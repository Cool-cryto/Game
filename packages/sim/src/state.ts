import type { CountryId } from "@gs/shared";
import type { RngState } from "./rng";

/**
 * The entire game, as plain serializable data. Saving is JSON.stringify(state).
 * Stage 1 only tracks the date and which countries exist; economy, population,
 * diplomacy and military are added in later stages.
 */
export interface GameState {
  version: 1;
  /** Days since the scenario start date. */
  tick: number;
  startDate: string; // ISO date, e.g. "2026-01-01"
  rng: RngState;
  countries: Record<CountryId, { id: CountryId }>;
}

export function createGameState(countryIds: CountryId[], seed: number, startDate = "2026-01-01"): GameState {
  return {
    version: 1,
    tick: 0,
    startDate,
    rng: { seed },
    countries: Object.fromEntries(countryIds.map((id) => [id, { id }])) as GameState["countries"],
  };
}

/** Advance the game by one day. Systems (economy, AI, ...) will run here in fixed order. */
export function tick(state: GameState): void {
  state.tick += 1;
}

export function currentDate(state: GameState): string {
  const d = new Date(`${state.startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + state.tick);
  return d.toISOString().slice(0, 10);
}
