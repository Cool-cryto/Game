import { useState } from "react";
import type { CountryId } from "@gs/shared";
import {
  alliesOf,
  dateAt,
  isAtWar,
  MAX_INFRASTRUCTURE,
  relation,
  relationLabel,
  sideOf,
  visibleProvinces,
  BUDGET_RANGE,
  type CountryState,
  type GameEvent,
} from "@gs/sim";
import { flagUrl, GEOGRAPHY, getCountry, landNeighbours } from "../../data/countries";
import { gdpPerCapita } from "../../map/mapModes";
import { playerCountry, useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { formatCompact, formatDate, formatInt, formatMoneyMillions, formatPercent } from "../format";
import { BUDGET_LABEL, Meter, PolicySlider } from "../InfoPanel";
import { Relations, SimpleWar } from "../simple/SimpleHud";
import { Sparkline } from "../Sparkline";
import { ProvinceList, useAvgInfrastructure } from "./CoreScreens";
import { Card, NeedCountry, Planned, Rows, ScreenFrame } from "./Screen";

const money = formatMoneyMillions;
const nameOf = (id: CountryId) => getCountry(id)?.name ?? id;

// ============ Diplomacy ============

export function DiplomacyScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="diplomacy"
          title="Diplomacy"
          subtitle="Friends, enemies, war and peace"
          tabs={[
            { id: "relations", label: "Relations" },
            { id: "wars", label: "Wars & peace" },
            { id: "alliances", label: "Alliances" },
            { id: "treaties", label: "Treaties & organizations" },
          ]}
        >
          {(tab) =>
            tab === "relations" ? (
              <RelationsTab me={c.id} />
            ) : tab === "wars" ? (
              <WarsTab me={c.id} />
            ) : tab === "alliances" ? (
              <AlliancesTab me={c.id} />
            ) : (
              <Planned
                title="Treaties and international organizations"
                items={["Non-aggression pacts and military access", "Trade and research agreements", "International organizations you can join or found", "Guarantees of independence"]}
                note="Today diplomacy covers relations, defensive alliances, war and peace."
              />
            )
          }
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

function RelationsTab({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const provinces = useGame((x) => x.provincesOf.get(me)) ?? [];
  const [query, setQuery] = useState("");
  const neighbours = new Set(landNeighbours(s, provinces));
  const q = query.trim().toLowerCase();
  const list = Object.values(s.countries)
    .filter((c) => c.active && c.id !== me)
    .filter((c) => (q ? nameOf(c.id).toLowerCase().includes(q) : neighbours.has(c.id) || alliesOf(s, me).includes(c.id) || relation(s, me, c.id) !== 0))
    .sort((a, b) => Number(neighbours.has(b.id)) - Number(neighbours.has(a.id)) || relation(s, me, b.id) - relation(s, me, a.id))
    .slice(0, 40);
  return (
    <>
      <input className="input screen__search" placeholder="Find a country…" aria-label="Find a country" value={query} onChange={(e) => setQuery(e.target.value)} />
      <p className="screen__note">{q ? `Countries matching "${query}".` : "Your neighbours, allies and every country you've dealt with. Search to find any other."}</p>
      <div className="list">
        {list.map((c) => (
          <Relations key={c.id} me={me} them={c.id} compact />
        ))}
        {!list.length && <p className="screen__note">No countries found.</p>}
      </div>
    </>
  );
}

function WarsTab({ me }: { me: CountryId }) {
  const allWars = useGame((s) => s.state.wars);
  const wars = allWars.filter((w) => sideOf(w, me));
  if (!wars.length) return <p className="screen__note">You're at peace. To go to war, pick a country in Relations.</p>;
  return (
    <div className="list">
      {wars.map((w) => (
        <SimpleWar key={w.id} war={w} me={me} />
      ))}
    </div>
  );
}

function AlliancesTab({ me }: { me: CountryId }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const allies = alliesOf(s, me);
  return (
    <div className="grid">
      <Card title={`Your allies (${allies.length})`} hint="Allies come to each other's defence when attacked." wide>
        {allies.length ? (
          <table className="table">
            <tbody>
              {allies.map((a) => (
                <tr key={a}>
                  <td>{nameOf(a)}</td>
                  <td>{relationLabel(relation(s, me, a))}</td>
                  <td className="num">
                    <button className="btn btn--ghost btn--small" onClick={() => send({ type: "breakAlliance", country: me, target: a })}>
                      Break alliance
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="screen__note">No allies yet. Improve relations with a country in Relations, then propose an alliance.</p>
        )}
      </Card>
    </div>
  );
}

/** One budget category as a slider, with what it costs. */
function SpendingSlider({ c, category, note }: { c: CountryState; category: "research" | "infrastructure"; note: string }) {
  const send = useGame((s) => s.send);
  return (
    <div className="grid">
      <Card title={`${BUDGET_LABEL[category].label} spending`} hint={BUDGET_LABEL[category].help} wide>
        <PolicySlider
          label={BUDGET_LABEL[category].label}
          help={BUDGET_LABEL[category].help}
          value={c.budget[category]}
          min={BUDGET_RANGE[0]}
          max={BUDGET_RANGE[1]}
          step={0.005}
          onCommit={(value) => send({ type: "setBudget", country: c.id, category, value })}
        />
        <p className="screen__note">
          {money(c.budget[category] * c.gdp)} per year. {note} Spending more without raising taxes creates a deficit.
        </p>
      </Card>
    </div>
  );
}

// ============ Construction ============

export function ConstructionScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="construction"
          title="Construction"
          subtitle="Infrastructure across your provinces"
          tabs={[
            { id: "infrastructure", label: "Infrastructure" },
            { id: "provinces", label: "By province" },
            { id: "buildings", label: "Buildings" },
          ]}
        >
          {(tab) =>
            tab === "infrastructure" ? (
              <InfraTab c={c} />
            ) : tab === "provinces" ? (
              <ProvinceList c={c} sort="infrastructure" />
            ) : (
              <Planned title="Buildings" items={["Factories", "Railways and roads between provinces", "Ports and airports", "Fortifications"]} note="Today each province has one infrastructure level, built up by infrastructure spending." />
            )
          }
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

function InfraTab({ c }: { c: CountryState }) {
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
      </div>
      <SpendingSlider c={c} category="infrastructure" note="About 4% of GDP keeps infrastructure growing; it rises fastest where it is lowest." />
    </>
  );
}

// ============ Statistics ============

const RANKINGS: { id: string; label: string; value: (c: CountryState) => number; format: (v: number) => string; hint?: string }[] = [
  { id: "gdp", label: "Economy (GDP)", value: (c) => c.gdp, format: (v) => `${money(v)} / yr` },
  { id: "population", label: "Population", value: (c) => c.population, format: formatCompact },
  { id: "perperson", label: "GDP per person", value: (c) => gdpPerCapita(c) ?? 0, format: (v) => `$${formatInt(v)}` },
  { id: "military", label: "Military spending", value: (c) => c.budget.defense * c.gdp, format: (v) => `${money(v)} / yr`, hint: "Defense budget per year (armies themselves are hidden by fog of war)" },
  { id: "technology", label: "Technology", value: (c) => c.techLevel + c.researchProgress, format: (v) => `Level ${Math.floor(v)}` },
];

export function StatisticsScreen() {
  return (
    <ScreenFrame
      id="statistics"
      title="Statistics"
      subtitle="How the world's countries compare"
      tabs={[...RANKINGS.map((r) => ({ id: r.id, label: r.label, hint: r.hint })), { id: "charts", label: "Your charts" }]}
    >
      {(tab) => (tab === "charts" ? <Charts /> : <Ranking id={tab} />)}
    </ScreenFrame>
  );
}

function Ranking({ id }: { id: string }) {
  const r = RANKINGS.find((x) => x.id === id)!;
  const s = useGame((x) => x.state);
  const me = playerCountry(s)?.id;
  const select = useUi((x) => x.select);
  const all = Object.values(s.countries).filter((c) => c.active).sort((a, b) => r.value(b) - r.value(a));
  const total = all.reduce((a, c) => a + r.value(c), 0);
  const myIndex = me ? all.findIndex((c) => c.id === me) : -1;
  const shown = all.slice(0, 25);
  const top = r.value(all[0]!) || 1;
  return (
    <>
      {myIndex >= 0 && (
        <p className="screen__note">
          You are <strong>#{myIndex + 1}</strong> of {all.length}
          {r.id !== "perperson" && r.id !== "technology" && total > 0 ? `, with ${formatPercent(r.value(all[myIndex]!) / total, 1)} of the world total` : ""}.
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
                    {info?.name ?? c.id}
                  </span>
                </td>
                <td className="bar-cell">
                  <span className="mini-bar mini-bar--wide">
                    <span style={{ width: `${(r.value(c) / top) * 100}%` }} />
                  </span>
                </td>
                <td className="num">{r.format(r.value(c))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Charts() {
  const me = useGame((s) => playerCountry(s.state));
  if (!me) return <p className="screen__note">Choose a country to see its charts.</p>;
  return (
    <div className="grid">
      <Card title="Economy (GDP)">{me.history.gdp.length > 1 ? <Sparkline values={me.history.gdp} label="GDP history" /> : <p className="screen__note">Charts fill in month by month. Press Play.</p>}</Card>
      <Card title="Population">{me.history.population.length > 1 ? <Sparkline values={me.history.population} label="Population history" /> : <p className="screen__note">Charts fill in month by month.</p>}</Card>
    </div>
  );
}

// ============ More ============

export function MoreScreen() {
  return (
    <ScreenFrame
      id="more"
      title="More"
      subtitle="Population, news, intelligence and settings"
      tabs={[
        { id: "population", label: "Population" },
        { id: "news", label: "News" },
        { id: "intelligence", label: "Intelligence" },
        { id: "settings", label: "Settings" },
      ]}
    >
      {(tab) => (tab === "population" ? <PopulationTab /> : tab === "news" ? <NewsTab /> : tab === "intelligence" ? <IntelligenceTab /> : <SettingsTab />)}
    </ScreenFrame>
  );
}

function PopulationTab() {
  return (
    <NeedCountry>
      {(c) => (
        <>
          <div className="grid">
            <Card title="People">
              <Rows
                rows={[
                  ["Population", formatCompact(c.population)],
                  ["Growth", c.history.population.length ? `${formatPercent(c.popGrowth, 2, true)} / yr` : "From the 1st of next month"],
                  ["Food supplied", formatPercent(Math.min(1, (c.resources.food.production + c.resources.food.imports) / Math.max(c.resources.food.need, 1e-9)), 0), "Shortages slow population growth and stability"],
                ]}
              />
            </Card>
          </div>
          <h3 className="screen__h3">Provinces by population</h3>
          <ProvinceList c={c} sort="population" />
          <p className="screen__note">Province populations are estimated from country totals, cities and land area.</p>
        </>
      )}
    </NeedCountry>
  );
}

const NEWS_ICON: Record<GameEvent["kind"], string> = { war: "⚔", peace: "☮", battle: "✕", occupation: "⚑", alliance: "⛓", annexation: "⚠", diplomacy: "✉", military: "▲", politics: "◆" };

function NewsTab() {
  const events = useGame((s) => s.state.events);
  const startDate = useGame((s) => s.state.startDate);
  const me = useGame((s) => playerCountry(s.state)?.id);
  const [mine, setMine] = useState(false);
  const shown = events.filter((e) => !mine || (me && e.countries.includes(me))).slice(-100).reverse();
  return (
    <>
      <div className="segmented segmented--inline" role="radiogroup" aria-label="Which news">
        <button role="radio" aria-checked={!mine} className={!mine ? "is-active" : ""} onClick={() => setMine(false)}>
          Everything
        </button>
        <button role="radio" aria-checked={mine} className={mine ? "is-active" : ""} onClick={() => setMine(true)} disabled={!me}>
          Your country
        </button>
      </div>
      <ul className="newslog" data-testid="news-log">
        {shown.map((e, i) => (
          <li key={`${e.tick}-${i}`} className={`news__item news__item--${e.kind}`}>
            <span className="news__icon" aria-hidden>
              {NEWS_ICON[e.kind]}
            </span>
            <span className="newslog__date">{formatDate(dateAt(startDate, e.tick))}</span>
            <span>{e.text}</span>
          </li>
        ))}
        {!shown.length && <li className="screen__note">Nothing yet. Press Play to see the world move.</li>}
      </ul>
    </>
  );
}

function IntelligenceTab() {
  const s = useGame((x) => x.state);
  const me = playerCountry(s)?.id;
  const seen = me ? visibleProvinces(s, GEOGRAPHY, me).size : 0;
  return (
    <div className="grid">
      <Card title="What you can see" hint="Fog of war: foreign armies are only visible near your land, your units and your allies.">
        {me ? (
          <Rows
            rows={[
              ["Provinces in sight", `${formatInt(seen)} of ${formatInt(Object.keys(s.provinces).length)}`],
              ["Allies sharing vision", String(alliesOf(s, me).length)],
              ["At war", isAtWar(s, me) ? "Yes" : "No"],
            ]}
          />
        ) : (
          <p className="screen__note">Choose a country to see what it can see.</p>
        )}
      </Card>
      <Planned title="Intelligence" items={["Spy networks in other countries", "Reports on foreign armies and plans", "Counter-intelligence"]} />
    </div>
  );
}

function SettingsTab() {
  const fog = useUi((s) => s.fog);
  const setFog = useUi((s) => s.setFog);
  const online = useGame((s) => s.mode === "online");
  return (
    <div className="grid">
      <Card title="Display" wide>
        <label className="dialog__check">
          <input type="checkbox" checked={online || fog} disabled={online} onChange={(e) => setFog(e.target.checked)} />
          <span>
            <strong>Fog of war</strong>
            <span className="screen__note">{online ? "Always on when playing online." : "Only show foreign forces near your land, your units and your allies."}</span>
          </span>
        </label>
      </Card>
      <Card title="Game" wide>
        <p className="screen__note">Saving, loading, new games, the world editor and online play are in the Settings menu at the top right.</p>
      </Card>
    </div>
  );
}

