import type { CountryId } from "@gs/shared";
import { isAtWar } from "./diplomacy";
import { nextRandom } from "./rng";
import { logEvent, type CountryState, type GameState } from "./state";

/**
 * Government: what kind of state a country is, who governs it, and its laws.
 *
 * - Regime (democracy … closed autocracy) comes from real data: V-Dem's
 *   "Regimes of the World" classification (CC BY-SA 4.0), for the scenario's
 *   year. Monarchy or republic comes from Wikidata (CC0). Places without data
 *   get an estimate, and the game says so.
 * - Parties are four broad blocs (not real parties), with game-generated
 *   popularity that follows how the country is doing.
 * - Democracies elect a government every four years; electoral autocracies hold
 *   elections the ruling bloc always wins; closed autocracies hold none.
 * - Laws (conscription, economic system, press) are choices with trade-offs.
 *   Starting laws are game defaults for each kind of government, not real laws.
 */
export type Regime = "liberal_democracy" | "electoral_democracy" | "electoral_autocracy" | "closed_autocracy";
export const REGIMES: Regime[] = ["liberal_democracy", "electoral_democracy", "electoral_autocracy", "closed_autocracy"];
export type Bloc = "left" | "centre" | "right" | "nationalist";
export const BLOCS: Bloc[] = ["left", "centre", "right", "nationalist"];

export const LAWS = {
  conscription: ["volunteer", "limited", "mass"],
  economy: ["free_market", "mixed", "state_directed"],
  press: ["free", "restricted", "state_controlled"],
} as const;
export type LawId = keyof typeof LAWS;
export const LAW_IDS = Object.keys(LAWS) as LawId[];
export type Laws = { [K in LawId]: (typeof LAWS)[K][number] };

export interface Government {
  regime: Regime;
  monarchy: boolean;
  /** "data": regime from V-Dem; "estimate": no data for this place; "custom": made in the world editor. */
  source: "data" | "estimate" | "custom";
  /** Bloc in government. */
  ruling: Bloc;
  /** Popularity of each bloc, shares adding up to 1 (game-generated). */
  support: Record<Bloc, number>;
  laws: Laws;
  /** Day of the next election (null: no elections under this government). */
  nextElection: number | null;
  /** Result of the most recent election, if any. */
  lastElection: { tick: number; winner: Bloc; share: number } | null;
  /** First day a law may be changed again. */
  lawCooldown: number;
}

/** Days between regular elections (four years). */
export const ELECTION_INTERVAL = 1461;
/** Days after a law change before another one. */
export const LAW_COOLDOWN = 180;
/** A snap election can be called once a year has passed since the last one. */
export const SNAP_ELECTION_MIN_GAP = 365;

export const isDemocracy = (r: Regime) => r === "liberal_democracy" || r === "electoral_democracy";
export const holdsElections = (r: Regime) => r !== "closed_autocracy";

/** A plain-language name for the kind of government. */
export function governmentLabel(g: Pick<Government, "regime" | "monarchy">): string {
  switch (g.regime) {
    case "liberal_democracy":
      return g.monarchy ? "Constitutional monarchy (liberal democracy)" : "Liberal democracy";
    case "electoral_democracy":
      return g.monarchy ? "Constitutional monarchy (democracy)" : "Democracy";
    case "electoral_autocracy":
      return g.monarchy ? "Monarchy with limited elections" : "Authoritarian state with elections";
    case "closed_autocracy":
      return g.monarchy ? "Absolute monarchy" : "One-party or military rule";
  }
}

export const REGIME_LABEL: Record<Regime, string> = {
  liberal_democracy: "Liberal democracy",
  electoral_democracy: "Electoral democracy",
  electoral_autocracy: "Electoral autocracy",
  closed_autocracy: "Closed autocracy",
};
export const REGIME_HELP: Record<Regime, string> = {
  liberal_democracy: "Free and fair elections, plus strong courts, rights and limits on the government.",
  electoral_democracy: "Free and fair elections, but weaker protection of rights and limits on power.",
  electoral_autocracy: "Elections are held, but they aren't free or fair: the ruling side always wins.",
  closed_autocracy: "No meaningful elections for the head of government.",
};
export const BLOC_LABEL: Record<Bloc, string> = { left: "Left", centre: "Centre", right: "Right", nationalist: "Nationalist" };
export const BLOC_HELP: Record<Bloc, string> = {
  left: "Welfare and fairness. In government: welfare does more for stability.",
  centre: "Steady, pragmatic government. In government: slightly faster growth.",
  right: "Low taxes and business. In government: growth bonus while taxes stay moderate.",
  nationalist: "Strength and sovereignty. In government: stronger support during wars.",
};
export const LAW_LABEL: Record<LawId, { label: string; options: Record<string, { label: string; help: string }> }> = {
  conscription: {
    label: "Conscription",
    options: {
      volunteer: { label: "Volunteer army", help: "Normal unit limit. No burden on the economy." },
      limited: { label: "Limited conscription", help: "30% more units allowed. Slightly slower growth; some unrest in peacetime." },
      mass: { label: "Mass mobilisation", help: "70% more units allowed. Clearly slower growth; strong unrest in peacetime." },
    },
  },
  economy: {
    label: "Economic system",
    options: {
      free_market: { label: "Free market", help: "Faster growth, but less security for people: a little less stable." },
      mixed: { label: "Mixed economy", help: "Balanced: no bonus, no penalty." },
      state_directed: { label: "State-directed", help: "More stable and secure, but slower growth." },
    },
  },
  press: {
    label: "Press",
    options: {
      free: { label: "Free press", help: "Faster research. Democracies expect it." },
      restricted: { label: "Restricted press", help: "A little more control (stability), slower research. Democracies resent it." },
      state_controlled: { label: "State-controlled press", help: "More control, clearly slower research. Democracies strongly resent it." },
    },
  },
};

/** Default laws for a kind of government (game defaults, not real-world laws). */
function defaultLaws(regime: Regime): Laws {
  switch (regime) {
    case "liberal_democracy":
      return { conscription: "volunteer", economy: "free_market", press: "free" };
    case "electoral_democracy":
      return { conscription: "volunteer", economy: "mixed", press: "free" };
    case "electoral_autocracy":
      return { conscription: "limited", economy: "mixed", press: "restricted" };
    case "closed_autocracy":
      return { conscription: "limited", economy: "state_directed", press: "state_controlled" };
  }
}

/** A small deterministic number in [0, 1) from a country id, so starting values differ but are the same every game. */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** Starting government of a country. Regime and monarchy come from the scenario when known. */
export function startingGovernment(
  id: CountryId,
  data: { regime?: Regime | null; monarchy?: boolean | null; regimeEstimated?: boolean } | undefined,
  custom = false,
): Government {
  const given = !!data?.regime && REGIMES.includes(data.regime);
  const known = given && !data?.regimeEstimated;
  const regime: Regime = given ? data!.regime! : "electoral_democracy";
  // Game-generated starting popularity: centre and right lead slightly more often.
  const raw: Record<Bloc, number> = {
    left: 0.2 + 0.25 * hash01(id, 1),
    centre: 0.25 + 0.25 * hash01(id, 2),
    right: 0.2 + 0.25 * hash01(id, 3),
    nationalist: 0.08 + 0.15 * hash01(id, 4),
  };
  const support = normalise(raw);
  const ruling = largest(support);
  // Spread elections over four years so they don't all happen at once (game schedule, not real election dates).
  const nextElection = holdsElections(regime) ? 60 + Math.floor(hash01(id, 5) * ELECTION_INTERVAL) : null;
  return {
    regime,
    monarchy: !!data?.monarchy,
    source: custom ? "custom" : known ? "data" : "estimate",
    ruling,
    support,
    laws: defaultLaws(regime),
    nextElection,
    lastElection: null,
    lawCooldown: 0,
  };
}

function normalise(s: Record<Bloc, number>): Record<Bloc, number> {
  const floor = 0.03;
  const out = { ...s };
  for (const b of BLOCS) out[b] = Math.max(floor, out[b]);
  const total = BLOCS.reduce((a, b) => a + out[b], 0);
  for (const b of BLOCS) out[b] = Math.round((out[b] / total) * 10000) / 10000;
  return out;
}
const largest = (s: Record<Bloc, number>): Bloc => BLOCS.reduce((best, b) => (s[b] > s[best] ? b : best), BLOCS[0]!);

// ---------- Effects ----------

const REGIME_EFFECT: Record<Regime, { growth: number; stability: number; research: number }> = {
  liberal_democracy: { growth: 0.003, stability: 4, research: 0.1 },
  electoral_democracy: { growth: 0.001, stability: 2, research: 0.05 },
  electoral_autocracy: { growth: -0.001, stability: 0, research: 0 },
  closed_autocracy: { growth: -0.003, stability: -2, research: -0.05 },
};
const CONSCRIPTION = { volunteer: { cap: 1, growth: 0, unrest: 0 }, limited: { cap: 1.3, growth: -0.002, unrest: 3 }, mass: { cap: 1.7, growth: -0.006, unrest: 8 } } as const;
const ECONOMY = { free_market: { growth: 0.004, stability: -3 }, mixed: { growth: 0, stability: 0 }, state_directed: { growth: -0.004, stability: 3 } } as const;
const PRESS = { free: { research: 0.05, control: 0 }, restricted: { research: -0.05, control: 3 }, state_controlled: { research: -0.12, control: 6 } } as const;

/**
 * What a country's government does to it, broken down for the UI: growth (yearly
 * rate), stability (points towards the target), research (multiplier - 1) and the
 * unit limit multiplier.
 */
export function governmentEffects(c: CountryState, atWar: boolean) {
  const g = c.government;
  const r = REGIME_EFFECT[g.regime];
  const con = CONSCRIPTION[g.laws.conscription];
  const eco = ECONOMY[g.laws.economy];
  const press = PRESS[g.laws.press];
  const democracy = isDemocracy(g.regime);
  // Democracies resent press restrictions instead of gaining control from them.
  const pressStability = democracy ? -press.control * 2 : press.control;
  // In democracies, a government with broad support is more stable.
  const mandate = democracy ? Math.max(-4, Math.min(4, (g.support[g.ruling] - 0.33) * 20)) : 0;
  const blocGrowth = g.ruling === "centre" ? 0.001 : g.ruling === "right" && c.taxRate <= 0.3 ? 0.002 : 0;
  const blocStability = g.ruling === "left" ? Math.min(4, (c.budget.welfare / 0.15) * 2) : g.ruling === "nationalist" && atWar ? 4 : 0;
  return {
    growth: { regime: r.growth, conscription: con.growth, economy: eco.growth, ruling: blocGrowth },
    stability: {
      regime: r.stability,
      conscription: atWar ? 0 : -con.unrest,
      economy: eco.stability,
      press: pressStability,
      mandate,
      ruling: blocStability,
    },
    research: r.research + press.research,
    unitCap: con.cap,
  };
}

const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
export const governmentGrowth = (c: CountryState, atWar: boolean) => sum(governmentEffects(c, atWar).growth);
export const governmentStability = (c: CountryState, atWar: boolean) => sum(governmentEffects(c, atWar).stability);

// ---------- Monthly politics ----------

/** Popularity drifts with how the country is doing; elections happen on schedule. */
export function politicsMonthly(s: GameState) {
  const occupiedOwners = new Set<CountryId>();
  for (const p of Object.values(s.provinces)) if (p.owner !== p.controller) occupiedOwners.add(p.owner);
  for (const c of Object.values(s.countries)) {
    if (!c.active) continue;
    const g = c.government;
    const war = isAtWar(s, c.id);
    const occupied = occupiedOwners.has(c.id);
    const t = { ...g.support };
    // The governing bloc gains when times are good and loses when they're bad.
    t[g.ruling] += (c.gdpGrowth - 0.02) * 0.5 + (c.stability - 55) / 2000;
    t.left += (0.15 - c.budget.welfare) * -0.05 + Math.max(0, -c.gdpGrowth) * 0.3;
    t.right += Math.max(0, c.taxRate - 0.3) * 0.1;
    t.nationalist += (war ? 0.006 : -0.002) + (occupied ? 0.01 : 0) + (c.stability < 35 ? 0.004 : 0);
    t.centre += c.stability > 60 && c.gdpGrowth > 0.01 ? 0.003 : -0.001;
    for (const b of BLOCS) t[b] += (nextRandom(s.rng) - 0.5) * 0.008;
    // Move a quarter of the way each month, so opinion shifts over seasons, not overnight.
    for (const b of BLOCS) t[b] = g.support[b] + (t[b] - g.support[b]) * 0.25;
    g.support = normalise(t);

    if (g.nextElection !== null && s.tick >= g.nextElection) holdElection(s, c);
  }
}

/** Hold an election now. Democracies: the most popular bloc wins (with a little luck). Electoral autocracies: the rulers win. */
export function holdElection(s: GameState, c: CountryState) {
  const g = c.government;
  if (!holdsElections(g.regime)) {
    g.nextElection = null;
    return;
  }
  let winner = g.ruling;
  let share = g.support[g.ruling];
  if (isDemocracy(g.regime)) {
    let best = -1;
    for (const b of BLOCS) {
      const score = g.support[b] + (b === g.ruling ? 0.015 : 0) + (nextRandom(s.rng) - 0.5) * 0.04;
      if (score > best) {
        best = score;
        winner = b;
      }
    }
    share = g.support[winner];
    const changed = winner !== g.ruling;
    g.ruling = winner;
    logEvent(
      s,
      "politics",
      changed
        ? `${c.name} held an election: the ${BLOC_LABEL[winner]} bloc won with ${Math.round(share * 100)}% and forms the new government.`
        : `${c.name} held an election: the ${BLOC_LABEL[winner]} bloc stays in government with ${Math.round(share * 100)}%.`,
      [c.id],
    );
    if (changed && c.controller === "ai") newGovernmentPolicy(c);
  } else {
    // Managed elections: the ruling bloc is declared the winner by a large margin.
    share = Math.max(0.6, Math.min(0.9, 0.7 + (nextRandom(s.rng) - 0.5) * 0.2));
    logEvent(s, "politics", `${c.name} held an election; the ruling ${BLOC_LABEL[winner]} bloc was declared the winner with ${Math.round(share * 100)}%.`, [c.id]);
  }
  g.lastElection = { tick: s.tick, winner, share };
  g.nextElection = s.tick + ELECTION_INTERVAL;
}

/** A newly elected AI government nudges policy its way (within normal limits). */
function newGovernmentPolicy(c: CountryState) {
  const b = c.budget;
  switch (c.government.ruling) {
    case "left":
      b.welfare = Math.min(0.3, b.welfare + 0.01);
      break;
    case "right":
      if (c.taxRate > 0.12) c.taxRate = Math.round((c.taxRate - 0.01) * 100) / 100;
      break;
    case "nationalist":
      b.defense = Math.min(0.3, b.defense + 0.005);
      break;
    case "centre":
      b.infrastructure = Math.min(0.3, b.infrastructure + 0.003);
      break;
  }
}

/** Can this law be changed now? Returns the reason if not. */
export function canChangeLaw(s: GameState, c: CountryState, law: LawId, value: string): string | null {
  if (!LAW_IDS.includes(law)) return "Unknown law.";
  if (!(LAWS[law] as readonly string[]).includes(value)) return "Unknown option.";
  if (c.government.laws[law] === value) return "That's already the law.";
  const wait = c.government.lawCooldown - s.tick;
  if (wait > 0) return `You changed a law recently. Wait ${wait} more days.`;
  if (isDemocracy(c.government.regime) && c.government.support[c.government.ruling] < 0.25)
    return "Your government is too unpopular to pass new laws (needs at least 25% support).";
  return null;
}

export function changeLaw(s: GameState, c: CountryState, law: LawId, value: string) {
  (c.government.laws as Record<LawId, string>)[law] = value;
  c.government.lawCooldown = s.tick + LAW_COOLDOWN;
  c.stability = Math.max(0, c.stability - 3); // change unsettles people for a while
  logEvent(s, "politics", `${c.name} changed its ${LAW_LABEL[law].label.toLowerCase()} law: ${LAW_LABEL[law].options[value]!.label.toLowerCase()}.`, [c.id]);
}

export function canCallElection(s: GameState, c: CountryState): string | null {
  const g = c.government;
  if (!isDemocracy(g.regime)) return "Only democracies can call early elections.";
  const since = g.lastElection ? s.tick - g.lastElection.tick : Infinity;
  if (since < SNAP_ELECTION_MIN_GAP) return `The last election was only ${since} days ago. Wait a year between elections.`;
  if (g.nextElection !== null && g.nextElection - s.tick <= 30) return "An election is already coming up.";
  return null;
}

/** The AI adjusts conscription for war and peace (rarely, respecting the cooldown). */
export function aiGovernment(s: GameState, c: CountryState, atWar: boolean) {
  const want = atWar ? (c.government.regime === "closed_autocracy" ? "mass" : "limited") : c.government.regime === "liberal_democracy" || c.government.regime === "electoral_democracy" ? "volunteer" : "limited";
  if (c.government.laws.conscription !== want && !canChangeLaw(s, c, "conscription", want)) changeLaw(s, c, "conscription", want);
}
