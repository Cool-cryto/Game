import { create } from "zustand";
import type { CountryId, ProvinceId } from "@gs/shared";
import { createGameState, provincesByOwner, type Command, type CountryState, type GameState } from "@gs/sim";
import { GEOGRAPHY, MODERN_SCENARIO, registerStateCountries } from "../data/countries";
import type { SimRequest, SimResponse, Speed } from "../sim/protocol";
import { online, onlineCountry, setOnlineHooks, useOnline } from "../net/online";

interface GameStore {
  /** Latest game state from the simulation worker. Treat as read-only. */
  state: GameState;
  /** Province ids per owner; recomputed only when ownership changes. */
  provincesOf: Map<CountryId, ProvinceId[]>;
  paused: boolean;
  speed: Speed;
  /** Bumped when a different game is loaded (new game or loaded save). */
  generation: number;
  /** "local": single player in this browser. "online": the game runs on a server. */
  mode: "local" | "online";
  /** Most recent command errors, for the UI to show. */
  errors: string[];
  send: (command: Command) => void;
  setSpeed: (speed: Speed) => void;
  setPaused: (paused: boolean) => void;
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

export const useGame = create<GameStore>((set, get) => ({
  state: initial,
  provincesOf: provincesByOwner(initial),
  paused: true,
  speed: 1,
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
  setSpeed: (speed) => {
    if (get().mode === "online") return online.clock({ speed });
    set({ speed });
    sim({ type: "setSpeed", speed });
  },
  setPaused: (paused) => {
    if (get().mode === "online") return online.clock({ paused });
    set({ paused });
    sim({ type: "setPaused", paused });
  },
  replace: (state) => {
    registerStateCountries(state);
    set((s) => ({ state, provincesOf: provincesByOwner(state), paused: true, errors: [], generation: s.generation + 1 }));
    sim({ type: "setPaused", paused: true });
    sim({ type: "start", state });
  },
}));

/** Start the simulation worker (it begins paused). */
export const startSimulation = () => sim({ type: "setSpeed", speed: useGame.getState().speed });

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
  clock: (clock) => useGame.setState({ paused: clock.paused, speed: clock.speed }),
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
