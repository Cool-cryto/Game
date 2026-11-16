import {
  BRANCH_LABEL,
  BRANCHES,
  BUDGET_RANGE,
  MAX_TECH,
  nextTech,
  researchSpeed,
  treatyResearch,
  researchTarget,
  TECHS,
  yearsPerBranchLevel,
  type Branch,
  type CountryState,
  type ResearchFocus,
} from "@gs/sim";
import { useGame } from "../../state/gameStore";
import { formatMoneyMillions, formatPercent } from "../format";
import { BUDGET_LABEL, Meter, PolicySlider } from "../InfoPanel";
import { Card, NeedCountry, Rows, ScreenFrame } from "./Screen";

export function ResearchScreen() {
  return (
    <NeedCountry>
      {(c) => (
        <ScreenFrame
          id="research"
          title="Research"
          subtitle={`Technology level ${c.techLevel} on average`}
          tabs={[
            { id: "overview", label: "Overview", hint: "Your three research branches and what to focus on" },
            { id: "tree", label: "Technology tree", hint: "Every technology and what it unlocks" },
            { id: "spending", label: "Research spending" },
          ]}
        >
          {(tab) => (tab === "overview" ? <Overview c={c} /> : tab === "tree" ? <Tree c={c} /> : <Spending c={c} />)}
        </ScreenFrame>
      )}
    </NeedCountry>
  );
}

/** Years to the next level of a branch if all research money went there. */
function yearsToNext(c: CountryState, b: Branch): number | null {
  if (c.research.levels[b] >= MAX_TECH || c.budget.research <= 0) return null;
  const perYear = (c.budget.research / 0.03 / yearsPerBranchLevel(c.research.levels[b])) * researchSpeed(c, treatyResearch(useGame.getState().state, c.id));
  return (1 - c.research.progress[b]) / perYear;
}

const FOCUS: { id: ResearchFocus; label: string; help: string }[] = [
  { id: "balanced", label: "Balanced", help: "Always researches the branch that is furthest behind." },
  { id: "economy", label: "Economy", help: BRANCH_LABEL.economy.help },
  { id: "military", label: "Military", help: BRANCH_LABEL.military.help },
  { id: "infrastructure", label: "Infrastructure", help: BRANCH_LABEL.infrastructure.help },
];

function Overview({ c }: { c: CountryState }) {
  const send = useGame((s) => s.send);
  const target = researchTarget(c, MAX_TECH);
  return (
    <>
      <div className="grid">
        <Card title="Research focus" hint="Research money goes to one branch at a time. Progress in the others is kept." wide>
          <div className="segmented segmented--4" role="radiogroup" aria-label="Research focus">
            {FOCUS.map((f) => (
              <button key={f.id} role="radio" aria-checked={c.research.focus === f.id} className={c.research.focus === f.id ? "is-active" : ""} title={f.help} onClick={() => send({ type: "setResearchFocus", country: c.id, focus: f.id })}>
                {f.label}
              </button>
            ))}
          </div>
          <p className="screen__note">
            {target ? (
              <>
                Researching now: <strong>{BRANCH_LABEL[target].label}</strong>. {FOCUS.find((f) => f.id === c.research.focus)!.help}
              </>
            ) : (
              "Every branch is at the maximum level."
            )}
            {c.budget.research <= 0 && " You spend nothing on research, so nothing advances."}
          </p>
        </Card>
      </div>
      <div className="grid grid--3">
        {BRANCHES.map((b) => {
          const level = c.research.levels[b];
          const next = nextTech(c, b);
          const years = yearsToNext(c, b);
          return (
            <Card key={b} title={BRANCH_LABEL[b].label} hint={BRANCH_LABEL[b].help}>
              <p className="big-number">
                {level}
                <span className="big-number__sub"> / {MAX_TECH}</span>
                {target === b && <span className="tag tag--now">Researching</span>}
              </p>
              <Meter value={c.research.progress[b]} max={1} label={level >= MAX_TECH ? "Maximum" : `${Math.round(c.research.progress[b] * 100)}% to level ${level + 1}`} tone="tech" />
              <Rows
                rows={[
                  ["Next level", years === null ? "—" : `about ${years.toFixed(1)} yr if focused`],
                  ["Next technology", next ? `${next.name} (level ${next.level})` : "All unlocked"],
                ]}
              />
            </Card>
          );
        })}
      </div>
      <p className="screen__note">Research speed ×{researchSpeed(c, treatyResearch(useGame.getState().state, c.id)).toFixed(2)} from your government, technologies and research agreements. All branches start at the same level, set by GDP per person.</p>
    </>
  );
}

function Tree({ c }: { c: CountryState }) {
  return (
    <div className="tree" data-testid="tech-tree">
      {BRANCHES.map((b) => (
        <div key={b} className="tree__branch">
          <h3 className="screen__h3" title={BRANCH_LABEL[b].help}>
            {BRANCH_LABEL[b].label} · level {c.research.levels[b]}
          </h3>
          <ol className="tree__list">
            {TECHS.filter((t) => t.branch === b).map((t) => {
              const done = c.research.levels[b] >= t.level;
              const isNext = !done && nextTech(c, b) === t;
              return (
                <li key={t.id} className={`tech ${done ? "tech--done" : isNext ? "tech--next" : "tech--locked"}`} data-testid={`tech-${t.id}`}>
                  <span className="tech__level">{t.level}</span>
                  <span className="tech__body">
                    <strong>{t.name}</strong>
                    <span>{t.effect}</span>
                  </span>
                  <span className="tech__state">{done ? "Unlocked" : isNext ? "Next" : `Level ${t.level}`}</span>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Spending({ c }: { c: CountryState }) {
  const send = useGame((s) => s.send);
  return (
    <div className="grid">
      <Card title="Research spending" hint={BUDGET_LABEL.research.help} wide>
        <PolicySlider
          label="Research"
          help={BUDGET_LABEL.research.help}
          value={c.budget.research}
          min={BUDGET_RANGE[0]}
          max={BUDGET_RANGE[1]}
          step={0.005}
          onCommit={(value) => send({ type: "setBudget", country: c.id, category: "research", value })}
        />
        <p className="screen__note">
          {formatMoneyMillions(c.budget.research * c.gdp)} per year ({formatPercent(c.budget.research)} of GDP). About 3% of GDP gives steady progress; higher levels take longer.
          Spending more without raising taxes creates a deficit.
        </p>
      </Card>
    </div>
  );
}
