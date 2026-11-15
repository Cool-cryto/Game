import { useEffect, type ReactNode } from "react";
import type { CountryId, CountryInfo, ProvinceId } from "@gs/shared";
import { citiesIn, flagUrl, getCountry, getProvince, MODERN_SCENARIO } from "../data/countries";
import { gdpPerCapita } from "../map/mapModes";
import { useGame } from "../state/gameStore";
import { useUi } from "../state/uiStore";
import { formatCompact, formatInt, formatMoneyMillions } from "./format";

const KIND_LABEL: Record<CountryInfo["kind"], string> = {
  sovereign: "Sovereign state",
  territory: "Territory / dependency",
  disputed: "Disputed region",
};

/** Info panel for whatever is selected: a country or a province. */
export function InfoPanel() {
  const selected = useUi((s) => s.selected);
  const select = useUi((s) => s.select);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !(e.target instanceof HTMLInputElement)) select(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!selected) return null;
  return selected.kind === "country" ? <CountryView id={selected.id} /> : <ProvinceView id={selected.id} />;
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

function CountryView({ id }: { id: CountryId }) {
  const c = getCountry(id);
  const state = useGame((s) => s.state.countries[id]);
  const provinceIds = useGame((s) => s.provincesOf.get(id)) ?? [];
  const select = useUi((s) => s.select);
  if (!c) return null;
  const flag = flagUrl(c);
  const perCapita = gdpPerCapita(state);
  const topCities = provinceIds
    .flatMap((p) => citiesIn(p))
    .sort((a, b) => b.cap - a.cap || b.pop - a.pop)
    .slice(0, 6);

  return (
    <Shell label={`${c.name} details`}>
      <div className="panel__head">
        {flag ? <img className="panel__flag" src={flag} alt={`Flag of ${c.name}`} /> : <div className="panel__flag flag-placeholder" />}
        <div className="panel__titles">
          <h2>{c.name}</h2>
          {c.officialName && c.officialName !== c.name && <p className="panel__official">{c.officialName}</p>}
          <span className={`badge badge--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
        </div>
        <CloseButton />
      </div>

      <div className="panel__actions">
        <button className="btn" onClick={() => select({ kind: "country", id }, { focus: true })}>
          Zoom to {c.name}
        </button>
      </div>

      {c.note && <p className="panel__note">{c.note}</p>}

      <section>
        <h3>Starting numbers</h3>
        <div className="stats">
          <Stat label="Population" value={state?.population ? formatCompact(state.population) : null} />
          <Stat label="GDP" value={state?.gdpMillionUsd ? formatMoneyMillions(state.gdpMillionUsd) : null} />
          <Stat label="GDP per person" value={perCapita ? `$${formatInt(Math.round(perCapita))}` : null} />
          <Stat label="Provinces" value={formatInt(provinceIds.length)} />
        </div>
        <p className="panel__source">{MODERN_SCENARIO.dataNote}</p>
      </section>

      <section>
        <h3>Overview</h3>
        <dl className="facts">
          <Fact label="Capital" value={c.capital.join(", ")} />
          <Fact label="Region" value={[c.subregion, c.region].filter(Boolean).join(", ")} />
          <Fact label="Area" value={c.areaKm2 ? `${formatInt(c.areaKm2)} km²` : null} />
          <Fact label="Economy" value={c.economy} />
          <Fact label="Income group" value={c.incomeGroup} />
          <Fact label="Languages" value={c.languages.join(", ")} />
          <Fact label="Currency" value={c.currencies.map((x) => `${x.name}${x.symbol ? ` (${x.symbol})` : ""}`).join(", ")} />
          <Fact label="Landlocked" value={c.landlocked === null ? null : c.landlocked ? "Yes" : "No"} />
          <Fact label="UN member" value={c.kind === "disputed" ? null : c.unMember ? "Yes" : "No"} />
          <Fact label="Code" value={c.id.startsWith("X-") ? null : c.id} />
        </dl>
      </section>

      {topCities.length > 0 && (
        <section>
          <h3>Largest cities</h3>
          <CityList cities={topCities} />
        </section>
      )}

      {c.borders.length > 0 && (
        <section>
          <h3>Land borders ({c.borders.length})</h3>
          <div className="chips">
            {c.borders.map((b) => {
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

function ProvinceView({ id }: { id: ProvinceId }) {
  const p = getProvince(id);
  const ownerId = useGame((s) => s.state.provinces[id]?.owner);
  const owner = getCountry(ownerId);
  const select = useUi((s) => s.select);
  if (!p) return null;
  const cities = citiesIn(id).slice(0, 8);
  const flag = owner ? flagUrl(owner) : null;

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

      <div className="panel__actions">
        <button className="btn" onClick={() => select({ kind: "province", id }, { focus: true })}>
          Zoom to {p.name}
        </button>
      </div>

      <section>
        <h3>Overview</h3>
        <dl className="facts">
          <Fact label="Area" value={`${formatInt(p.areaKm2)} km²`} />
          <Fact label="ISO code" value={p.iso} />
          <Fact label="Cities on map" value={formatInt(p.cityCount)} />
        </dl>
      </section>

      {cities.length > 0 && (
        <section>
          <h3>Cities</h3>
          <CityList cities={cities} />
        </section>
      )}

      <NotYet province />
    </Shell>
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
      <h3>Not simulated yet</h3>
      <p>
        {province
          ? "Province population, economy, resources, buildings and armies are not in the game yet. "
          : "Government, resources, technology, diplomacy and military are not in the game yet, and the numbers above don't change over time. "}
        They arrive in later stages.
      </p>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="stat">
      <div className={value ? "stat__value" : "stat__value muted"}>{value ?? "No data"}</div>
      <div className="stat__label">{label}</div>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <>
      <dt>{label}</dt>
      <dd className={value ? undefined : "muted"}>{value || "—"}</dd>
    </>
  );
}
