import * as React from "react";

export type CalibrationPoint = {
  readonly nominal: number;
  readonly observed: number;
  readonly label?: string;
};

export type CalibrationCurveChartProps = {
  readonly points: readonly CalibrationPoint[];
  readonly className?: string;
  readonly title?: string;
};

const finiteCoverage = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1;

export function normalizeCalibrationPoints(points: readonly CalibrationPoint[]): readonly CalibrationPoint[] {
  return points
    .filter((point) => finiteCoverage(point.nominal) && finiteCoverage(point.observed))
    .toSorted((left, right) => left.nominal - right.nominal);
}

const xFor = (value: number): number => 36 + value * 204;
const yFor = (value: number): number => 120 - value * 96;

export function CalibrationCurveChart({ points, className, title = "CONFORMAL CALIBRATION CURVE" }: CalibrationCurveChartProps) {
  const measured = normalizeCalibrationPoints(points);
  const target = measured.find((point) => point.nominal === 0.8);
  if (measured.length === 0) {
    return (
      <section className={`rounded-xl border border-pitwall-border bg-pitwall-card p-5 ${className ?? ""}`}>
        <h3 className="font-black text-xs tracking-widest">{title}</h3>
        <p className="mt-3 text-xs text-pitwall-muted">No empirical calibration points are available.</p>
      </section>
    );
  }

  const linePoints = measured.map((point) => `${xFor(point.nominal).toFixed(2)},${yFor(point.observed).toFixed(2)}`).join(" ");
  return (
    <section className={`rounded-xl border border-pitwall-border bg-pitwall-card p-5 ${className ?? ""}`}>
      <h3 className="font-black text-xs tracking-widest">{title}</h3>
      <p className="mt-1 text-xs text-pitwall-muted">Nominal confidence versus measured coverage. The diagonal marks ideal calibration.</p>
      <svg viewBox="0 0 276 150" className="mt-4 h-[150px] w-full" role="img" aria-label="Calibration curve showing only supplied nominal and measured coverage points">
        <line x1="36" y1="120" x2="240" y2="24" className="stroke-pitwall-border" strokeDasharray="4 4" />
        <line x1="36" y1="24" x2="36" y2="120" className="stroke-pitwall-steel" />
        <line x1="36" y1="120" x2="240" y2="120" className="stroke-pitwall-steel" />
        <text x="36" y="138" fontSize="9" className="fill-pitwall-muted">0%</text>
        <text x="226" y="138" fontSize="9" className="fill-pitwall-muted">100%</text>
        <text x="8" y="120" fontSize="9" className="fill-pitwall-muted">0%</text>
        <text x="3" y="28" fontSize="9" className="fill-pitwall-muted">100%</text>
        {measured.length > 1 && <polyline fill="none" className="stroke-pitwall-cyan" strokeWidth="2" points={linePoints} />}
        {measured.map((point) => {
          const isTarget = point.nominal === 0.8;
          const label = point.label ?? `${Math.round(point.nominal * 100)}%`;
          return (
            <g key={`${point.nominal}-${point.observed}`}>
              <circle cx={xFor(point.nominal)} cy={yFor(point.observed)} r="4" className={isTarget ? "fill-pitwall-accent stroke-pitwall-bg" : "fill-pitwall-cyan stroke-pitwall-bg"} strokeWidth="1.5" />
              <text x={xFor(point.nominal) + 6} y={yFor(point.observed) - 6} fontSize="9" className="fill-pitwall-fog">{label} {Math.round(point.observed * 100)}%</text>
            </g>
          );
        })}
      </svg>
      {target && <p className="mt-2 text-xs">80% target: <span className="font-mono font-black">{(target.observed * 100).toFixed(1)}%</span> measured coverage</p>}
    </section>
  );
}
