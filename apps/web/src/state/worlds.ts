import type { CustomWorld } from "@gs/sim";
import { db } from "./saves";

/** Custom worlds saved in this browser (IndexedDB), plus file export/import. */
export interface SavedWorld {
  id: string;
  savedAt: number;
  world: CustomWorld;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((resolve, reject) => {
    const req = fn(d.transaction("worlds", mode).objectStore("worlds"));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Storage error"));
  });
}

export const idForName = (name: string) => name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40) || "world";

export async function saveWorld(world: CustomWorld): Promise<void> {
  const rec: SavedWorld = { id: idForName(world.name), savedAt: Date.now(), world };
  await run("readwrite", (s) => s.put(rec, rec.id));
}

export async function listWorlds(): Promise<SavedWorld[]> {
  const all = (await run("readonly", (s) => s.getAll())) as SavedWorld[];
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function deleteWorld(id: string): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
}

export function exportWorld(world: CustomWorld) {
  const blob = new Blob([JSON.stringify(world, null, 1)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `world-${idForName(world.name)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
