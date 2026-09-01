"""Energy State Estimator & Deployment Predictor for 2026 ERS regulations.

The actual battery SoC is NOT exposed by public telemetry feeds (FIA removed
public access to ERS deploy/recharge and Active Aero position channels in 2026).
FastF1 discussion #861 confirms the DRS/ERS telemetry channels are effectively
useless for the 2026 era.

So instead of predicting SoC — which we have no labels for — these models
**detect energy-management behaviour** from observable telemetry proxies:

  - Throttle lift-and-coast patterns (coasting distance, throttle lift point)
  - Speed decay rates (terminal acceleration loss)
  - Braking intensity and regen inference (heavier braking → more regen)
  - Speed differentials across track segments (deploy = faster than baseline)

Architecture:
  - ``KalmanEnergyFilter`` — physics-based state-space model that integrates
    MGU-K deploy (350 kW key zones / 250 kW elsewhere per the April-2026 patch)
    and regenerative braking to propagate a latent SoC prior.  This provides
    a physically-grounded estimate, always marked as *estimated* in the UI.
  - ``EnergyStateEstimator`` — trains a LightGBM regressor on real telemetry
    to correct the Kalman prior, using observable proxies (speed, throttle,
    brake, RPM, gear, position, circuit context).
  - ``EnergyDeploymentPredictor`` — LightGBM classifier that predicts
    DEPLOY / SAVE / RECHARGE behaviour for each track segment from telemetry
    patterns.  Labels are derived from observable throttle/brake/speed behavior,
    not from synthetic SoC traces.

All models follow the same ``save(path) / load(path)`` contract as the
pace/tyre/pit models.  Every training label comes from an observed event —
no synthetic data.
"""

from __future__ import annotations

import json
import pickle
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, ClassVar

import numpy as np
import polars as pl

try:
    import lightgbm as lgb
except ImportError:  # pragma: no cover
    lgb = None  # type: ignore[assignment]


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class EnergyStateEstimate:
    """Estimated ERS state for one driver at one point in time."""

    driver_number: int
    battery_soc_percent: float = 60.0
    battery_soc_std: float = 8.0  # 1-sigma uncertainty
    energy_trend: str = "RECHARGING"  # DEPLOYING | RECHARGING | STABLE
    next_major_deploy: str = "T1-T3"
    overtake_reserve: str = "HIGH"  # HIGH | MEDIUM | LOW
    energy_limited_risk_pct: float = 15.0
    active_aero_mode: str = "CORNER"  # CORNER | STRAIGHT
    deploy_power_kw: float = 0.0
    last_deploy_lap: int | None = None
    soc_history: list[float] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class SegmentPrediction:
    """Deployment action probability for one track segment."""

    segment: str
    seg_type: str
    deploy_prob: float
    save_prob: float
    recharge_prob: float
    predicted_action: str


# ---------------------------------------------------------------------------
# Kalman filter — physics-based SoC propagation
# ---------------------------------------------------------------------------


class KalmanEnergyFilter:
    """Minimal Kalman filter for battery SoC state estimation.

    State vector: ``[soc, soc_rate]`` where soc is battery percentage
    (10-95) and soc_rate is the rate of change (percent per second).

    The prediction step integrates MGU-K deploy / regen power.  The update
    step uses observed speed/throttle/brake as noisy observations of whether
    the car is deploying or regenerating.
    """

    def __init__(
        self,
        initial_soc: float = 60.0,
        es_capacity_kj: float = 4000.0,
        mguk_deploy_kw: float = 350.0,
        mguk_regen_kw: float = 200.0,
        dt: float = 1.0,
    ) -> None:
        self.es_capacity_kj = es_capacity_kj
        self.mguk_deploy_kw = mguk_deploy_kw
        self.mguk_regen_kw = mguk_regen_kw
        self.dt = dt
        # State
        self.soc = float(np.clip(initial_soc, 10.0, 95.0))
        self.soc_rate = 0.0
        # Covariance (soc, soc_rate)
        self.P = np.diag([100.0, 25.0])
        # Process noise
        self.Q = np.diag([1.0, 0.5])
        # Measurement noise
        self.R = 9.0
        # History
        self._history: list[float] = [self.soc]

    @property
    def soc_history(self) -> list[float]:
        return list(self._history)

    def _kw_to_soc_rate(self, kw: float) -> float:
        """Convert power (kW) over dt to percentage SoC change.

        ``P(kW) * dt(s)`` = energy in kJ.  Divide by capacity to get fraction.
        """
        energy_kj = kw * self.dt
        return (energy_kj / self.es_capacity_kj) * 100.0

    def predict(self, deploy_kw: float = 0.0, regen_kw: float = 0.0) -> float:
        """Propagate state by dt using deploy/regen power.

        ``deploy_kw`` and ``regen_kw`` are instantaneous power values.
        Returns the predicted SoC.
        """
        # Net power drain (positive = discharging)
        net_kw = deploy_kw - regen_kw
        soc_change = self._kw_to_soc_rate(net_kw) * self.dt
        # State transition
        self.soc = float(np.clip(self.soc - soc_change, 10.0, 95.0))
        self.soc_rate = float(np.clip(-soc_change / max(self.dt, 0.001), -5.0, 5.0))
        # Covariance propagation (constant velocity model)
        F = np.array([[1.0, self.dt], [0.0, 1.0]])
        self.P = F @ self.P @ F.T + self.Q
        self._history.append(self.soc)
        return self.soc

    def update(self, observed_speed: float, throttle: float, brake: float) -> float:
        """Update belief using telemetry proxies.

        When speed > 250 km/h and throttle > 0.9, the car is likely deploying.
        When brake > 0.3, the car is regenerating.  We use these as noisy
        observations of the true SoC change.
        """
        # Observation model: expected SoC rate given telemetry
        # High speed + high throttle → deploying → SoC decreasing
        if observed_speed > 260 and throttle > 0.85:
            expected_rate = -2.5 * self.mguk_deploy_kw / 350.0  # percent/sec
        elif brake > 0.4:
            expected_rate = 1.5 * self.mguk_regen_kw / 200.0
        else:
            expected_rate = 0.0

        # Measurement residual
        residual = self.soc_rate - expected_rate
        # Kalman gain
        H = np.array([1.0, 0.0])  # observe soc_rate indirectly
        S = H @ self.P @ H.T + self.R * abs(expected_rate + 1.0)
        if S < 1e-6:
            S = 1e-6
        K = (self.P @ H) / S
        # State update
        self.soc = float(np.clip(self.soc + K[0] * residual, 10.0, 95.0))
        self.soc_rate = float(self.soc_rate + K[1] * residual)
        # Covariance update
        identity = np.eye(2)
        self.P = (identity - np.outer(K, H)) @ self.P
        self._history[-1] = self.soc
        return self.soc

    def reset(self, initial_soc: float = 60.0) -> None:
        """Reset filter to a new race/driver."""
        self.soc = float(np.clip(initial_soc, 10.0, 95.0))
        self.soc_rate = 0.0
        self.P = np.diag([100.0, 25.0])
        self._history = [self.soc]

    @property
    def std(self) -> float:
        """1-sigma uncertainty estimate from covariance diagonal."""
        return float(np.sqrt(self.P[0, 0]))


# ---------------------------------------------------------------------------
# Energy State Estimator — LightGBM correction on top of Kalman filter
# ---------------------------------------------------------------------------


class EnergyStateEstimator:
    """Estimates ERS battery state from telemetry features.

    Combines a physics-based Kalman filter with a learned LightGBM correction
    model.  The Kalman filter provides the prior (physics-driven) SoC, and
    the LightGBM model predicts the residual correction based on observed
    telemetry patterns (throttle aggression, braking intensity, track position,
    corner identity, lap number, etc.).

    The result is always **estimated** — never presented as ground truth.
    """

    DEPLOY_FEATURES: ClassVar[list[str]] = [
        "speed",
        "throttle",
        "brake",
        "rpm",
        "gear",
        "lap_number",
        "tyre_age",
        "race_progress",
        "gap_ahead_s",
        "position",
        "battery_soc_percent",
        "performance_energy_efficiency",
        "performance_straight_line",
        "pu_recharge_efficiency",
        "perf_high_speed",
    ]

    SEGMENT_FEATURES: ClassVar[list[str]] = [
        "segment",
        "seg_type",
        "key_accel_zone",
        "downforce_demand",
        "regen_potential",
        "length_m",
        "speed",
        "throttle",
        "brake",
        "battery_soc_percent",
        "car_id",
        "pu_family",
        "performance_energy_efficiency",
        "pu_recharge_efficiency",
        "pu_peak_acceleration",
        "race_progress",
        "lap_number",
    ]

    ACTION_LABELS: ClassVar[list[str]] = ["DEPLOY", "SAVE", "RECHARGE"]

    def __init__(self, seed: int = 42) -> None:
        self.seed = seed
        self.kalman: KalmanEnergyFilter | None = None
        self._lgb_model: Any | None = None
        self._deploy_model: Any | None = None
        self._feature_cols: list[str] = []
        self._segment_feature_cols: list[str] = []
        self._categorical_features: list[str] = ["segment", "seg_type", "pu_family", "car_id"]
        self._ready = False

    # -- Kalman filter management ------------------------------------------------

    def init_kalman(
        self, driver_number: int, initial_soc: float = 60.0, mguk_deploy_kw: float = 350.0
    ) -> KalmanEnergyFilter:
        """Create or reset the Kalman filter for a driver."""
        self.kalman = KalmanEnergyFilter(
            initial_soc=initial_soc,
            mguk_deploy_kw=mguk_deploy_kw,
        )
        return self.kalman

    # -- Training ---------------------------------------------------------------

    def fit(
        self,
        telemetry_df: pl.DataFrame | None = None,
        soc_col: str = "battery_soc",
        segment_df: pl.DataFrame | None = None,
    ) -> EnergyStateEstimator:
        """Train the LightGBM models.

        ``telemetry_df`` — per-point telemetry with features in ``DEPLOY_FEATURES``
          and ``soc_col`` as the true SoC target.
        ``segment_df`` — per-segment labels with ``action_label``
          (DEPLOY/SAVE/RECHARGE) and features in ``SEGMENT_FEATURES``.
        """
        if lgb is None:
            raise ImportError("lightgbm not installed. pip install lightgbm")

        # 1) Train SoC correction model on telemetry
        if telemetry_df is not None and not telemetry_df.is_empty():
            self._feature_cols = [c for c in self.DEPLOY_FEATURES if c in telemetry_df.columns]
            if soc_col in telemetry_df.columns and telemetry_df.height > 20:
                self._train_soc_model(telemetry_df, soc_col)

        # 2) Train deployment predictor on segment labels
        has_action = "action_label" in segment_df.columns if segment_df is not None else False
        if segment_df is not None and not segment_df.is_empty() and has_action:
            self._segment_feature_cols = [
                c for c in self.SEGMENT_FEATURES if c in segment_df.columns
            ]
            if segment_df.height > 10 and segment_df["action_label"].n_unique() > 1:
                self._train_deploy_model(segment_df)

        self._ready = True
        return self

    def _train_soc_model(self, df: pl.DataFrame, soc_col: str) -> None:
        """Train LightGBM to predict SoC from telemetry."""
        feature_cols = [c for c in self._feature_cols if c != soc_col]
        if len(feature_cols) < 3 or df.height < 20:
            return

        # Encode categoricals
        df = df.clone()
        for c in ["compound"]:
            if c in df.columns:
                df = df.with_columns(pl.col(c).cast(pl.Utf8))

        # Split for validation
        n = df.height
        split = int(n * 0.8)
        train_df = df.head(split)
        valid_df = df.slice(split)

        params = {
            "objective": "regression",
            "metric": "mae",
            "boosting_type": "gbdt",
            "num_leaves": 15,
            "learning_rate": 0.05,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "n_estimators": 200,
            "early_stopping_rounds": 20,
        }

        X_train = self._prepare_X(train_df, feature_cols)
        y_train = train_df[soc_col].to_numpy()

        X_valid = self._prepare_X(valid_df, feature_cols) if not valid_df.is_empty() else None
        y_valid = valid_df[soc_col].to_numpy() if not valid_df.is_empty() else None

        self._lgb_model = lgb.LGBMRegressor(**params)
        if X_valid is not None and len(y_valid) > 0:
            self._lgb_model.fit(
                X_train,
                y_train,
                eval_set=[(X_valid, y_valid)],
                callbacks=[lgb.early_stopping(20), lgb.log_evaluation(0)],
            )
        else:
            self._lgb_model.fit(X_train, y_train)

        self._soc_feature_cols = feature_cols

    def _train_deploy_model(self, df: pl.DataFrame) -> None:
        """Train LightGBM classifier for DEPLOY/SAVE/RECHARGE."""
        feature_cols = [c for c in self._segment_feature_cols if c != "action_label"]
        cat_cols = [c for c in self._categorical_features if c in df.columns]

        # Encode action_label to integer
        label_map = {label: i for i, label in enumerate(self.ACTION_LABELS)}
        df_enc = df.with_columns(
            pl.col("action_label").replace_strict(label_map, return_dtype=pl.Int8).alias("_label")
        )

        n = df_enc.height
        split = int(n * 0.8)
        train_df = df_enc.head(split)
        valid_df = df_enc.slice(split)

        params = {
            "objective": "multiclass",
            "metric": "multi_logloss",
            "boosting_type": "gbdt",
            "num_leaves": 15,
            "learning_rate": 0.05,
            "feature_fraction": 0.9,
            "bagging_fraction": 0.8,
            "bagging_freq": 5,
            "verbose": -1,
            "n_estimators": 200,
            "num_class": 3,
            "early_stopping_rounds": 20,
            "class_weight": "balanced",
        }

        X_train = self._prepare_X(train_df, feature_cols, cat_cols)
        y_train = train_df["_label"].to_numpy()

        if not valid_df.is_empty():
            X_valid = self._prepare_X(valid_df, feature_cols, cat_cols)
            y_valid = valid_df["_label"].to_numpy()
        else:
            X_valid = None
            y_valid = None

        self._deploy_model = lgb.LGBMClassifier(**params)
        if X_valid is not None and len(y_valid) > 0:
            self._deploy_model.fit(
                X_train,
                y_train,
                eval_set=[(X_valid, y_valid)],
                callbacks=[lgb.early_stopping(20), lgb.log_evaluation(0)],
            )
        else:
            self._deploy_model.fit(X_train, y_train)

        self._deploy_feature_cols = feature_cols
        self._deploy_cat_cols = cat_cols
        self._deploy_label_map = label_map

    def _prepare_X(
        self, df: pl.DataFrame, cols: list[str], cat_cols: list[str] | None = None
    ) -> Any:
        cols_present = [c for c in cols if c in df.columns]
        sub = df.select(cols_present)
        for c in cols_present:
            if cat_cols and c in cat_cols:
                sub = sub.with_columns(pl.col(c).fill_null("UNKNOWN").cast(pl.Utf8))
            else:
                try:
                    med = sub[c].median()
                    sub = sub.with_columns(pl.col(c).fill_null(med if med is not None else 0))
                except Exception:
                    sub = sub.with_columns(pl.col(c).fill_null(0))
        pdf = sub.to_pandas()
        if cat_cols:
            for c in cat_cols:
                if c in pdf.columns:
                    pdf[c] = pdf[c].astype("category")
        return pdf

    # -- Inference --------------------------------------------------------------

    def estimate(
        self,
        driver_number: int,
        speed: float | None = None,
        throttle: float | None = None,
        braking: float | None = None,
        rpm: float | None = None,
        gear: int | None = None,
        lap_number: int | None = None,
        gap_ahead: float | None = None,
        position: int | None = None,
        race_progress: float | None = None,
        tyre_age: int | None = None,
        battery_soc_percent: float | None = None,
        performance_energy_efficiency: float | None = None,
        pu_recharge_efficiency: float | None = None,
        perf_high_speed: float | None = None,
        is_straight: bool | None = None,
        deploy_kw: float = 0.0,
        regen_kw: float = 0.0,
    ) -> EnergyStateEstimate:
        """Estimate battery state from telemetry proxies.

        Falls back to Kalman-only estimation when no trained model is loaded.
        """
        # Kalman prior
        if self.kalman is None:
            self.init_kalman(driver_number)
        assert self.kalman is not None

        # Telemetry proxies
        speed_val = speed or (180.0 if is_straight else 120.0)
        throttle_val = throttle or (0.9 if is_straight else 0.6)
        brake_val = braking or 0.0
        rpm_val = rpm or 10000.0
        gear_val = gear or 6
        lap_val = lap_number or 1
        gap_val = gap_ahead or 0.0
        pos_val = position or 10
        progress_val = race_progress or 0.5
        tyre_val = tyre_age or 1
        soc_input = battery_soc_percent or self.kalman.soc

        # Kalman predict + update
        self.kalman.predict(deploy_kw=deploy_kw, regen_kw=regen_kw)
        soc_kalman = self.kalman.update(speed_val, throttle_val, brake_val)

        # LightGBM correction (if trained)
        soc_est = soc_kalman
        if self._lgb_model is not None and hasattr(self, "_soc_feature_cols"):
            try:
                row = {
                    "speed": speed_val,
                    "throttle": throttle_val,
                    "brake": brake_val,
                    "rpm": rpm_val,
                    "gear": gear_val,
                    "lap_number": lap_val,
                    "tyre_age": tyre_val,
                    "race_progress": progress_val,
                    "gap_ahead_s": gap_val,
                    "position": pos_val,
                    "battery_soc_percent": soc_input,
                    "performance_energy_efficiency": performance_energy_efficiency or 0.7,
                    "performance_straight_line": 0.7,
                    "pu_recharge_efficiency": pu_recharge_efficiency or 0.75,
                    "perf_high_speed": perf_high_speed or 0.7,
                }
                import pandas as pd

                X = pd.DataFrame([row])
                correction = float(self._lgb_model.predict(X)[0])
                soc_est = float(np.clip(soc_kalman + correction, 10.0, 95.0))
            except Exception:
                pass  # fall back to Kalman

        soc_std = max(self.kalman.std, 5.0)

        # Trend classification
        recent = self.kalman.soc_history[-5:] if len(self.kalman._history) >= 2 else [soc_est]
        if len(recent) >= 2:
            delta = recent[-1] - recent[0]
            if delta < -1.0:
                trend = "DEPLOYING"
            elif delta > 1.0:
                trend = "RECHARGING"
            else:
                trend = "STABLE"
        else:
            trend = "STABLE"

        # Reserve assessment
        if soc_est > 50:
            reserve = "HIGH"
        elif soc_est > 25:
            reserve = "MEDIUM"
        else:
            reserve = "LOW"

        # Energy-limited risk
        risk = round(max(0.0, min(100.0, (80.0 - soc_est) * 0.5)), 1)

        # Next major deploy inference
        if is_straight or (speed_val and speed_val > 250):
            next_deploy = "Next STRAIGHT"
        elif soc_est < 40:
            next_deploy = "Energy-limited — conserve"
        else:
            next_deploy = "T1-T3 Main Straight"

        return EnergyStateEstimate(
            driver_number=driver_number,
            battery_soc_percent=round(soc_est, 1),
            battery_soc_std=round(soc_std, 1),
            energy_trend=trend,
            next_major_deploy=next_deploy,
            overtake_reserve=reserve,
            energy_limited_risk_pct=risk,
            active_aero_mode=(
                "STRAIGHT" if is_straight or (speed_val and speed_val > 220) else "CORNER"
            ),
            deploy_power_kw=deploy_kw,
            last_deploy_lap=lap_val if deploy_kw > 0 else None,
            soc_history=[round(s, 1) for s in self.kalman.soc_history[-10:]],
        )

    # -- Deployment prediction per segment -------------------------------------

    def predict_segments(
        self,
        driver_number: int,
        track_segments: list[dict[str, Any]] | None = None,
        soc: float | None = None,
        circuit: str | None = None,
    ) -> list[SegmentPrediction]:
        """Predict DEPLOY/SAVE/RECHARGE probability for each track segment.

        ``track_segments`` is a list of segment dicts with keys like
        ``segment``, ``seg_type``, ``key_accel_zone``, ``speed``, etc.
        If a ``circuit`` name is given and no explicit segments are supplied,
        looks up the circuit's track configuration.
        Falls back to heuristic defaults when no trained model is available.
        """
        if track_segments is None:
            track_segments = self._circuit_segments(circuit)

        results: list[SegmentPrediction] = []

        for seg in track_segments:
            seg_name = seg.get("segment", "Unknown")
            seg_type = seg.get("seg_type", "STRAIGHT")

            if (
                self._deploy_model is not None
                and hasattr(self, "_deploy_feature_cols")
                and len(self._deploy_feature_cols) > 0
                and all(c in seg for c in self._deploy_feature_cols)
            ):
                # Use trained model
                try:
                    import pandas as pd

                    row = {k: v for k, v in seg.items() if k in self._deploy_feature_cols}
                    for c in self._deploy_cat_cols:
                        if c in row:
                            row[c] = str(row[c])
                    X = pd.DataFrame([row])
                    probs = self._deploy_model.predict_proba(X)[0]
                    classes = list(self._deploy_model.classes_)
                    # Map model classes to action label names
                    prob_map: dict[str, float] = {}
                    for cls_idx, cls_label in enumerate(classes):
                        label_name = self._deploy_label_map.get(cls_label)
                        if label_name:
                            prob_map[label_name] = probs[cls_idx] if cls_idx < len(probs) else 0.0
                    deploy_prob = float(prob_map.get("DEPLOY", 0.5))
                    save_prob = float(prob_map.get("SAVE", 0.3))
                    recharge_prob = float(prob_map.get("RECHARGE", 0.2))
                    # Renormalise
                    total = deploy_prob + save_prob + recharge_prob
                    if total > 0:
                        deploy_prob /= total
                        save_prob /= total
                        recharge_prob /= total
                    probs_list = [deploy_prob, save_prob, recharge_prob]
                    predicted = self.ACTION_LABELS[int(np.argmax(probs_list))]
                except Exception:
                    deploy_prob, save_prob, recharge_prob = self._heuristic_probs(seg)
                    probs_list = [deploy_prob, save_prob, recharge_prob]
                    predicted = self.ACTION_LABELS[int(np.argmax(probs_list))]
            else:
                deploy_prob, save_prob, recharge_prob = self._heuristic_probs(seg)
                probs_list = [deploy_prob, save_prob, recharge_prob]
                predicted = self.ACTION_LABELS[int(np.argmax(probs_list))]

            results.append(
                SegmentPrediction(
                    segment=seg_name,
                    seg_type=seg_type,
                    deploy_prob=round(deploy_prob, 3),
                    save_prob=round(save_prob, 3),
                    recharge_prob=round(recharge_prob, 3),
                    predicted_action=predicted,
                )
            )

        return results

    def _heuristic_probs(self, seg: dict[str, Any]) -> tuple[float, float, float]:
        """Fallback heuristic based on segment type and key accel zone."""
        seg_type = seg.get("seg_type", "STRAIGHT")
        key_accel = seg.get("key_accel_zone", False)
        regen_pot = seg.get("regen_potential", 0.5)
        seg.get("downforce_demand", 0.5)

        if seg_type == "STRAIGHT" and key_accel:
            return 0.91, 0.07, 0.02
        elif seg_type == "CHICANE":
            if regen_pot > 0.7:
                return 0.10, 0.25, 0.65
            return 0.25, 0.40, 0.35
        elif seg_type == "CORNER":
            if regen_pot > 0.6:
                return 0.05, 0.35, 0.60
            return 0.30, 0.50, 0.20
        else:
            return 0.50, 0.35, 0.15

    def _circuit_segments(self, circuit: str | None) -> list[dict[str, Any]]:
        """Look up circuit-specific segments, falling back to defaults."""
        if circuit:
            try:
                from pitwall.regulations.circuits import get_circuit_config

                cfg = get_circuit_config(circuit)
                if cfg is not None:
                    return [
                        {
                            "segment": s.name,
                            "seg_type": s.seg_type,
                            "key_accel_zone": s.key_accel_zone,
                            "speed": 300.0,
                            "throttle": 0.8,
                            "brake": 0.3,
                            "battery_soc_percent": 60.0,
                            "car_id": "default",
                            "pu_family": "Mercedes",
                            "performance_energy_efficiency": 0.75,
                            "pu_recharge_efficiency": 0.78,
                            "pu_peak_acceleration": 0.80,
                            "race_progress": 0.5,
                            "lap_number": 30,
                        }
                        for s in cfg.segments
                    ]
            except Exception:
                pass
        return self._default_segments()

    def _default_segments(self) -> list[dict[str, Any]]:
        """Default track segments for common circuits."""
        return [
            {
                "segment": "Turn 1 Exit",
                "seg_type": "CORNER",
                "key_accel_zone": False,
                "speed": 220.0,
                "throttle": 0.6,
                "brake": 0.1,
                "regen_potential": 0.7,
            },
            {
                "segment": "Main Straight",
                "seg_type": "STRAIGHT",
                "key_accel_zone": True,
                "speed": 340.0,
                "throttle": 0.95,
                "brake": 0.0,
                "regen_potential": 0.1,
            },
            {
                "segment": "Sector 3 Complex",
                "seg_type": "CHICANE",
                "key_accel_zone": False,
                "speed": 200.0,
                "throttle": 0.5,
                "brake": 0.4,
                "regen_potential": 0.8,
            },
        ]

    # -- Persistence -----------------------------------------------------------

    def save(self, path: str | Path) -> Path:
        """Save model artifacts to path/."""
        p = Path(path)
        p.mkdir(parents=True, exist_ok=True)

        deploy_fc = getattr(self, "_deploy_feature_cols", None) or []
        deploy_cc = getattr(self, "_deploy_cat_cols", None) or []
        deploy_lm = getattr(self, "_deploy_label_map", None) or {}

        with open(p / "model.pkl", "wb") as f:
            pickle.dump(
                {
                    "soc_model": self._lgb_model,
                    "deploy_model": self._deploy_model,
                    "soc_feature_cols": getattr(self, "_soc_feature_cols", []),
                    "deploy_feature_cols": deploy_fc,
                    "deploy_cat_cols": deploy_cc,
                    "deploy_label_map": deploy_lm,
                    "categorical_features": self._categorical_features,
                    "deploy_features": self.SEGMENT_FEATURES,
                    "soc_features": self.DEPLOY_FEATURES,
                    "seed": self.seed,
                    "ready": self._ready,
                },
                f,
            )

        with open(p / "manifest.json", "w") as f:
            json.dump(
                {
                    "version": "v2026-energy",
                    "soc_feature_cols": getattr(self, "_soc_feature_cols", []),
                    "deploy_feature_cols": deploy_fc,
                    "deploy_cat_cols": deploy_cc,
                    "seed": self.seed,
                    "ready": self._ready,
                },
                f,
                indent=2,
            )

        return p

    @classmethod
    def load(cls, path: str | Path) -> EnergyStateEstimator:
        """Load a saved energy model."""
        p = Path(path)
        with open(p / "model.pkl", "rb") as f:
            data = pickle.load(f)

        obj = cls(seed=data.get("seed", 42))
        obj._lgb_model = data.get("soc_model")
        obj._deploy_model = data.get("deploy_model")
        obj._soc_feature_cols = data.get("soc_feature_cols", [])
        obj._deploy_feature_cols = data.get("deploy_feature_cols", [])
        obj._deploy_cat_cols = data.get("deploy_cat_cols", [])
        obj._deploy_label_map = data.get("deploy_label_map", {})
        obj._categorical_features = data.get("categorical_features", obj._categorical_features)
        obj._ready = data.get("ready", False)
        return obj


class EnergyDeploymentPredictor:
    """Predicts DEPLOY / SAVE / RECHARGE across track segments.

    Thin wrapper around ``EnergyStateEstimator.predict_segments``, provided
    for API compatibility with the original stub interface.
    """

    def __init__(self, estimator: EnergyStateEstimator | None = None, seed: int = 42) -> None:
        self._estimator = estimator or EnergyStateEstimator(seed=seed)

    def fit(self, segment_df: pl.DataFrame) -> EnergyDeploymentPredictor:
        """Train on segment-level telemetry with action_label."""
        self._estimator.fit(segment_df=segment_df)
        return self

    def predict_segments(
        self,
        driver_number: int,
        track_segments: list[str] | None = None,
        circuit: str | None = None,
    ) -> list[SegmentPrediction]:
        """Predict deployment action probabilities per segment."""
        return self._estimator.predict_segments(
            driver_number=driver_number,
            track_segments=track_segments,
            circuit=circuit,
        )
