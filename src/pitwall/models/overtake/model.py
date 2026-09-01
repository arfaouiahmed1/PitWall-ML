"""Overtake Probability Model for 2026 Active Aero & Overtake Mode regulations.

Trains a LightGBM gradient-boosted tree classifier on real battle observations
from the Gold ``battle_state`` table.  Every training label comes from an
actual observed 2026 overtake (OpenF1 ``/overtakes`` endpoint), no synthetic
data.

Features (point-in-time, computed only from information available at ``t``):
  - Gap to car ahead (seconds)
  - Relative speed (attacker vs defender)
  - Relative throttle (attacker vs defender)
  - Relative brake usage
  - Attacker / defender tyre compound (encoded as C1-C5 / S/M/H)
  - Attacker / defender tyre age (laps)
  - Race progress (lap / total_laps)
  - Position
  - Weather context (track temp, rainfall)

Targets:
  - overtake_30s  = 1 if attacker passes defender within 30 seconds
  - overtake_60s  = 1 if within 60 seconds
  - overtake_120s = 1 if within 120 seconds

The 2026 regulation engine provides the `eligibility_gap` (1.0s) and
`energy_advantage_threshold` parameters that constrain the model's
recommendations.
"""

from __future__ import annotations

import contextlib
import json
import pickle
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import polars as pl

try:
    import lightgbm as lgb
except ImportError:  # pragma: no cover
    lgb = None  # type: ignore[assignment]


# ──────────────────────────────────────────────────────────────────────────────
# Prediction result
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class OvertakeOpportunityPrediction:
    """Result of the overtake probability model for one battle pair."""

    attacker: int
    defender: int
    current_gap_s: float
    p_overlap_opportunity: float
    p_successful_pass: float
    p_pass_30s: float
    p_pass_60s: float
    p_pass_120s: float
    recommended_attack_lap: int
    energy_advantage: str
    tyre_advantage_s: float
    eligibility: bool
    confidence: float
    top_features: list[dict[str, Any]]

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


# ──────────────────────────────────────────────────────────────────────────────
# Model
# ──────────────────────────────────────────────────────────────────────────────

# Features used by the model — all derivable from real telemetry/position data
FEATURE_COLUMNS = [
    "gap_to_car_ahead_s",
    "speed",
    "speed_ahead",
    "throttle",
    "throttle_ahead",
    "brake",
    "brake_ahead",
    "rpm",
    "rpm_ahead",
    "position",
    "lap_number",
    "race_progress",
    "tyre_age_attacker",
    "tyre_age_defender",
    # Relative features
    "relative_speed",
    "relative_throttle",
    "relative_brake",
    "relative_pace_3laps",
    "relative_pace_5laps",
    "straight_length_m",
    "distance_to_next_straight",
    "distance_to_next_corner",
    # Weather context
    "air_temp_c",
    "track_temp_c",
    "rainfall",
    # Tyre compound encoding (ordinal: C1=0 ... C5=4, S/M/H legacy=1/2/3)
    "tyre_class_attacker",
    "tyre_class_defender",
    "straight_mode_eligible",
    # Circuit
    "circuit_key",
]

TARGET_PREFIX = "overtake"

CATEGORICAL_FEATURES = [
    "tyre_class_attacker",
    "tyre_class_defender",
    "circuit_key",
]


class OvertakeOpportunityModel:
    """LightGBM classifier predicting overtake probability within time windows.

    Trained on real battle observations from the Gold ``battle_state`` table.
    Labels come from actual OpenF1 overtake events — no synthetic data.
    """

    def __init__(self, seed: int = 42) -> None:
        self.seed = seed
        self._models: dict[str, Any] = {}  # window → trained LGBMClassifier
        self._feature_cols: list[str] = []
        self._cat_cols: list[str] = []
        self._ready = False
        self._training_metrics: dict[str, dict[str, float]] = {}

    # ── Training ──────────────────────────────────────────────────────────────

    def fit(self, battle_df: pl.DataFrame) -> OvertakeOpportunityModel:
        """Train overtake classifiers on the Gold battle_state table.

        Expects columns from ``build_gold_battle_state``:
        gap, speeds, throttle, brake, positions, tyre info, labels.
        """
        if lgb is None:
            raise ImportError("lightgbm not installed. pip install lightgbm")

        df = self._prepare_features(battle_df)

        # Determine which targets are available
        targets = [t for t in ["overtake_30s", "overtake_60s", "overtake_120s"] if t in df.columns]
        if not targets:
            raise ValueError("No overtake target columns found in training data")

        self._feature_cols = [c for c in FEATURE_COLUMNS if c in df.columns]
        self._cat_cols = [c for c in CATEGORICAL_FEATURES if c in df.columns]
        self._ready = True

        for target in targets:
            positive = df.filter(pl.col(target) == 1).height
            negative = df.filter(pl.col(target) == 0).height
            total = positive + negative
            if positive < 5 or negative < 5:
                print(f"  Skipping {target}: too few samples (pos={positive}, neg={negative})")
                continue

            split = int(total * 0.8)
            train = df.head(split)
            valid = df.slice(split)

            X_train = self._prepare_X(train)
            y_train = train[target].to_numpy()

            X_valid = self._prepare_X(valid)
            y_valid = valid[target].to_numpy()

            # Handle class imbalance with scale_pos_weight
            pos_weight = max(1.0, negative / max(positive, 1))

            params = {
                "objective": "binary",
                "metric": ["binary_logloss", "auc"],
                "boosting_type": "gbdt",
                "num_leaves": 25,
                "max_depth": 6,
                "learning_rate": 0.05,
                "feature_fraction": 0.8,
                "bagging_fraction": 0.7,
                "bagging_freq": 5,
                "min_data_in_leaf": 20,
                "lambda_l1": 0.1,
                "lambda_l2": 0.1,
                "verbose": -1,
                "n_estimators": 500,
                "early_stopping_rounds": 30,
                "scale_pos_weight": pos_weight,
                "random_state": self.seed,
            }

            model = lgb.LGBMClassifier(**params)
            model.fit(
                X_train,
                y_train,
                eval_set=[(X_valid, y_valid)],
                callbacks=[lgb.early_stopping(30, verbose=False)],
            )

            self._models[target] = model

            # Compute validation metrics
            y_pred_proba = model.predict_proba(X_valid)[:, 1]
            from sklearn.metrics import average_precision_score, roc_auc_score

            auc = roc_auc_score(y_valid, y_pred_proba) if len(set(y_valid)) > 1 else 0.5
            ap = average_precision_score(y_valid, y_pred_proba) if len(set(y_valid)) > 1 else 0.5

            self._training_metrics[target] = {
                "auc": round(float(auc), 4),
                "average_precision": round(float(ap), 4),
                "positive_count": positive,
                "negative_count": negative,
                "best_iteration": (
                    model.best_iteration_ if hasattr(model, "best_iteration_") else None
                ),
            }
            print(
                f"  Trained {target}: AUC={auc:.4f}, AP={ap:.4f} (pos={positive}, neg={negative})"
            )

        return self

    def _prepare_features(self, df: pl.DataFrame) -> pl.DataFrame:
        """Add derived relative features and tyre encoding."""
        df = df.clone()

        # Relative features
        df = df.with_columns(
            [
                (pl.col("speed") - pl.col("speed_ahead")).alias("relative_speed"),
                (pl.col("throttle") - pl.col("throttle_ahead")).alias("relative_throttle"),
                (pl.col("brake") - pl.col("brake_ahead")).alias("relative_brake"),
                pl.col("speed").fill_null(0),
                pl.col("speed_ahead").fill_null(0),
                pl.col("throttle").fill_null(0),
                pl.col("throttle_ahead").fill_null(0),
                pl.col("brake").fill_null(0),
                pl.col("brake_ahead").fill_null(0),
                pl.col("rpm").fill_null(8000),
                pl.col("rpm_ahead").fill_null(8000),
                pl.col("position").fill_null(10),
                pl.col("lap_number").fill_null(20),
                pl.col("race_progress").fill_null(0.5),
                pl.col("tyre_age_attacker").fill_null(10),
                pl.col("tyre_age_defender").fill_null(10),
                pl.col("gap_to_car_ahead_s").fill_null(3.0),
            ]
        )

        # Tyre compound to ordinal (C1=0, C2=1, ..., C5=4; SOF=S, MED=M, HARD=H legacy)
        def _tyre_class(compound: str | None) -> int:
            if compound is None:
                return 2
            c = str(compound).upper().strip()
            # 2026 Pirelli C1-C5
            mapping_2026 = {"C1": 0, "C2": 1, "C3": 2, "C4": 3, "C5": 4}
            if c in mapping_2026:
                return mapping_2026[c]
            # Legacy compounds
            legacy = {"SOFT": 0, "MEDIUM": 2, "HARD": 4, "INTERMEDIATE": 2, "WET": 4}
            return legacy.get(c, 2)

        if "compound_attacker" in df.columns:
            df = df.with_columns(
                pl.col("compound_attacker")
                .map_elements(lambda x: _tyre_class(x), return_dtype=pl.Int8)
                .alias("tyre_class_attacker")
            )
        else:
            df = df.with_columns(pl.lit(2, dtype=pl.Int8).alias("tyre_class_attacker"))

        if "compound_defender" in df.columns:
            df = df.with_columns(
                pl.col("compound_defender")
                .map_elements(lambda x: _tyre_class(x), return_dtype=pl.Int8)
                .alias("tyre_class_defender")
            )
        else:
            df = df.with_columns(pl.lit(2, dtype=pl.Int8).alias("tyre_class_defender"))

        # Track/circuit info
        if "circuit_key" not in df.columns:
            df = df.with_columns(pl.lit("unknown").alias("circuit_key"))
        if "straight_mode_eligible" not in df.columns:
            df = df.with_columns(pl.lit(True).alias("straight_mode_eligible"))
        if "straight_length_m" not in df.columns:
            df = df.with_columns(pl.lit(800.0).alias("straight_length_m"))
        if "distance_to_next_straight" not in df.columns:
            df = df.with_columns(pl.lit(400.0).alias("distance_to_next_straight"))
        if "distance_to_next_corner" not in df.columns:
            df = df.with_columns(pl.lit(300.0).alias("distance_to_next_corner"))
        if "air_temp_c" not in df.columns:
            df = df.with_columns(pl.lit(25.0).alias("air_temp_c"))
        if "track_temp_c" not in df.columns:
            df = df.with_columns(pl.lit(35.0).alias("track_temp_c"))
        if "rainfall" not in df.columns:
            df = df.with_columns(pl.lit(0.0).alias("rainfall"))

        # Relative pace estimates (if not present, derive from speed delta)
        if "relative_pace_3laps" not in df.columns:
            df = df.with_columns(
                (pl.col("relative_speed") / 50.0).clip(-1, 1).alias("relative_pace_3laps")
            )
        if "relative_pace_5laps" not in df.columns:
            df = df.with_columns(
                (pl.col("relative_speed") / 50.0).clip(-1, 1).alias("relative_pace_5laps")
            )

        return df

    def _prepare_X(self, df: pl.DataFrame) -> Any:
        cols_present = [c for c in self._feature_cols if c in df.columns]
        sub = df.select(cols_present)
        for c in cols_present:
            if c in self._cat_cols:
                sub = sub.with_columns(pl.col(c).fill_null("UNKNOWN").cast(pl.Utf8))
            else:
                with contextlib.suppress(Exception):
                    sub = sub.with_columns(pl.col(c).fill_null(0))
        pdf = sub.to_pandas()
        for c in self._cat_cols:
            if c in pdf.columns:
                pdf[c] = pdf[c].astype("category")
        return pdf

    # ── Inference ──────────────────────────────────────────────────────────────

    def predict(
        self,
        attacker: int,
        defender: int,
        gap_s: float,
        tyre_delta_s: float = 0.2,
        energy_advantage_kj: float = 40.0,
        current_lap: int = 25,
        total_laps: int = 78,
        overtake_eligibility_gap: float = 1.0,
        # Telemetry features
        attacker_speed: float = 250.0,
        defender_speed: float = 245.0,
        attacker_throttle: float = 0.7,
        defender_throttle: float = 0.7,
        attacker_brake: float = 0.2,
        defender_brake: float = 0.2,
        position: int = 5,
        attacker_tyre_age: int = 10,
        defender_tyre_age: int = 15,
        attacker_compound: str = "MEDIUM",
        defender_compound: str = "MEDIUM",
        circuit_key: str = "unknown",
        air_temp_c: float = 25.0,
        track_temp_c: float = 35.0,
        rainfall: float = 0.0,
        straight_length_m: float = 800.0,
    ) -> OvertakeOpportunityPrediction:
        """Predict overtake probability for a specific battle.

        If a trained model is loaded, uses it; otherwise falls back to a
        rule-based heuristic derived from the 2026 overtake eligibility rules.
        """
        eligible = gap_s <= overtake_eligibility_gap

        # Build feature vector
        features = {
            "gap_to_car_ahead_s": gap_s,
            "speed": attacker_speed,
            "speed_ahead": defender_speed,
            "throttle": attacker_throttle,
            "throttle_ahead": defender_throttle,
            "brake": attacker_brake,
            "brake_ahead": defender_brake,
            "rpm": 10000.0,
            "rpm_ahead": 10000.0,
            "position": float(position),
            "lap_number": float(current_lap),
            "race_progress": float(current_lap / total_laps),
            "tyre_age_attacker": float(attacker_tyre_age),
            "tyre_age_defender": float(defender_tyre_age),
            "relative_speed": attacker_speed - defender_speed,
            "relative_throttle": attacker_throttle - defender_throttle,
            "relative_brake": attacker_brake - defender_brake,
            "relative_pace_3laps": (attacker_speed - defender_speed) / 50.0,
            "relative_pace_5laps": (attacker_speed - defender_speed) / 50.0,
            "straight_length_m": straight_length_m,
            "distance_to_next_straight": 400.0,
            "distance_to_next_corner": 300.0,
            "air_temp_c": air_temp_c,
            "track_temp_c": track_temp_c,
            "rainfall": rainfall,
            "tyre_class_attacker": self._encode_tyre(attacker_compound),
            "tyre_class_defender": self._encode_tyre(defender_compound),
            "straight_mode_eligible": True,
            "circuit_key": circuit_key,
        }

        # Use trained model if available
        if self._models and "overtake_30s" in self._models:
            import pandas as pd

            cols = [c for c in self._feature_cols if c in features]
            X = pd.DataFrame([{c: features[c] for c in cols}])
            for c in self._cat_cols:
                if c in X.columns:
                    X[c] = X[c].astype("category")
            model = self._models["overtake_30s"]
            probs = model.predict_proba(X)[0]
            classes = list(model.classes_)
            p_pass = float(probs[classes.index(1)] if 1 in classes else 0.0)

            # Use other window models if available
            p_30 = p_pass
            if "overtake_60s" in self._models:
                probs_60 = self._models["overtake_60s"].predict_proba(X)[0]
                cls_60 = list(self._models["overtake_60s"].classes_)
                p_60 = float(probs_60[cls_60.index(1)] if 1 in cls_60 else 0.0)
            else:
                p_60 = p_pass * 1.3
            if "overtake_120s" in self._models:
                probs_120 = self._models["overtake_120s"].predict_proba(X)[0]
                cls_120 = list(self._models["overtake_120s"].classes_)
                p_120 = float(probs_120[cls_120.index(1)] if 1 in cls_120 else 0.0)
            else:
                p_120 = p_pass * 1.5

            # Feature importance for top features
            if hasattr(model, "feature_importances_"):
                fi = dict(zip(cols, model.feature_importances_, strict=False))
                top_features = [
                    {"feature": k, "importance": float(v)}
                    for k, v in sorted(fi.items(), key=lambda x: -x[1])[:5]
                ]
            else:
                top_features = []

            confidence = max(p_30, 1 - p_30)
        else:
            # Rule-based fallback (based on 2026 overtake rules)
            p_pass = self._heuristic_probability(
                gap_s,
                tyre_delta_s,
                energy_advantage_kj,
                self.is_straight_segment(straight_length_m),
            )
            p_30 = p_pass
            p_60 = min(0.95, p_pass * 1.3)
            p_120 = min(0.95, p_pass * 1.5)
            top_features = []
            confidence = max(p_30, 1 - p_30)

        # Overlap probability: chance the attacker gets close enough to attempt
        if gap_s <= 2.0:
            p_overlap = 0.85
        elif gap_s <= 5.0:
            closing = (attacker_speed - defender_speed) / 50.0
            p_overlap = max(0.1, min(0.85, closing + 0.3))
        else:
            p_overlap = 0.05

        tyre_adv = tyre_delta_s
        if energy_advantage_kj > 60:
            energy_adv_str = "+HIGH"
        elif energy_advantage_kj > 25:
            energy_adv_str = "+MED"
        else:
            energy_adv_str = "NEUTRAL"

        rec_lap = current_lap + 2 if not eligible else current_lap

        return OvertakeOpportunityPrediction(
            attacker=attacker,
            defender=defender,
            current_gap_s=round(gap_s, 2),
            p_overlap_opportunity=round(p_overlap, 2),
            p_successful_pass=round(p_30, 3),
            p_pass_30s=round(p_30, 3),
            p_pass_60s=round(p_60, 3),
            p_pass_120s=round(p_120, 3),
            recommended_attack_lap=rec_lap,
            energy_advantage=energy_adv_str,
            tyre_advantage_s=round(tyre_adv, 2),
            eligibility=eligible,
            confidence=round(confidence, 3),
            top_features=top_features,
        )

    def _heuristic_probability(
        self,
        gap_s: float,
        tyre_delta_s: float,
        energy_adv_kj: float,
        is_straight: bool,
    ) -> float:
        """2026 rule-based fallback: gap ≤ 1.0s for overtake mode eligibility."""
        if gap_s > 3.0 and not is_straight:
            return 0.02
        gap_factor = max(0.0, 1.0 - gap_s / 2.0)
        tyre_factor = min(1.0, max(0.0, tyre_delta_s * 2.0))
        energy_factor = min(1.0, max(0.0, energy_adv_kj / 100.0))
        speed_bonus = 0.15 if is_straight else 0.0
        p = gap_factor * 0.45 + tyre_factor * 0.25 + energy_factor * 0.20 + speed_bonus
        return round(min(0.90, max(0.02, p)), 2)

    @staticmethod
    def _encode_tyre(compound: str) -> int:
        c = str(compound).upper().strip()
        mapping = {
            "C1": 0,
            "C2": 1,
            "C3": 2,
            "C4": 3,
            "C5": 4,
            "SOFT": 0,
            "MEDIUM": 2,
            "HARD": 4,
            "INTERMEDIATE": 2,
            "WET": 4,
        }
        return mapping.get(c, 2)

    @staticmethod
    def is_straight_segment(straight_length: float) -> bool:
        return straight_length > 400.0

    # ── Persistence ────────────────────────────────────────────────────────────

    def save(self, path: str | Path) -> Path:
        p = Path(path)
        p.mkdir(parents=True, exist_ok=True)

        with open(p / "model.pkl", "wb") as f:
            pickle.dump(
                {
                    "models": self._models,
                    "feature_cols": self._feature_cols,
                    "cat_cols": self._cat_cols,
                    "training_metrics": self._training_metrics,
                    "seed": self.seed,
                    "ready": self._ready,
                },
                f,
            )

        with open(p / "manifest.json", "w") as f:
            json.dump(
                {
                    "version": "v2026-overtake",
                    "feature_cols": self._feature_cols,
                    "categorical_features": self._cat_cols,
                    "training_metrics": self._training_metrics,
                    "seed": self.seed,
                    "ready": self._ready,
                },
                f,
                indent=2,
            )

        return p

    @classmethod
    def load(cls, path: str | Path) -> OvertakeOpportunityModel:
        p = Path(path)
        with open(p / "model.pkl", "rb") as f:
            data = pickle.load(f)

        obj = cls(seed=data.get("seed", 42))
        obj._models = data.get("models", {})
        obj._feature_cols = data.get("feature_cols", [])
        obj._cat_cols = data.get("cat_cols", [])
        obj._training_metrics = data.get("training_metrics", {})
        obj._ready = data.get("ready", False)
        return obj

    # ── Evaluation ─────────────────────────────────────────────────────────────

    def training_metrics(self) -> dict[str, dict[str, float]]:
        return self._training_metrics
