# World Ascendant: grand-strategy overhaul

This file tracks the overhaul brief (November 2026): what the game already had, what was missing, and the stages
used to close the gap. The rule throughout: build on the existing game (never replace it), and only call a feature
done once it is connected to the simulation and tested.

## 1. Inspection (Stage 0)

**Stack.** TypeScript everywhere. `packages/sim` is the rules engine: plain data and no browser code, daily ticks,
commands, a seeded random generator and versioned saves. `apps/web` is React 19 + Vite, with a Canvas 2D map, a WebGL
globe and the simulation in a Web Worker. `apps/server` is a Node + `ws` server-authoritative multiplayer server
with SQLite. Before this overhaul there were 97 automated logic and server tests plus about 38 browser tests, all
passing, and no type errors.

**What the brief asks for vs. what existed**

| Area | Already working | Missing or weak |
|---|---|---|
| World map | 4,596 provinces in 248 countries, zoom/pan/WASD, hover and selection, borders that follow ownership, 2D and 3D, 12+ map modes, fog of war | Terrain map mode (no terrain data in the project); resource modes only cover food/energy/minerals |
| Country selection | Start screen with 12 suggested countries and difficulty labels; any country can be picked on the map | No search inside the start screen; difficulty is a label with no effect on the game |
| Country management | Taxes, four budget categories, national focus, laws, stability | Treasury never moves under the default budget (it spends exactly what it collects) |
| Economy | GDP growth with explanations, debt and interest, a world market for 3 resources, history sparklines | Oil, steel, aluminium, coal, iron, electricity and rare materials; income/expense ledger; trade balance per resource |
| Construction | Factories, railways, ports, forts; queue of 5; costs and build times | Farms, refineries, power plants, airports, bases, depots, radar, research labs; manual priority |
| Military | Armies, fleets, air wings; recruiting, upkeep, unit limits | Unit types (tanks, artillery…), equipment, training time, generals |
| Movement | Pathfinding, sea transport, railways, gliding markers, move preview | Terrain effects |
| Combat | Strength, technology, home ground, forts, air support, retreats | Terrain, weather, generals, supply, organisation |
| War and peace | Declarations, allies join, war score, capital falls, white peace or keeping occupied land, surrender | Reparations, puppets, partial demands, peace conference screen |
| Diplomacy | Relations, alliances, non-aggression pacts, trade, research, military access, real international organisations | Sanctions, economic and military aid, guarantees, puppets |
| Research | 3 branches, 18 technologies with real effects | Unit-type techs (once unit types exist) |
| Politics | Real government types, party blocs, elections, laws | Coups, revolutions, civil wars, regime change |
| AI | Budgets, recruiting, construction, treaties, alliances, rare wars, peace | Personalities; the world is very peaceful (0–1 wars in 20 years) |
| News | News feed with world/yours filter, toasts | Clicking news to jump to the country/province; sounds |
| Time | One clock in the engine | **Pause and speed controls were removed in Stage 16** |
| Save/load | 3 browser slots, export/import, migrations | **No autosave: refreshing the page loses the game** |
| Multiplayer | Server-authoritative, validated commands, fog-of-war per player, reconnect, AI takeover, room saving | — (already meets the brief) |
| Game modes | Modern world (2020), End of the Cold War (1991), world editor | Random world, sandbox settings, alternate starting alliances |
| Statistics | Rankings screen | Compare two countries; more ranking categories |

**Bugs found**
- Peace news after an annexation read "undefined made peace with …" (the loser was dropped from the war's lists
  before the message was written). Fixed in Stage A.
- An army took an undefended enemy province the moment it walked in, so territory could fall with no
  military process. Fixed in Stage A.
- Treasury stuck at exactly $0 under default policies. Planned for Stage C.
- Refreshing the page loses an unsaved game. Fixed in Stage B.

**Data honesty.** The project never invents real-world facts: where open data doesn't exist, values are game-generated
and labelled. Terrain needs a real land-cover or elevation source before it can affect movement and battles; new
resources (oil, steel…) would be game-generated deposits like the existing ones, and labelled the same way.

## 2. Stages

### Stage A — Clock and conquest ✅
- **Pause and 1x–4x speed** in single player: pause button, speed buttons, Space to pause and +/- to change speed.
  1x = 10.5 days a second, 2x = 21 (the old fixed pace, still the default), 3x = 42, 4x = 63. It is still one clock:
  the speed only changes how many days run per second, never what a day does. Online rooms keep the server's
  fixed pace.
- **Occupation takes time.** An army must stay in an undefended enemy province for 2–12 days to take it (bigger
  and better-connected provinces take longer), and forts add about 15 days of siege per level. Up to three armies
  together go three times as fast. An advancing army has to occupy each enemy province on its route before it can
  march on, but it can always fall back to friendly ground. Battles now include armies that are busy occupying.
- **War record.** Each war tracks losses per country (in full units' worth) and enemy provinces taken; the war card
  shows duration, losses and provinces taken for each side. Wars are sent whole to online players, so this works
  online too.
- Fixed the "undefined made peace" news.
- Tests: occupation timing, occupying along a route, war losses, the news fix, and an updated browser test for
  pause and speeds.

### Stage B — Saves and setup ✅
- **Autosave.** The single-player game is kept in the browser every 5 seconds, and again when the tab is hidden or
  closed. Reloading restores it automatically, with a "Welcome back" notice. Starting a new game clears the autosave.
  Online games are kept by the server and never autosaved locally.
- **Difficulty: Easy, Normal, Hard, Expert** (`DIFFICULTY_RULES` in `state.ts`, stored in `GameState.settings`, save
  version 9). It sets the player's starting cash and army money (once per country), how readily computer
  countries attack a *human* player (relations threshold, strength ratio, chance), and how much of its unit limit
  the AI keeps in peacetime. The AI never gets free money or units, and rules between two computer countries stay
  at Normal. The setting is chosen before you take a country (the `setDifficulty` command, which the server never
  accepts) and is locked afterwards.
- **Country selection screen.** Search every country; suggested countries when the search is empty; per-country
  population, GDP and rank, GDP per person, provinces and area, estimated military, unit limit, technology,
  government, capital, organisations and a "challenge" rating; the scenario's name, start date and data source;
  difficulty buttons with a plain-words summary; and a Start game button (double-clicking a country also starts).
  It opens by itself for first-time players, and anyone can open it from "Choose a country" in the top bar. Country
  panels have a difficulty choice next to "Play as".
- **Bugs fixed:**
  - Loading a game (from a slot, a file, or the autosave) could leave time stopped while the page showed it
    running: the store restarted the clock before `replace()` sent the worker its pause.
  - The flat map stayed on "Loading world map…" forever if ownership changed while the map was downloading (its
    finished shapes were thrown away).
  - The globe kept the old borders in the same situation.
- Tests: difficulty (starting money, locking, AI hostility towards humans, save upgrade from version 8) and browser
  tests for the selection screen and for autosave and restore.

### Stage C — Economy depth
An income and expense ledger (taxes, trade, upkeep, construction, research, interest) so the treasury moves; new
game-generated resources (oil, steel, aluminium, coal, iron, electricity, rare materials) that units and buildings
consume; more building types (farms, refineries, power plants, airports, bases, depots, research labs).

### Stage D — Military depth
Unit types (infantry, motorised, mechanised, tanks, artillery, AA, AT, special forces; fighters, bombers;
destroyers, cruisers, battleships, carriers, submarines), each with attack/defence/speed/organisation and
resource needs; recruitment with training time; generals; supply.

### Stage E — Diplomacy, politics, AI
Sanctions, aid, guarantees, puppets and reparations in peace deals; coups, revolutions and civil wars; AI
personalities (aggressive, defensive, economic, diplomatic, balanced) and a livelier but still balanced world.

### Stage F — Modes, stats, polish
Random world and sandbox settings, clickable news, country comparison and more leaderboards, terrain (once a data
source is chosen), balance passes and performance checks.
