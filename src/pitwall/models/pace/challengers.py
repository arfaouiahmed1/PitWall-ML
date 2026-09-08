"""Smooth non-tree challengers and multi-paradigm ensemble for motorsport pace forecasting."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import polars as pl
from sklearn.linear_model import BayesianRidge
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import SplineTransformer, StandardScaler

# ── Split Conformal Predictor for Point Estimators ───────────────────────────


class SplitConformalPredictor:
    """Finite-sample distribution-free conformal calibration for point estimators."""

    def __init__(self, target_coverage: float = 0.80) -> None:
        self.target_coverage = target_coverage
        self.alpha = 1.0 - target_coverage
        self.q_hat_: float | None = None

    def fit(self, y_val: np.ndarray, y_pred_val: np.ndarray) -> SplitConformalPredictor:
        """Compute empirical conformal quantile on held-out validation residuals."""
        residuals = np.abs(y_val - y_pred_val)
        n = len(residuals)
        if n == 0:
            raise ValueError("Validation residuals cannot be empty")
        level = min(float(np.ceil((n + 1) * self.target_coverage)) / n, 1.0)
        self.q_hat_ = float(np.quantile(residuals, level))
        return self

    def predict_intervals(
        self, y_pred: np.ndarray
    ) -> tuple[np.ndarray, np.ndarray]:
        """Return calibrated lower and upper bounds: [y_pred - q_hat, y_pred + q_hat]."""
        if self.q_hat_ is None:
            raise ValueError("Calibrator must be fitted on validation residuals first")
        return y_pred - self.q_hat_, y_pred + self.q_hat_

    def params(self) -> dict[str, float]:
        return {"q_hat": self.q_hat_ or 0.0, "target_coverage": self.target_coverage}


# ── B-Spline Manifold + Bayesian Ridge ────────────────────────────────────────


class SplineBayesianRidgeModel:
    """Continuous smooth polynomial spline manifold with analytical Bayesian precision."""

    def __init__(self, n_knots: int = 5, degree: int = 3) -> None:
        self.pipeline: Pipeline = Pipeline([
            ("scaler", StandardScaler()),
            ("spline", SplineTransformer(n_knots=n_knots, degree=degree)),
            ("regressor", BayesianRidge()),
        ])
        self.feature_cols: list[str] = []
        self.calibrator: SplitConformalPredictor = SplitConformalPredictor(target_coverage=0.80)

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "target_delta_s",
        base_lap_col: str = "lap_time_s",
    ) -> SplineBayesianRidgeModel:
        self.feature_cols = [c for c in feature_cols if c in train_df.columns]
        X_tr = train_df.select(self.feature_cols).to_pandas()
        y_tr = train_df[target_col].fill_null(0.0).to_numpy()

        self.pipeline.fit(X_tr, y_tr)

        if valid_df is not None and not valid_df.is_empty():
            X_val = valid_df.select(self.feature_cols).to_pandas()
            y_val_abs = valid_df["next_clean_lap_s"].to_numpy()
            base_val = valid_df[base_lap_col].to_numpy()
            p_val_abs = base_val + self.pipeline.predict(X_val)
            self.calibrator.fit(y_val_abs, p_val_abs)

        return self

    def predict_delta(self, df: pl.DataFrame) -> np.ndarray:
        X = df.select([c for c in self.feature_cols if c in df.columns]).to_pandas()
        return self.pipeline.predict(X)

    def predict(self, df: pl.DataFrame, base_lap_col: str = "lap_time_s") -> np.ndarray:
        base = df[base_lap_col].fill_null(85.0).to_numpy()
        return base + self.predict_delta(df)

    def save(self, path: Path | str) -> Path:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.pipeline, path / "pipeline.joblib")
        with open(path / "manifest.json", "w") as f:
            json.dump({
                "feature_cols": self.feature_cols,
                "calibrator": self.calibrator.params(),
            }, f, indent=2)
        return path

    @classmethod
    def load(cls, path: Path | str) -> SplineBayesianRidgeModel:
        path = Path(path)
        obj = cls()
        obj.pipeline = joblib.load(path / "pipeline.joblib")
        with open(path / "manifest.json") as f:
            meta = json.load(f)
        obj.feature_cols = meta.get("feature_cols", [])
        obj.calibrator.q_hat_ = meta.get("calibrator", {}).get("q_hat")
        return obj


# ── Smooth Neural Residual MLP ────────────────────────────────────────────────


class NeuralResidualMLPModel:
    """Smooth multi-layer perceptron neural network with SiLU/ReLU activations."""

    def __init__(
        self,
        hidden_layer_sizes: tuple[int, ...] = (48, 24),
        alpha: float = 0.05,
        learning_rate_init: float = 0.003,
        max_iter: int = 1000,
    ) -> None:
        self.max_iter = max_iter
        self.pipeline: Pipeline = Pipeline([
            ("scaler", StandardScaler()),
            (
                "mlp",
                MLPRegressor(
                    hidden_layer_sizes=hidden_layer_sizes,
                    activation="relu",
                    learning_rate_init=learning_rate_init,
                    alpha=alpha,
                    max_iter=self.max_iter,
                    random_state=42,
                    early_stopping=True,
                    n_iter_no_change=25,
                ),
            ),
        ])
        self.feature_cols: list[str] = []
        self.calibrator: SplitConformalPredictor = SplitConformalPredictor(target_coverage=0.80)

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "target_delta_s",
        base_lap_col: str = "lap_time_s",
    ) -> NeuralResidualMLPModel:
        self.feature_cols = [c for c in feature_cols if c in train_df.columns]
        X_tr = train_df.select(self.feature_cols).to_pandas()
        y_tr = train_df[target_col].fill_null(0.0).to_numpy()

        self.pipeline.fit(X_tr, y_tr)

        if valid_df is not None and not valid_df.is_empty():
            X_val = valid_df.select(self.feature_cols).to_pandas()
            y_val_abs = valid_df["next_clean_lap_s"].to_numpy()
            base_val = valid_df[base_lap_col].to_numpy()
            p_val_abs = base_val + self.pipeline.predict(X_val)
            self.calibrator.fit(y_val_abs, p_val_abs)

        return self

    def predict_delta(self, df: pl.DataFrame) -> np.ndarray:
        X = df.select([c for c in self.feature_cols if c in df.columns]).to_pandas()
        return self.pipeline.predict(X)

    def predict(self, df: pl.DataFrame, base_lap_col: str = "lap_time_s") -> np.ndarray:
        base = df[base_lap_col].fill_null(85.0).to_numpy()
        return base + self.predict_delta(df)

    def save(self, path: Path | str) -> Path:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        joblib.dump(self.pipeline, path / "pipeline.joblib")
        with open(path / "manifest.json", "w") as f:
            json.dump({
                "feature_cols": self.feature_cols,
                "calibrator": self.calibrator.params(),
            }, f, indent=2)
        return path

    @classmethod
    def load(cls, path: Path | str) -> NeuralResidualMLPModel:
        path = Path(path)
        obj = cls()
        obj.pipeline = joblib.load(path / "pipeline.joblib")
        with open(path / "manifest.json") as f:
            meta = json.load(f)
        obj.feature_cols = meta.get("feature_cols", [])
        obj.calibrator.q_hat_ = meta.get("calibrator", {}).get("q_hat")
        return obj


# ── Multi-Paradigm Ensemble (Tree + Spline + Neural) ──────────────────────────


class MultiParadigmEnsemble:
    """Weighted blend of orthogonal inductive biases: Tree (50%) + Spline (25%) + MLP (25%)."""

    def __init__(
        self,
        weights: tuple[float, float, float] = (0.50, 0.25, 0.25),
        target_coverage: float = 0.80,
    ) -> None:
        self.weights = weights
        self.target_coverage = target_coverage
        self.spline_model = SplineBayesianRidgeModel()
        self.mlp_model = NeuralResidualMLPModel()
        self.calibrator = SplitConformalPredictor(target_coverage=target_coverage)
        self.feature_cols: list[str] = []

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        tree_model: Any,
        target_col: str = "target_delta_s",
        base_lap_col: str = "lap_time_s",
    ) -> MultiParadigmEnsemble:
        self.feature_cols = [c for c in feature_cols if c in train_df.columns]
        self.tree_model = tree_model

        # 1. Fit non-tree models
        self.spline_model.fit(train_df, valid_df, feature_cols=self.feature_cols, target_col=target_col)
        self.mlp_model.fit(train_df, valid_df, feature_cols=self.feature_cols, target_col=target_col)

        # 2. Calibrate ensemble on validation predictions
        if valid_df is not None and not valid_df.is_empty():
            y_val_abs = valid_df["next_clean_lap_s"].to_numpy()
            p_val = self.predict(valid_df, base_lap_col=base_lap_col)
            self.calibrator.fit(y_val_abs, p_val)

        return self

    def predict(self, df: pl.DataFrame, base_lap_col: str = "lap_time_s") -> np.ndarray:
        w_tree, w_spline, w_mlp = self.weights
        p_tree = self.tree_model.predict(df) if hasattr(self.tree_model, "predict") else np.zeros(len(df))
        p_spline = self.spline_model.predict(df, base_lap_col=base_lap_col)
        p_mlp = self.mlp_model.predict(df, base_lap_col=base_lap_col)
        return w_tree * p_tree + w_spline * p_spline + w_mlp * p_mlp

    def predict_quantiles(
        self, df: pl.DataFrame, base_lap_col: str = "lap_time_s"
    ) -> dict[float, np.ndarray]:
        """Reconstruct calibrated 80% conformal bounds: q10, q50, q90."""
        p50 = self.predict(df, base_lap_col=base_lap_col)
        q10, q90 = self.calibrator.predict_intervals(p50)
        return {0.1: q10, 0.5: p50, 0.9: q90}
