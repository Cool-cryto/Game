import { MAP_MODES, type MapModeId } from "../../map/mapModes";
import { useUi } from "../../state/uiStore";

const GROUPS = [...new Set(Object.values(MAP_MODES).map((m) => m.group))];

/** Which map to show (political, population, wealth, wars…), on the map itself. */
export function MapModeControl() {
  const mapMode = useUi((s) => s.mapMode);
  const setMapMode = useUi((s) => s.setMapMode);
  const screen = useUi((s) => s.screen);
  if (screen) return null; // a management screen covers this corner
  return (
    <label className="mapmode" title="Change what the map shows">
      <span className="mapmode__label">Map</span>
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
  );
}
