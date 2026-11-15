# Roadmap

Each stage ends with something playable or viewable, and with tests.

## Stage 1: Interactive world map ✅

- [x] Project setup: workspaces, TypeScript, React, Vite, tests
- [x] World map with every country, territory and disputed region (241 regions, Natural Earth 1:50m)
- [x] Hover names, clickable countries, info panel with real-world facts and flags
- [x] Zoom and pan (wheel, pinch, buttons, double-click, search), labels that appear as you zoom
- [x] Search, Political and Continents map modes, phone layout
- [x] Simulation package skeleton: seeded randomness, game clock, save-friendly state (not connected to the UI yet)

Known limits of Stage 1:
- Coastlines are 1:50m detail, so they look rough at the deepest zoom levels.
- Countries are drawn as one shape each; there are no provinces or cities yet.
- Flat map only, so countries that cross the date line (Fiji, eastern Russia) are split at the map edge.
- Panel facts are real-world reference data, not game values.

## Stage 2: Provinces, cities and starting data ✅

- [x] 4,596 provinces (Natural Earth admin-1) as the map's building blocks; countries are drawn from the provinces they own
- [x] Two levels of detail: simplified borders zoomed out, detailed borders zoomed in, built in a background thread
- [x] 7,333 cities with population, capitals marked, shown progressively by zoom
- [x] Province panel; country panel with population, GDP, GDP per person, largest cities
- [x] Search across countries, provinces (English and local names) and cities
- [x] Population and Wealth map modes
- [x] Modern World scenario: province ownership + starting population/GDP, loaded into the game state

Known limits of Stage 2:
- Population and GDP are 2019 estimates (the newest in Natural Earth). Newer figures (e.g. World Bank, CC BY 4.0) can replace them later.
- Provinces have no population or economy yet; only countries do.
- Province detail varies by country (Natural Earth uses each country's own first-level divisions, from 1 to ~100 per country).
- Flat map only; countries crossing the date line are split at the map edge.

## Stage 3: Simulation core (single player) ✅ (current)

- [x] Game clock: daily ticks, monthly systems, pause and 5 speeds, running in a Web Worker
- [x] Economy: GDP growth with explained causes, taxes, budget (infrastructure, research, welfare, defense, fixed admin), treasury, debt and interest
- [x] Population growth by country (faster in poorer countries, slowed by hunger and unrest); province populations estimated at start
- [x] Resources: food, energy, minerals per province (game-generated deposits), world market for surpluses and shortfalls
- [x] Technology levels and research; province infrastructure built up by spending
- [x] Stability with explained causes
- [x] Play as any country; policy sliders; commands validated by the engine
- [x] Save/load (3 browser slots), export/import save files, save format versioning
- [x] New map modes: growth, stability, technology, density, infrastructure, resources
- [x] Tests: rules, determinism, save round-trip, a 20-year world run checked for believable growth

Known limits of Stage 3:
- Other countries don't make decisions yet (AI is Stage 4); they keep their starting policies.
- Government types are not modelled: there's no openly licensed dataset in the project yet, and inventing labels for real countries would be misleading.
- Province populations are estimates; resource deposits are game-generated, not real-world data.
- Rules are simple, tuned game rules, not economic forecasts. Example: Japan's population grows slowly instead of shrinking.
- Saves are stored in this browser only (use Export to keep a copy).

## Stage 4: Diplomacy, military and AI
- Relations, alliances, treaties, war and peace
- Armies, navies, air forces as strategic units
- AI countries that develop and act on their own

## Stage 5: 3D globe and renderer upgrade
- WebGL renderer, flat map / globe toggle

## Stage 6: Multiplayer
- Game server, accounts, private servers (up to 50 players), AI takeover on disconnect

## Stage 7: Worlds
- Persistent global world, historical scenarios, custom world editor
