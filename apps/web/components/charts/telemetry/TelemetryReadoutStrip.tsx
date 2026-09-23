import * as React from "react";
import { cn } from "@/lib/utils";
import type { NormalizedPoint } from "./types";

export interface TelemetryReadoutStripProps {
  isTimestamp: boolean;
  unitLabel: string;
  minAxis: number;
  curPointA: NormalizedPoint;
  curPointB: NormalizedPoint | null;
}

export function TelemetryReadoutStrip({
  isTimestamp,
  unitLabel,
  minAxis,
  curPointA,
  curPointB,
}: TelemetryReadoutStripProps) {
  const deltaSpeed = curPointB ? curPointA.speed - curPointB.speed : 0;
  const deltaThrottle = curPointB ? curPointA.throttle - curPointB.throttle : 0;
  const deltaBrake = curPointB ? curPointA.brake - curPointB.brake : 0;

  return (
    <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs font-mono pt-2 border-t border-pitwall-border/60">
      <div className="bg-pitwall-bg/80 border border-pitwall-border rounded p-2">
        <div className="text-[10px] text-pitwall-steel uppercase tracking-wider flex items-center justify-between">
          <span>{isTimestamp ? "TIME / SAMPLE" : "DISTANCE"}</span>
          <span className="text-[9px] text-pitwall-cyan font-bold">
            {isTimestamp ? "SRC" : unitLabel}
          </span>
        </div>
        <div className="font-bold text-pitwall-ink mt-0.5 truncate">
          {isTimestamp
            ? curPointA.axisDisplay
            : `${Math.round(curPointA.distance)} ${unitLabel}`}
        </div>
        <div className="text-[9px] text-pitwall-muted truncate">
          {isTimestamp
            ? `Sample #${curPointA.sampleIndex + 1} (+${((curPointA.axisValue - minAxis) / 1000).toFixed(2)}s)`
            : `Sample #${curPointA.sampleIndex + 1}`}
        </div>
      </div>

      <div className="bg-pitwall-bg/80 border border-pitwall-border rounded p-2">
        <div className="text-[10px] text-pitwall-steel uppercase tracking-wider flex items-center justify-between">
          <span>SPEED</span>
          <span className="text-[9px] text-pitwall-cyan font-bold">km/h</span>
        </div>
        <div className="font-bold text-pitwall-ink mt-0.5 flex items-baseline gap-1.5">
          <span>{Math.round(curPointA.speed)}</span>
          {curPointB && (
            <span
              className={cn(
                "text-[10px] font-normal",
                deltaSpeed > 0
                  ? "text-emerald-400"
                  : deltaSpeed < 0
                  ? "text-rose-400"
                  : "text-pitwall-muted"
              )}
            >
              ({deltaSpeed > 0 ? "+" : ""}
              {deltaSpeed.toFixed(1)})
            </span>
          )}
        </div>
        <div className="text-[9px] text-pitwall-muted truncate">
          {curPointB ? `vs ${Math.round(curPointB.speed)} km/h` : "velocity"}
        </div>
      </div>

      <div className="bg-pitwall-bg/80 border border-pitwall-border rounded p-2">
        <div className="text-[10px] text-emerald-400 uppercase tracking-wider flex items-center justify-between">
          <span>THROTTLE</span>
          <span className="text-[9px] text-pitwall-steel">%</span>
        </div>
        <div className="font-bold text-emerald-400 mt-0.5 flex items-baseline gap-1.5">
          <span>{Math.round(curPointA.throttle)}%</span>
          {curPointB && (
            <span
              className={cn(
                "text-[10px] font-normal",
                deltaThrottle > 0
                  ? "text-emerald-300"
                  : deltaThrottle < 0
                  ? "text-rose-400"
                  : "text-pitwall-muted"
              )}
            >
              ({deltaThrottle > 0 ? "+" : ""}
              {Math.round(deltaThrottle)}%)
            </span>
          )}
        </div>
        <div className="text-[9px] text-pitwall-muted truncate">
          {curPointB ? `vs ${Math.round(curPointB.throttle)}%` : "input demand"}
        </div>
      </div>

      <div className="bg-pitwall-bg/80 border border-pitwall-border rounded p-2">
        <div className="text-[10px] text-rose-400 uppercase tracking-wider flex items-center justify-between">
          <span>BRAKE</span>
          <span className="text-[9px] text-pitwall-steel">%</span>
        </div>
        <div className="font-bold text-rose-400 mt-0.5 flex items-baseline gap-1.5">
          <span>{Math.round(curPointA.brake)}%</span>
          {curPointB && (
            <span
              className={cn(
                "text-[10px] font-normal",
                deltaBrake > 0
                  ? "text-rose-300"
                  : deltaBrake < 0
                  ? "text-emerald-400"
                  : "text-pitwall-muted"
              )}
            >
              ({deltaBrake > 0 ? "+" : ""}
              {Math.round(deltaBrake)}%)
            </span>
          )}
        </div>
        <div className="text-[9px] text-pitwall-muted truncate">
          {curPointB ? `vs ${Math.round(curPointB.brake)}%` : "pressure"}
        </div>
      </div>

      <div className="bg-pitwall-bg/80 border border-pitwall-border rounded p-2">
        <div className="text-[10px] text-purple-400 uppercase tracking-wider flex items-center justify-between">
          <span>GEAR / DRS</span>
          <span className="text-[9px] text-pitwall-steel">CH3</span>
        </div>
        <div className="font-bold text-pitwall-ink mt-0.5 flex items-center gap-2">
          <span>G{curPointA.gear}</span>
          <span
            className={cn(
              "px-1.5 py-0.2 rounded text-[9px] font-black",
              curPointA.drs
                ? "bg-purple-950 text-purple-300 border border-purple-600"
                : "bg-pitwall-border/40 text-pitwall-steel"
            )}
          >
            DRS {curPointA.drs ? "ON" : "OFF"}
          </span>
        </div>
        <div className="text-[9px] text-pitwall-muted truncate">
          {curPointB
            ? `vs G${curPointB.gear} (DRS ${curPointB.drs ? "ON" : "OFF"})`
            : "transmission"}
        </div>
      </div>
    </div>
  );
}
