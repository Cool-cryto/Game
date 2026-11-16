import type { CountryId } from "@gs/shared";
import type { CountryState } from "./state";

/**
 * How a computer-run country behaves. Every country gets one at the start of a game (game-generated, not a judgement
 * about the real country), weighted a little by its kind of government. Personality only changes *choices*: how
 * readily it goes to war, how big an army it keeps in peacetime, what it builds and how it treats its neighbours.
 */
export type Personality = "aggressive" | "defensive" | "economic" | "diplomatic" | "balanced";
export const PERSONALITIES: Personality[] = ["aggressive", "defensive", "economic", "diplomatic", "balanced"];

export interface PersonalityRules {
  label: string;
  summary: string;
  /** Multiplier on the monthly chance of starting a war. */
  warChance: number;
  /** Its side must be this many times stronger than the target's side. */
  warRatio: number;
  /** Relations at or below this make a neighbour a possible target. */
  hostility: number;
  /** Share of its unit limit kept in peacetime. */
  peaceArmy: number;
  /** Monthly chance of starting a building (when the budget allows). */
  buildChance: number;
  /** Fortifies borders with hostile neighbours in peacetime too. */
  fortifies: boolean;
  /** Multiplier on the chance of forming alliances and guarantees. */
  friendliness: number;
  /** Monthly chance of a rivalry flaring with a random neighbour (relations drop). */
  rivalry: number;
}

export const PERSONALITY_RULES: Record<Personality, PersonalityRules> = {
  aggressive: { label: "Aggressive", summary: "Builds a big army and attacks weaker rivals.", warChance: 3, warRatio: 1.5, hostility: -35, peaceArmy: 0.75, buildChance: 0.15, fortifies: false, friendliness: 0.6, rivalry: 0.2 },
  defensive: { label: "Defensive", summary: "Fortifies its borders and rarely starts wars.", warChance: 0.3, warRatio: 3, hostility: -75, peaceArmy: 0.7, buildChance: 0.2, fortifies: true, friendliness: 1, rivalry: 0.03 },
  economic: { label: "Economic", summary: "Builds factories, trades, keeps a small army.", warChance: 0.5, warRatio: 2.5, hostility: -70, peaceArmy: 0.45, buildChance: 0.3, fortifies: false, friendliness: 1.2, rivalry: 0.03 },
  diplomatic: { label: "Diplomatic", summary: "Seeks alliances, guarantees and treaties.", warChance: 0.5, warRatio: 2.5, hostility: -70, peaceArmy: 0.55, buildChance: 0.15, fortifies: false, friendliness: 2.5, rivalry: 0.02 },
  balanced: { label: "Balanced", summary: "A bit of everything.", warChance: 1, warRatio: 2, hostility: -55, peaceArmy: 0.6, buildChance: 0.15, fortifies: false, friendliness: 1, rivalry: 0.08 },
};

/** A stable number from a country id and the game's seed, so personalities don't depend on the order of anything. */
function hash(id: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

/** Pick a personality: closed autocracies lean aggressive, democracies lean economic or diplomatic. */
export function startingPersonality(c: Pick<CountryState, "id" | "government">, seed: number): Personality {
  const r = hash(c.id as CountryId, seed);
  const regime = c.government?.regime;
  const weights: Record<Personality, number> =
    regime === "closed_autocracy"
      ? { aggressive: 0.3, defensive: 0.25, economic: 0.1, diplomatic: 0.05, balanced: 0.3 }
      : regime === "electoral_autocracy"
        ? { aggressive: 0.2, defensive: 0.25, economic: 0.15, diplomatic: 0.1, balanced: 0.3 }
        : { aggressive: 0.06, defensive: 0.2, economic: 0.27, diplomatic: 0.2, balanced: 0.27 };
  let acc = 0;
  for (const p of PERSONALITIES) {
    acc += weights[p];
    if (r < acc) return p;
  }
  return "balanced";
}

export const personalityOf = (c: CountryState | undefined) => PERSONALITY_RULES[c?.personality ?? "balanced"];
