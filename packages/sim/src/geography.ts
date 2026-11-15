import type { CountryId, ProvinceId } from "@gs/shared";

/**
 * Fixed geography: where provinces are and which touch. It never changes during
 * a game, so it isn't part of GameState or saves.
 */
export interface Geography {
  provinces: Record<ProvinceId, { lon: number; lat: number; coastal: boolean; neighbors: ProvinceId[] }>;
}

/** Compact form written by the data build: id → [lon, lat, coastal 0/1, neighbor ids]. */
export type GeographyData = Record<string, [number, number, number, string[]]>;

export function geographyFrom(data: GeographyData): Geography {
  const provinces = {} as Geography["provinces"];
  for (const [id, [lon, lat, coastal, neighbors]] of Object.entries(data)) {
    provinces[id as ProvinceId] = { lon, lat, coastal: coastal === 1, neighbors: neighbors as ProvinceId[] };
  }
  return { provinces };
}

const R = 6371;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two provinces' centres, in km. */
export function distanceKm(geo: Geography, a: ProvinceId, b: ProvinceId): number {
  const p = geo.provinces[a];
  const q = geo.provinces[b];
  if (!p || !q) return 0;
  const dLat = rad(q.lat - p.lat);
  const dLon = rad(q.lon - p.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(p.lat)) * Math.cos(rad(q.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Cheapest land route from `from` to any province accepted by `isGoal`, moving only
 * through provinces where `canEnter` is true. Cost is distance in km.
 * Returns the provinces to travel through (excluding `from`), or null.
 */
export function findLandPath(
  geo: Geography,
  from: ProvinceId,
  isGoal: (p: ProvinceId) => boolean,
  canEnter: (p: ProvinceId) => boolean,
  maxKm = Infinity,
): ProvinceId[] | null {
  if (isGoal(from)) return [];
  const dist = new Map<ProvinceId, number>([[from, 0]]);
  const prev = new Map<ProvinceId, ProvinceId>();
  const heap = new MinHeap<ProvinceId>();
  heap.push(from, 0);
  while (heap.size) {
    const [cur, d] = heap.pop()!;
    if (d > (dist.get(cur) ?? Infinity)) continue;
    if (cur !== from && isGoal(cur)) {
      const path: ProvinceId[] = [];
      for (let n: ProvinceId | undefined = cur; n && n !== from; n = prev.get(n)) path.push(n);
      return path.reverse();
    }
    for (const next of geo.provinces[cur]?.neighbors ?? []) {
      if (!canEnter(next)) continue;
      const nd = d + Math.max(1, distanceKm(geo, cur, next));
      if (nd > maxKm || nd >= (dist.get(next) ?? Infinity)) continue;
      dist.set(next, nd);
      prev.set(next, cur);
      heap.push(next, nd);
    }
  }
  return null;
}

/** Countries whose provinces touch each other's (by current owner). */
export function countryNeighbors(geo: Geography, ownerOf: (p: ProvinceId) => CountryId | undefined): Map<CountryId, Set<CountryId>> {
  const out = new Map<CountryId, Set<CountryId>>();
  for (const [id, p] of Object.entries(geo.provinces) as [ProvinceId, Geography["provinces"][ProvinceId]][]) {
    const a = ownerOf(id);
    if (!a) continue;
    for (const n of p.neighbors) {
      const b = ownerOf(n);
      if (!b || b === a) continue;
      if (!out.has(a)) out.set(a, new Set());
      out.get(a)!.add(b);
    }
  }
  return out;
}

class MinHeap<T> {
  private items: [T, number][] = [];
  get size() {
    return this.items.length;
  }
  push(item: T, priority: number) {
    const a = this.items;
    a.push([item, priority]);
    let i = a.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (a[parent]![1] <= a[i]![1]) break;
      [a[parent], a[i]] = [a[i]!, a[parent]!];
      i = parent;
    }
  }
  pop(): [T, number] | undefined {
    const a = this.items;
    if (!a.length) return undefined;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l]![1] < a[m]![1]) m = l;
        if (r < a.length && a[r]![1] < a[m]![1]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i]!, a[m]!];
        i = m;
      }
    }
    return top;
  }
}
