"""CatBoost pace model — native high-cardinality categorical support."""

from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

try:
    from catboost import CatBoostRegressor

    HAS_CATBOOST = True
except ImportError:
    HAS_CATBOOST = False
    CatBoostRegressor = None  # type: ignore


class CatBoostPaceModel:
    """CatBoost regression model for pace forecasting with native categorical features."""

    def __init__(
        self,
        params: dict[str, Any] | None = None,
        categorical_features: list[str] | None = None,
    ) -> None:
        self.params = params or {
            "iterations": 500,
            "learning_rate": 0.05,
            "depth": 6,
            "loss_function": "MAE",
            "verbose": 0,
            "random_seed": 42,
        }
        self.categorical_features = categorical_features or [
            "compound",
            "team_id",
            "driver_id",
            "circuit_id",
        ]
        self.model: Any = None
        self.feature_cols: list[str] = []
        self.version: str = "v1-catboost"
        self._fallback_model = None

    def _prepare_X(self, df: pl.DataFrame):
        cols = [c for c in self.feature_cols if c in df.columns]
        sub = df.select(cols)
        for c in cols:
            if c in self.categorical_features:
                sub = sub.with_columns(pl.col(c).fill_null("UNKNOWN").cast(pl.Utf8))
            else:
                try:
                    med = sub[c].median()
                    sub = sub.with_columns(
                        pl.col(c).fill_null(med if med is not None else 0.0).cast(pl.Float64)
                    )
                except Exception:
                    sub = sub.with_columns(pl.col(c).fill_null(0.0).cast(pl.Float64))
        pdf = sub.to_pandas()
        return pdf

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "next_clean_lap_s",
    ) -> CatBoostPaceModel:
        self.feature_cols = feature_cols
        y_train = train_df[target_col].fill_null(90.0).to_numpy()
        X_train = self._prepare_X(train_df)

        if not HAS_CATBOOST:
            # Fallback to PaceLightGBM or Ridge
            try:
                from pitwall.models.pace.lightgbm_model import PaceLightGBM

                self._fallback_model = PaceLightGBM(categorical_features=self.categorical_features)
                self._fallback_model.fit(train_df, valid_df, feature_cols, target_col)
            except Exception:
                from pitwall.models.pace.baseline import RidgeRegressionBaseline

                self._fallback_model = RidgeRegressionBaseline(feature_cols=feature_cols)
                self._fallback_model.fit(train_df, feature_cols, target_col)
            return self

        cat_indices = [i for i, c in enumerate(X_train.columns) if c in self.categorical_features]

        p = {**self.params}
        if "verbose" not in p:
            p["verbose"] = 0

        self.model = CatBoostRegressor(**p, cat_features=cat_indices if cat_indices else None)

        if valid_df is not None and not valid_df.is_empty():
            X_valid = self._prepare_X(valid_df)
            y_valid = valid_df[target_col].fill_null(90.0).to_numpy()
            self.model.fit(
                X_train,
                y_train,
                eval_set=(X_valid, y_valid),
                early_stopping_rounds=50,
                verbose=False,
            )
        else:
            self.model.fit(X_train, y_train, verbose=False)

        return self

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        if not HAS_CATBOOST and self._fallback_model is not None:
            return self._fallback_model.predict(df)
        if self.model is None:
            return np.full(len(df), 90.0)
        X = self._prepare_X(df)
        return self.model.predict(X)

    def save(self, path: Path | str) -> Path:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        with open(path / "model.pkl", "wb") as f:
            pickle.dump(
                {
                    "model": self.model,
                    "fallback": self._fallback_model,
                    "feature_cols": self.feature_cols,
                    "params": self.params,
                    "version": self.version,
                },
                f,
            )
        with open(path / "manifest.json", "w") as f:
            json.dump(
                {
                    "feature_cols": self.feature_cols,
                    "params": self.params,
                    "version": self.version,
                    "has_catboost": HAS_CATBOOST,
                },
                f,
                indent=2,
            )
        return path

    @classmethod
    def load(cls, path: Path | str) -> CatBoostPaceModel:
        path = Path(path)
        with open(path / "model.pkl", "rb") as f:
            data = pickle.load(f)
        obj = cls(params=data.get("params"))
        obj.model = data.get("model")
        obj._fallback_model = data.get("fallback")
        obj.feature_cols = data.get("feature_cols", [])
        obj.version = data.get("version", "v1-catboost")
        return obj
