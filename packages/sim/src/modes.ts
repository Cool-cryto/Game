import type { CountryId } from "@gs/shared";
import { RESOURCES } from "@gs/shared";
import { alliesOf, pairKey } from "./diplomacy";
import { countryNeighbors, type Geography } from "./geography";
import { startingPersonality } from "./personality";
import { nextRandom } from "./rng";
import { logEvent, startingInfrastructure, type GameState } from "./state";
import { refreshResources } from "./systems";

/**
 * Ways to start a world, applied once to a fresh game (any scenario or custom world):
 *
 * - standard: the scenario as it is.
 * - alternate: real alliances and organizations are dissolved; neighbours start with random relations, some of them
 *   allied, others bitter rivals; every country gets a fresh personality.
 * - random: an alternate world, and also random resource deposits (30%-200% of the scenario's), starting treasuries
 *   (-10% to +15% of GDP), stability (40-75) and technology (one level either way). Everything random is
 *   game-generated.
 *
 * Sandbox options work with any mode: everyone's starting money, how warlike the AI is, and whether political crises
 * (coups, revolutions, breakaways) happen.
 */
export type WorldMode = "standard" | "alternate" | "random";
export interface WorldOptions {
  mode: WorldMode;
  /** Multiplier on every country's starting money: treasury (+10% of GDP per step above 1) and army funds. */
  startingMoney: number;
  /** Multiplier on the AI's chance of starting wars. */
  aiAggression: number;
  /** Coups, revolutions and breakaway states. */
  upheaval: boolean;
}
export const STANDARD_WORLD: WorldOptions = { mode: "standard", startingMoney: 1, aiAggression: 1, upheaval: true };
export const WORLD_MODES: { id: WorldMode; label: string; help: string }[] = [
  { id: "standard", label: "Standard", help: "The scenario as it is: real borders, alliances and organizations." },
  { id: "alternate", label: "Alternate history", help: "Real borders, but alliances and rivalries are reshuffled and every country gets a new personality." },
  { id: "random", label: "Random world", help: "Alternate history plus random resources, treasuries, stability and technology." },
];

export function applyWorldOptions(s: GameState, geo: Geography, o: WorldOptions) {
  const rand = () => nextRandom(s.rng);
  s.settings = { ...s.settings, mode: o.mode, startingMoney: o.startingMoney, aiAggression: o.aiAggression, upheaval: o.upheaval };
  const active = Object.values(s.countries).filter((c) => c.active);
  if (o.mode !== "standard") {
    s.organizations = [];
    s.alliances = [];
    s.relations = {};
    const neighbors = countryNeighbors(geo, (p) => s.provinces[p]?.owner);
    for (const c of active) {
      for (const n of neighbors.get(c.id) ?? []) {
        if (n <= c.id || !s.countries[n]?.active) continue;
        const rel = Math.round((rand() - 0.5) * 140);
        s.relations[pairKey(c.id, n as CountryId)] = Math.max(-70, Math.min(70, rel));
        if (rel > 45 && rand() < 0.6 && alliesOf(s, c.id).length < 3 && alliesOf(s, n as CountryId).length < 3) s.alliances.push(pairKey(c.id, n as CountryId));
      }
      c.personality = startingPersonality(c, (s.rng.seed ^ 0x5bd1e995) >>> 0);
    }
  }
  if (o.mode === "random") {
    for (const p of Object.values(s.provinces)) {
      if (!s.countries[p.owner]?.active) continue;
      for (const r of RESOURCES) p.deposits[r] = p.deposits[r] * (0.3 + 1.7 * rand());
    }
    for (const c of active) {
      c.treasury += (rand() * 0.25 - 0.1) * c.gdp;
      c.stability = 40 + Math.round(rand() * 35);
      const shift = Math.round(rand() * 2 - 1);
      for (const b of ["economy", "military", "infrastructure"] as const) c.research.levels[b] = Math.max(1, Math.min(20, c.research.levels[b] + shift));
      c.techLevel = Math.max(1, c.techLevel + shift);
    }
    for (const p of Object.values(s.provinces)) {
      const owner = s.countries[p.owner];
      if (owner?.active) p.infrastructure = startingInfrastructure(owner.techLevel, p.population, p.areaKm2);
    }
  }
  if (o.startingMoney !== 1) {
    for (const c of active) {
      c.treasury += (o.startingMoney - 1) * 0.1 * c.gdp;
      c.defenseFund *= o.startingMoney;
    }
  }
  refreshResources(s);
  if (o.mode !== "standard") logEvent(s, "diplomacy", o.mode === "random" ? "A random world: resources, treasuries and alliances are all different." : "An alternate history: the old alliances are gone and new rivalries have taken their place.", []);
}
