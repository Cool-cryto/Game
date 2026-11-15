import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { WebSocketServer, type WebSocket } from "ws";
import type { CountryId, Scenario } from "@gs/shared";
import { applyCustomWorld, createGameState, deserialize, GLOBAL_ROOM_ID, validateCustomWorld, type ClientMessage, type Geography, type ServerMessage } from "@gs/sim";
import { login, logout, register, userForToken } from "./auth";
import { accessKind, completeCheckout, confirmCheckout, createCheckout, hasAccess, isAdmin, verifyStripeSignature, type PaywallConfig } from "./paywall";
import type { Db } from "./db";
import { Room, type Conn } from "./room";

export interface ServerConfig {
  port: number;
  db: Db;
  /** Built-in starting worlds by id; "modern" is the default and the Global World's. */
  scenarios: Record<string, Scenario>;
  geo: Geography;
  /** Built web client to serve (apps/web/dist), if any. */
  webDist: string | null;
  /** How long a disconnected player's country waits before the AI takes over. */
  graceMs: number;
  /** Speed of the global world (fixed). */
  globalSpeed: 1 | 2 | 3 | 4 | 5;
  saveEveryMs: number;
  /**
   * True when the server runs behind a hosting provider's proxy (Railway, Fly.io,
   * Render…). Every request then arrives from the proxy, so the player's own address
   * is read from the X-Forwarded-For header the proxy adds. Never set it without a
   * proxy in front: players could then fake their address to dodge the sign-in limit.
   */
  trustProxy?: boolean;
  /** The $5 paywall (see paywall.ts). Null or missing: everyone can play. */
  paywall?: PaywallConfig | null;
  log?: (msg: string) => void;
}

const MAX_ROOMS = 100;
const MAX_ROOMS_PER_USER = 5;
/** Messages per second a single connection may send before being slowed down. */
const MESSAGES_PER_SECOND = 30;
const AUTH_TIMEOUT_MS = 10_000;
/**
 * Ping every connection this often. Hosting proxies close connections that are
 * quiet for about a minute (e.g. a paused game); pings keep them open, and a
 * connection that misses a ping is dead and gets closed.
 */
const PING_MS = 25_000;
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

  const newState = (scenario: Scenario) => createGameState(scenario, cfg.geo, Math.floor(Math.random() * 2 ** 31));
  const makeRoom = (o: { id: string; name: string; code: string | null; isPublic: boolean; hostUserId: number | null }, state = newState(cfg.scenarios.modern!)) => {
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
    if (attempts.size > 10_000) for (const [k, v] of attempts) if (now - v.since > 600_000) attempts.delete(k);
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
      if (tooManyAttempts(clientAddress(req, cfg.trustProxy ?? false))) return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });
      const body = await readJson(req);
      const result = url.pathname === "/api/register" ? register(cfg.db, body?.username, body?.password) : login(cfg.db, body?.username, body?.password);
      if (!result.ok) return json(res, 400, { error: result.error });
      setSessionCookie(req, res, result.token);
      return json(res, 200, { token: result.token, user: result.user, ...accessInfo(result.user) });
    }
    if (req.method === "POST" && url.pathname === "/api/logout") {
      const token = bearer(req);
      if (token) logout(cfg.db, token);
      res.setHeader("set-cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
      return json(res, 200, { ok: true });
    }
    // ----- Paywall -----
    const pw = cfg.paywall ?? null;
    if (req.method === "GET" && url.pathname === "/api/config") {
      return json(res, 200, { paywall: !!pw, priceCents: pw?.priceCents ?? 0, currency: pw?.currency ?? "usd", canBuy: !!pw?.stripeSecretKey });
    }
    if (req.method === "GET" && url.pathname === "/api/me") {
      const user = userForToken(cfg.db, bearer(req));
      if (!user) return json(res, 401, { error: "Please sign in again." });
      setSessionCookie(req, res, bearer(req)!); // lets the browser load the map files
      return json(res, 200, { user, ...accessInfo(user) });
    }
    if (req.method === "POST" && url.pathname === "/api/checkout") {
      const user = userForToken(cfg.db, bearer(req));
      if (!user) return json(res, 401, { error: "Please sign in first." });
      if (!pw?.stripeSecretKey) return json(res, 400, { error: "Purchases aren't open yet." });
      if (hasAccess(pw, cfg.db, user)) return json(res, 400, { error: "You already have the full game." });
      if (tooManyAttempts(clientAddress(req, cfg.trustProxy ?? false))) return json(res, 429, { error: "Too many attempts. Try again in a few minutes." });
      try {
        return json(res, 200, { url: await createCheckout(pw, user, publicBase(req)) });
      } catch (e) {
        log(`Stripe checkout failed: ${e instanceof Error ? e.message : String(e)}`);
        return json(res, 502, { error: "The payment page couldn't be opened. Try again in a moment." });
      }
    }
    if (req.method === "POST" && url.pathname === "/api/checkout/confirm") {
      const user = userForToken(cfg.db, bearer(req));
      const body = await readJson(req);
      if (!user) return json(res, 401, { error: "Please sign in first." });
      if (!pw?.stripeSecretKey || typeof body?.id !== "string") return json(res, 400, { error: "Bad request." });
      try {
        await confirmCheckout(pw, cfg.db, user.id, body.id);
      } catch (e) {
        log(`Stripe confirm failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      return json(res, 200, accessInfo(user));
    }
    if (req.method === "POST" && url.pathname === "/api/stripe/webhook") {
      if (!pw?.stripeWebhookSecret) return json(res, 404, { error: "Not found" });
      const raw = await readRaw(req, 256 * 1024);
      const sig = req.headers["stripe-signature"];
      if (raw === null || !verifyStripeSignature(raw, Array.isArray(sig) ? sig[0] : sig, pw.stripeWebhookSecret)) return json(res, 400, { error: "Bad signature" });
      const event = JSON.parse(raw) as { type?: string; data?: { object?: Record<string, unknown> } };
      if ((event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") && event.data?.object) {
        const unlocked = completeCheckout(pw, cfg.db, event.data.object);
        if (unlocked !== null) log(`Game unlocked by payment for user ${unlocked}`);
      }
      return json(res, 200, { received: true });
    }
    if (url.pathname.startsWith("/api/admin/")) {
      const user = userForToken(cfg.db, bearer(req));
      if (!pw || !user || !isAdmin(pw, user.username)) return json(res, 403, { error: "Only admins can do that." });
      if (req.method === "GET" && url.pathname === "/api/admin/users") {
        const q = (url.searchParams.get("q") ?? "").slice(0, 40);
        return json(res, 200, { users: cfg.db.findUsers(q).map((u) => ({ username: u.username, access: isAdmin(pw, u.username) ? "admin" : u.access, createdAt: u.created_at })) });
      }
      if (req.method === "POST" && url.pathname === "/api/admin/access") {
        const body = await readJson(req);
        const target = typeof body?.username === "string" ? cfg.db.userByName(body.username) : undefined;
        if (!target) return json(res, 404, { error: "No player with that username. They need to create an account first." });
        const current = cfg.db.accessOf(target.id);
        if (body?.access === "granted") {
          if (current === null) cfg.db.setAccess(target.id, "granted");
        } else if (body?.access === null) {
          if (current === "paid") return json(res, 400, { error: `${target.username} bought the game; their access can't be taken away here.` });
          cfg.db.setAccess(target.id, null);
          dropFromRooms(target.id);
        } else return json(res, 400, { error: "Bad request." });
        log(`${user.username} set access for ${target.username}: ${String(body.access)}`);
        return json(res, 200, { username: target.username, access: cfg.db.accessOf(target.id) });
      }
      return json(res, 404, { error: "Not found" });
    }
    if (url.pathname.startsWith("/api/")) return json(res, 404, { error: "Not found" });
    // The map is what makes the game playable: only players with access get it.
    if (pw && url.pathname.startsWith("/maps/")) {
      const user = userForToken(cfg.db, cookie(req, COOKIE));
      if (!user || !hasAccess(pw, cfg.db, user)) {
        res.writeHead(403, { "content-type": "text/plain" });
        return res.end("Unlock the game to load the map.");
      }
    }
    return serveStatic(url.pathname, res);
  }

  function accessInfo(user: { id: number; username: string }) {
    const pw = cfg.paywall ?? null;
    return { access: hasAccess(pw, cfg.db, user), accessKind: accessKind(pw, cfg.db, user), admin: !!pw && isAdmin(pw, user.username) };
  }

  /** The address players use, for Stripe's "come back here" links. */
  function publicBase(req: IncomingMessage): string {
    if (cfg.paywall?.publicUrl) return cfg.paywall.publicUrl;
    const proto = cfg.trustProxy ? String(req.headers["x-forwarded-proto"] ?? "https").split(",")[0]!.trim() : "http";
    return `${proto}://${req.headers.host ?? `localhost:${cfg.port}`}`;
  }

  /** The session also travels as a cookie, so the browser can load the (locked) map files. */
  function setSessionCookie(req: IncomingMessage, res: ServerResponse, token: string) {
    const secure = cfg.trustProxy ? String(req.headers["x-forwarded-proto"] ?? "").startsWith("https") : false;
    res.setHeader("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`);
  }

  /** Someone lost access: take them out of every room they're in. */
  function dropFromRooms(userId: number) {
    for (const [conn, room] of [...roomOf]) {
      if (conn.user.id !== userId) continue;
      room.disconnect(conn);
      roomOf.delete(conn);
      conn.kick?.();
    }
    for (const ws of wss.clients) if (connOf.get(ws)?.user.id === userId) ws.close(4005, "Your access to the game was removed.");
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
    if (!existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" });
      return res.end("Not found");
    }
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
    createReadStream(file).on("error", () => res.destroy()).pipe(res);
  }

  // ---------- WebSocket ----------
  // maxPayload leaves room for a custom world in the "create" message.
  const wss = new WebSocketServer({ server: http, path: "/ws", maxPayload: 512 * 1024, perMessageDeflate: { threshold: 1024 } });

  const alive = new WeakMap<WebSocket, boolean>();
  const connOf = new WeakMap<WebSocket, Conn>();
  wss.on("connection", (ws: WebSocket) => {
    let conn: Conn | null = null;
    alive.set(ws, true);
    ws.on("pong", () => alive.set(ws, true));
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
        if (!hasAccess(cfg.paywall ?? null, cfg.db, user)) return ws.close(4005, "Unlock the game to play online.");
        conn = { user, send: (data) => ws.readyState === ws.OPEN && ws.send(data), kick: () => ws.close(4005, "Your access to the game was removed.") };
        connOf.set(ws, conn);
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
    // Access can be taken away while someone is connected.
    if (cfg.paywall && (msg.t === "join" || msg.t === "create") && !hasAccess(cfg.paywall, cfg.db, conn.user)) return conn.kick?.();
    switch (msg.t) {
      case "list":
        return send({ t: "rooms", rooms: listFor(conn.user.id) });
      case "create": {
        const name = typeof msg.name === "string" ? msg.name.trim().slice(0, 40) : "";
        if (!name) return send({ t: "error", message: "Give your server a name." });
        if (rooms.size >= MAX_ROOMS) return send({ t: "error", message: "This game server is full. Try again later." });
        // Which world: a built-in scenario, or a custom world made in the editor (checked first).
        let scenario: Scenario | undefined;
        if (msg.custom !== undefined) {
          const base = cfg.scenarios[(msg.custom as { base?: string })?.base ?? ""];
          if (!base) return send({ t: "error", message: "That custom world is based on a scenario this server doesn't have." });
          const problem = validateCustomWorld(msg.custom, base);
          if (problem) return send({ t: "error", message: problem });
          scenario = applyCustomWorld(base, msg.custom);
        } else {
          scenario = cfg.scenarios[typeof msg.scenario === "string" ? msg.scenario : "modern"];
          if (!scenario) return send({ t: "error", message: "Unknown scenario." });
        }
        const made = roomsCreatedBy.get(conn.user.id) ?? 0;
        if (made >= MAX_ROOMS_PER_USER) return send({ t: "error", message: `You can create up to ${MAX_ROOMS_PER_USER} servers per session.` });
        roomsCreatedBy.set(conn.user.id, made + 1);
        let code = "";
        do code = Array.from(randomBytes(6), (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
        while ([...rooms.values()].some((r) => r.code === code));
        const room = makeRoom({ id: randomBytes(8).toString("hex"), name, code, isPublic: false, hostUserId: conn.user.id }, newState(scenario));
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
  const pingTimer = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, PING_MS);

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
          clearInterval(pingTimer);
          saveAll();
          for (const c of wss.clients) c.close(1001, "Server restarting");
          await new Promise<void>((done) => wss.close(() => http.close(() => done())));
          roomsCreatedBy = new Map();
        },
      });
    });
  });
}

/** The player's network address: the socket's, or behind a trusted proxy the last address the proxy added. */
export function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const header = req.headers["x-forwarded-for"];
    const list = (Array.isArray(header) ? header.join(",") : (header ?? "")).split(",").map((x) => x.trim()).filter(Boolean);
    if (list.length) return list[list.length - 1]!;
  }
  return req.socket.remoteAddress ?? "?";
}

const COOKIE = "wa_session";
const bearer = (req: IncomingMessage) => (req.headers.authorization ?? "").replace(/^Bearer /, "") || undefined;
function cookie(req: IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

function readRaw(req: IncomingMessage, limit: number): Promise<string | null> {
  return new Promise((done) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) req.destroy();
      else chunks.push(c);
    });
    req.on("end", () => done(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => done(null));
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
