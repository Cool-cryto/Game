import { create } from "zustand";
import type { CountryId } from "@gs/shared";
import { applyPatch, provincesByOwner, type ChatMessage, type ClientMessage, type Clock, type Command, type PlayerInfo, type RoomSummary, type ServerMessage } from "@gs/sim";

/**
 * Online play. The game server runs the real game; this module keeps the
 * connection, signs in, joins rooms, and feeds the server's snapshot and
 * patches into the normal game store, so the map and panels work unchanged.
 */

type Status = "offline" | "connecting" | "online" | "reconnecting";

interface OnlineState {
  status: Status;
  /** Is a game server reachable from this page? null = not checked yet. */
  available: boolean | null;
  user: { id: number; username: string } | null;
  rooms: RoomSummary[];
  room: RoomSummary | null;
  players: PlayerInfo[];
  chat: ChatMessage[];
  clock: Clock | null;
  you: { country: CountryId | null; host: boolean };
  error: string | null;
  setError: (e: string | null) => void;
}

export const useOnline = create<OnlineState>((set) => ({
  status: "offline",
  available: null,
  user: null,
  rooms: [],
  room: null,
  players: [],
  chat: [],
  clock: null,
  you: { country: null, host: false },
  error: null,
  setError: (error) => set({ error }),
}));

/** Your country while in an online room (undefined when not online). */
export const onlineCountry = (): CountryId | null | undefined => (useOnline.getState().room ? useOnline.getState().you.country : undefined);

// ---------- Session (kept in this browser so you stay signed in) ----------

const SESSION_KEY = "wa.session";
function loadSession(): { token: string; username: string } | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as { token: string; username: string }) : null;
  } catch {
    return null;
  }
}
function saveSession(s: { token: string; username: string } | null) {
  try {
    if (s) localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    else localStorage.removeItem(SESSION_KEY);
  } catch {
    /* private browsing: you'll just need to sign in again next time */
  }
}
export const hasSession = () => loadSession() !== null;

const apiUrl = (path: string) => new URL(`api/${path}`, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
const wsUrl = () => {
  const u = new URL("ws", new URL(import.meta.env.BASE_URL, document.baseURI));
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
};

/** Is there a game server behind this page? (Not when the game is opened as a static page.) */
export async function checkServer(): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("health"), { cache: "no-store" });
    const ok = res.ok && ((await res.json()) as { ok?: boolean }).ok === true;
    useOnline.setState({ available: ok });
    return ok;
  } catch {
    useOnline.setState({ available: false });
    return false;
  }
}

export async function signIn(kind: "login" | "register", username: string, password: string): Promise<string | null> {
  try {
    const res = await fetch(apiUrl(kind), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    const body = (await res.json()) as { token?: string; error?: string; user?: { username: string } };
    if (!res.ok || !body.token) return body.error ?? "Couldn't sign in.";
    saveSession({ token: body.token, username: body.user?.username ?? username });
    connect();
    return null;
  } catch {
    return "Can't reach the game server.";
  }
}

export function signOut() {
  const s = loadSession();
  if (s) void fetch(apiUrl("logout"), { method: "POST", headers: { authorization: `Bearer ${s.token}` } }).catch(() => {});
  saveSession(null);
  disconnect();
  useOnline.setState({ user: null, rooms: [] });
}

// ---------- Connection ----------

let ws: WebSocket | null = null;
let wanted = false;
let retry = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** The room to rejoin automatically after a dropped connection. */
let rejoin: string | null = null;
let hooks: OnlineHooks | null = null;

/** How online play talks to the rest of the app (set by the game store, avoiding an import cycle). */
export interface OnlineHooks {
  enter(state: import("@gs/sim").GameState): void;
  update(fn: (s: import("@gs/sim").GameState) => import("@gs/sim").GameState): void;
  clock(clock: Clock): void;
  leave(): void;
}
export const setOnlineHooks = (h: OnlineHooks) => (hooks = h);

export function connect() {
  const session = loadSession();
  if (!session) return;
  wanted = true;
  if (ws && ws.readyState <= WebSocket.OPEN) return;
  useOnline.setState({ status: useOnline.getState().status === "offline" ? "connecting" : "reconnecting" });
  const socket = new WebSocket(wsUrl());
  ws = socket;
  socket.onopen = () => socket.send(JSON.stringify({ t: "auth", token: session.token } satisfies ClientMessage));
  socket.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as ServerMessage);
  socket.onclose = (e) => {
    if (ws !== socket) return;
    ws = null;
    if (e.code === 4003) {
      // Session no longer valid: sign in again.
      saveSession(null);
      useOnline.setState({ status: "offline", user: null, error: e.reason || "Please sign in again." });
      return;
    }
    if (!wanted) return useOnline.setState({ status: "offline" });
    // Dropped: try again with growing waits (1s, 2s, 4s… up to 10s).
    useOnline.setState({ status: "reconnecting" });
    retryTimer = setTimeout(connect, Math.min(10_000, 1000 * 2 ** retry++));
  };
}

export function disconnect() {
  wanted = false;
  rejoin = null;
  if (retryTimer) clearTimeout(retryTimer);
  ws?.close();
  ws = null;
  if (useOnline.getState().room) hooks?.leave();
  useOnline.setState({ status: "offline", room: null, players: [], chat: [], clock: null, you: { country: null, host: false } });
}

function send(m: ClientMessage) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(m));
  else useOnline.setState({ error: "Not connected to the game server right now." });
}

export const online = {
  list: () => send({ t: "list" }),
  create: (name: string) => send({ t: "create", name }),
  join: (room: string) => send({ t: "join", room }),
  leave: () => {
    rejoin = null;
    send({ t: "leave" });
  },
  claim: (country: CountryId) => send({ t: "claim", country }),
  release: () => send({ t: "release" }),
  command: (command: Command) => send({ t: "cmd", command }),
  clock: (c: { paused?: boolean; speed?: Clock["speed"] }) => send({ t: "clock", ...c }),
  chat: (text: string) => send({ t: "chat", text }),
};

function onMessage(m: ServerMessage) {
  switch (m.t) {
    case "welcome":
      retry = 0;
      useOnline.setState({ status: "online", user: m.user, error: null });
      if (rejoin) send({ t: "join", room: rejoin });
      return;
    case "rooms":
      return useOnline.setState({ rooms: m.rooms });
    case "joined":
      rejoin = m.room.id;
      useOnline.setState({ room: m.room, players: m.players, chat: m.chat, clock: m.clock, you: m.you, error: null });
      hooks?.enter(m.state);
      hooks?.clock(m.clock);
      return;
    case "left":
      rejoin = null;
      useOnline.setState({ room: null, players: [], chat: [], clock: null, you: { country: null, host: false } });
      hooks?.leave();
      return;
    case "patch":
      return hooks?.update((s) => applyPatch(s, m.patch));
    case "players": {
      const me = useOnline.getState().user?.id;
      const host = m.players.find((p) => p.userId === me)?.host ?? false;
      return useOnline.setState((s) => ({ players: m.players, you: { ...s.you, host } }));
    }
    case "you":
      return useOnline.setState({ you: { country: m.country, host: m.host } });
    case "clock":
      useOnline.setState({ clock: m.clock });
      return hooks?.clock(m.clock);
    case "chat":
      return useOnline.setState((s) => ({ chat: [...s.chat, m.message].slice(-50) }));
    case "error":
      return useOnline.setState({ error: m.message });
  }
}

/** Province ownership index for a patched state (re-exported for the store). */
export { provincesByOwner };
