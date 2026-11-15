// Builds the game's map and starting data from open datasets.
// Run with: npm run data -w @gs/web   (downloads sources into .cache/ on first run)
//
// Sources (see public/maps/SOURCES.md):
//   Natural Earth v5.1.2: admin-1 provinces (1:10m), populated places (1:10m), admin-0 countries (1:50m). Public domain.
//   world-countries (mledoze/countries): country facts. ODbL.
//   flag-icons: SVG flags. MIT.
//
// Outputs:
//   public/maps/provinces-low.topo.json   simplified geometry for the zoomed-out view
//   public/maps/provinces-high.topo.json  detailed geometry for zoomed-in views
//   public/maps/cities.json               cities with province ids
//   public/flags/*.svg
//   src/data/countries.json               reference facts per country
//   src/data/provinces.json               reference facts per province
//   src/data/scenario-modern.json         modern-world starting state: province owners, population, GDP
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { geoArea, geoContains } from "d3-geo";
import { neighbors } from "topojson-client";
import mapshaper from "mapshaper";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const repoRoot = join(webRoot, "..", "..");
const cacheDir = join(repoRoot, ".cache", "ne");
const NE_BASE = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/";
const EARTH_RADIUS_KM = 6371.0088;

// Natural Earth country codes that differ from the ISO alpha-3 ids used in the game.
const CODE_MAP = {
  SDS: "SSD", // South Sudan
  SAH: "ESH", // Western Sahara
  KOS: "UNK", // Kosovo (world-countries uses UNK)
  PSX: "PSE", // Palestine
  ALD: "ALA", // Åland
  USG: "CUB", // Guantanamo Bay naval base: on Cuban territory, leased to the US
  KAB: "KAZ", // Baikonur Cosmodrome: in Kazakhstan, leased to Russia
  ESB: "X-SBA",
  WSB: "X-SBA",
  SOL: "X-SML",
  CYN: "X-NCY",
  KAS: "X-SIA",
  IOA: "X-IOT",
  CSI: "X-CSI",
  PGA: "X-SPR",
  CLP: "X-CLP",
  ATC: "X-ACI",
};

// Map regions with no entry in world-countries.
const SPECIAL = {
  "X-SBA": { name: "Akrotiri and Dhekelia", kind: "territory", region: "Asia", note: "British Sovereign Base Areas on Cyprus." },
  "X-SML": { name: "Somaliland", kind: "disputed", region: "Africa", note: "Self-declared state; internationally recognised as part of Somalia." },
  "X-NCY": { name: "Northern Cyprus", kind: "disputed", region: "Asia", note: "Recognised only by Turkey; internationally recognised as part of Cyprus." },
  "X-SIA": { name: "Siachen Glacier", kind: "disputed", region: "Asia", note: "Glacier region disputed between India and Pakistan." },
  "X-IOT": { name: "Australian Indian Ocean Territories", kind: "territory", region: "Oceania", note: "Christmas Island and the Cocos (Keeling) Islands, territories of Australia." },
  "X-CSI": { name: "Coral Sea Islands", kind: "territory", region: "Oceania", note: "Uninhabited islands, a territory of Australia." },
  "X-SPR": { name: "Spratly Islands", kind: "disputed", region: "Asia", note: "Claimed in whole or part by China, Taiwan, Vietnam, the Philippines, Malaysia and Brunei." },
  "X-CLP": { name: "Clipperton Island", kind: "territory", region: "Americas", note: "Uninhabited atoll, an overseas possession of France." },
  "X-ACI": { name: "Ashmore and Cartier Islands", kind: "territory", region: "Oceania", note: "Uninhabited islands, a territory of Australia." },
};

const countryIdOf = (neCode) => CODE_MAP[neCode] ?? neCode;

async function source(name) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, `${name}.geojson`);
  if (!existsSync(file)) {
    console.log(`Downloading ${name}…`);
    const res = await fetch(NE_BASE + name + ".geojson");
    if (!res.ok) throw new Error(`Download failed for ${name}: ${res.status}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return { file, data: JSON.parse(readFileSync(file, "utf8")) };
}

const admin1 = await source("ne_10m_admin_1_states_provinces");
const places = await source("ne_10m_populated_places_simple");
const admin0 = await source("ne_50m_admin_0_countries");
const facts = JSON.parse(readFileSync(require.resolve("world-countries/countries.json"), "utf8"));
const factsById = new Map(facts.map((c) => [c.cca3, c]));
const flagDir = join(dirname(require.resolve("flag-icons/package.json")), "flags", "4x3");

// ---------- Provinces ----------
const provinceFeatures = admin1.data.features;
const provincesPerCountry = {};
for (const f of provinceFeatures) {
  const c = countryIdOf(f.properties.adm0_a3);
  provincesPerCountry[c] = (provincesPerCountry[c] ?? 0) + 1;
}

const provinces = {};
const owners = {};
for (const f of provinceFeatures) {
  const p = f.properties;
  const id = p.adm1_code;
  const country = countryIdOf(p.adm0_a3);
  // Show English names (Bavaria, not Bayern); keep the local name and alternatives for search.
  let name = p.name_en ?? p.name ?? p.gn_name;
  if (!name) name = provincesPerCountry[country] === 1 ? p.admin : `${p.admin} (outlying islands)`;
  const localName = p.name && p.name !== name ? p.name : null;
  const altNames = [...new Set((p.name_alt ?? "").split("|").map((x) => x.trim()))].filter(
    (x) => x && x !== name && x !== localName && !x.includes("£"),
  );
  provinces[id] = {
    id,
    name,
    localName,
    altNames,
    type: p.type_en && p.type_en !== "null" ? p.type_en.split("|")[0] : null,
    iso: p.iso_3166_2 && /^[A-Z]{2}-[A-Z0-9]+$/.test(p.iso_3166_2) ? p.iso_3166_2 : null,
    areaKm2: Math.round(geoArea(f) * EARTH_RADIUS_KM ** 2),
    cityCount: 0,
  };
  owners[id] = country;
}

// Geometry: keep only the id, then simplify into two levels of detail with shared borders.
const slim = {
  type: "FeatureCollection",
  features: provinceFeatures.map((f) => ({ type: "Feature", properties: { id: f.properties.adm1_code }, geometry: f.geometry })),
};
const slimFile = join(cacheDir, "provinces-slim.geojson");
writeFileSync(slimFile, JSON.stringify(slim));
const mapsDir = join(webRoot, "public", "maps");
mkdirSync(mapsDir, { recursive: true });
for (const [level, pct] of [
  ["low", "3%"],
  ["high", "25%"],
]) {
  const out = join(mapsDir, `provinces-${level}.topo.json`);
  await mapshaper.runCommands(
    `-i "${slimFile}" name=provinces -simplify ${pct} keep-shapes -o "${out}" format=topojson quantization=100000 id-field=id`,
  );
  // mapshaper keeps the id as a property too; drop it to save space.
  const topo = JSON.parse(readFileSync(out, "utf8"));
  for (const g of topo.objects.provinces.geometries) delete g.properties;
  writeFileSync(out, JSON.stringify(topo));
}

// ---------- Cities ----------
const byCountry = new Map();
for (const f of provinceFeatures) {
  const c = countryIdOf(f.properties.adm0_a3);
  if (!byCountry.has(c)) byCountry.set(c, []);
  byCountry.get(c).push(f);
}
const inBox = (f, lon, lat) => !f.bbox || (lon >= f.bbox[0] && lon <= f.bbox[2] && lat >= f.bbox[1] && lat <= f.bbox[3]);
const cities = [];
let unplaced = 0;
for (const pf of places.data.features) {
  const p = pf.properties;
  const lon = +p.longitude.toFixed(4);
  const lat = +p.latitude.toFixed(4);
  const country = countryIdOf(p.adm0_a3);
  const candidates = byCountry.get(country) ?? provinceFeatures;
  let prov = candidates.find((f) => inBox(f, lon, lat) && geoContains(f, [lon, lat]));
  if (!prov) prov = provinceFeatures.find((f) => inBox(f, lon, lat) && geoContains(f, [lon, lat]));
  if (!prov) prov = candidates.find((f) => p.adm1name && f.properties.name === p.adm1name);
  if (!prov) {
    unplaced++;
    continue;
  }
  const provId = prov.properties.adm1_code;
  provinces[provId].cityCount++;
  cities.push({
    name: p.name,
    lon,
    lat,
    pop: Math.max(p.pop_max ?? 0, 0),
    cap: p.adm0cap === 1 ? 1 : 0,
    prov: provId,
  });
}
cities.sort((a, b) => b.pop - a.pop);
writeFileSync(join(mapsDir, "cities.json"), JSON.stringify(cities));

// ---------- Countries ----------
const countryIds = [...new Set(Object.values(owners))].sort();
const econ = new Map();
for (const f of admin0.data.features) {
  const p = f.properties;
  const id = countryIdOf(p.ADM0_A3);
  if (econ.has(id)) continue;
  // Antarctica has no permanent population; Natural Earth's research-station figures would
  // make it look like the richest place on Earth.
  if (id === "ATA") {
    econ.set(id, { population: null, gdpMillionUsd: null, economy: null, incomeGroup: null });
    continue;
  }
  econ.set(id, {
    population: p.POP_EST > 0 ? Math.round(p.POP_EST) : null,
    gdpMillionUsd: p.GDP_MD > 0 ? Math.round(p.GDP_MD) : null,
    economy: p.ECONOMY ? p.ECONOMY.replace(/^\d+\.\s*/, "") : null,
    incomeGroup: p.INCOME_GRP ? p.INCOME_GRP.replace(/^\d+\.\s*/, "") : null,
  });
}

const countries = {};
for (const id of countryIds) {
  const fact = factsById.get(id);
  const special = SPECIAL[id];
  if (fact) {
    countries[id] = {
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
  } else if (special) {
    countries[id] = {
      id,
      name: special.name,
      officialName: null,
      kind: special.kind,
      cca2: null,
      capital: [],
      region: special.region,
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
    throw new Error(`No country facts for "${id}". Add it to CODE_MAP or SPECIAL.`);
  }
  const e = econ.get(id);
  countries[id].economy = e?.economy ?? null;
  countries[id].incomeGroup = e?.incomeGroup ?? null;
}
for (const c of Object.values(countries)) c.borders = c.borders.filter((b) => countries[b]);

// Color slots: touching countries never share one (greedy coloring on the low-detail topology).
const low = JSON.parse(readFileSync(join(mapsDir, "provinces-low.topo.json"), "utf8"));
const geoms = low.objects.provinces.geometries;
const adjProv = neighbors(geoms);
const adj = new Map(countryIds.map((id) => [id, new Set()]));
geoms.forEach((g, i) => {
  for (const j of adjProv[i]) {
    const a = owners[g.id];
    const b = owners[geoms[j].id];
    if (a !== b) adj.get(a).add(b);
  }
});
const PALETTE_SIZE = 8;
const slot = {};
for (const id of [...countryIds].sort((a, b) => adj.get(b).size - adj.get(a).size)) {
  const used = new Set([...adj.get(id)].map((n) => slot[n]));
  let s = 0;
  while (used.has(s)) s++;
  if (s >= PALETTE_SIZE) throw new Error("Palette too small");
  slot[id] = s;
  countries[id].colorSlot = s;
}

// Flags
mkdirSync(join(webRoot, "public", "flags"), { recursive: true });
for (const c of Object.values(countries)) {
  const src = c.cca2 && join(flagDir, `${c.cca2.toLowerCase()}.svg`);
  c.hasFlag = Boolean(src && existsSync(src));
  if (c.hasFlag) copyFileSync(src, join(webRoot, "public", "flags", `${c.id}.svg`));
}

// ---------- Scenario: the modern world ----------
const scenario = {
  id: "modern",
  name: "Modern World",
  startDate: "2020-01-01",
  dataNote: "Population and GDP are Natural Earth estimates for 2019.",
  owners,
  countries: Object.fromEntries(
    countryIds.map((id) => [id, { population: econ.get(id)?.population ?? null, gdpMillionUsd: econ.get(id)?.gdpMillionUsd ?? null }]),
  ),
};

const dataDir = join(webRoot, "src", "data");
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(join(dataDir, "countries.json"), JSON.stringify(sortObj(countries)));
writeFileSync(join(dataDir, "provinces.json"), JSON.stringify(sortObj(provinces)));
writeFileSync(join(dataDir, "scenario-modern.json"), JSON.stringify(scenario));

console.log(
  `Wrote ${Object.keys(provinces).length} provinces, ${countryIds.length} countries, ${cities.length} cities (${unplaced} could not be placed).`,
);
