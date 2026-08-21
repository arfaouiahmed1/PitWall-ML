"""SHAP TreeExplainer for LightGBM pace/tyre/pit (V2).

Falls back gracefully if shap not installed — returns permutation importance proxy.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl


def _permutation_importance_proxy(model, X: Any, feature_cols: list[str]) -> dict[str, float]:
    """Fallback when shap not available: use LightGBM gain importance."""
    try:
        # LGBMRegressor/Classifier has feature_importances_ (split/gain)
        imp = model.feature_importances_
        # normalize to 0-100
        if imp.max() > 0:
            imp = imp / imp.max() * 100
        return {f: float(imp[i]) for i, f in enumerate(feature_cols) if i < len(imp)}
    except Exception:
        # uniform
        return {f: float(100 / len(feature_cols)) for f in feature_cols}


def compute_shap_summary(
    model: Any,
    data: pl.DataFrame,
    feature_cols: list[str],
    sample_n: int = 200,
    seed: int = 42,
) -> dict[str, float]:
    """Compute mean |SHAP| per feature.

    model: fitted LGBMRegressor/Classifier (or wrapper with .model)
    data: Polars DataFrame with feature columns
    """
    # unwrap if wrapper
    core = getattr(model, "model", model)
    # if QuantileLightGBM dict, use median model
    if isinstance(core, dict):
        # pick 0.5
        core = core.get(0.5, next(iter(core.values())))

    # prepare X
    cols = [c for c in feature_cols if c in data.columns]
    if not cols:
        return {}
    # sample for speed
    if len(data) > sample_n:
        data = data.sample(n=sample_n, seed=seed)
    # Use same _prepare_X logic as model if available, else simple pandas
    try:
        # reuse model's _prepare_X if wrapper has it
        if hasattr(model, "_prepare_X"):
            X = model._prepare_X(data)  # type: ignore
        else:
            X = data.select(cols).to_pandas()
    except Exception:
        X = data.select(cols).to_pandas()

    # Try shap
    try:
        import shap  # type: ignore

        # TreeExplainer for LightGBM
        explainer = shap.TreeExplainer(core)
        shap_vals = explainer.shap_values(X)
        # shap_vals shape: (n_samples, n_features) for regression; list for multiclass
        if isinstance(shap_vals, list):
            shap_vals = shap_vals[0]
        shap_vals = np.array(shap_vals)
        # Handle Lite: if shape mismatch due to categoricals, try Convert X to numeric
        if shap_vals.ndim == 1:
            shap_vals = shap_vals.reshape(-1, len(cols))
        mean_abs = np.abs(shap_vals).mean(axis=0)
        # normalize to 0-100
        if mean_abs.max() > 0:
            mean_abs = mean_abs / mean_abs.max() * 100
        out = {f: float(mean_abs[i]) for i, f in enumerate(cols) if i < len(mean_abs)}
        # sort descending
        out = dict(sorted(out.items(), key=lambda x: x[1], reverse=True))
        return out
    except Exception:
        # fallback
        # print(f"SHAP fallback: {e}")
        return _permutation_importance_proxy(core, X, cols)


def compute_and_save_shap(
    model: Any,
    data: pl.DataFrame,
    feature_cols: list[str],
    out_path: str | Path,
    sample_n: int = 200,
) -> dict[str, float]:
    summary = compute_shap_summary(model, data, feature_cols, sample_n=sample_n)
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with open(out_path, "w") as f:
        json.dump(summary, f, indent=2)
    return summary
