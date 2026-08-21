"""V2 integration smoke — quantile/tyre/pit/simulator/registry/shap."""

import numpy as np
import polars as pl
import pytest


def _synthetic_silver(n_sessions=2, laps=12):
    rows = []
    for s in range(n_sessions):
        for d in [1, 44]:
            pit = 7
            for lap in range(1, laps + 1):
                is_second = lap >= pit
                tyre_age = (lap - pit) if is_second else lap - 1
                compound = "HARD" if is_second else "MEDIUM"
                stint = 2 if is_second else 1
                rows.append(
                    {
                        "session_id": f"2024_R{s}",
                        "driver_number": d,
                        "lap_number": lap,
                        "lap_time_s": 90 + tyre_age * 0.07 + np.random.normal(0, 0.3),
                        "compound": compound,
                        "tyre_age": tyre_age,
                        "stint_no": stint,
                        "position": 1,
                        "is_valid_training_lap": True,
                        "track_temp_c": 35.0,
                    }
                )
    return pl.DataFrame(rows)


def test_quantile_monotonic():
    from pitwall.features.pace import build_pace_features, get_feature_columns
    from pitwall.models.pace.lightgbm_model import QuantileLightGBM

    silver = _synthetic_silver(n_sessions=3, laps=15)
    gold = build_pace_features(silver)
    cols = get_feature_columns(gold)
    # need at least some valid rows
    train = gold.head(30)
    valid = gold.slice(30, 10)
    # if not enough valid target, skip
    if (
        "next_clean_lap_s" not in train.columns
        or train.filter(pl.col("is_valid_training_lap_target")).is_empty()
    ):
        return
    train = train.filter(pl.col("is_valid_training_lap_target"))
    valid = valid.filter(pl.col("is_valid_training_lap_target")) if not valid.is_empty() else None
    if len(train) < 10:
        return
    m = QuantileLightGBM(alphas=[0.1, 0.5, 0.9], base_params={"n_estimators": 10, "num_leaves": 4})
    m.fit(train, valid if valid is not None and not valid.is_empty() else None, feature_cols=cols)
    preds = m.predict(train.head(5))
    assert 0.1 in preds and 0.5 in preds and 0.9 in preds
    # monotonic per sample
    for i in range(5):
        assert preds[0.1][i] <= preds[0.5][i] + 1e-6
        assert preds[0.5][i] <= preds[0.9][i] + 1e-6


def test_tyre_features_and_model():
    from pitwall.features.tyre import build_tyre_features, get_tyre_feature_columns
    from pitwall.models.tyre.lightgbm_tyre import TyreLightGBM

    silver = _synthetic_silver()
    gold = build_tyre_features(silver)
    assert "tyre_deg_s" in gold.columns
    assert "is_valid_tyre_row" in gold.columns
    cols = get_tyre_feature_columns(gold)
    assert "tyre_age" in cols
    # train smoke
    train = gold.filter(pl.col("is_valid_tyre_row")).head(20)
    if len(train) < 5:
        return
    m = TyreLightGBM(params={"n_estimators": 5, "num_leaves": 4})
    # need at least 5 rows and feature cols present
    valid = gold.filter(pl.col("is_valid_tyre_row")).slice(20, 5)
    m.fit(train, valid if not valid.is_empty() else None, feature_cols=cols)
    pred = m.predict(train.head(2))
    assert len(pred) == 2
    assert np.all(np.isfinite(pred))


def test_pit_features_and_model():
    from pitwall.features.pit import build_pit_features, get_pit_feature_columns
    from pitwall.models.pit.lightgbm_pit import PitHazardLightGBM

    silver = _synthetic_silver(laps=15)
    gold = build_pit_features(silver, horizon=3)
    assert "pit_in_next_3" in gold.columns
    assert gold["pit_in_next_3"].is_in([0, 1]).all()
    cols = get_pit_feature_columns(gold)
    assert "tyre_age" in cols
    train = gold.filter(pl.col("is_valid_pit_row")).head(20)
    if len(train) < 6 or train["pit_in_next_3"].n_unique() < 2:
        # need both classes
        return
    m = PitHazardLightGBM(params={"n_estimators": 5, "num_leaves": 4})
    valid = gold.filter(pl.col("is_valid_pit_row")).slice(20, 5)
    m.fit(train, valid if not valid.is_empty() else None, feature_cols=cols)
    prob = m.predict_proba(train.head(3))
    assert len(prob) == 3
    assert np.all((prob >= 0) & (prob <= 1))


def test_simulator_win_prob_sum():
    from pitwall.simulation.engine import DriverStateSim, simulate_race

    drivers = [
        DriverStateSim(driver_id="1", position=1, current_time_s=0, tyre_age=3),
        DriverStateSim(driver_id="44", position=2, current_time_s=1.0, tyre_age=8),
        DriverStateSim(driver_id="63", position=3, current_time_s=2.5, tyre_age=2),
    ]
    res = simulate_race(drivers, n_simulations=10, laps_remaining=5, seed=0)
    assert abs(sum(res["win_prob"].values()) - 1.0) < 1e-6
    assert sum(res["podium_prob"].values()) == pytest.approx(3.0, abs=1e-6)
    # win_prob dict has all drivers
    assert set(res["win_prob"].keys()) == {"1", "44", "63"}
    # expected_position between 1 and 3
    for v in res["expected_position"].values():
        assert 1 <= v <= 3


def test_promotion_gates():
    from pitwall.registry.promotion import evaluate_pace_promotion

    champ = {"mae": 0.50, "coverage_80": 0.81, "p95_ms": 20}
    chall_pass = {"mae": 0.48, "coverage_80": 0.82, "p95_ms": 25}  # 4% better
    chall_fail = {"mae": 0.51, "coverage_80": 0.82, "p95_ms": 25}  # worse

    res_pass = evaluate_pace_promotion(champ, chall_pass)
    assert res_pass["passed"] is True
    res_fail = evaluate_pace_promotion(champ, chall_fail)
    assert res_fail["passed"] is False
    assert any("MAE" in r for r in res_fail["reasons"])


def test_shap_fallback():
    from pitwall.explain.shap_utils import compute_shap_summary

    # create tiny LGBM model wrapper stub with feature_importances_
    class Stub:
        def __init__(self):
            self.feature_importances_ = np.array([10, 5, 1])
            self.model = self

    stub = Stub()
    df = pl.DataFrame({"a": [1, 2, 3], "b": [4, 5, 6], "c": [7, 8, 9]})
    # will go to shap fallback if shap not installed, else shap path; both should return dict
    summary = compute_shap_summary(stub, df, ["a", "b", "c"], sample_n=3)
    assert isinstance(summary, dict)
    assert set(summary.keys()) <= {"a", "b", "c"}
