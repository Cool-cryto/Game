/// <reference lib="webworker" />
// Builds map shapes off the main thread so the page never freezes while
// thousands of provinces are processed.
import type { CountryId } from "@gs/shared";
import { buildCountryShapes, buildProvinceShapes, createWorldFrame, type ProvinceTopology } from "./geo";
import type { WorkerRequest, WorkerResponse } from "./workerProtocol";

const frame = createWorldFrame();
const topologies: Partial<Record<"low" | "high", ProvinceTopology>> = {};
let owners: Record<string, CountryId> = {};
let generation = 0;

const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);

async function loadLevel(level: "low" | "high", baseUrl: string) {
  const res = await fetch(`${baseUrl}maps/provinces-${level}.topo.json`);
  if (!res.ok) throw new Error(`Map data request failed (${res.status})`);
  const topo = (await res.json()) as ProvinceTopology;
  topologies[level] = topo;
  const labels = level === "low";
  const provinces = buildProvinceShapes(topo, frame, { labels });
  // Built from the owners as they are now: if ownership changed while this was downloading (e.g. a saved game was
  // restored), an "owners" message has already updated them. Dropping the result instead would leave the map loading forever.
  const countries = buildCountryShapes(topo, frame, owners, { labels });
  post({ type: "level", level, provinces, countries });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      owners = msg.owners;
      ++generation;
      await loadLevel("low", msg.baseUrl);
      await loadLevel("high", msg.baseUrl);
    } else if (msg.type === "owners") {
      owners = msg.owners;
      const gen = ++generation;
      for (const level of ["low", "high"] as const) {
        const topo = topologies[level];
        if (topo) post({ type: "countries", level, countries: buildCountryShapes(topo, frame, owners, { labels: level === "low" }), gen });
      }
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
