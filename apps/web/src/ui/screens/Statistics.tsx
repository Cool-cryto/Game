import { useMemo, useState } from "react";
import type { CountryId } from "@gs/shared";
import { alliesOf, combatPower, orgsOf, treatiesOf, type CountryState, type GameState } from "@gs/sim";
import { flagUrl, getCountry } from "../../data/countries";
import { gdpPerCapita } from "../../map/mapModes";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { formatCompact, formatInt, formatMoneyMillions, formatPercent } from "../format";
import { Sparkline } from "../Sparkline";
import { Card, ScreenFrame } from "./Screen";

const money = formatMoneyMillions;

/** Figures that need more than the country itself (units, provinces, diplomacy), worked out once per update. */
interface WorldFacts {
  land: Map<CountryId, number>;
  sea: Map<CountryId, number>;
  air: Map<CountryId, number>;
  provinces: Map<CountryId, number>;
  area: Map<CountryId, number>;
  industry: Map<CountryId, number>;
  influence: Map<CountryId, number>;
}

function worldFacts(s: GameState): WorldFacts {
  const f: WorldFacts = { land: new Map(), sea: new Map(), air: new Map(), provinces: new Map(), area: new Map(), industry: new Map(), influence: new Map() };
  const add = (m: Map<CountryId, number>, k: CountryId, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const u of Object.values(s.units)) add(u.type === "army" ? f.land : u.type === "navy" ? f.sea : f.air, u.owner, combatPower(s, u));
  for (const p of Object.values(s.provinces)) {
    add(f.provinces, p.owner, 1);
    add(f.area, p.owner, p.areaKm2);
    const b = p.buildings;
    if (b) add(f.industry, p.owner, (b.factory ?? 0) * 2 + (b.powerPlant ?? 0) + (b.mine ?? 0) + (b.farm ?? 0) * 0.5);
  }
  // Diplomatic influence: allies, puppets, guarantees given, treaties and organisation memberships, weighted.
  for (const c of Object.values(s.countries)) {
    if (!c.active) continue;
    const puppets = Object.values(s.countries).filter((x) => x.active && x.overlord === c.id).length;
    const guarantees = (s.guarantees ?? []).filter((k) => k.startsWith(`${c.id}>`)).length;
    f.influence.set(c.id, alliesOf(s, c.id).length * 3 + puppets * 5 + guarantees * 2 + treatiesOf(s, c.id).length + orgsOf(s, c.id).length * 2);
  }
  return f;
}

interface Metric {
  id: string;
  label: string;
  value: (c: CountryState, f: WorldFacts) => number;
  format: (v: number) => string;
  hint?: string;
  /** Sums make sense (a share of the world total is shown). */
  share?: boolean;
}

const power = (v: number) => formatInt(v * 10);
export const METRICS: Metric[] = [
  { id: "gdp", label: "Economy (GDP)", value: (c) => c.gdp, format: (v) => `${money(v)} / yr`, share: true },
  { id: "military", label: "Military power", value: (c, f) => (f.land.get(c.id) ?? 0) + (f.air.get(c.id) ?? 0) * 0.5, format: power, hint: "Fighting power of its army and air force (strength, unit types, technology, fuel)", share: true },
  { id: "population", label: "Population", value: (c) => c.population, format: formatCompact, share: true },
  { id: "territory", label: "Territory", value: (c, f) => f.area.get(c.id) ?? 0, format: (v) => `${formatCompact(v)} km²`, hint: "Land owned", share: true },
  { id: "industry", label: "Industrial capacity", value: (c, f) => f.industry.get(c.id) ?? 0, format: (v) => formatInt(v), hint: "Factories (×2), power plants, mines and farms built", share: true },
  { id: "technology", label: "Technology", value: (c) => c.techLevel + c.researchProgress, format: (v) => `Level ${Math.floor(v)}` },
  { id: "naval", label: "Naval strength", value: (c, f) => f.sea.get(c.id) ?? 0, format: power, share: true },
  { id: "air", label: "Air strength", value: (c, f) => f.air.get(c.id) ?? 0, format: power, share: true },
  { id: "influence", label: "Diplomatic influence", value: (c, f) => f.influence.get(c.id) ?? 0, format: (v) => formatInt(v), hint: "Allies ×3, puppets ×5, guarantees ×2, treaties, organisations ×2" },
  { id: "perperson", label: "GDP per person", value: (c) => gdpPerCapita(c) ?? 0, format: (v) => `$${formatInt(v)}` },
  { id: "spending", label: "Military spending", value: (c) => c.budget.defense * c.gdp, format: (v) => `${money(v)} / yr`, share: true },
];

function useFacts() {
  const s = useGame((x) => x.state);
  // Recomputed when the state object changes (a few times a second at most).
  return useMemo(() => ({ s, f: worldFacts(s) }), [s]);
}

export function StatisticsScreen() {
  return (
    <ScreenFrame
      id="statistics"
      title="Statistics"
      subtitle="How the world's countries compare"
      tabs={[
        { id: "rankings", label: "Rankings", hint: "Every country ranked by one measure" },
        { id: "compare", label: "Compare", hint: "Two countries side by side" },
        { id: "charts", label: "Your charts" },
      ]}
    >
      {(tab) => (tab === "charts" ? <Charts /> : tab === "compare" ? <Compare /> : <Rankings />)}
    </ScreenFrame>
  );
}

function Rankings() {
  const [id, setId] = useState("gdp");
  const m = METRICS.find((x) => x.id === id)!;
  const { s, f } = useFacts();
  const me = playerCountry(s)?.id;
  const select = useUi((x) => x.select);
  const all = Object.values(s.countries)
    .filter((c) => c.active)
    .sort((a, b) => m.value(b, f) - m.value(a, f));
  const total = all.reduce((a, c) => a + m.value(c, f), 0);
  const myIndex = me ? all.findIndex((c) => c.id === me) : -1;
  const shown = all.slice(0, 25);
  const top = m.value(all[0]!, f) || 1;
  return (
    <>
      <label className="stat-pick">
        Rank by{" "}
        <select value={id} onChange={(e) => setId(e.target.value)} data-testid="ranking-measure">
          {METRICS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>
      {m.hint && <p className="screen__note">{m.hint}.</p>}
      {myIndex >= 0 && (
        <p className="screen__note">
          You are <strong>#{myIndex + 1}</strong> of {all.length}
          {m.share && total > 0 ? `, with ${formatPercent(m.value(all[myIndex]!, f) / total, 1)} of the world total` : ""}.
        </p>
      )}
      <table className="table" data-testid={`ranking-${id}`}>
        <tbody>
          {[...shown, ...(myIndex >= 25 ? [all[myIndex]!] : [])].map((c) => {
            const i = all.indexOf(c);
            const info = getCountry(c.id);
            const flag = info ? flagUrl(info) : null;
            return (
              <tr key={c.id} className={`table__click ${c.id === me ? "is-me" : ""}`} onClick={() => select({ kind: "country", id: c.id }, { focus: true })}>
                <td className="num rank">{i + 1}</td>
                <td>
                  <span className="cell-flag">
                    {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
                    {info?.name ?? c.name}
                  </span>
                </td>
                <td className="bar-cell">
                  <span className="mini-bar mini-bar--wide">
                    <span style={{ width: `${(m.value(c, f) / top) * 100}%` }} />
                  </span>
                </td>
                <td className="num">{m.format(m.value(c, f))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

/** Two countries side by side, with their history charts. */
function Compare() {
  const { s, f } = useFacts();
  const me = playerCountry(s)?.id;
  const active = Object.values(s.countries)
    .filter((c) => c.active)
    .sort((a, b) => (getCountry(a.id)?.name ?? a.name).localeCompare(getCountry(b.id)?.name ?? b.name));
  const biggest = [...active].sort((a, b) => b.gdp - a.gdp);
  const [a, setA] = useState<CountryId | null>(null);
  const [b, setB] = useState<CountryId | null>(null);
  const left = s.countries[a ?? me ?? biggest[0]!.id];
  const right = s.countries[b ?? biggest.find((c) => c.id !== left?.id)!.id];
  if (!left || !right) return null;
  const pick = (value: CountryId, set: (v: CountryId) => void, label: string) => (
    <select value={value} onChange={(e) => set(e.target.value as CountryId)} aria-label={label} data-testid={label === "First country" ? "compare-a" : "compare-b"}>
      {active.map((c) => (
        <option key={c.id} value={c.id}>
          {getCountry(c.id)?.name ?? c.name}
        </option>
      ))}
    </select>
  );
  return (
    <div className="grid">
      <Card title="Compare two countries" wide>
        <table className="table compare" data-testid="compare-table">
          <thead>
            <tr>
              <th />
              <th>{pick(left.id, setA, "First country")}</th>
              <th>{pick(right.id, setB, "Second country")}</th>
            </tr>
          </thead>
          <tbody>
            {METRICS.map((m) => {
              const x = m.value(left, f);
              const y = m.value(right, f);
              return (
                <tr key={m.id}>
                  <th title={m.hint}>{m.label}</th>
                  <td className={`num ${x > y ? "pos" : ""}`}>{m.format(x)}</td>
                  <td className={`num ${y > x ? "pos" : ""}`}>{m.format(y)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
      {[left, right].map((c) => (
        <Card key={c.id} title={`${getCountry(c.id)?.name ?? c.name}: economy over time`}>
          {c.history.gdp.length > 1 ? <Sparkline values={c.history.gdp} label={`${c.name} GDP history`} /> : <p className="screen__note">Charts fill in month by month.</p>}
        </Card>
      ))}
    </div>
  );
}

function Charts() {
  const me = useGame((s) => playerCountry(s.state));
  if (!me) return <p className="screen__note">Choose a country to see its charts.</p>;
  return (
    <div className="grid">
      <Card title="Economy (GDP)">{me.history.gdp.length > 1 ? <Sparkline values={me.history.gdp} label="GDP history" /> : <p className="screen__note">Charts fill in month by month.</p>}</Card>
      <Card title="Population">{me.history.population.length > 1 ? <Sparkline values={me.history.population} label="Population history" /> : <p className="screen__note">Charts fill in month by month.</p>}</Card>
    </div>
  );
}
