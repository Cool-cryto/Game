import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Db } from "./db";
import type { PaywallConfig } from "./paywall";

/**
 * Square Checkout: the player pays $5 on Square's own page (a payment link for
 * one item), then comes back to the game. We remember which Square order
 * belongs to which player, and unlock the game once Square says that order is
 * paid: either when the player returns (we ask Square about their orders) or
 * when Square's webhook tells us. Card details never touch this server.
 */
export interface SquareConfig {
  accessToken: string;
  locationId: string;
  environment: "sandbox" | "production";
  /** Signature key of the webhook subscription (optional). */
  webhookSignatureKey?: string;
  /** The exact URL the webhook subscription posts to (Square signs it together with the body). */
  webhookUrl?: string;
}

/** Square API version these requests are written against. */
const SQUARE_VERSION = "2025-01-23";
const apiBase = (sq: SquareConfig) => (sq.environment === "production" ? "https://connect.squareup.com/v2" : "https://connect.squareupsandbox.com/v2");

async function square(cfg: PaywallConfig, method: "GET" | "POST", path: string, body?: unknown) {
  const sq = cfg.square!;
  const res = await (cfg.stripeFetch ?? fetch)(`${apiBase(sq)}${path}`, {
    method,
    headers: { authorization: `Bearer ${sq.accessToken}`, "square-version": SQUARE_VERSION, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, unknown> & { errors?: { detail?: string; code?: string }[] };
  if (!res.ok) throw new Error(json.errors?.[0]?.detail ?? json.errors?.[0]?.code ?? `Square answered ${res.status}`);
  return json;
}

/** Make a Square payment link for this player and remember its order. Returns the page to send them to. */
export async function createSquareCheckout(cfg: PaywallConfig, db: Db, user: { id: number; username: string }, baseUrl: string): Promise<string> {
  const sq = cfg.square!;
  const res = await square(cfg, "POST", "/online-checkout/payment-links", {
    idempotency_key: randomUUID(),
    quick_pay: {
      name: "World Ascendant (full game)",
      price_money: { amount: cfg.priceCents, currency: cfg.currency.toUpperCase() },
      location_id: sq.locationId,
    },
    checkout_options: { redirect_url: `${baseUrl}/?checkout=square`, ask_for_shipping_address: false },
    payment_note: `World Ascendant for ${user.username} (player ${user.id})`,
  });
  const link = res.payment_link as { url?: string; order_id?: string } | undefined;
  if (!link?.url || !link.order_id) throw new Error("Square didn't return a checkout page.");
  db.addCheckout(link.order_id, user.id, "square");
  return link.url;
}

/** Is this Square order paid in full, for the right amount? */
function orderPaid(cfg: PaywallConfig, order: Record<string, unknown> | undefined): boolean {
  if (!order) return false;
  const total = order.total_money as { amount?: number; currency?: string } | undefined;
  const due = (order.net_amount_due_money as { amount?: number } | undefined)?.amount;
  const paidState = order.state === "COMPLETED" || (Array.isArray(order.tenders) && order.tenders.length > 0 && due === 0);
  return paidState && Number(total?.amount) >= cfg.priceCents && String(total?.currency).toLowerCase() === cfg.currency;
}

/** Unlock the game for whoever this order belongs to, if it's paid. Returns the user id unlocked, or null. */
export function completeSquareOrder(cfg: PaywallConfig, db: Db, order: Record<string, unknown> | undefined): number | null {
  const orderId = typeof order?.id === "string" ? order.id : null;
  if (!orderId || !orderPaid(cfg, order)) return null;
  const userId = db.checkoutUser(orderId, "square");
  if (userId === null) return null;
  db.addPayment(orderId, userId, Number((order!.total_money as { amount: number }).amount));
  if (db.accessOf(userId) === null) db.setAccess(userId, "paid");
  return userId;
}

/** The player came back from Square: check their recent orders. */
export async function confirmSquare(cfg: PaywallConfig, db: Db, userId: number): Promise<boolean> {
  const orderIds = db.checkoutsOf(userId, "square");
  if (!orderIds.length) return false;
  const res = await square(cfg, "POST", "/orders/batch-retrieve", { location_id: cfg.square!.locationId, order_ids: orderIds.slice(0, 20) });
  for (const order of (res.orders as Record<string, unknown>[] | undefined) ?? []) completeSquareOrder(cfg, db, order);
  return db.accessOf(userId) !== null;
}

/** A webhook from Square ("payment.created" / "payment.updated"): fetch the order and unlock if it's paid. */
export async function handleSquareEvent(cfg: PaywallConfig, db: Db, event: Record<string, unknown>): Promise<number | null> {
  const payment = ((event.data as Record<string, unknown> | undefined)?.object as { payment?: { order_id?: string; status?: string } } | undefined)?.payment;
  if (!payment?.order_id || payment.status !== "COMPLETED") return null;
  if (db.checkoutUser(payment.order_id, "square") === null) return null; // not one of ours
  const res = await square(cfg, "GET", `/orders/${encodeURIComponent(payment.order_id)}`);
  return completeSquareOrder(cfg, db, res.order as Record<string, unknown>);
}

/** Square signs webhooks: base64 HMAC-SHA256 of (notification URL + raw body) with the subscription's signature key. */
export function verifySquareSignature(rawBody: string, header: string | undefined, key: string, url: string): boolean {
  if (!header) return false;
  const expected = createHmac("sha256", key).update(url + rawBody).digest();
  const given = Buffer.from(header, "base64");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
