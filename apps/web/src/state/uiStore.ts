import { create } from "zustand";
import type { CountryId, ProvinceId } from "@gs/shared";
import type { MapModeId } from "../map/mapModes";

export type Selection = { kind: "country"; id: CountryId } | { kind: "province"; id: ProvinceId } | null;

export type CameraCommand =
  | { kind: "in" | "out" | "reset" }
  | { kind: "focus"; target: NonNullable<Selection> }
  | { kind: "point"; lon: number; lat: number; zoom: number };

interface UiState {
  hovered: Selection;
  selected: Selection;
  mapMode: MapModeId;
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

export const sameSelection = (a: Selection, b: Selection) => a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);

export const useUi = create<UiState>((set) => ({
  hovered: null,
  selected: null,
  mapMode: "political",
  zoom: 1,
  camera: null,
  hover: (hovered) => set((s) => (sameSelection(s.hovered, hovered) ? s : { hovered })),
  select: (selected, opts) =>
    set(opts?.focus && selected ? { selected, camera: { kind: "focus", target: selected, nonce: ++nonce } } : { selected }),
  setMapMode: (mapMode) => set({ mapMode }),
  setZoom: (zoom) => set({ zoom }),
  command: (cmd) => set({ camera: { ...cmd, nonce: ++nonce } }),
}));
