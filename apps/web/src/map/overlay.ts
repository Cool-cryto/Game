// Drawing shared by the flat map and the globe: unit markers, routes, battles,
// occupation stripes, and the helpers that go with them. Each view supplies a
// `project` function that turns a province into a screen position (or null when
// it isn't visible, e.g. on the far side of the globe).
import type { CountryId, ProvinceId } from "@gs/shared";
import { atWar, planMove, UNIT_STATS, type GameState, type Unit } from "@gs/sim";
import { COUNTRIES, GEOGRAPHY, getCountry } from "../data/countries";
import type { Selection } from "../state/uiStore";
import { MAP_MODES } from "./mapModes";

export const politicalColor = (c: CountryId) =>
  MAP_MODES.political.level === "country" ? MAP_MODES.political.color(c, { info: COUNTRIES[c], state: undefined }) : "#888";

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
  province: ProvinceId;
  owner: CountryId;
  units: Unit[];
  x: number;
  y: number;
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
}

/** Draw unit stacks, routes and battles in screen space. Returns marker boxes for clicking. */
export function drawUnitsOverlay(ctx: CanvasRenderingContext2D, o: UnitsOverlayOptions): Marker[] {
  const { project, w, h, zoom, game, me, selected, moveOrder } = o;
  const markers: Marker[] = [];

  // Group into stacks: one marker per country per province.
  const stacks = new Map<string, Stack>();
  for (const u of Object.values(game.units)) {
    const k = `${u.province}|${u.owner}`;
    let st = stacks.get(k);
    if (!st) {
      const pos = project(u.province);
      if (!pos) continue;
      stacks.set(k, (st = { province: u.province, owner: u.owner, units: [], x: pos[0], y: pos[1] }));
    }
    st.units.push(u);
  }

  // Routes of the player's moving units (the selected stack's more strongly).
  const selectedStack = selected?.kind === "units" ? `${selected.province}|${selected.owner}` : null;
  for (const st of stacks.values()) {
    if (st.owner !== me) continue;
    const emphasised = `${st.province}|${st.owner}` === selectedStack;
    for (const u of st.units) {
      if (!u.path.length) continue;
      ctx.beginPath();
      ctx.moveTo(st.x, st.y);
      for (const p of u.path) {
        const pos = project(p);
        if (pos) ctx.lineTo(pos[0], pos[1]);
      }
      ctx.setLineDash([6, 5]);
      ctx.lineWidth = emphasised ? 2.5 : 1.5;
      ctx.strokeStyle = emphasised ? "#ffd678" : "rgba(255, 214, 120, 0.6)";
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  const byProvince = new Map<ProvinceId, Stack[]>();
  for (const st of stacks.values()) {
    if (!byProvince.has(st.province)) byProvince.set(st.province, []);
    byProvince.get(st.province)!.push(st);
  }

  // Zoomed out, show only your own units and battles, to keep the map readable.
  for (const [province, list] of byProvince) {
    const battle = list.some((a) => list.some((b) => a !== b && atWar(game, a.owner, b.owner)));
    const show = zoom >= 2.5 || battle || list.some((st) => st.owner === me) || moveOrder != null;
    if (!show) continue;
    list.forEach((st, i) => {
      const x = st.x + (i - (list.length - 1) / 2) * 30;
      const y = st.y - 18;
      if (x < -30 || y < -30 || x > w + 30 || y > h + 30) return;
      drawMarker(ctx, st, x, y, st.owner === me, `${province}|${st.owner}` === selectedStack);
      markers.push({ x0: x - 14, y0: y - 10, x1: x + 14, y1: y + 10, stack: st });
    });
    if (battle) drawBattle(ctx, list[0]!.x, list[0]!.y - 38);
  }
  return markers;
}

function drawMarker(ctx: CanvasRenderingContext2D, st: Stack, x: number, y: number, mine: boolean, isSelected: boolean) {
  const counts = { army: 0, navy: 0, air: 0 };
  for (const u of st.units) counts[u.type]++;
  const main = (["army", "navy", "air"] as const).reduce((a, b) => (counts[b] > counts[a] ? b : a));
  const strength = st.units.reduce((a, u) => a + u.strength, 0) / st.units.length;
  ctx.beginPath();
  ctx.roundRect(x - 13, y - 9, 26, 18, 3);
  ctx.fillStyle = politicalColor(st.owner);
  ctx.fill();
  ctx.lineWidth = isSelected ? 2.5 : 1.5;
  ctx.strokeStyle = isSelected ? "#ffd678" : mine ? "#ffffff" : "rgba(5, 10, 16, 0.9)";
  ctx.stroke();
  // Unit symbol, in the style of military map symbols.
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  if (main === "army") {
    ctx.moveTo(x - 9, y - 5);
    ctx.lineTo(x + 3, y + 5);
    ctx.moveTo(x - 9, y + 5);
    ctx.lineTo(x + 3, y - 5);
  } else if (main === "navy") {
    ctx.moveTo(x - 9, y + 1);
    ctx.quadraticCurveTo(x - 3, y + 7, x + 3, y + 1);
    ctx.moveTo(x - 3, y - 5);
    ctx.lineTo(x - 3, y + 4);
  } else {
    ctx.moveTo(x - 9, y + 3);
    ctx.lineTo(x - 3, y - 4);
    ctx.lineTo(x + 3, y + 3);
  }
  ctx.stroke();
  ctx.font = "700 10px Inter, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#fff";
  ctx.fillText(String(st.units.length), x + 8.5, y + 0.5);
  // Strength bar.
  ctx.fillStyle = "rgba(5,10,16,0.85)";
  ctx.fillRect(x - 13, y + 10, 26, 3);
  ctx.fillStyle = strength > 60 ? "#7fd39a" : strength > 30 ? "#e8c25a" : "#f08a7a";
  ctx.fillRect(x - 13, y + 10, (26 * strength) / 100, 3);
}

function drawBattle(ctx: CanvasRenderingContext2D, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
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
