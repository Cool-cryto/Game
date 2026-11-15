import { createHmac, timingSafeEqual } from "node:crypto";
import type { Access, Db } from "./db";

/**
 * The paywall: the game is unlocked by buying it once (through Stripe Checkout),
 * or by a free pass that an admin gives to a username. Admins always have access.
 *
 * Card details never touch this server: players pay on Stripe's own page, and
 * Stripe tells us the payment went through (a signed webhook, or us asking
 * Stripe about the checkout when the player comes back).
 */
export interface PaywallConfig {
  /** Price in cents (500 = $5.00). */
  priceCents: number;
  currency: string;
  /** Usernames that can give and take away free passes (case-insensitive). */
  admins: string[];
  /** Stripe secret key (sk_live_… or sk_test_…). Without it the Buy button says purchases aren't open yet. */
  stripeSecretKey?: string;
  /** Signing secret of the Stripe webhook (whsec_…). Optional: purchases are also confirmed when the player returns. */
  stripeWebhookSecret?: string;
  /** Where players come back to after paying, e.g. https://game.example.com. Worked out from the request if not set. */
  publicUrl?: string;
  /** For tests: stands in for Stripe's API. */
  stripeFetch?: typeof fetch;
}

const STRIPE_API = "https://api.stripe.com/v1";

export const isAdmin = (cfg: PaywallConfig, username: string) => cfg.admins.some((a) => a.toLowerCase() === username.toLowerCase());

/** Can this user play? */
export function hasAccess(cfg: PaywallConfig | null, db: Db, user: { id: number; username: string }): boolean {
  if (!cfg) return true;
  return isAdmin(cfg, user.username) || db.accessOf(user.id) !== null;
}

export function accessKind(cfg: PaywallConfig | null, db: Db, user: { id: number; username: string }): Access | "admin" {
  if (cfg && isAdmin(cfg, user.username)) return "admin";
  return db.accessOf(user.id);
}

async function stripe(cfg: PaywallConfig, method: "GET" | "POST", path: string, form?: Record<string, string>) {
  const res = await (cfg.stripeFetch ?? fetch)(`${STRIPE_API}${path}`, {
    method,
    headers: { authorization: `Bearer ${cfg.stripeSecretKey}`, ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const body = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(body.error?.message ?? `Stripe answered ${res.status}`);
  return body;
}

/** Start a Stripe Checkout for this user. Returns the page to send them to. */
export async function createCheckout(cfg: PaywallConfig, user: { id: number; username: string }, baseUrl: string): Promise<string> {
  const session = await stripe(cfg, "POST", "/checkout/sessions", {
    mode: "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": cfg.currency,
    "line_items[0][price_data][unit_amount]": String(cfg.priceCents),
    "line_items[0][price_data][product_data][name]": "World Ascendant",
    "line_items[0][price_data][product_data][description]": `Full game for ${user.username}: single player and online play`,
    client_reference_id: String(user.id),
    "metadata[user_id]": String(user.id),
    "metadata[username]": user.username,
    success_url: `${baseUrl}/?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${baseUrl}/?checkout=cancelled`,
  });
  if (typeof session.url !== "string") throw new Error("Stripe didn't return a checkout page.");
  return session.url;
}

/**
 * A finished checkout: if it was paid in full, unlock the game for the user it was for.
 * Safe to call more than once for the same checkout. Returns the user id that was unlocked, or null.
 */
export function completeCheckout(cfg: PaywallConfig, db: Db, session: Record<string, unknown>): number | null {
  const id = typeof session.id === "string" ? session.id : null;
  const userId = Number(session.client_reference_id);
  const amount = Number(session.amount_total);
  if (!id || session.payment_status !== "paid" || !Number.isInteger(userId) || !db.userById(userId)) return null;
  if (!(amount >= cfg.priceCents) || String(session.currency).toLowerCase() !== cfg.currency) return null;
  db.addPayment(id, userId, amount);
  if (db.accessOf(userId) === null) db.setAccess(userId, "paid");
  return userId;
}

/** Ask Stripe about a checkout the player says they finished (they come back with its id). */
export async function confirmCheckout(cfg: PaywallConfig, db: Db, userId: number, checkoutId: string): Promise<boolean> {
  if (!/^cs_[A-Za-z0-9_]{1,200}$/.test(checkoutId)) return false;
  const session = await stripe(cfg, "GET", `/checkout/sessions/${checkoutId}`);
  // Only the player who bought it can confirm it.
  if (Number(session.client_reference_id) !== userId) return false;
  return completeCheckout(cfg, db, session) === userId;
}

/**
 * Check a Stripe webhook's signature (header "Stripe-Signature: t=…,v1=…"):
 * HMAC-SHA256 of "t.body" with the webhook secret, at most 5 minutes old.
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowSeconds = Date.now() / 1000): boolean {
  if (!header) return false;
  const parts = header.split(",").map((p) => p.split("=", 2) as [string, string]);
  const t = Number(parts.find(([k]) => k === "t")?.[1]);
  if (!Number.isFinite(t) || Math.abs(nowSeconds - t) > 300) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest();
  return parts
    .filter(([k]) => k === "v1")
    .some(([, v]) => {
      const given = Buffer.from(v ?? "", "hex");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
}

/** Paywall settings from environment variables (PAYWALL=1 turns it on). */
export function paywallFromEnv(env: NodeJS.ProcessEnv): PaywallConfig | null {
  if (env.PAYWALL !== "1") return null;
  return {
    priceCents: Number(env.PRICE_CENTS ?? 500),
    currency: (env.CURRENCY ?? "usd").toLowerCase(),
    admins: (env.ADMIN_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
    stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined,
    publicUrl: env.PUBLIC_URL?.replace(/\/$/, "") || undefined,
  };
}
