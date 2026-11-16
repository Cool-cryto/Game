import { techMods } from "./tech";
import type { CountryId, ProvinceId } from "@gs/shared";
import { nextRandom } from "./rng";
import { distanceKm, findLandPath, type Geography } from "./geography";
import { allied, atWar, friendly } from "./diplomacy";
import { hasAccess } from "./treaties";
import { logEvent, nameOf, type CountryState, type GameState, type Unit, type UnitType } from "./state";

/**
 * Strategic units. Numbers are game rules: an "army" is an abstract corps, not a
 * real-world formation, and starting militaries are estimated from defense budgets.
 */
export const UNIT_STATS: Record<UnitType, { label: string; recruit: number; power: number }> = {
  army: { label: "Army", recruit: 1000, power: 1 },
  navy: { label: "Fleet", recruit: 3000, power: 1 },
  air: { label: "Air wing", recruit: 2000, power: 1 },
};
/** Yearly upkeep as a share of the recruiting cost. */
const UPKEEP_SHARE = 0.3;
const LAND_KM_PER_DAY = 25;
const SEA_KM_PER_DAY = 400;
const AIR_KM_PER_DAY = 800;
/** Air wings support battles within this distance of their base. */
export const AIR_RANGE_KM = 1200;
/** A unit this weak falls back from battle. */
const RETREAT_AT = 15;

/** Units cost more in richer countries (pay, equipment). */
export function costMultiplier(c: CountryState): number {
  const perPerson = c.population > 0 ? (c.gdp * 1e6) / c.population : 0;
  return Math.max(0.15, Math.min(5, Math.pow(perPerson / 10_000, 0.8)));
}
export const recruitCost = (c: CountryState, type: UnitType) => UNIT_STATS[type].recruit * costMultiplier(c);
export const upkeepPerYear = (c: CountryState, type: UnitType) => recruitCost(c, type) * UPKEEP_SHARE;
/** Most units a country's population can field. */
/** How many units a country can support: grows with population; conscription raises it (see government.ts). */
export const unitCap = (c: CountryState) => (c.active ? Math.floor((1 + Math.floor(Math.sqrt(c.population / 1e6))) * conscriptionCap(c)) : 0);
const conscriptionCap = (c: CountryState) => ({ volunteer: 1, limited: 1.3, mass: 1.7 })[c.government?.laws.conscription ?? "volunteer"];
export const unitsOf = (s: GameState, c: CountryId) => Object.values(s.units).filter((u) => u.owner === c);
export function combatPower(s: GameState, u: Unit) {
  const c = s.countries[u.owner];
  const m = techMods(c);
  const typeBonus = u.type === "army" ? m.armyPower : u.type === "navy" ? m.fleetPower : 0;
  return (u.strength / 100) * UNIT_STATS[u.type].power * (1 + 0.08 * (c?.research?.levels.military ?? c?.techLevel ?? 1)) * (1 + typeBonus + m.unitPower);
}

function addUnit(s: GameState, owner: CountryId, type: UnitType, province: ProvinceId, strength: number): Unit {
  const u: Unit = { id: s.nextId++, owner, type, province, strength, path: [], travel: null, retreating: false };
  s.units[u.id] = u;
  return u;
}

/** Estimated starting forces: what the default defense budget can sustain, up to the population cap. */
export function createStartingMilitaries(s: GameState, geo: Geography) {
  for (const c of Object.values(s.countries)) {
    if (!c.active || !c.capital) continue;
    const yearly = c.gdp * c.budget.defense;
    const affordable = Math.floor((yearly * 0.6) / upkeepPerYear(c, "army"));
    const n = Math.min(Math.round(unitCap(c) * 0.6), affordable);
    if (n <= 0) continue;
    const owned = Object.values(s.provinces)
      .filter((p) => p.owner === c.id)
      .sort((a, b) => b.population - a.population);
    const port = owned.find((p) => geo.provinces[p.id]?.coastal);
    const navies = port && n >= 4 ? Math.max(1, Math.floor(n * 0.15)) : 0;
    const air = n >= 3 ? Math.max(1, Math.floor(n * 0.2)) : 0;
    const armies = n - navies - air;
    for (let i = 0; i < armies; i++) addUnit(s, c.id, "army", owned[i % Math.min(owned.length, 4)]!.id, 100);
    for (let i = 0; i < air; i++) addUnit(s, c.id, "air", c.capital, 100);
    for (let i = 0; i < navies; i++) addUnit(s, c.id, "navy", port!.id, 100);
  }
}

// ---------- Recruiting ----------

export function canRecruit(s: GameState, geo: Geography, country: CountryId, type: UnitType, province: ProvinceId): string | null {
  const c = s.countries[country];
  const p = s.provinces[province];
  if (!c?.active) return "That country can't raise forces.";
  if (!p || p.owner !== country || p.controller !== country) return "You can only recruit in provinces you own and hold.";
  if (type === "navy" && !geo.provinces[province]?.coastal) return "Fleets can only be built in coastal provinces.";
  if (unitsOf(s, country).length >= unitCap(c)) return `Your population supports at most ${unitCap(c)} units.`;
  const cost = recruitCost(c, type);
  if (c.defenseFund < cost) return `Not enough defense funds (needs $${Math.round(cost).toLocaleString("en-US")}M).`;
  return null;
}

export function recruit(s: GameState, country: CountryId, type: UnitType, province: ProvinceId): Unit {
  const c = s.countries[country]!;
  c.defenseFund -= recruitCost(c, type);
  // New units start under strength and fill up at home.
  return addUnit(s, country, type, province, 50);
}

// ---------- Movement ----------

/** May units of `country` enter this province? Own, allied and enemy (at war) territory only. */
export function canEnter(s: GameState, country: CountryId, p: ProvinceId): boolean {
  const prov = s.provinces[p];
  if (!prov) return false;
  return (
    friendly(s, country, prov.owner) ||
    friendly(s, country, prov.controller) ||
    atWar(s, country, prov.owner) ||
    atWar(s, country, prov.controller) ||
    // Military access: the land's owner lets you through while it holds the province.
    (prov.owner === prov.controller && hasAccess(s, country, prov.owner))
  );
}

export type Plan = { path: ProvinceId[]; mode: "land" | "sea" | "air" } | { error: string };

/** Work out how a unit would get to a province. */
export function planMove(s: GameState, geo: Geography, u: Unit, to: ProvinceId): Plan {
  if (u.province === to) return { error: "Already there." };
  const target = s.provinces[to];
  if (!target) return { error: "Unknown province." };
  if (u.type === "air") {
    if (!friendly(s, u.owner, target.controller)) return { error: "Air wings can only be based in provinces you or your allies hold." };
    return { path: [to], mode: "air" };
  }
  if (u.type === "navy") {
    if (!geo.provinces[to]?.coastal) return { error: "Fleets can only sail to coastal provinces." };
    if (!canEnter(s, u.owner, to)) return { error: "You have no access there (not yours, an ally's, an enemy's at war, or a country that gave you military access)." };
    return { path: [to], mode: "sea" };
  }
  if (!canEnter(s, u.owner, to)) return { error: "You have no access there (not yours, an ally's, an enemy's at war, or a country that gave you military access)." };
  const land = findLandPath(geo, u.province, (p) => p === to, (p) => canEnter(s, u.owner, p));
  if (land) return { path: land, mode: "land" };
  // No land route: ship the army over if both ends are on the coast and we have a fleet.
  const hasFleet = Object.values(s.units).some((x) => x.owner === u.owner && x.type === "navy");
  if (geo.provinces[u.province]?.coastal && geo.provinces[to]?.coastal) {
    if (hasFleet) return { path: [to], mode: "sea" };
    return { error: "No land route. Shipping an army overseas needs at least one fleet." };
  }
  return { error: "No route: there's no land path, and both ends must be coastal to go by sea." };
}

function legDays(s: GameState, geo: Geography, u: Unit, mode: "land" | "sea" | "air", next: ProvinceId): number {
  const km = distanceKm(geo, u.province, next);
  if (mode === "air") return Math.max(1, Math.ceil(km / AIR_KM_PER_DAY));
  const m = techMods(s.countries[u.owner]);
  const port = s.provinces[u.province]?.buildings?.port ?? 0;
  if (mode === "sea") return Math.max(2, Math.ceil(km / (SEA_KM_PER_DAY * (1 + m.seaSpeed + 0.15 * port))));
  const to = s.provinces[next];
  const infra = to?.infrastructure ?? 0;
  const home = to?.controller === u.owner ? m.ownLandSpeed : 0;
  // A railway speeds up armies of the side holding the province.
  const rail = to?.buildings?.railway && friendly(s, u.owner, to.controller) ? 0.4 : 0;
  return Math.max(1, Math.ceil(km / (LAND_KM_PER_DAY * (1 + infra / 10) * (1 + m.landSpeed + home + rail))));
}

export function startMove(s: GameState, geo: Geography, u: Unit, path: ProvinceId[], mode: "land" | "sea" | "air") {
  u.path = path;
  u.travel = path.length ? { mode, daysLeft: legDays(s, geo, u, mode, path[0]!) } : null;
}

/** Days until a unit reaches the end of its path (estimate, for the UI). */
export function etaDays(s: GameState, geo: Geography, u: Unit): number {
  if (!u.travel) return 0;
  let days = u.travel.daysLeft;
  let from = u.path[0]!;
  for (const next of u.path.slice(1)) {
    days += legDays(s, geo, { ...u, province: from }, u.travel.mode, next);
    from = next;
  }
  return days;
}

const hostileArmiesIn = (s: GameState, p: ProvinceId, owner: CountryId, type: UnitType) =>
  Object.values(s.units).some((x) => x.province === p && x.type === type && !x.retreating && atWar(s, owner, x.owner));

export function advanceMovement(s: GameState, geo: Geography) {
  for (const u of Object.values(s.units)) {
    if (!u.travel || !u.path.length) continue;
    u.travel.daysLeft -= 1;
    if (u.travel.daysLeft > 0) continue;
    const next = u.path[0]!;
    // The way may have closed (e.g. peace was signed); stop where we are.
    if (u.type !== "air" && !canEnter(s, u.owner, next)) {
      u.path = [];
      u.travel = null;
      continue;
    }
    u.province = next;
    u.path.shift();
    // Walking into enemy forces stops the march: there's a battle here.
    if (!u.retreating && u.type !== "air" && hostileArmiesIn(s, next, u.owner, u.type)) u.path = [];
    if (u.path.length) u.travel = { mode: u.travel.mode, daysLeft: legDays(s, geo, u, u.travel.mode, u.path[0]!) };
    else {
      u.travel = null;
      u.retreating = false;
    }
  }
}

// ---------- Battles ----------

/**
 * Hostile armies (or fleets) in the same province fight every day. Each side
 * loses strength in proportion to the other side's power. Defenders on their
 * own ground get +20%; air wings in range add +15% each (up to +45%).
 */
export function resolveBattles(s: GameState, geo: Geography) {
  if (!s.wars.length) return;
  const byPlace = new Map<string, Unit[]>();
  for (const u of Object.values(s.units)) {
    if (u.type === "air" || u.retreating || u.travel) continue;
    const k = `${u.province}#${u.type}`;
    if (!byPlace.has(k)) byPlace.set(k, []);
    byPlace.get(k)!.push(u);
  }
  for (const [key, units] of byPlace) {
    if (units.length < 2) continue;
    const province = key.split("#")[0] as ProvinceId;
    const first = units[0]!.owner;
    const enemy = units.find((u) => atWar(s, first, u.owner));
    if (!enemy) continue;
    const sideA = units.filter((u) => friendly(s, u.owner, first));
    const sideB = units.filter((u) => atWar(s, u.owner, first));
    if (!sideA.length || !sideB.length) continue;
    const powerOf = (side: Unit[]) => {
      let p = side.reduce((sum, u) => sum + combatPower(s, u), 0);
      const holder = s.provinces[province]!.controller;
      // Defending your own ground: +20%, and +15% per fortification level.
      if (side.some((u) => friendly(s, u.owner, holder))) p *= 1.2 + 0.15 * (s.provinces[province]!.buildings?.fort ?? 0);
      const air = Object.values(s.units).filter(
        (a) => a.type === "air" && !a.travel && friendly(s, a.owner, side[0]!.owner) && distanceKm(geo, a.province, province) <= AIR_RANGE_KM,
      ).length;
      return p * (1 + Math.min(3, air) * 0.15 * (1 + techMods(s.countries[side[0]!.owner]).airSupport));
    };
    const pa = powerOf(sideA);
    const pb = powerOf(sideB);
    const hit = (side: Unit[], ratio: number) => {
      for (const u of side) u.strength = Math.max(0, u.strength - 6 * ratio * (0.8 + 0.4 * nextRandom(s.rng)));
    };
    hit(sideA, pb / (pa + pb));
    hit(sideB, pa / (pa + pb));
    for (const [side, other] of [
      [sideA, sideB],
      [sideB, sideA],
    ] as const) {
      if (side.every((u) => u.strength < RETREAT_AT)) {
        const loser = side[0]!.owner;
        const winner = other[0]!.owner;
        logEvent(s, "battle", `${nameOf(s, winner)} won a battle against ${nameOf(s, loser)}.`, [winner, loser]);
        for (const u of side) retreat(s, geo, u);
      }
    }
  }
}

/** Fall back to the nearest province held by our side; with nowhere to go, the unit is destroyed. */
function retreat(s: GameState, geo: Geography, u: Unit) {
  const path = findLandPath(
    geo,
    u.province,
    (p) => friendly(s, u.owner, s.provinces[p]!.controller) && !hostileArmiesIn(s, p, u.owner, u.type),
    (p) => canEnter(s, u.owner, p),
    3000,
  );
  if (!path) {
    logEvent(s, "military", `A ${UNIT_STATS[u.type].label.toLowerCase()} of ${nameOf(s, u.owner)} was destroyed.`, [u.owner]);
    delete s.units[u.id];
    return;
  }
  u.retreating = true;
  startMove(s, geo, u, path, u.type === "navy" ? "sea" : "land");
  if (!path.length) u.retreating = false;
}

// ---------- Sieges and occupation ----------

/** Days of siege needed for a province: longer where infrastructure (and so fortification) is higher. */
export const siegeDays = (infrastructure: number, fort = 0) => (10 + 3 * infrastructure) * (1 + 0.4 * fort);

/**
 * Armies standing unopposed in a province held by an enemy take it over time.
 * Taking back your own (or an ally's) province returns it to its owner.
 */
export function advanceSieges(s: GameState) {
  // Sieges only happen in wartime (peace clears them).
  if (!s.wars.length) return;
  const armiesAt = new Map<ProvinceId, Unit[]>();
  for (const u of Object.values(s.units)) {
    if (u.type !== "army" || u.travel || u.retreating) continue;
    if (!armiesAt.has(u.province)) armiesAt.set(u.province, []);
    armiesAt.get(u.province)!.push(u);
  }
  // (If besiegers leave and come back during the same war, the siege resumes; peace clears it.)
  for (const [id, armies] of armiesAt) {
    const p = s.provinces[id]!;
    const besieger = armies.find((u) => atWar(s, u.owner, p.controller));
    if (!besieger) {
      if (p.siege) p.siege = null;
      continue;
    }
    // Defenders still in the province must be beaten first.
    if (armies.some((u) => friendly(s, u.owner, p.controller))) continue;
    if (!p.siege || p.siege.by !== besieger.owner) p.siege = { by: besieger.owner, progress: 0 };
    const force = Math.min(3, armies.filter((u) => friendly(s, u.owner, besieger.owner)).reduce((a, u) => a + u.strength / 100, 0));
    p.siege.progress += force / siegeDays(p.infrastructure, p.buildings?.fort ?? 0);
    if (p.siege.progress >= 1) {
      const liberated = friendly(s, besieger.owner, p.owner);
      p.controller = liberated ? p.owner : besieger.owner;
      p.siege = null;
      if (p.population > 0) {
        logEvent(
          s,
          "occupation",
          liberated ? `${nameOf(s, besieger.owner)} liberated a province of ${nameOf(s, p.owner)}.` : `${nameOf(s, besieger.owner)} occupied a province of ${nameOf(s, p.owner)}.`,
          [besieger.owner, p.owner],
        );
      }
    }
  }
}

// ---------- Monthly upkeep ----------

/**
 * Upkeep comes out of the defense fund. Units at home and fully paid regain
 * strength; if the fund runs dry, every unit weakens.
 */
export function militaryMonthly(s: GameState) {
  const upkeep = new Map<CountryId, number>();
  for (const u of Object.values(s.units)) {
    const c = s.countries[u.owner];
    if (!c) continue;
    upkeep.set(u.owner, (upkeep.get(u.owner) ?? 0) + upkeepPerYear(c, u.type) / 12);
  }
  for (const [id, cost] of upkeep) s.countries[id]!.defenseFund -= cost;
  // A country that lost territory can't support as many units: the weakest stand down.
  const byOwner = new Map<CountryId, Unit[]>();
  for (const u of Object.values(s.units)) {
    if (!byOwner.has(u.owner)) byOwner.set(u.owner, []);
    byOwner.get(u.owner)!.push(u);
  }
  for (const [owner, units] of byOwner) {
    const excess = units.length - unitCap(s.countries[owner]!);
    if (excess <= 0) continue;
    units.sort((a, b) => a.strength - b.strength);
    for (const u of units.slice(0, excess)) delete s.units[u.id];
    logEvent(s, "military", `${nameOf(s, owner)} demobilized ${excess} unit${excess > 1 ? "s" : ""} it can no longer support.`, [owner]);
  }
  for (const u of Object.values(s.units)) {
    const c = s.countries[u.owner]!;
    if (c.defenseFund < 0) {
      u.strength = Math.max(5, u.strength - 10);
      continue;
    }
    const p = s.provinces[u.province];
    const home = p && (p.controller === u.owner || allied(s, u.owner, p.controller));
    // Fleets recover faster in a port (+50% per level).
    const port = u.type === "navy" ? 0.5 * (p?.buildings?.port ?? 0) : 0;
    if (home && !u.travel && u.strength < 100) u.strength = Math.min(100, u.strength + 10 * (1 + techMods(c).recovery + port));
  }
}
