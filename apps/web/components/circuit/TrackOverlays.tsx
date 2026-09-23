"use client";

import React, { type RefObject } from "react";
import type { CircuitGeometry, DRSSegment, SectorDivision, SpeedTrap, TurnMarker } from "@/lib/circuits/types";
import { calculateSplineLength, getPointAtProgress, type Point } from "./trackUtils";

export type TrackOverlaysProps = {
  geometry: CircuitGeometry;
  pathRef: RefObject<SVGPathElement | null>;
  measuredLength: number | null;
  trackWidth: number;
  turnMarkers: readonly TurnMarker[];
  drsSegments: readonly DRSSegment[];
  speedTraps: readonly SpeedTrap[];
  sectors: readonly SectorDivision[];
  sectorColors?: Record<number, string>;
};

export function TrackOverlays({
  geometry,
  measuredLength,
  trackWidth,
  turnMarkers,
  drsSegments,
  speedTraps,
  sectors,
  sectorColors,
}: TrackOverlaysProps) {
  const effectiveLength =
    measuredLength && measuredLength > 0
      ? measuredLength
      : calculateSplineLength(geometry.normalizedCoordinates);

  return (
    <>
      {/* Sourced Sector Overlay Layer (only rendered if sourced sectors exist) */}
      {sectors.length > 0 && effectiveLength > 0 && (
        <g data-overlay-type="sector-split" className="pointer-events-none">
          {sectors.map((sector) => (
            <g key={`sector-${sector.sector}`}>
              <title>{`Sector ${sector.sector} (${(sector.startProgress * 100).toFixed(1)}% - ${(sector.endProgress * 100).toFixed(1)}%)`}</title>
              <path
                d={geometry.path}
                fill="none"
                stroke={sectorColors?.[sector.sector] ?? (sector.sector === 1 ? "#3b82f6" : sector.sector === 2 ? "#eab308" : "#ef4444")}
                strokeWidth={trackWidth}
                strokeDasharray={`${(sector.endProgress - sector.startProgress) * effectiveLength} ${effectiveLength}`}
                strokeDashoffset={-(sector.startProgress * effectiveLength)}
                opacity={0.35}
              />
            </g>
          ))}
        </g>
      )}

      {/* Sourced DRS Zones (only rendered if sourced DRS metadata exists) */}
      {effectiveLength > 0 &&
        drsSegments.map((drs, idx) => (
          <g key={drs.id ?? `drs-${drs.zone ?? idx}`} data-overlay-type="drs" className="pointer-events-none">
            <title>{`DRS Zone ${drs.zone ?? idx + 1} (${(drs.startProgress * 100).toFixed(0)}% - ${(drs.endProgress * 100).toFixed(0)}%)`}</title>
            <path
              d={geometry.path}
              fill="none"
              stroke="#a855f7"
              strokeWidth={trackWidth + 4}
              strokeLinecap="round"
              strokeDasharray={`${(drs.endProgress - drs.startProgress) * effectiveLength} ${effectiveLength}`}
              strokeDashoffset={-(drs.startProgress * effectiveLength)}
              opacity={0.8}
            />
          </g>
        ))}

      {/* Sourced Turn Markers (only rendered if sourced turn metadata exists) */}
      {turnMarkers.map((marker) => {
        let pt: Point | null = null;
        if (typeof marker.progress === "number" && Number.isFinite(marker.progress)) {
          pt = getPointAtProgress(geometry, marker.progress);
        } else if (
          typeof marker.x === "number" &&
          Number.isFinite(marker.x) &&
          typeof marker.y === "number" &&
          Number.isFinite(marker.y)
        ) {
          pt = { x: marker.x, y: marker.y };
        }
        if (!pt) return null;
        const { x, y } = pt;
        return (
          <g key={`turn-${marker.number}`} data-overlay-type="turn" className="pointer-events-none">
            <title>{marker.label ?? `Turn ${marker.number}`}</title>
            <circle cx={x} cy={y} r={12} fill="#020617" stroke="#64748b" strokeWidth={1.5} />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#cbd5e1" fontSize="9" fontWeight="bold" fontFamily="monospace">
              {`T${marker.number}`}
            </text>
          </g>
        );
      })}

      {/* Sourced Speed Traps (only rendered if sourced speed trap metadata exists) */}
      {speedTraps.map((trap, idx) => {
        let pt: Point | null = null;
        if (typeof trap.progress === "number" && Number.isFinite(trap.progress)) {
          pt = getPointAtProgress(geometry, trap.progress);
        } else if (
          typeof trap.x === "number" &&
          Number.isFinite(trap.x) &&
          typeof trap.y === "number" &&
          Number.isFinite(trap.y)
        ) {
          pt = { x: trap.x, y: trap.y };
        }
        if (!pt) return null;
        const { x, y } = pt;
        return (
          <g key={trap.id ?? `trap-${idx}`} data-overlay-type="speed-trap" className="pointer-events-none">
            <title>{trap.label ?? "Speed Trap"}</title>
            <polygon
              points={`${x},${y - 8} ${x + 6},${y} ${x},${y + 8} ${x - 6},${y}`}
              fill="#f59e0b"
              stroke="#020617"
              strokeWidth={1.5}
            />
          </g>
        );
      })}
    </>
  );
}
