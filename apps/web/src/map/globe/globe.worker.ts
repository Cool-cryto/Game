/// <reference lib="webworker" />
// Builds the globe's shapes (in equirectangular texture space) off the main thread.
import type { CountryId } from "@gs/shared";
import { buildCountryShapes, buildProvinceShapes, createEquirectFrame, type CountryShape, type ProvinceShape, type ProvinceTopology } from "../geo";

export type GlobeWorkerRequest =
  | { type: "load"; baseUrl: string; width: number; owners: Record<string, CountryId> }
  | { type: "owners"; owners: Record<string, CountryId> };

export type GlobeWorkerResponse =
  | { type: "shapes"; provinces: ProvinceShape[]; countries: CountryShape[] }
  | { type: "countries"; countries: CountryShape[] }
  | { type: "error"; message: string };

let topo: ProvinceTopology | null = null;
let frame = createEquirectFrame(4096);
const post = (m: GlobeWorkerResponse) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<GlobeWorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === "load") {
      frame = createEquirectFrame(msg.width);
      const res = await fetch(`${msg.baseUrl}maps/provinces-low.topo.json`);
      if (!res.ok) throw new Error(`Map data request failed (${res.status})`);
      topo = (await res.json()) as ProvinceTopology;
      post({ type: "shapes", provinces: buildProvinceShapes(topo, frame), countries: buildCountryShapes(topo, frame, msg.owners) });
    } else if (msg.type === "owners" && topo) {
      post({ type: "countries", countries: buildCountryShapes(topo, frame, msg.owners) });
    }
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
