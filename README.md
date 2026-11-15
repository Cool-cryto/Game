# World Ascendant (working title)

A grand strategy game that runs in the web browser, built in stages.

**Current stage: 2 — provinces, cities and starting data.** See [docs/ROADMAP.md](docs/ROADMAP.md) for what exists and what comes next,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the project is put together.

## What works today

- World map built from **4,596 provinces** (states, regions, prefectures…) grouped into 248 countries, territories and disputed regions
- **7,333 cities**: capitals and big cities first, smaller towns appear as you zoom in
- Zoomed out you pick **countries**; zoomed in (3× and more) you pick **provinces**. More detailed borders load automatically when you zoom in
- Country panel: flag, real-world facts, **starting population and GDP** (Natural Earth 2019 estimates), largest cities, land borders
- Province panel: English and local name, owning country, area, cities
- Search across countries, provinces (English or local names) and cities
- Map modes: Political, Continents, Population, Wealth (GDP per person)
- Countries are drawn from the provinces they own, so when conquest arrives, borders redraw automatically
- Works on desktop and phone screens

Not built yet: the game simulation itself (time passing, economy, armies, AI), province-level population, the 3D globe, multiplayer.

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
  scripts/        turns open map data into game data (npm run data -w @gs/web; downloads sources on first run)
  public/maps/    province geometry (two detail levels) and cities    public/flags/  flag images
  src/map/        map drawing, zoom, clicks, background map builder (world.worker.ts)
  src/ui/         panels, search, buttons     src/data/  country/province facts, modern-world scenario
packages/sim/     the game rules engine (no browser code, so a server can run it later)
packages/shared/  types used by both
docs/             architecture and roadmap
```

## Credits

Provinces, cities, population and GDP: [Natural Earth](https://www.naturalearthdata.com) (public domain) ·
Country facts: [mledoze/countries](https://github.com/mledoze/countries) (ODbL) ·
Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
