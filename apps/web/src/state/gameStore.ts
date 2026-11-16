import { create } from "zustand";
import type { CountryId, ProvinceId } from "@gs/shared";
import { createGameState, provincesByOwner, type Command, type CountryState, type GameState } from "@gs/sim";
import { GEOGRAPHY, MODERN_SCENARIO, registerStateCountries } from "../data/countries";
import type { SimRequest, SimResponse } from "../sim/protocol";
import { online, onlineCountry, setOnlineHooks, useOnline } from "../net/online";

interface GameStore {
  /** Latest game state from the simulation worker. Treat as read-only. */
  state: GameState;
  /** Province ids per owner; recomputed only when ownership changes. */
  provincesOf: Map<CountryId, ProvinceId[]>;
  /** Time stands still only before you lead a country, or while something holds it (editor, game menu). */
  paused: boolean;
  /** Bumped when a different game is loaded (new game or loaded save). */
  generation: number;
  /** "local": single player in this browser. "online": the game runs on a server. */
  mode: "local" | "online";
  /** Most recent command errors, for the UI to show. */
  errors: string[];
  send: (command: Command) => void;
  /** Stop time while `reason` is on (e.g. the world editor or the game menu); time runs again when no holds remain. */
  hold: (reason: string, on: boolean) => void;
  /** Replace the running game, e.g. a new game or a loaded save. Pauses the game. */
  replace: (state: GameState) => void;
}

/** While the world editor is open, the map shows a preview and the local game must not overwrite it. */
let previewMode = false;
export const setPreviewMode = (on: boolean) => (previewMode = on);

export const newGameState = (scenario = MODERN_SCENARIO) => createGameState(scenario, GEOGRAPHY, Date.now() % 2 ** 31);

const initial = newGameState();

let worker: Worker | null = null;
function sim(msg: SimRequest) {
  if (typeof Worker === "undefined") return; // e.g. unit tests
  if (!worker) {
    worker = new Worker(new URL("../sim/sim.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<SimResponse>) => {
      const { state, errors, paused } = e.data;
      if (useGame.getState().mode === "online") return; // the server is in charge while online
      if (previewMode) return; // the world editor is showing a preview
      // Ignore updates sent before the worker heard about the latest pause/play,
      // so the date doesn't keep moving after you press pause.
      if (paused !== useGame.getState().paused) return;
      useGame.setState((s) => ({
        state,
        errors: errors.length ? errors : s.errors,
        provincesOf: state.ownershipVersion !== s.state.ownershipVersion ? provincesByOwner(state) : s.provincesOf,
      }));
    };
    worker.postMessage({ type: "start", state: useGame.getState().state } satisfies SimRequest);
  }
  worker.postMessage(msg);
}

const holds = new Set<string>();
/** Single player: time runs whenever you lead a country and nothing holds it. */
function syncClock() {
  const g = useGame.getState();
  if (g.mode !== "local") return;
  const paused = previewMode || holds.size > 0 || !playerCountry(g.state);
  if (paused === g.paused) return;
  useGame.setState({ paused });
  sim({ type: "setPaused", paused });
}

export const useGame = create<GameStore>((set, get) => ({
  state: initial,
  provincesOf: provincesByOwner(initial),
  paused: true,
  generation: 0,
  mode: "local",
  errors: [],
  send: (command) => {
    if (get().mode === "local") return sim({ type: "command", command });
    // Online: picking a country has its own messages; everything else is a command.
    if (command.type === "claimCountry") online.claim(command.country);
    else if (command.type === "releaseCountry") online.release();
    else online.command(command);
  },
  hold: (reason, on) => {
    if (on) holds.add(reason);
    else holds.delete(reason);
    syncClock();
  },
  replace: (state) => {
    registerStateCountries(state);
    set((s) => ({ state, provincesOf: provincesByOwner(state), paused: true, errors: [], generation: s.generation + 1 }));
    sim({ type: "setPaused", paused: true });
    sim({ type: "start", state });
    syncClock();
  },
}));
// Picking a country (or loading a game with one) starts the clock.
useGame.subscribe((s, prev) => {
  if (s.state !== prev.state || s.mode !== prev.mode) syncClock();
});

/** Start the simulation worker (it begins paused, until you lead a country). */
export const startSimulation = () => sim({ type: "setPaused", paused: true });

export const ownerOf = (id: ProvinceId): CountryId | undefined => useGame.getState().state.provinces[id]?.owner;

/** The country you play: online, the one the server assigned you; offline, the human-controlled one. */
export const playerCountry = (s: GameState): CountryState | undefined => {
  const mine = onlineCountry();
  if (mine !== undefined) return mine ? s.countries[mine] : undefined;
  return Object.values(s.countries).find((c) => c.controller === "human");
};

// Online play feeds the server's game into this store.
setOnlineHooks({
  enter: (state) => {
    registerStateCountries(state);
    sim({ type: "setPaused", paused: true }); // stop the local game while online
    useGame.setState((s) => ({ state, provincesOf: provincesByOwner(state), mode: "online", errors: [], generation: s.generation + 1 }));
  },
  update: (fn) =>
    useGame.setState((s) => {
      const state = fn(s.state);
      return { state, provincesOf: state.ownershipVersion !== s.state.ownershipVersion ? provincesByOwner(state) : s.provincesOf };
    }),
  clock: (clock) => useGame.setState({ paused: clock.paused }),
  leave: () => {
    // Back to single player with a fresh world.
    useGame.setState({ mode: "local" });
    useGame.getState().replace(newGameState());
  },
});
// Re-render when your online country changes.
useOnline.subscribe((s, prev) => {
  if (s.you !== prev.you) useGame.setState((g) => ({ state: { ...g.state } }));
});

/** Owner of every province, in the plain shape the map worker needs. */
export const ownersRecord = (s: GameState): Record<string, CountryId> =>
  Object.fromEntries(Object.values(s.provinces).map((p) => [p.id, p.owner]));

// Lets automated tests read the game state. Development builds only.
if (import.meta.env.DEV && typeof window !== "undefined") (window as unknown as { __gsGame?: unknown }).__gsGame = useGame;
