import type {
  CircuitGeometry,
  DRSSegment,
  SectorDivision,
  SpeedTrap,
  TurnMarker,
} from "@/lib/circuits/types";

export type { SectorDivision } from "@/lib/circuits/types";

export type TrackDriver = {
  driverNumber: number;
  code: string;
  color: string;
  progress: number;
  position?: number;
  gap?: string | number;
  tyreCompound?: string;
};

export type Point = { x: number; y: number };
export type DriverPoint = Point & { driver: TrackDriver };

/**
 * Clamps fractional progress along the circuit spline to [0, 1].
 * Non-finite values safely default to 0.
 */
export function clampProgress(progress: number): number {
  if (typeof progress !== "number" || Number.isNaN(progress)) {
    return 0;
  }
  return Math.min(1, Math.max(0, progress));
}

/**
 * Calculates Euclidean length of a polyline from normalized coordinates.
 */
export function calculateSplineLength(
  coordinates?: readonly (readonly [number, number])[] | null
): number {
  if (!coordinates || !Array.isArray(coordinates) || coordinates.length < 2) {
    return 0;
  }
  let total = 0;
  for (let i = 1; i < coordinates.length; i++) {
    const prev = coordinates[i - 1];
    const curr = coordinates[i];
    if (prev && curr) {
      total += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
    }
  }
  return total;
}

/**
 * Maps fractional progress to exact [x, y] coordinates on the circuit polyline.
 * Guarantees coordinates lie directly on the authentic track path.
 */
export function getPointAtProgress(
  geometry?: CircuitGeometry | null,
  progress?: number | null
): Point | null {
  if (!geometry?.normalizedCoordinates || !Array.isArray(geometry.normalizedCoordinates)) {
    return null;
  }
  const coords = geometry.normalizedCoordinates;
  if (coords.length < 2) return null;

  const totalLength = calculateSplineLength(coords);
  if (totalLength <= 0) return null;

  const p = typeof progress === "number" ? clampProgress(progress) : 0;
  const targetDist = p * totalLength;
  let accumulated = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    if (!prev || !curr) continue;
    const dx = curr[0] - prev[0];
    const dy = curr[1] - prev[1];
    const segLen = Math.hypot(dx, dy);

    if (accumulated + segLen >= targetDist || i === coords.length - 1) {
      const segFraction = segLen > 0 ? (targetDist - accumulated) / segLen : 0;
      const t = Math.min(1, Math.max(0, segFraction));
      return {
        x: Number((prev[0] + dx * t).toFixed(3)),
        y: Number((prev[1] + dy * t).toFixed(3)),
      };
    }
    accumulated += segLen;
  }

  const last = coords[coords.length - 1];
  return last ? { x: last[0], y: last[1] } : null;
}

/**
 * Resolves sector divisions from circuit metadata.
 * Rejects unavailable, empty, or inverted sector boundaries.
 * NEVER fabricates or guesses equal-third splits (1/3, 2/3).
 */
export function resolveSectors(
  input?: CircuitGeometry | CircuitGeometry["overlays"] | null
): SectorDivision[] {
  if (!input || typeof input !== "object") {
    return [];
  }

  const overlays = "overlays" in input ? input.overlays : input;
  if (
    !overlays ||
    typeof overlays !== "object" ||
    !("sectors" in overlays) ||
    overlays.sectors === "unavailable" ||
    !Array.isArray(overlays.sectors) ||
    overlays.sectors.length === 0
  ) {
    return [];
  }

  const divisions: SectorDivision[] = [];
  for (const item of overlays.sectors) {
    if (typeof item !== "object" || item === null) continue;
    const s = item as Record<string, unknown>;
    const sectorNum = typeof s.sector === "number" ? s.sector : parseInt(String(s.sector), 10);
    const startVal =
      typeof s.startProgress === "number"
        ? s.startProgress
        : typeof s.start === "number"
        ? s.start
        : NaN;
    const endVal =
      typeof s.endProgress === "number"
        ? s.endProgress
        : typeof s.end === "number"
        ? s.end
        : NaN;

    if (
      Number.isFinite(sectorNum) &&
      sectorNum > 0 &&
      Number.isFinite(startVal) &&
      Number.isFinite(endVal) &&
      startVal < endVal
    ) {
      divisions.push({
        sector: sectorNum,
        startProgress: clampProgress(startVal),
        endProgress: clampProgress(endVal),
      });
    }
  }

  divisions.sort((a, b) => a.startProgress - b.startProgress || a.sector - b.sector);
  return divisions;
}

/**
 * Resolves turn markers, rejecting unavailable or non-array metadata.
 */
export function resolveTurns(
  input?: CircuitGeometry | CircuitGeometry["overlays"] | null
): TurnMarker[] {
  if (!input || typeof input !== "object") return [];
  const overlays = "overlays" in input ? input.overlays : input;
  if (!overlays || typeof overlays !== "object" || !("turns" in overlays) || overlays.turns === "unavailable" || !Array.isArray(overlays.turns)) {
    return [];
  }
  return overlays.turns.filter((t): t is TurnMarker => {
    return typeof t === "object" && t !== null && typeof (t as TurnMarker).number === "number";
  });
}

/**
 * Resolves DRS segments, rejecting unavailable metadata or invalid ranges.
 */
export function resolveDRS(
  input?: CircuitGeometry | CircuitGeometry["overlays"] | null
): DRSSegment[] {
  if (!input || typeof input !== "object") return [];
  const overlays = "overlays" in input ? input.overlays : input;
  if (!overlays || typeof overlays !== "object" || !("drs" in overlays) || overlays.drs === "unavailable" || !Array.isArray(overlays.drs)) {
    return [];
  }
  return overlays.drs.filter((d): d is DRSSegment => {
    if (typeof d !== "object" || d === null) return false;
    const drs = d as DRSSegment;
    return typeof drs.startProgress === "number" && typeof drs.endProgress === "number" && drs.startProgress < drs.endProgress;
  });
}

/**
 * Resolves speed traps, rejecting unavailable or non-array metadata.
 */
export function resolveSpeedTraps(
  input?: CircuitGeometry | CircuitGeometry["overlays"] | null
): SpeedTrap[] {
  if (!input || typeof input !== "object") return [];
  const overlays = "overlays" in input ? input.overlays : input;
  if (!overlays || typeof overlays !== "object" || !("speedTraps" in overlays) || overlays.speedTraps === "unavailable" || !Array.isArray(overlays.speedTraps)) {
    return [];
  }
  return overlays.speedTraps.filter((s): s is SpeedTrap => {
    return typeof s === "object" && s !== null;
  });
}

export function formatGap(gap?: string | number): string {
  if (typeof gap === "number") return `${gap >= 0 ? "+" : ""}${gap.toFixed(3)}s`;
  return gap ?? "LEADER";
}
