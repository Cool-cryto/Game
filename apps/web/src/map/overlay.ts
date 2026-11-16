// Drawing shared by the flat map and the globe: unit markers, routes, battles,
// occupation stripes, and the helpers that go with them. Each view supplies a
// `project` function that turns a province into a screen position (or null when
// it isn't visible, e.g. on the far side of the globe).
import type { CountryId, ProvinceId } from "@gs/shared";
import { atWar, GAME_DAYS_PER_SECOND, planMove, UNIT_STATS, type GameState, type Unit, type UnitType } from "@gs/sim";
import { COUNTRIES, GEOGRAPHY, getCountry } from "../data/countries";
import { useUi, type Selection } from "../state/uiStore";
import { MAP_MODES } from "./mapModes";

/** A country's map color (uses the game's own color for countries made in the world editor). */
export const politicalColor = (c: CountryId, game?: GameState) =>
  MAP_MODES.political.level === "country" ? MAP_MODES.political.color(c, { info: COUNTRIES[c], state: game?.countries[c] }) : "#888";

const stripeCache = new Map<string, HTMLCanvasElement>();
/** A diagonal-stripe fill (for occupied provinces). `k` is the current scale, so stripes keep their size on screen. */
export function stripes(ctx: CanvasRenderingContext2D, color: string, k = 1, size = 10): CanvasPattern | string {
  const key = `${color}|${size}`;
  let tile = stripeCache.get(key);
  if (!tile) {
    tile = document.createElement("canvas");
    tile.width = tile.height = size;
    const c = tile.getContext("2d")!;
    c.strokeStyle = color;
    c.lineWidth = size * 0.35;
    c.beginPath();
    for (const o of [-size, 0, size]) {
      c.moveTo(o, size);
      c.lineTo(o + size, 0);
    }
    c.stroke();
    stripeCache.set(key, tile);
  }
  const pattern = ctx.createPattern(tile, "repeat");
  if (!pattern) return color;
  if (k !== 1) pattern.setTransform(new DOMMatrix().scale(1 / k));
  return pattern;
}

export interface Stack {
  /** Where the units are (for moving units: the province they left). */
  province: ProvinceId;
  owner: CountryId;
  type: UnitType;
  units: Unit[];
  /** Screen position of the province (or of the moving units, between provinces). */
  x: number;
  y: number;
  moving: boolean;
}
export interface Marker {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  stack: Stack;
}

interface UnitsOverlayOptions {
  /** Screen position of a province, or null if it isn't visible. */
  project: (p: ProvinceId) => [number, number] | null;
  w: number;
  h: number;
  /** Zoom relative to the whole-world view. */
  zoom: number;
  game: GameState;
  me: CountryId | undefined;
  selected: Selection;
  moveOrder: { units: number[] } | null;
  /** Is time running? Moving units glide on between updates only while it is. */
  running: boolean;
}

// ---------- Smooth movement ----------
//
// The game moves units a day at a time (21 days a second) and the page hears about it a few times a second.
// To glide instead of jump, each moving unit keeps the progress it was last drawn at along its current leg,
// and creeps forward at the game's pace between updates (never more than a moment ahead of the real game).
const shown = new Map<number, { leg: string; progress: number; at: number }>();

/** How far along its current leg (0 = just left, 1 = arrived) a moving unit should be drawn. */
function legProgress(u: Unit, running: boolean, now: number): number {
  const t = u.travel!;
  const total = Math.max(1, t.total ?? t.daysLeft);
  const actual = Math.max(0, Math.min(1, 1 - t.daysLeft / total));
  const leg = `${u.province}>${u.path[0]}`;
  const last = shown.get(u.id);
  if (!last || last.leg !== leg) {
    shown.set(u.id, { leg, progress: actual, at: now });
    return actual;
  }
  const dt = Math.min(0.25, (now - last.at) / 1000);
  // Creep forward at the game's pace, but stay within half a second of the real position, and catch up if behind.
  const ahead = running ? last.progress + (dt * GAME_DAYS_PER_SECOND) / total : last.progress;
  const lead = (0.5 * GAME_DAYS_PER_SECOND) / total;
  let progress = Math.min(Math.max(ahead, actual), actual + lead, 1);
  if (progress < actual) progress = actual;
  last.progress = progress;
  last.at = now;
  return progress;
}

/** Draw unit stacks, routes and battles in screen space. Returns marker boxes for clicking, and whether anything is moving. */
export function drawUnitsOverlay(ctx: CanvasRenderingContext2D, o: UnitsOverlayOptions): { markers: Marker[]; animating: boolean } {
  const { project, w, h, zoom, game, me, selected, moveOrder, running } = o;
  const markers: Marker[] = [];
  const now = performance.now();
  let animating = false;

  // Group into stacks: one marker per country per kind of unit per place. Units on the move are drawn
  // between the two provinces of their current leg, grouped with others making the same move.
  const stacks = new Map<string, Stack>();
  const alive = new Set<number>();
  for (const u of Object.values(game.units)) {
    alive.add(u.id);
    const from = project(u.province);
    if (!from) continue;
    let x = from[0];
    let y = from[1];
    let key = `${u.province}|${u.owner}|${u.type}`;
    const moving = !!u.travel && u.path.length > 0;
    if (moving) {
      const to = project(u.path[0]!);
      if (to) {
        const f = legProgress(u, running, now);
        x += (to[0] - from[0]) * f;
        y += (to[1] - from[1]) * f;
        animating = animating || running;
        key = `${u.province}>${u.path[0]}|${u.owner}|${u.type}|${Math.round(f * 10)}`;
      }
    }
    let st = stacks.get(key);
    if (!st) stacks.set(key, (st = { province: u.province, owner: u.owner, type: u.type, units: [], x, y, moving }));
    st.units.push(u);
  }
  for (const id of shown.keys()) if (!alive.has(id)) shown.delete(id);

  // Routes of the player's moving units (the selected stack's more strongly), with an arrow and a ring
  // where they're going. One line per destination, not per unit.
  const selectedPlace = selected?.kind === "units" ? `${selected.province}|${selected.owner}` : null;
  for (const st of stacks.values()) {
    if (st.owner !== me || !st.moving) continue;
    const emphasised = `${st.province}|${st.owner}` === selectedPlace || (moveOrder?.units.some((id) => st.units.some((u) => u.id === id)) ?? false);
    const drawn = new Set<string>();
    for (const u of st.units) {
      if (!u.path.length) continue;
      const key = u.path.join(">");
      if (drawn.has(key)) continue;
      drawn.add(key);
      const pts: [number, number][] = [[st.x, st.y]];
      for (const p of u.path) {
        const pos = project(p);
        if (pos) pts.push(pos);
      }
      if (pts.length < 2) continue;
      const color = emphasised ? "#ffd678" : "rgba(255, 214, 120, 0.8)";
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
      // A dark edge under the line keeps it readable on any map color.
      ctx.lineWidth = emphasised ? 6 : 4.5;
      ctx.strokeStyle = "rgba(5, 10, 16, 0.55)";
      ctx.stroke();
      ctx.setLineDash([9, 6]);
      ctx.lineWidth = emphasised ? 3.5 : 2.5;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
      const [tx, ty] = pts[pts.length - 1]!;
      const [fx, fy] = pts[pts.length - 2]!;
      const a = Math.atan2(ty - fy, tx - fx);
      ctx.beginPath();
      ctx.moveTo(tx, ty);
      ctx.lineTo(tx - 13 * Math.cos(a - 0.45), ty - 13 * Math.sin(a - 0.45));
      ctx.lineTo(tx - 13 * Math.cos(a + 0.45), ty - 13 * Math.sin(a + 0.45));
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx, ty, 9, 0, Math.PI * 2);
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
    }
  }

  // Markers side by side where several share a spot. Zoomed out, only your own units and battles show.
  const bySpot = new Map<string, Stack[]>();
  for (const st of stacks.values()) {
    const k = st.moving ? `${Math.round(st.x / 30)}:${Math.round(st.y / 30)}` : st.province;
    if (!bySpot.has(k)) bySpot.set(k, []);
    bySpot.get(k)!.push(st);
  }
  for (const list of bySpot.values()) {
    const battle = list.some((a) => !a.moving && list.some((b) => a !== b && !b.moving && atWar(game, a.owner, b.owner)));
    const show = zoom >= 2.5 || battle || list.some((st) => st.owner === me) || moveOrder != null;
    if (!show) continue;
    list.sort((a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
    list.forEach((st, i) => {
      const x = st.x + (i - (list.length - 1) / 2) * 42;
      const y = st.y - 22;
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return;
      const isSelected = `${st.province}|${st.owner}` === selectedPlace && (!moveOrder || st.units.some((u) => moveOrder.units.includes(u.id)));
      drawMarker(ctx, game, st, x, y, st.owner === me, isSelected);
      markers.push({ x0: x - 20, y0: y - 16, x1: x + 20, y1: y + 18, stack: st });
    });
    if (battle) drawBattle(ctx, list[0]!.x, list[0]!.y - 52);
  }
  return { markers, animating };
}

const TYPE_ORDER: Record<UnitType, number> = { army: 0, air: 1, navy: 2 };

/** Unit markers are drawn at this size (1 = a 26×18 box). */
const S = 1.4;

/**
 * Each kind of unit has its own shape, so they're easy to tell apart at a glance:
 * armies a box with crossed lines, fleets a ship's hull, air wings a circle with a plane.
 */
function drawMarker(ctx: CanvasRenderingContext2D, game: GameState, st: Stack, x0: number, y0: number, mine: boolean, isSelected: boolean) {
  const strength = st.units.reduce((a, u) => a + u.strength, 0) / st.units.length;
  ctx.save();
  ctx.translate(x0, y0);
  ctx.scale(S, S);
  // Your own units glow a little, so they stand out from everyone else's.
  if (mine || isSelected) {
    ctx.shadowColor = isSelected ? "rgba(255, 214, 120, 0.9)" : "rgba(255, 255, 255, 0.55)";
    ctx.shadowBlur = isSelected ? 10 : 6;
  }
  ctx.beginPath();
  if (st.type === "army") ctx.roundRect(-13, -9, 26, 18, 3);
  else if (st.type === "navy") {
    // A hull: flat deck, pointed bow.
    ctx.moveTo(-13, -8);
    ctx.lineTo(9, -8);
    ctx.lineTo(14, 0);
    ctx.lineTo(9, 9);
    ctx.lineTo(-13, 9);
    ctx.closePath();
  } else ctx.arc(0, 0, 11, 0, Math.PI * 2);
  ctx.fillStyle = politicalColor(st.owner, game);
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowColor = "transparent";
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.strokeStyle = isSelected ? "#ffd678" : mine ? "#ffffff" : "rgba(5, 10, 16, 0.9)";
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (st.type === "army") {
    ctx.moveTo(-9, -5);
    ctx.lineTo(3, 5);
    ctx.moveTo(-9, 5);
    ctx.lineTo(3, -5);
    ctx.stroke();
  } else if (st.type === "navy") {
    // An anchor.
    ctx.moveTo(-4, -5);
    ctx.lineTo(-4, 5);
    ctx.moveTo(-8, 1);
    ctx.quadraticCurveTo(-4, 7, 0, 1);
    ctx.moveTo(-6.5, -3);
    ctx.lineTo(-1.5, -3);
    ctx.stroke();
  } else {
    // A plane seen from above.
    ctx.moveTo(-1, -8);
    ctx.lineTo(1, -8);
    ctx.lineTo(1.5, -2);
    ctx.lineTo(8, 1);
    ctx.lineTo(8, 3);
    ctx.lineTo(1.5, 1.5);
    ctx.lineTo(1, 6);
    ctx.lineTo(3.5, 8);
    ctx.lineTo(-3.5, 8);
    ctx.lineTo(-1, 6);
    ctx.lineTo(-1.5, 1.5);
    ctx.lineTo(-8, 3);
    ctx.lineTo(-8, 1);
    ctx.lineTo(-1.5, -2);
    ctx.closePath();
    ctx.fill();
  }
  // How many: a small badge in the corner.
  if (st.units.length > 1 || st.type === "army") {
    ctx.font = "700 9px Inter, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#fff";
    const bx = st.type === "army" ? 8.5 : 9;
    const by = st.type === "army" ? 0.5 : -8;
    if (st.type !== "army") {
      ctx.beginPath();
      ctx.arc(bx, by, 5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(5,10,16,0.9)";
      ctx.fill();
      ctx.fillStyle = "#fff";
    }
    ctx.fillText(String(st.units.length), bx, by + 0.5);
  }
  // Strength bar.
  ctx.fillStyle = "rgba(5,10,16,0.85)";
  ctx.fillRect(-13, 12, 26, 3);
  ctx.fillStyle = strength > 60 ? "#7fd39a" : strength > 30 ? "#e8c25a" : "#f08a7a";
  ctx.fillRect(-13, 12, (26 * strength) / 100, 3);
  ctx.restore();
}

function drawBattle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 12, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(200, 50, 40, 0.92)";
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1.8;
  ctx.beginPath();
  ctx.moveTo(x - 5, y - 5);
  ctx.lineTo(x + 5, y + 5);
  ctx.moveTo(x + 5, y - 5);
  ctx.lineTo(x - 5, y + 5);
  ctx.stroke();
}

/**
 * Clicking a unit marker selects it; clicking your own also gets them ready to move, so the next click on the
 * map sends them there. Clicking the same units again (while they wait for an order) cancels.
 */
export function clickMarker(marker: Marker, me: CountryId | undefined) {
  const ui = useUi.getState();
  const st = marker.stack;
  if (ui.moveOrder && st.units.some((u) => ui.moveOrder!.units.includes(u.id))) return ui.setMoveOrder(null);
  ui.select({ kind: "units", province: st.province, owner: st.owner });
  ui.setMoveOrder(st.owner === me ? { units: st.units.map((u) => u.id) } : null);
}

export const markerAt = (markers: Marker[], x: number, y: number) =>
  [...markers].reverse().find((m) => x >= m.x0 && x <= m.x1 && y >= m.y0 && y <= m.y1);

/** "2 armies, 1 fleet · France" */
export function stackLabel(st: Stack): string {
  const counts = { army: 0, navy: 0, air: 0 };
  for (const u of st.units) counts[u.type]++;
  const plural = { army: "armies", navy: "fleets", air: "air wings" };
  const parts = (["army", "navy", "air"] as const)
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${counts[k] > 1 ? plural[k] : UNIT_STATS[k].label.toLowerCase()}`);
  return `${parts.join(", ")} · ${getCountry(st.owner)?.name ?? st.owner}`;
}

/** What would happen if the units in the current move order were sent to this province? */
export function previewMove(game: GameState, order: { units: number[] } | null, province: ProvinceId | null): string | null {
  if (!order || !province) return null;
  const u = game.units[order.units[0]!];
  if (!u) return null;
  const plan = planMove(game, GEOGRAPHY, u, province);
  return "error" in plan ? plan.error : `Move here (${plan.mode === "land" ? "march" : plan.mode === "sea" ? "by sea" : "fly"})`;
}
