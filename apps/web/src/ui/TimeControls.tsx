import { useEffect } from "react";
import { currentDate, GAME_SPEEDS, SPEED_DAYS_PER_SECOND, type GameSpeed } from "@gs/sim";
import { playerCountry, useGame } from "../state/gameStore";
import { formatDate } from "./format";

/**
 * The date, pause and 1x-4x speed. One clock drives every system (economy, construction, research, recruiting,
 * movement, battles, AI); speed only changes how many days run per second. Space pauses, +/- change speed.
 * Online, the server keeps time for everyone, so only the date shows.
 */
export function TimeControls() {
  const date = useGame((s) => currentDate(s.state));
  const paused = useGame((s) => s.paused);
  const userPaused = useGame((s) => s.userPaused);
  const speed = useGame((s) => s.speed);
  const local = useGame((s) => s.mode === "local");
  const leading = useGame((s) => !!playerCountry(s.state));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as Element | null)?.closest?.("input, textarea, select, dialog, [contenteditable]")) return;
      const g = useGame.getState();
      if (g.mode !== "local") return;
      if (e.code === "Space") {
        e.preventDefault();
        g.togglePause();
      } else if (e.key === "+" || e.key === "=") g.setSpeed(Math.min(4, g.speed + 1) as GameSpeed);
      else if (e.key === "-" || e.key === "_") g.setSpeed(Math.max(1, g.speed - 1) as GameSpeed);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="time" role="group" aria-label="Date and game speed">
      {local && leading && (
        <>
          <button
            className={userPaused ? "time__btn time__pause is-on" : "time__btn time__pause"}
            onClick={() => useGame.getState().togglePause()}
            aria-pressed={userPaused}
            data-testid="pause"
            title={userPaused ? "Resume (Space)" : "Pause (Space)"}
          >
            {userPaused ? (
              <svg viewBox="0 0 12 12" aria-hidden>
                <path d="M3 1.5v9l7.5-4.5z" />
              </svg>
            ) : (
              <svg viewBox="0 0 12 12" aria-hidden>
                <path d="M2.5 1.5h2.6v9H2.5zM6.9 1.5h2.6v9H6.9z" />
              </svg>
            )}
          </button>
          <div className="time__speedset" role="radiogroup" aria-label="Game speed">
            {GAME_SPEEDS.map((n) => (
              <button
                key={n}
                role="radio"
                aria-checked={speed === n}
                className={speed === n ? "time__btn is-on" : "time__btn"}
                onClick={() => useGame.getState().setSpeed(n)}
                data-testid={`speed-${n}`}
                title={`${n}x: ${SPEED_DAYS_PER_SECOND[n]} days per second (+/- to change)`}
              >
                {n}x
              </button>
            ))}
          </div>
        </>
      )}
      <div className="time__date" data-testid="game-date" title={paused ? "Paused" : "Time is running"}>
        <span className={paused ? "time__dot" : "time__dot is-running"} aria-hidden />
        {formatDate(date)}
        {paused && leading && local && <span className="time__paused">Paused</span>}
      </div>
    </div>
  );
}
