import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CountryId, ProvinceId, Scenario } from "@gs/shared";
import {
  createGameState,
  currentDate,
  deserialize,
  nextRandom,
  provincesByOwner,
  serialize,
  tick,
  validateCommand,
  type GameState,
} from "./index";

const A = "AAA" as CountryId;
const B = "BBB" as CountryId;
const dep = (food: number, energy: number, minerals: number) => ({ food, energy, minerals });

const small: Scenario = {
  id: "test",
  name: "Test",
  startDate: "2026-12-30",
  dataNote: "",
  provinces: {
    "P-1": { owner: A, population: 6e6, areaKm2: 50_000, deposits: dep(3, 2, 1) },
    "P-2": { owner: A, population: 4e6, areaKm2: 80_000, deposits: dep(4, 0, 3) },
    "P-3": { owner: B, population: 20e6, areaKm2: 120_000, deposits: dep(2, 3, 2) },
  } as Scenario["provinces"],
  countries: {
    AAA: { population: 10e6, gdpMillionUsd: 400_000, incomeGroup: "High income: OECD" },
    BBB: { population: 20e6, gdpMillionUsd: 60_000, incomeGroup: "Lower middle income" },
  } as Scenario["countries"],
};

/** Run whole days. */
function run(state: GameState, days: number) {
  for (let i = 0; i < days; i++) tick(state);
}

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = { seed: 42 };
    const b = { seed: 42 };
    expect(Array.from({ length: 5 }, () => nextRandom(a))).toEqual(Array.from({ length: 5 }, () => nextRandom(b)));
  });
});

describe("game setup", () => {
  it("creates countries and provinces from a scenario", () => {
    const s = createGameState(small, 1);
    expect(s.provinces["P-3" as ProvinceId]?.owner).toBe("BBB");
    expect(s.countries[A]?.population).toBe(10e6);
    expect(provincesByOwner(s).get(A)).toEqual(["P-1", "P-2"]);
    // Richer country starts with higher technology and taxes.
    expect(s.countries[A]!.techLevel).toBeGreaterThan(s.countries[B]!.techLevel);
    expect(s.countries[A]!.taxRate).toBeGreaterThan(s.countries[B]!.taxRate);
  });

  it("rejects provinces owned by a country that doesn't exist", () => {
    const bad = { ...small, provinces: { "P-1": { ...small.provinces["P-1" as ProvinceId]!, owner: "ZZZ" } } } as Scenario;
    expect(() => createGameState(bad, 1)).toThrow(/unknown country/);
  });

  it("starts with a balanced budget", () => {
    const c = createGameState(small, 1).countries[A]!;
    const spend = 0.04 + Object.values(c.budget).reduce((a, b) => a + b, 0);
    expect(spend).toBeCloseTo(c.taxRate, 3);
  });
});

describe("clock", () => {
  it("advances one day per tick, across month and year ends", () => {
    const s = createGameState(small, 1);
    run(s, 2);
    expect(currentDate(s)).toBe("2027-01-01");
  });

  it("runs the economy on the first of each month", () => {
    const s = createGameState(small, 1);
    const gdp = s.countries[A]!.gdp;
    run(s, 1);
    expect(s.countries[A]!.gdp).toBe(gdp);
    run(s, 1); // 1 January
    expect(s.countries[A]!.gdp).not.toBe(gdp);
    expect(s.countries[A]!.history.gdp).toHaveLength(1);
  });
});

describe("commands", () => {
  it("are validated", () => {
    const s = createGameState(small, 1);
    expect(validateCommand(s, { type: "setTaxRate", country: A, value: 0.9 })).toMatch(/out of range/);
    expect(validateCommand(s, { type: "setTaxRate", country: "ZZZ" as CountryId, value: 0.2 })).toMatch(/Unknown country/);
    expect(validateCommand(s, { type: "setBudget", country: A, category: "research", value: 0.05 })).toBeNull();
  });

  it("let one human player claim a country at a time", () => {
    const s = createGameState(small, 1);
    tick(s, [{ type: "claimCountry", country: A }]);
    tick(s, [{ type: "claimCountry", country: B }]);
    expect(s.countries[A]!.controller).toBe("ai");
    expect(s.countries[B]!.controller).toBe("human");
  });

  it("report errors without changing the game", () => {
    const s = createGameState(small, 1);
    const errors = tick(s, [{ type: "setTaxRate", country: A, value: 5 }]);
    expect(errors).toHaveLength(1);
    expect(s.countries[A]!.taxRate).toBeLessThan(1);
  });
});

describe("rules", () => {
  it("raising taxes without spending more fills the treasury", () => {
    const s = createGameState(small, 1);
    tick(s, [{ type: "setTaxRate", country: A, value: 0.45 }]);
    run(s, 365);
    expect(s.countries[A]!.treasury).toBeGreaterThan(0);
  });

  it("deficits create debt, and debt hurts stability", () => {
    const s = createGameState(small, 1);
    const t = createGameState(small, 1);
    tick(s, [{ type: "setTaxRate", country: A, value: 0.1 }]);
    tick(t);
    run(s, 365 * 5);
    run(t, 365 * 5);
    expect(s.countries[A]!.treasury).toBeLessThan(0);
    expect(s.countries[A]!.stability).toBeLessThan(t.countries[A]!.stability);
  });

  it("more research means faster technology", () => {
    const s = createGameState(small, 1);
    const t = createGameState(small, 1);
    tick(s, [{ type: "setBudget", country: A, category: "research", value: 0.12 }]);
    tick(t, [{ type: "setBudget", country: A, category: "research", value: 0 }]);
    run(s, 365 * 5);
    run(t, 365 * 5);
    expect(s.countries[A]!.techLevel).toBeGreaterThan(t.countries[A]!.techLevel);
    expect(t.countries[A]!.researchProgress).toBe(0);
  });

  it("infrastructure spending builds infrastructure; none lets it decay", () => {
    const s = createGameState(small, 1);
    const t = createGameState(small, 1);
    const start = s.provinces["P-1" as ProvinceId]!.infrastructure;
    tick(s, [{ type: "setBudget", country: A, category: "infrastructure", value: 0.1 }]);
    tick(t, [{ type: "setBudget", country: A, category: "infrastructure", value: 0 }]);
    run(s, 365 * 3);
    run(t, 365 * 3);
    expect(s.provinces["P-1" as ProvinceId]!.infrastructure).toBeGreaterThan(start);
    expect(t.provinces["P-1" as ProvinceId]!.infrastructure).toBeLessThan(start);
  });

  it("a poorer country's population grows faster", () => {
    const s = createGameState(small, 1);
    run(s, 365);
    expect(s.countries[B]!.popGrowth).toBeGreaterThan(s.countries[A]!.popGrowth);
  });
});

describe("saving", () => {
  it("round-trips exactly and continues identically", () => {
    const s = createGameState(small, 7);
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
    const s = createGameState(small, 1);
    expect(() => deserialize(JSON.stringify({ ...s, version: 2 }))).toThrow(/older version/);
  });
});

describe("the modern world over 20 years", () => {
  const scenario = JSON.parse(
    readFileSync(new URL("../../../apps/web/src/data/scenario-modern.json", import.meta.url), "utf8"),
  ) as Scenario;
  const s = createGameState(scenario, 1);
  const worldGdp = (g: GameState) => Object.values(g.countries).reduce((a, c) => a + c.gdp, 0);
  const worldPop = (g: GameState) => Object.values(g.countries).reduce((a, c) => a + (c.active ? c.population : 0), 0);
  const gdp0 = worldGdp(s);
  const pop0 = worldPop(s);
  const started = performance.now();
  run(s, 365 * 20);
  const ms = performance.now() - started;

  it("runs fast enough for fast-forward", () => {
    // 20 years in well under 10 seconds (fast-forward is ~1 year every 3 seconds).
    expect(ms).toBeLessThan(10_000);
  });

  it("produces no broken numbers", () => {
    for (const c of Object.values(s.countries)) {
      if (!c.active) continue;
      for (const v of [c.gdp, c.population, c.treasury, c.stability, c.techLevel, c.researchProgress]) expect(Number.isFinite(v), c.id).toBe(true);
      expect(c.population, c.id).toBeGreaterThan(0);
      expect(c.gdp, c.id).toBeGreaterThan(0);
      expect(c.stability).toBeGreaterThanOrEqual(0);
      expect(c.stability).toBeLessThanOrEqual(100);
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

  it("keeps most countries reasonably stable on default settings", () => {
    const active = Object.values(s.countries).filter((c) => c.active);
    const unstable = active.filter((c) => c.stability < 30);
    expect(unstable.length / active.length).toBeLessThan(0.15);
  });
});
