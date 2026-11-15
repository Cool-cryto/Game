import { gzipSync } from "node:zlib";
import type { CountryId } from "@gs/shared";
import {
  applyCommand,
  fogView,
  logEvent,
  MAX_PLAYERS_GLOBAL,
  MAX_PLAYERS_PER_ROOM,
  playerView,
  StateDiffer,
  tick,
  ViewSync,
  visionIndex,
  validateCommand,
  type ChatMessage,
  type Clock,
  type Command,
  type GameState,
  type Geography,
  type PlayerInfo,
  type PlayerView,
  type RoomSummary,
  type ServerMessage,
  type Unit,
} from "@gs/sim";

/** In-game days per real second at each speed (same as single player). */
const DAYS_PER_SECOND = [0, 1, 4, 15, 45, 120] as const;
const MAX_DAYS_PER_STEP = 20;
/** How often players get updates. */
export const PATCH_MS = 250;
const CHAT_HISTORY = 50;
const CHAT_MAX_LENGTH = 300;

/** One connected browser tab. */
export interface Conn {
  user: { id: number; username: string };
  send(data: string): void;
}

interface Member {
  userId: number;
  name: string;
  country: CountryId | null;
  conns: Set<Conn>;
  /** When the player went offline (ms), or null while connected. */
  offlineSince: number | null;
  /** True once the AI has taken over this player's country. */
  aiTookOver: boolean;
}

export interface RoomOptions {
  id: string;
  name: string;
  code: string | null;
  isPublic: boolean;
  hostUserId: number | null;
  /** Fixed speed for the global world; null lets the host choose. */
  fixedSpeed: Clock["speed"] | null;
  graceMs: number;
  geo: Geography;
  /** Called when membership or a player's country changes, to store it. */
  onMember?: (room: Room, userId: number, country: CountryId | null) => void;
}

/**
 * A multiplayer world. The room owns the only real copy of the game; players
 * send commands, which are checked (you may only command your own country)
 * and applied in order. Everyone receives the same patches, except that with
 * fog of war each player only gets the units and sieges their country can see.
 */
export class Room {
  readonly id: string;
  name: string;
  readonly code: string | null;
  readonly isPublic: boolean;
  hostUserId: number | null;
  state: GameState;
  clock: Clock;
  private members = new Map<number, Member>();
  private differ: StateDiffer;
  /** What each connected tab has been sent of the fogged parts (units, sieges). */
  private views = new Map<Conn, ViewSync>();
  private queue: Command[] = [];
  private carry = 0;
  private lastStep = 0;
  private lastPatch = 0;
  private changed = false;
  /** Tick at the last save, to know whether saving is needed. */
  savedTick = -1;
  private chat: ChatMessage[] = [];

  constructor(
    private opts: RoomOptions,
    state: GameState,
  ) {
    this.id = opts.id;
    this.name = opts.name;
    this.code = opts.code;
    this.isPublic = opts.isPublic;
    this.hostUserId = opts.hostUserId;
    this.state = state;
    this.differ = new StateDiffer(state, { units: false });
    this.clock = { paused: true, speed: opts.fixedSpeed ?? 1, fixed: opts.fixedSpeed !== null };
  }

  /** Restore members saved in the database (they start offline). */
  restoreMember(userId: number, name: string, country: CountryId | null) {
    this.members.set(userId, { userId, name, country, conns: new Set(), offlineSince: 0, aiTookOver: country !== null });
    // Saved games keep their humans' countries; offline players are AI until they return.
    if (country && this.state.countries[country]?.controller === "human") this.state.countries[country]!.controller = "ai";
  }

  get maxPlayers() {
    return this.isPublic ? MAX_PLAYERS_GLOBAL : MAX_PLAYERS_PER_ROOM;
  }

  get onlineCount() {
    return [...this.members.values()].filter((m) => m.conns.size > 0).length;
  }

  summary(forUser?: number): RoomSummary {
    const member = forUser !== undefined && this.members.has(forUser);
    return {
      id: this.id,
      name: this.name,
      code: member ? this.code : null,
      isPublic: this.isPublic,
      players: this.members.size,
      online: this.onlineCount,
      maxPlayers: this.maxPlayers,
    };
  }

  isMember(userId: number) {
    return this.members.has(userId);
  }

  /** Add a browser tab to the room. Returns an error message if it can't join. */
  join(conn: Conn): string | null {
    let m = this.members.get(conn.user.id);
    if (!m && this.members.size >= this.maxPlayers) return `This server is full (${this.maxPlayers} players).`;
    if (!m) {
      m = { userId: conn.user.id, name: conn.user.username, country: null, conns: new Set(), offlineSince: null, aiTookOver: false };
      this.members.set(m.userId, m);
      this.opts.onMember?.(this, m.userId, null);
    }
    m.offlineSince = null;
    if (this.hostUserId === null && !this.isPublic) this.hostUserId = m.userId;
    // Welcome back: take your country back from the AI, if nobody else took it.
    if (m.country && m.aiTookOver) {
      const c = this.state.countries[m.country];
      if (c?.active && c.controller === "ai") {
        applyCommand(this.state, this.opts.geo, { type: "claimCountry", country: m.country });
        logEvent(this.state, "diplomacy", `${m.name} is back and has taken over ${c.name} again.`, [m.country]);
        this.changed = true;
      } else m.country = null;
      m.aiTookOver = false;
    }
    // Bring everyone already here up to date before the newcomer gets a snapshot,
    // so the snapshot and the next patch don't overlap (no duplicated news).
    this.broadcastPatch(true);
    m.conns.add(conn);
    // Fog of war: the newcomer sees only what their country can see.
    const view = fogView(this.state, this.opts.geo, m.country);
    this.views.set(conn, new ViewSync(view));
    if (this.clock.fixed && this.clock.paused) this.clock.paused = false; // the global world runs while anyone is online
    this.send(conn, {
      t: "joined",
      room: this.summary(m.userId),
      state: view,
      players: this.players(),
      clock: this.clock,
      chat: this.chat,
      you: { country: m.country, host: this.hostUserId === m.userId },
    });
    this.broadcastPlayers();
    if (this.clock.fixed) this.broadcast({ t: "clock", clock: this.clock });
    return null;
  }

  /** A tab closed or left. The player stays a member; their country waits for the grace period. */
  disconnect(conn: Conn) {
    const m = this.members.get(conn.user.id);
    if (!m || !m.conns.delete(conn)) return;
    this.views.delete(conn);
    if (m.conns.size === 0) m.offlineSince = Date.now();
    if (this.onlineCount === 0) this.clock.paused = true; // nobody here: stop the clock
    this.broadcastPlayers();
  }

  handle(conn: Conn, msg: { t: string; [k: string]: unknown }): void {
    const m = this.members.get(conn.user.id);
    if (!m || !m.conns.has(conn)) return;
    switch (msg.t) {
      case "claim": {
        const country = msg.country as CountryId;
        const c = typeof country === "string" ? this.state.countries[country] : undefined;
        if (!c?.active) return this.error(conn, "That country can't be played.");
        if (c.controller === "human") return this.error(conn, `${c.name} is already played by someone.`);
        if (m.country) applyCommand(this.state, this.opts.geo, { type: "releaseCountry", country: m.country });
        applyCommand(this.state, this.opts.geo, { type: "claimCountry", country });
        m.country = country;
        m.aiTookOver = false;
        this.opts.onMember?.(this, m.userId, country);
        this.changed = true;
        this.send(conn, { t: "you", country, host: this.hostUserId === m.userId });
        this.broadcastPlayers();
        return;
      }
      case "release": {
        if (m.country) applyCommand(this.state, this.opts.geo, { type: "releaseCountry", country: m.country });
        m.country = null;
        this.opts.onMember?.(this, m.userId, null);
        this.changed = true;
        this.send(conn, { t: "you", country: null, host: this.hostUserId === m.userId });
        this.broadcastPlayers();
        return;
      }
      case "cmd": {
        const cmd = msg.command;
        const problem = checkCommand(cmd, m.country);
        if (problem) return this.error(conn, problem);
        const err = validateCommand(this.state, this.opts.geo, cmd as Command);
        if (err) return this.error(conn, err);
        this.queue.push(cmd as Command);
        return;
      }
      case "clock": {
        if (this.clock.fixed) return this.error(conn, "The global world runs at a fixed speed.");
        if (this.hostUserId !== m.userId) return this.error(conn, "Only the host can change the game speed.");
        if (typeof msg.paused === "boolean") this.clock.paused = msg.paused;
        if (typeof msg.speed === "number" && [1, 2, 3, 4, 5].includes(msg.speed)) this.clock.speed = msg.speed as Clock["speed"];
        this.carry = 0;
        this.broadcast({ t: "clock", clock: this.clock });
        return;
      }
      case "chat": {
        const text = typeof msg.text === "string" ? msg.text.trim().slice(0, CHAT_MAX_LENGTH) : "";
        if (!text) return;
        const message = { from: m.name, text, at: Date.now() };
        this.chat.push(message);
        if (this.chat.length > CHAT_HISTORY) this.chat.shift();
        this.broadcast({ t: "chat", message });
        return;
      }
    }
  }

  /**
   * Called every ~50 ms by the server: hand countries of long-disconnected
   * players to the AI, advance the game, and send patches.
   */
  /** Time spent in the last step (ms), for monitoring. */
  lastStepMs = 0;

  step(now: number) {
    const began = performance.now();
    try {
      this.stepInner(now);
    } finally {
      this.lastStepMs = performance.now() - began;
    }
  }

  private stepInner(now: number) {
    const seconds = this.lastStep ? (now - this.lastStep) / 1000 : 0;
    this.lastStep = now;

    for (const m of this.members.values()) {
      if (m.offlineSince === null || m.aiTookOver || !m.country) continue;
      if (now - m.offlineSince < this.opts.graceMs) continue;
      const c = this.state.countries[m.country];
      if (c?.controller === "human") {
        applyCommand(this.state, this.opts.geo, { type: "releaseCountry", country: m.country });
        logEvent(this.state, "diplomacy", `${m.name} disconnected; the AI is running ${c.name} until they return.`, [m.country]);
        this.changed = true;
      }
      m.aiTookOver = true;
      this.broadcastPlayers();
    }

    if (this.clock.paused) {
      // While paused, apply orders straight away so players see them.
      for (const cmd of this.queue.splice(0)) {
        applyCommand(this.state, this.opts.geo, cmd);
        this.changed = true;
      }
    } else {
      this.carry += seconds * DAYS_PER_SECOND[this.clock.speed];
      const days = Math.min(Math.floor(this.carry), MAX_DAYS_PER_STEP);
      this.carry = Math.min(this.carry - days, 5);
      for (let i = 0; i < days; i++) tick(this.state, this.opts.geo, i === 0 ? this.queue.splice(0) : []);
      if (days) this.changed = true;
    }
    if (this.changed && now - this.lastPatch >= PATCH_MS) this.broadcastPatch();
  }

  private broadcastPatch(force = false) {
    if (!this.changed && !force) return;
    const patch = this.differ.diff(this.state);
    this.lastPatch = Date.now();
    this.changed = false;

    // The shared part is serialized once. Provinces under siege differ per player
    // (sieges are hidden outside what you can see), and so do units.
    const { provinces, units: _none, ...rest } = patch;
    const head = JSON.stringify(rest);
    const plain: Record<string, unknown> = {};
    const sieged: string[] = [];
    for (const [id, p] of Object.entries(provinces)) {
      if (p.siege) sieged.push(id);
      else plain[id] = p;
    }
    const plainJson = JSON.stringify(plain);
    const viewsOf = new Map<string, PlayerView>();
    const index = visionIndex(this.state);
    const jsonCache = new Map<Unit, string>();
    for (const m of this.members.values()) {
      if (!m.conns.size) continue;
      const key = m.country ?? "";
      let pv = viewsOf.get(key);
      if (!pv) viewsOf.set(key, (pv = playerView(this.state, this.opts.geo, m.country, index, jsonCache)));
      for (const conn of m.conns) {
        const sync = this.views.get(conn);
        if (!sync) continue;
        const own = sync.diff(pv);
        for (const id of sieged) own.provinces[id] ??= pv.view.provinces[id as keyof GameState["provinces"]]!;
        const provincesJson = mergeObjectJson(plainJson, JSON.stringify(own.provinces));
        conn.send(`{"t":"patch","patch":${head.slice(0, -1)},"provinces":${provincesJson},"units":${JSON.stringify(own.units)}}}`);
      }
    }
  }

  players(): PlayerInfo[] {
    return [...this.members.values()].map((m) => ({
      userId: m.userId,
      name: m.name,
      country: m.country,
      online: m.conns.size > 0,
      host: this.hostUserId === m.userId,
    }));
  }

  private broadcastPlayers() {
    this.broadcast({ t: "players", players: this.players() });
  }

  /** Serialize once, send to every connected tab. */
  private broadcast(msg: ServerMessage) {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) for (const c of m.conns) c.send(data);
  }
  private send(conn: Conn, msg: ServerMessage) {
    conn.send(JSON.stringify(msg));
  }
  private error(conn: Conn, message: string) {
    this.send(conn, { t: "error", message });
  }

  /** The saved form of the game (gzip-compressed JSON). */
  snapshot(): Uint8Array {
    return gzipSync(JSON.stringify(this.state));
  }
}

/** Join two JSON objects given as text (keys in the second win). */
function mergeObjectJson(a: string, b: string): string {
  if (a === "{}") return b;
  if (b === "{}") return a;
  return `${a.slice(0, -1)},${b.slice(1)}`;
}

/**
 * Check a command from the network before the game sees it: the right shape,
 * and only for the sender's own country. Returns a problem, or null if fine.
 */
export function checkCommand(cmd: unknown, myCountry: CountryId | null): string | null {
  if (!cmd || typeof cmd !== "object") return "Bad command.";
  const c = cmd as Record<string, unknown>;
  if (typeof c.type !== "string") return "Bad command.";
  if (c.type === "claimCountry" || c.type === "releaseCountry") return "Use the Play as… button to pick a country.";
  if (!myCountry) return "Pick a country first.";
  if (c.country !== myCountry) return "You can only give orders to your own country.";
  for (const [k, v] of Object.entries(c)) {
    if (typeof v === "string" && v.length > 64) return "Bad command.";
    if (k === "units" && (!Array.isArray(v) || v.length > 500 || !v.every((x) => Number.isInteger(x)))) return "Bad command.";
    if (typeof v === "object" && k !== "units") return "Bad command.";
  }
  return null;
}
