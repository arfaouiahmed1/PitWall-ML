import * as React from "react";
import type { ReactNode } from "react";

export type LocalShapContribution = {
  readonly feature: string;
  readonly value: number;
};

export type GlobalFeatureImportance = {
  readonly feature: string;
  readonly importance: number;
};

export type FeatureExplanation =
  | {
      readonly kind: "local";
      readonly baseline: number;
      readonly output?: number;
      readonly contributions: readonly LocalShapContribution[];
    }
  | {
      readonly kind: "global";
      readonly importances: readonly GlobalFeatureImportance[];
    };

export type FeatureWaterfallChartProps = {
  readonly data: FeatureExplanation;
  readonly className?: string;
  readonly title?: string;
};

export type WaterfallRow = {
  readonly feature: string;
  readonly value: number;
  readonly start: number;
  readonly end: number;
};

const finite = (value: number): boolean => Number.isFinite(value);

export function normalizeLocalContributions(
  contributions: readonly LocalShapContribution[],
  baseline: number,
): readonly WaterfallRow[] {
  if (!finite(baseline)) return [];

  let current = baseline;
  const rows: WaterfallRow[] = [];
  for (const contribution of contributions) {
    if (!finite(contribution.value) || !finite(current)) continue;
    const end = current + contribution.value;
    if (!finite(end)) continue;
    rows.push({ feature: contribution.feature, value: contribution.value, start: current, end });
    current = end;
  }
  return rows;
}

function formatSeconds(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(3)}s`;
}

function FeatureWaterfallShell({ children, className, title }: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly title: string;
}) {
  return (
    <section className={`rounded-xl border border-pitwall-border bg-pitwall-card p-5 ${className ?? ""}`}>
      <h3 className="font-black text-xs tracking-widest">{title}</h3>
      {children}
    </section>
  );
}

function LocalWaterfall({ data }: { readonly data: Extract<FeatureExplanation, { readonly kind: "local" }> }) {
  const rows = normalizeLocalContributions(data.contributions, data.baseline);
  const calculatedOutput = rows.at(-1)?.end ?? data.baseline;
  const output = finite(data.output ?? calculatedOutput) ? data.output ?? calculatedOutput : calculatedOutput;
  const values = [data.baseline, output, ...rows.flatMap((row) => [row.start, row.end])];
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = Math.max(maximum - minimum, 0.001);

  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-pitwall-muted">No local SHAP contributions are available for this prediction.</p>;
  }

  return (
    <div className="mt-4 space-y-2 font-mono text-xs">
      <div className="flex justify-between text-pitwall-muted"><span>baseline E[f(x)]</span><span>{data.baseline.toFixed(3)}s</span></div>
      {rows.map((row) => {
        const left = ((Math.min(row.start, row.end) - minimum) / range) * 100;
        const width = Math.max((Math.abs(row.value) / range) * 100, 0.5);
        const positive = row.value >= 0;
        return (
          <div className="grid grid-cols-[minmax(0,9rem)_1fr_4.75rem] items-center gap-2" key={row.feature}>
            <span className="truncate text-pitwall-muted" title={row.feature}>{row.feature}</span>
            <div className="relative h-5 overflow-hidden rounded bg-pitwall-bg" aria-label={`${row.feature}: ${formatSeconds(row.value)}`}>
              <div className="absolute inset-y-0 w-px bg-pitwall-border" style={{ left: `${((0 - minimum) / range) * 100}%` }} />
              <div
                className={`absolute inset-y-1 rounded ${positive ? "bg-pitwall-danger" : "bg-pitwall-green"}`}
                style={{ left: `${left}%`, width: `${width}%` }}
              />
            </div>
            <span className={positive ? "text-pitwall-danger text-right" : "text-pitwall-green text-right"}>{formatSeconds(row.value)}</span>
          </div>
        );
      })}
      <div className="flex justify-between border-t border-pitwall-border pt-2 font-black"><span>model output</span><span>{output.toFixed(3)}s</span></div>
    </div>
  );
}

function GlobalRanking({ data }: { readonly data: Extract<FeatureExplanation, { readonly kind: "global" }> }) {
  const rows = data.importances
    .filter((row) => finite(row.importance) && row.importance >= 0)
    .toSorted((left, right) => right.importance - left.importance);
  const maximum = Math.max(...rows.map((row) => row.importance), 0.001);
  if (rows.length === 0) return <p className="mt-3 text-xs text-pitwall-muted">No global feature importances are available.</p>;

  return (
    <div className="mt-3">
      <p className="text-xs text-pitwall-muted">Global feature ranking. Importances are not signed, per-lap SHAP contributions.</p>
      <div className="mt-3 space-y-2 font-mono text-xs">
        {rows.map((row) => (
          <div className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-2" key={row.feature}>
            <span className="truncate text-pitwall-muted" title={row.feature}>{row.feature}</span>
            <div className="h-2 overflow-hidden rounded bg-pitwall-bg"><div className="h-full rounded bg-pitwall-cyan" style={{ width: `${(row.importance / maximum) * 100}%` }} /></div>
            <span className="text-right">{row.importance.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FeatureWaterfallChart({ data, className, title }: FeatureWaterfallChartProps) {
  switch (data.kind) {
    case "local":
      return <FeatureWaterfallShell className={className} title={title ?? "LOCAL SHAP WATERFALL"}><LocalWaterfall data={data} /></FeatureWaterfallShell>;
    case "global":
      return <FeatureWaterfallShell className={className} title={title ?? "GLOBAL FEATURE IMPORTANCE"}><GlobalRanking data={data} /></FeatureWaterfallShell>;
  }
}
