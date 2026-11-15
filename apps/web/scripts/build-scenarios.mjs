// Builds the historical scenarios from the modern world plus World Bank data.
// Run after build-world.mjs (npm run data -w @gs/web does both).
//
// Sources (downloaded into .cache/wb on first run, via the "datasets" project on GitHub):
//   population.csv – World Bank population (ODC-PDDL, public domain)
//   gdp.csv        – World Bank GDP, current US$ (CC BY 4.0: credit "World Bank")
//
// Output: src/data/scenario-cold-war-1991.json, src/data/historical-countries.json, public/flags (CSK)
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const dataDir = join(webRoot, "src", "data");
const cacheDir = join(webRoot, "..", "..", ".cache", "wb");

async function csv(name) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${name}.csv`);
  if (!existsSync(file)) {
    console.log(`Downloading ${name}…`);
    const res = await fetch(`https://raw.githubusercontent.com/datasets/${name}/main/data/${name}.csv`);
    if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  const out = new Map();
  for (const line of readFileSync(file, "utf8").trim().split(/\r?\n/).slice(1)) {
    // "Country Name",Code,Year,Value  (names may contain commas inside quotes)
    const m = line.match(/,([A-Z0-9]{3}),(\d{4}),([\d.eE+-]+)$/);
    if (m) out.set(`${m[1]}|${m[2]}`, Number(m[3]));
  }
  return out;
}

const POP = await csv("population");
const GDP = await csv("gdp");
const modern = JSON.parse(readFileSync(join(dataDir, "scenario-modern.json"), "utf8"));
const countries = JSON.parse(readFileSync(join(dataDir, "countries.json"), "utf8"));
const geography = JSON.parse(readFileSync(join(dataDir, "geography.json"), "utf8"));

/** World Bank codes that differ from the game's ids. */
const WB_CODE = { UNK: "XKX" };
const wb = (table, id, year) => table.get(`${WB_CODE[id] ?? id}|${year}`);

// ---------- End of the Cold War, 1 January 1991 ----------
const YEAR = 1991;
const MERGE = {
  SUN: ["RUS", "UKR", "BLR", "KAZ", "UZB", "TKM", "KGZ", "TJK", "GEO", "ARM", "AZE", "MDA", "LTU", "LVA", "EST"],
  YUG: ["SRB", "HRV", "SVN", "BIH", "MKD", "MNE", "UNK"],
  CSK: ["CZE", "SVK"],
  ETH: ["ETH", "ERI"],
  SDN: ["SDN", "SSD"],
  IDN: ["IDN", "TLS"],
  SOM: ["SOM", "X-SML"],
};
const mergedInto = {};
for (const [into, list] of Object.entries(MERGE)) for (const c of list) mergedInto[c] = into;

const worldPerCapitaRatio = wb(GDP, "WLD", YEAR) / wb(POP, "WLD", YEAR) / (wb(GDP, "WLD", 2019) / wb(POP, "WLD", 2019));
const worldPopRatio = wb(POP, "WLD", YEAR) / wb(POP, "WLD", 2019);

// 1991 figures for each modern country; estimates are recorded.
const estimatedPop = [];
const estimatedGdp = [];
const pop1991 = {};
const gdp1991 = {};
for (const [id, c] of Object.entries(modern.countries)) {
  if (!c.population) continue;
  let p = wb(POP, id, YEAR);
  if (p === undefined) {
    p = Math.round(c.population * worldPopRatio);
    estimatedPop.push(id);
  }
  pop1991[id] = p;
  let g = wb(GDP, id, YEAR);
  if (g === undefined) {
    // Estimate: today's GDP per person, scaled by how much the world average changed since 1991.
    g = c.gdpMillionUsd ? (c.gdpMillionUsd * 1e6 * p * worldPerCapitaRatio) / c.population : undefined;
    if (g !== undefined) estimatedGdp.push(id);
  }
  if (g !== undefined) gdp1991[id] = g / 1e6;
}

/** Rough income group from GDP per person, using the World Bank's 1991 thresholds. */
const incomeGroup = (perPerson, modernGroup) =>
  perPerson >= 7911 ? (modernGroup?.includes("OECD") && !modernGroup.includes("non") ? "High income: OECD" : "High income: nonOECD") : perPerson >= 2556 ? "Upper middle income" : perPerson >= 636 ? "Lower middle income" : "Low income";

const scenarioCountries = {};
for (const [id, c] of Object.entries(modern.countries)) {
  const target = mergedInto[id] ?? id;
  const entry = (scenarioCountries[target] ??= { name: target === id ? c.name : null, population: 0, gdpMillionUsd: 0, incomeGroup: null, _modernGroup: modern.countries[MERGE[target]?.[0] ?? id]?.incomeGroup });
  if (!c.population) {
    if (target === id) Object.assign(entry, { population: null, gdpMillionUsd: null });
    continue;
  }
  entry.population += pop1991[id];
  entry.gdpMillionUsd = gdp1991[id] === undefined || entry.gdpMillionUsd === null ? null : entry.gdpMillionUsd + gdp1991[id];
}
const HISTORICAL_NAMES = { SUN: "Soviet Union", YUG: "Yugoslavia", CSK: "Czechoslovakia" };
for (const [id, e] of Object.entries(scenarioCountries)) {
  e.name ??= HISTORICAL_NAMES[id] ?? modern.countries[id]?.name ?? id;
  if (e.population && e.gdpMillionUsd) {
    e.population = Math.round(e.population);
    e.gdpMillionUsd = Math.round(e.gdpMillionUsd);
    e.incomeGroup = incomeGroup((e.gdpMillionUsd * 1e6) / e.population, e._modernGroup);
  }
  delete e._modernGroup;
}

// Provinces: same land, 1991 owners, populations scaled to each country's 1991 total.
const provinces = {};
for (const [pid, p] of Object.entries(modern.provinces)) {
  const ratio = modern.countries[p.owner]?.population ? (pop1991[p.owner] ?? 0) / modern.countries[p.owner].population : 0;
  provinces[pid] = { ...p, owner: mergedInto[p.owner] ?? p.owner, population: Math.round(p.population * ratio) };
}

// ---------- Facts for the countries that no longer exist ----------
const sumArea = (ids) => ids.reduce((a, id) => a + (countries[id]?.areaKm2 ?? 0), 0);
const historical = {
  SUN: {
    name: "Soviet Union",
    officialName: "Union of Soviet Socialist Republics",
    cca2: null,
    capital: ["Moscow"],
    region: "Europe",
    subregion: "Eastern Europe",
    landlocked: false,
    languages: ["Russian"],
    currencies: [{ code: "SUR", name: "Soviet ruble", symbol: null }],
    demonym: "Soviet",
  },
  YUG: {
    name: "Yugoslavia",
    officialName: "Socialist Federal Republic of Yugoslavia",
    cca2: null,
    capital: ["Belgrade"],
    region: "Europe",
    subregion: "Southeast Europe",
    landlocked: false,
    languages: ["Serbo-Croatian", "Slovene", "Macedonian"],
    currencies: [{ code: "YUN", name: "Yugoslav dinar", symbol: null }],
    demonym: "Yugoslav",
  },
  CSK: {
    name: "Czechoslovakia",
    officialName: "Czech and Slovak Federative Republic",
    cca2: "CZ", // the Czech Republic kept the Czechoslovak flag
    capital: ["Prague"],
    region: "Europe",
    subregion: "Central Europe",
    landlocked: true,
    languages: ["Czech", "Slovak"],
    currencies: [{ code: "CSK", name: "Czechoslovak koruna", symbol: "Kčs" }],
    demonym: "Czechoslovak",
  },
};
// Colors: pick a slot no 1991 neighbour uses.
const owner1991 = (pid) => provinces[pid]?.owner;
const neighbours = (c) => {
  const out = new Set();
  for (const [pid, [, , , ns]] of Object.entries(geography)) {
    if (owner1991(pid) !== c) continue;
    for (const n of ns) if (owner1991(n) !== c) out.add(owner1991(n));
  }
  return out;
};
const historicalInfo = {};
for (const [id, h] of Object.entries(historical)) {
  const used = new Set([...neighbours(id)].map((n) => countries[n]?.colorSlot));
  let slot = 0;
  while (used.has(slot)) slot++;
  const hasFlag = Boolean(h.cca2);
  if (hasFlag) copyFileSync(join(webRoot, "public", "flags", "CZE.svg"), join(webRoot, "public", "flags", `${id}.svg`));
  historicalInfo[id] = {
    id,
    ...h,
    kind: "sovereign",
    areaKm2: sumArea(MERGE[id]),
    unMember: true,
    borders: [],
    note: "This country no longer exists. It appears in the 1991 scenario.",
    economy: null,
    incomeGroup: null,
    colorSlot: slot % 8,
    hasFlag,
  };
}

const scenario = {
  id: "cold-war-1991",
  name: "End of the Cold War",
  startDate: "1991-01-01",
  dataNote:
    "Starting population and GDP are World Bank figures for 1991 (via the datasets project on GitHub). " +
    `Estimated where no figure exists (${estimatedGdp.length} countries' GDP, ${estimatedPop.length} territories' population).`,
  provinces,
  countries: scenarioCountries,
};
writeFileSync(join(dataDir, "scenario-cold-war-1991.json"), JSON.stringify(scenario));
writeFileSync(join(dataDir, "historical-countries.json"), JSON.stringify(historicalInfo));
console.log(
  `Cold War 1991: ${Object.keys(scenarioCountries).length} countries; GDP estimated for ${estimatedGdp.join(", ")}; population estimated for ${estimatedPop.join(", ")}.`,
);
