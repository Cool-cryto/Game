import type { CountryId } from "@gs/shared";
import { logEvent, nameOf, type CountryState, type GameState } from "./state";

/**
 * Statecraft beyond treaties:
 *
 * - Sanctions ("A>B": A sanctions B). Each costs the target 0.15% growth a year (up to 1%), the sanctioner 0.03%,
 *   ends trade agreements between the two, and sours relations.
 * - Aid: money from your treasury to theirs (economic aid) or from your army fund to theirs (military aid).
 *   Relations improve with how much it means to them.
 * - Guarantees of independence ("A>B": A guarantees B). If anyone declares war on B, A joins the defence.
 * - Puppet states (`CountryState.overlord`): a defeated country that must follow its overlord into war, may not
 *   declare war on its own, and pays 10% of its tax revenue as tribute each month.
 */
export const SANCTION_GROWTH = 0.0015;
export const SANCTION_GROWTH_CAP = 0.01;
export const SANCTIONER_COST = 0.0003;
export const MAX_GUARANTEES = 5;
export const TRIBUTE_SHARE = 0.1;
/** Aid must be at least this share of the giver's yearly GDP (no token gifts for relations). */
export const MIN_AID_SHARE = 0.001;

export const sanctionKey = (from: CountryId, to: CountryId) => `${from}>${to}`;
export const hasSanction = (s: GameState, from: CountryId, to: CountryId) => (s.sanctions ?? []).includes(sanctionKey(from, to));
export const hasGuarantee = (s: GameState, from: CountryId, to: CountryId) => (s.guarantees ?? []).includes(sanctionKey(from, to));
export const sanctionsOn = (s: GameState, c: CountryId) => (s.sanctions ?? []).filter((k) => k.endsWith(`>${c}`)).map((k) => k.split(">")[0] as CountryId);
export const sanctionsBy = (s: GameState, c: CountryId) => (s.sanctions ?? []).filter((k) => k.startsWith(`${c}>`)).map((k) => k.split(">")[1] as CountryId);
export const guarantorsOf = (s: GameState, c: CountryId) =>
  (s.guarantees ?? [])
    .filter((k) => k.endsWith(`>${c}`))
    .map((k) => k.split(">")[0] as CountryId)
    .filter((g) => s.countries[g]?.active);
export const guaranteesBy = (s: GameState, c: CountryId) => (s.guarantees ?? []).filter((k) => k.startsWith(`${c}>`)).map((k) => k.split(">")[1] as CountryId);

/** Growth change from sanctions: what being sanctioned costs, and what sanctioning others costs. */
export function sanctionGrowth(s: GameState, c: CountryId): number {
  const v = Math.min(SANCTION_GROWTH_CAP, SANCTION_GROWTH * sanctionsOn(s, c).length) + SANCTIONER_COST * sanctionsBy(s, c).length;
  return v ? -v : 0;
}

export const puppetsOf = (s: GameState, overlord: CountryId) => Object.values(s.countries).filter((c) => c.active && c.overlord === overlord).map((c) => c.id);
/** An overlord and its puppet count as allies (they fight together and may cross each other's land). */
export const puppetPair = (s: GameState, a: CountryId, b: CountryId) => s.countries[a]?.overlord === b || s.countries[b]?.overlord === a;

/** Make `puppet` a puppet of `overlord` (after a lost war). */
export function makePuppet(s: GameState, puppet: CountryId, overlord: CountryId) {
  const p = s.countries[puppet];
  if (!p?.active || puppet === overlord) return;
  // A puppet's own puppets go free; its guarantees and sanctions end.
  for (const c of Object.values(s.countries)) if (c.overlord === puppet) delete c.overlord;
  s.guarantees = (s.guarantees ?? []).filter((k) => !k.startsWith(`${puppet}>`));
  s.sanctions = (s.sanctions ?? []).filter((k) => !k.startsWith(`${puppet}>`) && k !== sanctionKey(overlord, puppet));
  p.overlord = overlord;
  logEvent(s, "annexation", `${nameOf(s, puppet)} became a puppet state of ${nameOf(s, overlord)}.`, [puppet, overlord]);
}

/** Tribute a puppet pays this month, in millions. */
export const tribute = (c: CountryState) => (c.overlord ? (c.gdp * c.taxRate * TRIBUTE_SHARE) / 12 : 0);

/** Puppets whose overlord is gone become free. Run monthly. */
export function freeOrphanedPuppets(s: GameState) {
  for (const c of Object.values(s.countries)) {
    if (c.overlord && !s.countries[c.overlord]?.active) {
      logEvent(s, "diplomacy", `${c.name} is independent again.`, [c.id]);
      delete c.overlord;
    }
  }
}
