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
from pitwall.features.pit import build_pit_features, get_pit_feature_columns
from pitwall.features.tyre import build_tyre_features, get_tyre_feature_columns
from pitwall.models.pace.baseline import LastLapBaseline, RollingMedianBaseline
from pitwall.models.pace.lightgbm_model import PaceLightGBM, QuantileLightGBM
from pitwall.models.pit.lightgbm_pit import PitHazardLightGBM
from pitwall.models.tyre.lightgbm_tyre import TyreLightGBM


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
        # Create synthetic data for smoke test if no real data — inject realistic tyre degradation signal
        print("No silver data found — generating synthetic data for smoke test (with tyre deg)")
        import numpy as np

        np.random.seed(42)
        n_sessions = 6
        rows = []
        for s in range(n_sessions):
            for d in [1, 16, 44, 63]:
                pit_lap = 15
                for lap in range(1, 31):
                    is_second_stint = lap >= pit_lap
                    tyre_age = (lap - pit_lap) if is_second_stint else (lap - 1)
                    compound = "HARD" if is_second_stint else "MEDIUM"
                    stint_no = 2 if is_second_stint else 1
                    # base pace 90s + degradation 0.07*age + 0.003*age^2 + compound offset + noise
                    base = float(np.random.normal(90, 0.5))
                    deg = 0.07 * tyre_age + 0.004 * (tyre_age**2)
                    if compound == "SOFT":
                        deg *= 1.3
                    elif compound == "HARD":
                        deg *= 0.75
                    lt = base + deg + float(np.random.normal(0, 0.25))
                    rows.append(
                        {
                            "session_id": f"2024_R{s}",
                            "driver_number": d,
                            "lap_number": lap,
                            "lap_time_s": lt,
                            "compound": compound,
                            "tyre_age": tyre_age,
                            "stint_no": stint_no,
                            "position": 1,
                            "is_valid_training_lap": True,
                            "track_temp_c": 37.0 + float(np.random.normal(0, 1.0)),
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

    # LightGBM point + quantile (V2)
    model_cfg = cfg.get("models", {}).get("pace", {})
    params = model_cfg.get("params", {})
    cat_features = cfg.get("features", {}).get("pace", {}).get("categorical", [])
    quantile_enabled = model_cfg.get("quantile", False) or bool(model_cfg.get("quantile_alphas"))
    quantile_alphas = model_cfg.get("quantile_alphas", [0.1, 0.5, 0.9])

    model = PaceLightGBM(params=params, categorical_features=cat_features)
    model.fit(train_df, valid_df, feature_cols=feature_cols, target_col=target)

    q_model: QuantileLightGBM | None = None
    if quantile_enabled:
        print(f"Training QuantileLightGBM alphas={quantile_alphas}")
        q_base = {k: v for k, v in params.items() if k not in ("objective", "metric")}
        q_model = QuantileLightGBM(
            alphas=quantile_alphas, base_params=q_base, categorical_features=cat_features
        )
        q_model.fit(train_df, valid_df, feature_cols=feature_cols, target_col=target)
        print("Quantile models trained:", list(q_model.models.keys()))

    # Evaluate on test
    import time

    import numpy as np

    t0 = time.perf_counter()
    preds = model.predict(test_df)
    p95_ms = (time.perf_counter() - t0) / max(len(test_df), 1) * 1000
    # more accurate per-row p95: time batch then estimate; for V2 we report p95 per prediction * 100 (simulated single)
    # Actually measure 100 single-row predicts for p95
    lat_samples = []
    for _ in range(100):
        s = test_df.head(1)
        st = time.perf_counter()
        _ = model.predict(s)
        lat_samples.append((time.perf_counter() - st) * 1000)
    p95_ms = float(np.percentile(lat_samples, 95)) if lat_samples else 0.0

    y_true = test_df[target].to_numpy()
    if q_model is not None:
        # also measure quantile latency
        t0q = time.perf_counter()
        q_all = q_model.predict(test_df)
        q_lat = (time.perf_counter() - t0q) / max(len(test_df), 1) * 1000
        q10 = q_all[0.1]
        q50 = q_all[0.5]
        q90 = q_all[0.9]
        print(
            f"Using trained quantile preds (p95 {p95_ms:.1f}ms, quantile batch {q_lat:.3f}ms/row)"
        )
    else:
        # heuristic fallback (V1)
        q_all = model.predict_quantiles(test_df)
        q10 = q_all[0.1]
        q50 = q_all[0.5]
        q90 = q_all[0.9]
        print("Using heuristic quantile preds (set models.pace.quantile=true to train)")

    # trim to common length
    n = min(len(y_true), len(preds), len(q10))
    y_true = y_true[:n]
    q10 = q10[:n]
    q50 = q50[:n]
    q90 = q90[:n]

    metrics = evaluate_pace(y_true, q10, q50, q90)
    metrics["p95_ms"] = p95_ms
    # per-compound grouping for promotion gate (max_group_regression)
    try:
        if "compound" in test_df.columns and len(y_true) == len(test_df):
            from pitwall.evaluation.metrics import mae as mae_fn

            per_comp: dict[str, float] = {}
            for comp in test_df["compound"].unique().to_list():
                mask = (test_df["compound"] == comp).to_numpy()
                # mask corresponds to y_true order (test_df order)
                y_g = y_true[mask[: len(y_true)]]
                q_g = q50[mask[: len(q50)]]
                if len(y_g) > 5:
                    per_comp[str(comp)] = float(mae_fn(y_g, q_g))
            if per_comp:
                metrics["per_compound"] = per_comp
                print(f"Per-compound MAE: {per_comp}")
    except Exception as e:
        print(f"Per-compound calc skipped: {e}")
    # also report point vs quantile median diff
    metrics["point_mae_vs_quantile_p50"] = float(np.mean(np.abs(preds[:n] - q50))) if n else 0.0
    metrics["quantile_enabled"] = quantile_enabled
    print("Metrics (pace):", json.dumps(metrics, indent=2))

    # --- V2.2 Tyre degradation model ---
    _tyre_model_to_save = None
    _tyre_feature_cols: list[str] = []
    try:
        tyre_gold = build_tyre_features(silver)
        tyre_feature_cols = get_tyre_feature_columns(tyre_gold)
        tyre_target = "tyre_deg_s"
        print(f"Tyre features ({len(tyre_feature_cols)}): {tyre_feature_cols}")
        if tyre_target in tyre_gold.columns and tyre_feature_cols:
            tyre_train = apply_split(tyre_gold, splits["train"]).filter(
                pl.col("is_valid_tyre_row")
                if "is_valid_tyre_row" in tyre_gold.columns
                else pl.lit(True)
            )
            tyre_valid = (
                apply_split(tyre_gold, splits["validation"]).filter(
                    pl.col("is_valid_tyre_row")
                    if "is_valid_tyre_row" in tyre_gold.columns
                    else pl.lit(True)
                )
                if splits["validation"]
                else None
            )
            tyre_test = apply_split(tyre_gold, splits["test"]).filter(
                pl.col("is_valid_tyre_row")
                if "is_valid_tyre_row" in tyre_gold.columns
                else pl.lit(True)
            )
            print(
                f"Tyre rows Train {len(tyre_train)} Valid {len(tyre_valid) if tyre_valid is not None else 0} Test {len(tyre_test)}"
            )
            tyre_cat = [
                c for c in ["compound", "circuit_id", "regulation_era"] if c in tyre_feature_cols
            ]
            tyre_params = cfg.get("models", {}).get("tyre", {}).get("params", {})
            if not tyre_params:
                tyre_params = {"n_estimators": 150, "learning_rate": 0.08, "num_leaves": 12}
            tyre_model = TyreLightGBM(params=tyre_params, categorical_features=tyre_cat)
            tyre_model.fit(
                tyre_train, tyre_valid, feature_cols=tyre_feature_cols, target_col=tyre_target
            )
            # evaluate
            from pitwall.evaluation.metrics import mae
            from pitwall.evaluation.metrics import rmse as rmse_fn

            if len(tyre_test) > 0:
                y_tyre = tyre_test[tyre_target].to_numpy()
                p_tyre = tyre_model.predict(tyre_test)
                n_t = min(len(y_tyre), len(p_tyre))
                tyre_mae = mae(y_tyre[:n_t], p_tyre[:n_t])
                tyre_rmse = rmse_fn(y_tyre[:n_t], p_tyre[:n_t])
                # degradation slope: avg pred at age 15 vs 3
                print(f"Tyre model — MAE={tyre_mae:.4f} RMSE={tyre_rmse:.4f} (deg target)")
                metrics["tyre_mae"] = tyre_mae
                metrics["tyre_rmse"] = tyre_rmse
                # store for later artifact save
                _tyre_model_to_save = tyre_model
                _tyre_feature_cols = tyre_feature_cols
            else:
                print("Tyre — no test rows")
                metrics["tyre_mae"] = None
                _tyre_model_to_save = None
        else:
            print("Tyre — skipped (no target/features)")
            _tyre_model_to_save = None
    except Exception as e:
        print(f"Tyre training skipped: {e}")
        import traceback

        traceback.print_exc()
        metrics["tyre_mae"] = None
        _tyre_model_to_save = None

    # --- V2.3 Pit hazard (next 3 laps) ---
    _pit_model_to_save = None
    _pit_feature_cols: list[str] = []
    try:
        pit_horizon = cfg.get("models", {}).get("pit", {}).get("horizon", 3)
        pit_gold = build_pit_features(silver, horizon=pit_horizon)
        pit_feature_cols = get_pit_feature_columns(pit_gold)
        pit_target = f"pit_in_next_{pit_horizon}"
        print(f"Pit features ({len(pit_feature_cols)}): {pit_feature_cols} target={pit_target}")
        if pit_target in pit_gold.columns and pit_feature_cols:
            pit_train = apply_split(pit_gold, splits["train"]).filter(
                pl.col("is_valid_pit_row")
                if "is_valid_pit_row" in pit_gold.columns
                else pl.lit(True)
            )
            pit_valid = (
                apply_split(pit_gold, splits["validation"]).filter(
                    pl.col("is_valid_pit_row")
                    if "is_valid_pit_row" in pit_gold.columns
                    else pl.lit(True)
                )
                if splits["validation"]
                else None
            )
            pit_test = apply_split(pit_gold, splits["test"]).filter(
                pl.col("is_valid_pit_row")
                if "is_valid_pit_row" in pit_gold.columns
                else pl.lit(True)
            )
            print(
                f"Pit rows Train {len(pit_train)} Valid {len(pit_valid) if pit_valid is not None else 0} Test {len(pit_test)}"
            )
            pit_cat = [
                c for c in ["compound", "circuit_id", "regulation_era"] if c in pit_feature_cols
            ]
            pit_params = cfg.get("models", {}).get("pit", {}).get("params", {})
            if not pit_params:
                pit_params = {"n_estimators": 150, "learning_rate": 0.08, "num_leaves": 12}
            pit_model = PitHazardLightGBM(params=pit_params, categorical_features=pit_cat)
            pit_model.fit(
                pit_train, pit_valid, feature_cols=pit_feature_cols, target_col=pit_target
            )
            # evaluate: AUC, logloss, precision at horizon
            if len(pit_test) > 0:
                y_pit = pit_test[pit_target].to_numpy()
                p_pit = pit_model.predict_proba(pit_test)
                from sklearn.metrics import log_loss, roc_auc_score

                try:
                    pit_auc = float(roc_auc_score(y_pit, p_pit)) if len(set(y_pit)) > 1 else 0.5
                except Exception:
                    pit_auc = 0.5
                pit_ll = (
                    float(log_loss(y_pit, np.clip(p_pit, 1e-6, 1 - 1e-6))) if len(y_pit) else 0.0
                )
                pit_pos_rate = float((y_pit == 1).mean()) if len(y_pit) else 0.0
                pit_pred_mean = float(p_pit.mean()) if len(p_pit) else 0.0
                print(
                    f"Pit model — AUC={pit_auc:.3f} logloss={pit_ll:.3f} pos_rate={pit_pos_rate:.3f} pred_mean={pit_pred_mean:.3f}"
                )
                metrics["pit_auc"] = pit_auc
                metrics["pit_logloss"] = pit_ll
                metrics["pit_pos_rate"] = pit_pos_rate
                _pit_model_to_save = pit_model
                _pit_feature_cols = pit_feature_cols
            else:
                print("Pit — no test rows")
                metrics["pit_auc"] = None
        else:
            print("Pit — skipped (no target/features)")
    except Exception as e:
        print(f"Pit training skipped: {e}")
        import traceback

        traceback.print_exc()
        metrics["pit_auc"] = None

    print("Metrics (combined):", json.dumps(metrics, indent=2))

    # Save artifacts
    out = Path(args.output_dir)
    out.mkdir(parents=True, exist_ok=True)
    model.save(out / "model")
    if q_model is not None:
        q_model.save(out / "model_quantile")
        # also save quantile metrics separately
        with open(out / "quantile_manifest.json", "w") as f:
            json.dump(
                {"alphas": quantile_alphas, "feature_cols": q_model.feature_cols}, f, indent=2
            )
    if _tyre_model_to_save is not None:
        _tyre_model_to_save.save(out / "model_tyre")
        with open(out / "tyre_manifest.json", "w") as f:
            json.dump({"feature_cols": _tyre_feature_cols}, f, indent=2)
    if _pit_model_to_save is not None:
        _pit_model_to_save.save(out / "model_pit")
        with open(out / "pit_manifest.json", "w") as f:
            json.dump({"feature_cols": _pit_feature_cols, "horizon": pit_horizon}, f, indent=2)

    # --- V2.6 SHAP (pace) ---
    try:
        from pitwall.explain.shap_utils import compute_and_save_shap

        if len(test_df) > 0 and feature_cols:
            # Use point model for SHAP; fallback to quantile median if needed
            shap_model = model
            shap_summary = compute_and_save_shap(
                shap_model, test_df, feature_cols, out / "shap_summary.json", sample_n=200
            )
            print(f"SHAP summary top 3: {list(shap_summary.items())[:3]}")
            # add top feature to metrics for registry
            if shap_summary:
                metrics["shap_top_feature"] = next(iter(shap_summary))
                metrics["shap_top_importance"] = float(next(iter(shap_summary.values())))
    except Exception as e:
        print(f"SHAP skipped: {e}")

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
