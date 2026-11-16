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
  /** The management screen open over the map (null = just the world map). One at a time. */
  screen: ScreenId | null;
  setScreen: (screen: ScreenId | null) => void;
  /** Map panels show every detail (after "Show all details"), not just the essentials. */
  details: boolean;
  setDetails: (on: boolean) => void;
  /** The tab last opened on each screen. */
  tabs: Partial<Record<ScreenId, string>>;
  setTab: (screen: ScreenId, tab: string) => void;
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

export const SCREENS = ["country", "economy", "military", "diplomacy", "government", "research", "construction", "statistics", "more"] as const;
export type ScreenId = (typeof SCREENS)[number];

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
  screen: null,
  setScreen: (screen) => set({ screen, moveOrder: null }),
  details: false,
  setDetails: (details) => set({ details }),
  tabs: {},
  setTab: (screen, tab) => set((s) => ({ tabs: { ...s.tabs, [screen]: tab } })),
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
        ? { selected, camera: { kind: "focus", target: selected, nonce: ++nonce } }
        : { selected },
    ),
  setMapMode: (mapMode) => set({ mapMode }),
  setZoom: (zoom) => set({ zoom }),
  command: (cmd) => set({ camera: { ...cmd, nonce: ++nonce } }),
}));
