import { useEditor } from "../state/editor";
import { useEffect, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, zoomTransform, type ZoomTransform } from "d3-zoom";
import { startKeyPan } from "./keyPan";
import "d3-transition";
import type { CountryId, ProvinceId } from "@gs/shared";
import { createWorldFrame, projectCities, type Bounds, type CityPoint, type CountryShape, type ProvinceShape } from "./geo";
import { MAP_MODES, NO_DATA } from "./mapModes";
import type { DetailLevel, WorkerRequest, WorkerResponse } from "./workerProtocol";
import { COUNTRIES, getCountry, getProvince, loadCities } from "../data/countries";
import { clickMarker, drawUnitsOverlay, markerAt, politicalColor, previewMove, stackLabel, stripes, type Marker } from "./overlay";
import { ownersRecord, playerCountry, useGame } from "../state/gameStore";
import { fogOf } from "../state/fog";
import { sameSelection, useUi, type CameraCommand, type Selection } from "../state/uiStore";

/** How far in the player may zoom, relative to the whole-world view. */
const MAX_ZOOM = 96;
/** From this zoom, the pointer picks provinces instead of countries and province borders show. */
export const PROVINCE_ZOOM = 3;
/** From this zoom, the detailed geometry is used (once loaded). */
const HIGH_DETAIL_ZOOM = 4;
/** Width of the country panel plus margins (see .panel in styles.css). */
const PANEL_SPACE = 384;
/** Height of the navigation + information bars (see --chrome-h in styles.css), plus a margin. */
const TOP_CHROME = 94;
const TOP_CHROME_NARROW = 98;
/** Width of a management screen (see .screen in styles.css). */
const SCREEN_WIDTH = 800;

type PShape = ProvinceShape & { path: Path2D };
type CShape = CountryShape & { path: Path2D; inner: Path2D | null };

interface Layer {
  provinces: Map<ProvinceId, PShape>;
  provinceList: PShape[];
  countries: Map<CountryId, CShape>;
  countryList: CShape[];
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/** Zoom level at which a city appears: big cities early, small towns only up close. */
function cityMinZoom(c: CityPoint): number {
  const z = c.pop >= 10e6 ? 1.6 : c.pop >= 3e6 ? 3 : c.pop >= 1e6 ? 5 : c.pop >= 300e3 ? 8 : c.pop >= 100e3 ? 14 : 24;
  return c.cap ? Math.min(z, 2.5) : z;
}

export function WorldMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [tooltip, setTooltip] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const frame = createWorldFrame();
    const sphere = new Path2D(frame.spherePath);
    const graticule = new Path2D(frame.graticulePath);
    const hitCtx = document.createElement("canvas").getContext("2d")!;
    const layers: Partial<Record<DetailLevel, Layer>> = {};
    /** Fog of war veil per detail level: the whole map minus the provinces you can see (filled even-odd). */
    const veils = new WeakMap<Layer, { version: number; path: Path2D }>();
    function veilFor(L: Layer, visible: Set<ProvinceId>, version: number): Path2D {
      const cached = veils.get(L);
      if (cached?.version === version) return cached.path;
      const path = new Path2D();
      path.addPath(sphere);
      for (const id of visible) {
        const shape = L.provinces.get(id);
        if (shape) path.addPath(shape.path);
      }
      veils.set(L, { version, path });
      return path;
    }
    let cities: CityPoint[] = [];
    let transform = zoomIdentity;
    let fitK = 1;
    let size = { w: 0, h: 0 };
    let frameId = 0;
    let pointer: { x: number; y: number } | null = null;
    let down: { x: number; y: number } | null = null;
    let disposed = false;

    const rel = () => transform.k / fitK;
    const layer = (): Layer | undefined => (rel() >= HIGH_DETAIL_ZOOM && layers.high) || layers.low;
    // Only draw while the flat map is the visible view.
    const requestDraw = () => {
      if (!frameId && useUi.getState().view === "flat") frameId = requestAnimationFrame(draw);
    };

    // ---------- Loading ----------
    const worker = new Worker(new URL("./world.worker.ts", import.meta.url), { type: "module" });
    const toCountries = (list: CountryShape[], level: DetailLevel): CShape[] =>
      list.map((c) => {
        const low = layers.low?.countries.get(c.id);
        const shape = level === "high" && low ? { ...c, mainBounds: low.mainBounds, labelPoint: low.labelPoint } : c;
        return { ...shape, path: new Path2D(c.pathData), inner: c.innerBordersData ? new Path2D(c.innerBordersData) : null };
      });
    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      if (disposed) return;
      const msg = e.data;
      if (msg.type === "error") {
        setLoad({ status: "error", message: msg.message });
        return;
      }
      if (msg.type === "level") {
        const low = layers.low;
        const provinceList = msg.provinces.map((p) => {
          const lp = msg.level === "high" ? low?.provinces.get(p.id) : undefined;
          return { ...p, ...(lp ? { mainBounds: lp.mainBounds, labelPoint: lp.labelPoint } : {}), path: new Path2D(p.pathData) };
        });
        const countryList = toCountries(msg.countries, msg.level);
        layers[msg.level] = {
          provinceList,
          provinces: new Map(provinceList.map((p) => [p.id, p])),
          countryList,
          countries: new Map(countryList.map((c) => [c.id, c])),
        };
        if (msg.level === "low") {
          setLoad({ status: "ready" });
          start();
        }
        updateHover();
        requestDraw();
      } else if (msg.type === "countries") {
        const l = layers[msg.level];
        if (!l) return;
        l.countryList = toCountries(msg.countries, msg.level);
        l.countries = new Map(l.countryList.map((c) => [c.id, c]));
        requestDraw();
      }
    };
    // Resolve the base address here: inside the worker, a relative path would resolve
    // against the worker script's folder instead of the page's.
    const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI).href;
    worker.postMessage({ type: "load", baseUrl, owners: ownersRecord(useGame.getState().state) } satisfies WorkerRequest);
    loadCities()
      .then((list) => {
        if (disposed) return;
        cities = projectCities(list, frame).sort((a, b) => b.cap - a.cap || b.pop - a.pop);
        requestDraw();
      })
      .catch(() => {
        /* The map still works without cities; the panel shows none. */
      });

    // When provinces change hands, rebuild country shapes (borders follow ownership).
    const unsubGame = useGame.subscribe((s, prev) => {
      if (s.state.ownershipVersion !== prev.state.ownershipVersion || s.generation !== prev.generation) {
        worker.postMessage({ type: "owners", owners: ownersRecord(s.state) } satisfies WorkerRequest);
      }
      // Numbers changed as time passed: recolor (map modes read the game state).
      if (s.state !== prev.state) requestDraw();
    });

    // ---------- Drawing ----------
    let lastDrawMs = 0;
    function draw() {
      const started = performance.now();
      frameId = 0;
      drawFrame();
      lastDrawMs = performance.now() - started;
    }

    function drawFrame() {
      const ctx = canvas.getContext("2d");
      const L = layer();
      if (!ctx || !L) return;
      const { w, h } = size;
      const dpr = window.devicePixelRatio || 1;
      const t = transform;
      const z = rel();
      const { hovered, selected, mapMode } = useUi.getState();
      const game = useGame.getState().state;
      const mode = MAP_MODES[mapMode];
      const playerId = playerCountry(game)?.id;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#070d14";
      ctx.fillRect(0, 0, w, h);

      ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
      ctx.fillStyle = "#0e1c2b";
      ctx.fill(sphere);
      ctx.strokeStyle = "rgba(140, 180, 220, 0.07)";
      ctx.lineWidth = 1 / t.k;
      ctx.stroke(graticule);

      const [vx0, vy0] = t.invert([0, 0]);
      const [vx1, vy1] = t.invert([w, h]);
      const onScreen = (b: Bounds) => b[1][0] >= vx0 && b[0][0] <= vx1 && b[1][1] >= vy0 && b[0][1] <= vy1;
      const visible = L.countryList.filter((c) => onScreen(c.bounds));

      if (mode.level === "country") {
        for (const c of visible) {
          ctx.fillStyle = mode.color(c.id, { info: COUNTRIES[c.id], state: game.countries[c.id], game, me: playerId });
          ctx.fill(c.path);
        }
      } else {
        // Province modes color each province; draw thin outlines so the fill doesn't seam.
        ctx.lineWidth = 0.5 / t.k;
        for (const p of L.provinceList) {
          if (!onScreen(p.bounds)) continue;
          const ps = game.provinces[p.id];
          ctx.fillStyle = ps ? mode.provinceColor(ps) : NO_DATA;
          ctx.fill(p.path);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.stroke(p.path);
        }
      }

      // Occupied provinces: stripes in the occupier's color.
      for (const p of L.provinceList) {
        const ps = game.provinces[p.id];
        if (!ps || ps.controller === ps.owner || !onScreen(p.bounds)) continue;
        ctx.fillStyle = stripes(ctx, politicalColor(ps.controller, game), t.k);
        ctx.fill(p.path);
      }

      // Fog of war: darken what you can't see.
      const fog = fogOf(game);
      if (fog.visible) {
        ctx.fillStyle = "rgba(3, 7, 12, 0.42)";
        ctx.fill(veilFor(L, fog.visible, fog.version), "evenodd");
      }

      ctx.lineJoin = "round";
      if (z >= PROVINCE_ZOOM * 0.75) {
        const a = Math.min(1, (z - PROVINCE_ZOOM * 0.75) / (PROVINCE_ZOOM * 0.5));
        ctx.strokeStyle = `rgba(8, 14, 22, ${0.45 * a})`;
        ctx.lineWidth = 0.6 / t.k;
        for (const c of visible) if (c.inner) ctx.stroke(c.inner);
      }
      ctx.strokeStyle = "rgba(6, 12, 20, 0.9)";
      ctx.lineWidth = (z >= PROVINCE_ZOOM ? 1.4 : 0.8) / t.k;
      for (const c of visible) ctx.stroke(c.path);

      const shapeOf = (s: Selection) =>
        !s ? undefined : s.kind === "country" ? L.countries.get(s.id) : L.provinces.get(s.kind === "units" ? s.province : s.id);

      const hov = !sameSelection(hovered, selected) ? shapeOf(hovered) : undefined;
      if (hov) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
        ctx.fill(hov.path);
      }
      const sel = shapeOf(selected);
      if (sel && selected) {
        if (selected.kind === "province") {
          const owner = L.countries.get(game.provinces[selected.id]?.owner as CountryId);
          if (owner) {
            ctx.strokeStyle = "rgba(255, 214, 120, 0.55)";
            ctx.lineWidth = 1.2 / t.k;
            ctx.stroke(owner.path);
          }
        }
        ctx.fillStyle = "rgba(255, 214, 120, 0.28)";
        ctx.fill(sel.path);
        ctx.strokeStyle = "#ffd678";
        ctx.lineWidth = 2 / t.k;
        ctx.stroke(sel.path);
      }

      drawLabels(ctx, L, visible, dpr, selected);
      drawUnits(ctx, dpr);
    }

    // ---------- Units (drawing shared with the globe, see overlay.ts) ----------
    /** Marker boxes drawn last frame, for clicking. */
    let markers: Marker[] = [];
    function drawUnits(ctx: CanvasRenderingContext2D, dpr: number) {
      const low = layers.low;
      if (!low) return;
      const game = useGame.getState().state;
      const { selected, moveOrder } = useUi.getState();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      markers = drawUnitsOverlay(ctx, {
        project: (p) => {
          const shape = low.provinces.get(p);
          return shape ? (transform.apply(shape.labelPoint) as [number, number]) : null;
        },
        w: size.w,
        h: size.h,
        zoom: rel(),
        game: fogOf(game).view,
        me: playerCountry(game)?.id,
        selected,
        moveOrder,
      });
    }

    function drawLabels(ctx: CanvasRenderingContext2D, L: Layer, visible: CShape[], dpr: number, selected: Selection) {
      const { w, h } = size;
      const t = transform;
      const z = rel();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = "middle";
      const placed: [number, number, number, number][] = [];
      const free = (b: [number, number, number, number]) => !placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
      const inView = (x: number, y: number) => x > -40 && y > -20 && x < w + 40 && y < h + 20;
      const halo = (text: string, x: number, y: number, fill: string) => {
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(5, 10, 16, 0.78)";
        ctx.strokeText(text, x, y);
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);
      };
      const selectedCountry = selected?.kind === "country" ? selected.id : null;
      const lowCountries = layers.low?.countries ?? L.countries;

      // Countries (biggest first; the selected one always).
      ctx.textAlign = "center";
      const ordered = [...visible].sort((a, b) => (a.id === selectedCountry ? -1 : b.id === selectedCountry ? 1 : b.area - a.area));
      for (const c of ordered) {
        const info = COUNTRIES[c.id];
        const shape = lowCountries.get(c.id) ?? c;
        if (!info) continue;
        const [sx, sy] = t.apply(shape.labelPoint);
        if (!inView(sx, sy)) continue;
        const lw = (shape.mainBounds[1][0] - shape.mainBounds[0][0]) * t.k;
        const lh = (shape.mainBounds[1][1] - shape.mainBounds[0][1]) * t.k;
        const fontSize = Math.max(10, Math.min(z >= PROVINCE_ZOOM ? 20 : 16, 9 + Math.sqrt(lw * lh) / 40));
        ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(info.name).width;
        const isSel = c.id === selectedCountry;
        if (!isSel && (tw > lw * 0.9 || lh < fontSize * 1.2)) continue;
        const box: [number, number, number, number] = [sx - tw / 2 - 3, sy - fontSize / 2 - 2, sx + tw / 2 + 3, sy + fontSize / 2 + 2];
        if (!isSel && !free(box)) continue;
        placed.push(box);
        halo(info.name, sx, sy, isSel ? "#ffe3a3" : z >= PROVINCE_ZOOM ? "rgba(235, 242, 250, 0.6)" : "rgba(235, 242, 250, 0.92)");
      }

      // Cities: dot plus name to the right.
      ctx.textAlign = "left";
      for (const c of cities) {
        if (z < cityMinZoom(c)) continue;
        const [sx, sy] = t.apply([c.x, c.y]);
        if (sx < 0 || sy < 0 || sx > w || sy > h) continue;
        const fontSize = c.cap ? 12.5 : c.pop >= 1e6 ? 12 : 11;
        ctx.font = `${c.cap ? 700 : 500} ${fontSize}px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(c.name).width;
        const box: [number, number, number, number] = [sx - 4, sy - fontSize / 2 - 1, sx + 7 + tw + 2, sy + fontSize / 2 + 1];
        if (!free(box)) continue;
        placed.push(box);
        ctx.beginPath();
        if (c.cap) {
          ctx.rect(sx - 3.5, sy - 3.5, 7, 7);
          ctx.fillStyle = "#ffd678";
        } else {
          ctx.arc(sx, sy, c.pop >= 1e6 ? 3 : 2.3, 0, Math.PI * 2);
          ctx.fillStyle = "#f2f5f8";
        }
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(5, 10, 16, 0.9)";
        ctx.stroke();
        halo(c.name, sx + 7, sy, c.cap ? "#ffe9b8" : "rgba(242, 245, 248, 0.95)");
      }

      // Province names, when zoomed in far enough and there's room.
      if (z >= PROVINCE_ZOOM) {
        ctx.textAlign = "center";
        const fontSize = 10.5;
        ctx.font = `600 ${fontSize}px Inter, system-ui, sans-serif`;
        const lowProv = layers.low?.provinces ?? L.provinces;
        const [vx0, vy0] = t.invert([0, 0]);
        const [vx1, vy1] = t.invert([w, h]);
        const candidates: PShape[] = [];
        for (const p of lowProv.values()) {
          const b = p.mainBounds;
          if (b[1][0] < vx0 || b[0][0] > vx1 || b[1][1] < vy0 || b[0][1] > vy1) continue;
          if ((b[1][0] - b[0][0]) * t.k < 40 || (b[1][1] - b[0][1]) * t.k < 14) continue;
          candidates.push(p);
        }
        candidates.sort((a, b) => b.area - a.area);
        for (const p of candidates) {
          const info = getProvince(p.id);
          if (!info) continue;
          const [sx, sy] = t.apply(p.labelPoint);
          if (!inView(sx, sy)) continue;
          const text = info.name.toUpperCase();
          const tw = ctx.measureText(text).width;
          if (tw > (p.mainBounds[1][0] - p.mainBounds[0][0]) * t.k * 0.95) continue;
          const box: [number, number, number, number] = [sx - tw / 2 - 2, sy - fontSize / 2 - 1, sx + tw / 2 + 2, sy + fontSize / 2 + 1];
          if (!free(box)) continue;
          placed.push(box);
          ctx.lineWidth = 2.5;
          ctx.strokeStyle = "rgba(5, 10, 16, 0.6)";
          ctx.strokeText(text, sx, sy);
          ctx.fillStyle = "rgba(225, 233, 242, 0.62)";
          ctx.fillText(text, sx, sy);
        }
      }
    }

    // ---------- Picking ----------
    /** The province under a screen point, and its owner. */
    function pick(sx: number, sy: number): { province: ProvinceId; country: CountryId } | null {
      const L = layer();
      if (!L) return null;
      const [wx, wy] = transform.invert([sx, sy]);
      const game = useGame.getState().state;
      for (const p of L.provinceList) {
        const [[x0, y0], [x1, y1]] = p.bounds;
        if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
        if (hitCtx.isPointInPath(p.path, wx, wy)) {
          const owner = game.provinces[p.id]?.owner;
          return owner ? { province: p.id, country: owner } : null;
        }
      }
      return null;
    }

    /** Zoomed out you pick countries; zoomed in you pick provinces. */
    function selectionAt(sx: number, sy: number): Selection {
      const hit = pick(sx, sy);
      if (!hit) return null;
      return rel() >= PROVINCE_ZOOM ? { kind: "province", id: hit.province } : { kind: "country", id: hit.country };
    }

    function updateHover() {
      const marker = pointer ? markerAt(markers, pointer.x, pointer.y) : undefined;
      const order = useUi.getState().moveOrder;
      if (marker && !order) {
        canvas.style.cursor = "pointer";
        const tip = tooltipRef.current;
        if (tip && pointer) tip.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
        setTooltip(stackLabel(marker.stack));
        useUi.getState().hover({ kind: "units", province: marker.stack.province, owner: marker.stack.owner });
        return;
      }
      const hit = pointer ? pick(pointer.x, pointer.y) : null;
      if (order) {
        canvas.style.cursor = "crosshair";
        const tip = tooltipRef.current;
        if (tip && pointer) tip.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
        useUi.getState().hover(hit ? { kind: "province", id: hit.province } : null);
        setTooltip(hit ? `${getProvince(hit.province)?.name ?? ""}: ${previewMove(useGame.getState().state, order, hit.province)}` : "Click a province to send your units there");
        return;
      }
      const s: Selection = hit ? (rel() >= PROVINCE_ZOOM ? { kind: "province", id: hit.province } : { kind: "country", id: hit.country }) : null;
      useUi.getState().hover(s);
      canvas.style.cursor = hit ? "pointer" : "grab";
      const tip = tooltipRef.current;
      if (tip && pointer) tip.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
      let text: string | null = null;
      if (hit) {
        const country = getCountry(hit.country)?.name ?? hit.country;
        text = s?.kind === "province" ? `${getProvince(hit.province)?.name ?? hit.province} · ${country}` : country;
      }
      setTooltip(text);
    }

    // ---------- Camera ----------
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>().on("zoom", (e: { transform: ZoomTransform }) => {
      transform = e.transform;
      useUi.getState().setZoom(rel());
      // The map moved under the pointer, so whatever it hovers may have changed.
      updateHover();
      requestDraw();
    });
    const sel = select(canvas);

    function fitTransform(): ZoomTransform {
      const { w, h } = size;
      const k = Math.min(w / frame.width, h / frame.height) * 0.98;
      return zoomIdentity.translate((w - frame.width * k) / 2, (h - frame.height * k) / 2).scale(k);
    }

    let sized = false;
    function resize(initial: boolean) {
      const rect = wrap.getBoundingClientRect();
      // A page opened in a hidden tab has no size yet: wait for a real one, or the zoom maths divides by zero.
      if (rect.width < 1 || rect.height < 1) return;
      if (!sized) initial = true;
      sized = true;
      const dpr = window.devicePixelRatio || 1;
      size = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const fit = fitTransform();
      const oldFit = fitK;
      fitK = fit.k;
      const pad = (0.5 * Math.max(rect.width, rect.height)) / fit.k;
      zoomBehavior
        .scaleExtent([fit.k, fit.k * MAX_ZOOM])
        .translateExtent([
          [-pad, -pad],
          [frame.width + pad, frame.height + pad],
        ])
        .extent([
          [0, 0],
          [rect.width, rect.height],
        ]);
      if (initial) sel.call(zoomBehavior.transform, fit);
      else {
        const r = transform.k / oldFit;
        const center = transform.invert([rect.width / 2, rect.height / 2]);
        const k = fit.k * r;
        sel.call(zoomBehavior.transform, zoomIdentity.translate(rect.width / 2 - center[0] * k, rect.height / 2 - center[1] * k).scale(k));
      }
      requestDraw();
    }

    /** The part of the screen not covered by the top bars, an open management screen, or the info panel. */
    function viewport() {
      const { w, h } = size;
      const panelOpen = !!useUi.getState().selected;
      const wide = w > 760;
      const top = wide ? TOP_CHROME : TOP_CHROME_NARROW;
      const left = wide && useUi.getState().screen ? Math.min(SCREEN_WIDTH, w / 2) : 0;
      if (panelOpen && wide) return { x0: left, x1: w - PANEL_SPACE, y0: top, y1: h };
      if (panelOpen) return { x0: 0, x1: w, y0: top, y1: Math.max(h * 0.45, 260) };
      return { x0: left, x1: w, y0: top, y1: h };
    }

    function focusTransform(b: Bounds, maxRel: number, minRel = 1): ZoomTransform {
      const v = viewport();
      const vw = v.x1 - v.x0;
      const vh = v.y1 - v.y0;
      const dx = Math.max(b[1][0] - b[0][0], 0.01);
      const dy = Math.max(b[1][1] - b[0][1], 0.01);
      const k = Math.max(fitK * minRel, Math.min(fitK * maxRel, 0.7 / Math.max(dx / vw, dy / vh)));
      const cx = (b[0][0] + b[1][0]) / 2;
      const cy = (b[0][1] + b[1][1]) / 2;
      return zoomIdentity.translate(v.x0 + vw / 2 - cx * k, v.y0 + vh / 2 - cy * k).scale(k);
    }

    function runCamera(cmd: CameraCommand) {
      const quick = cmd.kind === "in" || cmd.kind === "out";
      const tr = sel.transition().duration(quick ? 250 : 750);
      if (cmd.kind === "in") zoomBehavior.scaleBy(tr, 1.6);
      else if (cmd.kind === "out") zoomBehavior.scaleBy(tr, 1 / 1.6);
      else if (cmd.kind === "reset") zoomBehavior.transform(tr, fitTransform());
      else if (cmd.kind === "point") {
        const p = frame.projection([cmd.lon, cmd.lat]);
        if (!p) return;
        const v = viewport();
        const k = fitK * cmd.zoom;
        zoomBehavior.transform(tr, zoomIdentity.translate((v.x0 + v.x1) / 2 - p[0] * k, (v.y0 + v.y1) / 2 - p[1] * k).scale(k));
      } else if (cmd.kind === "focus") {
        const low = layers.low;
        if (!low) return;
        const target = cmd.target;
        if (target.kind === "country") {
          const c = low.countries.get(target.id);
          // Big countries fit to their size; tiny ones (Monaco, islands) zoom right in.
          if (c) zoomBehavior.transform(tr, focusTransform(c.mainBounds, MAX_ZOOM * 0.8));
        } else {
          const p = low.provinces.get(target.kind === "units" ? target.province : target.id);
          // Never stop short of province zoom, so the province stays selectable.
          if (p) zoomBehavior.transform(tr, focusTransform(p.mainBounds, MAX_ZOOM * 0.4, PROVINCE_ZOOM));
        }
      }
    }

    // ---------- Input (attached once the map is ready) ----------
    const local = (e: PointerEvent | MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const onMove = (e: PointerEvent) => {
      pointer = local(e);
      updateHover();
    };
    const onLeave = () => {
      pointer = null;
      updateHover();
    };
    const onDown = (e: PointerEvent) => (down = local(e));
    /** Send the current move order to a province. */
    function orderMove(units: number[], province: ProvinceId) {
      const me = playerCountry(useGame.getState().state);
      if (!me) return;
      useGame.getState().send({ type: "moveUnits", country: me.id, units, to: province });
    }
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      const click = down && Math.hypot(p.x - down.x, p.y - down.y) < 5;
      down = null;
      if (!click || e.button !== 0) return;
      const ui = useUi.getState();
      // The world editor uses clicks to paint provinces.
      if (useEditor.getState().active) {
        const hit = pick(p.x, p.y);
        if (hit) useEditor.getState().click(hit.province);
        return;
      }
      const marker = markerAt(markers, p.x, p.y);
      const me = playerCountry(useGame.getState().state)?.id;
      // Clicking your own units (even while others wait for an order) picks them instead.
      if (marker && (!ui.moveOrder || marker.stack.owner === me)) return clickMarker(marker, me);
      if (ui.moveOrder) {
        const hit = pick(p.x, p.y);
        if (hit) orderMove(ui.moveOrder.units, hit.province);
        ui.setMoveOrder(null);
        return;
      }
      ui.select(selectionAt(p.x, p.y));
    };
    /** Right-click with your units selected: move them there. */
    const onContextMenu = (e: MouseEvent) => {
      const ui = useUi.getState();
      const game = useGame.getState().state;
      const me = playerCountry(game)?.id;
      if (ui.selected?.kind !== "units" || ui.selected.owner !== me) return;
      e.preventDefault();
      const p = local(e);
      const hit = pick(p.x, p.y);
      const sel = ui.selected;
      const ids = Object.values(game.units)
        .filter((u) => u.province === sel.province && u.owner === me)
        .map((u) => u.id);
      if (hit && ids.length) orderMove(ids, hit.province);
    };
    const onDblClick = (e: MouseEvent) => {
      const p = local(e);
      const s = selectionAt(p.x, p.y);
      if (s) useUi.getState().select(s, { focus: true });
    };
    let unsubUi = () => {};
    let stopKeys = () => {};
    let ro: ResizeObserver | null = null;

    function start() {
      sel.call(zoomBehavior).on("dblclick.zoom", null);
      resize(true);
      ro = new ResizeObserver(() => resize(false));
      ro.observe(wrap);
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("pointerdown", onDown);
      canvas.addEventListener("pointerup", onUp);
      canvas.addEventListener("dblclick", onDblClick);
      canvas.addEventListener("contextmenu", onContextMenu);
      unsubUi = useUi.subscribe((s, prev) => {
        if (s.hovered !== prev.hovered || s.selected !== prev.selected || s.mapMode !== prev.mapMode || s.moveOrder !== prev.moveOrder || s.fog !== prev.fog) requestDraw();
        if (s.moveOrder !== prev.moveOrder) updateHover();
        if (s.view !== prev.view && s.view === "flat") requestDraw();
        if (s.camera && s.camera !== prev.camera && s.view === "flat") runCamera(s.camera);
      });
      // W/A/S/D (and arrows) move the camera; d3 counts the move in map units, so divide by the zoom.
      stopKeys = startKeyPan(
        (dx, dy) => {
          const k = zoomTransform(canvas).k;
          sel.call(zoomBehavior.translateBy, -dx / k, -dy / k);
        },
        () => useUi.getState().view === "flat",
      );
      if (import.meta.env.DEV) installTestHook();
    }

    // Lets automated tests find places on screen. Development builds only.
    function installTestHook() {
      (window as unknown as { __gsMap?: unknown }).__gsMap = {
        screenPointOf: (kind: "country" | "province", id: string) => {
          const low = layers.low;
          const s = kind === "country" ? low?.countries.get(id as CountryId) : low?.provinces.get(id as ProvinceId);
          return s ? transform.apply(s.labelPoint) : null;
        },
        pick,
        counts: () => ({ provinces: layers.low?.provinceList.length ?? 0, countries: layers.low?.countryList.length ?? 0, cities: cities.length }),
        detail: () => (layer() === layers.high ? "high" : "low"),
        highLoaded: () => !!layers.high,
        lastDrawMs: () => lastDrawMs,
        /** Screen centre of the marker for a country's units in a province. */
        markerOf: (province: string, owner: string) => {
          const m = markers.find((x) => x.stack.province === province && x.stack.owner === owner);
          return m ? [(m.x0 + m.x1) / 2, (m.y0 + m.y1) / 2] : null;
        },
      };
    }

    return () => {
      disposed = true;
      worker.terminate();
      unsubGame();
      unsubUi();
      ro?.disconnect();
      sel.on(".zoom", null);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDblClick);
      canvas.removeEventListener("contextmenu", onContextMenu);
      stopKeys();
      cancelAnimationFrame(frameId);
    };
  }, []);

  return (
    <div className="map" ref={wrapRef}>
      <canvas ref={canvasRef} aria-label="World map" role="img" data-testid="map-canvas" />
      <div ref={tooltipRef} className="map-tooltip" style={{ opacity: tooltip ? 1 : 0 }} aria-hidden>
        {tooltip}
      </div>
      {load.status === "loading" && <div className="map-status">Loading world map…</div>}
      {load.status === "error" && <div className="map-status map-status--error">Could not load the map: {load.message}</div>}
    </div>
  );
}
