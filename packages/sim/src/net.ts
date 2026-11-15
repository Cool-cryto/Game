import type { CountryId, ProvinceId } from "@gs/shared";
import type { CountryState, GameEvent, GameState, ProvinceState, Unit } from "./state";

/**
 * Network sync. The server runs the real game; clients get one full snapshot
 * when they join, then small patches with only what changed. Patches are the
 * same for every player in a room, so the server builds each one once.
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
  /** News since the previous patch. */
  events: GameEvent[];
  /** Changed fields of countries (never their history arrays). Numbers are rounded to 5 significant digits. */
  countries: Record<string, Partial<Omit<CountryState, "history">>>;
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

  /** Start from a snapshot that clients already have. */
  constructor(state: GameState) {
    this.remember(state);
  }

  private remember(s: GameState) {
    for (const c of Object.values(s.countries)) {
      this.countries.set(c.id, countryFields(c));
      this.history.set(c.id, historyKey(c));
    }
    for (const p of Object.values(s.provinces)) this.provinces.set(p.id, { ...p, siege: p.siege ? { ...p.siege } : null });
    for (const u of Object.values(s.units)) this.units.set(String(u.id), JSON.stringify(u));
    this.lastEvent = s.events[s.events.length - 1];
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

    for (const c of Object.values(s.countries)) {
      const fields = countryFields(c);
      const last = this.countries.get(c.id) ?? {};
      const changed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(fields)) if (last[k] !== v) changed[k] = JSON.parse(v);
      if (Object.keys(changed).length) {
        patch.countries[c.id] = changed as Partial<CountryState>;
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
        this.provinces.set(p.id, { ...p, siege: p.siege ? { ...p.siege } : null });
      }
    }
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
  const changedCountries = new Set([...Object.keys(p.countries), ...Object.keys(p.history)]);
  if (changedCountries.size) {
    next.countries = { ...s.countries };
    for (const id of changedCountries) {
      const old = s.countries[id as CountryId];
      const base = { ...old, ...p.countries[id] } as CountryState;
      if (!base) continue;
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
