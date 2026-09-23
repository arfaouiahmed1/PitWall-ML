import { parseEraReport } from "../../apps/web/app/monitoring/page";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// Given a backend era-drift observation, when parsed, then the measured values and source identity survive unchanged.
const observed = parseEraReport({
  status: "available",
  reason: null,
  reference_era: "reference-era",
  current_era: "current-era",
  n_reference_sessions: 6,
  n_current_sessions: 2,
  results: [{
    feature: "lap_time_s",
    ks_statistic: 0.43,
    ks_pvalue: 0.018,
    wasserstein: 1.72,
    psi: 0.29,
    js_divergence: 0.12,
    drifted: true,
    severity: "severe",
    reference_mean: 91.2,
    current_mean: 94.1,
    reference_std: 1.4,
    current_std: 2.1,
    relative_shift_pct: 20.71,
  }],
  metric_count: 1,
  overall_drift_ratio: 1,
  max_severity: "severe",
  broken_features: ["lap_time_s"],
  source_fingerprint: "source-abc",
});
assert(observed?.results[0]?.wasserstein === 1.72, "Observed Wasserstein value was not preserved.");
assert(observed?.results[0]?.ks_pvalue === 0.018, "Observed KS p-value was not preserved.");
assert(observed?.source_fingerprint === "source-abc", "Source identity was not preserved.");

// Given the API's explicit empty-data response, when parsed, then its state and reason survive without synthetic metrics.
const empty = parseEraReport({
  status: "no_data",
  reason: "insufficient_era_metrics",
  reference_era: "reference-era",
  current_era: "current-era",
  n_reference_sessions: 0,
  n_current_sessions: 0,
  results: [],
  metric_count: 0,
  overall_drift_ratio: 0,
  max_severity: "none",
  broken_features: [],
  source_fingerprint: "source-empty",
});
assert(empty?.status === "no_data", "Empty data state was not retained.");
assert(empty?.reason === "insufficient_era_metrics", "Empty data reason was not retained.");
assert(empty?.results.length === 0, "Empty data must not be populated with zero-valued feature rows.");
