"use client";

import * as React from "react";
import { useCallback, useId, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { normalizeGapTrajectory } from "@/lib/types";
import {
  type GapTrajectoryChartProps,
  type GapTrajectoryPoint,
  type LegacyGapPoint,
  GAP_CHART_LAYOUT,
} from "./gap/types";
import { buildSmoothSvgPath, formatDelta } from "./gap/math";
import { GapTrajectoryTooltip } from "./gap/GapTrajectoryTooltip";
import { GapTrajectorySvg } from "./gap/GapTrajectorySvg";

export type { GapTrajectoryChartProps, GapTrajectoryPoint, LegacyGapPoint };

export function GapTrajectoryChart({
  points,
  data,
  className,
  height,
  baselineLabel = "Baseline",
  whatifLabel = "What-If",
  title = "GAP TRAJECTORY • BASELINE vs WHAT-IF",
  showLegend = true,
  showZeroAxis = true,
  ariaLabel,
}: GapTrajectoryChartProps) {
  const chartId = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const rawInput = useMemo(() => points ?? data ?? [], [points, data]);
  const normalizedPoints = useMemo(() => normalizeGapTrajectory(rawInput), [rawInput]);
  const pointsCount = normalizedPoints.length;

  const { viewBoxW, viewBoxH, padLeft, padRight, padTop, padBottom } = GAP_CHART_LAYOUT;
  const chartWidth = viewBoxW - padLeft - padRight;
  const chartHeight = viewBoxH - padTop - padBottom;
  const bottomY = padTop + chartHeight;

  const { yMin, yMax, yRange, zeroY } = useMemo(() => {
    if (pointsCount === 0) {
      return { yMin: -0.5, yMax: 0.5, yRange: 1.0, zeroY: padTop + chartHeight / 2 };
    }
    const allValues = normalizedPoints.flatMap((p) => [p.baseline, p.whatif]);
    const boundedMin = Math.min(0, Math.min(...allValues));
    const boundedMax = Math.max(0, Math.max(...allValues));
    const yMinCalc = boundedMin - 0.5;
    const yMaxCalc = boundedMax + 0.5;
    const yRangeCalc = Math.max(1e-4, yMaxCalc - yMinCalc);
    const zeroClamped = Math.max(yMinCalc, Math.min(yMaxCalc, 0));
    const zeroYCalc = padTop + ((yMaxCalc - zeroClamped) / yRangeCalc) * chartHeight;
    return { yMin: yMinCalc, yMax: yMaxCalc, yRange: yRangeCalc, zeroY: zeroYCalc };
  }, [normalizedPoints, pointsCount, chartHeight, padTop]);

  const getX = useCallback((index: number) => {
    if (pointsCount <= 1) return padLeft + chartWidth / 2;
    return padLeft + (index / (pointsCount - 1)) * chartWidth;
  }, [pointsCount, chartWidth, padLeft]);

  const getY = useCallback((val: number) => {
    const clamped = Math.max(yMin, Math.min(yMax, val));
    return padTop + ((yMax - clamped) / yRange) * chartHeight;
  }, [yMin, yMax, yRange, chartHeight, padTop]);

  const baseCoords = useMemo(() => normalizedPoints.map((p, i) => ({ x: getX(i), y: getY(p.baseline) })), [normalizedPoints, getX, getY]);
  const whatifCoords = useMemo(() => normalizedPoints.map((p, i) => ({ x: getX(i), y: getY(p.whatif) })), [normalizedPoints, getX, getY]);

  const baseLinePath = useMemo(() => buildSmoothSvgPath(baseCoords), [baseCoords]);
  const whatifLinePath = useMemo(() => buildSmoothSvgPath(whatifCoords), [whatifCoords]);

  const baseAreaPath = useMemo(() => {
    if (baseCoords.length < 2) return "";
    return `${baseLinePath} L ${baseCoords[baseCoords.length - 1].x.toFixed(2)},${bottomY.toFixed(2)} L ${baseCoords[0].x.toFixed(2)},${bottomY.toFixed(2)} Z`;
  }, [baseLinePath, baseCoords, bottomY]);

  const whatifAreaPath = useMemo(() => {
    if (whatifCoords.length < 2) return "";
    return `${whatifLinePath} L ${whatifCoords[whatifCoords.length - 1].x.toFixed(2)},${bottomY.toFixed(2)} L ${whatifCoords[0].x.toFixed(2)},${bottomY.toFixed(2)} Z`;
  }, [whatifLinePath, whatifCoords, bottomY]);

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pointsCount === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    const relX = e.clientX - rect.left;
    const svgX = (relX / rect.width) * viewBoxW;
    const clampedX = Math.max(padLeft, Math.min(viewBoxW - padRight, svgX));
    const fraction = (clampedX - padLeft) / chartWidth;
    const closestIdx = Math.round(fraction * (pointsCount - 1));
    setHoverIdx(Math.max(0, Math.min(pointsCount - 1, closestIdx)));
  };

  const activePoint = hoverIdx !== null && hoverIdx < pointsCount ? normalizedPoints[hoverIdx] : null;
  const activeX = hoverIdx !== null ? getX(hoverIdx) : null;
  const activeBaseY = activePoint ? getY(activePoint.baseline) : null;
  const activeWhatifY = activePoint ? getY(activePoint.whatif) : null;
  const activeDelta = activePoint ? activePoint.whatif - activePoint.baseline : null;

  const lastPoint = pointsCount > 0 ? normalizedPoints[pointsCount - 1] : null;
  const summaryDelta = lastPoint ? lastPoint.whatif - lastPoint.baseline : null;

  const baselineGradId = `gap-grad-baseline-${chartId}`;
  const whatifGradId = `gap-grad-whatif-${chartId}`;

  return (
    <div className={cn("rounded-xl bg-pitwall-card border border-pitwall-border p-4 text-pitwall-ink", className)}>
      {showLegend && (
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="text-[11px] tracking-widest text-pitwall-muted font-bold">{title}</span>
            <span className="text-[10px] px-2 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-muted font-mono">
              {pointsCount} {pointsCount === 1 ? "lap" : "laps"}
            </span>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            {activePoint && activeDelta !== null ? (
              <span className="flex items-center gap-1.5">
                <span className="text-pitwall-muted">L{activePoint.lap} Δ:</span>
                <span className={cn("font-bold", activeDelta < 0 ? "text-pitwall-green" : activeDelta > 0 ? "text-pitwall-danger" : "text-pitwall-muted")}>
                  {formatDelta(activeDelta)}
                </span>
                <span className="text-pitwall-muted text-[9px]">
                  (What-If: {formatDelta(activePoint.whatif, 2)} | Base: {formatDelta(activePoint.baseline, 2)})
                </span>
              </span>
            ) : summaryDelta !== null && lastPoint ? (
              <span className="flex items-center gap-1.5 text-pitwall-muted">
                <span>Final L{lastPoint.lap} Δ:</span>
                <span className={cn("font-bold", summaryDelta < 0 ? "text-pitwall-green" : summaryDelta > 0 ? "text-pitwall-danger" : "text-pitwall-muted")}>
                  {formatDelta(summaryDelta)}
                </span>
              </span>
            ) : (
              <span className="text-pitwall-muted text-[10px]">Awaiting trajectory data</span>
            )}
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        onPointerMove={handlePointerMove}
        onPointerLeave={() => setHoverIdx(null)}
        className="relative bg-pitwall-bg rounded-lg border border-pitwall-border p-3 select-none touch-none"
        style={height ? { minHeight: height } : undefined}
      >
        <GapTrajectorySvg
          ariaLabel={ariaLabel}
          baselineGradId={baselineGradId}
          whatifGradId={whatifGradId}
          showZeroAxis={showZeroAxis}
          zeroY={zeroY}
          yMax={yMax}
          yMin={yMin}
          bottomY={bottomY}
          chartWidth={chartWidth}
          chartHeight={chartHeight}
          pointsCount={pointsCount}
          normalizedPoints={normalizedPoints}
          baseAreaPath={baseAreaPath}
          whatifAreaPath={whatifAreaPath}
          baseLinePath={baseLinePath}
          whatifLinePath={whatifLinePath}
          baseCoords={baseCoords}
          whatifCoords={whatifCoords}
          getX={getX}
          hoverIdx={hoverIdx}
          activePoint={activePoint}
          activeX={activeX}
          activeBaseY={activeBaseY}
          activeWhatifY={activeWhatifY}
          activeDelta={activeDelta}
        />
        {hoverIdx !== null && activePoint && activeDelta !== null && activeX !== null && (
          <GapTrajectoryTooltip
            activePoint={activePoint}
            activeDelta={activeDelta}
            activeX={activeX}
            viewBoxW={viewBoxW}
            baselineLabel={baselineLabel}
            whatifLabel={whatifLabel}
          />
        )}
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-3 text-[10px]">
        <span className="flex items-center gap-1.5 text-pitwall-muted">
          <span className="w-3 h-0.5 bg-[#64748b] rounded-full" />
          <span>{baselineLabel}</span>
        </span>
        <span className="flex items-center gap-1.5 text-pitwall-muted">
          <span className="w-3 h-0.5 bg-pitwall-accent rounded-full" />
          <span>{whatifLabel}</span>
        </span>
        <span className="ml-auto text-pitwall-muted font-mono text-[9px]">
          gap ahead (s) • divergence = strategy effect
        </span>
      </div>
    </div>
  );
}

export default GapTrajectoryChart;
