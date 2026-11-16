// Adds each country's starting government to the scenarios.
// Run after build-world.mjs and build-scenarios.mjs (npm run data -w @gs/web does all three).
//
// Sources (downloaded into .cache/gov on first run):
//   V-Dem "Regimes of the World" (Lührmann, Tannenberg & Lindberg), from the V-Dem dataset, as published by
//   Our World in Data (political-regime.csv). Licence: CC BY-SA 4.0. Credit "V-Dem (Coppedge et al.), processed by
//   Our World in Data". The regime values written below are an adaptation of that data and are under CC BY-SA 4.0.
//   Wikidata: countries whose form of government is a kind of monarchy, or whose head-of-state office is a kind of
//   monarch. Licence: CC0.
//
// Output: "regime" and "monarchy" on each country in src/data/scenario-modern.json (year 2020) and
// src/data/scenario-cold-war-1991.json (year 1991). Places without V-Dem data get regime null, and the game
// shows their government as an estimate.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const dataDir = join(webRoot, "src", "data");
const cacheDir = join(webRoot, "..", "..", ".cache", "gov");
const UA = "WorldAscendant-data-build/1.0 (game data build)";

async function cached(name, url, init) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, name);
  if (!existsSync(file)) {
    console.log(`Downloading ${name}…`);
    const res = await fetch(url, { ...init, headers: { "user-agent": UA, ...(init?.headers ?? {}) } });
    if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
    writeFileSync(file, await res.text());
  }
  return readFileSync(file, "utf8");
}

// ---------- V-Dem regimes ----------
const REGIME = {
  "Liberal democracy": "liberal_democracy",
  "Electoral democracy": "electoral_democracy",
  "Electoral autocracy": "electoral_autocracy",
  "Closed autocracy": "closed_autocracy",
};
const regimeCsv = await cached("political-regime.csv", "https://ourworldindata.org/grapher/political-regime.csv?v=1&csvType=full&useColumnShortNames=true");
/** "CODE|year" → regime */
const regimes = new Map();
for (const line of regimeCsv.trim().split(/\r?\n/).slice(1)) {
  // entity,code,year,regime  (entity names may be quoted and contain commas)
  const m = line.match(/,([A-Z_]+),(\d{4}),([^,]+)$/);
  if (m && REGIME[m[3]]) regimes.set(`${m[1]}|${m[2]}`, REGIME[m[3]]);
}
/** Game ids whose V-Dem series is filed under another code. */
const CODE_ALIAS = { UNK: "OWID_KOS", "X-SML": "OWID_SML" };
/** States of 1991 that V-Dem records as the same series as a successor. */
const HISTORICAL_SERIES = { SUN: "RUS", YUG: "SRB", CSK: "CZE" };

// ---------- Wikidata monarchies ----------
const sparql = `SELECT DISTINCT ?iso WHERE {
  ?c wdt:P298 ?iso . FILTER NOT EXISTS { ?c wdt:P576 ?end }
  { ?c wdt:P122 ?g . ?g wdt:P279* wd:Q7269 } UNION { ?c wdt:P1906 ?office . ?office wdt:P279* wd:Q116 }
}`;
const monarchyJson = await cached("monarchies.json", `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}`, {
  headers: { accept: "application/sparql-results+json" },
});
const monarchiesToday = new Set(JSON.parse(monarchyJson).results.bindings.map((b) => b.iso.value));
/**
 * Places V-Dem doesn't cover where the default estimate (an electoral democracy) would plainly be wrong:
 * written as estimates, and shown as estimates in the game.
 */
const ESTIMATE = { BRN: "closed_autocracy", VAT: "closed_autocracy", MAC: "closed_autocracy" };
/** Changes since the scenario year (well documented, so corrected by hand). */
const MONARCHY_THEN = {
  2020: { BRB: true }, // Barbados became a republic on 30 November 2021
  1991: { BRB: true, MUS: true, NPL: true, KHM: false }, // Mauritius republic 1992, Nepal 2008; Cambodia's monarchy restored 1993
};

function apply(file, year) {
  const path = join(dataDir, file);
  const scenario = JSON.parse(readFileSync(path, "utf8"));
  let withData = 0;
  const missing = [];
  for (const [id, c] of Object.entries(scenario.countries)) {
    const code = HISTORICAL_SERIES[id] ?? CODE_ALIAS[id] ?? id;
    const regime = regimes.get(`${code}|${year}`) ?? null;
    c.regime = regime ?? ESTIMATE[id] ?? null;
    if (!regime && ESTIMATE[id]) c.regimeEstimated = true;
    else delete c.regimeEstimated;
    c.monarchy = MONARCHY_THEN[year]?.[id] ?? monarchiesToday.has(id);
    if (regime) withData++;
    else if (c.population) missing.push(id);
  }
  writeFileSync(path, JSON.stringify(scenario));
  console.log(`${file}: regime data for ${withData} countries in ${year}; estimated for ${missing.length} inhabited places without V-Dem data (mostly territories): ${missing.join(", ")}`);
}

apply("scenario-modern.json", 2020);
apply("scenario-cold-war-1991.json", 1991);
