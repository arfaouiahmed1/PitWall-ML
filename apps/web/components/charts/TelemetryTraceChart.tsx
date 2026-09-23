"use client";

import * as React from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  type DrsSegment,
  type DriverTelemetryMeta,
  type NormalizedPoint,
  type TelemetryPoint,
  type TelemetryTraceChartProps,
  type ValidationResult,
  CHART_LAYOUT,
} from "./telemetry/types";
import {
  findClosestPoint,
  formatTimestamp,
  normalizeTrace,
  parseTimestampMs,
  validateTelemetryTrace,
} from "./telemetry/validation";
import {
  buildAreaPath,
  buildSmoothLinePath,
  buildStepLinePath,
  extractDrsSegments,
} from "./telemetry/geometry";
import { TelemetryUnavailableCard } from "./telemetry/TelemetryUnavailableCard";
import { TelemetryReadoutStrip } from "./telemetry/TelemetryReadoutStrip";
import { TelemetryChannelSpeed } from "./telemetry/TelemetryChannelSpeed";
import { TelemetryChannelThrottleBrake } from "./telemetry/TelemetryChannelThrottleBrake";
import { TelemetryChannelGearDrs } from "./telemetry/TelemetryChannelGearDrs";
import { TelemetryScrubberOverlay } from "./telemetry/TelemetryScrubberOverlay";

export type {
  TelemetryPoint,
  DriverTelemetryMeta,
  TelemetryTraceChartProps,
  ValidationResult,
  NormalizedPoint,
};
export { parseTimestampMs, formatTimestamp, validateTelemetryTrace, normalizeTrace };

export function TelemetryTraceChart({
  traceA,
  traceB,
  driverA = { code: "A" },
  driverB,
  title = "MULTI-CHANNEL TELEMETRY TRACE",
  subtitle = "Synchronized speed, throttle, brake, gear, and DRS channels",
  className,
  distanceUnit,
  showControls = true,
}: TelemetryTraceChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverAxis, setHoverAxis] = useState<number | null>(null);

  const normA = useMemo(() => normalizeTrace(traceA), [traceA]);
  const normB = useMemo(() => normalizeTrace(traceB), [traceB]);
  const hasComparison = normB.length > 0;
  const isEmpty = normA.length === 0;

  const { width: W, padLeft: padL, padRight: padR, plotWidth: plotW } = CHART_LAYOUT;
  const { speedTop, speedHeight: speedH, throttleBrakeTop: tbTop, throttleBrakeHeight: tbH } = CHART_LAYOUT;
  const { gearTop, gearHeight: gearH, totalHeight: totalH } = CHART_LAYOUT;

  const colorA = driverA?.color || "#00d2be";
  const colorB = driverB?.color || "#ffffff";

  const validationA = useMemo(() => validateTelemetryTrace(traceA), [traceA]);
  const validationB = useMemo(() => validateTelemetryTrace(traceB), [traceB]);

  const { minAxis, maxAxis, unitLabel, isTimestamp } = useMemo(() => {
    if (isEmpty || !validationA.axisMode) {
      return { minAxis: 0, maxAxis: 100, unitLabel: "%", isTimestamp: false };
    }
    const allAxis = normA.map((p) => p.axisValue);
    if (hasComparison && validationB.axisMode === validationA.axisMode) {
      allAxis.push(...normB.map((p) => p.axisValue));
    }
    const minA = Math.min(...allAxis);
    const maxA = Math.max(...allAxis);
    const isTs = validationA.axisMode === "timestamp";
    const uLabel = isTs ? "s" : (distanceUnit || (validationA.axisMode === "distance_m" ? "m" : "%"));
    return {
      minAxis: minA,
      maxAxis: maxA > minA ? maxA : minA + 1,
      unitLabel: uLabel,
      isTimestamp: isTs,
    };
  }, [normA, normB, isEmpty, validationA.axisMode, hasComparison, validationB.axisMode, distanceUnit]);

  const { minSpeed, effectiveMaxSpeed, speedSpan } = useMemo(() => {
    if (isEmpty) return { minSpeed: 0, effectiveMaxSpeed: 350, speedSpan: 350 };
    const allSpd = normA.map((p) => p.speed);
    if (normB.length > 0) allSpd.push(...normB.map((p) => p.speed));
    const rawMin = Math.min(...allSpd);
    const rawMax = Math.max(...allSpd);
    const minS = Math.max(0, Math.floor(rawMin / 50) * 50);
    const maxS = Math.min(400, Math.ceil(rawMax / 50) * 50);
    const effMax = maxS > minS + 50 ? maxS : minS + 150;
    return { minSpeed: minS, effectiveMaxSpeed: effMax, speedSpan: effMax - minS || 1 };
  }, [normA, normB, isEmpty]);

  const speedPathA = useMemo(() => isEmpty ? "" : buildSmoothLinePath(normA, (p) => p.speed, minSpeed, effectiveMaxSpeed, padL, plotW, speedTop, speedH, minAxis, maxAxis), [normA, isEmpty, minSpeed, effectiveMaxSpeed, padL, plotW, speedTop, speedH, minAxis, maxAxis]);
  const speedAreaA = useMemo(() => isEmpty ? "" : buildAreaPath(normA, (p) => p.speed, minSpeed, effectiveMaxSpeed, padL, plotW, speedTop, speedH, minAxis, maxAxis), [normA, isEmpty, minSpeed, effectiveMaxSpeed, padL, plotW, speedTop, speedH, minAxis, maxAxis]);
  const speedPathB = useMemo(() => (isEmpty || !hasComparison) ? "" : buildSmoothLinePath(normB, (p) => p.speed, minSpeed, effectiveMaxSpeed, padL, plotW, speedTop, speedH, minAxis, maxAxis), [normB, isEmpty, hasComparison, minSpeed, effectiveMaxSpeed, padL, plotW, speedTop, speedH, minAxis, maxAxis]);

  const throttlePathA = useMemo(() => isEmpty ? "" : buildSmoothLinePath(normA, (p) => p.throttle, 0, 100, padL, plotW, tbTop, tbH, minAxis, maxAxis), [normA, isEmpty, padL, plotW, tbTop, tbH, minAxis, maxAxis]);
  const throttleAreaA = useMemo(() => isEmpty ? "" : buildAreaPath(normA, (p) => p.throttle, 0, 100, padL, plotW, tbTop, tbH, minAxis, maxAxis), [normA, isEmpty, padL, plotW, tbTop, tbH, minAxis, maxAxis]);
  const throttlePathB = useMemo(() => (isEmpty || !hasComparison) ? "" : buildSmoothLinePath(normB, (p) => p.throttle, 0, 100, padL, plotW, tbTop, tbH, minAxis, maxAxis), [normB, isEmpty, hasComparison, padL, plotW, tbTop, tbH, minAxis, maxAxis]);

  const brakePathA = useMemo(() => isEmpty ? "" : buildSmoothLinePath(normA, (p) => p.brake, 0, 100, padL, plotW, tbTop, tbH, minAxis, maxAxis), [normA, isEmpty, padL, plotW, tbTop, tbH, minAxis, maxAxis]);
  const brakeAreaA = useMemo(() => isEmpty ? "" : buildAreaPath(normA, (p) => p.brake, 0, 100, padL, plotW, tbTop, tbH, minAxis, maxAxis), [normA, isEmpty, padL, plotW, tbTop, tbH, minAxis, maxAxis]);
  const brakePathB = useMemo(() => (isEmpty || !hasComparison) ? "" : buildSmoothLinePath(normB, (p) => p.brake, 0, 100, padL, plotW, tbTop, tbH, minAxis, maxAxis), [normB, isEmpty, hasComparison, padL, plotW, tbTop, tbH, minAxis, maxAxis]);

  const gearPathA = useMemo(() => isEmpty ? "" : buildStepLinePath(normA, (p) => p.gear, 1, 8, padL, plotW, gearTop, gearH - 14, minAxis, maxAxis), [normA, isEmpty, padL, plotW, gearTop, gearH, minAxis, maxAxis]);
  const gearPathB = useMemo(() => (isEmpty || !hasComparison) ? "" : buildStepLinePath(normB, (p) => p.gear, 1, 8, padL, plotW, gearTop, gearH - 14, minAxis, maxAxis), [normB, isEmpty, hasComparison, padL, plotW, gearTop, gearH, minAxis, maxAxis]);
  const drsSegmentsA = useMemo(() => isEmpty ? [] : extractDrsSegments(normA, padL, plotW, minAxis, maxAxis), [normA, isEmpty, padL, plotW, minAxis, maxAxis]);

  const targetAxis = hoverAxis ?? normA[0]?.axisValue ?? minAxis;
  const curPointA = useMemo(() => isEmpty ? { sampleIndex: 0, axisValue: 0, axisDisplay: "-", distance: 0, speed: 0, throttle: 0, brake: 0, gear: 0, drs: false } : findClosestPoint(normA, targetAxis), [normA, isEmpty, targetAxis]);
  const curPointB = useMemo(() => (isEmpty || !hasComparison) ? null : findClosestPoint(normB, targetAxis), [normB, isEmpty, hasComparison, targetAxis]);

  const handlePointerScrub = useCallback((clientX: number) => {
    if (!svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const relativeX = clientX - rect.left;
    const svgScale = W / rect.width;
    const svgX = relativeX * svgScale;
    const clampedX = Math.max(padL, Math.min(W - padR, svgX));
    const frac = (clampedX - padL) / plotW;
    setHoverAxis(minAxis + Math.max(0, Math.min(1, frac)) * (maxAxis - minAxis));
  }, [plotW, padL, padR, W, minAxis, maxAxis]);

  const speedTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = effectiveMaxSpeed - minSpeed > 200 ? 100 : 50;
    for (let s = minSpeed + step; s < effectiveMaxSpeed; s += step) ticks.push(s);
    return ticks;
  }, [minSpeed, effectiveMaxSpeed]);

  const axisTicks = useMemo(() => {
    if (isEmpty) return [];
    const sourceTickIndexes = Array.from(new Set([0, Math.floor((normA.length - 1) / 4), Math.floor((normA.length - 1) / 2), Math.floor((normA.length - 1) * 0.75), normA.length - 1]));
    return sourceTickIndexes.map((index) => {
      const point = normA[index];
      const x = padL + ((point.axisValue - minAxis) / (maxAxis - minAxis || 1)) * plotW;
      return { x, label: isTimestamp ? point.axisDisplay : `${Math.round(point.axisValue)}${unitLabel}` };
    });
  }, [normA, minAxis, maxAxis, padL, plotW, isTimestamp, unitLabel, isEmpty]);

  if (isEmpty) {
    return <TelemetryUnavailableCard title={title} subtitle={subtitle} className={className} reason={validationA.reason} />;
  }

  const crossX = padL + ((curPointA.axisValue - minAxis) / (maxAxis - minAxis || 1)) * plotW;
  const curSpeedYA = speedTop + speedH - ((curPointA.speed - minSpeed) / speedSpan) * speedH;
  const curSpeedYB = curPointB ? speedTop + speedH - ((curPointB.speed - minSpeed) / speedSpan) * speedH : null;
  const curThrottleYA = tbTop + tbH - (curPointA.throttle / 100) * tbH;
  const curBrakeYA = tbTop + tbH - (curPointA.brake / 100) * tbH;
  const curGearYA = gearTop + (gearH - 14) - ((curPointA.gear - 1) / 7) * (gearH - 14);

  return (
    <Card className={cn("bg-pitwall-card border-pitwall-border overflow-hidden", className)}>
      <CardHeader className="p-4 border-b border-pitwall-border bg-pitwall-bg/60">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle className="text-xs font-black tracking-widest text-pitwall-fog flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-pitwall-cyan animate-pulse" />
              {title}
            </CardTitle>
            <CardDescription className="text-[11px] text-pitwall-muted mt-0.5">{subtitle}</CardDescription>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-pitwall-border bg-pitwall-bg">
              <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ backgroundColor: colorA }} />
              <span className="font-bold text-pitwall-ink">{driverA?.code || "A"}</span>
              {driverA?.number && <span className="text-[10px] text-pitwall-muted">#{driverA.number}</span>}
            </div>
            {hasComparison && driverB && (
              <>
                <span className="text-pitwall-steel text-[10px] font-bold">VS</span>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded border border-pitwall-border bg-pitwall-bg">
                  <span className="w-2.5 h-2.5 rounded-full border border-white/20" style={{ backgroundColor: colorB }} />
                  <span className="font-bold text-pitwall-ink">{driverB.code}</span>
                  {driverB.number && <span className="text-[10px] text-pitwall-muted">#{driverB.number}</span>}
                </div>
              </>
            )}
          </div>
        </div>
        <TelemetryReadoutStrip isTimestamp={isTimestamp} unitLabel={unitLabel} minAxis={minAxis} curPointA={curPointA} curPointB={curPointB} />
      </CardHeader>
      <CardContent className="p-2 sm:p-4 bg-pitwall-bg/40 select-none">
        <div className="relative w-full rounded border border-pitwall-border bg-pitwall-bg overflow-hidden">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${totalH}`}
            className="w-full h-auto block cursor-crosshair"
            onMouseMove={(e) => handlePointerScrub(e.clientX)}
            onTouchMove={(e) => e.touches.length > 0 && handlePointerScrub(e.touches[0].clientX)}
            onMouseLeave={() => setHoverAxis(null)}
          >
            <defs>
              <linearGradient id="speedGradA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={colorA} stopOpacity="0.25" /><stop offset="100%" stopColor={colorA} stopOpacity="0.0" /></linearGradient>
              <linearGradient id="throttleGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#10b981" stopOpacity="0.28" /><stop offset="100%" stopColor="#10b981" stopOpacity="0.02" /></linearGradient>
              <linearGradient id="brakeGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ef4444" stopOpacity="0.32" /><stop offset="100%" stopColor="#ef4444" stopOpacity="0.02" /></linearGradient>
            </defs>
            <TelemetryChannelSpeed padL={padL} padR={padR} plotW={plotW} speedTop={speedTop} speedH={speedH} minSpeed={minSpeed} effectiveMaxSpeed={effectiveMaxSpeed} speedSpan={speedSpan} speedTicks={speedTicks} drsSegmentsA={drsSegmentsA} speedAreaA={speedAreaA} speedPathA={speedPathA} speedPathB={speedPathB} colorA={colorA} colorB={colorB} />
            <TelemetryChannelThrottleBrake padL={padL} padR={padR} plotW={plotW} tbTop={tbTop} tbH={tbH} throttleAreaA={throttleAreaA} brakeAreaA={brakeAreaA} throttlePathB={throttlePathB} brakePathB={brakePathB} throttlePathA={throttlePathA} brakePathA={brakePathA} />
            <TelemetryChannelGearDrs padL={padL} padR={padR} plotW={plotW} gearTop={gearTop} gearH={gearH} drsSegmentsA={drsSegmentsA} gearPathB={gearPathB} gearPathA={gearPathA} />
            <g id="channel-axis-labels">
              {axisTicks.map((tick, i) => (
                <text key={`axis-tick-${i}`} x={tick.x} y={totalH - 8} fontSize={8} fill="#64748b" textAnchor="middle" fontFamily="monospace">{tick.label}</text>
              ))}
            </g>
            <TelemetryScrubberOverlay crossX={crossX} totalH={totalH} colorA={colorA} colorB={colorB} curSpeedYA={curSpeedYA} curSpeedYB={curSpeedYB} curThrottleYA={curThrottleYA} curBrakeYA={curBrakeYA} curGearYA={curGearYA} curPointB={curPointB} />
          </svg>
        </div>
        {showControls && (
          <div className="mt-2 px-1 flex items-center gap-3">
            <span className="text-[10px] font-mono text-pitwall-steel whitespace-nowrap">{isTimestamp ? "SCRUB SAMPLES:" : "SCRUB TRACK:"}</span>
            <input type="range" min={0} max={Math.max(0, normA.length - 1)} value={curPointA.sampleIndex} onChange={(e) => setHoverAxis(normA[Number(e.target.value)]?.axisValue ?? null)} className="flex-1 h-1.5 bg-pitwall-border rounded-lg appearance-none cursor-pointer accent-pitwall-cyan opacity-75 hover:opacity-100 transition-opacity" aria-label={isTimestamp ? "Scrub telemetry samples" : "Scrub telemetry distance"} />
            <span className="text-[10px] font-mono text-pitwall-muted min-w-[36px] text-right">#{curPointA.sampleIndex + 1}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default TelemetryTraceChart;
