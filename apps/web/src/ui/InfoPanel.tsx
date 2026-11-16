import { useEffect, useState, type ReactNode } from "react";
import { RESOURCES, type CountryId, type CountryInfo, type ProvinceId, type ResourceId } from "@gs/shared";
import {
  ADMIN_COST,
  planMove,
  BUDGET_RANGE,
  budgetBalance,
  growthBreakdown,
  MAX_INFRASTRUCTURE,
  MAX_TECH,
  rawProduction,
  stabilityBreakdown,
  supplied,
  TAX_RANGE,
  yearsPerTechLevel,
  type BudgetCategory,
  type CountryState,
} from "@gs/sim";
import { citiesIn, flagUrl, GEOGRAPHY, getCountry, getProvince, landNeighbours, MODERN_SCENARIO } from "../data/countries";
import { gdpPerCapita } from "../map/mapModes";
import { fogOf } from "../state/fog";
import { SimpleCountryView } from "./simple/SimpleHud";
import { playerCountry, useGame } from "../state/gameStore";
import { useOnline } from "../net/online";
import { DiplomacySection, WarsSection } from "./DiplomacyPanel";
import { MilitarySection, ProvinceWarStatus, RecruitButtons, UnitsView } from "./MilitaryPanel";
import { useUi } from "../state/uiStore";
import { formatCompact, formatInt, formatMoneyMillions, formatPercent } from "./format";
import { Sparkline } from "./Sparkline";

const KIND_LABEL: Record<CountryInfo["kind"], string> = {
  sovereign: "Sovereign state",
  territory: "Territory / dependency",
  disputed: "Disputed region",
};
export const RESOURCE_LABEL: Record<ResourceId, string> = { food: "Food", energy: "Energy", minerals: "Minerals" };
export const BUDGET_LABEL: Record<BudgetCategory, { label: string; help: string }> = {
  infrastructure: { label: "Infrastructure", help: "Builds up province infrastructure (about 4% of GDP keeps it growing)." },
  research: { label: "Research", help: "Raises technology level, which boosts output and growth." },
  welfare: { label: "Welfare", help: "Raises stability." },
  defense: { label: "Defense", help: "Fills the army fund, which pays for recruiting and keeping units." },
};

/** Info panel for whatever is selected: a country or a province. */
export function InfoPanel() {
  const selected = useUi((s) => s.selected);
  const select = useUi((s) => s.select);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || (e.target as HTMLElement).closest("input[type=search], select, dialog")) return;
      // Escape first cancels a pending move order, then closes the panel.
      if (useUi.getState().moveOrder) useUi.getState().setMoveOrder(null);
      else select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!selected) return null;
  if (selected.kind === "units") return <UnitsView province={selected.province} owner={selected.owner} />;
  return selected.kind === "country" ? <CountryPanel id={selected.id} /> : <ProvinceView id={selected.id} />;
}

/** A short country panel first; "Show all details" shows everything. */
function CountryPanel({ id }: { id: CountryId }) {
  const details = useUi((s) => s.details);
  const setDetails = useUi((s) => s.setDetails);
  if (!details) return <SimpleCountryView id={id} onDetails={() => setDetails(true)} />;
  return <CountryView id={id} />;
}

/**
 * While giving a move order, the selected place gets a "Send units here" button:
 * handy for tiny provinces and islands, and for targets found with search.
 */
function SendHere({ province, label }: { province: ProvinceId; label: string }) {
  const moveOrder = useUi((s) => s.moveOrder);
  const setMoveOrder = useUi((s) => s.setMoveOrder);
  const state = useGame((s) => s.state);
  const send = useGame((s) => s.send);
  const me = playerCountry(state)?.id;
  if (!moveOrder || !me) return null;
  const units = moveOrder.units.map((id) => state.units[id]).filter((u): u is NonNullable<typeof u> => !!u);
  const plans = units.map((u) => planMove(state, GEOGRAPHY, u, province));
  const ok = plans.filter((p) => !("error" in p)).length;
  const firstError = plans.find((p): p is { error: string } => "error" in p)?.error;
  return (
    <div className="send-here">
      <p>
        Move order: {units.length} unit{units.length === 1 ? "" : "s"} waiting. {ok ? `${ok} can go to ${label}.` : firstError}
      </p>
      <button
        className="btn btn--primary btn--small"
        disabled={!ok}
        onClick={() => {
          send({ type: "moveUnits", country: me, units: moveOrder.units, to: province });
          setMoveOrder(null);
        }}
      >
        Send units here
      </button>
      <button className="btn btn--ghost btn--small" onClick={() => setMoveOrder(null)}>
        Cancel
      </button>
    </div>
  );
}

function Shell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <aside className="panel" aria-label={label} data-testid="info-panel">
      {children}
    </aside>
  );
}

function CloseButton() {
  const select = useUi((s) => s.select);
  return (
    <button className="icon-btn" onClick={() => select(null)} aria-label="Close panel" title="Close (Esc)">
      ×
    </button>
  );
}

export function CountryView({ id }: { id: CountryId }) {
  const c = getCountry(id);
  const state = useGame((s) => s.state.countries[id]);
  const provinceIds = useGame((s) => s.provincesOf.get(id)) ?? [];
  const avgInfra = useGame((s) => {
    let pop = 0;
    let sum = 0;
    for (const pid of s.provincesOf.get(id) ?? []) {
      const p = s.state.provinces[pid];
      if (!p) continue;
      pop += p.population;
      sum += p.population * p.infrastructure;
    }
    return pop > 0 ? sum / pop : 0;
  });
  const send = useGame((s) => s.send);
  const me = useGame((s) => playerCountry(s.state)?.id);
  const select = useUi((s) => s.select);
  if (!c || !state) return null;
  const flag = flagUrl(c);
  const perCapita = gdpPerCapita(state);
  // "Mine" means played by me (online, other humans play other countries).
  const isPlayer = me === id;
  const dataNote = useGame.getState().state.dataNote ?? MODERN_SCENARIO.dataNote;
  // Borders follow who owns what now (conquests, historical and custom worlds).
  const borders = landNeighbours(useGame.getState().state, provinceIds);
  // Growth rates are first calculated on the 1st of the next month.
  const started = state.history.gdp.length > 0;
  const topCities = provinceIds
    .flatMap((p) => citiesIn(p))
    .sort((a, b) => b.cap - a.cap || b.pop - a.pop)
    .slice(0, 5);

  return (
    <Shell label={`${c.name} details`}>
      <div className="panel__head">
        {flag ? <img className="panel__flag" src={flag} alt={`Flag of ${c.name}`} /> : <div className="panel__flag flag-placeholder" />}
        <div className="panel__titles">
          <h2>{c.name}</h2>
          {c.officialName && c.officialName !== c.name && <p className="panel__official">{c.officialName}</p>}
          <span className={`badge badge--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
          {isPlayer && <span className="badge badge--you">You</span>}
          <button className="link panel__less" onClick={() => useUi.getState().setDetails(false)}>
            Show less
          </button>
        </div>
        <CloseButton />
      </div>

      <div className="panel__actions">
        {state.active && !isPlayer && state.controller === "human" && (
          <p className="panel__note" data-testid="played-by">
            Played by {useOnline.getState().players.find((p) => p.country === id)?.name ?? "another player"}.
          </p>
        )}
        {state.active && !me && state.controller !== "human" && (
          <button className="btn btn--primary" onClick={() => send({ type: "claimCountry", country: id })}>
            Play as {c.name}
          </button>
        )}
        {state.active && me && !isPlayer && state.controller !== "human" && (
          <p className="panel__small" data-testid="locked-country">
            You lead {getCountry(me)?.name ?? me}. To lead another country, start a new game from the Game menu.
          </p>
        )}
        <button className="btn btn--ghost" onClick={() => select({ kind: "country", id }, { focus: true })}>
          Zoom to {c.name}
        </button>
      </div>

      {c.note && <p className="panel__note">{c.note}</p>}
      {state.capital && <SendHere province={state.capital} label={`${c.name}'s capital`} />}

      {isPlayer && <WarsSection me={id} />}
      {me && !isPlayer && state.active && <DiplomacySection me={me} them={id} />}

      {!state.active ? (
        <p className="panel__note">No permanent population or economy, so nothing is simulated here.</p>
      ) : (
        <>
          <section>
            <h3>Economy</h3>
            <div className="stats">
              <Stat label="Population" value={formatCompact(state.population)} sub={started ? `${formatPercent(state.popGrowth, 2, true)} / yr` : "growth from 1st of month"} />
              <Stat
                label="GDP"
                value={formatMoneyMillions(state.gdp)}
                sub={started ? `${formatPercent(state.gdpGrowth, 1, true)} / yr` : "growth from 1st of month"}
                subTone={started ? (state.gdpGrowth < 0 ? "neg" : "pos") : undefined}
              />
              <Stat label="GDP per person" value={perCapita ? `$${formatInt(perCapita)}` : null} />
              <Stat label="Treasury" value={formatMoneyMillions(state.treasury)} tone={state.treasury < 0 ? "neg" : undefined} sub={state.treasury < 0 ? "in debt" : undefined} />
            </div>
            <div className="trend">
              <div>
                <span className="trend__label">GDP, last {Math.max(1, Math.ceil(state.history.gdp.length / 12))} yr</span>
                <Sparkline values={state.history.gdp} label="GDP history" />
              </div>
              <div>
                <span className="trend__label">Population</span>
                <Sparkline values={state.history.population} label="Population history" />
              </div>
            </div>
            <Why title="Why is GDP growing at this rate?" parts={growthBreakdown(state, avgInfra).parts} format={(v) => formatPercent(v, 2, true)} labels={GROWTH_LABELS} />
          </section>

          <section>
            <h3>Stability</h3>
            <Meter value={state.stability} max={100} label={`${Math.round(state.stability)} / 100`} tone={state.stability < 35 ? "bad" : state.stability < 55 ? "mid" : "good"} />
            <Why
              title={`Heading towards ${Math.round(stabilityBreakdown(state).target)}. Why?`}
              parts={stabilityBreakdown(state).parts}
              format={(v) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0))}
              labels={STABILITY_LABELS}
            />
          </section>

          <section>
            <h3>Technology</h3>
            <Meter
              value={state.researchProgress}
              max={1}
              label={state.techLevel >= MAX_TECH ? `Level ${state.techLevel} (max)` : `Level ${state.techLevel} · ${Math.round(state.researchProgress * 100)}% to level ${state.techLevel + 1}`}
              tone="tech"
            />
            <p className="panel__small">
              {state.budget.research > 0
                ? `About ${((yearsPerTechLevel(state.techLevel) * 0.03) / state.budget.research).toFixed(1)} years per level at current research spending. Average infrastructure ${avgInfra.toFixed(1)} / ${MAX_INFRASTRUCTURE}.`
                : "No research spending: technology is not advancing."}
            </p>
          </section>

          <section>
            <h3>Resources</h3>
            <table className="res-table">
              <thead>
                <tr>
                  <th />
                  <th>Produces</th>
                  <th>Needs</th>
                  <th>Trade</th>
                </tr>
              </thead>
              <tbody>
                {RESOURCES.map((r) => {
                  const b = state.resources[r];
                  const short = supplied(b) < 0.999;
                  return (
                    <tr key={r}>
                      <th>{RESOURCE_LABEL[r]}</th>
                      <td>{formatCompact(b.production)}</td>
                      <td>{formatCompact(b.need)}</td>
                      <td className={short ? "neg" : b.exports > 0 ? "pos" : undefined}>
                        {short ? "Shortage" : b.exports > 0 ? `Exports ${formatCompact(b.exports)}` : b.imports > 0 ? `Imports ${formatCompact(b.imports)}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="panel__small">Resource deposits are game-generated, not real-world data. Updated monthly.</p>
          </section>

          {isPlayer ? <Policies country={state} /> : <PolicySummary country={state} />}
          {isPlayer && <MilitarySection country={id} />}
        </>
      )}

      <section>
        <h3>Overview</h3>
        <dl className="facts">
          <Fact label="Capital" value={c.capital.join(", ")} />
          <Fact label="Region" value={[c.subregion, c.region].filter(Boolean).join(", ")} />
          <Fact label="Area" value={c.areaKm2 ? `${formatInt(c.areaKm2)} km²` : null} />
          <Fact label="Provinces" value={formatInt(provinceIds.length)} />
          <Fact label="Income group" value={c.incomeGroup} />
          <Fact label="Languages" value={c.languages.join(", ")} />
          <Fact label="Currency" value={c.currencies.map((x) => `${x.name}${x.symbol ? ` (${x.symbol})` : ""}`).join(", ")} />
        </dl>
        <p className="panel__source">{dataNote} Everything after that is simulated by the game.</p>
      </section>

      {topCities.length > 0 && (
        <section>
          <h3>Largest cities (2019)</h3>
          <CityList cities={topCities} />
        </section>
      )}

      {borders.length > 0 && (
        <section>
          <h3>Land borders ({borders.length})</h3>
          <div className="chips">
            {borders.map((b) => {
              const n = getCountry(b);
              return n ? (
                <button key={b} className="chip" onClick={() => select({ kind: "country", id: b }, { focus: true })}>
                  {n.name}
                </button>
              ) : null;
            })}
          </div>
        </section>
      )}

      <NotYet />
    </Shell>
  );
}

export const GROWTH_LABELS: Record<string, string> = {
  base: "Catch-up potential",
  infrastructure: "Infrastructure vs technology",
  resources: "Resources and trade",
  taxes: "Tax burden",
  stability: "Stability",
  debt: "Debt",
};
export const STABILITY_LABELS: Record<string, string> = {
  base: "Baseline",
  welfare: "Welfare spending",
  taxes: "Tax burden",
  growth: "Economic growth",
  food: "Food shortage",
  debt: "Debt",
};

export function Why({ title, parts, format, labels }: { title: string; parts: Record<string, number>; format: (v: number) => string; labels: Record<string, string> }) {
  return (
    <details className="why">
      <summary>{title}</summary>
      <ul>
        {Object.entries(parts).map(([k, v]) => (
          <li key={k}>
            <span>{labels[k] ?? k}</span>
            <span className={v < 0 ? "neg" : v > 0 && k !== "base" ? "pos" : undefined}>{format(v)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The player's controls: tax rate and spending. */
export function Policies({ country }: { country: CountryState }) {
  const send = useGame((s) => s.send);
  const balance = budgetBalance(country);
  return (
    <section className="policies" aria-label="Policies">
      <h3>Your policies</h3>
      <PolicySlider
        label="Tax rate"
        help="Money raised each year, as a share of GDP. Above 25% slows growth; above 35% hurts stability."
        value={country.taxRate}
        min={TAX_RANGE[0]}
        max={TAX_RANGE[1]}
        step={0.01}
        onCommit={(value) => send({ type: "setTaxRate", country: country.id, value })}
      />
      <p className="policies__group">Spending (share of GDP per year)</p>
      {(Object.keys(BUDGET_LABEL) as BudgetCategory[]).map((cat) => (
        <PolicySlider
          key={cat}
          label={BUDGET_LABEL[cat].label}
          help={BUDGET_LABEL[cat].help}
          value={country.budget[cat]}
          min={BUDGET_RANGE[0]}
          max={BUDGET_RANGE[1]}
          step={0.005}
          onCommit={(value) => send({ type: "setBudget", country: country.id, category: cat, value })}
        />
      ))}
      <div className="balance">
        <span>Administration (fixed)</span>
        <span>{formatPercent(ADMIN_COST)}</span>
      </div>
      <div className={`balance balance--total ${balance < 0 ? "neg" : "pos"}`} data-testid="budget-balance">
        <span>{balance < 0 ? "Deficit" : "Surplus"} per year</span>
        <span>
          {formatPercent(Math.abs(balance))} of GDP · {formatMoneyMillions(Math.abs(balance) * country.gdp)}
        </span>
      </div>
      {balance < 0 && <p className="panel__small">Deficits add to debt. Debt costs 4% interest a year and lowers growth and stability.</p>}
    </section>
  );
}

export function PolicySummary({ country }: { country: CountryState }) {
  return (
    <section>
      <h3>Policies</h3>
      <dl className="facts">
        <Fact label="Tax rate" value={formatPercent(country.taxRate)} />
        {(Object.keys(BUDGET_LABEL) as BudgetCategory[]).map((cat) => (
          <Fact key={cat} label={BUDGET_LABEL[cat].label} value={`${formatPercent(country.budget[cat])} of GDP`} />
        ))}
      </dl>
      <p className="panel__small">Run by the computer: it adjusts taxes and spending when in debt, unrest or war.</p>
    </section>
  );
}

/** A slider that keeps its own value while dragging and follows the game state otherwise. */
export function PolicySlider({
  label,
  help,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  help: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setLocal(value);
  }, [value, editing]);
  const id = `policy-${label.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="slider">
      <label htmlFor={id}>
        <span>{label}</span>
        <span className="slider__value">{formatPercent(local)}</span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={local}
        title={help}
        aria-describedby={`${id}-help`}
        onPointerDown={() => setEditing(true)}
        onChange={(e) => {
          const v = Number(e.target.value);
          setLocal(v);
          onCommit(v);
        }}
        onPointerUp={() => setEditing(false)}
        onBlur={() => setEditing(false)}
      />
      <span id={`${id}-help`} className="slider__help">
        {help}
      </span>
    </div>
  );
}

function ProvinceView({ id }: { id: ProvinceId }) {
  const p = getProvince(id);
  const ps = useGame((s) => s.state.provinces[id]);
  const ownerState = useGame((s) => (ps ? s.state.countries[ps.owner] : undefined));
  const scale = useGame((s) => s.state.resourceScale);
  const owner = getCountry(ps?.owner);
  const select = useUi((s) => s.select);
  const me = useGame((s) => playerCountry(s.state)?.id);
  useUi((s) => s.fog); // re-render when fog is switched on or off
  const units = useGame((s) => fogOf(s.state).view.units);
  const full = useUi((s) => s.details);
  const setDetails = useUi((s) => s.setDetails);
  if (!p || !ps) return null;
  const here = new Map<CountryId, number>();
  for (const u of Object.values(units)) if (u.province === id) here.set(u.owner, (here.get(u.owner) ?? 0) + 1);
  const cities = citiesIn(id).slice(0, 8);
  const flag = owner ? flagUrl(owner) : null;
  const inhabited = ps.population > 0;

  return (
    <Shell label={`${p.name} details`}>
      <div className="panel__head">
        <div className="panel__titles">
          <p className="panel__eyebrow">{p.type ?? "Province"}</p>
          <h2>{p.name}</h2>
          {p.localName && <p className="panel__official">{p.localName}</p>}
        </div>
        <CloseButton />
      </div>

      {owner && (
        <button className="owner-card" onClick={() => select({ kind: "country", id: owner.id })}>
          {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
          <span>
            <span className="owner-card__label">Part of</span>
            <span className="owner-card__name">{owner.name}</span>
          </span>
          <span className="owner-card__arrow" aria-hidden>
            ›
          </span>
        </button>
      )}

      <ProvinceWarStatus province={id} />
      <SendHere province={id} label={p.name} />

      <div className="panel__actions">
        <button className="btn btn--ghost" onClick={() => select({ kind: "province", id }, { focus: true })}>
          Zoom to {p.name}
        </button>
      </div>

      {here.size > 0 && (
        <section>
          <h3>Forces here</h3>
          <div className="chips">
            {[...here].map(([owner, n]) => (
              <button key={owner} className="chip" onClick={() => select({ kind: "units", province: id, owner })}>
                {getCountry(owner)?.name ?? owner}: {n} unit{n > 1 ? "s" : ""}
              </button>
            ))}
          </div>
        </section>
      )}

      {full && me && ps.owner === me && ps.controller === me && <RecruitButtons country={me} province={id} label="Recruit here" />}

      {!full && (
        <button className="link" onClick={() => setDetails(true)}>
          Show all details
        </button>
      )}

      {full && inhabited && (
        <section>
          <h3>Province</h3>
          <div className="stats">
            <Stat label="Population" value={formatCompact(ps.population)} sub="estimated at start" />
            <Stat label="Density" value={`${formatInt(ps.population / Math.max(ps.areaKm2, 1))}/km²`} />
          </div>
          <Meter value={ps.infrastructure} max={MAX_INFRASTRUCTURE} label={`Infrastructure ${ps.infrastructure.toFixed(1)} / ${MAX_INFRASTRUCTURE}`} tone="good" />
        </section>
      )}

      {full && inhabited && ownerState && (
        <section>
          <h3>Resources</h3>
          <table className="res-table">
            <thead>
              <tr>
                <th />
                <th>Deposit</th>
                <th>Output / month</th>
              </tr>
            </thead>
            <tbody>
              {RESOURCES.map((r) => (
                <tr key={r}>
                  <th>{RESOURCE_LABEL[r]}</th>
                  <td>
                    <Pips n={ps.deposits[r]} />
                  </td>
                  <td>{formatCompact(rawProduction(ps, ownerState.techLevel, r) * scale[r])}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="panel__small">Deposits are game-generated, not real-world data. Output rises with infrastructure and technology.</p>
        </section>
      )}

      {full && <section>
        <h3>Overview</h3>
        <dl className="facts">
          <Fact label="Area" value={`${formatInt(p.areaKm2)} km²`} />
          <Fact label="ISO code" value={p.iso} />
          <Fact label="Cities on map" value={formatInt(p.cityCount)} />
        </dl>
      </section>}

      {cities.length > 0 && (
        <section>
          <h3>Cities (2019)</h3>
          <CityList cities={cities} />
        </section>
      )}

      {full && <NotYet province />}
    </Shell>
  );
}

function Pips({ n }: { n: number }) {
  return (
    <span className="pips" aria-label={`${n} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <span key={i} className={i <= n ? "pip is-on" : "pip"} />
      ))}
    </span>
  );
}

export function Meter({ value, max, label, tone }: { value: number; max: number; label: string; tone: "good" | "mid" | "bad" | "tech" }) {
  return (
    <div className={`meter meter--${tone}`}>
      <div className="meter__bar">
        <div className="meter__fill" style={{ width: `${Math.max(0, Math.min(1, value / max)) * 100}%` }} />
      </div>
      <span className="meter__label">{label}</span>
    </div>
  );
}

function CityList({ cities }: { cities: ReturnType<typeof citiesIn> }) {
  const command = useUi((s) => s.command);
  const select = useUi((s) => s.select);
  return (
    <ul className="city-list">
      {cities.map((c) => (
        <li key={`${c.name}${c.lon}`}>
          <button
            onClick={() => {
              select({ kind: "province", id: c.prov });
              command({ kind: "point", lon: c.lon, lat: c.lat, zoom: 14 });
            }}
          >
            <span className={c.cap ? "city-dot city-dot--cap" : "city-dot"} aria-hidden />
            <span className="city-list__name">
              {c.name}
              {c.cap ? <span className="city-list__cap"> capital</span> : null}
            </span>
            <span className="city-list__pop">{c.pop > 0 ? formatCompact(c.pop) : "—"}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function NotYet({ province = false }: { province?: boolean }) {
  return (
    <section className="panel__future">
      <h3>Not in the game yet</h3>
      <p>
        {province
          ? "Buildings and a separate local economy aren't in the game yet."
          : "Government types, trade agreements and naval battles aren't in the game yet."}
      </p>
    </section>
  );
}

export function Stat({ label, value, sub, tone, subTone }: { label: string; value: string | null; sub?: string; tone?: "neg"; subTone?: "neg" | "pos" }) {
  return (
    <div className="stat">
      <div className={value ? `stat__value ${tone ?? ""}` : "stat__value muted"}>{value ?? "No data"}</div>
      <div className="stat__label">
        {label}
        {sub && <span className={`stat__sub ${subTone ?? ""}`}> · {sub}</span>}
      </div>
    </div>
  );
}

export function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value ? undefined : "muted"}>{value || "—"}</dd>
    </>
  );
}
