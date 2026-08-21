"""Baselines for pace prediction."""

from __future__ import annotations

import numpy as np
import polars as pl


class LastLapBaseline:
    def fit(self, df: pl.DataFrame) -> LastLapBaseline:
        return self

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        # Predict last_clean_lap_s or lap_time_s
        col = "last_clean_lap_s" if "last_clean_lap_s" in df.columns else "lap_time_s"
        if col not in df.columns:
            return np.full(len(df), 90.0)
        return df[col].fill_null(90.0).to_numpy()


class RollingMedianBaseline:
    def __init__(self, window: int = 3) -> None:
        self.window = window

    def fit(self, df: pl.DataFrame) -> RollingMedianBaseline:
        return self

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        col = f"rolling_median_{self.window}"
        if col in df.columns:
            return df[col].fill_null(90.0).to_numpy()
        # fallback to lap_time
        if "lap_time_s" in df.columns:
            return df["lap_time_s"].fill_null(90.0).to_numpy()
        return np.full(len(df), 90.0)
