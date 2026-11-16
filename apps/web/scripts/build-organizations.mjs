// Adds real international organizations and their members to the scenarios.
// Run after build-scenarios.mjs (npm run data -w @gs/web runs every step).
//
// Source: Wikidata (CC0), "member of" (P463) statements on countries, with their start (P580) and end (P582)
// dates, and each organization's inception (P571) and dissolution (P576). Downloaded into .cache/orgs on first
// run. Wikidata allows only a few queries a minute; a failed download says so, and running again later works.
//
// Only organizations whose Wikidata member lists checked out against well-documented membership are used.
// Some lists have mistakes or gaps (e.g. ASEAN's lists Australia, a dialogue partner, without dates; Mercosur's
// lists Mexico; the SADC list misses Comoros; the Andean Community's mixes in associate members), so:
//   - `undated: false`: only statements with a start date count (this drops the mistaken undated entries);
//   - organizations with gaps that dates can't fix are left out entirely rather than shown incomplete.
// What each kind of organization does in the game (economic / defense / political) is a game rule.
//
// Output: "organizations" on src/data/scenario-modern.json (2020-01-01) and src/data/scenario-cold-war-1991.json
// (1991-01-01): [{ id, name, kind, members }].
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, "..");
const dataDir = join(webRoot, "src", "data");
const cacheDir = join(webRoot, "..", "..", ".cache", "orgs");
const UA = "WorldAscendant-data-build/1.0 (game data build)";

/**
 * undated: whether member statements without a start date are trusted. Checked by hand for these: every undated
 * African Union entry is a member since before 2020; the undated ECOWAS entries are its 1975 founders; the undated
 * Arab League entry is Palestine (member since 1976); the undated CIS entries joined in December 1991.
 */
const ORGS = [
  { qid: "Q7184", id: "NATO", name: "NATO", kind: "defense", undated: false },
  // Before the European Union existed (1 Nov 1993), the same countries formed the European Communities; Wikidata's EU
  // membership statements carry the dates they joined the Communities.
  { qid: "Q458", id: "EU", name: "European Union", kind: "economic", undated: false, earlier: { id: "EC", name: "European Communities" } },
  { qid: "Q7768", id: "ASEAN", name: "ASEAN", kind: "economic", undated: false },
  { qid: "Q193272", id: "ECOWAS", name: "ECOWAS", kind: "economic", undated: true },
  { qid: "Q318693", id: "CSTO", name: "Collective Security Treaty Organization", kind: "defense", undated: false },
  { qid: "Q41644", id: "WARSAW", name: "Warsaw Pact", kind: "defense", undated: false },
  { qid: "Q7159", id: "AU", name: "African Union", kind: "political", undated: true },
  { qid: "Q7172", id: "ARAB", name: "Arab League", kind: "political", undated: true },
  { qid: "Q7779", id: "CIS", name: "Commonwealth of Independent States", kind: "political", undated: true },
];
/** Wikidata items that hold a country's memberships but have no ISO code of their own. */
const ITEM_ISO = { Q29999: "NLD", Q55: "NLD", Q756617: "DNK", Q35: "DNK" };

async function sparql(name, query) {
  mkdirSync(cacheDir, { recursive: true });
  const file = join(cacheDir, name);
  if (!existsSync(file)) {
    console.log(`Downloading ${name} from Wikidata…`);
    const res = await fetch("https://query.wikidata.org/sparql", {
      method: "POST",
      headers: { "user-agent": UA, accept: "application/sparql-results+json", "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ query }),
    });
    const text = await res.text();
    if (!res.ok || !text.startsWith("{")) throw new Error(`Wikidata refused the query for ${name} (${res.status}); it may be rate-limiting. Try again in a minute.`);
    writeFileSync(file, text);
  }
  return JSON.parse(readFileSync(file, "utf8")).results.bindings;
}

const values = ORGS.map((o) => `wd:${o.qid}`).join(" ");
const byIso = await sparql(
  "members.json",
  `SELECT ?org ?iso ?start ?end ?rank WHERE { VALUES ?org { ${values} } ?c p:P463 ?st . ?st ps:P463 ?org ; wikibase:rank ?rank . ?c wdt:P298 ?iso . OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } }`,
);
const byItem = await sparql(
  "kingdoms.json",
  `SELECT ?org ?c ?start ?end ?inception ?dissolved WHERE { VALUES ?org { ${values} } OPTIONAL { ?org wdt:P571 ?inception } OPTIONAL { ?org wdt:P576 ?dissolved } OPTIONAL { VALUES ?c { ${Object.keys(ITEM_ISO).map((q) => `wd:${q}`).join(" ")} } ?c p:P463 ?st . ?st ps:P463 ?org . OPTIONAL { ?st pq:P580 ?start } OPTIONAL { ?st pq:P582 ?end } } }`,
);

const qid = (uri) => uri.split("/").pop();
const day = (b, k) => (b[k] ? b[k].value.slice(0, 10) : null);
/** org qid → [{ iso, start, end }] */
const memberships = new Map(ORGS.map((o) => [o.qid, []]));
const dates = new Map();
for (const b of byIso) {
  if (b.rank.value.endsWith("DeprecatedRank")) continue;
  memberships.get(qid(b.org.value))?.push({ iso: b.iso.value, start: day(b, "start"), end: day(b, "end") });
}
for (const b of byItem) {
  const org = qid(b.org.value);
  dates.set(org, { inception: day(b, "inception"), dissolved: day(b, "dissolved") });
  if (b.c) memberships.get(org)?.push({ iso: ITEM_ISO[qid(b.c.value)], start: day(b, "start"), end: day(b, "end") });
}

function organizationsOn(date, countries) {
  const out = [];
  for (const o of ORGS) {
    const { inception, dissolved } = dates.get(o.qid) ?? {};
    if (dissolved && dissolved <= date) continue;
    const exists = !inception || inception <= date;
    if (!exists && !o.earlier) continue;
    const members = new Set();
    for (const m of memberships.get(o.qid)) {
      if (!m.start && !o.undated) continue;
      if (m.start && m.start > date) continue;
      if (m.end && m.end <= date) continue;
      if (countries[m.iso]?.population) members.add(m.iso);
    }
    if (members.size < 2) continue;
    const info = exists ? o : { ...o, ...o.earlier };
    out.push({ id: info.id, name: info.name, kind: o.kind, members: [...members].sort() });
  }
  return out;
}

function apply(file, date) {
  const path = join(dataDir, file);
  const scenario = JSON.parse(readFileSync(path, "utf8"));
  scenario.organizations = organizationsOn(date, scenario.countries);
  writeFileSync(path, JSON.stringify(scenario));
  console.log(`${file}: ${scenario.organizations.map((o) => `${o.name} ${o.members.length}`).join(", ")}`);
}

apply("scenario-modern.json", "2020-01-01");
apply("scenario-cold-war-1991.json", "1991-01-01");
