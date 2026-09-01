"""2026 training pipeline — trains all 2026 models on real F1 timing data.

Implements the user's redesigned data strategy:
  1. Bronze raw data from OpenF1 (car_data, location, intervals, overtakes, etc.)
  2. Silver synchronized tables (lap-level features + telemetry)
  3. Gold ML-ready feature tables (battle_state, energy_behaviour, car_performance)
  4. Train models: Overtake Probability, Energy Behaviour, Clean Pace

Every training label comes from an observed 2026 event — no synthetic data.

Usage:
    python pipelines/train_2026.py --silver-dir data/silver/laps
    python pipelines/train_2026.py --bronze-dir data/bronze
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import polars as pl

from pitwall.evaluation.splits import apply_split, chronological_race_split
from pitwall.features.energy import EnergyStateEstimator
from pitwall.features.pace import build_pace_features, get_feature_columns
from pitwall.features.sync_2026 import (
    build_gold_battle_state,
    build_gold_car_performance,
    build_gold_clean_pace,
    build_gold_energy_labels,
    build_silver_laps,
)
from pitwall.models.overtake.model import OvertakeOpportunityModel


def load_silver(args: argparse.Namespace) -> tuple[pl.DataFrame, str]:
    """Load silver data from either existing silver directory or Bronze."""
    bronze_dir = Path(args.bronze_dir)

    if args.silver_dir:
        silver_path = Path(args.silver_dir)
        if silver_path.exists():
            print(f"[1/5] Loading Silver from {silver_path}")
            files = list(silver_path.rglob("*.parquet"))
            silver = pl.read_parquet(files)
            if args.max_rows:
                silver = silver.head(args.max_rows)
            print(f"  Loaded {len(silver)} rows from {len(files)} files")
            return silver, "existing_fastf1"
        print(f"  Silver dir {silver_path} not found")

    if bronze_dir.exists() and list(bronze_dir.rglob("laps.parquet")):
        print(f"[1/5] Building Silver from Bronze ({bronze_dir})")
        silver = build_silver_laps(str(bronze_dir))
        print(f"  Built {len(silver)} silver lap rows")
        return silver, "openf1_bronze"

    print("[1/5] No data found. Provide --silver-dir or --bronze-dir.")
    print("      Ingest 2026 data first via OpenF1 ingestion client.")
    sys.exit(1)


def derive_clean_pace_labels(silver: pl.DataFrame) -> pl.DataFrame:
    """Ensure clean-pace labels exist on the silver DataFrame."""
    if "is_valid_training_lap" in silver.columns:
        return silver

    silver = silver.with_columns(
        [
            _expr_or_lit(silver, "is_pit_in", False, pl.Boolean).alias("is_pit_in"),
        ]
    )

    if "track_status" in silver.columns:
        silver = silver.with_columns(
            pl.col("track_status")
            .str.to_lowercase()
            .str.contains("sc|vsc|safety")
            .fill_null(False)
            .alias("sc_vsc"),
        )
    else:
        silver = silver.with_columns(pl.lit(False).alias("sc_vsc"))

    silver = silver.with_columns(
        is_valid_training_lap=(
            ~pl.col("is_pit_in")
            & ~pl.col("sc_vsc")
            & pl.col("lap_time_s").is_not_null()
            & (pl.col("lap_time_s") > 30)
        ),
    )
    return silver


def _expr_or_lit(df: pl.DataFrame, col: str, fill_val, dtype) -> pl.Expr:
    """Return a column expression or a literal if column missing."""
    if col in df.columns:
        if dtype == pl.Boolean:
            return pl.col(col).fill_null(fill_val)
        return pl.col(col)
    return pl.lit(fill_val)


def train_overtake_model(bronze_dir: Path, gold_dir: Path, output_dir: Path) -> dict:
    """Train the Overtake Probability model on real battle data."""
    pos_files = list(bronze_dir.rglob("position.parquet"))
    if not pos_files:
        print("  No position data — skipping overtake model")
        return {}

    battle_state = build_gold_battle_state(str(bronze_dir))
    if battle_state.is_empty():
        print("  Empty battle state — skipping overtake model")
        return {}

    battle_state.write_parquet(str(gold_dir / "battle_state.parquet"))
    print(f"  Gold battle state: {battle_state.shape}")

    # Find available label columns
    possible_labels = ["overtake_30s", "overtake_60s", "overtake_120s"]
    label_cols = [c for c in possible_labels if c in battle_state.columns]
    if not label_cols:
        print("  No overtake labels — skipping")
        return {}

    target = label_cols[0]

    # Temporal split by session
    sessions = battle_state["session_key"].unique().sort().to_list()
    if len(sessions) >= 3:
        n = max(1, len(sessions) // 5)
        splits = chronological_race_split(
            battle_state.with_columns(pl.col("session_key").cast(pl.Utf8)),
            n_test_races=n,
            n_val_races=n,
        )
    else:
        splits = {
            "train": sessions[:-1],
            "validation": [],
            "test": [sessions[-1]],
        }

    train_df = apply_split(battle_state, splits["train"])
    val_list = splits.get("validation", [])
    valid_df = apply_split(battle_state, val_list) if val_list else None
    test_df = apply_split(battle_state, splits["test"])

    pos = train_df.filter(pl.col(target) == 1).height
    neg = train_df.filter(pl.col(target) == 0).height
    print(f"  Train: {len(train_df)} rows (pos={pos}, neg={neg})")

    metrics: dict = {}
    if pos < 10 or neg < 10:
        print(f"  Skipping: too few samples (pos={pos}, neg={neg})")
        return metrics

    model = OvertakeOpportunityModel(seed=42)
    model.fit(train_df, valid_df, target_col=target)

    if not test_df.is_empty():
        metrics = _evaluate_overtake_model(model, test_df, target)
        print(f"  AUC={metrics.get('overtake_auc', '?')}  AP={metrics.get('overtake_ap', '?')}")

    model.save(output_dir / "model_overtake")
    print(f"  Saved → {output_dir / 'model_overtake'}")
    return metrics


def _evaluate_overtake_model(
    model: OvertakeOpportunityModel, test_df: pl.DataFrame, target: str
) -> dict:
    """Evaluate the overtake model on the test set."""
    from sklearn.metrics import average_precision_score, roc_auc_score

    y_test = test_df[target].to_numpy()
    if not model._models or target not in model._models:
        return {}

    # Build feature matrix from test data
    feature_cols = [c for c in model._feature_cols if c in test_df.columns]
    X = test_df.select(feature_cols).to_pandas()
    for c in model._cat_cols:
        if c in X.columns:
            X[c] = X[c].astype("category")

    lr_model = model._models[target]
    y_pred = lr_model.predict_proba(X)[:, 1]

    has_both = len(set(y_test)) > 1
    auc = roc_auc_score(y_test, y_pred) if has_both else 0.5
    ap = average_precision_score(y_test, y_pred) if has_both else 0.5

    return {
        "overtake_auc": round(float(auc), 4),
        "overtake_ap": round(float(ap), 4),
        "overtake_pos_rate": round(float(y_test.mean()), 4),
    }


def train_energy_model(bronze_dir: Path, output_dir: Path) -> dict:
    """Train the Energy Management Behaviour model on real telemetry."""
    tele_files = list(bronze_dir.rglob("car_data.parquet"))
    if not tele_files:
        print("  No telemetry data — skipping energy model")
        return {}

    tele = pl.concat(
        [pl.read_parquet(str(f)) for f in tele_files],
        how="vertical_relaxed",
    )

    # Also load segment-level energy labels
    energy_labels = build_gold_energy_labels(str(bronze_dir))

    estimator = EnergyStateEstimator(seed=42)
    segment_df = energy_labels if not energy_labels.is_empty() else None
    estimator.fit(telemetry_df=tele, segment_df=segment_df)

    estimator.save(output_dir / "model_energy")

    metrics: dict = {
        "soc_model_trained": estimator._lgb_model is not None,
        "deploy_model_trained": estimator._deploy_model is not None,
    }

    # Sample estimation
    if not tele.is_empty():
        row = tele.row(0, named=True)
        est = estimator.estimate(
            driver_number=int(row.get("driver_number", 1)),
            speed=row.get("speed", 200),
            throttle=row.get("throttle", 0.7),
            braking=row.get("brake", 0),
            rpm=row.get("rpm", 10000),
            gear=row.get("gear", 5),
        )
        soc = est.battery_soc_percent
        print(f"  Sample estimate: SoC={soc}% (trend={est.energy_trend})")
        metrics["energy_sample_soc"] = soc

    print(f"  Saved → {output_dir / 'model_energy'}")
    return metrics


def train_pace_model(silver: pl.DataFrame, output_dir: Path) -> dict:
    """Train / evaluate the clean-pace model on real lap data."""
    from pitwall.evaluation.metrics import mae, rmse
    from pitwall.models.pace.lightgbm_model import PaceLightGBM

    gold_pace = build_pace_features(silver)
    print(f"[4/5] Pace features: {gold_pace.shape}")

    feature_cols = get_feature_columns(gold_pace)
    print(f"  Features: {len(feature_cols)} cols")

    target = "next_clean_lap_s"
    if target not in gold_pace.columns:
        avail = [c for c in gold_pace.columns if "lap" in c.lower() or "clean" in c.lower()]
        print(f"  Target {target} not found. Available: {avail}")
        return {}

    sessions = gold_pace["session_id"].unique().sort().to_list()
    if len(sessions) < 2:
        print(f"  Only {len(sessions)} sessions — need more for train/test split")
        return {}

    n = max(1, len(sessions) // 5)
    splits = chronological_race_split(gold_pace, n_test_races=n, n_val_races=n)

    train_df = apply_split(gold_pace, splits["train"])
    val_list = splits.get("validation", [])
    valid_df = apply_split(gold_pace, val_list) if val_list else None
    test_df = apply_split(gold_pace, splits["test"])

    n_valid = len(valid_df) if valid_df else 0
    print(f"  Train: {len(train_df)}  Val: {n_valid}  Test: {len(test_df)}")

    metrics: dict = {}
    pace_model = PaceLightGBM()
    try:
        pace_model.fit(train_df, valid_df, feature_cols=feature_cols, target_col=target)
        y_test = test_df[target].to_numpy()
        preds = pace_model.predict(test_df)
        n_pts = min(len(y_test), len(preds))
        pace_mae = mae(y_test[:n_pts], preds[:n_pts])
        pace_rmse = rmse(y_test[:n_pts], preds[:n_pts])
        print(f"  MAE={pace_mae:.3f}  RMSE={pace_rmse:.3f}")
        metrics["pace_mae"] = round(float(pace_mae), 3)
        metrics["pace_rmse"] = round(float(pace_rmse), 3)
        pace_model.save(output_dir / "model_pace")
        print("  Saved → model_pace")
    except Exception as e:
        print(f"  Pace training error: {e}")
        import traceback

        traceback.print_exc()

    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="PitWall ML 2026 training pipeline")
    parser.add_argument("--bronze-dir", default="data/bronze")
    parser.add_argument("--silver-dir", default=None, help="Use existing silver laps data")
    parser.add_argument("--gold-dir", default="data/gold")
    parser.add_argument("--output-dir", default="artifacts/candidate_2026")
    parser.add_argument("--max-rows", type=int, default=None)
    args = parser.parse_args()

    bronze_dir = Path(args.bronze_dir)
    gold_dir = Path(args.gold_dir)
    gold_dir.mkdir(parents=True, exist_ok=True)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    all_metrics: dict = {}

    # Step 1: Load data
    silver, silver_source = load_silver(args)
    all_metrics["data_source"] = silver_source
    all_metrics["silver_rows"] = len(silver)

    # Step 2: Build Gold tables
    print("[2/5] Building Gold feature tables...")
    silver = derive_clean_pace_labels(silver)

    gold_pace = build_pace_features(silver)
    gold_pace.write_parquet(str(gold_dir / "pace_features.parquet"))
    print(f"  Gold pace features: {gold_pace.shape}")

    # Gold tables from Bronze (if available)
    if bronze_dir.exists() and list(bronze_dir.rglob("laps.parquet")):
        clean_pace = build_gold_clean_pace(str(bronze_dir))
        if not clean_pace.is_empty():
            clean_pace.write_parquet(str(gold_dir / "clean_pace.parquet"))
            print(f"  Gold clean pace: {clean_pace.shape}")

        energy_labels = build_gold_energy_labels(str(bronze_dir))
        if not energy_labels.is_empty():
            energy_labels.write_parquet(str(gold_dir / "energy_labels.parquet"))
            print(f"  Gold energy labels: {energy_labels.shape}")

        car_perf = build_gold_car_performance(str(bronze_dir))
        if not car_perf.is_empty():
            car_perf.write_parquet(str(gold_dir / "car_performance.parquet"))
            print(f"  Gold car performance: {car_perf.shape}")

    # Step 3: Train models
    if bronze_dir.exists():
        ovt_metrics = train_overtake_model(bronze_dir, gold_dir, output_dir)
        all_metrics.update(ovt_metrics)

        energy_metrics = train_energy_model(bronze_dir, output_dir)
        all_metrics.update(energy_metrics)
    else:
        print("[3/5] No Bronze data — skipping overtake/energy models")

    # Step 4: Train pace model
    pace_metrics = train_pace_model(silver, output_dir)
    all_metrics.update(pace_metrics)

    # Step 5: Save manifest
    print("[5/5] Saving manifest...")
    manifest = {
        "version": "v2026",
        "data_source": silver_source,
        "silver_rows": len(silver),
        "models": [f.name for f in (output_dir / ".").glob("model_*")],
        "metrics": all_metrics,
    }
    with open(output_dir / "manifest.json", "w") as f:
        json.dump(manifest, f, indent=2, default=str)

    print(f"\nDone. Artifacts at {output_dir}/")
    print(json.dumps(all_metrics, indent=2))


if __name__ == "__main__":
    main()
