# PitWall ML

F1 lap-time forecasting and race strategy tool. Pulls timing + telemetry data from OpenF1, trains a quantile LightGBM model, and streams predictions to a Next.js dashboard.

[![CI](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/ci.yml/badge.svg)](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/ci.yml)
[![Deploy](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/deploy.yml/badge.svg)](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/deploy.yml)

**Demo:** https://arfaouiahmed1.github.io/PitWall-ML/

---

## What it does

- Predicts next clean lap time with 80% confidence intervals (q10/q50/q90) using LightGBM + conformal calibration
- Runs a Monte Carlo strategy simulator — pick a pit lap, compound, and push level, get a win probability delta
- Detects opponent undercut windows based on gap and tyre age
- Estimates safety car probability per lap using historical circuit rates
- Tracks 2025→2026 regulation drift (Wasserstein, KS, PSI) so the model knows when old data goes stale

The frontend replays historical race sessions at 20x speed through the same pipeline that live data would use, so it works without a paid F1 subscription.

## Stack

| Layer | Tech |
|---|---|
| Data ingestion | FastF1, OpenF1 API, Polars |
| Feature store | Polars point-in-time joins, Parquet |
| Models | LightGBM (quantile + point), CatBoost, conformal calibration |
| Serving | FastAPI, WebSockets |
| Frontend | Next.js 14, Tailwind |
| Observability | Prometheus, Grafana |
| Experiment tracking | MLflow |

## Results

Evaluated on held-out races (never seen during training):

| Model | MAE | 80% Coverage |
|---|---|---|
| Last-lap baseline | 0.38s | — |
| Rolling median (3 laps) | 1.77s | — |
| LightGBM point | 1.70s | 63.6% |
| **QuantileLightGBM + CQR** | **1.67s** | **86.4%** |

Hard compound error is higher (~4.3s) due to the non-linear warmup phase in laps 1–3. Bias correction applied.

## Getting started

```bash
# install
make bootstrap

# ingest data
python -m pitwall.ingest.cli --season 2024

# train
python -m pipelines.train --config configs/production.yaml --output-dir artifacts/candidate

# ablation
python -m pipelines.ablation --config configs/production.yaml

# serve API
uvicorn apps.api.pitwall_api.main:app --port 8000

# frontend
cd apps/web && npm install && npm run dev
```

Full stack with Prometheus + Grafana:

```bash
docker compose --profile monitoring up --build
```

- API docs: http://localhost:8000/docs
- Grafana: http://localhost:3001 (admin/admin)
- Prometheus: http://localhost:9090

## API

```
GET  /health                  service status + model version
GET  /predictions/pace        q10/q50/q90 lap forecasts for all drivers
GET  /predictions/pit         pit hazard probabilities (1-lap, 3-lap)
POST /whatif                  strategy scenario — returns position dist + time delta
GET  /monitoring/drift        feature drift metrics
ws   /ws/race?speed=5x        live race event stream
```

`POST /whatif` example:

```bash
curl -X POST http://localhost:8000/whatif \
  -H "Content-Type: application/json" \
  -d '{"driver_number": 4, "target_pit_lap": 24, "target_compound": "HARD", "push_pace_delta_s": -0.2, "remaining_laps": 30, "current_lap": 20}'
```

## Project layout

```
src/pitwall/
  features/       feature engineering (pace, pit, tyre, weather joins)
  models/         LightGBM, CatBoost, opponent, safety car
  evaluation/     metrics, splits, conformal calibration
  monitoring/     Prometheus exporter, drift detection
  simulation/     Monte Carlo engine
apps/
  api/            FastAPI app
  web/            Next.js frontend
pipelines/
  train.py        model training + bakeoff ladder
  ablation.py     LOFO feature ablation
configs/
  base.yaml
  production.yaml
monitoring/
  alerts.yml      Prometheus alert rules
  grafana/        dashboard JSON
```

## Tests

```bash
make test-all   # unit + leakage + integration + replay
make lint       # ruff check + format
```

## License

MIT
