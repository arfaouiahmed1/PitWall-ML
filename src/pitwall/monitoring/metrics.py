"""Prometheus metrics — V3 with drift, pace, HTTP."""

from __future__ import annotations

import time
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
    except Exception:
        pass
