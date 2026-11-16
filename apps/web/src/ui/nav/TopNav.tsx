import { isAtWar } from "@gs/sim";
import { flagUrl, getCountry } from "../../data/countries";
import { useOnline } from "../../net/online";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi, type ScreenId } from "../../state/uiStore";
import { formatMoneyMillions } from "../format";
import { GameMenu } from "../GameMenu";
import { SearchBox } from "../SearchBox";
import { economyRank } from "../simple/SimpleHud";
import { TimeControls } from "../TimeControls";
import { useEditor } from "../../state/editor";
import { Icon } from "./Icon";

/** The ten main buttons. "World" is the map itself; the rest open a management screen. */
export const NAV: { id: ScreenId | "world"; label: string; hint: string }[] = [
  { id: "world", label: "World", hint: "The world map (Esc)" },
  { id: "country", label: "Country", hint: "Your country at a glance: provinces, people, history" },
  { id: "economy", label: "Economy", hint: "Treasury, taxes, budget, resources and trade, debt" },
  { id: "military", label: "Military", hint: "Armies, fleets, air forces, recruiting, military budget" },
  { id: "diplomacy", label: "Diplomacy", hint: "Relations, alliances, wars and peace" },
  { id: "government", label: "Government", hint: "Stability and national policy" },
  { id: "research", label: "Research", hint: "Technology level and research spending" },
  { id: "construction", label: "Construction", hint: "Infrastructure in your provinces" },
  { id: "statistics", label: "Statistics", hint: "World rankings and charts" },
  { id: "more", label: "More", hint: "Population, news, settings" },
];

/** The permanent top navigation: brand, the ten sections, then search, online play and settings. */
export function TopNav() {
  const screen = useUi((s) => s.screen);
  const setScreen = useUi((s) => s.setScreen);
  const atWar = useGame((s) => {
    const me = playerCountry(s.state)?.id;
    return me ? isAtWar(s.state, me) || s.state.offers.some((o) => o.to === me) : false;
  });
  return (
    <header className="topnav">
      <div className="topnav__brand" title="World Ascendant">
        <Icon name="world" size={18} />
        <span>World Ascendant</span>
      </div>
      <nav className="topnav__nav" aria-label="Main navigation">
        {NAV.map((n) => {
          const active = n.id === "world" ? screen === null : screen === n.id;
          return (
            <button
              key={n.id}
              className={`topnav__btn ${active ? "is-active" : ""}`}
              aria-current={active ? "page" : undefined}
              title={n.hint}
              aria-label={n.label}
              data-testid={`nav-${n.id}`}
              onClick={() => setScreen(n.id === "world" ? null : n.id === screen ? null : n.id)}
            >
              <Icon name={n.id} />
              <span className="topnav__label">{n.label}</span>
              {n.id === "diplomacy" && atWar && <span className="topnav__dot" aria-label="At war or peace offer waiting" />}
            </button>
          );
        })}
      </nav>
      <div className="topnav__tools">
        <SearchBox />
        <OnlineButton />
        <GameMenu />
      </div>
    </header>
  );
}

function OnlineButton() {
  const room = useOnline((s) => s.room);
  const setOnlineDialog = useUi((s) => s.setOnlineDialog);
  if (room) return null; // in a room, the online pill shows status instead
  return (
    <button className="tool-btn" onClick={() => setOnlineDialog(true)} data-testid="play-online" title="Multiplayer: play online with others" aria-label="Play online">
      <Icon name="online" />
      <span className="tool-btn__label">Play online</span>
    </button>
  );
}

/** National figures and the clock, under the navigation. */
export function InfoBar() {
  const me = useGame((s) => playerCountry(s.state));
  const rank = useGame((s) => (me ? economyRank(s.state, me.id) : 0));
  const war = useGame((s) => (me ? isAtWar(s.state, me.id) : false));
  const setScreen = useUi((s) => s.setScreen);
  const editing = useEditor((s) => s.active);
  const info = me ? getCountry(me.id) : undefined;
  const flag = info ? flagUrl(info) : null;
  return (
    <div className="infobar">
      {me ? (
        <button className="infobar__country" onClick={() => setScreen("country")} data-testid="player-card" title="Open your country">
          {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
          <span className="infobar__name">{info?.name ?? me.id}</span>
          <span className="infobar__stat" title="Money in the bank (negative is debt)">
            <span className="infobar__label">Treasury</span>
            <span className={me.treasury < 0 ? "neg" : undefined}>{formatMoneyMillions(me.treasury)}</span>
          </span>
          <span className="infobar__stat" title="Your economy's size compared with every other country">
            <span className="infobar__label">Rank</span>
            <span>#{rank}</span>
          </span>
          {war && <span className="player__war">At war</span>}
        </button>
      ) : (
        <div className="infobar__country infobar__country--empty" data-testid="player-card">
          Choose a country: click it on the map, then <strong>Play as…</strong>
        </div>
      )}
      {!editing && <TimeControls />}
    </div>
  );
}
