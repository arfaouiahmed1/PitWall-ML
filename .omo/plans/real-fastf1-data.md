# Real FastF1 Data — Ingest + Train Plan

> Approved by user ("yes please use fastf1 data"). Replaces synthetic-fallback training with real race data.
> Baseline: main @ `085d00b`, CI green, suite 32 passed, synthetic smoke metrics MAE 0.504 / coverage 0.64.

## Objective
Ingest ≥4 real F1 races via FastF1 into Bronze/Silver, build Gold features, train the quantile pace model on real data, and compare against the synthetic baseline. Deliverables land under `artifacts/real/`.

## Steps
1. **Install**: `.\.venv\Scripts\pip.exe install fastf1` (or `-e ".[ml]"`). Verify import.
2. **Cache**: ensure a FastF1 cache dir (`data/cache/`) is used — check `src/pitwall/ingestion/fastf1.py`; if it doesn't call `fastf1.Cache.enable_cache`, wire it in the ingest path (small edit OK) so downloads aren't re-fetched.
3. **Ingest** these races (from `configs/shadow_races.yaml`, gives valid chronological splits):
   - 2024 Bahrain GP R · 2024 Spanish GP R · 2024 Italian GP R (Monza) · 2025 Monaco GP R · 2025 British GP R
   - Command per race: `python -m pipelines.ingest --season <Y> --event "<Name>" --session R`
   - Expect ~1–3 min download per race on first fetch. Verify `data/silver/laps/*.parquet` written + quality_report printed sane (non-zero valid laps).
4. **Train on real data**: `python -m pipelines.train --config configs/development.yaml --output-dir artifacts/real` — should pick up silver parquet automatically (no synthetic fallback).
5. **Compare**: record real-data MAE/RMSE/pinball/coverage_80/p95_ms/per-compound vs synthetic smoke (`artifacts/smoke/metrics.json`). Write comparison to `artifacts/real/comparison.json`.
6. **Ledger**: append done-claim JSONL to `.omo/start-work/ledger.jsonl`.

## Acceptance
- `data/silver/laps/` contains ≥4 real-race parquet files with plausible lap counts (50–80 laps × 20 drivers)
- Training log shows real session_ids (no "generating synthetic data" line)
- `artifacts/real/metrics.json` + `comparison.json` exist with honest numbers
- Suite still 32 passed; no regression

## Out of scope
- Retraining CI switch-over, API artifact-path repointing (follow-up decision), tyre/pit model retraining on real data (pace model first).

## Blocker protocol
If network/F1-API unreachable or event-name lookup fails after 2 retries with corrected names, STOP and report BLOCKED with exact error — do not fabricate data.
