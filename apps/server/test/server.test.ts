import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { CountryId, Scenario } from "@gs/shared";
import { applyPatch, geographyFrom, round5, GLOBAL_ROOM_ID, type ClientMessage, type GameState, type GeographyData, type ServerMessage } from "@gs/sim";
import { register } from "../src/auth";
import { Db } from "../src/db";
import { startServer } from "../src/server";

const data = (name: string) => JSON.parse(readFileSync(new URL(`../../web/src/data/${name}`, import.meta.url), "utf8")) as unknown;
const scenarios = { modern: data("scenario-modern.json") as Scenario, "cold-war-1991": data("scenario-cold-war-1991.json") as Scenario };
const geo = geographyFrom(data("geography.json") as GeographyData);

type Server = Awaited<ReturnType<typeof startServer>>;
const start = (db: Db, graceMs = 300) =>
  startServer({ port: 0, db, scenarios, geo, webDist: null, graceMs, globalSpeed: 2, saveEveryMs: 60_000, log: () => {} });

let server: Server;
let db: Db;
let base = "";

beforeAll(async () => {
  db = new Db(":memory:");
  server = await start(db);
  base = `http://localhost:${server.port}`;
});
afterAll(async () => {
  await server.close();
});

async function api(path: string, body: unknown) {
  const res = await fetch(base + path, { method: "POST", body: JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as { token?: string; error?: string; user?: { id: number } } };
}
let n = 0;
async function newUser(prefix = "player") {
  const username = `${prefix}${++n}`;
  const r = await api("/api/register", { username, password: "correct horse" });
  return { username, token: r.body.token!, id: r.body.user!.id };
}

/** Create an account directly (skips the HTTP sign-up limit, which would block 50 sign-ups at once). */
function directUser(prefix = "bulk") {
  const r = register(db, `${prefix}${++n}`, "correct horse");
  if (!r.ok) throw new Error(r.error);
  return { username: r.user.username, token: r.token, id: r.user.id };
}

/** A scripted player: connects, signs in, records every message, keeps a copy of the game. */
class TestClient {
  ws: WebSocket;
  messages: ServerMessage[] = [];
  state: GameState | null = null;
  bytes = 0;
  constructor(port: number) {
    this.ws = new WebSocket(`ws://localhost:${port}/ws`);
    this.ws.on("message", (raw) => {
      this.bytes += (raw as Buffer).length;
      const m = JSON.parse(raw.toString()) as ServerMessage;
      this.messages.push(m);
      if (m.t === "joined") this.state = m.state;
      if (m.t === "patch" && this.state) this.state = applyPatch(this.state, m.patch);
    });
  }
  static async signedIn(port: number, token: string) {
    const c = new TestClient(port);
    await new Promise((ok) => c.ws.once("open", ok));
    c.send({ t: "auth", token });
    await c.next("welcome");
    return c;
  }
  send(m: ClientMessage) {
    this.ws.send(JSON.stringify(m));
  }
  /** Wait for the next message of a type (optionally matching a condition). */
  async next<T extends ServerMessage["t"]>(t: T, match: (m: Extract<ServerMessage, { t: T }>) => boolean = () => true, ms = 5000) {
    const seen = this.messages.length;
    const found = () => this.messages.find((m, i) => i >= 0 && m.t === t && match(m as Extract<ServerMessage, { t: T }>)) as Extract<ServerMessage, { t: T }> | undefined;
    const started = Date.now();
    for (;;) {
      const m = found();
      if (m) {
        this.messages.splice(this.messages.indexOf(m), 1);
        return m;
      }
      if (Date.now() - started > ms) throw new Error(`Timed out waiting for "${t}" (had ${this.messages.slice(seen).map((x) => x.t).join(", ")})`);
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  /** Bytes actually received over the network (after compression). */
  get wireBytes(): number {
    return (this.ws as unknown as { _socket?: { bytesRead: number } })._socket?.bytesRead ?? 0;
  }
  close() {
    this.ws.close();
  }
}

describe("accounts", () => {
  it("registers, refuses duplicates and bad input, and logs in", async () => {
    const u = await newUser("alice");
    expect(u.token).toBeTruthy();
    expect((await api("/api/register", { username: u.username, password: "another one" })).body.error).toMatch(/taken/);
    expect((await api("/api/register", { username: "x", password: "correct horse" })).body.error).toMatch(/Usernames/);
    expect((await api("/api/register", { username: "shortpw", password: "abc" })).body.error).toMatch(/at least 8/);
    expect((await api("/api/login", { username: u.username, password: "wrong password" })).status).toBe(400);
    expect((await api("/api/login", { username: u.username.toUpperCase(), password: "correct horse" })).body.token).toBeTruthy();
  });

  it("never stores passwords or tokens in plain text", async () => {
    const u = await newUser("carol");
    const row = db.userByName(u.username)!;
    expect(row.pass_hash).not.toContain("correct horse");
    expect(db.sessionUser(u.token)).toBeUndefined(); // stored hashed, so the raw token finds nothing
  });

  it("closes connections that don't sign in, or use a bad token", async () => {
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    await new Promise((ok) => ws.once("open", ok));
    ws.send(JSON.stringify({ t: "auth", token: "made-up" }));
    const code = await new Promise<number>((ok) => ws.once("close", ok));
    expect(code).toBe(4003);
  });
});

describe("rooms", () => {
  it("everyone can see and join the Global World", async () => {
    const u = await newUser();
    const c = await TestClient.signedIn(server.port, u.token);
    const list = await c.next("rooms");
    expect(list.rooms.some((r) => r.id === GLOBAL_ROOM_ID && r.isPublic)).toBe(true);
    c.send({ t: "join", room: GLOBAL_ROOM_ID });
    const joined = await c.next("joined");
    expect(Object.keys(joined.state.provinces).length).toBeGreaterThan(4000);
    expect(joined.clock.fixed).toBe(true);
    c.close();
  });

  it("private servers are joined with an invite code; the code is only shown to members", async () => {
    const host = await newUser("host");
    const guest = await newUser("guest");
    const stranger = await newUser("stranger");
    const h = await TestClient.signedIn(server.port, host.token);
    h.send({ t: "create", name: "Friday game" });
    const joined = await h.next("joined");
    const code = joined.room.code!;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    expect(joined.you.host).toBe(true);

    const s = await TestClient.signedIn(server.port, stranger.token);
    expect((await s.next("rooms")).rooms.some((r) => r.name === "Friday game")).toBe(false);
    s.send({ t: "join", room: "WRONG1" });
    expect((await s.next("error")).message).toMatch(/No server/);

    const g = await TestClient.signedIn(server.port, guest.token);
    g.send({ t: "join", room: code.toLowerCase() });
    const gj = await g.next("joined");
    expect(gj.room.name).toBe("Friday game");
    expect(gj.you.host).toBe(false);
    const players = await h.next("players", (m) => m.players.length === 2);
    expect(players.players.map((p) => p.name)).toContain(guest.username);
    for (const c of [h, s, g]) c.close();
  });
});

describe("playing together", () => {
  it("one player per country; you can only command your own country; only the host controls time", async () => {
    const host = await newUser("hostb");
    const guest = await newUser("guestb");
    const h = await TestClient.signedIn(server.port, host.token);
    h.send({ t: "create", name: "Rules test" });
    const { room } = await h.next("joined");
    const g = await TestClient.signedIn(server.port, guest.token);
    g.send({ t: "join", room: room.code! });
    await g.next("joined");

    h.send({ t: "claim", country: "FRA" as CountryId });
    expect((await h.next("you")).country).toBe("FRA");
    g.send({ t: "claim", country: "FRA" as CountryId });
    expect((await g.next("error")).message).toMatch(/already played/);
    g.send({ t: "claim", country: "DEU" as CountryId });
    await g.next("you", (m) => m.country === "DEU");

    // Germany tries to order France around, and to move France's units.
    g.send({ t: "cmd", command: { type: "setTaxRate", country: "FRA" as CountryId, value: 0.5 } });
    expect((await g.next("error")).message).toMatch(/own country/);
    const frenchUnit = Object.values(g.state!.units).find((u) => u.owner === "FRA")!;
    g.send({ t: "cmd", command: { type: "moveUnits", country: "DEU" as CountryId, units: [frenchUnit.id], to: frenchUnit.province } });
    expect((await g.next("error")).message).toMatch(/your own units/);
    g.send({ t: "cmd", command: { type: "claimCountry", country: "ITA" as CountryId } });
    expect((await g.next("error")).message).toMatch(/Play as/);

    // A valid order goes through and both players see it.
    g.send({ t: "cmd", command: { type: "setTaxRate", country: "DEU" as CountryId, value: 0.4 } });
    await h.next("patch", (m) => m.patch.countries["DEU"]?.taxRate === 0.4);

    // Time: guests can't change it, the host can, and everyone's copy keeps up.
    g.send({ t: "clock", paused: false });
    expect((await g.next("error")).message).toMatch(/Only the host/);
    h.send({ t: "clock", paused: false, speed: 5 });
    await g.next("clock", (m) => !m.clock.paused && m.clock.speed === 5);
    await g.next("patch", (m) => m.patch.tick > 60);
    h.send({ t: "clock", paused: true });
    await g.next("clock", (m) => m.clock.paused);
    await new Promise((r) => setTimeout(r, 400));
    const real = server.rooms.get(room.id)!.state;
    expect(g.state!.tick).toBe(real.tick);
    // Numbers travel rounded to 5 significant digits; everything else is exact.
    const { history: _h, ...deu } = real.countries["DEU" as CountryId]!;
    const { history: _gh, ...gDeu } = g.state!.countries["DEU" as CountryId]!;
    expect(gDeu).toEqual(round5(deu));
    expect(g.state!.units).toEqual(real.units);

    // Chat reaches everyone.
    g.send({ t: "chat", text: "  hello france  " });
    expect((await h.next("chat")).message).toMatchObject({ from: guest.username, text: "hello france" });
    h.close();
    g.close();
  });

  it("the AI takes over a disconnected player's country, and gives it back when they return", async () => {
    const u = await newUser("dropper");
    const c = await TestClient.signedIn(server.port, u.token);
    c.send({ t: "create", name: "Takeover test" });
    const { room } = await c.next("joined");
    c.send({ t: "claim", country: "BRA" as CountryId });
    await c.next("you");
    const live = server.rooms.get(room.id)!;
    expect(live.state.countries["BRA" as CountryId]!.controller).toBe("human");
    c.close();
    await new Promise((r) => setTimeout(r, 700)); // grace period in tests is 300 ms
    expect(live.state.countries["BRA" as CountryId]!.controller).toBe("ai");
    expect(live.state.events.some((e) => e.text.includes("the AI is running Brazil"))).toBe(true);

    const back = await TestClient.signedIn(server.port, u.token);
    back.send({ t: "join", room: room.code! });
    const j = await back.next("joined");
    expect(j.you.country).toBe("BRA");
    expect(live.state.countries["BRA" as CountryId]!.controller).toBe("human");
    back.close();
  });

  it("a server holds at most 50 players", async () => {
    const host = await newUser("big");
    const h = await TestClient.signedIn(server.port, host.token);
    h.send({ t: "create", name: "Full house" });
    const { room } = await h.next("joined");
    const live = server.rooms.get(room.id)!;
    // Fill the other 49 seats directly (registering 49 accounts over HTTP would be slow).
    for (let i = 0; i < 49; i++) {
      const bot = directUser("bot");
      live.join({ user: { id: bot.id, username: bot.username }, send: () => {} });
    }
    const late = directUser("late");
    const l = await TestClient.signedIn(server.port, late.token);
    l.send({ t: "join", room: room.code! });
    expect((await l.next("error")).message).toMatch(/full \(50 players\)/);
    h.close();
    l.close();
  });
});

describe("scenarios and custom worlds", () => {
  it("a private server can start in 1991, or from a custom world", async () => {
    const u = await newUser("history");
    const c = await TestClient.signedIn(server.port, u.token);
    c.send({ t: "create", name: "Cold War game", scenario: "cold-war-1991" });
    const cw = await c.next("joined");
    expect(cw.state.startDate).toBe("1991-01-01");
    expect(cw.state.countries["SUN" as CountryId]?.name).toBe("Soviet Union");

    c.send({
      t: "create",
      name: "Custom game",
      custom: { version: 1, name: "Bavarian independence", base: "modern", owners: { "DEU-1591": "C-1" as CountryId }, newCountries: { "C-1": { name: "Free Bavaria", color: "#3366cc" } } },
    });
    const cu = await c.next("joined");
    expect(cu.state.scenarioName).toBe("Bavarian independence");
    expect(cu.state.provinces["DEU-1591" as never]).toMatchObject({ owner: "C-1" });

    // Bad worlds are refused with a reason.
    c.send({ t: "create", name: "Broken", custom: { version: 1, name: "x", base: "modern", owners: { "DEU-1591": "NOPE" as CountryId }, newCountries: {} } });
    expect((await c.next("error")).message).toMatch(/Unknown country/);
    c.send({ t: "create", name: "Mystery", scenario: "atlantis" });
    expect((await c.next("error")).message).toMatch(/Unknown scenario/);
    c.close();
  });
});

describe("saving", () => {
  it("rooms, games and players' countries survive a server restart", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-"));
    try {
      const file = join(dir, "game.db");
      let d = new Db(file);
      let s = await start(d);
      const reg = await fetch(`http://localhost:${s.port}/api/register`, { method: "POST", body: JSON.stringify({ username: "saver", password: "correct horse" }) });
      const { token } = (await reg.json()) as { token: string };
      let c = await TestClient.signedIn(s.port, token);
      c.send({ t: "create", name: "Persistent" });
      const { room } = await c.next("joined");
      c.send({ t: "claim", country: "JPN" as CountryId });
      await c.next("you");
      c.send({ t: "clock", paused: false, speed: 5 });
      await c.next("patch", (m) => m.patch.tick > 30);
      c.send({ t: "clock", paused: true });
      await c.next("clock", (m) => m.clock.paused);
      const tickBefore = s.rooms.get(room.id)!.state.tick;
      c.close();
      await s.close();
      d.close();

      d = new Db(file);
      s = await start(d);
      expect(s.rooms.get(room.id)!.state.tick).toBe(tickBefore);
      c = await TestClient.signedIn(s.port, token);
      expect((await c.next("rooms")).rooms.some((r) => r.id === room.id)).toBe(true);
      c.send({ t: "join", room: room.id });
      const j = await c.next("joined");
      expect(j.you.country).toBe("JPN");
      expect(j.state.tick).toBe(tickBefore);
      c.close();
      await s.close();
      d.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("load", () => {
  it("50 connected players at top speed: how much data each receives", async () => {
    const users = Array.from({ length: 50 }, () => directUser("load"));
    const clients = await Promise.all(users.map((u) => TestClient.signedIn(server.port, u.token)));
    clients[0]!.send({ t: "create", name: "Load test" });
    const { room } = await clients[0]!.next("joined");
    for (const c of clients.slice(1)) c.send({ t: "join", room: room.code! });
    await Promise.all(clients.slice(1).map((c) => c.next("joined")));
    const live = server.rooms.get(room.id)!;
    for (const speed of [2, 5] as const) {
      await new Promise((r) => setTimeout(r, 300));
      const wire0 = clients.map((c) => c.wireBytes);
      const tick0 = live.state.tick;
      clients[0]!.send({ t: "clock", paused: false, speed });
      const started = Date.now();
      let worstStep = 0;
      const watch = setInterval(() => (worstStep = Math.max(worstStep, live.lastStepMs)), 20);
      await new Promise((r) => setTimeout(r, 4000));
      clearInterval(watch);
      console.log(`LOAD speed ${speed}: slowest server step ${worstStep.toFixed(1)} ms`);
      clients[0]!.send({ t: "clock", paused: true });
      const seconds = (Date.now() - started) / 1000;
      const perClient = clients.reduce((a, c, i) => a + c.wireBytes - wire0[i]!, 0) / clients.length / seconds;
      console.log(`LOAD speed ${speed}: 50 players, ${Math.round((live.state.tick - tick0) / seconds)} game days/s, ~${(perClient / 1024).toFixed(1)} KB/s per player on the wire`);
      // Speed 2 is the global world's pace; it must be light. Top speed is allowed to cost more.
      expect(perClient / 1024).toBeLessThan(speed === 2 ? 20 : 150);
    }
    // The 50 test players run in this same process as the server, so they need a moment to catch up.
    for (let i = 0; i < 50 && clients.some((c) => c.state?.tick !== live.state.tick); i++) await new Promise((r) => setTimeout(r, 100));
    const behind = clients.filter((c) => c.state?.tick !== live.state.tick).map((c) => c.state?.tick);
    console.log("LOAD after pause: server tick", live.state.tick, "clients behind:", behind.length, behind.slice(0, 5));
    expect(behind).toEqual([]);
    for (const c of clients) c.close();
  }, 60_000);
});
