import type { Command, GameState } from "@gs/sim";

export type SimRequest =
  | { type: "start"; state: GameState }
  | { type: "command"; command: Command }
  | { type: "setPaused"; paused: boolean };

/** `paused` says whether the worker was paused when it sent this state. */
export type SimResponse = { type: "state"; state: GameState; errors: string[]; paused: boolean };
