import { geoEqualEarth, geoGraticule10, geoPath, type GeoProjection } from "d3-geo";
import { feature } from "topojson-client";
import polylabel from "polylabel";
import type { Feature, Geometry, MultiPolygon, Polygon, Position } from "geojson";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { CountryId } from "@gs/shared";

/**
 * Map geometry in a fixed "world space": the whole Earth projected once into a
 * WORLD_WIDTH-wide rectangle. The camera (zoom/pan) is a transform on top of
 * world space, so we never re-project while the player zooms.
 */
export const WORLD_WIDTH = 2000;

export type Bounds = [[number, number], [number, number]];

export interface MapRegion {
  id: CountryId;
  /** SVG path data in world space. */
  pathData: string;
  /** Bounds of every part of the region (overseas parts included). */
  bounds: Bounds;
  /** Bounds of the largest landmass, used for camera focus and label size. */
  mainBounds: Bounds;
  /** Best point to put the label: inside the largest landmass. */
  labelPoint: [number, number];
  /** Projected area of the whole region, used for label priority. */
  area: number;
}

export interface WorldGeometry {
  width: number;
  height: number;
  regions: MapRegion[];
  spherePath: string;
  graticulePath: string;
}

export function createProjection(): { projection: GeoProjection; height: number } {
  const projection = geoEqualEarth().fitWidth(WORLD_WIDTH, { type: "Sphere" });
  const [[, y0], [, y1]] = geoPath(projection).bounds({ type: "Sphere" });
  // fitWidth leaves the top edge at 0; height is the bottom edge.
  return { projection, height: Math.ceil(y1 - Math.min(0, y0)) };
}

export function buildWorld(topo: Topology): WorldGeometry {
  const { projection, height } = createProjection();
  const path = geoPath(projection);
  const collection = feature(topo, topo.objects.countries as GeometryCollection);
  const regions: MapRegion[] = [];

  for (const f of collection.features as Feature<Geometry>[]) {
    const id = String(f.id) as CountryId;
    const d = path(f);
    if (!d) continue;
    const main = largestPolygon(f.geometry, path);
    const projectedRings = main ? projectRings(main, projection) : null;
    const mainBounds = (main ? path.bounds(main) : path.bounds(f)) as Bounds;
    let labelPoint = (main ? path.centroid(main) : path.centroid(f)) as [number, number];
    if (projectedRings && projectedRings[0] && projectedRings[0].length > 3) {
      const p = polylabel(projectedRings, 0.5);
      if (Number.isFinite(p[0]) && Number.isFinite(p[1])) labelPoint = [p[0], p[1]];
    }
    regions.push({ id, pathData: d, bounds: path.bounds(f) as Bounds, mainBounds, labelPoint, area: path.area(f) });
  }

  return {
    width: WORLD_WIDTH,
    height,
    regions,
    spherePath: path({ type: "Sphere" }) ?? "",
    graticulePath: path(geoGraticule10()) ?? "",
  };
}

function largestPolygon(g: Geometry, path: ReturnType<typeof geoPath>): Polygon | null {
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
    for (const pos of ring as Position[]) {
      const p = projection([pos[0]!, pos[1]!]);
      if (p) out.push([p[0], p[1]]);
    }
    rings.push(out);
  }
  // Polygons that cross the 180° line project to a ring with a huge jump;
  // fall back to the centroid for those.
  const outer = rings[0];
  if (!outer) return null;
  for (let i = 1; i < outer.length; i++) {
    if (Math.abs(outer[i]![0]! - outer[i - 1]![0]!) > WORLD_WIDTH / 2) return null;
  }
  return rings;
}
