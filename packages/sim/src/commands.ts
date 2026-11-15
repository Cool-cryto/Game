import type { CountryId } from "@gs/shared";
import { BUDGET_CATEGORIES, type BudgetCategory, type GameState } from "./state";

/**
 * Every change a player (or, later, an AI or a network client) makes to the
 * game is a command. Commands are checked, then applied at the start of the
 * next tick. Keeping this the only way in makes multiplayer possible later.
 */
export type Command =
  | { type: "claimCountry"; country: CountryId }
  | { type: "releaseCountry"; country: CountryId }
  | { type: "setTaxRate"; country: CountryId; value: number }
  | { type: "setBudget"; country: CountryId; category: BudgetCategory; value: number };

export const TAX_RANGE = [0.05, 0.6] as const;
export const BUDGET_RANGE = [0, 0.3] as const;

/** Returns null if the command is allowed, otherwise the reason it isn't. */
export function validateCommand(state: GameState, cmd: Command): string | null {
  const c = state.countries[cmd.country];
  if (!c) return `Unknown country ${cmd.country}`;
  if (!c.active) return `${cmd.country} has no economy to manage`;
  switch (cmd.type) {
    case "claimCountry":
    case "releaseCountry":
      return null;
    case "setTaxRate":
      if (!Number.isFinite(cmd.value) || cmd.value < TAX_RANGE[0] || cmd.value > TAX_RANGE[1]) return "Tax rate out of range";
      return null;
    case "setBudget":
      if (!BUDGET_CATEGORIES.includes(cmd.category)) return `Unknown budget category ${cmd.category}`;
      if (!Number.isFinite(cmd.value) || cmd.value < BUDGET_RANGE[0] || cmd.value > BUDGET_RANGE[1]) return "Budget out of range";
      return null;
  }
}

export function applyCommand(state: GameState, cmd: Command): string | null {
  const error = validateCommand(state, cmd);
  if (error) return error;
  const c = state.countries[cmd.country]!;
  switch (cmd.type) {
    case "claimCountry":
      // Single player: one human country at a time.
      for (const other of Object.values(state.countries)) if (other.controller === "human") other.controller = "ai";
      c.controller = "human";
      break;
    case "releaseCountry":
      c.controller = "ai";
      break;
    case "setTaxRate":
      c.taxRate = cmd.value;
      break;
    case "setBudget":
      c.budget[cmd.category] = cmd.value;
      break;
  }
  return null;
}
