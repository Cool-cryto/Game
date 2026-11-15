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
