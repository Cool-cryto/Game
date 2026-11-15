import type { CountryId, ProvinceId, ResourceId, Scenario } from "@gs/shared";
import { RESOURCES } from "@gs/shared";
import type { RngState } from "./rng";

export const SAVE_VERSION = 3;

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
  techLevel: number;
  /** Progress to the next tech level, 0-1. */
  researchProgress: number;
  /** Last month's GDP growth, as a yearly rate (0.02 = 2%). */
  gdpGrowth: number;
  /** Last month's population growth, as a yearly rate. */
  popGrowth: number;
  resources: Record<ResourceId, ResourceBalance>;
  /** Total defense spending so far (millions of US$); armies use it from Stage 4. */
  defenseFund: number;
  history: { gdp: number[]; population: number[] };
}

export interface ProvinceState {
  id: ProvinceId;
  owner: CountryId;
  population: number;
  areaKm2: number;
  /** 0-10. Raises resource output and growth; built up by infrastructure spending. */
  infrastructure: number;
  deposits: Record<ResourceId, number>;
}

/**
 * The entire game as plain serializable data. Saving is JSON.stringify(state).
 * A country's shape is the set of provinces it owns, so borders follow ownership.
 */
export interface GameState {
  version: typeof SAVE_VERSION;
  scenarioId: string;
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

export function createGameState(scenario: Scenario, seed: number): GameState {
  const countries = {} as Record<CountryId, CountryState>;
  const emptyResources = () => Object.fromEntries(RESOURCES.map((r) => [r, { production: 0, need: 0, imports: 0, exports: 0 }])) as Record<ResourceId, ResourceBalance>;

  for (const [id, c] of Object.entries(scenario.countries) as [CountryId, Scenario["countries"][CountryId]][]) {
    const active = !!c.population && !!c.gdpMillionUsd;
    const gdp = active ? c.gdpMillionUsd! : 0;
    const taxRate = DEFAULT_TAX[c.incomeGroup ?? ""] ?? 0.22;
    countries[id] = {
      id,
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
    };
    owner.population += provinces[id].population;
  }

  const state: GameState = {
    version: SAVE_VERSION,
    scenarioId: scenario.id,
    tick: 0,
    startDate: scenario.startDate,
    rng: { seed },
    ownershipVersion: 0,
    resourceScale: { food: 1, energy: 1, minerals: 1 },
    countries,
    provinces,
  };
  calibrateResources(state);
  return state;
}

/** Size factor so a huge province produces more than a tiny one, without Siberia dominating. */
export const provinceSize = (areaKm2: number) => Math.min(6, Math.max(0.3, Math.sqrt(areaKm2 / 10_000)));
export const techMultiplier = (tech: number) => 1 + 0.08 * tech;

/** Raw (unscaled) production of one province. */
export function rawProduction(p: ProvinceState, techLevel: number, r: ResourceId): number {
  return p.deposits[r] * provinceSize(p.areaKm2) * (0.5 + p.infrastructure / MAX_INFRASTRUCTURE) * techMultiplier(techLevel);
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
      if (owner.active) production += rawProduction(p, owner.techLevel, r);
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
