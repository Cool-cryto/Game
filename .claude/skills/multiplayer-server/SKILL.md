---
name: multiplayer-server
description: How this game's multiplayer works — the Node.js game server, accounts, rooms, the client/server protocol, state sync (snapshots and patches), AI takeover, saving, and security rules. Use when changing anything in apps/server, packages/sim/src/net.ts or protocol.ts, apps/web/src/net, or when adding a feature that must work online.
---

# Multiplayer server

## Rules that keep multiplayer safe and in sync

- **The server is the only source of truth.** Clients never change game state themselves; they send commands.
- **Every command from the network goes through `checkCommand` (shape + sender's own country) and the engine's `validateCommand`.**
  Never add a command type without adding it to both, and never trust ids or values from the client.
- **New `GameState` fields** must also be handled in `StateDiffer.diff` / `applyPatch` (packages/sim/src/net.ts), or online
  players will never see them. Add a test in the "network sync" block of `packages/sim/src/sim.test.ts`.
- Picking a country uses the `claim`/`release` messages (one human per country), not commands.
- Keep patches small: send changed fields only; round numbers (`round5`); don't resend all provinces every month.
  Re-run the server load test (`npm test -w @gs/server`, look for `LOAD`) after changing what's synced.
- Passwords: scrypt only. Tokens: random, stored hashed. Don't log tokens or passwords.

## Where things are

- `apps/server/src/server.ts` (HTTP + WebSocket + loops), `room.ts` (one world), `auth.ts`, `db.ts` (node:sqlite), `main.ts` (env config).
- `packages/sim/src/protocol.ts` (messages), `net.ts` (sync).
- `apps/web/src/net/online.ts` (browser connection), `state/gameStore.ts` (local vs online mode), `ui/OnlineDialog.tsx`, `ui/OnlinePanel.tsx`.
- Tests: `apps/server/test/server.test.ts`, `apps/web/tests/e2e/online.spec.ts` (two browsers).

## Running

- Dev: `npm run dev` + `npm run dev:server` (Vite proxies /api and /ws to port 8787).
- Production: `npm start` (build + server serving the client). Env: PORT, DATA_DIR, GRACE_MS, WEB_DIST.
