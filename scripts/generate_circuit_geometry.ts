import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const SOURCE_REVISION = "394d8fbe70ef2c0b0c8d23ff7bee61fa09606055";
const PROJECTION = "local equirectangular; centered, aspect-preserving fit; 80 unit padding";
const SOURCE_CIRCUITS = [
  ["bahrain", "bh-2002"], ["jeddah", "sa-2021"], ["melbourne", "au-1953"],
  ["suzuka", "jp-1962"], ["shanghai", "cn-2004"], ["miami", "us-2022"],
  ["imola", "it-1953"], ["monaco", "mc-1929"], ["montreal", "ca-1978"],
  ["barcelona", "es-1991"], ["spielberg", "at-1969"], ["silverstone", "gb-1948"],
  ["budapest", "hu-1986"], ["spa", "be-1925"], ["zandvoort", "nl-1948"],
  ["monza", "it-1922"], ["baku", "az-2016"], ["singapore", "sg-2008"],
  ["austin", "us-2012"], ["mexico", "mx-1962"], ["sao_paulo", "br-1940"],
  ["las_vegas", "us-2023"], ["lusail", "qa-2004"], ["yas_marina", "ae-2009"],
  ["madrid", "es-2026"],
] as const;

type CircuitFeature = {
  readonly properties: { readonly Location: string; readonly Name: string; readonly length: number };
  readonly geometry: { readonly coordinates: readonly (readonly [number, number])[] };
};

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("GeoJSON value must be an object.");
  }
  return value;
}

function parseFeatureCollection(value: unknown): readonly CircuitFeature[] {
  const collection = record(value);
  if (collection.type !== "FeatureCollection" || !Array.isArray(collection.features)) {
    throw new Error("Expected a GeoJSON FeatureCollection.");
  }
  const features = collection.features.map((item): CircuitFeature => {
    const feature = record(item);
    const properties = record(feature.properties);
    const geometry = record(feature.geometry);
    if (geometry.type !== "LineString" || !Array.isArray(geometry.coordinates)) {
      throw new Error("Expected a GeoJSON LineString.");
    }
    const coordinates = geometry.coordinates.map((item): readonly [number, number] => {
      if (!Array.isArray(item) || item.length < 2 || typeof item[0] !== "number" || typeof item[1] !== "number") {
        throw new Error("Expected longitude/latitude coordinate pairs.");
      }
      return [item[0], item[1]];
    });
    if (typeof properties.Location !== "string" || typeof properties.Name !== "string" ||
        typeof properties.length !== "number" || coordinates.length < 2) {
      throw new Error("GeoJSON feature is missing source location, name, length, or coordinates.");
    }
    return { properties: { Location: properties.Location, Name: properties.Name, length: properties.length }, geometry: { coordinates } };
  });
  if (features.length === 0) throw new Error("GeoJSON FeatureCollection has no features.");
  return features;
}

const sourceRoot = process.argv[2];
if (!sourceRoot) throw new Error("Pass the checked-out bacinger/f1-circuits source root.");
const checkedOutRevision = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (checkedOutRevision !== SOURCE_REVISION) {
  throw new Error(`Expected source revision ${SOURCE_REVISION}, received ${checkedOutRevision}.`);
}
const outputRoot = resolve("apps/web/lib/circuits/data");

for (const [id, sourceId] of SOURCE_CIRCUITS) {
  const relativeSource = `circuits/${sourceId}.geojson`;
  const sourceBytes = readFileSync(resolve(sourceRoot, relativeSource));
  const parsedSource: unknown = JSON.parse(sourceBytes.toString("utf8"));
  const features = parseFeatureCollection(parsedSource);
  const feature = features[0];
  if (!feature) throw new Error(`No GeoJSON feature in ${relativeSource}`);
  const coordinates = feature.geometry.coordinates;
  const latitude = coordinates.reduce((sum, [, lat]) => sum + lat, 0) / coordinates.length;
  const longitude = coordinates.reduce((sum, [lon]) => sum + lon, 0) / coordinates.length;
  const projected = coordinates.map(([lon, lat]) => [
    (lon - longitude) * Math.cos((latitude * Math.PI) / 180),
    -(lat - latitude),
  ] as const);
  const bounds = {
    minX: Math.min(...projected.map(([x]) => x)), maxX: Math.max(...projected.map(([x]) => x)),
    minY: Math.min(...projected.map(([, y]) => y)), maxY: Math.max(...projected.map(([, y]) => y)),
  };
  const scale = Math.min(840 / (bounds.maxX - bounds.minX), 840 / (bounds.maxY - bounds.minY));
  const offsetX = 500 - ((bounds.minX + bounds.maxX) * scale) / 2;
  const offsetY = 500 - ((bounds.minY + bounds.maxY) * scale) / 2;
  const normalizedCoordinates = projected.map(([x, y]) => [
    Number((x * scale + offsetX).toFixed(3)), Number((y * scale + offsetY).toFixed(3)),
  ]);
  const path = normalizedCoordinates.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x} ${y}`).join(" ");
  const geometry = {
    id,
    name: feature.properties.Name,
    location: feature.properties.Location,
    lengthKm: feature.properties.length / 1000,
    viewBox: "0 0 1000 1000",
    path,
    source: {
      repository: "bacinger/f1-circuits",
      revision: SOURCE_REVISION,
      file: relativeSource,
      license: "MIT",
      projection: PROJECTION,
      sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      coordinates,
    },
    normalizedCoordinates,
    overlays: { turns: "unavailable", sectors: "unavailable", drs: "unavailable", speedTraps: "unavailable" },
  };
  const variableName = `${id}Circuit`;
  writeFileSync(resolve(outputRoot, `${id}.ts`),
    `import type { CircuitGeometry } from "../types";\n\n// Generated by scripts/generate_circuit_geometry.ts from ${relativeSource}.\nexport const ${variableName}: CircuitGeometry = ${JSON.stringify(geometry)};\n`);
}
