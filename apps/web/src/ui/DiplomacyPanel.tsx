import { useState } from "react";
import type { CountryId } from "@gs/shared";
import {
  alliesOf,
  allied,
  DIPLOMACY_COOLDOWN,
  IMPROVE_RELATIONS_COST,
  relation,
  relationLabel,
  sideOf,
  validateCommand,
  warBetween,
  warScore,
  wouldAcceptAlliance,
  wouldAcceptPeace,
  type PeaceTerms,
  type War,
} from "@gs/sim";
import { GEOGRAPHY, getCountry } from "../data/countries";
import { useGame } from "../state/gameStore";
import { formatMoneyMillions } from "./format";

/** Your relationship with another country, and what you can do about it. */
export function DiplomacySection({ me, them }: { me: CountryId; them: CountryId }) {
  const state = useGame((s) => s.state);
  const send = useGame((s) => s.send);
  const [confirmWar, setConfirmWar] = useState(false);
  const rel = relation(state, me, them);
  const war = warBetween(state, me, them);
  const isAllied = allied(state, me, them);
  const theirAllies = alliesOf(state, them).filter((a) => a !== me);
  const myCountry = state.countries[me]!;
  const reason = (type: "improveRelations" | "proposeAlliance" | "breakAlliance" | "declareWar") =>
    validateCommand(state, GEOGRAPHY, { type, country: me, target: them });
  const allianceReason = reason("proposeAlliance") ?? wouldAcceptAlliance(state, me, them);
  const name = getCountry(them)?.name ?? them;

  return (
    <section aria-label="Diplomacy" className="diplomacy">
      <h3>Diplomacy with you</h3>
      <div className="relation">
        <div className="relation__bar" aria-hidden>
          <span className="relation__mid" />
          <span className="relation__marker" style={{ left: `${(rel + 100) / 2}%` }} />
        </div>
        <span className="relation__label" data-testid="relation">
          {Math.round(rel)} · {relationLabel(rel)}
          {isAllied && " · Allied"}
          {war && " · At war"}
        </span>
      </div>
      {theirAllies.length > 0 && (
        <p className="panel__small">
          Allies: {theirAllies.map((a) => getCountry(a)?.name ?? a).join(", ")}. They will defend {name} if attacked.
        </p>
      )}
      {war ? (
        <WarCard war={war} me={me} />
      ) : (
        <div className="diplomacy__actions">
          <button
            className="btn btn--ghost btn--small"
            disabled={!!reason("improveRelations")}
            title={reason("improveRelations") ?? `Costs ${formatMoneyMillions(myCountry.gdp * IMPROVE_RELATIONS_COST)} from the treasury. +15 relations. Once every ${DIPLOMACY_COOLDOWN} days.`}
            onClick={() => send({ type: "improveRelations", country: me, target: them })}
          >
            Improve relations
          </button>
          {isAllied ? (
            <button className="btn btn--ghost btn--small" onClick={() => send({ type: "breakAlliance", country: me, target: them })}>
              Break alliance
            </button>
          ) : (
            <button
              className="btn btn--ghost btn--small"
              disabled={!!allianceReason}
              title={allianceReason ?? `${name} would accept. Allies defend each other when attacked.`}
              onClick={() => send({ type: "proposeAlliance", country: me, target: them })}
            >
              Propose alliance
            </button>
          )}
          {!confirmWar ? (
            <button className="btn btn--danger btn--small" disabled={!!reason("declareWar")} title={reason("declareWar") ?? undefined} onClick={() => setConfirmWar(true)}>
              Declare war…
            </button>
          ) : (
            <div className="confirm">
              <span>
                Declare war on {name}?{theirAllies.length ? ` ${theirAllies.map((a) => getCountry(a)?.name ?? a).join(", ")} will join them.` : ""}
              </span>
              <button
                className="btn btn--danger btn--small"
                onClick={() => {
                  send({ type: "declareWar", country: me, target: them });
                  setConfirmWar(false);
                }}
              >
                Declare war
              </button>
              <button className="btn btn--ghost btn--small" onClick={() => setConfirmWar(false)}>
                Cancel
              </button>
            </div>
          )}
          {allianceReason && !isAllied && <p className="panel__small">Alliance: {allianceReason}</p>}
        </div>
      )}
    </section>
  );
}

/** One war from your point of view: score, sides, and peace options. */
export function WarCard({ war, me }: { war: War; me: CountryId }) {
  const state = useGame((s) => s.state);
  const send = useGame((s) => s.send);
  const side = sideOf(war, me)!;
  const other = side === "attackers" ? "defenders" : "attackers";
  const score = warScore(state, war, side);
  const leader = war[side][0] === me;
  const enemyLeader = war[other][0]!;
  const enemyIsAi = state.countries[enemyLeader]?.controller === "ai";
  const months = Math.floor((state.tick - war.startTick) / 30);
  const names = (list: CountryId[]) => list.map((c) => getCountry(c)?.name ?? c).join(", ");
  const offers = state.offers.filter((o) => o.warId === war.id && o.to === me);

  const peaceButton = (terms: PeaceTerms, label: string) => {
    const accept = wouldAcceptPeace(state, war, enemyLeader, terms);
    return (
      <button
        className={`btn btn--small ${accept ? "btn--primary" : "btn--ghost"}`}
        onClick={() => send({ type: "offerPeace", country: me, warId: war.id, terms })}
        title={enemyIsAi ? (accept ? "They would accept." : "They would refuse right now.") : undefined}
      >
        {label}
        {enemyIsAi && <span className="recruit__cost">{accept ? "would accept" : "would refuse"}</span>}
      </button>
    );
  };

  return (
    <div className="war" data-testid={`war-${war.id}`}>
      <div className="war__head">
        <strong>{war.name}</strong>
        <span className="war__age">{months < 1 ? "just started" : `${months} month${months === 1 ? "" : "s"}`}</span>
      </div>
      <p className="panel__small">
        Your side: {names(war[side])}. Enemies: {names(war[other])}.
      </p>
      <div className="war__score">
        <div className="war__score-bar" aria-hidden>
          <span style={{ width: `${(score + 1) * 50}%` }} />
        </div>
        <span className={score < 0 ? "neg" : score > 0 ? "pos" : undefined} data-testid="war-score">
          War score {score > 0 ? "+" : ""}
          {Math.round(score * 100)}
        </span>
      </div>
      <p className="panel__small">War score = share of the enemy's population you occupy, minus the share of yours they occupy.</p>
      {offers.map((o) => (
        <div key={o.id} className="offer">
          <span>
            {getCountry(o.from)?.name} offers peace: {o.terms === "occupied" ? "you give up the provinces they occupy." : "no border changes."}
          </span>
          <button className="btn btn--primary btn--small" onClick={() => send({ type: "answerOffer", country: me, offerId: o.id, accept: true })}>
            Accept
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => send({ type: "answerOffer", country: me, offerId: o.id, accept: false })}>
            Refuse
          </button>
        </div>
      ))}
      {leader ? (
        <div className="diplomacy__actions">
          {peaceButton("occupied", "Demand occupied provinces")}
          {peaceButton("white", "Offer white peace")}
        </div>
      ) : (
        <p className="panel__small">{getCountry(war[side][0]!)?.name} leads your side and decides on peace.</p>
      )}
    </div>
  );
}

/** All of your wars (for your own country panel). */
export function WarsSection({ me }: { me: CountryId }) {
  const wars = useGame((s) => s.state.wars);
  const mine = wars.filter((w) => sideOf(w, me));
  if (!mine.length) return null;
  return (
    <section aria-label="Wars">
      <h3>Your wars</h3>
      {mine.map((w) => (
        <WarCard key={w.id} war={w} me={me} />
      ))}
    </section>
  );
}
