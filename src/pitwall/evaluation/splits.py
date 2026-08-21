"""Temporal splits — race-level chronological backtesting, no lap leakage."""

from __future__ import annotations

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
    """Generate expanding window folds for backtesting."""
    sessions = df.select(session_col).unique().sort(session_col)[session_col].to_list()
    folds = []
    for i in range(min_train_races, len(sessions) - 1):
        folds.append(
            {
                "train": sessions[:i],
                "test": [sessions[i]],
            }
        )
    return folds
