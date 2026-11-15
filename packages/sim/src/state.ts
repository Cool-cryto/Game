import type { CountryId, ProvinceId, Scenario } from "@gs/shared";
import type { RngState } from "./rng";

export interface CountryState {
  id: CountryId;
  /** Null when the scenario has no figure for this country. */
  population: number | null;
  gdpMillionUsd: number | null;
}

export interface ProvinceState {
  id: ProvinceId;
  owner: CountryId;
}

/**
 * The entire game, as plain serializable data. Saving is JSON.stringify(state).
 * Countries don't store their shape: a country is the set of provinces it owns,
 * so borders change automatically when provinces change hands.
 */
export interface GameState {
  version: 2;
  scenarioId: string;
  /** Days since the scenario start date. */
  tick: number;
  startDate: string;
  rng: RngState;
  countries: Record<CountryId, CountryState>;
  provinces: Record<ProvinceId, ProvinceState>;
}

export function createGameState(scenario: Scenario, seed: number): GameState {
  const countries = {} as Record<CountryId, CountryState>;
  for (const [id, c] of Object.entries(scenario.countries) as [CountryId, Scenario["countries"][CountryId]][]) {
    countries[id] = { id, population: c.population, gdpMillionUsd: c.gdpMillionUsd };
  }
  const provinces = {} as Record<ProvinceId, ProvinceState>;
  for (const [id, owner] of Object.entries(scenario.owners) as [ProvinceId, CountryId][]) {
    if (!countries[owner]) throw new Error(`Province ${id} is owned by unknown country ${owner}`);
    provinces[id] = { id, owner };
  }
  return { version: 2, scenarioId: scenario.id, tick: 0, startDate: scenario.startDate, rng: { seed }, countries, provinces };
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

/** Province ids grouped by owner. */
export function provincesByOwner(state: GameState): Map<CountryId, ProvinceId[]> {
  const out = new Map<CountryId, ProvinceId[]>();
  for (const p of Object.values(state.provinces)) {
    let list = out.get(p.owner);
    if (!list) out.set(p.owner, (list = []));
    list.push(p.id);
  }
  return out;
}
