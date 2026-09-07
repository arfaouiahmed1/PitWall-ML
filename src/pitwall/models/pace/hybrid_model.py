"""Two-stage hybrid motorsport pace estimator: Deterministic Physics + Quantile Residual ML."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from pitwall.models.pace.lightgbm_model import QuantileLightGBM

# ── Stage 1: Deterministic Physics Baseline ──────────────────────────────────


class DeterministicPhysicsBaseline:
    """Computes first-principles analytical pace deltas based on fuel burn and tyre kinetics."""

    def __init__(
        self,
        fuel_burn_s_per_lap: float = 0.033,
        compound_deg_rates: dict[str, float] | None = None,
        hard_warmup_penalty_s: float = 0.12,
    ) -> None:
        self.fuel_burn_s = fuel_burn_s_per_lap
        self.compound_deg = compound_deg_rates or {
            "SOFT": 0.055,
            "MEDIUM": 0.028,
            "HARD": 0.014,
            "INTERMEDIATE": 0.022,
            "WET": 0.025,
            "UNKNOWN": 0.025,
        }
        self.hard_warmup_penalty = hard_warmup_penalty_s

    def compute_delta(self, df: pl.DataFrame) -> np.ndarray:
        """Compute expected physical delta (seconds) for each row."""
        n = len(df)
        if n == 0:
            return np.array([], dtype=float)

        deltas = np.zeros(n, dtype=float)

        # 1. Fuel mass burn-off (car gets lighter -> faster by ~0.033s per lap)
        deltas -= self.fuel_burn_s

        # 2. Tyre degradation based on compound and age
        compounds = (
            df["compound"].cast(pl.Utf8).to_list()
            if "compound" in df.columns
            else ["MEDIUM"] * n
        )
        ages = (
            df["tyre_age"].fill_null(1.0).to_numpy()
            if "tyre_age" in df.columns
            else np.ones(n)
        )

        for i, (comp, age) in enumerate(zip(compounds, ages, strict=False)):
            comp_norm = str(comp).upper()
            base_deg = self.compound_deg.get(comp_norm, 0.025)

            # Progressive degradation slope
            tyre_penalty = base_deg * (1.0 + 0.015 * min(age, 35.0))

            # Non-linear Hard tyre graining/warmup phase (laps 1-3)
            if comp_norm == "HARD" and age <= 3:
                tyre_penalty += self.hard_warmup_penalty * (4.0 - age) / 3.0

            deltas[i] += tyre_penalty

        return deltas


# ── Stage 2: Hybrid Pace Estimator ───────────────────────────────────────────


class HybridPaceModel:
    """Two-Stage Hybrid Pace Model.

    Stage 1: Deterministic physics calculates fuel and tyre degradation delta.
    Stage 2: Quantile LightGBM models stochastic residuals (driver consistency,
             sector momentum carryover, traffic wake).
    Reconstruction: y_pred = y_current + delta_physics + residual_ML
    """

    def __init__(
        self,
        params: dict[str, Any] | None = None,
        alphas: list[float] | None = None,
        categorical_features: list[str] | None = None,
        physics_baseline: DeterministicPhysicsBaseline | None = None,
    ) -> None:
        self.alphas = alphas or [0.1, 0.5, 0.9]
        self.physics = physics_baseline or DeterministicPhysicsBaseline()
        self.residual_model = QuantileLightGBM(
            alphas=self.alphas,
            base_params=params,
            categorical_features=categorical_features,
        )
        self.feature_cols: list[str] = []
        self.version: str = "v3-hybrid"

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        feature_cols: list[str],
        target_col: str = "target_delta_s",
        base_lap_col: str = "lap_time_s",
    ) -> HybridPaceModel:
        """Fit the hybrid model on clean training data."""
        self.feature_cols = [c for c in feature_cols if c in train_df.columns]

        # 1. Compute physics delta
        phys_train = self.physics.compute_delta(train_df)

        # 2. Extract actual delta
        if target_col in train_df.columns:
            y_train_delta = train_df[target_col].fill_null(0.0).to_numpy()
        elif "next_clean_lap_s" in train_df.columns and base_lap_col in train_df.columns:
            y_train_delta = (
                train_df["next_clean_lap_s"].to_numpy() - train_df[base_lap_col].to_numpy()
            )
        else:
            raise ValueError(f"Neither {target_col} nor (next_clean_lap_s - {base_lap_col}) found in train_df")

        # 3. Compute residual: actual delta - physical delta
        train_residual = y_train_delta - phys_train

        # Attach residual target to training frame
        train_with_res = train_df.with_columns(
            pl.Series("_residual_target", train_residual)
        )

        # Handle validation frame if present
        valid_with_res = None
        if valid_df is not None and not valid_df.is_empty():
            phys_val = self.physics.compute_delta(valid_df)
            if target_col in valid_df.columns:
                y_val_delta = valid_df[target_col].fill_null(0.0).to_numpy()
            elif "next_clean_lap_s" in valid_df.columns and base_lap_col in valid_df.columns:
                y_val_delta = (
                    valid_df["next_clean_lap_s"].to_numpy() - valid_df[base_lap_col].to_numpy()
                )
            else:
                y_val_delta = np.zeros(len(valid_df))
            val_residual = y_val_delta - phys_val
            valid_with_res = valid_df.with_columns(
                pl.Series("_residual_target", val_residual)
            )

        # 4. Train quantile residual model
        self.residual_model.fit(
            train_with_res,
            valid_with_res,
            feature_cols=self.feature_cols,
            target_col="_residual_target",
        )
        return self

    def predict_delta(self, df: pl.DataFrame) -> dict[float, np.ndarray]:
        """Predict total pace delta (physics + residual) across quantiles."""
        phys_delta = self.physics.compute_delta(df)
        residual_preds = self.residual_model.predict(df)
        return {
            alpha: phys_delta + residual_preds[alpha]
            for alpha in self.alphas
        }

    def predict(self, df: pl.DataFrame, base_lap_col: str = "lap_time_s") -> np.ndarray:
        """Predict median absolute lap time (p50)."""
        base = (
            df[base_lap_col].fill_null(85.0).to_numpy()
            if base_lap_col in df.columns
            else np.full(len(df), 85.0)
        )
        deltas = self.predict_delta(df)
        return base + deltas[0.5]

    def predict_quantiles(
        self, df: pl.DataFrame, base_lap_col: str = "lap_time_s"
    ) -> dict[float, np.ndarray]:
        """Predict reconstructed absolute lap times for q10, q50, q90."""
        base = (
            df[base_lap_col].fill_null(85.0).to_numpy()
            if base_lap_col in df.columns
            else np.full(len(df), 85.0)
        )
        deltas = self.predict_delta(df)
        return {
            alpha: base + deltas[alpha]
            for alpha in self.alphas
        }

    def save(self, path: Path | str) -> Path:
        """Save hybrid model artifacts."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        # Save residual model
        self.residual_model.save(path / "residual_model")
        # Save metadata
        meta = {
            "version": self.version,
            "alphas": self.alphas,
            "feature_cols": self.feature_cols,
            "fuel_burn_s": self.physics.fuel_burn_s,
            "compound_deg": self.physics.compound_deg,
            "hard_warmup_penalty": self.physics.hard_warmup_penalty,
        }
        with open(path / "hybrid_manifest.json", "w") as f:
            json.dump(meta, f, indent=2)
        return path

    @classmethod
    def load(cls, path: Path | str) -> HybridPaceModel:
        """Load hybrid model artifacts."""
        path = Path(path)
        with open(path / "hybrid_manifest.json") as f:
            meta = json.load(f)

        phys = DeterministicPhysicsBaseline(
            fuel_burn_s_per_lap=meta.get("fuel_burn_s", 0.033),
            compound_deg_rates=meta.get("compound_deg"),
            hard_warmup_penalty_s=meta.get("hard_warmup_penalty", 0.12),
        )

        obj = cls(
            alphas=meta.get("alphas", [0.1, 0.5, 0.9]),
            physics_baseline=phys,
        )
        obj.feature_cols = meta.get("feature_cols", [])
        obj.version = meta.get("version", "v3-hybrid")
        obj.residual_model = QuantileLightGBM.load(path / "residual_model")
        return obj
