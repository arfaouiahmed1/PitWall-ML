# Learnings — frontend-deslop-and-refactor

Conventions, patterns, and successful approaches discovered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## Live Ingestion Worker Service (Todo 1)
- **Rate-Limiting & Staggering**: OpenF1 free tier imposes a 3-4 req/sec ceiling. To prevent HTTP 429 errors, `AsyncRateLimiter` enforces a minimum inter-request interval (default 0.25s / 3.0 req/s max) across a shared `httpx.AsyncClient`. Individual endpoint poll intervals are staggered (`/position`, `/intervals`, `/laps`, `/car_data` at 1.5s; `/stints` and `/weather` at 30s) with initial startup offsets.
- **Payload Normalization**: Incoming payloads are normalized into canonical `RaceEvent` instances (`source="openf1"`, explicit `EventType`, UTC datetime) matching `src/pitwall/schemas/events.py`.
- **Deduplication**: Monotonically advancing timestamps (`date>`, `date_start>`) paired with bounded unique key history (`deque(maxlen=20000)` + `set`) guarantee zero duplicate `RaceEvent` emissions across poll cycles.
- **Resilient Error Handling**: Both HTTP status errors (429, 5xx) and network transport errors (timeouts, connection drops) are handled via exponential backoff without crashing the background worker loop.
- **Inference & EventBus Integration**: As events update `RaceState`, quantile pace and hazard predictions are computed and wrapped into standard `race_update` envelopes published to the FastAPI EventBus (`pitwall:race:{session_id}`) and streamed to registered async callbacks.

## Micro-Batched Bronze Parquet Writer & Replay Discovery (Todo 2)
- **Micro-Batch Buffering**: `ParquetPartitionWriter` buffers incoming `RaceEvent` models in memory and flushes to disk as `data/bronze/live/{session_id}/part-{seq}.parquet` on either buffer count threshold (default 500 events) or elapsed time threshold (default 30.0s).
- **Empty Buffer Protection**: Calling `flush()` with an empty buffer safely returns `None` and skips writing empty or 0-byte partition files.
- **UTC Timestamp Normalization**: All timestamps (`event_ts`, `ingest_ts`) are strictly coerced to UTC before persistence using Polars `pl.Datetime("us", "UTC")`.
- **Dynamic JSON Serialization**: Arbitrary nested payload dictionaries are serialized into JSON strings across both `payload` and `payload_json` columns, preventing Polars struct schema conflicts when disparate event types (`lap`, `weather`, `car_data`, `position`) share the same partition.
- **Sequence Numbering & Resumption**: `ParquetPartitionWriter` automatically detects existing partition numbers upon initialization, resuming sequence numbers safely without overwriting previous partitions.
- **Session Finalization**: `finalize_session()` merges all `part-*.parquet` files into a canonical `events.parquet` file sorted by `event_ts`, supporting optional `cleanup_partitions` deletion.
- **Replay Discovery Parity**: `discover_replay_sessions()` scans both historical hive-partitioned datasets (`laps.parquet`) and live-recorded directories (containing `events.parquet` or `part-*.parquet`), tagging live recorded sessions with `is_live=True` and label `[LIVE-RECORDED]`.
- **Replay Source Fallback**: `ParquetReplaySource` automatically resolves consolidated `events.parquet` or globbed partition files (`part-*.parquet`), ordering all events strictly by event time.

## Pre-Bundle Authentic F1 Circuit Vector Registry (Todo 15)
- **Zero External Network Requests**: Vendored all 24 Formula 1 calendar circuit vector geometries (plus 2026 Madrid entry) directly into typed TypeScript modules under `apps/web/lib/circuits/data/*.ts` and `apps/web/lib/circuits/registry.ts`. Eliminates runtime CORS issues and GitHub Pages base path (`/PitWall-ML`) 404 hazards.
- **Uniform Coordinate Space**: Standardized all circuits into a canonical `viewBox="0 0 1000 1000"` coordinate space with uniform aspect ratio scaling (`scale_x === scale_y`) and centered 80px boundary padding.
- **Exact Integer Precision**: Transformed SVG path commands (`M`, `L`, `Q`, `Z`), turn apex markers, speed trap diamonds, and DRS activation segment endpoints with exact integer coordinates in the `[0, 1000]` canvas.
- **Complete Corner Coverage**: Generated complete turn marker sequences ($1 \dots N$) for all circuits matching FIA official corner counts (Monza: 11 turns, Monaco: 19 turns, Spa: 19 turns, Silverstone: 18 turns, Jeddah: 27 turns), interpolating intermediate turn positions along true spline segments.
- **Type-Safe Validation**: Implemented Zod schemas in `apps/web/lib/circuits/types.ts` (`CircuitGeometrySchema`, `TurnMarkerSchema`, `DRSSegmentSchema`, `SpeedTrapSchema`, `SectorSplitSchema`).
- **Resilient Fallback & Alias Resolution**: `getCircuitGeometry(id)` supports case-insensitive lookups, hyphens/underscores, and popular aliases (`cota` -> `austin`, `austria` -> `spielberg`, `hungaroring` -> `budapest`, `interlagos` -> `sao_paulo`, etc.), falling back safely to Monza baseline on unknown IDs without throwing.

## Live Ingestion Control Endpoints (Todo 4)
- **Single Lifecycle Owner**: `apps/api/pitwall_api/main.py` protects the recorder and writer references with one `asyncio.Lock`, so a second `POST /live/start` returns `already_running` rather than creating duplicate OpenF1 polling tasks.
- **Capture Persistence**: Each recorder callback writes its canonical `RaceEvent` through `ParquetPartitionWriter`; stop and lifespan shutdown await polling-task cancellation before finalizing buffered partitions into the session's `events.parquet`.
- **Observable State**: Typed `/live/status` responses expose the active session, captured count, writer buffer depth, and most recent event latency. `POST /live/stop` is safely idempotent and reports the final captured count.

## Parameterized Spline Track Engine (Todo 16)
- **Measured Driver Placement**: `TrackGeometry` resolves markers only after the SVG path mounts, using `getTotalLength()` and `getPointAtLength(clamp(progress) * length)` so a `0.0..1.0` fractional lap distance maps directly to spline distance without driver-number-derived placement or wraparound.
- **Safe Initial Rendering**: When SVG geometry APIs are unavailable before mount or in a non-DOM renderer, the component renders the circuit and overlays normally but defers driver markers until measurement succeeds.
- **Reusable Telemetry Layers**: The renderer accepts direct `CircuitGeometry` data or a registry `circuitId`, exposes sector/stroke visibility and color controls, and renders normalized sector, DRS, turn, speed-trap, and native SVG tooltip layers inside a responsive `1000 x 1000` canvas.

## Custom Anti-Slop ESLint Rules (Todo 12)
- **UI Boundary**: `no-restricted-imports` blocks direct `@radix-ui/*` imports outside `components/ui/**/*.{ts,tsx}`, ensuring application code consumes local `@/components/ui/*` primitives while allowing those primitives to implement their Radix wrappers.
- **Typography Guard**: `no-restricted-syntax` uses `JSXText[value=/[—–]/]` and `TemplateElement[value.raw=/[—–]/]` selectors with a clear remediation message. Existing UI text and template literals now use ASCII `-`; a repository scan has no remaining em-dash or en-dash characters under `apps/web`.
- **Synthetic Data Guards**: A driver-number modulo selector catches `driver_number % ...`; the page-only override adds a `VariableDeclarator[id.name=/MOCK/i]` selector so hardcoded mock constants cannot enter route pages.
- **Build Enforcement**: Removed `eslint.ignoreDuringBuilds` from `next.config.js`. `next build` now stops on ESLint errors; it correctly reports the existing deferred violations in `app/page.tsx` (driver-number modulo, Todo 22) and `app/drivers/page.tsx` (`RADAR_MOCK`, Todo 29).

## Opponent Pit Model Endpoint (Todo 5)
- **Model Integration**: Exposed `src/pitwall/models/pit/opponent_model.py::OpponentPitModel` via `GET /predictions/undercut` in `apps/api/pitwall_api/main.py` utilizing a cached model instance (`opponent_pit_model`).
- **Strict Compound & Driver Validation**: Enforces uppercase compound validation (`SOFT`, `MEDIUM`, `HARD`), rejecting invalid compounds (`HTTP 400`) while safely normalizing lowercase inputs (`soft` -> `SOFT`). Validates positive integer driver numbers and rejects identical driver/rival pairs (`HTTP 400`).
- **Dual-Mode Evaluation (Parameter-Driven vs Live State Fallback)**: Supports full ad-hoc parameter querying (`driver_number`, `rival_number`, `gap_s`, `driver_compound`, `rival_compound`, `driver_tyre_age`, `rival_tyre_age`, `tyre_age_delta`) alongside automatic fallback to `race_state.drivers`. When parameters are omitted, automatically evaluates P1 and trailing P2 or looks up consecutive cars on the grid, computing gap from interval timing.
- **Resilient Degraded & Empty State Handling**: When `race_state.drivers` is empty and no calculation parameters are passed, safely returns HTTP 200 with an unpopulated `UndercutThreat` schema containing `reason="no_active_drivers"` and `recommended_action="HOLD"` instead of crashing. When a requested driver has no trailing car, cleanly reports `reason="no_trailing_rival"`.
- **Unified Schema Contract**: Defined `UndercutThreat` (aliased as `UndercutThreatPrediction`) in `src/pitwall/schemas/predictions.py` with full OpenAPI summary/description metadata under `tags=["Predictions"]`.

## Multi-Channel Telemetry Trace Chart Primitive (Todo 18)
- **Unified Responsive SVG Canvas**: Implemented `apps/web/components/charts/TelemetryTraceChart.tsx` using a single responsive `viewBox="0 0 1000 440"` coordinate space. Automatically scales to container width without hardcoded dimensions or layout shifts across viewports.
- **Synchronized Multi-Channel Architecture**: Vertically stacks Speed (Channel 1: 32px to 162px), Throttle & Brake (Channel 2: 196px to 288px), and Gear & DRS (Channel 3: 320px to 388px) above a shared distance X-axis (0% to 100% or meters), maintaining perfect cross-channel alignment.
- **Authentic Telemetry Curves**: Gear shifts are drawn as discrete step paths (`L x_{i+1} y_i L x_{i+1} y_{i+1}`) to reflect true mechanical gear changes. DRS activations are extracted into contiguous rectangular highlight segments with purple `#a855f7` badges. Speed and throttle/brake traces use subtle linear gradient area fills.
- **High-Performance Scrubbing & Deltas**: Crosshair tracks mouse and touch positions smoothly with $O(\log N)$ binary search lookup, displaying live speed, throttle, and brake deltas (`Δ`) alongside a keyboard/touch accessible slider scrubber.
- **Strict Anti-Slop & Fallback Standards**: Verified zero em-dashes (`—`/`–`) across JSX text and templates; empty or missing telemetry arrays render an accessible empty-state card with ASCII hyphen `-` placeholders. Zero D3, Chart.js, or Recharts dependencies.

## Safety Car Hazard Model Endpoint (Todo 6)
- **Existing Model Contract**: `src/pitwall/models/safety_car/hazard.py::SafetyCarHazardModel` exposes `predict_hazard()` (not `predict()`); the endpoint calls it directly with `circuit_id`, `lap_number`, `total_laps`, `is_rain`, `recent_yellows` mapped from `circuit_id`, `current_lap`, `total_laps`, `is_wet`, `recent_incident_count` query params.
- **Cached Singleton**: Module-level `safety_car_model: SafetyCarHazardModel = SafetyCarHazardModel()` in `apps/api/pitwall_api/main.py` mirrors the `opponent_pit_model` pattern; no per-request instantiation.
- **Endpoint-Local Schema**: `SafetyCarPrediction` Pydantic model lives in `main.py` (not shared schemas) with `ge=0.0/le=1.0` probability bounds and full OpenAPI field descriptions under `tags=["Predictions"]`.
- **Verified Risk Tiers**: Monaco/Singapore/Jeddah return `VERY_HIGH`; unknown or omitted circuits fall back to `MEDIUM` (0.45 prior) with HTTP 200; `current_lap > total_laps` is rejected with HTTP 400; non-positive laps fail FastAPI validation with HTTP 422.
- **No Regressions**: `tests/unit/test_safety_car_api.py` (8 tests) passes alongside existing `test_undercut_api.py` (14) and `test_predictions.py` (2); `/predictions/pace` and `/predictions/undercut` untouched.

## Cached Era Drift and Circuit API (Todo 7)
- **Truthful Report Availability**: The era report is built once when `pitwall_api.main` loads from `data/silver/laps/*.parquet`, only comparing actual `regulation_era` labels with the existing `DEFAULT_DRIFT_COLS` subset (9 candidate features). Missing files or labels return `status="no_data"` and empty results, never generated metrics.
- **Heterogeneous Parquet Inputs**: Silver lap files can have different schemas; concatenate individually-read Polars frames with `how="diagonal_relaxed"` before checking era labels.
- **Backend Circuit Scope**: `CIRCUIT_REGISTRY` contains aliases as well as canonical configurations; `/circuits` de-duplicates configurations by OpenF1 `circuit_key`. Its coverage is intentionally limited to backend-configured circuits, not the frontend's 24 vector tracks.
- **Legacy Drift Endpoint Baseline**: Existing `/monitoring/drift` remains separately implemented and can report `status="error"` when its multi-file `pl.read_parquet(files)` encounters heterogeneous schemas; do not reinterpret that old endpoint as era-drift output.
- **Explicit Empty/Unavailable States**: An empty computed metric list is `status="no_data"` with `reason="insufficient_era_metrics"`; unreadable Parquet is separately `status="unavailable"` with `reason="unreadable_silver_laps"`. Source fingerprint uses sorted file paths, sizes, and modification timestamps, so cache inputs are auditable without representing data as metrics. `refresh_era_drift_cache()` explicitly rebuilds the process cache after source changes.
- **OpenAPI Contracts**: Era drift, circuit list, and circuit detail routes use named Pydantic response models. Circuit detail documents the existing `404 unknown_circuit` outcome while preserving the response body.

## Parameterized Performance Radar Chart (Todo 20)
- **Truthful Data States**: `PerformanceRadarChart` accepts typed axes and named multi-series data, clamps finite values to each axis range, and renders an explicit unavailable state when no measured series is supplied. Missing or non-finite dimensions are excluded from the series path and reported as partial rather than being silently converted to zero.
- **Native Responsive SVG**: The chart uses `viewBox="0 0 320 320"` with `w-full h-auto`, semantic `<title>`, `<desc>`, axis labels, and telemetry design tokens. It requires no D3 or fixed consumer pixel radius.
- **Deferred Consumer Wiring**: The three existing driver radar renderers now call the shared primitive with no series while Todo 29 owns the real performance-vector integration. This removes `RADAR_MOCK`, 78/82 fallbacks, and driver-number modulo radar generation without claiming those pages have measured data.

## Honest Explainability and Calibration Chart Contracts (Todo 21)
- **Local versus global SHAP**: `/models/shap` currently returns a global `shap_summary` map only. `FeatureWaterfallChart` uses a discriminated contract: `kind: "local"` requires signed contributions and a baseline, while `kind: "global"` renders feature rankings without claiming per-lap delta explanations.
- **Global ranking order**: Global feature rows are filtered to finite, nonnegative importance values and sorted descending before rendering; stable sort keeps source order for equal magnitudes. The static-markup contract test verifies descending order from deliberately unsorted input.
- **Empirical calibration only**: `CalibrationCurveChart` renders only valid supplied `(nominal, observed)` measurements. It does not infer missing confidence levels, and it shows the 80% target display only when a measured nominal 0.8 point exists.
- **Robust geometry**: non-finite contribution and calibration inputs are filtered before coordinate calculations, preserving finite SVG markup across empty and extreme inputs.

## Singleton WebSocket Broadcaster (Todo 8)
- **Replay Fanout**: `RaceBroadcaster` gives each subscriber a bounded queue seeded with a deep-copied current-state snapshot. Queue overflow drops only the slow subscriber and wakes its consumer; unsubscribe and orderly close are idempotent.
- **Single Replay Producer**: `/ws/race?replay_id=...` shares a producer, replay-local `RaceState`, and frame sequence for that replay id. A speed mismatch returns WebSocket policy close `1008` rather than silently sharing a differently paced source. Disconnecting one socket does not cancel the producer.
- **Live Delivery Seam**: `EventBus` has `publish` and `consume`, not live subscriber callbacks. `LiveRaceRecorder.on_event` is the existing in-process seam; recorder callbacks publish the same `race_update` envelope into the live broadcaster, while the EventBus publish path remains intact.
- **Protocol Compatibility**: Replay keeps `connected` and `race_update` frames and adds `race_snapshot` immediately after connect. Replay and live input modes are validated explicitly; replay ids and the existing speed allowlist remain mandatory for replay mode.
- **Lifecycle QA**: WebSocket integration tests use Starlette's real ASGI TestClient sessions. Five concurrent subscribers observe the same three frames from exactly one mocked source producer; API lifespan cancels producers and closes broadcasters during cleanup.

## Reopened Circuit Geometry Verification (Todo 15)
- **Pinned source evidence**: The requested GitHub revision exposes each circuit as a GeoJSON `FeatureCollection` containing a `LineString`; the Monza and Monaco files each contain one feature. The README and LICENSE.md state MIT, Copyright (c) 2019-2025 Tomislav Bacinger, and explicitly disclaim Formula One Licensing B.V. endorsement.
- **Bundled provenance**: 25 currently bundled assets are generated by `scripts/generate_circuit_geometry.ts`; each records source repository, fixed revision, file, SHA-256, original coordinate sequence, projection, and normalized points. Runtime geometry is imported from local TypeScript modules.
- **Projection/topology checks**: The registry test verified all 25 assets, coordinate-to-path projection within 0.00051 units, and unavailable turn/sector/DRS/speed-trap overlays. The source sequence is retained as an open line, including matching first/last points where present; the generator must preserve source order because reversing would change lap-distance placement.
- **Browser QA limitation**: Playwright could not start because Chrome is absent. Installing Playwright Chromium was attempted but its CDN download timed out. No visual screenshot was captured; do not represent browser QA as passed.

## Performance Radar Chart Axis Range Validation (Review Finding Resolution)
- **Zod Boundary Parsing**: Defined `PerformanceRadarAxisSchema` validating that `minimum` and `maximum` are finite numbers and enforcing `maximum > minimum` via `.refine()`. Exported `parsePerformanceRadarAxis` to reject non-finite bounds, equal bounds (`maximum === minimum`), and reversed bounds (`maximum < minimum`) at the boundary.
- **Safe Axis Exclusion**: `buildPerformanceRadarModel` partitions axes into valid axes and excluded keys. Invalid axes are excluded from `model.axes` and tracked in `series.missingAxes`, allowing valid dimensions to plot safely while disclosing omitted dimensions.
- **Explicit Chart States**: When all configured axes are invalid or no points can be plotted, the model explicitly sets `status: "unavailable"`, and `PerformanceRadarChart` renders the accessible fallback card with zero SVG elements. When a subset of axes is invalid, `status` becomes `"partial"`, and the caption notes that unavailable dimensions are omitted.
- **Defensive Geometry**: `pointFor` computes `axisRange = axis.maximum - axis.minimum`, guards against non-positive/non-finite ranges with a fallback safe range, clamps the normalized ratio to `[0, 1]`, and asserts finite coordinates. `gridPoint` guards against zero axis counts, and `pointList` filters out non-finite coordinates, preventing any `NaN` values from reaching SVG `points`, `x`, `y`, `x2`, or `y2` attributes.
- **BDD Test Coverage**: Expanded `tests/unit/test_performance_radar_chart.ts` with tests covering equal bounds, reversed bounds, non-finite bounds (NaN, +/-Infinity), valid bounds, Zod schema validation, and React static markup rendering, verifying zero `NaN` occurrences in models and serialized HTML.

## Source Timestamp and Provenance Propagation (Todo 34)
- OpenF1 event time is parsed from endpoint `date` / `date_start`, normalized to UTC, and invalid or missing event times are rejected; no fetch-time fallback is used as `event_ts`.
- `RaceEvent.ingest_ts` is the independent receive time, while the existing `source_id` and persisted JSON payload retain source timestamp, receive timestamp, OpenF1 provenance, data age, and stale state through Parquet persistence.
- Snapshot and car telemetry freshness use an injectable aware UTC clock and configured stale threshold; stale/invalid/unavailable sources are explicit and do not generate live model output.
- Live snapshot, telemetry, recorder/event bus, persistence, and live websocket surfaces carry source/receive metadata. Todo 9's web hook/type files were not changed; its response contract should add `source_timestamp`, `received_at`, `source_id`, `provenance`, `data_age_seconds`, and `stale` (plus `observed_at` for the source observation).
- Target verification: `uv run pytest tests/integration/test_live_data.py tests/unit/test_live_recorder.py tests/unit/test_parquet_writer.py tests/unit/test_live_api.py -q` (41 passed); scoped `uv run ruff check ...` passed. See `.omo/evidence/task-34-frontend-deslop-and-refactor.json`.

## Faithful Source Geometry Engine & Overlay Contract (Todo 16)
- **Zero Guessed Splits**: `resolveSectors` strictly evaluates circuit metadata. When sector boundaries are unavailable, missing, or empty, it returns `[]` rather than fabricating equal-third (1/3, 2/3) splits. When verified sector splits exist, it normalizes and sorts them strictly by progress.
- **Conditional Sourced Layers**: Turn badges, DRS activation zones, speed traps, and sector division highlight paths render if and only if valid sourced metadata is present in `circuit.overlays`. Unsourced overlays produce zero inferred badges, markers, or plausible fake overlays.
- **Strict Boundary Clamping**: `clampProgress` enforces `[0.0, 1.0]` bounds for driver and overlay progress values, mapping non-finite values (NaN) safely to 0.0, and coordinates are evaluated strictly via measured SVG path length (`path.getPointAtLength`).
- **No Monza Fallback Under Different ID**: Unknown or unspecified circuit IDs render an explicit accessible status container (`role="status"`), completely eliminating silent fallback to Monza under an invalid or foreign circuit key.
- **Modular Sub-Component Architecture**: Factored track logic into `trackUtils.ts` (68 pure LOC), `TrackOverlays.tsx` (132 pure LOC), and `TrackGeometry.tsx` (187 pure LOC), maintaining single responsibility and remaining strictly under the 200 pure LOC threshold.
- **Visual QA via Headless Edge**: Verified rendering through headless Microsoft Edge screenshot (`.omo/evidence/task-16-track-geometry.png`), visually confirming clean unsourced Monza spline, verified multi-overlay rendering, and explicit unavailable error state.

## Honest Model Data Surfaces (Todo 27)
- `/models/info` is the source for the metrics map and observation timestamp; `/models/shap` wraps only the global `shap_summary`; `/benchmarks/challengers` circuit rows contain measured router MAE/RMSE, coverage, p95, and test-lap fields. Do not infer local SHAP deltas, pinball values, or gate verdicts from these contracts.
- The page now leaves metrics, global SHAP rankings, and challenger rows empty until actual valid response fields arrive. Calibration remains unavailable because none of the three endpoint contracts returns measured nominal/observed pairs.
- Scoped ESLint and `tests/unit/test_model_charts.ts` pass. The web typecheck still reports unrelated existing missing `NormalizedGapPoint` in `components/charts/gap/GapTrajectorySvg.tsx`; TypeScript LSP is not installed in this OpenCode environment.

## Integrate API Docs into Global Navigation & Sourced Header Metadata (Todo 14)
- **Truthful Session State**: Connection status is derived directly from `useRaceSocket` (`LIVE`, `REPLAY`, `STALE`, `OFFLINE`). When `socket.connected` is true, status is guaranteed non-OFFLINE (defaults to REPLAY if speed is passed, else LIVE), preventing connected sockets from falsely reporting offline prior to receiving race updates.
- **Dynamic Circuit Lap Count**: Eliminated hardcoded fallback to `66` laps. Lap totals are resolved dynamically from `socket.totalLaps` or `resolveCircuitTotalLaps(socket.sessionId)` using verified calendar and historical replay reference datasets. When session or circuit information is unavailable or offline, concisely renders `N/A`.
- **Zero Synthetic Placeholders**: Fully purged `useNow(30000)` polling loops, fake countdowns, synthetic next-race metadata, `WS CONNECTED`, and fake `on track` / `off track` status badges.
- **Accessible Navigation & Active Route**: Standardized navigation to 7 canonical routes including `/api-docs` with exact label `API DOCS`. Active route matching uses `isActive(pathname, href)` and applies `aria-current="page"` alongside distinctive high-contrast active styling across both desktop (`border-pitwall-accent text-white font-bold`) and mobile (`bg-pitwall-accent/15 text-pitwall-accent border-pitwall-accent/30 font-bold`).
- **Real Browser Verification**: Playwright MCP interacted with live Next.js cockpit: navigated to `/`, clicked `API DOCS`, verified active route state and URL transition to `/api-docs`. Captured responsive visual artifacts in both desktop (`task-14-api-docs-desktop.png`) and mobile viewport (`task-14-api-docs-mobile.png`), and generated headless Microsoft Edge visual verification snapshot (`task-14-site-header-edge.png`).
- **File Size Discipline**: `SiteHeader.tsx` maintains single responsibility with 237 pure non-blank non-comment LOC, strictly conforming to the 250 LOC ceiling.

## Monitoring Era Drift Truthfulness (Todo 28)
- The monitoring page now uses `GET /monitoring/era-drift` for measured per-feature KS, Wasserstein, PSI, and JS values, status/reason, era session counts, and source fingerprint; `/monitoring/overview` contributes only the supplied model metrics and backend timestamp.
- Empty and unavailable era responses render explicit states with their API reason. Feature metrics are rendered only for valid returned rows; no fallback/demo metrics or zero-substituted latency/health cards remain.
- The current API contracts do not include an era sample timestamp or stale flag. The page exposes the overview's actual timestamp and source fingerprint, and marks freshness from elapsed time since the most recent successful poll rather than inventing source-time metadata.
- Focused parser tests cover measured values and `no_data` without injected rows. TypeScript LSP was not installed, so editor diagnostics could not run.

## Driver Data Truthfulness (Todo 29)
- Driver detail no longer generates stint plots or rank/pace claims. Historical lap rows come from OpenF1's latest-session `/laps` records and expose each record timestamp; empty results render an explicit unavailable message.
- Driver radar/profile surfaces remain empty when no per-driver measurements exist and are labeled as team-level car profiles. Detail telemetry continues through `TelemetryOverlay` and `TelemetryTraceChart` with source-provided timestamp metadata; the fabricated rival label was removed.
- Removed the dead `/race` redirect route. Focused telemetry contract tests guard against reintroducing generated laps, rank/pace copy, or unmarked driver-level profile data.

## Source-Derived Race Leaderboard (Todo 23)
- RaceTable now sorts supplied leaderboard fields, keeps the header sticky, exposes keyboard-operated sorting and expandable details, and shows q10/q50/q90 without deriving replacement values.
- Race row subcomponents live in `RaceTableRow.tsx`, `DriverPaceSparkline.tsx`, and `TyreStintBadge.tsx`; missing gap, pace quantiles, sectors, pit data, stint data, and tyre wear remain unavailable.
- The existing `useRaceSnapshot.normalizeRow` still supplies fallback driver/position/tyre/age values before RaceTable. This table-scoped task does not alter that shared consumer contract.
- Focused static-markup checks run using `NODE_PATH=node_modules npx tsx ../../tests/unit/test_race_table.ts` from `apps/web`.

## Socket-Backed Race Event Feed (Todo 24)
- EventFeed subscribes directly to `useRaceSocket().events`; the page's leaderboard-derived `feedEvents` compatibility prop is intentionally not treated as race-control data.
- Socket event id/type/source timestamp are preserved; null lap and timestamp stay unavailable. Safety-car hazard probabilities come from `/predictions/safety-car`; that endpoint currently supplies no observation timestamp.
- An offline socket reports safety-car state unavailable, and the feed has no hardcoded event rows, green banner, or static legend.

## Sector Dominance Real Timing (Todo 25)
- `TrackDominance.tsx` now uses genuine sector timing deltas passed from live data; all fallback `MOCK_ROWS` and character-code modulo hashes were purged.
- When timing data is missing, the component cleanly renders `N/A` with WCAG AA compliant placeholders rather than fabricating purple benchmark sectors.

## Database Persistence, Live Weather & MLOps State (Todo 38)
- Relational schema defined for `LiveWeatherRecord` storing air/track temperature, humidity, pressure, wind, and rainfall probability linked via foreign key to `LiveSession`.
- Async Alembic migrations generated and validated under both SQLite (`aiosqlite`) and PostgreSQL (`asyncpg`).
- `WeatherWidget.tsx` and `useLiveWeather.ts` now read directly from backend persisted weather routes with source timestamps, falling back cleanly to `UNAVAILABLE` when no active session or telemetry exists.

