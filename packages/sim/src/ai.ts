import { aiConstruction } from "./construction";
import { aiTreaties, hasTreaty } from "./treaties";
import { interestRate } from "./systems";
import { aiGovernment } from "./government";
import type { CountryId, ProvinceId } from "@gs/shared";
import { nextRandom } from "./rng";
import { findLandPath, type Geography } from "./geography";
import { allied, alliesOf, atWar, declareWar, isAtWar, makePeace, pairKey, relation, sideOf, warScore, wouldAcceptPeace } from "./diplomacy";
import { canEnter, canRecruit, combatPower, recruit, startMove, unitCap } from "./military";
import { DIFFICULTY_RULES, difficultyOf } from "./state";
import { DEFAULT_KIND, kindUnlocked, type UnitKind } from "./units";
import { personalityOf } from "./personality";
import { guaranteesBy, hasGuarantee, hasSanction, sanctionKey } from "./statecraft";
import { adjustRelation } from "./diplomacy";
import type { PeaceTerms } from "./state";
import { generalCap, generalCost, generalsOf, hireGeneral, updateGeneral } from "./generals";
import type { Unit } from "./state";
import { budgetBalance, defaultBudget, logEvent, nameOf, type CountryState, type GameState, type ProvinceState, type UnitType } from "./state";

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

  const armiesOf = new Map<CountryId, Unit[]>();
  for (const u of Object.values(s.units)) if (u.type === "army") armiesOf.set(u.owner, [...(armiesOf.get(u.owner) ?? []), u]);
  const owned = new Map<CountryId, ProvinceState[]>();
  for (const p of Object.values(s.provinces)) {
    if (!owned.has(p.owner)) owned.set(p.owner, []);
    owned.get(p.owner)!.push(p);
  }
  for (const c of ai(s)) {
    economyPolicy(s, c);
    const enemies = new Set(s.wars.flatMap((w) => (sideOf(w, c.id) === "attackers" ? w.defenders : sideOf(w, c.id) === "defenders" ? w.attackers : [])));
    aiConstruction(s, geo, c, enemies, owned.get(c.id) ?? []);
    aiGovernment(s, c, isAtWar(s, c.id));
    // Research: weapons first in wartime, otherwise keep the branches even.
    c.research.focus = isAtWar(s, c.id) && c.research.levels.military < 20 ? "military" : "balanced";
    buildForces(s, geo, c, unitCount.get(c.id) ?? { all: 0, navy: 0, air: 0 }, port.get(c.id) ?? null);
    aiGenerals(s, c, armiesOf.get(c.id) ?? []);
    diplomacy(s, c, neighbors.get(c.id) ?? new Set(), sidePower);
    aiTreaties(s, c, neighbors.get(c.id) ?? new Set(), sidePower);
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
  } else if (c.treasury > 0.25 * c.gdp && budgetBalance(c) > -0.02) {
    // Savings piling up: cut taxes a little and invest more in roads and research.
    if (c.taxRate > 0.1) c.taxRate -= 0.01;
    c.budget.infrastructure = Math.min(0.3, c.budget.infrastructure + 0.003);
    c.budget.research = Math.min(0.3, c.budget.research + 0.002);
  }
  // In debt: make sure the budget also covers the interest, or the debt grows forever.
  if (c.treasury < 0 && c.gdp > 0 && c.taxRate < 0.45 && budgetBalance(c) < (-c.treasury * interestRate(c)) / c.gdp) c.taxRate = Math.min(0.45, c.taxRate + 0.005);
}

function buildForces(s: GameState, geo: Geography, c: CountryState, units: { all: number; navy: number; air: number }, coast: ProvinceId | null) {
  if (!c.capital) return;
  // Peacetime army: the personality's share, nudged by difficulty (Normal = no change).
  const peace = Math.min(1, personalityOf(c).peaceArmy + (difficultyOf(s).aiPeaceArmy - DIFFICULTY_RULES.normal.aiPeaceArmy));
  const target = Math.ceil(unitCap(c) * (isAtWar(s, c.id) ? 1 : peace));
  if (units.all >= target) return;
  const port = geo.provinces[c.capital]?.coastal ? c.capital : coast;
  let type: UnitType = "army";
  if (port && units.navy < units.all * 0.15) type = "navy";
  else if (units.air < units.all * 0.2) type = "air";
  const where = type === "navy" ? port! : c.capital;
  const kind = aiKind(c, type, units.all);
  if (!canRecruit(s, geo, c.id, type, where, kind)) recruit(s, c.id, type, where, kind);
}

/** A sensible mix: mostly infantry with artillery and armour as technology allows; fighters and bombers; a balanced fleet. */
const AI_MIX: Record<UnitType, UnitKind[]> = {
  army: ["infantry", "infantry", "artillery", "tanks", "infantry", "mechanized", "motorized", "antiTank", "infantry", "antiAir", "tanks", "specialForces"],
  air: ["fighter", "fighter", "bomber", "heavyFighter", "fighter", "navalBomber", "bomber", "strategicBomber"],
  navy: ["destroyer", "cruiser", "submarine", "destroyer", "battleship", "carrier", "transportShip"],
};
function aiKind(c: CountryState, type: UnitType, n: number): UnitKind {
  const want = AI_MIX[type][n % AI_MIX[type].length]!;
  return kindUnlocked(c, want) ? want : DEFAULT_KIND[type];
}

/** Hire a general once the army is big enough, and keep every general in charge of a big stack. */
function aiGenerals(s: GameState, c: CountryState, armies: Unit[]) {
  if (armies.length >= 4 && generalsOf(s, c.id).length < generalCap(armies.length) && c.defenseFund > 3 * generalCost(c) && nextRandom(s.rng) < 0.15) {
    c.defenseFund -= generalCost(c);
    hireGeneral(s, c.id);
  }
  const led = new Set(s.generals.filter((g) => g.owner === c.id && g.unit !== null).map((g) => s.units[g.unit!]?.province));
  for (const g of generalsOf(s, c.id)) {
    if (g.unit !== null && s.units[g.unit]) continue;
    // The biggest stack without a general.
    const counts = new Map<ProvinceId, Unit>();
    const size = new Map<ProvinceId, number>();
    for (const u of armies) {
      if (led.has(u.province)) continue;
      size.set(u.province, (size.get(u.province) ?? 0) + 1);
      if (!counts.has(u.province)) counts.set(u.province, u);
    }
    const best = [...size].sort((a, b) => b[1] - a[1])[0];
    if (!best) break;
    updateGeneral(s, g.id, { unit: counts.get(best[0])!.id });
    led.add(best[0] as ProvinceId);
  }
}

/** What a peace offer asks for, in words. */
export const PEACE_DEMANDS: Record<PeaceTerms, string> = {
  white: "with no border changes",
  occupied: "if you give up the provinces they occupy",
  reparations: "if you pay reparations (5% of your GDP)",
  puppet: "if you become their puppet state",
};

/**
 * Sanctions, guarantees and aid. Countries sanction neighbours they detest and lift sanctions once tempers cool;
 * friendly countries guarantee small neighbours; rich friendly ones send aid now and then.
 */
function statecraft(s: GameState, c: CountryState, neighbors: Set<CountryId>, friendliness: number) {
  for (const n of neighbors) {
    const other = s.countries[n];
    if (!other?.active || atWar(s, c.id, n)) continue;
    const rel = relation(s, c.id, n);
    if (rel <= -80 && !hasSanction(s, c.id, n) && !allied(s, c.id, n) && nextRandom(s.rng) < 0.03) {
      s.sanctions = [...(s.sanctions ?? []), sanctionKey(c.id, n)];
      logEvent(s, "diplomacy", `${c.name} imposed sanctions on ${other.name}.`, [c.id, n]);
    } else if (rel > -40 && hasSanction(s, c.id, n)) {
      s.sanctions = s.sanctions.filter((k) => k !== sanctionKey(c.id, n));
      logEvent(s, "diplomacy", `${c.name} lifted its sanctions on ${other.name}.`, [c.id, n]);
    }
    if (rel >= 50 && other.gdp < 0.5 * c.gdp && !hasGuarantee(s, c.id, n) && guaranteesBy(s, c.id).length < 2 && nextRandom(s.rng) < 0.02 * friendliness) {
      s.guarantees = [...(s.guarantees ?? []), sanctionKey(c.id, n)];
      adjustRelation(s, c.id, n, 10);
      logEvent(s, "diplomacy", `${c.name} guaranteed the independence of ${other.name}.`, [c.id, n]);
    }
    if (rel >= 40 && other.gdp < 0.3 * c.gdp && c.treasury > 0.15 * c.gdp && nextRandom(s.rng) < 0.01 * friendliness) {
      const amount = 0.002 * c.gdp;
      c.treasury -= amount;
      other.treasury += amount;
      c.monthAid = (c.monthAid ?? 0) - amount;
      other.monthAid = (other.monthAid ?? 0) + amount;
      adjustRelation(s, c.id, n, Math.min(25, Math.max(3, (amount / Math.max(1, other.gdp)) * 500)));
    }
  }
}

/** Military power of a country and its allies. */
export function powerOf(s: GameState, c: CountryId, withAllies = true): number {
  const members = withAllies ? [c, ...alliesOf(s, c)] : [c];
  return Object.values(s.units)
    .filter((u) => u.type !== "navy" && members.includes(u.owner))
    .reduce((sum, u) => sum + combatPower(s, u), 0);
}

function diplomacy(s: GameState, c: CountryState, neighbors: Set<CountryId>, sidePower: (c: CountryId) => number) {
  const me = personalityOf(c);
  // Rivalries flare between neighbours now and then (more often for aggressive countries).
  if (neighbors.size && nextRandom(s.rng) < me.rivalry) {
    const list = [...neighbors].filter((n) => s.countries[n]?.active && !allied(s, c.id, n));
    const rival = list[Math.floor(nextRandom(s.rng) * list.length)];
    if (rival) adjustRelation(s, c.id, rival, -12);
  }
  statecraft(s, c, neighbors, me.friendliness);
  // Friendly neighbours may sign a defensive alliance.
  for (const n of neighbors) {
    const other = s.countries[n];
    if (!other?.active || allied(s, c.id, n) || atWar(s, c.id, n)) continue;
    if (relation(s, c.id, n) >= 55 && alliesOf(s, c.id).length < 3 && nextRandom(s.rng) < 0.05 * me.friendliness) {
      if (other.controller === "ai") {
        s.alliances.push(pairKey(c.id, n));
        logEvent(s, "alliance", `${nameOf(s, c.id)} and ${nameOf(s, n)} formed an alliance.`, [c.id, n]);
      }
    }
  }
  // War: attack a hostile neighbour that is much weaker (allies included). Personality sets how readily; against a
  // human player the difficulty shifts it further. Puppets follow their overlord and never start wars.
  if (isAtWar(s, c.id) || c.stability < 45 || c.overlord) return;
  const mine = sidePower(c.id);
  for (const n of neighbors) {
    const other = s.countries[n];
    const diff = other?.controller === "human" ? difficultyOf(s) : DIFFICULTY_RULES.normal;
    const hostility = me.hostility + (diff.aiHostility - DIFFICULTY_RULES.normal.aiHostility);
    const ratio = me.warRatio * (diff.aiWarRatio / DIFFICULTY_RULES.normal.aiWarRatio);
    if (!other?.active || other.overlord === c.id || relation(s, c.id, n) > hostility || allied(s, c.id, n) || hasTreaty(s, c.id, n, "nonAggression")) continue;
    if (mine < ratio * sidePower(n) || mine === 0) continue;
    if (nextRandom(s.rng) < 0.015 * me.warChance * diff.aiWarChance * (s.settings?.aiAggression ?? 1)) {
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
    // A crushing win over a smaller country: make it a puppet. Economic countries prefer reparations to land.
    const style = leader.personality;
    const terms: PeaceTerms | null =
      score >= 0.5 && other.gdp < 0.6 * leader.gdp && (style === "aggressive" || style === "balanced")
        ? "puppet"
        : score >= 0.2
          ? style === "economic"
            ? "reparations"
            : "occupied"
          : months >= 18 && Math.abs(score) < 0.15
            ? "white"
            : null;
    if (!terms) continue;
    if (other.controller === "human") {
      // At most one offer every 6 months, so the player isn't pestered.
      const key = `offer#${war.id}`;
      const last = s.diplomacyCooldown[key];
      if (last !== undefined && s.tick - last < 180) continue;
      if (!s.offers.some((o) => o.warId === war.id && o.from === leader.id)) {
        s.diplomacyCooldown[key] = s.tick;
        s.offers.push({ id: s.nextId++, warId: war.id, from: leader.id, to: other.id, terms, expiresTick: s.tick + 60 });
        logEvent(s, "diplomacy", `${leader.name} offers peace ${PEACE_DEMANDS[terms]}.`, [leader.id, other.id]);
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
  // In wartime one army guards the capital (if it falls, the whole country falls): the one already there or
  // on its way, otherwise the next idle army that thinks about what to do.
  const guard = new Map<CountryId, number>();
  if (s.wars.length) {
    for (const u of Object.values(s.units)) {
      const cap = s.countries[u.owner]?.capital;
      if (!cap || u.type !== "army" || u.retreating || guard.has(u.owner)) continue;
      if ((u.province === cap && !u.travel) || u.path[u.path.length - 1] === cap) guard.set(u.owner, u.id);
    }
  }
  for (const u of Object.values(s.units)) {
    const c = s.countries[u.owner];
    if (!c || c.controller !== "ai" || u.type !== "army" || u.travel || u.retreating || u.training) continue;
    if (guard.get(u.owner) === u.id && isAtWar(s, u.owner)) continue;
    if ((s.tick + u.id) % 5 !== 0) continue;
    if (!guard.has(u.owner) && c.capital && isAtWar(s, u.owner)) {
      guard.set(u.owner, u.id);
      if (u.province !== c.capital) {
        const home = findLandPath(geo, u.province, (p) => p === c.capital, (p) => canEnter(s, u.owner, p), 3000);
        if (home?.length) startMove(s, geo, u, home, "land");
      }
      continue;
    }
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
    // The capital is in enemy hands: everyone goes to take it back before the country falls.
    if (c.capitalLost && c.capital) {
      const back = findLandPath(geo, u.province, (p) => p === c.capital, (p) => canEnter(s, u.owner, p), 3000);
      if (back?.length) {
        startMove(s, geo, u, back, "land");
        continue;
      }
    }
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
