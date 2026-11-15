/** A tiny line chart of recent values. */
export function Sparkline({ values, label }: { values: number[]; label: string }) {
  if (values.length < 2) return <div className="spark spark--empty">Builds up as time passes</div>;
  const w = 120;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - 2 - ((v - min) / span) * (h - 4)).toFixed(1)}`).join(" ");
  const up = values[values.length - 1]! >= values[0]!;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <polyline points={pts} fill="none" stroke={up ? "#7fd39a" : "#f08a7a"} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
