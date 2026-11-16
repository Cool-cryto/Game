import type { CountryId, ProvinceId } from "@gs/shared";
import { RESOURCES } from "@gs/shared";
import { declareWar, isAtWar, transferProvince } from "./diplomacy";
import { distanceKm, type Geography } from "./geography";
import { BLOCS, ELECTION_INTERVAL, holdsElections, startingGovernment, type Bloc } from "./government";
import { startingPersonality } from "./personality";
import { nextRandom } from "./rng";
import { defaultBudget, largestProvince, logEvent, type CountryState, type GameState, type ResourceBalance } from "./state";
import { startingResearch } from "./tech";

/**
 * Political upheaval. A country whose stability stays very low faces crises (checked monthly, after politics):
 *
 * - Coup (stability below 20 for 3+ months, not at war): the army takes over. The government becomes military rule,
 *   the Nationalist bloc rules, elections stop; order returns (+15 stability).
 * - Revolution (an autocracy below 15 for 4+ months): the regime falls and an electoral democracy takes its place, led
 *   by the most popular bloc, with elections in four years (+10 stability).
 * - Breakaway (below 12 for 6+ months, at least 8 provinces, not at war): a region far from the capital declares
 *   independence as a new country, taking the soldiers stationed there, and a civil war begins.
 *
 * Each crisis has a monthly chance, so a struggling country can still recover first. Human players get the same
 * crises (they are warned by the low-stability numbers).
 */
const COUP = { below: 20, months: 3, chance: 0.08 };
const REVOLUTION = { below: 15, months: 4, chance: 0.08 };
const BREAKAWAY = { below: 12, months: 6, chance: 0.06, minProvinces: 8 };

export function upheavalMonthly(s: GameState, geo: Geography) {
  for (const c of Object.values(s.countries)) {
    if (!c.active) continue;
    c.crisisMonths = c.stability < COUP.below ? (c.crisisMonths ?? 0) + 1 : 0;
    if (!c.crisisMonths) continue;
    const war = isAtWar(s, c.id);
    const autocracy = c.government.regime === "closed_autocracy" || c.government.regime === "electoral_autocracy";
    const roll = nextRandom(s.rng);
    if (!war && c.stability < BREAKAWAY.below && c.crisisMonths >= BREAKAWAY.months && roll < BREAKAWAY.chance) {
      if (breakaway(s, geo, c)) continue;
    }
    if (autocracy && c.stability < REVOLUTION.below && c.crisisMonths >= REVOLUTION.months && roll < REVOLUTION.chance) revolution(s, c);
    else if (!war && c.government.regime !== "closed_autocracy" && c.crisisMonths >= COUP.months && roll < COUP.chance) coup(s, c);
  }
}

export function coup(s: GameState, c: CountryState) {
  c.government = { ...c.government, regime: "closed_autocracy", ruling: "nationalist", nextElection: null, source: c.government.source === "custom" ? "custom" : c.government.source };
  c.stability = Math.min(100, c.stability + 15);
  c.crisisMonths = 0;
  logEvent(s, "politics", `A military coup has overthrown the government of ${c.name}.`, [c.id]);
}

export function revolution(s: GameState, c: CountryState) {
  const winner = BLOCS.reduce<Bloc>((best, b) => (c.government.support[b] > c.government.support[best] ? b : best), "centre");
  c.government = { ...c.government, regime: "electoral_democracy", monarchy: false, ruling: winner, nextElection: s.tick + ELECTION_INTERVAL };
  if (!holdsElections(c.government.regime)) c.government.nextElection = null;
  c.stability = Math.min(100, c.stability + 10);
  c.crisisMonths = 0;
  logEvent(s, "politics", `A revolution in ${c.name} has brought down the regime. ${c.name} is now a democracy.`, [c.id]);
}

/** A colour from an id, for countries that appear during a game. */
function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  // HSL(hue, 35%, 45%) to hex: muted, like the rest of the political map.
  const s = 0.35;
  const l = 0.45;
  const k = (n: number) => (n + hue / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
  return `#${[f(0), f(8), f(4)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** A region far from the capital breaks away as a new country, and a civil war starts. Returns false if it can't. */
export function breakaway(s: GameState, geo: Geography, c: CountryState): boolean {
  const owned = Object.values(s.provinces).filter((p) => p.owner === c.id && p.controller === c.id);
  if (owned.length < BREAKAWAY.minProvinces || !c.capital) return false;
  // Start from the populated province farthest from the capital and grow a connected region (about a quarter of the
  // country), never including the capital.
  // (An island or exclave can't grow a region, so try the next farthest provinces.)
  const candidates = owned.filter((p) => p.population > 0 && p.id !== c.capital).sort((a, b) => distanceKm(geo, b.id, c.capital!) - distanceKm(geo, a.id, c.capital!));
  const want = Math.max(2, Math.round(owned.length * 0.25));
  let region = new Set<ProvinceId>();
  for (const start of candidates.slice(0, 10)) {
    region = new Set<ProvinceId>([start.id]);
    const queue: ProvinceId[] = [start.id];
    while (queue.length && region.size < want) {
      const id = queue.shift()!;
      for (const n of geo.provinces[id]?.neighbors ?? []) {
        const p = s.provinces[n];
        if (!p || p.owner !== c.id || p.controller !== c.id || n === c.capital || region.has(n)) continue;
        region.add(n);
        queue.push(n);
        if (region.size >= want) break;
      }
    }
    if (region.size >= Math.ceil(want / 2)) break;
  }
  if (region.size < 2) return false;
  const id = `R-${s.nextId++}` as CountryId;
  const base = c.name.replace(/^Free /, "");
  const taken = new Set(Object.values(s.countries).map((x) => x.name));
  let name = `Free ${base}`;
  for (let i = 2; taken.has(name); i++) name = `Free ${base} (${i})`;
  const emptyResources = () => Object.fromEntries(RESOURCES.map((r) => [r, { production: 0, need: 0, imports: 0, exports: 0 }])) as Record<(typeof RESOURCES)[number], ResourceBalance>;
  const rebel: CountryState = {
    id,
    name,
    color: colorFor(id),
    controller: "ai",
    active: true,
    population: 0,
    gdp: 0,
    treasury: 0,
    taxRate: c.taxRate,
    budget: defaultBudget(c.taxRate),
    stability: 45,
    techLevel: c.techLevel,
    research: startingResearch(Math.round(c.techLevel)),
    construction: [],
    researchProgress: 0,
    gdpGrowth: 0,
    popGrowth: 0,
    resources: emptyResources(),
    defenseFund: 0,
    capital: null,
    government: { ...startingGovernment(id, { regime: "electoral_democracy", monarchy: false }, true), ruling: "nationalist" },
    history: { gdp: [], population: [] },
  };
  rebel.personality = startingPersonality(rebel, s.rng.seed);
  s.countries[id] = rebel;
  for (const pid of region) transferProvince(s, pid, id);
  rebel.capital = largestProvince(s, id);
  rebel.defenseFund = (rebel.gdp * rebel.budget.defense) / 4;
  // Soldiers stationed in the region go over to the rebels; a militia forms where there were none.
  let defected = 0;
  for (const u of Object.values(s.units)) {
    if (u.owner === c.id && u.type === "army" && region.has(u.province)) {
      u.owner = id;
      u.path = [];
      u.travel = null;
      defected++;
    }
  }
  for (let i = defected; i < Math.min(4, Math.ceil(region.size / 3)); i++) {
    const u = { id: s.nextId++, owner: id, type: "army" as const, kind: "infantry" as const, province: rebel.capital!, strength: 70, path: [], travel: null, retreating: false };
    s.units[u.id] = u;
  }
  s.generals = s.generals.map((g) => (g.unit !== null && s.units[g.unit]?.owner === id ? { ...g, unit: null } : g));
  c.stability = Math.min(100, c.stability + 10);
  c.crisisMonths = 0;
  logEvent(s, "war", `${name} has declared independence from ${c.name}, taking ${region.size} provinces. Civil war has begun.`, [id, c.id]);
  const war = declareWar(s, id, c.id);
  war.name = `${c.name} Civil War`;
  return true;
}
