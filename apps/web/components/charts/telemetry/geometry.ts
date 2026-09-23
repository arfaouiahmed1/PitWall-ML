import type { DrsSegment, NormalizedPoint } from "./types";

export function buildSmoothLinePath(
  points: NormalizedPoint[],
  valueSelector: (p: NormalizedPoint) => number,
  minVal: number,
  maxVal: number,
  padL: number,
  plotW: number,
  topY: number,
  height: number,
  minAxis: number,
  maxAxis: number
): string {
  if (points.length === 0) return "";
  const axisSpan = maxAxis - minAxis || 1;
  const valSpan = maxVal - minVal || 1;

  return points
    .map((p, i) => {
      const x = padL + ((p.axisValue - minAxis) / axisSpan) * plotW;
      const y = topY + height - ((valueSelector(p) - minVal) / valSpan) * height;
      const cmd = i === 0 ? "M" : "L";
      return `${cmd} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export function buildStepLinePath(
  points: NormalizedPoint[],
  valueSelector: (p: NormalizedPoint) => number,
  minVal: number,
  maxVal: number,
  padL: number,
  plotW: number,
  topY: number,
  height: number,
  minAxis: number,
  maxAxis: number
): string {
  if (points.length === 0) return "";
  const axisSpan = maxAxis - minAxis || 1;
  const valSpan = maxVal - minVal || 1;

  let path = "";
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const x = padL + ((p.axisValue - minAxis) / axisSpan) * plotW;
    const y = topY + height - ((valueSelector(p) - minVal) / valSpan) * height;

    if (i === 0) {
      path += `M ${x.toFixed(1)} ${y.toFixed(1)}`;
    } else {
      const prevY =
        topY +
        height -
        ((valueSelector(points[i - 1]) - minVal) / valSpan) * height;
      path += ` L ${x.toFixed(1)} ${prevY.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`;
    }
  }
  return path;
}

export function buildAreaPath(
  points: NormalizedPoint[],
  valueSelector: (p: NormalizedPoint) => number,
  minVal: number,
  maxVal: number,
  padL: number,
  plotW: number,
  topY: number,
  height: number,
  minAxis: number,
  maxAxis: number
): string {
  if (points.length === 0) return "";
  const line = buildSmoothLinePath(
    points,
    valueSelector,
    minVal,
    maxVal,
    padL,
    plotW,
    topY,
    height,
    minAxis,
    maxAxis
  );
  if (!line) return "";

  const axisSpan = maxAxis - minAxis || 1;
  const firstX = padL + ((points[0].axisValue - minAxis) / axisSpan) * plotW;
  const lastX =
    padL +
    ((points[points.length - 1].axisValue - minAxis) / axisSpan) * plotW;
  const bottomY = topY + height;

  return `${line} L ${lastX.toFixed(1)} ${bottomY.toFixed(1)} L ${firstX.toFixed(1)} ${bottomY.toFixed(1)} Z`;
}

export function extractDrsSegments(
  points: NormalizedPoint[],
  padL: number,
  plotW: number,
  minAxis: number,
  maxAxis: number
): DrsSegment[] {
  const segments: DrsSegment[] = [];
  if (points.length < 2) return segments;

  const axisSpan = maxAxis - minAxis || 1;
  let inZone = false;
  let segStartAxis = 0;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.drs && !inZone) {
      inZone = true;
      segStartAxis = p.axisValue;
    } else if (!p.drs && inZone) {
      inZone = false;
      const segEndAxis = points[i - 1].axisValue;
      const startX = padL + ((segStartAxis - minAxis) / axisSpan) * plotW;
      const endX = padL + ((segEndAxis - minAxis) / axisSpan) * plotW;
      segments.push({ startX, width: Math.max(3, endX - startX) });
    }
  }

  if (inZone) {
    const lastAxis = points[points.length - 1].axisValue;
    const startX = padL + ((segStartAxis - minAxis) / axisSpan) * plotW;
    const endX = padL + ((lastAxis - minAxis) / axisSpan) * plotW;
    segments.push({ startX, width: Math.max(3, endX - startX) });
  }

  return segments;
}
