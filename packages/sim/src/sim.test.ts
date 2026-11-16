import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CountryId, ProvinceId, Scenario } from "@gs/shared";
import {
  allied,
  atWar,
  createGameState,
  currentDate,
  deserialize,
  etaDays,
  geographyFrom,
  nextRandom,
  provincesByOwner,
  serialize,
  tick,
  unitCap,
  DIFFICULTY_RULES,
  unitsOf,
  validateCommand,
  warScore,
  applyPatch,
  applyCustomWorld,
  validateCustomWorld,
  type CustomWorld,
  round5,
  StateDiffer,
  fogView,
  playerView,
  ViewSync,
  visibleProvinces,
  startingGovernment,
  SAVE_VERSION,
  applyCommand,
  startMove,
  BUILDINGS,
  buildCost,
  siegeDays,
  rawProduction,
  growthBreakdown,
  techMods,
  TECHS,
  combatPower,
  researchTarget,
  governmentEffects,
  ELECTION_INTERVAL,
  LAW_COOLDOWN,
  hasTreaty,
  tradeGrowth,
  treatyEffects,
  orgsOf,
  canEnter,
  wouldAcceptTreaty,
  type Command,
  type GameState,
  type GeographyData,
  type Organization,
} from "./index";

// ---------- A tiny test world ----------
//
//   A: P-1 — P-2 — P-3 ═ B: P-4 — P-5        C: island P-6 (coastal)       D: P-7 (far away)
//   coastal: P-1, P-5, P-6, P-7
const A = "AAA" as CountryId;
const B = "BBB" as CountryId;
const C = "CCC" as CountryId;
const D = "DDD" as CountryId;
const P = (n: number) => `P-${n}` as ProvinceId;
const dep = (food: number, energy: number, minerals: number) => ({ food, energy, minerals });

const geo = geographyFrom({
  "P-1": [0, 50, 1, ["P-2"]],
  "P-2": [2, 50, 0, ["P-1", "P-3"]],
  "P-3": [4, 50, 0, ["P-2", "P-4"]],
  "P-4": [6, 50, 0, ["P-3", "P-5"]],
  "P-5": [8, 50, 1, ["P-4"]],
  "P-6": [10, 45, 1, []],
  "P-7": [100, 10, 1, []],
} as GeographyData);

const small: Scenario = {
  id: "test",
  name: "Test",
  startDate: "2026-12-30",
  dataNote: "",
  provinces: {
    "P-1": { owner: A, population: 30e6, areaKm2: 50_000, deposits: dep(3, 2, 1) },
    "P-2": { owner: A, population: 20e6, areaKm2: 80_000, deposits: dep(4, 0, 3) },
    "P-3": { owner: A, population: 10e6, areaKm2: 60_000, deposits: dep(3, 1, 1) },
    "P-4": { owner: B, population: 6e6, areaKm2: 120_000, deposits: dep(2, 3, 2) },
    "P-5": { owner: B, population: 4e6, areaKm2: 90_000, deposits: dep(2, 1, 0) },
    "P-6": { owner: C, population: 3e6, areaKm2: 20_000, deposits: dep(3, 0, 0) },
    "P-7": { owner: D, population: 5e6, areaKm2: 20_000, deposits: dep(3, 0, 0) },
  } as Scenario["provinces"],
  countries: {
    AAA: { name: "Avaria", population: 60e6, gdpMillionUsd: 2_400_000, incomeGroup: "High income: OECD" },
    BBB: { name: "Borduria", population: 10e6, gdpMillionUsd: 60_000, incomeGroup: "Lower middle income" },
    CCC: { name: "Carpania", population: 3e6, gdpMillionUsd: 30_000, incomeGroup: "Upper middle income" },
    DDD: { name: "Dorsia", population: 5e6, gdpMillionUsd: 40_000, incomeGroup: "Upper middle income" },
  } as Scenario["countries"],
};

const newGame = (seed = 1) => createGameState(small, geo, seed);
function run(s: GameState, days: number, first: Command[] = []) {
  for (let i = 0; i < days; i++) tick(s, geo, i === 0 ? first : []);
}
/** Days until `done` is true (or the limit). */
function runUntil(s: GameState, done: () => boolean, limit = 1000) {
  for (let i = 0; i < limit && !done(); i++) tick(s, geo);
  return done();
}
const armies = (s: GameState, c: CountryId) => unitsOf(s, c).filter((u) => u.type === "army");
/** Hand the human player to A and stop B/C/D's AI from interfering with a scripted test. */
function scripted(s: GameState) {
  tick(s, geo, [{ type: "claimCountry", country: A }]);
  for (const c of [B, C, D]) s.countries[c]!.stability = 0; // unstable countries never start wars
}

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = { seed: 42 };
    const b = { seed: 42 };
    expect(Array.from({ length: 5 }, () => nextRandom(a))).toEqual(Array.from({ length: 5 }, () => nextRandom(b)));
  });
});

describe("game setup", () => {
  it("creates countries, provinces and capitals from a scenario", () => {
    const s = newGame();
    expect(s.provinces[P(4)]?.owner).toBe(B);
    expect(s.provinces[P(4)]?.controller).toBe(B);
    expect(s.countries[A]?.population).toBe(60e6);
    expect(s.countries[A]?.capital).toBe(P(1));
    expect(provincesByOwner(s).get(A)).toEqual([P(1), P(2), P(3)]);
    expect(s.countries[A]!.techLevel).toBeGreaterThan(s.countries[B]!.techLevel);
  });

  it("gives countries a starting military within their population cap", () => {
    const s = newGame();
    const a = unitsOf(s, A);
    expect(a.length).toBeGreaterThan(0);
    expect(a.length).toBeLessThanOrEqual(unitCap(s.countries[A]!));
    expect(a.some((u) => u.type === "navy")).toBe(true); // A has a coast
  });

  it("has resource production and needs from day one", () => {
    const c = newGame().countries[A]!;
    expect(c.resources.food.production).toBeGreaterThan(0);
    expect(c.resources.food.need).toBeGreaterThan(0);
  });

  it("starts with a budget that keeps a small reserve (5% of taxes)", () => {
    const c = newGame().countries[A]!;
    expect(0.04 + Object.values(c.budget).reduce((a, b) => a + b, 0)).toBeCloseTo(c.taxRate * 0.95, 3);
  });
});

describe("clock and economy", () => {
  it("advances one day per tick and runs the economy on the 1st", () => {
    const s = newGame();
    const gdp = s.countries[A]!.gdp;
    run(s, 1);
    expect(s.countries[A]!.gdp).toBe(gdp);
    run(s, 1);
    expect(currentDate(s)).toBe("2027-01-01");
    expect(s.countries[A]!.history.gdp).toHaveLength(1);
  });

  it("raising taxes fills the treasury; a deficit creates debt that hurts stability", () => {
    const rich = newGame();
    const poor = newGame();
    const same = newGame();
    run(rich, 365, [{ type: "setTaxRate", country: A, value: 0.45 }]);
    run(poor, 365 * 5, [{ type: "setTaxRate", country: A, value: 0.1 }]);
    run(same, 365 * 5);
    expect(rich.countries[A]!.treasury).toBeGreaterThan(0);
    expect(poor.countries[A]!.treasury).toBeLessThan(0);
    expect(poor.countries[A]!.stability).toBeLessThan(same.countries[A]!.stability);
  });

  it("research raises technology; infrastructure spending builds infrastructure", () => {
    const s = newGame();
    const t = newGame();
    const infra = s.provinces[P(1)]!.infrastructure;
    run(s, 365 * 5, [
      { type: "claimCountry", country: A },
      { type: "setBudget", country: A, category: "research", value: 0.12 },
      { type: "setBudget", country: A, category: "infrastructure", value: 0.1 },
    ]);
    run(t, 365 * 5, [
      { type: "claimCountry", country: A },
      { type: "setBudget", country: A, category: "research", value: 0 },
      { type: "setBudget", country: A, category: "infrastructure", value: 0 },
    ]);
    expect(s.countries[A]!.techLevel).toBeGreaterThan(t.countries[A]!.techLevel);
    expect(s.provinces[P(1)]!.infrastructure).toBeGreaterThan(infra);
    expect(t.provinces[P(1)]!.infrastructure).toBeLessThan(infra);
  });
});

describe("commands", () => {
  it("are validated, and errors don't change the game", () => {
    const s = newGame();
    expect(validateCommand(s, geo, { type: "setTaxRate", country: A, value: 0.9 })).toMatch(/out of range/);
    expect(validateCommand(s, geo, { type: "declareWar", country: A, target: A })).toMatch(/your own/);
    const errors = tick(s, geo, [{ type: "setTaxRate", country: A, value: 5 }]);
    expect(errors).toHaveLength(1);
    expect(s.countries[A]!.taxRate).toBeLessThan(1);
  });

  it("allow one human per country; releasing hands it back to the AI", () => {
    const s = newGame();
    run(s, 1, [{ type: "claimCountry", country: A }]);
    expect(validateCommand(s, geo, { type: "claimCountry", country: A })).toMatch(/already played/);
    run(s, 1, [{ type: "claimCountry", country: B }]);
    expect(s.countries[A]!.controller).toBe("human");
    expect(s.countries[B]!.controller).toBe("human");
    run(s, 1, [{ type: "releaseCountry", country: A }]);
    expect(s.countries[A]!.controller).toBe("ai");
  });
});

describe("military", () => {
  it("recruiting needs defense funds and stays within the population cap", () => {
    const s = newGame();
    scripted(s);
    // Countries start with three months of defense money; spend it, and recruiting must wait for more.
    expect(s.countries[A]!.defenseFund).toBeGreaterThan(0);
    s.countries[A]!.defenseFund = 0;
    expect(validateCommand(s, geo, { type: "recruit", country: A, unitType: "army", province: P(1) })).toMatch(/defense funds/);
    run(s, 365);
    const before = unitsOf(s, A).length;
    run(s, 1, [{ type: "recruit", country: A, unitType: "army", province: P(2) }]);
    expect(unitsOf(s, A).length).toBe(before + 1);
    expect(validateCommand(s, geo, { type: "recruit", country: A, unitType: "navy", province: P(2) })).toMatch(/coastal/);
    expect(validateCommand(s, geo, { type: "recruit", country: A, unitType: "army", province: P(4) })).toMatch(/own and hold/);
  });

  it("armies march along the road, taking time", () => {
    const s = newGame();
    scripted(s);
    const u = armies(s, A).find((x) => x.province === P(1))!;
    run(s, 1, [{ type: "moveUnits", country: A, units: [u.id], to: P(3) }]);
    expect(u.path).toEqual([P(2), P(3)]);
    const eta = etaDays(s, geo, u);
    expect(eta).toBeGreaterThan(1);
    expect(runUntil(s, () => u.province === P(3), 60)).toBe(true);
  });

  it("can't enter a neutral country, or sail overseas without a fleet", () => {
    const s = newGame();
    scripted(s);
    const u = armies(s, A)[0]!;
    expect(validateCommand(s, geo, { type: "moveUnits", country: A, units: [u.id], to: P(4) })).toMatch(/no access/);
    // At war with island C: needs a fleet.
    run(s, 1, [{ type: "declareWar", country: A, target: C }]);
    for (const n of unitsOf(s, A).filter((x) => x.type === "navy")) delete s.units[n.id];
    const coastal = armies(s, A).find((x) => x.province === P(1))!;
    expect(validateCommand(s, geo, { type: "moveUnits", country: A, units: [coastal.id], to: P(6) })).toMatch(/fleet/);
  });
});

describe("war", () => {
  /** A declares war on B and marches its whole army in (towards P-5, or `to`). */
  function invade(s: GameState, to?: ProvinceId) {
    scripted(s);
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    pushOn(s, to);
  }
  /** Like a player would: send idle armies on towards the target (they halt when they meet the enemy). */
  function pushOn(s: GameState, target?: ProvinceId) {
    // By default, the next enemy province not yet taken (nothing falls instantly, so the enemy can retake land behind you).
    const to = target ?? [P(4), P(5)].find((p) => s.provinces[p]!.controller === B) ?? P(5);
    const ids = armies(s, A)
      .filter((u) => !u.travel && u.province !== to && s.provinces[u.province]!.controller !== B)
      .map((u) => u.id);
    if (ids.length && s.wars.length) run(s, 1, [{ type: "moveUnits", country: A, units: ids, to }]);
  }
  function runWar(s: GameState, done: () => boolean, limit: number, to?: ProvinceId) {
    for (let i = 0; i < limit && !done(); i += 5) {
      run(s, 5);
      pushOn(s, to);
    }
    return done();
  }
  /** B's capital moved to P-5, and A only goes as far as P-4: occupation without the capital falling. */
  function invadeWithoutCapital(s: GameState) {
    s.countries[B]!.capital = P(5);
    invade(s, P(4));
  }

  it("an army occupies an undefended province over a few days; fortifications make it a longer siege", () => {
    const s = newGame();
    s.countries[B]!.capital = P(5);
    scripted(s);
    for (const u of unitsOf(s, B)) delete s.units[u.id];
    s.countries[B]!.defenseFund = -1e6; // and no money to raise new ones
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    const army = armies(s, A)[0]!;
    army.province = P(3);
    startMove(s, geo, army, [P(4)], "land");
    runUntil(s, () => army.province === P(4), 100);
    // Nothing falls instantly: arriving starts the occupation.
    expect(s.provinces[P(4)]!.controller).toBe(B);
    const need = siegeDays(s.provinces[P(4)]!.infrastructure, 0, s.provinces[P(4)]!.areaKm2);
    const t0 = s.tick;
    expect(runUntil(s, () => s.provinces[P(4)]!.controller === A, 100)).toBe(true);
    expect(s.tick - t0).toBeGreaterThanOrEqual(Math.floor(need) - 1);
    // The war keeps a record of it.
    expect(s.wars[0]!.captured?.[A]).toBe(1);
    // A fort: the army has to besiege it for a while.
    s.provinces[P(5)]!.buildings = { fort: 2 };
    startMove(s, geo, army, [P(5)], "land");
    runUntil(s, () => army.province === P(5), 100);
    expect(s.provinces[P(5)]!.controller).toBe(B);
    expect(runUntil(s, () => s.provinces[P(5)]!.controller !== B, 100)).toBe(true);
  });

  it("an advancing army must occupy each enemy province on its way before marching on", () => {
    const s = newGame();
    s.countries[B]!.capital = P(5);
    scripted(s);
    for (const u of unitsOf(s, B)) delete s.units[u.id];
    s.countries[B]!.defenseFund = -1e6;
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    const army = armies(s, A)[0]!;
    army.province = P(3);
    startMove(s, geo, army, [P(4), P(5)], "land");
    runUntil(s, () => army.province === P(4), 100);
    // It waits in P-4 until P-4 is taken, then moves on.
    run(s, 1);
    expect(army.province).toBe(P(4));
    runUntil(s, () => army.province === P(5), 200);
    expect(s.provinces[P(4)]!.controller).toBe(A);
  });

  it("battles record each side's losses in the war", () => {
    const s = newGame();
    s.countries[B]!.capital = P(5);
    scripted(s);
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    const a = armies(s, A)[0]!;
    const b = armies(s, B)[0]!;
    a.province = P(4);
    b.province = P(4);
    run(s, 3);
    const w = s.wars[0]!;
    expect(w.losses?.[A] ?? 0).toBeGreaterThan(0);
    expect(w.losses?.[B] ?? 0).toBeGreaterThan(0);
  });

  it("when an enemy holds a country's capital for seven months, the whole country falls", () => {
    const s = newGame();
    scripted(s);
    for (const u of unitsOf(s, B)) delete s.units[u.id];
    s.countries[B]!.defenseFund = -1e6; // and no money to raise new ones
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    expect(s.countries[B]!.capital).toBe(P(4));
    const army = armies(s, A)[0]!;
    army.province = P(3);
    startMove(s, geo, army, [P(4)], "land");
    runUntil(s, () => s.provinces[P(4)]!.controller === A, 100);
    // A warning first: the capital can still be retaken.
    expect(s.countries[B]!.capitalLost?.by).toBe(A);
    expect(s.events.some((e) => e.text.includes("has taken the capital of Borduria"))).toBe(true);
    run(s, 100);
    expect(s.countries[B]!.active).toBe(true);
    expect(runUntil(s, () => !s.countries[B]!.active, 150)).toBe(true);
    expect([s.provinces[P(4)]!.owner, s.provinces[P(5)]!.owner]).toEqual([A, A]); // P-5 too, never reached
    expect(s.wars).toHaveLength(0);
    expect(s.events.some((e) => e.text.includes("held the capital of Borduria"))).toBe(true);
  });

  it("declaring war brings in the defender's allies", () => {
    const s = newGame();
    s.alliances.push("BBB|CCC");
    scripted(s);
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    expect(atWar(s, A, B)).toBe(true);
    expect(atWar(s, A, C)).toBe(true);
    expect(s.events.some((e) => e.kind === "war" && e.text.includes("Carpania joined"))).toBe(true);
  });

  it("battles wear armies down until one side retreats or is destroyed", () => {
    const s = newGame();
    invade(s);
    const bArmies = () => armies(s, B).filter((u) => s.provinces[u.province]!.owner === B);
    expect(runUntil(s, () => s.events.some((e) => e.kind === "battle") || !s.wars.length, 400)).toBe(true);
    expect(bArmies().every((u) => u.strength < 100)).toBe(true);
  });

  it("occupation, then surrender: the loser's provinces change hands and its GDP moves with them", () => {
    const s = newGame();
    const gdpA = s.countries[A]!.gdp;
    invade(s);
    const ok = runWar(s, () => !s.countries[B]!.active, 1500);
    expect(ok).toBe(true);
    expect(s.provinces[P(4)]!.owner).toBe(A);
    expect(s.provinces[P(5)]!.owner).toBe(A);
    expect(s.ownershipVersion).toBeGreaterThan(0);
    expect(s.countries[A]!.gdp).toBeGreaterThan(gdpA);
    expect(unitsOf(s, B)).toHaveLength(0);
    expect(s.wars).toHaveLength(0);
    expect(s.events.some((e) => e.kind === "annexation")).toBe(true);
    // News names both sides even after the loser no longer exists.
    expect(s.events.some((e) => e.text.includes("undefined"))).toBe(false);
  });

  it("a peace treaty can hand over occupied provinces, and the AI only accepts when losing", () => {
    const s = newGame();
    invadeWithoutCapital(s);
    const war = s.wars[0]!;
    // Too early: B isn't losing yet, so B rejects.
    run(s, 1, [{ type: "offerPeace", country: A, warId: war.id, terms: "occupied" }]);
    expect(s.wars).toHaveLength(1);
    expect(runWar(s, () => s.provinces[P(4)]!.controller === A, 800, P(4))).toBe(true);
    expect(warScore(s, war, "attackers")).toBeGreaterThan(0.15);
    run(s, 1, [{ type: "offerPeace", country: A, warId: war.id, terms: "occupied" }]);
    expect(s.wars).toHaveLength(0);
    expect(s.provinces[P(4)]!.owner).toBe(A);
    // Every unit ends up somewhere its owner (or a friend) holds.
    for (const u of Object.values(s.units)) expect([u.owner, A].includes(s.provinces[u.province]!.controller) || u.owner !== B).toBe(true);
  });

  it("white peace returns occupied land", () => {
    const s = newGame();
    invadeWithoutCapital(s);
    const war = s.wars[0]!;
    expect(runWar(s, () => s.provinces[P(4)]!.controller === A, 800, P(4))).toBe(true);
    // B (AI) proposes nothing; A offers white peace, which B accepts as it is losing.
    run(s, 1, [{ type: "offerPeace", country: A, warId: war.id, terms: "white" }]);
    expect(s.wars).toHaveLength(0);
    expect(s.provinces[P(4)]!.owner).toBe(B);
    expect(s.provinces[P(4)]!.controller).toBe(B);
  });
});

describe("diplomacy", () => {
  it("improving relations has a cooldown; alliances need good relations", () => {
    const s = newGame();
    scripted(s);
    run(s, 1, [{ type: "proposeAlliance", country: A, target: D }]);
    expect(allied(s, A, D)).toBe(false);
    for (let i = 0; i < 4; i++) {
      run(s, 1, [{ type: "improveRelations", country: A, target: D }]);
      expect(validateCommand(s, geo, { type: "improveRelations", country: A, target: D })).toMatch(/Wait/);
      run(s, 31);
    }
    run(s, 1, [{ type: "proposeAlliance", country: A, target: D }]);
    expect(allied(s, A, D)).toBe(true);
  });
});

describe("saving", () => {
  it("round-trips exactly and continues identically", () => {
    const s = newGame(7);
    run(s, 400);
    const loaded = deserialize(serialize(s));
    expect(loaded).toEqual(s);
    run(s, 200);
    run(loaded, 200);
    expect(loaded).toEqual(s);
  });

  it("refuses files that aren't saves, or are from another version", () => {
    expect(() => deserialize("hello")).toThrow(/isn't a saved game/);
    expect(() => deserialize("{}")).toThrow(/isn't a saved game/);
    expect(() => deserialize(JSON.stringify({ ...newGame(), version: 3 }))).toThrow(/different version/);
  });
});

describe("economy ledger and buildings", () => {
  it("records last month's income and spending, and the treasury moves by exactly the ledger", () => {
    const s = newGame();
    scripted(s);
    run(s, 40); // past the 1st of the month
    const c = s.countries[A]!;
    const before = c.treasury;
    const l0 = c.ledger!;
    expect(l0.taxes).toBeGreaterThan(0);
    expect(l0.admin).toBeLessThan(0);
    // Next month: treasury change = ledger.net + construction (construction was paid when ordered).
    runUntil(s, () => c.ledger !== l0, 40);
    expect(c.treasury - before).toBeCloseTo(c.ledger!.net - c.ledger!.construction, 3);
    // The default budget keeps a reserve, so a country at peace without debt saves money.
    expect(c.ledger!.taxes + c.ledger!.admin + c.ledger!.welfare + c.ledger!.infrastructure + c.ledger!.research + c.ledger!.defense).toBeGreaterThan(0);
  });

  it("the world market balances, and a state's share of trade stays within 2% of GDP a year", () => {
    const s = newGame();
    run(s, 40);
    // Every unit sold is bought: the value of all exports equals the value of all imports.
    for (const r of ["food", "energy", "minerals"] as const) {
      const ex = Object.values(s.countries).reduce((a, c) => a + c.resources[r].exports, 0);
      const im = Object.values(s.countries).reduce((a, c) => a + c.resources[r].imports, 0);
      expect(Math.abs(ex - im)).toBeLessThan(1e-6 * Math.max(1, ex));
    }
    for (const c of Object.values(s.countries)) if (c.active && c.ledger) expect(Math.abs(c.ledger.trade)).toBeLessThanOrEqual((0.02 * c.gdp) / 12 + 1e-6);
  });

  it("farms, power plants, mines, labs, bases and airbases have their effects", () => {
    const s = newGame();
    const p = s.provinces[P(2)]!;
    const food = rawProduction(p, 5, "food");
    const minerals = rawProduction(p, 5, "minerals");
    p.buildings = { farm: 2, mine: 1, factory: 1 };
    expect(rawProduction(p, 5, "food") / food).toBeCloseTo(1.3, 5);
    expect(rawProduction(p, 5, "minerals") / minerals).toBeCloseTo(1.1 * 1.15, 5); // factory and mine multiply
    // Research facilities speed research.
    const a = newGame();
    const b = newGame();
    a.countries[A]!.research.focus = "economy";
    b.countries[A]!.research.focus = "economy";
    b.provinces[P(1)]!.buildings = { lab: 3 };
    run(a, 400);
    run(b, 400);
    const prog = (x: GameState) => x.countries[A]!.research.levels.economy + x.countries[A]!.research.progress.economy;
    expect(prog(b)).toBeGreaterThan(prog(a));
    // A military base trains new armies to full strength.
    scripted(s);
    s.countries[A]!.defenseFund = 1e9;
    s.provinces[P(2)]!.buildings = { base: 1 };
    run(s, 1, [{ type: "recruit", country: A, unitType: "army", province: P(2) }]);
    const fresh = unitsOf(s, A).filter((u) => u.province === P(2)).sort((x, y) => y.id - x.id)[0]!;
    expect(fresh.strength).toBe(100);
  });
});

describe("difficulty", () => {
  it("is chosen before taking a country, and sets the player's starting money once", () => {
    const easy = newGame();
    const hard = newGame();
    const normal = newGame();
    const fund = normal.countries[A]!.defenseFund;
    expect(validateCommand(easy, geo, { type: "setDifficulty", difficulty: "nonsense" as "easy" })).toMatch(/Unknown difficulty/);
    tick(easy, geo, [{ type: "setDifficulty", difficulty: "easy" }, { type: "claimCountry", country: A }]);
    tick(hard, geo, [{ type: "setDifficulty", difficulty: "expert" }, { type: "claimCountry", country: A }]);
    tick(normal, geo, [{ type: "claimCountry", country: A }]);
    expect(easy.settings.difficulty).toBe("easy");
    expect(easy.countries[A]!.treasury).toBeGreaterThan(normal.countries[A]!.treasury + 0.09 * easy.countries[A]!.gdp);
    expect(easy.countries[A]!.defenseFund).toBeGreaterThan(fund);
    expect(hard.countries[A]!.treasury).toBeLessThan(0); // Expert starts in debt…
    expect(hard.countries[A]!.defenseFund).toBeGreaterThanOrEqual(0); // …but never with negative army money
    // Locked once someone leads a country; releasing and re-taking doesn't pay out twice.
    expect(validateCommand(easy, geo, { type: "setDifficulty", difficulty: "normal" })).toMatch(/before you take a country/);
    const t = easy.countries[A]!.treasury;
    tick(easy, geo, [{ type: "releaseCountry", country: A }]);
    tick(easy, geo, [{ type: "claimCountry", country: A }]);
    // (only the month's normal budget reserve may have come in, nowhere near another 10% of GDP)
    expect(easy.countries[A]!.treasury - t).toBeLessThan(0.02 * easy.countries[A]!.gdp);
  });

  it("makes computer countries readier to attack a human player, never each other", () => {
    expect(DIFFICULTY_RULES.expert.aiWarRatio).toBeLessThan(DIFFICULTY_RULES.normal.aiWarRatio);
    expect(DIFFICULTY_RULES.easy.aiWarChance).toBeLessThan(DIFFICULTY_RULES.hard.aiWarChance);
    // A hostile, much stronger neighbour attacks a human on Expert far more often than on Easy.
    const wars = (level: "easy" | "expert") => {
      let n = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const s = newGame(seed);
        tick(s, geo, [{ type: "setDifficulty", difficulty: level }, { type: "claimCountry", country: B }]);
        s.countries[A]!.stability = 80;
        for (const u of Object.values(s.units)) if (u.owner === B) delete s.units[u.id];
        s.countries[B]!.defenseFund = -1e6;
        for (let d = 0; d < 400 && !s.wars.length; d++) {
          s.relations[[A, B].sort().join("|")] = -50; // a lasting rivalry
          run(s, 1);
        }
        if (s.wars.some((w) => w.attackers.includes(A) && w.defenders.includes(B))) n++;
      }
      return n;
    };
    expect(wars("expert")).toBeGreaterThan(wars("easy"));
  });

  it("old saves (version 8) upgrade to Normal with their players already started", () => {
    const s = newGame();
    tick(s, geo, [{ type: "claimCountry", country: A }]);
    const old = JSON.parse(serialize(s));
    old.version = 8;
    delete old.settings;
    const loaded = deserialize(JSON.stringify(old));
    expect(loaded.settings).toEqual({ difficulty: "normal", started: [A] });
  });
});

describe("treaties", () => {
  const friends = (s: GameState, x: CountryId, y: CountryId, v: number) => (s.relations[[x, y].sort().join("|")] = v);

  it("AI countries sign a treaty when relations are good enough, and a non-aggression pact blocks war", () => {
    const s = newGame();
    scripted(s);
    const err: string[] = [];
    friends(s, A, B, 10);
    err.push(...tick(s, geo, [{ type: "proposeTreaty", country: A, target: B, treaty: "trade" }]));
    expect(err[0]).toMatch(/declined: Relations must be at least 20/);
    expect(hasTreaty(s, A, B, "trade")).toBe(false);
    // One diplomatic action per month towards the same country.
    expect(validateCommand(s, geo, { type: "proposeTreaty", country: A, target: B, treaty: "nonAggression" })).toMatch(/Wait/);
    run(s, 31);
    run(s, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "nonAggression" }]);
    expect(hasTreaty(s, A, B, "nonAggression")).toBe(true);
    expect(hasTreaty(s, B, A, "nonAggression")).toBe(true);
    expect(validateCommand(s, geo, { type: "declareWar", country: A, target: B })).toMatch(/non-aggression pact/);
    run(s, 1, [{ type: "cancelTreaty", country: A, target: B, treaty: "nonAggression" }]);
    expect(hasTreaty(s, A, B, "nonAggression")).toBe(false);
    expect(validateCommand(s, geo, { type: "declareWar", country: A, target: B })).toBeNull();
  });

  it("trade agreements add growth (more for the smaller partner), research agreements speed up research", () => {
    const s = newGame();
    scripted(s);
    friends(s, A, B, 50);
    run(s, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "trade" }]);
    run(s, 31);
    run(s, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "research" }]);
    expect(hasTreaty(s, A, B, "trade") && hasTreaty(s, A, B, "research")).toBe(true);
    // B is far smaller than A: B gains the full 0.1%, A a fraction of it.
    expect(tradeGrowth(s, B)).toBeCloseTo(0.001, 6);
    expect(tradeGrowth(s, A)).toBeLessThan(0.0002);
    expect(treatyEffects(s).get(B)).toEqual({ trade: tradeGrowth(s, B), research: 0.05 });
    expect(growthBreakdown(s.countries[B]!, 5, 0, tradeGrowth(s, B)).parts.trade).toBeCloseTo(0.001, 6);
  });

  it("military access lets armies cross the other's land; cancelling it sends them home", () => {
    const s = newGame();
    scripted(s);
    expect(canEnter(s, A, P(4))).toBe(false);
    friends(s, A, B, 60);
    run(s, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "access" }]);
    expect(canEnter(s, A, P(4))).toBe(true);
    const army = armies(s, A)[0]!;
    startMove(s, geo, army, [P(4)], "land");
    runUntil(s, () => army.province === P(4), 400);
    expect(army.province).toBe(P(4));
    expect(atWar(s, A, B)).toBe(false);
    run(s, 1, [{ type: "cancelTreaty", country: A, target: B, treaty: "access" }]);
    expect(army.province).toBe(s.countries[A]!.capital);
  });

  it("declaring war ends the two sides' treaties", () => {
    const s = newGame();
    scripted(s);
    friends(s, A, B, 60);
    run(s, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "trade" }]);
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    expect(hasTreaty(s, A, B, "trade")).toBe(false);
  });

  it("proposals to another player wait for their answer", () => {
    const s = newGame();
    scripted(s);
    s.countries[B]!.controller = "human";
    friends(s, A, B, 50);
    run(s, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "trade" }]);
    expect(hasTreaty(s, A, B, "trade")).toBe(false);
    const p = s.proposals.find((x) => x.to === B)!;
    expect(p.kind).toBe("trade");
    expect(validateCommand(s, geo, { type: "answerProposal", country: A, proposalId: p.id, accept: true })).toMatch(/expired/);
    run(s, 1, [{ type: "answerProposal", country: B, proposalId: p.id, accept: true }]);
    expect(hasTreaty(s, A, B, "trade")).toBe(true);
    expect(s.proposals).toHaveLength(0);
    // Unanswered ones expire after two months.
    run(s, 31);
    run(s, 1, [{ type: "proposeAlliance", country: A, target: B }]);
    expect(s.proposals[0]?.kind).toBe("alliance");
    run(s, 70);
    expect(s.proposals).toHaveLength(0);
  });

  it("there's a limit on each kind of treaty", () => {
    const s = newGame();
    for (const c of [B, C, D]) friends(s, A, c, 60);
    s.countries[B]!.controller = "human";
    // Fill B up to the research limit with made-up partners.
    s.treaties = [1, 2, 3].map((i) => ({ id: 1000 + i, type: "research" as const, a: B, b: `X${i}` as CountryId, since: 0 }));
    expect(wouldAcceptTreaty(s, A, B, "research")).toMatch(/already has 3/);
  });
});

describe("organizations", () => {
  const withOrgs = (): GameState => {
    const s = createGameState(
      {
        ...small,
        organizations: [
          { id: "PACT", name: "Northern Pact", kind: "defense", members: [B, C] },
          { id: "MKT", name: "Common Market", kind: "economic", members: [A, B, D] },
        ],
      },
      geo,
      1,
    );
    scripted(s);
    return s;
  };
  const org = (s: GameState, id: string) => s.organizations.find((o) => o.id === id) as Organization;

  it("start from the scenario's real organizations", () => {
    const s = withOrgs();
    expect(s.organizations.map((o) => [o.id, o.source, o.members])).toEqual([
      ["data:PACT", "data", [B, C]],
      ["data:MKT", "data", [A, B, D]],
    ]);
  });

  it("defense alliance members defend each other, like allies", () => {
    const s = withOrgs();
    expect(allied(s, B, C)).toBe(true);
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    expect(atWar(s, A, C)).toBe(true);
    // Can't attack a fellow member, or break the alliance bilaterally.
    expect(validateCommand(s, geo, { type: "declareWar", country: C, target: B })).toMatch(/fellow member of Northern Pact/);
    expect(validateCommand(s, geo, { type: "breakAlliance", country: C, target: B })).toMatch(/leave it/);
  });

  it("economic union members are each other's trade partners", () => {
    const s = withOrgs();
    expect(tradeGrowth(s, B)).toBeGreaterThan(0.0009);
    expect(tradeGrowth(s, C)).toBe(0);
  });

  it("joining needs good relations with the leading members; one defense alliance at a time; leaving costs relations", () => {
    const s = withOrgs();
    expect(validateCommand(s, geo, { type: "joinOrganization", country: A, org: "data:PACT" })).toMatch(/leading members \(Borduria, Carpania\)/);
    s.relations["AAA|BBB"] = 50;
    s.relations["AAA|CCC"] = 50;
    run(s, 1, [{ type: "joinOrganization", country: A, org: "data:PACT" }]);
    expect(org(s, "data:PACT").members).toContain(A);
    expect(allied(s, A, C)).toBe(true);
    run(s, 1, [{ type: "foundOrganization", country: A, name: "Second Pact", kind: "defense" }]);
    expect(s.organizations.some((o) => o.name === "Second Pact")).toBe(false);
    run(s, 1, [{ type: "leaveOrganization", country: A, org: "data:PACT" }]);
    expect(allied(s, A, C)).toBe(false);
    expect(s.relations["AAA|CCC"]).toBeLessThan(35);
  });

  it("players can found an organization; it's wound up when the last member leaves", () => {
    const s = withOrgs();
    run(s, 1, [{ type: "foundOrganization", country: A, name: "  Sun <b>Alliance</b> ", kind: "political" }]);
    const o = s.organizations.find((x) => x.source === "game")!;
    expect(o).toMatchObject({ name: "Sun bAllianceb", kind: "political", members: [A], founder: A });
    expect(validateCommand(s, geo, { type: "foundOrganization", country: A, name: "Another", kind: "economic" })).toMatch(/already founded/);
    expect(validateCommand(s, geo, { type: "foundOrganization", country: B, name: "sun ballianceb", kind: "economic" })).toMatch(/already exists/);
    run(s, 1, [{ type: "leaveOrganization", country: A, org: o.id }]);
    expect(s.organizations.find((x) => x.id === o.id)).toBeUndefined();
  });

  it("an annexed country leaves its treaties and organizations", () => {
    const s = withOrgs();
    s.relations["AAA|DDD"] = 50;
    run(s, 1, [{ type: "proposeTreaty", country: A, target: D, treaty: "trade" }]);
    expect(orgsOf(s, D)).toHaveLength(1);
    for (const p of Object.values(s.provinces)) if (p.owner === D) p.controller = A;
    for (const u of unitsOf(s, D)) delete s.units[u.id]; // (an army at home would simply take its capital back)
    s.wars.push({ id: 999, name: "Test War", attackers: [A], defenders: [D], startTick: s.tick });
    run(s, 2);
    expect(s.countries[D]!.active).toBe(false);
    expect(orgsOf(s, D)).toHaveLength(0);
    expect(hasTreaty(s, A, D, "trade")).toBe(false);
  });
});

describe("the modern world over 20 years", () => {
  const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../apps/web/src/data/${p}`, import.meta.url), "utf8"));
  const scenario = read("scenario-modern.json") as Scenario;
  const world = geographyFrom(read("geography.json") as GeographyData);
  const s = createGameState(scenario, world, 1);
  const worldGdp = (g: GameState) => Object.values(g.countries).reduce((a, c) => a + c.gdp, 0);
  const worldPop = (g: GameState) => Object.values(g.countries).reduce((a, c) => a + (c.active ? c.population : 0), 0);
  const gdp0 = worldGdp(s);
  const pop0 = worldPop(s);
  const countries0 = Object.values(s.countries).filter((c) => c.active).length;
  const started = performance.now();
  for (let i = 0; i < 365 * 20; i++) tick(s, world);
  const ms = performance.now() - started;
  const wars = s.events.filter((e) => e.kind === "war" && e.text.includes("declared war")).length;

  it("runs fast enough for fast-forward", () => {
    expect(ms).toBeLessThan(30_000);
  });

  it("produces no broken numbers, and armies stay within their caps", () => {
    for (const c of Object.values(s.countries)) {
      if (!c.active) continue;
      for (const v of [c.gdp, c.population, c.treasury, c.stability, c.techLevel, c.defenseFund]) expect(Number.isFinite(v), c.id).toBe(true);
      expect(c.gdp, c.id).toBeGreaterThan(0);
      expect(unitsOf(s, c.id).length, c.id).toBeLessThanOrEqual(unitCap(c));
    }
    for (const u of Object.values(s.units)) {
      expect(s.provinces[u.province], `unit ${u.id}`).toBeDefined();
      expect(u.strength).toBeGreaterThanOrEqual(0);
    }
  });

  it("grows the world at believable rates", () => {
    const gdpRate = Math.pow(worldGdp(s) / gdp0, 1 / 20) - 1;
    const popRate = Math.pow(worldPop(s) / pop0, 1 / 20) - 1;
    expect(gdpRate).toBeGreaterThan(0.01);
    expect(gdpRate).toBeLessThan(0.05);
    expect(popRate).toBeGreaterThan(0.002);
    expect(popRate).toBeLessThan(0.02);
  });

  it("has some wars, but the world doesn't collapse into chaos", () => {
    const countries = Object.values(s.countries).filter((c) => c.active).length;
    expect(countries).toBeGreaterThan(countries0 * 0.85);
    expect(wars).toBeLessThan(60);
    const active = Object.values(s.countries).filter((c) => c.active);
    expect(active.filter((c) => c.stability < 30).length / active.length).toBeLessThan(0.2);
  });

  it("keeps public finances sane: few countries in deep debt, nobody with absurd savings", () => {
    const active = Object.values(s.countries).filter((c) => c.active && c.gdp > 0);
    const ratio = active.map((c) => c.treasury / c.gdp).sort((a, b) => a - b);
    const deep = ratio.filter((r) => r < -0.5).length;
    console.log(
      `treasury/GDP after 20 years: min ${ratio[0]!.toFixed(2)}, 10th pct ${ratio[Math.floor(ratio.length * 0.1)]!.toFixed(2)}, median ${ratio[Math.floor(ratio.length / 2)]!.toFixed(2)}, 90th pct ${ratio[Math.floor(ratio.length * 0.9)]!.toFixed(2)}, max ${ratio[ratio.length - 1]!.toFixed(2)}; ${deep} below -50%`,
    );
    expect(deep / active.length).toBeLessThan(0.1);
    expect(ratio[ratio.length - 1]!).toBeLessThan(3);
  });

  it("prints a summary", () => {
    console.log(
      `20 years: ${(ms / 1000).toFixed(1)}s, ${wars} wars declared, ${s.wars.length} ongoing, ` +
        `${countries0 - Object.values(s.countries).filter((c) => c.active).length} countries annexed, ${Object.keys(s.units).length} units, ` +
        `${s.alliances.length} alliances, ownership changes ${s.ownershipVersion}, ` +
        `${s.treaties.length} treaties (${["trade", "research", "nonAggression", "access"].map((t) => `${t} ${s.treaties.filter((x) => x.type === t).length}`).join(", ")}), ` +
        `organizations: ${s.organizations.map((o) => `${o.id.replace("data:", "")} ${o.members.length}`).join(", ")}, ` +
        `GDP ${((Math.pow(worldGdp(s) / gdp0, 1 / 20) - 1) * 100).toFixed(2)}%/yr`,
    );
  });
});

describe("network sync", () => {
  it("a client that starts from a snapshot and applies patches stays in sync with the server", () => {
    const server = newGame(3);
    scripted(server);
    const differ = new StateDiffer(server);
    let client = deserialize(serialize(server));
    let bytes = 0;
    // A year with a war, sending a patch every 2 days (like ~4 patches/s at 4 days/s).
    run(server, 1, [{ type: "declareWar", country: A, target: B }]);
    run(server, 1, [{ type: "moveUnits", country: A, units: unitsOf(server, A).filter((u) => u.type === "army").map((u) => u.id), to: P(4) }]);
    for (let day = 0; day < 365; day += 2) {
      run(server, 2);
      const patch = differ.diff(server);
      const wire = JSON.stringify(patch);
      bytes += wire.length;
      client = applyPatch(client, JSON.parse(wire));
    }
    expect(client.tick).toBe(server.tick);
    expect(client.units).toEqual(server.units);
    expect(client.wars).toEqual(server.wars);
    expect(client.events).toEqual(server.events);
    // Countries match to 5 significant digits (numbers are rounded on the wire to save bandwidth).
    for (const c of Object.values(server.countries)) {
      const { history, ...rest } = c;
      const { history: clientHistory, ...clientRest } = client.countries[c.id]!;
      expect(round5(clientRest)).toEqual(round5(rest));
      expect(clientHistory).toEqual(history);
    }
    for (const p of Object.values(server.provinces)) {
      const q = client.provinces[p.id]!;
      expect([q.owner, q.controller]).toEqual([p.owner, p.controller]);
      expect(Math.abs(q.population - p.population) / Math.max(1, p.population)).toBeLessThan(0.011);
    }
    expect(bytes / 183).toBeLessThan(20_000); // average patch size in this tiny world
  });

  it("treaties, organizations and proposals reach the client, and only when they change", () => {
    const server = createGameState({ ...small, organizations: [{ id: "MKT", name: "Common Market", kind: "economic", members: [A, B] }] }, geo, 3);
    scripted(server);
    server.countries[B]!.controller = "human";
    const differ = new StateDiffer(server, { units: false });
    let client = deserialize(serialize(server));
    const sync = () => {
      const patch = differ.diff(server);
      client = applyPatch(client, JSON.parse(JSON.stringify(patch)));
      return patch;
    };
    server.relations["AAA|DDD"] = 50;
    server.relations["AAA|CCC"] = 50;
    run(server, 1, [{ type: "proposeTreaty", country: A, target: D, treaty: "trade" }]);
    run(server, 1, [{ type: "proposeTreaty", country: A, target: B, treaty: "nonAggression" }]);
    run(server, 1, [{ type: "foundOrganization", country: A, name: "Sea Union", kind: "political" }]);
    run(server, 1, [{ type: "leaveOrganization", country: B, org: "data:MKT" }]);
    expect(sync().treaties?.add).toHaveLength(1);
    expect(client.treaties).toEqual(server.treaties);
    expect(client.organizations).toEqual(server.organizations);
    expect(client.proposals).toEqual(server.proposals);
    // Nothing changed: none of them are sent again.
    run(server, 3);
    const quiet = sync();
    expect([quiet.treaties, quiet.organizations, quiet.proposals]).toEqual([undefined, undefined, undefined]);
    run(server, 1, [{ type: "cancelTreaty", country: A, target: D, treaty: "trade" }]);
    run(server, 1, [{ type: "leaveOrganization", country: A, org: server.organizations.find((o) => o.name === "Sea Union")!.id }]);
    const p = sync();
    expect(p.treaties).toEqual({ add: [], remove: [expect.any(Number)] });
    expect(Object.values(p.organizations!)).toEqual([null]);
    expect(client.treaties).toEqual(server.treaties);
    expect(client.organizations).toEqual(server.organizations);
  });
});

describe("fog of war", () => {
  const seen = (s: GameState, c: CountryId) => [...visibleProvinces(s, geo, c)].sort();

  it("you see your own land and the next province over; allies share what they see", () => {
    const s = newGame();
    expect(seen(s, A)).toEqual([P(1), P(2), P(3), P(4)]);
    expect(seen(s, B)).toEqual([P(3), P(4), P(5)]);
    expect(seen(s, D)).toEqual([P(7)]);
    s.alliances.push("AAA|DDD");
    expect(seen(s, D)).toEqual([P(1), P(2), P(3), P(4), P(7)]);
  });

  it("hides foreign units out of sight, and where foreign units are going", () => {
    const s = newGame();
    invadeB(s);
    // Dorsia, far away, sees no one's armies but its own.
    expect(Object.values(fogView(s, geo, D).units).every((u) => u.owner === D)).toBe(true);
    // Borduria sees the invaders on its border, but not their route.
    run(s, 1, [{ type: "moveUnits", country: A, units: armies(s, A).map((u) => u.id), to: P(5) }]);
    const marching = Object.values(fogView(s, geo, B).units).filter((u) => u.owner === A);
    expect(marching.length).toBeGreaterThan(0);
    for (const u of marching) {
      expect(seen(s, B)).toContain(u.province);
      expect([u.path, u.travel]).toEqual([[], null]);
    }
    // Avaria sees its own routes, and the real state is untouched.
    expect(Object.values(fogView(s, geo, A).units).some((u) => u.owner === A && u.path.length)).toBe(true);
    expect(armies(s, A).some((u) => u.path.length)).toBe(true);
    // No country chosen: no units at all.
    expect(Object.keys(fogView(s, geo, null).units)).toHaveLength(0);
  });

  it("each player's patches carry exactly the units and sieges they can see", () => {
    const server = newGame(3);
    invadeB(server);
    // Forts, so there are sieges to see (without them provinces fall at once).
    server.provinces[P(4)]!.buildings = { fort: 3 };
    server.provinces[P(5)]!.buildings = { fort: 3 };
    const differ = new StateDiffer(server, { units: false });
    const viewers = [A, B, D];
    const clients = new Map(viewers.map((v) => [v, deserialize(serialize(fogView(server, geo, v)))]));
    const syncs = new Map(viewers.map((v) => [v, new ViewSync(clients.get(v)!)]));
    let sieges = 0;
    run(server, 1, [{ type: "moveUnits", country: A, units: armies(server, A).map((u) => u.id), to: P(5) }]);
    for (let day = 0; day < 300; day += 2) {
      run(server, 2);
      const patch = differ.diff(server);
      if (Object.values(server.provinces).some((p) => p.siege)) sieges++;
      for (const v of viewers) {
        // The same steps the game server takes (apps/server/src/room.ts).
        const pv = playerView(server, geo, v);
        const own = syncs.get(v)!.diff(pv);
        const provinces = { ...patch.provinces };
        for (const id of Object.keys(provinces)) if (provinces[id]!.siege) provinces[id] = pv.view.provinces[id as ProvinceId]!;
        const wire = JSON.stringify({ ...patch, provinces: { ...provinces, ...own.provinces }, units: own.units });
        const client = applyPatch(clients.get(v)!, JSON.parse(wire));
        clients.set(v, client);
        expect(client.units).toEqual(pv.view.units);
        // Sieges are sent when they move on by 5% or more, so the client may be a little behind.
        for (const p of Object.values(server.provinces)) {
          const [mine, real] = [client.provinces[p.id]!.siege, pv.view.provinces[p.id]!.siege];
          expect(mine?.by).toEqual(real?.by);
          if (mine && real) expect(Math.abs(mine.progress - real.progress)).toBeLessThan(0.05);
        }
      }
    }
    expect(sieges).toBeGreaterThan(0); // the test did cover sieges
    expect(Object.values(clients.get(D)!.units).every((u) => u.owner === D)).toBe(true);
  });
});

/** A declares war on B (for tests outside the war section). */
function invadeB(s: GameState) {
  scripted(s);
  run(s, 1, [{ type: "declareWar", country: A, target: B }]);
}

describe("government", () => {
  const withGov = () => {
    const sc = structuredClone(small);
    sc.countries[A]!.regime = "liberal_democracy";
    sc.countries[A]!.monarchy = true;
    sc.countries[B]!.regime = "closed_autocracy";
    sc.countries[C]!.regime = "electoral_autocracy";
    return createGameState(sc, geo, 5);
  };

  it("starts from the scenario's data, and says when it's an estimate", () => {
    const s = withGov();
    expect(s.countries[A]!.government).toMatchObject({ regime: "liberal_democracy", monarchy: true, source: "data" });
    expect(s.countries[A]!.government.laws).toEqual({ conscription: "volunteer", economy: "free_market", press: "free" });
    expect(s.countries[B]!.government).toMatchObject({ regime: "closed_autocracy", nextElection: null });
    expect(s.countries[D]!.government.source).toBe("estimate"); // no data in the scenario
    expect(startingGovernment("C-NEW" as CountryId, undefined, true).source).toBe("custom");
    const sum = Object.values(s.countries[A]!.government.support).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 3);
  });

  it("democracies and electoral autocracies hold elections every four years; closed autocracies don't", () => {
    const s = withGov();
    scripted(s);
    run(s, ELECTION_INTERVAL + 60);
    for (const c of [A, C, D]) {
      const g = s.countries[c]!.government;
      expect(g.lastElection).not.toBeNull();
      expect(g.nextElection! - g.lastElection!.tick).toBe(ELECTION_INTERVAL);
    }
    expect(s.countries[B]!.government.lastElection).toBeNull();
    // Managed elections: the ruling bloc always wins, by a large margin.
    expect(s.countries[C]!.government.lastElection!.share).toBeGreaterThanOrEqual(0.6);
    expect(s.events.some((e) => e.kind === "politics" && e.text.includes("held an election"))).toBe(true);
  });

  it("laws have effects, a cooldown, and conscription raises the unit limit", () => {
    const s = withGov();
    scripted(s);
    const a = s.countries[A]!;
    const capBefore = unitCap(a);
    expect(validateCommand(s, geo, { type: "setLaw", country: A, law: "conscription", value: "nonsense" })).toMatch(/Unknown option/);
    run(s, 1, [{ type: "setLaw", country: A, law: "conscription", value: "mass" }]);
    expect(a.government.laws.conscription).toBe("mass");
    expect(unitCap(a)).toBeGreaterThan(capBefore);
    expect(governmentEffects(a, false).stability.conscription).toBeLessThan(0); // unrest in peacetime…
    expect(governmentEffects(a, true).stability.conscription).toBe(0); // …but not in war
    expect(validateCommand(s, geo, { type: "setLaw", country: A, law: "press", value: "restricted" })).toMatch(/Wait/);
    run(s, LAW_COOLDOWN);
    expect(validateCommand(s, geo, { type: "setLaw", country: A, law: "press", value: "restricted" })).toBeNull();
    // A democracy resents press restrictions; an autocracy gains control from them.
    expect(governmentEffects({ ...a, government: { ...a.government, laws: { ...a.government.laws, press: "state_controlled" } } }, false).stability.press).toBeLessThan(0);
    const b = s.countries[B]!;
    expect(governmentEffects(b, false).stability.press).toBeGreaterThan(0);
  });

  it("only democracies can call early elections, and not too often", () => {
    const s = withGov();
    scripted(s);
    expect(validateCommand(s, geo, { type: "callElection", country: B })).toMatch(/Only democracies/);
    const a = s.countries[A]!;
    a.government.nextElection = s.tick + 1000;
    run(s, 1, [{ type: "callElection", country: A }]);
    expect(a.government.nextElection).toBe(s.tick + 29);
    run(s, 40);
    expect(a.government.lastElection).not.toBeNull();
    expect(validateCommand(s, geo, { type: "callElection", country: A })).toMatch(/Wait a year/);
  });

  it("saves from before governments existed still load, with the scenario's governments", () => {
    const s = withGov();
    const old = JSON.parse(serialize(s));
    old.version = 4;
    for (const c of Object.values(old.countries) as { government?: unknown }[]) delete c.government;
    const loaded = deserialize(JSON.stringify(old), { BBB: { regime: "closed_autocracy" } });
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.countries[A]!.construction).toEqual([]);
    expect(loaded.countries[A]!.research.levels.economy).toBe(s.countries[A]!.techLevel);
    expect(loaded.countries[B]!.government.regime).toBe("closed_autocracy");
    expect(loaded.countries[A]!.government.source).toBe("estimate");
  });

  it("saves from before treaties existed load with the scenario's organizations", () => {
    const old = JSON.parse(serialize(newGame()));
    old.version = 7;
    delete old.treaties;
    delete old.organizations;
    delete old.proposals;
    const loaded = deserialize(JSON.stringify(old), undefined, (id) => (id === "test" ? [{ id: "MKT", name: "Common Market", kind: "economic", members: [A, B, "ZZZ" as CountryId] }] : undefined));
    expect(loaded.version).toBe(SAVE_VERSION);
    expect(loaded.treaties).toEqual([]);
    expect(loaded.proposals).toEqual([]);
    expect(loaded.organizations).toEqual([{ id: "data:MKT", name: "Common Market", kind: "economic", members: [A, B], source: "data", since: 0 }]);
    // Without the scenario's data (e.g. a custom world): no organizations.
    expect(deserialize(JSON.stringify(old)).organizations).toEqual([]);
  });
});

describe("technology tree", () => {
  it("starts every branch at the country's level, with the matching technologies unlocked", () => {
    const s = newGame();
    const a = s.countries[A]!;
    expect(a.research.levels).toEqual({ economy: a.techLevel, military: a.techLevel, infrastructure: a.techLevel });
    const expected = TECHS.filter((t) => t.level <= a.techLevel).length;
    expect(TECHS.filter((t) => a.research.levels[t.branch] >= t.level)).toHaveLength(expected);
  });

  it("research spending advances the focused branch only; balanced works on the lowest", () => {
    const s = newGame();
    scripted(s);
    const a = s.countries[A]!;
    a.budget.research = 0.1;
    run(s, 1, [{ type: "setResearchFocus", country: A, focus: "military" }]);
    const before = { ...a.research.levels };
    runUntil(s, () => a.research.levels.military > before.military, 3000);
    expect(a.research.levels.military).toBeGreaterThan(before.military);
    expect(a.research.levels.economy).toBe(before.economy);
    expect(a.research.levels.infrastructure).toBe(before.infrastructure);
    a.research.focus = "balanced";
    expect(researchTarget(a, 20)).not.toBe("military"); // military is now ahead
    expect(validateCommand(s, geo, { type: "setResearchFocus", country: A, focus: "magic" as never })).toMatch(/Unknown/);
  });

  it("unlocked technologies change the rules: production, combat power, movement, interest", () => {
    const s = newGame();
    const a = s.countries[A]!;
    const army = armies(s, A)[0]!;
    a.research.levels = { economy: 1, military: 1, infrastructure: 1 };
    const weak = combatPower(s, army);
    expect(techMods(a).food).toBe(0);
    a.research.levels = { economy: 12, military: 11, infrastructure: 2 };
    expect(techMods(a).food).toBeCloseTo(0.15);
    expect(techMods(a).interest).toBeCloseTo(0.01);
    expect(techMods(a).ownLandSpeed).toBeCloseTo(0.2);
    // Military level 11: 8% per level, plus Combined arms (+10% armies) and Precision weapons (+10%).
    expect(combatPower(s, army) / weak).toBeCloseTo(((1 + 0.08 * 11) * 1.2) / 1.08, 5);
  });
});

describe("construction", () => {
  it("building costs money, takes time, and raises the level when done", () => {
    const s = newGame();
    scripted(s);
    const a = s.countries[A]!;
    const before = a.treasury;
    expect(applyCommand(s, geo, { type: "build", country: A, province: P(2), building: "factory" })).toBeNull();
    const cost = buildCost(s, a, P(2), "factory");
    expect(cost).toBeCloseTo(0.03 * a.gdp * (s.provinces[P(2)]!.population / a.population), 0);
    expect(a.treasury).toBeCloseTo(before - cost, 6);
    expect(a.construction).toHaveLength(1);
    run(s, BUILDINGS.factory.days - 1);
    expect(s.provinces[P(2)]!.buildings?.factory ?? 0).toBe(0);
    run(s, 2);
    expect(s.provinces[P(2)]!.buildings?.factory).toBe(1);
    expect(a.construction).toHaveLength(0);
  });

  it("checks where and how much you can build", () => {
    const s = newGame();
    scripted(s);
    expect(validateCommand(s, geo, { type: "build", country: A, province: P(4), building: "factory" })).toMatch(/own and hold/);
    expect(validateCommand(s, geo, { type: "build", country: A, province: P(2), building: "port" })).toMatch(/coast/);
    expect(validateCommand(s, geo, { type: "build", country: A, province: P(1), building: "port" })).toBeNull();
    s.provinces[P(2)]!.buildings = { railway: 1 };
    expect(validateCommand(s, geo, { type: "build", country: A, province: P(2), building: "railway" })).toMatch(/highest level/);
    s.countries[A]!.treasury = -0.6 * s.countries[A]!.gdp;
    expect(validateCommand(s, geo, { type: "build", country: A, province: P(1), building: "fort" })).toMatch(/debt is too high/);
  });

  it("buildings change the rules: factories, forts, railways", () => {
    const s = newGame();
    const p = s.provinces[P(2)]!;
    const plain = rawProduction(p, 5, "minerals");
    p.buildings = { factory: 3, fort: 2, railway: 1 };
    expect(rawProduction(p, 5, "minerals") / plain).toBeCloseTo(1.3, 5);
    expect(rawProduction(p, 5, "food")).toBe(rawProduction({ ...p, buildings: {} }, 5, "food")); // food unaffected
    expect(siegeDays(5, 0)).toBeCloseTo(5, 5); // no fort: a few days to occupy
    expect(siegeDays(5, 2)).toBeCloseTo(40, 5);
    expect(siegeDays(5, 0, 1_000_000)).toBeGreaterThan(siegeDays(5, 0, 1_000)); // big provinces take longer
    expect(growthBreakdown(s.countries[A]!, 5, 5).parts.factories).toBeCloseTo(0.008, 5);
    // A railway into P-2 shortens the march from P-1.
    const army = armies(s, A)[0]!;
    army.province = P(1);
    p.buildings = {};
    p.infrastructure = 0; // a slow road, so the railway's saving shows in whole days
    startMove(s, geo, army, [P(2)], "land");
    const slow = army.travel!.daysLeft;
    p.buildings = { railway: 1 };
    army.province = P(1);
    startMove(s, geo, army, [P(2)], "land");
    expect(army.travel!.daysLeft).toBeLessThan(slow);
  });

  it("AI countries with money build factories", () => {
    const s = newGame();
    for (const c of Object.values(s.countries)) c.treasury = c.gdp * 0.2;
    run(s, 365 * 2);
    const built = Object.values(s.provinces).reduce((n, p) => n + (p.buildings?.factory ?? 0), 0);
    expect(built).toBeGreaterThan(0);
  });
});

describe("custom worlds", () => {
  const world = (over: Partial<CustomWorld> = {}): CustomWorld => ({
    version: 1,
    name: "Split Avaria",
    base: "test",
    owners: { "P-3": "C-NEW" as CountryId },
    newCountries: { "C-NEW": { name: "Newland", color: "#aa3366" } },
    ...over,
  });

  it("are checked before use", () => {
    expect(validateCustomWorld(world(), small)).toBeNull();
    expect(validateCustomWorld(world({ base: "other" }), small)).toMatch(/based on/);
    expect(validateCustomWorld(world({ owners: { "P-99": A } }), small)).toMatch(/Unknown province/);
    expect(validateCustomWorld(world({ owners: { "P-1": "ZZZ" as CountryId } }), small)).toMatch(/Unknown country/);
    expect(validateCustomWorld(world({ newCountries: { bad: { name: "x", color: "#000000" } } }), small)).toMatch(/Bad country id/);
    expect(validateCustomWorld(world({ newCountries: { "C-NEW": { name: "x", color: "red" } } }), small)).toMatch(/Bad color/);
    expect(validateCustomWorld({ hello: 1 }, small)).toMatch(/different version|isn't/);
  });

  it("move land, people and their share of GDP to the new owner", () => {
    const sc = applyCustomWorld(small, world());
    const s = createGameState(sc, geo, 1);
    expect(s.provinces[P(3)]!.owner).toBe("C-NEW");
    expect(s.countries["C-NEW" as CountryId]!.name).toBe("Newland");
    expect(s.countries["C-NEW" as CountryId]!.color).toBe("#aa3366");
    // P-3 holds 10M of Avaria's 60M people, so it takes 1/6 of Avaria's GDP.
    expect(s.countries["C-NEW" as CountryId]!.gdp).toBeCloseTo(2_400_000 / 6, -2);
    expect(s.countries[A]!.gdp).toBeCloseTo((2_400_000 * 5) / 6, -2);
    expect(s.scenarioName).toBe("Split Avaria");
    run(s, 365); // and the world runs
    expect(s.countries["C-NEW" as CountryId]!.population).toBeGreaterThan(0);
  });

  it("a country that loses all its land is not in play", () => {
    const sc = applyCustomWorld(small, world({ owners: { "P-6": A }, newCountries: {} }));
    const s = createGameState(sc, geo, 1);
    expect(s.countries[C]!.active).toBe(false);
  });
});

describe("real organizations (2020)", () => {
  const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../apps/web/src/data/${p}`, import.meta.url), "utf8"));
  const s = createGameState(read("scenario-modern.json") as Scenario, geographyFrom(read("geography.json") as GeographyData), 1);
  const o = (id: string) => s.organizations.find((x) => x.id === `data:${id}`)!;

  it("are members as of 1 January 2020 (Wikidata)", () => {
    expect(o("NATO").members).toHaveLength(29); // North Macedonia joined in March 2020
    expect(o("NATO").members).not.toContain("MKD");
    expect(o("EU").members).toHaveLength(28); // the UK left on 31 January 2020
    expect(o("EU").members).toContain("GBR");
    expect(o("ASEAN").members).toHaveLength(10);
    expect(o("CSTO").members).toEqual(["ARM", "BLR", "KAZ", "KGZ", "RUS", "TJK"]);
    expect(o("NATO").kind).toBe("defense");
    expect(allied(s, "USA" as CountryId, "EST" as CountryId)).toBe(true);
    expect(allied(s, "USA" as CountryId, "RUS" as CountryId)).toBe(false);
  });
});

describe("the End of the Cold War scenario (1991)", () => {
  const read = (p: string) => JSON.parse(readFileSync(new URL(`../../../apps/web/src/data/${p}`, import.meta.url), "utf8"));
  const sc = read("scenario-cold-war-1991.json") as Scenario;
  const world = geographyFrom(read("geography.json") as GeographyData);
  const s = createGameState(sc, world, 1);

  it("has the Soviet Union, Yugoslavia and Czechoslovakia, and not their successors", () => {
    expect(s.countries["SUN" as CountryId]!.name).toBe("Soviet Union");
    expect(s.countries["YUG" as CountryId]!.name).toBe("Yugoslavia");
    expect(s.countries["CSK" as CountryId]!.name).toBe("Czechoslovakia");
    for (const gone of ["RUS", "UKR", "EST", "HRV", "SVK", "ERI", "SSD", "TLS"]) expect(sc.countries[gone as CountryId], gone).toBeUndefined();
    const owners = new Set(Object.values(s.provinces).map((p) => p.owner));
    expect(owners.has("RUS" as CountryId)).toBe(false);
  });

  it("starts on 1 January 1991 with believable world totals", () => {
    expect(currentDate(s)).toBe("1991-01-01");
    const pop = Object.values(s.countries).reduce((a, c) => a + (c.active ? c.population : 0), 0);
    const gdp = Object.values(s.countries).reduce((a, c) => a + (c.active ? c.gdp : 0), 0);
    expect(pop / 1e9).toBeGreaterThan(5.2);
    expect(pop / 1e9).toBeLessThan(5.5);
    expect(gdp / 1e6).toBeGreaterThan(20);
    expect(gdp / 1e6).toBeLessThan(28);
    expect(s.countries["SUN" as CountryId]!.population / 1e6).toBeGreaterThan(280);
  });

  it("has the organizations of 1991: NATO, the European Communities and the Warsaw Pact", () => {
    const o = (id: string) => s.organizations.find((x) => x.id === `data:${id}`)?.members ?? [];
    expect(o("NATO")).toHaveLength(16);
    expect(o("EC")).toHaveLength(12);
    expect(o("WARSAW")).toEqual(["BGR", "CSK", "HUN", "POL", "ROU", "SUN"]);
    expect(s.organizations.find((x) => x.id === "data:EU")).toBeUndefined();
  });

  it("runs for 10 years without broken numbers", () => {
    for (let i = 0; i < 3650; i++) tick(s, world);
    for (const c of Object.values(s.countries)) if (c.active) expect(Number.isFinite(c.gdp) && c.gdp > 0, c.id).toBe(true);
  });
});
