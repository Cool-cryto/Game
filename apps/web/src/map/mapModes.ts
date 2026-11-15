import type { CountryInfo } from "@gs/shared";

/**
 * A map mode decides each region's color. It is a pure function of the
 * region (and, in later stages, the game state), so switching modes only
 * recolors the map; it never rebuilds geometry.
 */
export type MapModeId = "political" | "region";

export interface MapMode {
  id: MapModeId;
  label: string;
  color: (c: CountryInfo) => string;
  legend: { label: string; color: string }[] | null;
}

const POLITICAL = ["#4f7397", "#6f9461", "#a9884f", "#86689a", "#a2615a", "#4f918b", "#958c56", "#6675a3"];

const REGION_COLORS: Record<string, string> = {
  Africa: "#b98a4e",
  Americas: "#5e8fb5",
  Asia: "#b0605a",
  Europe: "#7b6aa8",
  Oceania: "#4f9c8f",
  Antarctic: "#8fa3b3",
};
const UNKNOWN = "#6b737c";

export const MAP_MODES: Record<MapModeId, MapMode> = {
  political: {
    id: "political",
    label: "Political",
    color: (c) => POLITICAL[c.colorSlot % POLITICAL.length] ?? UNKNOWN,
    legend: null,
  },
  region: {
    id: "region",
    label: "Continents",
    color: (c) => (c.region ? (REGION_COLORS[c.region] ?? UNKNOWN) : UNKNOWN),
    legend: [...Object.entries(REGION_COLORS).map(([label, color]) => ({ label, color })), { label: "Disputed / other", color: UNKNOWN }],
  },
};
