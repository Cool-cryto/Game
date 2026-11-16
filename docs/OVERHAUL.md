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
- Treasury stuck at exactly $0 under default policies. Fixed in Stage C.
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

### Stage C — Economy depth ✅
- **Monthly ledger** (`CountryState.ledger`): taxes, trade, running the state, welfare, infrastructure, research,
  defense, interest and construction, plus the net change in the treasury. It is shown line by line on the Economy
  screen.
- **The treasury moves.** Sensible budgets (the default, and every national focus) keep 5% of the tax take as a
  reserve, so a country at peace slowly saves money. Trade now moves money too: resources have world prices, and the
  state keeps 30% of its trade balance (taxes on exporters, subsidies for importers), capped at ±2% of GDP a year so
  small countries with rich game-generated deposits can't get absurdly rich. The Resources & trade tab shows each
  resource's monthly value.
- **AI finances:** when savings pass 25% of GDP, the AI cuts taxes and invests more in infrastructure and research.
  In a 20-year world run, treasuries end between −34% and +25% of GDP (median +16%), and no country is below −50%.
- **Six new buildings, each changing an existing rule:**
  - Farms, power plants and mines (+15% food, energy or minerals per level).
  - Research facilities (+4% research speed per level, up to +40%).
  - Military bases (+50% recovery per level, and new armies start at full strength).
  - Airbases (+40% air-support range per level).
  The AI builds farms, power plants and mines when short of a resource, and research facilities now and then.
- Tests: the ledger adds up to the treasury change, the world market balances, the trade cap holds, every new
  building's effect, sane public finances over 20 years, and a browser check of the ledger.
- Not done in this stage (planned with Stage D, since they matter once units need equipment): oil, steel,
  aluminium and the other named resources.

### Stage D — Military depth ✅
- **22 unit types** (`packages/sim/src/units.ts`) inside the existing three branches:
  - Army: infantry, motorized, mechanized, tanks, heavy tanks, artillery, anti-air, anti-tank, special forces,
    paratroopers.
  - Air: fighters, heavy fighters, bombers, strategic bombers, naval bombers, transport aircraft.
  - Navy: destroyers, cruisers, battleships, carriers, submarines, transport ships.

  Each type has its own attack, defense, speed, price (upkeep follows), training time, the military research level
  that unlocks it, and whether it burns fuel.
- **Recruiting** picks a branch, type and quantity (1–10). New units train before they can move and defend at half
  strength meanwhile; a military base trains them 30% faster and to full strength.
- **Combat:**
  - Attackers use attack and defenders use defense.
  - Anti-tank units blunt enemy armour (up to −30%).
  - Submarines hit hard unless the enemy has destroyers.
  - Fuel-burning units fight at 60–100% depending on their country's energy supply.
  - Air support comes from each air wing's (and carrier's) own value, minus what enemy fighters and anti-air
    cancel (up to +60%).
  - Strategic bombers wear down enemy infrastructure every month.
  - Paratroopers can drop up to 1,200 km into enemy land if the country has transport aircraft.
  - Special forces occupy 50% faster.
- **Generals** (`generals.ts`): hire them (one, plus one per six units), put each in charge of a unit to lead its
  stack, or dismiss them. Skill (1–5) adds 4% per level. Traits:
  - offensive: +10% attack
  - defensive: +10% defense
  - logistics: faster movement and fewer fuel problems
  - armour: +15% for tanks
  - siege: +30% occupation speed

  Generals gain experience in battle and are promoted. Names are fictional.
- **AI:** recruits a mix of types as research allows, hires generals and puts them in charge of its biggest stacks.
  In a 20-year run it fielded infantry, artillery, tanks, mechanized, anti-air and anti-tank units; fighters,
  heavy fighters and bombers; destroyers, cruisers, submarines and battleships; and 68 generals.
- **Interface:**
  - Military: a recruitment panel with type cards, plus new Generals and Unit types tabs.
  - Forces lists show unit types and their general; unit panels show training and who leads the stack.
- Save version 10: old units become infantry, fighters and destroyers. Generals are synced to online players.
- **Bug fixed:** saves from version 7 skipped the version 8 upgrade (introduced in Stage B).
- Not yet: stockpiled equipment and the named resources (oil, steel, aluminium…); terrain and weather in battles
  (no terrain data yet).

### Stage E — Diplomacy, politics, AI ✅
- **AI personalities** (`personality.ts`): aggressive, defensive, economic, diplomatic or balanced. They are
  game-generated, weighted a little by the kind of government, and shown in country panels. Personality sets:
  - how readily a country goes to war (chance, strength ratio, hostility)
  - its peacetime army size
  - how often it builds, and whether it fortifies borders in peacetime
  - its friendliness (alliances, guarantees, aid)
  - how often rivalries flare with neighbours

  Difficulty still shifts behaviour towards human players on top of personality.
- **A livelier world:** in a 20-year run, 8 wars, 199 ownership changes, 8 puppet states, 5 sanctions and 59
  guarantees. Treasuries still stay between −39% and +73% of GDP, and GDP grows 3.43%/yr. The world was almost
  frozen before (0–1 wars).
- **Statecraft** (`statecraft.ts`), with buttons in every country panel:
  - Sanctions: −0.15% growth a year for the target (up to −1%) and −0.03% for the sanctioner; they end trade
    agreements and anger the target.
  - Economic and military aid: money or army funds; relations improve with what the aid means to them.
  - Guarantees of independence: the guarantor joins any war against the guaranteed country.

  The AI uses all three.
- **Peace conference.** Four kinds of terms, and for each the game shows whether a computer-run enemy would accept:
  - White peace.
  - Keep occupied land.
  - Reparations: the losers pay 5% of their GDP.
  - Puppet state: needs a crushing win. The puppet follows its overlord into war, can't declare war itself, and
    pays 10% of its taxes as tribute.

  AI winners choose terms by personality. Tribute and aid have their own ledger lines.
- **Political upheaval** (`upheaval.ts`), from long periods of very low stability:
  - Military coups: the government becomes military rule and elections stop.
  - Revolutions: an autocracy becomes a democracy.
  - Breakaway states: a region far from the capital declares independence as a new country ("Free …", with its
    own colour), takes the soldiers stationed there, and a civil war begins.

  The Government screen warns when a crisis is building.
- **Performance:** surrender-by-lost-land is checked every 5 days instead of daily (capitals are still checked
  daily). The 20-year run takes about 11.5 s, against a 30 s limit.
- Save version 11; sanctions and guarantees are synced to online players; new countries are registered in the
  browser as they appear.
- Tests: personalities, sanctions, aid, guarantees joining wars, reparations, puppets (tribute, following the
  overlord, no own wars), coups and revolutions, and a breakaway in the real modern world (Russia). Browser tests
  cover sanction and guarantee buttons and the peace conference.

### Stage F — Modes, stats, polish ✅
- **World setup** in New game (`modes.ts`), for any scenario or custom world:
  - Standard.
  - Alternate history: real alliances and organizations dissolved, neighbours start with random relations and
    alliances, and every country gets a new personality.
  - Random world: alternate history plus random deposits, treasuries, stability and technology, all labelled
    game-generated.

  Sandbox options work with any of them: starting money (half, normal, double, five times), computer countries
  (peaceful, normal, warlike) and political crises on or off. They are stored in `GameState.settings`.
- **Statistics:**
  - Rankings by 11 measures: GDP, military power, population, territory, industrial capacity, technology, naval
    strength, air strength, diplomatic influence, GDP per person and military spending, each with your rank and
    share of the world.
  - A Compare tab with two countries side by side, plus their GDP history.
- **News:** click a news item to go to the country it's about. Short alert tones (Web Audio, no files) play for
  wars, battles, peace, alliances and annexations involving you; switch them off under More → Settings.
- Tests: alternate and random worlds, sandbox money, crises switched off, and a browser test for a random world
  with sandbox money, the rankings and comparison.

## 3. What is still open

Each item below is a real gap, in no particular order:
- **Named resources** (oil, steel, aluminium, coal, iron, electricity, rare materials) and **equipment stockpiles**.
  Today there are food, energy and minerals; units burn fuel (energy).
- **Terrain and weather** effects on movement and battles, and a terrain map mode. These need a real land-cover or
  elevation data source, which the project doesn't have yet.
- **Supply lines**, beyond fuel and home-ground recovery.
- **More historical scenarios** (1914, 1936): they need historical borders and open economic data.
- **Fog-aware AI**: the AI still plans with full knowledge.
- **Online**: speed control for private-room hosts (rooms keep one pace), and difficulty/world setup for online
  rooms.
- **Balance**: military power follows population closely (unit limits come from population), so populous
  countries lead the military rankings; worth revisiting with equipment and resources.
