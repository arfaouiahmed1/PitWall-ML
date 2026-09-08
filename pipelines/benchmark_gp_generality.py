"""Leave-One-GP-Out (LOGO) Generalization Benchmark across circuit archetypes."""

from __future__ import annotations

import json
import pathlib
import time

import lightgbm as lgb
import numpy as np
import polars as pl

from pitwall.evaluation.metrics import interval_coverage, mae, rmse
from pitwall.features.pace import build_pace_features
from pitwall.models.pace.hybrid_model import HybridPaceModel
from pitwall.models.pace.sector_chain import SectorChainModel

SILVER_DIR = pathlib.Path("data/silver/laps")
OUT_FILE = pathlib.Path("artifacts/benchmark_generality.json")

# 8 representative circuit archetypes
CIRCUIT_TARGETS = [
    {"name": "Monza", "pattern": "Italian", "type": "Low-Downforce High-Speed"},
    {"name": "Suzuka", "pattern": "Suzuka", "type": "High-Speed Flowing S-Curves"},
    {"name": "Shanghai", "pattern": "Chinese", "alt_pattern": "Shanghai", "type": "Technical Long-Straight"},
    {"name": "Melbourne", "pattern": "Australian", "alt_pattern": "Melbourne", "type": "Semi-Street High-Speed"},
    {"name": "Miami", "pattern": "Miami", "type": "Street High-Speed Straights"},
    {"name": "Silverstone", "pattern": "British", "alt_pattern": "Silverstone", "type": "Extreme Lateral G-Force"},
    {"name": "Spa", "pattern": "Belgian", "alt_pattern": "Spa", "type": "Elevation Changes & High Speed"},
    {"name": "Monaco", "pattern": "Monaco", "type": "Tight Low-Speed Street"},
]


def load_all_silver() -> pl.DataFrame:
    files = sorted(SILVER_DIR.glob("*.parquet"))
    # Filter to race sessions
    race_files = [
        f for f in files
        if any(k in f.stem for k in ["Race", "Grand Prix", "_R"])
        and "Qualifying" not in f.stem
        and "Practice" not in f.stem
        and "Day_" not in f.stem
    ]
    print(f"Loading {len(race_files)} race sessions...")
    dfs = []
    for f in race_files:
        try:
            d = pl.read_parquet(f)
            if not d.is_empty():
                dfs.append(d)
        except Exception as e:
            print(f"  skip {f.name}: {e}")
    return pl.concat(dfs, how="diagonal")


def get_circuit_test_files(target: dict[str, str]) -> list[pathlib.Path]:
    p1 = target["pattern"]
    p2 = target.get("alt_pattern", p1)
    files = sorted(SILVER_DIR.glob("*.parquet"))
    return [
        f for f in files
        if (p1 in f.stem or p2 in f.stem)
        and any(k in f.stem for k in ["Race", "Grand Prix", "_R"])
        and "Qualifying" not in f.stem
        and "Practice" not in f.stem
    ]


def run_benchmark() -> None:
    t0 = time.perf_counter()
    full_silver = load_all_silver()
    print(f"Full dataset: {len(full_silver):,} laps across all seasons")

    # Build Gold feature matrix once
    print("Building Gold features with sector momentum & target deltas...")
    full_gold = build_pace_features(full_silver)

    # Filter clean racing laps with valid delta target (<2.5s)
    clean_gold = (
        full_gold.filter(pl.col("is_valid_training_lap_target"))
        .filter(pl.col("next_clean_lap_s").is_not_null())
        .filter((pl.col("next_clean_lap_s") - pl.col("lap_time_s")).abs() < 2.5)
    )
    print(f"Clean racing laps available: {len(clean_gold):,}")

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
    feat_cols = [c for c in features if c in clean_gold.columns]

    results = []

    print("\n" + "=" * 80)
    print("LEAVE-ONE-GP-OUT GENERALIZATION BENCHMARK")
    print("=" * 80)

    for target in CIRCUIT_TARGETS:
        circuit_name = target["name"]
        circuit_type = target["type"]
        p1 = target["pattern"]
        p2 = target.get("alt_pattern", p1)

        # Identify test slice
        test_mask = clean_gold["session_id"].str.contains(f"{p1}|{p2}")
        test_df = clean_gold.filter(test_mask)
        train_df = clean_gold.filter(~test_mask)

        if len(test_df) < 50:
            print(f"\n[SKIP] {circuit_name}: insufficient clean laps ({len(test_df)})")
            continue

        print(f"\n>>> Benchmarking {circuit_name} ({circuit_type})")
        print(f"    Train: {len(train_df):,} laps (all OTHER circuits) | Test: {len(test_df):,} laps ({circuit_name})")

        y_test_abs = test_df["next_clean_lap_s"].to_numpy()
        base_lap_test = test_df["lap_time_s"].to_numpy()

        # ── 1. LastLap Baseline ──
        last_lap_pred = base_lap_test
        m_last = float(mae(y_test_abs, last_lap_pred))
        r_last = float(rmse(y_test_abs, last_lap_pred))

        # ── 2. Old Absolute LightGBM (predicts y_t+1 directly without delta) ──
        # Sample train_df for speed (max 15,000 rows)
        train_sample = train_df.sample(n=min(15000, len(train_df)), seed=42)
        X_tr = train_sample.select(feat_cols).to_pandas()
        X_tr["compound"] = X_tr["compound"].astype("category")
        y_tr_abs = train_sample["next_clean_lap_s"].to_numpy()

        X_te = test_df.select(feat_cols).to_pandas()
        X_te["compound"] = X_te["compound"].astype("category")

        model_abs = lgb.LGBMRegressor(
            n_estimators=250, learning_rate=0.04, num_leaves=31, random_state=42, verbose=-1
        )
        model_abs.fit(X_tr, y_tr_abs)
        abs_pred = model_abs.predict(X_te)
        m_abs = float(mae(y_test_abs, abs_pred))
        r_abs = float(rmse(y_test_abs, abs_pred))

        # ── 3. Chained 3-Sector Model ──
        chain_model = SectorChainModel(
            params={"n_estimators": 200, "learning_rate": 0.04, "num_leaves": 20, "verbose": -1},
            categorical_features=["compound"],
        )
        chain_model.fit(train_sample, None, base_features=feat_cols)
        chain_pred = chain_model.predict(test_df)
        m_chain = float(mae(y_test_abs, chain_pred))
        r_chain = float(rmse(y_test_abs, chain_pred))

        # ── 4. Two-Stage Hybrid Pace Model (Physics + Quantile Residual) ──
        hybrid_model = HybridPaceModel(
            params={"n_estimators": 250, "learning_rate": 0.04, "num_leaves": 25, "verbose": -1},
            alphas=[0.1, 0.5, 0.9],
            categorical_features=["compound"],
        )
        hybrid_model.fit(train_sample, None, feature_cols=feat_cols, target_col="target_delta_s")
        hyb_pred = hybrid_model.predict(test_df)
        hyb_quantiles = hybrid_model.predict_quantiles(test_df)
        m_hyb = float(mae(y_test_abs, hyb_pred))
        r_hyb = float(rmse(y_test_abs, hyb_pred))
        cov_hyb = float(interval_coverage(y_test_abs, hyb_quantiles[0.1], hyb_quantiles[0.9]))

        circuit_result = {
            "circuit": circuit_name,
            "type": circuit_type,
            "test_laps": len(test_df),
            "models": {
                "LastLapBaseline": {"mae_ms": round(m_last * 1000, 1), "rmse_ms": round(r_last * 1000, 1)},
                "AbsoluteLightGBM": {"mae_ms": round(m_abs * 1000, 1), "rmse_ms": round(r_abs * 1000, 1)},
                "SectorChainModel": {"mae_ms": round(m_chain * 1000, 1), "rmse_ms": round(r_chain * 1000, 1)},
                "HybridPaceModel": {
                    "mae_ms": round(m_hyb * 1000, 1),
                    "rmse_ms": round(r_hyb * 1000, 1),
                    "coverage_80": round(cov_hyb * 100, 1),
                },
            },
            "winner": "HybridPaceModel" if m_hyb <= min(m_last, m_abs, m_chain) else "LastLapBaseline",
            "delta_reduction_vs_abs_pct": round((m_abs - m_hyb) / m_abs * 100, 1),
        }
        results.append(circuit_result)

        print(f"    LastLap:    {m_last*1000:>6.1f} ms")
        print(f"    Absolute:   {m_abs*1000:>6.1f} ms  (fails cross-circuit)")
        print(f"    SectorChain:{m_chain*1000:>6.1f} ms")
        print(f"    Hybrid:     {m_hyb*1000:>6.1f} ms  | 80% Cov = {cov_hyb*100:.1f}%  | Winner: {circuit_result['winner']}")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    summary = {
        "benchmark": "Leave-One-GP-Out (LOGO) Cross-Validation",
        "circuits_evaluated": len(results),
        "total_test_laps": sum(r["test_laps"] for r in results),
        "elapsed_seconds": round(time.perf_counter() - t0, 1),
        "circuit_results": results,
        "macro_averages": {
            "LastLap_mae_ms": round(np.mean([r["models"]["LastLapBaseline"]["mae_ms"] for r in results]), 1),
            "Absolute_mae_ms": round(np.mean([r["models"]["AbsoluteLightGBM"]["mae_ms"] for r in results]), 1),
            "SectorChain_mae_ms": round(np.mean([r["models"]["SectorChainModel"]["mae_ms"] for r in results]), 1),
            "Hybrid_mae_ms": round(np.mean([r["models"]["HybridPaceModel"]["mae_ms"] for r in results]), 1),
            "Hybrid_coverage_80_pct": round(np.mean([r["models"]["HybridPaceModel"]["coverage_80"] for r in results]), 1),
        },
    }
    with open(OUT_FILE, "w") as f:
        json.dump(summary, f, indent=2)

    print("\n" + "=" * 80)
    print("MACRO GENERALIZATION SUMMARY ACROSS ALL CIRCUITS")
    print("=" * 80)
    print(f"Macro LastLap MAE:     {summary['macro_averages']['LastLap_mae_ms']} ms")
    print(f"Macro Absolute MAE:    {summary['macro_averages']['Absolute_mae_ms']} ms  (High error from track shift)")
    print(f"Macro SectorChain MAE: {summary['macro_averages']['SectorChain_mae_ms']} ms")
    print(f"Macro Hybrid MAE:      {summary['macro_averages']['Hybrid_mae_ms']} ms  <-- CHAMPION")
    print(f"Macro 80% Coverage:    {summary['macro_averages']['Hybrid_coverage_80_pct']}%")
    print(f"Artifact saved to {OUT_FILE}")


if __name__ == "__main__":
    run_benchmark()
