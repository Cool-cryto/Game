import { useEffect, useState } from "react";
import type { CountryId, ProvinceId } from "@gs/shared";
import {
  canRecruit,
  etaDays,
  kindOf,
  rankOf,
  TRAITS,
  recruitCost,
  siegeDays,
  unitCap,
  UNIT_STATS,
  upkeepPerYear,
  type GameState,
  type Unit,
  type UnitType,
} from "@gs/sim";
import { GEOGRAPHY, getCountry, getProvince, flagUrl } from "../data/countries";
import { playerCountry, useGame } from "../state/gameStore";
import { useUi } from "../state/uiStore";
import { formatMoneyMillions } from "./format";
import { kindSummary, stackGeneral } from "./screens/MilitaryForces";

const TYPES: UnitType[] = ["army", "navy", "air"];
const TYPE_HELP: Record<UnitType, string> = {
  army: "Fights on land and occupies enemy provinces.",
  navy: "Lets armies cross the sea. Built and based in coastal provinces.",
  air: "Supports battles within 1,200 km of its base (+15% each, up to +45%).",
};

export function unitStatus(s: GameState, u: Unit): string {
  if (u.training) return `Training · ${u.training} days`;
  if (u.retreating) return "Retreating";
  if (u.travel && u.path.length) {
    const to = getProvince(u.path[u.path.length - 1]!)?.name ?? "?";
    return `${u.travel.mode === "sea" ? "Sailing" : u.travel.mode === "air" ? "Flying" : "Marching"} to ${to} · ${etaDays(s, GEOGRAPHY, u)} days`;
  }
  const p = s.provinces[u.province];
  if (p?.siege && p.siege.by === u.owner) return `Besieging · ${Math.round(p.siege.progress * 100)}%`;
  const enemyHere = Object.values(s.units).some((x) => x.province === u.province && x.owner !== u.owner && x.type === u.type && s.wars.some((w) => (w.attackers.includes(x.owner) && w.defenders.includes(u.owner)) || (w.defenders.includes(x.owner) && w.attackers.includes(u.owner))));
  return enemyHere ? "In battle" : "Idle";
}

/** A stack of units in one province (the "units" selection). */
export function UnitsView({ province, owner }: { province: ProvinceId; owner: CountryId }) {
  // Select the whole state (a stable reference) and derive from it; selecting a freshly
  // filtered array would make React re-render forever.
  const state = useGame((s) => s.state);
  const units = Object.values(state.units).filter((u) => u.province === province && u.owner === owner);
  const me = playerCountry(state)?.id;
  const send = useGame((s) => s.send);
  const select = useUi((s) => s.select);
  const setMoveOrder = useUi((s) => s.setMoveOrder);
  const moveOrder = useUi((s) => s.moveOrder);
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const mine = owner === me;
  const country = getCountry(owner);
  const flag = country ? flagUrl(country) : null;
  const picked = units.filter((u) => (chosen ? chosen.has(u.id) : true)).map((u) => u.id);
  // The units moved on (or are gone): close this panel rather than show an empty one.
  const empty = units.length === 0;
  useEffect(() => {
    if (!empty) return;
    const t = setTimeout(() => select(null), 400);
    return () => clearTimeout(t);
  }, [empty, select]);

  return (
    <aside className="panel" aria-label="Units" data-testid="info-panel">
      <div className="panel__head">
        {flag ? <img className="panel__flag panel__flag--small" src={flag} alt="" /> : null}
        <div className="panel__titles">
          <p className="panel__eyebrow">{mine ? "Your forces" : `${country?.name ?? owner} forces`}</p>
          <h2>{getProvince(province)?.name ?? province}</h2>
        </div>
        <button className="icon-btn" onClick={() => select(null)} aria-label="Close panel">
          ×
        </button>
      </div>
      {(() => {
        const g = stackGeneral(state, owner, units);
        return g ? (
          <p className="panel__small" data-testid="stack-general">
            Led by {rankOf(g)} {g.name} · skill {g.skill} · {TRAITS[g.trait].label}
          </p>
        ) : null;
      })()}
      {units.length === 0 ? (
        <p className="panel__note">No units here any more.</p>
      ) : (
        <ul className="unit-list">
          {units.map((u) => (
            <li key={u.id} className="unit-row">
              {mine && (
                <input
                  type="checkbox"
                  aria-label={`Select ${kindOf(u).label} ${u.id}`}
                  checked={chosen ? chosen.has(u.id) : true}
                  onChange={(e) => {
                    const next = new Set(chosen ?? units.map((x) => x.id));
                    if (e.target.checked) next.add(u.id);
                    else next.delete(u.id);
                    setChosen(next);
                    // Units waiting for a move order: only the ticked ones go.
                    if (moveOrder) setMoveOrder(next.size ? { units: [...next] } : null);
                  }}
                />
              )}
              <span className={`unit-icon unit-icon--${u.type}`} aria-hidden />
              <span className="unit-row__main">
                <span className="unit-row__name">
                  {kindOf(u).label} #{u.id}
                </span>
                <span className="unit-row__status">{unitStatus(state, u)}</span>
              </span>
              <span className="unit-row__strength" title="Strength">
                <span className="unit-row__bar">
                  <span style={{ width: `${u.strength}%` }} className={u.strength > 60 ? "good" : u.strength > 30 ? "mid" : "bad"} />
                </span>
                {Math.round(u.strength)}%
              </span>
            </li>
          ))}
        </ul>
      )}
      {mine && units.length > 0 && (
        <div className="panel__actions">
          <button className="btn btn--primary" disabled={!picked.length} onClick={() => setMoveOrder(moveOrder ? null : { units: picked })}>
            {moveOrder ? "Cancel move" : `Move ${picked.length} unit${picked.length === 1 ? "" : "s"}…`}
          </button>
          {moveOrder && <p className="panel__small">Ready to move: click a province on the map to send them there. Esc cancels.</p>}
          <button
            className="btn btn--ghost"
            disabled={!picked.length}
            onClick={() => {
              if (me) send({ type: "disband", country: me, units: picked });
              setChosen(null);
            }}
          >
            Disband selected
          </button>
        </div>
      )}
      {!mine && <p className="panel__small">You can see other countries' forces but not command them.</p>}
    </aside>
  );
}

/** Your military: overview, recruiting at the capital, and where your units are. */
export function MilitarySection({ country }: { country: CountryId }) {
  const state = useGame((s) => s.state);
  const c = state.countries[country]!;
  const units = Object.values(state.units).filter((u) => u.owner === country);
  const select = useUi((s) => s.select);
  const stacks = new Map<ProvinceId, Unit[]>();
  for (const u of units) stacks.set(u.province, [...(stacks.get(u.province) ?? []), u]);
  const upkeep = units.reduce((a, u) => a + upkeepPerYear(c, u.type, u.kind), 0);

  return (
    <section aria-label="Military">
      <h3>Military</h3>
      <div className="stats">
        <div className="stat">
          <div className="stat__value">
            {units.length} / {unitCap(c)}
          </div>
          <div className="stat__label">Units (population limit)</div>
        </div>
        <div className="stat">
          <div className={`stat__value ${c.defenseFund < 0 ? "neg" : ""}`}>{formatMoneyMillions(c.defenseFund)}</div>
          <div className="stat__label">Defense fund · upkeep {formatMoneyMillions(upkeep)}/yr</div>
        </div>
      </div>
      {c.capital && <RecruitButtons country={country} province={c.capital} label="Recruit at the capital" />}
      {stacks.size > 0 && (
        <ul className="stack-list">
          {[...stacks].map(([p, list]) => (
            <li key={p}>
              <button onClick={() => select({ kind: "units", province: p, owner: country }, { focus: true })}>
                <span className="stack-list__name">{getProvince(p)?.name ?? p}</span>
                <span className="stack-list__units">{kindSummary(list)}</span>
                <span className="stack-list__status">{unitStatus(state, list[0]!)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="panel__small">
        Units are paid from the defense fund, which your defense spending fills. If it runs out, units lose strength. Starting forces are
        estimates sized from defense budgets, not real-world militaries.
      </p>
    </section>
  );
}

export function RecruitButtons({ country, province, label }: { country: CountryId; province: ProvinceId; label: string }) {
  const state = useGame((s) => s.state);
  const send = useGame((s) => s.send);
  const c = state.countries[country]!;
  return (
    <div className="recruit">
      <p className="policies__group">{label}</p>
      <div className="recruit__buttons">
        {TYPES.map((type) => {
          const reason = canRecruit(state, GEOGRAPHY, country, type, province);
          return (
            <button
              key={type}
              className="btn btn--ghost btn--small"
              disabled={!!reason}
              title={reason ?? TYPE_HELP[type]}
              onClick={() => send({ type: "recruit", country, unitType: type, province })}
            >
              {UNIT_STATS[type].label}
              <span className="recruit__cost">{formatMoneyMillions(recruitCost(c, type))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Occupation and siege status for a province panel. */
export function ProvinceWarStatus({ province }: { province: ProvinceId }) {
  const p = useGame((s) => s.state.provinces[province]);
  if (!p) return null;
  const occupied = p.controller !== p.owner;
  if (!occupied && !p.siege) return null;
  return (
    <div className="panel__note panel__note--war">
      {occupied && <p>Occupied by {getCountry(p.controller)?.name ?? p.controller}.</p>}
      {p.siege && (
        <p>
          {p.buildings?.fort ? "Under siege" : "Being occupied"} by {getCountry(p.siege.by)?.name ?? p.siege.by}: {Math.round(p.siege.progress * 100)}% (about{" "}
          {Math.round(siegeDays(p.infrastructure, p.buildings?.fort ?? 0, p.areaKm2))} days for one full-strength army; up to three armies go three times as fast).
        </p>
      )}
    </div>
  );
}
