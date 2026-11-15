import { useEffect, useMemo, useState } from "react";
import { flagUrl, loadCities, search, type SearchResult } from "../data/countries";
import { ownerOf } from "../state/gameStore";
import { useUi } from "../state/uiStore";

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const [citiesReady, setCitiesReady] = useState(false);
  useEffect(() => {
    loadCities().then(() => setCitiesReady(true), () => {});
  }, []);
  const results = useMemo(() => search(query, ownerOf), [query, citiesReady]);
  const select = useUi((s) => s.select);
  const command = useUi((s) => s.command);

  const choose = (r: SearchResult | undefined) => {
    if (!r) return;
    if (r.kind === "country") select({ kind: "country", id: r.id }, { focus: true });
    else if (r.kind === "province") select({ kind: "province", id: r.id }, { focus: true });
    else {
      select({ kind: "province", id: r.city.prov });
      command({ kind: "point", lon: r.city.lon, lat: r.city.lat, zoom: 14 });
    }
    setQuery("");
    setOpen(false);
    // Hand keyboard focus back to the page so Escape closes the panel.
    (document.activeElement as HTMLElement | null)?.blur();
  };

  return (
    <div className="search">
      <svg className="search__icon" viewBox="0 0 24 24" aria-hidden>
        <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />
      </svg>
      <input
        type="search"
        placeholder="Search countries, provinces, cities"
        aria-label="Search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setActive((a) => Math.min(a + 1, results.length - 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(a - 1, 0));
          else if (e.key === "Enter") choose(results[active]);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && query && (
        <ul className="search__results" role="listbox">
          {results.length === 0 && <li className="search__empty">No matches</li>}
          {results.map((r, i) => (
            <li
              key={r.kind + (r.kind === "city" ? `${r.city.name}${r.city.lon}` : r.id)}
              role="option"
              aria-selected={i === active}
              className={i === active ? "is-active" : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(r);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <ResultIcon r={r} />
              <span className="search__text">
                <span className="search__name">{r.name}</span>
                {r.detail && <span className="search__detail">{r.detail}</span>}
              </span>
              <span className="tag">{r.kind === "country" ? (r.country.kind === "sovereign" ? "country" : r.country.kind) : r.kind}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultIcon({ r }: { r: SearchResult }) {
  if (r.kind === "country") {
    const flag = flagUrl(r.country);
    return flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />;
  }
  return <span className={`result-icon result-icon--${r.kind}`} aria-hidden />;
}
