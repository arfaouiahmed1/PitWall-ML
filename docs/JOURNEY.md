# The PitWall ML build journey

The README covers what this system does and how to run it. This document covers the other half: how it got built, what broke along the way, and why the final numbers look the way they do. The process framework lives in [docs/METHODOLOGY.md](METHODOLOGY.md), which maps each CRISP-DM phase to concrete artifacts in this repo.

Everything here is grounded. The execution ledger (`.omo/start-work/ledger.jsonl`) records each phase and its verification commands, the git history timestamps the decisions, and the metric artifacts under `artifacts/` hold every number quoted below. If a claim has no source, it does not appear in this document.

## Results first, because that is the whole story

Three snapshots of the same pace model, in the order they happened:

| Snapshot | Evaluation data | Pace MAE | 80% interval coverage | Pit classifier AUC |
|----------|-----------------|---------:|----------------------:|-------------------:|
| Synthetic smoke test | 232 generated laps | 0.504 s | 35.7% before quantile training, 64.2% after | 1.00 |
| First real ingest | 5 races, unfiltered targets, 1,969 laps | 8.442 s | 6.2% | 0.66 |
| Final | 48 races, green-flag targets, CQR-calibrated, 1,885 held-out laps | 1.635 s | 84.4% | 0.786 |

Sources: `artifacts/smoke/metrics.json`, `artifacts/real/comparison.json`, `artifacts/real_v2/comparison.json`. Each row is what the pipeline actually printed when it finished. Nothing is hand-tuned or aspirational.

Read left to right: a model that looked excellent on generated data fell apart on real race laps, then recovered to genuinely useful once the training target was fixed and the intervals were calibrated. The middle row stays in this table on purpose. The distance between row two and row three is where all the engineering happened, and skipping straight to the flattering endpoint would hide the only part worth reading.

## Timeline at a glance

| When | Commit | What happened |
|------|--------|---------------|
| Aug 21 | `d0223d3` | Full-stack V1 lands in one pass, plus the Pages static-export fight and CI hardening |
| Aug 21 | `587fb3b` | V2: quantile pace, tyre and pit models, simulator, MLflow promotion, SHAP |
| Aug 21 | `91ca5be` | V3: Prometheus, Grafana, Evidently drift, shadow replay wiring |
| Aug 22 | `085d00b` | V4: feature store, flow runner, event bus, infra parity, strict-lint cleanup |
| Aug 22 | `57067f3` | First real ingest exposes the NaT LapTime bug; boundary fix |
| Aug 22 | `fbcf7cd` | Frontend honesty pass: client-side demo sim, honest mode labels |
| Aug 22 | `c6c8db2` | Green-flag targets plus CQR calibration: MAE 8.44 s to 1.64 s, coverage 6% to 84% |

## The phases

### V1: scaffold in a weekend

The first version was written in one pass, because the pieces only prove each other once they run end to end:

- Ingestion from FastF1, OpenF1, and Jolpica behind a single async event protocol (`src/pitwall/ingestion/base.py`)
- Bronze/silver/gold Parquet layers processed with Polars, queried with DuckDB
- A LightGBM pace model sitting next to simple baselines, so "is ML beating the obvious thing" had an answer from day one
- Chronological race-level evaluation, chosen over random splits for reasons explained later
- A replay engine that streams historical races through the live pipeline
- FastAPI with WebSockets, a Next.js race screen, Docker Compose, CI

One decision made that weekend shaped everything after: replay-first. Official live timing is paywalled (OpenF1's live feed requires a EUR 9.90/month sponsorship tier; FastF1 live needs F1TV credentials), so historical replay became the canonical data path. Replayed races flow through the identical `RaceEvent -> RaceState -> Features -> Model -> WebSocket` pipeline that live data would use. Switching sources later is configuration, not a rewrite. That trade (no real-time feed today, in exchange for an architecture that treats live as a drop-in) is cheap to make early and expensive to retrofit.

Shipping baselines alongside the model in the same weekend was deliberate too. A model without a baseline comparison produces numbers nobody can interpret. With one, every future claim has a denominator.

### CI/CD and the Pages static-export fight

Deploying the dashboard to GitHub Pages means Next.js static export, and static export has no patience for server-side dynamics. The race route originally re-exported the client page component directly. Next.js treats that as a dynamic escape hatch: the export bailed out with a `searchParams.toJSON` error and the build worker hit its 60-second timeout. The fix was a thin server wrapper component that renders the client page, which tells the exporter the route is safely static. `apps/web/app/race/page.tsx` is six lines and earns its keep.

The same effort added basePath derivation so project sites under `/PitWall-ML/` resolve assets correctly, `generateStaticParams` for driver detail routes, unoptimized images, and dual frontend builds in CI so both the SSR dev path and the export path stay green on every push. Deploy itself runs through `configure-pages` plus an artifact upload with `.nojekyll`, triggered only when `apps/web/**` changes.

### V2: ML depth

A point estimate hides the interesting part, so V2 split one question into several models:

- **Quantile pace**: LightGBM quantile regression at q10/q50/q90, monotonicity enforced at the schema level, so every forecast ships with an interval instead of a bare number
- **Tyre degradation**: degradation isolated as `tyre_deg_s = lap_time - rolling_median_5`, modeled over tyre age, stint number, and compound
- **Pit hazard**: a binary classifier predicting a stop within three laps, driving both the UI risk display and the simulator's stop decisions
- **Monte Carlo simulator**: remaining laps sampled from the quantile bands, pits injected from the hazard model with roughly 22 s of pit loss and compound-cycle constraints, hundreds of repetitions producing a distribution over finishing order
- **Registry and explanations**: MLflow champion/challenger aliases with promotion gates, SHAP values explaining what the models look at

The simulator stayed practical rather than aspirational: batch mode covers 200 simulations across 10 remaining laps in roughly 49 seconds, fast enough to sit behind an API endpoint.

The synthetic smoke metrics at this stage read like a victory lap: MAE 0.504 s, pit AUC 1.00, SHAP's top feature sensibly `tyre_age`. Interval coverage told a quieter story: 35.7% against a nominal 80%, later improved to 64.2% by quantile training itself. Both numbers were recorded rather than rounded up. That instinct turned out to matter.

### V3: observability

Prometheus instrumentation, a Grafana dashboard checked into `monitoring/grafana/dashboards/`, Evidently drift detection over a rolling 3-race window against the training reference, alert rules, shadow replay where the challenger silently scores historical races before any promotion, and a weekly retrain workflow triggered by a newly completed race, detected drift, or manual dispatch.

Promotion became a gate instead of a hope: at least 2% primary-metric gain, no subgroup regressing more than 10%, interval coverage within tolerance, inference p95 under 100 ms. None of it changed the model. All of it changed how fast a bad model gets noticed, which matters more once real data starts moving underneath you.

### The real-data shock

Then came the first real ingest: five races (2024 Bahrain, Spanish, Italian; 2025 Monaco, British), 5,219 valid laps after cleaning. The metrics collapsed.

Pace MAE went from 0.504 s to 8.442 s, seventeen times worse. Interval coverage fell from 64.2% to 6.2% against a nominal 80%. The bands were 2.47 s wide while errors averaged 8.44 s, so the model was confidently wrong at scale. The per-compound breakdown said exactly why: intermediates averaged 13.87 s of error versus 6.70 s on hards, precisely where rain and safety cars live. The target column contained yellow-flag laps, safety-car crawls, and wet-lap chaos, and the model had been asked to learn all of it as if it were pace.

The diagnosis took minutes once the per-compound table was on screen. This was not model variance or missing feature engineering; the error concentrated exactly where race regime changes, which pointed at the target definition rather than the learner. The fix took longer, because it was not a code bug. It was a definition bug: "next lap time" was the wrong thing to predict.

The numbers went into the README unedited anyway. A results table that only shows the flattering metric tells you nothing about how the system behaves on the data that matters, and the failure mode (tight bands around chaotic targets) was itself information worth publishing.

### V4: advanced infra, local-first

V4 rebuilt the serious-MLOps pieces to run locally with zero new runtime dependencies:

- **Feature store** (`src/pitwall/features/store.py`): point-in-time historical retrieval via backward Polars `join_asof` on `(session_id, driver_number)`, online/offline views, and a gold-store materializer
- **Flow runner** (`src/pitwall/orchestration/flow.py`): task/flow decorators with retry, backoff, run manifests, and a dry-run CLI
- **Event bus** (`src/pitwall/eventbus/stream.py`): Redis Streams consumer groups with NOGROUP recovery, behind an in-memory fallback that logs once instead of failing silently
- **Infra parity notes** (`infra/PARITY.md`): every compose service mapped to its free-tier cloud equivalent

Verification stayed strict throughout: 32 tests passing, ruff clean under strict rules, both frontend builds compiling, compose config valid, CI green in 7m03s. Each work item carried an adversarial review pass before it counted as done, hunting specific failure classes: stale state, misleading success output, flaky tests, hung commands, dirty worktrees. The point-in-time store test, for example, asserts the joined value is the historically correct one (94.0, not the latest 999.0), not merely that the query exited zero.

### Frontend honesty pass

The hosted Pages demo has no backend to stream from. Rather than fake a connection, the dashboard got a client-side simulator (`apps/web/lib/raceSim.ts`) that advances a lightweight race model entirely in the browser: per-driver base pace, tyre degradation, stochastic lap noise, occasional slow laps, and pit stops inside the classic window. It auto-starts where no WebSocket exists and freezes the moment a real replay connects, so the demo never masquerades as the real pipeline.

Mode labels now say plainly what is simulated and what is not. Jargon leaks in the UI copy got removed. The leaderboard shows real driver names and headshots through a defensively-mapped OpenF1 lookup with an offline fallback map, so the page renders correctly even with no network. Verification here meant grepping the rendered HTML for actual driver names rather than trusting that the build succeeded.

### Quality breakthrough

The fix for the shock came in three moves.

**Scale first.** Full-season ingest across 2024 and 2025, roughly 43 idempotent ingest calls that skip races already on disk, giving 48 races total. More data alone did not fix anything, but it made the next two moves statistically meaningful instead of anecdotal.

**Target hygiene second.** A lap only trains when lap t AND lap t+1 ran green (FastF1 track status matching only `'1'` codes, since multi-code statuses like `'2;4'` mean yellow plus safety car), and the next lap may not exceed 1.07x the rolling median of the last five laps. Safety-car laps stay in the feature stream as context; they just stop being things the model must predict.

**Calibration third.** Conformalized Quantile Regression fitted on the validation race, never test, widening the raw quantile bands by a correction learned from held-out predictions.

Result: MAE 1.635 s, calibrated coverage 84.4% at a 3.18 s mean width, pit classifier AUC up from 0.66 to 0.786, inference p95 at 11.9 ms. Per-compound MAE landed at 1.41 s soft, 1.56 s medium, 4.17 s hard. Raw coverage before calibration was already 80.8%; calibration bought the last four points honestly, at the cost of 0.19 s of extra average band width.

## Five bugs worth remembering

### 1. Polars renamed an argument

**Symptom:** rolling-feature construction failed with an unexpected-keyword error.

**Cause:** newer Polars renamed `min_periods` to `min_samples`, and the code called `rolling_median(window_size=w, min_periods=w)`.

**Fix:** update the call sites in `src/pitwall/features/common.py`.

**Lesson:** dataframe library APIs move. A lockfile plus a test suite are the only things standing between you and finding out at runtime.

### 2. The static-export bailout

**Symptom:** the Pages deploy died with a `searchParams.toJSON` error and the build worker hit its 60-second timeout.

**Cause:** the race route re-exported a client page component as its default export, which Next.js reads as a potentially dynamic route, so static export bails out.

**Fix:** a six-line server wrapper component rendering the client page (`apps/web/app/race/page.tsx`).

**Lesson:** with static export, the shape of your imports is a deployment concern, not just a style choice.

### 3. The big one: NaT lap times that passed null checks

**Symptom:** the first real-data evaluation produced all-NaN metrics.

**Investigation:** traced upstream to FastF1 returning pandas `NaT` for missing lap times. Converting timedeltas to seconds turned those into NaN floats, and NaN passes Polars' `is_not_null()` check. Invalid laps sailed through validity filtering and poisoned 36 test targets.

**Fix:** drop them at the boundary with `laps = laps[laps["LapTime"].notna()]` in the fetch layer (commit `57067f3`).

**Lesson:** at every data boundary, check finiteness, not just nullness. Null checks ask "is there a value"; finiteness asks "is the value usable".

### 4. The degenerate smoke split

**Symptom:** LightGBM crashed during the smoke test with an empty training set.

**Cause:** the `max_rows` cap landed mid-way through the second session of a two-session dataset. The chronological splitter demands at least four sessions and raised its error, and the fallback path produced an empty train split.

**Fix:** explicit fallback branches in `pipelines/train.py` guaranteeing non-empty train/validation/test for three sessions or fewer.

**Lesson:** smoke tests exist to fail loudly. This one failed in a way that taught us the fallback needed the same rigor as the happy path.

### 5. The costliest non-bug: the unconditional target

No crash, no stack trace, just quietly wrong learning. The original target was "the next lap time", full stop. That asked the model to predict safety-car chaos, virtual-safety-car crawl rates, and rain transitions as if they were pace. Every downstream metric inherited the noise.

**Fix:** in `src/pitwall/features/pace.py`, require green status on the current lap and the next one, then trim outliers beyond 1.07x the rolling median.

**Lesson:** this single change moved real-data MAE more than any model or infrastructure work in the entire project. When metrics look hopeless, audit the target definition before touching the model.

## How the model is actually trained

### Splits are chronological by whole race, never random by lap

Random splits leak. Two laps from the same race share fuel load, track evolution, tyre era, and weather, so a random split lets the model memorize the race and get graded on recall instead of forecasting. PitWall sorts sessions by ID, holds out the last two races for test and the one before them for validation, and trains on everything earlier. Leakage tests in `tests/leakage/` enforce this in CI on every push.

### Features are point-in-time by construction

A training row may contain only what was knowable at prediction time. Rolling medians and standard deviations shift by one lap before computing, so a row at lap t never sees lap t. The feature store serves historical features through backward as-of joins keyed on `(session_id, driver_number)`, which means online serving and offline training read from the same feature definitions and cannot drift apart silently.

### The target evolved with the data

It started as the raw next lap time. It is now `next_clean_lap_s`: the next lap's time, kept only when both the current lap and the next one ran green, and when the next lap sits within 1.07x of the recent rolling median. Race context (safety cars, rain) is deliberately excluded from the target rather than modeled. That exclusion is honest about what the model knows today and explicit about what future work should add back as inputs.

### One model per question

Point pace regression answers "how fast". Quantile regression at q10/q50/q90 answers "how sure". Tyre degradation models the delta between lap time and rolling median over age, stint, and compound. The pit hazard classifier answers "will this driver stop within three laps". Bundling these into one multi-headed model would have been cleverer and worse: each question has different label hygiene needs, and the pit labels especially benefit from staying separate.

### CQR calibration touches only validation data

The calibrator computes conformity scores `E_i = max(q10_i - y_i, y_i - q90_i)` on validation predictions and stores a correction `q_hat` at the finite-sample order-statistic level (Romano et al., 2019), widening every interval symmetrically; a median shift `d` corrects the point forecast. Fitted values: `q_hat = 0.096 s`, `d = 0.065 s`. Test races never influence it, so reported coverage is measured on data the calibrator has never seen.

### The final split

45 training races (all of 2024 plus 21 of 2025), 1 validation race (2025 Spanish GP), 2 test races (2025 Sao Paulo GP, 2025 United States GP), leaving 1,885 held-out test laps. Every number in the final results row comes from those two test races and nothing else.

### Honest caveats

- **Two test races is a small sample.** These numbers carry real variance, and a different pair of races would move them.
- **Compound effects are under-captured.** The HARD residual sits at 4.17 s against 1.41 s on softs, so something compound-specific is missing from the current features.
- **The baseline comparison is thin.** The final model beats the rolling median baseline (1.77 s MAE) comfortably, but a proper bake-off against richer baselines on identical splits is still future work. Claiming victory without it would be premature.
- **Wet pace is out of scope by construction.** Rain laps are filtered from targets, so the model says nothing about them today.

## Provenance: how to check these claims

| Claim | Source |
|-------|--------|
| Synthetic smoke metrics (0.504 s MAE, 64.2% coverage, 232 laps) | `artifacts/smoke/metrics.json` |
| First real run (8.442 s MAE, 6.2% coverage, 1,969 laps, per-compound errors) | `artifacts/real/comparison.json` |
| Final run (1.635 s MAE, 84.4% calibrated coverage, 0.786 pit AUC, 1,885 laps) | `artifacts/real_v2/comparison.json`, `artifacts/real_v2/metrics.json` |
| Race split (45 train / 1 val / 2 test) | `artifacts/real_v2/splits.json` |
| CQR parameters (q_hat 0.096 s, d 0.065 s) | `artifacts/real_v2/model_quantile/calibrator.json` |
| NaT bug and boundary fix (36 poisoned targets) | commit `57067f3`, `src/pitwall/ingestion/fastf1.py` |
| Green-flag target hygiene (status regex, 1.07x trim) | `src/pitwall/features/pace.py` |
| CQR method (fit on validation only) | `src/pitwall/evaluation/calibration.py` |
| Phase-by-phase execution record | `.omo/start-work/ledger.jsonl` |

## What the final numbers do and don't say

A few patterns worth noticing across the three snapshots:

- **SHAP's top feature stayed `tyre_age` in every era**, synthetic and real alike. Whatever else changed, the models kept looking at the physically sensible thing.
- **Latency stayed flat while accuracy transformed**: p95 went 7.6 ms (synthetic) to 13.1 ms (first real run) to 11.9 ms (final). The quality breakthrough cost nothing at serving time.
- **Coverage recovered in two distinct steps**: target hygiene took raw coverage from 6.2% to 80.8%; CQR added the last four points using validation data only. Confusing those steps would mean confusing "stop predicting chaos" with "widen the bands".
- **The pit classifier improved without rebalancing tricks**: positive rate sits around 5.2% of laps, and AUC still climbed from 0.66 to 0.786 once trained on cleaner race data.

What they don't say: anything about generalization beyond two test races, wet-pace skill (wet laps are filtered out of targets entirely), or superiority over baselines more sophisticated than a rolling median.

## What would come next

Three directions, in the order they would pay off:

- **Safety-car-aware features**: reattach race context (SC laps, rainfall, traffic) as explicit inputs instead of filtering it out, so the model can reason about disrupted racing instead of ignoring it.
- **Baseline bake-off**: gradient-boosted baselines, per-driver medians, and sequence models evaluated on the exact same chronological splits, so "beats the baseline" becomes a measured claim rather than a hopeful one.
- **Live OpenF1 MQTT feed**: replace replay as the streaming source and exercise the paywalled-live path the architecture was designed for.

The short version of this whole document: synthetic data flatters, real data teaches, and most of the accuracy came not from a better model but from a better-defined question. The model got marginally smarter. The target definition got honest.
