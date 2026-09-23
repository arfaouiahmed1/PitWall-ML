import * as fs from "node:fs";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  OPENAPI_SNAPSHOT,
  OPENAPI_PROVENANCE,
  getOpenApiEndpoints,
  getOpenApiSchemas,
  getOpenApiTags,
  generateCurlCommand,
} from "../../apps/web/lib/openapi";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// 1. Verify provenance metadata
assert(OPENAPI_PROVENANCE !== undefined, "OPENAPI_PROVENANCE must be exported");
assert(OPENAPI_PROVENANCE.backendTitle === "PitWall ML API", "Expected backend title 'PitWall ML API'");
assert(OPENAPI_PROVENANCE.backendVersion === "0.1.0", "Expected backend version '0.1.0'");
assert(OPENAPI_PROVENANCE.openapiVersion === "3.1.0", "Expected OpenAPI 3.1.0");
assert(OPENAPI_PROVENANCE.capturedDate === "2026-09-22", "Expected captured date 2026-09-22");
assert(typeof OPENAPI_PROVENANCE.sourceCommit === "string" && OPENAPI_PROVENANCE.sourceCommit.length === 40, "Expected 40-char commit SHA");
assert(/^[a-f0-9]{64}$/.test(OPENAPI_PROVENANCE.sourceSha256), "Expected SHA-256 of the captured backend OpenAPI export");

assert(OPENAPI_SNAPSHOT !== undefined, "OPENAPI_SNAPSHOT must be exported");
assert(OPENAPI_SNAPSHOT.openapi === "3.1.0", "OpenAPI version in snapshot must be 3.1.0");
assert(typeof OPENAPI_SNAPSHOT.paths === "object", "OpenAPI snapshot must contain paths object");
assert(typeof OPENAPI_SNAPSHOT.components?.schemas === "object", "OpenAPI snapshot must contain schemas");

const repositoryRoot = path.resolve(__dirname, "../..");
const backendExport = JSON.parse(execFileSync("uv", [
  "run", "python", "-c",
  "import hashlib, json; from apps.api.pitwall_api.main import app; schema = app.openapi(); encoded = json.dumps(schema, sort_keys=True, separators=(',', ':')).encode(); print(json.dumps({'schema': schema, 'sha256': hashlib.sha256(encoded).hexdigest()}))",
], { cwd: repositoryRoot, encoding: "utf8" })) as Record<string, unknown>;
const backendSchema = backendExport.schema;

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
  return `{${Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

for (const section of ["paths", "components", "security"] as const) {
  assert(
    canonicalJson(OPENAPI_SNAPSHOT[section]) === canonicalJson(backendSchema[section]),
    `Fallback OpenAPI ${section} drifted from apps.api.pitwall_api.main:app.openapi(); refresh snapshot.json and provenance.`,
  );
}
assert(backendExport.sha256 === OPENAPI_PROVENANCE.sourceSha256, "Snapshot provenance SHA-256 does not match the captured OpenAPI schema");

const paths = Object.keys(OPENAPI_SNAPSHOT.paths);
assert(paths.includes("/health"), "Snapshot must include /health");
assert(paths.includes("/predictions/undercut"), "Snapshot must include /predictions/undercut");
assert(paths.includes("/predictions/safety-car"), "Snapshot must include /predictions/safety-car");
assert(paths.includes("/monitoring/era-drift"), "Snapshot must include /monitoring/era-drift");
assert(paths.includes("/circuits"), "Snapshot must include /circuits");
assert(paths.includes("/live/start"), "Snapshot must include /live/start");

const schemas = Object.keys(OPENAPI_SNAPSHOT.components.schemas);
assert(schemas.includes("UndercutThreat"), "Schemas must include UndercutThreat");
assert(schemas.includes("SafetyCarPrediction"), "Schemas must include SafetyCarPrediction");
assert(schemas.includes("EraDriftResponse"), "Schemas must include EraDriftResponse");
assert(schemas.includes("CircuitResponse"), "Schemas must include CircuitResponse");

// 3. Verify helper methods
const endpoints = getOpenApiEndpoints();
assert(endpoints.length > 0, "Expected operations parsed from the backend schema");
const tags = getOpenApiTags();
assert(tags.includes("ALL"), "Tags must include ALL filter");
assert(tags.includes("Live Ingestion"), "Tags must include Live Ingestion tag");
assert(tags.includes("Predictions"), "Tags must include Predictions tag");

const schemasList = getOpenApiSchemas();
assert(schemasList.length === schemas.length, "Parsed schemas must match component schema inventory");

// 4. Verify curl generation
const healthEp = endpoints.find((e) => e.path === "/health");
assert(healthEp !== undefined, "Health endpoint must exist");
const healthCurl = generateCurlCommand(healthEp, "http://localhost:8000");
assert(healthCurl === 'curl -X GET "http://localhost:8000/health"', `Unexpected curl for health: ${healthCurl}`);

const startEp = endpoints.find((e) => e.path === "/live/start");
assert(startEp !== undefined, "Live start endpoint must exist");
const startCurl = generateCurlCommand(startEp, "http://localhost:8000");
assert(startCurl.includes('curl -X POST "http://localhost:8000/live/start"'), "Start curl must be POST");
assert(startCurl.includes('-H "Content-Type: application/json"'), "Start curl must include JSON header");

// 5. Verify page.tsx conforms to requirements:
// - Under 250 pure LOC
// - Zero em-dashes
// - No ENDPOINT_SPECS or fabricated sample endpoints
const pagePath = path.resolve(__dirname, "../../apps/web/app/api-docs/page.tsx");
const pageContent = fs.readFileSync(pagePath, "utf-8");
const pageLines = pageContent.split("\n");

assert(!pageContent.includes("ENDPOINT_SPECS"), "page.tsx must not contain fake ENDPOINT_SPECS");
assert(!pageContent.includes("SCHEMA_DEFINITIONS"), "page.tsx must not contain fake SCHEMA_DEFINITIONS");
assert(!pageContent.includes("—") && !pageContent.includes("–"), "page.tsx must contain zero em-dashes or en-dashes");
assert(pageLines.length <= 250, `page.tsx must be <= 250 LOC; got ${pageLines.length}`);

console.log("All OpenAPI snapshot and api-docs requirements verified successfully!");
