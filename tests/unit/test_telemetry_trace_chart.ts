import * as fs from "node:fs";
import * as path from "node:path";
import { createRequire } from "node:module";
import type { createElement as ReactCreateElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";

const webRequire = createRequire(path.resolve(__dirname, "../../apps/web/package.json"));
const React = webRequire("react") as { readonly createElement: typeof ReactCreateElement };
const { createElement } = React;
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

import {
  TelemetryTraceChart,
  type TelemetryPoint,
  formatTimestamp,
  normalizeTrace,
  validateTelemetryTrace,
} from "../../apps/web/components/charts/TelemetryTraceChart";
import {
  GapTrajectoryChart,
  type GapTrajectoryChartProps,
} from "../../apps/web/components/charts/GapTrajectoryChart";
import { TelemetryOverlay } from "../../apps/web/components/TelemetryOverlay";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// -------------------------------------------------------------
// 1. Static Source Code Audits (Anti-Slop, No Synthetic/Fake Data)
// -------------------------------------------------------------
const traceChartPath = path.resolve(__dirname, "../../apps/web/components/charts/TelemetryTraceChart.tsx");
const traceChartSource = fs.readFileSync(traceChartPath, "utf-8");

const overlayPath = path.resolve(__dirname, "../../apps/web/components/TelemetryOverlay.tsx");
const overlaySource = fs.readFileSync(overlayPath, "utf-8");

// No synthetic spacing fallback in TelemetryTraceChart
assert(
  !traceChartSource.includes("(idx / (total - 1)) * 100"),
  "TelemetryTraceChart.tsx must not synthesize distance spacing via (idx / (total - 1)) * 100"
);

// No clamping of corrupt values in normalizeTrace
assert(
  !traceChartSource.includes("Math.max(0, Math.min(100, Number(rawThrottle) || 0))"),
  "TelemetryTraceChart.tsx must not clamp corrupt throttle values silently"
);
assert(
  !traceChartSource.includes("Math.max(0, Math.min(100, Number(rawBrake) || 0))"),
  "TelemetryTraceChart.tsx must not clamp corrupt brake values silently"
);

// No synthTrace or sine-wave mock generator in TelemetryOverlay
assert(
  !overlaySource.includes("synthTrace"),
  "TelemetryOverlay.tsx must not contain or use synthTrace"
);
assert(
  !overlaySource.includes("Math.sin((d / 100)"),
  "TelemetryOverlay.tsx must not synthesize telemetry with sine waves"
);

// No generated index-based distance in TelemetryOverlay
assert(
  !overlaySource.includes("Math.round((i / Math.max(1, res.points"),
  "TelemetryOverlay.tsx must not synthesize distance from array index"
);
assert(
  !overlaySource.includes("hoverIdx ?? 25"),
  "TelemetryOverlay.tsx must not invent a default scrubber sample index"
);
assert(
  !overlaySource.includes("speed: p.speed ??") &&
    !overlaySource.includes("throttle: p.throttle ??") &&
    !overlaySource.includes("brake: p.brake ??") &&
    !overlaySource.includes("gear: p.gear ??"),
  "TelemetryOverlay.tsx must not replace missing telemetry channels with fabricated defaults"
);
assert(
  !traceChartSource.includes("const defaultFrac = 0.5"),
  "TelemetryTraceChart.tsx must not invent a midpoint scrubber position"
);

// -------------------------------------------------------------
// 2. Telemetry Trace Validation Contracts
// -------------------------------------------------------------

// Valid trace with timestamps
const validTimestampTrace: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { timestamp: "2026-09-22T20:00:00.100Z", speed: 285, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { timestamp: "2026-09-22T20:00:00.200Z", speed: 290, throttle: 100, brake: 0, gear: 8, drs: 1 },
];
const validTimestampResult = validateTelemetryTrace(validTimestampTrace);
assert(validTimestampResult.valid === true, "Valid timestamped trace must pass validation");
assert(validTimestampResult.axisMode === "timestamp", "Valid timestamped trace must detect timestamp axisMode");
const normalizedTimestampTrace = normalizeTrace(validTimestampTrace);
assert(normalizedTimestampTrace.length === validTimestampTrace.length, "Normalization must retain every source sample");
assert(
  normalizedTimestampTrace[1].axisDisplay === "2026-09-22T20:00:00.100Z",
  "Timestamp scrub readout must display the exact source timestamp rather than an interpolated value"
);
assert(
  formatTimestamp(validTimestampTrace[2].timestamp) === "2026-09-22T20:00:00.200Z",
  "Source timestamp formatting must retain millisecond precision"
);

// Valid trace with distance_m
const validDistanceTrace: TelemetryPoint[] = [
  { distance_m: 100, speed: 280, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { distance_m: 150, speed: 285, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { distance_m: 200, speed: 290, throttle: 100, brake: 0, gear: 8, drs: 1 },
];
const validDistResult = validateTelemetryTrace(validDistanceTrace);
assert(validDistResult.valid === true, "Valid distance_m trace must pass validation");
assert(validDistResult.axisMode === "distance_m", "Valid distance_m trace must detect distance_m axisMode");

// Out-of-order timestamps: must NOT be silently sorted or synthesized
const outOfOrderTimestampTrace: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:01.000Z", speed: 280, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { timestamp: "2026-09-22T20:00:00.500Z", speed: 285, throttle: 100, brake: 0, gear: 7, drs: 1 },
];
const outOfOrderResult = validateTelemetryTrace(outOfOrderTimestampTrace);
assert(outOfOrderResult.valid === false, "Out-of-order timestamps must fail validation");
assert(
  outOfOrderResult.reason === "out_of_order_timestamps",
  `Expected reason 'out_of_order_timestamps', got '${outOfOrderResult.reason}'`
);

// Missing timestamps / missing axis: trace with no distance and missing/null timestamp
const missingTimestampTrace: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { speed: 285, throttle: 100, brake: 0, gear: 7, drs: 1 }, // missing timestamp
];
const missingTimestampResult = validateTelemetryTrace(missingTimestampTrace);
assert(missingTimestampResult.valid === false, "Partially missing timestamps must fail validation");
assert(
  missingTimestampResult.reason === "missing_timestamps",
  `Expected reason 'missing_timestamps', got '${missingTimestampResult.reason}'`
);

// Entirely missing axis (no distance, no timestamp): must be marked unavailable
const noAxisTrace: TelemetryPoint[] = [
  { speed: 280, throttle: 100, brake: 0, gear: 7, drs: 1 },
  { speed: 285, throttle: 100, brake: 0, gear: 7, drs: 1 },
];
const noAxisResult = validateTelemetryTrace(noAxisTrace);
assert(noAxisResult.valid === false, "Trace with no axis must fail validation");
assert(
  noAxisResult.reason === "missing_axis",
  `Expected reason 'missing_axis', got '${noAxisResult.reason}'`
);

const missingThrottleTrace: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, brake: 0, gear: 7, drs: 1 },
];
const missingThrottleResult = validateTelemetryTrace(missingThrottleTrace);
assert(missingThrottleResult.valid === false, "Missing throttle must fail instead of being displayed as 0%");
assert(
  missingThrottleResult.reason === "missing_throttle",
  `Expected reason 'missing_throttle', got '${missingThrottleResult.reason}'`
);

// Throttle edge validation: negative or > 100 must fail instead of clamping
const corruptThrottleTraceHigh: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, throttle: 140, brake: 0, gear: 7, drs: 1 },
];
const corruptThrottleHighResult = validateTelemetryTrace(corruptThrottleTraceHigh);
assert(corruptThrottleHighResult.valid === false, "Throttle > 100 must fail validation");
assert(
  corruptThrottleHighResult.reason === "corrupt_throttle_bounds",
  `Expected 'corrupt_throttle_bounds', got '${corruptThrottleHighResult.reason}'`
);

const corruptThrottleTraceLow: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, throttle: -15, brake: 0, gear: 7, drs: 1 },
];
const corruptThrottleLowResult = validateTelemetryTrace(corruptThrottleTraceLow);
assert(corruptThrottleLowResult.valid === false, "Throttle < 0 must fail validation");
assert(
  corruptThrottleLowResult.reason === "corrupt_throttle_bounds",
  `Expected 'corrupt_throttle_bounds', got '${corruptThrottleLowResult.reason}'`
);

// Brake edge validation: negative or > 100 must fail instead of clamping
const corruptBrakeTraceHigh: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, throttle: 0, brake: 110, gear: 7, drs: 1 },
];
const corruptBrakeHighResult = validateTelemetryTrace(corruptBrakeTraceHigh);
assert(corruptBrakeHighResult.valid === false, "Brake > 100 must fail validation");
assert(
  corruptBrakeHighResult.reason === "corrupt_brake_bounds",
  `Expected 'corrupt_brake_bounds', got '${corruptBrakeHighResult.reason}'`
);

const corruptBrakeTraceLow: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: 280, throttle: 0, brake: -5, gear: 7, drs: 1 },
];
const corruptBrakeLowResult = validateTelemetryTrace(corruptBrakeTraceLow);
assert(corruptBrakeLowResult.valid === false, "Brake < 0 must fail validation");
assert(
  corruptBrakeLowResult.reason === "corrupt_brake_bounds",
  `Expected 'corrupt_brake_bounds', got '${corruptBrakeLowResult.reason}'`
);

// Speed edge validation: negative speed or corrupt NaN must fail
const corruptSpeedTrace: TelemetryPoint[] = [
  { timestamp: "2026-09-22T20:00:00.000Z", speed: -20, throttle: 0, brake: 0, gear: 1, drs: 0 },
];
const corruptSpeedResult = validateTelemetryTrace(corruptSpeedTrace);
assert(corruptSpeedResult.valid === false, "Negative speed must fail validation");

// -------------------------------------------------------------
// 3. Render contracts for TelemetryTraceChart
// -------------------------------------------------------------

// Render with corrupt trace should show UNAVAILABLE state with reason, NOT silent clamping
const markupCorrupt = renderToStaticMarkup(
  React.createElement(TelemetryTraceChart, {
    traceA: corruptThrottleTraceHigh,
    driverA: { code: "VER", name: "Max Verstappen" },
  })
);
assert(
  markupCorrupt.includes("UNAVAILABLE") || markupCorrupt.includes("NO TRACE DATA") || markupCorrupt.includes("corrupt"),
  "Corrupt trace must render unavailable/warning state, not fabricated charts"
);

// Render with valid timestamped trace displays exact sample metadata
const markupValid = renderToStaticMarkup(
  React.createElement(TelemetryTraceChart, {
    traceA: validTimestampTrace,
    driverA: { code: "VER", name: "Max Verstappen", color: "#00d2be" },
  })
);
assert(
  markupValid.includes("SPEED") && markupValid.includes("THROTTLE") && markupValid.includes("BRAKE"),
  "Valid trace must render all channels"
);
assert(
  !markupValid.includes("NO TRACE DATA"),
  "Valid trace should not show empty state"
);

// -------------------------------------------------------------
// 4. Render contracts for TelemetryOverlay
// -------------------------------------------------------------

// Empty / no data overlay should explicitly show UNAVAILABLE rather than synthetic trace
const markupEmptyOverlay = renderToStaticMarkup(
  React.createElement(TelemetryOverlay, {
    dataA: [],
    dataB: [],
  })
);
assert(
  markupEmptyOverlay.includes("UNAVAILABLE") || markupEmptyOverlay.includes("No telemetry data") || markupEmptyOverlay.includes("Awaiting"),
  "Empty overlay data must show truthful unavailable message, not synthetic trace"
);

const markupTimestampOverlay = renderToStaticMarkup(
  React.createElement(TelemetryOverlay, {
    dataA: validTimestampTrace,
    dataB: validTimestampTrace,
  })
);
assert(
  markupTimestampOverlay.includes("2026-09-22T20:00:00.000Z"),
  "TelemetryOverlay must preserve and render the exact source timestamp supplied by its caller"
);

const gapChartPath = path.resolve(__dirname, "../../apps/web/components/charts/GapTrajectoryChart.tsx");
const gapChartSource = fs.readFileSync(gapChartPath, "utf-8");

function countPureLoc(source: string): number {
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("//") && !line.startsWith("/*") && !line.startsWith("*")).length;
}

const markupGapEmpty = renderToStaticMarkup(
  React.createElement(GapTrajectoryChart, { points: [] })
);
assert(
  markupGapEmpty.includes("No trajectory data recorded") || markupGapEmpty.includes("Awaiting trajectory data"),
  "Empty gap trajectory chart must render empty state message"
);

const markupGapValid = renderToStaticMarkup(
  React.createElement(GapTrajectoryChart, {
    points: [
      { lap: 1, baseline: 1.2, whatif: 0.8 },
      { lap: 2, baseline: 1.5, whatif: 0.9 },
    ],
  })
);
assert(
  markupGapValid.includes("GAP TRAJECTORY") && markupGapValid.includes("Baseline") && markupGapValid.includes("What-If"),
  "Valid gap trajectory chart must render header and legend"
);

assert(
  countPureLoc(traceChartSource) <= 250,
  `TelemetryTraceChart.tsx pure LOC must be <= 250, found ${countPureLoc(traceChartSource)}`
);

assert(
  countPureLoc(gapChartSource) <= 250,
  `GapTrajectoryChart.tsx pure LOC must be <= 250, found ${countPureLoc(gapChartSource)}`
);

console.log("Telemetry trace chart & overlay contracts verified successfully.");
