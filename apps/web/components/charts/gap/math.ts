export function buildSmoothSvgPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) {
    return `M ${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  }
  if (coords.length === 2) {
    return `M ${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)} L ${coords[1].x.toFixed(2)},${coords[1].y.toFixed(2)}`;
  }

  let path = `M ${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i === 0 ? 0 : i - 1];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2 < coords.length ? i + 2 : i + 1];

    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;

    path += ` C ${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(2)},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return path;
}

export function formatDelta(val: number, precision = 3): string {
  if (!Number.isFinite(val)) return "0.000s";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(precision)}s`;
}
