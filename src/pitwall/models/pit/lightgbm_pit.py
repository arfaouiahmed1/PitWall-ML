"""Pit hazard — discrete-time hazard classifier (V2).

Predicts P(pit in next 3 laps) and P(pit next lap) as binary classification.
Uses LightGBM classifier with logloss, handles class imbalance via scale_pos_weight.
"""

from __future__ import annotations

import json
import pickle
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

try:
    import lightgbm as lgb
except ImportError:
    lgb = None  # type: ignore


class PitHazardLightGBM:
    def __init__(
        self, params: dict[str, Any] | None = None, categorical_features: list[str] | None = None
    ):
        if lgb is None:
            raise ImportError("lightgbm not installed")
        self.params = params or {
            "objective": "binary",
            "metric": "binary_logloss",
            "boosting_type": "gbdt",
            "num_leaves": 15,
            "learning_rate": 0.08,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.8,
            "bagging_freq": 3,
            "verbose": -1,
            "n_estimators": 200,
        }
        self.categorical_features = categorical_features or []
        self.model: Any = None
        self.feature_cols: list[str] = []
        self.version = "v2-pit"
        self.horizon: int = 3

    def _prepare_X(self, df: pl.DataFrame):
        cols = [c for c in self.feature_cols if c in df.columns]
        sub = df.select(cols)
        for c in cols:
            if c in self.categorical_features:
                sub = sub.with_columns(pl.col(c).fill_null("UNKNOWN").cast(pl.Utf8))
            else:
                try:
                    med = sub[c].median()
                    sub = sub.with_columns(pl.col(c).fill_null(med))
                except Exception:
                    sub = sub.with_columns(pl.col(c).fill_null(0))
        pdf = sub.to_pandas()
        for c in self.categorical_features:
            if c in pdf.columns:
                pdf[c] = pdf[c].astype("category")
        for col in pdf.select_dtypes(include=["object"]).columns:
            pdf[col] = pdf[col].astype("category")
        return pdf

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "pit_in_next_3",
    ) -> PitHazardLightGBM:
        self.feature_cols = feature_cols
        if target_col not in train_df.columns:
            raise ValueError(f"target {target_col} not in train")
        self.horizon = int(target_col.split("_")[-1]) if "next_" in target_col else 3
        X_train = self._prepare_X(train_df)
        y_train = train_df[target_col].to_numpy()
        # scale_pos_weight for imbalance
        pos = float((y_train == 1).sum())
        neg = float((y_train == 0).sum())
        spw = (neg / pos) if pos > 0 else 1.0
        spw = min(spw, 10.0)

        p = {
            k: v
            for k, v in self.params.items()
            if k not in ("n_estimators", "early_stopping_rounds")
        }
        if "verbose" not in p:
            p["verbose"] = -1
        if "scale_pos_weight" not in p:
            p["scale_pos_weight"] = spw
        n_est = self.params.get("n_estimators", 200)
        esr = self.params.get("early_stopping_rounds")

        self.model = lgb.LGBMClassifier(**p, n_estimators=n_est)  # type: ignore

        X_valid = None
        y_valid = None
        if valid_df is not None and not valid_df.is_empty() and target_col in valid_df.columns:
            X_valid = self._prepare_X(valid_df)
            y_valid = valid_df[target_col].to_numpy()
            if X_valid is not None and esr:
                self.model.fit(
                    X_train,
                    y_train,
                    eval_set=[(X_valid, y_valid)],
                    callbacks=[lgb.early_stopping(esr), lgb.log_evaluation(0)],  # type: ignore
                )
            elif X_valid is not None:
                self.model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)])
            else:
                self.model.fit(X_train, y_train)
        else:
            self.model.fit(X_train, y_train)
        return self

    def predict_proba(self, df: pl.DataFrame) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("Pit model not fitted")
        X = self._prepare_X(df)
        # LGBMClassifier predict_proba returns (n,2)
        proba = self.model.predict_proba(X)
        # prob of class 1
        if proba.ndim == 2 and proba.shape[1] == 2:
            return proba[:, 1]
        return proba

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        return (self.predict_proba(df) >= 0.5).astype(int)

    def save(self, path: Path | str) -> Path:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        with open(path / "model.pkl", "wb") as f:
            pickle.dump(
                {"model": self.model, "feature_cols": self.feature_cols, "params": self.params},
                f,
            )
        with open(path / "manifest.json", "w") as f:
            json.dump(
                {
                    "feature_cols": self.feature_cols,
                    "params": self.params,
                    "version": self.version,
                    "horizon": self.horizon,
                },
                f,
                indent=2,
            )
        return path

    @classmethod
    def load(cls, path: Path | str) -> PitHazardLightGBM:
        path = Path(path)
        with open(path / "model.pkl", "rb") as f:
            data = pickle.load(f)
        obj = cls(params=data["params"])
        obj.model = data["model"]
        obj.feature_cols = data["feature_cols"]
        return obj
