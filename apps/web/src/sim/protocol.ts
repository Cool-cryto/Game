import type { Command, GameState } from "@gs/sim";

/** Game speeds: in-game days per real second. Index 0 is unused (paused is separate). */
export const DAYS_PER_SECOND = [0, 1, 4, 15, 45, 120] as const;
export type Speed = 1 | 2 | 3 | 4 | 5;

export type SimRequest =
  | { type: "start"; state: GameState }
  | { type: "command"; command: Command }
  | { type: "setSpeed"; speed: Speed }
  | { type: "setPaused"; paused: boolean };

/** `paused` says whether the worker was paused when it sent this state. */
export type SimResponse = { type: "state"; state: GameState; errors: string[]; paused: boolean };
