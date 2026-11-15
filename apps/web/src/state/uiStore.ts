import { create } from "zustand";
import type { CountryId } from "@gs/shared";
import type { MapModeId } from "../map/mapModes";

export type ZoomCommand = { kind: "in" | "out" | "reset" } | { kind: "focus"; id: CountryId };

interface UiState {
  hoveredId: CountryId | null;
  selectedId: CountryId | null;
  mapMode: MapModeId;
  /** Zoom relative to the whole-world view (1 = whole world). */
  zoom: number;
  /** One-shot request for the map camera; nonce makes repeated requests distinct. */
  zoomCommand: (ZoomCommand & { nonce: number }) | null;
  hover: (id: CountryId | null) => void;
  select: (id: CountryId | null, opts?: { focus?: boolean }) => void;
  setMapMode: (mode: MapModeId) => void;
  setZoom: (zoom: number) => void;
  command: (cmd: ZoomCommand) => void;
}

let nonce = 0;

export const useUi = create<UiState>((set) => ({
  hoveredId: null,
  selectedId: null,
  mapMode: "political",
  zoom: 1,
  zoomCommand: null,
  hover: (hoveredId) => set({ hoveredId }),
  select: (selectedId, opts) =>
    set(opts?.focus && selectedId ? { selectedId, zoomCommand: { kind: "focus", id: selectedId, nonce: ++nonce } } : { selectedId }),
  setMapMode: (mapMode) => set({ mapMode }),
  setZoom: (zoom) => set({ zoom }),
  command: (cmd) => set({ zoomCommand: { ...cmd, nonce: ++nonce } }),
}));
