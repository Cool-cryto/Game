// Types shared by the browser client, the simulation, and (later) the game server.

/** A country or map region id, e.g. "FRA". Disputed areas use "X-..." ids. */
export type CountryId = string & { readonly __brand: "CountryId" };

export type CountryKind = "sovereign" | "territory" | "disputed";

/** Real-world reference facts about a map region. These are fixed data, not game state. */
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
  /** Color slot 0-7; touching countries never share a slot. */
  colorSlot: number;
  hasFlag: boolean;
}
