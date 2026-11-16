import type { CountryId } from "@gs/shared";
import { nextRandom } from "./rng";
import { logEvent, nameOf, type CountryState, type GameState, type Unit } from "./state";
import { recruitCost } from "./military";

/**
 * Generals. A country hires commanders and puts each in charge of one of its units; the general then leads every
 * unit of that country in the same place (the stack). Generals are fictional: names are put together from common
 * first and last names, never real people.
 *
 * - Skill 1-5: +4% attack and defense per level for the stack.
 * - Trait: offensive (+10% attack), defensive (+10% defense), logistics (stack moves 15% faster, fuel shortages
 *   hurt half as much), armour (+15% for tanks and mechanized units), or siege (occupies 30% faster).
 * - Experience: one point per day of battle. Skill rises at 60, 150, 280 and 450 points; rank follows skill.
 * - A general whose unit is destroyed is left without a command (not killed).
 */
export type Trait = "offensive" | "defensive" | "logistics" | "armor" | "siege";
export const TRAITS: Record<Trait, { label: string; effect: string }> = {
  offensive: { label: "Offensive doctrine", effect: "+10% attack" },
  defensive: { label: "Defensive expert", effect: "+10% defense" },
  logistics: { label: "Logistician", effect: "Moves 15% faster; fuel shortages hurt half as much" },
  armor: { label: "Armour commander", effect: "+15% for tanks and mechanized units" },
  siege: { label: "Siege specialist", effect: "Occupies provinces 30% faster" },
};

export interface General {
  id: number;
  owner: CountryId;
  name: string;
  /** 1-5. */
  skill: number;
  xp: number;
  trait: Trait;
  /** The unit this general commands (they lead its whole stack), or null. */
  unit: number | null;
}

export const RANKS = ["Brigadier General", "Major General", "Lieutenant General", "General", "Field Marshal"];
export const rankOf = (g: General) => RANKS[Math.min(RANKS.length, Math.max(1, g.skill)) - 1]!;
const SKILL_AT = [0, 60, 150, 280, 450];

const FIRST = ["Alex", "Sam", "Mira", "Jon", "Ana", "Leo", "Ida", "Omar", "Ravi", "Lena", "Tomas", "Yuki", "Ines", "Kofi", "Nadia", "Piotr", "Sofia", "Emil", "Hana", "Diego", "Amara", "Jonas", "Farah", "Mateo", "Elif", "Kenji", "Zara", "Pavel", "Noor", "Lucas"];
const LAST = ["Varga", "Lindqvist", "Okafor", "Moreau", "Takeda", "Novak", "Haddad", "Silva", "Brandt", "Kowal", "Mensah", "Rao", "Duarte", "Petrov", "Nakamura", "Costa", "Weber", "Aziz", "Bianchi", "Hansen", "Osei", "Park", "Rossi", "Fischer", "Kaya", "Dubois", "Reyes", "Sato", "Jensen", "Morales"];

/** Generals a country may have: one, plus one per six units. */
export const generalCap = (units: number) => 1 + Math.floor(units / 6);
/** Hiring a general costs half the price of recruiting an infantry army. */
export const generalCost = (c: CountryState) => 0.5 * recruitCost(c, "army", "infantry");

export const generalsOf = (s: GameState, c: CountryId) => s.generals.filter((g) => g.owner === c);

export function hireGeneral(s: GameState, country: CountryId): General {
  const pick = <T>(list: T[]) => list[Math.floor(nextRandom(s.rng) * list.length) % list.length]!;
  const traits = Object.keys(TRAITS) as Trait[];
  const g: General = { id: s.nextId++, owner: country, name: `${pick(FIRST)} ${pick(LAST)}`, skill: 1, xp: 0, trait: pick(traits), unit: null };
  s.generals = [...s.generals, g];
  return g;
}

/** Replace one general (the list is replaced, never edited in place, so network sync notices). */
export function updateGeneral(s: GameState, id: number, change: Partial<General>) {
  s.generals = s.generals.map((g) => (g.id === id ? { ...g, ...change } : g));
}

export function dismissGeneral(s: GameState, id: number) {
  s.generals = s.generals.filter((g) => g.id !== id);
}

/** The general leading the units of `owner` in `province`, if any (the best one, if several are there). */
export function generalAt(s: GameState, owner: CountryId, province: string): General | null {
  let best: General | null = null;
  for (const g of s.generals) {
    if (g.owner !== owner || g.unit === null) continue;
    const u = s.units[g.unit];
    if (u && u.province === province && (!best || g.skill > best.skill)) best = g;
  }
  return best;
}

/** Combat multiplier a general gives one unit. */
export function generalBonus(g: General | null, _u: Unit, attacking: boolean, armored: boolean): number {
  if (!g) return 1;
  let m = 1 + 0.04 * g.skill;
  if (g.trait === "offensive" && attacking) m += 0.1;
  if (g.trait === "defensive" && !attacking) m += 0.1;
  if (g.trait === "armor" && armored) m += 0.15;
  return m;
}

/** Battle experience, and promotion. Called with the generals who led a battle today. */
export function generalsFought(s: GameState, ids: Set<number>) {
  if (!ids.size) return;
  s.generals = s.generals.map((g) => {
    if (!ids.has(g.id)) return g;
    const xp = g.xp + 1;
    const skill = Math.max(g.skill, SKILL_AT.filter((t) => xp >= t).length);
    if (skill > g.skill) logEvent(s, "military", `${g.name} of ${nameOf(s, g.owner)} was promoted to ${RANKS[skill - 1]}.`, [g.owner]);
    return { ...g, xp, skill };
  });
}

/** Generals whose unit no longer exists lose their command. */
export function releaseOrphanedGenerals(s: GameState) {
  if (s.generals.some((g) => g.unit !== null && !s.units[g.unit])) s.generals = s.generals.map((g) => (g.unit !== null && !s.units[g.unit] ? { ...g, unit: null } : g));
}
