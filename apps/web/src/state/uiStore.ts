import { create } from "zustand";
import type { CountryId, ProvinceId } from "@gs/shared";
import type { MapModeId } from "../map/mapModes";

export type Selection =
  | { kind: "country"; id: CountryId }
  | { kind: "province"; id: ProvinceId }
  /** A stack of units: everything one country has in one province. */
  | { kind: "units"; province: ProvinceId; owner: CountryId; id?: undefined }
  | null;

export type CameraCommand =
  | { kind: "in" | "out" | "reset" }
  | { kind: "focus"; target: NonNullable<Selection> }
  | { kind: "point"; lon: number; lat: number; zoom: number };

interface UiState {
  hovered: Selection;
  selected: Selection;
  /** While set, the next click on the map sends these units there. */
  moveOrder: { units: number[] } | null;
  setMoveOrder: (m: { units: number[] } | null) => void;
  mapMode: MapModeId;
  /** Is the world editor open? */
  editor: boolean;
  setEditor: (open: boolean) => void;
  /** Is the "Play online" dialog open? */
  onlineDialog: boolean;
  setOnlineDialog: (open: boolean) => void;
  /**
   * Advanced controls (all map modes, policy sliders, full country details). Off by
   * default: the game starts in simple mode. Remembered in this browser.
   */
  advanced: boolean;
  setAdvanced: (on: boolean) => void;
  /** Simple mode's main panels, opened from the action bar. */
  hud: Hud;
  setHud: (hud: Hud) => void;
  /** Fog of war in single player (online it's always on). Remembered in this browser. */
  fog: boolean;
  setFog: (on: boolean) => void;
  /** Flat map or 3D globe. */
  view: "flat" | "globe";
  setView: (view: "flat" | "globe") => void;
  /** Zoom relative to the whole-world view (1 = whole world). */
  zoom: number;
  /** One-shot request for the map camera; nonce makes repeated requests distinct. */
  camera: (CameraCommand & { nonce: number }) | null;
  hover: (s: Selection) => void;
  select: (s: Selection, opts?: { focus?: boolean }) => void;
  setMapMode: (mode: MapModeId) => void;
  setZoom: (zoom: number) => void;
  command: (cmd: CameraCommand) => void;
}

let nonce = 0;

export type Hud = "country" | "army" | "world" | null;

const ADVANCED_KEY = "wa.advanced";
function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "on";
  } catch {
    return fallback;
  }
}
function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? "on" : "off");
  } catch {
    /* private browsing: just not remembered */
  }
}

const FOG_KEY = "wa.fog";
function loadFog(): boolean {
  try {
    return localStorage.getItem(FOG_KEY) !== "off";
  } catch {
    return true;
  }
}

export const sameSelection = (a: Selection, b: Selection) =>
  a === b ||
  (!!a &&
    !!b &&
    a.kind === b.kind &&
    (a.kind === "units" && b.kind === "units" ? a.province === b.province && a.owner === b.owner : a.id === b.id));

export const useUi = create<UiState>((set) => ({
  hovered: null,
  selected: null,
  moveOrder: null,
  setMoveOrder: (moveOrder) => set({ moveOrder }),
  mapMode: "political",
  view: "flat",
  onlineDialog: false,
  editor: false,
  setEditor: (editor) => set({ editor }),
  setOnlineDialog: (onlineDialog) => set({ onlineDialog }),
  setView: (view) => set({ view }),
  advanced: loadFlag(ADVANCED_KEY, false),
  setAdvanced: (advanced) => {
    saveFlag(ADVANCED_KEY, advanced);
    // Simple mode shows only the political map.
    set(advanced ? { advanced } : { advanced, mapMode: "political", hud: null });
  },
  hud: null,
  setHud: (hud) => set(hud ? { hud, selected: null } : { hud }),
  fog: loadFog(),
  setFog: (fog) => {
    try {
      localStorage.setItem(FOG_KEY, fog ? "on" : "off");
    } catch {
      /* private browsing: the setting just isn't remembered */
    }
    set({ fog });
  },
  zoom: 1,
  camera: null,
  hover: (hovered) => set((s) => (sameSelection(s.hovered, hovered) ? s : { hovered })),
  select: (selected, opts) =>
    set(
      opts?.focus && selected
        ? { selected, hud: null, camera: { kind: "focus", target: selected, nonce: ++nonce } }
        : selected
          ? { selected, hud: null }
          : { selected },
    ),
  setMapMode: (mapMode) => set({ mapMode }),
  setZoom: (zoom) => set({ zoom }),
  command: (cmd) => set({ camera: { ...cmd, nonce: ++nonce } }),
}));
