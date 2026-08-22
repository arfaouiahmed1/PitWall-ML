# PitWall ML — V4 Advanced Work Plan

> Decision-complete plan for a worker session (`/start-work`). No open questions.
> Baseline verified 2026-08-21 · git `main` @ `71c53aa` · origin `github.com/arfaouiahmed1/PitWall-ML`

## Objective
Ship V4 "Advanced" layer: local feature store with point-in-time joins, Prefect-style flow orchestration, Redis Streams event bus, infra parity spec — plus cleanup debt (Makefile stale targets, ruff lint) and roadmap checkoff. Zero new runtime dependencies.

## Baseline evidence (verified this session)
| Item | State |
|---|---|
| Commits on `origin/main` | `d0223d3` Pages/CD → `587fb3b` V2 ML depth → `91ca5be` V3 monitoring/drift → `71c53aa` fix(ci) buildx ref |
| CI | run `32479865127` ✅ success — python 5m35s (19 tests), frontend 58s (SSR + static export), docker 47s |
| GitHub Pages | `https://arfaouiahmed1.github.io/PitWall-ML/` HTTP 200, `build_type=workflow` enabled |
| GHCR | `ghcr.io/arfaouiahmed1/pitwall-api:latest` published on push (runs `32479100200`, `32479291959`) |
| Tests | `pytest -q` → 19 passed locally (`tests/unit/test_v2.py` ×6 incl.) |
| Frontend | `STATIC_EXPORT=true next build` → 17/17 pages, `out/` valid |
| Python | `.venv` 3.11.15 · `pyproject.toml` requires-python >=3.11 |

## Existing APIs the worker must reuse (do NOT re-implement)
- Features: `build_pace_features`, `get_feature_columns` (`src/pitwall/features/pace.py`), `build_tyre_features`, `get_tyre_feature_columns` (`features/tyre.py`), `build_pit_features`, `get_pit_feature_columns` (`features/pit.py`), `add_rolling_features`, `encode_compound` (`features/common.py`)
- Models (all have `save(path)` / `load(path)`): `PaceLightGBM`, `QuantileLightGBM` (`models/pace/lightgbm_model.py`), `TyreLightGBM` (`models/tyre/lightgbm_tyre.py`), `PitHazardLightGBM` (`models/pit/lightgbm_pit.py`)
- Pipelines: `python -m pipelines.train --config configs/development.yaml [--max-rows N] [--output-dir artifacts/X]` (synthetic fallback built-in), `python -m pipelines.features`, `python -m pipelines.ingest --season S --event E --session R`
- Drift: `detect_drift(reference, current, columns, threshold)` + `drift_on_window(gold)` in `src/pitwall/monitoring/drift.py`
- API: `apps/api/pitwall_api/main.py` — lifespan loads local artifacts (pace/quantile/tyre/pit), routes `/predictions/pace|tyre|pit`, `/models/info|shap`, `/registry/promotion`, `POST /simulate`, `/monitoring/drift|overview`, `WS /ws/race`
- Gold columns available after `build_pace_features`: `session_id, driver_number, lap_number, lap_time_s, compound, tyre_age, stint_no, position, rolling_median_3/5, rolling_std_5, race_progress, next_clean_lap_s, is_valid_training_lap_target`

---

## Work Item 1 — V4.1 Feature store (point-in-time, Feast-style, parquet-backed)
**Create `src/pitwall/features/store.py`:**

```python
@dataclass
class FeatureView:
    name: str                      # e.g. "pace"
    entities: list[str]            # ["session_id", "driver_number"]
    event_ts_col: str = "event_ts"
    features: list[str] = []       # [] = all non-entity/non-ts cols
    ttl_days: float = 365.0

class FeatureStore:
    def __init__(self, root="data/store") -> None
    def register(self, view: FeatureView, df: pl.DataFrame) -> Path
        # writes root/<name>/data.parquet (entities + ts + features only)
        # writes root/<name>/meta.json {name, entities, event_ts_col, features, ttl_days, rows}
    def list_views(self) -> list[dict]
    def get_historical_features(self, entity_df: pl.DataFrame, view_name: str,
                                feature_refs=None) -> pl.DataFrame
        # POINT-IN-TIME: sort both by event_ts_col, join_asof(strategy="backward", by=entity keys)
        # fallback when entity_df lacks ts col: group_by(keys).last() then left join on keys
    def get_online_features(self, view_name: str, entity_keys: dict) -> dict
        # filter by keys, sort by ts, tail(1) → flat dict

def materialize_gold_store(gold: pl.DataFrame, root="data/store") -> FeatureStore
    # registers views: "pace" (rolling_median_3/5, rolling_std_5, tyre_age, stint_no,
    #   lap_number, position, race_progress, compound, next_clean_lap_s),
    #   "tyre" (tyre_age, tyre_age_sq?, stint_no, compound), "pit" (tyre_age, stint_no, position, compound, race_progress)
```
Notes: no external deps (polars only). If `event_ts_col` missing in df, synthesize constant column so meta stays consistent. Entity keys intersected with available columns.

**Tests — create `tests/unit/test_store.py` (~6 tests):**
1. register → `list_views()` returns metadata with correct rows/features
2. historical features return ONLY rows with `ts <= query ts` (construct 2-session df, query mid-point, assert no future values leak) — mirrors `tests/leakage/test_no_leakage.py` style
3. online fetch returns latest row per entity
4. fallback path works when entity_df has no ts column
5. `materialize_gold_store` creates 3 views from synthetic silver→gold
6. unknown view raises FileNotFoundError

**Accept:** `pytest tests/unit/test_store.py -q` green; full suite still ≥19 passed.

---

## Work Item 2 — V4.2 Prefect-style local flow runner (zero deps)
**Create `src/pitwall/orchestration/__init__.py` + `flow.py`:**

```python
def task(_fn=None, *, retries=0, backoff_s=2.0):   # decorator, records retries
def flow(name: str):                               # decorator wrapping a run(cfg) function
class FlowRunner:
    def __init__(self, config: dict) -> None       # config from configs/flow.yaml
    def run(self, steps: list[str], dry_run=False) -> dict
        # sequential execution; each step resolves to registry entry:
        STEPS = {"ingest": ..., "features": ..., "train": ..., "drift": ...}
        # train step shells: python -m pipelines.train --config <cfg> --output-dir artifacts/candidate
        # drift step: builds gold (reuse pipelines/train.load_data path or read data/gold),
        #             calls drift_on_window(gold), writes artifacts/drift/report.json
        # retry w/ backoff on exception; abort chain on failure unless step marked allow_fail
        # manifest: {"run_id", "started_at", "steps": [{"name","status","duration_s","error"}]}
        # write artifacts/flow/<run_id>/manifest.json
```
**Create `configs/flow.yaml`:**
```yaml
name: daily-retrain
steps:
  - {name: features, module: pipelines.features}
  - {name: train, cmd: "python -m pipelines.train --config configs/development.yaml --output-dir artifacts/candidate"}
  - {name: drift, allow_fail: true}
```
**Create `pipelines/flow_cli.py`:** argparse `--config`, `--steps` (subset), `--dry-run` (prints plan, executes nothing); prints manifest path at end.

**Tests — create `tests/unit/test_flow.py` (~4 tests):** dry-run executes nothing but validates config; failing task retries then reports error status; successful chain writes manifest.json; steps subset filtering works.

**Accept:** `pytest tests/unit/test_flow.py -q`; `python -m pipelines.flow_cli --config configs/flow.yaml --dry-run` prints plan.

---

## Work Item 3 — V4.3 Redis Streams event bus (optional-at-runtime)
**Create `src/pitwall/eventbus/__init__.py` + `stream.py`:**

```python
class EventBus(Protocol):
    def publish(self, stream: str, payload: dict) -> None: ...
    def consume(self, stream: str, group: str, consumer: str, count=10, block_ms=1000) -> list[dict]: ...

class InMemoryBus:   # deque-based, for tests + redis-less dev
class RedisStreamBus:  # XADD (dict-flat payload json-encoded), XREADGROUP with consumer groups,
                       # lazy connect from REDIS_URL env; NOOP-publish if unreachable (log warn once)
def get_bus() -> EventBus  # factory: RedisStreamBus if REDIS_URL set & reachable else InMemoryBus
```
**Modify `apps/api/pitwall_api/main.py` WS handler:** after building each `msg`, call `get_bus().publish(f"pitwall:race:{race_state.session_id}", msg)` wrapped in try/except (never break replay). No other route changes.

compose.yaml already runs `redis:7-alpine` — no infra change needed.

**Tests — create `tests/unit/test_eventbus.py` (~3 tests):** InMemoryBus publish/consume roundtrip preserves order; RedisStreamBus falls back gracefully (mock/fake connection failure → publish no-op); `get_bus()` returns InMemoryBus without REDIS_URL.

**Accept:** `pytest tests/unit/test_eventbus.py -q`; existing `tests/integration/test_api.py` still green (WS behavior unchanged when bus absent).

---

## Work Item 4 — V4.4 Terraform-lite infra parity (docs, not runnable TF)
**Create `infra/PARITY.md`:** table mapping each compose service → free-tier cloud equivalent + constraint:
postgres→Render Postgres free/Neon, redis→Upstash free, mlflow→GHCR-hosted container on Render w/ persistent disk caveat OR MLflow SQLite-on-render, api→Render Free (already in `infra/render.yaml`), prometheus/grafana→Grafana Cloud free, web→GitHub Pages (live).
Include "what Terraform would own" section + example HCL snippet block (documented-only).

---

## Work Item 5 — Cleanup debt (required before merge)
1. **Makefile stale targets** (currently reference non-existent modules — broken):
   - `features:` → `$(PY) -m pipelines.features`
   - `train-pace:` → `$(PY) -m pipelines.train --config configs/development.yaml`
   - `ingest:` already OK (`pitwall.ingestion.cli` exists? verify; else switch to `-m pipelines.ingest`)
   - `evaluate:` references `pitwall.pipeline.evaluate` (doesn't exist) → replace with promotion gate call: `$(PY) -c "from pitwall.registry.promotion import check_promotion_from_files; ..."` or remove target
   - `validate:` uses `pitwall.data.quality` CLI that doesn't exist → replace with tiny inline script calling `check_silver_laps` or remove
   - `replay:` references `pitwall.replay` (doesn't exist) → remove or repoint to uvicorn note
2. **ruff lint debt** (CI currently tolerates via `|| echo`):
   - E501 long lines: `pipelines/train.py:62`, `pipelines/ingest.py:34`, `apps/api/pitwall_api/main.py:167,398,444`
   - SIM105 try-except-pass ×3 in `main.py` → `with contextlib.suppress(Exception)`
   - F841 unused vars: `gold_path` (main.py ~395), `prob` (main.py ~282), `sess` (ingest.py:25 → rename `_sess` or use)
   - I001 import sort (main.py ~390)
   - Fix all, then **restore strict CI**: `ci.yml` line ~27 back to plain `ruff check .`
3. **Dockerfile alignment:** `FROM python:3.12-slim` → `python:3.11-slim` (matches `requires-python >=3.11` and CI matrix).

**Accept:** `ruff check .` exit 0 locally; CI green with strict lint.

---

## Work Item 6 — Docs + roadmap checkoff
README.md: mark V3 `[x]` with one-line evidence (Grafana dashboard JSON, drift endpoint, alerts); add V4 bullet list (feature store, flow runner, event bus, PARITY.md); bump structure tree with `orchestration/`, `eventbus/`, `features/store.py`.

---

## TODOs

1. [x] WI1: Feature store — create `src/pitwall/features/store.py` (FeatureView, FeatureStore.register/list_views/get_historical_features point-in-time join_asof/get_online_features, materialize_gold_store) + `tests/unit/test_store.py` (~6 tests); accept: pytest tests/unit/test_store.py green, full suite ≥19 passed
2. [x] WI2: Flow runner — create `src/pitwall/orchestration/__init__.py` + `flow.py` (task/flow decorators, FlowRunner with STEPS registry, retry/backoff, manifest at artifacts/flow/<run_id>/manifest.json) + `configs/flow.yaml` + `pipelines/flow_cli.py` (--config/--steps/--dry-run) + `tests/unit/test_flow.py` (~4 tests); accept: pytest green, dry-run prints plan
3. [x] WI3: Event bus — create `src/pitwall/eventbus/__init__.py` + `stream.py` (EventBus protocol, InMemoryBus, RedisStreamBus lazy-connect from REDIS_URL with graceful no-op fallback, get_bus factory) + hook publish into WS handler in `apps/api/pitwall_api/main.py` (try/except, never break replay) + `tests/unit/test_eventbus.py` (~3 tests); accept: pytest green, integration test_api.py still green
4. [x] WI4: Infra parity — create `infra/PARITY.md` mapping compose services → free-tier cloud equivalents + "what Terraform would own" section + documented-only HCL snippet
5. [x] WI5: Cleanup debt — fix Makefile stale targets (features→pipelines.features, train-pace→pipelines.train, evaluate/validate/replay broken refs), ruff lint fixes (E501 train.py:62 ingest.py:34 main.py:167/398/444, SIM105 ×3 main.py, F841 gold_path/prob/sess, I001 main.py ~390), Dockerfile python:3.12-slim→3.11-slim, restore strict `ruff check .` in ci.yml; accept: ruff check exit 0
6. [x] WI6: Docs — README roadmap V3 [x] with evidence, V4 bullet list, structure tree bump (orchestration/, eventbus/, features/store.py)

## Final Verification Wave

F1. [x] Full suite — `.\.venv\Scripts\python.exe -m pytest -q` → 32 passed (19 baseline + 13 new), zero failures
F2. [x] Strict lint — `.\.venv\Scripts\ruff.exe check .` exit 0 AND `ruff format --check .` clean (81 files)
F3. [x] Frontend build — `cd apps\web; npm run build` compiles successfully (17/17 pages)
F4. [ ] Compose valid — `docker compose config >/dev/null` exit 0; commit + push, CI workflows green on GitHub

## Execution order & commit plan
1. Item 1 (store+tests) → commit `feat(v4): feature store — point-in-time joins, online/offline serving`
2. Item 2 (orchestration) → `feat(v4): flow runner + configs/flow.yaml + CLI`
3. Item 3 (eventbus + API hook) → `feat(v4): redis streams event bus (graceful fallback)`
4. Item 5 (cleanup + strict lint) → `chore(v4): makefile/ruff/dockerfile cleanup, restore strict lint`
5. Items 4+6 (docs) → `docs(v4): infra parity + roadmap checkoff`
Push after each green `pytest -q && ruff check . && cd apps/web && npm run build`.

## Verification checklist (worker must run all)
```powershell
.\.venv\Scripts\python.exe -m pytest -q                 # expect 19 + ~13 new = ~32 passed
.\.venv\Scripts\ruff.exe check .                        # exit 0 (strict restored)
cd apps\web; npm run build                              # compiles
docker compose config >/dev/null                        # still valid
git push                                                # CI + Pages workflows green
```

## Out of scope (explicitly)
Real `feast`/`prefect` packages, OpenF1 MQTT live (€9.90/mo), Redpanda swap, actual terraform apply, model quality improvements, simulator perf tuning beyond current batch mode.
