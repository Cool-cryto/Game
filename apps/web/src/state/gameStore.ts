import { create } from "zustand";
import type { CountryId, ProvinceId } from "@gs/shared";
import { createGameState, provincesByOwner, type Command, type CountryState, type GameState } from "@gs/sim";
import { MODERN_SCENARIO } from "../data/countries";
import type { SimRequest, SimResponse, Speed } from "../sim/protocol";

interface GameStore {
  /** Latest game state from the simulation worker. Treat as read-only. */
  state: GameState;
  /** Province ids per owner; recomputed only when ownership changes. */
  provincesOf: Map<CountryId, ProvinceId[]>;
  paused: boolean;
  speed: Speed;
  /** Bumped when a different game is loaded (new game or loaded save). */
  generation: number;
  /** Most recent command errors, for the UI to show. */
  errors: string[];
  send: (command: Command) => void;
  setSpeed: (speed: Speed) => void;
  setPaused: (paused: boolean) => void;
  /** Replace the running game, e.g. a new game or a loaded save. Pauses the game. */
  replace: (state: GameState) => void;
}

export const newGameState = () => createGameState(MODERN_SCENARIO, Date.now() % 2 ** 31);

const initial = newGameState();

let worker: Worker | null = null;
function sim(msg: SimRequest) {
  if (typeof Worker === "undefined") return; // e.g. unit tests
  if (!worker) {
    worker = new Worker(new URL("../sim/sim.worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<SimResponse>) => {
      const { state, errors, paused } = e.data;
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

export const useGame = create<GameStore>((set) => ({
  state: initial,
  provincesOf: provincesByOwner(initial),
  paused: true,
  speed: 1,
  generation: 0,
  errors: [],
  send: (command) => sim({ type: "command", command }),
  setSpeed: (speed) => {
    set({ speed });
    sim({ type: "setSpeed", speed });
  },
  setPaused: (paused) => {
    set({ paused });
    sim({ type: "setPaused", paused });
  },
  replace: (state) => {
    set((s) => ({ state, provincesOf: provincesByOwner(state), paused: true, errors: [], generation: s.generation + 1 }));
    sim({ type: "setPaused", paused: true });
    sim({ type: "start", state });
  },
}));

/** Start the simulation worker (it begins paused). */
export const startSimulation = () => sim({ type: "setSpeed", speed: useGame.getState().speed });

export const ownerOf = (id: ProvinceId): CountryId | undefined => useGame.getState().state.provinces[id]?.owner;

export const playerCountry = (s: GameState): CountryState | undefined => Object.values(s.countries).find((c) => c.controller === "human");

/** Owner of every province, in the plain shape the map worker needs. */
export const ownersRecord = (s: GameState): Record<string, CountryId> =>
  Object.fromEntries(Object.values(s.provinces).map((p) => [p.id, p.owner]));
