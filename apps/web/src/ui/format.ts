const int = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export const formatInt = (n: number) => int.format(n);
/** 83,132,799 → "83.1M" */
export const formatCompact = (n: number) => compact.format(n);
/** GDP given in millions of US$ → "$3.86T" */
export const formatMoneyMillions = (m: number) => `$${compact.format(m * 1e6)}`;
