import type { ProvinceId } from "@gs/shared";
import { fogView, visibleProvinces, type GameState } from "@gs/sim";
import { GEOGRAPHY } from "../data/countries";
import { onlineCountry } from "../net/online";
import { playerCountry } from "./gameStore";
import { useUi } from "./uiStore";

/**
 * Fog of war in the browser. The map, globe and panels draw from `view`
 * instead of the full game so that foreign units outside your sight stay
 * hidden. Online, the server already sends only what you can see (this just
 * draws the veil); in single player the whole game is in this browser, and fog
 * can be switched off in the Game menu.
 */
export interface Fog {
  /** The game as you see it (the full game when fog is off). */
  view: GameState;
  /** Provinces you can see, or null when nothing is hidden. */
  visible: Set<ProvinceId> | null;
  /** Changes whenever `visible` changes, so the map knows to redraw its veil. */
  version: number;
}

let cache: { game: GameState; me: string | undefined; on: boolean; fog: Fog } | null = null;
let version = 0;

export function fogOf(game: GameState): Fog {
  const me = playerCountry(game)?.id;
  const on = onlineCountry() !== undefined || useUi.getState().fog;
  if (cache && cache.game === game && cache.me === me && cache.on === on) return cache.fog;
  let fog: Fog;
  if (!on || !me) fog = { view: game, visible: null, version: 0 };
  else {
    const visible = visibleProvinces(game, GEOGRAPHY, me);
    const prev = cache?.fog.visible;
    const same = !!prev && prev.size === visible.size && [...visible].every((p) => prev.has(p));
    fog = { view: fogView(game, GEOGRAPHY, me), visible, version: same ? cache!.fog.version : ++version };
  }
  cache = { game, me, on, fog };
  return fog;
}
