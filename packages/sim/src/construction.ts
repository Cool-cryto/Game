import type { CountryId, ProvinceId } from "@gs/shared";
import type { Geography } from "./geography";
import { costMultiplier } from "./military";
import { nextRandom } from "./rng";
import { budgetBalance, logEvent, type CountryState, type GameState, type ProvinceState } from "./state";

/**
 * Construction: buildings in provinces.
 *
 * - Factory (levels 1-5): faster growth and more energy and minerals from the province.
 * - Railway (level 1): armies cross the province much faster; its infrastructure grows faster.
 * - Port (levels 1-3, coastal): fleets leave faster and recover faster here.
 * - Fortification (levels 1-3): defenders fight harder; sieges take much longer.
 * - Farm, power plant, mine (levels 1-3): +15% food, energy or minerals from the province per level.
 * - Research facility (levels 1-3): +4% research speed per level across the country (up to +40%).
 * - Military base (levels 1-2): units recover faster here; armies recruited here start at full strength.
 * - Airbase (levels 1-2): air wings based here support battles 40% further away per level.
 *
 * A building is ordered (paid from the treasury, which may go into debt up to a
 * limit) and finishes after some months. Country-wide effects are weighted by
 * each province's share of the population, so a factory in a big city counts
 * for more than one in a village. Buildings stay with the province when it
 * changes hands. Every province starts with none (real-world industry is
 * already in each country's GDP and infrastructure).
 */
export type BuildingType = "factory" | "railway" | "port" | "fort" | "farm" | "powerPlant" | "mine" | "lab" | "base" | "airbase";
export const BUILDING_TYPES: BuildingType[] = ["factory", "farm", "powerPlant", "mine", "lab", "railway", "port", "base", "airbase", "fort"];
export type Buildings = Partial<Record<BuildingType, number>>;

export const BUILDINGS: Record<BuildingType, { label: string; max: number; cost: number; days: number; effect: string; coastal?: boolean }> = {
  factory: { label: "Factory", max: 5, cost: 1500, days: 180, effect: "Faster economic growth (weighted by population); +10% energy and minerals here per level." },
  railway: { label: "Railway", max: 1, cost: 600, days: 120, effect: "Armies move 40% faster into this province; infrastructure here grows 50% faster." },
  port: { label: "Port", max: 3, cost: 800, days: 150, coastal: true, effect: "Fleets sail out 15% faster per level and recover strength faster here." },
  fort: { label: "Fortification", max: 3, cost: 500, days: 90, effect: "Defenders here fight 15% harder per level; sieges take 40% longer per level." },
  farm: { label: "Farm", max: 3, cost: 400, days: 120, effect: "+15% food from this province per level." },
  powerPlant: { label: "Power plant", max: 3, cost: 900, days: 180, effect: "+15% energy from this province per level." },
  mine: { label: "Mine", max: 3, cost: 700, days: 150, effect: "+15% minerals from this province per level." },
  lab: { label: "Research facility", max: 3, cost: 1000, days: 240, effect: "+4% research speed per level, counted across the country (up to +40%)." },
  base: { label: "Military base", max: 2, cost: 700, days: 150, effect: "Units here recover 50% faster per level; armies recruited here start at full strength." },
  airbase: { label: "Airbase", max: 2, cost: 900, days: 150, effect: "Air wings based here support battles 40% further away per level." },
};

/** Output multiplier from production buildings in a province (factories help energy and minerals). */
export function outputMultiplier(p: ProvinceState, r: "food" | "energy" | "minerals"): number {
  const b = p.buildings;
  if (!b) return 1;
  if (r === "food") return 1 + 0.15 * (b.farm ?? 0);
  const factory = 1 + 0.1 * (b.factory ?? 0);
  return factory * (1 + 0.15 * ((r === "energy" ? b.powerPlant : b.mine) ?? 0));
}

/** Research speed from research facilities in held provinces: +4% per level, up to +40%. */
export function labBonus(s: GameState, c: CountryId): number {
  let levels = 0;
  for (const p of Object.values(s.provinces)) if (p.owner === c && p.controller === c) levels += p.buildings?.lab ?? 0;
  return Math.min(0.4, 0.04 * levels);
}

/** At most this many buildings under construction at once per country. */
export const MAX_PROJECTS = 5;
/** Building may push the treasury into debt, but not below this share of GDP. */
export const BORROW_LIMIT = 0.5;

export interface Project {
  id: number;
  province: ProvinceId;
  building: BuildingType;
  /** Day it finishes. */
  doneTick: number;
}

export const buildingLevel = (p: ProvinceState | undefined, b: BuildingType) => p?.buildings?.[b] ?? 0;

/**
 * Cost in millions. A factory costs 3% of the province's share of the economy per level (so it's worth the same
 * everywhere: dearer in a big city, cheaper in a village). Railways, ports and forts have a fixed price that's
 * dearer in richer countries (wages), at most 3% of GDP.
 */
export function buildCost(s: GameState, c: CountryState, province: ProvinceId, b: BuildingType): number {
  const floor = BUILDINGS[b].cost * 0.05 * costMultiplier(c);
  if (b === "factory") {
    const share = c.population > 0 ? (s.provinces[province]?.population ?? 0) / c.population : 0;
    return Math.max(floor, 0.03 * c.gdp * share);
  }
  return Math.min(BUILDINGS[b].cost * costMultiplier(c), 0.03 * c.gdp);
}

/** Can this country start this building here? Returns the reason if not. */
export function canBuild(s: GameState, geo: Geography, country: CountryId, province: ProvinceId, b: BuildingType): string | null {
  const c = s.countries[country];
  const p = s.provinces[province];
  if (!c?.active) return "That country can't build.";
  if (!BUILDING_TYPES.includes(b)) return "Unknown building.";
  if (!p || p.owner !== country || p.controller !== country) return "You can only build in provinces you own and hold.";
  if (BUILDINGS[b].coastal && !geo.provinces[province]?.coastal) return "Ports can only be built on the coast.";
  const queued = c.construction.filter((q) => q.province === province && q.building === b).length;
  if (buildingLevel(p, b) + queued >= BUILDINGS[b].max) return `${BUILDINGS[b].label} is already at the highest level here.`;
  if (c.construction.length >= MAX_PROJECTS) return `You can build at most ${MAX_PROJECTS} things at once.`;
  if (c.treasury - buildCost(s, c, province, b) < -BORROW_LIMIT * c.gdp) return "Your debt is too high to borrow for this.";
  return null;
}

export function startBuilding(s: GameState, country: CountryId, province: ProvinceId, b: BuildingType) {
  const c = s.countries[country]!;
  const cost = buildCost(s, c, province, b);
  c.treasury -= cost;
  c.monthConstruction = (c.monthConstruction ?? 0) + cost;
  c.construction.push({ id: s.nextId++, province, building: b, doneTick: s.tick + BUILDINGS[b].days });
}

/** Finish due projects. Runs daily (projects are few). A project in a province lost meanwhile is abandoned. */
export function constructionDaily(s: GameState) {
  for (const c of Object.values(s.countries)) {
    if (!c.construction?.length) continue;
    const keep: Project[] = [];
    for (const q of c.construction) {
      const p = s.provinces[q.province];
      if (!p || p.owner !== c.id) continue; // lost the province: the work is lost too
      if (s.tick < q.doneTick) {
        keep.push(q);
        continue;
      }
      if (p.controller !== c.id) {
        keep.push({ ...q, doneTick: s.tick + 30 }); // occupied: work stops until it's back
        continue;
      }
      p.buildings = { ...p.buildings, [q.building]: buildingLevel(p, q.building) + 1 };
      if (c.controller === "human") logEvent(s, "military", `${c.name} finished a ${BUILDINGS[q.building].label.toLowerCase()} (level ${p.buildings[q.building]}).`, [c.id]);
    }
    c.construction = keep;
  }
}

/** Population-weighted average level of a building across a country's held provinces (0 to its max). */
export function weightedLevel(s: GameState, c: CountryId, b: BuildingType): number {
  let pop = 0;
  let sum = 0;
  for (const p of Object.values(s.provinces)) {
    if (p.owner !== c || p.controller !== c) continue;
    pop += p.population;
    sum += p.population * buildingLevel(p, b);
  }
  return pop > 0 ? sum / pop : 0;
}

/** Growth from factories: up to +0.8% a year with level-5 factories everywhere. */
export const factoryGrowth = (weightedFactory: number) => 0.0016 * weightedFactory;

/** Province output multiplier for energy and minerals. */
export const factoryOutput = (p: ProvinceState) => 1 + 0.1 * buildingLevel(p, "factory");

/**
 * The AI builds while its debt is light: forts facing enemies in wartime, a farm, power plant or mine when it runs
 * short of a resource, sometimes a research facility, otherwise factories in its biggest provinces.
 */
export function aiConstruction(s: GameState, geo: Geography, c: CountryState, enemies: Set<CountryId>, owned: ProvinceState[]) {
  // Like players, the AI may borrow to build, but only while its debt is light, and one project at a time.
  if (c.construction.length >= 1 || c.treasury < -0.05 * c.gdp || budgetBalance(c) < 0 || c.stability < 30 || nextRandom(s.rng) > 0.15) return;
  let target: { p: ProvinceState; b: BuildingType } | null = null;
  if (enemies.size) {
    // A fort in the most populous province bordering an enemy.
    const border = owned
      .filter((p) => p.controller === c.id && buildingLevel(p, "fort") < BUILDINGS.fort.max && (geo.provinces[p.id]?.neighbors ?? []).some((n) => enemies.has(s.provinces[n]?.controller as CountryId)))
      .sort((a, b) => b.population - a.population)[0];
    if (border) target = { p: border, b: "fort" };
  }
  // A shortage: a farm, power plant or mine where the deposits are richest.
  if (!target) {
    const short = (["food", "energy", "minerals"] as const).find((r) => c.resources[r].need > 0 && c.resources[r].production < c.resources[r].need * 0.9);
    if (short) {
      const b: BuildingType = short === "food" ? "farm" : short === "energy" ? "powerPlant" : "mine";
      const p = owned.filter((x) => x.controller === c.id && buildingLevel(x, b) < BUILDINGS[b].max).sort((x, y) => y.deposits[short] * y.areaKm2 - x.deposits[short] * x.areaKm2)[0];
      if (p) target = { p, b };
    }
  }
  // Now and then, a research facility in the capital.
  if (!target && c.capital && nextRandom(s.rng) < 0.2) {
    const p = s.provinces[c.capital];
    if (p && p.controller === c.id && buildingLevel(p, "lab") < BUILDINGS.lab.max) target = { p, b: "lab" };
  }
  if (!target) {
    const p = owned.filter((x) => x.controller === c.id && buildingLevel(x, "factory") < BUILDINGS.factory.max).sort((a, b) => b.population / (1 + buildingLevel(b, "factory")) - a.population / (1 + buildingLevel(a, "factory")))[0];
    if (p) target = { p, b: "factory" };
  }
  if (target && !canBuild(s, geo, c.id, target.p.id, target.b)) startBuilding(s, c.id, target.p.id, target.b);
}
