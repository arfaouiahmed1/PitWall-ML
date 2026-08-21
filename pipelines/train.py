"""Training pipeline — pace model with temporal split + MLflow logging."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import polars as pl
import yaml

from pitwall.evaluation.metrics import evaluate_pace
from pitwall.evaluation.splits import apply_split, chronological_race_split
from pitwall.features.pace import build_pace_features, get_feature_columns
from pitwall.models.pace.baseline import LastLapBaseline, RollingMedianBaseline
from pitwall.models.pace.lightgbm_model import PaceLightGBM


def load_config(path: str) -> dict:
    with open(path) as f:
        cfg = yaml.safe_load(f)
    # handle extends
    if "extends" in cfg:
        base_p = Path(path).parent / cfg["extends"]
        if base_p.exists():
            with open(base_p) as bf:
                base = yaml.safe_load(bf)
            # shallow merge
            for k, v in cfg.items():
                if k == "extends":
                    continue
                if isinstance(v, dict) and k in base and isinstance(base[k], dict):
                    base[k] = {**base[k], **v}
                else:
                    base[k] = v
            return base
    return cfg


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="configs/development.yaml")
    parser.add_argument("--output-dir", default="artifacts/candidate")
    parser.add_argument("--max-rows", type=int, default=None)
    args = parser.parse_args()

    cfg = load_config(args.config)
    print(f"Config: {args.config}")

    # Load silver laps
    silver_root = Path(cfg.get("data", {}).get("silver_path", "data/silver"))
    files = (
        list((silver_root / "laps").rglob("*.parquet"))
        if (silver_root / "laps").exists()
        else list(silver_root.rglob("*.parquet"))
    )
    if not files:
        # Create synthetic data for smoke test if no real data
        print("No silver data found — generating synthetic data for smoke test")
        import numpy as np

        np.random.seed(42)
        n_sessions = 6
        rows = []
        for s in range(n_sessions):
            for d in [1, 16, 44, 63]:
                for lap in range(1, 31):
                    lt = float(np.random.normal(90, 1.2))
                    rows.append(
                        {
                            "session_id": f"2024_R{s}",
                            "driver_number": d,
                            "lap_number": lap,
                            "lap_time_s": lt,
                            "compound": "MEDIUM",
                            "tyre_age": lap % 10,
                            "stint_no": 1,
                            "position": 1,
                            "is_valid_training_lap": True,
                        }
                    )
        silver = pl.DataFrame(rows)
    else:
        print(f"Found {len(files)} silver files")
        silver = pl.read_parquet(files)
        if args.max_rows:
            silver = silver.head(args.max_rows)

    print(f"Silver total rows: {len(silver)}")

    # Build features
    gold = build_pace_features(silver)
    print(f"Gold rows: {len(gold)} cols: {gold.columns[:12]}...")

    # Temporal split
    n_test = cfg.get("training", {}).get("test_races", 2)
    n_val = cfg.get("training", {}).get("validation_races", 1)
    try:
        splits = chronological_race_split(gold, n_test_races=n_test, n_val_races=n_val)
    except ValueError as e:
        print(f"Split warning: {e} — using random fallback for smoke test")
        # fallback: take last sessions lexicographically
        sessions = gold.select("session_id").unique().sort("session_id")["session_id"].to_list()
        splits = {"train": sessions[:-2], "validation": [sessions[-2]], "test": [sessions[-1]]}

    print(
        f"Splits: train={len(splits['train'])} val={len(splits['validation'])} test={len(splits['test'])}"
    )

    train_df = apply_split(gold, splits["train"]).filter(
        pl.col("is_valid_training_lap_target")
        if "is_valid_training_lap_target" in gold.columns
        else pl.lit(True)
    )
    valid_df = (
        apply_split(gold, splits["validation"]).filter(
            pl.col("is_valid_training_lap_target")
            if "is_valid_training_lap_target" in gold.columns
            else pl.lit(True)
        )
        if splits["validation"]
        else None
    )
    test_df = apply_split(gold, splits["test"]).filter(
        pl.col("is_valid_training_lap_target")
        if "is_valid_training_lap_target" in gold.columns
        else pl.lit(True)
    )

    print(
        f"Train {len(train_df)} Valid {len(valid_df) if valid_df is not None else 0} Test {len(test_df)}"
    )

    feature_cols = get_feature_columns(gold)
    target = cfg.get("features", {}).get("pace", {}).get("target", "next_clean_lap_s")
    if target not in gold.columns:
        target = "next_clean_lap_s"
    print(f"Features ({len(feature_cols)}): {feature_cols}")
    print(f"Target: {target}")

    # Baselines
    import numpy as np

    y_test = test_df[target].to_numpy() if target in test_df.columns else np.array([])
    if len(y_test) > 0:
        for name, model in [
            ("last_lap", LastLapBaseline()),
            ("rolling_3", RollingMedianBaseline(3)),
        ]:
            pred = model.predict(test_df)
            # align lengths
            n = min(len(y_test), len(pred))
            from pitwall.evaluation.metrics import mae, rmse

            print(
                f"Baseline {name}: MAE={mae(y_test[:n], pred[:n]):.3f} RMSE={rmse(y_test[:n], pred[:n]):.3f}"
            )

    # LightGBM
    model_cfg = cfg.get("models", {}).get("pace", {})
    params = model_cfg.get("params", {})
    cat_features = cfg.get("features", {}).get("pace", {}).get("categorical", [])

    model = PaceLightGBM(params=params, categorical_features=cat_features)
    model.fit(train_df, valid_df, feature_cols=feature_cols, target_col=target)

    # Evaluate on test
    import numpy as np

    preds = model.predict(test_df)
    y_true = test_df[target].to_numpy()
    # quantile approx
    q_all = model.predict_quantiles(test_df)
    q10 = q_all[0.1]
    q50 = q_all[0.5]
    q90 = q_all[0.9]

    # trim to common length
    n = min(len(y_true), len(preds), len(q10))
    y_true = y_true[:n]
    q10 = q10[:n]
    q50 = q50[:n]
    q90 = q90[:n]

    metrics = evaluate_pace(y_true, q10, q50, q90)
    print("Metrics:", json.dumps(metrics, indent=2))

    # Save artifacts
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    model.save(out / "model")
    with open(out / "metrics.json", "w") as f:
        json.dump(metrics, f, indent=2)
    with open(out / "splits.json", "w") as f:
        json.dump(splits, f, indent=2)
    with open(out / "config.json", "w") as f:
        json.dump(cfg, f, indent=2, default=str)

    # Try MLflow log
    try:
        from pitwall.registry.mlflow_utils import log_pace_run

        exp = cfg.get("mlflow", {}).get("experiment", "pitwall-pace-dev")
        run_id = log_pace_run(metrics, params, artifacts=out, experiment=exp)
        print(f"MLflow run: {run_id} experiment={exp}")
        with open(out / "mlflow_run.json", "w") as f:
            json.dump({"run_id": run_id, "experiment": exp}, f)
    except Exception as e:
        print(f"MLflow logging skipped: {e}")

    print(f"Done. Artifacts at {out}")


if __name__ == "__main__":
    main()
