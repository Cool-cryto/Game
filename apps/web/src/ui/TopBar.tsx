import { MAP_MODES, type MapModeId } from "../map/mapModes";
import { useUi } from "../state/uiStore";
import { GameMenu } from "./GameMenu";
import { SearchBox } from "./SearchBox";
import { useOnline } from "../net/online";

function OnlineButton() {
  const room = useOnline((s) => s.room);
  const setOnlineDialog = useUi((s) => s.setOnlineDialog);
  if (room) return null; // in a room, the online pill shows status instead
  return (
    <button className="menu-btn" onClick={() => setOnlineDialog(true)} data-testid="play-online">
      <svg viewBox="0 0 24 24" aria-hidden>
        <circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
        <circle cx="17" cy="9.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        <path d="M3 19c.6-3.3 3-5 6-5s5.4 1.7 6 5M14.5 15.2c.8-.5 1.6-.7 2.5-.7 2.3 0 4 1.3 4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span>Play online</span>
    </button>
  );
}

const GROUPS = [...new Set(Object.values(MAP_MODES).map((m) => m.group))];

export function TopBar() {
  const mapMode = useUi((s) => s.mapMode);
  const setMapMode = useUi((s) => s.setMapMode);
  const advanced = useUi((s) => s.advanced);
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span>World Ascendant</span>
        {advanced && <span className="brand__stage">Stage 8 · fog of war &amp; online</span>}
      </div>
      <SearchBox />
      {advanced && <label className="mode-select">
        <span className="mode-select__label">Map</span>
        <select aria-label="Map mode" value={mapMode} onChange={(e) => setMapMode(e.target.value as MapModeId)}>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {Object.values(MAP_MODES)
                .filter((m) => m.group === g)
                .map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>
      </label>}
      <OnlineButton />
      <GameMenu />
    </header>
  );
}
