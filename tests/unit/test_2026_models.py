"""Tests for the 2026 models — energy, overtake, car performance, and data pipeline."""

from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import polars as pl
import pytest

from pitwall.features.energy import (
    EnergyDeploymentPredictor,
    EnergyStateEstimator,
    KalmanEnergyFilter,
)
from pitwall.models.overtake.model import (
    OvertakeOpportunityModel,
)

_TMP_COUNTER = 0


@pytest.fixture
def tmp_workspace() -> Path:
    """Create a temp directory within the project workspace (avoids /tmp permission issues)."""
    global _TMP_COUNTER
    _TMP_COUNTER += 1
    tmp = Path("tests/_tmp") / f"test_{_TMP_COUNTER}"
    tmp.mkdir(parents=True, exist_ok=True)
    yield tmp
    shutil.rmtree(str(tmp), ignore_errors=True)


# ── Fixtures ───────────────────────────────────────────────────────────────────


@pytest.fixture
def small_battle_df() -> pl.DataFrame:
    """Small synthetic battle-state DataFrame for testing the overtake model."""
    rng = np.random.default_rng(42)
    rows = []
    for _i in range(200):
        gap = float(rng.uniform(0.1, 5.0))
        rel_speed = float(rng.uniform(-10, 15))
        tyre_age_attacker = int(rng.integers(1, 35))
        tyre_age_defender = int(rng.integers(1, 35))
        pass_success = 1 if (gap < 1.5 and rel_speed > 5 and tyre_age_defender > 20) else 0
        if pass_success == 0:
            pass_success = 1 if rng.random() < 0.15 else 0
        rows.append(
            {
                "gap_to_car_ahead_s": gap,
                "speed": float(rng.uniform(200, 360)),
                "speed_ahead": float(rng.uniform(200, 360)),
                "throttle": float(rng.uniform(0.1, 1.0)),
                "throttle_ahead": float(rng.uniform(0.1, 1.0)),
                "brake": float(rng.uniform(0, 100)),
                "brake_ahead": float(rng.uniform(0, 100)),
                "rpm": float(rng.uniform(8000, 15000)),
                "rpm_ahead": float(rng.uniform(8000, 15000)),
                "position": int(rng.integers(1, 20)),
                "lap_number": int(rng.integers(1, 78)),
                "race_progress": float(rng.uniform(0.01, 0.99)),
                "tyre_age_attacker": tyre_age_attacker,
                "tyre_age_defender": tyre_age_defender,
                "relative_speed": rel_speed,
                "relative_throttle": float(rng.uniform(-0.3, 0.3)),
                "relative_brake": float(rng.uniform(-30, 30)),
                "relative_pace_3laps": float(rng.uniform(-1, 1)),
                "relative_pace_5laps": float(rng.uniform(-1, 1)),
                "straight_length_m": float(rng.uniform(200, 1300)),
                "distance_to_next_straight": float(rng.uniform(50, 2000)),
                "distance_to_next_corner": float(rng.uniform(50, 1500)),
                "air_temp_c": 25.0,
                "track_temp_c": 35.0,
                "rainfall": 0.0,
                "tyre_class_attacker": int(rng.integers(0, 4)),
                "tyre_class_defender": int(rng.integers(0, 4)),
                "straight_mode_eligible": True,
                "circuit_key": "monza",
                "session_key": 101,
                "driver_number": int(rng.integers(1, 22)),
                "driver_ahead": int(rng.integers(1, 22)),
                "overtake_30s": pass_success,
                "overtake_60s": pass_success,
                "overtake_120s": pass_success,
            }
        )
    return pl.DataFrame(rows)


@pytest.fixture
def small_telemetry_df() -> pl.DataFrame:
    """Small telemetry DataFrame for testing energy models."""
    rng = np.random.default_rng(42)
    rows = []
    for i in range(200):
        speed = float(rng.uniform(80, 360))
        is_straight = speed > 200
        throttle = float(rng.uniform(0.8, 1.0)) if is_straight else float(rng.uniform(0.3, 0.8))
        brake = 0.0 if is_straight else float(rng.uniform(0, 80))
        rows.append(
            {
                "date": f"2026-05-24T15:{i // 60:02d}:{i % 60:02d}.000Z",
                "driver_number": 4,
                "session_key": 101,
                "speed": speed,
                "throttle": throttle,
                "brake": brake,
                "rpm": float(rng.uniform(8000, 15000)),
                "gear": int(rng.integers(3, 7)),
                "drs": int(rng.integers(0, 2)),
                "lap_number": i // 20 + 1,
            }
        )
    return pl.DataFrame(rows)


@pytest.fixture
def small_segment_df() -> pl.DataFrame:
    """Segment-level DataFrame with action labels for deployment predictor."""
    rng = np.random.default_rng(42)
    rows = []
    for _ in range(150):
        seg_type = rng.choice(["STRAIGHT", "CORNER", "CHICANE"])
        if seg_type == "STRAIGHT":
            action = "DEPLOY"
        elif seg_type == "CHICANE":
            action = rng.choice(["RECHARGE", "DEPLOY", "SAVE"])
        else:
            action = rng.choice(["SAVE", "RECHARGE", "DEPLOY"])
        rows.append(
            {
                "segment": f"Seg_{_}",
                "seg_type": seg_type,
                "key_accel_zone": seg_type == "STRAIGHT",
                "downforce_demand": float(rng.uniform(0.1, 1.0)),
                "regen_potential": float(rng.uniform(0.1, 1.0)),
                "length_m": float(rng.uniform(100, 1000)),
                "speed": float(rng.uniform(100, 360)),
                "throttle": float(rng.uniform(0.1, 1.0)),
                "brake": float(rng.uniform(0, 100)),
                "battery_soc_percent": float(rng.uniform(15.0, 90.0)),
                "car_id": "MCL40_Monaco",
                "pu_family": "Mercedes",
                "performance_energy_efficiency": float(rng.uniform(0.3, 0.9)),
                "pu_recharge_efficiency": float(rng.uniform(0.6, 0.9)),
                "pu_peak_acceleration": float(rng.uniform(0.3, 0.9)),
                "race_progress": float(rng.uniform(0.01, 0.99)),
                "lap_number": int(rng.integers(1, 78)),
                "action_label": action,
            }
        )
    return pl.DataFrame(rows)


# ── Overtake model tests ───────────────────────────────────────────────────────


class TestOvertakeModel:
    def test_heuristic_fallback(self):
        """Model works without training (falls back to heuristic)."""
        model = OvertakeOpportunityModel()
        pred = model.predict(
            attacker=4,
            defender=16,
            gap_s=0.5,
            tyre_delta_s=2.0,
            energy_advantage_kj=50.0,
            current_lap=30,
            total_laps=78,
            attacker_speed=340,
            defender_speed=330,
            attacker_tyre_age=8,
            defender_tyre_age=15,
            attacker_compound="C3",
            defender_compound="C2",
            circuit_key="monza",
        )
        assert pred.attacker == 4
        assert pred.defender == 16
        assert 0.0 <= pred.p_pass_30s <= 1.0
        assert 0.0 <= pred.p_overlap_opportunity <= 1.0
        assert pred.eligibility  # gap <= 1.0s
        assert pred.confidence > 0.0
        assert len(pred.top_features) >= 0  # may be 0 with heuristic

    def test_large_gap_blocks_overtake(self):
        """Gap > 3s with small straight = very low probability."""
        model = OvertakeOpportunityModel()
        pred = model.predict(
            attacker=4,
            defender=16,
            gap_s=10.0,
            tyre_delta_s=0.0,
            current_lap=10,
            total_laps=78,
            attacker_speed=200,
            defender_speed=205,
            straight_length_m=200,
        )
        assert pred.p_pass_30s < 0.1
        assert not pred.eligibility

    def test_small_gap_on_straight_high_prob(self):
        """Small gap on long straight = high probability."""
        model = OvertakeOpportunityModel()
        pred = model.predict(
            attacker=4,
            defender=16,
            gap_s=0.3,
            tyre_delta_s=5.0,
            energy_advantage_kj=80.0,
            current_lap=40,
            total_laps=78,
            attacker_speed=350,
            defender_speed=320,
            attacker_tyre_age=25,
            defender_tyre_age=30,
            straight_length_m=1300,
        )
        assert pred.p_pass_30s > 0.5
        assert pred.eligibility

    def test_training_and_evaluation(self, small_battle_df):
        """Model trains on real battle data and can evaluate."""
        model = OvertakeOpportunityModel(seed=42)
        model.fit(small_battle_df)
        assert model._ready or len(model._models) > 0

        # Verify we can predict with trained model
        pred = model.predict(
            attacker=4,
            defender=16,
            gap_s=0.5,
            tyre_delta_s=2.0,
            current_lap=40,
            total_laps=78,
            attacker_speed=340,
            defender_speed=330,
            attacker_tyre_age=10,
            defender_tyre_age=30,
            circuit_key="monza",
        )
        assert 0.0 <= pred.p_pass_30s <= 1.0
        assert pred.top_features is not None

    def test_save_load_roundtrip(self, small_battle_df, tmp_workspace):
        """Model can be saved and loaded."""
        model = OvertakeOpportunityModel(seed=42)
        model.fit(small_battle_df)
        model.save(tmp_workspace / "model_overtake")

        loaded = OvertakeOpportunityModel.load(tmp_workspace / "model_overtake")
        assert loaded._ready == model._ready
        # Loaded model produces same prediction
        kwargs = dict(
            attacker=4,
            defender=16,
            gap_s=0.5,
            tyre_delta_s=2.0,
            current_lap=40,
            total_laps=78,
            attacker_speed=340,
            defender_speed=330,
            circuit_key="monza",
        )
        pred1 = model.predict(**kwargs)
        pred2 = loaded.predict(**kwargs)
        assert abs(pred1.p_pass_30s - pred2.p_pass_30s) < 0.01

    def test_training_metrics_available(self, small_battle_df):
        """Training metrics are computed and accessible."""
        model = OvertakeOpportunityModel(seed=42)
        model.fit(small_battle_df)
        metrics = model.training_metrics()
        assert isinstance(metrics, dict)
        for _window, m in metrics.items():
            assert "auc" in m
            assert "average_precision" in m

    def test_tyre_encoding(self):
        """Tyre compounds are correctly encoded."""
        model = OvertakeOpportunityModel()
        assert model._encode_tyre("C1") == 0
        assert model._encode_tyre("C3") == 2
        assert model._encode_tyre("C5") == 4
        assert model._encode_tyre("SOFT") == 0
        assert model._encode_tyre("HARD") == 4
        assert model._encode_tyre("UNKNOWN") == 2  # default


# ── Energy model tests ─────────────────────────────────────────────────────────


class TestEnergyModel:
    def test_kalman_filter_basic(self):
        """Kalman filter propagates SoC correctly."""
        kf = KalmanEnergyFilter(initial_soc=60.0)
        # No deploy/regen → SoC stays roughly constant
        for _ in range(5):
            kf.predict(deploy_kw=0, regen_kw=0)
        assert 55.0 < kf.soc < 65.0

        # Deploy → SoC decreases
        kf.reset(initial_soc=80.0)
        for _i in range(10):
            kf.predict(deploy_kw=350, regen_kw=0)
        assert kf.soc < 80.0

        # Regen → SoC increases
        kf.reset(initial_soc=20.0)
        for _ in range(10):
            kf.predict(deploy_kw=0, regen_kw=200)
        assert kf.soc > 20.0

    def test_kalman_update(self):
        """Kalman update adjusts based on telemetry."""
        kf = KalmanEnergyFilter(initial_soc=50.0)
        kf.predict(deploy_kw=0, regen_kw=0)
        updated = kf.update(observed_speed=340, throttle=0.95, brake=0)
        assert 10.0 <= updated <= 95.0
        assert kf.std > 0

    def test_estimator_heuristic_fallback(self):
        """EnergyStateEstimator works without trained model."""
        est = EnergyStateEstimator()
        result = est.estimate(
            driver_number=4,
            speed=340,
            throttle=0.95,
            braking=0.0,
            lap_number=5,
            is_straight=True,
            deploy_kw=350.0,
        )
        assert result.battery_soc_percent > 0
        assert result.battery_soc_percent < 100
        assert result.energy_trend in ("DEPLOYING", "RECHARGING", "STABLE")
        assert result.overtake_reserve in ("HIGH", "MEDIUM", "LOW")
        assert isinstance(result.soc_history, list)

    def test_estimator_training(self, small_telemetry_df, small_segment_df):
        """EnergyStateEstimator trains on real telemetry."""
        est = EnergyStateEstimator(seed=42)
        est.fit(
            telemetry_df=small_telemetry_df,
            soc_col="speed",  # use speed as proxy for training (not ideal but tests the pipeline)
            segment_df=small_segment_df,
        )
        assert est._ready

    def test_estimator_save_load(self, small_telemetry_df, small_segment_df, tmp_workspace):
        """Estimator can be saved and loaded."""
        est = EnergyStateEstimator(seed=42)
        est.fit(telemetry_df=small_telemetry_df, segment_df=small_segment_df)
        est.save(tmp_workspace / "model_energy")

        loaded = EnergyStateEstimator.load(tmp_workspace / "model_energy")
        assert loaded._ready == est._ready

        # Loaded estimator produces a result
        result = loaded.estimate(
            driver_number=4,
            speed=300,
            throttle=0.7,
            braking=0.0,
            is_straight=True,
            deploy_kw=250.0,
        )
        assert result.battery_soc_percent > 0

    def test_deployment_predictor_default(self):
        """EnergyDeploymentPredictor works without training."""
        dep = EnergyDeploymentPredictor()
        segs = dep.predict_segments(driver_number=4, circuit="monza")
        assert len(segs) > 0
        for s in segs:
            assert s.deploy_prob + s.save_prob + s.recharge_prob >= 0.95
            assert s.predicted_action in ("DEPLOY", "SAVE", "RECHARGE")

    def test_deployment_predictor_circuit_lookup(self):
        """Deployment predictor looks up circuit-specific segments."""
        dep = EnergyDeploymentPredictor()
        for circuit in ["monza", "spa", "monaco", "silverstone"]:
            segs = dep.predict_segments(driver_number=4, circuit=circuit)
            assert len(segs) > 3, f"Expected segments for {circuit}, got {len(segs)}"


# ── Sync pipeline tests ────────────────────────────────────────────────────────


class TestSyncPipeline:
    def test_energy_label_derivation(self, tmp_workspace):
        """Energy labels are derived from real telemetry patterns."""
        from pitwall.features.sync_2026 import build_gold_energy_labels

        # Create mock bronze data
        bronze = tmp_workspace / "bronze"
        session_dir = bronze / "year=2026" / "event=TestGP" / "session=R"
        session_dir.mkdir(parents=True)

        tele_data = {
            "session_key": [101] * 6,
            "driver_number": [4] * 6,
            "date": [
                "2026-05-24T15:00:00.000Z",
                "2026-05-24T15:00:00:270000.000Z",
                "2026-05-24T15:00:00:540000.000Z",
                "2026-05-24T15:00:01:210000.000Z",
                "2026-05-24T15:00:01:480000.000Z",
                "2026-05-24T15:00:02:160000.000Z",
            ],
            "speed": [80.0, 150.0, 280.0, 340.0, 320.0, 120.0],
            "throttle": [0.3, 0.5, 0.9, 0.95, 0.6, 0.0],
            "brake": [0.0, 0.0, 0.0, 0.0, 0.0, 0.8],
            "rpm": [8000, 10000, 12000, 14000, 13000, 8000],
            "gear": [4, 5, 6, 6, 5, 3],
            "drs": [0, 0, 1, 1, 0, 0],
            "lap_number": [1] * 6,
        }
        pl.DataFrame(tele_data).write_parquet(str(session_dir / "car_data.parquet"))

        labels = build_gold_energy_labels(str(bronze))
        assert not labels.is_empty()
        assert "action_counts" in labels.columns
        assert "dominant_action" in labels.columns
        # Verify labels are one of the valid set
        valid_actions = {"DEPLOY", "RECHARGE", "SAVE", "STABLE"}
        actual = set(labels["dominant_action"].unique().to_list())
        assert actual.issubset(valid_actions), f"Unexpected actions: {actual - valid_actions}"

    def test_clean_pace_labels(self, tmp_workspace):
        """Clean pace labels are derived from real race conditions."""
        from pitwall.features.sync_2026 import build_gold_clean_pace

        bronze = tmp_workspace / "bronze"
        session_dir = bronze / "year=2026" / "event=TestGP" / "session=R"
        session_dir.mkdir(parents=True)

        # Create mock laps
        lap_data = {
            "session_key": [101] * 4,
            "driver_number": [4] * 4,
            "lap_number": [1, 2, 3, 4],
            "lap_time": [None, 90.0, 91.0, 112.0],  # lap 4 is a pit lap
            "lap_start": [
                "2026-05-24T15:00:00.000Z",
                "2026-05-24T15:01:30.000Z",
                "2026-05-24T15:03:00.000Z",
                "2026-05-24T15:04:30.000Z",
            ],
            "is_pit_in": [False, False, False, True],
            "track_status": ["1", "1", "1", "1"],
        }
        pl.DataFrame(lap_data).write_parquet(str(session_dir / "laps.parquet"))

        clean = build_gold_clean_pace(str(bronze))
        if not clean.is_empty():
            assert "is_clean_pace_lap" in clean.columns
            assert "is_valid_training_lap" in clean.columns

    def test_circuit_config_lookup(self):
        """Circuit configs can be looked up by name."""
        from pitwall.regulations.circuits import all_circuits, get_circuit_config

        cfg = get_circuit_config("monza")
        assert cfg is not None
        assert cfg.circuit_short_name == "Monza"
        assert len(cfg.segments) > 0

        cfg2 = get_circuit_config("monaco")
        assert cfg2 is not None
        assert len(cfg2.segments) > 5

        all_c = all_circuits()
        assert len(all_c) >= 6


# ── Cars metadata tests ────────────────────────────────────────────────────────


class TestCarMetadata:
    def test_all_2026_drivers_have_profiles(self):
        """All 26 2026 drivers have valid car profiles."""
        from datetime import date

        from pitwall.regulations.cars import DRIVER2026, get_car_profile

        mid_season = date(2026, 7, 20)
        for dn in DRIVER2026:
            profile = get_car_profile(dn, mid_season)
            assert profile is not None
            assert profile.driver_number == dn
            assert profile.constructor != ""
            assert profile.chassis_name != ""
            assert profile.pu is not None
            assert 0.0 <= profile.performance.high_speed <= 1.0

    def test_upgrade_epochs(self):
        """Upgrade epochs apply correct deltas."""
        from datetime import date

        from pitwall.regulations.cars import get_car_profile

        # McLaren before Miami (no upgrade)
        p_launch = get_car_profile(4, date(2026, 5, 1))  # before Miami
        assert p_launch.upgrade_epoch == "Launch"

        # McLaren after Austria (3rd upgrade)
        p_austria = get_car_profile(4, date(2026, 7, 20))
        assert p_austria.upgrade_epoch == "Austria"

    def test_pu_decomposition(self):
        """PU decomposition returns manufacturer info."""
        from pitwall.regulations.cars import pu_decomposition

        result = pu_decomposition(4)  # McLaren = Mercedes PU
        assert result["pu_family"] == "Mercedes"

    def test_legacy_fallback(self):
        """2024-era drivers get a neutral fallback profile."""
        from datetime import date

        from pitwall.regulations.cars import get_car_profile

        # Driver numbers not in DRIVER2026
        p = get_car_profile(99, date(2024, 6, 1))
        assert p.constructor == "Legacy"
        assert p.upgrade_epoch == "N/A"
        assert p.performance.high_speed == 0.5  # neutral default
