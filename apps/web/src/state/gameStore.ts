import { create } from "zustand";
import type { CountryId, ProvinceId } from "@gs/shared";
import { createGameState, provincesByOwner, type GameState } from "@gs/sim";
import { MODERN_SCENARIO } from "../data/countries";

interface GameStore {
  state: GameState;
  /** Province ids per owner; recomputed when ownership changes. */
  provincesOf: Map<CountryId, ProvinceId[]>;
}

const initial = createGameState(MODERN_SCENARIO, 1);

/**
 * Holds the game state. Stage 2 only reads it (nothing changes yet); in
 * Stage 3 the simulation will update it every tick.
 */
export const useGame = create<GameStore>(() => ({
  state: initial,
  provincesOf: provincesByOwner(initial),
}));

export const ownerOf = (id: ProvinceId): CountryId | undefined => useGame.getState().state.provinces[id]?.owner;

/** Owner of every province, in the plain shape the map worker needs. */
export const ownersRecord = (s: GameState): Record<string, CountryId> =>
  Object.fromEntries(Object.values(s.provinces).map((p) => [p.id, p.owner]));
