import { applyCommand, type Command } from "./commands";
import { aiDaily, aiMonthly } from "./ai";
import { checkCapitulations, diplomacyMonthly } from "./diplomacy";
import { countryNeighbors, type Geography } from "./geography";
import { advanceMovement, advanceSieges, enforceUnitCaps, militaryMonthly, resolveBattles } from "./military";
import { dateAt, SAVE_VERSION, type GameState } from "./state";
import { runMonthly } from "./systems";
import { politicsMonthly, startingGovernment, type Regime } from "./government";
import { startingResearch } from "./tech";
import { constructionDaily } from "./construction";
import { expireProposals } from "./treaties";
import { startingOrganizations } from "./state";
import type { Scenario } from "@gs/shared";

/**
 * Advance the game by one day. Order:
 *   1. apply queued commands
 *   2. movement → battles → sieges → surrenders → construction → expired proposals
 *   3. AI war orders
 *   4. on the 1st of a month: economy and society, military upkeep, diplomacy, AI decisions
 * Returns any command errors.
 */
export function tick(state: GameState, geo: Geography, commands: Command[] = []): string[] {
  const errors: string[] = [];
  for (const cmd of commands) {
    const err = applyCommand(state, geo, cmd);
    if (err) errors.push(err);
  }
  advanceMovement(state, geo);
  resolveBattles(state, geo);
  advanceSieges(state);
  checkCapitulations(state);
  constructionDaily(state);
  expireProposals(state);
  aiDaily(state, geo);
  state.tick += 1;
  if (dateAt(state.startDate, state.tick).endsWith("-01")) {
    runMonthly(state);
    politicsMonthly(state);
    militaryMonthly(state);
    const neighbors = countryNeighbors(geo, (p) => state.provinces[p]?.owner);
    diplomacyMonthly(state, neighbors);
    aiMonthly(state, geo, neighbors);
  }
  enforceUnitCaps(state);
  return errors;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/**
 * Load a save. Throws a readable error for anything that isn't a valid save.
 * Saves from the previous version (4, before governments) are upgraded: pass the
 * scenario's countries so they get their real starting government.
 */
export function deserialize(
  text: string,
  scenarioCountries?: Record<string, { regime?: Regime | null; monarchy?: boolean }>,
  organizationsFor?: (scenarioId: string) => Scenario["organizations"] | undefined,
): GameState {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't a saved game.");
  }
  const s = data as Partial<GameState>;
  if (!s || typeof s !== "object" || typeof s.tick !== "number" || !s.countries || !s.provinces) {
    throw new Error("This file isn't a saved game.");
  }
  if ((s.version as number) === 4) {
    // Version 5 added governments.
    for (const c of Object.values(s.countries) as GameState["countries"][keyof GameState["countries"]][]) {
      c.government ??= startingGovernment(c.id, scenarioCountries?.[c.id], c.id.startsWith("C-"));
    }
    (s as { version: number }).version = 5;
  }
  if ((s.version as number) === 5) {
    // Version 6 split technology into research branches, all starting at the old level.
    for (const c of Object.values(s.countries) as GameState["countries"][keyof GameState["countries"]][]) {
      c.research ??= startingResearch(c.techLevel, c.researchProgress ?? 0);
    }
    (s as { version: number }).version = 6;
  }
  if ((s.version as number) === 6) {
    // Version 7 added construction.
    for (const c of Object.values(s.countries) as GameState["countries"][keyof GameState["countries"]][]) c.construction ??= [];
    (s as { version: number }).version = 7;
  }
  if ((s.version as number) === 7) {
    // Version 8 added treaties and international organizations: real ones as of the scenario's start, for the
    // countries still in the game (custom worlds and unknown scenarios start without any).
    s.treaties ??= [];
    s.proposals ??= [];
    s.organizations ??= startingOrganizations({ organizations: organizationsFor?.(s.scenarioId ?? "") }, s.countries);
    (s as { version: number }).version = 9;
  }
  if ((s.version as number) === 8) {
    // Version 9 added game settings (difficulty). Older games played at Normal, and their players already started.
    s.settings ??= {
      difficulty: "normal",
      started: Object.values(s.countries)
        .filter((c) => c.controller === "human")
        .map((c) => c.id),
    };
    (s as { version: number }).version = SAVE_VERSION;
  }
  if (s.version !== SAVE_VERSION) {
    throw new Error(`This save is from a different version of the game (save format ${String(s.version)}, need ${SAVE_VERSION}).`);
  }
  return s as GameState;
}
