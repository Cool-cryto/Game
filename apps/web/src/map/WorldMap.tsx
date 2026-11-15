import { useEffect, useRef, useState } from "react";
import { select } from "d3-selection";
import { zoom as d3zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import "d3-transition";
import type { Topology } from "topojson-specification";
import type { CountryId } from "@gs/shared";
import { buildWorld, type Bounds, type MapRegion, type WorldGeometry } from "./geo";
import { MAP_MODES } from "./mapModes";
import { COUNTRIES, getCountry } from "../data/countries";
import { useUi } from "../state/uiStore";

/** How far in the player may zoom, relative to the whole-world view. */
const MAX_ZOOM = 64;
/** Width of the country panel plus margins (see .panel in styles.css). */
const PANEL_SPACE = 384;

interface Region extends MapRegion {
  path: Path2D;
}

interface Scene {
  world: WorldGeometry;
  regions: Region[];
  byId: Map<CountryId, Region>;
  sphere: Path2D;
  graticule: Path2D;
}

type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

export function WorldMap() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Scene | null>(null);
  const transformRef = useRef<ZoomTransform>(zoomIdentity);
  const fitRef = useRef(1);
  const sizeRef = useRef({ w: 0, h: 0 });
  const zoomRef = useRef<ZoomBehavior<HTMLCanvasElement, unknown> | null>(null);
  const frameRef = useRef(0);
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [tooltip, setTooltip] = useState<string | null>(null);

  // Load and prepare map geometry once.
  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}maps/world-50m.topo.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`Map data request failed (${r.status})`);
        return r.json() as Promise<Topology>;
      })
      .then((topo) => {
        if (cancelled) return;
        const world = buildWorld(topo);
        const regions = world.regions.map((r) => ({ ...r, path: new Path2D(r.pathData) }));
        sceneRef.current = {
          world,
          regions,
          byId: new Map(regions.map((r) => [r.id, r])),
          sphere: new Path2D(world.spherePath),
          graticule: new Path2D(world.graticulePath),
        };
        setLoad({ status: "ready" });
      })
      .catch((e: unknown) => !cancelled && setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) }));
    return () => {
      cancelled = true;
    };
  }, []);

  // Set up canvas, camera and input once the map is ready.
  useEffect(() => {
    if (load.status !== "ready") return;
    const canvas = canvasRef.current!;
    const wrap = wrapRef.current!;
    const scene = sceneRef.current!;
    const { world } = scene;
    const hitCtx = document.createElement("canvas").getContext("2d")!;
    /** Last pointer position over the map, or null when the pointer is elsewhere. */
    let pointer: { x: number; y: number } | null = null;

    const requestDraw = () => {
      if (!frameRef.current) frameRef.current = requestAnimationFrame(draw);
    };

    function draw() {
      frameRef.current = 0;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const { w, h } = sizeRef.current;
      const dpr = window.devicePixelRatio || 1;
      const t = transformRef.current;
      const { hoveredId, selectedId, mapMode } = useUi.getState();
      const mode = MAP_MODES[mapMode];

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = "#070d14";
      ctx.fillRect(0, 0, w, h);

      ctx.setTransform(dpr * t.k, 0, 0, dpr * t.k, dpr * t.x, dpr * t.y);
      ctx.fillStyle = "#0e1c2b";
      ctx.fill(scene.sphere);
      ctx.strokeStyle = "rgba(140, 180, 220, 0.07)";
      ctx.lineWidth = 1 / t.k;
      ctx.stroke(scene.graticule);

      // Only draw regions that are on screen.
      const [[vx0, vy0], [vx1, vy1]] = [t.invert([0, 0]), t.invert([w, h])];
      const visible = scene.regions.filter(
        (r) => r.bounds[1][0] >= vx0 && r.bounds[0][0] <= vx1 && r.bounds[1][1] >= vy0 && r.bounds[0][1] <= vy1,
      );

      for (const r of visible) {
        const info = COUNTRIES[r.id];
        ctx.fillStyle = info ? mode.color(info) : "#555";
        ctx.fill(r.path);
      }

      ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(6, 12, 20, 0.85)";
      ctx.lineWidth = 0.8 / t.k;
      for (const r of visible) ctx.stroke(r.path);

      const hovered = hoveredId ? scene.byId.get(hoveredId) : undefined;
      if (hovered && hoveredId !== selectedId) {
        ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
        ctx.fill(hovered.path);
      }
      const selected = selectedId ? scene.byId.get(selectedId) : undefined;
      if (selected) {
        ctx.fillStyle = "rgba(255, 214, 120, 0.28)";
        ctx.fill(selected.path);
        ctx.strokeStyle = "#ffd678";
        ctx.lineWidth = 2 / t.k;
        ctx.stroke(selected.path);
      }

      drawLabels(ctx, visible, t, dpr, w, h, selectedId);
    }

    function drawLabels(
      ctx: CanvasRenderingContext2D,
      visible: Region[],
      t: ZoomTransform,
      dpr: number,
      w: number,
      h: number,
      selectedId: CountryId | null,
    ) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const placed: [number, number, number, number][] = [];
      const ordered = [...visible].sort((a, b) => (a.id === selectedId ? -1 : b.id === selectedId ? 1 : b.area - a.area));
      for (const r of ordered) {
        const info = COUNTRIES[r.id];
        if (!info) continue;
        const [sx, sy] = t.apply(r.labelPoint);
        if (sx < -50 || sy < -20 || sx > w + 50 || sy > h + 20) continue;
        const landWidth = (r.mainBounds[1][0] - r.mainBounds[0][0]) * t.k;
        const landHeight = (r.mainBounds[1][1] - r.mainBounds[0][1]) * t.k;
        const size = Math.max(10, Math.min(16, 9 + Math.sqrt(landWidth * landHeight) / 40));
        ctx.font = `600 ${size}px Inter, system-ui, sans-serif`;
        const text = info.name;
        const tw = ctx.measureText(text).width;
        const isSelected = r.id === selectedId;
        if (!isSelected && (tw > landWidth * 0.9 || landHeight < size * 1.2)) continue;
        const box: [number, number, number, number] = [sx - tw / 2 - 3, sy - size / 2 - 2, sx + tw / 2 + 3, sy + size / 2 + 2];
        if (placed.some((p) => box[0] < p[2] && box[2] > p[0] && box[1] < p[3] && box[3] > p[1])) continue;
        placed.push(box);
        ctx.lineWidth = 3;
        ctx.strokeStyle = "rgba(5, 10, 16, 0.75)";
        ctx.strokeText(text, sx, sy);
        ctx.fillStyle = isSelected ? "#ffe3a3" : "rgba(235, 242, 250, 0.92)";
        ctx.fillText(text, sx, sy);
      }
    }

    // Camera
    const zoomBehavior = d3zoom<HTMLCanvasElement, unknown>()
      .on("zoom", (e: { transform: ZoomTransform }) => {
        transformRef.current = e.transform;
        useUi.getState().setZoom(e.transform.k / fitRef.current);
        // The map moved under the pointer, so whatever it hovers may have changed.
        updateHover();
        requestDraw();
      });
    zoomRef.current = zoomBehavior;
    const sel = select(canvas);
    sel.call(zoomBehavior).on("dblclick.zoom", null);

    function fitTransform(): ZoomTransform {
      const { w, h } = sizeRef.current;
      const k = Math.min(w / world.width, h / world.height) * 0.98;
      return zoomIdentity.translate((w - world.width * k) / 2, (h - world.height * k) / 2).scale(k);
    }

    function resize(initial: boolean) {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: rect.width, h: rect.height };
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      const fit = fitTransform();
      const oldFit = fitRef.current;
      fitRef.current = fit.k;
      const pad = 0.5 * Math.max(rect.width, rect.height) / fit.k;
      zoomBehavior
        .scaleExtent([fit.k, fit.k * MAX_ZOOM])
        .translateExtent([
          [-pad, -pad],
          [world.width + pad, world.height + pad],
        ])
        .extent([
          [0, 0],
          [rect.width, rect.height],
        ]);
      if (initial) sel.call(zoomBehavior.transform, fit);
      else {
        // Keep the same relative zoom after a window resize.
        const t = transformRef.current;
        const rel = t.k / oldFit;
        const center = t.invert([rect.width / 2, rect.height / 2]);
        const k = fit.k * rel;
        sel.call(zoomBehavior.transform, zoomIdentity.translate(rect.width / 2 - center[0] * k, rect.height / 2 - center[1] * k).scale(k));
      }
      requestDraw();
    }
    resize(true);
    const ro = new ResizeObserver(() => resize(false));
    ro.observe(wrap);

    // Hit testing: which region is under a screen point?
    function regionAt(sx: number, sy: number): CountryId | null {
      const [wx, wy] = transformRef.current.invert([sx, sy]);
      let best: Region | null = null;
      for (const r of scene.regions) {
        const [[x0, y0], [x1, y1]] = r.bounds;
        if (wx < x0 || wx > x1 || wy < y0 || wy > y1) continue;
        // Smaller regions win, so enclaves (e.g. Lesotho) stay clickable.
        if (hitCtx.isPointInPath(r.path, wx, wy) && (!best || r.area < best.area)) best = r;
      }
      return best?.id ?? null;
    }

    let down: { x: number; y: number } | null = null;
    function updateHover() {
      const id = pointer ? regionAt(pointer.x, pointer.y) : null;
      if (id !== useUi.getState().hoveredId) useUi.getState().hover(id);
      canvas.style.cursor = id ? "pointer" : "grab";
      const tip = tooltipRef.current;
      if (tip && pointer) tip.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
      setTooltip(id ? (getCountry(id)?.name ?? null) : null);
    }
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
    const onUp = (e: PointerEvent) => {
      const p = local(e);
      if (down && Math.hypot(p.x - down.x, p.y - down.y) < 5) useUi.getState().select(regionAt(p.x, p.y));
      down = null;
    };
    const onDblClick = (e: MouseEvent) => {
      const p = local(e);
      const id = regionAt(p.x, p.y);
      if (id) useUi.getState().select(id, { focus: true });
    };
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerleave", onLeave);
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("dblclick", onDblClick);

    // Redraw when hover, selection or map mode changes; run camera commands.
    const unsub = useUi.subscribe((s, prev) => {
      if (s.hoveredId !== prev.hoveredId || s.selectedId !== prev.selectedId || s.mapMode !== prev.mapMode) requestDraw();
      if (s.zoomCommand && s.zoomCommand !== prev.zoomCommand) runCommand(s.zoomCommand);
    });

    function focusTransform(b: Bounds): ZoomTransform {
      const { w, h } = sizeRef.current;
      const dx = Math.max(b[1][0] - b[0][0], 1);
      const dy = Math.max(b[1][1] - b[0][1], 1);
      // The info panel covers the right side on wide screens and the bottom ~55% on
      // phones; fit the country into the part of the map that stays visible.
      const panelOpen = !!useUi.getState().selectedId;
      const wide = w > 760;
      const visibleW = panelOpen && wide ? w - PANEL_SPACE : w;
      // On phones the top bar takes ~140px and the bottom sheet starts at ~45% height.
      const visibleH = panelOpen && !wide ? Math.max(h * 0.45 - 140, 120) : h;
      const k = Math.min(fitRef.current * MAX_ZOOM * 0.25, 0.6 / Math.max(dx / visibleW, dy / visibleH));
      const k2 = Math.max(k, fitRef.current);
      const cx = (b[0][0] + b[1][0]) / 2;
      const cy = (b[0][1] + b[1][1]) / 2;
      const centerY = panelOpen && !wide ? 140 + visibleH / 2 : h / 2;
      return zoomIdentity.translate(visibleW / 2 - cx * k2, centerY - cy * k2).scale(k2);
    }

    function runCommand(cmd: NonNullable<ReturnType<typeof useUi.getState>["zoomCommand"]>) {
      const tr = sel.transition().duration(cmd.kind === "focus" || cmd.kind === "reset" ? 750 : 250);
      if (cmd.kind === "in") zoomBehavior.scaleBy(tr, 1.6);
      else if (cmd.kind === "out") zoomBehavior.scaleBy(tr, 1 / 1.6);
      else if (cmd.kind === "reset") zoomBehavior.transform(tr, fitTransform());
      else if (cmd.kind === "focus") {
        const r = scene.byId.get(cmd.id);
        if (r) zoomBehavior.transform(tr, focusTransform(r.mainBounds));
      }
    }

    // Small test hook so automated tests can find countries on screen.
    if (import.meta.env.DEV) {
      (window as unknown as { __gsMap?: unknown }).__gsMap = {
        screenPointOf: (id: CountryId) => {
          const r = scene.byId.get(id);
          return r ? transformRef.current.apply(r.labelPoint) : null;
        },
        regionAt,
        regionCount: scene.regions.length,
      };
    }

    return () => {
      unsub();
      ro.disconnect();
      sel.on(".zoom", null);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerleave", onLeave);
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("dblclick", onDblClick);
      cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
    };
  }, [load.status]);

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
