"""Prometheus metrics — V3 with drift, pace, HTTP."""

from __future__ import annotations

import contextlib
from typing import Any

from prometheus_client import Counter, Gauge, Histogram

# Service
http_requests_total = Counter(
    "http_requests_total", "HTTP requests", ["method", "endpoint", "status"]
)
http_request_duration_seconds = Histogram(
    "http_request_duration_seconds", "HTTP duration", ["endpoint"]
)
inference_requests_total = Counter(
    "inference_requests_total", "Inference requests", ["model", "alias"]
)
inference_duration_seconds = Histogram("inference_duration_seconds", "Inference latency", ["model"])
event_processing_lag_seconds = Gauge(
    "event_processing_lag_seconds", "Lag between event_ts and processing"
)
feature_freshness_seconds = Gauge("feature_freshness_seconds", "Feature staleness")
replay_events_processed_total = Counter("replay_events_processed_total", "Replay events")
websocket_clients = Gauge("websocket_clients", "Connected WS clients")
errors_total = Counter("errors_total", "Errors", ["type"])

# ML — V3
pace_mae_seconds = Gauge("pace_mae_seconds", "Pace MAE", ["model_version", "alias"])
pace_rmse_seconds = Gauge("pace_rmse_seconds", "Pace RMSE", ["model_version", "alias"])
pace_interval_coverage = Gauge("pace_interval_coverage", "Coverage", ["model_version"])
pace_mean_width_seconds = Gauge("pace_mean_width_seconds", "Mean interval width", ["model_version"])
prediction_error_rolling = Gauge("prediction_error_rolling", "Rolling error")
drifting_features_ratio = Gauge("drifting_features_ratio", "Drift ratio")
missing_feature_ratio = Gauge("missing_feature_ratio", "Missing ratio")
feature_drift_details = Gauge("feature_drift_details", "Per-feature drift (1=drift)", ["feature"])
model_p95_ms = Gauge("model_p95_ms", "Model p95 latency ms", ["model_version"])
tyre_mae_seconds = Gauge("tyre_mae_seconds", "Tyre MAE", ["model_version"])
pit_auc = Gauge("pit_auc", "Pit AUC", ["model_version"])

# Era drift & subgroup — V4 (2025 -> 2026)
feature_wasserstein_distance = Gauge(
    "feature_wasserstein_distance",
    "Wasserstein distance (W1) per feature per era",
    ["feature", "era"],
)
feature_psi_value = Gauge(
    "feature_psi_value", "Population Stability Index per feature per era", ["feature", "era"]
)
# Alias for alert compatibility: alerts.yml references feature_psi, metrics spec uses feature_psi_value
feature_psi = Gauge("feature_psi", "PSI per feature per era (alias)", ["feature", "era"])
subgroup_compound_mae = Gauge(
    "subgroup_compound_mae", "MAE per compound", ["compound", "model_version"]
)
# Alias for alert: subgroup_hard_mae_seconds (alert) is HARD view of subgroup_compound_mae
subgroup_hard_mae_seconds = Gauge(
    "subgroup_hard_mae_seconds", "Hard compound MAE (alias for alert)", ["model_version"]
)
strategy_simulations_total = Counter(
    "strategy_simulations_total", "Strategy simulations run", ["mode"]
)


def observe_http(method: str, endpoint: str, status: int, duration_s: float) -> None:
    http_requests_total.labels(method=method, endpoint=endpoint, status=str(status)).inc()
    http_request_duration_seconds.labels(endpoint=endpoint).observe(duration_s)


def observe_inference(model: str, alias: str, duration_s: float) -> None:
    inference_requests_total.labels(model=model, alias=alias).inc()
    inference_duration_seconds.labels(model=model).observe(duration_s)


def set_pace_metrics(metrics: dict[str, Any], model_version: str = "champion") -> None:
    try:
        if "mae" in metrics:
            pace_mae_seconds.labels(model_version=model_version, alias="champion").set(
                float(metrics["mae"])
            )
        if "rmse" in metrics:
            pace_rmse_seconds.labels(model_version=model_version, alias="champion").set(
                float(metrics["rmse"])
            )
        if "coverage_80" in metrics:
            pace_interval_coverage.labels(model_version=model_version).set(
                float(metrics["coverage_80"])
            )
        if "mean_width" in metrics:
            pace_mean_width_seconds.labels(model_version=model_version).set(
                float(metrics["mean_width"])
            )
        if "p95_ms" in metrics:
            model_p95_ms.labels(model_version=model_version).set(float(metrics["p95_ms"]))
        if "tyre_mae" in metrics and metrics["tyre_mae"] is not None:
            tyre_mae_seconds.labels(model_version=model_version).set(float(metrics["tyre_mae"]))
        if "pit_auc" in metrics and metrics["pit_auc"] is not None:
            pit_auc.labels(model_version=model_version).set(float(metrics["pit_auc"]))
    except Exception:
        pass


def set_drift_metrics(drift_result: dict[str, Any]) -> None:
    try:
        ratio = (
            drift_result.get("drift_ratio") or drift_result.get("drifting_features_ratio") or 0.0
        )
        drifting_features_ratio.set(float(ratio))
        miss = drift_result.get("missing_ratio", 0.0)
        missing_feature_ratio.set(float(miss))
        per_feat = drift_result.get("per_feature", {}) or drift_result.get("details", {})
        for feat, is_drift in per_feat.items():
            try:
                # is_drift may be bool or dict
                val = (
                    1.0
                    if (
                        is_drift is True or (isinstance(is_drift, dict) and is_drift.get("drifted"))
                    )
                    else float(is_drift)
                    if isinstance(is_drift, (int, float))
                    else 0.0
                )
                feature_drift_details.labels(feature=str(feat)).set(val)
            except Exception:
                continue
        # Extended V4: set Wasserstein and PSI per-feature if provided
        try:
            era = str(drift_result.get("era") or drift_result.get("regulation_era") or "2026")
            # Explicit maps: wasserstein_by_feature / psi_by_feature
            w_map = (
                drift_result.get("wasserstein_by_feature") or drift_result.get("wasserstein") or {}
            )
            if isinstance(w_map, dict):
                for feat, val in w_map.items():
                    try:
                        feature_wasserstein_distance.labels(feature=str(feat), era=era).set(
                            float(val)
                        )
                    except Exception:
                        continue
            psi_map = drift_result.get("psi_by_feature") or drift_result.get("psi") or {}
            if isinstance(psi_map, dict):
                for feat, val in psi_map.items():
                    try:
                        fv = float(val)
                        feature_psi_value.labels(feature=str(feat), era=era).set(fv)
                        feature_psi.labels(feature=str(feat), era=era).set(fv)
                    except Exception:
                        continue
            # Per-feature dicts containing nested metrics (era_drift_analysis style)
            for feat, info in list(per_feat.items()):
                if isinstance(info, dict):
                    w = (
                        info.get("wasserstein")
                        or info.get("w1")
                        or info.get("wasserstein_distance")
                    )
                    if w is not None:
                        with contextlib.suppress(Exception):
                            feature_wasserstein_distance.labels(feature=str(feat), era=era).set(
                                float(w)
                            )
                    p = info.get("psi") or info.get("psi_value") or info.get("PSI")
                    if p is not None:
                        try:
                            fv = float(p)
                            feature_psi_value.labels(feature=str(feat), era=era).set(fv)
                            feature_psi.labels(feature=str(feat), era=era).set(fv)
                        except Exception:
                            pass
            # Top-level era_report handling
            era_report = drift_result.get("era_report")
            if isinstance(era_report, dict):
                results = era_report.get("results") or era_report.get("per_feature") or {}
                if isinstance(results, dict):
                    for feat, res in results.items():
                        if isinstance(res, dict):
                            w = res.get("wasserstein")
                            p = res.get("psi")
                            if w is not None:
                                with contextlib.suppress(Exception):
                                    feature_wasserstein_distance.labels(
                                        feature=str(feat), era=era
                                    ).set(float(w))
                            if p is not None:
                                try:
                                    fv = float(p)
                                    feature_psi_value.labels(feature=str(feat), era=era).set(fv)
                                    feature_psi.labels(feature=str(feat), era=era).set(fv)
                                except Exception:
                                    pass
        except Exception:
            pass
    except Exception:
        pass


def set_subgroup_mae(
    compound: str | dict[str, Any],
    mae_seconds: float | None = None,
    model_version: str = "champion",
) -> None:
    """Set subgroup MAE per compound.

    Supports two call patterns:
      set_subgroup_mae("HARD", 5.2, model_version="champion")
      set_subgroup_mae({"SOFT": 1.1, "HARD": 5.2}, model_version="champion")
    """
    try:
        # Dict form: set_subgroup_mae({"SOFT": 1.2, "MEDIUM": 2.3}, ...)
        if isinstance(compound, dict):
            d = compound
            mv = (
                str(mae_seconds)
                if isinstance(mae_seconds, str) and mae_seconds != "champion"
                else model_version
            )
            # If second arg is actually model_version when dict form is used
            if isinstance(mae_seconds, str):
                mv = mae_seconds
            for comp, val in d.items():
                try:
                    cv = str(comp).upper()
                    fv = float(val)  # type: ignore[arg-type]
                    subgroup_compound_mae.labels(compound=cv, model_version=str(mv)).set(fv)
                    if cv == "HARD":
                        subgroup_hard_mae_seconds.labels(model_version=str(mv)).set(fv)
                except Exception:
                    continue
            return
        # Scalar form
        if mae_seconds is None:
            return
        cv = str(compound).upper()
        fv = float(mae_seconds)
        subgroup_compound_mae.labels(compound=cv, model_version=str(model_version)).set(fv)
        if cv == "HARD":
            subgroup_hard_mae_seconds.labels(model_version=str(model_version)).set(fv)
    except Exception:
        pass


def inc_strategy_simulation(mode: str = "whatif") -> None:
    """Increment strategy simulation counter."""
    with contextlib.suppress(Exception):
        strategy_simulations_total.labels(mode=str(mode)).inc()
