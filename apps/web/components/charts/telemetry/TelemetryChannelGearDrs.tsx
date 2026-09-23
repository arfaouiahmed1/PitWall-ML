import * as React from "react";
import type { DrsSegment } from "./types";

export interface TelemetryChannelGearDrsProps {
  padL: number;
  padR: number;
  plotW: number;
  gearTop: number;
  gearH: number;
  drsSegmentsA: DrsSegment[];
  gearPathB: string;
  gearPathA: string;
}

export function TelemetryChannelGearDrs({
  padL,
  padR,
  plotW,
  gearTop,
  gearH,
  drsSegmentsA,
  gearPathB,
  gearPathA,
}: TelemetryChannelGearDrsProps) {
  const chartRight = padL + plotW;

  return (
    <g id="channel-gear-drs">
      <text
        x={padL}
        y={gearTop - 8}
        fontSize={9}
        fontWeight={800}
        fill="#cbd5e1"
        letterSpacing="0.08em"
      >
        GEAR & DRS ACTIVATION
      </text>

      <line
        x1={padL}
        x2={chartRight}
        y1={gearTop}
        y2={gearTop}
        stroke="#1e293b"
        strokeWidth={0.8}
      />
      <line
        x1={padL}
        x2={chartRight}
        y1={gearTop + gearH - 14}
        y2={gearTop + gearH - 14}
        stroke="#1e293b"
        strokeWidth={0.8}
      />

      <text
        x={padL - 8}
        y={gearTop + 3}
        fontSize={9}
        textAnchor="end"
        fill="#64748b"
        fontFamily="monospace"
      >
        G8
      </text>
      <text
        x={padL - 8}
        y={gearTop + (gearH - 14) / 2 + 3}
        fontSize={9}
        textAnchor="end"
        fill="#475569"
        fontFamily="monospace"
      >
        G4
      </text>
      <text
        x={padL - 8}
        y={gearTop + gearH - 14 + 3}
        fontSize={9}
        textAnchor="end"
        fill="#64748b"
        fontFamily="monospace"
      >
        G1
      </text>

      <rect
        x={padL}
        y={gearTop + gearH - 10}
        width={plotW}
        height={10}
        fill="#1e293b"
        opacity={0.4}
      />
      {drsSegmentsA.map((seg, i) => (
        <g key={`drs-band-${i}`}>
          <rect
            x={seg.startX}
            y={gearTop + gearH - 10}
            width={seg.width}
            height={10}
            fill="#a855f7"
            opacity={0.85}
          />
          {seg.width > 24 && (
            <text
              x={seg.startX + seg.width / 2}
              y={gearTop + gearH - 2}
              fontSize={7.5}
              fontWeight={900}
              textAnchor="middle"
              fill="#ffffff"
              fontFamily="monospace"
            >
              DRS
            </text>
          )}
        </g>
      ))}

      {gearPathB && (
        <path
          d={gearPathB}
          fill="none"
          stroke="#a855f7"
          strokeWidth={1.4}
          strokeDasharray="4 3"
          opacity={0.65}
        />
      )}
      {gearPathA && (
        <path
          d={gearPathA}
          fill="none"
          stroke="#c084fc"
          strokeWidth={2.0}
        />
      )}
    </g>
  );
}
