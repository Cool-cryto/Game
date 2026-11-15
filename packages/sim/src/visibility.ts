import type { CountryId, ProvinceId } from "@gs/shared";
import { alliesOf } from "./diplomacy";
import type { Geography } from "./geography";
import type { GameState, ProvinceState, Unit } from "./state";

/**
 * Fog of war: what one country can see.
 *
 * Borders, owners, occupation, economies and the news are public (as in the real
 * world). What's hidden is military: foreign units, where they are heading, and
 * sieges, outside the area a country can see.
 *
 * A country sees:
 * - every province it owns or holds, and the provinces next to them;
 * - around each of its units: the unit's province and its neighbours
 *   (air wings see one ring further);
 * - everything its allies see (allies share intelligence).
 *
 * The server uses this to send each player only what they can see, so a modified
 * browser can't reveal hidden armies. Single player uses it to draw the map.
 */
export const VISION_RANGE = { army: 1, navy: 1, air: 2, territory: 1 } as const;

/**
 * Lookups shared by every viewer of the same state, so working out 50 players'
 * views doesn't scan all provinces 50 times. Build one per state (per update).
 */
export interface VisionIndex {
  /** Provinces each country owns or holds. */
  territory: Map<CountryId, ProvinceId[]>;
  unitsByOwner: Map<CountryId, Unit[]>;
  /** Provinces with a siege going on. */
  sieged: ProvinceState[];
}

export function visionIndex(s: GameState): VisionIndex {
  const territory = new Map<CountryId, ProvinceId[]>();
  const add = (c: CountryId, p: ProvinceId) => {
    let list = territory.get(c);
    if (!list) territory.set(c, (list = []));
    list.push(p);
  };
  const sieged: ProvinceState[] = [];
  for (const p of Object.values(s.provinces)) {
    add(p.owner, p.id);
    if (p.controller !== p.owner) add(p.controller, p.id);
    if (p.siege) sieged.push(p);
  }
  const unitsByOwner = new Map<CountryId, Unit[]>();
  for (const u of Object.values(s.units)) {
    let list = unitsByOwner.get(u.owner);
    if (!list) unitsByOwner.set(u.owner, (list = []));
    list.push(u);
  }
  return { territory, unitsByOwner, sieged };
}

/** The viewer and its allies: countries whose units are always shown and whose vision is shared. */
export function visionGroup(s: GameState, viewer: CountryId): Set<CountryId> {
  return new Set([viewer, ...alliesOf(s, viewer)]);
}

/** Every province the viewer can see. */
export function visibleProvinces(s: GameState, geo: Geography, viewer: CountryId, index = visionIndex(s)): Set<ProvinceId> {
  const seen = new Set<ProvinceId>();
  const reveal = (from: ProvinceId, hops: number) => {
    seen.add(from);
    let ring: ProvinceId[] = [from];
    for (let i = 0; i < hops; i++) {
      const next: ProvinceId[] = [];
      for (const p of ring) {
        for (const n of geo.provinces[p]?.neighbors ?? []) {
          if (seen.has(n)) continue;
          seen.add(n);
          next.push(n);
        }
      }
      ring = next;
    }
  };
  for (const c of visionGroup(s, viewer)) {
    for (const p of index.territory.get(c) ?? []) reveal(p, VISION_RANGE.territory);
    for (const u of index.unitsByOwner.get(c) ?? []) reveal(u.province, VISION_RANGE[u.type]);
  }
  return seen;
}

/** Can the viewer see this unit? `visible` is the result of visibleProvinces. */
export function canSeeUnit(u: Unit, group: Set<CountryId>, visible: Set<ProvinceId>): boolean {
  return group.has(u.owner) || visible.has(u.province);
}

/**
 * The game as one country sees it: a shallow copy with hidden units removed,
 * foreign units' routes left out, and sieges in unseen provinces cleared.
 * With no viewer (a player who hasn't picked a country) no units are shown.
 * The real state is never changed.
 */
export function fogView(s: GameState, geo: Geography, viewer: CountryId | null, index = visionIndex(s)): GameState {
  const group = viewer ? visionGroup(s, viewer) : new Set<CountryId>();
  const visible = viewer ? visibleProvinces(s, geo, viewer, index) : new Set<ProvinceId>();
  const units: GameState["units"] = {};
  for (const [id, u] of Object.entries(s.units)) {
    if (!canSeeUnit(u, group, visible)) continue;
    // Foreign units: you see where they are, not where they're going.
    units[id] = group.has(u.owner) || (!u.path.length && !u.travel) ? u : { ...u, path: [], travel: null };
  }
  let provinces = s.provinces;
  for (const p of index.sieged) {
    if (visible.has(p.id)) continue;
    if (provinces === s.provinces) provinces = { ...s.provinces };
    provinces[p.id] = { ...p, siege: null };
  }
  return { ...s, units, provinces };
}
