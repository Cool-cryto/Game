const int = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const formatInt = (n: number) => int.format(Math.round(n));
/** 83,132,799 → "83.1M" */
export const formatCompact = (n: number) => compact.format(n);
const money = new Intl.NumberFormat("en-US", { notation: "compact", maximumSignificantDigits: 3 });
/** Money given in millions of US$ → "$3.95T", "-$120B" (amounts under $0.5M show as "$0") */
export const formatMoneyMillions = (m: number) => `${m < -0.5 ? "-" : ""}$${money.format(Math.abs(m) * 1e6)}`;
/** 0.0234 → "2.3%" ; signed adds "+" */
export const formatPercent = (v: number, digits = 1, signed = false) => `${signed && v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2020-03-07" → "7 Mar 2020" */
export function formatDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[(m ?? 1) - 1]} ${y}`;
}
