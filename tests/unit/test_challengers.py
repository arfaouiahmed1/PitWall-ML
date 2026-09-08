"""Unit tests for the circuit-adaptive dual-paradigm router and normalized conformal calibration."""

from __future__ import annotations

import time

import numpy as np
import polars as pl
import pytest

from pitwall.evaluation.metrics import interval_coverage, mae
from pitwall.features.pace import build_pace_features
from pitwall.models.pace.challengers import (
    CircuitAdaptivePaceRouter,
    NormalizedConformalCalibrator,
    SplineBayesianRidgeModel,
    SplitConformalPredictor,
    is_spline_circuit,
    normalize_circuit_key,
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


def test_normalized_conformal_scales_with_local_difficulty() -> None:
    """Heteroscedastic groups get widths proportional to local sigma, ~80% cover."""
    rng = np.random.default_rng(7)
    # Low-variance group (sigma 0.15) and high-variance group (sigma 0.60)
    n_lo, n_hi = 400, 400
    y_lo = rng.normal(85.0, 0.15, n_lo)
    y_hi = rng.normal(85.0, 0.60, n_hi)
    y_val = np.concatenate([y_lo, y_hi])
    pred_val = y_val + np.concatenate([
        rng.normal(0.0, 0.15, n_lo), rng.normal(0.0, 0.60, n_hi),
    ])
    sigma_val = np.concatenate([np.full(n_lo, 0.15), np.full(n_hi, 0.60)])

    cal = NormalizedConformalCalibrator(target_coverage=0.80)
    cal.fit(y_val, pred_val, sigma_val=sigma_val)
    assert cal.q_norm_ is not None and cal.q_norm_ > 0.0

    y_test = np.concatenate([rng.normal(85.0, 0.15, 300), rng.normal(85.0, 0.60, 300)])
    pred_test = y_test + np.concatenate([
        rng.normal(0.0, 0.15, 300), rng.normal(0.0, 0.60, 300),
    ])
    sigma_test = np.concatenate([np.full(300, 0.15), np.full(300, 0.60)])
    q10, q90 = cal.predict_intervals(pred_test, sigma_test)
    cov = interval_coverage(y_test, q10, q90)
    assert 0.75 <= cov <= 0.85, f"Normalized coverage {cov*100:.1f}% outside [75%, 85%]"

    widths = q90 - q10
    assert widths[300:].mean() > 2.0 * widths[:300].mean(), "High-sigma band must be wider"


def test_circuit_regime_predicates() -> None:
    assert normalize_circuit_key("2026_British Grand Prix_R") == "2026_british grand prix_r"
    assert is_spline_circuit("Silverstone")
    assert is_spline_circuit("2026_British Grand Prix_R")
    assert is_spline_circuit("Suzuka")
    assert not is_spline_circuit("Monza")
    assert not is_spline_circuit("2026_Italian Grand Prix_R")
    assert not is_spline_circuit(None)


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


def test_router_routes_by_regime_and_blends_unknown(sample_clean_laps: pl.DataFrame) -> None:
    """Spline circuits use the spline leg, tree circuits the tree leg, unknown blends 70/30."""
    train_df = sample_clean_laps.filter(pl.col("lap_number") <= 28)
    val_df = sample_clean_laps.filter((pl.col("lap_number") > 28) & (pl.col("lap_number") <= 38))
    test_df = sample_clean_laps.filter(pl.col("lap_number") > 38).head(20)
    features = ["pace_offset_r3", "speed_fl_delta", "tyre_age", "lap_number"]

    hyb = HybridPaceModel(params={"n_estimators": 50, "verbose": -1}, alphas=[0.1, 0.5, 0.9])
    hyb.fit(train_df, val_df, feature_cols=features)
    router = CircuitAdaptivePaceRouter(target_coverage=0.80)
    router.fit(train_df, val_df, feature_cols=features, tree_model=hyb)

    p_tree = hyb.predict(test_df)
    p_spline = router.spline_model.predict(test_df)

    p_monza = router.predict(test_df, circuit="2026_Italian Grand Prix_R")
    np.testing.assert_allclose(p_monza, p_tree, rtol=1e-8)
    p_silver = router.predict(test_df, circuit="Silverstone")
    np.testing.assert_allclose(p_silver, p_spline, rtol=1e-8)
    p_unknown = router.predict(test_df, circuit="demo")
    np.testing.assert_allclose(p_unknown, 0.70 * p_tree + 0.30 * p_spline, rtol=1e-8)


def test_router_coverage_latency_and_persistence(sample_clean_laps: pl.DataFrame, tmp_path) -> None:
    """Router hits sub-350ms MAE, [75%, 85%] normalized coverage, sub-15ms p95, round-trips."""
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

    hyb = HybridPaceModel(params={"n_estimators": 100, "verbose": -1}, alphas=[0.1, 0.5, 0.9])
    hyb.fit(train_df, val_df, feature_cols=features)
    router = CircuitAdaptivePaceRouter(target_coverage=0.80)
    router.fit(train_df, val_df, feature_cols=features, tree_model=hyb)

    preds = router.predict(test_df)
    y_true = test_df["next_clean_lap_s"].to_numpy()
    err_ms = mae(y_true, preds) * 1000.0
    assert err_ms <= 350.0, f"Router MAE {err_ms:.1f}ms exceeds 350ms gate"

    q_all = router.predict_quantiles(test_df)
    cov = interval_coverage(y_true, q_all[0.1], q_all[0.9])
    assert 0.75 <= cov <= 0.85, f"Normalized coverage {cov*100:.1f}% outside [75%, 85%] gate"

    save_dir = tmp_path / "adaptive_router"
    router.save(save_dir)
    loaded = CircuitAdaptivePaceRouter.load(save_dir)
    np.testing.assert_allclose(loaded.predict(test_df), preds, rtol=1e-5)

    latencies = []
    sample_row = test_df.head(1)
    for _ in range(50):
        t0 = time.perf_counter()
        _ = router.predict(sample_row)
        latencies.append((time.perf_counter() - t0) * 1000.0)
    p95 = float(np.percentile(latencies, 95))
    assert p95 < 15.0, f"Latency p95 {p95:.2f}ms exceeds 15ms SLA"
