"""Drift detection — Evidently DataDriftPreset with scipy fallback (V3)."""

from __future__ import annotations

from typing import Any

import polars as pl


def _ks_fallback(
    reference: pl.DataFrame, current: pl.DataFrame, cols: list[str], threshold: float = 0.05
) -> dict[str, Any]:
    """Simple KS test fallback per column."""
    try:
        from scipy.stats import ks_2samp  # type: ignore
    except ImportError:
        # if scipy not available, heuristic: compare means
        per_feature: dict[str, Any] = {}
        drifted = 0
        for c in cols:
            if c not in reference.columns or c not in current.columns:
                continue
            try:
                ref = reference[c].drop_nulls().to_numpy()
                cur = current[c].drop_nulls().to_numpy()
                if len(ref) == 0 or len(cur) == 0:
                    continue
                # simple mean shift > 0.3*std as drift
                mean_shift = abs(float(ref.mean()) - float(cur.mean()))
                std = float(ref.std()) if float(ref.std()) != 0 else 1.0
                is_drift = mean_shift > 0.5 * std
                per_feature[c] = {"drifted": is_drift, "mean_shift": mean_shift}
                if is_drift:
                    drifted += 1
            except Exception:
                continue
        total = len(per_feature) or 1
        return {
            "method": "heuristic_mean",
            "drift_ratio": drifted / total,
            "per_feature": per_feature,
            "drifted_features": [k for k, v in per_feature.items() if v.get("drifted")],
            "threshold": threshold,
        }

    per_feature: dict[str, Any] = {}
    drifted = 0
    for c in cols:
        if c not in reference.columns or c not in current.columns:
            continue
        try:
            # only numerical
            ref = reference[c].drop_nulls().to_numpy()
            cur = current[c].drop_nulls().to_numpy()
            if len(ref) < 10 or len(cur) < 10:
                continue
            # need numeric
            try:
                ref_f = ref.astype(float)
                cur_f = cur.astype(float)
            except Exception:
                # categorical: compare distribution via simple chi? Fallback to heuristic
                continue
            stat, pval = ks_2samp(ref_f, cur_f)
            is_drift = pval < threshold
            per_feature[c] = {
                "p_value": float(pval),
                "statistic": float(stat),
                "drifted": bool(is_drift),
            }
            if is_drift:
                drifted += 1
        except Exception:
            continue
    total = len(per_feature) or 1
    return {
        "method": "ks_2samp",
        "drift_ratio": drifted / total,
        "per_feature": per_feature,
        "drifted_features": [k for k, v in per_feature.items() if v["drifted"]],
        "threshold": threshold,
    }


def detect_drift(
    reference: pl.DataFrame,
    current: pl.DataFrame,
    columns: list[str] | None = None,
    threshold: float = 0.05,
) -> dict[str, Any]:
    """Detect drift between reference and current.

    Tries Evidently first, falls back to KS. Returns dict with drift_ratio, per_feature, method.
    """
    if reference.is_empty() or current.is_empty():
        return {"method": "empty", "drift_ratio": 0.0, "per_feature": {}, "drifted_features": []}

    # infer columns
    if columns is None:
        # use numeric + categorical from reference
        columns = [c for c in reference.columns if c in current.columns]
        # filter to meaningful
        # keep only those with variance
        columns = [c for c in columns if reference[c].n_unique() > 1]

    # Try Evidently
    try:
        import pandas as pd  # noqa: F401

        # Try modern evidently API (v0.4+)
        try:
            from evidently.report import Report  # type: ignore
            from evidently.metric_preset import DataDriftPreset  # type: ignore

            ref_pd = reference.select(columns).to_pandas()
            cur_pd = current.select(columns).to_pandas()
            report = Report(metrics=[DataDriftPreset()])
            report.run(reference_data=ref_pd, current_data=cur_pd)
            res = report.as_dict()
            # parse drift
            # Evidently 0.4 returns metrics[0].result
            try:
                drift_metric = res["metrics"][0]["result"]
                drift_ratio = drift_metric.get("share_of_drifted_columns", 0.0)
                per_feat = {}
                for col, details in drift_metric.get("drift_by_columns", {}).items():
                    per_feat[col] = {
                        "drifted": bool(details.get("drift_detected")),
                        "p_value": details.get("p_value"),
                    }
                return {
                    "method": "evidently_DataDriftPreset",
                    "drift_ratio": float(drift_ratio),
                    "per_feature": per_feat,
                    "drifted_features": [k for k, v in per_feat.items() if v.get("drifted")],
                    "threshold": threshold,
                    "raw": res,
                }
            except Exception:
                # fallback to generic parsing
                pass
        except Exception:
            pass

        # Try DatasetDriftMetric (evidently 0.6)
        try:
            from evidently.metrics import DatasetDriftMetric  # type: ignore
            from evidently.report import Report  # type: ignore

            ref_pd = reference.select(columns).to_pandas()
            cur_pd = current.select(columns).to_pandas()
            report = Report(metrics=[DatasetDriftMetric()])
            report.run(reference_data=ref_pd, current_data=cur_pd)
            res = report.as_dict()
            # new format: metrics[0].result.dataset_drift etc.
            drift = res["metrics"][0]["result"].get("dataset_drift", False)
            ratio = 1.0 if drift else 0.0
            return {
                "method": "evidently_DatasetDriftMetric",
                "drift_ratio": float(ratio),
                "per_feature": {},
                "drifted_features": [],
                "threshold": threshold,
                "raw": res,
            }
        except Exception:
            pass
    except Exception:
        pass

    # Fallback to KS
    return _ks_fallback(reference, current, columns, threshold=threshold)


def drift_on_window(
    gold: pl.DataFrame,
    n_reference_races: int = 3,
    n_current_races: int = 3,
    columns: list[str] | None = None,
) -> dict[str, Any]:
    """Split gold into reference (earliest) and current (latest) window for drift demo."""
    if "session_id" not in gold.columns:
        return {"method": "no_session", "drift_ratio": 0.0, "per_feature": {}}
    sessions = gold.select("session_id").unique().sort("session_id")["session_id"].to_list()
    if len(sessions) < n_reference_races + n_current_races:
        return {"method": "not_enough_sessions", "drift_ratio": 0.0, "per_feature": {}}
    ref_sessions = sessions[:n_reference_races]
    cur_sessions = sessions[-n_current_races:]
    ref = gold.filter(pl.col("session_id").is_in(ref_sessions))
    cur = gold.filter(pl.col("session_id").is_in(cur_sessions))
    return detect_drift(ref, cur, columns=columns)
