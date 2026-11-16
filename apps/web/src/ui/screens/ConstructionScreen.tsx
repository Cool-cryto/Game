import { useState } from "react";
import type { ProvinceId } from "@gs/shared";
import {
  BUILDING_TYPES,
  BUILDINGS,
  buildCost,
  buildingLevel,
  canBuild,
  dateAt,
  factoryGrowth,
  labBonus,
  MAX_INFRASTRUCTURE,
  MAX_PROJECTS,
  weightedLevel,
  type BuildingType,
  type CountryState,
} from "@gs/sim";
import { GEOGRAPHY, getProvince } from "../../data/countries";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { formatCompact, formatDate, formatMoneyMillions, formatPercent } from "../format";
import { Meter } from "../InfoPanel";
import { useAvgInfrastructure } from "./CoreScreens";
import { Card, NeedCountry, Rows, ScreenFrame } from "./Screen";
import { SpendingSlider } from "./WorldScreens";

export function ConstructionScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="construction"
          title="Construction"
          subtitle="Buildings and infrastructure across your provinces"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "build", label: "Build", hint: "Order factories, railways, ports and fortifications" },
            { id: "provinces", label: "By province" },
            { id: "infrastructure", label: "Infrastructure" },
          ]}
        >
          {(tab) => (tab === "overview" ? <Overview c={c} /> : tab === "build" ? <Build c={c} /> : tab === "provinces" ? <ByProvince c={c} /> : <Infrastructure c={c} />)}
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

function Overview({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const select = useUi((x) => x.select);
  const totals = Object.fromEntries(BUILDING_TYPES.map((b) => [b, 0])) as Record<BuildingType, number>;
  for (const p of Object.values(s.provinces)) if (p.owner === c.id) for (const b of BUILDING_TYPES) totals[b] += buildingLevel(p, b);
  const factories = weightedLevel(s, c.id, "factory");
  return (
    <div className="grid">
      <Card title={`Under construction (${c.construction.length} of ${MAX_PROJECTS})`} hint="You can build several things at once, up to the limit." wide>
        {c.construction.length ? (
          <table className="table" data-testid="projects">
            <tbody>
              {c.construction.map((q) => (
                <tr key={q.id} className="table__click" onClick={() => select({ kind: "province", id: q.province }, { focus: true })}>
                  <td>{BUILDINGS[q.building].label}</td>
                  <td>{getProvince(q.province)?.name ?? q.province}</td>
                  <td className="num">ready {formatDate(dateAt(s.startDate, q.doneTick))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="screen__note">Nothing being built. Order buildings in the Build tab, or click one of your provinces on the map.</p>
        )}
      </Card>
      <Card title="Your buildings" hint="Total levels across all your provinces.">
        <Rows rows={BUILDING_TYPES.map((b) => [BUILDINGS[b].label, String(totals[b]), BUILDINGS[b].effect])} />
      </Card>
      <Card title="What they do for you">
        <Rows
          rows={[
            ["Growth from factories", `${formatPercent(factoryGrowth(factories), 2, true)} / yr`, "Factories count by how many people live where they are"],
            ["Factory coverage", `${((factories / BUILDINGS.factory.max) * 100).toFixed(0)}%`, "Population-weighted factory level, out of level 5 everywhere"],
            ["Research from facilities", `${formatPercent(labBonus(s, c.id), 0, true)} speed`, "+4% per research facility level, up to +40%"],
          ]}
        />
        <p className="screen__note">Buildings are paid from the treasury. You may borrow, but debt costs interest. Provinces start with no buildings: real industry is already in each country's GDP.</p>
      </Card>
    </div>
  );
}

function Build({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const select = useUi((x) => x.select);
  const ids = useGame((x) => x.provincesOf.get(c.id));
  const [type, setType] = useState<BuildingType>("factory");
  const def = BUILDINGS[type];
  const provinces = (ids ?? [])
    .map((id) => s.provinces[id]!)
    .filter((p) => p && p.controller === c.id && (!def.coastal || GEOGRAPHY.provinces[p.id]?.coastal))
    .sort((a, b) => b.population - a.population);
  return (
    <>
      <div className="segmented segmented--4" role="radiogroup" aria-label="Building">
        {BUILDING_TYPES.map((b) => (
          <button key={b} role="radio" aria-checked={type === b} className={type === b ? "is-active" : ""} title={BUILDINGS[b].effect} onClick={() => setType(b)}>
            {BUILDINGS[b].label}
          </button>
        ))}
      </div>
      <p className="screen__note">
        <strong>{def.label}</strong> (up to level {def.max}{def.coastal ? ", coast only" : ""}, {Math.round(def.days / 30)} months to build): {def.effect}
      </p>
      <p className="screen__note">
        Treasury {formatMoneyMillions(c.treasury)} · building {c.construction.length} of {MAX_PROJECTS}
      </p>
      <table className="table" data-testid="build-table">
        <thead>
          <tr>
            <th>Province</th>
            <th className="num">People</th>
            <th className="num">Level</th>
            <th className="num">Cost</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {provinces.map((p) => {
            const reason = canBuild(s, GEOGRAPHY, c.id, p.id, type);
            const queued = c.construction.filter((q) => q.province === p.id && q.building === type).length;
            return (
              <tr key={p.id}>
                <td className="table__click" onClick={() => select({ kind: "province", id: p.id }, { focus: true })} title="Show on the map">
                  {getProvince(p.id)?.name ?? p.id}
                </td>
                <td className="num">{formatCompact(p.population)}</td>
                <td className="num">
                  {buildingLevel(p, type)}
                  {queued ? ` (+${queued})` : ""} / {def.max}
                </td>
                <td className="num">{formatMoneyMillions(buildCost(s, c, p.id, type))}</td>
                <td className="num">
                  <button className="btn btn--primary btn--small" disabled={!!reason} title={reason ?? `Build: ready in about ${Math.round(def.days / 30)} months`} onClick={() => send({ type: "build", country: c.id, province: p.id as ProvinceId, building: type })}>
                    Build
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!provinces.length && <p className="screen__note">{def.coastal ? "You hold no coastal provinces." : "You hold no provinces."}</p>}
    </>
  );
}

function ByProvince({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const ids = useGame((x) => x.provincesOf.get(c.id));
  const select = useUi((x) => x.select);
  const rows = (ids ?? []).map((id) => s.provinces[id]!).filter(Boolean).sort((a, b) => b.population - a.population);
  return (
    <table className="table" data-testid="province-buildings">
      <thead>
        <tr>
          <th>Province</th>
          <th title="Roads, power and services, 0 to 10">Infra</th>
          <th>Buildings</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="table__click" onClick={() => select({ kind: "province", id: p.id }, { focus: true })}>
            <td>{getProvince(p.id)?.name ?? p.id}</td>
            <td>{p.infrastructure.toFixed(1)}</td>
            <td className="table__buildings">
              {BUILDING_TYPES.filter((b) => buildingLevel(p, b) > 0)
                .map((b) => `${BUILDINGS[b].label} ${buildingLevel(p, b)}`)
                .join(" · ") || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Infrastructure({ c }: { c: CountryState }) {
  const avg = useAvgInfrastructure(c.id);
  return (
    <>
      <div className="grid">
        <Card title="Average infrastructure" hint="Roads, power and services. Raises resource output and economic growth.">
          <p className="big-number">
            {avg.toFixed(1)}
            <span className="big-number__sub"> / {MAX_INFRASTRUCTURE}</span>
          </p>
          <Meter value={avg} max={MAX_INFRASTRUCTURE} label="Weighted by population" tone="good" />
        </Card>
        <Card title="How it grows">
          <p className="screen__note">Infrastructure spending raises it in every province, up to your infrastructure research level + 2. Railways make it grow 50% faster where they are.</p>
        </Card>
      </div>
      <SpendingSlider c={c} category="infrastructure" note="About 4% of GDP keeps infrastructure growing." />
    </>
  );
}

/** In a province's map panel: its buildings, and (in your own provinces) buttons to build more. */
export function ProvinceBuildings({ province }: { province: ProvinceId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const p = s.provinces[province];
  const mine = playerCountry(s);
  const me = mine && p && mine.id === p.owner ? mine : null;
  if (!p) return null;
  const has = BUILDING_TYPES.filter((b) => buildingLevel(p, b) > 0);
  const queued = me ? me.construction.filter((q) => q.province === province) : [];
  if (!me && !has.length) return null;
  return (
    <section aria-label="Buildings" data-testid="province-buildings-panel">
      <h3>Buildings</h3>
      <p className="panel__small">
        {has.length ? has.map((b) => `${BUILDINGS[b].label} ${buildingLevel(p, b)}`).join(" · ") : "None yet."}
        {queued.length ? ` Building: ${queued.map((q) => BUILDINGS[q.building].label.toLowerCase()).join(", ")}.` : ""}
      </p>
      {me && (
        <div className="build-row">
          {BUILDING_TYPES.map((b) => {
            const reason = canBuild(s, GEOGRAPHY, me.id, province, b);
            if (reason && /coast|highest/.test(reason)) return null;
            return (
              <button key={b} className="btn btn--ghost btn--small" disabled={!!reason} title={reason ?? `${BUILDINGS[b].effect} Costs ${formatMoneyMillions(buildCost(s, me, province, b))}.`} onClick={() => send({ type: "build", country: me.id, province, building: b })}>
                Build {BUILDINGS[b].label.toLowerCase()}
                <span className="recruit__cost">{formatMoneyMillions(buildCost(s, me, province, b))}</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
