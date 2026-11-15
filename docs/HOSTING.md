# Putting the game online

The game is one Node.js process (the game server, which also serves the web page) plus one SQLite database file.
Any host that runs a container around the clock with a **persistent disk** works. The repository includes:

| File | What it's for |
|---|---|
| `Dockerfile` | Builds the web client and runs the game server. Works on Railway, Fly.io, Render or any server with Docker. |
| `railway.json` | Railway settings: build with the Dockerfile, health check on `/api/health`, restart if it crashes. |

## Settings (environment variables)

| Variable | Value | Why |
|---|---|---|
| `DATA_DIR` | `/data` (already set in the Dockerfile) | Where the database lives. **Must be on a persistent volume**, or accounts and games vanish on every deploy. |
| `TRUST_PROXY` | `1` | Hosts put a proxy in front of the game. This makes the sign-in limit count each player's own address instead of the proxy's. Only set it when there *is* a proxy (all the hosts below have one). |
| `PORT` | set by the host (Railway does it automatically) | The port the server listens on. The Dockerfile defaults to 8787. |
| `GRACE_MS` | optional, default `30000` | How long a disconnected player's country waits before the AI takes over. |

HTTPS comes from the host. The browser then connects to the game with `wss://` automatically; nothing to configure.

## Railway (recommended: no command line needed)

1. Sign up at railway.com with your GitHub account. A paid plan (Hobby, about $5/month) is needed for an
   always-on server with a volume.
2. **New Project → Deploy from GitHub repo → `Cool-cryto/Game`.** In the service's **Settings → Source**, set the
   branch to the one you play from (e.g. `claude/browser-game-skills-gq45g9`). Railway finds `railway.json` and the Dockerfile.
3. **Add a volume:** right-click the service (or ⌘K → "Volume") → mount path **`/data`**.
4. **Variables:** add `TRUST_PROXY` = `1`.
5. **Settings → Networking → Generate Domain.** Use port **8787** if asked. You get an address like
   `something.up.railway.app`.
6. Open that address: the game loads; **Play online** creates an account on your server.

Each push to the chosen branch redeploys automatically. Players are disconnected for a few seconds and reconnect on
their own; games are saved when the server stops (it receives the host's stop signal).

## Fly.io (alternative, uses a command line)

```bash
fly launch --no-deploy          # creates fly.toml; answer "no" to databases
fly volumes create data --size 1
```

In `fly.toml` add a mount (`[mounts] source = "data"`, `destination = "/data"`), set `internal_port = 8787`,
`auto_stop_machines = "off"` and `min_machines_running = 1` (a stopped machine drops every player),
and add `TRUST_PROXY = "1"` under `[env]`. Then `fly deploy`.

## The $5 paywall (optional)

With the paywall on, visitors see a welcome menu that explains the game. To play (single player or online) they
need an account that has **bought the game once** or been given a **free pass** by an admin. The server enforces it:
without access it won't send the map files or allow online play.

| Variable | Value | Why |
|---|---|---|
| `PAYWALL` | `1` | Turns the paywall on. Leave it out and everyone can play. |
| `ADMIN_USERS` | your username, e.g. `Cool-cryto` (comma-separate several) | Admins always have access and can give or remove free passes (Game menu → **Free passes**). **Create that account on your server first**, then add the variable, so nobody else can claim the name. |
| `PRICE_CENTS` | `500` (default) | The price: 500 = $5.00. |
| `CURRENCY` | `usd` (default) | Any currency Stripe supports. |
| `STRIPE_SECRET_KEY` | `sk_test_…` or `sk_live_…` | Lets players pay. Without it the welcome menu says purchases open soon (free passes still work). |
| `STRIPE_WEBHOOK_SECRET` | `whsec_…` (optional) | Stripe also tells the server directly about payments, in case a player closes the page before returning. |
| `PUBLIC_URL` | e.g. `https://game-production-f031a71a.up.railway.app` (optional) | Where Stripe sends players back after paying. Worked out automatically if not set. |

### Setting up Stripe

1. Create an account at stripe.com (Stripe takes a small fee per payment; there's no monthly cost).
2. Try it first in **test mode**: Developers → API keys → copy the **secret key** (`sk_test_…`) into `STRIPE_SECRET_KEY`.
   Pay with Stripe's test card `4242 4242 4242 4242`, any future date and any CVC; nothing is charged.
3. Optional webhook: Developers → Webhooks → **Add endpoint** → URL `https://<your address>/api/stripe/webhook`,
   events `checkout.session.completed` and `checkout.session.async_payment_succeeded`. Copy its signing secret into `STRIPE_WEBHOOK_SECRET`.
4. When you're ready to take real money, finish Stripe's account activation and switch both values to the live ones (`sk_live_…`, and a live webhook).

Card details are typed on Stripe's own page; they never reach the game server.

## Checking it works

- `https://<your address>/api/health` should answer `{"ok":true,"rooms":…}`.
- Open the game in two browsers (or ask a friend), sign in, join the same private server with its invite code.

## Limits

- One process hosts every room (up to 100 rooms; tested with 50 players in one room). For more, you'd run more
  processes and send each room's players to the right one; not needed yet.
- The database is a single file: back it up by copying `/data/game.db` (Railway: volume backups in its settings).
- No password reset (needs email), so players who forget their password need a new account.
