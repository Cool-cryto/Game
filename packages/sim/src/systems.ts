import { RESOURCES, type CountryId, type ResourceId } from "@gs/shared";
import {
  ADMIN_COST,
  calibrateResources,
  HISTORY_MONTHS,
  provincesByOwner,
  MAX_INFRASTRUCTURE,
  MAX_TECH,
  rawNeed,
  rawProduction,
  type CountryState,
  type GameState,
  type ProvinceState,
  type ResourceBalance,
} from "./state";

/**
 * Monthly systems. They run in this fixed order on the 1st of every month:
 *   1. resources   – what each country produced and needed
 *   2. economy     – GDP growth, taxes, spending, debt
 *   3. investment  – infrastructure and research
 *   4. society     – stability and population
 *   5. history     – record numbers for charts
 *
 * All numbers are game rules, tuned to give believable results, not real-world forecasts.
 */
/**
 * Work out every country's resource production, need and trade without
 * advancing time. Used at game start so the panels have numbers on day one.
 */
export function refreshResources(state: GameState): void {
  calibrateResources(state);
  worldMarket(state, aggregateProvinces(state));
}

export function runMonthly(state: GameState): void {
  calibrateResources(state);
  const agg = aggregateProvinces(state);
  const owned = provincesByOwner(state);
  for (const c of Object.values(state.countries)) {
    if (c.active && (!agg.get(c.id) || c.population <= 0)) c.active = false;
  }
  worldMarket(state, agg);
  for (const c of Object.values(state.countries)) {
    if (!c.active) continue;
    const a = agg.get(c.id)!;
    economy(c, a);
    const provinces = (owned.get(c.id) ?? []).map((id) => state.provinces[id]!);
    investment(c, provinces);
    society(c, provinces);
    recordHistory(c);
  }
}

interface Aggregate {
  /** Population-weighted average infrastructure. */
  infrastructure: number;
  production: Record<ResourceId, number>;
}

function aggregateProvinces(state: GameState): Map<CountryId, Aggregate> {
  const out = new Map<CountryId, Aggregate & { pop: number; infraPop: number }>();
  for (const p of Object.values(state.provinces)) {
    const owner = state.countries[p.owner];
    if (!owner?.active) continue;
    let a = out.get(p.owner);
    if (!a) out.set(p.owner, (a = { pop: 0, infraPop: 0, infrastructure: 0, production: { food: 0, energy: 0, minerals: 0 } }));
    a.pop += p.population;
    a.infraPop += p.infrastructure * p.population;
    for (const r of RESOURCES) a.production[r] += rawProduction(p, owner.techLevel, r) * state.resourceScale[r];
  }
  for (const [id, a] of out) {
    a.infrastructure = a.pop > 0 ? a.infraPop / a.pop : 0;
    state.countries[id]!.population = a.pop;
  }
  return out;
}

/** Share of need actually covered after trade (production + imports), capped at 1. */
export const supplied = (b: ResourceBalance) => (b.need > 0 ? Math.min(1, (Math.min(b.production, b.need) + b.imports) / b.need) : 1);
/** Net trade as a share of need: positive for exporters, negative for importers. */
export const tradeBalance = (b: ResourceBalance) => (b.need > 0 ? (b.exports - b.imports) / b.need : 0);

/**
 * World market: every country's surplus is offered, every shortfall is bought.
 * If the world has less than everyone needs, each importer gets the same share
 * of its shortfall; unmet need becomes a real shortage.
 */
function worldMarket(state: GameState, agg: Map<CountryId, Aggregate>) {
  for (const r of RESOURCES) {
    let surplus = 0;
    let deficit = 0;
    for (const c of Object.values(state.countries)) {
      if (!c.active) continue;
      const production = agg.get(c.id)!.production[r];
      const need = rawNeed(c, r);
      c.resources[r] = { production, need, imports: 0, exports: 0 };
      if (production > need) surplus += production - need;
      else deficit += need - production;
    }
    const coverage = deficit > 0 ? Math.min(1, surplus / deficit) : 0;
    const sold = surplus > 0 ? Math.min(1, deficit / surplus) : 0;
    for (const c of Object.values(state.countries)) {
      if (!c.active) continue;
      const b = c.resources[r];
      if (b.production < b.need) b.imports = (b.need - b.production) * coverage;
      else b.exports = (b.production - b.need) * sold;
    }
  }
}

const RESOURCE_WEIGHT: Record<ResourceId, number> = { food: 0.01, energy: 0.015, minerals: 0.01 };
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const debtRatio = (c: CountryState) => (c.treasury < 0 && c.gdp > 0 ? -c.treasury / c.gdp : 0);

/** The yearly GDP growth rate this month, broken down so the UI can explain it. */
export function growthBreakdown(c: CountryState, infrastructure: number) {
  const parts = {
    // Less developed economies catch up faster.
    base: 0.012 + 0.03 * (1 - c.techLevel / 12),
    infrastructure: clamp((infrastructure - c.techLevel) * 0.003, -0.02, 0.01),
    // Exporters earn a little, importers pay a little; real shortages hurt a lot.
    resources: RESOURCES.reduce(
      (sum, r) => sum + (clamp(tradeBalance(c.resources[r]), -1, 1) * 0.25 - (1 - supplied(c.resources[r])) * 3) * RESOURCE_WEIGHT[r],
      0,
    ),
    taxes: -Math.max(0, c.taxRate - 0.25) * 0.08,
    stability: ((c.stability - 50) / 50) * 0.01,
    debt: -Math.min(0.03, debtRatio(c) * 0.02),
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, total };
}

function economy(c: CountryState, a: Aggregate) {
  const g = growthBreakdown(c, a.infrastructure).total;
  c.gdpGrowth = g;
  c.gdp *= Math.pow(1 + g, 1 / 12);

  const revenue = (c.gdp * c.taxRate) / 12;
  const spending = (c.gdp * (ADMIN_COST + c.budget.infrastructure + c.budget.research + c.budget.welfare + c.budget.defense)) / 12;
  const interest = c.treasury < 0 ? (-c.treasury * 0.04) / 12 : 0;
  c.treasury += revenue - spending - interest;
  c.defenseFund += (c.gdp * c.budget.defense) / 12;
}

/** Years to gain one tech level when spending 3% of GDP on research. */
export const yearsPerTechLevel = (level: number) => 4 + 0.5 * level;

function investment(c: CountryState, provinces: ProvinceState[]) {
  // Infrastructure: 4% of GDP slowly builds it up; spending nothing lets it decay.
  const change = (c.budget.infrastructure / 0.04 - 0.5) * 0.01;
  const cap = Math.min(MAX_INFRASTRUCTURE, c.techLevel + 2);
  for (const p of provinces) {
    p.infrastructure = clamp(p.infrastructure + change, 0, Math.max(p.infrastructure, cap));
  }

  // Research.
  if (c.techLevel < MAX_TECH) {
    c.researchProgress += c.budget.research / 0.03 / (12 * yearsPerTechLevel(c.techLevel));
    while (c.researchProgress >= 1 && c.techLevel < MAX_TECH) {
      c.researchProgress -= 1;
      c.techLevel += 1;
      c.gdp *= 1.02; // a new technology level gives a one-off productivity boost
    }
  }
}

/** Where stability is heading, broken down so the UI can explain it. */
export function stabilityBreakdown(c: CountryState) {
  const food = supplied(c.resources.food);
  const parts = {
    base: 55,
    welfare: clamp((c.budget.welfare / 0.15 - 1) * 20, -25, 15),
    taxes: -Math.max(0, c.taxRate - 0.35) * 100,
    growth: clamp(c.gdpGrowth * 500, -10, 10),
    food: food < 1 ? -(1 - food) * 40 : 0,
    debt: -Math.min(20, debtRatio(c) * 20),
  };
  const target = clamp(Object.values(parts).reduce((a, b) => a + b, 0), 0, 100);
  return { parts, target };
}

function society(c: CountryState, provinces: ProvinceState[]) {
  c.stability = clamp(c.stability + (stabilityBreakdown(c).target - c.stability) * 0.1, 0, 100);

  // Population: poorer countries grow faster; hunger and unrest slow growth.
  const perPerson = (c.gdp * 1e6) / c.population;
  const food = supplied(c.resources.food);
  const rate =
    0.003 +
    0.025 / (1 + Math.pow(perPerson / 2500, 1.2)) +
    (food < 1 ? -(1 - food) * 0.03 : 0) +
    (c.stability < 30 ? -(30 - c.stability) * 0.0005 : 0);
  c.popGrowth = rate;
  const factor = Math.pow(1 + rate, 1 / 12);
  let total = 0;
  for (const p of provinces) {
    p.population *= factor;
    total += p.population;
  }
  c.population = total;
}

function recordHistory(c: CountryState) {
  c.history.gdp.push(Math.round(c.gdp));
  c.history.population.push(Math.round(c.population));
  if (c.history.gdp.length > HISTORY_MONTHS) c.history.gdp.shift();
  if (c.history.population.length > HISTORY_MONTHS) c.history.population.shift();
}
