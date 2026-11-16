import { useEditor } from "../../state/editor";
import { useEffect, useRef, useState } from "react";
import { geoDistance, geoOrthographic, geoPath, type GeoPermissibleObjects } from "d3-geo";
import { feature, merge } from "topojson-client";
import type { GeometryObject } from "topojson-specification";
import type { CountryId, ProvinceId } from "@gs/shared";
import { COUNTRIES, GEOGRAPHY, getCountry, getProvince, loadCities } from "../../data/countries";
import { ownersRecord, playerCountry, useGame } from "../../state/gameStore";
import { sameSelection, useUi, type CameraCommand, type Selection } from "../../state/uiStore";
import { createEquirectFrame, type Bounds, type CountryShape, type ProvinceShape, type ProvinceTopology } from "../geo";
import { MAP_MODES, NO_DATA } from "../mapModes";
import { fogOf } from "../../state/fog";
import { startKeyPan } from "../keyPan";
import { clickMarker, drawUnitsOverlay, markerAt, politicalColor, previewMove, stackLabel, stripes, type Marker } from "../overlay";
import { GlobeRenderer, type GlobeCamera } from "./globeRenderer";
import type { GlobeWorkerRequest, GlobeWorkerResponse } from "./globe.worker";

/** Zoom limits relative to the whole-globe view. The texture gets blurry beyond ~8×. */
const MAX_ZOOM = 8;
/** Same rule as the flat map: from this zoom, clicks pick provinces. */
const PROVINCE_ZOOM = 3;
const PANEL_SPACE = 384;
const DEG = 180 / Math.PI;

type PShape = ProvinceShape & { path: Path2D };
type CShape = CountryShape & { path: Path2D; inner: Path2D | null };
type LoadState = { status: "loading" } | { status: "error"; message: string } | { status: "ready" };

/**
 * The 3D globe. Colors, borders and occupation are painted onto an
 * equirectangular texture that WebGL wraps around the sphere; labels, units,
 * routes and highlights are drawn crisply on a 2D overlay with the same
 * orthographic projection.
 */
export function GlobeView({ active }: { active: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const glRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  const wakeRef = useRef<() => void>(() => {});
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [tooltip, setTooltip] = useState<string | null>(null);

  useEffect(() => {
    activeRef.current = active;
    if (active) wakeRef.current();
  }, [active]);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const glCanvas = glRef.current!;
    const overlay = overlayRef.current!;
    let renderer: GlobeRenderer;
    try {
      renderer = new GlobeRenderer(glCanvas);
    } catch (e) {
      setLoad({ status: "error", message: e instanceof Error ? e.message : String(e) });
      return;
    }
    const texWidth = Math.min(4096, renderer.maxTextureSize);
    const frame = createEquirectFrame(texWidth);
    const texture = document.createElement("canvas");
    texture.width = texWidth;
    texture.height = texWidth / 2;
    const texCtx = texture.getContext("2d")!;
    const graticule = new Path2D(frame.graticulePath);
    const hitCtx = document.createElement("canvas").getContext("2d")!;

    let provinces = new Map<ProvinceId, PShape>();
    let provinceList: PShape[] = [];
    let countries = new Map<CountryId, CShape>();
    let countryList: CShape[] = [];
    let topo: ProvinceTopology | null = null;
    let cities: { name: string; lon: number; lat: number; pop: number; cap: 0 | 1 }[] = [];
    let markers: Marker[] = [];
    let size = { w: 0, h: 0 };
    let fitRadius = 300;
    const cam: GlobeCamera = { lon: 10, lat: 25, radius: 300, x: 0, y: 0 };
    let textureDirty = true;
    let lastPaint = 0;
    let frameId = 0;
    let disposed = false;
    let anim: { from: GlobeCamera; to: GlobeCamera; start: number; ms: number } | null = null;

    const rel = () => cam.radius / fitRadius;
    const projection = () =>
      geoOrthographic()
        .rotate([-cam.lon, -cam.lat])
        .scale(cam.radius)
        .translate([cam.x, cam.y])
        .clipAngle(90)
        .precision(0.3);
    const visible = (lon: number, lat: number) => geoDistance([lon, lat], [cam.lon, cam.lat]) < Math.PI / 2 - 0.03;
    /** Texture pixel → longitude/latitude. */
    const toLonLat = (p: [number, number]) => frame.projection.invert!(p) as [number, number];

    // ---------- Loading ----------
    const worker = new Worker(new URL("./globe.worker.ts", import.meta.url), { type: "module" });
    const toCountries = (list: CountryShape[]) =>
      list.map((c) => ({ ...c, path: new Path2D(c.pathData), inner: c.innerBordersData ? new Path2D(c.innerBordersData) : null }));
    worker.onmessage = (e: MessageEvent<GlobeWorkerResponse>) => {
      if (disposed) return;
      const msg = e.data;
      if (msg.type === "error") return setLoad({ status: "error", message: msg.message });
      if (msg.type === "shapes") {
        provinceList = msg.provinces.map((p) => ({ ...p, path: new Path2D(p.pathData) }));
        provinces = new Map(provinceList.map((p) => [p.id, p]));
      }
      countryList = toCountries(msg.countries);
      countries = new Map(countryList.map((c) => [c.id, c]));
      countryFeatures.clear();
      textureDirty = true;
      if (msg.type === "shapes") {
        setLoad({ status: "ready" });
        installTestHook();
      }
      requestDraw();
    };
    const baseUrl = new URL(import.meta.env.BASE_URL, document.baseURI).href;
    worker.postMessage({ type: "load", baseUrl, width: texWidth, owners: ownersRecord(useGame.getState().state) } satisfies GlobeWorkerRequest);
    // The same file again (from the browser cache), for drawing outlines of the selected place.
    fetch(`${baseUrl}maps/provinces-low.topo.json`)
      .then((r) => r.json() as Promise<ProvinceTopology>)
      .then((t) => {
        topo = t;
        requestDraw();
      })
      .catch(() => {});
    loadCities()
      .then((list) => {
        cities = [...list].sort((a, b) => b.cap - a.cap || b.pop - a.pop);
        requestDraw();
      })
      .catch(() => {});

    const provinceFeatures = new Map<ProvinceId, GeoPermissibleObjects>();
    const countryFeatures = new Map<CountryId, GeoPermissibleObjects>();
    function featureOf(s: Selection): GeoPermissibleObjects | null {
      if (!s || !topo) return null;
      const geoms = topo.objects.provinces.geometries as GeometryObject[];
      if (s.kind === "country") {
        let f = countryFeatures.get(s.id);
        if (!f) {
          const game = useGame.getState().state;
          f = merge(topo, geoms.filter((g) => game.provinces[String(g.id) as ProvinceId]?.owner === s.id) as never);
          countryFeatures.set(s.id, f);
        }
        return f;
      }
      const id = s.kind === "units" ? s.province : s.id;
      let f = provinceFeatures.get(id);
      if (!f) {
        const g = geoms.find((x) => String(x.id) === id);
        if (!g) return null;
        f = feature(topo, g as never) as GeoPermissibleObjects;
        provinceFeatures.set(id, f);
      }
      return f;
    }

    /**
     * What the texture currently shows. Repainting 4096×2048 pixels is the slow
     * part, so only repaint when this changes: borders and occupation always
     * matter; the numbers behind data map modes only change once a month.
     */
    let paintedKey = "";
    function textureKey(): string {
      const g = useGame.getState().state;
      const mode = MAP_MODES[useUi.getState().mapMode];
      let occupied = 0;
      let hash = 0;
      for (const p of Object.values(g.provinces)) {
        if (p.controller === p.owner) continue;
        occupied++;
        for (let i = 0; i < p.id.length; i++) hash = (hash * 31 + p.id.charCodeAt(i) + p.controller.charCodeAt(0)) | 0;
      }
      const staticMode = mode.id === "political" || mode.id === "region";
      const month = staticMode ? 0 : Math.floor(g.tick / 30);
      const diplomacy = mode.id === "diplomacy" || mode.id === "wars" ? `${g.wars.length}|${g.alliances.length}|${Object.keys(g.relations).length}|${month}` : "";
      return `${mode.id}|${g.ownershipVersion}|${occupied}|${hash}|${month}|${diplomacy}|${countryList.length}|${playerCountry(g)?.id ?? ""}|${fogOf(g).version}`;
    }

    // Recolor when time passes or ownership changes (only if the picture would change).
    const unsubGame = useGame.subscribe((s, prev) => {
      if (s.state.ownershipVersion !== prev.state.ownershipVersion || s.generation !== prev.generation) {
        worker.postMessage({ type: "owners", owners: ownersRecord(s.state) } satisfies GlobeWorkerRequest);
      }
      if (s.state !== prev.state && activeRef.current) {
        if (textureKey() !== paintedKey) textureDirty = true;
        requestDraw();
      }
    });

    // ---------- Texture ----------
    function paintTexture() {
      const ctx = texCtx;
      const game = useGame.getState().state;
      const mode = MAP_MODES[useUi.getState().mapMode];
      const me = playerCountry(game)?.id;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#0e1c2b";
      ctx.fillRect(0, 0, texture.width, texture.height);
      ctx.strokeStyle = "rgba(140, 180, 220, 0.12)";
      ctx.lineWidth = 1;
      ctx.stroke(graticule);
      if (mode.level === "country") {
        for (const c of countryList) {
          ctx.fillStyle = mode.color(c.id, { info: COUNTRIES[c.id], state: game.countries[c.id], game, me });
          ctx.fill(c.path);
        }
      } else {
        ctx.lineWidth = 0.6;
        for (const p of provinceList) {
          const ps = game.provinces[p.id];
          ctx.fillStyle = ps ? mode.provinceColor(ps) : NO_DATA;
          ctx.fill(p.path);
          ctx.strokeStyle = ctx.fillStyle;
          ctx.stroke(p.path);
        }
      }
      for (const p of provinceList) {
        const ps = game.provinces[p.id];
        if (!ps || ps.controller === ps.owner) continue;
        ctx.fillStyle = stripes(ctx, politicalColor(ps.controller, game), 1, 6);
        ctx.fill(p.path);
      }
      // Fog of war: darken what you can't see (everything, minus visible provinces, filled even-odd).
      const fog = fogOf(game);
      if (fog.visible) {
        const veil = new Path2D();
        veil.rect(0, 0, texture.width, texture.height);
        for (const id of fog.visible) {
          const shape = provinces.get(id);
          if (shape) veil.addPath(shape.path);
        }
        ctx.fillStyle = "rgba(3, 7, 12, 0.42)";
        ctx.fill(veil, "evenodd");
      }
      ctx.lineJoin = "round";
      // Province borders inside countries aren't drawn (they cluttered the map).
      ctx.strokeStyle = "rgba(6, 12, 20, 0.9)";
      ctx.lineWidth = 1.3;
      for (const c of countryList) ctx.stroke(c.path);
      renderer.setTexture(texture);
      textureDirty = false;
      paintedKey = textureKey();
      lastPaint = performance.now();
    }

    // ---------- Drawing ----------
    const requestDraw = () => {
      if (!frameId && !disposed) frameId = requestAnimationFrame(draw);
    };
    wakeRef.current = () => {
      textureDirty = true;
      resize();
      requestDraw();
    };
    let lastDrawMs = 0;

    function draw(now: number) {
      frameId = 0;
      if (!activeRef.current || !countryList.length) return;
      const started = performance.now();
      if (anim) {
        const t = Math.min(1, (now - anim.start) / anim.ms);
        const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        let dLon = anim.to.lon - anim.from.lon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        cam.lon = anim.from.lon + dLon * e;
        cam.lat = anim.from.lat + (anim.to.lat - anim.from.lat) * e;
        cam.radius = anim.from.radius * Math.pow(anim.to.radius / anim.from.radius, e);
        cam.x = anim.from.x + (anim.to.x - anim.from.x) * e;
        cam.y = anim.from.y + (anim.to.y - anim.from.y) * e;
        useUi.getState().setZoom(rel());
        if (t >= 1) anim = null;
        else requestDraw();
      }
      // Repaint the texture at most a few times a second while time runs (it's the slow part).
      if (textureDirty && (now - lastPaint > 1000 || lastPaint === 0 || useGame.getState().paused)) paintTexture();
      else if (textureDirty) requestDraw();
      const dpr = window.devicePixelRatio || 1;
      renderer.draw(cam, dpr);
      drawOverlay(dpr);
      lastDrawMs = performance.now() - started;
    }

    function drawOverlay(dpr: number) {
      const ctx = overlay.getContext("2d")!;
      const { w, h } = size;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const proj = projection();
      const path = geoPath(proj, ctx);
      const { hovered, selected, moveOrder } = useUi.getState();
      const game = useGame.getState().state;

      const hov = !sameSelection(hovered, selected) ? featureOf(hovered) : null;
      if (hov) {
        ctx.beginPath();
        path(hov);
        ctx.fillStyle = "rgba(255, 255, 255, 0.18)";
        ctx.fill();
      }
      const sel = featureOf(selected);
      if (sel) {
        ctx.beginPath();
        path(sel);
        ctx.fillStyle = "rgba(255, 214, 120, 0.28)";
        ctx.fill();
        ctx.strokeStyle = "#ffd678";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      drawLabels(ctx, proj);
      const drawn = drawUnitsOverlay(ctx, {
        project: (p) => {
          const g = GEOGRAPHY.provinces[p];
          if (!g || !visible(g.lon, g.lat)) return null;
          return proj([g.lon, g.lat]) as [number, number] | null;
        },
        w,
        h,
        zoom: rel(),
        game: fogOf(game).view,
        me: playerCountry(game)?.id,
        selected,
        moveOrder,
        running: !useGame.getState().paused,
      });
      markers = drawn.markers;
      // Keep drawing while units glide between provinces.
      if (drawn.animating) requestDraw();
    }

    function drawLabels(ctx: CanvasRenderingContext2D, proj: ReturnType<typeof projection>) {
      const { w, h } = size;
      const z = rel();
      const placed: [number, number, number, number][] = [];
      const free = (b: [number, number, number, number]) => !placed.some((p) => b[0] < p[2] && b[2] > p[0] && b[1] < p[3] && b[3] > p[1]);
      const halo = (text: string, x: number, y: number, fill: string, width = 3) => {
        ctx.lineWidth = width;
        ctx.strokeStyle = "rgba(5, 10, 16, 0.78)";
        ctx.strokeText(text, x, y);
        ctx.fillStyle = fill;
        ctx.fillText(text, x, y);
      };
      const pxPerTexel = (cam.radius * 2 * Math.PI) / texture.width;
      ctx.textBaseline = "middle";
      const selected = useUi.getState().selected;
      const selectedCountry = selected?.kind === "country" ? selected.id : null;

      // Countries, largest first.
      ctx.textAlign = "center";
      const ordered = [...countryList].sort((a, b) => (a.id === selectedCountry ? -1 : b.id === selectedCountry ? 1 : b.area - a.area));
      for (const c of ordered) {
        const info = COUNTRIES[c.id];
        if (!info) continue;
        const [lon, lat] = toLonLat(c.labelPoint);
        if (!visible(lon, lat)) continue;
        const pt = proj([lon, lat]);
        if (!pt) continue;
        // Approximate on-screen size: texture size × scale, shrunk towards the edge of the globe.
        const fore = Math.cos(geoDistance([lon, lat], [cam.lon, cam.lat]));
        const lw = (c.mainBounds[1][0] - c.mainBounds[0][0]) * pxPerTexel * Math.cos((lat * Math.PI) / 180) * fore;
        const lh = (c.mainBounds[1][1] - c.mainBounds[0][1]) * pxPerTexel * fore;
        const fontSize = Math.max(10, Math.min(z >= PROVINCE_ZOOM ? 20 : 16, 9 + Math.sqrt(Math.max(lw * lh, 0)) / 40));
        ctx.font = `700 ${fontSize}px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(info.name).width;
        const isSel = c.id === selectedCountry;
        if (!isSel && (tw > lw * 0.9 || lh < fontSize * 1.2)) continue;
        const box: [number, number, number, number] = [pt[0] - tw / 2 - 3, pt[1] - fontSize / 2 - 2, pt[0] + tw / 2 + 3, pt[1] + fontSize / 2 + 2];
        if (!isSel && !free(box)) continue;
        placed.push(box);
        halo(info.name, pt[0], pt[1], isSel ? "#ffe3a3" : z >= PROVINCE_ZOOM ? "rgba(235, 242, 250, 0.6)" : "rgba(235, 242, 250, 0.92)");
      }

      // Cities, appearing as you zoom in (same thresholds as the flat map).
      ctx.textAlign = "left";
      for (const c of cities) {
        const min = c.pop >= 10e6 ? 1.6 : c.pop >= 3e6 ? 2.5 : c.pop >= 1e6 ? 4 : c.pop >= 300e3 ? 6 : 99;
        if (z < (c.cap ? Math.min(min, 2) : min) || !visible(c.lon, c.lat)) continue;
        const pt = proj([c.lon, c.lat]);
        if (!pt || pt[0] < 0 || pt[1] < 0 || pt[0] > w || pt[1] > h) continue;
        const fontSize = c.cap ? 12.5 : 11.5;
        ctx.font = `${c.cap ? 700 : 500} ${fontSize}px Inter, system-ui, sans-serif`;
        const tw = ctx.measureText(c.name).width;
        const box: [number, number, number, number] = [pt[0] - 4, pt[1] - fontSize / 2 - 1, pt[0] + 9 + tw, pt[1] + fontSize / 2 + 1];
        if (!free(box)) continue;
        placed.push(box);
        ctx.beginPath();
        if (c.cap) ctx.rect(pt[0] - 3.5, pt[1] - 3.5, 7, 7);
        else ctx.arc(pt[0], pt[1], 2.6, 0, Math.PI * 2);
        ctx.fillStyle = c.cap ? "#ffd678" : "#f2f5f8";
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = "rgba(5, 10, 16, 0.9)";
        ctx.stroke();
        halo(c.name, pt[0] + 7, pt[1], c.cap ? "#ffe9b8" : "rgba(242, 245, 248, 0.95)");
      }
    }

    // ---------- Picking ----------
    function pick(x: number, y: number): { province: ProvinceId; country: CountryId } | null {
      if (Math.hypot(x - cam.x, y - cam.y) > cam.radius) return null;
      const ll = projection().invert!([x, y]);
      if (!ll) return null;
      const [tx, ty] = frame.projection(ll)!;
      const game = useGame.getState().state;
      for (const p of provinceList) {
        const [[x0, y0], [x1, y1]] = p.bounds;
        if (tx < x0 || tx > x1 || ty < y0 || ty > y1) continue;
        if (hitCtx.isPointInPath(p.path, tx, ty)) {
          const owner = game.provinces[p.id]?.owner;
          return owner ? { province: p.id, country: owner } : null;
        }
      }
      return null;
    }
    /** Clicking picks a country (provinces only matter as places to send units). */
    const selectionFor = (hit: ReturnType<typeof pick>): Selection => (!hit ? null : { kind: "country", id: hit.country });

    // ---------- Camera ----------
    function resize() {
      const rect = wrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dpr = window.devicePixelRatio || 1;
      const first = size.w === 0;
      size = { w: rect.width, h: rect.height };
      for (const c of [glCanvas, overlay]) {
        c.width = Math.round(rect.width * dpr);
        c.height = Math.round(rect.height * dpr);
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
      }
      const r = rel();
      fitRadius = Math.min(rect.width, rect.height - 130) * 0.42;
      const v = viewport();
      cam.x = (v.x0 + v.x1) / 2;
      cam.y = (v.y0 + v.y1) / 2;
      cam.radius = first ? fitRadius : fitRadius * r;
      requestDraw();
    }

    function viewport() {
      const { w, h } = size;
      const panelOpen = !!useUi.getState().selected;
      const wide = w > 760;
      const left = wide && useUi.getState().screen ? Math.min(800, w / 2) : 0;
      if (panelOpen && wide) return { x0: left, x1: w - PANEL_SPACE, y0: 94, y1: h - 40 };
      if (panelOpen) return { x0: 0, x1: w, y0: 140, y1: Math.max(h * 0.45, 260) };
      return { x0: left, x1: w, y0: wide ? 94 : 98, y1: h - 40 };
    }

    function animateTo(to: Partial<GlobeCamera>, ms = 750) {
      const v = viewport();
      const target: GlobeCamera = { ...cam, x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2, ...to };
      target.radius = Math.max(fitRadius, Math.min(fitRadius * MAX_ZOOM, target.radius));
      target.lat = Math.max(-85, Math.min(85, target.lat));
      anim = { from: { ...cam }, to: target, start: performance.now(), ms };
      requestDraw();
    }

    /** Centre on a texture-space box and zoom so it fills about 60% of the view. */
    function focusBounds(b: Bounds, minRel = 1) {
      const [lon0, lat0] = toLonLat(b[0]);
      const [lon1, lat1] = toLonLat(b[1]);
      const lon = (lon0 + lon1) / 2;
      const lat = (lat0 + lat1) / 2;
      const spanDeg = Math.max(Math.abs(lon1 - lon0) * Math.cos((lat * Math.PI) / 180), Math.abs(lat1 - lat0), 0.3);
      const v = viewport();
      const radius = (0.6 * Math.min(v.x1 - v.x0, v.y1 - v.y0)) / (spanDeg / DEG);
      animateTo({ lon, lat, radius: Math.max(radius, fitRadius * minRel) });
    }

    function runCamera(cmd: CameraCommand) {
      if (cmd.kind === "in") animateTo({ radius: cam.radius * 1.6 }, 250);
      else if (cmd.kind === "out") animateTo({ radius: cam.radius / 1.6 }, 250);
      else if (cmd.kind === "reset") animateTo({ radius: fitRadius });
      else if (cmd.kind === "point") animateTo({ lon: cmd.lon, lat: cmd.lat, radius: fitRadius * Math.min(MAX_ZOOM, cmd.zoom / 2) });
      else if (cmd.kind === "focus") {
        const t = cmd.target;
        if (t.kind === "country") {
          const c = countries.get(t.id);
          if (c) focusBounds(c.mainBounds);
        } else {
          const p = provinces.get(t.kind === "units" ? t.province : t.id);
          if (p) focusBounds(p.mainBounds, PROVINCE_ZOOM);
        }
      }
    }

    // ---------- Input ----------
    const pointers = new Map<number, { x: number; y: number }>();
    let drag: { x: number; y: number; moved: boolean; pinch: number | null } | null = null;
    let pointer: { x: number; y: number } | null = null;
    const local = (e: PointerEvent | MouseEvent | WheelEvent) => {
      const r = overlay.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const setTip = (text: string | null) => {
      const tip = tooltipRef.current;
      if (tip && pointer) tip.style.transform = `translate(${pointer.x + 14}px, ${pointer.y + 14}px)`;
      setTooltip(text);
    };

    function updateHover() {
      if (!pointer) {
        useUi.getState().hover(null);
        return setTip(null);
      }
      const order = useUi.getState().moveOrder;
      const marker = !order ? markerAt(markers, pointer.x, pointer.y) : undefined;
      if (marker) {
        overlay.style.cursor = "pointer";
        useUi.getState().hover({ kind: "units", province: marker.stack.province, owner: marker.stack.owner });
        return setTip(stackLabel(marker.stack));
      }
      const hit = pick(pointer.x, pointer.y);
      if (order) {
        overlay.style.cursor = "crosshair";
        useUi.getState().hover(hit ? { kind: "province", id: hit.province } : null);
        return setTip(hit ? `${getProvince(hit.province)?.name ?? ""}: ${previewMove(useGame.getState().state, order, hit.province)}` : "Click a province to send your units there");
      }
      const s = selectionFor(hit);
      useUi.getState().hover(s);
      overlay.style.cursor = hit ? "pointer" : "grab";
      if (!hit) return setTip(null);
      const country = getCountry(hit.country)?.name ?? hit.country;
      setTip(s?.kind === "province" ? `${getProvince(hit.province)?.name ?? hit.province} · ${country}` : country);
    }

    function orderMove(units: number[], province: ProvinceId) {
      const me = playerCountry(useGame.getState().state);
      if (me) useGame.getState().send({ type: "moveUnits", country: me.id, units, to: province });
    }

    const onDown = (e: PointerEvent) => {
      overlay.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      anim = null;
      drag = { ...p, moved: false, pinch: pointers.size === 2 ? pinchDistance() : null };
    };
    const pinchDistance = () => {
      const [a, b] = [...pointers.values()];
      return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      pointer = p;
      if (drag && pointers.has(e.pointerId)) {
        const prev = pointers.get(e.pointerId)!;
        pointers.set(e.pointerId, p);
        if (pointers.size === 2 && drag.pinch) {
          const d = pinchDistance();
          cam.radius = Math.max(fitRadius, Math.min(fitRadius * MAX_ZOOM, (cam.radius * d) / drag.pinch));
          drag.pinch = d;
          drag.moved = true;
        } else {
          const dx = p.x - prev.x;
          const dy = p.y - prev.y;
          if (Math.hypot(p.x - drag.x, p.y - drag.y) > 4) drag.moved = true;
          // Turn the globe under the pointer: one radius of drag ≈ one radian.
          cam.lon -= (dx / cam.radius) * DEG;
          cam.lat = Math.max(-85, Math.min(85, cam.lat + (dy / cam.radius) * DEG));
          cam.lon = ((((cam.lon + 180) % 360) + 360) % 360) - 180;
        }
        useUi.getState().setZoom(rel());
        overlay.style.cursor = "grabbing";
        setTip(null);
        requestDraw();
        return;
      }
      updateHover();
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      const was = drag;
      if (pointers.size === 0) drag = null;
      if (!was || was.moved || e.button !== 0) return;
      const p = local(e);
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
      ui.select(selectionFor(pick(p.x, p.y)));
    };
    const onLeave = () => {
      pointer = null;
      updateHover();
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      anim = null;
      cam.radius = Math.max(fitRadius, Math.min(fitRadius * MAX_ZOOM, cam.radius * Math.exp(-e.deltaY * 0.0015)));
      useUi.getState().setZoom(rel());
      requestDraw();
    };
    const onDblClick = (e: MouseEvent) => {
      const s = selectionFor(pick(local(e).x, local(e).y));
      if (s) useUi.getState().select(s, { focus: true });
    };
    const onContextMenu = (e: MouseEvent) => {
      const ui = useUi.getState();
      const game = useGame.getState().state;
      const me = playerCountry(game)?.id;
      if (ui.selected?.kind !== "units" || ui.selected.owner !== me) return;
      e.preventDefault();
      const hit = pick(local(e).x, local(e).y);
      const sel = ui.selected;
      const ids = Object.values(game.units)
        .filter((u) => u.province === sel.province && u.owner === me)
        .map((u) => u.id);
      if (hit && ids.length) orderMove(ids, hit.province);
    };
    overlay.addEventListener("pointerdown", onDown);
    overlay.addEventListener("pointermove", onMove);
    overlay.addEventListener("pointerup", onUp);
    overlay.addEventListener("pointercancel", onUp);
    overlay.addEventListener("pointerleave", onLeave);
    overlay.addEventListener("wheel", onWheel, { passive: false });
    overlay.addEventListener("dblclick", onDblClick);
    overlay.addEventListener("contextmenu", onContextMenu);

    const unsubUi = useUi.subscribe((s, prev) => {
      if (!activeRef.current) return;
      if (s.mapMode !== prev.mapMode || s.fog !== prev.fog) textureDirty = true;
      if (s.hovered !== prev.hovered || s.selected !== prev.selected || s.mapMode !== prev.mapMode || s.moveOrder !== prev.moveOrder || s.fog !== prev.fog) requestDraw();
      if (s.selected !== prev.selected && !!s.selected !== !!prev.selected && !anim) animateTo({}, 400); // re-centre beside the panel
      if (s.moveOrder !== prev.moveOrder) updateHover();
      if (s.camera && s.camera !== prev.camera) runCamera(s.camera);
    });
    const ro = new ResizeObserver(() => resize());
    ro.observe(wrap);
    resize();

    // Lets automated tests find places on the globe. Development builds only.
    function installTestHook() {
      if (!import.meta.env.DEV) return;
      (window as unknown as { __gsGlobe?: unknown }).__gsGlobe = {
        pick,
        camera: () => ({ ...cam, zoom: rel() }),
        lastDrawMs: () => lastDrawMs,
        /** Screen point of a province's centre, or null if it's on the far side. */
        screenPointOfProvince: (id: string) => {
          const g = GEOGRAPHY.provinces[id as ProvinceId];
          return g && visible(g.lon, g.lat) ? projection()([g.lon, g.lat]) : null;
        },
        lookAt: (lon: number, lat: number, zoom = 1) => {
          anim = null;
          Object.assign(cam, { lon, lat, radius: fitRadius * zoom });
          requestDraw();
        },
      };
    }

    // W/A/S/D (and arrows) turn the globe: one radius on screen ≈ one radian, as when dragging.
    const stopKeys = startKeyPan(
      (dx, dy) => {
        cam.lon += (dx / cam.radius) * DEG;
        cam.lat = Math.max(-85, Math.min(85, cam.lat - (dy / cam.radius) * DEG));
        cam.lon = ((((cam.lon + 180) % 360) + 360) % 360) - 180;
        setTip(null);
        requestDraw();
      },
      () => useUi.getState().view === "globe",
    );

    return () => {
      disposed = true;
      stopKeys();
      worker.terminate();
      unsubGame();
      unsubUi();
      ro.disconnect();
      cancelAnimationFrame(frameId);
      overlay.removeEventListener("pointerdown", onDown);
      overlay.removeEventListener("pointermove", onMove);
      overlay.removeEventListener("pointerup", onUp);
      overlay.removeEventListener("pointercancel", onUp);
      overlay.removeEventListener("pointerleave", onLeave);
      overlay.removeEventListener("wheel", onWheel);
      overlay.removeEventListener("dblclick", onDblClick);
      overlay.removeEventListener("contextmenu", onContextMenu);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="map globe" ref={wrapRef} aria-hidden={!active}>
      <canvas ref={glRef} className="globe__gl" />
      <canvas ref={overlayRef} className="globe__overlay" aria-label="Globe" role="img" data-testid="globe-canvas" />
      <div ref={tooltipRef} className="map-tooltip" style={{ opacity: tooltip ? 1 : 0 }} aria-hidden>
        {tooltip}
      </div>
      {load.status === "loading" && <div className="map-status">Building the globe…</div>}
      {load.status === "error" && <div className="map-status map-status--error">Could not show the globe: {load.message}</div>}
    </div>
  );
}
