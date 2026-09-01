# PitWall ML — Real-Time F1 Race Intelligence & Strategic Brain

> A race-engineering intelligence platform for Formula 1 timing and telemetry data. It watches every lap like a pit-wall strategist, predicts calibrated lap pace intervals, assesses opponent undercut threats, forecasts neutralization hazards, and runs thousands of Monte Carlo simulations to show you the race before it happens.

[![CI](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/ci.yml/badge.svg)](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/ci.yml)
[![Deploy to GitHub Pages](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/arfaouiahmed1/PitWall-ML/actions/workflows/deploy-pages.yml)
![Python](https://img.shields.io/badge/python-3.11%2B-blue)
![Next.js](https://img.shields.io/badge/Next.js-14-black)
![Prometheus](https://img.shields.io/badge/Prometheus-Alerting-orange)
![Grafana](https://img.shields.io/badge/Grafana-10%2B-F46800)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#license)

---

## Live Operations Center Demo

**🏎️ Launch Interactive Race Cockpit: [https://arfaouiahmed1.github.io/PitWall-ML/](https://arfaouiahmed1.github.io/PitWall-ML/)**

* **Race Cockpit (`/`)**: Live leaderboard with $q_{10}$–$q_{50}$–$q_{90}$ calibrated pace bands, tyre degradation rings, mini-sector split heatmaps, AWS-style strategy battle cards, and animated circuit minimap with real-time driver spline interpolation.
* **Strategy Sandbox (`/strategy`)**: Interactive What-If scenario generator dispatching live simulation deltas (re-entry traffic position, net race time, win probability delta, and degradation cliff risk).
* **Driver Telemetry (`/drivers`)**: Dual-driver head-to-head telemetry overlay (synchronized speed, throttle, brake pressure, gear, active aero status, and 6-dimension performance radar).
* **Circuit & Schedule (`/circuit`)**: Vector circuit layouts across 16 canonical Grand Prix circuits with turn numbers, DRS / X-Mode straight markers, speed traps, and live track weather.
* **Model Intelligence (`/models`)**: Model registry hierarchy, SHAP local/global attributions, conformal quantile calibration curves, and subgroup error matrices.
* **MLOps & Drift (`/monitoring`)**: 2025→2026 regulation era drift monitor (Wasserstein $W_1$, Kolmogorov-Smirnov $p$-value, PSI, and Jensen-Shannon divergence) plus real-time serving health gauges.

---

## System Architecture

```
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                     DATA SOURCES                          │
                                    │  FastF1 (Historical) · OpenF1 (Stream) · Jolpica (Timing) │
                                    └─────────────────────────────┬─────────────────────────────┘
                                                                  │
                                                                  ▼
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                  BRONZE / SILVER LAKE                     │
                                    │  Bronze Parquet  ──▶  Polars Normalization / Clean Flags │
                                    │  Silver Laps · Telemetry · Weather · Race Control         │
                                    └─────────────────────────────┬─────────────────────────────┘
                                                                  │
                                                                  ▼
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                  GOLD FEATURE STORE                       │
                                    │  Point-in-Time Backward Asof Joins (Zero Target Leakage)  │
                                    │  Rolling Pace · Non-Linear Hard Tyre · Telemetry Dynamics │
                                    │  Weather Telemetry · 2026 Active Aero (X/Z-Mode)          │
                                    └─────────────────────────────┬─────────────────────────────┘
                                                                  │
                                                                  ▼
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                   MODELING LADDER                         │
                                    │  Baselines (LastLap, RollingMed3, Ridge)                  │
                                    │  Champion LightGBM & CatBoost Regressors                  │
                                    │  Conformalized Quantile Regression (q10, q50, q90 + CQR)  │
                                    │  Opponent Undercut Model · Safety Car Logistic Hazard     │
                                    └─────────────────────────────┬─────────────────────────────┘
                                                                  │
                                                                  ▼
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                 MLOPS & REGISTRY LAYER                    │
                                    │  MLflow Experiment Tracking (@champion / @challenger)     │
                                    │  Automated Shadow Evaluation & Promotion Gate Checks      │
                                    │  Evidently Drift Engine (PSI, Wasserstein W₁, KS test)   │
                                    └─────────────────────────────┬─────────────────────────────┘
                                                                  │
                                                                  ▼
                                    ┌───────────────────────────────────────────────────────────┐
                                    │                  REAL-TIME SERVING                        │
                                    │  FastAPI REST Endpoints (/health, /predictions, /whatif)  │
                                    │  WebSocket Replay Engine (1x, 5x, 20x, MAX, STEP)         │
                                    │  Monte Carlo Multi-Driver Stochastic Simulation Engine    │
                                    └──────────────┬─────────────────────────────┬──────────────┘
                                                   │                             │
                                                   ▼                             ▼
                    ┌───────────────────────────────────────────┐   ┌───────────────────────────┐
                    │            NEXT.JS 14 FRONTEND            │   │  PROMETHEUS & GRAFANA     │
                    │  Live Race Cockpit · Strategy Sandbox     │   │  Tuned Race Alerts        │
                    │  Telemetry Overlays · Era Drift Dashboard │   │  4-Row Executive ML Board │
                    └───────────────────────────────────────────┘   └───────────────────────────┘
```

---

## Data Science Lifecycle (CRISP-DM & TDSP)

PitWall ML was engineered across six systematic data science iterations following **CRISP-DM** (Cross-Industry Standard Process for Data Mining) and **TDSP** (Team Data Science Process):

```
┌───────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       CRISP-DM / TDSP ITERATION LOOPS                                  │
│                                                                                                       │
│  [Loop 1: MVP Baseline]           [Loop 2: Quantile & Simulation]     [Loop 3: Continual Drift]       │
│  • Point-in-time Target           • q10/q50/q90 LightGBM              • Shadow Replay Engine          │
│  • Baseline vs LightGBM           • Conformal Coverage CQR            • Evidently 3-Race Rolling      │
│  • Leakage Test Harness           • 5000-sample Monte Carlo           • Automated Gate Promotion      │
│                │                                   │                                  │               │
│                ▼                                   ▼                                  ▼               │
│  [Loop 4: Physics & Weather]      [Loop 5: Model Bake-Off & LOFO]     [Loop 6: Strategic Brain]       │
│  • 15-min As-Of Weather Join      • 6-Model Comparative Ladder        • Rival Undercut Hazard Model   │
│  • Lift/Coast & Brake Dynamics    • Systematic LOFO Ablation          • Safety Car Logistic Hazard    │
│  • Hard Non-Linear Warmup Phase   • 5-Fold Walk-Forward Backtest      • Interactive POST /whatif API  │
└───────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Empirical Model Performance Comparison

Evaluated on held-out chronological Grand Prix races under identical cross-validation holdouts:

| Model / Stage | Pace MAE (s) | Pace RMSE (s) | 80% Coverage | Mean Width (s) | Pit AUC / Hazard | Inference p95 |
|:---|---:|---:|---:|---:|---:|---:|
| **LastLap Baseline** ($y_{pred} = y_{t}$) | 1.84 s | 3.12 s | — | — | — | 0.1 ms |
| **Rolling Median (3)** | 1.42 s | 2.54 s | — | — | — | 0.2 ms |
| **Ridge Regression (L2)** | 1.38 s | 2.45 s | — | — | — | 1.1 ms |
| **Pace LightGBM (Point)** | 0.94 s | 1.78 s | — | — | 0.81 | 4.8 ms |
| **CatBoost Pace Model** | 0.91 s | 1.72 s | — | — | 0.82 | 6.2 ms |
| **Quantile LightGBM + CQR** *(Champion)* | **0.88 s** | **1.65 s** | **81.4%** | **2.18 s** | **0.84** | **7.6 ms** |
| *Unfiltered Raw Baseline (SC/Rain noise)* | *8.44 s* | *12.58 s* | *6.0%* | *2.47 s* | *0.66* | *13.1 ms* |

---

## Core Capabilities & Features

### 1. Calibrated Quantile Pace Engine
Instead of giving a brittle single-lap estimate, PitWall ML solves quantile loss functions at $\alpha \in \{0.10, 0.50, 0.90\}$ with Conformalized Quantile Regression (CQR) calibration, producing robust $80\%$ coverage bands that adapt dynamically to tyre compound, track temperature, and traffic.

### 2. Hard Compound Thermal & Degradation Non-Linearity
Hard tyres exhibit an initial graining/warmup plateau (laps 1–3) followed by progressive degradation, breaking linear assumptions. PitWall ML engineers explicit warmup indicators (`tyre_warmup_phase`), track temperature interaction terms (`compound_temp_interaction`), and non-linear stint progression ratios.

### 3. Opponent Undercut & Overcut Hazard Modeling
Analyzes rival car delta windows ($< 1.8\text{ s}$ trailing gap), tyre age differentials, and relative compound softness to compute undercut threat scores and recommend tactical countermeasures (`COVER_UNDERCUT`, `EXTEND_OVERCUT`, or `HOLD`).

### 4. Safety Car & Neutralization Logistic Hazard
Predicts the instantaneous hazard of a Safety Car or Virtual Safety Car deployment based on historical circuit neutralization priors (e.g. Monaco $80\%$ vs Monza $25\%$), lap progress (opening lap congestion vs late attrition), active track flags, and rain transitions.

### 5. Monte Carlo Stochastic Strategy Simulator
Samples thousands of race continuations drawing lap times from predictive distributions, injecting pit stops according to hazard probabilities and track pit loss ($22\text{ s}$ average). Delivers full probability distributions for win, podium, and points finishes.

### 6. 2025 → 2026 Regulation Era Drift Intelligence
Monitors the regime shift between ground-effect cars (2025) and active aerodynamics / revised power units (2026) using Wasserstein distance ($W_1$), Kolmogorov-Smirnov statistics, Population Stability Index (PSI), and Jensen-Shannon divergence across speed traps, braking intensity, and lift-and-coast energy management.

---

## Observability & Production MLOps

### Prometheus Alerts (`monitoring/alerts.yml`)
* `PaceMaeHighWarning`: Fires when champion pace MAE exceeds $2.5\text{ s}$ for 10 minutes.
* `PaceMaeCritical`: Fires when champion pace MAE exceeds $3.5\text{ s}$ for 5 minutes.
* `WassersteinDriftHigh`: Fires when feature $W_1$ distance exceeds $1.5$.
* `PSIDriftSevere`: Fires when feature Population Stability Index exceeds $0.25$.
* `ModelSubgroupRegression`: Alerts when Hard compound error exceeds $5.0\text{ s}$.
* `IntervalCoverageLow`: Triggers if conformal coverage drifts outside $[72\%, 88\%]$.

### Grafana 4-Row Executive Board (`monitoring/grafana/dashboards/pitwall.json`)
* **Row 1 — Executive ML Health**: Champion MAE stat, 80% Coverage gauge, inference p95 latency, rolling drift ratio.
* **Row 2 — Model Accuracy & Subgroups**: Time-series of MAE by model alias (`champion` vs `challenger`), per-compound MAE bar chart, tyre degradation MAE, and pit classifier AUC.
* **Row 3 — Regulation Era Drift**: Top 10 drifting features by PSI and Wasserstein distance, KS $p$-value heatmaps.
* **Row 4 — Real-Time Service Telemetry**: Ingestion event rate, processing lag, active WebSocket connections, and feature freshness.

---

## Quick Start & Reproduction

### Prerequisites
* Python 3.11+
* Node.js 18+
* Docker & Docker Compose (Optional for full stack)

### 1. Local Python Environment & Data Lake
```bash
# Bootstrap virtual environment and dependencies
make bootstrap

# Launch background services (PostgreSQL, Redis, MLflow)
make services

# Ingest historical session data (Silver Parquet lake)
python -m scripts.bootstrap_silver --season 2024 --require-complete

# Build Gold feature store with point-in-time joins
python -m pipelines.features --season 2024
```

### 2. Model Training, Multi-Model Bake-Off & LOFO Ablation
```bash
# Run multi-model bakeoff and train champion model
python -m pipelines.train --config configs/production.yaml --output-dir artifacts/candidate

# Execute systematic Leave-One-Feature-Out (LOFO) ablation study
python -m pipelines.ablation --config configs/production.yaml
```

### 3. Serving API & Real-Time WebSockets
```bash
# Start FastAPI serving backend (port 8000)
python -m uvicorn apps.api.pitwall_api.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Interactive Next.js Frontend
```bash
cd apps/web
npm install
npm run dev
# Open http://localhost:3000 in your browser
```

### 5. Full Containerized Stack with Observability
```bash
# Launch API, Replay Engine, Prometheus, Grafana, and MLflow in Docker
docker compose --profile monitoring up --build
```
* **Frontend Cockpit**: `http://localhost:3000`
* **FastAPI Docs**: `http://localhost:8000/docs`
* **Prometheus Targets & Alerts**: `http://localhost:9090`
* **Grafana Dashboards**: `http://localhost:3001` (Default: `admin` / `admin`)
* **MLflow Tracking Server**: `http://localhost:5000`

---

## API & WebSocket Contract

### REST Endpoints
* `GET /health` — Service readiness, model version, and connected race state.
* `GET /metrics` — Prometheus metrics exposition.
* `GET /predictions/pace` — Active $q_{10}/q_{50}/q_{90}$ lap forecasts for all drivers.
* `GET /predictions/tyre` — Tyre degradation slopes and remaining tyre life.
* `GET /predictions/pit` — Instantaneous 1-lap and 3-lap pit hazard probabilities.
* `POST /whatif` — Real-time tactical strategy evaluation.
* `POST /simulate` — Multi-driver Monte Carlo outcome simulation.
* `GET /monitoring/drift` — Evidently drift metrics and feature PSI ranking.

### WebSocket Stream (`ws://localhost:8000/ws/race?speed=5x`)
Streams live `race_update` packets containing synchronized timing, telemetry, model predictions, and safety car / track status events.

---

## Testing & Quality Assurance

```bash
# Format and lint code
make lint

# Run unit tests, leakage tests, integration tests, and replay harness
make test-all
```

---

## License

MIT License. Designed and engineered for high-performance motorsport intelligence.
