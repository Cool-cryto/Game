import type { CountryId, ProvinceId, Scenario } from "@gs/shared";

/**
 * A custom world, made in the world editor: a base scenario plus changes.
 * Storing only the changes keeps files small (easy to share, and small enough
 * to send to a game server).
 */
export interface CustomWorld {
  version: 1;
  name: string;
  /** The scenario it starts from, e.g. "modern". */
  base: string;
  /** Provinces given to a different country than in the base scenario. */
  owners: Record<string, CountryId>;
  /** Countries that don't exist in the base scenario. */
  newCountries: Record<string, { name: string; color: string }>;
}

export const CUSTOM_COUNTRY_ID = /^C-[A-Z0-9]{1,8}$/;
const COLOR = /^#[0-9a-fA-F]{6}$/;
export const MAX_NEW_COUNTRIES = 100;

/** Check a custom world against its base scenario. Returns a problem, or null if it's fine. */
export function validateCustomWorld(w: unknown, base: Scenario): string | null {
  if (!w || typeof w !== "object") return "This isn't a custom world file.";
  const c = w as Partial<CustomWorld>;
  if (c.version !== 1) return "This custom world was made by a different version of the game.";
  if (typeof c.name !== "string" || !c.name.trim() || c.name.length > 40) return "A custom world needs a name (up to 40 characters).";
  if (c.base !== base.id) return `This world is based on "${String(c.base)}", not "${base.id}".`;
  if (!c.owners || typeof c.owners !== "object" || !c.newCountries || typeof c.newCountries !== "object") return "This isn't a custom world file.";
  const added = Object.entries(c.newCountries);
  if (added.length > MAX_NEW_COUNTRIES) return `At most ${MAX_NEW_COUNTRIES} new countries.`;
  for (const [id, n] of added) {
    if (!CUSTOM_COUNTRY_ID.test(id)) return `Bad country id ${id}.`;
    if (!n || typeof n.name !== "string" || !n.name.trim() || n.name.length > 40) return "Every new country needs a name (up to 40 characters).";
    if (typeof n.color !== "string" || !COLOR.test(n.color)) return `Bad color for ${n.name}.`;
  }
  const changes = Object.entries(c.owners);
  if (changes.length > Object.keys(base.provinces).length) return "Too many province changes.";
  for (const [pid, owner] of changes) {
    if (!base.provinces[pid as ProvinceId]) return `Unknown province ${pid}.`;
    if (typeof owner !== "string" || (!base.countries[owner as CountryId] && !c.newCountries[owner])) return `Unknown country ${String(owner)}.`;
  }
  return null;
}

/**
 * Turn a custom world into a playable scenario. Each province carries its share of
 * its original country's GDP (by population) to its new owner, so economies follow land.
 */
export function applyCustomWorld(base: Scenario, w: CustomWorld): Scenario {
  const provinces = {} as Scenario["provinces"];
  const pop = new Map<CountryId, number>();
  const gdp = new Map<CountryId, number>();
  for (const [pid, p] of Object.entries(base.provinces) as [ProvinceId, Scenario["provinces"][ProvinceId]][]) {
    const owner = (w.owners[pid] ?? p.owner) as CountryId;
    provinces[pid] = { ...p, owner };
    const from = base.countries[p.owner];
    const share = from?.population && from.gdpMillionUsd ? (from.gdpMillionUsd * p.population) / from.population : 0;
    pop.set(owner, (pop.get(owner) ?? 0) + p.population);
    gdp.set(owner, (gdp.get(owner) ?? 0) + share);
  }
  const countries = {} as Scenario["countries"];
  const ids = new Set<CountryId>([...(Object.keys(base.countries) as CountryId[]), ...(Object.keys(w.newCountries) as CountryId[])]);
  for (const id of ids) {
    const b = base.countries[id];
    const n = w.newCountries[id];
    const people = pop.get(id) ?? 0;
    const money = gdp.get(id) ?? 0;
    const alive = people > 0 && money > 0;
    countries[id] = {
      name: n?.name ?? b?.name ?? id,
      population: alive ? Math.round(people) : null,
      gdpMillionUsd: alive ? Math.round(money) : null,
      incomeGroup: b?.incomeGroup ?? null,
      ...(n ? { color: n.color } : { regime: b?.regime ?? null, monarchy: b?.monarchy ?? false, ...(b?.regimeEstimated ? { regimeEstimated: true } : {}) }),
    };
  }
  return {
    id: "custom",
    name: w.name,
    startDate: base.startDate,
    dataNote: `A custom world based on "${base.name}". ${base.dataNote}`,
    provinces,
    countries,
    ...(base.organizations ? { organizations: base.organizations } : {}),
  };
}
