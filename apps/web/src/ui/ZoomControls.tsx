import { useUi } from "../state/uiStore";

export function ZoomControls() {
  const zoom = useUi((s) => s.zoom);
  const command = useUi((s) => s.command);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  return (
    <div className="zoom-controls" aria-label="Zoom controls">
      <button
        className="zoom-controls__view"
        onClick={() => setView(view === "flat" ? "globe" : "flat")}
        aria-label={view === "flat" ? "Switch to 3D globe" : "Switch to flat map"}
        title={view === "flat" ? "3D globe (G)" : "Flat map (G)"}
        data-testid="view-toggle"
      >
        {view === "flat" ? "3D" : "2D"}
      </button>
      <button onClick={() => command({ kind: "in" })} aria-label="Zoom in" title="Zoom in">+</button>
      <div className="zoom-controls__level" data-testid="zoom-level" title="Zoom level">{zoom < 9.95 ? zoom.toFixed(1) : Math.round(zoom)}×</div>
      <button onClick={() => command({ kind: "out" })} aria-label="Zoom out" title="Zoom out">−</button>
      <button onClick={() => command({ kind: "reset" })} aria-label="Show whole world" title="Show whole world" className="zoom-controls__reset">
        <svg viewBox="0 0 24 24" aria-hidden>
          <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
          <path d="M4 12h16M12 4c2.2 2.4 2.2 13.6 0 16M12 4c-2.2 2.4-2.2 13.6 0 16" fill="none" stroke="currentColor" strokeWidth="1.3" />
        </svg>
      </button>
    </div>
  );
}
