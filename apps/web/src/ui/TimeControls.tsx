import { currentDate } from "@gs/sim";
import { useGame } from "../state/gameStore";
import { formatDate } from "./format";

/** The date. Time always runs by itself (21 days a second) once you lead a country. */
export function TimeControls() {
  const date = useGame((s) => currentDate(s.state));
  const paused = useGame((s) => s.paused);
  return (
    <div className="time" role="group" aria-label="Date">
      <div className="time__date" data-testid="game-date" title="Time runs by itself: 21 days every second">
        <span className={paused ? "time__dot" : "time__dot is-running"} aria-hidden />
        {formatDate(date)}
      </div>
    </div>
  );
}
