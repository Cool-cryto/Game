import type { ReactNode } from "react";
import { RESOURCES, type CountryId, type ProvinceId } from "@gs/shared";
import {
  ADMIN_COST,
  BUDGET_CATEGORIES,
  BUDGET_RANGE,
  canRecruit,
  debtRatio,
  growthBreakdown,
  weightedLevel,
  interestRate,
  governmentLabel,
  isAtWar,
  MAX_INFRASTRUCTURE,
  recruitCost,
  stabilityBreakdown,
  supplied,
  UNIT_STATS,
  unitCap,
  upkeepPerYear,
  type CountryState,
  type UnitType,
} from "@gs/sim";
import { flagUrl, GEOGRAPHY, getCountry, getProvince, landNeighbours } from "../../data/countries";
import { gdpPerCapita } from "../../map/mapModes";
import { useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { formatCompact, formatInt, formatMoneyMillions, formatPercent } from "../format";
import { BUDGET_LABEL, GROWTH_LABELS, Meter, Policies, PolicySlider, RESOURCE_LABEL, STABILITY_LABELS, Why } from "../InfoPanel";
import { unitStatus } from "../MilitaryPanel";
import { economyRank, plainReason, recruitProvince } from "../simple/SimpleHud";
import { currentFocus, currentTaxLevel, FOCUSES, policyCommands, TAX_LEVELS } from "../simple/focus";
import { Sparkline } from "../Sparkline";
import { Card, NeedCountry, Planned, Rows, ScreenFrame } from "./Screen";

const money = formatMoneyMillions;
const pct = (v: number, d = 1, signed = false) => formatPercent(v, d, signed);

/** Average infrastructure of a country's provinces, weighted by population. */
export function useAvgInfrastructure(id: CountryId | undefined) {
  return useGame((s) => {
    if (!id) return 0;
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
}

/** Money in and out per year, in millions. */
export function yearlyBudget(c: CountryState) {
  const income = c.taxRate * c.gdp;
  const spending = BUDGET_CATEGORIES.reduce((a, k) => a + c.budget[k], 0) * c.gdp;
  const admin = ADMIN_COST * c.gdp;
  const interest = c.treasury < 0 ? -c.treasury * interestRate(c) : 0;
  return { income, spending, admin, interest, balance: income - spending - admin - interest };
}

// ============ Country ============

export function CountryScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="country"
          title={getCountry(c.id)?.name ?? c.id}
          subtitle="Your country at a glance"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "provinces", label: "Provinces", hint: "Every province you own" },
            { id: "history", label: "History", hint: "How your economy and population have changed" },
          ]}
        >
          {(tab) => (tab === "overview" ? <CountryOverview c={c} /> : tab === "provinces" ? <ProvinceList c={c} sort="population" /> : <CountryHistory c={c} />)}
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

function CountryOverview({ c }: { c: CountryState }) {
  const info = getCountry(c.id)!;
  const rank = useGame((s) => economyRank(s.state, c.id));
  const provinces = useGame((s) => s.provincesOf.get(c.id)) ?? [];
  const state = useGame((s) => s.state);
  const borders = landNeighbours(state, provinces);
  const war = useGame((s) => isAtWar(s.state, c.id));
  const select = useUi((s) => s.select);
  const setScreen = useUi((s) => s.setScreen);
  const flag = flagUrl(info);
  const perPerson = gdpPerCapita(c);
  return (
    <div className="grid">
      <Card title="Nation">
        <div className="nation">
          {flag ? <img src={flag} alt={`Flag of ${info.name}`} /> : <span className="flag-placeholder" />}
          <div>
            <strong>{info.officialName || info.name}</strong>
            <p className="screen__note">
              {[info.subregion, info.region].filter(Boolean).join(", ")}
              {war && <span className="player__war">At war</span>}
            </p>
          </div>
        </div>
        <Rows
          rows={[
            ["Capital", c.capital ? (getProvince(c.capital)?.name ?? info.capital.join(", ")) : "None"],
            ["Provinces", formatInt(provinces.length)],
            ["Languages", info.languages.slice(0, 3).join(", ") || "—"],
            ["Currency", info.currencies.map((x) => x.name).join(", ") || "—"],
          ]}
        />
      </Card>
      <Card title="Key figures">
        <Rows
          rows={[
            ["Population", formatCompact(c.population)],
            ["Economy (GDP)", `${money(c.gdp)} / yr`],
            ["World rank", `#${rank}`, "Your economy's size compared with every other country"],
            ["GDP per person", perPerson ? `$${formatInt(perPerson)}` : "—"],
            ["Treasury", <span className={c.treasury < 0 ? "neg" : undefined}>{money(c.treasury)}</span>],
            ["Stability", `${Math.round(c.stability)} / 100`],
            ["Technology", `Level ${c.techLevel}`],
            ["Government", governmentLabel(c.government)],
          ]}
        />
      </Card>
      <Card title={`Neighbours (${borders.length})`} wide>
        {borders.length ? (
          <div className="chips">
            {borders.map((b) => (
              <button key={b} className="chip" onClick={() => select({ kind: "country", id: b }, { focus: true })}>
                {getCountry(b)?.name ?? b}
              </button>
            ))}
          </div>
        ) : (
          <p className="screen__note">No land neighbours.</p>
        )}
        <button className="link" onClick={() => setScreen("diplomacy")}>
          Relations with them: Diplomacy ›
        </button>
      </Card>
    </div>
  );
}

/** Your provinces as a table; click one to see it on the map. */
export function ProvinceList({ c, sort }: { c: CountryState; sort: "population" | "infrastructure" }) {
  // Select stable pieces of the store and build the list here (a new list per check would re-render forever).
  const ids = useGame((s) => s.provincesOf.get(c.id));
  const all = useGame((s) => s.state.provinces);
  const provinces = (ids ?? []).map((id) => all[id]!).filter(Boolean);
  const select = useUi((s) => s.select);
  const rows = [...provinces].sort((a, b) => (sort === "population" ? b.population - a.population : b.infrastructure - a.infrastructure));
  return (
    <table className="table" data-testid="province-table">
      <thead>
        <tr>
          <th>Province</th>
          <th className="num">Population</th>
          <th title="Roads, power and services, 0 to 10">Infrastructure</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.id} className="table__click" onClick={() => select({ kind: "province", id: p.id }, { focus: true })} title="Show on the map">
            <td>
              {getProvince(p.id)?.name ?? p.id}
              {c.capital === p.id && <span className="tag">Capital</span>}
            </td>
            <td className="num">{formatCompact(p.population)}</td>
            <td>
              <span className="mini-bar">
                <span style={{ width: `${(p.infrastructure / MAX_INFRASTRUCTURE) * 100}%` }} />
              </span>
              {p.infrastructure.toFixed(1)}
            </td>
            <td className={p.controller !== c.id ? "neg" : undefined}>{p.controller !== c.id ? `Occupied by ${getCountry(p.controller)?.name ?? p.controller}` : p.siege ? "Under siege" : "Held"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CountryHistory({ c }: { c: CountryState }) {
  const years = Math.max(1, Math.ceil(c.history.gdp.length / 12));
  return (
    <div className="grid">
      <Card title={`Economy (GDP), last ${years} yr`}>
        {c.history.gdp.length > 1 ? <Sparkline values={c.history.gdp} label="GDP history" /> : <p className="screen__note">History starts after the first month. Press Play.</p>}
        <Rows rows={[["Now", `${money(c.gdp)} / yr`], ["Growth", c.history.gdp.length ? pct(c.gdpGrowth, 1, true) + " / yr" : "—"]]} />
      </Card>
      <Card title="Population">
        {c.history.population.length > 1 ? <Sparkline values={c.history.population} label="Population history" /> : <p className="screen__note">History starts after the first month.</p>}
        <Rows rows={[["Now", formatCompact(c.population)], ["Growth", c.history.population.length ? pct(c.popGrowth, 2, true) + " / yr" : "—"]]} />
      </Card>
    </div>
  );
}

// ============ Economy ============

export function EconomyScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="economy"
          title="Economy"
          subtitle="Money in, money out, and what you produce"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "budget", label: "Budget & taxes", hint: "Pick a focus and a tax level" },
            { id: "trade", label: "Resources & trade", hint: "Food, energy and minerals" },
            { id: "debt", label: "Debt" },
            { id: "detailed", label: "Detailed budget", hint: "Exact tax and spending sliders" },
          ]}
        >
          {(tab) =>
            tab === "overview" ? <EconomyOverview c={c} /> : tab === "budget" ? <BudgetChoices c={c} /> : tab === "trade" ? <Trade c={c} /> : tab === "debt" ? <Debt c={c} /> : <Policies country={c} />
          }
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

function EconomyOverview({ c }: { c: CountryState }) {
  const infra = useAvgInfrastructure(c.id);
  const state = useGame((s) => s.state);
  const factories = weightedLevel(state, c.id, "factory");
  const b = yearlyBudget(c);
  const started = c.history.gdp.length > 0;
  return (
    <div className="grid">
      <Card title="Treasury" hint="Money in the bank. Negative means debt, which costs interest (4% a year; 3% with Global finance).">
        <p className={`big-number ${c.treasury < 0 ? "neg" : ""}`}>{money(c.treasury)}</p>
        <Rows
          rows={[
            ["Economy (GDP)", `${money(c.gdp)} / yr`],
            ["Growth", started ? <span className={c.gdpGrowth < 0 ? "neg" : "pos"}>{pct(c.gdpGrowth, 1, true)} / yr</span> : "From the 1st of next month"],
            ["GDP per person", gdpPerCapita(c) ? `$${formatInt(gdpPerCapita(c)!)}` : "—"],
          ]}
        />
      </Card>
      <Card title="Income and expenses (per year)" hint="Taxes bring money in; spending and running the state take it out.">
        <Rows
          rows={[
            ["Tax income", <span className="pos">+{money(b.income)}</span>, `Tax rate ${pct(c.taxRate, 0)} of GDP`],
            ["Spending", <span className="neg">−{money(b.spending)}</span>, "Infrastructure, research, welfare and defense"],
            ["Running the state", <span className="neg">−{money(b.admin)}</span>, `Fixed at ${pct(ADMIN_COST, 0)} of GDP`],
            ...(b.interest > 0 ? ([["Interest on debt", <span className="neg">−{money(b.interest)}</span>]] as [string, ReactNode][]) : []),
            [
              "Balance",
              Math.abs(b.balance) < 0.5 ? (
                <strong>Balanced</strong>
              ) : (
                <strong className={b.balance < 0 ? "neg" : "pos"}>
                  {b.balance < 0 ? "−" : "+"}
                  {money(Math.abs(b.balance))}
                </strong>
              ),
            ],
          ]}
        />
      </Card>
      <Card title="Why is the economy growing at this rate?" wide>
        <Why title="Show the breakdown" parts={growthBreakdown(c, infra, factories).parts} format={(v) => pct(v, 2, true)} labels={GROWTH_LABELS} />
      </Card>
    </div>
  );
}

/** Tax level and national focus: the simple way to set the budget (always balanced). */
export function BudgetChoices({ c }: { c: CountryState }) {
  const send = useGame((s) => s.send);
  const focus = currentFocus(c);
  const tax = currentTaxLevel(c);
  const apply = (taxRate: number, focusId: string) => policyCommands(c.id, taxRate, focusId).forEach((cmd) => send(cmd));
  return (
    <div className="grid">
      <Card title="National focus" hint="Decides how your tax money is spent. Your budget is always balanced, so you won't go into debt." wide>
        <div className="choices choices--4">
          {FOCUSES.map((f) => (
            <button key={f.id} className={`choice ${focus === f.id ? "is-active" : ""}`} aria-pressed={focus === f.id} onClick={() => apply(c.taxRate, f.id)}>
              <span className="choice__label">{f.label}</span>
              <span className="choice__help">{f.help}</span>
            </button>
          ))}
        </div>
        {focus === null && <p className="screen__note">Custom spending (set in Detailed budget). Pick a focus to go back to a balanced budget.</p>}
      </Card>
      <Card title="Taxes" hint="Higher taxes give more money but slow growth; very high taxes cause unrest.">
        <div className="segmented" role="radiogroup" aria-label="Taxes">
          {TAX_LEVELS.map((t) => (
            <button key={t.id} role="radio" aria-checked={tax === t.id} className={tax === t.id ? "is-active" : ""} title={t.help} onClick={() => apply(t.rate, focus ?? "balanced")}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="screen__note">{TAX_LEVELS.find((t) => t.id === tax)?.help}</p>
      </Card>
      <Card title="Where the money goes (per year)">
        <Rows rows={BUDGET_CATEGORIES.map((k) => [BUDGET_LABEL[k].label, `${money(c.budget[k] * c.gdp)} · ${pct(c.budget[k])} of GDP`, BUDGET_LABEL[k].help])} />
      </Card>
    </div>
  );
}

function Trade({ c }: { c: CountryState }) {
  return (
    <div className="grid">
      <Card title="Resources this month" hint="What your provinces produce against what your people and economy need. Shortfalls are bought on the world market; surpluses are sold." wide>
        <table className="table">
          <thead>
            <tr>
              <th />
              <th className="num">Produce</th>
              <th className="num">Need</th>
              <th className="num">Supplied</th>
              <th>Trade</th>
            </tr>
          </thead>
          <tbody>
            {RESOURCES.map((r) => {
              const b = c.resources[r];
              const sup = supplied(b);
              return (
                <tr key={r}>
                  <th>{RESOURCE_LABEL[r]}</th>
                  <td className="num">{formatCompact(b.production)}</td>
                  <td className="num">{formatCompact(b.need)}</td>
                  <td className={`num ${sup < 0.999 ? "neg" : ""}`}>{pct(sup, 0)}</td>
                  <td className={sup < 0.999 ? "neg" : b.exports > 0 ? "pos" : undefined}>
                    {sup < 0.999 ? "Shortage" : b.exports > 0 ? `Exports ${formatCompact(b.exports)}` : b.imports > 0 ? `Imports ${formatCompact(b.imports)}` : "Self-sufficient"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="screen__note">Food shortages hurt stability; energy and mineral shortages slow growth. Resource deposits are game-generated, not real-world data.</p>
      </Card>
      <Planned title="Trade agreements" items={["Trade deals with other countries", "Sanctions and embargoes", "Deals for specific resources"]} note="Today all trade happens automatically on one world market." />
    </div>
  );
}

function Debt({ c }: { c: CountryState }) {
  const infra = useAvgInfrastructure(c.id);
  const ratio = debtRatio(c);
  const growthHit = growthBreakdown(c, infra).parts.debt ?? 0;
  const stabilityHit = stabilityBreakdown(c).parts.debt ?? 0;
  if (c.treasury >= 0)
    return (
      <div className="grid">
        <Card title="No debt">
          <p className="screen__note">Your treasury is positive ({money(c.treasury)}). Spending more than you raise in taxes would create debt.</p>
        </Card>
      </div>
    );
  return (
    <div className="grid">
      <Card title="National debt" hint="Debt grows when spending is higher than income.">
        <p className="big-number neg">{money(-c.treasury)}</p>
        <Rows
          rows={[
            ["Debt / GDP", pct(ratio, 0)],
            ["Interest", `${money(-c.treasury * interestRate(c))} / yr (${Math.round(interestRate(c) * 100)}%)`],
            ["Effect on growth", <span className="neg">{pct(growthHit, 2, true)} / yr</span>],
            ["Effect on stability", <span className="neg">{stabilityHit.toFixed(0)}</span>],
          ]}
        />
      </Card>
      <Card title="Paying it down">
        <p className="screen__note">Raise taxes or pick a focus in Budget & taxes: those choices always balance the budget, and a surplus from Detailed budget repays debt.</p>
      </Card>
    </div>
  );
}

// ============ Military ============

const TYPES: { type: UnitType; label: string; help: string }[] = [
  { type: "army", label: "Army", help: "Fights on land and captures provinces." },
  { type: "navy", label: "Fleet", help: "Carries armies across the sea." },
  { type: "air", label: "Air force", help: "Supports nearby battles." },
];

export function MilitaryScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="military"
          title="Military"
          subtitle="Your armed forces"
          tabs={[
            { id: "overview", label: "Overview" },
            { id: "forces", label: "Forces", hint: "Where your units are and what they're doing" },
            { id: "recruit", label: "Recruit" },
            { id: "budget", label: "Military budget" },
            { id: "equipment", label: "Equipment" },
          ]}
        >
          {(tab) =>
            tab === "overview" ? (
              <MilitaryOverview c={c} />
            ) : tab === "forces" ? (
              <Forces c={c} />
            ) : tab === "recruit" ? (
              <Recruit c={c} />
            ) : tab === "budget" ? (
              <MilitaryBudget c={c} />
            ) : (
              <Planned title="Equipment" items={["Rifles, tanks, ships and aircraft as stockpiles", "Factories that produce equipment", "Units that need equipment to reach full strength"]} note="Today a unit's power comes from its strength and your technology level." />
            )
          }
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

function useMyUnits(id: CountryId) {
  const units = useGame((s) => s.state.units);
  return Object.values(units).filter((u) => u.owner === id);
}

function MilitaryOverview({ c }: { c: CountryState }) {
  const units = useMyUnits(c.id);
  const count = (t: UnitType) => units.filter((u) => u.type === t).length;
  const upkeep = units.reduce((a, u) => a + upkeepPerYear(c, u.type), 0);
  const strength = units.length ? units.reduce((a, u) => a + u.strength, 0) / units.length : 0;
  return (
    <div className="grid">
      <Card title="Forces">
        <Rows
          rows={[
            ["Armies", String(count("army"))],
            ["Fleets", String(count("navy"))],
            ["Air forces", String(count("air"))],
            ["Total / limit", `${units.length} / ${unitCap(c)}`, "Your population decides how many units you can support"],
            ["Average strength", units.length ? `${Math.round(strength)}%` : "—", "Units lose strength in battle and regain it at home"],
          ]}
        />
      </Card>
      <Card title="Military money" hint="Defense spending fills the military fund each month. It pays for recruiting and upkeep.">
        <p className={`big-number ${c.defenseFund < 0 ? "neg" : ""}`}>{money(c.defenseFund)}</p>
        <Rows
          rows={[
            ["Added per year", money(c.budget.defense * c.gdp)],
            ["Upkeep per year", money(upkeep)],
          ]}
        />
        {upkeep > c.budget.defense * c.gdp && <p className="screen__note neg">Upkeep is higher than defense spending: the fund will run down, then units lose strength.</p>}
      </Card>
    </div>
  );
}

function Forces({ c }: { c: CountryState }) {
  const state = useGame((s) => s.state);
  const select = useUi((s) => s.select);
  const units = useMyUnits(c.id);
  const stacks = new Map<ProvinceId, typeof units>();
  for (const u of units) stacks.set(u.province, [...(stacks.get(u.province) ?? []), u]);
  if (!units.length) return <p className="screen__note">No units. Recruit some in the Recruit tab.</p>;
  return (
    <table className="table" data-testid="forces-table">
      <thead>
        <tr>
          <th>Where</th>
          <th>Units</th>
          <th className="num">Strength</th>
          <th>Doing</th>
        </tr>
      </thead>
      <tbody>
        {[...stacks].map(([p, list]) => (
          <tr key={p} className="table__click" onClick={() => select({ kind: "units", province: p, owner: c.id }, { focus: true })} title="Select on the map to give orders">
            <td>{getProvince(p)?.name ?? p}</td>
            <td>
              {TYPES.filter((t) => list.some((u) => u.type === t.type))
                .map((t) => `${list.filter((u) => u.type === t.type).length} ${UNIT_STATS[t.type].label.toLowerCase()}`)
                .join(", ")}
            </td>
            <td className="num">{Math.round(list.reduce((a, u) => a + u.strength, 0) / list.length)}%</td>
            <td>{unitStatus(state, list[0]!)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Recruit({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  return (
    <div className="grid">
      <Card title="Recruit new units" hint="Armies and air forces are raised at your capital; fleets at your largest port." wide>
        <div className="choices choices--3">
          {TYPES.map((t) => {
            const at = recruitProvince(s, c.id, t.type);
            const raw = at ? canRecruit(s, GEOGRAPHY, c.id, t.type, at) : t.type === "navy" ? "You have no port to build a fleet in." : "You don't hold your capital right now.";
            const reason = raw ? plainReason(raw, t.type) : null;
            return (
              <button key={t.type} className="choice" disabled={!!reason} title={reason ?? t.help} onClick={() => at && send({ type: "recruit", country: c.id, unitType: t.type, province: at })}>
                <span className="choice__label">{t.label}</span>
                <span className="choice__help">{reason ?? `${t.help} Raised in ${getProvince(at!)?.name ?? "your capital"}.`}</span>
                <span className="choice__cost">{money(recruitCost(c, t.type))}</span>
              </button>
            );
          })}
        </div>
        <p className="screen__note">Military money: {money(c.defenseFund)}. Starting forces are estimates sized from defense budgets, not real-world militaries.</p>
      </Card>
    </div>
  );
}

function MilitaryBudget({ c }: { c: CountryState }) {
  const send = useGame((s) => s.send);
  return (
    <div className="grid">
      <Card title="Defense spending" hint="Share of your economy spent on the military each year." wide>
        <PolicySlider
          label="Defense"
          help={BUDGET_LABEL.defense.help}
          value={c.budget.defense}
          min={BUDGET_RANGE[0]}
          max={BUDGET_RANGE[1]}
          step={0.005}
          onCommit={(value) => send({ type: "setBudget", country: c.id, category: "defense", value })}
        />
        <p className="screen__note">
          {money(c.budget.defense * c.gdp)} per year. Raising it without raising taxes creates a deficit; the "Build the army" focus in Economy balances it for you.
        </p>
      </Card>
    </div>
  );
}

// ============ Shared: stability (used by Government) ============

export function StabilityCard({ c }: { c: CountryState }) {
  const war = useGame((s) => isAtWar(s.state, c.id));
  const b = stabilityBreakdown(c, war);
  return (
    <Card title="Stability" hint="How content and orderly your country is. Low stability slows growth.">
      <Meter value={c.stability} max={100} label={`${Math.round(c.stability)} / 100`} tone={c.stability < 35 ? "bad" : c.stability < 55 ? "mid" : "good"} />
      <Why title={`Heading towards ${Math.round(b.target)}. Why?`} parts={b.parts} format={(v) => (v > 0 ? `+${v.toFixed(0)}` : v.toFixed(0))} labels={STABILITY_LABELS} />
    </Card>
  );
}

