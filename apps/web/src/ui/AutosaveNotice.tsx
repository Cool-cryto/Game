import { useEffect } from "react";
import { useAutosave } from "../state/autosave";
import { formatDate } from "./format";

/** "Welcome back": shown for a few seconds after a refresh restored your game. */
export function AutosaveNotice() {
  const restored = useAutosave((s) => s.restored);
  const dismiss = useAutosave((s) => s.dismiss);
  useEffect(() => {
    if (!restored) return;
    const t = setTimeout(dismiss, 7000);
    return () => clearTimeout(t);
  }, [restored, dismiss]);
  if (!restored) return null;
  return (
    <div className="news-toast autosave-notice" role="status" data-testid="autosave-notice">
      Welcome back: your game{restored.country ? ` as ${restored.country}` : ""} was restored ({formatDate(restored.gameDate)}). Start over from
      the Game menu.
      <button className="icon-btn" onClick={dismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  );
}
