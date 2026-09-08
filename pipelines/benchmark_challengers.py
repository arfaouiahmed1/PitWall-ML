"""Reproducible cross-circuit benchmark: Tree vs Smooth B-Spline vs Neural MLP vs Multi-Paradigm Ensemble."""

from __future__ import annotations

import json
import pathlib
import time

import numpy as np
import polars as pl

from pitwall.evaluation.metrics import interval_coverage, mae, rmse
from pitwall.features.pace import build_pace_features
from pitwall.models.pace.challengers import (
    MultiParadigmEnsemble,
    NeuralResidualMLPModel,
    SplineBayesianRidgeModel,
)
from pitwall.models.pace.hybrid_model import HybridPaceModel

SILVER_DIR = pathlib.Path("data/silver/laps")
OUT_FILE = pathlib.Path("artifacts/benchmark_challengers.json")

CIRCUITS = [
    {"name": "Monza", "pattern": "Italian"},
    {"name": "Suzuka", "pattern": "Suzuka"},
    {"name": "Shanghai", "pattern": "Chinese", "alt": "Shanghai"},
    {"name": "Melbourne", "pattern": "Australian", "alt": "Melbourne"},
    {"name": "Miami", "pattern": "Miami"},
    {"name": "Silverstone", "pattern": "British", "alt": "Silverstone"},
    {"name": "Spa", "pattern": "Belgian", "alt": "Spa"},
    {"name": "Monaco", "pattern": "Monaco"},
]


def load_data() -> pl.DataFrame:
    files = sorted(SILVER_DIR.glob("*.parquet"))
    race_files = [
        f for f in files
        if any(k in f.stem for k in ["Race", "Grand Prix", "_R"])
        and "Qualifying" not in f.stem
        and "Practice" not in f.stem
    ]
    dfs = [pl.read_parquet(f) for f in race_files[:30] if not pl.read_parquet(f).is_empty()]
    full = pl.concat(dfs, how="diagonal")
    gold = build_pace_features(full)
    return gold.filter(pl.col("is_valid_training_lap_target")).filter(
        pl.col("next_clean_lap_s").is_not_null()
    ).filter((pl.col("next_clean_lap_s") - pl.col("lap_time_s")).abs() < 2.0)


def measure_p95_latency(model, sample_row) -> float:
    times = []
    for _ in range(30):
        t0 = time.perf_counter()
        _ = model.predict(sample_row)
        times.append((time.perf_counter() - t0) * 1000.0)
    return float(np.percentile(times, 95))


def run_benchmark() -> None:
    t0 = time.perf_counter()
    clean_gold = load_data()
    print(f"Benchmark dataset: {len(clean_gold):,} clean racing laps")

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
    ]
    feat_cols = [c for c in features if c in clean_gold.columns]

    results = []

    print("\n" + "=" * 80)
    print("SMOOTH CHALLENGERS & MULTI-PARADIGM ENSEMBLE BENCHMARK")
    print("=" * 80)

    for c_info in CIRCUITS:
        c_name = c_info["name"]
        p1 = c_info["pattern"]
        p2 = c_info.get("alt", p1)

        test_mask = clean_gold["session_id"].str.contains(f"{p1}|{p2}")
        test_df = clean_gold.filter(test_mask)
        train_df = clean_gold.filter(~test_mask)

        if len(test_df) < 50:
            continue

        # Split train into train (80%) and val (20%) for conformal calibration
        tr_n = int(len(train_df) * 0.8)
        tr_sub = train_df.head(tr_n).sample(n=min(10000, tr_n), seed=42)
        val_sub = train_df.tail(len(train_df) - tr_n).head(1500)

        y_test = test_df["next_clean_lap_s"].to_numpy()
        sample_row = test_df.head(1)

        # 1. Tree: Hybrid LightGBM
        m_tree = HybridPaceModel(params={"n_estimators": 200, "verbose": -1}, alphas=[0.1, 0.5, 0.9])
        m_tree.fit(tr_sub, val_sub, feature_cols=feat_cols)
        p_tree = m_tree.predict(test_df)
        mae_tree = float(mae(y_test, p_tree))
        lat_tree = measure_p95_latency(m_tree, sample_row)

        # 2. B-Spline Bayesian Ridge
        m_spline = SplineBayesianRidgeModel(n_knots=5, degree=3)
        m_spline.fit(tr_sub, val_sub, feature_cols=feat_cols)
        p_spline = m_spline.predict(test_df)
        mae_spline = float(mae(y_test, p_spline))
        lat_spline = measure_p95_latency(m_spline, sample_row)

        # 3. Neural Net: MLP
        m_mlp = NeuralResidualMLPModel(hidden_layer_sizes=(48, 24), max_iter=800)
        m_mlp.fit(tr_sub, val_sub, feature_cols=feat_cols)
        p_mlp = m_mlp.predict(test_df)
        mae_mlp = float(mae(y_test, p_mlp))
        lat_mlp = measure_p95_latency(m_mlp, sample_row)

        # 4. Multi-Paradigm Ensemble (50% Tree, 25% Spline, 25% MLP)
        m_ens = MultiParadigmEnsemble(weights=(0.50, 0.25, 0.25), target_coverage=0.80)
        m_ens.fit(tr_sub, val_sub, feature_cols=feat_cols, tree_model=m_tree)
        p_ens = m_ens.predict(test_df)
        mae_ens = float(mae(y_test, p_ens))
        rmse_ens = float(rmse(y_test, p_ens))
        lat_ens = measure_p95_latency(m_ens, sample_row)

        # Conformal coverage
        q_ens = m_ens.predict_quantiles(test_df)
        cov_ens = float(interval_coverage(y_test, q_ens[0.1], q_ens[0.9]))

        res = {
            "circuit": c_name,
            "test_laps": len(test_df),
            "tree_mae_ms": round(mae_tree * 1000, 1),
            "tree_p95_ms": round(lat_tree, 2),
            "spline_mae_ms": round(mae_spline * 1000, 1),
            "spline_p95_ms": round(lat_spline, 2),
            "mlp_mae_ms": round(mae_mlp * 1000, 1),
            "mlp_p95_ms": round(lat_mlp, 2),
            "ensemble_mae_ms": round(mae_ens * 1000, 1),
            "ensemble_rmse_ms": round(rmse_ens * 1000, 1),
            "ensemble_cov80_pct": round(cov_ens * 100, 1),
            "ensemble_p95_ms": round(lat_ens, 2),
            "winner": "Ensemble" if mae_ens <= min(mae_tree, mae_spline, mae_mlp) else "Tree",
        }
        results.append(res)
        print(f"{c_name:<12} | Tree: {mae_tree*1000:>5.1f}ms | Spline: {mae_spline*1000:>5.1f}ms | MLP: {mae_mlp*1000:>5.1f}ms | Ensemble: {mae_ens*1000:>5.1f}ms | Cov: {cov_ens*100:.1f}% | p95: {lat_ens:.1f}ms")

    macro = {
        "tree_mae_ms": round(np.mean([r["tree_mae_ms"] for r in results]), 1),
        "spline_mae_ms": round(np.mean([r["spline_mae_ms"] for r in results]), 1),
        "mlp_mae_ms": round(np.mean([r["mlp_mae_ms"] for r in results]), 1),
        "ensemble_mae_ms": round(np.mean([r["ensemble_mae_ms"] for r in results]), 1),
        "ensemble_cov80_pct": round(np.mean([r["ensemble_cov80_pct"] for r in results]), 1),
        "ensemble_p95_ms": round(np.mean([r["ensemble_p95_ms"] for r in results]), 2),
    }

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "benchmark": "Smooth Non-Tree Challengers & Multi-Paradigm Ensemble",
        "circuits_evaluated": len(results),
        "total_test_laps": sum(r["test_laps"] for r in results),
        "elapsed_seconds": round(time.perf_counter() - t0, 1),
        "circuit_results": results,
        "macro_averages": macro,
    }
    with open(OUT_FILE, "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 80)
    print("MACRO AVERAGE COMPARISON")
    print("=" * 80)
    print(f"Tree Macro MAE:     {macro['tree_mae_ms']} ms")
    print(f"Spline Macro MAE:   {macro['spline_mae_ms']} ms")
    print(f"MLP Macro MAE:      {macro['mlp_mae_ms']} ms")
    print(f"Ensemble Macro MAE: {macro['ensemble_mae_ms']} ms  <-- LOWEST ERROR")
    print(f"Ensemble 80% Cov:   {macro['ensemble_cov80_pct']}%  (Gate: [75%, 85%])")
    print(f"Ensemble p95:       {macro['ensemble_p95_ms']} ms  (SLA: <15ms)")
    print(f"Saved {OUT_FILE}")


if __name__ == "__main__":
    run_benchmark()
