"""Prometheus metrics."""

from __future__ import annotations

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

# ML
pace_mae_seconds = Gauge("pace_mae_seconds", "Pace MAE", ["model_version", "alias"])
pace_interval_coverage = Gauge("pace_interval_coverage", "Coverage", ["model_version"])
prediction_error_rolling = Gauge("prediction_error_rolling", "Rolling error")
drifting_features_ratio = Gauge("drifting_features_ratio", "Drift ratio")
missing_feature_ratio = Gauge("missing_feature_ratio", "Missing ratio")
