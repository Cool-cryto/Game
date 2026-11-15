# Map data sources

| File | Source | License |
|---|---|---|
| world-50m.topo.json | Natural Earth admin-0 countries 1:50m, via the `world-atlas` npm package (v2.0.2) | Public domain |
| ../flags/*.svg | `flag-icons` npm package | MIT |
| src/data/countries.json | `world-countries` npm package (mledoze/countries) | ODbL 1.0 — attribution required, shown in the app footer |

Regenerate with `npm run data -w @gs/web`. Shape ids are ISO 3166-1 alpha-3 codes (e.g. `FRA`);
regions without one use `X-...` ids (see `SPECIAL` in `apps/web/scripts/build-countries.mjs`).

Note: Natural Earth draws de facto borders. Disputed areas are labelled as such in the info panel.
