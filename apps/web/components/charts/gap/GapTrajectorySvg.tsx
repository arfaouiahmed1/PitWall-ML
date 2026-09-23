import * as React from "react";
import { type GapTrajectoryPoint, GAP_CHART_LAYOUT } from "./types";

export interface GapTrajectorySvgProps {
  ariaLabel?: string;
  baselineGradId: string;
  whatifGradId: string;
  showZeroAxis: boolean;
  zeroY: number;
  yMax: number;
  yMin: number;
  bottomY: number;
  chartWidth: number;
  chartHeight: number;
  pointsCount: number;
  normalizedPoints: GapTrajectoryPoint[];
  baseAreaPath: string;
  whatifAreaPath: string;
  baseLinePath: string;
  whatifLinePath: string;
  baseCoords: { x: number; y: number }[];
  whatifCoords: { x: number; y: number }[];
  getX: (index: number) => number;
  hoverIdx: number | null;
  activePoint: GapTrajectoryPoint | null;
  activeX: number | null;
  activeBaseY: number | null;
  activeWhatifY: number | null;
  activeDelta: number | null;
}

export function GapTrajectorySvg({
  ariaLabel,
  baselineGradId,
  whatifGradId,
  showZeroAxis,
  zeroY,
  yMax,
  yMin,
  bottomY,
  chartWidth,
  chartHeight,
  pointsCount,
  normalizedPoints,
  baseAreaPath,
  whatifAreaPath,
  baseLinePath,
  whatifLinePath,
  baseCoords,
  whatifCoords,
  getX,
  hoverIdx,
  activePoint,
  activeX,
  activeBaseY,
  activeWhatifY,
  activeDelta,
}: GapTrajectorySvgProps) {
  const { viewBoxW, viewBoxH, padLeft, padRight, padTop } = GAP_CHART_LAYOUT;

  return (
    <svg
      viewBox={`0 0 ${viewBoxW} ${viewBoxH}`}
      className="w-full h-auto max-h-[160px] overflow-visible"
      role="img"
      aria-label={ariaLabel ?? "Gap trajectory chart: baseline versus what-if gap ahead in seconds by lap"}
    >
      <defs>
        <linearGradient id={baselineGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#64748b" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#64748b" stopOpacity="0.0" />
        </linearGradient>
        <linearGradient id={whatifGradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ff1801" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ff1801" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      <line x1={padLeft} y1={padTop} x2={viewBoxW - padRight} y2={padTop} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="2 4" />
      <line x1={padLeft} y1={bottomY} x2={viewBoxW - padRight} y2={bottomY} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="2 4" />

      {showZeroAxis && (
        <g>
          <line x1={padLeft} y1={zeroY} x2={viewBoxW - padRight} y2={zeroY} stroke="#334155" strokeWidth={1.2} strokeDasharray="4 4" />
          <text x={padLeft - 6} y={zeroY + 3} textAnchor="end" fontSize={8} fill="#8b9bb4" fontFamily="monospace">0.0s</text>
        </g>
      )}

      <text x={padLeft - 6} y={padTop + 3} textAnchor="end" fontSize={7.5} fill="#64748b" fontFamily="monospace">
        {yMax >= 0 ? `+${yMax.toFixed(1)}s` : `${yMax.toFixed(1)}s`}
      </text>
      <text x={padLeft - 6} y={bottomY + 3} textAnchor="end" fontSize={7.5} fill="#64748b" fontFamily="monospace">
        {yMin >= 0 ? `+${yMin.toFixed(1)}s` : `${yMin.toFixed(1)}s`}
      </text>
      <text x={padLeft} y={10} fontSize={7.5} fill="#8b9bb4" fontFamily="monospace" letterSpacing="0.05em">GAP (s)</text>

      {pointsCount === 0 && (
        <text x={padLeft + chartWidth / 2} y={padTop + chartHeight / 2 + 4} textAnchor="middle" fontSize={10} fill="#64748b" fontFamily="monospace">
          No trajectory data recorded
        </text>
      )}

      {pointsCount > 1 && (
        <>
          <path d={baseAreaPath} fill={`url(#${baselineGradId})`} />
          <path d={whatifAreaPath} fill={`url(#${whatifGradId})`} />
          <path d={baseLinePath} fill="none" stroke="#64748b" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
          <path d={whatifLinePath} fill="none" stroke="#ff1801" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}

      {pointsCount === 1 && (
        <g>
          <line x1={baseCoords[0].x} y1={padTop} x2={baseCoords[0].x} y2={bottomY} stroke="#334155" strokeWidth={1} strokeDasharray="2 3" />
          <circle cx={baseCoords[0].x} cy={baseCoords[0].y} r={4} fill="#64748b" stroke="#080c14" strokeWidth={1.5} />
          <circle cx={whatifCoords[0].x} cy={whatifCoords[0].y} r={4.5} fill="#ff1801" stroke="#080c14" strokeWidth={1.5} />
        </g>
      )}

      {normalizedPoints.map((p, i) => {
        const shouldRender = pointsCount <= 8 || i === 0 || i === pointsCount - 1 || (pointsCount <= 16 && i % 2 === 0) || (pointsCount > 16 && i % 3 === 0);
        if (!shouldRender) return null;
        const x = getX(i);
        const isHovered = hoverIdx === i;
        return (
          <text key={i} x={x} y={viewBoxH - 8} textAnchor="middle" fontSize={isHovered ? 8 : 7} fontWeight={isHovered ? 700 : 500} fill={isHovered ? "#e2e8f0" : "#64748b"} fontFamily="monospace">
            L{p.lap}
          </text>
        );
      })}

      {hoverIdx !== null && activeX !== null && activeBaseY !== null && activeWhatifY !== null && activePoint && (
        <g>
          <line x1={activeX} y1={padTop} x2={activeX} y2={bottomY} stroke="#475569" strokeWidth={1.2} strokeDasharray="3 3" />
          <line x1={activeX} y1={activeBaseY} x2={activeX} y2={activeWhatifY} stroke={activeDelta !== null && activeDelta < 0 ? "#22c55e" : "#ef4444"} strokeWidth={1.5} opacity={0.6} />
          <circle cx={activeX} cy={activeBaseY} r={3.8} fill="#64748b" stroke="#080c14" strokeWidth={2} />
          <circle cx={activeX} cy={activeWhatifY} r={4.5} fill="#ff1801" stroke="#080c14" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}
