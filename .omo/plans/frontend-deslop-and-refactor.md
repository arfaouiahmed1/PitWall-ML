# frontend-deslop-and-refactor - Work Plan

## TL;DR (For humans)

**What you'll get:** An end-to-end modernization and deslopping of PitWall ML. This replaces fake math, hardcoded data presented as current, and inaccurate track drawings with timestamped source data, persistent storage, exposed ML endpoints, interactive API documentation, attributable circuit geometry, reusable telemetry graphs, and verified deployment/operations controls.

**Why this approach:** Rather than treating this as a cosmetic CSS touch-up, we address the root causes of lackluster implementation: disconnected network streams, client-side synthetic math (modulo arithmetic, sine waves, ASCII hashing), unexposed backend Python ML models, and fragmented bespoke SVG components. By establishing a shared singleton WebSocket event bus, persistent ingestion layer, and pre-bundled authentic circuit vectors, the cockpit becomes an authentic, reliable engineering tool.

**What it will NOT do:**
- It will NOT alter core ML model training pipelines, feature store parquet schemas, or evaluation algorithms in `src/pitwall/models/`.
- It will NOT install heavy, unstyled external charting libraries (D3, Chart.js, Recharts, Plotly) - all charts are native SVG/Canvas primitives styled with Tailwind CSS.
- It will NOT fabricate fallback data. Static export may render an explicit unavailable/offline state until a live backend is configured.
- It will NOT introduce non-F1 light mode or purple neon gradient AI slop.

**Effort:** XL (43 atomic implementation todos across 11 coordinated execution waves)
**Risk:** High - cross-layer live ingestion, persistent deployment state, security/CORS, MLOps, and production deployment; mitigated by staged automated gates, real HTTP/browser smoke, exact provenance, least-privilege secrets, and rollback evidence.
**Decisions I made for you:**
- Dual-tier live storage: Bronze Parquet micro-batches with automatic session finalization to `events.parquet` (preserving 100% replay compatibility with `ParquetReplaySource`), combined with SQLite (local/test) and PostgreSQL (Docker Compose via `asyncpg`) for fast relational queries.
- ReUI + shadcn/ui integration: Installing official ReUI primitives (data-grid, calendar, filters) with Radix UI, Lucide icons, and Tailwind CSS, mapped to dark telemetry tokens.
- Circuit vector bundling: Bundle reproducibly converted, MIT-attributed community GeoJSON shapes with per-asset provenance; do not call them FIA official or invent track metadata.
- Zero em-dashes (`—`/`–`) everywhere: Standardizing all missing telemetry empty states to ASCII `"-"` or `"N/A"` so the anti-slop ban has zero exceptions.
- Swagger explorer at `/api-docs`: Embedded styled iframe pointing to `${NEXT_PUBLIC_API_URL}/docs` with a fallback static OpenAPI schema card on HTTPS GitHub Pages deployments to avoid mixed-content blocks.
- Data integrity: no generated/demo telemetry in production UI. Offline, missing, or stale observations show explicit unavailable/reason/source time instead of plausible mock values.
- Deployment: use repository's existing GitHub Pages and GHCR/container targets only; do not invent hosting. If production API URL/secrets/backend target are absent, deploy only what is safe and mark API deployment blocked with exact inputs required.

Your next move: Approve the plan or execute via `$start-work frontend-deslop-and-refactor`. Full execution detail follows below.

---

> TL;DR (machine): XL effort, elevated operational risk. 43 implementation todos across 11 waves + 4 final verification tasks. Includes truthful live data, no synthetic placeholder metrics, timestamped scrubbing, security/CORS, MLOps state, staged CI/CD, GPT-6 Luna default routing, deployment smoke/rollback.

## Scope

### Must have
- Backend asynchronous live ingestion worker (`src/pitwall/ingestion/live_recorder.py`) polling OpenF1 and pushing to internal EventBus.
- Dual-tier storage: Micro-batched Bronze Parquet event writer (`data/bronze/live/{session_id}/`) with session finalizer and relational database tables (SQLite/PostgreSQL via `aiosqlite`/`asyncpg`) with `POST /live/start`, `POST /live/stop`, and `GET /live/status` routes.
- New ML REST endpoints in `apps/api/pitwall_api/main.py`: `GET /predictions/undercut`, `GET /predictions/safety-car`, `GET /monitoring/era-drift`, `GET /circuits/{id}`, and `GET /circuits`.
- Interactive Swagger API explorer page in Next.js cockpit (`apps/web/app/api-docs/page.tsx`) and navigation link in `SiteHeader.tsx`.
- Singleton WebSocket broadcast event bus (`apps/api/pitwall_api/broadcaster.py` and `apps/web/lib/useRaceSocket.ts`), eliminating duplicate sockets and error code 1008 disconnects.
- Licensed, source-derived community circuit shape geometry bundled with source revision, asset provenance, and bundled MIT attribution. Unsourced turn, speed trap, sector and DRS facts are unavailable, not guessed.
- ReUI and shadcn/ui design system setup with Tailwind CSS tokens and core primitives (`Button`, `Card`, `Badge`, `Tabs`, `Dialog`, `Tooltip`, `Separator`, `Table`, `DataGrid`).
- Custom ESLint linter configuration (`apps/web/.eslintrc.json`) enforcing component boundaries, banning em-dashes (`—`/`–`), and prohibiting modulo arithmetic hacks in JSX.
- Reusable SVG telemetry chart primitives: `TelemetryTraceChart`, `GapTrajectoryChart`, `PerformanceRadarChart`, `FeatureWaterfallChart`, and `CalibrationCurveChart`.
- Complete elimination of synthetic math formulas: driver dot modulo placement, ASCII sector hashing, sine wave stint laps, and overtake linear formulas.
- Full modularization of `app/page.tsx`, `components/RaceTable.tsx`, `components/CircuitMap.tsx`, `app/strategy/page.tsx`, `app/models/page.tsx`, `app/monitoring/page.tsx`, and `app/drivers/`.
- Dual deployment parity: Docker Compose production orchestration and Next.js static export with `<Suspense>` boundaries, explicit service health/state, valid production CORS, deployment smoke checks, and rollback instructions.
- Source timestamp/provenance, stale-state reporting, sample-accurate time scrub and raw throttle/brake/speed graphs.
- Security: protected live mutation endpoints, exact CORS origins, no committed production secrets, no unsafe public wildcard permissions.
- MLOps runtime readiness: persistent state after restarts, honest model/data/DB/ingestion health, drift/cache freshness, actionable monitoring and alerts.
- Multi-stage CI/CD with hard gates, artifact security, staged deploy, post-deploy validation, and rollback rehearsal/evidence.
- No fake or placeholder telemetry/metrics in user-visible application surfaces. Missing, stale, or offline data is labeled with reason and source timestamp or shown as unavailable.
- Real-time graphs preserve source timestamps and raw measured speed/throttle/brake/gear/DRS values; scrubber labels bind to those samples, not synthetic spacing or smoothing.
- Secure deployment: API key protection for live-control mutations, exact allowed-origin configuration, no wildcard credentialed CORS, no production-default credentials, and documented secrets handling.
- Multi-stage CI/CD gates for backend tests/types/lint/security, frontend lint/types/build/visual E2E, container scans, staging smoke, protected production deploy, post-deploy health, and rollback.

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Must NOT modify existing ML training pipelines (`pipelines/train.py`), ablation experiments (`pipelines/ablation.py`), or champion model artifacts in `artifacts/champion/`.
- Must NOT introduce external heavyweight charting libraries (D3, Chart.js, Recharts, Plotly).
- Must NOT break static export mode (`npm run build` with `STATIC_EXPORT=true`) for GitHub Pages deployment, but offline mode must not show invented race/model data.
- Must NOT install `swagger-ui-react` as a package in `apps/web/package.json` (use zero-bundle styled iframe pointing to `${API_URL}/docs`).
- Must NOT introduce light mode or non-F1 color palettes (pure black drop shadows, neon purple button glows).
- Must NOT leave dead stub routes in production (remove `app/race/page.tsx`).

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD for backend storage/API endpoints (pytest), automated typecheck (`tsc --noEmit`), strict linting (`npm run lint`), and headless browser validation (Playwright).
- Evidence: `.omo/evidence/task-<N>-frontend-deslop-and-refactor.<ext>`

## Execution strategy

### Parallel execution waves
- **Wave 1: Backend Live Ingestion & Persistent Storage Layer** (Todos 1-4)
- **Wave 2: Core ML Endpoint Exposure & OpenAPI Documentation** (Todos 5-7)
- **Wave 3: Unified WebSocket Event Bus & Server Concurrency Fix** (Todos 8-9)
- **Wave 4: ReUI, shadcn/ui & Custom Anti-Slop ESLint Linter** (Todos 10-12)
- **Wave 5: Interactive Swagger API Explorer & Documentation** (Todos 13-14)
- **Wave 6: Authentic F1 Track SVGs & Geometric Centerline Assets** (Todos 15-17)
- **Wave 7: Reusable Telemetry Chart Primitives** (Todos 18-21)
- **Wave 8: Main Cockpit Dashboard Deslop & Modularization** (Todos 22-25)
- **Wave 9: Analytics, Strategy & Driver Intelligence Views** (Todos 26-29)
- **Wave 10: Deployment Hardening & CI/CD Pipelines** (Todos 30-32)
- **Wave 11: Data Integrity, Timestamp UX, Security, MLOps & Actual Deployment Verification** (Todos 34-41)
- **Wave 11: Data Integrity, Timestamp UX, Security, MLOps & Actual Deployment Verification** (Todos 34-41)

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1-4 (Wave 1) | None | 5, 8 | None |
| 5-7 (Wave 2) | 1-4 | 8, 13 | 10-12, 15-17 |
| 8-9 (Wave 3) | 1, 5 | 22-25 | 10-12, 15-17 |
| 10-12 (Wave 4) | None | 18-21, 22-25 | 5-7, 15-17 |
| 13-14 (Wave 5) | 5-7 | 30 | 18-21 |
| 15-17 (Wave 6) | None | 22, 29 | 5-7, 10-12 |
| 18-21 (Wave 7) | 10-12 | 22, 26, 27 | 13-14, 15-17 |
| 22-25 (Wave 8) | 8-9, 10-12, 15-17, 18-21 | 30-32 | 26-29 |
| 26-29 (Wave 9) | 5-7, 8-9, 10-12, 18-21 | 30-32 | 22-25 |
| 30-32 (Wave 10) | 22-25, 26-29 | F1-F4 | None |
| 34-36 (data correctness) | 8-9, 15-21 | 22-29 | security/CORS, MLOps |
| 37 (security/CORS) | 4, 8, 13 | 38-41 | timestamp and graph audit |
| 38 (MLOps state) | 1-7, 30, 34 | 39-41 | UI accuracy audit |
| 39 (multi-stage CI/CD) | 12, 30-38 | 40-41 | None |
| 40 (production deployment) | 39 | 41 | None |
| 41 (deployed-state QA/rollback) | 40 | F1-F4 | None |
| 34-36 (data correctness) | 8-9, 15-21 | 22-29 | CORS/security, MLOps |
| 37 (security/CORS) | 4, 8, 13 | 38-41 | timestamp / graph audits |
| 38 (MLOps state) | 1-7, 30 | 39-41 | UI accuracy audit |
| 39 (multi-stage CI/CD) | 12, 30-38 | 40-41 | None |
| 40 (production deployment) | 39 | 41 | None |
| 41 (deployed state + rollback) | 40 | F1-F4 | None |

## Todos

- [x] 1. Build Live Ingestion Worker Service (`src/pitwall/ingestion/live_recorder.py`)
  What to do: Implement `LiveRaceRecorder` class capable of polling OpenF1 endpoints (`/position`, `/intervals`, `/laps`, `/stints`, `/car_data`, `/weather`) with an async rate-limiter (shared `httpx.AsyncClient`, min 1.5s per endpoint, weather staggered at 30s), normalizing incoming payloads to `RaceEvent` instances, running live inference, and pushing to the FastAPI EventBus.
  Must NOT do: Do not use synchronous blocking HTTP calls. Do not trigger HTTP 429 errors.
  Parallelization: Wave 1 | Blocked by: None | Blocks: Todo 2, 4
  References: `src/pitwall/ingestion/openf1.py:20-68`, `apps/api/pitwall_api/live_data.py:100-185`, `src/pitwall/schemas/events.py:15-40`
  Acceptance criteria: `python -m pytest tests/unit/test_live_recorder.py` passes with mocked OpenF1 client.
  QA scenarios: Happy path: poll session with valid events and assert `RaceEvent` emitted. Failure path: simulate OpenF1 500 error and verify exponential backoff with zero unhandled exceptions. Evidence: `.omo/evidence/task-1-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(ingest): add async live race recorder with rate-limiting and event normalization

- [x] 2. Implement Micro-Batched Bronze Parquet Writer with Replay Finalizer (`src/pitwall/storage/parquet_writer.py`)
  What to do: Implement `ParquetPartitionWriter` that buffers incoming raw `RaceEvent` objects in memory and flushes them to disk as partitioned Parquet files (`data/bronze/live/{session_id}/part-{seq}.parquet`). On session stop or checkpoint, consolidate partitions into `data/bronze/live/{session_id}/events.parquet` and update `src/pitwall/ingestion/replay.py::discover_replay_sessions` to discover live captured sessions.
  Must NOT do: Do not write individual Parquet files per single event (prevents disk I/O thrashing).
  Parallelization: Wave 1 | Blocked by: Todo 1 | Blocks: Todo 3, 4
  References: `src/pitwall/ingestion/replay.py:25-90`, `src/pitwall/schemas/events.py`
  Acceptance criteria: Buffered events write valid Parquet files readable by `polars.read_parquet` and discovered by `discover_replay_sessions()`.
  QA scenarios: Happy path: buffer 500 events, finalize session, verify replay discovery lists the live session. Failure path: trigger write with empty buffer, verify no empty files written. Evidence: `.omo/evidence/task-2-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(storage): implement micro-batched bronze parquet partition writer with replay discovery compatibility

- [x] 3. Build Dual-Engine Relational Storage Layer (`src/pitwall/storage/db.py`, `models.py`)
  What to do: Add `aiosqlite>=0.20` and `asyncpg>=0.29` to `pyproject.toml`. Implement SQLAlchemy 2.0 async engine and declarative models for `LiveSession`, `LiveDriverLap`, `LiveStint`, and `LiveHazardLog`. Support seamless fallback to `sqlite+aiosqlite:///data/pitwall.db` when PostgreSQL is not configured, and update `compose.yaml` to `postgresql+asyncpg://pitwall:pitwall@postgres:5432/pitwall`.
  Must NOT do: Do not hardcode PostgreSQL-only dialect extensions that break SQLite in test environments.
  Parallelization: Wave 1 | Blocked by: None | Blocks: Todo 4
  References: `src/pitwall/state/race_state.py:15-60`, `compose.yaml:63`, `pyproject.toml:18-25`
  Acceptance criteria: `pytest tests/unit/test_db_storage.py` passes under both SQLite and PostgreSQL.
  QA scenarios: Happy path: insert live lap record, query by session_id and driver_number. Failure path: database connection error handled with warning and graceful memory buffer. Evidence: `.omo/evidence/task-3-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(storage): implement dual-engine async sqlite/postgres persistence with aiosqlite and asyncpg

- [x] 4. Expose Live Ingestion Control Endpoints (`POST /live/start`, `POST /live/stop`, `GET /live/status`)
  What to do: Add REST endpoints in `apps/api/pitwall_api/main.py` allowing clients to start live capture for a session, stop recording and finalize Parquet partitions, and poll current status (active session, event count, latency).
  Must NOT do: Do not allow concurrent conflicting live recorder instances.
  Parallelization: Wave 1 | Blocked by: Todo 1, 2, 3 | Blocks: Todo 8
  References: `apps/api/pitwall_api/main.py:520-560`
  Acceptance criteria: `curl -s -X POST http://localhost:8000/live/start -d '{"session_key":"latest"}'` returns HTTP 200 with status JSON.
  QA scenarios: Happy path: start recording, verify status returns running. Failure path: double start returns idempotent `already_running` response. Evidence: `.omo/evidence/task-4-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(api): add live ingestion control and status endpoints

- [x] 5. Expose Opponent Pit Model Endpoint (`GET /predictions/undercut`)
  What to do: Add endpoint in `apps/api/pitwall_api/main.py` integrating `src/pitwall/models/pit/opponent_model.py::OpponentPitModel`. Accept optional query parameters (`driver_number`, `rival_number`, `gap_s`, `driver_compound`, `rival_compound`, `driver_tyre_age`, `rival_tyre_age`) with fallback to current `race_state` when omitted.
  Must NOT do: Do not crash when `race_state.drivers` is empty (return unpopulated structure with reason).
  Parallelization: Wave 2 | Blocked by: Todo 4 | Blocks: Todo 8, 22
  References: `src/pitwall/models/pit/opponent_model.py:15-120`, `apps/api/pitwall_api/main.py`
  Acceptance criteria: Endpoint returns `UndercutThreat` Pydantic model with `is_undercut_threat`, `rival_pit_probability_3l`, and `recommended_action`.
  QA scenarios: Happy path: query with gap_s=1.2s and tyre age delta=6 laps, expect `COVER_UNDERCUT`. Failure path: query with invalid driver number, expect HTTP 400 or empty threat model. Evidence: `.omo/evidence/task-5-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(api): expose opponent pit undercut and overcut threat prediction endpoint

- [x] 6. Expose Safety Car Hazard Model Endpoint (`GET /predictions/safety-car`)
  What to do: Add endpoint in `apps/api/pitwall_api/main.py` integrating `src/pitwall/models/safety_car/hazard.py::SafetyCarHazardModel`. Return `NeutralizationPrediction` containing `p_sc_next_1`, `p_vsc_next_1`, `p_neutralization_next_3`, and `circuit_risk_tier`.
  Must NOT do: Do not hardcode static safety car probabilities.
  Parallelization: Wave 2 | Blocked by: Todo 4 | Blocks: Todo 8, 24
  References: `src/pitwall/models/safety_car/hazard.py:20-140`, `apps/api/pitwall_api/main.py`
  Acceptance criteria: `curl -s http://localhost:8000/predictions/safety-car?circuit_id=monaco` returns risk tier `VERY_HIGH` and valid probability floats.
  QA scenarios: Happy path: query Monaco circuit, assert p_sc_next_1 > 0.15. Failure path: query unknown circuit, assert fallback to medium risk prior without crashing. Evidence: `.omo/evidence/task-6-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(api): expose safety car and neutralization hazard prediction endpoint

- [x] 7. Expose Cached Era Drift Report (`GET /monitoring/era-drift`) & Circuit Endpoints
  What to do: Expose `src/pitwall/monitoring/drift_era.py` via `GET /monitoring/era-drift` using a pre-computed startup cache so it returns in <50ms. Return computed metrics only when both source eras and eligible feature rows are present; otherwise return a typed explicit `no_data` status. Add `GET /circuits` and `GET /circuits/{id}` exposing only track configurations registered in `src/pitwall/regulations/circuits.py`.
  Must NOT do: Do not recompute statistical tests synchronously on every incoming HTTP request.
  Parallelization: Wave 2 | Blocked by: Todo 4 | Blocks: Todo 27, 28
  References: `src/pitwall/monitoring/drift_era.py:30-180`, `src/pitwall/regulations/circuits.py:25-110`
  Acceptance criteria: Endpoint returns cached `EraDriftReport` JSON in <100ms. When applicable real source rows exist, each reported feature contains Wasserstein, KS, PSI, and JS metrics; when source eras or eligible feature rows are absent, response says `status: no_data` with an empty result array and reason, never fabricated zero-valued metrics.
  QA scenarios: Happy path: fixture real rows for both era labels and at least five observations per feature, then GET returns all 4 metrics for eligible features. Failure path: no matching eras, verify `no_data` and no computed rows. Circuit QA: `/circuits` enumerates registered backend configs, `/circuits/monza` returns config, unknown id returns 404. Evidence: `.omo/evidence/task-7-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(api): expose cached era drift report and circuit metadata endpoints

- [x] 8. Implement Singleton WebSocket Broadcaster (`apps/api/pitwall_api/broadcaster.py`)
  What to do: Create an asynchronous `RaceBroadcaster` service managing client subscriptions via `asyncio.Queue` fan-out. On initial client connect, immediately emit the latest `RaceState` snapshot frame so clients render without waiting for the next lap event. Fix `main.py::ws_race` so connecting clients receive shared broadcast stream frames instead of creating competing `ParquetReplaySource` loops. Support both `replay_id` and `source=live` modes.
  Must NOT do: Do not allow multiple connected browser tabs to overwrite global `race_state`.
  Parallelization: Wave 3 | Blocked by: Todo 4, 5 | Blocks: Todo 9, 22
  References: `apps/api/pitwall_api/main.py:809-840`, `src/pitwall/ingestion/replay.py`
  Acceptance criteria: 5 concurrent WebSocket clients connect simultaneously and receive synchronized identical `race_update` frames.
  QA scenarios: Happy path: connect two websocket clients, verify both receive matching sequence numbers and initial state snapshot. Failure path: client disconnects, broadcaster cleans up queue without leaking memory. Evidence: `.omo/evidence/task-8-frontend-deslop-and-refactor.json`.
  Commit: Y | fix(api): replace per-socket loops with centralized broadcast event bus and initial state frame

- [x] 9. Refactor Web Cockpit WebSocket Engine (`apps/web/lib/useRaceSocket.ts`)
  What to do: Update `useRaceSocket.ts` to accept `replayId` and `source` (`live` | `replay`). Fix the query string generation to send `?replay_id=${id}&speed=${speed}` or `?source=live`. Parse full prediction payload (`q10`, `q50`, `q90`, `tyre_deg`, `pit_next_3`) into snapshot state. Deprecate duplicate WebSocket inside `useRaceSnapshot.ts`.
  Must NOT do: Do not omit `replay_id` when in replay mode (prevents code 1008 disconnect).
  Parallelization: Wave 3 | Blocked by: Todo 8 | Blocks: Todo 22-25
  References: `apps/web/lib/useRaceSocket.ts:160-205`, `apps/web/lib/useRaceSnapshot.ts:172-240`
  Acceptance criteria: `useRaceSocket` maintains stable open connection without 1008 errors and exposes full prediction telemetry.
  QA scenarios: Happy path: connect to backend replay, assert connection flag=true and q10/q50/q90 state populated. Failure path: backend disconnects, exponential backoff reconnects automatically. Evidence: `.omo/evidence/task-9-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): unify websocket connection engine with full prediction parsing

- [x] 10. Configure ReUI Registry & shadcn/ui Dependencies (`apps/web/package.json`, `components.json`)
  What to do: Add `@radix-ui/react-slot`, `@radix-ui/react-tabs`, `@radix-ui/react-dialog`, `@radix-ui/react-tooltip`, `@radix-ui/react-dropdown-menu`, `lucide-react`, and `class-variance-authority` to `apps/web/package.json`. Add ReUI registry (`@reui`) to `components.json`. Configure `opencode.json` with ReUI MCP server (`https://mcp.reui.io`). Map shadcn/ui semantic HSL color tokens in `apps/web/app/globals.css` directly to existing `pitwall-*` color hexes.
  Must NOT do: Do not change font stacks or break dark mode theme tokens.
  Parallelization: Wave 4 | Blocked by: None | Blocks: Todo 11, 12
  References: `apps/web/tailwind.config.js:10-35`, `apps/web/app/globals.css`, `https://reui.io/docs`
  Acceptance criteria: `npm install` runs cleanly in `apps/web` and CSS variables resolve to dark telemetry palette.
  QA scenarios: Happy path: load page, verify background matches #080c14 and card matches #0f172a. Failure path: verify light mode defaults to high-contrast dark telemetry theme. Evidence: `.omo/evidence/task-10-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): install radix dependencies and initialize reui/shadcn tokens

- [x] 11. Implement Core UI Primitives from ReUI / shadcn (`apps/web/components/ui/`)
  What to do: Generate or install foundational UI primitives under `apps/web/components/ui/`: `button.tsx`, `card.tsx`, `badge.tsx`, `tabs.tsx`, `dialog.tsx`, `tooltip.tsx`, `separator.tsx`, `table.tsx`, and `dropdown-menu.tsx`. Ensure all components adhere to strict dark telemetry aesthetics (1.5px borders, monospace numeric badges).
  Must NOT do: Do not hand-roll custom SVG icon paths (use `lucide-react`).
  Parallelization: Wave 4 | Blocked by: Todo 10 | Blocks: Todo 18-29
  References: `apps/web/components/DataBadge.tsx`, `apps/web/components/ops/`
  Acceptance criteria: All 9 primitives render in test harness with zero TypeScript diagnostics.
  QA scenarios: Happy path: render button with variant="outline", verify focus ring and active state. Failure path: render disabled button, verify pointer-events-none and opacity-50. Evidence: `.omo/evidence/task-11-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): add shadcn/reui core ui primitives with dark telemetry styling

- [x] 12. Configure Custom Anti-Slop ESLint Linter Rules (`apps/web/.eslintrc.json`)
  What to do: Update `apps/web/.eslintrc.json` with strict ESLint rules: (1) `no-restricted-imports` enforcing UI element imports from `@/components/ui/*`, (2) anti-slop rule banning em-dashes (`—`/`–`) in JSX elements (standardizing table empty states to ASCII `"-"` or `"N/A"`), (3) `no-restricted-syntax` prohibiting arithmetic modulo (`%`) on driver numbers, (4) rule banning hardcoded mock constants in page files, and (5) remove `eslint: { ignoreDuringBuilds: true }` from `next.config.js`.
  Must NOT do: Do not allow em-dashes anywhere in visible JSX text or template literals.
  Parallelization: Wave 4 | Blocked by: Todo 10 | Blocks: Todo 22-29
  References: `apps/web/.eslintrc.json`, `apps/web/next.config.js:27`, `.github/workflows/ci.yml:63`
  Acceptance criteria: `npm run lint` executes in `apps/web` and catches prohibited patterns with exit code 1.
  QA scenarios: Happy path: clean codebase passes linting with 0 errors. Failure path: add test component with `driver_number % 7` or em-dash, verify lint fails. Evidence: `.omo/evidence/task-12-frontend-deslop-and-refactor.json`.
  Commit: Y | chore(web): configure custom anti-slop eslint rules and enforce build-time linting

- [x] 13. Build Interactive Swagger UI Page in Cockpit with Mixed-Content Guard (`apps/web/app/api-docs/page.tsx`)
  What to do: Create a dedicated page at `/api-docs` that embeds the backend OpenAPI documentation. Implement a zero-bundle styled container with an `<iframe>` pointing to `${NEXT_PUBLIC_API_URL}/docs`. Include a client-side origin check: if running under HTTPS on GitHub Pages and `NEXT_PUBLIC_API_URL` is HTTP or unreachable, display a styled static OpenAPI documentation card with live curl examples, schema viewer, and direct link to container backend docs.
  Must NOT do: Do not install `swagger-ui-react` into `package.json`.
  Parallelization: Wave 5 | Blocked by: Todo 7 | Blocks: Todo 14, 30
  References: `apps/api/pitwall_api/main.py:72`, `apps/web/next.config.js`
  Acceptance criteria: Navigating to `http://localhost:3000/api-docs` renders the interactive Swagger UI interface without mixed-content console errors.
  QA scenarios: Happy path: load `/api-docs` on localhost, verify iframe points to active API docs. Failure path: load on HTTPS GitHub Pages, verify clean static OpenAPI viewer renders. Evidence: `.omo/evidence/task-13-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): add interactive swagger api documentation view with mixed-content guard

- [x] 14. Integrate API Docs into Global Navigation (`apps/web/components/SiteHeader.tsx`)
  What to do: Keep the accessible "API DOCS" navigation item and active-route behavior. Replace static `CALENDAR_2025` total-lap lookup and fixed "2025/26 season" badge with API/session-sourced metadata; if active backend session lacks a circuit or lap total, show `N/A` and do not imply live. Status, lap, source time and provenance must come from the unified live/replay snapshot.
  Must NOT do: Do not hardcode total laps, season label, current status, or server time in the header. Do not fall back to a static calendar for a live session.
  Parallelization: Wave 5 | Blocked by: Todo 13 | Blocks: Todo 22
  References: `apps/web/components/SiteHeader.tsx:15-60`
  Acceptance criteria: Header renders API Docs link and correct active state; live/replay labels and lap total are from current backend session payload; absent session metadata renders N/A/offline with provenance reason; 2025/26 decorative season badge and static lap fallback removed.
  QA scenarios: Happy path: click API Docs tab, verify active route styling and sourced live metadata. Failure path: no backend/session metadata displays N/A, not a calendar-derived total. Verify mobile hamburger includes API Docs link and no horizontal overflow. Evidence: `.omo/evidence/task-14-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): add api explorer link and dynamic circuit metadata to site header

- [x] 15. Replace Unverified Circuit Vectors with Licensed GeoJSON Centerlines (`apps/web/lib/circuits/`)
  What to do: Replace the hand-authored/inferred paths with track geometries derived from `https://github.com/bacinger/f1-circuits`, whose repository lists GeoJSON tracks and an MIT license (Copyright 2019-2025 Tomislav Bacinger). Vendor source GeoJSON or reproducible converted coordinates, include the license/attribution, and record source commit/hash and source circuit file per asset. Normalize shape coordinates for the renderer, but do not label them FIA official. Only include circuits with actual source geometry; do not manufacture coordinates. Keep turn, sector, speed-trap, and DRS metadata only when independently sourced and traceable. Unsupported overlays must render unavailable rather than fabricated.
  Must NOT do: Do not describe these community vectors as official FIA geometry. Do not infer turn apexes, speed traps, sector splits, or DRS zones from shape paths and present guesses as data. Do not copy from Formula-Timer or Sportmonks pages without explicit downloadable redistribution terms. No runtime external fetch.
  Parallelization: Wave 6 correction | Blocked by: None | Blocks: Todo 16, 17, 22.
  References: `apps/web/lib/circuits/data/*.ts`, `apps/web/lib/circuits/types.ts`, `apps/web/components/circuit/TrackGeometry.tsx`, `https://github.com/bacinger/f1-circuits`, `https://github.com/bacinger/f1-circuits/blob/master/LICENSE.md`.
  Acceptance criteria: Every bundled circuit shape matches its cited GeoJSON source after documented projection/normalization within defined tolerance; each asset carries provenance; LICENSE/attribution is bundled. An independently rendered Monza comparison verifies recognizable chicanes, oval banking/approach, and Curva Grande geometry; unsupported DRS/sectors/turn markers are absent or explicitly unavailable.
  QA scenarios: Happy path: run registry validation against source hashes, render Monza and Monaco in browser at desktop/mobile, verify same topology and no clipping. Failure path: remove or corrupt a source feature and assert build/test rejects it; unknown circuit has unavailable state rather than Monza presented under another name. Evidence: `.omo/evidence/task-15-frontend-deslop-and-refactor.json`.
  QA finding to resolve: Real Edge QA captured desktop Monza and mobile Monaco; the mobile screenshot shows the track fully legible but schedule/date and circuit-header labels are ellipsized, and an earlier Playwright measurement reported 584px document width at 375px. Correct responsive page composition/labels without shrinking or hiding the track, then recapture 375px evidence. Geometry conversion/provenance is source-pinned and tested.
  Commit: Y | feat(web): pre-bundle authentic f1 circuit vector geometries into typed registry

- [x] 16. Build Parameterized Spline Track Engine (`apps/web/components/circuit/TrackGeometry.tsx`)
  What to do: Implement a reusable SVG track renderer that consumes source-derived circuit geometry, renders the circuit outline, and maps drivers along the spline using accurate fractional lap distance (`0.0..1.0`). Only render turn badges, sector divisions, DRS zones, and speed traps when independently sourced metadata is present; otherwise render the shape only and indicate metadata is unavailable.
  Must NOT do: Do not use modulo arithmetic on driver numbers to calculate positions.
  Parallelization: Wave 6 | Blocked by: Todo 15 | Blocks: Todo 17, 22
  References: `apps/web/components/CircuitMap.tsx:500-650`
  Acceptance criteria: TrackGeometry renders the actual source-derived SVG path and driver markers at `SVGPathElement.getPointAtLength`; absent overlay metadata produces no inferred markers/sector zones.
  QA scenarios: Happy path: driver at distance 0.5 renders at midpoint of source spline. Failure path: invalid distance clamps to `[0,1]`; missing sector/DRS metadata does not invent overlays. Evidence: `.omo/evidence/task-16-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): implement accurate spline-based circuit track geometry component

- [x] 17. Refactor Monolithic Circuit Map Component (`apps/web/components/CircuitMap.tsx`)
  What to do: Keep `CircuitMap.tsx` modular with `TrackGeometry`, bind driver positions only to live telemetry, and retain accurate source provenance for selected track. Remove static/synthetic driver baselines and sector-dominance overlays unless sourced live sector times are present; expose explicit unavailable state otherwise.
  Must NOT do: Do not retain synthetic `setInterval` artificial driver movement loops.
  Parallelization: Wave 6 | Blocked by: Todo 16 | Blocks: Todo 22
  References: `apps/web/components/CircuitMap.tsx:1-1048`
  Acceptance criteria: `CircuitMap.tsx` remains <300 lines; only source-derived vector shapes and real telemetry markers appear; no invented markers or fallback drivers are shown as live.
  QA scenarios: Happy path: render a sourced circuit and live positions; Failure path: unavailable sector/driver metadata shows explicit unavailable state, never synthetic positions. Evidence: `.omo/evidence/task-17-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): modularize circuit map visualizer with externalized vector assets

- [x] 18. Build Multi-Channel Telemetry Trace Chart (`apps/web/components/charts/TelemetryTraceChart.tsx`)
  What to do: Create a high-performance SVG/Canvas telemetry trace viewer under `components/charts/` displaying synchronized speed, throttle, brake, gear, and DRS traces over distance/time. Implement responsive hover scrubbing with crosshair and exact delta tooltips between two compared drivers.
  Must NOT do: Do not import D3 or Chart.js.
  Parallelization: Wave 7 | Blocked by: Todo 11 | Blocks: Todo 29
  References: `apps/web/components/TelemetryOverlay.tsx:215-280`
  Acceptance criteria: Component renders 250 telemetry points with crisp rendering, zero layout shift, and smooth hover scrubbing.
  QA scenarios: Happy path: scrub across distance axis, verify speed and throttle tooltips display accurate numbers. Failure path: telemetry array empty, renders clean empty-state placeholder with ASCII hyphen. Evidence: `.omo/evidence/task-18-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): create multi-channel telemetry trace chart primitive

- [x] 19. Build Dynamic Gap Trajectory Chart (`apps/web/components/charts/GapTrajectoryChart.tsx`)
  What to do: Create a strategy gap evolution chart under `components/charts/` displaying baseline vs what-if delta trajectories over 15 laps. Calculate dynamic viewBox bounding boxes based on actual min/max deltas (replaces brittle fixed 55px offset that clipped at >3.0s).
  Must NOT do: Do not allow SVG polyline coordinates to overflow container boundaries.
  Parallelization: Wave 7 | Blocked by: Todo 11 | Blocks: Todo 26
  References: `apps/web/app/strategy/page.tsx:295-320`
  Acceptance criteria: Trajectory renders cleanly across arbitrary delta ranges (e.g. -5.0s to +8.0s) with zero clipping.
  QA scenarios: Happy path: input trajectory with -4.2s delta, verify zero-axis and path remain inside viewBox. Failure path: single point trajectory handled without SVG NaN errors. Evidence: `.omo/evidence/task-19-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): create dynamic gap trajectory chart with auto-scaling bounds

- [x] 20. Build Parameterized Performance Radar Chart (`apps/web/components/charts/PerformanceRadarChart.tsx`)
  What to do: Create a reusable 6-to-8 axis radar chart under `components/charts/` parameterized with metrics (`high_speed`, `low_speed`, `traction`, `tyre_conservation`, `energy_efficiency`, `straight_line`). Replace the 3 duplicated copy-pasted implementations in `app/drivers/page.tsx`, `DriverDetailClient.tsx`, and `TelemetryOverlay.tsx`.
  Must NOT do: Do not hardcode fixed pixel radiuses.
  Parallelization: Wave 7 | Blocked by: Todo 11 | Blocks: Todo 29
  References: `apps/web/app/drivers/page.tsx:180-210`, `apps/web/app/drivers/[driver]/DriverDetailClient.tsx:110-140`
  Acceptance criteria: Single reusable component supports head-to-head series with customizable colors and size; no measured series renders explicit unavailable state, partial dimensions are disclosed, and invalid axes never emit NaN geometry.
  QA scenarios: Happy path: pass two measured vectors, verify overlapping polygons render with distinct fills. Failure path: invalid bounds or missing vector dimensions show unavailable/partial status without substituting zero ratings or NaN SVG. Edge browser verified the no-series state; measured-series and responsive composition remain in the final visual QA audit. Evidence: `.omo/evidence/task-20-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): create unified parameterized performance radar chart primitive

- [x] 21. Build SHAP Waterfall & Calibration Charts (`apps/web/components/charts/`)
  What to do: Create `FeatureWaterfallChart.tsx` with a discriminated contract: local signed waterfall only when actual local SHAP contributions plus baseline/output exist; global `/models/shap` values render sorted global-importance ranking and must not claim local lap-time deltas. `CalibrationCurveChart.tsx` plots only empirically measured nominal/observed coverage points.
  Must NOT do: Do not fabricate delta values via `(v / 100) * 0.9 - 0.35`.
  Parallelization: Wave 7 | Blocked by: Todo 11 | Blocks: Todo 27
  References: `apps/web/app/models/page.tsx:160-195`, `apps/web/app/models/page.tsx:335-360`
  Acceptance criteria: Local waterfall renders actual signed values/baseline; global model SHAP renders importance-sorted ranking, not signed impact. Calibration has no invented/interpolated points and only marks 80% target when a measured nominal .8 point exists.
  QA scenarios: Happy path: render local positive and negative SHAP features and assert cumulative baseline; render global values and assert descending importance order. Failure path: empty data renders explicit no-data state; missing empirical levels are not synthesized. Evidence: `.omo/evidence/task-21-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(web): create signed shap waterfall and conformal calibration chart primitives

- [ ] 22. Deslop and Refactor Main Cockpit Page (`apps/web/app/page.tsx`)
  What to do: Eliminate the duplicate WebSocket hook call in `app/page.tsx`. Remove the driver dot modulo placement formula `(row.driver_number % 7) * 0.003` and sector dominance ASCII hashing `code.charCodeAt(0) % 5`. Wire track positions to real interval gaps from the live snapshot, and connect the undercut alert banner to `GET /predictions/undercut`.
  Must NOT do: Do not retain any artificial modulo math or character code hashing.
  Parallelization: Wave 8 | Blocked by: Todo 9, 11, 17 | Blocks: Todo 30
  References: `apps/web/app/page.tsx:60-120`
  Acceptance criteria: `app/page.tsx` renders live leaderboard and circuit visualizer with zero ESLint anti-slop violations.
  QA scenarios: Happy path: load `/`, verify single WebSocket connection active and real intervals displayed. Failure path: disconnect backend, verify clean offline standby banner. Evidence: `.omo/evidence/task-22-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): deslop main cockpit page and eliminate synthetic calculations

- [~] 23. Modularize Leaderboard Table with ReUI DataGrid (`apps/web/components/RaceTable.tsx`)
  What to do: Refactor the 514-line `RaceTable.tsx` monolith into modular subcomponents: `RaceTableRow.tsx`, `DriverPaceSparkline.tsx`, and `TyreStintBadge.tsx`. Implement ReUI DataGrid patterns with column sorting, sticky headers, and expandable driver telemetry rows. Bind pace predictions directly to incoming `q10`, `q50`, `q90` models. Standardize missing telemetry tokens to ASCII `"-"`.
  Must NOT do: Do not synthesize fallback lap times using `79.2 + tyreAge * 0.05`. Do not use em-dashes `—`.
  Parallelization: Wave 8 | Blocked by: Todo 9, 11 | Blocks: Todo 30
  References: `apps/web/components/RaceTable.tsx:1-514`
  Acceptance criteria: Table renders 20 drivers with sorting, expandable telemetry drawers, and zero synthetic math heuristics.
  QA scenarios: Happy path: click column header to sort by gap or pace, verify correct order. Failure path: driver lap time missing, renders standardized ASCII "-" fallback token with WCAG AA contrast. Evidence: `.omo/evidence/task-23-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): modularize race table with reui data-grid architecture
  Blocker: Table-local fake formulas were removed and extraction/sort/expand behavior plus focused test and lint pass. `useRaceSnapshot.normalizeRow` still synthesizes identity, position, tyre, and age values before rows reach the component; scope was left untouched. No browser QA was possible because port 3000 is unavailable. Reopen the upstream normalization/API contract and browser checks before calling this fully complete.

- [~] 24. Refactor Race Control Event Feed (`apps/web/components/EventFeed.tsx`)
  What to do: Connect `EventFeed.tsx` directly to the live WebSocket eventbus stream (`useRaceSocket.events`). Display live safety car status, sector flags, fastest laps, and pit stop notices with timestamps. Connect safety car probability badge to `GET /predictions/safety-car`. Remove static hardcoded `MOCK_EVENTS` array.
  Must NOT do: Do not display static `"Last SC: Lap 28"` copy when live events are active.
  Parallelization: Wave 8 | Blocked by: Todo 6, 9, 11 | Blocks: Todo 30
  References: `apps/web/components/EventFeed.tsx:15-95`
  Acceptance criteria: Feed updates dynamically as incoming events arrive over the WebSocket stream.
  QA scenarios: Happy path: emit safety car event over socket, verify banner immediately turns yellow/orange with SC badge. Failure path: no events received, displays empty state "Awaiting race events". Evidence: `.omo/evidence/task-24-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): connect event feed to live websocket eventbus stream
  Blocker: Source and focused socket/feed contract test plus scoped ESLint pass. Browser smoke is blocked because prior Next.js ports timed out; the parent closed the project Next.js dev servers at the user's request. Reopen once a dev server can be started and browser route exercised.

- [x] 25. Refactor Sector Dominance Console (`apps/web/components/TrackDominance.tsx`)
  What to do: Replace the ASCII character code hashing in `TrackDominance.tsx` with actual sector times ($S_1, S_2, S_3$) parsed from `RaceEvent` payloads. Highlight fastest driver per sector with authentic team color badges.
  Must NOT do: Do not use driver name character codes to fabricate sector times.
  Parallelization: Wave 8 | Blocked by: Todo 9, 11 | Blocks: Todo 30
  References: `apps/web/components/TrackDominance.tsx:1-120`, `apps/web/app/page.tsx:84-95`
  Acceptance criteria: Sector dominance shows real sector leaders with millisecond deltas based on validated lap records.
  QA scenarios: Happy path: pass real sector times, verify fastest driver highlighted in purple. Failure path: missing sector time displays placeholder dash without NaN error. Evidence: `.omo/evidence/task-25-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): bind track dominance console to validated sector telemetry

- [x] 26. Refactor Strategy Sandbox with Monte Carlo Engine & Honest Offline State (`apps/web/app/strategy/page.tsx`)
  What to do: Refactor `strategy/page.tsx` to connect to `POST /whatif` and `POST /simulate`. Replace brittle SVG polyline with `GapTrajectoryChart`. Add Monte Carlo simulation runner allowing users to trigger 500-2000 runs and view actual backend position distributions. Offline state must say unavailable with timestamp/reason, never show demo values as results. Wrap `useSearchParams()` in `<Suspense>`.
  Must NOT do: Do not execute client-side hardcoded tyre cliff formulas.
  Parallelization: Wave 9 | Blocked by: Todo 11, 19 | Blocks: Todo 30
  References: `apps/web/app/strategy/page.tsx:1-350`, `apps/api/pitwall_api/main.py:730-795`
  Acceptance criteria: Strategy page evaluates scenarios via backend API and renders gap trajectories without clipping.
  QA scenarios: Happy path: adjust pit lap slider to Lap 24, click simulate, verify backend returns updated win prob delta and chart renders. Failure path: backend returns 500, displays inline error banner with retry option. Evidence: `.omo/evidence/task-26-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): integrate strategy sandbox with backend monte carlo simulation and suspense guard

- [~] 27. Refactor Model Intelligence Page with Honest Missing-Model State (`apps/web/app/models/page.tsx`)
  What to do: Replace static benchmark matrices and `challengerMetrics` with live API calls to `/models/info`, `/models/shap`, and `/benchmarks/challengers`. Use `FeatureWaterfallChart` only for actual local SHAP values; use importance ranking for global values. Calibration displays only measured points. Offline or absent artifacts render unavailable with source/observed timestamp, never baked mock results.
  Must NOT do: Do not hardcode static benchmark PASS badges in JSX.
  Parallelization: Wave 9 | Blocked by: Todo 7, 11, 21 | Blocks: Todo 30
  References: `apps/web/app/models/page.tsx:50-200`
  Acceptance criteria: Model page displays actual metrics from `metrics.json` and true SHAP values from `artifacts/champion/shap_summary.json`.
  QA scenarios: Happy path: page loads champion MAE and coverage directly from backend response. Failure path: backend offline, displays pre-baked benchmark fixture with explicit "OFFLINE STANDBY DEMO" badge. Evidence: `.omo/evidence/task-27-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): bind model intelligence page to dynamic backend benchmarks and shap
  Blocker: Implementation, API contract inspection, focused tests, and lint pass. Whole-project typecheck has an unrelated existing `NormalizedGapPoint` export error in `GapTrajectorySvg.tsx`; real page/browser QA remains blocked because port 3000 timed out and alternate Next.js startup exceeded the bounded execution window. Reopen when a responsive app server/browser endpoint is available.

- [~] 28. Refactor MLOps & Era Drift Dashboard with Source Freshness (`apps/web/app/monitoring/page.tsx`)
  What to do: Bind `monitoring/page.tsx` to `/monitoring/era-drift` and `/monitoring/overview`. Show only observed metrics with source/sample/observed timestamps and stale status. Remove zero-filling and static latency cards. When drift is no_data, explain that source eras or feature rows are unavailable instead of substituting fabricated metrics.
  Must NOT do: Do not display fake static latency cards.
  Parallelization: Wave 9 | Blocked by: Todo 7, 11 | Blocks: Todo 30
  References: `apps/web/app/monitoring/page.tsx:25-90`
  Acceptance criteria: Dashboard renders all 4 statistical drift tests per feature without zeros.
  QA scenarios: Happy path: load `/monitoring`, verify 14 features display genuine KS, Wasserstein, and PSI values. Failure path: drift calculation fails, displays clear degraded mode badge. Evidence: `.omo/evidence/task-28-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): connect mlops dashboard to multi-metric era drift api
  Blocker: Implementation, focused parser tests, and page lint pass. Whole-project typecheck has the unrelated existing `NormalizedGapPoint` export error in `GapTrajectorySvg.tsx`; browser QA could not start because the current port-3000 server timed out and alternate startup exceeded the bounded execution window. Reopen after restoring an accessible app server/browser.

- [x] 29. Refactor Driver Telemetry & Head-to-Head Views (`apps/web/app/drivers/`)
  What to do: Eliminate `RADAR_MOCK` dictionary from `app/drivers/page.tsx` and `DriverDetailClient.tsx`. `cars.py` profiles are chassis/team-level, not driver-measured; show those only when explicitly labeled as team/car model data, and show driver performance as unavailable unless a real per-driver measured profile exists. Eliminate the trigonometric sine wave stint generator and use historical lap records only. Replace inline SVG traces with timestamped `TelemetryTraceChart` and `PerformanceRadarChart`. Remove dead redirect stub `app/race/page.tsx`.
  Must NOT do: Do not fabricate telemetry corner delta speeds using integer arithmetic.
  Parallelization: Wave 9 | Blocked by: Todo 11, 18, 20 | Blocks: Todo 30
  References: `apps/web/app/drivers/page.tsx:1-220`, `apps/web/app/drivers/[driver]/DriverDetailClient.tsx:1-180`
  Acceptance criteria: Driver telemetry displays authentic speed/throttle/brake traces and valid stint lap histories.
  QA scenarios: Happy path: select Norris vs Verstappen, verify telemetry trace overlays and radar polygon comparisons. Failure path: driver has no telemetry, displays clean offline placeholder without crashing. Evidence: `.omo/evidence/task-29-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): bind driver telemetry and head-to-head comparison to live traces

- [ ] 30. Optimize Multi-Stage Dockerfiles and Compose Stack (`compose.yaml`, `Dockerfile.web`)
  What to do: Update `compose.yaml` to ensure all services (`postgres`, `redis`, `mlflow`, `api`, `web`, `prometheus`, `grafana`) boot with proper healthcheck dependencies. Use `postgresql+asyncpg://` connection strings. Add persistent volume mounts for `data/bronze/live/`. Update `Dockerfile.web` for standalone Next.js 15 output with non-root security.
  Must NOT do: Do not run web container as root user.
  Parallelization: Wave 10 | Blocked by: Todo 22-29 | Blocks: Todo 31, 32
  References: `compose.yaml:1-120`, `Dockerfile.web:1-35`
  Acceptance criteria: `docker compose up -d` boots all services and healthchecks report healthy.
  QA scenarios: Happy path: run compose up, verify `curl http://localhost:8000/health` and `curl http://localhost:3000` return 200. Failure path: simulate database container pause, API gracefully reports degraded status. Evidence: `.omo/evidence/task-30-frontend-deslop-and-refactor.json`.
  Commit: Y | build(docker): harden compose services, volume mounts, and standalone web container

- [ ] 31. Harden Static Export Build & Suspense Boundaries (`apps/web/next.config.js`)
  What to do: Ensure all pages utilizing `useSearchParams()` (`strategy`, `drivers`) are wrapped in React `<Suspense>` boundaries. Verify that `npm run build` with `STATIC_EXPORT=true` succeeds with zero errors, producing a fully functional static cockpit in `apps/web/out/`.
  Must NOT do: Do not allow de-opt bail-out warnings during static export compilation.
  Parallelization: Wave 10 | Blocked by: Todo 22-29 | Blocks: Todo 32
  References: `apps/web/next.config.js:15-30`, `apps/web/app/strategy/page.tsx:100-110`
  Acceptance criteria: `STATIC_EXPORT=true npm run build` completes successfully and generates `out/index.html`.
  QA scenarios: Happy path: run static export build, assert out/ directory contains all HTML and JS assets. Failure path: assert no missing Suspense boundary errors in build log. Evidence: `.omo/evidence/task-31-frontend-deslop-and-refactor.json`.
  Commit: Y | fix(web): wrap search params in suspense and verify clean static export build

- [ ] 32. Update GitHub Actions CI/CD Workflows (`.github/workflows/ci.yml`, `deploy.yml`)
  What to do: Update `.github/workflows/ci.yml` and `deploy.yml` to: (1) run pytest on backend units and live ingestion storage, (2) run ESLint in `apps/web` with custom anti-slop rules without `|| true` bypass, (3) verify TypeScript types (`tsc --noEmit`), and (4) verify static export build.
  Must NOT do: Do not swallow linting or test errors with `|| true` or `continue-on-error: true`.
  Parallelization: Wave 10 | Blocked by: Todo 12, 30, 31 | Blocks: F1-F4
  References: `.github/workflows/ci.yml:1-80`, `.github/workflows/deploy.yml:1-60`
  Acceptance criteria: CI workflow runs all stages strictly and exits 0 on valid code.
  QA scenarios: Happy path: run GitHub Actions steps locally, assert lint, test, and build all pass. Failure path: trigger intentional type error, assert CI fails. Evidence: `.omo/evidence/task-32-frontend-deslop-and-refactor.json`.
  Commit: Y | ci: enforce strict linting, unit tests, and build verification in github actions

- [~] 33. Install the Complete Official ReUI Agent Skill for the Configured MCP (`.opencode/skills/reui/`)
  What to do: Install the complete official ReUI Agent Skill bundle, including SKILL.md and every linked `rules/*.md` and `tools.md` reference, into the project-local `.opencode/skills/reui/` directory. Preserve official content and metadata. Root `opencode.json` already contains the ReUI MCP; verify its endpoint remains `https://mcp.reui.io` and do not change auth mode. Record that browser OAuth and OpenCode restart may be required before MCP tools become available in a new session.
  Must NOT do: Do not write personal tokens or credentials. Do not alter user/global OpenCode configuration. Do not claim live MCP connectivity in the current session unless the tools appear and a real tool call succeeds. Do not use paid registry components.
  Parallelization: Wave 4 | Blocked by: Todo 10 | Blocks: Todos 11 and future ReUI component additions
  References: root `opencode.json`, `https://reui.io/docs/opencode`, `https://reui.io/docs/agent-skills`
  Acceptance criteria: Project-local ReUI skill has SKILL.md plus all referenced rule/tool files from the official bundle; every relative link resolves; `opencode.json` retains the configured remote MCP; no credentials added. Attempt MCP auth/tool connection if non-interactive; if interactive user sign-in is required, leave skill install complete but mark live MCP use blocked with exact user action needed.
  QA scenarios: Happy path: validate the skill file frontmatter and MCP URL using a local read/config parse. Failure path: attempt the official ReUI MCP after restart/auth only if available; if authorization is required, record the exact `needs_auth` response without inserting credentials. Evidence: `.omo/evidence/task-33-frontend-deslop-and-refactor.json`.
  Blocker: Full official skill and MCP project config are installed, but ReUI MCP tools are not registered in this running session. OpenCode must restart and browser OAuth may require user interaction; live MCP use therefore remains unverified until then. Required user action: restart OpenCode and complete ReUI browser sign-in, then resume this checkbox to verify a real MCP call.
  Commit: Y | chore(opencode): install official reui agent skill

- [x] 34. Propagate Source Timestamps and Provenance Through Live Data (`apps/api/pitwall_api/live_data.py`, `src/pitwall/ingestion/live_recorder.py`)
  What to do: Preserve source event timestamps from OpenF1 `date`/`date_start` rather than replacing them with server `now`; expose `source_timestamp`, `observed_at`, `received_at`, `source_id`, provenance and computed data age consistently in snapshots, telemetry, predictions and recorded events. Validate clock parsing and timezone normalization. Mark stale based on configured TTL and source age.
  Must NOT do: Do not label server fetch time as source event time, use client wall-clock as a fake `lastUpdated`, or report `LIVE` for stale data.
  Parallelization: Wave 11 | Blocked by: 1, 4, 7 | Blocks: 35, 36, 38
  References: `apps/api/pitwall_api/live_data.py:30-37, 106-210`, `src/pitwall/ingestion/live_recorder.py`, `apps/web/lib/types.ts`, `apps/web/lib/useRaceSnapshot.ts`.
  Acceptance criteria: Unit/integration tests prove source timestamps survive normalization and storage; stale/invalid timestamp cases produce explicit stale/unavailable status and typed reason.
  QA scenarios: Feed fixed old/new source timestamps through ASGI snapshot and recorder; assert ISO UTC fields and calculated age from injected clock. Failure: missing/malformed timestamp does not become falsely fresh.
  Evidence: `.omo/evidence/task-34-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(telemetry): propagate timestamps and provenance end to end

- [ ] 35. Remove User-Visible Fake Metrics and Demo Fallbacks (`apps/web/app/**`, `apps/web/components/**`, `apps/web/lib/**`)
  What to do: Audit all remaining presentation surfaces and remove fabricated rows, synthetic formulas, mock benchmark/radar/calibration data, arbitrary driver defaults, generated demo events, fake weather estimates, static schedules presented as current, fabricated sector times, and fallback positions. Static schedule/circuit names are allowed only as clearly static reference data with source/date; telemetry/model results are never seeded. Missing data shows a concise reason, stale timestamp, retry action, or empty state. Copy audit all visible strings: precise, concise, user-oriented; remove wordy AI-style explanations, marketing filler, broken grammar, repeated labels and decorative microcopy while preserving necessary data source/provenance.
  Must NOT do: Do not present fixtures/sample/extrapolated numbers as live, replay, model inference, or telemetry. Do not hide missing data with plausible-looking zeros.
  Parallelization: Wave 11 | Blocked by: 8, 9, 15-17, 22-29 | Blocks: 36, 39
  References: prior audits; `apps/web/lib/liveTelemetry.ts`, `liveWeather.ts`, `raceSim.ts`, `calendar.ts`, `app/page.tsx`, `components/EventFeed.tsx`, `WeatherWidget.tsx`, `WeekendSchedule.tsx`, `app/drivers/**`, `app/models/page.tsx`, `app/monitoring/page.tsx`; user screenshots `file-c9dfc2030546b7e4e65bbfbe794181cf.png`, `file-7f8a9ffdc14bd4de5fb750138ce2fb6e.png`, `file-c019a7232010297f8511aa873c8e135a.png`, `file-28bb044ad7b6c33c5fba6373c21de15b.png`, `file-6e5e651c4d2da88ce76fc595f47d288e.png`, `file-69c6e792e79650c23a355bb0853e6fd3.png`, `file-534fc0f941fdc3df5eed85feed589608.png`.
  Acceptance criteria: Static scan plus reviewed surface inventory has no non-reference mock/fallback values or derivation formulas; every user-visible empty state has `UNAVAILABLE`/`STALE` and reason, not telemetry placeholders. Offline connection can never coexist with a green/live badge, current-looking lap, measured weather, benchmark PASS, drift ratio, demo events, or strategy results. Visible text review finds no AI-flavored filler and explains data provenance concisely. Complete screenshots prove offline state is empty/explicit and live state carries source/time.
  QA scenarios: Compare every route against the supplied screenshots. With backend disconnected visit all pages; assert no simulated drivers, 20/66 live lap, generated lap values, demo benchmark table, weather estimate, fallback strategy simulation or fake events. Reconnect to actual source and assert each visible telemetry metric includes source/observed time and stale state when old.
  Evidence: `.omo/evidence/task-35-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): remove simulated and placeholder telemetry surfaces

- [x] 36. Make Telemetry Graphs Timestamped and Sample-Accurate (`apps/web/components/charts/TelemetryTraceChart.tsx`, `apps/web/components/TelemetryOverlay.tsx`)
  What to do: Drive scrubber X coordinates from actual `timestamp` or source-provided distance samples, show exact UTC/source time under scrub cursor, and plot raw reported speed/throttle/brake/gear/DRS values with units and data cadence. The speed/throttle/brake panels must share the same sample index/timestamp; preserve unsmoothed source observations, including sharp throttle pickup and brake-release transitions. Reject invalid/out-of-range samples rather than clamping corrupt telemetry into plausible values.
  Must NOT do: Do not synthesize equidistant timestamps/distances when absent, smooth or interpolate control inputs, clamp invalid values into legitimate ranges, or use generated sinusoids.
  Parallelization: Wave 11 | Blocked by: 18, 34 | Blocks: 29, F3
  References: `apps/api/pitwall_api/live_data.py:213-261`, `apps/web/components/charts/TelemetryTraceChart.tsx`, `apps/web/components/TelemetryOverlay.tsx`.
  Acceptance criteria: Fixture from captured source payloads renders samples at actual timestamp/distance; keyboard/pointer scrub resolves the exact same raw sample; throttle is source value in percent and synchronized with brake/speed by timestamp; missing timeline yields no graph with reason.
  QA scenarios: Replay recorded high-frequency car_data with abrupt 0→100 throttle and 100→0 brake; scrub both transitions and assert tooltip timestamp and exact raw values. Malformed/out-of-order sample returns validation error or explicit excluded-sample count, not shifted curves.
  Evidence: `.omo/evidence/task-36-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(charts): scrub source-timestamped raw telemetry accurately

- [x] 37. Harden CORS, API Mutation Authentication, and Runtime Security (`apps/api/pitwall_api/settings.py`, `main.py`, `compose.yaml`)
  What to do: Define strict exact production origin allowlist from deployment environment, support preflight only for needed routes/methods/headers, disallow wildcard credentials, and reject invalid origins. Apply equivalent exact Origin validation to WebSocket upgrades (CORS middleware does not secure WebSockets). Protect `/live/start` and `/live/stop` with constant-time comparison of `X-Pitwall-API-Key` against a required secret in non-development deployment; fail closed when production secret is absent. Replace committed default DB/Grafana secrets with required environment variables and a documented local-only dev profile; avoid exposing internal `/metrics` or docs if production policy disables them. Add security headers and request/body limits where relevant.
  Must NOT do: Do not commit secrets, wildcard origins, allow all methods/headers, log API keys, or make mutation endpoints unauthenticated in production.
  Parallelization: Wave 11 | Blocked by: 4, 13, 30 | Blocks: 39, 40
  References: `apps/api/pitwall_api/settings.py`, CORS middleware in `apps/api/pitwall_api/main.py`, `compose.yaml`, `.env.example`.
  Acceptance criteria: Tests cover exact allowed/denied HTTP Origin, OPTIONS preflight, WebSocket Origin allow/deny, wrong/missing key on live mutations, timing-safe key compare helper, production missing-secret startup failure, dev-profile functionality, and no secrets in committed configuration.
  QA scenarios: curl allowed and hostile Origin; unauthenticated and wrong-key start/stop fail 401/403; valid configured key succeeds. Attempt WebSocket upgrade from both allowlisted and denied Origins. Compose config rejects missing prod secrets and local development can explicitly use dev-only values.
  Evidence: `.omo/evidence/task-37-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(security): enforce cors allowlist and protect live controls

- [x] 38. Verify Persistent Runtime State, Weather Database Conception, and MLOps Readiness (`apps/api/pitwall_api/main.py`, storage, monitoring, `compose.yaml`, `monitoring/**`)
  What to do: Ensure every ingested live `RaceEvent` (including raw telemetry/weather payloads) and live session, lap, stint, hazard records persist across API container recreation; implement a formal relational database conception for weather observations (`LiveWeatherRecord` table storing air_temp_c, track_temp_c, humidity_pct, pressure_mbar, wind_speed_kmh, wind_dir_deg, rainfall_mm, rainfall_prob, and source_timestamp with session foreign key) so weather is stored and retrieved persistently rather than held in ephemeral state. Add Alembic async SQLAlchemy migrations for all runtime tables (live_sessions, live_driver_laps, live_stints, live_hazard_logs, live_weather_records). Expose persisted weather/telemetry through source-timestamped API read endpoints and wire the website's weather/live-data surfaces to those persisted API records; no direct upstream/client cache bypass or demo/default readings presented as current. Add truthful health/monitoring state for model artifact load/version, database connection, live recorder, last source event timestamp/age, Parquet flush/finalize, drift report status/sample counts/cache age, and promotion status. Add Prometheus/Grafana panels/alerts for stale ingestion, DB/storage failures, unavailable model, model drift and endpoint errors. No fake zeros for unknown values.
  Must NOT do: Do not report models healthy if not loaded, persistence successful before commit/flush, or drift metrics available when source comparison unavailable. Do not use PostgreSQL-specific JSONB/ARRAY types that fail on SQLite.
  Parallelization: Wave 11 | Blocked by: 1-7, 30, 34, 37 | Blocks: 39-41
  References: `apps/api/pitwall_api/main.py:/health,/monitoring/overview`, `src/pitwall/storage/db.py`, `models.py`, `parquet_writer.py`, `monitoring/grafana/**`, `compose.yaml`.
  Acceptance criteria: Container restart integration test preserves every stored event/payload, DB rows (including weather records), and finalized replay files; website reads API-returned persisted weather with exact source timestamp and explicit unavailable state when no record exists; health status accurately transitions on DB/model/ingest fault injection; alerts/panels load from provisioned config; Alembic `upgrade head` runs on SQLite and PostgreSQL-compatible configuration and is idempotent; migration rollback or forward-only policy is documented and tested.
  QA scenarios: Capture source weather and telemetry events, stop/finalize, restart API container, read same records through API and verify the website consumes those values/timestamps. Kill DB connection or remove model artifact, assert health reports degraded with reason and alerts fire; website must show unavailable rather than stale defaults.
  Evidence: `.omo/evidence/task-38-frontend-deslop-and-refactor.json`.
  Commit: Y | feat(storage): implement live weather relational model, alembic migrations, and mlops health

- [ ] 39. Build Multi-Stage CI/CD Quality, Security, and Deployment Gates (`.github/workflows/ci.yml`, `deploy-pages.yml`, new workflow files)
  What to do: Split CI into independent stages: backend lint/type/security/tests, frontend lint/type/unit/typecheck, static export, container build/security scan, integration/E2E, then staged deploy and post-deploy smoke. Remove advisory `|| true`, npm fallback installation, and non-blocking checks for required gates. Pin actions to reviewed versions/SHA according to repository policy, use least-privilege permissions, artifact provenance, concurrency protection, and safe secret contexts. Deploy only from protected main after all gates and preserve rollback artifact/previous deployment instructions.
  Must NOT do: Do not expose secrets to PRs from forks, bypass failed lint/tests, automatically promote a failed staging build, or echo credentials.
  Parallelization: Wave 11 | Blocked by: 12, 30-38 | Blocks: 40, 41
  References: `.github/workflows/ci.yml`, `deploy-pages.yml`, `retrain.yml`, `promote.yml`, Dockerfiles.
  Acceptance criteria: CI workflow validates configuration; pipeline jobs/gates/dependencies are explicit; fork PR path receives no deploy secrets; controlled test fails when lint/test/security gate fails; successful path builds and deploy artifact contains no secrets.
  QA scenarios: Run workflow validation and local staged commands; inject deliberate lint failure and verify pipeline blocks deployment; inspect built artifact for secrets; simulate failed deployment health check and verify rollback action remains available.
  Evidence: `.omo/evidence/task-39-frontend-deslop-and-refactor.json`.
  Commit: Y | ci: gate staged deployment on quality and security checks

- [ ] 40. Deploy the Verified Frontend and Backend Artifacts to Existing Targets (`deploy-pages.yml`, GHCR/production deployment configuration)
  What to do: Use the existing project targets only: GitHub Pages for static frontend and GHCR/container deployment path already declared in repository. Verify required `PITWALL_API_URL`, `PITWALL_WS_URL`, API host and credentials are configured through secrets/environment. Build immutable commit-tagged artifacts, deploy via gated workflow, then capture deployment run ID, commit SHA, and deployed URLs. If backend target/credentials do not exist, do not invent a host or expose an unprotected API; mark this task `[~]` with exact missing required secret/target, but deploy Pages if that target is available.
  Must NOT do: Do not deploy uncommitted code, bypass CI, print secrets, modify DNS/provider settings, or silently deploy with HTTP endpoints from HTTPS Pages.
  Parallelization: Wave 11 | Blocked by: 39 | Blocks: 41
  References: `.github/workflows/deploy-pages.yml`, `.github/workflows/ci.yml`, `Dockerfile`, `Dockerfile.web`, `compose.yaml`, `.env.example`.
  Acceptance criteria: GitHub Actions deployment succeeds from the intended protected commit, records deployment ID/SHA/URLs, and points frontend to a valid HTTPS backend. If no production backend target/secrets exist, document blocked state via `- [~]` and provide necessary exact deployment inputs.
  QA scenarios: Check deployed Pages URL loads, OpenAPI snapshot matches deployed commit, and health endpoint is HTTPS/allowed by CORS; backend mutation endpoint denies unauthenticated requests. Failure: bad API origin results in explicit offline state rather than misleading live UI.
  Evidence: `.omo/evidence/task-40-frontend-deslop-and-refactor.json`.
  Commit: N | deployment performed by gated workflow, not source commit

- [ ] 41. Verify Deployed State, Data Freshness, MLOps, and Rollback (`production URLs`, deployment workflow)
  What to do: Run post-deploy smoke against deployed Pages and backend; verify latest source timestamp, live ingestion state, data persistence, current model version/load, drift status, OpenAPI routes, CORS/security headers, and telemetry scrub behavior. Record deployment SHA and rollback instructions/artifact. Do not claim live status if no active OpenF1 session.
  Must NOT do: Do not seed production with synthetic telemetry to make checks pass; no placeholder success badge; no stale cache reported as fresh.
  Parallelization: Wave 11 | Blocked by: 34-40 | Blocks: F1-F4
  References: deployment evidence for Todo 40, `/health`, `/live/status`, `/monitoring/overview`, `/monitoring/era-drift`, `/openapi.json`, live telemetry endpoints.
  Acceptance criteria: Each check is PASS, explicitly NO_ACTIVE_SESSION, or BLOCKED with reason; all source times and SHA are in evidence; rollback artifact and workflow action are identified and rehearsed on staging where available.
  QA scenarios: Execute HTTPS curl checks and browser UI smoke on actual deployment. With no race session, verify no current-looking telemetry appears. Verify deployment state can be rolled back to previous SHA/artifact.
  Evidence: `.omo/evidence/task-41-frontend-deslop-and-refactor.json`.
  Commit: N | post-deploy verification only

- [ ] 42. Split Oversized Telemetry Chart Components by Responsibility (`apps/web/components/charts/`)
  What to do: Refactor overgrown `TelemetryTraceChart.tsx` and `GapTrajectoryChart.tsx` into focused type/contracts, normalization/geometry utilities, and render/interaction components. Keep each pure logic/helper module under 250 nonblank noncomment lines; UI files should also remain reviewable and expose one responsibility each. Preserve measured source timestamps and exact raw input behavior introduced in Todo 36.
  Must NOT do: Do not alter chart semantics, scrub behavior, source values, or accessibility. Do not create abstractions used by only one call site unless split is required for file-size compliance; preserve existing exports.
  Parallelization: Wave 11 | Blocked by: Todo 36 | Blocks: F1-F4.
  References: `apps/web/components/charts/TelemetryTraceChart.tsx`, `GapTrajectoryChart.tsx`, `tests/unit/test_model_charts.ts`, chart contract tests.
  Acceptance criteria: No changed chart/helper exceeds 250 pure LOC without a documented non-splittable reason; all chart contract tests, TypeScript, and targeted lint pass with unchanged user-observable behavior.
  QA scenarios: Happy path: run chart interaction tests and sample scrub; failure path: rerun all boundary/empty/malformed source timestamp cases and verify same explicit states, no NaN, no synthesized samples. Evidence: `.omo/evidence/task-42-frontend-deslop-and-refactor.json`.
  Commit: Y | refactor(web): split oversized telemetry chart modules without behavior changes

- [ ] 43. Persist GPT-6 Luna as OpenCode Default and General Worker Model (`opencode.json`)
  What to do: Preserve the existing ReUI MCP configuration and set the project OpenCode default model to the verified model ID `openai/gpt-6-luna`; configure the documented `general` agent model to the same ID. Inspect official OpenCode config schema and OMO model-routing documentation before any Sisyphus/category override; add such an override only if the mechanism is officially documented and validate it. Do not claim in-flight team processes changed model.
  Must NOT do: Do not edit user/global configuration, overwrite ReUI MCP settings, write credentials, guess provider/model IDs, or claim this running process reloaded config. Do not disable Gemini provider globally; the user explicitly allowed it for exceptional visual work earlier, but default future routing should be GPT-6 Luna.
  Parallelization: Wave 11 | Blocked by: None for project default; new agent-routing validation after current team closes | Blocks: future sessions using project defaults.
  References: `opencode.json`, official `https://opencode.ai/config.json`, OMO current model/team routing docs.
  Acceptance criteria: Config validates against official schema, `opencode models` contains `openai/gpt-6-luna`, root ReUI MCP entry remains enabled, future general agent routing resolves to GPT-6 Luna after restart. If custom category model routing cannot be guaranteed by supported schema, document the remaining limitation explicitly.
  QA scenarios: Run a bounded config validation/model list command (timeout <=30s); verify merged default and general-agent config in a fresh session after restart. Failure path: unknown model/invalid schema rejects config and the original config can be restored without losing MCP entry. Evidence: `.omo/evidence/task-43-frontend-deslop-and-refactor.json`.
  Commit: Y | chore(opencode): set GPT-6 Luna as project default model

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.
- [ ] F1. Plan compliance audit
- [ ] F2. Code quality review
- [ ] F3. Real manual QA
- [ ] F4. Scope fidelity

## Commit strategy
- All changes committed using Conventional Commits specification: `feat(...)`, `refactor(...)`, `fix(...)`, `chore(...)`, `ci(...)`, `build(...)`.
- Wave-level atomic commits to ensure clean bisectability and rollback capability.
- No dirty worktree artifacts or uncommitted test files left in repo.

## Success criteria
1. Backend live ingestion worker polls OpenF1, streams via unified WebSocket broadcaster, and writes Bronze Parquet + SQLite/PostgreSQL persistence with replay finalization.
2. New ML endpoints (`/predictions/undercut`, `/predictions/safety-car`, `/monitoring/era-drift`, `/circuits/{id}`) fully functional and documented.
3. Interactive Swagger UI explorer embedded directly into Next.js cockpit at `/api-docs` with HTTPS mixed-content guard.
4. Accurate geometric F1 circuit vector JSON assets pre-bundled for 24 tracks with true aspect ratios, turns, and DRS zones.
5. ReUI & shadcn/ui components installed, styled with dark telemetry tokens, and governed by custom anti-slop ESLint rules.
6. Zero synthetic math formulas remaining in frontend code (no driver modulo placement, no ASCII hashing, no sine wave stint curves).
7. Deployment gates and actual existing-target deployment are verified; unavailable backend credentials/target are explicitly recorded instead of fabricated deployment success.
8. Zero em-dashes (`—`/`–`) in visible typography across the entire web application (standardized to ASCII "-" and "N/A").
9. No mock/demo/placeholder telemetry or model metrics are presented as real; all live data includes source/observed timestamp and freshness.
10. Throttle and brake plots show timestamp-aligned raw source samples and scrub accurately to exact sample values.
11. CORS, API mutation authentication, secret handling, health/MLOps monitoring, staged CI/CD, post-deploy smoke, and rollback are all tested.
