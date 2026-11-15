// Starts the game server. Settings come from environment variables:
//   PORT        port to listen on (default 8787)
//   DATA_DIR    where the database is kept (default ./data)
//   GRACE_MS    ms before the AI takes over a disconnected player's country (default 30000)
//   WEB_DIST    built web client to serve (default apps/web/dist, if it exists)
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Scenario } from "@gs/shared";
import { geographyFrom, type GeographyData } from "@gs/sim";
import { Db } from "./db";
import { startServer } from "./server";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..", "..", "..");
const dataFile = (name: string) => JSON.parse(readFileSync(join(repo, "apps", "web", "src", "data", name), "utf8")) as unknown;

const dataDir = resolve(process.env.DATA_DIR ?? join(repo, "data"));
const webDist = process.env.WEB_DIST ?? join(repo, "apps", "web", "dist");
const db = new Db(join(dataDir, "game.db"));

const server = await startServer({
  port: Number(process.env.PORT ?? 8787),
  db,
  scenario: dataFile("scenario-modern.json") as Scenario,
  geo: geographyFrom(dataFile("geography.json") as GeographyData),
  webDist: existsSync(join(webDist, "index.html")) ? webDist : null,
  graceMs: Number(process.env.GRACE_MS ?? 30_000),
  globalSpeed: 2,
  saveEveryMs: 60_000,
});

// Save everything before stopping (Ctrl+C, or the host restarting the server).
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    console.log("Saving and shutting down…");
    void server.close().then(() => {
      db.close();
      process.exit(0);
    });
  });
}
