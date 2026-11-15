import { MAP_MODES, type MapModeId } from "../map/mapModes";
import { useUi } from "../state/uiStore";
import { SearchBox } from "./SearchBox";

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
        <span className="brand__stage">Stage 1 · map prototype</span>
      </div>
      <SearchBox />
      <div className="segmented" role="radiogroup" aria-label="Map mode">
        {(Object.keys(MAP_MODES) as MapModeId[]).map((id) => (
          <button key={id} role="radio" aria-checked={mapMode === id} className={mapMode === id ? "is-on" : undefined} onClick={() => setMapMode(id)}>
            {MAP_MODES[id].label}
          </button>
        ))}
      </div>
    </header>
  );
}
