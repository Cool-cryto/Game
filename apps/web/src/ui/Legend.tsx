import { MAP_MODES } from "../map/mapModes";
import { useUi } from "../state/uiStore";

export function Legend() {
  const mode = MAP_MODES[useUi((s) => s.mapMode)];
  if (!mode.legend) return null;
  return (
    <div className="legend" aria-label={`${mode.label} legend`}>
      {mode.legend.map((l) => (
        <div key={l.label} className="legend__row">
          <span className="legend__swatch" style={{ background: l.color }} />
          {l.label}
        </div>
      ))}
    </div>
  );
}
