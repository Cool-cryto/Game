# World Ascendant — Project Overview

> Working title. A grand strategy game that runs in the web browser: the whole Earth, every country, economies,
> militaries, diplomacy, AI countries, single player and multiplayer. Inspired by the genre of Roblox's *Conquer the
> World*, but an original game (no copied name, art, maps or rules).

This document is the single place to see **what we set out to build, what exists today, how it works, and what is
still left**. It is written for a beginner: technical terms are explained the first time they appear.

- Code: GitHub `Cool-cryto/Game`, branch `claude/browser-game-skills-gq45g9`
- More detail: [README.md](README.md) (how to run and play), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (how it's built),
  [docs/HOSTING.md](docs/HOSTING.md) (putting it online),
  [docs/ROADMAP.md](docs/ROADMAP.md) (stage checklists), [apps/web/public/maps/SOURCES.md](apps/web/public/maps/SOURCES.md) (data sources)

---

## 1. The original brief

What was asked for at the start, and where each item stands today.

| Requirement | Status | Where it lives |
|---|---|---|
| Full interactive Earth map with every country, territory and island | ✅ Done | 4,596 provinces in 248 countries/territories/disputed areas |
| Clickable countries with detailed information panels | ✅ Done | Country and province panels |
| Zoom from the world down to provinces and cities | ✅ Done | Two detail levels, 7,333 cities |
| Modern world | ✅ Done | Modern World scenario (start 2020) |
| Historical scenarios | 🟡 One so far | End of the Cold War (1991). More need more data (see §7) |
| Custom worlds | ✅ Done | World editor: paint provinces, create countries, save/share/play/host |
| Economies | ✅ Done | GDP, taxes, budgets, debt, growth with explanations |
| Governments | ✅ Done | Real government types (V-Dem + Wikidata), party blocs, laws, elections |
| Populations | ✅ Done | Country and province populations that grow over time |
| Resources | ✅ Done | Food, energy, minerals with a world market (deposits are game-generated) |
| Technology | ✅ Done | Technology levels from research spending |
| Infrastructure | ✅ Done | Per-province infrastructure from spending |
| Diplomacy | ✅ Done | Relations, alliances, peace deals |
| Armies, navies and air forces as strategic units | ✅ Done | Recruit, move, fight, besiege; fleets carry armies; air support |
| AI countries that develop and interact independently | ✅ Done | Rule-based AI for economy, military, alliances, war and peace |
| Single player | ✅ Done | Runs fully in the browser |
| Multiplayer | ✅ Done | Game server with accounts and rooms |
| One global multiplayer world | ✅ Done | "Global World" room, fixed speed |
| Private servers for up to 50 players | ✅ Done | Invite codes, host controls time |
| AI takes over when a player disconnects | ✅ Done | After 30 s; player gets the country back on return |
| Modern interface with 2D map and 3D globe | ✅ Done | Flat map + WebGL globe, 2D/3D toggle |
| Fog of war (not in the brief; added in Stage 8) | ✅ Done | Players only see nearby foreign forces; the server only sends what each player can see |
| Build in stages, test the work, be honest about what's unfinished | ✅ Ongoing | 8 stages, ~100 automated tests, limits listed below |

Also agreed at the start: add useful **Claude Code skills** for the project (see §9), and later add backend, database
and multiplayer skills.

---

## 2. Technology choices (and why)

| Part | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for browser, game rules and server; catches mistakes early |
| Interface | **React 19 + Vite** | Popular, fast to develop with |
| UI state | **Zustand** | Small and simple |
| Flat map | **Canvas 2D + d3-geo + d3-zoom** | Draws a frame in 1–3 ms; accurate clicking; no map service needed |
| 3D globe | **WebGL** with one custom shader | No 3D library needed; overlay lines up pixel-perfectly with d3 |
| Game rules | **`packages/sim`**, plain TypeScript, no browser code | The same engine runs in the browser (single player) and on the server (multiplayer) |
| Background work | **Web Workers** | Map building and the simulation never freeze the page |
| Server | **Node.js + `ws` (WebSockets)** | Live two-way connection; small and well known |
| Database | **SQLite built into Node** (`node:sqlite`) | No extra database server to run; one file |
| Tests | **Vitest** (logic, server) + **Playwright** (real browser) | Logic tests are fast; browser tests click through the game like a player |

Decisions made along the way (with reasons):

- **Server-authoritative multiplayer.** The server runs the only real copy of the game; players send *commands*. This
  stops cheating by editing your own copy and keeps 50 players in sync.
- **Same command path for humans, AI and network players.** Every change is a command that the engine checks.
- **Countries are made of provinces.** A country's shape is drawn from the provinces it owns, so conquest, historical
  scenarios and custom worlds need no extra map data.
- **Flat map stays Canvas 2D.** The roadmap first said "WebGL for everything", but measurements showed the flat map is
  already fast; only the globe needed WebGL.
- **Plain `ws` instead of the Colyseus framework.** Our own small protocol fits the existing command system and keeps
  dependencies low.
- **No invented real-world facts.** Where no reliable open data exists (government types, real armies, alliances,
  resource deposits) the game either leaves the feature out or clearly labels values as game-generated or estimated.

---

## 3. How the project is organised

```
apps/web/          the game in the browser (React + TypeScript)
  scripts/         build-world.mjs (map + modern data), build-scenarios.mjs (1991 scenario)
  public/maps/     province shapes (2 detail levels), cities        public/flags/  flag images
  src/map/         flat map, globe (src/map/globe), shared unit drawing (overlay.ts), map modes
  src/ui/          panels, menus, editor, online dialogs              src/data/  facts, scenarios, geography
  src/sim/         runs the engine in a background thread             src/net/   online connection
  src/state/       game store, UI store, saves, editor, custom worlds
  tests/e2e/       browser tests (single player, online)
apps/server/       multiplayer game server (accounts, rooms, sync, saving) + tests
packages/sim/      game engine: state, economy, military, diplomacy, AI, commands, saves, network sync, custom worlds
packages/shared/   types shared by everything
docs/              ARCHITECTURE.md, ROADMAP.md
.claude/skills/    project guides for Claude Code (map-rendering, simulation-loop, multiplayer-server)
```

How a game runs:

```
Player / AI / network ──commands──▶ engine (tick = 1 day)
                                     daily:   movement → battles → sieges → surrenders → AI war orders
                                     monthly: world market → economy → infrastructure & research → stability & population
                                              → military upkeep → diplomacy → AI decisions
                                   ◀──state── map, globe and panels
```

---

## 4. The stages: what was planned and what was built

### Stage 1 — Interactive world map ✅
Planned: tech stack, multiplayer-ready architecture, project setup, a clickable, zoomable world map with a modern interface.
Built: workspaces, React/Vite/TypeScript, a Canvas world map (241 regions), hover names, country panel with flags and
facts, zoom/pan/search, Political and Continents modes, phone layout, engine skeleton, tests.

### Stage 2 — Provinces, cities and starting data ✅
Built: 4,596 provinces as the building blocks; countries merged from provinces in a background worker; two levels of
detail; 7,333 cities; province panel; search across countries/provinces/cities (English and local names); Population
and Wealth modes; modern-world population and GDP (2019).

### Stage 3 — Simulation core ✅
Built: game clock (pause, 5 speeds), monthly economy (GDP growth with explanations, taxes, budget, debt and interest),
population, game-generated resources with a world market, technology, infrastructure, stability; play as any country
with policy sliders; save/load (3 browser slots, export/import); 12 map modes.

### Stage 4 — Military, war, diplomacy and AI ✅
Built: province adjacency and coastlines; armies, fleets, air wings (recruit, upkeep, reinforce, population-based
limit); movement with path-finding and sea transport; battles (technology, home ground, air support), retreats,
sieges and occupation; wars with allies joining, war score, white peace or handing over occupied land, surrender and
annexation; relations and alliances; AI for budgets, recruiting, alliances, rare wars, fighting and peace; news feed;
Diplomacy and Wars map modes.

### Stage 5 — 3D globe ✅
Built: WebGL globe (lighting, atmosphere) with the same map colours, borders, occupation, labels, cities, units, battles
and routes as the flat map; drag/zoom/pinch; clicking and move orders; 2D/3D toggle (button or G).

### Stage 6 — Multiplayer ✅
Built: game server; accounts (hashed passwords and tokens, sign-in rate limit); Global World (fixed speed, up to 200
players) and private servers (invite codes, up to 50 players, host controls time); every command checked to be for the
sender's own country; snapshot + small patches (≈0.1 KB/s per player at the global pace); AI takeover after 30 s; rooms
saved and restored; chat; auto-reconnect.

### Stage 7 — Scenarios and custom worlds ✅
Built: scenario system; **End of the Cold War (1991)** with the Soviet Union, Yugoslavia and Czechoslovakia and World Bank
1991 figures; **world editor** (create countries, paint provinces or whole countries, pick from map, undo, save in
browser, export/import, play, host online); server support for scenarios and custom worlds; borders computed from the
live map.

### Stage 11 — Government & elections ✅ (current)
Built: every country starts with its real kind of government for the scenario's year: V-Dem "Regimes of the World"
(liberal democracy, electoral democracy, electoral autocracy, closed autocracy; CC BY-SA 4.0) plus monarchy or republic
from Wikidata (CC0), giving types such as constitutional monarchy, absolute monarchy or one-party rule. Four party blocs
(Left, Centre, Right, Nationalist) with game-generated popularity that follows the economy, taxes, war and stability;
elections every four years (free in democracies, managed in electoral autocracies, none in closed autocracies) and
early elections; laws for conscription (raises the unit limit), the economic system and the press, each with
trade-offs and a cooldown. Government feeds growth, stability, research and the unit limit; the AI adjusts conscription
for war and peace and newly elected AI governments nudge policy. Government screen (overview, parties & elections, laws,
stability), a Government map mode, government in country panels. Old saves and server rooms upgrade automatically.

### Stage 10 — Top navigation ✅
Built: a permanent top navigation (World, Country, Economy, Military, Diplomacy, Government, Research, Construction,
Statistics, More) with search, Play online and Settings on the right; an information bar with flag, treasury, rank,
date, pause and speed; one management screen at a time, each with tabs, tooltips and "Back to map"; the map keeps its
map-mode menu, legend and zoom. Every screen uses the systems that exist; parties/laws/elections, the technology tree,
buildings, equipment, treaties/organizations and intelligence are clearly labelled as coming later. Responsive from
phones (navigation on its own row) to wide screens, never overlapping. The Simple/Advanced switch is gone: each screen
shows the essentials first, with detailed controls in their own tabs; map panels have "Show all details".

### Stage 9 — Simple mode ✅
Built: the game starts simple. A start screen (goal, suggested countries with difficulty, short guide); three buttons
(My country, Army, World) with plain-language panels; a national focus and Low/Normal/High taxes instead of five
sliders (always a balanced budget); one-click Attack and Make peace; a world rank as the score; short country and
province panels ("Show all details" for more); only the political map. Your country is locked in once chosen. Everything
from before is under Game → Options → **Advanced controls**.

### Stage 8 — Fog of war ✅
Built: vision rules (your land and the next province over, around your units, further for air wings, shared with
allies); foreign units out of sight, foreign routes and unseen sieges are hidden; the server sends each player only what
their country can see (closing the "modified client can see everything" gap); the map and globe darken what you can't
see; on/off switch for single player (Game → Options). Also fixed: two files the game needs (`scenarios.ts` and the 1991
data) had never been uploaded to GitHub, so a fresh download didn't build.

---

## 5. Data sources and licences

| Data | Source | Licence |
|---|---|---|
| Province borders, cities, modern population and GDP (2019) | Natural Earth v5.1.2 | Public domain |
| Country facts (capitals, languages, currencies…) | mledoze/countries (`world-countries`) | ODbL (credited in the game) |
| Flags | `flag-icons` | MIT |
| 1991 population | World Bank, via github.com/datasets/population | Public domain (ODC-PDDL) |
| 1991 GDP | World Bank, via github.com/datasets/gdp | CC BY 4.0 (credited in the game) |
| Kind of government (1991, 2020) | V-Dem Regimes of the World, via Our World in Data | CC BY-SA 4.0 (credited in the game) |
| Monarchy or republic | Wikidata | CC0 |

Estimated or game-generated (always labelled in the game):
- Province populations (split from country totals by cities and land).
- Resource deposits (food, energy, minerals) — game-generated, not real data.
- Starting militaries — sized from defense budgets, not real armies.
- Party blocs and their popularity, starting laws and election dates — game-generated; ~60 small places without V-Dem
  data have an estimated kind of government (labelled).
- 1991 GDP for 48 places with no World Bank figure (mostly territories, plus e.g. the Baltic states, Belarus, Iran).

---

## 6. Testing and quality

Run `npm test` (logic + server) and `npm run test:e2e` (browser). At the end of Stage 8:

| Suite | Tests | Covers |
|---|---|---|
| Engine (`packages/sim`) | 36 | Economy rules, military, war, diplomacy, saves, network sync, fog of war, custom worlds, 1991 world, 20-year world run |
| Map data (`apps/web`) | 11 | Province/country data integrity, colors, cities, search, border redraws |
| Server (`apps/server`) | 12 | Accounts, rooms, permissions, fog of war, AI takeover, persistence, scenarios, 50-player load |
| Browser (Playwright) | 38 | Map, search, panels, time, policies, saves, war to annexation, fog of war, globe, two-player online, editor |

Performance measured along the way: flat map frame 1–3 ms; globe frame 3–5 ms while time runs; 20 game years of the
whole world simulate in ~8 s; server step ≤ 60 ms with 50 players at top speed.

Real bugs found by tests and fixed (examples): world population shrinking (no trade), rich economies stalling (supply
not keeping pace), map not loading from a subfolder, AI never starting wars, unfair war score for small countries,
clicking Monaco hitting France, the globe stuttering, a second online player seeing another's country as theirs,
bandwidth 5× too high, and an editor race that wiped a newly created country.

---

## 7. What is still left to build

### Next steps (recommended order)
0. **Systems the new screens are waiting for** (each screen already has its place): a technology tree; buildings (factories, railways, ports); equipment; treaties and organizations;
   intelligence.
1. **Hosting on the internet** so friends anywhere can play online. Needs an account with a host that runs a long-lived
   Node.js app with a persistent disk (e.g. Fly.io, Railway, Render or a small VPS) and HTTPS. Steps are in
   [docs/HOSTING.md](docs/HOSTING.md). The project is ready to deploy (Dockerfile, Railway settings, proxy-safe sign-in
   limit, connection keep-alive). *Waiting on: you creating a hosting account.*
2. **Changing the kind of government**: reforms, coups and revolutions (governments, parties, laws and elections exist).
3. **Naval warfare**: fleet battles, blockades, AI sea invasions.
4. **More historical scenarios** (e.g. 1936, 1914). These need historical borders that don't follow today's provinces and
   reliable open economic data for those years; the project currently has neither.

### Gameplay ideas not yet started
- Trade agreements and sanctions; resource-specific deals
- Victory screen when you reach #1 (simple mode already shows your world rank)
- Province buildings (factories, ports, fortifications) and a local economy per province
- Events and decisions (elections, crises, disasters)
- Smarter AI (planning, coalitions, naval invasions, adapting to the player), and an AI that respects fog of war
- Unit types beyond army/fleet/air wing (armour, artillery, missiles), supply lines, terrain effects
- Peace deals with more options (money, puppets, partial land)
- Editor: edit economies, alliances, armies and start date; rename/recolour existing countries
- Victory conditions and score screens

### Paywall (built, switched off until you turn it on)
- A $5 one-time purchase through Stripe, or a free pass you give to a username; a welcome menu explains the game first.
  Server-enforced (map data and online play are locked). Setup: [docs/HOSTING.md](docs/HOSTING.md) → "The $5 paywall".

### Platform and polish
- Accounts: password reset (needs email), account deletion, moderation tools (kick/ban in private servers)
- Several server processes for many busy rooms
- Flags for countries that no longer exist (Soviet Union, Yugoslavia)
- Province names on the globe; higher-detail globe texture at deep zoom
- Accessibility review (keyboard-only map control, screen readers) and translations
- Smaller first download (bundled province data ≈ 300 KB compressed)
- Update the modern scenario to newer figures (World Bank 2023)

### Known limits today
- Online play only works where the game server runs (not from the static preview link).
- The AI still sees everything; news items mention battles anywhere in the world.
- The 1991 map is simplified to today's province lines.
- Starting militaries, resource deposits and province populations are estimates or game-generated.
- Rules are tuned game rules, not forecasts (e.g. Japan's population grows slightly).
- Node's built-in SQLite prints an "experimental" notice when the server starts; it works.

---

## 8. How to run it

```
npm install          # once
npm run dev          # single player at http://localhost:5173
npm run dev:server   # (second terminal) online play while developing
npm start            # build + run the game server at http://localhost:8787 (single and multiplayer)
npm test             # logic and server tests
npm run test:e2e     # browser tests
npm run data -w @gs/web   # rebuild map and scenario data from the sources
```

---

## 9. Claude Code skills for this project

Installed / created during the project:
- **frontend-design** (Anthropic, from the plugin directory) — interface design guidance (install card was offered at the start).
- **map-rendering** (project guide) — rules for the map and globe.
- **simulation-loop** (project guide) — rules for the game engine.
- **multiplayer-server** (project guide) — security and sync rules for online play.
Planned: an end-to-end test generator plugin; backend, database and hosting skills when we work on hosting.

---

*Last updated at the end of Stage 8.*
