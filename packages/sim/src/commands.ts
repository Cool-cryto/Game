import type { CountryId, ProvinceId } from "@gs/shared";
import type { Geography } from "./geography";
import {
  adjustRelation,
  allied,
  atWar,
  declareWar,
  makePeace,
  pairKey,
  relation,
  sideOf,
  wouldAcceptPeace,
} from "./diplomacy";
import { canRecruit, planMove, recruit, startMove, UNIT_STATS } from "./military";
import { BUDGET_CATEGORIES, logEvent, nameOf, type BudgetCategory, type GameState, type PeaceTerms, type UnitType } from "./state";

/**
 * Every change a player (or AI, or later a network client) makes to the game
 * is a command. Commands are checked, then applied at the start of the next
 * tick. Keeping this the only way in makes multiplayer possible later.
 */
export type Command =
  | { type: "claimCountry"; country: CountryId }
  | { type: "releaseCountry"; country: CountryId }
  | { type: "setTaxRate"; country: CountryId; value: number }
  | { type: "setBudget"; country: CountryId; category: BudgetCategory; value: number }
  | { type: "recruit"; country: CountryId; unitType: UnitType; province: ProvinceId }
  | { type: "disband"; country: CountryId; units: number[] }
  | { type: "moveUnits"; country: CountryId; units: number[]; to: ProvinceId }
  | { type: "declareWar"; country: CountryId; target: CountryId }
  | { type: "offerPeace"; country: CountryId; warId: number; terms: PeaceTerms }
  | { type: "answerOffer"; country: CountryId; offerId: number; accept: boolean }
  | { type: "improveRelations"; country: CountryId; target: CountryId }
  | { type: "proposeAlliance"; country: CountryId; target: CountryId }
  | { type: "breakAlliance"; country: CountryId; target: CountryId };

export const TAX_RANGE = [0.05, 0.6] as const;
export const BUDGET_RANGE = [0, 0.3] as const;
/** Days between two diplomatic actions towards the same country. */
export const DIPLOMACY_COOLDOWN = 30;
/** Improving relations costs this share of yearly GDP from the treasury. */
export const IMPROVE_RELATIONS_COST = 0.0005;

const cooldownLeft = (s: GameState, from: CountryId, to: CountryId) => {
  const last = s.diplomacyCooldown[`${from}>${to}`];
  return last === undefined ? 0 : Math.max(0, last + DIPLOMACY_COOLDOWN - s.tick);
};

/** Returns null if the command is allowed, otherwise the reason it isn't. */
export function validateCommand(s: GameState, geo: Geography, cmd: Command): string | null {
  const c = s.countries[cmd.country];
  if (!c) return `Unknown country ${cmd.country}`;
  if (!c.active) return `${c.name} has no government to give orders`;
  const target = "target" in cmd ? s.countries[cmd.target] : undefined;
  if ("target" in cmd) {
    if (!target?.active) return "That country doesn't exist any more.";
    if (cmd.target === cmd.country) return "That's your own country.";
  }
  switch (cmd.type) {
    case "claimCountry":
    case "releaseCountry":
      return null;
    case "setTaxRate":
      if (!Number.isFinite(cmd.value) || cmd.value < TAX_RANGE[0] || cmd.value > TAX_RANGE[1]) return "Tax rate out of range";
      return null;
    case "setBudget":
      if (!BUDGET_CATEGORIES.includes(cmd.category)) return `Unknown budget category ${cmd.category}`;
      if (!Number.isFinite(cmd.value) || cmd.value < BUDGET_RANGE[0] || cmd.value > BUDGET_RANGE[1]) return "Budget out of range";
      return null;
    case "recruit":
      return canRecruit(s, geo, cmd.country, cmd.unitType, cmd.province);
    case "disband":
    case "moveUnits": {
      if (!cmd.units.length) return "No units selected.";
      for (const id of cmd.units) if (s.units[id]?.owner !== cmd.country) return "You can only command your own units.";
      if (cmd.type === "moveUnits") {
        // Fine as long as at least one unit can go; the rest stay (see applyCommand).
        const errors = cmd.units.map((id) => planMove(s, geo, s.units[id]!, cmd.to)).filter((p) => "error" in p) as { error: string }[];
        if (errors.length === cmd.units.length) return errors[0]!.error;
      }
      return null;
    }
    case "declareWar":
      if (atWar(s, cmd.country, cmd.target)) return `Already at war with ${target!.name}.`;
      if (allied(s, cmd.country, cmd.target)) return `Break your alliance with ${target!.name} first.`;
      return null;
    case "offerPeace": {
      const war = s.wars.find((w) => w.id === cmd.warId);
      if (!war) return "That war is over.";
      const side = sideOf(war, cmd.country);
      if (!side || war[side][0] !== cmd.country) return "Only the leader of a side can negotiate peace.";
      return null;
    }
    case "answerOffer": {
      const offer = s.offers.find((o) => o.id === cmd.offerId);
      if (!offer || offer.to !== cmd.country) return "That offer has expired.";
      return null;
    }
    case "improveRelations": {
      const wait = cooldownLeft(s, cmd.country, cmd.target);
      if (wait) return `Wait ${wait} more days before another diplomatic action towards ${target!.name}.`;
      if (atWar(s, cmd.country, cmd.target)) return "You're at war. Make peace first.";
      return null;
    }
    case "proposeAlliance": {
      if (allied(s, cmd.country, cmd.target)) return `Already allied with ${target!.name}.`;
      if (atWar(s, cmd.country, cmd.target)) return "You're at war. Make peace first.";
      const wait = cooldownLeft(s, cmd.country, cmd.target);
      if (wait) return `Wait ${wait} more days before another diplomatic action towards ${target!.name}.`;
      return null;
    }
    case "breakAlliance":
      if (!allied(s, cmd.country, cmd.target)) return `You're not allied with ${target!.name}.`;
      return null;
  }
}

/** Would `target` accept an alliance from `from`? Same rule for AI and the UI's prediction. */
export function wouldAcceptAlliance(s: GameState, from: CountryId, target: CountryId): string | null {
  if (relation(s, from, target) < 40) return "Relations must be at least 40 (Cordial).";
  const enemies = s.wars.filter((w) => sideOf(w, from));
  if (enemies.some((w) => sideOf(w, target) === null && w[sideOf(w, from) === "attackers" ? "defenders" : "attackers"].some((e) => allied(s, target, e))))
    return `${nameOf(s, target)} is allied with one of your enemies.`;
  return null;
}

export function applyCommand(s: GameState, geo: Geography, cmd: Command): string | null {
  const error = validateCommand(s, geo, cmd);
  if (error) return error;
  const c = s.countries[cmd.country]!;
  switch (cmd.type) {
    case "claimCountry":
      // Single player: one human country at a time.
      for (const other of Object.values(s.countries)) if (other.controller === "human") other.controller = "ai";
      c.controller = "human";
      break;
    case "releaseCountry":
      c.controller = "ai";
      break;
    case "setTaxRate":
      c.taxRate = cmd.value;
      break;
    case "setBudget":
      c.budget[cmd.category] = cmd.value;
      break;
    case "recruit":
      recruit(s, cmd.country, cmd.unitType, cmd.province);
      break;
    case "disband":
      for (const id of cmd.units) delete s.units[id];
      break;
    case "moveUnits": {
      const stayed: string[] = [];
      for (const id of cmd.units) {
        const u = s.units[id]!;
        const plan = planMove(s, geo, u, cmd.to);
        if ("error" in plan) stayed.push(`${UNIT_STATS[u.type].label} #${u.id}: ${plan.error}`);
        else startMove(s, geo, u, plan.path, plan.mode);
      }
      // Not a failure (the others are moving), but tell the player.
      if (stayed.length) return `Some units stayed behind. ${stayed.join(" ")}`;
      break;
    }
    case "declareWar":
      declareWar(s, cmd.country, cmd.target);
      break;
    case "offerPeace": {
      const war = s.wars.find((w) => w.id === cmd.warId)!;
      const side = sideOf(war, cmd.country)!;
      const other = war[side === "attackers" ? "defenders" : "attackers"][0]!;
      const receiver = s.countries[other]!;
      if (receiver.controller === "human") {
        s.offers.push({ id: s.nextId++, warId: war.id, from: cmd.country, to: other, terms: cmd.terms, expiresTick: s.tick + 60 });
      } else if (wouldAcceptPeace(s, war, other, cmd.terms)) {
        makePeace(s, war, cmd.terms, side);
      } else {
        logEvent(s, "diplomacy", `${receiver.name} rejected ${c.name}'s peace offer.`, [cmd.country, other]);
      }
      break;
    }
    case "answerOffer": {
      const offer = s.offers.find((o) => o.id === cmd.offerId)!;
      s.offers = s.offers.filter((o) => o !== offer);
      const war = s.wars.find((w) => w.id === offer.warId);
      if (!war) break;
      if (cmd.accept) makePeace(s, war, offer.terms, sideOf(war, offer.from)!);
      else logEvent(s, "diplomacy", `${c.name} rejected ${nameOf(s, offer.from)}'s peace offer.`, [cmd.country, offer.from]);
      break;
    }
    case "improveRelations":
      c.treasury -= c.gdp * IMPROVE_RELATIONS_COST;
      adjustRelation(s, cmd.country, cmd.target, 15);
      s.diplomacyCooldown[`${cmd.country}>${cmd.target}`] = s.tick;
      break;
    case "proposeAlliance": {
      s.diplomacyCooldown[`${cmd.country}>${cmd.target}`] = s.tick;
      const target = s.countries[cmd.target]!;
      const reason = target.controller === "human" ? "they are another player" : wouldAcceptAlliance(s, cmd.country, cmd.target);
      if (reason) {
        logEvent(s, "diplomacy", `${target.name} declined an alliance with ${c.name}.`, [cmd.country, cmd.target]);
        return `${target.name} declined: ${reason}`;
      }
      s.alliances.push(pairKey(cmd.country, cmd.target));
      logEvent(s, "alliance", `${c.name} and ${target.name} formed an alliance.`, [cmd.country, cmd.target]);
      break;
    }
    case "breakAlliance":
      s.alliances = s.alliances.filter((k) => k !== pairKey(cmd.country, cmd.target));
      adjustRelation(s, cmd.country, cmd.target, -30);
      logEvent(s, "alliance", `${c.name} broke its alliance with ${nameOf(s, cmd.target)}.`, [cmd.country, cmd.target]);
      break;
  }
  return null;
}
