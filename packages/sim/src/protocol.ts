import type { CountryId } from "@gs/shared";
import type { Command } from "./commands";
import type { CustomWorld } from "./custom";
import type { Patch } from "./net";
import type { GameState } from "./state";

/** Messages between the browser and the game server (JSON over a WebSocket). */

/** Private servers hold up to 50 players. */
export const MAX_PLAYERS_PER_ROOM = 50;
/** The global world is shared by everyone, so it allows more (limited by what one server process can handle). */
export const MAX_PLAYERS_GLOBAL = 200;
export const GLOBAL_ROOM_ID = "world";

export interface RoomSummary {
  id: string;
  name: string;
  /** Invite code (private rooms only, and only shown to members). */
  code: string | null;
  isPublic: boolean;
  players: number;
  online: number;
  maxPlayers: number;
}

export interface PlayerInfo {
  userId: number;
  name: string;
  country: CountryId | null;
  online: boolean;
  host: boolean;
}

export interface ChatMessage {
  from: string;
  text: string;
  at: number;
}

/** The standard pace (2x): in-game days per real second. Online rooms always run at this pace. */
export const GAME_DAYS_PER_SECOND = 21;

/** Single-player game speeds (1x-4x). One clock drives every system; speed only changes how many days run per second. */
export type GameSpeed = 1 | 2 | 3 | 4;
export const GAME_SPEEDS: GameSpeed[] = [1, 2, 3, 4];
export const SPEED_DAYS_PER_SECOND: Record<GameSpeed, number> = { 1: 10.5, 2: GAME_DAYS_PER_SECOND, 3: 42, 4: 63 };
export const DEFAULT_SPEED: GameSpeed = 2;

export interface Clock {
  paused: boolean;
  speed: 1 | 2 | 3 | 4 | 5;
  /** True if the speed is fixed by the server (the global world). */
  fixed: boolean;
}

export type ClientMessage =
  | { t: "auth"; token: string }
  | { t: "list" }
  /** Create a private server, from a built-in scenario (default "modern") or a custom world. */
  | { t: "create"; name: string; scenario?: string; custom?: CustomWorld }
  | { t: "join"; room: string } // a room id or an invite code
  | { t: "leave" }
  | { t: "claim"; country: CountryId }
  | { t: "release" }
  | { t: "cmd"; command: Command }
  | { t: "clock"; paused?: boolean; speed?: Clock["speed"] }
  | { t: "chat"; text: string };

export type ServerMessage =
  | { t: "welcome"; user: { id: number; username: string } }
  | { t: "rooms"; rooms: RoomSummary[] }
  | { t: "joined"; room: RoomSummary; state: GameState; players: PlayerInfo[]; clock: Clock; chat: ChatMessage[]; you: { country: CountryId | null; host: boolean } }
  | { t: "left" }
  | { t: "patch"; patch: Patch }
  | { t: "players"; players: PlayerInfo[] }
  | { t: "you"; country: CountryId | null; host: boolean }
  | { t: "clock"; clock: Clock }
  | { t: "chat"; message: ChatMessage }
  | { t: "error"; message: string };
