import * as React from "react";
import type { NormalizedPoint } from "./types";

export interface TelemetryScrubberOverlayProps {
  crossX: number;
  totalH: number;
  colorA: string;
  colorB: string;
  curSpeedYA: number;
  curSpeedYB: number | null;
  curThrottleYA: number;
  curBrakeYA: number;
  curGearYA: number;
  curPointB: NormalizedPoint | null;
}

export function TelemetryScrubberOverlay({
  crossX,
  totalH,
  colorA,
  colorB,
  curSpeedYA,
  curSpeedYB,
  curThrottleYA,
  curBrakeYA,
  curGearYA,
  curPointB,
}: TelemetryScrubberOverlayProps) {
  return (
    <g id="scrubber-crosshair">
      <line
        x1={crossX}
        x2={crossX}
        y1={24}
        y2={totalH - 24}
        stroke="#475569"
        strokeWidth={1.2}
        strokeDasharray="3 3"
      />

      {curPointB && curSpeedYB !== null && (
        <circle
          cx={crossX}
          cy={curSpeedYB}
          r={4}
          fill={colorB}
          stroke="#080c14"
          strokeWidth={1.5}
        />
      )}

      <circle
        cx={crossX}
        cy={curSpeedYA}
        r={4.5}
        fill={colorA}
        stroke="#080c14"
        strokeWidth={1.5}
      />

      <circle
        cx={crossX}
        cy={curThrottleYA}
        r={3.5}
        fill="#10b981"
        stroke="#080c14"
        strokeWidth={1.5}
      />

      <circle
        cx={crossX}
        cy={curBrakeYA}
        r={3.5}
        fill="#ef4444"
        stroke="#080c14"
        strokeWidth={1.5}
      />

      <circle
        cx={crossX}
        cy={curGearYA}
        r={3.5}
        fill="#e2e8f0"
        stroke="#080c14"
        strokeWidth={1.5}
      />
    </g>
  );
}
