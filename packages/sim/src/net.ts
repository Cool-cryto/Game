import type { CountryId, ProvinceId } from "@gs/shared";
import type { Geography } from "./geography";
import type { CountryState, GameEvent, GameState, ProvinceState, Unit } from "./state";
import { fogView, visionIndex, type VisionIndex } from "./visibility";
import type { Organization, Treaty } from "./treaties";

/**
 * Network sync. The server runs the real game; clients get one full snapshot
 * when they join, then small patches with only what changed. Patches are the
 * same for every player in a room, so the server builds each one once, except
 * for units and sieges: with fog of war those are per player (see ViewSync).
 */
export interface Patch {
  tick: number;
  ownershipVersion: number;
  nextId: number;
  resourceScale: GameState["resourceScale"];
  rng: GameState["rng"];
  // Small parts of the state, always sent whole.
  wars: GameState["wars"];
  relations: GameState["relations"];
  alliances: GameState["alliances"];
  offers: GameState["offers"];
  diplomacyCooldown: GameState["diplomacyCooldown"];
  /** Treaties signed and ended since the previous patch (absent when nothing changed). */
  treaties?: { add: Treaty[]; remove: number[] };
  /** Organizations that changed (whole), or null for ones that are gone (absent when nothing changed). */
  organizations?: Record<string, Organization | null>;
  /** Waiting proposals, whole, when they changed. */
  proposals?: GameState["proposals"];
  /** Generals, whole, when they changed (the list is replaced, never edited in place). */
  generals?: GameState["generals"];
  /** Sanctions and guarantees, whole, when they changed (replaced, never edited in place). */
  sanctions?: GameState["sanctions"];
  guarantees?: GameState["guarantees"];
  /** News since the previous patch. */
  events: GameEvent[];
  /** Changed fields of countries (never their history arrays). Numbers are rounded to 5 significant digits. */
  countries: Record<string, Partial<Omit<CountryState, "history">>>;
  /** Country fields that no longer exist (e.g. a warning that ended), per country. */
  removed?: Record<string, string[]>;
  /** New monthly history values to append: [gdp, population]. */
  history: Record<string, [number, number]>;
  /** Provinces that changed noticeably. */
  provinces: Record<string, ProvinceState>;
  /** Units that changed; null means the unit is gone. */
  units: Record<string, Unit | null>;
}

/** Remembers what was last sent so it can work out the next patch. */
export class StateDiffer {
  /** Last sent value of each country field, as JSON (after rounding). */
  private countries = new Map<string, Record<string, string>>();
  private history = new Map<string, string>();
  private provinces = new Map<string, ProvinceState>();
  private units = new Map<string, string>();
  private lastEvent: GameEvent | undefined;
  private treatyList: Treaty[] = [];
  private treatyIds = new Set<number>();
  private orgList: Organization[] = [];
  private orgJson = new Map<string, string>();
  private proposals: GameState["proposals"] = [];
  private generals: GameState["generals"] = [];
  private sanctions: GameState["sanctions"] = [];
  private guarantees: GameState["guarantees"] = [];

  /**
   * Start from a snapshot that clients already have. With `units: false` the
   * patches carry no units (the server sends each player's units separately,
   * see ViewSync, because with fog of war players see different units).
   */
  constructor(
    state: GameState,
    private opts: { units?: boolean } = {},
  ) {
    this.remember(state);
  }

  private remember(s: GameState) {
    for (const c of Object.values(s.countries)) {
      this.countries.set(c.id, countryFields(c));
      this.history.set(c.id, historyKey(c));
    }
    for (const p of Object.values(s.provinces)) this.provinces.set(p.id, { ...p, siege: p.siege ? { ...p.siege } : null, ...(p.buildings ? { buildings: { ...p.buildings } } : {}) });
    if (this.opts.units !== false) for (const u of Object.values(s.units)) this.units.set(String(u.id), JSON.stringify(u));
    this.lastEvent = s.events[s.events.length - 1];
    this.treatyList = s.treaties;
    this.treatyIds = new Set(s.treaties.map((t) => t.id));
    this.orgList = s.organizations;
    this.orgJson = new Map(s.organizations.map((o) => [o.id, JSON.stringify(o)]));
    this.proposals = s.proposals;
    this.generals = s.generals;
    this.sanctions = s.sanctions;
    this.guarantees = s.guarantees;
  }

  diff(s: GameState): Patch {
    const patch: Patch = {
      tick: s.tick,
      ownershipVersion: s.ownershipVersion,
      nextId: s.nextId,
      resourceScale: s.resourceScale,
      rng: s.rng,
      wars: s.wars,
      relations: s.relations,
      alliances: s.alliances,
      offers: s.offers,
      diplomacyCooldown: s.diplomacyCooldown,
      events: [],
      countries: {},
      history: {},
      provinces: {},
      units: {},
    };
    // Events: everything after the last one we sent (the array drops old events from the front).
    const i = this.lastEvent ? s.events.lastIndexOf(this.lastEvent) : -1;
    patch.events = s.events.slice(i + 1);
    this.lastEvent = s.events[s.events.length - 1] ?? this.lastEvent;

    // Treaties, organizations and proposals are replaced (not edited) when they change, so a new array means news.
    if (s.treaties !== this.treatyList) {
      const now = new Set(s.treaties.map((t) => t.id));
      const add = s.treaties.filter((t) => !this.treatyIds.has(t.id));
      const remove = [...this.treatyIds].filter((id) => !now.has(id));
      if (add.length || remove.length) patch.treaties = { add, remove };
      this.treatyList = s.treaties;
      this.treatyIds = now;
    }
    if (s.organizations !== this.orgList) {
      const changed: Record<string, Organization | null> = {};
      const seen = new Set<string>();
      for (const o of s.organizations) {
        seen.add(o.id);
        const json = JSON.stringify(o);
        if (this.orgJson.get(o.id) !== json) {
          changed[o.id] = o;
          this.orgJson.set(o.id, json);
        }
      }
      for (const id of [...this.orgJson.keys()]) {
        if (seen.has(id)) continue;
        changed[id] = null;
        this.orgJson.delete(id);
      }
      if (Object.keys(changed).length) patch.organizations = changed;
      this.orgList = s.organizations;
    }
    if (s.generals !== this.generals) {
      patch.generals = s.generals;
      this.generals = s.generals;
    }
    if (s.sanctions !== this.sanctions) {
      patch.sanctions = s.sanctions;
      this.sanctions = s.sanctions;
    }
    if (s.guarantees !== this.guarantees) {
      patch.guarantees = s.guarantees;
      this.guarantees = s.guarantees;
    }
    if (s.proposals !== this.proposals) {
      patch.proposals = s.proposals;
      this.proposals = s.proposals;
    }

    for (const c of Object.values(s.countries)) {
      const fields = countryFields(c);
      const last = this.countries.get(c.id) ?? {};
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if (last[k] !== v) changed[k] = JSON.parse(v);
      const gone = Object.keys(last).filter((k) => !(k in fields));
      if (gone.length) (patch.removed ??= {})[c.id] = gone;
      if (Object.keys(changed).length || gone.length) {
        if (Object.keys(changed).length) patch.countries[c.id] = changed as Partial<CountryState>;
        this.countries.set(c.id, fields);
      }
      const hk = historyKey(c);
      if (this.history.get(c.id) !== hk && c.history.gdp.length) {
        patch.history[c.id] = [c.history.gdp[c.history.gdp.length - 1]!, c.history.population[c.history.population.length - 1]!];
        this.history.set(c.id, hk);
      }
    }
    for (const p of Object.values(s.provinces)) {
      const last = this.provinces.get(p.id);
      if (!last || provinceChanged(last, p)) {
        patch.provinces[p.id] = p;
        this.provinces.set(p.id, { ...p, siege: p.siege ? { ...p.siege } : null, ...(p.buildings ? { buildings: { ...p.buildings } } : {}) });
      }
    }
    if (this.opts.units === false) return patch;
    const seen = new Set<string>();
    for (const u of Object.values(s.units)) {
      const id = String(u.id);
      seen.add(id);
      const key = JSON.stringify(u);
      if (this.units.get(id) !== key) {
        patch.units[id] = u;
        this.units.set(id, key);
      }
    }
    for (const id of this.units.keys()) {
      if (!seen.has(id)) {
        patch.units[id] = null;
        this.units.delete(id);
      }
    }
    return patch;
  }
}

/** Round to 5 significant digits: plenty for display, and small changes stop being "changes". */
export function round5(v: unknown): unknown {
  if (typeof v === "number") return Number.isInteger(v) || !Number.isFinite(v) ? v : Number(v.toPrecision(5));
  if (Array.isArray(v)) return v.map(round5);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, round5(x)]));
  return v;
}
/** Each country field (except history), rounded, as JSON text for cheap comparison. */
function countryFields(c: CountryState): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(c)) if (k !== "history") out[k] = JSON.stringify(round5(v));
  return out;
}
const historyKey = (c: CountryState) => `${c.history.gdp.length}|${c.history.gdp[c.history.gdp.length - 1]}|${c.history.population[c.history.population.length - 1]}`;

/**
 * Province populations change a little every month; sending all 4,600 each month
 * would be wasteful. Send a province when something visible changes: owner,
 * controller, siege, infrastructure, or population by more than 1%.
 */
function provinceChanged(a: ProvinceState, b: ProvinceState): boolean {
  if (a.owner !== b.owner || a.controller !== b.controller) return true;
  if (!!a.siege !== !!b.siege || (a.siege && b.siege && (a.siege.by !== b.siege.by || Math.abs(a.siege.progress - b.siege.progress) >= 0.05))) return true;
  if (Math.abs(a.infrastructure - b.infrastructure) >= 0.05) return true;
  if (JSON.stringify(a.buildings ?? {}) !== JSON.stringify(b.buildings ?? {})) return true;
  return Math.abs(a.population - b.population) > Math.max(1000, a.population * 0.01);
}

/**
 * Apply a patch on the client. Returns a new state object; unchanged parts keep
 * their identity, so the UI only re-renders what changed.
 */
export function applyPatch(s: GameState, p: Patch, maxEvents = 300, historyMonths = 120): GameState {
  const next: GameState = {
    ...s,
    tick: p.tick,
    ownershipVersion: p.ownershipVersion,
    nextId: p.nextId,
    resourceScale: p.resourceScale,
    rng: p.rng,
    wars: p.wars,
    relations: p.relations,
    alliances: p.alliances,
    offers: p.offers,
    diplomacyCooldown: p.diplomacyCooldown,
  };
  if (p.events.length) next.events = [...s.events, ...p.events].slice(-maxEvents);
  if (p.treaties) {
    const gone = new Set(p.treaties.remove);
    next.treaties = [...s.treaties.filter((t) => !gone.has(t.id)), ...p.treaties.add];
  }
  if (p.organizations) {
    const changed = p.organizations;
    const kept = s.organizations.filter((o) => !(o.id in changed));
    const updated = Object.values(changed).filter((o): o is Organization => !!o);
    // Keep the original order: existing organizations where they were, new ones at the end.
    const order = new Map(s.organizations.map((o, i) => [o.id, i]));
    next.organizations = [...kept, ...updated].sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
  }
  if (p.proposals) next.proposals = p.proposals;
  if (p.generals) next.generals = p.generals;
  if (p.sanctions) next.sanctions = p.sanctions;
  if (p.guarantees) next.guarantees = p.guarantees;
  const changedCountries = new Set([...Object.keys(p.countries), ...Object.keys(p.history), ...Object.keys(p.removed ?? {})]);
  if (changedCountries.size) {
    next.countries = { ...s.countries };
    for (const id of changedCountries) {
      const old = s.countries[id as CountryId];
      const base = { ...old, ...p.countries[id] } as CountryState;
      for (const k of p.removed?.[id] ?? []) delete (base as unknown as Record<string, unknown>)[k];
      let history = old?.history ?? { gdp: [], population: [] };
      const h = p.history[id];
      if (h) history = { gdp: [...history.gdp, h[0]].slice(-historyMonths), population: [...history.population, h[1]].slice(-historyMonths) };
      next.countries[id as CountryId] = { ...base, history };
    }
  }
  if (Object.keys(p.provinces).length) next.provinces = { ...s.provinces, ...(p.provinces as Record<ProvinceId, ProvinceState>) };
  if (Object.keys(p.units).length) {
    const units = { ...s.units };
    for (const [id, u] of Object.entries(p.units)) {
      if (u) units[id] = u;
      else delete units[id];
    }
    next.units = units;
  }
  return next;
}

// ---------- Fog of war: each player's own units and sieges ----------

/** The world as one country sees it, worked out once per patch and shared by everyone playing that country. */
export interface PlayerView {
  view: GameState;
  /** Each visible unit as JSON, so comparing per player is cheap. */
  unitJson: Map<string, string>;
  /** Provinces with a visible siege. */
  sieges: ProvinceState[];
}

/**
 * Work out one country's view. When building several views of the same state,
 * pass the same `index` and `jsonCache` so the shared work is done once.
 */
export function playerView(
  s: GameState,
  geo: Geography,
  viewer: CountryId | null,
  index: VisionIndex = visionIndex(s),
  jsonCache: Map<Unit, string> = new Map(),
): PlayerView {
  const view = fogView(s, geo, viewer, index);
  const unitJson = new Map<string, string>();
  for (const [id, u] of Object.entries(view.units)) {
    let json = jsonCache.get(u);
    if (json === undefined) jsonCache.set(u, (json = JSON.stringify(u)));
    unitJson.set(id, json);
  }
  const sieges = index.sieged.map((p) => view.provinces[p.id]!).filter((p) => p.siege);
  return { view, unitJson, sieges };
}

/**
 * Remembers which units and sieges one connection has been sent, so its patches
 * add units that came into sight, update the ones it can see, and remove the
 * ones that left its sight (as if they were gone).
 */
export class ViewSync {
  private units = new Map<string, string>();
  private sieges = new Map<string, { by: CountryId; progress: number }>();

  /** Start from the (fogged) snapshot this connection received. */
  constructor(view: GameState) {
    for (const [id, u] of Object.entries(view.units)) this.units.set(id, JSON.stringify(u));
    for (const p of Object.values(view.provinces)) if (p.siege) this.sieges.set(p.id, { ...p.siege });
  }

  diff(pv: PlayerView): { units: Record<string, Unit | null>; provinces: Record<string, ProvinceState> } {
    const units: Record<string, Unit | null> = {};
    for (const [id, json] of pv.unitJson) {
      if (this.units.get(id) === json) continue;
      units[id] = pv.view.units[id]!;
      this.units.set(id, json);
    }
    for (const id of [...this.units.keys()]) {
      if (pv.unitJson.has(id)) continue;
      units[id] = null;
      this.units.delete(id);
    }
    // Sieges that came into sight, moved on noticeably, or went out of sight / ended.
    const provinces: Record<string, ProvinceState> = {};
    const now = new Set<string>();
    for (const p of pv.sieges) {
      now.add(p.id);
      const last = this.sieges.get(p.id);
      if (last && last.by === p.siege!.by && Math.abs(last.progress - p.siege!.progress) < 0.05) continue;
      provinces[p.id] = p;
      this.sieges.set(p.id, { ...p.siege! });
    }
    for (const id of [...this.sieges.keys()]) {
      if (now.has(id)) continue;
      provinces[id] = pv.view.provinces[id as ProvinceId]!;
      this.sieges.delete(id);
    }
    return { units, provinces };
  }
}
