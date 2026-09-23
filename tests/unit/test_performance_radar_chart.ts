import { strict as assert } from "node:assert";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { createElement as ReactCreateElement } from "react";
import type { renderToStaticMarkup as ReactRenderToStaticMarkup } from "react-dom/server";
import {
  DEFAULT_PERFORMANCE_RADAR_AXES,
  PerformanceRadarAxisSchema,
  PerformanceRadarChart,
  buildPerformanceRadarModel,
  normalizePerformanceRadarAxes,
  parsePerformanceRadarAxis,
} from "../../apps/web/components/charts/PerformanceRadarChart";

const webRequire = createRequire(resolve(__dirname, "../../apps/web/package.json"));
const { createElement } = webRequire("react") as { readonly createElement: typeof ReactCreateElement };
const { renderToStaticMarkup } = webRequire("react-dom/server") as {
  readonly renderToStaticMarkup: typeof ReactRenderToStaticMarkup;
};

const axes = DEFAULT_PERFORMANCE_RADAR_AXES;

// Given two measured driver vectors, when the model is built, then both valid polygons are retained.
const twoSeriesModel = buildPerformanceRadarModel({
  axes,
  series: [
    {
      id: "NOR",
      label: "NOR",
      color: "#ff8000",
      values: { highSpeed: 92, lowSpeed: 86, traction: 89, tyreConservation: 84, energyEfficiency: 80, reliability: 91 },
    },
    {
      id: "VER",
      label: "VER",
      color: "#3671c6",
      values: { highSpeed: 96, lowSpeed: 88, traction: 91, tyreConservation: 82, energyEfficiency: 79, reliability: 93 },
    },
  ],
});

assert.equal(twoSeriesModel.status, "ready");
assert.equal(twoSeriesModel.series.length, 2);
assert(twoSeriesModel.series.every((series) => series.points.length === axes.length));

// Given one absent measurement, when the model is built, then that dimension is explicitly unavailable and omitted from its polygon.
const missingValueModel = buildPerformanceRadarModel({
  axes,
  series: [
    {
      id: "NOR",
      label: "NOR",
      color: "#ff8000",
      values: { highSpeed: 92, lowSpeed: null, traction: 89, tyreConservation: 84, energyEfficiency: 80, reliability: 91 },
    },
  ],
});

assert.equal(missingValueModel.status, "partial");
assert.equal(missingValueModel.series[0]?.points.length, axes.length - 1);
assert.equal(missingValueModel.series[0]?.missingAxes.includes("lowSpeed"), true);

// Given values beyond the declared scale or non-finite values, when the model is built, then coordinates remain finite and bounds are respected.
const invalidRangeModel = buildPerformanceRadarModel({
  axes,
  series: [
    {
      id: "EDGE",
      label: "EDGE",
      color: "#22d3ee",
      values: { highSpeed: -4, lowSpeed: 120, traction: Number.NaN, tyreConservation: Number.POSITIVE_INFINITY, energyEfficiency: 70, reliability: 50 },
    },
  ],
});

assert.equal(invalidRangeModel.status, "partial");
assert(invalidRangeModel.series[0]?.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
assert.equal(invalidRangeModel.series[0]?.missingAxes.includes("traction"), true);
assert.equal(invalidRangeModel.series[0]?.missingAxes.includes("tyreConservation"), true);

// Given no measured series, when the model is built, then it reports unavailable instead of inventing a profile.
const unavailableModel = buildPerformanceRadarModel({ axes, series: [] });
assert.equal(unavailableModel.status, "unavailable");

// Given the responsive SVG model, when paths are serialized, then no NaN or em-dash can reach the DOM.
assert(!JSON.stringify(twoSeriesModel).includes("NaN"));
assert(!JSON.stringify(twoSeriesModel).includes("—"));
assert.equal(twoSeriesModel.viewBox, "0 0 320 320");

// Given axis with equal bounds (maximum <= minimum), when parsed or modeled, then it is rejected or safely excluded and produces no NaN coordinates.
const equalBoundsAxis = { key: "equal", label: "Equal", minimum: 50, maximum: 50 };
assert.equal(parsePerformanceRadarAxis(equalBoundsAxis), null);

const modelWithEqualBounds = buildPerformanceRadarModel({
  axes: [
    ...axes.slice(0, 3),
    equalBoundsAxis,
  ],
  series: [
    {
      id: "DRIVER",
      label: "DRIVER",
      color: "#ff8000",
      values: { highSpeed: 85, lowSpeed: 80, traction: 75, equal: 50 },
    },
  ],
});
assert.equal(modelWithEqualBounds.axes.some((a) => a.key === "equal"), false);
assert.equal(modelWithEqualBounds.status, "partial");
assert.equal(modelWithEqualBounds.series[0]?.missingAxes.includes("equal"), true);
assert(modelWithEqualBounds.series[0]?.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
assert(!JSON.stringify(modelWithEqualBounds).includes("NaN"));

// Given axis with reversed bounds (maximum < minimum), when parsed or modeled, then it is rejected or safely excluded and produces no NaN coordinates.
const reversedBoundsAxis = { key: "reversed", label: "Reversed", minimum: 100, maximum: 0 };
assert.equal(parsePerformanceRadarAxis(reversedBoundsAxis), null);

const modelWithReversedBounds = buildPerformanceRadarModel({
  axes: [
    ...axes.slice(0, 3),
    reversedBoundsAxis,
  ],
  series: [
    {
      id: "DRIVER",
      label: "DRIVER",
      color: "#ff8000",
      values: { highSpeed: 85, lowSpeed: 80, traction: 75, reversed: 50 },
    },
  ],
});
assert.equal(modelWithReversedBounds.axes.some((a) => a.key === "reversed"), false);
assert.equal(modelWithReversedBounds.status, "partial");
assert.equal(modelWithReversedBounds.series[0]?.missingAxes.includes("reversed"), true);
assert(modelWithReversedBounds.series[0]?.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
assert(!JSON.stringify(modelWithReversedBounds).includes("NaN"));

// Given axes with non-finite bounds (NaN, +/-Infinity), when parsed or modeled, then they are rejected or safely excluded and produce no NaN coordinates.
const nanMinAxis = { key: "nanMin", label: "NaN Min", minimum: Number.NaN, maximum: 100 };
const nanMaxAxis = { key: "nanMax", label: "NaN Max", minimum: 0, maximum: Number.NaN };
const infMinAxis = { key: "infMin", label: "Inf Min", minimum: Number.NEGATIVE_INFINITY, maximum: 100 };
const infMaxAxis = { key: "infMax", label: "Inf Max", minimum: 0, maximum: Number.POSITIVE_INFINITY };

assert.equal(parsePerformanceRadarAxis(nanMinAxis), null);
assert.equal(parsePerformanceRadarAxis(nanMaxAxis), null);
assert.equal(parsePerformanceRadarAxis(infMinAxis), null);
assert.equal(parsePerformanceRadarAxis(infMaxAxis), null);

const modelWithNonFiniteBounds = buildPerformanceRadarModel({
  axes: [
    ...axes.slice(0, 3),
    nanMinAxis,
    nanMaxAxis,
    infMinAxis,
    infMaxAxis,
  ],
  series: [
    {
      id: "DRIVER",
      label: "DRIVER",
      color: "#ff8000",
      values: { highSpeed: 85, lowSpeed: 80, traction: 75, nanMin: 50, nanMax: 50, infMin: 50, infMax: 50 },
    },
  ],
});
assert.equal(modelWithNonFiniteBounds.axes.length, 3);
assert.equal(modelWithNonFiniteBounds.status, "partial");
assert(modelWithNonFiniteBounds.series[0]?.missingAxes.includes("nanMin"));
assert(modelWithNonFiniteBounds.series[0]?.missingAxes.includes("nanMax"));
assert(modelWithNonFiniteBounds.series[0]?.missingAxes.includes("infMin"));
assert(modelWithNonFiniteBounds.series[0]?.missingAxes.includes("infMax"));
assert(modelWithNonFiniteBounds.series[0]?.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
assert(!JSON.stringify(modelWithNonFiniteBounds).includes("NaN"));

// Given only invalid axes, when model is built, then the resulting chart state is explicitly unavailable rather than emitting NaN SVG coordinates.
const allInvalidModel = buildPerformanceRadarModel({
  axes: [equalBoundsAxis, reversedBoundsAxis, nanMinAxis],
  series: [
    {
      id: "DRIVER",
      label: "DRIVER",
      color: "#ff8000",
      values: { equal: 50, reversed: 50, nanMin: 50 },
    },
  ],
});
assert.equal(allInvalidModel.axes.length, 0);
assert.equal(allInvalidModel.status, "unavailable");
assert(!JSON.stringify(allInvalidModel).includes("NaN"));

// Given axes with valid bounds, when parsed or modeled, then they are accepted and plotted with finite coordinates.
const validAxis = { key: "validMetric", label: "Valid Metric", minimum: 0, maximum: 100 };
const parsedValid = parsePerformanceRadarAxis(validAxis);
assert.notEqual(parsedValid, null);
assert.equal(parsedValid?.key, "validMetric");
assert.equal(parsedValid?.minimum, 0);
assert.equal(parsedValid?.maximum, 100);

// Given mixed valid and invalid axes, when normalized, then only valid axes are retained.
const mixedNormalized = normalizePerformanceRadarAxes([
  validAxis,
  equalBoundsAxis,
  reversedBoundsAxis,
  nanMinAxis,
]);
assert.equal(mixedNormalized.length, 1);
assert.equal(mixedNormalized[0]?.key, "validMetric");

// Given Zod schema directly, when evaluated on boundary conditions, then schema correctly validates or rejects.
assert.equal(PerformanceRadarAxisSchema.safeParse(equalBoundsAxis).success, false);
assert.equal(PerformanceRadarAxisSchema.safeParse(reversedBoundsAxis).success, false);
assert.equal(PerformanceRadarAxisSchema.safeParse(nanMinAxis).success, false);
assert.equal(PerformanceRadarAxisSchema.safeParse(nanMaxAxis).success, false);
assert.equal(PerformanceRadarAxisSchema.safeParse(infMinAxis).success, false);
assert.equal(PerformanceRadarAxisSchema.safeParse(infMaxAxis).success, false);
assert.equal(PerformanceRadarAxisSchema.safeParse(validAxis).success, true);

const validAxesList = [
  { key: "a", label: "Axis A", minimum: 0, maximum: 100 },
  { key: "b", label: "Axis B", minimum: -50, maximum: 50 },
  { key: "c", label: "Axis C", minimum: 10, maximum: 20 },
];
const allValidModel = buildPerformanceRadarModel({
  axes: validAxesList,
  series: [
    {
      id: "DRIVER",
      label: "DRIVER",
      color: "#ff8000",
      values: { a: 50, b: 0, c: 15 },
    },
  ],
});
assert.equal(allValidModel.axes.length, 3);
assert.equal(allValidModel.status, "ready");
assert.equal(allValidModel.series[0]?.points.length, 3);
assert(allValidModel.series[0]?.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
assert(!JSON.stringify(allValidModel).includes("NaN"));

// Given rendered React component with invalid axis ranges, when serialized to HTML, then no NaN SVG attributes are produced.
const partialMarkup = renderToStaticMarkup(
  createElement(PerformanceRadarChart, {
    axes: [...axes.slice(0, 3), equalBoundsAxis],
    series: [
      {
        id: "DRIVER",
        label: "DRIVER",
        color: "#ff8000",
        values: { highSpeed: 85, lowSpeed: 80, traction: 75, equal: 50 },
      },
    ],
  }),
);
assert(!partialMarkup.includes("NaN"), "Rendered chart emitted NaN SVG attribute on partial axes.");
assert(!partialMarkup.includes("—"), "Rendered chart emitted em-dash.");
assert(partialMarkup.includes("Unavailable dimensions are omitted."), "Partial chart did not disclose omitted dimensions.");

// Given rendered React component with all invalid axes, when serialized to HTML, then explicit unavailable fallback is rendered with zero SVG markup.
const allInvalidMarkup = renderToStaticMarkup(
  createElement(PerformanceRadarChart, {
    axes: [equalBoundsAxis, reversedBoundsAxis],
    series: [
      {
        id: "DRIVER",
        label: "DRIVER",
        color: "#ff8000",
        values: { equal: 50, reversed: 50 },
      },
    ],
  }),
);
assert(allInvalidMarkup.includes("Performance vector unavailable"), "Missing unavailable state on invalid axes.");
assert(!allInvalidMarkup.includes("<svg"), "Chart rendered SVG markup when all axes were invalid.");
assert(!allInvalidMarkup.includes("NaN"), "Unavailable chart emitted NaN markup.");

console.log("Performance radar chart contracts verified.");

