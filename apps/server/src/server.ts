import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";
import type { CountryId, Scenario } from "@gs/shared";
import { createGameState, deserialize, GLOBAL_ROOM_ID, type ClientMessage, type Geography, type ServerMessage } from "@gs/sim";
import { login, logout, register, userForToken } from "./auth";
import type { Db } from "./db";
import { Room, type Conn } from "./room";

export interface ServerConfig {
  port: number;
  db: Db;
  scenario: Scenario;
  geo: Geography;
  /** Built web client to serve (apps/web/dist), if any. */
  webDist: string | null;
  /** How long a disconnected player's country waits before the AI takes over. */
  graceMs: number;
  /** Speed of the global world (fixed). */
  globalSpeed: 1 | 2 | 3 | 4 | 5;
  saveEveryMs: number;
  log?: (msg: string) => void;
}

const MAX_ROOMS = 100;
const MAX_ROOMS_PER_USER = 5;
/** Messages per second a single connection may send before being slowed down. */
const MESSAGES_PER_SECOND = 30;
const AUTH_TIMEOUT_MS = 10_000;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

/**
 * The game server: a web server for the client and the account API, plus a
 * WebSocket endpoint (/ws) for live games. One process can host many rooms.
 */
export function startServer(cfg: ServerConfig) {
  const log = cfg.log ?? ((m: string) => console.log(m));
  const rooms = new Map<string, Room>();
  const roomOf = new Map<Conn, Room>();
  let roomsCreatedBy = new Map<number, number>();

  const makeRoom = (o: { id: string; name: string; code: string | null; isPublic: boolean; hostUserId: number | null }, state = createGameState(cfg.scenario, cfg.geo, Math.floor(Math.random() * 2 ** 31))) => {
    const room = new Room(
      {
        ...o,
        fixedSpeed: o.isPublic ? cfg.globalSpeed : null,
        graceMs: cfg.graceMs,
        geo: cfg.geo,
        onMember: (r, userId, country) => cfg.db.setMember(r.id, userId, country),
      },
      state,
    );
    rooms.set(room.id, room);
    return room;
  };

  // Restore saved rooms, and make sure the global world exists.
  for (const r of cfg.db.rooms()) {
    try {
      const state = r.state ? deserialize(gunzipSync(r.state).toString("utf8")) : undefined;
      const room = makeRoom({ id: r.id, name: r.name, code: r.code, isPublic: r.is_public === 1, hostUserId: r.host_user_id }, state);
      for (const m of cfg.db.members(r.id)) room.restoreMember(m.user_id, m.username, m.country as CountryId | null);
      room.savedTick = room.state.tick;
    } catch (e) {
      log(`Could not restore room ${r.id}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  if (!rooms.has(GLOBAL_ROOM_ID)) {
    const world = makeRoom({ id: GLOBAL_ROOM_ID, name: "Global World", code: null, isPublic: true, hostUserId: null });
    save(world);
  }

  function save(room: Room) {
    cfg.db.saveRoom({ id: room.id, name: room.name, code: room.code, isPublic: room.isPublic, hostUserId: room.hostUserId, state: room.snapshot() });
    room.savedTick = room.state.tick;
  }
  const saveAll = () => {
    for (const r of rooms.values()) if (r.savedTick !== r.state.tick) save(r);
  };

  // ---------- HTTP ----------
  const attempts = new Map<string, { count: number; since: number }>();
  /** At most 20 sign-in attempts per address per 10 minutes. */
  const tooManyAttempts = (ip: string) => {
    const now = Date.now();
    const a = attempts.get(ip);
    if (!a || now - a.since > 600_000) {
      attempts.set(ip, { count: 1, since: now });
      return false;
    }
    a.count++;
    return a.count > 20;
  };

  const http = createServer((req, res) => {
    handleHttp(req, res).catch((e: unknown) => {
      log(`HTTP error: ${e instanceof Error ? e.message : String(e)}`);
      if (!res.headersSent) json(res, 500, { error: "Server error" });
    });
  });

  async function handleHttp(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname === "/api/health") return json(res, 200, { ok: true, rooms: rooms.size });
    if (req.method === "POST" && (url.pathname === "/api/register" || url.pathname === "/api/login")) {
      if (tooManyAttempts(req.socket.remoteAddress ?? "?")) return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });
      const body = await readJson(req);
      const result = url.pathname === "/api/register" ? register(cfg.db, body?.username, body?.password) : login(cfg.db, body?.username, body?.password);
      return result.ok ? json(res, 200, { token: result.token, user: result.user }) : json(res, 400, { error: result.error });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      if (token) logout(cfg.db, token);
      return json(res, 200, { ok: true });
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
    return serveStatic(url.pathname, res);
  }

  function serveStatic(pathname: string, res: ServerResponse) {
    if (!cfg.webDist) {
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("World Ascendant game server is running. Build the web client (npm run build) to play from this address.");
    }
    const root = resolve(cfg.webDist);
    let file = normalize(join(root, decodeURIComponent(pathname)));
    if (!file.startsWith(root)) {
      res.writeHead(403);
      return res.end();
    }
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).pipe(res);
  }

  // ---------- WebSocket ----------
  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 64 * 1024, perMessageDeflate: { threshold: 1024 } });

  wss.on("connection", (ws: WebSocket) => {
    let conn: Conn | null = null;
    let budget = MESSAGES_PER_SECOND;
    const refill = setInterval(() => (budget = MESSAGES_PER_SECOND), 1000);
    const authTimer = setTimeout(() => !conn && ws.close(4001, "Sign in first"), AUTH_TIMEOUT_MS);
    const send = (msg: ServerMessage) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(msg));

    ws.on("message", (raw) => {
      if (--budget < 0) return send({ t: "error", message: "Slow down: too many messages." });
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return send({ t: "error", message: "Bad message." });
      }
      if (!msg || typeof msg !== "object" || typeof msg.t !== "string") return send({ t: "error", message: "Bad message." });

      if (!conn) {
        if (msg.t !== "auth") return ws.close(4001, "Sign in first");
        const user = userForToken(cfg.db, msg.token);
        if (!user) return ws.close(4003, "Session expired. Please sign in again.");
        conn = { user, send: (data) => ws.readyState === ws.OPEN && ws.send(data) };
        clearTimeout(authTimer);
        send({ t: "welcome", user });
        send({ t: "rooms", rooms: listFor(user.id) });
        return;
      }
      handleMessage(conn, msg, send);
    });

    ws.on("close", () => {
      clearInterval(refill);
      clearTimeout(authTimer);
      if (conn) leaveRoom(conn);
    });
  });

  function listFor(userId: number) {
    const mine = new Set(cfg.db.roomsOfUser(userId));
    return [...rooms.values()].filter((r) => r.isPublic || mine.has(r.id)).map((r) => r.summary(userId));
  }

  function leaveRoom(conn: Conn) {
    const room = roomOf.get(conn);
    if (!room) return;
    room.disconnect(conn);
    roomOf.delete(conn);
  }

  function handleMessage(conn: Conn, msg: ClientMessage, send: (m: ServerMessage) => void) {
    switch (msg.t) {
      case "list":
        return send({ t: "rooms", rooms: listFor(conn.user.id) });
      case "create": {
        const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 40) : "";
        if (!name) return send({ t: "error", message: "Give your server a name." });
        if (rooms.size >= MAX_ROOMS) return send({ t: "error", message: "This game server is full. Try again later." });
        const made = roomsCreatedBy.get(conn.user.id) ?? 0;
        if (made >= MAX_ROOMS_PER_USER) return send({ t: "error", message: `You can create up to ${MAX_ROOMS_PER_USER} servers per session.` });
        roomsCreatedBy.set(conn.user.id, made + 1);
        let code = "";
        do code = Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
        while ([...rooms.values()].some((r) => r.code === code));
        const room = makeRoom({ id: randomBytes(8).toString("hex"), name, code, isPublic: false, hostUserId: conn.user.id });
        save(room);
        log(`${conn.user.username} created room "${name}" (${code})`);
        return joinRoom(conn, room, send);
      }
      case "join": {
        const key = typeof msg.room === "string" ? msg.room.trim() : "";
        const room = rooms.get(key) ?? [...rooms.values()].find((r) => r.code && r.code === key.toUpperCase());
        if (!room) return send({ t: "error", message: "No server with that code." });
        if (!room.isPublic && room.code !== key.toUpperCase() && !room.isMember(conn.user.id)) return send({ t: "error", message: "No server with that code." });
        return joinRoom(conn, room, send);
      }
      case "leave":
        leaveRoom(conn);
        send({ t: "left" });
        return send({ t: "rooms", rooms: listFor(conn.user.id) });
      default: {
        const room = roomOf.get(conn);
        if (!room) return send({ t: "error", message: "Join a server first." });
        room.handle(conn, msg as never);
      }
    }
  }

  function joinRoom(conn: Conn, room: Room, send: (m: ServerMessage) => void) {
    leaveRoom(conn);
    const err = room.join(conn);
    if (err) return send({ t: "error", message: err });
    roomOf.set(conn, room);
  }

  // ---------- Loops ----------
  const stepTimer = setInterval(() => {
    const now = Date.now();
    for (const r of rooms.values()) r.step(now);
  }, 50);
  const saveTimer = setInterval(saveAll, cfg.saveEveryMs);

  return new Promise<{ port: number; close: () => Promise<void>; rooms: Map<string, Room> }>((ready) => {
    http.listen(cfg.port, () => {
      const address = http.address();
      const port = typeof address === "object" && address ? address.port : cfg.port;
      log(`Game server listening on http://localhost:${port}`);
      ready({
        port,
        rooms,
        close: async () => {
          clearInterval(stepTimer);
          clearInterval(saveTimer);
          saveAll();
          for (const c of wss.clients) c.close(1001, "Server restarting");
          await new Promise<void>((done) => wss.close(() => http.close(() => done())));
          roomsCreatedBy = new Map();
        },
      });
    });
  });
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown> | null> {
  return new Promise((done) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 10_000) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => {
      try {
        done(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>);
      } catch {
        done(null);
      }
    });
    req.on("error", () => done(null));
  });
}
