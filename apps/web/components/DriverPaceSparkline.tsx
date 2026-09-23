import * as React from "react";

export function DriverPaceSparkline({ values, color }: { values?: number[]; color?: string }) {
  if (!values?.length) return <span className="text-pitwall-muted">N/A</span>;
  const finiteValues = values.filter(Number.isFinite);
  if (!finiteValues.length) return <span className="text-pitwall-muted">N/A</span>;
  const min = Math.min(...finiteValues);
  const max = Math.max(...finiteValues);
  return <span className="inline-flex items-end gap-1" aria-label={`Stint pace: ${finiteValues.join(", ")}`}>
    {finiteValues.map((value, index) => <span key={`${index}-${value}`} aria-hidden="true" className="w-1.5 rounded-full bg-pitwall-cyan" style={{ height: `${max === min ? 10 : 4 + ((value - min) / (max - min)) * 14}px`, backgroundColor: color }} />)}
    <span className="ml-1 text-pitwall-fog">{finiteValues.join(" · ")}</span>
  </span>;
}
