import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { neighbors } from "topojson-client";
import type { City, CountryId, ProvinceId } from "@gs/shared";
import { createGameState } from "@gs/sim";
import { buildCountryShapes, buildProvinceShapes, createWorldFrame, type ProvinceTopology } from "./geo";
import { COUNTRIES as ALL_COUNTRIES, GEOGRAPHY, MODERN_SCENARIO, PROVINCES, search, setCities } from "../data/countries";
import historical from "../data/historical-countries.json";

// The modern world's countries (the list also holds the Soviet Union etc. for the 1991 scenario).
const COUNTRIES = Object.fromEntries(Object.entries(ALL_COUNTRIES).filter(([id]) => !(id in historical))) as typeof ALL_COUNTRIES;

const read = <T,>(p: string) => JSON.parse(readFileSync(new URL(`../../public/maps/${p}`, import.meta.url), "utf8")) as T;
const low = read<ProvinceTopology>("provinces-low.topo.json");
const high = read<ProvinceTopology>("provinces-high.topo.json");
const cities = read<City[]>("cities.json");
const frame = createWorldFrame();
const owners = Object.fromEntries(Object.entries(MODERN_SCENARIO.provinces).map(([id, p]) => [id, p.owner])) as Record<ProvinceId, CountryId>;
const ids = (t: ProvinceTopology) => t.objects.provinces.geometries.map((g) => String(g.id));

describe("map data", () => {
  it("has the same provinces in both detail levels, each with facts and an owner", () => {
    const lowIds = ids(low);
    expect(lowIds.length).toBeGreaterThan(4000);
    expect(new Set(lowIds).size).toBe(lowIds.length);
    expect([...ids(high)].sort()).toEqual([...lowIds].sort());
    expect(Object.keys(PROVINCES).sort()).toEqual([...lowIds].sort());
    for (const id of lowIds) expect(COUNTRIES[owners[id as ProvinceId]!], id).toBeDefined();
  });

  it("has facts for every country that owns provinces, and every UN member owns some", () => {
    const owning = new Set(Object.values(owners));
    expect(Object.keys(COUNTRIES).sort()).toEqual([...owning].sort());
    const un = Object.values(COUNTRIES).filter((c) => c.unMember);
    expect(un.length).toBeGreaterThanOrEqual(193);
  });

  it("has population and GDP for nearly every sovereign state", () => {
    const sovereign = Object.values(COUNTRIES).filter((c) => c.kind === "sovereign");
    const missing = sovereign.filter((c) => !MODERN_SCENARIO.countries[c.id]?.population);
    expect(missing.map((c) => c.id)).toEqual([]);
    expect(MODERN_SCENARIO.countries["DEU" as CountryId]?.population).toBeGreaterThan(80e6);
  });

  it("never gives touching countries the same color", () => {
    const geoms = low.objects.provinces.geometries;
    const adj = neighbors(geoms);
    geoms.forEach((g, i) => {
      for (const j of adj[i]!) {
        const a = owners[String(g.id) as ProvinceId]!;
        const b = owners[String(geoms[j]!.id) as ProvinceId]!;
        if (a !== b) expect(COUNTRIES[a]!.colorSlot, `${a}/${b}`).not.toBe(COUNTRIES[b]!.colorSlot);
      }
    });
  });

  it("places every city in a real province, capitals included", () => {
    expect(cities.length).toBeGreaterThan(7000);
    for (const c of cities) expect(PROVINCES[c.prov], c.name).toBeDefined();
    const paris = cities.find((c) => c.name === "Paris" && c.cap)!;
    expect(owners[paris.prov]).toBe("FRA");
    expect(PROVINCES[paris.prov]!.name).toBe("Paris");
    expect(Object.values(PROVINCES).find((p) => p.localName === "Bayern")?.name).toBe("Bavaria");
  });
});

describe("shapes", () => {
  const provinces = buildProvinceShapes(low, frame);
  const countries = buildCountryShapes(low, frame, owners);

  it("builds one shape per province and per country, inside the world rectangle", () => {
    expect(provinces.length).toBe(ids(low).length);
    expect(countries.length).toBe(Object.keys(COUNTRIES).length);
    for (const s of [...provinces, ...countries]) {
      const [x, y] = s.labelPoint;
      expect(x >= -1 && x <= frame.width + 1 && y >= -1 && y <= frame.height + 1, s.id).toBe(true);
    }
  });

  it("draws borders between a country's own provinces", () => {
    expect(countries.find((c) => c.id === "DEU")!.innerBordersData.length).toBeGreaterThan(100);
  });

  it("places France's label in mainland France, not French Guiana", () => {
    const fra = countries.find((c) => c.id === "FRA")!;
    const deu = countries.find((c) => c.id === "DEU")!;
    expect(Math.abs(fra.labelPoint[0] - deu.labelPoint[0])).toBeLessThan(60);
  });

  it("redraws borders when a province changes owner", () => {
    const bavaria = Object.values(PROVINCES).find((p) => p.name === "Bavaria")!;
    const state = createGameState(MODERN_SCENARIO, GEOGRAPHY, 1);
    state.provinces[bavaria.id]!.owner = "AUT" as CountryId;
    const changed = buildCountryShapes(low, frame, Object.fromEntries(Object.values(state.provinces).map((p) => [p.id, p.owner])), {
      labels: false,
    });
    const before = countries.find((c) => c.id === "AUT")!;
    const after = changed.find((c) => c.id === "AUT")!;
    expect(after.area).toBeGreaterThan(before.area * 1.5);
  });
});

describe("search", () => {
  setCities(cities);
  const ownerOf = (p: ProvinceId) => owners[p];

  it("finds countries first, then provinces, then cities", () => {
    expect(search("fra", ownerOf)[0]).toMatchObject({ kind: "country", id: "FRA" });
    const tokyo = search("tokyo", ownerOf);
    expect(tokyo.some((r) => r.kind === "province")).toBe(true);
    expect(tokyo.some((r) => r.kind === "city" && r.detail?.includes("Japan"))).toBe(true);
  });

  it("ignores accents", () => {
    expect(search("sao paulo", ownerOf).some((r) => r.name === "São Paulo")).toBe(true);
  });
});
