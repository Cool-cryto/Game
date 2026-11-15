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

async function loadLevel(level: "low" | "high", baseUrl: string, gen: number) {
  const res = await fetch(`${baseUrl}maps/provinces-${level}.topo.json`);
  if (!res.ok) throw new Error(`Map data request failed (${res.status})`);
  const topo = (await res.json()) as ProvinceTopology;
  topologies[level] = topo;
  const labels = level === "low";
  const provinces = buildProvinceShapes(topo, frame, { labels });
  const countries = buildCountryShapes(topo, frame, owners, { labels });
  if (gen === generation) post({ type: "level", level, provinces, countries });
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      owners = msg.owners;
      const gen = ++generation;
      await loadLevel("low", msg.baseUrl, gen);
      await loadLevel("high", msg.baseUrl, gen);
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
