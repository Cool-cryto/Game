import { useState } from "react";
import type { CountryId } from "@gs/shared";
import {
  canRecruit,
  generalCap,
  generalCost,
  KINDS_OF,
  kindUnlocked,
  militaryLevel,
  rankOf,
  recruitCost,
  TRAITS,
  UNIT_KINDS,
  unitCap,
  upkeepPerYear,
  type CountryState,
  type GameState,
  type Unit,
  type UnitKind,
  type UnitType,
} from "@gs/sim";
import { GEOGRAPHY, getProvince } from "../../data/countries";
import { useGame } from "../../state/gameStore";
import { useUi } from "../../state/uiStore";
import { formatMoneyMillions } from "../format";
import { plainReason, recruitProvince } from "../simple/SimpleHud";
import { Card } from "./Screen";

const money = formatMoneyMillions;
const BRANCHES: { type: UnitType; label: string; where: string }[] = [
  { type: "army", label: "Army", where: "raised at your capital" },
  { type: "air", label: "Air force", where: "based at your capital" },
  { type: "navy", label: "Navy", where: "built at your largest port" },
];

/** "3 infantry, 1 tank divisions" for a list of units. */
export function kindSummary(units: Unit[]): string {
  const n = new Map<UnitKind, number>();
  for (const u of units) n.set(u.kind, (n.get(u.kind) ?? 0) + 1);
  return [...n]
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => `${c} ${c > 1 ? UNIT_KINDS[k].plural : UNIT_KINDS[k].label.toLowerCase()}`)
    .join(", ");
}

const statLine = (k: UnitKind) => {
  const x = UNIT_KINDS[k];
  if (x.type === "air") return `Support ${Math.round((x.landSupport ?? 0) * 100)}% land / ${Math.round((x.seaSupport ?? 0) * 100)}% sea${x.airDefense ? ` · intercepts ${x.airDefense}` : ""}`;
  return `Attack ${x.attack} · Defense ${x.defense} · Speed ${Math.round(x.speed * 100)}%`;
};

/** Recruiting: pick a branch, a unit type and how many. Units train before they can move. */
export function RecruitPanel({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const [branch, setBranch] = useState<UnitType>("army");
  const [kind, setKind] = useState<UnitKind>("infantry");
  const [count, setCount] = useState(1);
  const at = recruitProvince(s, c.id, branch);
  const k = UNIT_KINDS[kind].type === branch ? kind : KINDS_OF[branch][0]!;
  const units = Object.values(s.units).filter((u) => u.owner === c.id).length;
  const free = Math.max(0, unitCap(c) - units);
  const n = Math.max(1, Math.min(count, 10));
  const cost = recruitCost(c, branch, k) * n;
  const raw = !at
    ? branch === "navy"
      ? "You have no port to build a fleet in."
      : "You don't hold your capital right now."
    : canRecruit(s, GEOGRAPHY, c.id, branch, at, k) ?? (n > free ? `Your population supports ${free} more unit${free === 1 ? "" : "s"}.` : c.defenseFund < cost ? "Not enough army money yet. It builds up every month." : null);
  const reason = raw ? plainReason(raw, branch) : null;
  const base = at ? (s.provinces[at]?.buildings?.base ?? 0) : 0;
  return (
    <Card title="Recruit" hint="Units train before they can move (they defend at half strength meanwhile). A military base trains them faster and to full strength." wide>
      <div className="seg-row" role="tablist" aria-label="Branch">
        {BRANCHES.map((b) => (
          <button key={b.type} role="tab" aria-selected={branch === b.type} className={branch === b.type ? "seg is-on" : "seg"} onClick={() => setBranch(b.type)} data-testid={`branch-${b.type}`}>
            {b.label}
          </button>
        ))}
      </div>
      <div className="kinds" role="radiogroup" aria-label="Unit type">
        {KINDS_OF[branch].map((x) => {
          const open = kindUnlocked(c, x);
          return (
            <button
              key={x}
              role="radio"
              aria-checked={k === x}
              className={`kind ${k === x ? "is-on" : ""} ${open ? "" : "is-locked"}`}
              onClick={() => setKind(x)}
              title={UNIT_KINDS[x].summary}
              data-testid={`kind-${x}`}
            >
              <span className="kind__name">{UNIT_KINDS[x].label}</span>
              <span className="kind__stats">{open ? statLine(x) : `Needs military research ${UNIT_KINDS[x].tech}`}</span>
              <span className="kind__cost">{money(recruitCost(c, branch, x))}</span>
            </button>
          );
        })}
      </div>
      <p className="kind__summary">
        <strong>{UNIT_KINDS[k].label}:</strong> {UNIT_KINDS[k].summary} Trains in {Math.round(UNIT_KINDS[k].trainDays * (base ? 0.7 : 1))} days
        {UNIT_KINDS[k].fuel ? "; burns fuel (weaker in an energy shortage)" : ""}. Upkeep {money(upkeepPerYear(c, branch, k))}/yr.
      </p>
      <div className="recruit-row">
        <label>
          How many{" "}
          <input type="number" min={1} max={10} value={count} onChange={(e) => setCount(Number(e.target.value) || 1)} aria-label="How many" data-testid="recruit-count" />
        </label>
        <button
          className="btn btn--primary"
          disabled={!!reason}
          title={reason ?? undefined}
          onClick={() => at && send({ type: "recruit", country: c.id, unitType: branch, province: at, kind: k, count: n })}
          data-testid="recruit-button"
        >
          Recruit {n > 1 ? `${n} × ` : ""}
          {UNIT_KINDS[k].label} · {money(cost)}
        </button>
      </div>
      <p className="screen__note">
        {reason ? <span className="neg">{reason} </span> : null}
        {at ? `${BRANCHES.find((b) => b.type === branch)!.label} units are ${BRANCHES.find((b) => b.type === branch)!.where} (${getProvince(at)?.name ?? at}). ` : ""}
        Military money {money(c.defenseFund)} · units {units} / {unitCap(c)}. Starting forces are estimates sized from defense budgets.
      </p>
    </Card>
  );
}

/** Every unit type, what it does and whether it's unlocked. */
export function UnitCatalogue({ c }: { c: CountryState }) {
  return (
    <Card title="Unit types" hint={`Your military research level is ${militaryLevel(c)}. Higher levels unlock more types.`} wide>
      <table className="table" data-testid="unit-catalogue">
        <thead>
          <tr>
            <th>Type</th>
            <th className="num">Atk</th>
            <th className="num">Def</th>
            <th className="num">Speed</th>
            <th className="num">Cost</th>
            <th className="num">Train</th>
          </tr>
        </thead>
        <tbody>
          {(["army", "air", "navy"] as const).flatMap((t) =>
            KINDS_OF[t].map((k) => {
              const x = UNIT_KINDS[k];
              const open = kindUnlocked(c, k);
              return (
                <tr key={k} className={open ? undefined : "is-locked"} title={x.summary}>
                  <th>
                    {x.label}
                    <span className="table__sub">{open ? x.summary : `Needs military research ${x.tech}`}</span>
                  </th>
                  <td className="num">{t === "air" ? "—" : x.attack}</td>
                  <td className="num">{t === "air" ? "—" : x.defense}</td>
                  <td className="num">{Math.round(x.speed * 100)}%</td>
                  <td className="num">{money(recruitCost(c, t, k))}</td>
                  <td className="num">{x.trainDays}d</td>
                </tr>
              );
            }),
          )}
        </tbody>
      </table>
    </Card>
  );
}

/** The general leading a stack, if any. */
export function stackGeneral(s: GameState, owner: CountryId, units: Unit[]) {
  const ids = new Set(units.map((u) => u.id));
  return s.generals.find((g) => g.owner === owner && g.unit !== null && ids.has(g.unit)) ?? null;
}

/** Hire, assign and dismiss generals. */
export function GeneralsPanel({ c }: { c: CountryState }) {
  const s = useGame((x) => x.state);
  const send = useGame((x) => x.send);
  const select = useUi((x) => x.select);
  const mine = s.generals.filter((g) => g.owner === c.id);
  const armies = Object.values(s.units).filter((u) => u.owner === c.id && u.type === "army");
  const total = Object.values(s.units).filter((u) => u.owner === c.id).length;
  const cap = generalCap(total);
  const cost = generalCost(c);
  const stacks = new Map<string, Unit[]>();
  for (const u of armies) stacks.set(u.province, [...(stacks.get(u.province) ?? []), u]);
  const hireReason = mine.length >= cap ? `You can have ${cap} with your current forces (one more per six units).` : c.defenseFund < cost ? "Not enough military money." : null;
  return (
    <div className="grid">
      <Card title={`Generals (${mine.length} of ${cap})`} hint="A general leads every army of yours in the same province as the unit they command." wide>
        <div className="recruit-row">
          <button className="btn btn--primary" disabled={!!hireReason} title={hireReason ?? undefined} onClick={() => send({ type: "hireGeneral", country: c.id })} data-testid="hire-general">
            Hire a general · {money(cost)}
          </button>
          {hireReason && <span className="panel__small">{hireReason}</span>}
        </div>
        {!mine.length ? (
          <p className="screen__note">No generals yet. A general adds 4% attack and defense per skill level to the stack they lead, plus a trait.</p>
        ) : (
          <ul className="generals" data-testid="generals-list">
            {mine.map((g) => {
              const u = g.unit !== null ? s.units[g.unit] : undefined;
              return (
                <li key={g.id} className="general">
                  <div className="general__head">
                    <strong>{g.name}</strong>
                    <span className="general__rank">{rankOf(g)}</span>
                  </div>
                  <div className="general__meta">
                    Skill {"★".repeat(g.skill)}
                    {"☆".repeat(5 - g.skill)} · {g.xp} xp · {TRAITS[g.trait].label}: {TRAITS[g.trait].effect}
                  </div>
                  <div className="general__cmd">
                    <select
                      aria-label={`Command for ${g.name}`}
                      value={u ? u.province : ""}
                      onChange={(e) => {
                        const list = stacks.get(e.target.value);
                        send({ type: "assignGeneral", country: c.id, general: g.id, unit: list ? list[0]!.id : -1 });
                      }}
                    >
                      <option value="">No command</option>
                      {[...stacks].map(([p, list]) => (
                        <option key={p} value={p}>
                          {getProvince(p as never)?.name ?? p} ({kindSummary(list)})
                        </option>
                      ))}
                    </select>
                    {u && (
                      <button className="link" onClick={() => select({ kind: "units", province: u.province, owner: c.id }, { focus: true })}>
                        Show
                      </button>
                    )}
                    <button className="link" onClick={() => send({ type: "dismissGeneral", country: c.id, general: g.id })}>
                      Dismiss
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
