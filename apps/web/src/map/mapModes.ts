import type { CountryId, CountryInfo } from "@gs/shared";
import type { CountryState } from "@gs/sim";

/**
 * A map mode decides each country's color from its facts and game state. It is
 * a pure function, so switching modes only recolors the map; geometry is
 * never rebuilt.
 */
export type MapModeId = "political" | "region" | "population" | "wealth";

export interface MapModeContext {
  info: CountryInfo | undefined;
  state: CountryState | undefined;
}

export interface MapMode {
  id: MapModeId;
  label: string;
  color: (id: CountryId, ctx: MapModeContext) => string;
  legend: { title: string; items: { label: string; color: string }[] } | null;
}

const NO_DATA = "#4a525c";
const POLITICAL = ["#4f7397", "#6f9461", "#a9884f", "#86689a", "#a2615a", "#4f918b", "#958c56", "#6675a3"];

const REGION_COLORS: Record<string, string> = {
  Africa: "#b98a4e",
  Americas: "#5e8fb5",
  Asia: "#b0605a",
  Europe: "#7b6aa8",
  Oceania: "#4f9c8f",
  Antarctic: "#8fa3b3",
};

/** A color scale with fixed steps, so the legend matches the map exactly. */
function steps(thresholds: number[], colors: string[], format: (n: number) => string) {
  const color = (v: number | null | undefined) => {
    if (v == null || !Number.isFinite(v)) return NO_DATA;
    let i = 0;
    while (i < thresholds.length && v >= thresholds[i]!) i++;
    return colors[i]!;
  };
  const items = colors.map((c, i) => ({
    color: c,
    label: i === 0 ? `Under ${format(thresholds[0]!)}` : i === thresholds.length ? `${format(thresholds[i - 1]!)}+` : `${format(thresholds[i - 1]!)} – ${format(thresholds[i]!)}`,
  }));
  return { color, items: [...items, { color: NO_DATA, label: "No data" }] };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const SEQ = ["#1d3550", "#25507a", "#2f6ea0", "#3e8fbf", "#62b0d6", "#9fd3ea"];
const SEQ_GOLD = ["#3b2f1c", "#5c4421", "#86602a", "#b58436", "#dcae4f", "#f3d68a"];

const pop = steps([1e6, 5e6, 20e6, 50e6, 150e6], SEQ, (n) => compact.format(n));
const wealth = steps([1_000, 4_000, 10_000, 25_000, 50_000], SEQ_GOLD, (n) => `$${compact.format(n)}`);

export const gdpPerCapita = (s: CountryState | undefined) =>
  s?.gdpMillionUsd && s.population ? (s.gdpMillionUsd * 1e6) / s.population : null;

export const MAP_MODES: Record<MapModeId, MapMode> = {
  political: {
    id: "political",
    label: "Political",
    color: (_id, { info }) => (info ? (POLITICAL[info.colorSlot % POLITICAL.length] ?? NO_DATA) : NO_DATA),
    legend: null,
  },
  region: {
    id: "region",
    label: "Continents",
    color: (_id, { info }) => (info?.region ? (REGION_COLORS[info.region] ?? NO_DATA) : NO_DATA),
    legend: { title: "Continents", items: [...Object.entries(REGION_COLORS).map(([label, color]) => ({ label, color })), { label: "Other", color: NO_DATA }] },
  },
  population: {
    id: "population",
    label: "Population",
    color: (_id, { state }) => pop.color(state?.population),
    legend: { title: "Population", items: pop.items },
  },
  wealth: {
    id: "wealth",
    label: "Wealth",
    color: (_id, { state }) => wealth.color(gdpPerCapita(state)),
    legend: { title: "GDP per person (US$)", items: wealth.items },
  },
};
