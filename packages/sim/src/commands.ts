import { canBuild, startBuilding, type BuildingType } from "./construction";
import { BRANCHES, type ResearchFocus } from "./tech";
import { canCallElection, canChangeLaw, changeLaw, type LawId } from "./government";
import type { CountryId, ProvinceId } from "@gs/shared";
import type { Geography } from "./geography";
import {
  canFoundOrg,
  canJoinOrg,
  canProposeTreaty,
  cancelTreaty,
  countTreaties,
  foundOrg,
  hasTreaty,
  joinOrg,
  leaveOrg,
  orgById,
  signTreaty,
  TREATY_INFO,
  TREATY_TYPES,
  wouldAcceptTreaty,
  type OrgKind,
  type TreatyType,
} from "./treaties";
import {
  adjustRelation,
  allied,
  bilateralAlly,
  defenseOrgOf,
  sameDefenseOrg,
  atWar,
  declareWar,
  makePeace,
  pairKey,
  relation,
  sideOf,
  wouldAcceptPeace,
} from "./diplomacy";
import { canRecruit, planMove, recruit, startMove, UNIT_STATS } from "./military";
import { DIFFICULTIES, DIFFICULTY_RULES, type Difficulty } from "./state";
import { BUDGET_CATEGORIES, logEvent, nameOf, type BudgetCategory, type GameState, type PeaceTerms, type UnitType } from "./state";

/**
 * Every change a player (or AI, or later a network client) makes to the game
 * is a command. Commands are checked, then applied at the start of the next
 * tick. Keeping this the only way in makes multiplayer possible later.
 */
export type Command =
  | { type: "claimCountry"; country: CountryId }
  /** Single player, before you lead a country (the server never accepts it). */
  | { type: "setDifficulty"; difficulty: Difficulty }
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
  | { type: "breakAlliance"; country: CountryId; target: CountryId }
  | { type: "setLaw"; country: CountryId; law: LawId; value: string }
  | { type: "callElection"; country: CountryId }
  | { type: "setResearchFocus"; country: CountryId; focus: ResearchFocus }
  | { type: "build"; country: CountryId; province: ProvinceId; building: BuildingType }
  | { type: "proposeTreaty"; country: CountryId; target: CountryId; treaty: TreatyType }
  | { type: "cancelTreaty"; country: CountryId; target: CountryId; treaty: TreatyType }
  | { type: "answerProposal"; country: CountryId; proposalId: number; accept: boolean }
  | { type: "joinOrganization"; country: CountryId; org: string }
  | { type: "leaveOrganization"; country: CountryId; org: string }
  | { type: "foundOrganization"; country: CountryId; name: string; kind: OrgKind };

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
  if (cmd.type === "setDifficulty") {
    if (!DIFFICULTIES.includes(cmd.difficulty)) return "Unknown difficulty.";
    if (Object.values(s.countries).some((x) => x.controller === "human")) return "Difficulty is chosen before you take a country.";
    return null;
  }
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
      // In multiplayer, each country has at most one human player.
      if (c.controller === "human") return `${c.name} is already played by someone.`;
      return null;
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
      if (sameDefenseOrg(s, cmd.country, cmd.target)) return `${target!.name} is a fellow member of ${defenseOrgOf(s, cmd.country)!.name}. Leave it first.`;
      if (allied(s, cmd.country, cmd.target)) return `Break your alliance with ${target!.name} first.`;
      if (hasTreaty(s, cmd.country, cmd.target, "nonAggression")) return `You have a non-aggression pact with ${target!.name}. Cancel it first.`;
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
      if (s.proposals.some((p) => p.from === cmd.country && p.to === cmd.target && p.kind === "alliance")) return "You've already proposed this; waiting for their answer.";
      const wait = cooldownLeft(s, cmd.country, cmd.target);
      if (wait) return `Wait ${wait} more days before another diplomatic action towards ${target!.name}.`;
      return null;
    }
    case "breakAlliance":
      if (!bilateralAlly(s, cmd.country, cmd.target)) return sameDefenseOrg(s, cmd.country, cmd.target) ? `You're allied through ${defenseOrgOf(s, cmd.country)!.name}; leave it to end that.` : `You're not allied with ${target!.name}.`;
      return null;
    case "setLaw":
      return canChangeLaw(s, c, cmd.law, cmd.value);
    case "callElection":
      return canCallElection(s, c);
    case "setResearchFocus":
      if (cmd.focus !== "balanced" && !BRANCHES.includes(cmd.focus)) return "Unknown research branch.";
      return null;
    case "build":
      return canBuild(s, geo, cmd.country, cmd.province, cmd.building);
    case "proposeTreaty": {
      const why = canProposeTreaty(s, cmd.country, cmd.target, cmd.treaty);
      if (why) return why;
      const wait = cooldownLeft(s, cmd.country, cmd.target);
      if (wait) return `Wait ${wait} more days before another diplomatic action towards ${target!.name}.`;
      return null;
    }
    case "cancelTreaty":
      if (!TREATY_TYPES.includes(cmd.treaty)) return "Unknown kind of treaty.";
      if (!hasTreaty(s, cmd.country, cmd.target, cmd.treaty)) return `You have no ${TREATY_INFO[cmd.treaty].label.toLowerCase()} with ${target!.name}.`;
      return null;
    case "answerProposal": {
      const p = s.proposals.find((x) => x.id === cmd.proposalId);
      if (!p || p.to !== cmd.country) return "That proposal has expired.";
      return null;
    }
    case "joinOrganization":
      return canJoinOrg(s, cmd.country, orgById(s, cmd.org));
    case "leaveOrganization": {
      const o = orgById(s, cmd.org);
      if (!o || !o.members.includes(cmd.country)) return "You're not a member of that organization.";
      return null;
    }
    case "foundOrganization":
      if (typeof cmd.name !== "string") return "Give it a name.";
      return canFoundOrg(s, cmd.country, cmd.name, cmd.kind);
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
  if (cmd.type === "setDifficulty") {
    s.settings.difficulty = cmd.difficulty;
    return null;
  }
  const c = s.countries[cmd.country]!;
  switch (cmd.type) {
    case "claimCountry":
      // The caller releases the player's previous country first (see the client and server).
      c.controller = "human";
      // The difficulty's starting money, once per country.
      if (!s.settings.started.includes(c.id)) {
        const rules = DIFFICULTY_RULES[s.settings.difficulty];
        c.treasury += rules.playerTreasury * c.gdp;
        c.defenseFund = Math.max(0, c.defenseFund + (rules.playerDefenseMonths * c.gdp * c.budget.defense) / 12);
        s.settings = { ...s.settings, started: [...s.settings.started, c.id] };
      }
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
      if (target.controller === "human") {
        s.proposals = [...s.proposals, { id: s.nextId++, from: cmd.country, to: cmd.target, kind: "alliance", expiresTick: s.tick + 60 }];
        logEvent(s, "diplomacy", `${c.name} proposed an alliance to ${target.name}.`, [cmd.country, cmd.target]);
        break;
      }
      const reason = wouldAcceptAlliance(s, cmd.country, cmd.target);
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
    case "setLaw":
      changeLaw(s, c, cmd.law, cmd.value);
      break;
    case "callElection":
      // The vote happens in a month.
      c.government.nextElection = s.tick + 30;
      logEvent(s, "politics", `${c.name} called an early election, to be held in a month.`, [cmd.country]);
      break;
    case "setResearchFocus":
      c.research.focus = cmd.focus;
      break;
    case "build":
      startBuilding(s, cmd.country, cmd.province, cmd.building);
      break;
    case "proposeTreaty": {
      s.diplomacyCooldown[`${cmd.country}>${cmd.target}`] = s.tick;
      const target = s.countries[cmd.target]!;
      const label = TREATY_INFO[cmd.treaty].label.toLowerCase();
      if (target.controller === "human") {
        s.proposals = [...s.proposals, { id: s.nextId++, from: cmd.country, to: cmd.target, kind: cmd.treaty, expiresTick: s.tick + 60 }];
        logEvent(s, "diplomacy", `${c.name} proposed a ${label} to ${target.name}.`, [cmd.country, cmd.target]);
        break;
      }
      const reason = wouldAcceptTreaty(s, cmd.country, cmd.target, cmd.treaty);
      if (reason) {
        logEvent(s, "diplomacy", `${target.name} declined a ${label} with ${c.name}.`, [cmd.country, cmd.target]);
        return `${target.name} declined: ${reason}`;
      }
      signTreaty(s, cmd.country, cmd.target, cmd.treaty);
      break;
    }
    case "cancelTreaty":
      cancelTreaty(s, cmd.country, cmd.target, cmd.treaty);
      break;
    case "answerProposal": {
      const p = s.proposals.find((x) => x.id === cmd.proposalId)!;
      s.proposals = s.proposals.filter((x) => x !== p);
      const from = s.countries[p.from];
      if (!from?.active) break;
      if (!cmd.accept) {
        logEvent(s, "diplomacy", `${c.name} turned down ${from.name}'s proposal.`, [cmd.country, p.from]);
        break;
      }
      if (p.kind === "alliance") {
        if (allied(s, p.from, p.to) || atWar(s, p.from, p.to)) return "That alliance is no longer possible.";
        s.alliances.push(pairKey(p.from, p.to));
        logEvent(s, "alliance", `${from.name} and ${c.name} formed an alliance.`, [p.from, p.to]);
      } else {
        // Check again: things may have changed while the proposal waited (another treaty filled the limit, a war started).
        const why =
          canProposeTreaty({ ...s, proposals: [] }, p.from, p.to, p.kind) ??
          (countTreaties(s, p.to, p.kind) >= TREATY_INFO[p.kind].max ? `You already have the most ${TREATY_INFO[p.kind].label.toLowerCase()}s allowed.` : null);
        if (why) return why;
        signTreaty(s, p.from, p.to, p.kind);
      }
      break;
    }
    case "joinOrganization":
      joinOrg(s, cmd.country, orgById(s, cmd.org)!);
      break;
    case "leaveOrganization":
      leaveOrg(s, cmd.country, orgById(s, cmd.org)!);
      break;
    case "foundOrganization":
      foundOrg(s, cmd.country, cmd.name, cmd.kind);
      break;
  }
  return null;
}
