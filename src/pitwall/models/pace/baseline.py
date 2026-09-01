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


class RidgeRegressionBaseline:
    """L2-regularized linear baseline on normalized numerical features."""

    def __init__(self, alpha: float = 1.0, feature_cols: list[str] | None = None) -> None:
        self.alpha = alpha
        self.feature_cols = feature_cols or []
        self.model = None
        self.scaler_mean = None
        self.scaler_scale = None

    def _prepare_X(self, df: pl.DataFrame) -> np.ndarray:
        cols = [c for c in self.feature_cols if c in df.columns]
        if not cols:
            # fallback to whatever numeric columns are present
            cols = [
                c
                for c in ["tyre_age", "stint_no", "lap_number", "position", "rolling_median_5"]
                if c in df.columns
            ]
        if not cols:
            return np.zeros((len(df), 1))

        sub = df.select(cols)
        # Fill nulls with column medians or 0
        filled = []
        for c in cols:
            try:
                med = sub[c].median()
                filled.append(
                    sub[c].fill_null(med if med is not None else 0.0).cast(pl.Float64).to_numpy()
                )
            except Exception:
                filled.append(np.zeros(len(df)))
        X = np.column_stack(filled) if filled else np.zeros((len(df), 1))
        return X

    def fit(
        self,
        df: pl.DataFrame,
        feature_cols: list[str] | None = None,
        target_col: str = "next_clean_lap_s",
    ) -> RidgeRegressionBaseline:
        from sklearn.linear_model import Ridge
        from sklearn.preprocessing import StandardScaler

        if feature_cols:
            self.feature_cols = feature_cols
        X = self._prepare_X(df)
        y = df[target_col].fill_null(90.0).to_numpy()

        scaler = StandardScaler()
        X_scaled = scaler.fit_transform(X)
        self.scaler_mean = scaler.mean_
        self.scaler_scale = scaler.scale_

        self.model = Ridge(alpha=self.alpha)
        self.model.fit(X_scaled, y)
        return self

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        if self.model is None or self.scaler_mean is None:
            return np.full(len(df), 90.0)
        X = self._prepare_X(df)
        # Safe scaling
        scale = np.where(self.scaler_scale == 0, 1.0, self.scaler_scale)
        X_scaled = (X - self.scaler_mean) / scale
        return self.model.predict(X_scaled)
