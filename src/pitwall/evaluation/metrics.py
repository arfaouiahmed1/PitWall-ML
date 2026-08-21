"""Metrics for regression + quantiles."""

from __future__ import annotations

import numpy as np


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
