"""Unit tests for non-tree smooth challengers, split conformal calibration, and multi-paradigm ensemble."""

from __future__ import annotations

import time

import numpy as np
import polars as pl
import pytest

from pitwall.evaluation.metrics import interval_coverage, mae
from pitwall.features.pace import build_pace_features
from pitwall.models.pace.challengers import (
    MultiParadigmEnsemble,
    NeuralResidualMLPModel,
    SplineBayesianRidgeModel,
    SplitConformalPredictor,
)
from pitwall.models.pace.hybrid_model import HybridPaceModel


@pytest.fixture
def sample_clean_laps() -> pl.DataFrame:
    df = pl.read_parquet("data/silver/laps/2026_Italian Grand Prix_R.parquet")
    gold = build_pace_features(df).filter(pl.col("is_valid_training_lap_target")).filter(
        pl.col("next_clean_lap_s").is_not_null()
    )
    return gold.filter((pl.col("next_clean_lap_s") - pl.col("lap_time_s")).abs() < 2.0)


def test_split_conformal_predictor() -> None:
    """Verify split conformal prediction achieves exact finite-sample coverage."""
    rng = np.random.default_rng(42)
    # Synthetic validation set (n=200) and test set (n=300)
    y_val = rng.normal(85.0, 1.0, 200)
    y_pred_val = y_val + rng.normal(0.0, 0.25, 200)

    calibrator = SplitConformalPredictor(target_coverage=0.80)
    calibrator.fit(y_val, y_pred_val)
    assert calibrator.q_hat_ is not None and calibrator.q_hat_ > 0.0

    y_test = rng.normal(85.0, 1.0, 300)
    y_pred_test = y_test + rng.normal(0.0, 0.25, 300)
    q10, q90 = calibrator.predict_intervals(y_pred_test)

    cov = interval_coverage(y_test, q10, q90)
    # Conformal guarantee under exchangeability: coverage >= 1 - alpha - epsilon
    assert 0.75 <= cov <= 0.85, f"Coverage {cov*100:.1f}% outside 80% tolerance"


def test_spline_bayesian_ridge(sample_clean_laps: pl.DataFrame, tmp_path) -> None:
    """Verify B-Spline + BayesianRidge fits, predicts, and serializes."""
    train_df = sample_clean_laps.filter(pl.col("lap_number") <= 35)
    test_df = sample_clean_laps.filter(pl.col("lap_number") > 35)
    features = ["pace_offset_r3", "speed_fl_delta", "tyre_age", "lap_number"]

    model = SplineBayesianRidgeModel(n_knots=4, degree=3)
    model.fit(train_df, None, feature_cols=features)

    preds = model.predict(test_df)
    y_true = test_df["next_clean_lap_s"].to_numpy()
    err_s = mae(y_true, preds)
    assert err_s < 0.400, f"Spline MAE {err_s*1000:.1f}ms exceeds 400ms"

    # Save & Load round-trip
    save_dir = tmp_path / "spline_model"
    model.save(save_dir)
    loaded = SplineBayesianRidgeModel.load(save_dir)
    p_load = loaded.predict(test_df)
    np.testing.assert_allclose(preds, p_load, rtol=1e-5)


def test_neural_residual_mlp_convergence(sample_clean_laps: pl.DataFrame) -> None:
    """Verify MLP converges cleanly without reaching max_iter."""
    train_df = sample_clean_laps.filter(pl.col("lap_number") <= 35)
    test_df = sample_clean_laps.filter(pl.col("lap_number") > 35)
    features = ["pace_offset_r3", "speed_fl_delta", "tyre_age", "lap_number"]

    mlp = NeuralResidualMLPModel(hidden_layer_sizes=(32, 16), max_iter=800)
    mlp.fit(train_df, None, feature_cols=features)

    # Check optimizer converged well before max_iter
    mlp_step = mlp.pipeline.named_steps["mlp"]
    assert mlp_step.n_iter_ < 800, f"MLP did not converge! Used {mlp_step.n_iter_} iterations"

    preds = mlp.predict(test_df)
    y_true = test_df["next_clean_lap_s"].to_numpy()
    err_s = mae(y_true, preds)
    assert err_s < 0.450, f"MLP MAE {err_s*1000:.1f}ms exceeds 450ms"


def test_multi_paradigm_ensemble_and_latency(sample_clean_laps: pl.DataFrame) -> None:
    """Verify MultiParadigmEnsemble achieves sub-350ms MAE, 80% coverage, and sub-15ms latency."""
    train_df = sample_clean_laps.filter(pl.col("lap_number") <= 28)
    val_df = sample_clean_laps.filter((pl.col("lap_number") > 28) & (pl.col("lap_number") <= 38))
    test_df = sample_clean_laps.filter(pl.col("lap_number") > 38)
    features = [
        "pace_offset_r3",
        "speed_fl_delta",
        "speed_i1_delta",
        "speed_i2_delta",
        "s1_delta",
        "s2_delta",
        "s3_delta",
        "tyre_age",
        "lap_number",
    ]

    # 1. Fit hybrid tree
    hyb = HybridPaceModel(params={"n_estimators": 100, "verbose": -1}, alphas=[0.1, 0.5, 0.9])
    hyb.fit(train_df, val_df, feature_cols=features)

    # 2. Fit ensemble
    ensemble = MultiParadigmEnsemble(weights=(0.50, 0.25, 0.25), target_coverage=0.80)
    ensemble.fit(train_df, val_df, feature_cols=features, tree_model=hyb)

    # 3. Predict on test
    preds = ensemble.predict(test_df)
    y_true = test_df["next_clean_lap_s"].to_numpy()
    err_ms = mae(y_true, preds) * 1000.0
    assert err_ms <= 350.0, f"Ensemble MAE {err_ms:.1f}ms exceeds 350ms gate"

    # 4. Conformal coverage
    q_all = ensemble.predict_quantiles(test_df)
    cov = interval_coverage(y_true, q_all[0.1], q_all[0.9])
    assert 0.75 <= cov <= 0.85, f"Calibrated coverage {cov*100:.1f}% outside [75%, 85%] gate"

    # 5. Measure latency
    latencies = []
    sample_row = test_df.head(1)
    for _ in range(50):
        t0 = time.perf_counter()
        _ = ensemble.predict(sample_row)
        latencies.append((time.perf_counter() - t0) * 1000.0)
    p95 = np.percentile(latencies, 95)
    assert p95 < 15.0, f"Latency p95 {p95:.2f}ms exceeds 15ms SLA"
