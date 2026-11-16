import type { CountryId } from "@gs/shared";
import { adjustRelation, allied, atWar, defenseOrgOf, pairKey, relation, sendTroopsHome } from "./diplomacy";
import { nextRandom } from "./rng";
import { logEvent, nameOf, type CountryState, type GameState } from "./state";

/**
 * Treaties between two countries, and international organizations.
 *
 * Treaties (one of each kind per pair of countries):
 *   - non-aggression pact: neither side can declare war on the other until one cancels it
 *   - trade agreement: both economies grow a little faster (more for the smaller partner)
 *   - research agreement: both research a little faster
 *   - military access: each side's armies may cross the other's land
 *
 * Organizations have members and one of three kinds:
 *   - economic (e.g. a customs union): every pair of members counts as a trade agreement
 *   - defense (e.g. a military alliance): members defend each other, like an alliance
 *   - political (e.g. a regional union): members get along better
 * Real organizations and their members at the scenario's start come from Wikidata (CC0); players and AI
 * can join, leave and found organizations. The size of every effect is a game rule, not a real-world figure.
 */

export type TreatyType = "nonAggression" | "trade" | "research" | "access";
export const TREATY_TYPES: TreatyType[] = ["nonAggression", "trade", "research", "access"];

export interface Treaty {
  id: number;
  type: TreatyType;
  /** The two countries, sorted. */
  a: CountryId;
  b: CountryId;
  since: number;
}

export type OrgKind = "economic" | "defense" | "political";
export const ORG_KINDS: OrgKind[] = ["economic", "defense", "political"];

export interface Organization {
  /** "data:NATO" for real organizations, "org-<n>" for founded ones. */
  id: string;
  name: string;
  kind: OrgKind;
  members: CountryId[];
  /** Real organization from data, or founded during the game. */
  source: "data" | "game";
  founder?: CountryId;
  /** Tick the organization was founded in this game (0 for those that existed at the start). */
  since: number;
}

/** A treaty or alliance proposed to a human player, waiting for an answer. */
export interface Proposal {
  id: number;
  from: CountryId;
  to: CountryId;
  kind: TreatyType | "alliance";
  expiresTick: number;
}

export const TREATY_INFO: Record<TreatyType, { label: string; short: string; effect: string; minRelation: number; max: number; cancelPenalty: number }> = {
  nonAggression: {
    label: "Non-aggression pact",
    short: "Non-aggression",
    effect: "Neither of you can declare war on the other while it lasts.",
    minRelation: 0,
    max: 20,
    cancelPenalty: 25,
  },
  trade: {
    label: "Trade agreement",
    short: "Trade",
    effect: "Both economies grow a little faster; the smaller partner gains more.",
    minRelation: 20,
    max: 8,
    cancelPenalty: 15,
  },
  research: {
    label: "Research agreement",
    short: "Research",
    effect: "Both of you research 5% faster (up to 3 agreements count).",
    minRelation: 35,
    max: 3,
    cancelPenalty: 15,
  },
  access: {
    label: "Military access",
    short: "Access",
    effect: "Each side's armies may cross the other's land.",
    minRelation: 50,
    max: 20,
    cancelPenalty: 10,
  },
};

export const ORG_INFO: Record<OrgKind, { label: string; effect: string; minRelation: number; leavePenalty: number }> = {
  economic: {
    label: "Economic union",
    effect: "Every member counts as a trade partner of every other member.",
    minRelation: 20,
    leavePenalty: 10,
  },
  defense: {
    label: "Defense alliance",
    effect: "Members defend each other when attacked. One defense alliance at a time.",
    minRelation: 40,
    leavePenalty: 20,
  },
  political: {
    label: "Political union",
    effect: "Members get along better over time.",
    minRelation: 10,
    leavePenalty: 5,
  },
};

/** Growth from one trade partner, before the size factor, and the most trade can add in total (yearly rates). */
export const TRADE_GROWTH_PER_PARTNER = 0.001;
export const TRADE_GROWTH_CAP = 0.005;
export const RESEARCH_PER_AGREEMENT = 0.05;
export const MAX_FOUNDED_ORGS = 40;

// ---------- Lookups ----------

const sorted = (x: CountryId, y: CountryId): [CountryId, CountryId] => (x < y ? [x, y] : [y, x]);

export function treatyBetween(s: GameState, x: CountryId, y: CountryId, type: TreatyType): Treaty | undefined {
  const [a, b] = sorted(x, y);
  return s.treaties.find((t) => t.type === type && t.a === a && t.b === b);
}
/** "type|A|B" for every treaty, cached per treaties array (which is replaced, never edited, on change). */
const treatyIndex = new WeakMap<Treaty[], Set<string>>();
export function hasTreaty(s: GameState, x: CountryId, y: CountryId, type: TreatyType): boolean {
  if (x === y) return false;
  const list = s.treaties ?? [];
  let set = treatyIndex.get(list);
  if (!set) treatyIndex.set(list, (set = new Set(list.map((t) => `${t.type}|${t.a}|${t.b}`))));
  const [a, b] = sorted(x, y);
  return set.has(`${type}|${a}|${b}`);
}
export const treatiesOf = (s: GameState, c: CountryId) => s.treaties.filter((t) => t.a === c || t.b === c);
export const partnerIn = (t: Treaty, c: CountryId) => (t.a === c ? t.b : t.a);
export const countTreaties = (s: GameState, c: CountryId, type: TreatyType) => s.treaties.reduce((n, t) => n + (t.type === type && (t.a === c || t.b === c) ? 1 : 0), 0);

export const orgById = (s: GameState, id: string) => s.organizations.find((o) => o.id === id);
export const orgsOf = (s: GameState, c: CountryId) => s.organizations.filter((o) => o.members.includes(c));
/** Military access: own land, an ally's, or a country you have an access treaty with. */
export const hasAccess = (s: GameState, c: CountryId, owner: CountryId) => hasTreaty(s, c, owner, "access");

/** Countries that count as trade partners: trade agreements plus fellow members of economic unions. */
export function tradePartners(s: GameState, c: CountryId): Set<CountryId> {
  const out = new Set<CountryId>();
  for (const t of s.treaties) if (t.type === "trade" && (t.a === c || t.b === c)) out.add(partnerIn(t, c));
  for (const o of s.organizations) if (o.kind === "economic" && o.members.includes(c)) for (const m of o.members) if (m !== c) out.add(m);
  return out;
}

/**
 * Extra yearly GDP growth from trade. Each partner adds up to 0.1%, scaled by how big its economy is next to
 * yours (a partner as large as you or larger counts fully), up to 0.5% in all. Partners you're at war with
 * don't count.
 */
export function tradeGrowth(s: GameState, c: CountryId, partners = tradePartners(s, c)): number {
  const me = s.countries[c];
  if (!me?.active || me.gdp <= 0) return 0;
  let sum = 0;
  for (const p of partners) {
    const other = s.countries[p];
    if (!other?.active || atWar(s, c, p)) continue;
    sum += TRADE_GROWTH_PER_PARTNER * Math.min(1, Math.sqrt(other.gdp / me.gdp));
  }
  return Math.min(TRADE_GROWTH_CAP, sum);
}

/** Extra research speed from research agreements (5% each, up to three). */
export function treatyResearch(s: GameState, c: CountryId): number {
  return Math.min(TREATY_INFO.research.max, countTreaties(s, c, "research")) * RESEARCH_PER_AGREEMENT;
}

/** Trade growth and research bonus for every country at once (used by the monthly economy). */
export function treatyEffects(s: GameState): Map<CountryId, { trade: number; research: number }> {
  const partners = new Map<CountryId, Set<CountryId>>();
  const research = new Map<CountryId, number>();
  const add = (x: CountryId, y: CountryId) => {
    let set = partners.get(x);
    if (!set) partners.set(x, (set = new Set()));
    set.add(y);
  };
  for (const t of s.treaties) {
    if (t.type === "trade") {
      add(t.a, t.b);
      add(t.b, t.a);
    } else if (t.type === "research") {
      research.set(t.a, (research.get(t.a) ?? 0) + 1);
      research.set(t.b, (research.get(t.b) ?? 0) + 1);
    }
  }
  for (const o of s.organizations) if (o.kind === "economic") for (const m of o.members) for (const n of o.members) if (m !== n) add(m, n);
  const out = new Map<CountryId, { trade: number; research: number }>();
  for (const c of Object.values(s.countries)) {
    if (!c.active) continue;
    const set = partners.get(c.id);
    out.set(c.id, {
      trade: set ? tradeGrowth(s, c.id, set) : 0,
      research: Math.min(TREATY_INFO.research.max, research.get(c.id) ?? 0) * RESEARCH_PER_AGREEMENT,
    });
  }
  return out;
}

// ---------- Rules ----------

/** Can `from` propose this treaty to `to` at all? (Not whether they'd say yes; see wouldAcceptTreaty.) */
export function canProposeTreaty(s: GameState, from: CountryId, to: CountryId, type: TreatyType): string | null {
  if (!TREATY_TYPES.includes(type)) return "Unknown kind of treaty.";
  const info = TREATY_INFO[type];
  if (hasTreaty(s, from, to, type)) return `You already have a ${info.label.toLowerCase()}.`;
  if (atWar(s, from, to)) return "You're at war. Make peace first.";
  if (s.proposals.some((p) => p.from === from && p.to === to && p.kind === type)) return "You've already proposed this; waiting for their answer.";
  if (countTreaties(s, from, type) >= info.max) return `You already have ${info.max} ${info.label.toLowerCase()}s, the most allowed.`;
  return null;
}

/** Would `to` accept a treaty from `from`? Same rule for the AI and the UI's prediction. Null means yes. */
export function wouldAcceptTreaty(s: GameState, from: CountryId, to: CountryId, type: TreatyType): string | null {
  const info = TREATY_INFO[type];
  if (countTreaties(s, to, type) >= info.max) return `${nameOf(s, to)} already has ${info.max} ${info.label.toLowerCase()}s.`;
  const rel = relation(s, from, to);
  if (type === "access" && allied(s, from, to)) return null;
  if (rel < info.minRelation) return `Relations must be at least ${info.minRelation}.`;
  return null;
}

/** Treaties between two computer-run countries are too common to be news; ones involving a player are. */
const involvesPlayer = (s: GameState, x: CountryId, y: CountryId) => s.countries[x]?.controller === "human" || s.countries[y]?.controller === "human";

export function signTreaty(s: GameState, x: CountryId, y: CountryId, type: TreatyType) {
  const [a, b] = sorted(x, y);
  s.treaties = [...s.treaties, { id: s.nextId++, type, a, b, since: s.tick }];
  s.proposals = s.proposals.filter((p) => !(p.kind === type && ((p.from === x && p.to === y) || (p.from === y && p.to === x))));
  if (involvesPlayer(s, x, y)) logEvent(s, "diplomacy", `${nameOf(s, x)} and ${nameOf(s, y)} signed a ${TREATY_INFO[type].label.toLowerCase()}.`, [x, y]);
}

export function cancelTreaty(s: GameState, by: CountryId, other: CountryId, type: TreatyType, quiet = false) {
  const t = treatyBetween(s, by, other, type);
  if (!t) return;
  s.treaties = s.treaties.filter((x) => x !== t);
  // Without access, armies standing in the other's land go home.
  if (type === "access") sendTroopsHome(s, [by, other]);
  if (quiet) return;
  adjustRelation(s, by, other, -TREATY_INFO[type].cancelPenalty);
  if (involvesPlayer(s, by, other)) logEvent(s, "diplomacy", `${nameOf(s, by)} cancelled its ${TREATY_INFO[type].label.toLowerCase()} with ${nameOf(s, other)}.`, [by, other]);
}

/** The (up to) three largest economies among the members: they decide who may join. */
export function leadingMembers(s: GameState, o: Organization, except?: CountryId): CountryId[] {
  return o.members
    .filter((m) => m !== except && s.countries[m]?.active)
    .sort((a, b) => s.countries[b]!.gdp - s.countries[a]!.gdp)
    .slice(0, 3);
}

/** Average relation between a country and an organization's leading members. */
export function relationWithMembers(s: GameState, c: CountryId, o: Organization): number {
  const leaders = leadingMembers(s, o, c);
  if (!leaders.length) return 100;
  return leaders.reduce((sum, m) => sum + relation(s, c, m), 0) / leaders.length;
}

/** Can `c` join this organization? The members agree if relations with them are good enough on average. */
export function canJoinOrg(s: GameState, c: CountryId, o: Organization | undefined): string | null {
  if (!o) return "That organization doesn't exist any more.";
  if (o.members.includes(c)) return `You're already a member of ${o.name}.`;
  const enemy = o.members.find((m) => atWar(s, c, m));
  if (enemy) return `You're at war with a member (${nameOf(s, enemy)}).`;
  if (o.kind === "defense") {
    const other = defenseOrgOf(s, c);
    if (other) return `Leave ${other.name} first: one defense alliance at a time.`;
  }
  const info = ORG_INFO[o.kind];
  const rel = relationWithMembers(s, c, o);
  if (rel < info.minRelation)
    return `The leading members (${leadingMembers(s, o, c).map((m) => nameOf(s, m)).join(", ")}) won't let you in: relations with them average ${Math.round(rel)}, they need ${info.minRelation}.`;
  return null;
}

export function joinOrg(s: GameState, c: CountryId, o: Organization) {
  replaceOrg(s, o, { ...o, members: [...o.members, c] });
  logEvent(s, "diplomacy", `${nameOf(s, c)} joined ${o.name}.`, [c]);
}

export function leaveOrg(s: GameState, c: CountryId, o: Organization, quiet = false) {
  const members = o.members.filter((m) => m !== c);
  if (!quiet) for (const m of members) adjustRelation(s, c, m, -ORG_INFO[o.kind].leavePenalty);
  // A founded organization nobody belongs to any more is wound up; real ones stay (they can be rejoined).
  if (!members.length && o.source === "game") s.organizations = s.organizations.filter((x) => x !== o);
  else replaceOrg(s, o, { ...o, members });
  if (!quiet) logEvent(s, "diplomacy", `${nameOf(s, c)} left ${o.name}.`, [c]);
}

export function canFoundOrg(s: GameState, c: CountryId, name: string, kind: OrgKind): string | null {
  if (!ORG_KINDS.includes(kind)) return "Unknown kind of organization.";
  const clean = cleanOrgName(name);
  if (clean.length < 3) return "Give it a name (at least 3 letters).";
  if (s.organizations.some((o) => o.name.toLowerCase() === clean.toLowerCase())) return "An organization with that name already exists.";
  if (s.organizations.some((o) => o.source === "game" && o.founder === c)) return "You've already founded an organization.";
  if (s.organizations.filter((o) => o.source === "game").length >= MAX_FOUNDED_ORGS) return "The world has too many organizations already.";
  if (kind === "defense") {
    const other = defenseOrgOf(s, c);
    if (other) return `Leave ${other.name} first: one defense alliance at a time.`;
  }
  return null;
}

export const cleanOrgName = (name: string) => name.replace(/[^\p{L}\p{N} '&().,-]/gu, "").replace(/\s+/g, " ").trim().slice(0, 40);

export function foundOrg(s: GameState, c: CountryId, name: string, kind: OrgKind): Organization {
  const org: Organization = { id: `org-${s.nextId++}`, name: cleanOrgName(name), kind, members: [c], source: "game", founder: c, since: s.tick };
  s.organizations = [...s.organizations, org];
  logEvent(s, "diplomacy", `${nameOf(s, c)} founded ${org.name}, a new ${ORG_INFO[kind].label.toLowerCase()}.`, [c]);
  return org;
}

/** Organizations are replaced, never changed in place, so cached lookups (see defenseOrgOf) stay correct. */
function replaceOrg(s: GameState, old: Organization, next: Organization) {
  s.organizations = s.organizations.map((o) => (o === old ? next : o));
}

/** When a war starts, the two sides' treaties with each other end, and attacking a fellow member means leaving. */
export function breakTreatiesForWar(s: GameState, attacker: CountryId, defenders: CountryId[]) {
  const set = new Set(defenders);
  s.treaties = s.treaties.filter((t) => !((t.a === attacker && set.has(t.b)) || (t.b === attacker && set.has(t.a))));
  s.proposals = s.proposals.filter((p) => !((p.from === attacker && set.has(p.to)) || (p.to === attacker && set.has(p.from))));
}

/** A country that leaves the game leaves its treaties and organizations too. */
export function removeFromTreaties(s: GameState, c: CountryId) {
  s.treaties = s.treaties.filter((t) => t.a !== c && t.b !== c);
  s.proposals = s.proposals.filter((p) => p.from !== c && p.to !== c);
  for (const o of orgsOf(s, c)) leaveOrg(s, c, o, true);
}

/** Pair keys with a treaty, for the monthly relation drift. */
export function treatyPairBaselines(s: GameState): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of s.treaties) {
    const k = pairKey(t.a, t.b);
    out.set(k, Math.min(20, (out.get(k) ?? 0) + (t.type === "trade" ? 10 : t.type === "research" || t.type === "access" ? 5 : 0)));
  }
  return out;
}

/** Daily: proposals nobody answered expire (and ones from or to a country that's gone). */
export function expireProposals(s: GameState) {
  if (!s.proposals.length) return;
  const keep = s.proposals.filter((p) => p.expiresTick > s.tick && s.countries[p.from]?.active && s.countries[p.to]?.active);
  // Replace the list only when something expired: a new list means "changed" to network sync.
  if (keep.length !== s.proposals.length) s.proposals = keep;
}

// ---------- AI ----------

/** How often (per month) an AI country tries each kind of deal with a suitable neighbour. */
const AI_CHANCE = { trade: 0.03, research: 0.015, nonAggression: 0.008, join: 0.01 };

/**
 * Computer-run countries, monthly: sign trade and research agreements with friendly neighbours, seek
 * non-aggression pacts with much stronger ones, end deals with neighbours they've fallen out with, and now
 * and then join an organization most of its neighbours belong to. Offers to human players are rarer and wait for
 * their answer. They never found organizations.
 */
export function aiTreaties(s: GameState, c: CountryState, neighbors: Set<CountryId>, sidePower: (c: CountryId) => number) {
  const mine = sidePower(c.id);
  for (const n of neighbors) {
    const other = s.countries[n];
    if (!other?.active || atWar(s, c.id, n)) continue;
    const rel = relation(s, c.id, n);
    // Fallen out: end the friendly deals.
    if (rel < -20) {
      for (const type of ["trade", "research", "access"] as const) if (hasTreaty(s, c.id, n, type) && nextRandom(s.rng) < 0.2) cancelTreaty(s, c.id, n, type);
      continue;
    }
    const want: TreatyType | null =
      rel >= 30 && nextRandom(s.rng) < AI_CHANCE.trade
        ? "trade"
        : rel >= 45 && nextRandom(s.rng) < AI_CHANCE.research
          ? "research"
          : // A pact with a much stronger neighbour it's wary of (not one it's friends with, nor an open enemy).
            rel > -40 && rel < 20 && sidePower(n) > 2 * mine && countTreaties(s, c.id, "nonAggression") < 2 && nextRandom(s.rng) < AI_CHANCE.nonAggression
            ? "nonAggression"
            : null;
    if (!want || canProposeTreaty(s, c.id, n, want) || wouldAcceptTreaty(s, c.id, n, want)) continue;
    if (other.controller === "human") {
      // Players are asked less often (about one offer per neighbour every few years), and never twice at once.
      if (s.proposals.some((p) => p.from === c.id && p.to === n) || nextRandom(s.rng) >= 0.25) continue;
      s.proposals = [...s.proposals, { id: s.nextId++, from: c.id, to: n, kind: want, expiresTick: s.tick + 60 }];
      logEvent(s, "diplomacy", `${c.name} proposes a ${TREATY_INFO[want].label.toLowerCase()} with you.`, [c.id, n]);
    } else {
      signTreaty(s, c.id, n, want);
    }
  }
  // Organizations: join one most neighbours belong to, if the leading members would have us.
  if (nextRandom(s.rng) >= AI_CHANCE.join) return;
  for (const o of s.organizations) {
    // Only regional ones: at least half of its neighbours already belong.
    if (o.members.includes(c.id) || !neighbors.size || [...neighbors].filter((n) => o.members.includes(n)).length * 2 < neighbors.size) continue;
    // A defense alliance only when a neighbour looks threatening.
    if (o.kind === "defense" && ![...neighbors].some((n) => relation(s, c.id, n) <= -40)) continue;
    // And only when it gets on well with every neighbour that's a member.
    if ([...neighbors].some((n) => o.members.includes(n) && relation(s, c.id, n) < 30)) continue;
    if (canJoinOrg(s, c.id, o)) continue;
    joinOrg(s, c.id, o);
    return;
  }
}
