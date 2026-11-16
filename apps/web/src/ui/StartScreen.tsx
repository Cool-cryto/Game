import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import type { CountryId } from "@gs/shared";
import { currentDate, DIFFICULTIES, DIFFICULTY_RULES, governmentLabel, orgsOf, unitCap, UNIT_STATS, type Difficulty, type GameState, type UnitType } from "@gs/sim";
import { flagUrl, getCountry } from "../data/countries";
import { playerCountry, useGame } from "../state/gameStore";
import { useUi } from "../state/uiStore";
import { useEditor } from "../state/editor";
import { useOnline } from "../net/online";
import { formatCompact, formatDate, formatMoneyMillions } from "./format";
import { difficulty as challenge, economyRank } from "./simple/SimpleHud";

const SUGGESTED = ["USA", "CHN", "DEU", "GBR", "FRA", "JPN", "BRA", "IND", "TUR", "EGY", "NGA", "POL"] as CountryId[];
const GUIDE_KEY = "wa.guideDone";
const firstVisit = () => {
  try {
    return localStorage.getItem(GUIDE_KEY) !== "1";
  } catch {
    return true;
  }
};

/** Whether the country-selection screen is open. First-time players see it straight away; anyone can open it from the top bar. */
export const useStartScreen = create<{ open: boolean; setOpen: (open: boolean) => void }>((set) => ({
  open: firstVisit(),
  setOpen: (open) => set({ open }),
}));

const PLURAL: Record<UnitType, string> = { army: "armies", navy: "fleets", air: "air wings" };
const nameOf = (id: CountryId) => getCountry(id)?.name ?? id;

function forcesOf(s: GameState, id: CountryId): Record<UnitType, number> {
  const n: Record<UnitType, number> = { army: 0, navy: 0, air: 0 };
  for (const u of Object.values(s.units)) if (u.owner === id) n[u.type]++;
  return n;
}

/**
 * Country selection: search every country, compare starting figures, choose a difficulty and start. Every number
 * comes from the game state that is about to run (the scenario's data, or game-generated where labelled).
 */
export function StartScreen() {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const provincesOf = useGame((x) => x.provincesOf);
  const me = playerCountry(s);
  const editing = useEditor((x) => x.active);
  const online = useOnline((x) => !!x.room);
  const { open, setOpen } = useStartScreen();
  const selectedOnMap = useUi((x) => x.selected);
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState<CountryId | null>(null);
  const [level, setLevel] = useState<Difficulty>(s.settings?.difficulty ?? "normal");

  // Picking something on the map (or with search) means the player wants to look around.
  useEffect(() => {
    if (selectedOnMap) setOpen(false);
  }, [selectedOnMap, setOpen]);

  const all = useMemo(
    () =>
      Object.values(s.countries)
        .filter((c) => c.active && c.controller !== "human" && getCountry(c.id))
        .sort((a, b) => b.gdp - a.gdp),
    [s.countries],
  );
  const q = query.trim().toLowerCase();
  const list = q
    ? all.filter((c) => nameOf(c.id).toLowerCase().includes(q) || c.id.toLowerCase() === q).slice(0, 40)
    : SUGGESTED.map((id) => s.countries[id]).filter((c) => c?.active && c.controller !== "human");

  if (me || editing || online || !open) return null;

  const start = () => {
    if (!pick) return;
    send({ type: "setDifficulty", difficulty: level });
    send({ type: "claimCountry", country: pick });
    setOpen(false);
  };
  const c = pick ? s.countries[pick] : undefined;
  const info = pick ? getCountry(pick) : undefined;
  const forces = pick ? forcesOf(s, pick) : null;
  return (
    <div className="start start--select" role="dialog" aria-label="Choose your country" data-testid="start-screen">
      <header className="start__head">
        <div>
          <h2>Choose a country to lead</h2>
          <p className="start__goal">
            <strong>Your goal:</strong> make your country the strongest in the world. Grow your economy, build an army, make friends, and take
            land from your enemies.
          </p>
        </div>
        <div className="start__scenario" data-testid="start-scenario">
          <strong>{s.scenarioName ?? "Modern World"}</strong>
          <span>Starts {formatDate(currentDate(s))}</span>
        </div>
      </header>

      <div className="start__body">
        <div className="start__list">
          <input
            className="start__search"
            type="search"
            placeholder="Search all countries"
            aria-label="Search countries"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            data-testid="start-search"
          />
          <p className="start__listhint">{q ? `${list.length} match${list.length === 1 ? "" : "es"}` : "Suggested · search for any other country"}</p>
          <ul className="start__rows" role="listbox" aria-label="Countries">
            {list.map((x) => {
              const ci = getCountry(x!.id)!;
              const flag = flagUrl(ci);
              const d = challenge(s, x!.id);
              return (
                <li key={x!.id}>
                  <button
                    role="option"
                    aria-selected={pick === x!.id}
                    className={pick === x!.id ? "start__pick is-on" : "start__pick"}
                    onClick={() => setPick(x!.id)}
                    onDoubleClick={() => {
                      setPick(x!.id);
                      send({ type: "setDifficulty", difficulty: level });
                      send({ type: "claimCountry", country: x!.id });
                      setOpen(false);
                    }}
                  >
                    {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
                    <span className="start__name">{ci.name}</span>
                    <span className="start__gdp">{formatMoneyMillions(x!.gdp)}</span>
                    <span className={`difficulty difficulty--${d.tone}`} title="How hard this country is to play, from the size of its economy">
                      {d.label}
                    </span>
                  </button>
                </li>
              );
            })}
            {!list.length && <li className="start__empty">No country by that name.</li>}
          </ul>
        </div>

        <div className="start__detail" data-testid="start-detail">
          {c && info && forces ? (
            <>
              <div className="start__title">
                {flagUrl(info) ? <img src={flagUrl(info)!} alt="" /> : <span className="flag-placeholder" />}
                <div>
                  <h3>{info.name}</h3>
                  <span className="start__sub">
                    {governmentLabel(c.government)}
                    {c.government.source === "estimate" ? " (estimate)" : ""}
                    {info.capital[0] ? ` · capital ${info.capital[0]}` : ""}
                  </span>
                </div>
              </div>
              <dl className="start__facts">
                <div>
                  <dt>Population</dt>
                  <dd>{formatCompact(c.population)}</dd>
                </div>
                <div>
                  <dt>Economy (GDP)</dt>
                  <dd>
                    {formatMoneyMillions(c.gdp)} <small>#{economyRank(s, c.id)}</small>
                  </dd>
                </div>
                <div>
                  <dt>Per person</dt>
                  <dd>${formatCompact((c.gdp * 1e6) / Math.max(1, c.population))}</dd>
                </div>
                <div>
                  <dt>Territory</dt>
                  <dd>
                    {provincesOf.get(c.id)?.length ?? 0} provinces{info.areaKm2 ? ` · ${formatCompact(info.areaKm2)} km²` : ""}
                  </dd>
                </div>
                <div>
                  <dt title="Starting forces are estimated from defense budgets, not real armies">Military (est.)</dt>
                  <dd>
                    {(Object.keys(forces) as UnitType[])
                      .filter((t) => forces[t])
                      .map((t) => `${forces[t]} ${forces[t] > 1 ? PLURAL[t] : UNIT_STATS[t].label.toLowerCase()}`)
                      .join(", ") || "none"}
                  </dd>
                </div>
                <div>
                  <dt>Unit limit</dt>
                  <dd>{unitCap(c)}</dd>
                </div>
                <div>
                  <dt>Technology</dt>
                  <dd>Level {c.techLevel.toFixed(0)}</dd>
                </div>
                <div>
                  <dt>Challenge</dt>
                  <dd>
                    <span className={`difficulty difficulty--${challenge(s, c.id).tone}`}>{challenge(s, c.id).label}</span>
                  </dd>
                </div>
              </dl>
              {orgsOf(s, c.id).length > 0 && <p className="start__orgs">Member of {orgsOf(s, c.id).map((o) => o.name).join(", ")}</p>}
            </>
          ) : (
            <p className="start__placeholder">Pick a country to see its starting population, economy, military and territory.</p>
          )}
          {s.dataNote && <p className="start__source">{s.dataNote}</p>}
        </div>
      </div>

      <footer className="start__foot">
        <div className="start__levels" role="radiogroup" aria-label="Difficulty">
          {DIFFICULTIES.map((d) => (
            <button key={d} role="radio" aria-checked={level === d} className={level === d ? "seg is-on" : "seg"} onClick={() => setLevel(d)} data-testid={`difficulty-${d}`}>
              {DIFFICULTY_RULES[d].label}
            </button>
          ))}
        </div>
        <p className="start__levelnote">{DIFFICULTY_RULES[level].summary}</p>
        <div className="start__actions">
          <button className="link" onClick={() => setOpen(false)}>
            Just look around first
          </button>
          <button className="btn btn--primary" disabled={!pick} onClick={start} data-testid="start-game">
            {pick ? `Start game as ${nameOf(pick)}` : "Start game"}
          </button>
        </div>
      </footer>
    </div>
  );
}
