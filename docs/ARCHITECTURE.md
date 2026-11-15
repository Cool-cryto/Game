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

- Geometry is projected once (Equal Earth projection) into a fixed "world space"; zooming and panning are just a camera transform.
- Each region is a cached `Path2D`; only regions on screen are drawn, and only when something changes.
- Clicks use the canvas's exact point-in-shape test; when shapes overlap, the smallest wins (so enclaves like Lesotho can be clicked).
- Map modes are pure functions from a country to a color, so switching mode just recolors the map.
