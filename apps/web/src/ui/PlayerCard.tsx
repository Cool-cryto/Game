import { flagUrl, getCountry } from "../data/countries";
import { isAtWar } from "@gs/sim";
import { playerCountry, useGame } from "../state/gameStore";
import { useUi } from "../state/uiStore";
import { formatMoneyMillions, formatPercent } from "./format";
import { economyRank } from "./simple/SimpleHud";

/** Your country at a glance, or a hint on how to pick one. */
export function PlayerCard() {
  const me = useGame((s) => playerCountry(s.state));
  const select = useUi((s) => s.select);
  const war = useGame((s) => (me ? isAtWar(s.state, me.id) : false));
  const advanced = useUi((s) => s.advanced);
  const setHud = useUi((s) => s.setHud);
  const rank = useGame((s) => (me ? economyRank(s.state, me.id) : 0));
  if (!me) {
    return (
      <div className="player player--hint" data-testid="player-card">
        {advanced ? (
          <>
            Click a country, then <strong>Play as…</strong> to lead it.
          </>
        ) : (
          <>Choose a country to lead.</>
        )}
      </div>
    );
  }
  if (!advanced) {
    const info = getCountry(me.id);
    const flag = info ? flagUrl(info) : null;
    return (
      <button className="player" onClick={() => setHud("country")} data-testid="player-card">
        {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
        <span className="player__name">{info?.name ?? me.id}</span>
        <span className="player__stat" title="Money in the bank (negative is debt)">
          <span className="player__label">Money</span>
          <span className={me.treasury < 0 ? "neg" : undefined}>{formatMoneyMillions(me.treasury)}</span>
        </span>
        <span className="player__stat" title="Your economy's size compared with every other country">
          <span className="player__label">World rank</span>
          <span>#{rank}</span>
        </span>
        {war && <span className="player__war">At war</span>}
      </button>
    );
  }
  const info = getCountry(me.id);
  const flag = info ? flagUrl(info) : null;
  return (
    <button className="player" onClick={() => select({ kind: "country", id: me.id }, { focus: true })} data-testid="player-card">
      {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
      <span className="player__name">{info?.name ?? me.id}</span>
      <span className="player__stat" title="Treasury (negative is debt)">
        <span className="player__label">Treasury</span>
        <span className={me.treasury < 0 ? "neg" : undefined}>{formatMoneyMillions(me.treasury)}</span>
      </span>
      <span className="player__stat" title="GDP growth per year">
        <span className="player__label">Growth</span>
        {me.history.gdp.length > 0 ? <span className={me.gdpGrowth < 0 ? "neg" : "pos"}>{formatPercent(me.gdpGrowth, 1, true)}</span> : <span>—</span>}
      </span>
      {war && <span className="player__war">At war</span>}
      <span className="player__stat" title="Stability (0-100)">
        <span className="player__label">Stability</span>
        <span>{Math.round(me.stability)}</span>
      </span>
    </button>
  );
}
