# Roadmap

Each stage ends with something playable or viewable, and with tests.

## Stage 1: Interactive world map ✅ (current)

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

## Stage 2: Provinces, cities and detail
- Province/state geometry (Natural Earth admin-1) and major cities
- Higher-detail coastlines when zoomed in
- Country made of provinces; province info panel
- Starting game data per country (population, economy) from open, licensed sources

## Stage 3: Simulation core (single player)
- Game clock with pause and speed controls
- Economy, population, resources, government, infrastructure, technology
- Simulation running in a Web Worker; save and load

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
