import type { CountryId } from "@gs/shared";
import type { CountryShape, ProvinceShape } from "./geo";

export type DetailLevel = "low" | "high";

export type WorkerRequest =
  | { type: "load"; baseUrl: string; owners: Record<string, CountryId> }
  | { type: "owners"; owners: Record<string, CountryId> };

export type WorkerResponse =
  | { type: "level"; level: DetailLevel; provinces: ProvinceShape[]; countries: CountryShape[] }
  | { type: "countries"; level: DetailLevel; countries: CountryShape[]; gen: number }
  | { type: "error"; message: string };
