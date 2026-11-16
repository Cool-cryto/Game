import type { CountryState } from "@gs/sim";
import {
  BLOC_HELP,
  BLOC_LABEL,
  BLOCS,
  canCallElection,
  canChangeLaw,
  dateAt,
  governmentEffects,
  governmentLabel,
  holdsElections,
  isAtWar,
  isDemocracy,
  LAW_COOLDOWN,
  LAW_IDS,
  LAW_LABEL,
  LAWS,
  REGIME_HELP,
  REGIME_LABEL,
  type GameState,
} from "@gs/sim";
import { useGame } from "../../state/gameStore";
import { formatDate, formatPercent } from "../format";
import { StabilityCard } from "./CoreScreens";
import { Card, NeedCountry, Planned, Rows, ScreenFrame } from "./Screen";

export function GovernmentScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="government"
          title="Government"
          subtitle={governmentLabel(c.government)}
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "parties", label: "Parties & elections" },
            { id: "laws", label: "Laws" },
            { id: "stability", label: "Stability" },
          ]}
        >
          {(tab) =>
            tab === "overview" ? (
              <Overview c={c} />
            ) : tab === "parties" ? (
              <Parties c={c} />
            ) : tab === "laws" ? (
              <Laws c={c} />
            ) : (
              <div className="grid">
                <StabilityCard c={c} />
                <Card title="What raises stability">
                  <p className="screen__note">Welfare spending, moderate taxes, a growing economy, enough food, and a government with broad support. Debt, high taxes and peacetime conscription lower it.</p>
                </Card>
              </div>
            )
          }
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

const SOURCE_NOTE: Record<CountryState["government"]["source"], string> = {
  data: "From V-Dem's Regimes of the World classification for the scenario's year (CC BY-SA 4.0); monarchy from Wikidata.",
  estimate: "No V-Dem data for this place: the kind of government is an estimate.",
  custom: "A country made in the world editor: starts as a democracy.",
};

const pct = (v: number) => formatPercent(v, 1, true);
const pts = (v: number) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0));

function Overview({ c }: { c: CountryState }) {
  const war = useGame((s) => isAtWar(s.state, c.id));
  const g = c.government;
  const e = governmentEffects(c, war);
  const growth = Object.values(e.growth).reduce((a, b) => a + b, 0);
  const stability = Object.values(e.stability).reduce((a, b) => a + b, 0);
  return (
    <div className="grid">
      <Card title="Kind of government" hint={REGIME_HELP[g.regime]}>
        <p className="gov-title">{governmentLabel(g)}</p>
        <Rows
          rows={[
            ["Regime", REGIME_LABEL[g.regime], REGIME_HELP[g.regime]],
            ["Head of state", g.monarchy ? "Monarch" : "Elected or appointed (republic)"],
            ["In government", `${BLOC_LABEL[g.ruling]} bloc`, BLOC_HELP[g.ruling]],
            ["Elections", holdsElections(g.regime) ? (isDemocracy(g.regime) ? "Free and fair" : "Held, but the rulers always win") : "None"],
          ]}
        />
        <p className="screen__note">{SOURCE_NOTE[g.source]}</p>
      </Card>
      <Card title="Effects on your country" hint="What your kind of government, the bloc in power and your laws do together.">
        <Rows
          rows={[
            ["Growth", <span className={growth < 0 ? "neg" : "pos"}>{pct(growth)} / yr</span>, "Added to economic growth"],
            ["Stability", <span className={stability < 0 ? "neg" : "pos"}>{pts(stability)}</span>, "Added to where stability is heading"],
            ["Research speed", <span className={e.research < 0 ? "neg" : "pos"}>{pct(e.research)}</span>],
            ["Unit limit", `×${e.unitCap.toFixed(1)}`, "From your conscription law"],
          ]}
        />
        <details className="why">
          <summary>Show where these come from</summary>
          <ul>
            <li>
              <span>{REGIME_LABEL[g.regime]}</span>
              <span>
                {pct(e.growth.regime)} growth · {pts(e.stability.regime)} stability
              </span>
            </li>
            <li>
              <span>{LAW_LABEL.economy.options[g.laws.economy]!.label}</span>
              <span>
                {pct(e.growth.economy)} growth · {pts(e.stability.economy)} stability
              </span>
            </li>
            <li>
              <span>{LAW_LABEL.conscription.options[g.laws.conscription]!.label}</span>
              <span>
                {pct(e.growth.conscription)} growth · {pts(e.stability.conscription)} stability
              </span>
            </li>
            <li>
              <span>{LAW_LABEL.press.options[g.laws.press]!.label}</span>
              <span>{pts(e.stability.press)} stability</span>
            </li>
            <li>
              <span>{BLOC_LABEL[g.ruling]} bloc in power</span>
              <span>
                {pct(e.growth.ruling)} growth · {pts(e.stability.ruling)} stability
              </span>
            </li>
            {isDemocracy(g.regime) && (
              <li>
                <span>Support for the government</span>
                <span>{pts(e.stability.mandate)} stability</span>
              </li>
            )}
          </ul>
        </details>
      </Card>
      <Planned title="Changing the kind of government" items={["Reforms towards democracy or towards tighter control", "Coups and revolutions when stability collapses"]} note="Today a country keeps the kind of government it starts with; its parties, laws and elections change." />
    </div>
  );
}

function Parties({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const g = c.government;
  const sorted = [...BLOCS].sort((a, b) => g.support[b] - g.support[a]);
  const reason = canCallElection(s, c);
  const when = (tick: number) => formatDate(dateAt(s.startDate, tick));
  return (
    <div className="grid">
      <Card title="Party support" hint="Four broad political blocs. Their popularity is game-generated and follows how your country is doing." wide>
        <table className="table" data-testid="party-support">
          <tbody>
            {sorted.map((b) => (
              <tr key={b} className={b === g.ruling ? "is-me" : undefined} title={BLOC_HELP[b]}>
                <td>
                  {BLOC_LABEL[b]}
                  {b === g.ruling && <span className="tag">In government</span>}
                </td>
                <td className="bar-cell">
                  <span className="mini-bar mini-bar--wide">
                    <span style={{ width: `${g.support[b] * 100}%` }} />
                  </span>
                </td>
                <td className="num">{Math.round(g.support[b] * 100)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="screen__note">
          {isDemocracy(g.regime)
            ? "Good times help the bloc in government. Low welfare and recessions help the Left; high taxes help the Right; war, occupation and unrest help the Nationalists."
            : "Under this government, popularity doesn't decide who rules, but it shows the public mood."}
        </p>
      </Card>
      <Card title="Elections">
        <Rows
          rows={[
            ["Next election", g.nextElection !== null ? when(g.nextElection) : "None under this government"],
            ["Last election", g.lastElection ? `${when(g.lastElection.tick)}: ${BLOC_LABEL[g.lastElection.winner]} ${Math.round(g.lastElection.share * 100)}%` : "None yet in this game"],
          ]}
        />
        <p className="screen__note">Election dates are the game's own four-year schedule, not real-world dates.</p>
      </Card>
      <Card title="Early election" hint="Ask voters now, for example while your bloc is popular.">
        <button className="btn btn--ghost btn--small" disabled={!!reason} title={reason ?? "The vote is held in a month."} onClick={() => send({ type: "callElection", country: c.id })}>
          Call an early election
        </button>
        <p className="screen__note">{reason ?? "The vote is held in a month. If another bloc is more popular, it may win."}</p>
      </Card>
    </div>
  );
}

function Laws({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const g = c.government;
  const wait = g.lawCooldown - s.tick;
  return (
    <>
      <p className="screen__note">
        Changing a law costs a little stability, and then you must wait {LAW_COOLDOWN} days before the next change.
        {wait > 0 ? ` Next change possible in ${wait} days.` : ""}
        {isDemocracy(g.regime) ? " In a democracy, the government needs at least 25% support to pass laws." : ""}
      </p>
      <div className="laws">
        {LAW_IDS.map((law) => (
          <Card key={law} title={LAW_LABEL[law].label} wide>
            <div className="choices choices--3">
              {(LAWS[law] as readonly string[]).map((opt) => {
                const active = g.laws[law] === opt;
                const reason = active ? null : canChangeLaw(s as GameState, c, law, opt);
                const o = LAW_LABEL[law].options[opt]!;
                return (
                  <button
                    key={opt}
                    className={`choice ${active ? "is-active" : ""}`}
                    aria-pressed={active}
                    disabled={!active && !!reason}
                    title={reason ?? o.help}
                    onClick={() => !active && send({ type: "setLaw", country: c.id, law, value: opt })}
                  >
                    <span className="choice__label">{o.label}</span>
                    <span className="choice__help">{o.help}</span>
                    {active && <span className="choice__cost">Current law</span>}
                  </button>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
      <p className="screen__note">Starting laws are game defaults for each kind of government, not each country's real laws.</p>
    </>
  );
}
