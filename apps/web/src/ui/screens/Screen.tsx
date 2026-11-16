import { useEffect, type ReactNode } from "react";
import type { CountryState } from "@gs/sim";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi, type ScreenId } from "../../state/uiStore";
import { Icon } from "../nav/Icon";

export interface Tab {
  id: string;
  label: string;
  hint?: string;
}

/**
 * The frame every management screen uses: title, tabs, and a way back to the
 * map. Only one screen is open at a time (uiStore.screen); the tab picked on
 * each screen is remembered while the game is open.
 */
export function ScreenFrame({ id, title, subtitle, tabs, children }: { id: ScreenId; title: string; subtitle?: ReactNode; tabs: Tab[]; children: (tab: string) => ReactNode }) {
  const remembered = useUi((s) => s.tabs[id]);
  const setTab = useUi((s) => s.setTab);
  const setScreen = useUi((s) => s.setScreen);
  const tab = tabs.some((t) => t.id === remembered) ? remembered! : tabs[0]!.id;
  return (
    <section className="screen" aria-label={title} data-testid={`screen-${id}`}>
      <header className="screen__head">
        <div className="screen__title">
          <Icon name={id} size={18} />
          <div>
            <h2>{title}</h2>
            {subtitle && <p className="screen__subtitle">{subtitle}</p>}
          </div>
        </div>
        <button className="screen__back" onClick={() => setScreen(null)} title="Back to the world map (Esc)">
          <Icon name="back" size={14} />
          Back to map
        </button>
      </header>
      {tabs.length > 1 && (
        <div className="screen__tabs" role="tablist" aria-label={`${title} sections`}>
          {tabs.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : undefined} title={t.hint} onClick={() => setTab(id, t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className="screen__body" role="tabpanel">
        {children(tab)}
      </div>
    </section>
  );
}

/** Screens about your country need one first. */
export function NeedCountry({ children }: { children: (me: CountryState) => ReactNode }) {
  const me = useGame((s) => playerCountry(s.state));
  const setScreen = useUi((s) => s.setScreen);
  if (me) return <>{children(me)}</>;
  return (
    <div className="screen__empty">
      <p>Choose a country to lead first.</p>
      <button className="btn btn--primary btn--small" onClick={() => setScreen(null)}>
        Choose on the map
      </button>
    </div>
  );
}

/** A system that isn't in the game yet: says so plainly, with no made-up numbers. */
export function Planned({ title, items, note }: { title: string; items: string[]; note?: string }) {
  return (
    <div className="planned" data-testid="planned">
      <div className="planned__head">
        <Icon name="lock" size={14} />
        <strong>{title}</strong>
        <span className="planned__tag">Coming in a later update</span>
      </div>
      <ul>
        {items.map((i) => (
          <li key={i}>{i}</li>
        ))}
      </ul>
      {note && <p className="screen__note">{note}</p>}
    </div>
  );
}

/** A compact titled block inside a screen. */
export function Card({ title, hint, children, wide }: { title: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={`card ${wide ? "card--wide" : ""}`}>
      <h3 title={hint}>
        {title}
        {hint && (
          <span className="card__hint" aria-label={hint} title={hint}>
            ?
          </span>
        )}
      </h3>
      {children}
    </div>
  );
}

/** Label/value rows for compact cards. */
export function Rows({ rows }: { rows: [string, ReactNode, string?][] }) {
  return (
    <dl className="rows">
      {rows.map(([k, v, hint]) => (
        <div key={k} title={hint}>
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Close the open screen with Escape. */
export function useEscapeCloses() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement).closest("input, select, textarea, dialog")) return;
      const ui = useUi.getState();
      if (ui.screen && !ui.selected && !ui.moveOrder) ui.setScreen(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
