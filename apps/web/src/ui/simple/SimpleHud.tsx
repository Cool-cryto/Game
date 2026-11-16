import { useState, type ReactNode } from "react";
import type { CountryId } from "@gs/shared";
import {
  allied,
  canRecruit,
  planMove,
  recruitCost,
  relation,
  relationLabel,
  sideOf,
  unitCap,
  validateCommand,
  warBetween,
  warScore,
  wouldAcceptAlliance,
  wouldAcceptPeace,
  type GameState,
  type UnitType,
  type War,
} from "@gs/sim";
import { flagUrl, GEOGRAPHY, getCountry, getProvince, landNeighbours } from "../../data/countries";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi, type Hud } from "../../state/uiStore";
import { useEditor } from "../../state/editor";
import { useOnline } from "../../net/online";
import { formatCompact, formatMoneyMillions, formatPercent } from "../format";
import { currentFocus, currentTaxLevel, FOCUSES, policyCommands, TAX_LEVELS } from "./focus";

// ---------- Helpers ----------

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
function recruitProvince(s: GameState, me: CountryId, type: UnitType) {
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
function plainReason(reason: string, type: UnitType): string {
  if (reason.startsWith("Not enough defense funds")) return "Not enough army money yet. It builds up every month.";
  if (reason.startsWith("Your population supports")) return "You have as many units as your population can support.";
  if (reason.startsWith("You can only recruit")) return type === "navy" ? "You have no port to build a fleet in." : "You don't hold your capital right now.";
  return reason;
}

/** Send every idle army towards the enemy's capital (they stop to fight what they meet on the way). */
function attackOrders(s: GameState, me: CountryId, enemy: CountryId) {
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

function Big({ label, value, tone, hint }: { label: string; value: string; tone?: "good" | "bad"; hint?: string }) {
  return (
    <div className="sstat" title={hint}>
      <span className="sstat__label">{label}</span>
      <span className={`sstat__value ${tone ? `sstat__value--${tone}` : ""}`}>{value}</span>
    </div>
  );
}

// ---------- Action bar ----------

const ACTIONS: { id: NonNullable<Hud>; label: string; icon: string }[] = [
  { id: "country", label: "My country", icon: "🏛️" },
  { id: "army", label: "Army", icon: "🛡️" },
  { id: "world", label: "World", icon: "🌍" },
];

/** Simple mode's three main buttons. */
export function ActionBar() {
  const hud = useUi((s) => s.hud);
  const setHud = useUi((s) => s.setHud);
  const me = useGame((s) => playerCountry(s.state)?.id);
  const atWar = useGame((s) => (me ? s.state.wars.some((w) => sideOf(w, me)) : false));
  const offers = useGame((s) => (me ? s.state.offers.filter((o) => o.to === me).length : 0));
  if (!me) return null;
  return (
    <nav className="actionbar" aria-label="Main actions">
      {ACTIONS.map((a) => (
        <button key={a.id} className={`actionbar__btn ${hud === a.id ? "is-active" : ""}`} aria-pressed={hud === a.id} onClick={() => setHud(hud === a.id ? null : a.id)}>
          <span className="actionbar__icon" aria-hidden>
            {a.icon}
          </span>
          <span>{a.label}</span>
          {a.id === "world" && (atWar || offers > 0) && <span className="actionbar__dot" aria-label={offers ? "Peace offer waiting" : "At war"} />}
        </button>
      ))}
    </nav>
  );
}

/** Whichever simple panel the action bar opened. */
export function HudPanel() {
  const hud = useUi((s) => s.hud);
  const me = useGame((s) => playerCountry(s.state)?.id);
  if (!hud || !me) return null;
  return hud === "country" ? <CountryHud me={me} /> : hud === "army" ? <ArmyHud me={me} /> : <WorldHud me={me} />;
}

// ---------- My country ----------

function CountryHud({ me }: { me: CountryId }) {
  const c = useGame((s) => s.state.countries[me]!);
  const rank = useGame((s) => economyRank(s.state, me));
  const send = useGame((s) => s.send);
  const setHud = useUi((s) => s.setHud);
  const focus = currentFocus(c);
  const tax = currentTaxLevel(c);
  const apply = (taxRate: number, focusId: string) => policyCommands(me, taxRate, focusId).forEach((cmd) => send(cmd));
  const started = c.history.gdp.length > 0;
  return (
    <Panel title={nameOf(me)} onClose={() => setHud(null)} testId="hud-country">
      <div className="sstats">
        <Big label="Money" value={formatMoneyMillions(c.treasury)} tone={c.treasury < 0 ? "bad" : undefined} hint="Negative means debt." />
        <Big label="World rank" value={`#${rank}`} hint="Your economy's size compared with every other country." />
        <Big label="Growth" value={started ? formatPercent(c.gdpGrowth, 1, true) : "—"} tone={c.gdpGrowth < 0 ? "bad" : started ? "good" : undefined} hint="How fast your economy grows per year." />
        <Big label="Happiness" value={`${Math.round(c.stability)}/100`} tone={c.stability < 40 ? "bad" : c.stability > 65 ? "good" : undefined} hint="Low happiness slows growth." />
      </div>

      <section aria-label="National focus">
        <h3>What should your country focus on?</h3>
        <div className="choices">
          {FOCUSES.map((f) => (
            <button key={f.id} className={`choice ${focus === f.id ? "is-active" : ""}`} aria-pressed={focus === f.id} onClick={() => apply(c.taxRate, f.id)}>
              <span className="choice__icon" aria-hidden>
                {f.icon}
              </span>
              <span className="choice__label">{f.label}</span>
              <span className="choice__help">{f.help}</span>
            </button>
          ))}
        </div>
        {focus === null && <p className="panel__small">You've set custom spending in Advanced mode. Pick a focus to go back to simple choices.</p>}
      </section>

      <section aria-label="Taxes">
        <h3>Taxes</h3>
        <div className="segmented" role="radiogroup" aria-label="Taxes">
          {TAX_LEVELS.map((t) => (
            <button key={t.id} role="radio" aria-checked={tax === t.id} className={tax === t.id ? "is-active" : ""} title={t.help} onClick={() => apply(t.rate, focus ?? "balanced")}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="panel__small">{TAX_LEVELS.find((t) => t.id === tax)?.help} Your budget is always balanced, so you won't fall into debt.</p>
      </section>
    </Panel>
  );
}

// ---------- Army ----------

const TYPES: { type: UnitType; label: string; help: string }[] = [
  { type: "army", label: "Army", help: "Fights on land and captures provinces." },
  { type: "navy", label: "Fleet", help: "Carries armies across the sea." },
  { type: "air", label: "Air force", help: "Helps nearby battles." },
];

function ArmyHud({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const select = useUi((x) => x.select);
  const setHud = useUi((x) => x.setHud);
  const c = s.countries[me]!;
  const units = myArmies(s, me);
  const count = (t: UnitType) => units.filter((u) => u.type === t).length;
  const where = new Map<string, number>();
  for (const u of units) where.set(u.province, (where.get(u.province) ?? 0) + 1);
  return (
    <Panel title="Your army" onClose={() => setHud(null)} testId="hud-army">
      <div className="sstats">
        <Big label="Armies" value={String(count("army"))} />
        <Big label="Fleets" value={String(count("navy"))} />
        <Big label="Air forces" value={String(count("air"))} />
        <Big label="Army money" value={formatMoneyMillions(c.defenseFund)} hint="Filled each month by your budget. Pick 'Build the army' in My country for more." />
      </div>
      <p className="panel__small">
        You can have up to {unitCap(c)} units (bigger population, bigger army).
      </p>

      <section aria-label="Recruit">
        <h3>Recruit</h3>
        <div className="recruit-big">
          {TYPES.map((t) => {
            const at = recruitProvince(s, me, t.type);
            const raw = at ? canRecruit(s, GEOGRAPHY, me, t.type, at) : t.type === "navy" ? "You have no port to build a fleet in." : "You don't hold your capital right now.";
            const reason = raw ? plainReason(raw, t.type) : null;
            return (
              <button key={t.type} className="choice" disabled={!!reason} title={reason ?? t.help} onClick={() => at && send({ type: "recruit", country: me, unitType: t.type, province: at })}>
                <span className="choice__label">{t.label}</span>
                <span className="choice__help">{reason ?? t.help}</span>
                <span className="choice__cost">{formatMoneyMillions(recruitCost(c, t.type))}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-label="Where your forces are">
        <h3>Where your forces are</h3>
        {where.size === 0 ? (
          <p className="panel__small">No units yet. Recruit one above.</p>
        ) : (
          <ul className="slist">
            {[...where].map(([p, n]) => (
              <li key={p}>
                <button className="slist__item" onClick={() => select({ kind: "units", province: p as never, owner: me }, { focus: true })}>
                  <span>{getProvince(p as never)?.name ?? p}</span>
                  <span className="slist__meta">
                    {n} unit{n > 1 ? "s" : ""} · Move ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="panel__small">To attack, open World and press Attack next to your enemy. Your armies march there by themselves.</p>
      </section>
    </Panel>
  );
}

// ---------- World ----------

function WorldHud({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const provinces = useGame((x) => x.provincesOf.get(me)) ?? [];
  const setHud = useUi((x) => x.setHud);
  const wars = s.wars.filter((w) => sideOf(w, me));
  const neighbours = landNeighbours(s, provinces).filter((id) => s.countries[id]?.active);
  const allies = s.alliances.flatMap((k) => {
    const [a, b] = k.split("|") as [CountryId, CountryId];
    return a === me ? [b] : b === me ? [a] : [];
  });
  const others = [...new Set([...allies, ...neighbours])].filter((id) => !wars.some((w) => sideOf(w, id)));
  return (
    <Panel title="The world" onClose={() => setHud(null)} testId="hud-world">
      {wars.length > 0 && (
        <section aria-label="Your wars">
          <h3>Your wars</h3>
          {wars.map((w) => (
            <SimpleWar key={w.id} war={w} me={me} />
          ))}
        </section>
      )}
      <section aria-label="Neighbours and allies">
        <h3>{others.length ? "Neighbours and allies" : "Neighbours"}</h3>
        {others.length === 0 && <p className="panel__small">No land neighbours. Click any country on the map to deal with it.</p>}
        {others.map((id) => (
          <Relations key={id} me={me} them={id} compact />
        ))}
        <p className="panel__small">Click any country on the map to make friends with it or declare war, even far away.</p>
      </section>
    </Panel>
  );
}

/** One war in plain words: who's winning, attack, and make peace. */
function SimpleWar({ war, me }: { war: War; me: CountryId }) {
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
      {offers.map((o) => (
        <div key={o.id} className="offer">
          <span>{nameOf(o.from)} offers peace{o.terms === "occupied" ? " and wants the land they hold" : ""}.</span>
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
          ⚔️ Attack
        </button>
        {leader && (
          <button
            className="btn btn--ghost btn--small"
            disabled={enemyAi && !terms}
            title={enemyAi && !terms ? "They won't accept peace yet. Keep fighting." : undefined}
            onClick={() => send({ type: "offerPeace", country: me, warId: war.id, terms: terms ?? "white" })}
          >
            🕊️ {terms === "occupied" ? "Make peace and keep the land you hold" : "Make peace"}
          </button>
        )}
      </div>
      {leader && enemyAi && !terms && <p className="panel__small">They won't accept peace yet. Capture more of their land first.</p>}
      {!leader && <p className="panel__small">{nameOf(war[side][0]!)} leads your side and decides on peace.</p>}
    </div>
  );
}

/** Make friends, ally, or go to war with one country. */
function Relations({ me, them, compact = false }: { me: CountryId; them: CountryId; compact?: boolean }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const [confirm, setConfirm] = useState(false);
  const rel = relation(s, me, them);
  const war = warBetween(s, me, them);
  const isAllied = allied(s, me, them);
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
            🤝 Make friends
          </button>
          {!isAllied && (
            <button className="btn btn--ghost btn--small" disabled={!!allyReason} title={allyReason ?? "Allies defend each other."} onClick={() => send({ type: "proposeAlliance", country: me, target: them })}>
              🛡️ Ally
            </button>
          )}
          {!confirm ? (
            <button className="btn btn--danger btn--small" disabled={!!reason("declareWar")} title={reason("declareWar") ?? undefined} onClick={() => setConfirm(true)}>
              ⚔️ War
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
      {!war && !isAllied && allyReason && !compact && <p className="panel__small">Alliance: {allyReason}</p>}
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
      {!c.active ? (
        <p className="panel__note">Nobody lives here permanently, so nothing happens here.</p>
      ) : (
        <>
          <div className="sstats">
            <Big label="People" value={formatCompact(c.population)} />
            <Big label="Economy" value={`#${economyRank(s, id)} in the world`} />
          </div>
          {!me && c.controller !== "human" && (
            <div className="slead">
              <p>
                Difficulty: <span className={`difficulty difficulty--${diff.tone}`}>{diff.label}</span>
              </p>
              <button className="btn btn--primary" onClick={() => send({ type: "claimCountry", country: id })}>
                Lead {info.name}
              </button>
            </div>
          )}
          {!me && c.controller === "human" && <p className="panel__note">Another player leads {info.name}.</p>}
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
          {me && mine && <p className="panel__small">Use the buttons at the bottom left to run your country.</p>}
          {me && !mine && !online && <p className="panel__small">You lead {nameOf(me)}. To lead a different country, start a new game (Game menu).</p>}
        </>
      )}
      <button className="link" onClick={onDetails}>
        Show all details
      </button>
    </Panel>
  );
}

// ---------- Start screen and guide ----------

const SUGGESTED: CountryId[] = ["USA", "CHN", "DEU", "GBR", "FRA", "JPN", "BRA", "IND", "TUR", "EGY", "NGA", "POL"] as CountryId[];

/** Before you pick a country: what the game is about, and some good countries to start with. */
export function StartScreen() {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const me = playerCountry(s);
  const editing = useEditor((x) => x.active);
  const online = useOnline((x) => !!x.room);
  const selected = useUi((x) => x.selected);
  const [hidden, setHidden] = useState(false);
  if (me || editing || online || hidden || selected) return null;
  const options = SUGGESTED.filter((id) => s.countries[id]?.active && s.countries[id]?.controller !== "human");
  return (
    <div className="start" role="dialog" aria-label="Choose your country" data-testid="start-screen">
      <h2>Choose a country to lead</h2>
      <p className="start__goal">
        <strong>Your goal:</strong> make your country the strongest in the world. Grow your economy, build an army, make friends, and take
        land from your enemies.
      </p>
      <div className="start__grid">
        {options.map((id) => {
          const info = getCountry(id)!;
          const flag = flagUrl(info);
          const d = difficulty(s, id);
          return (
            <button key={id} className="start__pick" onClick={() => send({ type: "claimCountry", country: id })}>
              {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
              <span>{info.name}</span>
              <span className={`difficulty difficulty--${d.tone}`}>{d.label}</span>
            </button>
          );
        })}
      </div>
      <p className="start__or">
        …or click any country on the map.{" "}
        <button className="link" onClick={() => setHidden(true)}>
          Just look around first
        </button>
      </p>
    </div>
  );
}

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
      <ol>
        <li>
          <strong>🏛️ My country:</strong> choose what to focus on, like growing the economy or building the army.
        </li>
        <li>
          <strong>🛡️ Army:</strong> recruit armies to defend yourself or attack.
        </li>
        <li>
          <strong>🌍 World:</strong> make friends and allies, or declare war and press Attack.
        </li>
        <li>
          <strong>▶️ Play:</strong> press Play at the bottom to let time run. Watch your world rank climb!
        </li>
      </ol>
      <button className="btn btn--primary" onClick={finish}>
        Let's go
      </button>
    </div>
  );
}
