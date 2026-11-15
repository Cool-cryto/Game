// Builds the game's map + country data from open datasets.
// Run with: npm run data -w @gs/web
//
// Inputs (npm packages):
//   world-atlas      Natural Earth admin-0 borders, 1:50m (public domain), TopoJSON
//   world-countries  country facts by Mohammed Le Doze (ODbL)
//   flag-icons       SVG flags (MIT)
// Outputs:
//   public/maps/world-50m.topo.json  map geometry, each shape tagged with a stable id
//   src/data/countries.json          country facts keyed by the same id
//   public/flags/*.svg               flags for every country we have
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { neighbors } from "topojson-client";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");

const topo = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
const facts = JSON.parse(readFileSync(require.resolve("world-countries/countries.json"), "utf8"));
const flagDir = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");

const byNumeric = new Map(facts.filter((c) => c.ccn3).map((c) => [c.ccn3, c]));
const byCca3 = new Map(facts.map((c) => [c.cca3, c]));

// Map shapes in Natural Earth that have no ISO numeric code.
// Kosovo exists in world-countries; the others are disputed or special areas
// that we keep on the map but mark clearly.
const SPECIAL = {
  Kosovo: { cca3: "UNK" },
  Somaliland: { id: "X-SML", kind: "disputed", note: "Self-declared state; internationally recognised as part of Somalia." },
  "N. Cyprus": { id: "X-NCY", kind: "disputed", note: "Recognised only by Turkey; internationally recognised as part of Cyprus." },
  "Siachen Glacier": { id: "X-SIA", kind: "disputed", note: "Glacier region disputed between India and Pakistan." },
  "Ashmore and Cartier Is.": { id: "X-ACI", kind: "territory", note: "Uninhabited islands, a territory of Australia." },
  "Indian Ocean Ter.": { id: "X-IOT", kind: "territory", note: "Christmas Island and the Cocos (Keeling) Islands, territories of Australia." },
};

const geoms = topo.objects.countries.geometries;
const countries = {};

for (const g of geoms) {
  const mapName = g.properties.name;
  const special = SPECIAL[mapName];
  let fact = g.id && !special?.id ? byNumeric.get(g.id) : undefined;
  if (!fact && special?.cca3) fact = byCca3.get(special.cca3);

  let id;
  let entry;
  if (fact) {
    id = fact.cca3;
    entry = {
      id,
      name: fact.name.common,
      officialName: fact.name.official,
      kind: fact.independent ? "sovereign" : "territory",
      cca2: fact.cca2,
      capital: fact.capital ?? [],
      region: fact.region,
      subregion: fact.subregion || null,
      areaKm2: fact.area > 0 ? fact.area : null,
      landlocked: fact.landlocked,
      unMember: fact.unMember,
      languages: Object.values(fact.languages ?? {}),
      currencies: Object.entries(fact.currencies ?? {}).map(([code, c]) => ({ code, name: c.name, symbol: c.symbol ?? null })),
      demonym: fact.demonyms?.eng?.m ?? null,
      borders: fact.borders ?? [],
      note: null,
    };
  } else if (special?.id) {
    id = special.id;
    entry = {
      id,
      name: mapName.replace("N. Cyprus", "Northern Cyprus").replace("Indian Ocean Ter.", "Australian Indian Ocean Territories").replace("Is.", "Islands"),
      officialName: null,
      kind: special.kind,
      cca2: null,
      capital: [],
      region: null,
      subregion: null,
      areaKm2: null,
      landlocked: null,
      unMember: false,
      languages: [],
      currencies: [],
      demonym: null,
      borders: [],
      note: special.note,
    };
  } else {
    throw new Error(`No country data for map shape "${mapName}" (id ${g.id}). Add it to SPECIAL.`);
  }

  if (countries[id]) throw new Error(`Duplicate id ${id} for "${mapName}"`);
  countries[id] = entry;
  g.id = id;
  g.properties = {};
}

// Only keep land borders that point at countries that exist on our map.
for (const c of Object.values(countries)) c.borders = c.borders.filter((b) => countries[b]);

// Give every country a color slot so that touching countries never share one
// (greedy graph coloring on shared borders).
const PALETTE_SIZE = 8;
const adj = neighbors(geoms);
const order = geoms.map((_, i) => i).sort((a, b) => adj[b].length - adj[a].length);
const slot = new Array(geoms.length).fill(-1);
for (const i of order) {
  const used = new Set(adj[i].map((j) => slot[j]));
  let s = 0;
  while (used.has(s)) s++;
  if (s >= PALETTE_SIZE) throw new Error("Palette too small for map coloring");
  slot[i] = s;
}
geoms.forEach((g, i) => (countries[g.id].colorSlot = slot[i]));

// Flags
mkdirSync(join(webRoot, "public", "flags"), { recursive: true });
let flags = 0;
for (const c of Object.values(countries)) {
  const src = c.cca2 && join(flagDir, `${c.cca2.toLowerCase()}.svg`);
  if (src && existsSync(src)) {
    copyFileSync(src, join(webRoot, "public", "flags", `${c.id}.svg`));
    c.hasFlag = true;
    flags++;
  } else c.hasFlag = false;
}

mkdirSync(join(webRoot, "public", "maps"), { recursive: true });
writeFileSync(join(webRoot, "public", "maps", "world-50m.topo.json"), JSON.stringify(topo));
const sorted = Object.fromEntries(Object.entries(countries).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(webRoot, "src", "data", "countries.json"), JSON.stringify(sorted, null, 1));

console.log(`Wrote ${Object.keys(countries).length} map regions, ${flags} flags.`);
