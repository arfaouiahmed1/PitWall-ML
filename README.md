# PitWall ML — Real-Time F1 Race Intelligence with Continual Learning, Probabilistic Forecasting and Production MLOps

> **Replayable and optionally live race-intelligence platform** that ingests F1 timing and telemetry, maintains event-time race state, predicts pace and pit behavior, simulates race outcomes, quantifies uncertainty, tracks models and experiments, detects drift, retrains after new races, tests challengers against production champions, and exposes both race predictions and ML-system health through a polished web dashboard.

## Architecture at a glance

```
raw events
   ↓
validated historical + streaming data  (FastF1 + OpenF1 + Jolpica)
   ↓
point-in-time features  (Polars, no leakage)
   ↓
training / backtesting  (chronological race holdout)
   ↓
model registry  (MLflow @champion / @challenger)
   ↓
real-time inference  (FastAPI)
   ↓
monitoring  (Prometheus + Grafana + Evidently)
   ↓
new race labels → drift → retraining → shadow replay → promotion
```

**Key design decision: Replay Mode is the canonical demo.** OpenF1 live requires €9.90/mo sponsor and FastF1 live requires F1TV auth. Replay streams historical Bronze events through the *same* `RaceEvent → RaceState → Features → Model → WebSocket` path as live, making it an event-time integration test of the production architecture.

## Quick start (V1 MVP)

```bash
# 1. Bootstrap
make bootstrap
cp .env.example .env

# 2. Start infra (Postgres, Redis, MLflow)
make services
# → MLflow at http://localhost:5000

# 3. Ingest historical data (requires fastf1)
make ingest SEASON=2025 EVENT="Monaco Grand Prix" SESSION=R
# or: python -m pipelines.ingest --season 2025 --event "Monaco Grand Prix" --session R

# 4. Build features
make features SEASON=2025

# 5. Train pace model (temporal split, baselines + LightGBM)
make train-pace
# or: python -m pipelines.train --config configs/development.yaml

# 6. Run API + WebSocket
make api
# → http://localhost:8000/health  http://localhost:8000/metrics  ws://localhost:8000/ws/race

# 7. Run frontend
cd apps/web && npm install && npm run dev
# → http://localhost:3000

# 8. Full stack via Docker
docker compose up --build
docker compose --profile monitoring up --build  # with Prometheus+Grafana
```

### Replay semantics

```python
# Every source adapts to RaceEvent
class RaceEventSource(Protocol):
    async def events(self) -> AsyncIterator[RaceEvent]: ...


# Replay vs Live share the interface
ParquetReplaySource  # historical bronze
FastF1ReplaySource  # FastF1 historical
OpenF1HistoricalSource  # OpenF1 free since 2023
OpenF1LiveSource  # MQTT (paid, V3)
```

Speeds: `1×` realistic, `5×` demo, `20×` fast demo, `MAX` deterministic batch, `STEP` manual.

## Project structure

```
pitwall-ml/
├── src/pitwall/
│   ├── ingestion/   # openf1.py, fastf1.py, jolpica.py, replay.py, base.py
│   ├── schemas/     # events.py, laps.py, predictions.py
│   ├── data/        # bronze.py, silver.py, quality.py
│   ├── state/       # race_state.py
│   ├── features/    # pace.py, tyre.py, pit.py, common.py
│   ├── models/      # pace/lightgbm_model.py, pace/baseline.py
│   ├── evaluation/  # splits.py, metrics.py
│   ├── registry/    # mlflow_utils.py
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
└── .github/workflows/  # ci.yml, retrain.yml, promote.yml
```

## Data layer

| Layer | Storage | Grain |
|-------|---------|-------|
| **Bronze** | Parquet, append-only, source-faithful | one event / raw_payload json |
| **Silver** | Parquet | driver/lap normalized |
| **Gold** | Parquet | point-in-time feature rows with `next_clean_lap_s` target |

Tooling: **Polars** (lazy scan, streaming), Pandas only at FastF1 boundary, **DuckDB** for SQL. Mirrors the plan's Bronze/Silver/Gold schema.

## Model suite (dependency graph)

```
Pace Model ─────────┐
                    ├─→ Monte Carlo Outcome Simulator
Tyre Model ─────────┤
Pit Hazard Model ───┘
```

### Pace predictor — current V1

- **Target:** `next_clean_lap_s` (next lap time; pit-in/out, SC, VSC, red-flag laps excluded)
- **Features:** tyre_age, compound, stint_no, position, gaps, rolling_median_3/5, rolling_std_5, race_progress, track_temp etc.
- **Baselines:** last-lap, rolling-3/5 median, team/session median
- **Primary:** LightGBM regression; quantile variant (q10/q50/q90) via `objective: quantile`
- **Evaluation:** chronological race holdout (never random lap split), segmented by circuit/driver/compound/regulation_era
- **Metrics:** MAE, RMSE, pinball loss, interval coverage, mean width, p95 latency

### Coming in V2

Tyre degradation proxy, pit discrete hazard (logistic → LightGBM → Cox/RSF via scikit-survival), Monte Carlo simulator (5–20k runs), SHAP TreeExplainer.

## MLOps lifecycle

- **MLflow** tracking + registry with mutable aliases: `models:/pitwall-pace@champion` / `@challenger`
- **Promotion gates** (`configs/promotion.yaml`): primary metric ≥2% gain, no subgroup >10% regression, coverage within tolerance, p95 <100ms, all contracts pass
- **Shadow deployment:** replay historical races, champion displayed, challenger logged, compare on delayed ground truth
- **Retraining:** triggered by new completed race / drift / manual dispatch (GitHub Actions `retrain.yml`, idempotent, never relies on exact cron)
- **Drift:** Evidently DataDriftPreset (feature / prediction / performance) on rolling 3-race window vs training reference

## Serving & observability

- **API:** FastAPI + WebSockets (UI snapshots ~250ms–1s, not raw 3.7 Hz)
- **Metrics:** `http_requests_total`, `inference_duration_seconds`, `event_processing_lag_seconds`, `pace_mae_seconds`, `drifting_features_ratio` … exposed at `/metrics`
- **Dashboards:** Prometheus → Grafana, Alertmanager → Slack/webhook
- **Frontend:** Next.js on Vercel Hobby (thin demo); full stack reproducible via `docker compose`

## Deployment

| Host | Role | Note |
|------|------|------|
| **GitHub Pages** | Next.js frontend (static export) | free, auto-deploys via `deploy-pages.yml`; demo data or `NEXT_PUBLIC_API_URL` to hosted API |
| **Vercel Hobby** | Next.js frontend (SSR alternative) | free, portfolio-appropriate |
| **GHCR + Render Free** | FastAPI (baked champion) via `publish-api.yml` | ephemeral FS, spins down after 15m idle; or `docker compose` |
| **Local Docker Compose** | Canonical full system | Postgres+Redis+MLflow+Prometheus+Grafana+full dataset |

> *The hosted demo runs a constrained inference/replay deployment. The full MLOps stack is reproducible locally through Docker Compose.*

### GitHub Pages (static dashboard)

The dashboard is statically exported (`output: export` when `STATIC_EXPORT=true`) and deploys to Pages on every push to `main`:

```yaml
# .github/workflows/deploy-pages.yml
# - actions/configure-pages@v5 + upload-pages-artifact + deploy-pages@v4
# - builds apps/web with STATIC_EXPORT=true + GITHUB_PAGES=true (derives basePath /<repo> automatically)
```

**One-time setup**

1. Create the GitHub repo (e.g. `youruser/PitWall-ML`) and push `main`:
   ```bash
   git remote add origin https://github.com/<user>/PitWall-ML.git
   git push -u origin main
   ```
2. In GitHub → Settings → Pages → **Build and deployment** → Source: **GitHub Actions** (not “Deploy from branch”).
3. Push to `main` or run `Deploy Frontend to GitHub Pages` manually (workflow_dispatch).  
   Result: `https://<user>.github.io/PitWall-ML/` (project site) or `https://<user>.github.io/` for a `*.github.io` repo — `next.config.js:1` auto-detects `GITHUB_REPOSITORY` and sets `basePath` accordingly. Override with `NEXT_PUBLIC_BASE_PATH` for a custom domain.

**Local Pages preview**

```bash
cd apps/web
STATIC_EXPORT=true npm run build   # → out/
npx serve out            # or: npm run build && npx http-server out
```

Set `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL` in `deploy-pages.yml` env to point the static demo at your hosted API (Render/Fly); otherwise it renders demo leaderboard data and “Awaiting replay events…”.

### CI/CD overview

| Workflow | Trigger | What it does |
|----------|---------|--------------|
| `ci.yml` | `push`/`pull_request` on `main` | Python 3.11 `ruff`/`mypy`/`pytest` (unit+leakage+integration+replay) + training smoke test + `docker compose config` + **both** frontend builds (SSR + static export) + `docker/build-push-action` cache |
| `deploy-pages.yml` | `push` to `main` touching `apps/web/**` + manual | `configure-pages` → `STATIC_EXPORT=true` build → `upload-pages-artifact` (`apps/web/out` + `.nojekyll`) → `deploy-pages@v4` |
| `publish-api.yml` | `push` to `main` touching `src/**`/`apps/api/**`/`Dockerfile` | `docker/login-action` → `docker/metadata-action` → `build-push-action` to `ghcr.io/<owner>/pitwall-api:latest` ( + `cache-from/to: gha`) |
| `retrain.yml` | `schedule: 17 3 * * 1` (Mon 03:17) + `workflow_dispatch` | stub detect-new-race → `pipelines.train --config production.yaml` → upload `artifacts/` |
| `promote.yml` | `workflow_dispatch` (`artifact_run_id`) + `environment: model-registry` | download candidate → register `@challenger` → shadow replay → `check_promotion` vs `configs/promotion.yaml` → promote `@challenger`→`@champion` |

## Roadmap

- [x] **V1 Weekend MVP** — ingestion, silver/gold, LightGBM pace + baselines, temporal eval, replay engine, FastAPI+WS, Next.js race screen, Docker, CI
- [ ] **V2 ML depth** — quantiles, tyre, pit hazard, simulation, MLflow registry, SHAP
- [ ] **V3 Production-like** — Prometheus/Grafana, Evidently, champion/challenger, shadow, retraining CI, Render/Vercel thin demo, optional OpenF1 MQTT live
- [ ] **V4 Advanced** — Feast, Prefect, Redis Streams/Redpanda, Terraform

## Repository hygiene

- Shared feature functions for offline/online to avoid skew; point-in-time tests in `tests/leakage/`
- Reproducibility manifest per run: `git_sha`, `data_snapshot`, `splits`, `features`, `params`, `metrics`
- `PacePrediction` enforces `q10 ≤ q50 ≤ q90`; `RaceEvent` separates `event_ts` / `ingest_ts`
- No fake metrics — tables are populated only by real pipeline runs

## License

MIT
