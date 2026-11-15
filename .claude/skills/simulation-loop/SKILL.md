---
name: simulation-loop
description: How this grand strategy game's simulation works — the game clock and ticks, game state shape, systems (economy, population, diplomacy, war, AI), events, randomness and saving. Use when adding or changing game rules, systems, AI behavior, the game speed or pause controls, or save/load.
---

# Simulation loop

The simulation is the game's rules engine. It must be predictable, testable and separate from the UI.

## Core rules

- **Simulation code is plain TypeScript with no React, no DOM and no browser APIs.** It lives in `src/sim/`. The UI only reads state and sends commands.
- Game state is one serializable object (`GameState`) made of plain data: no classes with methods, no functions, no `Map`/`Set` unless converted when saving. This makes save/load and future multiplayer simple.
- Entities are stored in records keyed by id (`provinces: Record<ProvinceId, Province>`), not nested deep inside each other.
- Use strict TypeScript types for every part of the state. Branded id types (`ProvinceId`, `CountryId`) prevent mixing ids.

## The clock

- The game advances in fixed **ticks** (default: 1 tick = 1 in-game day).
- Game speed (pause, 1x–5x) controls how many ticks run per real second; it never changes what a tick does.
- Run ticks from a fixed-timestep loop driven by `requestAnimationFrame`; cap ticks per frame so a slow frame can't freeze the browser.
- Some systems run daily, others monthly or yearly. Schedule them by checking the date inside the tick, not with separate timers.

## Systems

- Each system is a function: `(state, ctx) => void` (mutating a draft, e.g. with Immer) or `(state, ctx) => GameState`. Pick one style and use it everywhere.
- Systems run in a fixed, documented order each tick, e.g.:
  1. apply player and AI commands
  2. economy
  3. population
  4. diplomacy
  5. war and movement
  6. events
- A system only changes its own part of the state where possible. Cross-system effects go through clearly named fields or events.

## Commands

- Players and AI change the game only by issuing **commands** (`{ type: "declareWar", by, target }`). Commands are validated, then applied at the start of the next tick.
- The same command path is used for the human player, AI and (later) multiplayer clients.

## Randomness

- Never use `Math.random()` inside the simulation. Use a seeded random number generator stored in the state, so the same seed and commands always give the same result. This makes bugs reproducible.

## AI

- AI reads the state and returns commands; it never edits state directly.
- Keep AI cheap: spread expensive decisions across ticks (e.g. each country re-plans monthly, staggered).

## Saving

- A save is `JSON.stringify(state)` plus a `version` number. When the state shape changes, add a migration from the old version.

## Performance

- Profile tick time; a tick should take well under the frame budget at max speed.
- If a tick gets too slow, move the simulation into a Web Worker. Keeping it DOM-free from the start makes this easy.

## Testing

- Unit-test every system with small hand-built states: "given this state, after one tick, expect that".
- Add a determinism test: run N ticks twice with the same seed and commands and check the states are identical.
- Add a long-run smoke test (e.g. 10 in-game years) that checks for crashes, `NaN` values and negative populations or money.
