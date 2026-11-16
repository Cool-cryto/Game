import { useEffect, useRef, useState } from "react";
import { dateAt, type GameEvent } from "@gs/sim";
import { playerCountry, useGame } from "../state/gameStore";
import { formatDate } from "./format";
import { useUi } from "../state/uiStore";
import { playAlert } from "./sound";

const ICON: Record<GameEvent["kind"], string> = {
  war: "⚔",
  peace: "☮",
  battle: "✕",
  occupation: "⚑",
  alliance: "⛓",
  annexation: "⚠",
  diplomacy: "✉",
  military: "▲",
  politics: "◆",
};

/**
 * World news. "Yours" shows events involving your country; "World" adds major
 * events everywhere (wars, peace, annexations, alliances). Important events
 * involving you also pop up briefly.
 */
export function NewsFeed() {
  const events = useGame((s) => s.state.events);
  const startDate = useGame((s) => s.state.startDate);
  const me = useGame((s) => playerCountry(s.state)?.id);
  const [filter, setFilter] = useState<"mine" | "world">("world");
  const [open, setOpen] = useState(true);
  const [toast, setToast] = useState<GameEvent | null>(null);
  const select = useUi((s) => s.select);
  const seen = useRef(events.length ? events[events.length - 1]! : null);

  const major = (e: GameEvent) => e.kind === "war" || e.kind === "peace" || e.kind === "annexation" || e.kind === "alliance";
  const shown = events.filter((e) => (filter === "mine" ? me && e.countries.includes(me) : major(e) || (me && e.countries.includes(me)))).slice(-30).reverse();

  // Pop up new events that involve you.
  useEffect(() => {
    const last = seen.current;
    const fresh = last ? events.slice(events.indexOf(last) + 1) : events;
    seen.current = events.length ? events[events.length - 1]! : null;
    const mineNew = fresh.filter((e) => me && e.countries.includes(me) && e.kind !== "military");
    if (!mineNew.length) return;
    setToast(mineNew[mineNew.length - 1]!);
    playAlert(mineNew[mineNew.length - 1]!.kind);
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [events, me]);

  return (
    <>
      {toast && (
        <div className={`news-toast news-toast--${toast.kind}`} role="status" data-testid="news-toast">
          <span className="news__icon">{ICON[toast.kind]}</span>
          {toast.text}
        </div>
      )}
      <section className={`news ${open ? "" : "news--closed"}`} aria-label="News">
        <div className="news__head">
          <button className="news__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
            News {events.length > 0 && !open && <span className="news__count">{shown.length}</span>}
          </button>
          {open && (
            <div className="news__filters" role="radiogroup" aria-label="News filter">
              {(["world", "mine"] as const).map((f) => (
                <button key={f} role="radio" aria-checked={filter === f} className={filter === f ? "is-on" : undefined} onClick={() => setFilter(f)}>
                  {f === "world" ? "World" : "Yours"}
                </button>
              ))}
            </div>
          )}
        </div>
        {open && (
          <ul className="news__list" data-testid="news-list">
            {shown.length === 0 && <li className="news__empty">{filter === "mine" && !me ? "Pick a country to see your news." : "Nothing yet. News appears here as time runs."}</li>}
            {shown.map((e, i) => (
              <li
                key={`${e.tick}-${i}`}
                className={`news__item news__item--${e.kind} ${e.countries.length ? "news__item--link" : ""}`}
                onClick={() => e.countries[0] && select({ kind: "country", id: e.countries.find((c) => c !== me) ?? e.countries[0] }, { focus: true })}
                title={e.countries.length ? "Show on the map" : undefined}
              >
                <span className="news__icon" aria-hidden>
                  {ICON[e.kind]}
                </span>
                <span>
                  <span className="news__date">{formatDate(dateAt(startDate, e.tick))}</span>
                  {e.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
