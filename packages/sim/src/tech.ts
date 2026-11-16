import type { ResourceId } from "@gs/shared";
import { governmentEffects } from "./government";
import type { CountryState } from "./state";

/**
 * Technology: three research branches, each with a level from 1 to 20.
 *
 * - Research spending advances the branch the country focuses on ("balanced"
 *   always works on the lowest branch). Progress in a branch is kept when the
 *   focus changes.
 * - Reaching a level unlocks that branch's technologies up to it (the tree):
 *   each has a concrete effect on existing rules (production, growth, research,
 *   movement, combat, recovery, interest, stability, infrastructure).
 * - Economy also sets production; Military sets unit power; Infrastructure sets
 *   how far infrastructure can be built up. The country's overall `techLevel`
 *   is the average of the three (used for growth catch-up, maps and rankings).
 *
 * Starting levels come from GDP per person (the same for all three branches):
 * the game doesn't invent which countries lead in which field.
 */
export type Branch = "economy" | "military" | "infrastructure";
export const BRANCHES: Branch[] = ["economy", "military", "infrastructure"];
export type ResearchFocus = Branch | "balanced";

export interface Research {
  levels: Record<Branch, number>;
  /** Progress towards the next level of each branch, 0-1. */
  progress: Record<Branch, number>;
  focus: ResearchFocus;
}

export const BRANCH_LABEL: Record<Branch, { label: string; help: string }> = {
  economy: { label: "Economy", help: "Production of food, energy and minerals, growth and research speed." },
  military: { label: "Military", help: "How strong your units are, how fast they move and recover." },
  infrastructure: { label: "Infrastructure", help: "How far infrastructure can be built, movement at home, energy." },
};

/** What a technology changes. Numbers add up across unlocked technologies. */
export interface TechMods {
  /** Extra output of a resource (0.15 = +15%). */
  food: number;
  energy: number;
  minerals: number;
  /** Extra yearly growth. */
  growth: number;
  /** Extra research speed. */
  research: number;
  /** Faster land movement everywhere / in your own territory, faster sea movement. */
  landSpeed: number;
  ownLandSpeed: number;
  seaSpeed: number;
  /** Extra power of armies / fleets / all units. */
  armyPower: number;
  fleetPower: number;
  unitPower: number;
  /** Air wings' battle support multiplier (0.5 = 50% more support per wing). */
  airSupport: number;
  /** Faster recovery of strength at home (1 = twice as fast). */
  recovery: number;
  /** Lower interest on debt (0.01 = one percentage point). */
  interest: number;
  /** Stability points. */
  stability: number;
  /** Faster infrastructure building. */
  infraSpeed: number;
}
const NONE: TechMods = { food: 0, energy: 0, minerals: 0, growth: 0, research: 0, landSpeed: 0, ownLandSpeed: 0, seaSpeed: 0, armyPower: 0, fleetPower: 0, unitPower: 0, airSupport: 0, recovery: 0, interest: 0, stability: 0, infraSpeed: 0 };

export interface Tech {
  id: string;
  branch: Branch;
  /** Branch level that unlocks it. */
  level: number;
  name: string;
  /** What it does, in plain words. */
  effect: string;
  mods: Partial<TechMods>;
}

export const TECHS: Tech[] = [
  { id: "mech_farming", branch: "economy", level: 2, name: "Mechanised farming", effect: "+15% food production", mods: { food: 0.15 } },
  { id: "mass_production", branch: "economy", level: 4, name: "Mass production", effect: "+10% energy and mineral production", mods: { energy: 0.1, minerals: 0.1 } },
  { id: "computing", branch: "economy", level: 6, name: "Computing", effect: "+10% research speed", mods: { research: 0.1 } },
  { id: "automation", branch: "economy", level: 9, name: "Automation", effect: "+0.3% economic growth per year", mods: { growth: 0.003 } },
  { id: "global_finance", branch: "economy", level: 12, name: "Global finance", effect: "Interest on debt falls from 4% to 3%", mods: { interest: 0.01 } },
  { id: "ai", branch: "economy", level: 15, name: "Artificial intelligence", effect: "+15% research speed, +0.3% growth per year", mods: { research: 0.15, growth: 0.003 } },

  { id: "motorised", branch: "military", level: 2, name: "Motorised logistics", effect: "Armies march 15% faster", mods: { landSpeed: 0.15 } },
  { id: "combined_arms", branch: "military", level: 4, name: "Combined arms", effect: "Armies +10% stronger", mods: { armyPower: 0.1 } },
  { id: "air_superiority", branch: "military", level: 6, name: "Air superiority", effect: "Air forces give 50% more support in battle", mods: { airSupport: 0.5 } },
  { id: "blue_water", branch: "military", level: 8, name: "Blue-water navy", effect: "Fleets +20% stronger and 20% faster", mods: { fleetPower: 0.2, seaSpeed: 0.2 } },
  { id: "precision", branch: "military", level: 11, name: "Precision weapons", effect: "All units +10% stronger", mods: { unitPower: 0.1 } },
  { id: "rapid_reinforcement", branch: "military", level: 14, name: "Rapid reinforcement", effect: "Units recover strength twice as fast at home", mods: { recovery: 1 } },

  { id: "railways", branch: "infrastructure", level: 2, name: "Railways", effect: "Armies move 20% faster in your own territory", mods: { ownLandSpeed: 0.2 } },
  { id: "electrification", branch: "infrastructure", level: 4, name: "Electrification", effect: "+15% energy production", mods: { energy: 0.15 } },
  { id: "highways", branch: "infrastructure", level: 6, name: "Highways", effect: "Infrastructure is built 25% faster", mods: { infraSpeed: 0.25 } },
  { id: "modern_ports", branch: "infrastructure", level: 9, name: "Modern ports", effect: "Fleets 15% faster", mods: { seaSpeed: 0.15 } },
  { id: "smart_grids", branch: "infrastructure", level: 12, name: "Smart grids", effect: "+3 stability", mods: { stability: 3 } },
  { id: "high_speed_rail", branch: "infrastructure", level: 15, name: "High-speed rail", effect: "Armies 20% faster at home, +0.2% growth per year", mods: { ownLandSpeed: 0.2, growth: 0.002 } },
];

export const unlocked = (c: CountryState, t: Tech) => c.research.levels[t.branch] >= t.level;

/** Bonuses depend only on the three levels, so they're worked out once per combination (battles ask very often). */
const modsCache = new Map<string, TechMods>();

/** All bonuses from the technologies a country has. Treat the result as read-only. */
export function techMods(c: CountryState | undefined): TechMods {
  if (!c?.research) return NONE;
  const { economy, military, infrastructure } = c.research.levels;
  const key = `${economy}|${military}|${infrastructure}`;
  let out = modsCache.get(key);
  if (!out) {
    out = { ...NONE };
    for (const t of TECHS) {
      if (c.research.levels[t.branch] < t.level) continue;
      for (const [k, v] of Object.entries(t.mods) as [keyof TechMods, number][]) out[k] += v;
    }
    modsCache.set(key, out);
  }
  return out;
}

/** Technologies are spread through the levels, so this is a small lookup. */
export const nextTech = (c: CountryState, b: Branch) => TECHS.find((t) => t.branch === b && !unlocked(c, t));

/** Starting research: every branch at the country's starting level. */
export function startingResearch(level: number, progress = 0): Research {
  return { levels: { economy: level, military: level, infrastructure: level }, progress: { economy: progress, military: 0, infrastructure: 0 }, focus: "balanced" };
}

/** Overall level: the average of the branches. */
export const overallLevel = (r: Research) => Math.round((r.levels.economy + r.levels.military + r.levels.infrastructure) / 3);

/** The branch research money goes to this month. */
export function researchTarget(c: CountryState, max: number): Branch | null {
  const r = c.research;
  if (r.focus !== "balanced") return r.levels[r.focus] < max ? r.focus : null;
  const open = BRANCHES.filter((b) => r.levels[b] < max);
  if (!open.length) return null;
  return open.reduce((low, b) => (r.levels[b] < r.levels[low] ? b : low));
}

/** One branch moves about 2.5× as fast as the old single level did, so the average keeps a similar pace. */
export const BRANCH_SPEED = 2.5;

/** Years to gain one level in a branch at 3% of GDP on research (before speed bonuses). */
export const yearsPerBranchLevel = (level: number) => (4 + 0.5 * level) / BRANCH_SPEED;

/** Research speed multiplier from government and technologies. */
export const researchSpeed = (c: CountryState) => 1 + governmentEffects(c, false).research + techMods(c).research;

/** Extra output of each resource from technology. */
export const resourceBonus = (c: CountryState | undefined, r: ResourceId) => 1 + techMods(c)[r];
