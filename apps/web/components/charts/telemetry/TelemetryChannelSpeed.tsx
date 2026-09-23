import * as React from "react";
import type { DrsSegment } from "./types";

export interface TelemetryChannelSpeedProps {
  padL: number;
  padR: number;
  plotW: number;
  speedTop: number;
  speedH: number;
  minSpeed: number;
  effectiveMaxSpeed: number;
  speedSpan: number;
  speedTicks: number[];
  drsSegmentsA: DrsSegment[];
  speedAreaA: string;
  speedPathA: string;
  speedPathB: string;
  colorA: string;
  colorB: string;
}

export function TelemetryChannelSpeed({
  padL,
  padR,
  plotW,
  speedTop,
  speedH,
  minSpeed,
  effectiveMaxSpeed,
  speedSpan,
  speedTicks,
  drsSegmentsA,
  speedAreaA,
  speedPathA,
  speedPathB,
  colorA,
  colorB,
}: TelemetryChannelSpeedProps) {
  const chartRight = padL + plotW;

  return (
    <g id="channel-speed">
      <text
        x={padL}
        y={20}
        fontSize={9}
        fontWeight={800}
        fill="#cbd5e1"
        letterSpacing="0.08em"
      >
        SPEED (km/h)
      </text>

      {drsSegmentsA.map((seg, i) => (
        <rect
          key={`speed-drs-${i}`}
          x={seg.startX}
          y={speedTop}
          width={seg.width}
          height={speedH}
          fill="#a855f7"
          opacity={0.06}
        />
      ))}

      <line
        x1={padL}
        x2={chartRight}
        y1={speedTop}
        y2={speedTop}
        stroke="#1e293b"
        strokeWidth={0.8}
      />
      <line
        x1={padL}
        x2={chartRight}
        y1={speedTop + speedH}
        y2={speedTop + speedH}
        stroke="#1e293b"
        strokeWidth={0.8}
      />

      {speedTicks.map((tick) => {
        const y = speedTop + speedH - ((tick - minSpeed) / speedSpan) * speedH;
        return (
          <g key={`speed-tick-${tick}`}>
            <line
              x1={padL}
              x2={chartRight}
              y1={y}
              y2={y}
              stroke="#1e293b"
              strokeWidth={0.6}
              strokeDasharray="4 4"
            />
            <text
              x={padL - 8}
              y={y + 3}
              fontSize={9}
              textAnchor="end"
              fill="#64748b"
              fontFamily="monospace"
            >
              {tick}
            </text>
          </g>
        );
      })}

      <text
        x={padL - 8}
        y={speedTop + speedH + 3}
        fontSize={9}
        textAnchor="end"
        fill="#475569"
        fontFamily="monospace"
      >
        {minSpeed}
      </text>
      <text
        x={padL - 8}
        y={speedTop + 3}
        fontSize={9}
        textAnchor="end"
        fill="#475569"
        fontFamily="monospace"
      >
        {effectiveMaxSpeed}
      </text>

      {speedAreaA && <path d={speedAreaA} fill="url(#speedGradA)" />}
      {speedPathB && (
        <path
          d={speedPathB}
          fill="none"
          stroke={colorB}
          strokeWidth={1.8}
          strokeDasharray="5 3"
          opacity={0.85}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {speedPathA && (
        <path
          d={speedPathA}
          fill="none"
          stroke={colorA}
          strokeWidth={2.4}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </g>
  );
}
