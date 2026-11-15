import { applyCommand, type Command } from "./commands";
import { dateAt, SAVE_VERSION, type GameState } from "./state";
import { runMonthly } from "./systems";

/**
 * Advance the game by one day: apply queued commands, then run the monthly
 * systems if a new month has started. Returns any command errors.
 */
export function tick(state: GameState, commands: Command[] = []): string[] {
  const errors: string[] = [];
  for (const cmd of commands) {
    const err = applyCommand(state, cmd);
    if (err) errors.push(err);
  }
  state.tick += 1;
  if (dateAt(state.startDate, state.tick).endsWith("-01")) runMonthly(state);
  return errors;
}

export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

/** Load a save. Throws a readable error for anything that isn't a valid save of this version. */
export function deserialize(text: string): GameState {
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
  if (s.version !== SAVE_VERSION) {
    throw new Error(`This save is from an older version of the game (save format ${String(s.version)}, need ${SAVE_VERSION}).`);
  }
  return s as GameState;
}
