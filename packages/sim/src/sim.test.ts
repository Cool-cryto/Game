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
  unitsOf,
  validateCommand,
  warScore,
  applyPatch,
  round5,
  StateDiffer,
  type Command,
  type GameState,
  type GeographyData,
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

  it("starts with a balanced budget", () => {
    const c = newGame().countries[A]!;
    expect(0.04 + Object.values(c.budget).reduce((a, b) => a + b, 0)).toBeCloseTo(c.taxRate, 3);
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
    expect(eta).toBeGreaterThan(3);
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
  /** A declares war on B and marches its whole army in. */
  function invade(s: GameState) {
    scripted(s);
    run(s, 1, [{ type: "declareWar", country: A, target: B }]);
    pushOn(s);
  }
  /** Like a player would: send idle armies on towards P-5 (they halt when they meet the enemy). */
  function pushOn(s: GameState) {
    const ids = armies(s, A)
      .filter((u) => !u.travel && u.province !== P(5) && s.provinces[u.province]!.controller !== B)
      .map((u) => u.id);
    if (ids.length && s.wars.length) run(s, 1, [{ type: "moveUnits", country: A, units: ids, to: P(5) }]);
  }
  function runWar(s: GameState, done: () => boolean, limit: number) {
    for (let i = 0; i < limit && !done(); i += 20) {
      run(s, 20);
      pushOn(s);
    }
    return done();
  }

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
    expect(runWar(s, () => !s.countries[B]!.active, 1500)).toBe(true);
    expect(s.provinces[P(4)]!.owner).toBe(A);
    expect(s.provinces[P(5)]!.owner).toBe(A);
    expect(s.ownershipVersion).toBeGreaterThan(0);
    expect(s.countries[A]!.gdp).toBeGreaterThan(gdpA);
    expect(unitsOf(s, B)).toHaveLength(0);
    expect(s.wars).toHaveLength(0);
    expect(s.events.some((e) => e.kind === "annexation")).toBe(true);
  });

  it("a peace treaty can hand over occupied provinces, and the AI only accepts when losing", () => {
    const s = newGame();
    invade(s);
    const war = s.wars[0]!;
    // Too early: B isn't losing yet, so B rejects.
    run(s, 1, [{ type: "offerPeace", country: A, warId: war.id, terms: "occupied" }]);
    expect(s.wars).toHaveLength(1);
    expect(runWar(s, () => s.provinces[P(4)]!.controller === A, 800)).toBe(true);
    expect(warScore(s, war, "attackers")).toBeGreaterThan(0.15);
    run(s, 1, [{ type: "offerPeace", country: A, warId: war.id, terms: "occupied" }]);
    expect(s.wars).toHaveLength(0);
    expect(s.provinces[P(4)]!.owner).toBe(A);
    // Every unit ends up somewhere its owner (or a friend) holds.
    for (const u of Object.values(s.units)) expect([u.owner, A].includes(s.provinces[u.province]!.controller) || u.owner !== B).toBe(true);
  });

  it("white peace returns occupied land", () => {
    const s = newGame();
    invade(s);
    const war = s.wars[0]!;
    expect(runWar(s, () => s.provinces[P(4)]!.controller === A, 800)).toBe(true);
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

  it("prints a summary", () => {
    console.log(
      `20 years: ${(ms / 1000).toFixed(1)}s, ${wars} wars declared, ${s.wars.length} ongoing, ` +
        `${countries0 - Object.values(s.countries).filter((c) => c.active).length} countries annexed, ${Object.keys(s.units).length} units, ` +
        `${s.alliances.length} alliances, ownership changes ${s.ownershipVersion}`,
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
      expect(clientRest).toEqual(round5(rest));
      expect(clientHistory).toEqual(history);
    }
    for (const p of Object.values(server.provinces)) {
      const q = client.provinces[p.id]!;
      expect([q.owner, q.controller]).toEqual([p.owner, p.controller]);
      expect(Math.abs(q.population - p.population) / Math.max(1, p.population)).toBeLessThan(0.011);
    }
    expect(bytes / 183).toBeLessThan(20_000); // average patch size in this tiny world
  });
});
