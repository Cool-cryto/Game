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
        for (const p of Object.values(server.provinces)) expect(client.provinces[p.id]!.siege).toEqual(pv.view.provinces[p.id]!.siege);
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
    expect(siegeDays(5, 2) / siegeDays(5, 0)).toBeCloseTo(1.8, 5);
    expect(growthBreakdown(s.countries[A]!, 5, 5).parts.factories).toBeCloseTo(0.008, 5);
    // A railway into P-2 shortens the march from P-1.
    const army = armies(s, A)[0]!;
    army.province = P(1);
    p.buildings = {};
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

  it("runs for 10 years without broken numbers", () => {
    for (let i = 0; i < 3650; i++) tick(s, world);
    for (const c of Object.values(s.countries)) if (c.active) expect(Number.isFinite(c.gdp) && c.gdp > 0, c.id).toBe(true);
  });
});
