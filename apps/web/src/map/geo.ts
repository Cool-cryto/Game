import { geoEqualEarth, geoGraticule10, geoPath, type GeoPath, type GeoProjection } from "d3-geo";
import { feature, merge, mesh } from "topojson-client";
import polylabel from "polylabel";
import type { Feature, Geometry, MultiPolygon, Polygon } from "geojson";
import type { GeometryCollection, GeometryObject, Topology } from "topojson-specification";
import type { City, CountryId, ProvinceId } from "@gs/shared";

/**
 * Map geometry lives in a fixed "world space": the whole Earth projected once
 * into a WORLD_WIDTH-wide rectangle. Zoom and pan are a camera transform on
 * top, so nothing is re-projected while the player moves around.
 */
export const WORLD_WIDTH = 2000;

export type Bounds = [[number, number], [number, number]];

interface Shape {
  /** SVG path data in world space. */
  pathData: string;
  bounds: Bounds;
  /** Bounds of the largest landmass, for camera focus and label sizing. */
  mainBounds: Bounds;
  /** Label position inside the largest landmass. */
  labelPoint: [number, number];
  /** Projected area in world-space units. */
  area: number;
}

export interface ProvinceShape extends Shape {
  id: ProvinceId;
}

export interface CountryShape extends Shape {
  id: CountryId;
  /** Borders between this country's own provinces. */
  innerBordersData: string;
}

export interface WorldFrame {
  width: number;
  height: number;
  projection: GeoProjection;
  path: GeoPath;
  spherePath: string;
  graticulePath: string;
}

export interface CityPoint extends City {
  x: number;
  y: number;
}

export type ProvinceTopology = Topology<{ provinces: GeometryCollection }>;

export function createWorldFrame(): WorldFrame {
  const projection = geoEqualEarth().fitWidth(WORLD_WIDTH, { type: "Sphere" });
  const path = geoPath(projection);
  const [[, y0], [, y1]] = path.bounds({ type: "Sphere" });
  return {
    width: WORLD_WIDTH,
    height: Math.ceil(y1 - Math.min(0, y0)),
    projection,
    path,
    spherePath: path({ type: "Sphere" }) ?? "",
    graticulePath: path(geoGraticule10()) ?? "",
  };
}

const geometriesOf = (topo: ProvinceTopology) => topo.objects.provinces.geometries as GeometryObject[];

/**
 * Options for building shapes. With labels: false, label points and main
 * bounds are skipped (they are slow to compute); the detailed layer reuses
 * the ones from the simplified layer.
 */
export interface BuildOptions {
  labels?: boolean;
}

export function buildProvinceShapes(topo: ProvinceTopology, frame: WorldFrame, { labels = true }: BuildOptions = {}): ProvinceShape[] {
  const collection = feature(topo, topo.objects.provinces);
  const out: ProvinceShape[] = [];
  for (const f of collection.features as Feature<Geometry>[]) {
    const shape = shapeOf(f.geometry, frame, labels);
    if (shape) out.push({ id: String(f.id) as ProvinceId, ...shape });
  }
  return out;
}

/**
 * Build each country's shape from the provinces it owns. Called again whenever
 * ownership changes, so conquest redraws borders automatically.
 */
export function buildCountryShapes(
  topo: ProvinceTopology,
  frame: WorldFrame,
  owners: Readonly<Record<string, CountryId>>,
  { labels = true }: BuildOptions = {},
): CountryShape[] {
  const byOwner = new Map<CountryId, GeometryObject[]>();
  for (const g of geometriesOf(topo)) {
    const owner = owners[String(g.id)];
    if (!owner) continue;
    let list = byOwner.get(owner);
    if (!list) byOwner.set(owner, (list = []));
    list.push(g);
  }
  const out: CountryShape[] = [];
  for (const [id, geoms] of byOwner) {
    const merged = merge(topo, geoms as never) as MultiPolygon;
    const shape = shapeOf(merged, frame, labels);
    if (!shape) continue;
    let innerBordersData = "";
    if (geoms.length > 1) {
      const lines = mesh(topo, { type: "GeometryCollection", geometries: geoms } as GeometryCollection, (a, b) => a !== b);
      innerBordersData = frame.path(lines) ?? "";
    }
    out.push({ id, ...shape, innerBordersData });
  }
  return out;
}

export function projectCities(cities: City[], frame: WorldFrame): CityPoint[] {
  const out: CityPoint[] = [];
  for (const c of cities) {
    const p = frame.projection([c.lon, c.lat]);
    if (p) out.push({ ...c, x: p[0], y: p[1] });
  }
  return out;
}

function shapeOf(g: Geometry, frame: WorldFrame, labels: boolean): Shape | null {
  const d = frame.path(g);
  if (!d) return null;
  if (!labels) {
    const bounds = frame.path.bounds(g) as Bounds;
    return { pathData: d, bounds, mainBounds: bounds, labelPoint: [0, 0], area: frame.path.area(g) };
  }
  const main = largestPolygon(g, frame.path);
  const mainGeom = main ?? g;
  let labelPoint = frame.path.centroid(mainGeom) as [number, number];
  const rings = main ? projectRings(main, frame.projection) : null;
  if (rings) {
    const p = polylabel(rings, 0.5);
    if (Number.isFinite(p[0]) && Number.isFinite(p[1])) labelPoint = [p[0], p[1]];
  }
  if (!Number.isFinite(labelPoint[0])) {
    const b = frame.path.bounds(g);
    labelPoint = [(b[0][0] + b[1][0]) / 2, (b[0][1] + b[1][1]) / 2];
  }
  return {
    pathData: d,
    bounds: frame.path.bounds(g) as Bounds,
    mainBounds: frame.path.bounds(mainGeom) as Bounds,
    labelPoint,
    area: frame.path.area(g),
  };
}

function largestPolygon(g: Geometry, path: GeoPath): Polygon | null {
  if (g.type === "Polygon") return g;
  if (g.type !== "MultiPolygon") return null;
  let best: Polygon | null = null;
  let bestArea = -1;
  for (const coordinates of (g as MultiPolygon).coordinates) {
    const poly: Polygon = { type: "Polygon", coordinates };
    const a = path.area(poly);
    if (a > bestArea) {
      bestArea = a;
      best = poly;
    }
  }
  return best;
}

function projectRings(poly: Polygon, projection: GeoProjection): [number, number][][] | null {
  const rings: [number, number][][] = [];
  for (const ring of poly.coordinates) {
    const out: [number, number][] = [];
    for (const pos of ring) {
      const p = projection([pos[0]!, pos[1]!]);
      if (p) out.push([p[0], p[1]]);
    }
    rings.push(out);
  }
  // Polygons crossing the 180° line jump across the map once projected; use the centroid instead.
  const outer = rings[0];
  if (!outer || outer.length < 4) return null;
  for (let i = 1; i < outer.length; i++) {
    if (Math.abs(outer[i]![0] - outer[i - 1]![0]) > WORLD_WIDTH / 2) return null;
  }
  return rings;
}
