import type { CountryId, ProvinceId, ResourceId, Scenario } from "@gs/shared";
import { RESOURCES } from "@gs/shared";
import { createStartingMilitaries } from "./military";
import { refreshResources } from "./systems";
import type { RngState } from "./rng";
import type { Geography } from "./geography";
import { startingGovernment, type Government } from "./government";
import { resourceBonus, startingResearch, type Research } from "./tech";
import type { Buildings, Project } from "./construction";

export const SAVE_VERSION = 7;

/** Spending categories the player controls, each as a share of GDP per year. */
export type BudgetCategory = "infrastructure" | "research" | "welfare" | "defense";
export const BUDGET_CATEGORIES: BudgetCategory[] = ["infrastructure", "research", "welfare", "defense"];

/** Fixed cost of running the state (share of GDP per year). Not adjustable. */
export const ADMIN_COST = 0.04;
export const MAX_TECH = 20;
export const MAX_INFRASTRUCTURE = 10;
/** Months of history kept per country (10 years). */
export const HISTORY_MONTHS = 120;

export interface ResourceBalance {
  /** Production last month, in game units. */
  production: number;
  /** What the country needed last month, in the same units. */
  need: number;
  /** Bought from the world market to cover a shortfall. */
  imports: number;
  /** Surplus sold on the world market. */
  exports: number;
}

export interface CountryState {
  id: CountryId;
  name: string;
  /** Map color (#rrggbb), for countries that have no standard color (made in the world editor). */
  color?: string;
  controller: "ai" | "human";
  /** False for places with no population or economy (e.g. Antarctica, uninhabited islands). */
  active: boolean;
  /** Sum of province populations. */
  population: number;
  /** Yearly GDP in millions of US$. */
  gdp: number;
  /** Money in the bank in millions of US$; negative means debt. */
  treasury: number;
  taxRate: number;
  budget: Record<BudgetCategory, number>;
  /** 0-100. Low stability slows growth. */
  stability: number;
  /** Overall technology level: the average of the research branches (see tech.ts). */
  techLevel: number;
  /** Research branches, their progress and the current focus. */
  research: Research;
  /** Buildings under construction (see construction.ts). */
  construction: Project[];
  /** Progress to the next tech level, 0-1. */
  researchProgress: number;
  /** Last month's GDP growth, as a yearly rate (0.02 = 2%). */
  gdpGrowth: number;
  /** Last month's population growth, as a yearly rate. */
  popGrowth: number;
  resources: Record<ResourceId, ResourceBalance>;
  /** Defense money not yet spent (millions of US$). Pays for recruiting, upkeep and reinforcements. */
  defenseFund: number;
  /** Seat of government: the most populous province owned. Null once a country has no provinces. */
  capital: ProvinceId | null;
  /** Kind of government, ruling bloc, party support, laws and elections (see government.ts). */
  government: Government;
  history: { gdp: number[]; population: number[] };
}

export type UnitType = "army" | "navy" | "air";

export interface Unit {
  id: number;
  owner: CountryId;
  type: UnitType;
  /** Where the unit is now. */
  province: ProvinceId;
  /** 0-100. Lost in battle, regained slowly at home. */
  strength: number;
  /** Provinces still to travel through; path[0] is the next stop. Empty when not moving. */
  path: ProvinceId[];
  /** How the unit is travelling to path[0], and how many days are left. */
  travel: { mode: "land" | "sea" | "air"; daysLeft: number } | null;
  /** Set while falling back from a lost battle; retreating units don't fight. */
  retreating: boolean;
}

export interface War {
  id: number;
  name: string;
  /** attackers[0] and defenders[0] lead their sides and negotiate peace. */
  attackers: CountryId[];
  defenders: CountryId[];
  startTick: number;
}

export type PeaceTerms = "white" | "occupied";

export interface PeaceOffer {
  id: number;
  warId: number;
  from: CountryId;
  to: CountryId;
  terms: PeaceTerms;
  expiresTick: number;
}

export type EventKind = "war" | "peace" | "battle" | "occupation" | "alliance" | "annexation" | "diplomacy" | "military" | "politics";

export interface GameEvent {
  tick: number;
  kind: EventKind;
  text: string;
  countries: CountryId[];
}

export interface ProvinceState {
  id: ProvinceId;
  owner: CountryId;
  population: number;
  areaKm2: number;
  /** 0-10. Raises resource output and growth; built up by infrastructure spending. */
  infrastructure: number;
  deposits: Record<ResourceId, number>;
  /** Who holds the province right now. Differs from owner while occupied in a war. */
  controller: CountryId;
  /** Siege in progress: who is taking the province and how far along (0-1). */
  siege: { by: CountryId; progress: number } | null;
  /** Buildings here (factory, railway, port, fort levels); missing means none. */
  buildings?: Buildings;
}

/**
 * The entire game as plain serializable data. Saving is JSON.stringify(state).
 * A country's shape is the set of provinces it owns, so borders follow ownership.
 */
export interface GameState {
  version: typeof SAVE_VERSION;
  scenarioId: string;
  /** Name of the scenario, and where its starting numbers came from (for the UI). */
  scenarioName?: string;
  dataNote?: string;
  /** Days since the scenario start date. */
  tick: number;
  startDate: string;
  rng: RngState;
  /** Bumped whenever any province changes owner, so the map knows to redraw borders. */
  ownershipVersion: number;
  /** Converts production and need into the same units; fixed at game start. */
  resourceScale: Record<ResourceId, number>;
  countries: Record<CountryId, CountryState>;
  provinces: Record<ProvinceId, ProvinceState>;
  units: Record<string, Unit>;
  /** Next id for units, wars and offers. */
  nextId: number;
  wars: War[];
  /** Relations between two countries, -100 to 100, keyed "AAA|BBB" (sorted). Missing means 0. */
  relations: Record<string, number>;
  /** Defensive alliances, as sorted "AAA|BBB" keys. */
  alliances: string[];
  /** Peace offers waiting for a human player's answer. */
  offers: PeaceOffer[];
  /** Last day each pair had a diplomatic action, keyed "FROM>TO". */
  diplomacyCooldown: Record<string, number>;
  /** Recent news, newest last. */
  events: GameEvent[];
}

const DEFAULT_TAX: Record<string, number> = {
  "High income: OECD": 0.34,
  "High income: nonOECD": 0.26,
  "Upper middle income": 0.24,
  "Lower middle income": 0.18,
  "Low income": 0.14,
};

/** Starting technology level from GDP per person: $300 → 1, $3,000 → 3, $30,000 → 5, $100,000 → 6-7. */
export function startingTechLevel(gdpPerPerson: number): number {
  return Math.max(1, Math.min(10, Math.round(1 + 2.2 * Math.log10(Math.max(gdpPerPerson, 300) / 300))));
}

/** Starting infrastructure: set by technology, higher in dense provinces, lower in remote ones. */
export function startingInfrastructure(techLevel: number, population: number, areaKm2: number): number {
  const density = population / Math.max(areaKm2, 1);
  const local = Math.max(-2.5, Math.min(1.5, Math.log10(Math.max(density, 0.1) / 50)));
  return Math.round(Math.max(0.5, Math.min(MAX_INFRASTRUCTURE, 1 + techLevel + local)) * 10) / 10;
}

/** Default budget: the tax take minus admin, split between categories. */
export function defaultBudget(taxRate: number): Record<BudgetCategory, number> {
  const spendable = Math.max(0, taxRate - ADMIN_COST);
  return {
    infrastructure: round4(spendable * 0.18),
    research: round4(spendable * 0.12),
    welfare: round4(spendable * 0.55),
    defense: round4(spendable * 0.15),
  };
}

const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function createGameState(scenario: Scenario, geo: Geography, seed: number): GameState {
  const countries = {} as Record<CountryId, CountryState>;
  const emptyResources = () => Object.fromEntries(RESOURCES.map((r) => [r, { production: 0, need: 0, imports: 0, exports: 0 }])) as Record<ResourceId, ResourceBalance>;

  for (const [id, c] of Object.entries(scenario.countries) as [CountryId, Scenario["countries"][CountryId]][]) {
    const active = !!c.population && !!c.gdpMillionUsd;
    const gdp = active ? c.gdpMillionUsd! : 0;
    const taxRate = DEFAULT_TAX[c.incomeGroup ?? ""] ?? 0.22;
    countries[id] = {
      id,
      name: c.name ?? id,
      ...(c.color ? { color: c.color } : {}),
      controller: "ai",
      active,
      population: 0,
      gdp,
      treasury: 0,
      taxRate,
      budget: defaultBudget(taxRate),
      stability: 65,
      techLevel: active ? startingTechLevel((gdp * 1e6) / c.population!) : 1,
      researchProgress: 0,
      gdpGrowth: 0,
      popGrowth: 0,
      resources: emptyResources(),
      defenseFund: 0,
      capital: null,
      construction: [],
      research: startingResearch(active ? startingTechLevel((gdp * 1e6) / c.population!) : 1),
      government: startingGovernment(id, c, id.startsWith("C-")),
      history: { gdp: [], population: [] },
    };
  }

  const provinces = {} as Record<ProvinceId, ProvinceState>;
  for (const [id, p] of Object.entries(scenario.provinces) as [ProvinceId, Scenario["provinces"][ProvinceId]][]) {
    const owner = countries[p.owner];
    if (!owner) throw new Error(`Province ${id} is owned by unknown country ${p.owner}`);
    provinces[id] = {
      id,
      owner: p.owner,
      population: owner.active ? p.population : 0,
      areaKm2: p.areaKm2,
      infrastructure: owner.active ? startingInfrastructure(owner.techLevel, p.population, p.areaKm2) : 0,
      deposits: { ...p.deposits },
      controller: p.owner,
      siege: null,
    };
    owner.population += provinces[id].population;
  }

  const state: GameState = {
    version: SAVE_VERSION,
    scenarioId: scenario.id,
    scenarioName: scenario.name,
    dataNote: scenario.dataNote,
    tick: 0,
    startDate: scenario.startDate,
    rng: { seed },
    ownershipVersion: 0,
    resourceScale: { food: 1, energy: 1, minerals: 1 },
    countries,
    provinces,
    units: {},
    nextId: 1,
    wars: [],
    relations: {},
    alliances: [],
    offers: [],
    diplomacyCooldown: {},
    events: [],
  };
  refreshResources(state);
  for (const c of Object.values(countries)) c.capital = largestProvince(state, c.id);
  createStartingMilitaries(state, geo);
  return state;
}

/** The most populous province a country owns. */
export function largestProvince(state: GameState, country: CountryId): ProvinceId | null {
  let best: ProvinceState | null = null;
  for (const p of Object.values(state.provinces)) if (p.owner === country && (!best || p.population > best.population)) best = p;
  return best?.id ?? null;
}

export function logEvent(state: GameState, kind: EventKind, text: string, countries: CountryId[]) {
  state.events.push({ tick: state.tick, kind, text, countries });
  if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}
export const MAX_EVENTS = 300;
export const nameOf = (s: GameState, c: CountryId) => s.countries[c]?.name ?? c;

/** Size factor so a huge province produces more than a tiny one, without Siberia dominating. */
export const provinceSize = (areaKm2: number) => Math.min(6, Math.max(0.3, Math.sqrt(areaKm2 / 10_000)));
export const techMultiplier = (tech: number) => 1 + 0.08 * tech;

/** Raw (unscaled) production of one province. */
export function rawProduction(p: ProvinceState, techLevel: number, r: ResourceId): number {
  // Factories raise energy and mineral output by 10% per level (see construction.ts).
  const factory = r === "food" ? 1 : 1 + 0.1 * (p.buildings?.factory ?? 0);
  return p.deposits[r] * provinceSize(p.areaKm2) * (0.5 + p.infrastructure / MAX_INFRASTRUCTURE) * techMultiplier(techLevel) * factory;
}

/** Raw need: food scales with people, energy and minerals with the size of the economy. */
export function rawNeed(c: CountryState, r: ResourceId): number {
  return r === "food" ? c.population / 1e6 : c.gdp / 1e4;
}

/**
 * Choose resource units so the world as a whole produces what it needs. Run every month: world
 * supply keeps pace with demand overall, and what changes is each country's share of it (which
 * grows with its infrastructure and technology). Individual countries have surpluses or shortfalls.
 */
export function calibrateResources(state: GameState) {
  for (const r of RESOURCES) {
    let production = 0;
    let need = 0;
    for (const p of Object.values(state.provinces)) {
      const owner = state.countries[p.owner]!;
      if (owner.active) production += rawProduction(p, owner.research.levels.economy, r) * resourceBonus(owner, r);
    }
    for (const c of Object.values(state.countries)) if (c.active) need += rawNeed(c, r);
    state.resourceScale[r] = production > 0 ? need / production : 1;
  }
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

export function currentDate(state: GameState): string {
  return dateAt(state.startDate, state.tick);
}

export function dateAt(startDate: string, tick: number): string {
  const d = new Date(`${startDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + tick);
  return d.toISOString().slice(0, 10);
}

export const totalSpending = (c: CountryState) => ADMIN_COST + Object.values(c.budget).reduce((a, b) => a + b, 0);
/** Yearly budget balance as a share of GDP: positive is surplus. */
export const budgetBalance = (c: CountryState) => c.taxRate - totalSpending(c);
