import { aiGovernment } from "./government";
import type { CountryId, ProvinceId } from "@gs/shared";
import { nextRandom } from "./rng";
import { findLandPath, type Geography } from "./geography";
import { allied, alliesOf, atWar, declareWar, isAtWar, makePeace, pairKey, relation, warScore, wouldAcceptPeace } from "./diplomacy";
import { canEnter, canRecruit, combatPower, recruit, startMove, unitCap } from "./military";
import { budgetBalance, defaultBudget, logEvent, nameOf, type CountryState, type GameState, type UnitType } from "./state";

/**
 * Computer-run countries. Simple, readable rules rather than a clever planner:
 * keep the budget sane, keep an army, make friends with friendly neighbours,
 * occasionally attack a much weaker rival, fight towards the enemy, and make
 * peace once the war is won, lost or stuck.
 */

const ai = (s: GameState) => Object.values(s.countries).filter((c) => c.active && c.controller === "ai");

// ---------- Monthly ----------

export function aiMonthly(s: GameState, geo: Geography, neighbors: Map<CountryId, Set<CountryId>>) {
  // Work these out once, not once per country.
  const unitCount = new Map<CountryId, { all: number; navy: number; air: number }>();
  for (const u of Object.values(s.units)) {
    const n = unitCount.get(u.owner) ?? { all: 0, navy: 0, air: 0 };
    n.all++;
    if (u.type === "navy") n.navy++;
    if (u.type === "air") n.air++;
    unitCount.set(u.owner, n);
  }
  const port = new Map<CountryId, ProvinceId>();
  for (const p of Object.values(s.provinces)) {
    if (p.owner === p.controller && geo.provinces[p.id]?.coastal && !port.has(p.owner)) port.set(p.owner, p.id);
  }
  const power = new Map<CountryId, number>();
  for (const u of Object.values(s.units)) if (u.type !== "navy") power.set(u.owner, (power.get(u.owner) ?? 0) + combatPower(s, u));
  const sidePower = (c: CountryId) => [c, ...alliesOf(s, c)].reduce((sum, x) => sum + (power.get(x) ?? 0), 0);

  for (const c of ai(s)) {
    economyPolicy(s, c);
    aiGovernment(s, c, isAtWar(s, c.id));
    // Research: weapons first in wartime, otherwise keep the branches even.
    c.research.focus = isAtWar(s, c.id) && c.research.levels.military < 20 ? "military" : "balanced";
    buildForces(s, geo, c, unitCount.get(c.id) ?? { all: 0, navy: 0, air: 0 }, port.get(c.id) ?? null);
    diplomacy(s, c, neighbors.get(c.id) ?? new Set(), sidePower);
  }
  for (const war of [...s.wars]) peaceTalks(s, war);
}

function economyPolicy(s: GameState, c: CountryState) {
  const war = isAtWar(s, c.id);
  const base = defaultBudget(c.taxRate);
  // Defense: more in wartime, back to normal in peace.
  const defenseTarget = war ? Math.max(base.defense, 0.06) : base.defense;
  c.budget.defense += Math.sign(defenseTarget - c.budget.defense) * Math.min(0.005, Math.abs(defenseTarget - c.budget.defense));
  // Unrest: spend more on welfare.
  if (c.stability < 40 && c.budget.welfare < 0.3) c.budget.welfare = Math.min(0.3, c.budget.welfare + 0.005);
  // Deep debt or a big deficit: raise taxes a little (up to 45%), or trim welfare.
  const debt = c.treasury < -0.3 * c.gdp;
  if (budgetBalance(c) < -0.01 && (debt || budgetBalance(c) < -0.03)) {
    if (c.taxRate < 0.45) c.taxRate = Math.min(0.45, c.taxRate + 0.01);
    else c.budget.welfare = Math.max(0.02, c.budget.welfare - 0.005);
  } else if (budgetBalance(c) > 0.03 && c.treasury > 0.2 * c.gdp && c.taxRate > 0.1) c.taxRate -= 0.01;
}

function buildForces(s: GameState, geo: Geography, c: CountryState, units: { all: number; navy: number; air: number }, coast: ProvinceId | null) {
  if (!c.capital) return;
  const target = Math.ceil(unitCap(c) * (isAtWar(s, c.id) ? 1 : 0.6));
  if (units.all >= target) return;
  const port = geo.provinces[c.capital]?.coastal ? c.capital : coast;
  let type: UnitType = "army";
  if (port && units.navy < units.all * 0.15) type = "navy";
  else if (units.air < units.all * 0.2) type = "air";
  const where = type === "navy" ? port! : c.capital;
  if (!canRecruit(s, geo, c.id, type, where)) recruit(s, c.id, type, where);
}

/** Military power of a country and its allies. */
export function powerOf(s: GameState, c: CountryId, withAllies = true): number {
  const members = withAllies ? [c, ...alliesOf(s, c)] : [c];
  return Object.values(s.units)
    .filter((u) => u.type !== "navy" && members.includes(u.owner))
    .reduce((sum, u) => sum + combatPower(s, u), 0);
}

function diplomacy(s: GameState, c: CountryState, neighbors: Set<CountryId>, sidePower: (c: CountryId) => number) {
  // Friendly neighbours may sign a defensive alliance.
  for (const n of neighbors) {
    const other = s.countries[n];
    if (!other?.active || allied(s, c.id, n) || atWar(s, c.id, n)) continue;
    if (relation(s, c.id, n) >= 55 && alliesOf(s, c.id).length < 3 && nextRandom(s.rng) < 0.05) {
      if (other.controller === "ai") {
        s.alliances.push(pairKey(c.id, n));
        logEvent(s, "alliance", `${nameOf(s, c.id)} and ${nameOf(s, n)} formed an alliance.`, [c.id, n]);
      }
    }
  }
  // War: rarely, attack a hostile neighbour that is much weaker (allies included).
  if (isAtWar(s, c.id) || c.stability < 45) return;
  const mine = sidePower(c.id);
  for (const n of neighbors) {
    const other = s.countries[n];
    if (!other?.active || relation(s, c.id, n) > -60 || allied(s, c.id, n)) continue;
    if (mine < 2 * sidePower(n) || mine === 0) continue;
    if (nextRandom(s.rng) < 0.015) {
      declareWar(s, c.id, n);
      return;
    }
  }
}

/** War leaders run by the AI decide on peace. Offers to humans wait for an answer. */
function peaceTalks(s: GameState, war: (typeof s.wars)[number]) {
  const months = (s.tick - war.startTick) / 30;
  if (months < 3) return;
  for (const side of ["attackers", "defenders"] as const) {
    const leader = s.countries[war[side][0]!];
    const otherSide = side === "attackers" ? "defenders" : "attackers";
    const other = s.countries[war[otherSide][0]!];
    if (!leader || !other || leader.controller !== "ai" || !s.wars.includes(war)) continue;
    const score = warScore(s, war, side);
    const terms = score >= 0.2 ? "occupied" : months >= 18 && Math.abs(score) < 0.15 ? "white" : null;
    if (!terms) continue;
    if (other.controller === "human") {
      // At most one offer every 6 months, so the player isn't pestered.
      const key = `offer#${war.id}`;
      const last = s.diplomacyCooldown[key];
      if (last !== undefined && s.tick - last < 180) continue;
      if (!s.offers.some((o) => o.warId === war.id && o.from === leader.id)) {
        s.diplomacyCooldown[key] = s.tick;
        s.offers.push({ id: s.nextId++, warId: war.id, from: leader.id, to: other.id, terms, expiresTick: s.tick + 60 });
        logEvent(s, "diplomacy", `${leader.name} offers peace${terms === "occupied" ? " if you give up the provinces they occupy" : " with no border changes"}.`, [leader.id, other.id]);
      }
    } else if (wouldAcceptPeace(s, war, other.id, terms)) {
      makePeace(s, war, terms, side);
    }
  }
}

// ---------- Daily (only countries at war) ----------

/**
 * Idle armies of AI countries at war look for something to do, in order:
 * retake their own occupied land, defend against nearby enemy armies, or
 * march on the nearest enemy-held province. Each unit re-thinks every 5 days.
 */
export function aiDaily(s: GameState, geo: Geography) {
  for (const u of Object.values(s.units)) {
    const c = s.countries[u.owner];
    if (!c || c.controller !== "ai" || u.type !== "army" || u.travel || u.retreating) continue;
    if ((s.tick + u.id) % 5 !== 0) continue;
    if (!isAtWar(s, u.owner)) {
      // At peace: go home if stranded abroad.
      const here = s.provinces[u.province];
      if (here && here.controller !== u.owner && !allied(s, u.owner, here.controller) && c.capital) {
        const path = findLandPath(geo, u.province, (p) => p === c.capital, (p) => canEnter(s, u.owner, p));
        if (path) startMove(s, geo, u, path, "land");
      }
      continue;
    }
    // Badly damaged units rest (they recover at home) instead of attacking.
    if (u.strength < 40) {
      const home = s.provinces[u.province]!;
      if (home.controller !== u.owner && c.capital) {
        const path = findLandPath(geo, u.province, (p) => s.provinces[p]!.controller === u.owner, (p) => canEnter(s, u.owner, p), 3000);
        if (path?.length) startMove(s, geo, u, path, "land");
      }
      continue;
    }
    // Stay put while besieging or fighting here.
    const here = s.provinces[u.province]!;
    if (atWar(s, u.owner, here.controller)) continue;
    if (Object.values(s.units).some((x) => x.province === u.province && x.type === "army" && atWar(s, u.owner, x.owner))) continue;
    const goal = (p: ProvinceId) => {
      const prov = s.provinces[p]!;
      if (!atWar(s, u.owner, prov.controller)) return false;
      // Don't walk into a much stronger enemy stack.
      const enemy = Object.values(s.units)
        .filter((x) => x.province === p && x.type === "army" && atWar(s, u.owner, x.owner))
        .reduce((a, x) => a + combatPower(s, x), 0);
      return enemy < combatPower(s, u) * 1.5;
    };
    const path = findLandPath(geo, u.province, goal, (p) => canEnter(s, u.owner, p), 2500);
    if (path?.length) startMove(s, geo, u, path, "land");
  }
}
