"""Metrics for regression + quantiles."""

from __future__ import annotations

import numpy as np
import polars as pl


def mae(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.mean(np.abs(y_true - y_pred)))


def rmse(y_true: np.ndarray, y_pred: np.ndarray) -> float:
    return float(np.sqrt(np.mean((y_true - y_pred) ** 2)))


def pinball_loss(y_true: np.ndarray, y_pred: np.ndarray, alpha: float) -> float:
    diff = y_true - y_pred
    return float(np.mean(np.maximum(alpha * diff, (alpha - 1) * diff)))


def interval_coverage(y_true: np.ndarray, q_low: np.ndarray, q_high: np.ndarray) -> float:
    return float(np.mean((y_true >= q_low) & (y_true <= q_high)))


def interval_width(q_low: np.ndarray, q_high: np.ndarray) -> float:
    return float(np.mean(q_high - q_low))


def evaluate_pace(y_true: np.ndarray, q10: np.ndarray, q50: np.ndarray, q90: np.ndarray) -> dict:
    return {
        "mae": mae(y_true, q50),
        "rmse": rmse(y_true, q50),
        "pinball_q10": pinball_loss(y_true, q10, 0.1),
        "pinball_q50": pinball_loss(y_true, q50, 0.5),
        "pinball_q90": pinball_loss(y_true, q90, 0.9),
        "coverage_80": interval_coverage(y_true, q10, q90),
        "mean_width": interval_width(q10, q90),
        "n": len(y_true),
    }


# --- Subgroup evaluation helpers (Iteration 5) ---


def evaluate_per_compound(
    y_true: np.ndarray,
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
    compounds: np.ndarray | list[str],
) -> dict[str, dict]:
    """MAE/RMSE/coverage broken down by tyre compound.

    Args:
        y_true, q10, q50, q90: arrays aligned by row.
        compounds: array/list of compound strings (SOFT/MEDIUM/HARD etc) same length.

    Returns:
        dict[compound -> metrics dict]
    """
    compounds_arr = np.array(compounds, dtype=object)
    unique = np.unique(compounds_arr)
    out: dict[str, dict] = {}
    for comp in unique:
        mask = compounds_arr == comp
        if int(np.sum(mask)) < 1:
            continue
        yt = y_true[mask]
        q10_g = q10[mask]
        q50_g = q50[mask]
        q90_g = q90[mask]
        out[str(comp)] = {
            "mae": mae(yt, q50_g),
            "rmse": rmse(yt, q50_g),
            "coverage_80": interval_coverage(yt, q10_g, q90_g),
            "mean_width": interval_width(q10_g, q90_g),
            "n": int(np.sum(mask)),
        }
    return out


def evaluate_per_stint(
    y_true: np.ndarray,
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
    stint_nos: np.ndarray | list[int],
) -> dict[str, dict]:
    """MAE/RMSE broken down by stint number (1,2,3)."""
    stints = np.array(stint_nos)
    unique = np.unique(stints)
    out: dict[str, dict] = {}
    for s in unique:
        mask = stints == s
        if int(np.sum(mask)) < 1:
            continue
        yt = y_true[mask]
        q10_g = q10[mask]
        q50_g = q50[mask]
        q90_g = q90[mask]
        key = f"stint_{int(s)}"
        out[key] = {
            "mae": mae(yt, q50_g),
            "rmse": rmse(yt, q50_g),
            "coverage_80": interval_coverage(yt, q10_g, q90_g),
            "mean_width": interval_width(q10_g, q90_g),
            "n": int(np.sum(mask)),
        }
    return out


def evaluate_per_circuit_type(
    y_true: np.ndarray,
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
    circuit_types: np.ndarray | list[str],
) -> dict[str, dict]:
    """Breakdown by circuit type (Street/Permanent/HighSpeed)."""
    cats = np.array(circuit_types, dtype=object)
    unique = np.unique(cats)
    out: dict[str, dict] = {}
    for ct in unique:
        mask = cats == ct
        if int(np.sum(mask)) < 1:
            continue
        yt = y_true[mask]
        q10_g = q10[mask]
        q50_g = q50[mask]
        q90_g = q90[mask]
        out[str(ct)] = {
            "mae": mae(yt, q50_g),
            "rmse": rmse(yt, q50_g),
            "coverage_80": interval_coverage(yt, q10_g, q90_g),
            "mean_width": interval_width(q10_g, q90_g),
            "n": int(np.sum(mask)),
        }
    return out


def evaluate_subgroups(
    y_true: np.ndarray,
    q10: np.ndarray,
    q50: np.ndarray,
    q90: np.ndarray,
    df: pl.DataFrame | None = None,
    *,
    compound_col: str = "compound",
    stint_col: str = "stint_no",
    circuit_type_col: str = "circuit_type",
) -> dict[str, dict]:
    """Unified subgroup evaluation helper.

    If df is provided, extracts columns by name and returns nested dict with
    per_compound, per_stint, per_circuit_type. Falls back to flat dict when df is None.

    For callers that already have separate arrays, prefer evaluate_per_compound / etc.
    """
    if df is None or df.is_empty():
        return {}
    result: dict[str, dict] = {}
    try:
        if compound_col in df.columns and len(y_true) == len(df):
            comps = df[compound_col].to_numpy()
            result["per_compound"] = evaluate_per_compound(y_true, q10, q50, q90, comps)
    except Exception:
        pass
    try:
        if stint_col in df.columns and len(y_true) == len(df):
            stints = df[stint_col].to_numpy()
            result["per_stint"] = evaluate_per_stint(y_true, q10, q50, q90, stints)
    except Exception:
        pass
    try:
        if circuit_type_col in df.columns and len(y_true) == len(df):
            cts = df[circuit_type_col].to_numpy()
            result["per_circuit_type"] = evaluate_per_circuit_type(y_true, q10, q50, q90, cts)
    except Exception:
        pass
    return result


def summary_compound_mae(per_compound: dict[str, dict]) -> dict[str, float]:
    """Extract simple compound -> MAE mapping for Prometheus / gate checks."""
    return {k: float(v.get("mae", 0.0)) for k, v in per_compound.items()}


def subgroup_mae_table(
    y_true: np.ndarray,
    q50: np.ndarray,
    groups: dict[str, np.ndarray],
) -> dict[str, float]:
    """Generic helper: compute MAE per named group array.

    Args:
        y_true, q50: aligned arrays
        groups: mapping group_value_array -> name? Actually mapping group_name -> label array
                e.g. {"compound": np.array([...]), "stint": np.array([...])}

    Returns:
        flat dict of "group:value" -> mae
    """
    out: dict[str, float] = {}
    for gname, labels in groups.items():
        arr = np.array(labels, dtype=object)
        for val in np.unique(arr):
            mask = arr == val
            if int(np.sum(mask)) < 1:
                continue
            out[f"{gname}:{val}"] = mae(y_true[mask], q50[mask])
    return out
