import { useEffect } from "react";
import type { CountryInfo } from "@gs/shared";
import { flagUrl, getCountry } from "../data/countries";
import { useUi } from "../state/uiStore";

const KIND_LABEL: Record<CountryInfo["kind"], string> = {
  sovereign: "Sovereign state",
  territory: "Territory / dependency",
  disputed: "Disputed region",
};

const fmt = new Intl.NumberFormat("en-US");

export function CountryPanel() {
  const selectedId = useUi((s) => s.selectedId);
  const select = useUi((s) => s.select);
  const c = getCountry(selectedId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && select(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  if (!c) return null;
  const flag = flagUrl(c);

  return (
    <aside className="panel" aria-label={`${c.name} details`} data-testid="country-panel">
      <div className="panel__head">
        {flag ? <img className="panel__flag" src={flag} alt={`Flag of ${c.name}`} /> : <div className="panel__flag flag-placeholder" />}
        <div className="panel__titles">
          <h2>{c.name}</h2>
          {c.officialName && c.officialName !== c.name && <p className="panel__official">{c.officialName}</p>}
          <span className={`badge badge--${c.kind}`}>{KIND_LABEL[c.kind]}</span>
        </div>
        <button className="icon-btn" onClick={() => select(null)} aria-label="Close panel" title="Close (Esc)">
          ×
        </button>
      </div>

      <div className="panel__actions">
        <button className="btn" onClick={() => select(c.id, { focus: true })}>Zoom to {c.name}</button>
      </div>

      {c.note && <p className="panel__note">{c.note}</p>}

      <section>
        <h3>Overview</h3>
        <dl className="facts">
          <Fact label="Capital" value={c.capital.join(", ")} />
          <Fact label="Region" value={[c.subregion, c.region].filter(Boolean).join(", ")} />
          <Fact label="Area" value={c.areaKm2 ? `${fmt.format(c.areaKm2)} km²` : null} />
          <Fact label="Landlocked" value={c.landlocked === null ? null : c.landlocked ? "Yes" : "No"} />
          <Fact label="UN member" value={c.kind === "disputed" ? null : c.unMember ? "Yes" : "No"} />
          <Fact label="Languages" value={c.languages.join(", ")} />
          <Fact label="Currency" value={c.currencies.map((x) => `${x.name}${x.symbol ? ` (${x.symbol})` : ""}`).join(", ")} />
          <Fact label="Demonym" value={c.demonym} />
          <Fact label="Code" value={c.id.startsWith("X-") ? null : c.id} />
        </dl>
      </section>

      {c.borders.length > 0 && (
        <section>
          <h3>Land borders ({c.borders.length})</h3>
          <div className="chips">
            {c.borders.map((b) => {
              const n = getCountry(b);
              return n ? (
                <button key={b} className="chip" onClick={() => select(b, { focus: true })}>
                  {n.name}
                </button>
              ) : null;
            })}
          </div>
        </section>
      )}

      <section className="panel__future">
        <h3>Not simulated yet</h3>
        <p>
          Population, economy, government, resources, technology, diplomacy and military are not part of the game yet. They arrive in
          later stages. The facts above are real-world reference data, not game values.
        </p>
      </section>
    </aside>
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
