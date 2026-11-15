# Architecture

## Technology stack

| Part | Choice | Why |
|---|---|---|
| Language | **TypeScript** everywhere | One language for browser, game rules and server. Types catch mistakes before the game runs. |
| UI | **React 19** + **Vite** | Most popular UI library with the biggest ecosystem; Vite gives instant reloads while developing. |
| UI state | **Zustand** | Tiny and simple: selected country, map mode, zoom. |
| Map (now) | **Canvas 2D** + **d3-geo** (projection) + **d3-zoom** (pan/zoom) | Fast enough for ~250 countries, no WebGL or map-tile server needed, and accurate click detection. |
| Map (later) | **WebGL renderer**. Leading candidate: **MapLibre GL JS** | Needed for thousands of provinces, city-level zoom and the 3D globe. MapLibre is open source and does flat map + globe in one engine. The renderer is kept behind `apps/web/src/map/` so swapping it doesn't touch the rest. |
| Game rules | **`@gs/sim`**, plain TypeScript, no browser code | The same code runs in the browser (single player, in a Web Worker) and on the server (multiplayer). |
| Server (later) | **Node.js + WebSockets**, likely the **Colyseus** framework | Colyseus provides game rooms, reconnection and state sync out of the box; it's TypeScript-native. |
| Database (later) | **PostgreSQL** (Supabase is a good hosted option) | Accounts, worlds, saved games. Redis is added only if one server is no longer enough. |
| Tests | **Vitest** (logic) + **Playwright** (real browser) | Logic is tested without a browser; Playwright clicks through the game like a player. |
| Hosting (later) | Static site host for the client; a long-running server host (e.g. Fly.io, Railway, a VPS) for game servers | Game servers keep WebSocket connections open, which serverless platforms don't do well. |

## Folder structure (npm workspaces)

```
apps/web          browser client: map, UI. Reads game state, sends commands.
packages/sim      game rules: state, clock, systems, AI. No DOM, no React, no network.
packages/shared   types shared by everything (ids, country info, later: commands and network messages)
apps/server       (later) multiplayer game server; imports @gs/sim
```

The rule that makes multiplayer possible later: **game rules never live in the UI**. The client only
(1) displays state and (2) sends commands.

## How the game will run

```
             commands                       state
  Player UI ─────────▶  Simulation (@gs/sim)  ─────────▶  Map + panels
  AI        ─────────▶   tick: day by day
```

- **State** is one plain, serializable object (`GameState`). Saving = `JSON.stringify(state)`.
- **Ticks**: the game advances one in-game day per tick. Game speed only changes how many ticks run per second.
- **Commands**: every change (build, declare war, move army) is a command like
  `{ type: "declareWar", by: "FRA", target: "DEU" }`. Commands are validated, then applied at the start of the next tick.
  Human players, AI and network players all use this same path.
- **Determinism**: randomness comes from a seeded generator stored in the state (`nextRandom`), never `Math.random()`.
  Same seed + same commands = same game. That makes bugs reproducible and saves small.
- **Provinces are the building blocks**: in a later stage each country becomes a set of provinces, and a country's
  shape is drawn from the provinces it owns. That's what makes conquest, historical scenarios (different
  owners, same provinces) and custom worlds possible.

## Multiplayer design (later stages)

**Server-authoritative.** The server runs the only "real" copy of the simulation. Clients send commands and
receive updates. Clients can't cheat by editing their own game, and 50 players never have to stay in perfect sync
with each other.

```
 Browser ──commands──▶ ┌──────────────── Game server (one room per world) ───────────────┐
 Browser ◀──updates─── │ validate command → queue → tick → send changed state to players │
 Browser               │ controller per country: human player | AI                       │
                       └──────────── snapshots + command log ──▶ PostgreSQL ──────────────┘
```

- **Rooms**: each world is a room. **Private servers** are rooms with an invite code and a cap of 50 players.
  The **global world** is one long-running room that never ends; it's saved regularly so a server restart loses nothing.
- **Controllers**: every country has a controller, either `{ human: playerId }` or `{ ai }`. When a player disconnects,
  the server waits a short grace period, then switches their country to AI. When they reconnect, control goes back to them.
  This works because AI and humans issue the same commands.
- **Updates**: after each tick the server sends only what changed (and, later, only what each player is allowed to see).
- **Speed**: the server owns the clock. In private servers the host chooses the speed; the global world runs at a fixed pace.
- **Persistence**: periodic snapshots of `GameState` plus the commands since the last snapshot, so a world can be restored exactly.
- **Single player** runs the same simulation in a Web Worker in the browser, so single player and multiplayer play by identical rules.

## Map rendering (current)

See `.claude/skills/map-rendering/SKILL.md` for the detailed rules. In short:

- **Provinces are the base geometry.** `scripts/build-world.mjs` turns Natural Earth admin-1 data into two TopoJSON
  files (simplified and detailed) that share borders exactly.
- **Countries are derived.** A background Web Worker (`src/map/world.worker.ts`) merges each country's provinces into one
  shape and works out the internal province borders. When ownership in the game state changes, the worker rebuilds the
  country shapes and the map redraws, so conquest and historical scenarios need no extra map data.
- Geometry is projected once (Equal Earth) into a fixed "world space"; zoom and pan are a camera transform.
- **Level of detail:** under 4× zoom the simplified layer is drawn; from 4× the detailed one (loaded in the background).
  Province borders fade in around 2–3×; from 3× the pointer selects provinces instead of countries.
- Only on-screen countries are drawn, and only when something changes. A frame takes about 1–3 ms to draw.
- Clicks use the canvas's exact point-in-shape test against province shapes; the province's owner gives the country.
- Map modes are pure functions from (country facts, country game state) to a color.

## Data flow

```
Natural Earth + world-countries ──build-world.mjs──▶ topology files, cities.json   (public/maps, fetched at runtime)
                                                  └▶ countries.json, provinces.json (reference facts, bundled)
                                                  └▶ scenario-modern.json ──createGameState()──▶ GameState
GameState.provinces[*].owner ──▶ map worker ──▶ country shapes ──▶ canvas
```

Reference facts (names, capitals, areas) never change during a game. Everything that can change (owners,
population, GDP) lives in `GameState`.

## Simulation (Stage 3)

```
 UI (React)            gameStore (zustand)           sim.worker.ts (background thread)
 sliders, buttons ──▶  send(command) ───────────────▶ queue ─▶ tick(state, commands)
                       setSpeed / setPaused ────────▶ clock: 1–120 days per second
 map, panels  ◀──────  state  ◀──── a few times a second (immediately while paused)
```

- `packages/sim/src/engine.ts` – `tick()`: apply queued commands, advance a day, run monthly systems on the 1st.
- `packages/sim/src/systems.ts` – monthly systems in fixed order: world resource market → economy → investment
  (infrastructure, research) → society (stability, population) → history. Growth and stability expose a
  breakdown so the UI can explain them.
- `packages/sim/src/commands.ts` – the only way to change the game: `claimCountry`, `setTaxRate`, `setBudget`.
  Every command is validated; invalid ones are reported, never applied.
- Saves are `JSON.stringify(GameState)` with a `version` number; loading an incompatible version gives a clear error.
  Browser saves use IndexedDB (saves are ~1–2 MB).
- The same engine will run on the multiplayer server later; the browser worker is the single-player host.

## Military, war and AI (Stage 4)

- `packages/sim/src/geography.ts` – fixed geography (neighbours, coasts, positions), distances, Dijkstra path-finding.
  Geography is passed to the engine (`tick(state, geo, commands)`) and is **not** part of saves.
- `packages/sim/src/military.ts` – units, recruiting, movement, battles, sieges, upkeep.
- `packages/sim/src/diplomacy.ts` – relations, alliances, wars, war score, peace, province transfer, surrender.
- `packages/sim/src/ai.ts` – monthly AI decisions (budget, forces, alliances, war, peace) and daily war orders.
- Daily order in `tick()`: commands → movement → battles → sieges → surrenders → AI war orders; monthly systems on the 1st.
- Players and AI use the same rules; acceptance rules (`wouldAcceptPeace`, `wouldAcceptAlliance`) are also used
  by the UI to show whether an offer would be accepted.
- Every province has an `owner` (de jure) and a `controller` (who holds it now). Peace treaties turn control into ownership.

## 3D globe (Stage 5)

```
globe.worker.ts ── province & country shapes in equirectangular space (4096×2048)
        │
GlobeView ── paints the texture (2D canvas) ──▶ GlobeRenderer (WebGL): full-screen shader,
        │                                         inverse orthographic projection → texture lookup
        └── 2D overlay canvas with d3.geoOrthographic (same projection): labels, units, outlines
```

- `apps/web/src/map/globe/globeRenderer.ts` – WebGL setup and the shader (no 3D library needed).
- `apps/web/src/map/globe/GlobeView.tsx` – camera (centre lon/lat + radius), input, texture painting, overlay, picking.
- `apps/web/src/map/overlay.ts` – unit markers, routes, battles and stripes, shared by both views.
- Picking on the globe: screen point → longitude/latitude (inverse projection) → equirectangular point → `isPointInPath`.
- The texture is repainted only when its content key changes (map mode, ownership, occupation, or a new month for data modes).

## Multiplayer server (Stage 6)

```
Browser ──HTTPS── /api/register, /api/login ──▶ auth.ts ──▶ SQLite (users, sessions)
Browser ──WebSocket /ws──▶ server.ts ──▶ Room (one per world)
   {auth}                                 ├─ runs @gs/sim: tick(state, geo, commands)
   {join, claim, cmd, clock, chat}        ├─ checks each command: right shape, sender's own country
   ◀── joined (snapshot), patch, players, ├─ hands offline players' countries to the AI after GRACE_MS
       clock, chat, error                 └─ StateDiffer → one patch per 250 ms for everyone
                                       SQLite (rooms: gzip'd GameState; members: who plays which country)
```

- `apps/server/src/server.ts` – HTTP (static client, account API, health), WebSocket routing, rate limits, room list, loops.
- `apps/server/src/room.ts` – one world: membership, claiming countries, command checks, host-only clock, AI takeover, chat.
- `packages/sim/src/net.ts` – `StateDiffer` and `applyPatch`: only changed countries' fields (rounded to 5 significant digits),
  provinces that changed noticeably (owner, controller, siege, infrastructure, >1% population), changed units, new events.
- `packages/sim/src/protocol.ts` – the message types, shared by client and server.
- `apps/web/src/net/online.ts` – the browser side: sign-in, reconnects, feeding snapshots/patches into the game store.
- Security: passwords hashed with scrypt; session tokens are random and stored only as SHA-256 hashes; sign-in attempts
  are limited per address; WebSocket messages are size- and rate-limited; commands are validated by the engine *and*
  checked to belong to the sender's country.

### Fog of war (Stage 8)

- `packages/sim/src/visibility.ts` – `visibleProvinces` (own/held land + 1 ring, units + 1 ring, air wings + 2, allies share),
  `fogView` (a copy of the state with hidden units removed, foreign routes cleared, unseen sieges cleared) and `visionIndex`
  (lookups shared by every viewer of one state).
- Server: the shared patch from `StateDiffer` no longer carries units (`{ units: false }`). Per update the room builds one
  `playerView` per country in play and, per connection, a `ViewSync` diff of units and sieges. The shared part of the
  message is serialized once and the per-player parts are appended.
- Browser: `apps/web/src/state/fog.ts` (`fogOf`) gives the map, globe and panels the fogged view and the visible provinces;
  the map draws a veil over the rest (one even-odd fill: the whole map minus visible provinces).

### Hosting

The server is one Node.js process with a SQLite file, so any host that runs a long-lived container with a persistent disk
works. `Dockerfile` builds the client and runs the server (`DATA_DIR=/data` on a volume); `railway.json` configures Railway.
Behind a host's proxy set `TRUST_PROXY=1` so the sign-in limit sees each player's address (`clientAddress` in server.ts).
The server pings every WebSocket every 25 s so proxies don't close quiet connections, and closes ones that stop answering.
Serverless platforms are not a good fit, because players keep a connection open. Step-by-step: [HOSTING.md](HOSTING.md).

### Paywall

- `apps/server/src/paywall.ts` – access rules (admins, `users.access` = `paid` | `granted`), Stripe Checkout through Stripe's
  REST API (no SDK), confirming a checkout when the player returns, and webhook signature checks. Off unless `PAYWALL=1`.
- `server.ts` – `/api/config`, `/api/me`, `/api/checkout`, `/api/checkout/confirm`, `/api/stripe/webhook`, `/api/admin/*`.
  The session also travels as an HttpOnly cookie so the browser can load `/maps/*`, which is refused without access;
  WebSocket sign-in is refused with code 4005; taking a pass away disconnects the player.
- Browser: `src/net/access.ts` decides between the game and the welcome menu (`src/ui/Welcome.tsx`); admins get
  Game menu → Free passes (`src/ui/AccessAdmin.tsx`). Without a game server (static page, development) the game simply opens.
- Limit: the game's code itself is public (only the map data is locked), so a determined person could rebuild the map
  from public sources to play single player. Online play can't be reached without access.

## Scenarios and custom worlds (Stage 7)

- A `Scenario` (packages/shared) is the starting data: province owners and populations, country population/GDP/income group.
- Built-in scenarios: `apps/web/src/data/scenarios.ts` (modern is bundled; others load on demand). The 1991 scenario is generated by
  `apps/web/scripts/build-scenarios.mjs` from the modern one plus World Bank data, merging today's countries into their 1991 states.
- `CustomWorld` (packages/sim/src/custom.ts) = base scenario id + changed province owners + new countries (name, color).
  `validateCustomWorld` checks it; `applyCustomWorld` turns it into a Scenario, moving each province's share of GDP with it.
- Countries that aren't in the modern facts (historical or custom) get facts from `historical-countries.json` or a generic
  entry (`registerStateCountries`). Custom countries' map color is stored on `CountryState.color`.
- The editor (`apps/web/src/state/editor.ts`) shows a preview game built from the draft; the real game is restored on close.
