# Issues — frontend-deslop-and-refactor

Problems and gotchas encountered during work on this plan.

_Auto-scaffolded by /start-work. Append new entries below - never overwrite._

---

## Todo 15 reopened verification
- The web package's `npm test` script is a placeholder (`echo "no tests"`); run the circuit test directly with `npx tsx ../../tests/unit/test_circuits_registry.ts` from `apps/web`.
- Playwright Chromium is not installed, and browser download timed out. Visual responsive verification is blocked until a browser executable is available.
- Requested `npx tsc --noEmit` fails in pre-existing `apps/web/app/api-docs/page.tsx:1226` (`unknown` is not assignable to `ReactNode`). `npm run lint` also fails on unrelated existing violations in `app/drivers/page.tsx` and `app/page.tsx`.

## Todo 21 verification
- The real chart contract test resolves `react-dom/server` when run from `apps/web` with `NODE_PATH=node_modules npx tsx ../../tests/unit/test_model_charts.ts`; the web package's `npm test` remains a placeholder and is not meaningful test evidence.
- A deliberately unsorted global importance fixture failed before the renderer fix, proving global rankings must be sorted descending; after sorting, the contract test, web project typecheck, and chart-scoped ESLint pass.
- Browser QA is blocked because Playwright cannot find the configured Chrome executable. No browser render or screenshot is claimed.

## Todo 27 follow-up verification
- Independently matched the page parser fields to `apps/api/pitwall_api/main.py`: `/models/info` returns `metrics` and ISO `timestamp`; `/models/shap` returns `shap_summary` and `model_version`; `/benchmarks/challengers` returns `circuit_results`. `artifacts/benchmark_challengers.json` circuit rows contain `circuit`, `test_laps`, `router_mae_ms`, `router_rmse_ms`, `router_cov80_pct`, and `router_p95_ms`, matching the page fields. No response contains measured nominal/observed calibration pairs; no contract correction or regression test was needed.
- Edge is installed at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`. UX QA is BLOCKED: initial app launch failed with `EADDRINUSE` on port 3000; an alternate-port dev command exceeded its 160s tool bound, and the alternate URL refused connections. The pre-existing port-3000 server also timed out on an HTTP request. Edge headless exited successfully but could not connect to the attempted page, so no page render QA passed. Removed the failed screenshot and temporary Edge profile; no attempt-owned app/browser processes remained.

## Todo 16 verification
- `TrackGeometry` component previously lacked export of `resolveSectors` and `clampProgress`. Added `resolveSectors` with an explicit empty array `[]` return when sector overlays are unavailable or empty (banning guessed thirds).
- Re-architected `TrackGeometry.tsx` into modular sub-modules `TrackOverlays.tsx` and `trackUtils.ts` to strictly maintain the 250 LOC rule (< 200 pure LOC each).
- Playwright Chromium was unavailable (Chrome absent at expected path, install admin-restricted). Used Windows installed Microsoft Edge (`msedge.exe`) in headless mode to capture visual verification artifact `.omo/evidence/task-16-track-geometry.png`.

## OpenCode model and ReUI connectivity
- Root is running on `openai/gpt-6-luna`; `opencode models` confirms `opencode/muse-spark-1.3-contributor-free` is available, but the `task`/team category APIs do not accept a per-child model parameter. Existing team categories were created with Gemini routing and cannot be hot-switched mid-session. Project config change is queued for GPT-6 Luna defaults after restart.
- Project ReUI skill and MCP configuration are present, but this running OpenCode process does not expose a `reui` MCP namespace. Skill 33 remains `-[~]` pending OpenCode restart and user OAuth. A bounded `opencode mcp list` probe exceeded 20 seconds and the shell tool terminated it; no interactive auth command was run.
- Production backend target is not yet declared in repository workflows. Pages is defined, but backend runtime endpoint/host and Actions secret names must be checked before any production publish; do not invent a host or deploy an API without security config.

## Todo 28 verification limits
- `tests/unit/test_monitoring_page.ts` passed via `NODE_PATH=node_modules npx tsx ../../tests/unit/test_monitoring_page.ts` from `apps/web`; scoped `npx eslint app/monitoring/page.tsx` passed, and the static fake-metric search returned no matches.
- `npx tsc --noEmit` remains blocked by the inherited unrelated missing `NormalizedGapPoint` export in `components/charts/gap/GapTrajectorySvg.tsx`. TypeScript LSP is unavailable.
- Browser rendering was not attempted: the inherited port 3000 request timed out and alternate startup exceeded its tool bound. No visual QA is claimed.
- The active executor is OpenAI GPT-6 Luna. Gemini routing/rate-limit claims for category agents are not independently observable from this executor; no category agent was used.

## Todo 24 verification limits
- Focused event feed contract test and scoped ESLint pass. `npx tsc --noEmit` remains blocked by the unrelated missing `NormalizedGapPoint` export in `components/charts/gap/GapTrajectorySvg.tsx`; the TypeScript LSP server is not installed.
- The safety-car endpoint response has no timestamp field, so its forecast display includes no timestamp. No browser QA was performed.

## Stopped Local Background Servers
- All stray Node/Next.js dev processes listening on ports 3000, 3005, 3015 have been gracefully terminated per user instruction. No hanging listeners remain.

