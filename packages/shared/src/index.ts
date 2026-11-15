// Types shared by the browser client, the simulation, and (later) the game server.

/** A country id, e.g. "FRA". Regions without an ISO code use "X-..." ids. */
export type CountryId = string & { readonly __brand: "CountryId" };
/** A province id from Natural Earth, e.g. "DEU-1591". */
export type ProvinceId = string & { readonly __brand: "ProvinceId" };

export type CountryKind = "sovereign" | "territory" | "disputed";

/** Real-world reference facts about a country. Fixed data, not game state. */
export interface CountryInfo {
  id: CountryId;
  name: string;
  officialName: string | null;
  kind: CountryKind;
  cca2: string | null;
  capital: string[];
  region: string | null;
  subregion: string | null;
  areaKm2: number | null;
  landlocked: boolean | null;
  unMember: boolean;
  languages: string[];
  currencies: { code: string; name: string; symbol: string | null }[];
  demonym: string | null;
  /** Ids of countries sharing a land border. */
  borders: CountryId[];
  note: string | null;
  /** Natural Earth economy category, e.g. "Developed region: G7". */
  economy: string | null;
  /** World Bank income group, e.g. "High income: OECD". */
  incomeGroup: string | null;
  /** Color slot 0-7; touching countries never share a slot. */
  colorSlot: number;
  hasFlag: boolean;
}

/** Real-world reference facts about a province. Which country owns it is game state, not stored here. */
export interface ProvinceInfo {
  id: ProvinceId;
  /** English name, e.g. "Bavaria". */
  name: string;
  /** Local name when different, e.g. "Bayern". */
  localName: string | null;
  /** Other spellings, used by search. */
  altNames: string[];
  /** e.g. "State", "Province", "Region". */
  type: string | null;
  /** ISO 3166-2 code, e.g. "DE-BY". */
  iso: string | null;
  areaKm2: number;
  cityCount: number;
}

export interface City {
  name: string;
  lon: number;
  lat: number;
  /** Metropolitan population estimate (Natural Earth pop_max). */
  pop: number;
  /** 1 if a national capital. */
  cap: 0 | 1;
  prov: ProvinceId;
}

export type ResourceId = "food" | "energy" | "minerals";
export const RESOURCES: ResourceId[] = ["food", "energy", "minerals"];

/** Starting data for a game: who owns what, and the starting numbers. */
export interface Scenario {
  id: string;
  name: string;
  startDate: string;
  dataNote: string;
  provinces: Record<
    ProvinceId,
    {
      owner: CountryId;
      /** Estimated from the country's population, its cities and land area. */
      population: number;
      areaKm2: number;
      /** Game-generated resource deposits, 0-5. Not real-world data. */
      deposits: Record<ResourceId, number>;
    }
  >;
  countries: Record<
    CountryId,
    {
      name?: string;
      population: number | null;
      gdpMillionUsd: number | null;
      incomeGroup: string | null;
      /** Map color (#rrggbb) for countries made in the world editor. */
      color?: string;
    }
  >;
}
