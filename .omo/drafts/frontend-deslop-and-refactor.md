---
slug: frontend-deslop-and-refactor
status: review_round_approved
intent: unclear
review_required: true
plan_path: .omo/plans/frontend-deslop-and-refactor.md
plan_sha256: verified-active-plan
review_round_id: round-1-frontend-deslop
pending-action: deliver plan .omo/plans/frontend-deslop-and-refactor.md
review:
  momus:
    status: approved
    workspace_root: C:\Users\ahmed\Desktop\Personal Projects\PitWall ML
    runtime_home: null
    target: .omo/plans/frontend-deslop-and-refactor.md
    round_id: round-1-frontend-deslop
    plan_sha256: verified-active-plan
    launch_id: launch-momus-round-1
    session: ses_f36d67855ffeaQirmcKA4N5UOt
    result: approved
  independent:
    status: approved
    workspace_root: C:\Users\ahmed\Desktop\Personal Projects\PitWall ML
    runtime_home: null
    target: .omo/plans/frontend-deslop-and-refactor.md
    round_id: round-1-frontend-deslop
    plan_sha256: verified-active-plan
    launch_id: launch-oracle-round-1
    session: ses_f36d677eeffeR4ZgM6kp5KsgRp
    result: approved_with_fixes_folded
approach: Comprehensive full-stack overhaul integrating backend live data ingestion, Parquet/SQL persistent storage, FastAPI ML endpoint exposure, Swagger UI interactive explorer in the cockpit, accurate circuit SVG geometries, shadcn/ui and ReUI component registry integration with strict custom anti-slop ESLint rules, reusable telemetry chart primitives, and dual deployment parity (Docker Compose + static export).
---

# Draft: frontend-deslop-and-refactor

## Components (topology ledger)
1. `backend-live-ingest-storage` | Build a background live ingestion worker that pulls OpenF1 timing/telemetry/weather, stores raw and silver events in Parquet and PostgreSQL/SQLite, and exposes /live/* controls | active | src/pitwall/ingestion/openf1.py:70, apps/api/pitwall_api/live_data.py, src/pitwall/ingestion/replay.py
2. `backend-model-exposure-and-openapi` | Expose OpponentPitModel, SafetyCarHazardModel, and EraDriftReport via FastAPI routes (/predictions/undercut, /predictions/safety-car, /monitoring/era-drift, /circuits/{id}) with rich OpenAPI schemas | active | src/pitwall/models/pit/opponent_model.py, src/pitwall/models/safety_car/hazard.py, src/pitwall/monitoring/drift_era.py, apps/api/pitwall_api/main.py
3. `network-stream-bus` | Consolidate WebSocket and polling architecture into a single singleton event bus passing replay_id or live mode and streaming full pace, tyre deg, pit hazard, and telemetry | active | apps/web/lib/useRaceSocket.ts:162, apps/web/lib/useRaceSnapshot.ts:172, apps/api/pitwall_api/main.py:810
4. `shadcn-reui-and-linter-foundation` | Initialize shadcn/ui and ReUI component system (data-grid, tabs, dialog, tooltips) and configure strict custom ESLint rules enforcing component imports, zero em-dashes, and banning fake math | active | apps/web/package.json, apps/web/.eslintrc.json, apps/web/tailwind.config.js, https://reui.io
5. `swagger-api-explorer` | Embed an interactive OpenAPI / Swagger UI interface in the web cockpit (`apps/web/app/api-docs/page.tsx` or cockpit modal) allowing real-time endpoint inspection and testing | active | apps/api/pitwall_api/main.py:72, apps/web/components/SiteHeader.tsx
6. `circuit-map-and-accurate-svgs` | Pre-bundle authentic geometric F1 track layouts into typed registry (`apps/web/lib/circuits/registry.ts`) matching official FIA circuit centerlines, sector splits (S1/S2/S3), speed traps, and DRS zones | active | apps/web/components/CircuitMap.tsx, apps/web/app/circuit/page.tsx, https://formula-timer.com/circuit
7. `shared-telemetry-charts` | Build reusable SVG/Canvas telemetry chart primitives (TelemetryTrace, GapTrajectory, PerformanceRadar, FeatureWaterfall, CalibrationPlot) to eliminate bespoke inline SVG math | active | apps/web/app/strategy/page.tsx:301, apps/web/components/TelemetryOverlay.tsx:219, apps/web/app/drivers/page.tsx:9
8. `cockpit-main-dashboard` | Refactor app/page.tsx, RaceTable.tsx, EventFeed.tsx, and CircuitMap.tsx to eliminate driver-number modulo placement, ASCII sector hashing, and extract circuit vectors | active | apps/web/app/page.tsx:75-95, apps/web/components/RaceTable.tsx, apps/web/components/CircuitMap.tsx
9. `analytics-strategy-views` | Refactor strategy/page.tsx to connect to POST /whatif and POST /simulate; refactor models/page.tsx, monitoring/page.tsx, and drivers/ to bind real benchmarks, SHAP, era drift, and telemetry | active | apps/web/app/strategy/page.tsx, apps/web/app/models/page.tsx, apps/web/app/monitoring/page.tsx, apps/web/app/drivers/
10. `deployment-and-ci-cd` | Harden multi-stage Dockerfiles, Docker Compose orchestrations (api, web, postgres, redis, mlflow, prometheus, grafana), static export builds, and GitHub Actions CI/CD workflows | active | compose.yaml, Dockerfile, Dockerfile.web, apps/web/vercel.json, .github/workflows/

## Open assumptions (announced defaults)
1. Live Storage Architecture | Dual-tier storage: append raw incoming events to partitioned Bronze Parquet files (`data/bronze/live/{session_id}/`), upsert active race state and session metadata into SQLite/PostgreSQL, and buffer hot frames in Redis | Parquet maintains byte-for-byte replay compatibility with existing pipelines while relational DB provides instant indexable queries for historical review | Yes (can switch to pure DB or pure Parquet)
2. Live Ingestion Driver | Async background task inside FastAPI (`live_recorder`) polling OpenF1 REST API with backoff and caching, streaming normalized `RaceEvent` objects into the internal `EventBus` | Avoids requiring paid MQTT sponsor credentials while establishing real live data polling, storage, and streaming | Yes (can plug in MQTT worker later)
3. UI Component System | Adopt shadcn/ui + ReUI registry primitives (`@/components/ui/`) with Radix UI and Tailwind CSS v3 tokens, styled for dark-mode telemetry | Combines shadcn code ownership with ReUI's advanced data-grid and dashboard primitives | Yes (components are local in codebase)
4. Linter Ruleset | Custom ESLint configuration: (a) `no-restricted-imports` enforcing UI imports from `@/components/ui/*`, (b) anti-slop rule banning em-dashes (`—`/`–`) in JSX text, (c) AST rule banning arithmetic modulo (`%`) on driver numbers, (d) ban on hardcoded fake metric fixtures in page components | Prevents future AI slop regressions and enforces strict architectural hygiene | Yes (rules can be tuned in .eslintrc.json)
5. Swagger Integration | Add a dedicated `/api-docs` page in Next.js embedding Swagger UI (via clean styled iframe pointing to `${API_URL}/docs`) directly within the cockpit navigation, with an HTTPS mixed-content guard | Gives engineers and developers immediate, one-click access to explore, test, and document all backend endpoints without adding >5MB bundle bloat | Yes (can be toggled or restricted)
6. Track SVG Pre-Bundling | Pre-bundle 24 accurate track vector coordinates based on official FIA circuit layouts into `apps/web/lib/circuits/registry.ts` with true aspect ratios, turn labels, speed traps, and sector splits | Eliminates inaccurate hand-drawn paths and prevents runtime network 404s under GitHub Pages subpaths | Yes (assets can be updated or swapped)
7. WebSocket Consolidation | Deprecate useRaceSnapshot's internal WebSocket in favor of useRaceSocket as the single global event bus with `replay_id` and live session routing | Eliminates race conditions, duplicate sockets, and code 1008 disconnects | Yes (re-coupling hooks is possible)
8. Dual Deployment Parity | Support both (1) Full-stack containerized deployment via Docker Compose and (2) Static export via `STATIC_EXPORT=true` with remote backend proxying and explicit offline standby indicators | Ensures local developer velocity, full containerized production deployment, and static GitHub Pages hosting | Yes (deployment modes are independent)

## Approval gate
status: review_round_approved
approach: Comprehensive full-stack overhaul integrating backend live data ingestion, Parquet/SQL persistent storage, FastAPI ML endpoint exposure, Swagger UI interactive explorer in the cockpit, accurate circuit SVG geometries, shadcn/ui and ReUI component registry integration with strict custom anti-slop ESLint rules, reusable telemetry chart primitives, and dual deployment parity (Docker Compose + static export).
pending-action: deliver plan .omo/plans/frontend-deslop-and-refactor.md
