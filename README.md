# PitWall ML

> A race-engineering brain for F1 timing data. It watches every lap like a pit-wall engineer, predicts what happens next, and shows you the race before it happens.

[![CI](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/ci.yml/badge.svg)](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/deploy-pages.yml)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

## What is this?

PitWall ML reads Formula 1 timing and telemetry the way a team's pit wall does: lap by lap, driver by driver, in race order. For every driver it predicts how fast the next lap will be and puts an honest uncertainty band around that number. It estimates how likely each driver is to pit within the next three laps. Then it replays the rest of the race thousands of times to turn those predictions into a probability distribution over finishing positions.

Everything streams to a dashboard: a live-style leaderboard, predicted pace with intervals, pit risk per driver, and a simulated final classification, updating as race events arrive.

## Live demo

**https://arfaouiahmed1.github.io/PitWall-ML/**

The hosted dashboard runs in demo mode: it streams a simulated race replay so it works with zero setup. The full stack (ingestion, training, inference, monitoring) runs locally; see [Quick start](#quick-start). For the honest build story (what broke, what it cost, and why the numbers look the way they do), read [docs/JOURNEY.md](docs/JOURNEY.md). For the process behind it (CRISP-DM phases mapped to repo artifacts, the three-iteration log, and an honest gap analysis), read [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

<!-- TODO: screenshot of the race dashboard (leaderboard + predicted pace bands + pit probability) -->

## How it works

```
raw events                      FastF1 · OpenF1 · Jolpica
        |
        v
bronze / silver / gold lake     Parquet + Polars + DuckDB
        |
        v
point-in-time features          leakage-safe by construction
        |
        v
training / backtesting          chronological race holdout
        |
        v
model registry                  MLflow @champion / @challenger
        |
        v
real-time inference             FastAPI + WebSockets
        |                                |
        v                                v
Next.js dashboard               Prometheus · Grafana · Evidently
        |
        v
new race labels -> drift detected -> retrain -> shadow replay -> promotion
```

### Replay-first design

Official live timing is paywalled: OpenF1's live feed requires a EUR 9.90/month sponsorship tier and FastF1 live needs F1TV credentials. Rather than fake a live system, PitWall ML treats historical replay as the canonical path. Replayed races stream through the identical `RaceEvent -> RaceState -> Features -> Model -> WebSocket` pipeline that live data uses, so the demo exercises the real architecture end to end. Every source implements one async event protocol (`src/pitwall/ingestion/base.py`); switching replay for live is a configuration change, not a rewrite.

### Point-in-time features

A training row can only contain information that was knowable at prediction time. The target `next_clean_lap_s` is shifted one lap back per driver and session, and the local feature store (`src/pitwall/features/store.py`) serves historical features through backward as-of joins on `(session_id, driver_number)` using Polars `join_asof`. Leakage tests in `tests/leakage/` enforce this by construction, and CI runs them on every push.

### Quantile pace model

A single point estimate hides the interesting part. The pace model is LightGBM quantile regression at q10/q50/q90, so every forecast ships with a calibrated interval instead of a bare number. Predictions enforce monotonicity (`q10 <= q50 <= q90`) at the schema level. Features include rolling medians and standard deviation of recent laps, tyre age, stint number, track position, compound, and race progress.

### Tyre degradation model

Degradation is isolated as `tyre_deg_s = lap_time - rolling_median_5` and modeled with LightGBM over tyre age, stint number, and compound. This feeds both the pace forecast and the simulator's compound-switching behavior.

### Pit hazard classifier

A binary LightGBM classifier predicts whether a driver pits within the next three laps, trained on position, tyre age, stint, compound, and race progress. Its probability drives the pit-risk display in the UI and stop decisions inside the simulator.

### Monte Carlo simulator

For each driver the simulator samples remaining laps from the quantile bands, injects pit stops sampled from the hazard model (with a ~22 s pit loss and compound-cycle constraints), and repeats this hundreds of times. The output is a distribution over finishing order: "this driver wins 62% of simulated races", not a single guess. Batch mode covers 200 simulations across 10 remaining laps in roughly 49 seconds; the API exposes it at `POST /simulate`.

## Tech stack

| Layer | Technology |
|-------|------------|
| Ingestion | FastF1, OpenF1, Jolpica, replay sources behind one async protocol |
| Data | Polars, Parquet (bronze/silver/gold), DuckDB for SQL |
| Models | LightGBM: quantile regression, regression, binary classification |
| Serving | FastAPI with WebSockets and REST endpoints |
| Frontend | Next.js 14, Tailwind CSS |
| MLOps | MLflow, Evidently, Prometheus, Grafana |
| Infra | Docker Compose, GHCR, Render, GitHub Pages, GitHub Actions |

## Real results

These numbers come straight from `artifacts/real/comparison.json`, produced by evaluation runs on held-out laps. Nothing here is hand-tuned or aspirational.

| Metric | Synthetic holdout | Real race laps |
|--------|------------------:|---------------:|
| Pace MAE | 0.50 s | 8.44 s |
| Pace RMSE | 0.62 s | 12.58 s |
| 80% interval coverage | 64% | 6% |
| Mean interval width | 1.09 s | 2.47 s |
| Pit classifier AUC | 1.00 | 0.66 |
| Inference p95 latency | 7.6 ms | 13.1 ms |
| Evaluation laps | 232 | 1,969 |

The gap is the story. On synthetic data (clean laps, controlled degradation curves) the model lands within half a second. On real race laps it lands at 8.44 seconds, because real lap-time targets contain safety cars, virtual safety cars, traffic, and rain. The per-compound breakdown confirms it: intermediates average 13.87 s of error versus 6.70 s on hards, exactly where weather variance lives. Interval coverage collapses for the same reason: the bands are tight while the targets are not.

The fix is already scoped: filter safety-car and VSC-contaminated laps out of the training target so the model learns racing pace, then reattach race-context effects as explicit features.

Publishing these numbers unedited is deliberate. A results table that only shows the flattering metric tells you nothing about how the system behaves on the data that matters.

## Quick start

Requirements: Python 3.11+, Node 18+, Docker.

```bash
# 1. Bootstrap: install package + dev deps, create .env and data dirs
make bootstrap

# 2. Start infra (Postgres, Redis, MLflow) -> MLflow UI at http://localhost:5000
make services

# 3. Ingest a historical race
make ingest SEASON=2025 EVENT="Monaco Grand Prix" SESSION=R

# 4. Build point-in-time features
make features SEASON=2025

# 5. Train the pace model (chronological split, baselines + LightGBM)
make train-pace

# 6. Serve predictions -> http://localhost:8000/health, ws://localhost:8000/ws/race
make api

# 7. Dashboard -> http://localhost:3000
cd apps/web && npm install && npm run dev

# Full stack in Docker (--profile monitoring adds Prometheus + Grafana)
docker compose up --build
docker compose --profile monitoring up --build
```

Replay speeds: `1x` realistic, `5x` demo, `20x` fast, `MAX` deterministic batch, `STEP` manual.

## Project structure

```
pitwall-ml/
├── src/pitwall/
│   ├── ingestion/   # openf1.py, fastf1.py, jolpica.py, replay.py, base.py
│   ├── schemas/     # events.py, laps.py, predictions.py
│   ├── data/        # bronze.py, silver.py, quality.py
│   ├── state/       # race_state.py
│   ├── features/    # pace.py, tyre.py, pit.py, common.py, store.py
│   ├── models/      # pace/lightgbm_model.py, pace/baseline.py, tyre/lightgbm_tyre.py, pit/lightgbm_pit.py
│   ├── explain/     # shap_utils.py
│   ├── orchestration/  # flow.py
│   ├── eventbus/    # stream.py
│   ├── evaluation/  # splits.py, metrics.py
│   ├── registry/    # mlflow_utils.py, promotion.py, shadow.py
│   └── monitoring/  # metrics.py
├── apps/
│   ├── api/pitwall_api/  # FastAPI + WebSocket
│   └── web/              # Next.js 14 dashboard (race, models, monitoring)
├── pipelines/       # ingest.py, features.py, train.py
├── configs/         # base.yaml, development.yaml, production.yaml, promotion.yaml
├── tests/           # unit, leakage, integration, replay
├── monitoring/      # prometheus.yml, alerts.yml, grafana/
├── infra/           # render.yaml
├── compose.yaml     # Postgres 17 + Redis 7 + MLflow 2.13 + API + Prometheus/Grafana
└── .github/workflows/  # ci.yml, deploy-pages.yml, publish-api.yml, retrain.yml, promote.yml
```

## MLOps lifecycle

| Stage | Mechanism |
|-------|-----------|
| Tracking & registry | MLflow with mutable aliases: `models:/pitwall-pace@champion` / `@challenger` |
| Promotion gates | >=2% primary-metric gain, no subgroup >10% regression, interval-coverage tolerance, p95 <100 ms (`configs/promotion.yaml`) |
| Shadow deployment | Challenger replays historical races and logs predictions; champion stays displayed until gates pass |
| Retraining | Triggered by a newly completed race, drift, or manual dispatch (`retrain.yml`, idempotent) |
| Drift detection | Evidently DataDriftPreset over a rolling 3-race window vs the training reference |

Every run writes a reproducibility manifest: `git_sha`, data snapshot, splits, features, params, metrics. Tables are populated only by real pipeline runs.

## Deployment

| Host | Role | Note |
|------|------|------|
| GitHub Pages | Static Next.js dashboard | Auto-deploys via `deploy-pages.yml`; demo replay or point `NEXT_PUBLIC_API_URL` at a hosted API |
| GHCR + Render Free | FastAPI serving the baked champion | Image published by `publish-api.yml`; free tier spins down after idle |
| Docker Compose | Canonical full system | Postgres, Redis, MLflow, Prometheus, Grafana, full dataset |

CI/CD workflows:

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | push / PR to main | ruff, mypy, pytest (unit + leakage + integration + replay), training smoke test, both frontend builds, compose config check |
| `deploy-pages.yml` | push touching `apps/web/**` + manual | Static export build, upload artifact, deploy to Pages |
| `publish-api.yml` | push touching API or Dockerfile | Build and push the API image to GHCR |
| `retrain.yml` | weekly schedule + manual | Retrain on latest ingested data, upload artifacts |
| `promote.yml` | manual dispatch | Register challenger, shadow replay, gated promotion to champion |

## Roadmap

- [x] **V1 Weekend MVP**: ingestion, silver/gold layers, LightGBM pace model plus baselines, temporal evaluation, replay engine, FastAPI + WebSockets, Next.js race screen, Docker, CI
- [x] **V2 ML depth**: quantile pace forecasts (q10/q50/q90), tyre degradation model, pit hazard classifier, Monte Carlo simulator, MLflow registry with promotion gates, SHAP explanations
- [x] **V3 Production-like**: Prometheus/Grafana dashboards (`monitoring/grafana/dashboards/pitwall.json`), drift detection with `/monitoring/drift`, alert rules, champion/challenger shadow replay, retraining workflow, hosted thin demos
- [x] **V4 Advanced**: local-first builds of the advanced stack with zero new runtime dependencies
    - Feature store (`src/pitwall/features/store.py`): point-in-time historical retrieval via Polars `join_asof`, online/offline views, `materialize_gold_store`
    - Flow runner (`src/pitwall/orchestration/flow.py`): task/flow decorators with retry and backoff, run manifests, dry-run CLI
    - Event bus (`src/pitwall/eventbus/stream.py`): Redis Streams consumer groups with in-memory fallback, WebSocket publish hook
    - Infra parity notes (`infra/PARITY.md`): compose service to free-tier cloud mapping

## License

MIT
