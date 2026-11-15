import { describe, expect, it } from "vitest";
import type { CountryId, ProvinceId, Scenario } from "@gs/shared";
import { createGameState, currentDate, nextRandom, provincesByOwner, tick } from "./index";

const scenario: Scenario = {
  id: "test",
  name: "Test",
  startDate: "2026-12-30",
  dataNote: "",
  owners: { "P-1": "AAA", "P-2": "AAA", "P-3": "BBB" } as Record<ProvinceId, CountryId>,
  countries: { AAA: { population: 1000, gdpMillionUsd: 5 }, BBB: { population: null, gdpMillionUsd: null } } as Scenario["countries"],
};

describe("rng", () => {
  it("is deterministic for the same seed", () => {
    const a = { seed: 42 };
    const b = { seed: 42 };
    const seqA = Array.from({ length: 5 }, () => nextRandom(a));
    const seqB = Array.from({ length: 5 }, () => nextRandom(b));
    expect(seqA).toEqual(seqB);
    expect(seqA.every((x) => x >= 0 && x < 1)).toBe(true);
  });
});

describe("game state", () => {
  it("is created from a scenario", () => {
    const s = createGameState(scenario, 1);
    expect(s.provinces["P-3" as ProvinceId]?.owner).toBe("BBB");
    expect(s.countries["AAA" as CountryId]?.population).toBe(1000);
    expect(provincesByOwner(s).get("AAA" as CountryId)).toEqual(["P-1", "P-2"]);
  });

  it("rejects provinces owned by a country that doesn't exist", () => {
    expect(() => createGameState({ ...scenario, owners: { "P-1": "ZZZ" } as Scenario["owners"] }, 1)).toThrow(/unknown country/);
  });

  it("advances one day per tick, across month and year ends", () => {
    const s = createGameState(scenario, 1);
    tick(s);
    tick(s);
    expect(currentDate(s)).toBe("2027-01-01");
  });

  it("survives a save/load round trip", () => {
    const s = createGameState(scenario, 7);
    tick(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
