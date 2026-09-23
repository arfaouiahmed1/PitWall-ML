import * as React from "react";
import { useId, useMemo } from "react";
import { z } from "zod";
import { cn } from "@/lib/utils";
import type { PerformanceVector } from "@/lib/types";

export type PerformanceRadarValue = number | null | undefined;
export type PerformanceRadarAxisKey = keyof PerformanceVector | (string & {});

export type PerformanceRadarAxis<Key extends string = PerformanceRadarAxisKey> = {
  readonly key: Key;
  readonly label: string;
  readonly minimum: number;
  readonly maximum: number;
};

export type PerformanceRadarSeries<Key extends string = PerformanceRadarAxisKey> = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly values: Readonly<Partial<Record<Key, PerformanceRadarValue>>>;
};

export type PerformanceRadarChartProps<Key extends string = PerformanceRadarAxisKey> = {
  readonly axes?: readonly PerformanceRadarAxis<Key>[];
  readonly series: readonly PerformanceRadarSeries<Key>[];
  readonly title?: string;
  readonly description?: string;
  readonly className?: string;
};

type RadarPoint<Key extends string> = {
  readonly axis: Key;
  readonly x: number;
  readonly y: number;
};

type RadarSeriesModel<Key extends string> = {
  readonly id: string;
  readonly label: string;
  readonly color: string;
  readonly points: readonly RadarPoint<Key>[];
  readonly missingAxes: readonly Key[];
};

export type PerformanceRadarModel<Key extends string = PerformanceRadarAxisKey> = {
  readonly status: "ready" | "partial" | "unavailable";
  readonly viewBox: "0 0 320 320";
  readonly axes: readonly PerformanceRadarAxis<Key>[];
  readonly series: readonly RadarSeriesModel<Key>[];
};

export const PerformanceRadarAxisSchema = z
  .object({
    key: z.string().min(1),
    label: z.string(),
    minimum: z.number().finite(),
    maximum: z.number().finite(),
  })
  .refine((axis) => axis.maximum > axis.minimum, {
    message: "Axis maximum must be strictly greater than minimum",
  });

export function parsePerformanceRadarAxis(axis: unknown): PerformanceRadarAxis | null {
  const result = PerformanceRadarAxisSchema.safeParse(axis);
  if (!result.success) {
    return null;
  }
  return {
    key: result.data.key,
    label: result.data.label,
    minimum: result.data.minimum,
    maximum: result.data.maximum,
  };
}

export function normalizePerformanceRadarAxes<Key extends string = PerformanceRadarAxisKey>(
  axes: readonly PerformanceRadarAxis<Key>[],
): readonly PerformanceRadarAxis<Key>[] {
  return axes.filter((axis) => parsePerformanceRadarAxis(axis) !== null);
}

const VIEWBOX_SIZE = 320;
const CENTER = VIEWBOX_SIZE / 2;
const RADIUS = 108;
const LABEL_RADIUS = 140;
const GRID_LEVELS = [0.25, 0.5, 0.75, 1] as const;

export const DEFAULT_PERFORMANCE_RADAR_AXES: readonly PerformanceRadarAxis[] = [
  { key: "highSpeed", label: "High speed", minimum: 0, maximum: 100 },
  { key: "lowSpeed", label: "Low speed", minimum: 0, maximum: 100 },
  { key: "traction", label: "Traction", minimum: 0, maximum: 100 },
  { key: "tyreConservation", label: "Tyre conservation", minimum: 0, maximum: 100 },
  { key: "energyEfficiency", label: "Energy efficiency", minimum: 0, maximum: 100 },
  { key: "reliability", label: "Reliability", minimum: 0, maximum: 100 },
];

function pointFor<Key extends string>(
  axis: PerformanceRadarAxis<Key>,
  index: number,
  axisCount: number,
  value: number,
): RadarPoint<Key> {
  const axisRange = axis.maximum - axis.minimum;
  const safeRange = Number.isFinite(axisRange) && axisRange > 0 ? axisRange : 1;
  const ratio = (value - axis.minimum) / safeRange;
  const safeAxisCount = Math.max(1, axisCount);
  const angle = (Math.PI * 2 * index) / safeAxisCount - Math.PI / 2;
  const radius = Math.max(0, Math.min(1, Number.isFinite(ratio) ? ratio : 0)) * RADIUS;
  const x = CENTER + Math.cos(angle) * radius;
  const y = CENTER + Math.sin(angle) * radius;
  return {
    axis: axis.key,
    x: Number.isFinite(x) ? x : CENTER,
    y: Number.isFinite(y) ? y : CENTER,
  };
}

function gridPoint(index: number, axisCount: number, ratio: number): { readonly x: number; readonly y: number } {
  if (axisCount <= 0) {
    return { x: CENTER, y: CENTER };
  }
  const angle = (Math.PI * 2 * index) / axisCount - Math.PI / 2;
  const x = CENTER + Math.cos(angle) * RADIUS * ratio;
  const y = CENTER + Math.sin(angle) * RADIUS * ratio;
  return {
    x: Number.isFinite(x) ? x : CENTER,
    y: Number.isFinite(y) ? y : CENTER,
  };
}

function pointList(points: readonly { readonly x: number; readonly y: number }[]): string {
  return points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(" ");
}

export function buildPerformanceRadarModel<Key extends string = PerformanceRadarAxisKey>({
  axes,
  series,
}: Pick<PerformanceRadarChartProps<Key>, "axes" | "series">): PerformanceRadarModel<Key> {
  const rawAxes = axes ?? [];
  const activeAxes: PerformanceRadarAxis<Key>[] = [];
  const excludedKeys: Key[] = [];

  for (const axis of rawAxes) {
    if (parsePerformanceRadarAxis(axis) !== null) {
      activeAxes.push(axis);
    } else {
      excludedKeys.push(axis.key);
    }
  }

  const radarSeries = series.map((entry) => {
    const missingAxes: Key[] = [...excludedKeys];
    const points: RadarPoint<Key>[] = [];

    activeAxes.forEach((axis, index) => {
      const value = entry.values[axis.key];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        missingAxes.push(axis.key);
        return;
      }
      points.push(pointFor(axis, index, activeAxes.length, value));
    });

    return { id: entry.id, label: entry.label, color: entry.color, points, missingAxes };
  });
  const hasMeasuredValues = activeAxes.length > 0 && radarSeries.some((entry) => entry.points.length > 0);
  const hasUnavailableDimensions = radarSeries.some((entry) => entry.missingAxes.length > 0);
  const status = hasMeasuredValues ? (hasUnavailableDimensions ? "partial" : "ready") : "unavailable";

  return { status, viewBox: "0 0 320 320", axes: activeAxes, series: radarSeries };
}

export function PerformanceRadarChart({
  axes = DEFAULT_PERFORMANCE_RADAR_AXES,
  series,
  title = "Performance vector",
  description,
  className,
}: PerformanceRadarChartProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const model = useMemo(() => buildPerformanceRadarModel({ axes, series }), [axes, series]);
  const accessibleDescription = description ?? "Measured driver performance dimensions shown on a radar chart.";

  if (model.status === "unavailable") {
    return (
      <div className={cn("rounded-lg border border-pitwall-border bg-pitwall-bg p-4 text-sm text-pitwall-muted", className)} role="status">
        <p className="font-mono font-bold text-pitwall-fog">Performance vector unavailable</p>
        <p className="mt-1 text-xs">Measured performance dimensions are not available for this driver comparison.</p>
      </div>
    );
  }

  return (
    <figure className={cn("w-full", className)}>
      <svg className="block h-auto w-full" viewBox={model.viewBox} role="img" aria-labelledby={`${chartId}-title ${chartId}-description`} preserveAspectRatio="xMidYMid meet">
        <title id={`${chartId}-title`}>{title}</title>
        <desc id={`${chartId}-description`}>{accessibleDescription}</desc>
        {GRID_LEVELS.map((level) => (
          <polygon key={level} points={pointList(model.axes.map((_, index) => gridPoint(index, model.axes.length, level)))} fill="none" stroke="hsl(var(--border))" strokeWidth="1" />
        ))}
        {model.axes.map((axis, index) => {
          const endpoint = gridPoint(index, model.axes.length, 1);
          const labelPoint = gridPoint(index, model.axes.length, LABEL_RADIUS / RADIUS);
          return (
            <g key={axis.key}>
              <line x1={CENTER} y1={CENTER} x2={endpoint.x} y2={endpoint.y} stroke="hsl(var(--border))" strokeWidth="1" />
              <text x={labelPoint.x} y={labelPoint.y} textAnchor="middle" dominantBaseline="middle" className="fill-pitwall-muted text-[11px] font-mono">
                {axis.label}
              </text>
            </g>
          );
        })}
        {model.series.map((entry) => {
          const points = pointList(entry.points);
          if (entry.missingAxes.length === 0 && entry.points.length === model.axes.length) {
            return <polygon key={entry.id} points={points} fill={entry.color} fillOpacity="0.18" stroke={entry.color} strokeWidth="2" strokeLinejoin="round" />;
          }
          return <polyline key={entry.id} points={points} fill="none" stroke={entry.color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />;
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-pitwall-muted">
        {model.series.map((entry) => <span key={entry.id} className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ backgroundColor: entry.color }} />{entry.label}</span>)}
        {model.status === "partial" ? <span>Unavailable dimensions are omitted.</span> : null}
      </figcaption>
    </figure>
  );
}
