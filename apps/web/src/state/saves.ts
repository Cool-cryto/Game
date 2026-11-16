import { MODERN_SCENARIO } from "../data/countries";
import { deserialize, serialize, currentDate, type GameState } from "@gs/sim";
import { getCountry } from "../data/countries";

/** Organizations for saves from before treaties existed (the 1991 data loads on demand, so only the modern world's are at hand). */
const organizationsFor = (scenarioId: string) => (scenarioId === "modern" ? MODERN_SCENARIO.organizations : undefined);
import { playerCountry } from "./gameStore";

/**
 * Saved games live in this browser's IndexedDB (saves are ~1-2 MB, too big for
 * localStorage). They stay on this device only; use Export to keep a copy.
 */
export const SLOTS = [1, 2, 3] as const;
export type Slot = (typeof SLOTS)[number];

export interface SaveInfo {
  slot: Slot;
  savedAt: number;
  gameDate: string;
  country: string | null;
}

const DB = "world-ascendant";
const STORE = "saves";

/** Version 2 added the "worlds" store (custom worlds from the editor). */
export function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 2);
    req.onupgradeneeded = () => {
      for (const name of [STORE, "worlds"]) if (!req.result.objectStoreNames.contains(name)) req.result.createObjectStore(name);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Saving isn't available in this browser."));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Save storage error"));
  });
}

export function describe(state: GameState) {
  return { gameDate: currentDate(state), country: getCountry(playerCountry(state)?.id)?.name ?? null };
}

export async function saveToSlot(slot: Slot, state: GameState): Promise<void> {
  const info: SaveInfo = { slot, savedAt: Date.now(), ...describe(state) };
  await run("readwrite", (s) => s.put({ info, data: serialize(state) }, slot));
}

export async function loadFromSlot(slot: Slot): Promise<GameState> {
  const rec = (await run("readonly", (s) => s.get(slot))) as { data: string } | undefined;
  if (!rec) throw new Error(`Slot ${slot} is empty.`);
  return deserialize(rec.data, MODERN_SCENARIO.countries, organizationsFor);
}

export async function deleteSlot(slot: Slot): Promise<void> {
  await run("readwrite", (s) => s.delete(slot));
}

export async function listSlots(): Promise<Partial<Record<Slot, SaveInfo>>> {
  const out: Partial<Record<Slot, SaveInfo>> = {};
  for (const slot of SLOTS) {
    const rec = (await run("readonly", (s) => s.get(slot))) as { info: SaveInfo } | undefined;
    if (rec) out[slot] = rec.info;
  }
  return out;
}

/** Download the game as a file. */
export function exportSave(state: GameState) {
  const { gameDate, country } = describe(state);
  const blob = new Blob([serialize(state)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `world-ascendant-${(country ?? "world").toLowerCase().replace(/\W+/g, "-")}-${gameDate}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export async function importSave(file: File): Promise<GameState> {
  return deserialize(await file.text(), MODERN_SCENARIO.countries, organizationsFor);
}
