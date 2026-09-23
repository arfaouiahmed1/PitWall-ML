import * as React from "react";

export interface TelemetryChannelThrottleBrakeProps {
  padL: number;
  padR: number;
  plotW: number;
  tbTop: number;
  tbH: number;
  throttleAreaA: string;
  brakeAreaA: string;
  throttlePathB: string;
  brakePathB: string;
  throttlePathA: string;
  brakePathA: string;
}

export function TelemetryChannelThrottleBrake({
  padL,
  padR,
  plotW,
  tbTop,
  tbH,
  throttleAreaA,
  brakeAreaA,
  throttlePathB,
  brakePathB,
  throttlePathA,
  brakePathA,
}: TelemetryChannelThrottleBrakeProps) {
  const chartRight = padL + plotW;

  return (
    <g id="channel-throttle-brake">
      <text
        x={padL}
        y={tbTop - 8}
        fontSize={9}
        fontWeight={800}
        fill="#cbd5e1"
        letterSpacing="0.08em"
      >
        THROTTLE & BRAKE (%)
      </text>

      <line
        x1={padL}
        x2={chartRight}
        y1={tbTop}
        y2={tbTop}
        stroke="#1e293b"
        strokeWidth={0.8}
      />
      <line
        x1={padL}
        x2={chartRight}
        y1={tbTop + tbH / 2}
        y2={tbTop + tbH / 2}
        stroke="#1e293b"
        strokeWidth={0.6}
        strokeDasharray="4 4"
      />
      <line
        x1={padL}
        x2={chartRight}
        y1={tbTop + tbH}
        y2={tbTop + tbH}
        stroke="#1e293b"
        strokeWidth={0.8}
      />

      <text
        x={padL - 8}
        y={tbTop + 3}
        fontSize={9}
        textAnchor="end"
        fill="#64748b"
        fontFamily="monospace"
      >
        100%
      </text>
      <text
        x={padL - 8}
        y={tbTop + tbH / 2 + 3}
        fontSize={9}
        textAnchor="end"
        fill="#475569"
        fontFamily="monospace"
      >
        50%
      </text>
      <text
        x={padL - 8}
        y={tbTop + tbH + 3}
        fontSize={9}
        textAnchor="end"
        fill="#64748b"
        fontFamily="monospace"
      >
        0%
      </text>

      {throttleAreaA && <path d={throttleAreaA} fill="url(#throttleGrad)" />}
      {brakeAreaA && <path d={brakeAreaA} fill="url(#brakeGrad)" />}

      {throttlePathB && (
        <path
          d={throttlePathB}
          fill="none"
          stroke="#10b981"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.7}
          strokeLinejoin="round"
        />
      )}
      {brakePathB && (
        <path
          d={brakePathB}
          fill="none"
          stroke="#ef4444"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          opacity={0.7}
          strokeLinejoin="round"
        />
      )}

      {throttlePathA && (
        <path
          d={throttlePathA}
          fill="none"
          stroke="#10b981"
          strokeWidth={2.0}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {brakePathA && (
        <path
          d={brakePathA}
          fill="none"
          stroke="#ef4444"
          strokeWidth={2.0}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}
