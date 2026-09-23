"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { getCircuitGeometry } from "@/lib/circuits/registry";
import type { CircuitGeometry, CircuitId } from "@/lib/circuits/types";
import {
  calculateSplineLength,
  clampProgress,
  formatGap,
  getPointAtProgress,
  resolveDRS,
  resolveSectors,
  resolveSpeedTraps,
  resolveTurns,
  type DriverPoint,
  type Point,
  type TrackDriver,
} from "./trackUtils";
import { TrackOverlays } from "./TrackOverlays";

export {
  calculateSplineLength,
  clampProgress,
  getPointAtProgress,
  resolveDRS,
  resolveSectors,
  resolveSpeedTraps,
  resolveTurns,
};
export type { DriverPoint, Point, SectorDivision, TrackDriver } from "./trackUtils";

export type TrackGeometryProps = {
  circuit?: CircuitGeometry;
  circuitId?: CircuitId | string;
  drivers?: readonly TrackDriver[];
  className?: string;
  trackWidth?: number;
  ariaLabel?: string;
  showTurns?: boolean;
  showSectors?: boolean;
  showDRS?: boolean;
  showSpeedTraps?: boolean;
  showProvenance?: boolean;
  sectorColors?: Record<number, string>;
};

const DEFAULT_TRACK_WIDTH = 18;

export function TrackGeometry({
  circuit,
  circuitId,
  drivers = [],
  className = "",
  trackWidth = DEFAULT_TRACK_WIDTH,
  ariaLabel,
  showTurns = true,
  showSectors = true,
  showDRS = true,
  showSpeedTraps = true,
  showProvenance = false,
  sectorColors,
}: TrackGeometryProps) {
  const geometry = circuit ?? (circuitId ? getCircuitGeometry(circuitId) : undefined);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [domLength, setDomLength] = useState<number | null>(null);

  const splineLength = useMemo(() => {
    if (!geometry) return 0;
    return calculateSplineLength(geometry.normalizedCoordinates);
  }, [geometry]);

  const staticDriverPoints = useMemo<DriverPoint[]>(() => {
    if (!geometry || !drivers.length) return [];
    return drivers
      .map((driver) => {
        if (typeof driver.progress !== "number" || !Number.isFinite(driver.progress)) {
          return null;
        }
        const pt = getPointAtProgress(geometry, driver.progress);
        return pt ? { x: pt.x, y: pt.y, driver } : null;
      })
      .filter((p): p is DriverPoint => p !== null);
  }, [geometry, drivers]);

  const [domDriverPoints, setDomDriverPoints] = useState<DriverPoint[] | null>(null);

  useEffect(() => {
    if (!geometry) {
      setDomDriverPoints(null);
      setDomLength(null);
      return;
    }
    const path = pathRef.current;
    if (!path) {
      setDomDriverPoints(null);
      setDomLength(null);
      return;
    }

    try {
      const len = path.getTotalLength();
      if (!Number.isFinite(len) || len <= 0) {
        setDomDriverPoints(null);
        setDomLength(null);
        return;
      }
      setDomLength(len);

      setDomDriverPoints(
        drivers.map((driver) => {
          const point = path.getPointAtLength(clampProgress(driver.progress) * len);
          return { x: Number(point.x.toFixed(3)), y: Number(point.y.toFixed(3)), driver };
        })
      );
    } catch {
      setDomDriverPoints(null);
      setDomLength(null);
    }
  }, [geometry, drivers]);

  const driverPoints = domDriverPoints ?? staticDriverPoints;
  const effectiveLength = domLength && domLength > 0 ? domLength : splineLength;

  const turnMarkers = useMemo(() => {
    if (!showTurns) return [];
    return resolveTurns(geometry);
  }, [geometry, showTurns]);

  const drsSegments = useMemo(() => {
    if (!showDRS) return [];
    return resolveDRS(geometry);
  }, [geometry, showDRS]);

  const speedTraps = useMemo(() => {
    if (!showSpeedTraps) return [];
    return resolveSpeedTraps(geometry);
  }, [geometry, showSpeedTraps]);

  const sectors = useMemo(() => {
    if (!showSectors) return [];
    return resolveSectors(geometry);
  }, [geometry, showSectors]);

  const rootClassName = [
    "relative w-full overflow-hidden rounded-xl border border-pitwall-border bg-pitwall-bg",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  if (!geometry) {
    return (
      <div className={rootClassName} role="status" aria-live="polite">
        <div className="flex flex-col items-center justify-center p-8 text-center text-xs text-pitwall-muted">
          <span className="font-semibold text-pitwall-fog">Circuit geometry unavailable.</span>
          <span className="mt-1 block font-mono text-[11px] text-pitwall-steel">
            No source track geometry found for {circuitId ?? "unspecified circuit"}.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClassName}>
      <svg
        viewBox="0 0 1000 1000"
        className="block h-auto w-full"
        role="img"
        aria-label={ariaLabel ?? `${geometry.name} circuit telemetry map`}
        preserveAspectRatio="xMidYMid meet"
      >
        <title>{geometry.name}</title>
        <desc>
          {`Source: ${geometry.source.repository} (${geometry.source.license} license) revision ${geometry.source.revision.slice(0, 7)}`}
        </desc>
        <defs>
          <filter id={`track-glow-${geometry.id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Base track outline layers */}
        <path d={geometry.path} fill="none" stroke="#020617" strokeWidth={trackWidth + 10} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
        <path d={geometry.path} fill="none" stroke="#0f172a" strokeWidth={trackWidth + 4} strokeLinecap="round" strokeLinejoin="round" />
        <path ref={pathRef} d={geometry.path} fill="none" stroke="#1e293b" strokeWidth={trackWidth} strokeLinecap="round" strokeLinejoin="round" />

        {/* Sourced Overlay Layers */}
        <TrackOverlays
          geometry={geometry}
          pathRef={pathRef}
          measuredLength={effectiveLength}
          trackWidth={trackWidth}
          turnMarkers={turnMarkers}
          drsSegments={drsSegments}
          speedTraps={speedTraps}
          sectors={sectors}
          sectorColors={sectorColors}
        />

        {/* Centerline dashed guide */}
        <path d={geometry.path} fill="none" stroke="#e2e8f0" strokeWidth={1.2} strokeDasharray="5 12" strokeLinecap="round" opacity={0.32} />

        {/* Driver dot positions measured from authentic track spline */}
        {driverPoints.map(({ x, y, driver }) => (
          <g key={driver.driverNumber} className="cursor-help" style={{ transition: "all 350ms ease-out" }}>
            <title>{`${driver.code} - P${driver.position ?? "-"} - ${formatGap(driver.gap)} - ${driver.tyreCompound ?? "Unknown tyre"}`}</title>
            <circle cx={x} cy={y} r={21} fill={driver.color} opacity={0.2} />
            <circle cx={x} cy={y} r={13} fill="#020617" stroke={driver.color} strokeWidth={3} />
            <text x={x} y={y} textAnchor="middle" dominantBaseline="central" fill="#ffffff" fontSize="10" fontWeight="900" fontFamily="monospace">
              {driver.code}
            </text>
          </g>
        ))}
      </svg>

      <span className="sr-only">
        {`Map source: ${geometry.source.repository} (${geometry.source.license}). `}
      </span>

      {drivers.length > 0 && driverPoints.length === 0 && (
        <span className="sr-only">Driver positions will appear when the circuit path is measured.</span>
      )}

      {showProvenance && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-pitwall-border/40 bg-pitwall-card/60 px-3 py-1.5 text-[10px] text-pitwall-steel font-mono">
          <span>
            Source: {geometry.source.repository} ({geometry.source.license})
          </span>
          <span className="truncate max-w-[200px]" title={geometry.source.file}>
            {geometry.source.file}
          </span>
        </div>
      )}
    </div>
  );
}

export default TrackGeometry;
