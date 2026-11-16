import type { CountryId, ProvinceId } from "@gs/shared";
import { nextRandom } from "./rng";
import { largestProvince, logEvent, nameOf, type GameState, type PeaceTerms, type War } from "./state";
import { breakTreatiesForWar, hasAccess, removeFromTreaties, treatyPairBaselines, type Organization } from "./treaties";

// ---------- Relations and alliances ----------

export const pairKey = (a: CountryId, b: CountryId) => (a < b ? `${a}|${b}` : `${b}|${a}`);
export const relation = (s: GameState, a: CountryId, b: CountryId) => s.relations[pairKey(a, b)] ?? 0;

export function adjustRelation(s: GameState, a: CountryId, b: CountryId, delta: number) {
  if (a === b) return;
  const k = pairKey(a, b);
  const v = Math.max(-100, Math.min(100, (s.relations[k] ?? 0) + delta));
  if (Math.abs(v) < 0.5) delete s.relations[k];
  else s.relations[k] = Math.round(v * 10) / 10;
}

/** Each country's defense organization (at most one). Cached per organizations array, which is replaced on change. */
const defenseIndex = new WeakMap<Organization[], Map<CountryId, Organization>>();
function defenseMap(s: GameState): Map<CountryId, Organization> {
  const orgs = s.organizations ?? [];
  let map = defenseIndex.get(orgs);
  if (!map) {
    map = new Map();
    for (const o of orgs) if (o.kind === "defense") for (const m of o.members) if (!map.has(m)) map.set(m, o);
    defenseIndex.set(orgs, map);
  }
  return map;
}
export const defenseOrgOf = (s: GameState, c: CountryId): Organization | undefined => defenseMap(s).get(c);
/** Fellow members of a defense organization (e.g. NATO). */
export function sameDefenseOrg(s: GameState, a: CountryId, b: CountryId): boolean {
  const map = defenseMap(s);
  const o = map.get(a);
  return !!o && o === map.get(b);
}

/** Bilateral alliance only (the ones made and broken with proposeAlliance / breakAlliance). */
export const bilateralAlly = (s: GameState, a: CountryId, b: CountryId) => a !== b && s.alliances.includes(pairKey(a, b));
/** Allied: a bilateral alliance, or members of the same defense organization. */
export const allied = (s: GameState, a: CountryId, b: CountryId) => a !== b && (s.alliances.includes(pairKey(a, b)) || sameDefenseOrg(s, a, b));
export const alliesOf = (s: GameState, c: CountryId): CountryId[] => {
  const out = new Set<CountryId>();
  for (const k of s.alliances) {
    const [a, b] = k.split("|") as [CountryId, CountryId];
    if (a === c) out.add(b);
    else if (b === c) out.add(a);
  }
  const org = defenseOrgOf(s, c);
  if (org) for (const m of org.members) if (m !== c) out.add(m);
  return [...out];
};

export function relationLabel(v: number): string {
  if (v >= 60) return "Friendly";
  if (v >= 20) return "Cordial";
  if (v > -20) return "Neutral";
  if (v > -60) return "Unfriendly";
  return "Hostile";
}

// ---------- Wars ----------

export const sideOf = (war: War, c: CountryId): "attackers" | "defenders" | null =>
  war.attackers.includes(c) ? "attackers" : war.defenders.includes(c) ? "defenders" : null;
const otherSide = (side: "attackers" | "defenders") => (side === "attackers" ? "defenders" : "attackers");

/** The war in which a and b are on opposite sides, if any. */
export function warBetween(s: GameState, a: CountryId, b: CountryId): War | undefined {
  return s.wars.find((w) => {
    const sa = sideOf(w, a);
    const sb = sideOf(w, b);
    return sa && sb && sa !== sb;
  });
}
export const atWar = (s: GameState, a: CountryId, b: CountryId) => a !== b && !!warBetween(s, a, b);
export const isAtWar = (s: GameState, c: CountryId) => s.wars.some((w) => sideOf(w, c));
/** Same side in a war, allied, or the same country. */
export const friendly = (s: GameState, a: CountryId, b: CountryId) =>
  a === b || allied(s, a, b) || s.wars.some((w) => sideOf(w, a) && sideOf(w, a) === sideOf(w, b));

export function declareWar(s: GameState, attacker: CountryId, target: CountryId): War {
  // The target's allies defend it, unless they are allied to the attacker too.
  const defenders = [target, ...alliesOf(s, target).filter((a) => a !== attacker && !allied(s, a, attacker) && s.countries[a]?.active)];
  const war: War = {
    id: s.nextId++,
    name: `${nameOf(s, attacker)}–${nameOf(s, target)} War`,
    attackers: [attacker],
    defenders,
    startTick: s.tick,
  };
  s.wars.push(war);
  for (const d of defenders) {
    adjustRelation(s, attacker, d, -60);
    // Declaring war on someone breaks any alliance with them.
    s.alliances = s.alliances.filter((k) => k !== pairKey(attacker, d));
  }
  breakTreatiesForWar(s, attacker, defenders);
  const joined = defenders.slice(1).map((c) => nameOf(s, c));
  logEvent(
    s,
    "war",
    `${nameOf(s, attacker)} declared war on ${nameOf(s, target)}.${joined.length ? ` ${joined.join(", ")} joined to defend ${nameOf(s, target)}.` : ""}`,
    [attacker, ...defenders],
  );
  return war;
}

/**
 * How well a side is doing, from -1 to 1: the share of the enemy's population it
 * occupies, minus the share of its own population the enemy occupies.
 */
export function warScore(s: GameState, war: War, side: "attackers" | "defenders"): number {
  const us = new Set(war[side]);
  const them = new Set(war[otherSide(side)]);
  let gained = 0;
  let lost = 0;
  let theirPop = 0;
  let ourPop = 0;
  for (const p of Object.values(s.provinces)) {
    if (them.has(p.owner)) {
      theirPop += p.population;
      if (us.has(p.controller)) gained += p.population;
    } else if (us.has(p.owner)) {
      ourPop += p.population;
      if (them.has(p.controller)) lost += p.population;
    }
  }
  const score = (theirPop > 0 ? gained / theirPop : 0) - (ourPop > 0 ? lost / ourPop : 0);
  return Math.max(-1, Math.min(1, score));
}

/** Would `receiver` (leading its side) accept these terms? Same rule for AI and the UI's prediction. */
export function wouldAcceptPeace(s: GameState, war: War, receiver: CountryId, terms: PeaceTerms): boolean {
  const side = sideOf(war, receiver);
  if (!side) return false;
  const score = warScore(s, war, side);
  const months = (s.tick - war.startTick) / 30;
  const armies = Object.values(s.units).filter((u) => u.type === "army" && war[side].includes(u.owner)).length;
  if (terms === "occupied") return score <= -0.15 || armies === 0 || (months >= 24 && score <= -0.05);
  return score <= 0.05 || (months >= 18 && score < 0.2);
}

/** End a war. With "occupied" terms, the winners keep the enemy provinces they hold. */
export function makePeace(s: GameState, war: War, terms: PeaceTerms, winner: "attackers" | "defenders") {
  // Name the leaders now: a loser annexed by the transfers below drops out of the war's lists.
  const leader = war[winner][0]!;
  const other = war[otherSide(winner)][0]!;
  const [firstAttacker, firstDefender] = [war.attackers[0]!, war.defenders[0]!];
  const everyone = [...war.attackers, ...war.defenders];
  const winners = new Set(war[winner]);
  const losers = new Set(war[otherSide(winner)]);
  const transferred: CountryId[] = [];
  for (const p of Object.values(s.provinces)) {
    const ownerIn = winners.has(p.owner) || losers.has(p.owner);
    if (!ownerIn || p.controller === p.owner) continue;
    if (terms === "occupied" && losers.has(p.owner) && winners.has(p.controller)) {
      transferred.push(p.controller);
      transferProvince(s, p.id, p.controller);
    } else if ((winners.has(p.controller) || losers.has(p.controller)) && !isOccupiedByOtherWar(s, war, p.id)) {
      p.controller = p.owner;
      p.siege = null;
    }
  }
  for (const p of Object.values(s.provinces)) if (p.siege && (winners.has(p.siege.by) || losers.has(p.siege.by))) p.siege = null;
  s.wars = s.wars.filter((w) => w !== war);
  s.offers = s.offers.filter((o) => o.warId !== war.id);
  for (const a of war.attackers) for (const d of war.defenders) adjustRelation(s, a, d, 30);
  sendTroopsHome(s, [...winners, ...losers]);
  const gained = new Set(transferred);
  logEvent(
    s,
    "peace",
    terms === "white"
      ? `${nameOf(s, firstAttacker)} and ${nameOf(s, firstDefender)} made peace with no border changes.`
      : `${nameOf(s, other)} made peace with ${nameOf(s, leader)}${gained.size ? ` and gave up the provinces occupied by ${[...gained].map((c) => nameOf(s, c)).join(", ")}` : ""}.`,
    everyone,
  );
}

function isOccupiedByOtherWar(s: GameState, war: War, p: ProvinceId): boolean {
  const prov = s.provinces[p]!;
  return s.wars.some((w) => w !== war && atWarIn(w, prov.owner, prov.controller));
}
const atWarIn = (w: War, a: CountryId, b: CountryId) => {
  const sa = sideOf(w, a);
  const sb = sideOf(w, b);
  return !!sa && !!sb && sa !== sb;
};

/** Units standing in territory that is no longer theirs or a friend's go back to their capital. */
export function sendTroopsHome(s: GameState, countries: CountryId[]) {
  const set = new Set(countries);
  for (const u of Object.values(s.units)) {
    if (!set.has(u.owner)) continue;
    const p = s.provinces[u.province];
    if (p && (friendly(s, u.owner, p.controller) || (p.owner === p.controller && hasAccess(s, u.owner, p.owner)))) continue;
    const home = s.countries[u.owner]?.capital;
    if (home) {
      u.province = home;
      u.path = [];
      u.travel = null;
      u.retreating = false;
    } else delete s.units[u.id];
  }
}

/** Hand a province to a new owner. GDP moves with the people, minus some disruption. */
export function transferProvince(s: GameState, id: ProvinceId, newOwner: CountryId) {
  const p = s.provinces[id]!;
  const from = s.countries[p.owner]!;
  const to = s.countries[newOwner]!;
  if (from === to) return;
  const share = from.population > 0 ? p.population / from.population : 0;
  const gdp = from.gdp * share;
  from.gdp -= gdp;
  from.population -= p.population;
  if (to.active) {
    to.gdp += gdp * 0.8;
    to.population += p.population;
  }
  p.owner = newOwner;
  p.controller = newOwner;
  p.siege = null;
  s.ownershipVersion++;
  if (from.capital === id) from.capital = largestProvince(s, from.id);
  if (!from.capital) eliminate(s, from.id);
}

/** A country with no provinces left leaves the game. */
function eliminate(s: GameState, c: CountryId) {
  const country = s.countries[c]!;
  country.active = false;
  country.population = 0;
  country.gdp = 0;
  for (const u of Object.values(s.units)) if (u.owner === c) delete s.units[u.id];
  s.alliances = s.alliances.filter((k) => !k.split("|").includes(c));
  removeFromTreaties(s, c);
  for (const w of s.wars) {
    w.attackers = w.attackers.filter((x) => x !== c);
    w.defenders = w.defenders.filter((x) => x !== c);
  }
  s.wars = s.wars.filter((w) => w.attackers.length && w.defenders.length);
  logEvent(s, "annexation", `${nameOf(s, c)} has been annexed and no longer exists.`, [c]);
}

/** Share (0-1) of a country's population living in provinces it still controls. */
export function heldShare(s: GameState, c: CountryId): number {
  let total = 0;
  let held = 0;
  for (const p of Object.values(s.provinces)) {
    if (p.owner !== c) continue;
    total += p.population;
    if (p.controller === c) held += p.population;
  }
  return total > 0 ? held / total : 1;
}

/** Days an enemy must hold a country's capital before the country falls (about 10 seconds at 21 days a second). */
export const CAPITAL_HOLD_DAYS = 210;

/**
 * A country at war whose capital an enemy holds for CAPITAL_HOLD_DAYS in a row falls: the enemy holding the
 * capital annexes it, except provinces another enemy holds, which go to that enemy. Taking the capital back
 * (or peace) resets the count.
 */
function capitalsFallen(s: GameState) {
  for (const c of Object.values(s.countries)) {
    if (!c.capitalLost) continue;
    const capital = c.active && c.capital ? s.provinces[c.capital] : undefined;
    if (!capital || capital.controller === c.id || !atWar(s, c.id, capital.controller)) delete c.capitalLost;
  }
  for (const war of [...s.wars]) {
    for (const c of [...war.attackers, ...war.defenders]) {
      const country = s.countries[c];
      const capital = country?.active && country.capital ? s.provinces[country.capital] : undefined;
      if (!country || !capital || capital.controller === c || !atWar(s, c, capital.controller)) continue;
      const taker = capital.controller;
      if (country.capitalLost?.by !== taker) {
        country.capitalLost = { by: taker, since: s.tick };
        logEvent(
          s,
          "war",
          `${nameOf(s, taker)} has taken the capital of ${nameOf(s, c)}! If it isn't retaken within ${Math.round(CAPITAL_HOLD_DAYS / 30)} months, ${nameOf(s, c)} falls.`,
          [taker, c],
        );
        continue;
      }
      if (s.tick - country.capitalLost.since < CAPITAL_HOLD_DAYS) continue;
      delete country.capitalLost;
      logEvent(s, "annexation", `${nameOf(s, taker)} held the capital of ${nameOf(s, c)}, and the whole country has fallen.`, [taker, c]);
      // Work out who gets what first: once the country is gone, nobody is at war with it any more.
      const handover = Object.values(s.provinces)
        .filter((p) => p.owner === c)
        .map((p) => [p.id, p.controller !== c && atWar(s, c, p.controller) ? p.controller : taker] as const);
      for (const [id, to] of handover) transferProvince(s, id, to);
      // Provinces the fallen country held in other countries go back to their owners.
      for (const p of Object.values(s.provinces)) {
        if (p.controller === c) {
          p.controller = p.owner;
          p.siege = null;
        }
      }
    }
  }
}

/**
 * A country that controls under 10% of its people surrenders: if it leads its
 * side the whole war ends; otherwise it signs a separate peace and leaves.
 */
export function checkCapitulations(s: GameState) {
  if (!s.wars.length) return;
  capitalsFallen(s);
  if (!s.wars.length) return;
  // One pass over provinces for everyone at war.
  const fighting = new Set(s.wars.flatMap((w) => [...w.attackers, ...w.defenders]));
  const total = new Map<CountryId, number>();
  const held = new Map<CountryId, number>();
  for (const p of Object.values(s.provinces)) {
    if (!fighting.has(p.owner)) continue;
    total.set(p.owner, (total.get(p.owner) ?? 0) + p.population);
    if (p.controller === p.owner) held.set(p.owner, (held.get(p.owner) ?? 0) + p.population);
  }
  const share = (c: CountryId) => ((total.get(c) ?? 0) > 0 ? (held.get(c) ?? 0) / total.get(c)! : 1);
  for (const war of [...s.wars]) {
    for (const side of ["attackers", "defenders"] as const) {
      for (const c of [...war[side]]) {
        if (!s.wars.includes(war) || share(c) >= 0.1) continue;
        const winner = otherSide(side);
        if (war[side][0] === c) {
          logEvent(s, "war", `${nameOf(s, c)} has surrendered.`, [c]);
          makePeace(s, war, "occupied", winner);
        } else {
          for (const p of Object.values(s.provinces)) if (p.owner === c && war[winner].includes(p.controller)) transferProvince(s, p.id, p.controller);
          war[side] = war[side].filter((x) => x !== c);
          for (const p of Object.values(s.provinces)) if (p.controller === c && war[winner].includes(p.owner)) p.controller = p.owner;
          sendTroopsHome(s, [c]);
          logEvent(s, "peace", `${nameOf(s, c)} surrendered and left the ${war.name}.`, [c]);
        }
      }
    }
  }
}

// ---------- Monthly drift ----------

/**
 * Relations drift back towards a baseline (friendlier between allies, worse
 * at war), and neighbours' relations wander a little: rivalries come and go.
 */
export function diplomacyMonthly(s: GameState, neighbors: Map<CountryId, Set<CountryId>>) {
  // Treaties and shared (economic or political) organizations make a friendlier baseline, up to 30.
  // Only pairs that already have a relation value drift, so this never grows the relations table.
  const baselines = treatyPairBaselines(s);
  const orgsOf = new Map<CountryId, Organization[]>();
  for (const o of s.organizations) if (o.kind !== "defense") for (const m of o.members) orgsOf.set(m, [...(orgsOf.get(m) ?? []), o]);
  const sharedOrgs = (a: CountryId, b: CountryId) => Math.min(20, (orgsOf.get(a) ?? []).filter((o) => o.members.includes(b)).length * 10);
  for (const k of Object.keys(s.relations)) {
    const [a, b] = k.split("|") as [CountryId, CountryId];
    const target = allied(s, a, b) ? 40 : atWar(s, a, b) ? -80 : Math.min(30, (baselines.get(k) ?? 0) + sharedOrgs(a, b));
    adjustRelation(s, a, b, (target - s.relations[k]!) * 0.03);
  }
  for (const [a, set] of neighbors) {
    if (!s.countries[a]?.active) continue;
    for (const b of set) if (a < b && s.countries[b]?.active) adjustRelation(s, a, b, (nextRandom(s.rng) - 0.5) * 24);
  }
  s.offers = s.offers.filter((o) => o.expiresTick > s.tick);
}
