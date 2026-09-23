import type { NormalizedPoint, TelemetryPoint, ValidationResult } from "./types";

export function parseTimestampMs(ts: unknown): number | null {
  if (typeof ts === "number" && !Number.isNaN(ts) && ts > 0) {
    return ts;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    if (!Number.isNaN(parsed)) return parsed;
    const num = Number(ts);
    if (!Number.isNaN(num) && num > 0) return num;
  }
  return null;
}

export function formatTimestamp(ts: unknown): string {
  if (typeof ts === "string") {
    return ts;
  }
  if (typeof ts === "number") {
    return String(ts);
  }
  return "-";
}

export function validateTelemetryTrace(points?: TelemetryPoint[] | null): ValidationResult {
  if (!points || !Array.isArray(points) || points.length === 0) {
    return { valid: false, reason: "empty_trace" };
  }

  let timestampCount = 0;
  let distanceCount = 0;
  let distanceMCount = 0;

  for (const p of points) {
    if (p.timestamp !== undefined && p.timestamp !== null && p.timestamp !== "") {
      const ms = parseTimestampMs(p.timestamp);
      if (ms !== null) timestampCount++;
    }
    if (typeof p.distance_m === "number" && !Number.isNaN(p.distance_m)) {
      distanceMCount++;
    }
    if (typeof p.distance === "number" && !Number.isNaN(p.distance)) {
      distanceCount++;
    }
  }

  const total = points.length;
  let axisMode: "timestamp" | "distance_m" | "distance" | null = null;

  if (timestampCount === total) {
    axisMode = "timestamp";
  } else if (distanceMCount === total) {
    axisMode = "distance_m";
  } else if (distanceCount === total) {
    axisMode = "distance";
  } else {
    if (timestampCount > 0 && timestampCount < total) {
      return { valid: false, reason: "missing_timestamps" };
    }
    return { valid: false, reason: "missing_axis" };
  }

  if (axisMode === "timestamp") {
    for (let i = 1; i < total; i++) {
      const prevMs = parseTimestampMs(points[i - 1].timestamp)!;
      const currMs = parseTimestampMs(points[i].timestamp)!;
      if (currMs < prevMs) {
        return { valid: false, reason: "out_of_order_timestamps" };
      }
    }
  } else {
    for (let i = 1; i < total; i++) {
      const prevDist = (points[i - 1].distance_m ?? points[i - 1].distance) as number;
      const currDist = (points[i].distance_m ?? points[i].distance) as number;
      if (currDist < prevDist) {
        return { valid: false, reason: "out_of_order_distance" };
      }
    }
  }

  for (const p of points) {
    const rawThr = p.throttle ?? p.throttle_pct;
    if (rawThr === undefined || rawThr === null || (rawThr as unknown) === "") {
      return { valid: false, reason: "missing_throttle" };
    }
    const thr = Number(rawThr);
    if (Number.isNaN(thr) || thr < 0 || thr > 100) {
      return { valid: false, reason: "corrupt_throttle_bounds" };
    }

    const rawBrk = p.brake ?? p.brake_pct;
    if (rawBrk === undefined || rawBrk === null || (rawBrk as unknown) === "") {
      return { valid: false, reason: "missing_brake" };
    }
    const brk = Number(rawBrk);
    if (Number.isNaN(brk) || brk < 0 || brk > 100) {
      return { valid: false, reason: "corrupt_brake_bounds" };
    }

    const rawSpd = p.speed ?? p.speed_kmh;
    if (rawSpd === undefined || rawSpd === null || (rawSpd as unknown) === "") {
      return { valid: false, reason: "missing_speed" };
    }
    const spd = Number(rawSpd);
    if (Number.isNaN(spd) || spd < 0 || spd > 450) {
      return { valid: false, reason: "corrupt_speed_bounds" };
    }

    if (p.gear === undefined || p.gear === null || (p.gear as unknown) === "") {
      return { valid: false, reason: "missing_gear" };
    }
    const gear = Number(p.gear);
    if (Number.isNaN(gear) || gear < 0 || gear > 8) {
      return { valid: false, reason: "corrupt_gear_bounds" };
    }

    if (p.drs === undefined || p.drs === null) {
      return { valid: false, reason: "missing_drs" };
    }
  }

  return { valid: true, axisMode };
}

export function normalizeTrace(points?: TelemetryPoint[] | null): NormalizedPoint[] {
  const validation = validateTelemetryTrace(points);
  if (!validation.valid || !validation.axisMode || !points) return [];

  const axisMode = validation.axisMode;
  return points.map((p, idx) => {
    let axisValue = 0;
    let axisDisplay = "";
    let distance = 0;

    if (axisMode === "timestamp") {
      axisValue = parseTimestampMs(p.timestamp)!;
      axisDisplay = formatTimestamp(p.timestamp);
      distance = typeof p.distance_m === "number" ? p.distance_m : typeof p.distance === "number" ? p.distance : Number.NaN;
    } else {
      axisValue = (p.distance_m ?? p.distance) as number;
      axisDisplay = `${Math.round(axisValue)} m`;
      distance = axisValue;
    }

    const rawSpeed = p.speed ?? p.speed_kmh;
    const speed = Number(rawSpeed);

    const rawThrottle = p.throttle ?? p.throttle_pct;
    const throttle = Number(rawThrottle);

    const rawBrake = p.brake ?? p.brake_pct;
    const brake = Number(rawBrake);

    const rawGear = p.gear;
    const gear = Math.round(Number(rawGear));

    const drs = Boolean(p.drs);

    return {
      sampleIndex: idx,
      axisValue,
      axisDisplay,
      distance,
      speed,
      throttle,
      brake,
      gear,
      drs,
      rawTimestamp: p.timestamp,
      rawDistance: p.distance_m ?? p.distance,
    };
  });
}

export function findClosestPoint(
  points: NormalizedPoint[],
  targetAxisValue: number
): NormalizedPoint {
  if (points.length === 0) {
    return {
      sampleIndex: 0,
      axisValue: 0,
      axisDisplay: "-",
      distance: 0,
      speed: 0,
      throttle: 0,
      brake: 0,
      gear: 0,
      drs: false,
    };
  }
  if (points.length === 1) return points[0];

  let low = 0;
  let high = points.length - 1;

  while (low <= high) {
    const mid = (low + high) >> 1;
    const midVal = points[mid].axisValue;
    if (midVal === targetAxisValue) return points[mid];
    if (midVal < targetAxisValue) low = mid + 1;
    else high = mid - 1;
  }

  const left = Math.max(0, Math.min(points.length - 1, high));
  const right = Math.max(0, Math.min(points.length - 1, low));
  const distLeft = Math.abs(points[left].axisValue - targetAxisValue);
  const distRight = Math.abs(points[right].axisValue - targetAxisValue);

  return distLeft <= distRight ? points[left] : points[right];
}
