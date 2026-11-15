import type { CountryId, CountryInfo, ResourceId } from "@gs/shared";
import type { CountryState, ProvinceState } from "@gs/sim";

/**
 * A map mode decides colors from facts and game state. Country modes color whole
 * countries; province modes color each province. They're pure functions, so
 * switching modes or advancing time only recolors the map.
 */
export type MapModeId =
  | "political"
  | "region"
  | "population"
  | "wealth"
  | "growth"
  | "stability"
  | "technology"
  | "density"
  | "infrastructure"
  | "food"
  | "energy"
  | "minerals";

export interface MapModeContext {
  info: CountryInfo | undefined;
  state: CountryState | undefined;
}

interface Legend {
  title: string;
  note?: string;
  items: { label: string; color: string }[];
}

export type MapMode =
  | { id: MapModeId; label: string; group: string; level: "country"; color: (id: CountryId, ctx: MapModeContext) => string; legend: Legend | null }
  | { id: MapModeId; label: string; group: string; level: "province"; provinceColor: (p: ProvinceState) => string; legend: Legend };

export const NO_DATA = "#4a525c";
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
    label:
      i === 0
        ? `Under ${format(thresholds[0]!)}`
        : i === thresholds.length
          ? `${format(thresholds[i - 1]!)}+`
          : `${format(thresholds[i - 1]!)} – ${format(thresholds[i]!)}`,
  }));
  return { color, items: [...items, { color: NO_DATA, label: "No data" }] };
}

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const BLUE = ["#1d3550", "#25507a", "#2f6ea0", "#3e8fbf", "#62b0d6", "#9fd3ea"];
const GOLD = ["#3b2f1c", "#5c4421", "#86602a", "#b58436", "#dcae4f", "#f3d68a"];
const GREEN = ["#1f3326", "#24492f", "#2f6a3d", "#43904f", "#6fb86a", "#a9dd96"];
const VIOLET = ["#2a2140", "#3a2c63", "#4e3c8a", "#6a55b0", "#8f7ed0", "#bdb2ea"];
const DIVERGING = ["#8e3b3b", "#b4664e", "#c9a46a", "#7fae7a", "#4c9a6a", "#2f7a55"];
const RES_COLORS: Record<ResourceId, string[]> = {
  food: ["#26331f", "#3a5228", "#55762f", "#7a9d38", "#a8c24a", "#d6e47c"],
  energy: ["#2e2318", "#4f3519", "#7a4b17", "#a96417", "#d8841f", "#f7b04a"],
  minerals: ["#212a33", "#2f3e4d", "#46596d", "#647b91", "#8aa0b6", "#bccbdb"],
};

export const gdpPerCapita = (s: CountryState | undefined) => (s?.active && s.population ? (s.gdp * 1e6) / s.population : null);
const active = (s: CountryState | undefined) => (s?.active ? s : undefined);

const pop = steps([1e6, 5e6, 20e6, 50e6, 150e6], BLUE, (n) => compact.format(n));
const wealth = steps([1_000, 4_000, 10_000, 25_000, 50_000], GOLD, (n) => `$${compact.format(n)}`);
const growth = steps([0, 0.01, 0.02, 0.03, 0.04], DIVERGING, (n) => `${Math.round(n * 100)}%`);
const stability = steps([20, 35, 50, 65, 80], DIVERGING, (n) => String(n));
const tech = steps([2, 4, 6, 8, 10], VIOLET, (n) => `Level ${n}`);
const density = steps([5, 25, 75, 150, 400], BLUE, (n) => `${n}/km²`);
const infra = steps([2, 4, 6, 8, 9], GREEN, (n) => String(n));
const deposit = (r: ResourceId) => {
  const colors = RES_COLORS[r];
  const items = [0, 1, 2, 3, 4, 5].map((v) => ({ label: v === 0 ? "None" : `${v} of 5`, color: colors[v]! }));
  return { color: (v: number) => colors[Math.max(0, Math.min(5, v))]!, items };
};
const RESOURCE_NOTE = "Game-generated deposits, not real-world data.";

const countryMode = (
  id: MapModeId,
  label: string,
  group: string,
  color: (id: CountryId, ctx: MapModeContext) => string,
  legend: Legend | null,
): MapMode => ({ id, label, group, level: "country", color, legend });

const resourceMode = (r: ResourceId, label: string): MapMode => {
  const d = deposit(r);
  return {
    id: r,
    label,
    group: "Provinces",
    level: "province",
    provinceColor: (p) => d.color(p.deposits[r]),
    legend: { title: `${label} deposits`, note: RESOURCE_NOTE, items: d.items },
  };
};

export const MAP_MODES: Record<MapModeId, MapMode> = {
  political: countryMode("political", "Political", "World", (_id, { info }) => (info ? (POLITICAL[info.colorSlot % POLITICAL.length] ?? NO_DATA) : NO_DATA), null),
  region: countryMode(
    "region",
    "Continents",
    "World",
    (_id, { info }) => (info?.region ? (REGION_COLORS[info.region] ?? NO_DATA) : NO_DATA),
    { title: "Continents", items: [...Object.entries(REGION_COLORS).map(([label, color]) => ({ label, color })), { label: "Other", color: NO_DATA }] },
  ),
  population: countryMode("population", "Population", "Countries", (_id, { state }) => pop.color(active(state)?.population), { title: "Population", items: pop.items }),
  wealth: countryMode("wealth", "Wealth", "Countries", (_id, { state }) => wealth.color(gdpPerCapita(state)), { title: "GDP per person (US$)", items: wealth.items }),
  growth: countryMode("growth", "Economic growth", "Countries", (_id, { state }) => growth.color(active(state)?.gdpGrowth), {
    title: "GDP growth per year",
    note: "Updates monthly while the game runs.",
    items: growth.items,
  }),
  stability: countryMode("stability", "Stability", "Countries", (_id, { state }) => stability.color(active(state)?.stability), { title: "Stability (0–100)", items: stability.items }),
  technology: countryMode("technology", "Technology", "Countries", (_id, { state }) => tech.color(active(state)?.techLevel), { title: "Technology level", items: tech.items }),
  density: {
    id: "density",
    label: "Population density",
    group: "Provinces",
    level: "province",
    provinceColor: (p) => (p.population > 0 ? density.color(p.population / Math.max(p.areaKm2, 1)) : NO_DATA),
    legend: { title: "People per km²", note: "Province populations are estimates.", items: density.items },
  },
  infrastructure: {
    id: "infrastructure",
    label: "Infrastructure",
    group: "Provinces",
    level: "province",
    provinceColor: (p) => (p.population > 0 ? infra.color(p.infrastructure) : NO_DATA),
    legend: { title: "Infrastructure (0–10)", items: infra.items },
  },
  food: resourceMode("food", "Food"),
  energy: resourceMode("energy", "Energy"),
  minerals: resourceMode("minerals", "Minerals"),
};
