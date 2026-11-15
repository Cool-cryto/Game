# World Ascendant (working title)

A grand strategy game that runs in the web browser, built in stages.

**Current stage: 6 — multiplayer.** See [docs/ROADMAP.md](docs/ROADMAP.md) for what exists and what comes next,
and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how the project is put together.

## What works today

- World map of **4,596 provinces** in 248 countries, territories and disputed regions, with **7,333 cities**
- **Time**: starts 1 Jan 2020, paused. Play/pause (Space) and 5 speeds (keys 1–5, from 1 to 120 days per second)
- **Economy**, monthly for every country: GDP growth, taxes and spending, treasury and debt, stability,
  technology, infrastructure, population, and food / energy / minerals with a world market
- **Military**: armies, fleets and air wings on the map. Recruit with your defense fund, pay upkeep,
  march along real province borders, ship armies overseas with a fleet, air wings support nearby battles
- **War**: declare war (the defender's allies join), battles, sieges and occupation (striped provinces),
  peace treaties that hand over occupied land, surrender and annexation; borders really change
- **Diplomacy**: relations from −100 to 100, improving relations, defensive alliances, peace offers
- **AI countries**: adjust taxes and spending, recruit forces, form alliances with friendly neighbours,
  occasionally attack much weaker rivals, fight their wars and make peace
- **News feed** of wars, battles, treaties and alliances; pop-ups for events involving you
- **Save and load**: 3 browser slots plus export/import of save files
- **14 map modes** including Diplomacy (relations with you) and Wars
- **3D globe**: switch between the flat map and a lit, rotating globe with the **2D/3D** button (or **G**).
  Everything works on both: colors and map modes, occupation, labels, cities, units, battles, routes,
  clicking, move orders. Drag to spin, wheel or pinch to zoom
- Search across countries, provinces and cities; works on desktop and phone screens

- **Multiplayer**: accounts, a shared **Global World**, and **private servers** for up to 50 players with invite codes.
  The server runs the game; you can only command your own country; the host controls time; chat; if you disconnect,
  the AI runs your country after 30 seconds until you return; games are saved on the server

Not built yet: government types, naval battles, trade deals, historical scenarios, custom worlds.

## How to play

1. Click a country (or search for it) and press **Play as …**.
2. Press **Play** (or Space) to start time; pick a speed with the bars next to the date.
3. **Economy**: in your country's panel, set the tax rate and spending. Defense spending fills your defense fund.
4. **Military**: in the Military section, click a group of units (or click a unit marker on the map), press
   **Move…**, then click a province, or right-click a province with your units selected. For tiny places,
   search for them and press **Send units here**. Recruit new units with the Army / Fleet / Air wing buttons.
5. **Diplomacy**: open another country to improve relations, propose an alliance or declare war.
6. **War**: march armies into enemy provinces to besiege and occupy them. In your panel's **Your wars** section,
   offer peace: demand the provinces you occupy, or a white peace. The button says whether they'd accept.
7. Use **Game → Save** to keep your progress.

## Playing online with friends

Online play needs the **game server** (it runs the shared world and stores accounts).

1. On the computer that will host: install Node.js 22+, then in this folder run `npm install` and `npm start`.
   This builds the game and starts the server at http://localhost:8787. Open it, press **Play online**, and create an account.
2. Choose **Global World**, or **Create** a private server and send the 6-letter invite code to friends.
3. Friends need to reach your server's address. On the same home network they can use your computer's local IP
   (for example http://192.168.1.20:8787). Over the internet, the server has to be hosted somewhere reachable:
   see "Hosting" in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

The single-player game (and the shared preview link) works without a server; online play then says so.

## Running it on your computer

1. Install [Node.js](https://nodejs.org) version 22 or newer.
2. In a terminal, inside this folder, run `npm install` (downloads the libraries; first time only).
3. Run `npm run dev` and open http://localhost:5173 in your browser (single player).
4. For online play while developing, also run `npm run dev:server` in a second terminal.

## Checking that everything works

- `npm test` runs the logic tests (map data, game rules, a 20-year simulation run) and the game server tests
  (accounts, rooms, permissions, AI takeover, saving, a 50-player load test).
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
apps/server/      the multiplayer game server (accounts, rooms, live sync, saving)
packages/sim/     the game rules engine: state, systems, commands, save format, network sync (no browser code)
packages/shared/  types used by both
docs/             architecture and roadmap
```

## Credits

Provinces, cities, population and GDP: [Natural Earth](https://www.naturalearthdata.com) (public domain) ·
Country facts: [mledoze/countries](https://github.com/mledoze/countries) (ODbL) ·
Flags: [flag-icons](https://github.com/lipis/flag-icons) (MIT)
