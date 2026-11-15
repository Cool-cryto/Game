# World Ascendant (working title)

A grand strategy game that runs in the web browser, built in stages.

**Current stage: 3 — simulation (single player).** See [docs/ROADMAP.md](docs/ROADMAP.md) for what exists and what comes next,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the project is put together.

## What works today

- World map of **4,596 provinces** in 248 countries, territories and disputed regions, with **7,333 cities**
- **Time**: starts 1 Jan 2020, paused. Play/pause (Space) and 5 speeds (keys 1–5, from 1 to 120 days per second)
- **Economy simulation**, updated on the 1st of every month for every country: GDP growth, taxes and spending,
  treasury and debt (with interest), stability, technology research, infrastructure, population growth,
  and food / energy / minerals with a world market (surplus is exported, shortfalls imported)
- **Play as any country**: set its tax rate and spending on infrastructure, research, welfare and defense,
  see the budget surplus or deficit, and see *why* growth and stability are moving
- **Save and load**: 3 save slots in the browser, plus export/import of save files
- **12 map modes**: Political, Continents, Population, Wealth, Economic growth, Stability, Technology,
  Population density, Infrastructure, Food, Energy, Minerals
- Search across countries, provinces and cities; works on desktop and phone screens

Not built yet: AI decisions (other countries keep their starting policies), government types, diplomacy,
armies/navies/air forces, war, the 3D globe, historical scenarios, multiplayer.

## How to play

1. Click a country (or search for it) and press **Play as …**.
2. Press **Play** (or Space) to start time; pick a speed with the bars next to the date.
3. In your country's panel, move the **Tax rate** and **Spending** sliders. Watch the surplus/deficit line.
   Research raises technology, infrastructure raises output, welfare raises stability. Debt costs interest.
4. Open **Why is GDP growing at this rate?** to see what helps and hurts your economy.
5. Use **Game → Save** to keep your progress.

## Running it on your computer

1. Install [Node.js](https://nodejs.org) version 22 or newer.
2. In a terminal, inside this folder, run `npm install` (downloads the libraries; first time only).
3. Run `npm run dev` and open http://localhost:5173 in your browser.

## Checking that everything works

- `npm test` runs the fast logic tests (map data, game rules, a 20-year simulation run).
- `npm run test:e2e` opens the game in a hidden browser and clicks through it like a player.
- `npm run typecheck` checks the code for type mistakes.

## Project layout

```
apps/web/         the game you see in the browser (React + TypeScript)
  scripts/        turns open map data into game data (npm run data -w @gs/web; downloads sources on first run)
  public/maps/    province geometry (two detail levels) and cities    public/flags/  flag images
  src/map/        map drawing, zoom, clicks, background map builder (world.worker.ts)
  src/ui/         panels, search, buttons     src/data/  country/province facts, modern-world scenario
  src/sim/        runs the game engine in a background thread (sim.worker.ts)
packages/sim/     the game rules engine: state, monthly systems, commands, save format (no browser code)
packages/shared/  types used by both
docs/             architecture and roadmap
```

## Credits

Provinces, cities, population and GDP: [Natural Earth](https://www.naturalearthdata.com) (public domain) ·
Country facts: [mledoze/countries](https://github.com/mledoze/countries) (ODbL) ·
Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
