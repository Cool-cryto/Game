import { create } from "zustand";
import { currentSession } from "./online";

/**
 * The paywall, browser side. When the game server has it switched on, players
 * need an account that has bought the game (or been given a free pass) before
 * the game loads; until then they see the welcome menu. The server enforces
 * it too: it won't send the map or let anyone play online without access.
 *
 * Without a game server (opened as a plain web page, or local development
 * without one) there is no paywall and the game starts straight away.
 */
export interface Me {
  user: { id: number; username: string };
  access: boolean;
  accessKind: "paid" | "granted" | "admin" | null;
  admin: boolean;
}
export interface ShopConfig {
  paywall: boolean;
  priceCents: number;
  currency: string;
  /** False until the owner has connected a payment service. */
  canBuy: boolean;
  provider?: "square" | "stripe" | null;
}

interface AccessState {
  status: "checking" | "locked" | "open";
  config: ShopConfig | null;
  me: Me | null;
  /** A note for the welcome screen (e.g. "Payment cancelled"). */
  notice: string | null;
}

export const useAccess = create<AccessState>(() => ({ status: "checking", config: null, me: null, notice: null }));

const apiUrl = (path: string) => new URL(`api/${path}`, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
const authHeaders = (): Record<string, string> => {
  const s = currentSession();
  return s ? { authorization: `Bearer ${s.token}` } : {};
};

async function fetchMe(): Promise<Me | null> {
  if (!currentSession()) return null;
  try {
    const res = await fetch(apiUrl("me"), { headers: authHeaders(), cache: "no-store" });
    return res.ok ? ((await res.json()) as Me) : null;
  } catch {
    return null;
  }
}

/** Work out whether to show the game or the welcome menu. Call once at start-up and after signing in or out. */
export async function refreshAccess(): Promise<void> {
  let config = useAccess.getState().config;
  if (!config) {
    try {
      const res = await fetch(apiUrl("config"), { cache: "no-store" });
      config = res.ok ? ((await res.json()) as ShopConfig) : null;
    } catch {
      config = null;
    }
  }
  if (!config?.paywall) return useAccess.setState({ status: "open", config, me: await fetchMe() });
  const me = await fetchMe();
  useAccess.setState({ config, me, status: me?.access ? "open" : "locked" });
}

/** Back from the payment page: confirm the purchase (the server asks Square or Stripe), then unlock. */
export async function handleCheckoutReturn(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const id = params.get("checkout");
  if (!id) return;
  history.replaceState(null, "", location.pathname); // don't confirm twice on reload
  if (id === "cancelled") return useAccess.setState({ notice: "Payment cancelled. You haven't been charged." });
  useAccess.setState({ notice: "Confirming your payment…" });
  for (let i = 0; i < 6; i++) {
    try {
      const res = await fetch(apiUrl("checkout/confirm"), { method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ id }) });
      if (res.ok && ((await res.json()) as { access?: boolean }).access) return useAccess.setState({ notice: "Thanks for buying World Ascendant! Have fun." });
    } catch {
      /* try again */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  useAccess.setState({ notice: "We haven't received the payment confirmation yet. If you paid, wait a minute and press Check again." });
}

/** Go to the payment page. Returns an error message, or never returns (the page changes). */
export async function startCheckout(): Promise<string | null> {
  try {
    const res = await fetch(apiUrl("checkout"), { method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: "{}" });
    const body = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !body.url) return body.error ?? "Couldn't open the payment page.";
    location.href = body.url;
    return null;
  } catch {
    return "Can't reach the game server.";
  }
}

export interface AdminUser {
  username: string;
  access: "paid" | "granted" | "admin" | null;
  createdAt: number;
}
export async function adminSearch(q: string): Promise<AdminUser[]> {
  const res = await fetch(apiUrl(`admin/users?q=${encodeURIComponent(q)}`), { headers: authHeaders(), cache: "no-store" });
  if (!res.ok) throw new Error(((await res.json()) as { error?: string }).error ?? "Couldn't load players.");
  return ((await res.json()) as { users: AdminUser[] }).users;
}
export async function adminSetAccess(username: string, access: "granted" | null): Promise<string | null> {
  const res = await fetch(apiUrl("admin/access"), { method: "POST", headers: { ...authHeaders(), "content-type": "application/json" }, body: JSON.stringify({ username, access }) });
  return res.ok ? null : (((await res.json()) as { error?: string }).error ?? "That didn't work.");
}

/** "$5" / "$4.99" */
export function formatPrice(c: ShopConfig): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: c.currency.toUpperCase(), minimumFractionDigits: c.priceCents % 100 ? 2 : 0 }).format(c.priceCents / 100);
}
