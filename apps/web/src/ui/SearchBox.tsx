import { useMemo, useState } from "react";
import { flagUrl, searchCountries } from "../data/countries";
import { useUi } from "../state/uiStore";

export function SearchBox() {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const results = useMemo(() => searchCountries(query), [query]);
  const select = useUi((s) => s.select);

  const choose = (i: number) => {
    const c = results[i];
    if (!c) return;
    select(c.id, { focus: true });
    setQuery("");
    setOpen(false);
  };

  return (
    <div className="search">
      <svg className="search__icon" viewBox="0 0 24 24" aria-hidden>
        <path d="M10.5 3a7.5 7.5 0 0 1 5.96 12.05l4.25 4.24-1.42 1.42-4.24-4.25A7.5 7.5 0 1 1 10.5 3Zm0 2a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11Z" />
      </svg>
      <input
        type="search"
        placeholder="Search countries and territories"
        aria-label="Search countries"
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
          else if (e.key === "Enter") choose(active);
          else if (e.key === "Escape") setOpen(false);
          else return;
          e.preventDefault();
        }}
      />
      {open && query && (
        <ul className="search__results" role="listbox">
          {results.length === 0 && <li className="search__empty">No matches</li>}
          {results.map((c, i) => {
            const flag = flagUrl(c);
            return (
              <li
                key={c.id}
                role="option"
                aria-selected={i === active}
                className={i === active ? "is-active" : undefined}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(i);
                }}
                onMouseEnter={() => setActive(i)}
              >
                {flag ? <img src={flag} alt="" /> : <span className="flag-placeholder" />}
                <span>{c.name}</span>
                {c.kind !== "sovereign" && <span className="tag">{c.kind}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
