import { create } from "zustand";
import type { CountryId, ProvinceId, Scenario } from "@gs/shared";
import { applyCustomWorld, createGameState, provincesByOwner, type CustomWorld, type GameState } from "@gs/sim";
import { GEOGRAPHY, registerStateCountries } from "../data/countries";
import { scenarioById } from "../data/scenarios";
import { setPreviewMode, useGame } from "./gameStore";

/**
 * The world editor. You paint provinces onto countries (existing or new ones);
 * the result is a CustomWorld (only the changes). While editing, the map shows
 * a preview game built from the draft; the real game is kept and restored when
 * you close the editor without playing.
 */
interface EditorState {
  active: boolean;
  base: Scenario | null;
  draft: CustomWorld;
  /** The country new clicks give provinces to. */
  brush: CountryId | null;
  /** Next map click picks the brush instead of painting. */
  picking: boolean;
  /** Paint one province, or a whole country at once. */
  paintWhole: boolean;
  /** For undo: what each click changed (province → previous override, or null). */
  history: Record<string, CountryId | null>[];
  busy: boolean;
  open: (baseId?: string) => Promise<void>;
  close: () => void;
  setBase: (baseId: string) => Promise<void>;
  setName: (name: string) => void;
  setBrush: (c: CountryId | null) => void;
  setPicking: (on: boolean) => void;
  setPaintWhole: (on: boolean) => void;
  addCountry: (name: string, color: string) => CountryId;
  click: (province: ProvinceId) => void;
  undo: () => void;
  reset: () => void;
  load: (world: CustomWorld) => Promise<void>;
}

const emptyDraft = (base: string): CustomWorld => ({ version: 1, name: "My world", base, owners: {}, newCountries: {} });

/** The game that was running before the editor opened. */
let previous: GameState | null = null;
let rebuildTimer: ReturnType<typeof setTimeout> | null = null;

/** Show the draft on the map (a preview game; time doesn't run). */
function showPreview() {
  const { base, draft } = useEditor.getState();
  if (!base) return;
  if (rebuildTimer) clearTimeout(rebuildTimer);
  // Short delay so quick clicks are drawn together.
  rebuildTimer = setTimeout(() => {
    const state = createGameState(applyCustomWorld(base, draft), GEOGRAPHY, 1);
    registerStateCountries(state);
    useGame.setState((g) => ({ state, provincesOf: provincesByOwner(state), generation: g.generation + 1 }));
  }, 60);
}

/** Who owns a province in the draft right now. */
const ownerInDraft = (p: ProvinceId) => {
  const { base, draft } = useEditor.getState();
  return (draft.owners[p] ?? base?.provinces[p]?.owner) as CountryId | undefined;
};

export const useEditor = create<EditorState>((set, get) => ({
  active: false,
  base: null,
  draft: emptyDraft("modern"),
  brush: null,
  picking: false,
  paintWhole: false,
  history: [],
  busy: false,
  open: async (baseId = "modern") => {
    if (get().active) return;
    useGame.getState().hold("editor", true);
    previous = useGame.getState().state;
    setPreviewMode(true);
    // Busy until the starting world has loaded, so nothing done meanwhile gets wiped.
    set({ active: true, busy: true, base: null });
    await get().setBase(baseId);
  },
  close: () => {
    setPreviewMode(false);
    set({ active: false, picking: false });
    if (previous) useGame.getState().replace(previous);
    previous = null;
    useGame.getState().hold("editor", false);
  },
  setBase: async (baseId) => {
    set({ busy: true });
    const base = await scenarioById(baseId)!.load();
    set((s) => ({ base, draft: { ...emptyDraft(baseId), name: s.draft.name }, history: [], brush: null, busy: false }));
    showPreview();
  },
  setName: (name) => set((s) => ({ draft: { ...s.draft, name } })),
  setBrush: (brush) => set({ brush, picking: false }),
  setPicking: (picking) => set({ picking }),
  setPaintWhole: (paintWhole) => set({ paintWhole }),
  addCountry: (name, color) => {
    const existing = new Set(Object.keys(get().draft.newCountries));
    let n = existing.size + 1;
    while (existing.has(`C-${n}`)) n++;
    const id = `C-${n}` as CountryId;
    set((s) => ({ draft: { ...s.draft, newCountries: { ...s.draft.newCountries, [id]: { name: name.trim().slice(0, 40), color } } }, brush: id }));
    showPreview(); // so the new country is known everywhere (names, colors)
    return id;
  },
  click: (province) => {
    const s = get();
    if (!s.base || s.busy) return;
    if (s.picking) {
      const owner = ownerInDraft(province);
      if (owner) set({ brush: owner, picking: false });
      return;
    }
    if (!s.brush) return;
    const targets: ProvinceId[] = s.paintWhole
      ? (Object.keys(s.base.provinces) as ProvinceId[]).filter((p) => ownerInDraft(p) === ownerInDraft(province))
      : [province];
    const owners = { ...s.draft.owners };
    const undo: Record<string, CountryId | null> = {};
    for (const p of targets) {
      if (ownerInDraft(p) === s.brush) continue;
      undo[p] = owners[p] ?? null;
      // Giving a province back to its original owner removes the change.
      if (s.base.provinces[p]?.owner === s.brush) delete owners[p];
      else owners[p] = s.brush;
    }
    if (!Object.keys(undo).length) return;
    set({ draft: { ...s.draft, owners }, history: [...s.history, undo].slice(-200) });
    showPreview();
  },
  undo: () => {
    const s = get();
    const last = s.history[s.history.length - 1];
    if (!last) return;
    const owners = { ...s.draft.owners };
    for (const [p, prev] of Object.entries(last)) {
      if (prev) owners[p] = prev;
      else delete owners[p];
    }
    set({ draft: { ...s.draft, owners }, history: s.history.slice(0, -1) });
    showPreview();
  },
  reset: () => {
    set((s) => ({ draft: { ...emptyDraft(s.draft.base), name: s.draft.name }, history: [], brush: null }));
    showPreview();
  },
  load: async (world) => {
    if (get().draft.base !== world.base || !get().base) await get().setBase(world.base);
    set({ draft: world, history: [], brush: null });
    showPreview();
  },
}));

/** Leave the editor and play the draft in single player. */
export function playDraft(scenario: Scenario) {
  setPreviewMode(false);
  useEditor.setState({ active: false, picking: false });
  previous = null;
  useGame.getState().replace(createGameState(scenario, GEOGRAPHY, Date.now() % 2 ** 31));
}
