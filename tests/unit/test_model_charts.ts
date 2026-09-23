import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  FeatureWaterfallChart,
  normalizeLocalContributions,
} from "../../apps/web/components/charts/FeatureWaterfallChart";
import {
  CalibrationCurveChart,
  normalizeCalibrationPoints,
} from "../../apps/web/components/charts/CalibrationCurveChart";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Given signed local SHAP values, when cumulative rows are normalized,
// then positive and negative contributions retain their sign and order.
const localRows = normalizeLocalContributions(
  [
    { feature: "tyre_age", value: 0.42 },
    { feature: "fuel_load", value: -0.27 },
  ],
  80,
);
assert(localRows.length === 2, "Expected both signed local contributions.");
assert(localRows[0]?.start === 80 && localRows[0]?.end === 80.42, "Positive local SHAP value was not accumulated.");
assert(localRows[1]?.start === 80.42 && localRows[1]?.end === 80.15, "Negative local SHAP value was not accumulated.");

// Given extreme and non-finite local values, when normalized,
// then SVG geometry inputs remain finite.
const extremeRows = normalizeLocalContributions(
  [
    { feature: "large", value: Number.MAX_VALUE },
    { feature: "invalid", value: Number.NaN },
  ],
  0,
);
assert(extremeRows.length === 1, "Expected non-finite contribution to be discarded.");
assert(extremeRows.every((row) => Number.isFinite(row.start) && Number.isFinite(row.end)), "Waterfall normalization emitted a non-finite value.");

// Given no local contributions, when rendered,
// then the chart exposes an accessible no-data state.
const emptyWaterfallMarkup = renderToStaticMarkup(
  createElement(FeatureWaterfallChart, { data: { kind: "local", baseline: 80, contributions: [] } }),
);
assert(emptyWaterfallMarkup.includes("No local SHAP contributions"), "Waterfall missing its empty state.");

// Given only global importances, when rendered,
// then the chart calls them rankings rather than a local waterfall.
const globalMarkup = renderToStaticMarkup(
  createElement(FeatureWaterfallChart, {
    data: {
      kind: "global",
      importances: [
        { feature: "lower_rank", importance: 12 },
        { feature: "top_rank", importance: 90 },
        { feature: "middle_rank", importance: 47 },
      ],
    },
  }),
);
assert(globalMarkup.includes("Global feature ranking"), "Global importance was not labeled as a ranking.");
assert(!globalMarkup.includes("Local SHAP waterfall"), "Global importance was incorrectly labeled as local SHAP.");
assert(
  globalMarkup.indexOf("top_rank") < globalMarkup.indexOf("middle_rank") &&
    globalMarkup.indexOf("middle_rank") < globalMarkup.indexOf("lower_rank"),
  "Global feature importances were not ranked from largest to smallest.",
);

// Given only empirically supplied calibration points, when normalized,
// then no intermediate nominal points are inferred.
const calibrationRows = normalizeCalibrationPoints([
  { nominal: 0.8, observed: 0.789 },
  { nominal: 0.5, observed: 0.48 },
]);
assert(calibrationRows.length === 2, "Calibration normalization invented or lost points.");
assert(calibrationRows[0]?.nominal === 0.5 && calibrationRows[1]?.nominal === 0.8, "Calibration points were not sorted by nominal coverage.");

// Given an 80% empirical point, when rendered,
// then its target marker appears; otherwise no target marker is produced.
const targetMarkup = renderToStaticMarkup(
  createElement(CalibrationCurveChart, { points: [{ nominal: 0.8, observed: 0.789 }] }),
);
assert(targetMarkup.includes("80% target"), "Measured 80% coverage did not receive a target marker.");
const noTargetMarkup = renderToStaticMarkup(
  createElement(CalibrationCurveChart, { points: [{ nominal: 0.7, observed: 0.68 }] }),
);
assert(!noTargetMarkup.includes("80% target"), "Target marker was inferred without 80% coverage data.");

// Given no usable empirical points, when rendered,
// then the chart has a no-data state and never emits NaN SVG coordinates.
const emptyCalibrationMarkup = renderToStaticMarkup(
  createElement(CalibrationCurveChart, { points: [{ nominal: Number.NaN, observed: Number.NaN }] }),
);
assert(emptyCalibrationMarkup.includes("No empirical calibration points"), "Calibration chart missing its empty state.");
assert(!emptyCalibrationMarkup.includes("NaN"), "Calibration chart emitted NaN markup.");

console.log("Model chart contracts verified.");
