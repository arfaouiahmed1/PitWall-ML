import type { CircuitGeometry, CircuitId } from "./types";
import {
  BUNDLED_CIRCUITS,
} from "./data";

/**
 * Canonical dictionary of all 24 Formula 1 calendar circuits.
 * Indexed by canonical ID.
 */
export const CIRCUITS_REGISTRY: Readonly<Record<string, CircuitGeometry>> = Object.freeze(
  BUNDLED_CIRCUITS.reduce<Record<string, CircuitGeometry>>((acc, circuit) => {
    acc[circuit.id] = circuit;
    return acc;
  }, {})
);

/**
 * Array of all bundled authentic Formula 1 circuit vector geometries.
 * Compatible with legacy `CIRCUITS` exports in CircuitMap.tsx.
 */
export const CIRCUITS: readonly CircuitGeometry[] = BUNDLED_CIRCUITS;

/**
 * Alias map for circuit name lookup, country, and alternative spellings.
 */
export const CIRCUIT_ALIASES: Record<string, string> = Object.freeze({
  // Spielberg / Red Bull Ring / Austria
  austria: "spielberg",
  red_bull_ring: "spielberg",
  redbullring: "spielberg",
  spielberg: "spielberg",

  // Budapest / Hungaroring / Hungary
  hungaroring: "budapest",
  hungary: "budapest",
  budapest: "budapest",

  // Austin / COTA / Circuit of the Americas
  cota: "austin",
  circuit_of_the_americas: "austin",
  circuitoftheamericas: "austin",
  austin: "austin",

  // Sao Paulo / Interlagos / Jose Carlos Pace
  interlagos: "sao_paulo",
  jose_carlos_pace: "sao_paulo",
  saopaulo: "sao_paulo",
  sao_paulo: "sao_paulo",
  brazil: "sao_paulo",

  // Las Vegas
  lasvegas: "las_vegas",
  las_vegas: "las_vegas",
  vegas: "las_vegas",

  // Yas Marina / Abu Dhabi
  yasmarina: "yas_marina",
  yas_marina: "yas_marina",
  abudhabi: "yas_marina",
  abu_dhabi: "yas_marina",

  // Melbourne / Albert Park
  albert_park: "melbourne",
  albertpark: "melbourne",
  australia: "melbourne",
  melbourne: "melbourne",

  // Bahrain / Sakhir
  sakhir: "bahrain",
  bahrain: "bahrain",

  // Jeddah / Saudi Arabia
  saudi_arabia: "jeddah",
  saudi: "jeddah",
  jeddah: "jeddah",

  // Suzuka / Japan
  japan: "suzuka",
  suzuka: "suzuka",

  // Shanghai / China
  china: "shanghai",
  shanghai: "shanghai",

  // Miami
  miami: "miami",

  // Imola / Emilia-Romagna
  emilia_romagna: "imola",
  emiliaromagna: "imola",
  san_marino: "imola",
  imola: "imola",

  // Monaco / Monte Carlo
  monte_carlo: "monaco",
  montecarlo: "monaco",
  monaco: "monaco",

  // Montreal / Gilles Villeneuve / Canada
  gilles_villeneuve: "montreal",
  gillesvilleneuve: "montreal",
  canada: "montreal",
  montreal: "montreal",

  // Barcelona / Catalunya / Spain
  catalunya: "barcelona",
  spain: "barcelona",
  barcelona: "barcelona",

  // Silverstone / Great Britain / UK
  great_britain: "silverstone",
  greatbritain: "silverstone",
  britain: "silverstone",
  uk: "silverstone",
  silverstone: "silverstone",

  // Spa-Francorchamps / Belgium
  spa_francorchamps: "spa",
  spafrancorchamps: "spa",
  belgium: "spa",
  spa: "spa",

  // Zandvoort / Netherlands
  netherlands: "zandvoort",
  dutch: "zandvoort",
  zandvoort: "zandvoort",

  // Monza / Italy
  italy: "monza",
  monza: "monza",

  // Baku / Azerbaijan
  azerbaijan: "baku",
  baku: "baku",

  // Singapore / Marina Bay
  marina_bay: "singapore",
  marinabay: "singapore",
  singapore: "singapore",

  // Mexico City / Hermanos Rodriguez
  mexico_city: "mexico",
  mexicocity: "mexico",
  hermanos_rodriguez: "mexico",
  mexico: "mexico",

  // Lusail / Qatar
  qatar: "lusail",
  lusail: "lusail",

  // Madrid (2026 entry)
  madrid: "madrid",
});

/**
 * Normalizes an arbitrary circuit key or search string into a lookup key.
 */
function normalizeLookupKey(key: string): string {
  return key
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

/**
 * Retrieves the authentic vector geometry for a given circuit ID or alias.
 * If the circuit is unknown or not found, falls back safely to the Monza baseline
 * without throwing an exception.
 *
 * @param id Circuit ID, short name, or alias (e.g. "monza", "austria", "cota", "silverstone")
 * @returns Authentic CircuitGeometry
 */
export function getCircuitGeometry(id: CircuitId | string): CircuitGeometry | undefined {
  if (!id || typeof id !== "string") {
    return undefined;
  }

  const lookup = normalizeLookupKey(id);
  const resolvedId = CIRCUIT_ALIASES[lookup] ?? lookup;

  const found = CIRCUITS_REGISTRY[resolvedId];
  if (found) {
    return found;
  }

  return BUNDLED_CIRCUITS.find(
    (c) =>
      c.id === resolvedId ||
      c.name.toLowerCase().includes(lookup) ||
      c.location.toLowerCase().includes(lookup)
  );
}

/**
 * Returns all canonical Formula 1 circuit vector geometries.
 * Guarantees zero external network requests and instant in-memory lookup.
 */
export function getAllCircuits(): readonly CircuitGeometry[] {
  return [...BUNDLED_CIRCUITS];
}

/**
 * Calculates the bounding box of an SVG path string.
 */
function getPathBounds(pathStr: string): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
} {
  const numbers = pathStr.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < numbers.length; i += 2) {
    const x = numbers[i];
    const y = numbers[i + 1];
    if (x !== undefined && !Number.isNaN(x)) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
    if (y !== undefined && !Number.isNaN(y)) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const width = maxX > minX ? maxX - minX : 1;
  const height = maxY > minY ? maxY - minY : 1;
  return { minX, maxX, minY, maxY, width, height };
}

export type NormalizePathOptions = {
  targetSize?: number;
  padding?: number;
  scale?: number;
  offsetX?: number;
  offsetY?: number;
};

/**
 * Normalizes an SVG track path string into a target coordinate space (default: viewBox="0 0 1000 1000").
 * Preserves true curvature and aspect ratio (scale_x === scale_y) and centers the circuit with padding.
 *
 * @param path SVG path string (e.g. "M 140 440 L 520 440 ... Z")
 * @param options Target size, padding, or explicit linear transform
 * @returns Normalized SVG path string with integer coordinates
 */
export function normalizeTrackPath(path: string, options?: NormalizePathOptions): string {
  if (!path || typeof path !== "string") {
    return "";
  }

  const targetSize = options?.targetSize ?? 1000;
  const padding = options?.padding ?? 80;

  let scale: number;
  let offsetX: number;
  let offsetY: number;

  if (options?.scale !== undefined && options?.offsetX !== undefined && options?.offsetY !== undefined) {
    scale = options.scale;
    offsetX = options.offsetX;
    offsetY = options.offsetY;
  } else {
    const bounds = getPathBounds(path);
    const usable = Math.max(10, targetSize - 2 * padding);
    scale = usable / Math.max(bounds.width, bounds.height);
    offsetX = (targetSize - (bounds.minX + bounds.maxX) * scale) / 2;
    offsetY = (targetSize - (bounds.minY + bounds.maxY) * scale) / 2;
  }

  const transformPoint = (x: number, y: number) => ({
    x: Math.round(x * scale + offsetX),
    y: Math.round(y * scale + offsetY),
  });

  const tokens = path.trim().split(/\s+/);
  const outTokens: (string | number)[] = [];
  let i = 0;

  while (i < tokens.length) {
    const cmd = tokens[i++];
    outTokens.push(cmd);
    if (cmd === "M" || cmd === "L") {
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      const p = transformPoint(x, y);
      outTokens.push(p.x, p.y);
    } else if (cmd === "Q") {
      const cx = parseFloat(tokens[i++]);
      const cy = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      const cp = transformPoint(cx, cy);
      const p = transformPoint(x, y);
      outTokens.push(cp.x, cp.y, p.x, p.y);
    } else if (cmd === "C") {
      const c1x = parseFloat(tokens[i++]);
      const c1y = parseFloat(tokens[i++]);
      const c2x = parseFloat(tokens[i++]);
      const c2y = parseFloat(tokens[i++]);
      const x = parseFloat(tokens[i++]);
      const y = parseFloat(tokens[i++]);
      const cp1 = transformPoint(c1x, c1y);
      const cp2 = transformPoint(c2x, c2y);
      const p = transformPoint(x, y);
      outTokens.push(cp1.x, cp1.y, cp2.x, cp2.y, p.x, p.y);
    }
  }

  return outTokens.join(" ");
}

export default getCircuitGeometry;
