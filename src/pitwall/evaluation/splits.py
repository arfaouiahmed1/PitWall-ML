"""Temporal splits — race-level chronological backtesting, no lap leakage."""

from __future__ import annotations

import numpy as np
import polars as pl


def chronological_race_split(
    df: pl.DataFrame,
    session_col: str = "session_id",
    n_test_races: int = 2,
    n_val_races: int = 1,
) -> dict[str, list[str]]:
    """Split by whole races in chronological order.

    Assumes session_id encodes year/event order or df has a date column.
    For V1: sorts unique sessions lexicographically (works if season prefix is year).
    """
    sessions = df.select(session_col).unique().sort(session_col)[session_col].to_list()
    if len(sessions) < n_test_races + n_val_races + 1:
        raise ValueError(
            f"Not enough sessions ({len(sessions)}) for split test={n_test_races} val={n_val_races}"
        )

    test = sessions[-n_test_races:]
    val = sessions[-(n_test_races + n_val_races) : -n_test_races] if n_val_races > 0 else []
    train = (
        sessions[: -(n_test_races + n_val_races)] if (n_test_races + n_val_races) > 0 else sessions
    )

    return {"train": train, "validation": val, "test": test}


def apply_split(
    df: pl.DataFrame, sessions: list[str], session_col: str = "session_id"
) -> pl.DataFrame:
    return df.filter(pl.col(session_col).is_in(sessions))


def expanding_window_folds(
    df: pl.DataFrame, session_col: str = "session_id", min_train_races: int = 5
) -> list[dict[str, list[str]]]:
    """Generate expanding window folds for backtesting.

    Generic expanding window: each fold expands train by 1 race, tests next single race.
    For large histories (>= 48 races) callers should prefer expanding_window_backtest
    which implements the spec 5-fold schedule (30/33/36/39/42 base).
    """
    sessions = df.select(session_col).unique().sort(session_col)[session_col].to_list()
    folds: list[dict[str, list[str]]] = []
    for i in range(min_train_races, len(sessions) - 1):
        folds.append(
            {
                "train": sessions[:i],
                "test": [sessions[i]],
            }
        )
    return folds


def expanding_window_backtest(
    df: pl.DataFrame,
    session_col: str = "session_id",
    n_folds: int = 5,
) -> list[dict[str, list[str]]]:
    """5-fold expanding window backtest over chronological races.

    Implements the spec schedule for 48 historical races:

    - Fold 1: Train 30 races -> Test 3 races (2024 Rounds 31-33)
    - Fold 2: Train 33 races -> Test 3 races (2024 Rounds 34-36)
    - Fold 3: Train 36 races -> Test 3 races (2025 Rounds 1-3)
    - Fold 4: Train 39 races -> Test 3 races (2025 Rounds 4-6)
    - Fold 5: Train 42 races -> Test 6 races (2025 Rounds 7-12)

    For datasets where n_sessions != 48 the schedule is adapted proportionally:
    - The base train sizes are [30, 33, 36, 39, 42] scaled to actual n.
    - Falls back to generic expanding_window_folds when n_sessions < 10 or n_folds != 5.
    - Ensures train and test sets are disjoint and chronological.

    Returns a list of dicts each with keys: train, test, fold (1-indexed),
    train_size, test_size. Compatibility: each fold dict at minimum contains
    "train" and "test" lists.
    """
    sessions = df.select(session_col).unique().sort(session_col)[session_col].to_list()
    n_sessions = len(sessions)

    # Fallback for small datasets or non-spec n_folds
    if n_sessions < 10 or n_folds != 5:
        # Generic expanding window with n_folds folds, evenly spaced start points
        if n_folds <= 1:
            return expanding_window_folds(
                df, session_col=session_col, min_train_races=max(5, n_sessions // 2)
            )
        # Create n_folds folds expanding from 50% to 85% of data
        folds: list[dict[str, list[str]]] = []
        min_train = max(5, n_sessions - n_folds * 2)
        # Distribute train ends evenly
        step = max(1, (n_sessions - min_train) // n_folds)
        for k in range(n_folds):
            train_end = min_train + k * step
            if k == n_folds - 1:
                # last fold consumes remainder
                test = sessions[train_end:]
            else:
                test_end = min(train_end + step, n_sessions)
                test = sessions[train_end:test_end]
            if not test or train_end <= 0:
                continue
            folds.append(
                {
                    "train": sessions[:train_end],
                    "test": test,
                    "fold": k + 1,
                    "train_size": train_end,
                    "test_size": len(test),
                }
            )
        return folds

    # Spec pattern for ~48 races
    # Base schedule as defined; scale if n_sessions differs slightly
    base_train = [30, 33, 36, 39, 42]
    base_test = [3, 3, 3, 3, 6]

    # If exactly 48, use as-is; otherwise proportionally adjust but keep spec structure
    if n_sessions != 48:
        # Scale train sizes proportionally to keep last train end at n_sessions - last test
        # Keep relative spacing of 3 races
        scale = (n_sessions - base_test[-1]) / 42 if 42 != 0 else 1.0
        # Round and ensure monotonic increase
        scaled_train = [max(5, round(t * scale)) for t in base_train]
        # Ensure strictly increasing and within bounds
        for i in range(1, len(scaled_train)):
            if scaled_train[i] <= scaled_train[i - 1]:
                scaled_train[i] = scaled_train[i - 1] + 3
        # Cap last train so test fits
        scaled_train[-1] = min(scaled_train[-1], n_sessions - base_test[-1])
        base_train = scaled_train
        # Adjust test sizes to fill remainder for last fold
        remaining = n_sessions - base_train[-1]
        base_test[-1] = max(1, remaining)
        # Ensure earlier test sizes don't overflow
        for i in range(len(base_train) - 1):
            available = base_train[i + 1] - base_train[i]
            if base_test[i] > available:
                base_test[i] = max(1, available)

    folds_out: list[dict[str, list[str]]] = []
    for idx, (t_size, te_size) in enumerate(zip(base_train, base_test, strict=False)):
        # Clamp to available sessions
        t_size_c = min(t_size, n_sessions - 1)
        te_start = t_size_c
        te_end = min(te_start + te_size, n_sessions)
        train = sessions[:t_size_c]
        test = sessions[te_start:te_end]
        if not train or not test:
            continue
        folds_out.append(
            {
                "train": train,
                "test": test,
                "fold": idx + 1,
                "train_size": len(train),
                "test_size": len(test),
            }
        )
    return folds_out


def summarize_backtest_metrics(
    per_fold_metrics: list[dict[str, float]],
) -> dict[str, dict[str, float]]:
    """Compute mean/std of MAE/RMSE/coverage across folds.

    Args:
        per_fold_metrics: list of dicts each containing mae, rmse, coverage_80 (or coverage)

    Returns:
        dict keyed by metric with mean/std/count.
    """
    if not per_fold_metrics:
        return {}
    keys = ["mae", "rmse", "coverage_80", "coverage", "mean_width", "pinball_q10", "pinball_q90"]
    out: dict[str, dict[str, float]] = {}
    for k in keys:
        vals = [float(m[k]) for m in per_fold_metrics if k in m and m[k] is not None]
        if vals:
            arr = np.array(vals, dtype=float)
            out[k] = {
                "mean": float(np.mean(arr)),
                "std": float(np.std(arr, ddof=1)) if len(arr) > 1 else 0.0,
                "min": float(np.min(arr)),
                "max": float(np.max(arr)),
                "count": len(vals),
            }
    return out


# Backward compat alias - some callers may expect this name
expanding_window_splits = expanding_window_folds
