import { useEffect } from "react";
import { currentDate } from "@gs/sim";
import { useGame } from "../state/gameStore";
import { useOnline } from "../net/online";
import type { Speed } from "../sim/protocol";
import { formatDate } from "./format";

const SPEEDS: Speed[] = [1, 2, 3, 4, 5];
const SPEED_LABEL: Record<Speed, string> = { 1: "1 day per second", 2: "4 days per second", 3: "15 days per second", 4: "45 days per second", 5: "120 days per second" };

/** Date, pause/play and speed. Space pauses; keys 1-5 pick a speed. */
export function TimeControls() {
  const date = useGame((s) => currentDate(s.state));
  const paused = useGame((s) => s.paused);
  const speed = useGame((s) => s.speed);
  const setPaused = useGame((s) => s.setPaused);
  const setSpeed = useGame((s) => s.setSpeed);
  const mode = useGame((s) => s.mode);
  const clock = useOnline((s) => s.clock);
  const host = useOnline((s) => s.you.host);
  // Online, only the host of a private server controls time; the global world runs at a fixed pace.
  const locked = mode === "online" && (!!clock?.fixed || !host);
  const lockedReason = clock?.fixed ? "The global world runs at a fixed speed" : "Only the host controls time";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, [contenteditable], dialog")) return;
      if (useGame.getState().mode === "online" && (useOnline.getState().clock?.fixed || !useOnline.getState().you.host)) return;
      if (e.code === "Space") {
        e.preventDefault();
        setPaused(!useGame.getState().paused);
      } else if (/^[1-5]$/.test(e.key)) setSpeed(Number(e.key) as Speed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaused, setSpeed]);

  return (
    <div className="time" role="group" aria-label="Time controls">
      <button
        className={paused ? "time__play" : "time__play is-running"}
        onClick={() => setPaused(!paused)}
        aria-label={paused ? "Play" : "Pause"}
        title={locked ? lockedReason : paused ? "Play (Space)" : "Pause (Space)"}
        disabled={locked}
      >
        {paused ? (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M8 5v14l11-7z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden>
            <path d="M7 5h4v14H7zM13 5h4v14h-4z" />
          </svg>
        )}
      </button>
      <div className="time__date" data-testid="game-date">
        {formatDate(date)}
        {paused && <span className="time__paused">Paused</span>}
        {locked && <span className="time__note">{clock?.fixed ? "Fixed speed" : "Host's clock"}</span>}
      </div>
      <div className="time__speeds" role="radiogroup" aria-label="Game speed">
        {SPEEDS.map((s) => (
          <button
            key={s}
            role="radio"
            aria-checked={speed === s}
            aria-label={`Speed ${s}`}
            title={locked ? lockedReason : `Speed ${s}: ${SPEED_LABEL[s]} (key ${s})`}
            disabled={locked}
            className={s <= speed ? "is-on" : undefined}
            onClick={() => setSpeed(s)}
          />
        ))}
      </div>
    </div>
  );
}
