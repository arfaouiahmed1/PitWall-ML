import * as fs from "node:fs";
import * as path from "node:path";
import { CIRCUITS, getAllCircuits, getCircuitGeometry } from "../../apps/web/lib/circuits/registry";
import { CircuitGeometrySchema } from "../../apps/web/lib/circuits/types";

const SOURCE_REVISION = "394d8fbe70ef2c0b0c8d23ff7bee61fa09606055";
const PROJECTION_TOLERANCE = 0.00051;
const EXPECTED_IDS = [
  "austin", "baku", "barcelona", "bahrain", "budapest", "imola", "jeddah",
  "las_vegas", "lusail", "madrid", "melbourne", "mexico", "miami", "monaco",
  "monza", "montreal", "sao_paulo", "shanghai", "singapore", "silverstone",
  "spa", "spielberg", "suzuka", "yas_marina", "zandvoort",
] as const;

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function expectedProjectedPoints(coordinates: readonly (readonly [number, number])[]) {
  const latitude = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const longitude = coordinates.reduce((sum, [lon]) => sum + lon, 0) / coordinates.length;
  const projected = coordinates.map(([lon, lat]) => [
    (lon - longitude) * Math.cos((latitude * Math.PI) / 180), -(lat - latitude),
  ] as const);
  const minX = Math.min(...projected.map(([x]) => x));
  const maxX = Math.max(...projected.map(([x]) => x));
  const minY = Math.min(...projected.map(([, y]) => y));
  const maxY = Math.max(...projected.map(([, y]) => y));
  const scale = Math.min(840 / (maxX - minX), 840 / (maxY - minY));
  const offsetX = 500 - ((minX + maxX) * scale) / 2;
  const offsetY = 500 - ((minY + maxY) * scale) / 2;
  return projected.map(([x, y]) => [
    Number((x * scale + offsetX).toFixed(3)), Number((y * scale + offsetY).toFixed(3)),
  ] as const);
}

const circuits = getAllCircuits();
assert(circuits.length === EXPECTED_IDS.length, `Expected ${EXPECTED_IDS.length} source-backed circuits; received ${circuits.length}.`);
assert(CIRCUITS.length === circuits.length, "Legacy CIRCUITS export differs from the bundled registry.");

for (const id of EXPECTED_IDS) {
  const circuit = getCircuitGeometry(id);
  assert(circuit !== undefined, `Expected source-backed circuit ${id}.`);
  assert(circuit.id === id, `Lookup for ${id} returned ${circuit.id}.`);
  assert(CircuitGeometrySchema.safeParse(circuit).success, `Circuit ${id} did not satisfy the geometry schema.`);
  assert(circuit.source.revision === SOURCE_REVISION, `${id} has an unexpected source revision.`);
  assert(circuit.source.repository === "bacinger/f1-circuits", `${id} has an unexpected source repository.`);
  assert(circuit.source.license === "MIT", `${id} has no MIT attribution.`);
  assert(circuit.source.file.startsWith("circuits/"), `${id} has no GeoJSON source path.`);
  assert(/^[a-f0-9]{64}$/.test(circuit.source.sha256), `${id} has no source-file SHA-256.`);
  assert(circuit.normalizedCoordinates.length === circuit.source.coordinates.length, `${id} changed the source point count.`);

  const expected = expectedProjectedPoints(circuit.source.coordinates);
  for (const [index, expectedPoint] of expected.entries()) {
    const actualPoint = circuit.normalizedCoordinates[index];
    assert(actualPoint !== undefined, `${id} is missing normalized point ${index}.`);
    assert(Math.abs(actualPoint[0] - expectedPoint[0]) <= PROJECTION_TOLERANCE, `${id} point ${index} longitude projection exceeded tolerance.`);
    assert(Math.abs(actualPoint[1] - expectedPoint[1]) <= PROJECTION_TOLERANCE, `${id} point ${index} latitude projection exceeded tolerance.`);
  }

  const expectedPath = circuit.normalizedCoordinates
    .map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`)
    .join(" ");
  assert(circuit.path === expectedPath, `${id} SVG path does not preserve normalized GeoJSON point sequence.`);
  assert(circuit.overlays.turns === "unavailable", `${id} must not imply known turn markers.`);
  assert(circuit.overlays.sectors === "unavailable", `${id} must not imply known sector splits.`);
  assert(circuit.overlays.drs === "unavailable", `${id} must not imply known DRS zones.`);
  assert(circuit.overlays.speedTraps === "unavailable", `${id} must not imply known speed traps.`);
}

assert(getCircuitGeometry("austria")?.id === "spielberg", "Known alias did not resolve to its bundled geometry.");
assert(getCircuitGeometry("MONZA")?.id === "monza", "Case-insensitive circuit lookup failed.");
assert(getCircuitGeometry("not-a-real-circuit-999") === undefined, "Unknown circuit ID must be unavailable rather than returning a fallback geometry.");
assert(getCircuitGeometry("") === undefined, "Empty circuit ID must be unavailable rather than returning a fallback geometry.");

const evidence = {
  sourceRepository: "https://github.com/bacinger/f1-circuits",
  sourceRevision: SOURCE_REVISION,
  license: "MIT",
  projection: "local equirectangular; centered, aspect-preserving fit; 80 unit padding",
  normalizationTolerance: PROJECTION_TOLERANCE,
  circuitCount: circuits.length,
  circuitIds: circuits.map(({ id }) => id),
  sourcePointCounts: Object.fromEntries(circuits.map(({ id, source }) => [id, source.coordinates.length])),
  unknownIdUnavailable: true,
  unavailableOverlays: ["turns", "sectors", "drs", "speedTraps"],
  allAssertionsPassed: true,
};
const evidencePath = path.resolve(".omo/evidence/task-15-frontend-deslop-and-refactor.json");
fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
fs.writeFileSync(evidencePath, JSON.stringify(evidence, null, 2), "utf8");
console.log(`Circuit registry verified: ${circuits.length} geometries at ${SOURCE_REVISION}; ${evidencePath}`);
