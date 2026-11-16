import { ADMIN_COST, BUDGET_CATEGORIES, BUDGET_RESERVE, type BudgetCategory, type CountryState } from "@gs/sim";
import type { CountryId } from "@gs/shared";

/**
 * Simple mode's economy: instead of a tax slider and four spending sliders, the
 * player picks a tax level and a national focus. Each choice sets the real
 * policies, always to a budget that keeps a small reserve (5% of taxes), so
 * simple-mode players never sink into debt by accident and the treasury grows.
 */
export const TAX_LEVELS = [
  { id: "low", label: "Low", rate: 0.18, help: "Happier people and faster growth, but less money to spend." },
  { id: "normal", label: "Normal", rate: 0.25, help: "A sensible middle." },
  { id: "high", label: "High", rate: 0.32, help: "More money for your focus, but slower growth and some unrest." },
] as const;
export type TaxLevel = (typeof TAX_LEVELS)[number]["id"];

/** How the money left after running the state is split. */
export const FOCUSES: { id: string; label: string; icon: string; help: string; split: Record<BudgetCategory, number> }[] = [
  { id: "balanced", label: "Balanced", icon: "⚖️", help: "A bit of everything.", split: { infrastructure: 0.18, research: 0.12, welfare: 0.55, defense: 0.15 } },
  { id: "growth", label: "Grow the economy", icon: "📈", help: "Roads, power and research. The economy grows faster.", split: { infrastructure: 0.32, research: 0.28, welfare: 0.3, defense: 0.1 } },
  { id: "military", label: "Build the army", icon: "🛡️", help: "Saves money for recruiting and keeping armies.", split: { infrastructure: 0.1, research: 0.08, welfare: 0.37, defense: 0.45 } },
  { id: "people", label: "Keep people happy", icon: "😊", help: "Welfare keeps the country stable and calm.", split: { infrastructure: 0.12, research: 0.08, welfare: 0.7, defense: 0.1 } },
];

const round = (n: number) => Math.round(n * 10000) / 10000;

/** The commands that set this tax level and focus. */
export function policyCommands(country: CountryId, taxRate: number, focusId: string) {
  const focus = FOCUSES.find((f) => f.id === focusId) ?? FOCUSES[0]!;
  const spendable = Math.max(0, taxRate * (1 - BUDGET_RESERVE) - ADMIN_COST);
  return [
    { type: "setTaxRate" as const, country, value: taxRate },
    ...BUDGET_CATEGORIES.map((category) => ({ type: "setBudget" as const, country, category, value: Math.min(0.3, round(spendable * focus.split[category])) })),
  ];
}

/** Which tax level is closest to the country's current tax rate. */
export function currentTaxLevel(c: CountryState): TaxLevel {
  return TAX_LEVELS.reduce((best, t) => (Math.abs(t.rate - c.taxRate) < Math.abs(best.rate - c.taxRate) ? t : best)).id;
}

/** Which focus matches the current spending split, or null if it was set by hand (advanced mode). */
export function currentFocus(c: CountryState): string | null {
  const total = BUDGET_CATEGORIES.reduce((a, k) => a + c.budget[k], 0);
  if (total <= 0) return null;
  for (const f of FOCUSES) if (BUDGET_CATEGORIES.every((k) => Math.abs(c.budget[k] / total - f.split[k]) < 0.03)) return f.id;
  return null;
}
