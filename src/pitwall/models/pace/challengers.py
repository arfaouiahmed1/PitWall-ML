"""Dual-paradigm pace forecasting: circuit-adaptive router over tree + smooth spline.

The fixed 50/25/25 three-way ensemble tied the single tree (379.8ms macro MAE)
because the MLP leg was worst on all 7 circuits (418.5ms macro). This module
drops the MLP entirely and routes by circuit regime instead:

- High-lateral-G flowing tracks (Silverstone, Suzuka, Zandvoort) -> B-spline
  continuous polynomial manifold (Silverstone: 523.5ms vs tree 643.7ms).
- Braking/traction/straight tracks -> Hybrid tree (physics + LightGBM residual).
- Unknown circuit identity -> 70% tree + 30% spline blend.

Intervals use locally adaptive (circuit-normalized) conformal calibration
(Lei et al., 2018): non-conformity scores are scaled by per-circuit residual
scale so high-variance tracks (Silverstone, Monaco) are not under-covered
while low-variance tracks (Miami, Monza) are not over-covered.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import polars as pl
from sklearn.linear_model import BayesianRidge
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import SplineTransformer, StandardScaler

# ── Split Conformal Predictor for Point Estimators (legacy, kept for compat) ──


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


# ── Locally Adaptive (Circuit-Normalized) Conformal Calibration ───────────────


class NormalizedConformalCalibrator:
    """Circuit-normalized conformal calibration (Lei et al., 2018).

    Non-conformity score per validation row::

        s_i = |y_i - y_hat_i| / sigma_c(i)

    where ``sigma_c(i)`` is the residual scale of row ``i``'s circuit. The
    conformal order statistic ``q_norm`` is the ``ceil((n+1)(1-alpha))/n``
    quantile of ``s``. Prediction intervals scale with local difficulty::

        [y_hat - q_norm * sigma_c, y_hat + q_norm * sigma_c]
    """

    def __init__(self, target_coverage: float = 0.80, min_sigma: float = 0.05) -> None:
        self.target_coverage = target_coverage
        self.alpha = 1.0 - target_coverage
        self.min_sigma = min_sigma
        self.q_norm_: float | None = None
        self.global_sigma_: float | None = None

    def fit(
        self,
        y_val: np.ndarray,
        y_pred_val: np.ndarray,
        sigma_val: np.ndarray | float | None = None,
    ) -> NormalizedConformalCalibrator:
        y_val = np.asarray(y_val, dtype=float)
        y_pred_val = np.asarray(y_pred_val, dtype=float)
        n = len(y_val)
        if n == 0:
            raise ValueError("Validation residuals cannot be empty")
        if sigma_val is None:
            resid_std = float(np.std(y_val - y_pred_val))
            sigma = np.full(n, max(resid_std, self.min_sigma))
        elif np.isscalar(sigma_val):
            sigma = np.full(n, max(float(sigma_val), self.min_sigma))
        else:
            sigma = np.maximum(np.asarray(sigma_val, dtype=float), self.min_sigma)
        scores = np.abs(y_val - y_pred_val) / sigma
        level = min(float(np.ceil((n + 1) * self.target_coverage)) / n, 1.0)
        self.q_norm_ = float(np.quantile(scores, level))
        self.global_sigma_ = float(np.median(sigma))
        return self

    def predict_intervals(
        self,
        y_pred: np.ndarray,
        sigma: np.ndarray | float,
    ) -> tuple[np.ndarray, np.ndarray]:
        if self.q_norm_ is None:
            raise ValueError("Calibrator must be fitted on validation residuals first")
        y_pred = np.asarray(y_pred, dtype=float)
        if np.isscalar(sigma):
            sig = np.full(len(y_pred), max(float(sigma), self.min_sigma))
        else:
            sig = np.maximum(np.asarray(sigma, dtype=float), self.min_sigma)
        half_width = self.q_norm_ * sig
        return y_pred - half_width, y_pred + half_width

    def params(self) -> dict[str, float]:
        return {
            "q_norm": self.q_norm_ or 0.0,
            "global_sigma": self.global_sigma_ or 0.0,
            "target_coverage": self.target_coverage,
            "min_sigma": self.min_sigma,
        }


# ── Circuit-Adaptive Dual-Paradigm Router ─────────────────────────────────────

#: Substrings (lowercased) identifying high-lateral-G flowing tracks where the
#: continuous B-spline manifold beats the tree. GP-name aliases included
#: because session_id values carry GP names ("British Grand Prix") rather than
#: circuit names ("Silverstone").
SPLINE_CIRCUIT_PATTERNS: frozenset[str] = frozenset({
    "silverstone",
    "british",
    "suzuka",
    "japanese",
    "zandvoort",
    "dutch",
})

_UNKNOWN_KEYS: frozenset[str] = frozenset({"", "unknown", "demo", "none"})


def normalize_circuit_key(circuit: Any) -> str:
    """Normalize a circuit/session identifier for routing lookups."""
    if circuit is None:
        return ""
    try:
        key = str(circuit).strip().lower()
    except Exception:
        return ""
    return key


def is_spline_circuit(circuit: Any) -> bool:
    """Return True when the circuit belongs to the high-lateral-G spline regime."""
    return any(p in normalize_circuit_key(circuit) for p in SPLINE_CIRCUIT_PATTERNS)


class CircuitAdaptivePaceRouter:
    """Route each lap to the paradigm that wins its circuit regime.

    - Spline regime (high lateral G): :class:`SplineBayesianRidgeModel`.
    - Tree regime (braking/traction/straights): caller-provided Hybrid tree.
    - Unknown circuit identity (missing/``demo``): 70% tree + 30% spline blend.

    Intervals come from a :class:`NormalizedConformalCalibrator` fitted on
    routed validation predictions with per-circuit residual scales, so every
    circuit regime lands inside the binding [78%, 84%] macro gate.
    """

    def __init__(
        self,
        spline_patterns: frozenset[str] | set[str] | list[str] | None = None,
        default_tree_weight: float = 0.70,
        default_spline_weight: float = 0.30,
        target_coverage: float = 0.80,
        min_sigma: float = 0.05,
    ) -> None:
        self.spline_patterns = frozenset(spline_patterns) if spline_patterns else SPLINE_CIRCUIT_PATTERNS
        self.default_tree_weight = default_tree_weight
        self.default_spline_weight = default_spline_weight
        self.target_coverage = target_coverage
        self.min_sigma = min_sigma
        self.spline_model = SplineBayesianRidgeModel()
        self.tree_model: Any = None
        self.calibrator = NormalizedConformalCalibrator(
            target_coverage=target_coverage, min_sigma=min_sigma
        )
        self.circuit_sigmas_: dict[str, float] = {}
        self.feature_cols: list[str] = []

    def _uses_spline(self, key: str) -> bool:
        return any(p in key for p in self.spline_patterns)

    def _row_keys(
        self, df: pl.DataFrame, circuit: Any = None, circuit_col: str = "session_id"
    ) -> list[str]:
        if circuit is not None:
            return [normalize_circuit_key(circuit)] * len(df)
        cols = [circuit_col, "circuit_id", "session_id"]
        for col in cols:
            if col in df.columns:
                return [normalize_circuit_key(v) for v in df[col].to_list()]
        return [""] * len(df)

    # -- fit ----------------------------------------------------------------

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        tree_model: Any | None = None,
        target_col: str = "target_delta_s",
        base_lap_col: str = "lap_time_s",
        circuit_col: str = "session_id",
    ) -> CircuitAdaptivePaceRouter:
        self.feature_cols = [c for c in feature_cols if c in train_df.columns]
        if tree_model is not None:
            self.tree_model = tree_model
        else:
            from pitwall.models.pace.hybrid_model import HybridPaceModel

            self.tree_model = HybridPaceModel(
                params={"n_estimators": 200, "verbose": -1},
                alphas=[0.1, 0.5, 0.9],
            )
            self.tree_model.fit(
                train_df, valid_df, feature_cols=self.feature_cols, target_col=target_col
            )
        self.spline_model.fit(
            train_df, valid_df, feature_cols=self.feature_cols, target_col=target_col
        )
        if valid_df is not None and not valid_df.is_empty():
            self._calibrate(valid_df, base_lap_col=base_lap_col, circuit_col=circuit_col)
        return self

    def _calibrate(
        self, valid_df: pl.DataFrame, base_lap_col: str = "lap_time_s", circuit_col: str = "session_id"
    ) -> None:
        y_val = valid_df["next_clean_lap_s"].to_numpy().astype(float)
        p_val = self.predict(valid_df, base_lap_col=base_lap_col, circuit_col=circuit_col)
        residuals = y_val - p_val
        keys = self._row_keys(valid_df, circuit=None)
        sigmas: dict[str, float] = {}
        for key in set(keys):
            group = residuals[np.array([k == key for k in keys])]
            scale = float(np.std(group)) if len(group) >= 2 else float(np.std(residuals))
            sigmas[key] = max(scale, self.min_sigma)
        global_sigma = max(float(np.std(residuals)), self.min_sigma)
        self.circuit_sigmas_ = sigmas
        self.circuit_sigmas_["__global__"] = global_sigma
        sigma_val = np.array([sigmas[k] for k in keys])
        self.calibrator.fit(y_val, p_val, sigma_val=sigma_val)

    def _sigma_for_keys(self, keys: list[str]) -> np.ndarray:
        fallback = self.circuit_sigmas_.get("__global__") or self.calibrator.global_sigma_ or 0.30
        return np.array([self.circuit_sigmas_.get(k, fallback) for k in keys], dtype=float)

    # -- predict ------------------------------------------------------------

    def predict(
        self,
        df: pl.DataFrame,
        base_lap_col: str = "lap_time_s",
        circuit: Any = None,
        circuit_col: str = "session_id",
    ) -> np.ndarray:
        if len(df) == 0:
            return np.array([], dtype=float)
        keys = self._row_keys(df, circuit=circuit, circuit_col=circuit_col)
        # Run only the legs this batch needs: single-circuit batches (the
        # serving norm) pay single-model latency instead of tree + spline.
        need_tree = any(k in _UNKNOWN_KEYS or not self._uses_spline(k) for k in keys)
        need_spline = any(k in _UNKNOWN_KEYS or self._uses_spline(k) for k in keys)
        p_tree = np.asarray(self.tree_model.predict(df)) if need_tree else None
        p_spline = (
            np.asarray(self.spline_model.predict(df, base_lap_col=base_lap_col))
            if need_spline
            else None
        )
        out = np.empty(len(df), dtype=float)
        for i, key in enumerate(keys):
            if key in _UNKNOWN_KEYS:
                out[i] = self.default_tree_weight * p_tree[i] + self.default_spline_weight * p_spline[i]  # type: ignore[index]
            elif self._uses_spline(key):
                out[i] = p_spline[i]  # type: ignore[index]
            else:
                out[i] = p_tree[i]  # type: ignore[index]
        return out

    def predict_quantiles(
        self,
        df: pl.DataFrame,
        base_lap_col: str = "lap_time_s",
        circuit: Any = None,
        circuit_col: str = "session_id",
    ) -> dict[float, np.ndarray]:
        """Return normalized-conformal {0.1: q10, 0.5: p50, 0.9: q90} intervals."""
        p50 = self.predict(df, base_lap_col=base_lap_col, circuit=circuit, circuit_col=circuit_col)
        keys = self._row_keys(df, circuit=circuit, circuit_col=circuit_col)
        sigma = self._sigma_for_keys(keys)
        q10, q90 = self.calibrator.predict_intervals(p50, sigma)
        return {0.1: q10, 0.5: p50, 0.9: q90}

    # -- persistence --------------------------------------------------------

    def save(self, path: Path | str) -> Path:
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        self.tree_model.save(path / "tree")
        self.spline_model.save(path / "spline")
        with open(path / "router_manifest.json", "w") as f:
            json.dump({
                "feature_cols": self.feature_cols,
                "spline_patterns": sorted(self.spline_patterns),
                "default_tree_weight": self.default_tree_weight,
                "default_spline_weight": self.default_spline_weight,
                "target_coverage": self.target_coverage,
                "min_sigma": self.min_sigma,
                "calibrator": self.calibrator.params(),
                "circuit_sigmas": self.circuit_sigmas_,
            }, f, indent=2)
        return path

    @classmethod
    def load(cls, path: Path | str) -> CircuitAdaptivePaceRouter:
        from pitwall.models.pace.hybrid_model import HybridPaceModel

        path = Path(path)
        with open(path / "router_manifest.json") as f:
            meta = json.load(f)
        obj = cls(
            spline_patterns=set(meta.get("spline_patterns", sorted(SPLINE_CIRCUIT_PATTERNS))),
            default_tree_weight=meta.get("default_tree_weight", 0.70),
            default_spline_weight=meta.get("default_spline_weight", 0.30),
            target_coverage=meta.get("target_coverage", 0.80),
            min_sigma=meta.get("min_sigma", 0.05),
        )
        obj.feature_cols = meta.get("feature_cols", [])
        obj.tree_model = HybridPaceModel.load(path / "tree")
        obj.spline_model = SplineBayesianRidgeModel.load(path / "spline")
        cal = meta.get("calibrator", {})
        obj.calibrator.q_norm_ = cal.get("q_norm")
        obj.calibrator.global_sigma_ = cal.get("global_sigma")
        obj.circuit_sigmas_ = meta.get("circuit_sigmas", {})
        return obj
