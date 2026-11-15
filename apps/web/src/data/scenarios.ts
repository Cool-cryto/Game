import type { Scenario } from "@gs/shared";
import { applyCustomWorld, validateCustomWorld, type CustomWorld } from "@gs/sim";
import { MODERN_SCENARIO } from "./countries";

/**
 * The built-in starting worlds. The modern world is bundled (it's needed at
 * once); the others are loaded only when chosen, to keep the first download small.
 */
export interface ScenarioEntry {
  id: string;
  name: string;
  /** Shown as a tag next to the name. */
  year: string;
  description: string;
  load: () => Promise<Scenario>;
}

export const SCENARIOS: ScenarioEntry[] = [
  {
    id: "modern",
    name: MODERN_SCENARIO.name,
    year: MODERN_SCENARIO.startDate.slice(0, 4),
    description: "Today's countries and borders, with 2019 population and GDP.",
    load: async () => MODERN_SCENARIO,
  },
  {
    id: "cold-war-1991",
    name: "End of the Cold War",
    year: "1991",
    description: "The Soviet Union, Yugoslavia and Czechoslovakia still stand. World Bank figures for 1991.",
    load: async () => (await import("./scenario-cold-war-1991.json")).default as unknown as Scenario,
  },
];

export const scenarioById = (id: string) => SCENARIOS.find((s) => s.id === id);

/** Turn a custom world (from the editor or an imported file) into a playable scenario. Throws if it isn't valid. */
export async function scenarioFromCustom(world: unknown): Promise<Scenario> {
  const baseId = String((world as { base?: unknown } | null)?.base ?? "");
  const entry = scenarioById(baseId);
  if (!entry) throw new Error(world && typeof world === "object" ? `This world is based on a scenario this game doesn't have ("${baseId}").` : "This isn't a custom world file.");
  const base = await entry.load();
  const problem = validateCustomWorld(world, base);
  if (problem) throw new Error(problem);
  return applyCustomWorld(base, world as CustomWorld);
}
