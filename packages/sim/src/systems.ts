import { governmentGrowth, governmentStability } from "./government";
import { factoryGrowth } from "./construction";
import { treatyEffects } from "./treaties";
import { sanctionGrowth, tribute } from "./statecraft";
import { overallLevel, researchSpeed, researchTarget, resourceBonus, techMods, yearsPerBranchLevel } from "./tech";
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
  type Ledger,
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
  const warring = new Set(state.wars.flatMap((w) => [...w.attackers, ...w.defenders]));
  const treaties = treatyEffects(state);
  // Tribute owed to each overlord this month (worked out before anyone's GDP moves).
  const tributeTo = new Map<CountryId, number>();
  for (const c of Object.values(state.countries)) if (c.active && c.overlord) tributeTo.set(c.overlord, (tributeTo.get(c.overlord) ?? 0) + tribute(c));
  for (const c of Object.values(state.countries)) {
    if (!c.active) continue;
    const a = agg.get(c.id)!;
    const t = treaties.get(c.id);
    economy(c, a, t?.trade ?? 0, sanctionGrowth(state, c.id), tributeTo.get(c.id) ?? 0);
    const provinces = (owned.get(c.id) ?? []).map((id) => state.provinces[id]!);
    investment(c, provinces, t?.research ?? 0);
    society(c, provinces, warring.has(c.id));
    recordHistory(c);
  }
}

interface Aggregate {
  /** Population-weighted average infrastructure. */
  infrastructure: number;
  /** Population-weighted average factory level (held provinces). */
  factories: number;
  production: Record<ResourceId, number>;
}

function aggregateProvinces(state: GameState): Map<CountryId, Aggregate> {
  const out = new Map<CountryId, Aggregate & { pop: number; infraPop: number; factoryPop: number }>();
  for (const p of Object.values(state.provinces)) {
    const owner = state.countries[p.owner];
    if (!owner?.active) continue;
    let a = out.get(p.owner);
    if (!a) out.set(p.owner, (a = { pop: 0, infraPop: 0, factoryPop: 0, infrastructure: 0, factories: 0, production: { food: 0, energy: 0, minerals: 0 } }));
    a.pop += p.population;
    a.infraPop += p.infrastructure * p.population;
    if (p.controller === p.owner) a.factoryPop += (p.buildings?.factory ?? 0) * p.population;
    for (const r of RESOURCES) a.production[r] += rawProduction(p, owner.research.levels.economy, r) * resourceBonus(owner, r) * state.resourceScale[r];
  }
  for (const [id, a] of out) {
    a.infrastructure = a.pop > 0 ? a.infraPop / a.pop : 0;
    a.factories = a.pop > 0 ? a.factoryPop / a.pop : 0;
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
/** Yearly interest on debt: 4%, lower with Global finance. */
export const interestRate = (c: CountryState) => 0.04 - techMods(c).interest;
export const debtRatio = (c: CountryState) => (c.treasury < 0 && c.gdp > 0 ? -c.treasury / c.gdp : 0);

/** The yearly GDP growth rate this month, broken down so the UI can explain it. */
/** `trade` is the extra growth from trade partners (see tradeGrowth in treaties.ts). */
export function growthBreakdown(c: CountryState, infrastructure: number, weightedFactory = 0, trade = 0, sanctions = 0) {
  const parts = {
    // Less developed economies catch up faster.
    base: 0.012 + 0.03 * (1 - c.techLevel / 12),
    infrastructure: clamp((infrastructure - c.research.levels.infrastructure) * 0.003, -0.02, 0.01),
    // Exporters earn a little, importers pay a little; real shortages hurt a lot.
    resources: RESOURCES.reduce(
      (sum, r) => sum + (clamp(tradeBalance(c.resources[r]), -1, 1) * 0.25 - (1 - supplied(c.resources[r])) * 3) * RESOURCE_WEIGHT[r],
      0,
    ),
    taxes: -Math.max(0, c.taxRate - 0.25) * 0.08,
    stability: ((c.stability - 50) / 50) * 0.01,
    debt: -Math.min(0.03, debtRatio(c) * 0.02),
    government: governmentGrowth(c, false),
    technology: techMods(c).growth,
    factories: factoryGrowth(weightedFactory),
    trade,
    sanctions,
  };
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return { parts, total };
}

/**
 * What a unit of each resource is worth on the world market, in millions of US$. Set so that a country importing
 * everything it needs would pay about $300 a person a year for food, 3% of GDP for energy and 1.5% for minerals.
 */
export const RESOURCE_PRICE: Record<ResourceId, number> = { food: 25, energy: 25, minerals: 12.5 };
/** The state's share of trade: its taxes on exporters and its subsidies to importers. */
export const TRADE_STATE_SHARE = 0.3;
/** ...at most this share of GDP a year either way (small countries with rich deposits would otherwise get absurdly rich). */
export const TRADE_INCOME_CAP = 0.02;

/** The state's monthly income from trade (negative for net importers), in millions. */
export function tradeIncome(c: CountryState): number {
  let v = 0;
  for (const r of RESOURCES) v += (c.resources[r].exports - c.resources[r].imports) * RESOURCE_PRICE[r];
  const cap = (TRADE_INCOME_CAP * c.gdp) / 12;
  return Math.max(-cap, Math.min(cap, v * TRADE_STATE_SHARE));
}

function economy(c: CountryState, a: Aggregate, trade: number, sanctions: number, tributeIn: number) {
  const g = growthBreakdown(c, a.infrastructure, a.factories, trade, sanctions).total;
  c.gdpGrowth = g;
  c.gdp *= Math.pow(1 + g, 1 / 12);

  const month = (share: number) => (c.gdp * share) / 12;
  const ledger: Ledger = {
    taxes: month(c.taxRate),
    trade: tradeIncome(c),
    admin: -month(ADMIN_COST),
    infrastructure: -month(c.budget.infrastructure),
    research: -month(c.budget.research),
    welfare: -month(c.budget.welfare),
    defense: -month(c.budget.defense),
    interest: c.treasury < 0 ? -(-c.treasury * interestRate(c)) / 12 : 0,
    // Already paid when each project was ordered; shown here so the month adds up.
    construction: c.monthConstruction ? -c.monthConstruction : 0, // (never -0: it wouldn't survive JSON)
    tribute: tributeIn - tribute(c),
    // Already moved when it was sent; shown here so the month adds up.
    aid: c.monthAid ?? 0,
    net: 0,
  };
  // Construction was taken from the treasury when ordered, so it isn't taken again.
  const change = ledger.taxes + ledger.trade + ledger.admin + ledger.infrastructure + ledger.research + ledger.welfare + ledger.defense + ledger.interest + ledger.tribute;
  ledger.net = change + ledger.construction + ledger.aid;
  c.treasury += change;
  c.ledger = ledger;
  c.monthConstruction = 0;
  c.monthAid = 0;
  c.defenseFund += month(c.budget.defense);
}

/** Years to gain one tech level when spending 3% of GDP on research. */
export const yearsPerTechLevel = (level: number) => 4 + 0.5 * level;

function investment(c: CountryState, provinces: ProvinceState[], treatyResearch = 0) {
  // Infrastructure: 4% of GDP slowly builds it up; spending nothing lets it decay.
  const mods = techMods(c);
  const change = (c.budget.infrastructure / 0.04 - 0.5) * 0.01 * (c.budget.infrastructure / 0.04 > 0.5 ? 1 + mods.infraSpeed : 1);
  const cap = Math.min(MAX_INFRASTRUCTURE, c.research.levels.infrastructure + 2);
  for (const p of provinces) {
    // Railways speed up building (not decay).
    const rail = change > 0 && p.buildings?.railway ? 1.5 : 1;
    p.infrastructure = clamp(p.infrastructure + change * rail, 0, Math.max(p.infrastructure, cap));
  }

  // Research: money goes to the focused branch (or the lowest, when balanced).
  const branch = researchTarget(c, MAX_TECH);
  if (branch) {
    const r = c.research;
    // Research facilities in held provinces: +4% per level, up to +40% (see construction.ts).
    let labs = 0;
    for (const p of provinces) if (p.controller === c.id) labs += p.buildings?.lab ?? 0;
    const facilities = Math.min(0.4, 0.04 * labs);
    r.progress[branch] += (c.budget.research / 0.03 / (12 * yearsPerBranchLevel(r.levels[branch]))) * (researchSpeed(c, treatyResearch) + facilities);
    while (r.progress[branch] >= 1 && r.levels[branch] < MAX_TECH) {
      r.progress[branch] -= 1;
      r.levels[branch] += 1;
      if (branch === "economy") c.gdp *= 1.02; // a new economic level gives a one-off productivity boost
    }
    if (r.levels[branch] >= MAX_TECH) r.progress[branch] = 0;
    c.techLevel = overallLevel(r);
    c.researchProgress = r.progress[branch];
  }
}

/** Where stability is heading, broken down so the UI can explain it. */
export function stabilityBreakdown(c: CountryState, atWar = false) {
  const food = supplied(c.resources.food);
  const parts = {
    base: 55,
    welfare: clamp((c.budget.welfare / 0.15 - 1) * 20, -25, 15),
    taxes: -Math.max(0, c.taxRate - 0.35) * 100,
    growth: clamp(c.gdpGrowth * 500, -10, 10),
    food: food < 1 ? -(1 - food) * 40 : 0,
    debt: -Math.min(20, debtRatio(c) * 20),
    government: governmentStability(c, atWar),
    technology: techMods(c).stability,
  };
  const target = clamp(Object.values(parts).reduce((a, b) => a + b, 0), 0, 100);
  return { parts, target };
}

function society(c: CountryState, provinces: ProvinceState[], atWar: boolean) {
  c.stability = clamp(c.stability + (stabilityBreakdown(c, atWar).target - c.stability) * 0.1, 0, 100);

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
