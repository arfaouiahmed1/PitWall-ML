import * as React from "react";
import { cn } from "@/lib/utils";
import type { GapTrajectoryPoint } from "./types";
import { formatDelta } from "./math";

export interface GapTrajectoryTooltipProps {
  activePoint: GapTrajectoryPoint;
  activeDelta: number;
  activeX: number;
  viewBoxW: number;
  baselineLabel: string;
  whatifLabel: string;
}

export function GapTrajectoryTooltip({
  activePoint,
  activeDelta,
  activeX,
  viewBoxW,
  baselineLabel,
  whatifLabel,
}: GapTrajectoryTooltipProps) {
  return (
    <div
      className="pointer-events-none absolute z-20 flex flex-col gap-1 rounded-md bg-pitwall-card/95 border border-pitwall-border px-2.5 py-1.5 shadow-lg backdrop-blur text-[10px] font-mono transition-transform duration-75"
      style={{
        left: `${(activeX / viewBoxW) * 100}%`,
        top: "14px",
        transform:
          activeX > viewBoxW * 0.72
            ? "translateX(-102%)"
            : activeX < viewBoxW * 0.28
            ? "translateX(6%)"
            : "translateX(-50%)",
      }}
    >
      <div className="flex items-center justify-between gap-3 border-b border-pitwall-border pb-1">
        <span className="font-bold text-pitwall-ink">LAP {activePoint.lap}</span>
        <span
          className={cn(
            "font-bold px-1.5 py-0.2 rounded text-[9px]",
            activeDelta < 0
              ? "bg-pitwall-green/15 text-pitwall-green border border-pitwall-green/30"
              : activeDelta > 0
              ? "bg-pitwall-danger/15 text-pitwall-danger border border-pitwall-danger/30"
              : "bg-pitwall-steel text-pitwall-muted"
          )}
        >
          Δ {formatDelta(activeDelta)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[9px] text-pitwall-muted pt-0.5">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#ff1801]" />
          {whatifLabel}:
        </span>
        <span className="font-semibold text-pitwall-ink">{formatDelta(activePoint.whatif)}</span>
      </div>
      <div className="flex items-center justify-between gap-4 text-[9px] text-pitwall-muted">
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-[#64748b]" />
          {baselineLabel}:
        </span>
        <span className="font-semibold text-pitwall-ink">{formatDelta(activePoint.baseline)}</span>
      </div>
    </div>
  );
}
