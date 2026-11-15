import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { neighbors } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import { buildWorld, WORLD_WIDTH } from "./geo";
import { COUNTRIES, searchCountries } from "../data/countries";

const topo = JSON.parse(readFileSync(new URL("../../public/maps/world-50m.topo.json", import.meta.url), "utf8")) as Topology;
const geoms = (topo.objects.countries as GeometryCollection).geometries;
const world = buildWorld(topo);

describe("map data", () => {
  it("links every map shape to country facts, and every country to a shape", () => {
    const mapIds = geoms.map((g) => String(g.id));
    expect(new Set(mapIds).size).toBe(mapIds.length);
    for (const id of mapIds) expect(COUNTRIES[id as never], id).toBeDefined();
    expect(Object.keys(COUNTRIES).sort()).toEqual([...mapIds].sort());
  });

  it("includes every UN member state", () => {
    const un = Object.values(COUNTRIES).filter((c) => c.unMember);
    expect(un.length).toBe(193);
  });

  it("never gives touching countries the same color", () => {
    const adj = neighbors(geoms);
    geoms.forEach((g, i) => {
      for (const j of adj[i]!) {
        expect(COUNTRIES[String(g.id) as never]!.colorSlot).not.toBe(COUNTRIES[String(geoms[j]!.id) as never]!.colorSlot);
      }
    });
  });

  it("only lists borders with countries that exist", () => {
    for (const c of Object.values(COUNTRIES)) for (const b of c.borders) expect(COUNTRIES[b], `${c.id}->${b}`).toBeDefined();
  });
});

describe("world geometry", () => {
  it("projects every region inside the world rectangle with a usable label point", () => {
    expect(world.regions.length).toBe(geoms.length);
    for (const r of world.regions) {
      const [x, y] = r.labelPoint;
      expect(Number.isFinite(x) && Number.isFinite(y), r.id).toBe(true);
      expect(x).toBeGreaterThanOrEqual(-1);
      expect(x).toBeLessThanOrEqual(WORLD_WIDTH + 1);
      expect(y).toBeGreaterThanOrEqual(-1);
      expect(y).toBeLessThanOrEqual(world.height + 1);
      expect(r.pathData.length).toBeGreaterThan(0);
    }
  });

  it("places France's label in mainland France, not French Guiana", () => {
    const fra = world.regions.find((r) => r.id === "FRA")!;
    const deu = world.regions.find((r) => r.id === "DEU")!;
    expect(Math.abs(fra.labelPoint[0] - deu.labelPoint[0])).toBeLessThan(60);
  });
});

describe("search", () => {
  it("finds countries by the start of their name first", () => {
    expect(searchCountries("fra")[0]?.id).toBe("FRA");
    expect(searchCountries("united").map((c) => c.id)).toEqual(expect.arrayContaining(["USA", "GBR", "ARE"]));
    expect(searchCountries("")).toEqual([]);
  });
});
