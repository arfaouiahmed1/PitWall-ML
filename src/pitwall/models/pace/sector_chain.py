"""Chained Autoregressive 3-Sector Momentum Estimator."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import polars as pl

from pitwall.models.pace.lightgbm_model import PaceLightGBM


class SectorChainModel:
    """Chained 3-Sector Momentum Estimator.

    Models corner exit momentum propagation across sector boundaries:
    - Sector 1: conditioned on prior lap finish-line speed (speed_fl_delta)
    - Sector 2: conditioned on Sector 1 exit speed (speed_i1_delta) + predicted Delta S1
    - Sector 3: conditioned on Sector 2 exit speed (speed_i2_delta) + predicted Delta S2
    Reconstructed lap: Lap_(t+1) = Sum_k (S_(k,t) + Delta S_k)
    """

    def __init__(
        self,
        params: dict[str, Any] | None = None,
        categorical_features: list[str] | None = None,
    ) -> None:
        self.params = params or {
            "n_estimators": 350,
            "learning_rate": 0.03,
            "num_leaves": 25,
            "random_state": 42,
            "verbose": -1,
        }
        self.categorical_features = categorical_features or []
        self.m_s1 = PaceLightGBM(params=self.params, categorical_features=self.categorical_features)
        self.m_s2 = PaceLightGBM(params=self.params, categorical_features=self.categorical_features)
        self.m_s3 = PaceLightGBM(params=self.params, categorical_features=self.categorical_features)
        self.features_s1: list[str] = []
        self.features_s2: list[str] = []
        self.features_s3: list[str] = []
        self.version: str = "v3-sector-chain"

    def _extract_sector_seconds(self, df: pl.DataFrame) -> pl.DataFrame:
        """Ensure sector1time_s, sector2time_s, sector3time_s exist as float seconds."""
        cols = df.columns
        updates = []
        for raw, target in [
            ("Sector1Time", "sector1time_s"),
            ("Sector2Time", "sector2time_s"),
            ("Sector3Time", "sector3time_s"),
            ("duration_sector_1", "sector1time_s"),
            ("duration_sector_2", "sector2time_s"),
            ("duration_sector_3", "sector3time_s"),
        ]:
            if raw in cols and target not in cols:
                if df[raw].dtype == pl.Duration:
                    updates.append((pl.col(raw).dt.total_nanoseconds() / 1e9).alias(target))
                else:
                    updates.append(pl.col(raw).cast(pl.Float64, strict=False).alias(target))
        return df.with_columns(updates) if updates else df

    def fit(
        self,
        train_df: pl.DataFrame,
        valid_df: pl.DataFrame | None,
        base_features: list[str],
        group_cols: list[str] | None = None,
    ) -> SectorChainModel:
        """Fit chained S1, S2, S3 models."""
        groups = group_cols or ["session_id", "driver_number"]
        groups = [c for c in groups if c in train_df.columns]

        tr = self._extract_sector_seconds(train_df).sort([*groups, "lap_number"])

        # Compute next sector targets: Delta S1, Delta S2, Delta S3
        tr = tr.with_columns([
            (pl.col("sector1time_s").shift(-1).over(groups) - pl.col("sector1time_s")).alias("_delta_s1"),
            (pl.col("sector2time_s").shift(-1).over(groups) - pl.col("sector2time_s")).alias("_delta_s2"),
            (pl.col("sector3time_s").shift(-1).over(groups) - pl.col("sector3time_s")).alias("_delta_s3"),
        ])

        # Filter valid clean training rows
        clean_tr = tr.filter(
            pl.col("_delta_s1").is_not_null()
            & pl.col("_delta_s2").is_not_null()
            & pl.col("_delta_s3").is_not_null()
            & (pl.col("_delta_s1").abs() < 1.5)
            & (pl.col("_delta_s2").abs() < 1.5)
            & (pl.col("_delta_s3").abs() < 1.5)
        )

        val_clean = None
        if valid_df is not None and not valid_df.is_empty():
            vl = self._extract_sector_seconds(valid_df).sort([*groups, "lap_number"])
            vl = vl.with_columns([
                (pl.col("sector1time_s").shift(-1).over(groups) - pl.col("sector1time_s")).alias("_delta_s1"),
                (pl.col("sector2time_s").shift(-1).over(groups) - pl.col("sector2time_s")).alias("_delta_s2"),
                (pl.col("sector3time_s").shift(-1).over(groups) - pl.col("sector3time_s")).alias("_delta_s3"),
            ])
            val_clean = vl.filter(
                pl.col("_delta_s1").is_not_null()
                & pl.col("_delta_s2").is_not_null()
                & pl.col("_delta_s3").is_not_null()
            )

        # 1. Sector 1 Model: uses speed_fl_delta (finish line momentum) + base
        s1_cands = ["speed_fl_delta", "speed_st_delta", "s3_delta", *base_features]
        self.features_s1 = [c for c in dict.fromkeys(s1_cands) if c in clean_tr.columns]
        self.m_s1.fit(clean_tr, val_clean, feature_cols=self.features_s1, target_col="_delta_s1")

        # 2. Sector 2 Model: uses speed_i1_delta (S1 exit speed) + predicted Delta S1
        # In training, use actual Delta S1 as proxy
        clean_tr_s2 = clean_tr.with_columns(pl.col("_delta_s1").alias("pred_delta_s1"))
        val_clean_s2 = (
            val_clean.with_columns(pl.col("_delta_s1").alias("pred_delta_s1"))
            if val_clean is not None
            else None
        )
        s2_cands = ["speed_i1_delta", "pred_delta_s1", "s1_delta", *base_features]
        self.features_s2 = [c for c in dict.fromkeys(s2_cands) if c in clean_tr_s2.columns]
        self.m_s2.fit(clean_tr_s2, val_clean_s2, feature_cols=self.features_s2, target_col="_delta_s2")

        # 3. Sector 3 Model: uses speed_i2_delta (S2 exit speed) + predicted Delta S2
        clean_tr_s3 = clean_tr_s2.with_columns(pl.col("_delta_s2").alias("pred_delta_s2"))
        val_clean_s3 = (
            val_clean_s2.with_columns(pl.col("_delta_s2").alias("pred_delta_s2"))
            if val_clean_s2 is not None
            else None
        )
        s3_cands = ["speed_i2_delta", "pred_delta_s2", "s2_delta", *base_features]
        self.features_s3 = [c for c in dict.fromkeys(s3_cands) if c in clean_tr_s3.columns]
        self.m_s3.fit(clean_tr_s3, val_clean_s3, feature_cols=self.features_s3, target_col="_delta_s3")

        return self

    def predict_sectors(self, df: pl.DataFrame) -> dict[str, np.ndarray]:
        """Predict reconstructed S1, S2, S3 for the next lap."""
        df_sec = self._extract_sector_seconds(df)
        n = len(df)

        base_s1 = (
            df_sec["sector1time_s"].fill_null(28.0).to_numpy()
            if "sector1time_s" in df_sec.columns
            else np.full(n, 28.0)
        )
        base_s2 = (
            df_sec["sector2time_s"].fill_null(30.0).to_numpy()
            if "sector2time_s" in df_sec.columns
            else np.full(n, 30.0)
        )
        base_s3 = (
            df_sec["sector3time_s"].fill_null(26.0).to_numpy()
            if "sector3time_s" in df_sec.columns
            else np.full(n, 26.0)
        )

        # 1. Predict Delta S1
        p_ds1 = self.m_s1.predict(df_sec)

        # 2. Predict Delta S2 conditioned on predicted Delta S1
        df_s2 = df_sec.with_columns(pl.Series("pred_delta_s1", p_ds1))
        p_ds2 = self.m_s2.predict(df_s2)

        # 3. Predict Delta S3 conditioned on predicted Delta S2
        df_s3 = df_s2.with_columns(pl.Series("pred_delta_s2", p_ds2))
        p_ds3 = self.m_s3.predict(df_s3)

        return {
            "s1": base_s1 + p_ds1,
            "s2": base_s2 + p_ds2,
            "s3": base_s3 + p_ds3,
            "delta_s1": p_ds1,
            "delta_s2": p_ds2,
            "delta_s3": p_ds3,
        }

    def predict(self, df: pl.DataFrame) -> np.ndarray:
        """Predict total reconstructed lap time: S1 + S2 + S3."""
        sec_preds = self.predict_sectors(df)
        return sec_preds["s1"] + sec_preds["s2"] + sec_preds["s3"]

    def save(self, path: Path | str) -> Path:
        """Save chained sector model artifacts."""
        path = Path(path)
        path.mkdir(parents=True, exist_ok=True)
        self.m_s1.save(path / "sector_1_model")
        self.m_s2.save(path / "sector_2_model")
        self.m_s3.save(path / "sector_3_model")
        meta = {
            "version": self.version,
            "params": self.params,
            "features_s1": self.features_s1,
            "features_s2": self.features_s2,
            "features_s3": self.features_s3,
        }
        with open(path / "sector_chain_manifest.json", "w") as f:
            json.dump(meta, f, indent=2)
        return path

    @classmethod
    def load(cls, path: Path | str) -> SectorChainModel:
        """Load chained sector model artifacts."""
        path = Path(path)
        with open(path / "sector_chain_manifest.json") as f:
            meta = json.load(f)

        obj = cls(params=meta.get("params"))
        obj.version = meta.get("version", "v3-sector-chain")
        obj.features_s1 = meta.get("features_s1", [])
        obj.features_s2 = meta.get("features_s2", [])
        obj.features_s3 = meta.get("features_s3", [])
        obj.m_s1 = PaceLightGBM.load(path / "sector_1_model")
        obj.m_s2 = PaceLightGBM.load(path / "sector_2_model")
        obj.m_s3 = PaceLightGBM.load(path / "sector_3_model")
        return obj
