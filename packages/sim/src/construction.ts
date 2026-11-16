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
 *
 * A building is ordered (paid from the treasury, which may go into debt up to a
 * limit) and finishes after some months. Country-wide effects are weighted by
 * each province's share of the population, so a factory in a big city counts
 * for more than one in a village. Buildings stay with the province when it
 * changes hands. Every province starts with none (real-world industry is
 * already in each country's GDP and infrastructure).
 */
export type BuildingType = "factory" | "railway" | "port" | "fort";
export const BUILDING_TYPES: BuildingType[] = ["factory", "railway", "port", "fort"];
export type Buildings = Partial<Record<BuildingType, number>>;

export const BUILDINGS: Record<BuildingType, { label: string; max: number; cost: number; days: number; effect: string; coastal?: boolean }> = {
  factory: { label: "Factory", max: 5, cost: 1500, days: 180, effect: "Faster economic growth (weighted by population); +10% energy and minerals here per level." },
  railway: { label: "Railway", max: 1, cost: 600, days: 120, effect: "Armies move 40% faster into this province; infrastructure here grows 50% faster." },
  port: { label: "Port", max: 3, cost: 800, days: 150, coastal: true, effect: "Fleets sail out 15% faster per level and recover strength faster here." },
  fort: { label: "Fortification", max: 3, cost: 500, days: 90, effect: "Defenders here fight 15% harder per level; sieges take 40% longer per level." },
};

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
  c.treasury -= buildCost(s, c, province, b);
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

/** The AI builds while its debt is light: factories in its biggest provinces, forts facing enemies in wartime. */
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
  if (!target) {
    const p = owned.filter((x) => x.controller === c.id && buildingLevel(x, "factory") < BUILDINGS.factory.max).sort((a, b) => b.population / (1 + buildingLevel(b, "factory")) - a.population / (1 + buildingLevel(a, "factory")))[0];
    if (p) target = { p, b: "factory" };
  }
  if (target && !canBuild(s, geo, c.id, target.p.id, target.b)) startBuilding(s, c.id, target.p.id, target.b);
}
