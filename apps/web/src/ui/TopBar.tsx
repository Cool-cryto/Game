import { MAP_MODES, type MapModeId } from "../map/mapModes";
import { useUi } from "../state/uiStore";
import { GameMenu } from "./GameMenu";
import { SearchBox } from "./SearchBox";

const GROUPS = [...new Set(Object.values(MAP_MODES).map((m) => m.group))];

export function TopBar() {
  const mapMode = useUi((s) => s.mapMode);
  const setMapMode = useUi((s) => s.setMapMode);
  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 12h18M12 3c2.8 3 2.8 15 0 18M12 3c-2.8 3-2.8 15 0 18" fill="none" stroke="currentColor" strokeWidth="1.2" />
        </svg>
        <span>World Ascendant</span>
        <span className="brand__stage">Stage 3 · simulation</span>
      </div>
      <SearchBox />
      <label className="mode-select">
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
      </label>
      <GameMenu />
    </header>
  );
}
