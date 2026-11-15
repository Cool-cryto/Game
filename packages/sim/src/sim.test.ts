import { describe, expect, it } from "vitest";
import type { CountryId } from "@gs/shared";
import { createGameState, currentDate, nextRandom, tick } from "./index";

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

describe("game clock", () => {
  it("advances one day per tick, across month and year ends", () => {
    const s = createGameState(["FRA" as CountryId], 1, "2026-12-30");
    tick(s);
    tick(s);
    expect(currentDate(s)).toBe("2027-01-01");
  });

  it("produces state that survives a save/load round trip", () => {
    const s = createGameState(["FRA", "DEU"] as CountryId[], 7);
    tick(s);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
