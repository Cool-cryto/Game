# World Ascendant (working title)

A grand strategy game that runs in the web browser, built in stages.

**Current stage: 1 — interactive world map.** See [docs/ROADMAP.md](docs/ROADMAP.md) for what exists and what comes next,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the project is put together.

## What works today

- World map with all 241 Natural Earth map regions: 193 sovereign states, 45 territories, 3 disputed regions
- Hover to see a name; click (or double-click to also zoom) to open an info panel with real-world facts and flag
- Zoom with the mouse wheel, pinch, the + / − buttons, or by choosing a country; drag to pan
- Search box for any country or territory
- Two map modes: Political and Continents
- Works on desktop and phone screens

Not built yet: provinces, cities, the 3D globe, any game simulation (economy, armies, AI), multiplayer.

## Running it on your computer

1. Install [Node.js](https://nodejs.org) version 22 or newer.
2. In a terminal, inside this folder, run `npm install` (downloads the libraries; first time only).
3. Run `npm run dev` and open http://localhost:5173 in your browser.

## Checking that everything works

- `npm test` runs the fast logic tests (map data, game clock).
- `npm run test:e2e` opens the game in a hidden browser and clicks through it like a player.
- `npm run typecheck` checks the code for type mistakes.

## Project layout

```
apps/web/         the game you see in the browser (React + TypeScript)
  scripts/        turns open map data into game data (npm run data -w @gs/web)
  public/maps/    map geometry       public/flags/  flag images
  src/map/        map drawing, zoom, clicks       src/ui/  panels, search, buttons
packages/sim/     the game rules engine (no browser code, so a server can run it later)
packages/shared/  types used by both
docs/             architecture and roadmap
```

## Credits

Borders: [Natural Earth](https://www.naturalearthdata.com) (public domain) via world-atlas ·
Country facts: [mledoze/countries](https://github.com/mledoze/countries) (ODbL) ·
Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
