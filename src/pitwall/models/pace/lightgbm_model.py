"""LightGBM pace model — quantile + point prediction."""

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
    lgb = None  # type: ignore[assignment]


class PaceLightGBM:
    def __init__(
        self, params: dict[str, Any] | None = None, categorical_features: list[str] | None = None
    ) -> None:
        if lgb is None:
            raise ImportError("lightgbm not installed. pip install lightgbm")
        self.params = params or {
            "objective": "regression",
            "metric": "mae",
            "boosting_type": "gbdt",
            "num_leaves": 31,
            "learning_rate": 0.05,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "n_estimators": 500,
        }
        self.categorical_features = categorical_features or []
        self.model: Any = None
        self.feature_cols: list[str] = []
        self.version: str = "v0"

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "next_clean_lap_s",
    ) -> PaceLightGBM:
        self.feature_cols = feature_cols

        # Prepare matrices — handle categoricals
        X_train = self._prepare_X(train_df)
        y_train = train_df[target_col].to_numpy()

        X_valid = None
        y_valid = None
        if valid_df is not None and not valid_df.is_empty():
            X_valid = self._prepare_X(valid_df)
            y_valid = valid_df[target_col].to_numpy()

        n_est = self.params.get("n_estimators", 500)
        # Strip n_estimators from params for LGBMRegressor
        p = {
            k: v
            for k, v in self.params.items()
            if k not in ("n_estimators", "early_stopping_rounds")
        }
        esr = self.params.get("early_stopping_rounds")

        self.model = lgb.LGBMRegressor(**p, n_estimators=n_est, verbose=-1)  # type: ignore[call-arg]

        if X_valid is not None and esr:
            self.model.fit(
                X_train,
                y_train,
                eval_set=[(X_valid, y_valid)],
                callbacks=[lgb.early_stopping(esr), lgb.log_evaluation(0)],  # type: ignore[attr-defined]
            )
        elif X_valid is not None:
            self.model.fit(X_train, y_train, eval_set=[(X_valid, y_valid)])
        else:
            self.model.fit(X_train, y_train)

        return self

    def _prepare_X(self, df: pl.DataFrame) -> np.ndarray | Any:
        # Use pandas for categorical handling if needed
        cols = [c for c in self.feature_cols if c in df.columns]
        sub = df.select(cols)
        # Fill nulls: median for numeric, UNKNOWN for categoricals
        for c in cols:
            if c in self.categorical_features:
                sub = sub.with_columns(pl.col(c).fill_null("UNKNOWN").cast(pl.Utf8))
            else:
                # numeric — fill with median
                try:
                    med = sub[c].median()
                    sub = sub.with_columns(pl.col(c).fill_null(med))
                except Exception:
                    sub = sub.with_columns(pl.col(c).fill_null(0))
        # Convert categoricals to category dtype for LightGBM
        pdf = sub.to_pandas()
        for c in self.categorical_features:
            if c in pdf.columns:
                pdf[c] = pdf[c].astype("category")
        return pdf

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        if self.model is None:
            raise RuntimeError("Model not fitted")
        X = self._prepare_X(df)
        return self.model.predict(X)

    def predict_quantiles(
        self, df: pl.DataFrame, alphas: list[float] | None = None
    ) -> dict[float, np.ndarray]:
        """Train separate quantile models? For V1 we approximate by point +/- learned residual.

        Proper quantile training requires separate LightGBM quantile objectives.
        V1: use point prediction +/- empirical interval width.
        """
        point = self.predict(df)
        # Simple heuristic: ±0.5s for q10/q90 if no quantile models trained
        # TODO V2: train lgb with objective quantile + alpha per model
        return {0.5: point, 0.1: point - 0.6, 0.9: point + 0.6}

    def save(self, path: Path | str) -> Path:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        with open(path / "model.pkl", "wb") as f:
            pickle.dump(
                {"model": self.model, "feature_cols": self.feature_cols, "params": self.params}, f
            )
        with open(path / "manifest.json", "w") as f:
            json.dump(
                {"feature_cols": self.feature_cols, "params": self.params, "version": self.version},
                f,
                indent=2,
            )
        return path

    @classmethod
    def load(cls, path: Path | str) -> PaceLightGBM:
        path = Path(path)
        with open(path / "model.pkl", "rb") as f:
            data = pickle.load(f)
        obj = cls(params=data["params"])
        obj.model = data["model"]
        obj.feature_cols = data["feature_cols"]
        return obj


class QuantileLightGBM:
    """Proper quantile models — one LightGBM per alpha."""

    def __init__(
        self, alphas: list[float] = [0.1, 0.5, 0.9], base_params: dict | None = None
    ) -> None:
        if lgb is None:
            raise ImportError("lightgbm required")
        self.alphas = alphas
        self.base_params = base_params or {}
        self.models: dict[float, Any] = {}
        self.feature_cols: list[str] = []

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "next_clean_lap_s",
    ) -> QuantileLightGBM:
        self.feature_cols = feature_cols
        for alpha in self.alphas:
            params = {
                **self.base_params,
                "objective": "quantile",
                "alpha": alpha,
                "metric": "quantile",
            }
            # categorical handling via pandas category
            sub_train = train_df.select([c for c in feature_cols if c in train_df.columns])
            pdf_train = sub_train.to_pandas().fillna(
                sub_train.to_pandas().median(numeric_only=True)
            )
            for c in feature_cols:
                if c in pdf_train.columns and pdf_train[c].dtype == object:
                    pdf_train[c] = pdf_train[c].astype("category")
            y_train = train_df[target_col].to_numpy()
            model = lgb.LGBMRegressor(
                **{k: v for k, v in params.items() if k not in ("n_estimators",)},
                n_estimators=params.get("n_estimators", 300),
                verbose=-1,
            )  # type: ignore[call-arg]
            model.fit(pdf_train, y_train)
            self.models[alpha] = model
        return self

    def predict(self, df: pl.DataFrame) -> dict[float, np.ndarray]:
        out: dict[float, np.ndarray] = {}
        sub = df.select([c for c in self.feature_cols if c in df.columns])
        pdf = sub.to_pandas().fillna(sub.to_pandas().median(numeric_only=True))
        for c in self.feature_cols:
            if c in pdf.columns and pdf[c].dtype == object:
                pdf[c] = pdf[c].astype("category")
        for alpha, model in self.models.items():
            out[alpha] = model.predict(pdf)
        return out
