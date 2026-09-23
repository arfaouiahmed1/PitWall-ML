import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { createElement as ReactCreateElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import {
  TrackGeometry,
  resolveSectors,
  clampProgress,
  calculateSplineLength,
  getPointAtProgress,
  type TrackDriver,
  type SectorDivision,
} from "../../apps/web/components/circuit/TrackGeometry";
import { getCircuitGeometry } from "../../apps/web/lib/circuits/registry";
import type { CircuitGeometry } from "../../apps/web/lib/circuits/types";

const webRequire = createRequire(resolve(__dirname, "../../apps/web/package.json"));
const { createElement } = webRequire("react") as { readonly createElement: typeof ReactCreateElement };
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const monza = getCircuitGeometry("monza");
assert(monza !== undefined, "Monza geometry must be registered.");

// --- Scenario 1: resolveSectors returns no divisions for unavailable metadata ---
// Given circuit metadata with sectors marked "unavailable",
// When resolveSectors is called,
// Then it returns an empty array, NOT guessed thirds (1/3, 2/3).
const monzaSectors = resolveSectors(monza);
assert.deepEqual(monzaSectors, [], "resolveSectors must return an empty array when sectors are unavailable.");
assert.equal(monzaSectors.length, 0, "No sector divisions must be returned for unsourced sectors.");

// Given null or undefined input,
// When resolveSectors is called,
// Then it safely returns an empty array.
assert.deepEqual(resolveSectors(undefined), []);
assert.deepEqual(resolveSectors(null), []);

// Given circuit with empty array or missing overlays,
// When resolveSectors is called,
// Then it returns an empty array.
assert.deepEqual(resolveSectors({ ...monza, overlays: { ...monza.overlays, sectors: "unavailable" } }), []);

// Verify no guessed 1/3 or 2/3 fractions appear in the output
const hasGuessedThirds = monzaSectors.some(
  (s) => Math.abs(s.endProgress - 1 / 3) < 0.05 || Math.abs(s.endProgress - 2 / 3) < 0.05
);
assert.equal(hasGuessedThirds, false, "Must never infer or guess 1/3 or 2/3 sector splits.");

// --- Scenario 2: resolveSectors returns valid divisions when sourced ---
// Given circuit metadata with explicitly sourced sector boundaries,
// When resolveSectors is called,
// Then it returns the exact normalized sector divisions.
const circuitWithSourcedSectors: CircuitGeometry = {
  ...monza,
  overlays: {
    ...monza.overlays,
    sectors: [
      { sector: 1, startProgress: 0, endProgress: 0.315 },
      { sector: 2, startProgress: 0.315, endProgress: 0.672 },
      { sector: 3, startProgress: 0.672, endProgress: 1.0 },
    ],
  },
};
const sourcedSectors = resolveSectors(circuitWithSourcedSectors);
assert.equal(sourcedSectors.length, 3, "Must return all 3 sourced sector divisions.");
assert.equal(sourcedSectors[0]?.sector, 1);
assert.equal(sourcedSectors[0]?.startProgress, 0);
assert.equal(sourcedSectors[0]?.endProgress, 0.315);
assert.equal(sourcedSectors[1]?.sector, 2);
assert.equal(sourcedSectors[1]?.startProgress, 0.315);
assert.equal(sourcedSectors[1]?.endProgress, 0.672);
assert.equal(sourcedSectors[2]?.sector, 3);
assert.equal(sourcedSectors[2]?.startProgress, 0.672);
assert.equal(sourcedSectors[2]?.endProgress, 1.0);

// --- Scenario 3: Missing/unavailable overlays produce NO inferred visual layers ---
// Given a bundled authentic circuit with overlays = "unavailable",
// When TrackGeometry is rendered,
// Then no DRS, turn, speed trap, or sector overlay layers are rendered.
const unsourcedMarkup = renderToStaticMarkup(createElement(TrackGeometry, { circuit: monza }));
assert(unsourcedMarkup.includes(monza.path), "Must render authentic track path.");
assert(!unsourcedMarkup.includes("data-overlay-type=\"drs\""), "Must not render DRS overlay when unavailable.");
assert(!unsourcedMarkup.includes("data-overlay-type=\"turn\""), "Must not render turn overlay when unavailable.");
assert(!unsourcedMarkup.includes("data-overlay-type=\"speed-trap\""), "Must not render speed trap overlay when unavailable.");
assert(!unsourcedMarkup.includes("data-overlay-type=\"sector-split\""), "Must not render sector split overlay when unavailable.");
assert(!unsourcedMarkup.includes("Variante del Rettifilo"), "Must not invent turn names.");

// Accurate source provenance label must be preserved in rendered output
assert(unsourcedMarkup.includes("bacinger/f1-circuits"), "Must include source repository provenance.");
assert(unsourcedMarkup.includes("MIT"), "Must include source license attribution.");

// --- Scenario 4: Valid sourced overlays ARE rendered when metadata is present ---
// Given a circuit with valid sourced turn, DRS, sector, and speed trap metadata,
// When TrackGeometry is rendered,
// Then each sourced layer is faithfully rendered.
const circuitWithAllOverlays: CircuitGeometry = {
  ...monza,
  overlays: {
    turns: [
      { number: 1, progress: 0.12, x: 250, y: 180, label: "Variante del Rettifilo" },
      { number: 2, progress: 0.15, x: 270, y: 200 },
    ],
    sectors: [
      { sector: 1, startProgress: 0, endProgress: 0.35 },
      { sector: 2, startProgress: 0.35, endProgress: 0.70 },
      { sector: 3, startProgress: 0.70, endProgress: 1.0 },
    ],
    drs: [
      { id: "drs-1", zone: 1, startProgress: 0.05, endProgress: 0.18, detectionProgress: 0.02 },
    ],
    speedTraps: [
      { id: "st-1", label: "Speed Trap 1", progress: 0.16, x: 260, y: 190 },
    ],
  },
};
const sourcedMarkup = renderToStaticMarkup(createElement(TrackGeometry, { circuit: circuitWithAllOverlays }));
assert(sourcedMarkup.includes("data-overlay-type=\"turn\""), "Must render turn markers when sourced.");
assert(sourcedMarkup.includes("T1"), "Must render turn 1 badge.");
assert(sourcedMarkup.includes("T2"), "Must render turn 2 badge.");
assert(sourcedMarkup.includes("data-overlay-type=\"drs\""), "Must render DRS segments when sourced.");
assert(sourcedMarkup.includes("data-overlay-type=\"speed-trap\""), "Must render speed traps when sourced.");
assert(sourcedMarkup.includes("data-overlay-type=\"sector-split\""), "Must render sector divisions when sourced.");

// --- Scenario 5: Driver progress clamping [0..1] ---
// Given driver progress values outside [0, 1] or non-finite,
// When clampProgress is called,
// Then values are clamped strictly to [0, 1].
assert.equal(clampProgress(-0.5), 0, "Negative progress must clamp to 0.");
assert.equal(clampProgress(0), 0, "Zero progress must remain 0.");
assert.equal(clampProgress(0.42), 0.42, "Valid fractional progress must remain unchanged.");
assert.equal(clampProgress(1.0), 1.0, "Progress 1.0 must remain 1.0.");
assert.equal(clampProgress(1.5), 1.0, "Progress > 1 must clamp to 1.0.");
assert.equal(clampProgress(Number.NaN), 0, "NaN progress must clamp to 0.");
assert.equal(clampProgress(Number.POSITIVE_INFINITY), 1.0, "Infinity progress must clamp to 1.0.");
assert.equal(clampProgress(Number.NEGATIVE_INFINITY), 0, "Negative infinity progress must clamp to 0.");

// --- Scenario 6: Unknown circuit renders unavailable state, NOT Monza fallback ---
// Given an unknown or unregistered circuit ID,
// When TrackGeometry is rendered,
// Then it renders an explicit unavailable state, NOT a Monza fallback under another name.
const unknownMarkup = renderToStaticMarkup(
  createElement(TrackGeometry, { circuitId: "nonexistent-grand-prix-999" })
);
assert(unknownMarkup.includes("role=\"status\""), "Must render an accessible status element for missing circuit.");
assert(
  unknownMarkup.toLowerCase().includes("unavailable"),
  "Must state that circuit geometry is unavailable."
);
assert(!unknownMarkup.includes(monza.path), "Must NOT render Monza track path for an unknown circuit ID.");
assert(!unknownMarkup.includes("Autodromo Nazionale Monza"), "Must NOT render Monza name for an unknown ID.");

// Given unspecified circuit with no circuitId or circuit prop,
// When TrackGeometry is rendered,
// Then it renders unavailable, NOT silent Monza default.
const unspecifiedMarkup = renderToStaticMarkup(
  createElement(TrackGeometry, { circuit: undefined, circuitId: undefined })
);
assert(unspecifiedMarkup.includes("role=\"status\""), "Unspecified circuit must render status element.");
assert(!unspecifiedMarkup.includes(monza.path), "Must not default to Monza when circuitId is undefined.");

// --- Scenario 7: Anti-Slop typography & geometry invariants ---
// Given rendered markup for both sourced and unsourced geometries,
// Then zero em-dashes (— or –) or NaN coordinates are present.
assert(!unsourcedMarkup.includes("—"), "Must not contain em-dashes.");
assert(!unsourcedMarkup.includes("–"), "Must not contain en-dashes.");
assert(!sourcedMarkup.includes("—"), "Must not contain em-dashes in sourced overlays.");
assert(!sourcedMarkup.includes("–"), "Must not contain en-dashes in sourced overlays.");
assert(!sourcedMarkup.includes("NaN"), "Must not contain NaN coordinates.");

// --- Scenario 8: calculateSplineLength and getPointAtProgress spline projection ---
// Given authentic Monza normalizedCoordinates,
// When calculateSplineLength is called,
// Then it returns accurate polyline length in viewBox units (>2000).
const monzaLength = calculateSplineLength(monza.normalizedCoordinates);
assert(monzaLength > 2000 && monzaLength < 3000, `Monza length ${monzaLength} must be between 2000 and 3000 viewBox units.`);
assert.equal(calculateSplineLength([]), 0, "Empty coordinates must have 0 length.");
assert.equal(calculateSplineLength(null), 0, "Null coordinates must have 0 length.");

// Given fractional progress values,
// When getPointAtProgress is called,
// Then points are computed directly on the authentic GeoJSON polyline path.
const startPt = getPointAtProgress(monza, 0);
assert(startPt !== null, "Start point must be resolvable.");
assert(Math.abs(startPt.x - monza.normalizedCoordinates[0][0]) < 0.01, "Progress 0 x must match start coordinate.");
assert(Math.abs(startPt.y - monza.normalizedCoordinates[0][1]) < 0.01, "Progress 0 y must match start coordinate.");

const endPt = getPointAtProgress(monza, 1.0);
assert(endPt !== null, "End point must be resolvable.");
const lastCoord = monza.normalizedCoordinates[monza.normalizedCoordinates.length - 1];
assert(Math.abs(endPt.x - lastCoord[0]) < 0.01, "Progress 1.0 x must match end coordinate.");
assert(Math.abs(endPt.y - lastCoord[1]) < 0.01, "Progress 1.0 y must match end coordinate.");

const t1Pt = getPointAtProgress(monza, 0.12);
assert(t1Pt !== null, "Turn 1 point must be resolvable.");
assert(Math.abs(t1Pt.x - 308.537) < 0.5, `Turn 1 x expected ~308.5, got ${t1Pt.x}`);
assert(Math.abs(t1Pt.y - 359.197) < 0.5, `Turn 1 y expected ~359.2, got ${t1Pt.y}`);

const ascariPt = getPointAtProgress(monza, 0.68);
assert(ascariPt !== null, "Ascari point must be resolvable.");
assert(Math.abs(ascariPt.x - 382.371) < 0.5, `Ascari x expected ~382.4, got ${ascariPt.x}`);
assert(Math.abs(ascariPt.y - 558.659) < 0.5, `Ascari y expected ~558.7, got ${ascariPt.y}`);

// Given invalid or non-finite progress, getPointAtProgress clamps safely
const clampedNeg = getPointAtProgress(monza, -0.5);
assert(clampedNeg !== null && Math.abs(clampedNeg.x - startPt.x) < 0.01, "Negative progress clamps to start.");
const clampedOver = getPointAtProgress(monza, 1.5);
assert(clampedOver !== null && Math.abs(clampedOver.x - endPt.x) < 0.01, "Over-progress clamps to end.");
assert.equal(getPointAtProgress(null, 0.5), null, "Null geometry returns null point.");

// --- Scenario 9: Sourced turn markers and traps reject floating coordinates ---
// Given a turn marker with both progress: 0.68 and floating unverified x: 780, y: 620,
// When TrackGeometry is rendered,
// Then it MUST project the marker from progress onto the track (x ~382, y ~558) and NOT render at (780, 620).
const circuitWithFloatingMarker: CircuitGeometry = {
  ...monza,
  overlays: {
    turns: [
      { number: 8, progress: 0.68, x: 780, y: 620, label: "Variante Ascari" },
    ],
    sectors: "unavailable",
    drs: "unavailable",
    speedTraps: [
      { id: "st-floating", progress: 0.12, x: 999, y: 999, label: "Sourced Trap" },
    ],
  },
};
const floatingMarkup = renderToStaticMarkup(
  createElement(TrackGeometry, { circuit: circuitWithFloatingMarker })
);
assert(!floatingMarkup.includes("cx=\"780\""), "Must NOT render turn marker at floating x: 780.");
assert(!floatingMarkup.includes("cy=\"620\""), "Must NOT render turn marker at floating y: 620.");
assert(floatingMarkup.includes("cx=\"382.371\""), `Turn marker must be projected to track spline x: 382.371.`);
assert(floatingMarkup.includes("cy=\"558.659\""), `Turn marker must be projected to track spline y: 558.659.`);
assert(!floatingMarkup.includes("999,991"), "Must NOT render speed trap polygon at floating 999,999.");
assert(floatingMarkup.includes("308.537"), "Speed trap must be projected to track spline x at progress 0.12.");

// --- Scenario 10: DRS overlays render accurate stroke segments and NEVER stroke full track ---
// Given a circuit with DRS zone [0.05..0.18],
// When rendered without DOM measurement (SSR/static),
// Then it renders stroke-dasharray matching the segment, NOT an un-dashed full track stroke.
assert(sourcedMarkup.includes("stroke-dasharray="), "DRS overlay must have stroke-dasharray even in static rendering.");
assert(!sourcedMarkup.includes("opacity=\"0.4\""), "Must NEVER render low-opacity full-track stroke as DRS fallback.");

// --- Scenario 11: Driver dots render synchronously in static markup / SSR ---
// Given TrackGeometry rendered with live drivers,
// When rendered to static markup,
// Then driver dots and labels are immediately present at their authentic spline coordinates.
const testDrivers: TrackDriver[] = [
  { driverNumber: 1, code: "VER", color: "#3671c6", progress: 0.88, position: 1 },
  { driverNumber: 4, code: "NOR", color: "#ff8000", progress: 0.12, position: 2 },
];
const driversMarkup = renderToStaticMarkup(
  createElement(TrackGeometry, { circuit: monza, drivers: testDrivers })
);
assert(driversMarkup.includes("VER"), "VER driver label must be rendered in static markup.");
assert(driversMarkup.includes("NOR"), "NOR driver label must be rendered in static markup.");
const verPt = getPointAtProgress(monza, 0.88);
assert(verPt !== null);
assert(driversMarkup.includes(`cx="${verPt.x}"`), `VER circle cx must be at projected x: ${verPt.x}`);
assert(driversMarkup.includes(`cy="${verPt.y}"`), `VER circle cy must be at projected y: ${verPt.y}`);

// --- Scenario 12: resolveSectors rejects inverted or zero-length sector ranges ---
// Given sectors with startProgress >= endProgress,
// When resolveSectors is called,
// Then invalid divisions are rejected and omitted.
const invertedSectors = resolveSectors({
  ...monza,
  overlays: {
    ...monza.overlays,
    sectors: [
      { sector: 1, startProgress: 0.5, endProgress: 0.2 },
      { sector: 2, startProgress: 0.4, endProgress: 0.4 },
      { sector: 3, startProgress: 0.1, endProgress: 0.6 },
    ],
  },
});
assert.equal(invertedSectors.length, 1, "Only the 1 valid sector range (0.1 -> 0.6) must be retained.");
assert.equal(invertedSectors[0]?.sector, 3, "Valid sector 3 must be retained.");

console.log("Track geometry contracts verified successfully.");
