import { create } from "zustand";
import { currentDate, deserialize, serialize } from "@gs/sim";
import { getCountry, MODERN_SCENARIO } from "../data/countries";
import { db } from "./saves";
import { playerCountry, useGame } from "./gameStore";
import { useEditor } from "./editor";

/**
 * Autosave: the single-player game is kept in this browser (IndexedDB, next to the save slots) so a refresh or a
 * closed tab doesn't lose it. It saves every 5 seconds while time runs, and when the tab is hidden or closed. On the
 * next visit the game is restored automatically. Online games live on the server, so they are never autosaved here.
 */
const STORE = "saves";
const KEY = "auto";
const EVERY_MS = 5_000;

interface AutoRecord {
  savedAt: number;
  gameDate: string;
  country: string | null;
  data: string;
}

/** What was restored on this visit, for a short notice. */
export const useAutosave = create<{ restored: { country: string | null; gameDate: string } | null; dismiss: () => void }>((set) => ({
  restored: null,
  dismiss: () => set({ restored: null }),
}));

/** Kept open so a save started as the page closes begins at once (an await first would lose it). */
let conn: IDBDatabase | null = null;

async function put(rec: AutoRecord | null) {
  const d = conn ?? (conn = await db());
  await new Promise<void>((resolve, reject) => {
    const tx = d.transaction(STORE, "readwrite");
    if (rec) tx.objectStore(STORE).put(rec, KEY);
    else tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("Autosave failed"));
  });
}

async function get(): Promise<AutoRecord | undefined> {
  const d = conn ?? (conn = await db());
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result as AutoRecord | undefined);
    req.onerror = () => reject(req.error ?? new Error("Autosave failed"));
  });
}

let lastTick = -1;
let lastGeneration = -1;

/** Is there a single-player game worth keeping right now? */
function saveable() {
  const g = useGame.getState();
  return g.mode === "local" && !useEditor.getState().active && !!playerCountry(g.state);
}

/** Save now if the game moved on since the last autosave. */
export async function autosaveNow(): Promise<void> {
  if (!saveable()) return;
  const g = useGame.getState();
  if (g.state.tick === lastTick && g.generation === lastGeneration) return;
  lastTick = g.state.tick;
  lastGeneration = g.generation;
  try {
    await put({
      savedAt: Date.now(),
      gameDate: currentDate(g.state),
      country: getCountry(playerCountry(g.state)?.id)?.name ?? null,
      data: serialize(g.state),
    });
  } catch {
    /* storage unavailable (e.g. a private window): the game still runs */
  }
}

/** Forget the autosave (a new game was started). */
export async function clearAutosave(): Promise<void> {
  lastTick = -1;
  try {
    await put(null);
  } catch {
    /* nothing to clear */
  }
}

let started = false;

/** Restore the last autosaved game (if any), then keep autosaving. Safe to call more than once. */
export async function startAutosave(): Promise<void> {
  if (started) return;
  started = true;
  try {
    const rec = await get();
    // Don't replace a game the player already started while this was loading.
    if (rec && !playerCountry(useGame.getState().state) && useGame.getState().mode === "local") {
      const state = deserialize(rec.data, MODERN_SCENARIO.countries, (id) => (id === "modern" ? MODERN_SCENARIO.organizations : undefined));
      useGame.getState().replace(state);
      lastTick = state.tick;
      lastGeneration = useGame.getState().generation;
      useAutosave.setState({ restored: { country: rec.country, gameDate: rec.gameDate } });
    }
  } catch {
    /* a broken or old autosave: start fresh */
  }
  setInterval(() => void autosaveNow(), EVERY_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void autosaveNow();
  });
  window.addEventListener("pagehide", () => void autosaveNow());
}
