"""Unit tests for DeterministicPhysicsBaseline, HybridPaceModel, and SectorChainModel."""

from __future__ import annotations

import numpy as np
import polars as pl
import pytest

from pitwall.evaluation.metrics import mae
from pitwall.features.pace import build_pace_features
from pitwall.models.pace.hybrid_model import DeterministicPhysicsBaseline, HybridPaceModel
from pitwall.models.pace.sector_chain import SectorChainModel

# ── 1. DeterministicPhysicsBaseline Tests ────────────────────────────────────


def test_physics_fuel_burn_off() -> None:
    """Verify fuel mass loss reduces lap time (negative delta contribution)."""
    phys = DeterministicPhysicsBaseline(fuel_burn_s_per_lap=0.033)
    df = pl.DataFrame({
        "compound": ["MEDIUM", "MEDIUM"],
        "tyre_age": [0.0, 0.0],
    })
    deltas = phys.compute_delta(df)
    # Tyre age 0: delta = -fuel_burn + base_deg * 1.0
    # Medium: -0.033 + 0.028 = -0.005
    assert deltas[0] < 0.01
    assert np.isclose(deltas[0], -0.033 + 0.028, atol=1e-3)


def test_physics_compound_degradation_ordering() -> None:
    """Soft tyres must have higher degradation slope than Hard tyres."""
    phys = DeterministicPhysicsBaseline()
    df = pl.DataFrame({
        "compound": ["SOFT", "HARD"],
        "tyre_age": [10.0, 10.0],
    })
    deltas = phys.compute_delta(df)
    assert deltas[0] > deltas[1], "Soft tyre degradation must exceed Hard tyre degradation"


def test_physics_hard_warmup_penalty() -> None:
    """Hard tyres on laps 1-3 must receive non-linear graining/warmup penalty."""
    phys = DeterministicPhysicsBaseline(hard_warmup_penalty_s=0.15)
    df_warmup = pl.DataFrame({"compound": ["HARD"], "tyre_age": [1.0]})
    df_settled = pl.DataFrame({"compound": ["HARD"], "tyre_age": [5.0]})

    d_warmup = phys.compute_delta(df_warmup)[0]
    d_settled = phys.compute_delta(df_settled)[0]

    # Warmup on lap 1 has extra +0.15 * (3/3) = +0.15s graining penalty
    assert d_warmup > d_settled


# ── 2. HybridPaceModel Tests ─────────────────────────────────────────────────


@pytest.fixture
def sample_gold_data() -> pl.DataFrame:
    """Load real clean laps from 2026 Italian GP for testing."""
    df = pl.read_parquet("data/silver/laps/2026_Italian Grand Prix_R.parquet")
    gold = build_pace_features(df)
    return gold.filter(pl.col("is_valid_training_lap_target")).filter(
        pl.col("next_clean_lap_s").is_not_null()
    )


def test_hybrid_pace_sub_350ms_reconstruction(sample_gold_data: pl.DataFrame) -> None:
    """Verify HybridPaceModel achieves sub-350ms reconstructed lap MAE."""
    # Chronological within-race split: laps <= 35 train, laps > 35 test
    clean_laps = sample_gold_data.filter(
        (pl.col("next_clean_lap_s") - pl.col("lap_time_s")).abs() < 2.0
    )
    train_df = clean_laps.filter(pl.col("lap_number") <= 35)
    test_df = clean_laps.filter(pl.col("lap_number") > 35)

    features = [
        "pace_offset_r3",
        "speed_fl_delta",
        "speed_i1_delta",
        "speed_i2_delta",
        "speed_st_delta",
        "s1_delta",
        "s2_delta",
        "s3_delta",
        "tyre_age",
        "stint_no",
        "lap_number",
        "race_progress",
        "compound",
    ]

    model = HybridPaceModel(
        params={"n_estimators": 100, "learning_rate": 0.05, "num_leaves": 20, "verbose": -1},
        alphas=[0.1, 0.5, 0.9],
        categorical_features=["compound"],
    )
    model.fit(train_df, None, feature_cols=features)

    # Predict reconstructed absolute lap times
    preds_abs = model.predict(test_df)
    y_true_abs = test_df["next_clean_lap_s"].to_numpy()

    error_s = mae(y_true_abs, preds_abs)
    # Assert reconstructed lap MAE is under 350 ms (0.35s)
    assert error_s <= 0.350, f"Reconstructed lap MAE {error_s*1000:.1f}ms exceeds 350ms threshold"

    # Predict quantiles
    q_preds = model.predict_quantiles(test_df)
    assert 0.1 in q_preds and 0.5 in q_preds and 0.9 in q_preds
    # Monotonicity check
    assert np.all(q_preds[0.9] >= q_preds[0.5])
    assert np.all(q_preds[0.5] >= q_preds[0.1])


def test_hybrid_model_save_load(sample_gold_data: pl.DataFrame, tmp_path) -> None:
    """Verify save and load round-trip preserves predictions."""
    features = ["pace_offset_r3", "tyre_age", "stint_no", "compound"]
    model = HybridPaceModel(
        params={"n_estimators": 20, "learning_rate": 0.1, "num_leaves": 10, "verbose": -1},
        categorical_features=["compound"],
    )
    model.fit(sample_gold_data.head(200), None, feature_cols=features)

    save_dir = tmp_path / "hybrid_test"
    model.save(save_dir)
    loaded = HybridPaceModel.load(save_dir)

    test_sub = sample_gold_data.tail(50)
    p_orig = model.predict(test_sub)
    p_load = loaded.predict(test_sub)

    np.testing.assert_allclose(p_orig, p_load, rtol=1e-5)


# ── 3. SectorChainModel Tests ────────────────────────────────────────────────


def test_sector_chain_model(sample_gold_data: pl.DataFrame, tmp_path) -> None:
    """Verify SectorChainModel trains, reconstructs lap time, and serializes."""
    clean_laps = sample_gold_data.filter(
        (pl.col("next_clean_lap_s") - pl.col("lap_time_s")).abs() < 2.0
    )
    train_df = clean_laps.filter(pl.col("lap_number") <= 35)
    test_df = clean_laps.filter(pl.col("lap_number") > 35)

    base_features = ["tyre_age", "stint_no", "lap_number"]
    chain = SectorChainModel(
        params={"n_estimators": 30, "learning_rate": 0.1, "num_leaves": 10, "verbose": -1}
    )
    chain.fit(train_df, None, base_features=base_features)

    # Predict individual sectors
    sec_preds = chain.predict_sectors(test_df)
    assert "s1" in sec_preds and "s2" in sec_preds and "s3" in sec_preds
    assert len(sec_preds["s1"]) == len(test_df)

    # Predict reconstructed lap
    p_lap = chain.predict(test_df)
    expected_sum = sec_preds["s1"] + sec_preds["s2"] + sec_preds["s3"]
    np.testing.assert_allclose(p_lap, expected_sum, rtol=1e-6)

    # Save & load
    save_dir = tmp_path / "sector_chain_test"
    chain.save(save_dir)
    loaded = SectorChainModel.load(save_dir)
    p_load = loaded.predict(test_df)
    np.testing.assert_allclose(p_lap, p_load, rtol=1e-5)
