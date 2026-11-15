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

## Stage 3: Simulation core (single player) ✅

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

## Stage 4: Diplomacy, military and AI ✅

- [x] Province adjacency and coastlines from the map data; distances between provinces
- [x] Armies, fleets, air wings: recruit (defense fund), upkeep, reinforcement, population-based limit
- [x] Movement along province borders (path-finding), sea transport with a fleet, air rebasing
- [x] Battles (strength, technology, home ground, air support), retreats, sieges and occupation
- [x] Wars with alliances joining, war score, peace terms (white peace / hand over occupied provinces), surrender and annexation
- [x] Province transfers move population and GDP; the map redraws borders
- [x] Relations, improving relations, defensive alliances, AI and player peace offers
- [x] AI: budget adjustments, recruiting, alliances, rare wars against much weaker rivals, war movement, peace
- [x] News feed, Diplomacy and Wars map modes, occupation stripes, unit markers, battle icons, routes
- [x] Tests: movement, battles, sieges, surrender, peace, alliances; 20-year world run (wars happen, world stays stable)

Known limits of Stage 4:
- Starting militaries are estimates from defense budgets; countries start with no alliances (no reliable dataset in the project).
- Fleets don't fight each other and can't blockade; the AI doesn't plan sea invasions.
- AI wars are rule-based and fairly simple: it attacks neighbours only, and only when much stronger.
- Units are abstract ("army" ≈ a corps), not real formations.
- The news feed is hidden on screens narrower than 1100 px (important events still pop up).

## Stage 5: 3D globe ✅

- [x] WebGL globe: one shader draws the sphere from an equirectangular world texture, with lighting and an atmosphere glow
- [x] Texture painted from the province geometry (in a background worker): map-mode colors, borders, occupation stripes, graticule
- [x] 2D overlay in the same orthographic projection: labels, cities, unit markers, battles, routes, hover and selection outlines
- [x] Drag to rotate, wheel/pinch zoom, click/double-click/right-click like the flat map; search and camera buttons fly the globe
- [x] 2D/3D toggle (button or G); both views stay loaded so switching is instant
- [x] Performance: the texture is repainted only when what it shows changes (frames ~3–5 ms while time runs)
- [x] Tests for opening, switching, rotating, zooming, picking, search and phone layout

Decision: the flat map stays on Canvas 2D. Measurements show it draws in 1–3 ms per frame, so moving it to WebGL would add
complexity without a visible benefit. The globe is the part that needed WebGL.

Known limits of Stage 5:
- The globe texture is 4096×2048 (about 10 km per pixel), so it gets slightly soft at the deepest globe zoom (8×).
  For close-up work, the flat map zooms further and has more detailed borders.
- Province names are shown on the flat map only (the globe shows country and city names).
- A thin seam can appear in a narrow wedge directly behind the North or South Pole when looking from far above it.

## Stage 6: Multiplayer ✅

- [x] Game server (`apps/server`): Node.js, WebSockets (`ws`), built-in SQLite database; serves the web client too
- [x] Accounts: username + password (scrypt hashes), session tokens (stored hashed), sign-in rate limit
- [x] Rooms: one Global World (fixed speed, up to 200 players) and private servers (invite codes, up to 50 players, host controls time)
- [x] Server-authoritative: the server runs the engine; players send commands; every command is checked to be for the sender's own country
- [x] Sync: a full snapshot on join, then patches with only what changed (rounded numbers); ~0.1 KB/s per player at the global world's pace
- [x] AI takeover after 30 s offline; the player gets their country back on return
- [x] Rooms and players' countries saved to the database (every minute and on shutdown) and restored on restart
- [x] Chat, player list, invite codes, reconnecting automatically after a dropped connection
- [x] Tests: server integration tests (accounts, permissions, takeover, persistence, 50-player load) and two-browser end-to-end tests

Known limits of Stage 6:
- Running the server on the internet (so friends elsewhere can join) needs a host: see ARCHITECTURE.md → Hosting. Nothing is deployed yet.
- One server process hosts all rooms; for many busy rooms you'd add processes (not needed yet).
- No password reset or email; no moderation tools beyond the host owning private servers.
- Players see everything (no fog of war), so a modified client could show other countries' units (it still can't command them).
- Node's built-in SQLite prints an "experimental feature" warning when the server starts. It works; it's a notice from Node.

## Stage 7: Scenarios and custom worlds ✅ (current)

- [x] Scenario system: built-in scenarios load on demand; scenario name and data note travel with the game
- [x] End of the Cold War (1 January 1991): Soviet Union, Yugoslavia, Czechoslovakia; Eritrea in Ethiopia, South Sudan in Sudan,
      East Timor in Indonesia; World Bank 1991 population and GDP, with labelled estimates where figures are missing
- [x] World editor: create countries (name + color), paint one province or a whole country, pick a country from the map,
      undo, clear; save in the browser; export/import files; play; host online
- [x] Custom worlds are stored as changes to a base scenario; land carries its share of GDP to the new owner
- [x] Server: private servers can start from any scenario or a custom world (checked before use)
- [x] Land borders in country panels are worked out from the current map (follow conquests and custom worlds)
- [x] Tests: custom-world rules and validation, the 1991 world (borders, totals, 10-year run), server creation, browser tests

Known limits of Stage 7:
- Only one historical scenario so far. Earlier dates (e.g. 1936) need historical borders that don't follow today's provinces,
  and good open data for that period; see PROJECT.md.
- The 1991 map is simplified to today's province lines (e.g. Walvis Bay is shown as Namibian; Berlin was already reunited).
- The Soviet Union and Yugoslavia show a placeholder instead of a flag.
- The editor changes who owns land and creates countries; it can't yet edit economies, alliances, armies or the start date.
