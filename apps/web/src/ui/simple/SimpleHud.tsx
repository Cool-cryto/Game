import { useState, type ReactNode } from "react";
import type { CountryId } from "@gs/shared";
import {
  allied,
  planMove,
  relation,
  relationLabel,
  sideOf,
  validateCommand,
  warBetween,
  warScore,
  wouldAcceptAlliance,
  wouldAcceptPeace,
  type GameState,
  type UnitType,
  type War,
  governmentLabel,
  orgsOf,
  treatiesOf,
  partnerIn,
  TREATY_INFO,
  DIFFICULTIES,
  DIFFICULTY_RULES,
  type Difficulty,
  hasGuarantee,
  hasSanction,
  PEACE_DEMANDS,
  PERSONALITY_RULES,
  type PeaceTerms,
} from "@gs/sim";
import { flagUrl, GEOGRAPHY, getCountry } from "../../data/countries";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { useOnline } from "../../net/online";
import { formatCompact, formatMoneyMillions } from "../format";

// ---------- Helpers (shared with the management screens) ----------

const nameOf = (id: CountryId) => getCountry(id)?.name ?? id;

/** Countries ranked by economy size (1 = biggest). */
export function economyRank(s: GameState, id: CountryId): number {
  const mine = s.countries[id]?.gdp ?? 0;
  return 1 + Object.values(s.countries).filter((c) => c.active && c.gdp > mine).length;
}
/** How hard a country is to play, from the size of its economy. */
export function difficulty(s: GameState, id: CountryId): { label: string; tone: "easy" | "medium" | "hard" } {
  const r = economyRank(s, id);
  return r <= 15 ? { label: "Easy", tone: "easy" } : r <= 60 ? { label: "Medium", tone: "medium" } : { label: "Hard", tone: "hard" };
}
const myArmies = (s: GameState, me: CountryId) => Object.values(s.units).filter((u) => u.owner === me);

/** Where to recruit: the capital, or for fleets the most populous port you hold. */
export function recruitProvince(s: GameState, me: CountryId, type: UnitType) {
  const capital = s.countries[me]?.capital ?? null;
  if (type !== "navy" || (capital && GEOGRAPHY.provinces[capital]?.coastal)) return capital;
  let best: { id: string; pop: number } | null = null;
  for (const p of Object.values(s.provinces)) {
    if (p.owner !== me || p.controller !== me || !GEOGRAPHY.provinces[p.id]?.coastal) continue;
    if (!best || p.population > best.pop) best = { id: p.id, pop: p.population };
  }
  return (best?.id ?? null) as typeof capital;
}

/** Recruiting rules in plain words. */
export function plainReason(reason: string, type: UnitType): string {
  if (reason.startsWith("Not enough defense funds")) return "Not enough army money yet. It builds up every month.";
  if (reason.startsWith("Your population supports")) return "You have as many units as your population can support.";
  if (reason.startsWith("You can only recruit")) return type === "navy" ? "You have no port to build a fleet in." : "You don't hold your capital right now.";
  return reason;
}

/** Send every idle army towards the enemy's capital (they stop to fight what they meet on the way). */
export function attackOrders(s: GameState, me: CountryId, enemy: CountryId) {
  const target = s.countries[enemy]?.capital;
  if (!target) return null;
  const ids = myArmies(s, me)
    .filter((u) => u.type === "army" && !u.travel && !u.retreating)
    .filter((u) => !("error" in planMove(s, GEOGRAPHY, u, target)))
    .map((u) => u.id);
  return ids.length ? { type: "moveUnits" as const, country: me, units: ids, to: target } : null;
}

function Panel({ title, children, onClose, testId }: { title: ReactNode; children: ReactNode; onClose: () => void; testId: string }) {
  return (
    <aside className="panel spanel" aria-label={typeof title === "string" ? title : undefined} data-testid={testId}>
      <div className="spanel__head">
        <h2>{title}</h2>
        <button className="icon-btn" onClick={onClose} aria-label="Close panel" title="Close (Esc)">
          ×
        </button>
      </div>
      {children}
    </aside>
  );
}

export function Big({ label, value, tone, hint }: { label: string; value: string; tone?: "good" | "bad"; hint?: string }) {
  return (
    <div className="sstat" title={hint}>
      <span className="sstat__label">{label}</span>
      <span className={`sstat__value ${tone ? `sstat__value--${tone}` : ""}`}>{value}</span>
    </div>
  );
}

/** One war in plain words: who's winning, attack, and make peace. */
export function SimpleWar({ war, me }: { war: War; me: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const side = sideOf(war, me)!;
  const other = side === "attackers" ? "defenders" : "attackers";
  const enemy = war[other][0]!;
  const score = warScore(s, war, side);
  const leader = war[side][0] === me;
  const offers = s.offers.filter((o) => o.warId === war.id && o.to === me);
  const attack = attackOrders(s, me, enemy);
  const enemyAi = s.countries[enemy]?.controller === "ai";
  const terms = wouldAcceptPeace(s, war, enemy, "occupied") ? ("occupied" as const) : wouldAcceptPeace(s, war, enemy, "white") ? ("white" as const) : null;
  const [demand, setDemand] = useState<PeaceTerms | null>(null);
  const status = score > 0.15 ? "You're winning" : score < -0.15 ? "You're losing" : "Even fight";
  return (
    <div className="swar" data-testid={`war-${war.id}`}>
      <div className="swar__head">
        <strong>vs {nameOf(enemy)}</strong>
        <span className={score > 0.15 ? "pos" : score < -0.15 ? "neg" : undefined}>{status}</span>
      </div>
      <div className="war__score-bar" aria-hidden>
        <span style={{ width: `${(score + 1) * 50}%` }} />
      </div>
      <WarStats war={war} side={side} />
      {offers.map((o) => (
        <div key={o.id} className="offer">
          <span>
            {nameOf(o.from)} offers peace {PEACE_DEMANDS[o.terms]}.
          </span>
          <button className="btn btn--primary btn--small" onClick={() => send({ type: "answerOffer", country: me, offerId: o.id, accept: true })}>
            Accept
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => send({ type: "answerOffer", country: me, offerId: o.id, accept: false })}>
            No
          </button>
        </div>
      ))}
      <div className="swar__actions">
        <button className="btn btn--danger btn--small" disabled={!attack} title={attack ? "Send all idle armies towards their capital." : "No armies free to attack. Recruit some in Army."} onClick={() => attack && send(attack)}>
          Attack
        </button>
        {leader && (
          <button
            className="btn btn--ghost btn--small"
            disabled={enemyAi && !terms}
            title={enemyAi && !terms ? "They won't accept peace yet. Keep fighting." : undefined}
            onClick={() => send({ type: "offerPeace", country: me, warId: war.id, terms: terms ?? "white" })}
          >
            {terms === "occupied" ? "Make peace and keep the land you hold" : "Make peace"}
          </button>
        )}
      </div>
      {leader && enemyAi && !terms && <p className="panel__small">They won't accept peace yet. Capture more of their land first.</p>}
      {leader && (
        <details className="peace-conf" data-testid="peace-conference">
          <summary>Peace conference: choose your terms</summary>
          <div className="peace-conf__terms">
            {PEACE_TERMS.map((t) => {
              const ok = !enemyAi || wouldAcceptPeace(s, war, enemy, t.id);
              return (
                <label key={t.id} className={`peace-term ${demand === t.id ? "is-on" : ""}`}>
                  <input type="radio" name={`terms-${war.id}`} checked={demand === t.id} onChange={() => setDemand(t.id)} />
                  <span>
                    <strong>{t.label}</strong> <span className={ok ? "pos" : "neg"}>{enemyAi ? (ok ? "they would accept" : "they would refuse") : "they decide"}</span>
                    <span className="panel__small">{t.help}</span>
                  </span>
                </label>
              );
            })}
          </div>
          <button className="btn btn--primary btn--small" disabled={!demand} onClick={() => demand && send({ type: "offerPeace", country: me, warId: war.id, terms: demand })}>
            Offer these terms
          </button>
        </details>
      )}
      {!leader && <p className="panel__small">{nameOf(war[side][0]!)} leads your side and decides on peace.</p>}
    </div>
  );
}

const PEACE_TERMS: { id: PeaceTerms; label: string; help: string }[] = [
  { id: "white", label: "White peace", help: "Everyone goes home; no land changes hands." },
  { id: "occupied", label: "Keep the land you hold", help: "Enemy provinces your side occupies become yours." },
  { id: "reparations", label: "Reparations", help: "No land changes; they pay you 5% of their GDP." },
  { id: "puppet", label: "Puppet state", help: "They keep their land but follow you into war and pay 10% of their taxes as tribute. Needs a crushing win." },
];

/** Duration, losses and provinces taken by each side, from the war's own record. */
export function WarStats({ war, side }: { war: War; side: "attackers" | "defenders" }) {
  const tick = useGame((x) => x.state.tick);
  const other = side === "attackers" ? "defenders" : "attackers";
  const sum = (rec: Record<string, number> | undefined, who: CountryId[]) => who.reduce((a, c) => a + (rec?.[c] ?? 0), 0);
  const days = tick - war.startTick;
  const dur = days >= 365 ? `${(days / 365).toFixed(1)} years` : days >= 60 ? `${Math.round(days / 30)} months` : `${days} days`;
  return (
    <dl className="warstats" data-testid="war-stats">
      <div>
        <dt>Duration</dt>
        <dd>{dur}</dd>
      </div>
      <div>
        <dt title="Strength lost in battle, in full units' worth">Losses (you / them)</dt>
        <dd>
          {sum(war.losses, war[side]).toFixed(1)} / {sum(war.losses, war[other]).toFixed(1)}
        </dd>
      </div>
      <div>
        <dt title="Enemy provinces occupied during this war">Provinces taken</dt>
        <dd>
          {sum(war.captured, war[side])} / {sum(war.captured, war[other])}
        </dd>
      </div>
    </dl>
  );
}

/** Make friends, ally, or go to war with one country. */
export function Relations({ me, them, compact = false }: { me: CountryId; them: CountryId; compact?: boolean }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const [confirm, setConfirm] = useState(false);
  const rel = relation(s, me, them);
  const war = warBetween(s, me, them);
  const isAllied = allied(s, me, them);
  const setScreen = useUi((x) => x.setScreen);
  const setTab = useUi((x) => x.setTab);
  const setTarget = useUi((x) => x.setDiplomacyTarget);
  const treaties = treatiesOf(s, me).filter((t) => partnerIn(t, me) === them);
  const reason = (type: "improveRelations" | "proposeAlliance" | "declareWar") => validateCommand(s, GEOGRAPHY, { type, country: me, target: them });
  const allyReason = reason("proposeAlliance") ?? wouldAcceptAlliance(s, me, them);
  const tone = isAllied ? "ally" : rel >= 25 ? "good" : rel <= -25 ? "bad" : "neutral";
  const info = getCountry(them);
  const flag = info ? flagUrl(info) : null;
  return (
    <div className={`srel ${compact ? "srel--compact" : ""}`} data-testid={`relations-${them}`}>
      <div className="srel__head">
        {compact && (flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />)}
        {compact && <strong>{nameOf(them)}</strong>}
        <span className={`srel__tag srel__tag--${tone}`}>{war ? "At war" : isAllied ? "Ally" : relationLabel(rel)}</span>
      </div>
      {!war && (
        <div className="srel__actions">
          <button className="btn btn--ghost btn--small" disabled={!!reason("improveRelations")} title={reason("improveRelations") ?? "Costs some money. Makes them like you more."} onClick={() => send({ type: "improveRelations", country: me, target: them })}>
            Make friends
          </button>
          {!isAllied && (
            <button className="btn btn--ghost btn--small" disabled={!!allyReason} title={allyReason ?? "Allies defend each other."} onClick={() => send({ type: "proposeAlliance", country: me, target: them })}>
              Ally
            </button>
          )}
          <button
            className="btn btn--ghost btn--small"
            title="Trade, research, non-aggression and military access treaties."
            onClick={() => {
              setTarget(them);
              setTab("diplomacy", "treaties");
              setScreen("diplomacy");
            }}
          >
            Treaties
          </button>
          {!confirm ? (
            <button className="btn btn--danger btn--small" disabled={!!reason("declareWar")} title={reason("declareWar") ?? undefined} onClick={() => setConfirm(true)}>
              War
            </button>
          ) : (
            <span className="confirm">
              Go to war with {nameOf(them)}?
              <button
                className="btn btn--danger btn--small"
                onClick={() => {
                  send({ type: "declareWar", country: me, target: them });
                  setConfirm(false);
                }}
              >
                Yes, declare war
              </button>
              <button className="btn btn--ghost btn--small" onClick={() => setConfirm(false)}>
                Cancel
              </button>
            </span>
          )}
        </div>
      )}
      {!war && !compact && <Statecraft me={me} them={them} />}
      {treaties.length > 0 && <p className="panel__small">Treaties: {treaties.map((t) => TREATY_INFO[t.type].short).join(", ")}</p>}
      {statusLine(s, me, them) && <p className="panel__small" data-testid="status-line">{statusLine(s, me, them)}</p>}
      {!war && !isAllied && allyReason && !compact && <p className="panel__small">Alliance: {allyReason}</p>}
    </div>
  );
}

/** Puppets, guarantees and sanctions between you and them, in words. */
function statusLine(s: GameState, me: CountryId, them: CountryId): string {
  const parts: string[] = [];
  if (s.countries[them]?.overlord === me) parts.push("Your puppet state (pays you tribute)");
  if (s.countries[me]?.overlord === them) parts.push("You are their puppet state");
  if (hasGuarantee(s, me, them)) parts.push("You guarantee their independence");
  if (hasGuarantee(s, them, me)) parts.push("They guarantee your independence");
  if (hasSanction(s, me, them)) parts.push("You sanction them");
  if (hasSanction(s, them, me)) parts.push("They sanction you");
  return parts.join(" · ");
}

/** Sanctions, aid and guarantees towards one country. */
function Statecraft({ me, them }: { me: CountryId; them: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const c = s.countries[me]!;
  const amount = Math.round(0.005 * c.gdp);
  const check = (cmd: Parameters<typeof validateCommand>[2]) => validateCommand(s, GEOGRAPHY, cmd);
  const sanctioned = hasSanction(s, me, them);
  const guaranteed = hasGuarantee(s, me, them);
  const sanctionCmd = { type: sanctioned ? ("liftSanction" as const) : ("sanction" as const), country: me, target: them };
  const guaranteeCmd = { type: guaranteed ? ("revokeGuarantee" as const) : ("guarantee" as const), country: me, target: them };
  const aid = (kind: "economic" | "military") => ({ type: "sendAid" as const, country: me, target: them, aid: kind, amount });
  return (
    <div className="srel__actions srel__actions--more">
      <button className="btn btn--ghost btn--small" disabled={!!check(guaranteeCmd)} title={check(guaranteeCmd) ?? (guaranteed ? "Stop protecting them (they won't like it)." : "If anyone attacks them, you join the war.")} onClick={() => send(guaranteeCmd)} data-testid="guarantee">
        {guaranteed ? "Revoke guarantee" : "Guarantee"}
      </button>
      <button className="btn btn--ghost btn--small" disabled={!!check(aid("economic"))} title={check(aid("economic")) ?? `Send ${formatMoneyMillions(amount)} from your treasury. They will like you more.`} onClick={() => send(aid("economic"))} data-testid="aid-economic">
        Aid {formatMoneyMillions(amount)}
      </button>
      <button className="btn btn--ghost btn--small" disabled={!!check(aid("military"))} title={check(aid("military")) ?? `Send ${formatMoneyMillions(amount)} of military money.`} onClick={() => send(aid("military"))}>
        Military aid
      </button>
      <button className="btn btn--ghost btn--small" disabled={!!check(sanctionCmd)} title={check(sanctionCmd) ?? (sanctioned ? "Lift your sanctions." : "Costs them 0.15% growth a year (you 0.03%), ends trade deals, angers them.")} onClick={() => send(sanctionCmd)} data-testid="sanction">
        {sanctioned ? "Lift sanctions" : "Sanction"}
      </button>
    </div>
  );
}

// ---------- Another country, clicked on the map ----------

/** Simple country panel: who they are, how you get along, and (before you pick a country) "Lead". */
export function SimpleCountryView({ id, onDetails }: { id: CountryId; onDetails: () => void }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const select = useUi((x) => x.select);
  const me = playerCountry(s)?.id;
  const online = useOnline((x) => !!x.room);
  const c = s.countries[id];
  const info = getCountry(id);
  if (!c || !info) return null;
  const flag = flagUrl(info);
  const mine = me === id;
  const diff = difficulty(s, id);
  return (
    <Panel
      title={
        <span className="spanel__title">
          {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
          {info.name}
          {mine && <span className="badge badge--you">You</span>}
        </span>
      }
      onClose={() => select(null)}
      testId="info-panel"
    >
      {info.kind !== "sovereign" && (
        <p className="panel__note">
          <span className={`badge badge--${info.kind}`}>{info.kind === "territory" ? "Territory / dependency" : "Disputed region"}</span>
          {info.note ? ` ${info.note}` : ""}
        </p>
      )}
      {!c.active ? (
        <p className="panel__note">Nobody lives here permanently, so nothing happens here.</p>
      ) : (
        <>
          <div className="sstats">
            <Big label="People" value={formatCompact(c.population)} />
            <Big label="Economy" value={`#${economyRank(s, id)} in the world`} />
          </div>
          <p className="panel__small" data-testid="government-line" title={c.government.source === "estimate" ? "Estimate: no V-Dem data for this place" : "V-Dem Regimes of the World; monarchy from Wikidata"}>
            Government: <strong>{governmentLabel(c.government)}</strong>
            {c.government.source === "estimate" ? " (estimate)" : ""}
          </p>
          {c.controller === "ai" && c.personality && (
            <p className="panel__small" data-testid="personality-line" title={PERSONALITY_RULES[c.personality].summary}>
              Computer personality: <strong>{PERSONALITY_RULES[c.personality].label}</strong> (game-generated)
            </p>
          )}
          {c.overlord && <p className="panel__small">Puppet state of {nameOf(c.overlord)}</p>}
          {orgsOf(s, id).length > 0 && (
            <p className="panel__small" data-testid="orgs-line">
              Member of: {orgsOf(s, id).map((o) => o.name).join(", ")}
            </p>
          )}
          {!me && c.controller !== "human" && (
            <div className="slead">
              <p>
                Challenge: <span className={`difficulty difficulty--${diff.tone}`}>{diff.label}</span>
              </p>
              <label className="slead__level">
                Difficulty{" "}
                <select
                  value={s.settings?.difficulty ?? "normal"}
                  onChange={(e) => send({ type: "setDifficulty", difficulty: e.target.value as Difficulty })}
                  data-testid="panel-difficulty"
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {DIFFICULTY_RULES[d].label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="btn btn--primary" onClick={() => send({ type: "claimCountry", country: id })}>
                Play as {info.name}
              </button>
            </div>
          )}
          {!me && c.controller === "human" && (
            <p className="panel__note" data-testid="played-by">
              Played by {playerName(id) ?? "another player"}.
            </p>
          )}
          {me && !mine && (
            <section aria-label="Diplomacy">
              <h3>You and {info.name}</h3>
              <Relations me={me} them={id} />
              {(() => {
                const war = warBetween(s, me, id);
                return war ? <SimpleWar war={war} me={me} /> : null;
              })()}
            </section>
          )}
          {me && mine && <p className="panel__small">Run your country from the bar at the top: Economy, Military, Diplomacy and more.</p>}
          {me && !mine && !online && <p className="panel__small">You lead {nameOf(me)}. To lead a different country, start a new game (Game menu).</p>}
        </>
      )}
      <button className="link" onClick={onDetails}>
        Show all details
      </button>
    </Panel>
  );
}

const playerName = (id: CountryId) => useOnline.getState().players.find((p) => p.country === id)?.name;

// ---------- Start screen and guide ----------

const GUIDE_KEY = "wa.guideDone";
const guideDone = () => {
  try {
    return localStorage.getItem(GUIDE_KEY) === "1";
  } catch {
    return false;
  }
};

/** A short guide, shown the first time you lead a country. */
export function Guide() {
  const me = useGame((x) => playerCountry(x.state)?.id);
  const [done, setDone] = useState(guideDone);
  if (!me || done) return null;
  const finish = () => {
    try {
      localStorage.setItem(GUIDE_KEY, "1");
    } catch {
      /* not remembered */
    }
    setDone(true);
  };
  return (
    <div className="guide" role="dialog" aria-label="How to play" data-testid="guide">
      <h2>You lead {nameOf(me)}!</h2>
      <p className="guide__lead">Everything is in the bar at the top. The ones to start with:</p>
      <ol>
        <li>
          <strong>Economy:</strong> choose what your country focuses on, like growing the economy or building the army.
        </li>
        <li>
          <strong>Military:</strong> recruit armies to defend yourself or attack. Click your army on the map, then click where it should go: it occupies each enemy province on the way, which takes a few days each (forts take longer). Guard your capital: if it falls, your whole country falls.
        </li>
        <li>
          <strong>Diplomacy:</strong> make friends and allies, or declare war and press Attack.
        </li>
        <li>
          <strong>Time</strong> starts the moment you lead a country. Pause with Space or the pause button, and pick 1x-4x speed at the top. Watch your world rank climb!
        </li>
      </ol>
      <button className="btn btn--primary" onClick={finish}>
        Let's go
      </button>
    </div>
  );
}
