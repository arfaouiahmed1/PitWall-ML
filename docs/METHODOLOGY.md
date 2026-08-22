# Methodology: CRISP-DM, applied and audited

This document is the process complement to [docs/JOURNEY.md](JOURNEY.md). JOURNEY tells the story: what broke, what it cost, and why the numbers look the way they do. METHODOLOGY shows the framework underneath: how each phase of CRISP-DM maps to concrete files, configs, and artifacts in this repository, what each modeling iteration actually changed, and where practice fell short of the method. If you are deciding whether this project was engineered or improvised, both documents exist so you do not have to guess.

## 1. Framing: why CRISP-DM

CRISP-DM (Cross-Industry Standard Process for Data Mining) divides a data project into six phases: business understanding, data understanding, data preparation, modeling, evaluation, and deployment. It fits an F1 forecasting system for three reasons.

First, the problem is a business problem wearing a math costume. "Predict the next lap time" is meaningless until you ask what decision it serves (pit-wall situational awareness), what uncertainty a user can act on (a calibrated interval, not a bare number), and what failure costs (a confidently wrong forecast is worse than none). That is business understanding, and it deserves its own phase rather than a sentence in a README.

Second, CRISP-DM is iterative by design. The phases form a cycle with feedback arrows running backwards, not a waterfall. This project ran the cycle three times before anyone wrote the word "CRISP" down, and each loop's evaluation became the next loop's problem statement.

Third, every phase produces inspectable artifacts. A methodology you cannot audit is a vibe. The table below is the map; every cell points at something checked into this repo.

| CRISP-DM phase | Concrete artifacts in this repo |
|---|---|
| 1. Business understanding | `configs/promotion.yaml`, `configs/base.yaml`, README objectives |
| 2. Data understanding | `src/pitwall/ingestion/*`, `src/pitwall/data/quality.py`, `artifacts/real/comparison.json` |
| 3. Data preparation | `src/pitwall/data/silver.py`, `src/pitwall/features/pace.py`, `src/pitwall/features/common.py`, `src/pitwall/features/store.py` |
| 4. Modeling | `src/pitwall/models/**`, `pipelines/train.py` |
| 5. Evaluation | `src/pitwall/evaluation/splits.py`, `metrics.py`, `calibration.py`, `tests/leakage/`, `artifacts/real_v2/*` |
| 6. Deployment | `apps/api/pitwall_api/main.py`, `src/pitwall/registry/*`, `src/pitwall/monitoring/metrics.py` |

One honesty note up front: the framework was followed in practice before it was written down. Three full loops ran between August 21 and 22, 2026 (repo timestamps), each ending in metrics saved to disk. This document retrofits the vocabulary onto work that already happened, and section 9 audits where the practice deviated from the ideal.

How to read what follows: sections 2 through 7 walk the six phases in order, each anchored to the files and artifacts that phase produced. Section 8 replays the three iterations as the cycle actually unfolded, section 9 lists the deviations without varnish, and section 10 converts those deviations into the checklist for the next loop.

## 2. Phase 1: Business understanding

The system exists to answer three questions a pit-wall engineer asks during a race:

1. **How fast will the next lap be, and how sure are we?** A pace forecast with a calibrated uncertainty band, not a single number.
2. **Will this driver pit within the next three laps?** A per-driver stop probability driving both the UI risk display and simulator decisions.
3. **Where will the race finish?** A Monte Carlo simulation over remaining laps, producing a distribution over finishing order.

Two explicit non-goals keep the scope honest. Wet-pace prediction is out of scope by construction, because rain laps are filtered out of targets entirely; the model says nothing about them today. Lap-by-lap strategy optimization (when to stop, which compound next) is delegated to the simulator that consumes these predictions rather than attempted end to end.

Success criteria were written as machine-checkable promotion gates in `configs/promotion.yaml` before any challenger could replace a champion:

| Gate | Threshold | Config key |
|---|---|---|
| Primary metric | `mae_seconds` (pace), `brier_score` (pit hazard) | `primary_metric` |
| Challenger improvement | at least 2% relative gain | `min_relative_improvement: 0.02` |
| Subgroup safety | no subgroup regresses more than 10% | `max_group_regression: 0.10` |
| Serving latency | p95 under 100 ms | `latency.p95_ms_max: 100` |
| Interval calibration | nominal coverage 0.80 within a 0.05 tolerance | `interval.nominal_coverage / coverage_tolerance` |
| Required checks | schema, no_leakage, temporal_backtest, feature_contract, artifact_integrity | `required_checks` |

One gate predates the config file because it predates everything: beat the obvious baseline. A model that cannot beat "the last lap they did" or "the median of their last three laps" has no reason to exist, so baselines ship and score alongside every model run (`pipelines/train.py` prints them before any boosting happens).

Each gate maps to a user-facing failure it prevents. The improvement floor stops noise from masquerading as progress when a challenger retrains on new races. The subgroup ceiling stops a model that wins on average while quietly getting worse where it matters, say on worn hards late in a stint. The latency ceiling keeps forecasts usable inside a live replay stream, and the coverage tolerance keeps "80% interval" an honest label rather than marketing.

## 3. Phase 2: Data understanding

**Sources and grain.** Timing and telemetry come from FastF1, OpenF1, and Jolpica behind one async event protocol (`src/pitwall/ingestion/base.py`). Historical replay is the canonical path because official live feeds are paywalled. The modeling grain is one row per lap x driver x session, with `session_id` encoding `{season}_{event}_{session}`.

Scale arrived in two steps. The first real ingest covered five races (2024 Bahrain, Spanish, and Italian; 2025 Monaco and British) with 5,219 valid laps after cleaning. The full-season pass added roughly 43 idempotent ingest calls and brought the total to 48 races spanning 2024 and 2025, which is the dataset every final number rests on.

**TrackStatus semantics.** FastF1 encodes session state as status codes on every lap:

| Code | Meaning | Counts as green? |
|---|---|---|
| `1` | green flag | yes |
| `2` | yellow flag | no |
| `4` | safety car | no |
| `5` | red flag | no |
| `6` / `7` | virtual safety car deployed / ending | no |

Statuses combine into multi-code strings like `'2;4'`, meaning yellow flag plus safety car simultaneously. A lap counts as green only when every code in its string is `'1'`; the predicate lives in `src/pitwall/features/pace.py` as the regex `^[1;]*$`. Getting this wrong in either direction poisons everything downstream, which is exactly what happened in iteration 2.

**Quality contracts.** `src/pitwall/data/quality.py` defines checks that log with severity instead of silently dropping rows: driver_number non-null (critical), lap_number at least 1, position within 1..30, tyre_age non-negative, lap_time inside a 30..400 s plausibility band, compound against a known enum, missing-rate thresholds above 10% warning, and duplicate lap detection per session/driver/lap_number. The design rule: invariants are logged, never silently enforced. The report collapses to two counters (`failed_critical`, `failed_warn`), so pipeline logs can gate on critical failures without parsing individual checks.

**Key discoveries.** Each of these was earned by a failure, not found by curiosity:

- **The NaT leak.** FastF1 returns pandas `NaT` for missing lap times. Converting timedeltas to seconds turns those into NaN floats, and NaN passes Polars' `is_not_null()` check. Invalid laps sailed through validity filtering and poisoned 36 test targets before the fix landed at the fetch boundary (commit `57067f3`). Lesson: at data boundaries, check finiteness, not just nullness.
- **Regime variance dominates error.** The first real evaluation put intermediate-compound error at 13.87 s versus 6.70 s on hards, precisely where rain and safety cars live. Error concentrated exactly where race regime changes, which pointed at the target definition rather than the learner.
- **Per-compound behavior persists after filtering.** Even in the final model, HARD residual sits at 4.17 s against 1.41 s on softs, flagging compound-specific signal the current features do not capture. That is a queued question for the next loop, not a closed one.

## 4. Phase 3: Data preparation

Four structural choices, each listed with the leakage or contamination problem it prevents:

1. **Silver normalization** (`src/pitwall/data/silver.py`). One typed schema: uppercase compound enum with UNKNOWN fill, Float64 lap times, flags derived from pit-in/pit-out timestamps, and an `is_valid_training_lap` column excluding pit laps, safety-car laps, deleted laps, and times outside 30..300 s. Why: type decisions and validity semantics get made once, upstream of every consumer, instead of re-derived (differently) by each one.
2. **Green-flag pair targets** (`src/pitwall/features/pace.py`). The target `next_clean_lap_s` is the next lap's time, shifted -1 within `(session_id, driver_number)`, kept only when lap t AND lap t+1 both ran green AND the next lap does not exceed 1.07x the rolling median of the last five laps. Why: an unconditional next-lap target asks the model to learn safety-car crawl rates and rain transitions as if they were pace. The pair condition guarantees the transition itself was clean; the 1.07x trim removes fuel-less anomalies and slow laps. Safety-car laps stay in the feature stream as context. They just stop being things the model must predict.
3. **Shift-1 rollings** (`src/pitwall/features/common.py`). `rolling_median_3`, `rolling_median_5`, and `rolling_std_5` are computed on `shift(1)` values within each driver/session group, so a row at lap t summarizes laps through t-1 only. Why: point-in-time correctness. Without the shift, the current lap sits inside its own features and the model memorizes instead of forecasting.
4. **Backward as-of feature store** (`src/pitwall/features/store.py`). Historical features are served through backward Polars `join_asof` keyed on `(session_id, driver_number)`. Why: offline training and online serving read from the same feature definitions, so train/serve skew cannot creep in silently. The store's own test asserts the joined value is the historically correct one, not merely that the query exited zero.

The choices in one view:

| Preparation choice | Contamination or leak it prevents |
|---|---|
| Silver normalization | schema drift between consumers |
| Green-flag pair targets | regime chaos inside the label |
| 1.07x rolling-median trim | slow-lap and anomaly labels |
| Shift-1 rollings | the current lap predicting itself |
| Backward join_asof store | future leakage in retrieval, train/serve skew |

One deliberate omission, recorded so it does not look like an accident: weather columns exist in the config schema (`track_temp_c`, `rainfall` in `configs/base.yaml`) but the pace feature builder does not consume them yet. The code marks the nearest-as-of weather join unimplemented, which makes it a queued preparation task rather than hidden debt.

## 5. Phase 4: Modeling

**Baselines first.** `LastLapBaseline` and `RollingMedianBaseline(3)` score on the identical test rows before any gradient boosting runs. The ladder matters more than it looks: the last-lap baseline answers "how much of pace is just persistence?", the rolling median answers "does light smoothing beat persistence?", and only after both are scored does the boosted family get its turn. The gap between them is the honest measure of what feature-based learning adds.

**One LightGBM per question**, all orchestrated in `pipelines/train.py`:

| Question | Model | Objective | Notes |
|---|---|---|---|
| How fast is the next lap? | `PaceLightGBM` | regression, MAE metric | rolling features, tyre age, track position, gaps, compounds |
| How sure are we? | `QuantileLightGBM` | quantile at alpha 0.1 / 0.5 / 0.9 | monotone q10 <= q50 <= q90 enforced at schema level |
| What is the tyre doing? | `TyreLightGBM` | regression on `tyre_deg_s = lap_time - rolling_median_5` | isolates degradation over age, stint, compound |
| Will they pit within 3 laps? | `PitHazardLightGBM` | binary logloss with `scale_pos_weight` | handles roughly 5% positive rate |

Bundling these into one multi-headed model would have been cleverer and worse. Each question has different label hygiene needs, and the pit labels especially benefit from staying separate.

Hyperparameters live in `configs/base.yaml` rather than in code: gradient boosting with 31 leaves, learning rate 0.05, up to 500 estimators with early stopping at 50 rounds, feature fraction 0.9, bagging 0.8 every 5 rounds, and quantile alphas defaulting to [0.1, 0.5, 0.9]. The tyre and pit models run smaller forests (150 estimators, learning rate 0.08, 12 leaves) because their targets are smoother and their rows fewer. The pit classifier computes `scale_pos_weight` from the observed class imbalance when the config does not pin one. Categorical inputs (compound, team, driver, circuit) pass to LightGBM as native categorical features rather than one-hot encodings, keeping the feature space small.

**Why a quantile objective instead of point predictions plus residual bands:** pinball loss optimizes each quantile directly, so interval width can vary with tyre age, compound, and stint instead of assuming the error spread is constant everywhere. Post-hoc residual bands bake in homoscedasticity that lap timing violates by construction (degradation widens true uncertainty lap over lap). Calibration (next phase) then adds the finite-sample coverage guarantee on top of the learned quantiles.

## 6. Phase 5: Evaluation

**Splits are chronological whole-race holdouts, never random by lap** (`src/pitwall/evaluation/splits.py`). Random splits leak: two laps from the same race share fuel load, track evolution, tyre era, and weather, so a random split lets the model memorize the race and gets graded on recall instead of forecasting. Leakage tests in `tests/leakage/` enforce this in CI. The final split (`artifacts/real_v2/splits.json`): 45 training races (all of 2024 plus 21 of 2025), 1 validation race (2025 Spanish GP), 2 test races (2025 Sao Paulo GP, 2025 United States GP), leaving 1,885 held-out test laps.

The single validation race does double duty, and keeping it separate from test is what makes the reported numbers trustworthy. Early stopping reads it during training, and the CQR calibrator fits its correction on validation predictions only. Test races touch neither step, so test metrics measure generalization rather than self-grading. `expanding_window_folds` in the same module implements walk-forward backtesting over races for when multi-fold evaluation is needed; the shipped results use the simpler single holdout.

**Metrics chosen and why** (`src/pitwall/evaluation/metrics.py`):

- **MAE as primary.** Interpretable in seconds and less outlier-sensitive than RMSE, which matters when the occasional chaotic lap would otherwise dominate the headline number.
- **RMSE as context.** Reported alongside MAE, never as primary; it over-weights exactly the rare chaotic laps that target hygiene removed from scope.
- **Pinball loss per quantile.** The proper scoring rule for quantile forecasts. MAE can grade a point estimate but cannot grade an interval; pinball can, and it is reported at q10/q50/q90 separately.
- **Coverage and width together.** Coverage alone is gameable by predicting everything; width punishes vagueness. Both are reported as a pair, raw and calibrated.
- **Per-compound MAE.** The subgroup view that gives the `max_group_regression` gate its evidence. Averages hide exactly this.

**Calibration.** Conformalized Quantile Regression (Romano et al., 2019; `src/pitwall/evaluation/calibration.py`). Conformity scores `E_i = max(q10_i - y_i, y_i - q90_i)` are computed on validation predictions only, and the stored correction widens every interval symmetrically while a median shift corrects the point forecast. Fitted values: `q_hat = 0.096 s`, `d = 0.065 s`. Test races never influence the calibrator, so reported coverage is measured on data it has never seen.

**Final numbers** (`artifacts/real_v2/metrics.json`, `artifacts/real_v2/comparison.json`):

| Metric | Value |
|---|---|
| Pace MAE | 1.635 s |
| Pace RMSE | 4.829 s |
| Raw 80% interval coverage | 80.8% |
| Calibrated 80% coverage | 84.4% |
| Mean interval width (calibrated) | 3.18 s |
| Pinball loss q10 / q50 / q90 | 0.554 / 0.817 / 0.590 |
| Per-compound MAE | SOFT 1.41 s, MEDIUM 1.56 s, HARD 4.17 s |
| Pit classifier AUC | 0.786 (logloss 0.509, positive rate 5.2%) |
| Tyre model MAE | 1.834 s |
| Inference p95 latency | 11.9 ms |
| SHAP top feature | `tyre_age` |

Against the gates: p95 sits far under the 100 ms ceiling, calibrated coverage lands inside 0.80 +/- 0.05, and the model beats the shipped baselines on the same rows. The per-compound table is the subgroup-regression check in action, and it doubles as the pointer to the HARD-compound gap.

The coverage story decomposes into two honest steps, and keeping them separate matters. Target hygiene took raw coverage from 6.2% to 80.8%, mostly by stopping the model from being graded on chaos it was never meant to predict. Calibration then moved 80.8% to 84.4% at a cost of 0.19 s of extra average width (2.986 s raw to 3.178 s calibrated), using validation data alone. Confusing those steps would mean confusing a better question with wider bands.

## 7. Phase 6: Deployment

The serving path: `pipelines/train.py` writes versioned artifacts (`model/`, `model_quantile/` with `calibrator.json`, `model_tyre/`, `model_pit/`, manifests, `metrics.json`, `splits.json`, `config.json`) into the MLflow registry, where champion/challenger aliases move only through the promotion gates. At startup, the FastAPI app loads the champion during its lifespan hook (`apps/api/pitwall_api/main.py`, via `load_champion()`), and predictions stream over WebSocket to the dashboard. Replayed races flow through the identical pipeline live data would use.

Monitoring closes the loop back into business understanding. Prometheus gauges (`src/pitwall/monitoring/metrics.py`) publish exactly the quantities the promotion gates measure: `pace_mae_seconds`, `pace_rmse_seconds`, `pace_interval_coverage`, `pace_mean_width_seconds`, `model_p95_ms`, `tyre_mae_seconds`, `pit_auc`, plus drift signals like `drifting_features_ratio` and `prediction_error_rolling`. Evidently compares a rolling three-race window against the training reference. Retraining fires on a newly completed race, detected drift, or manual dispatch; challengers pass shadow replay over historical races before any promotion. The deployment phase feeds the next iteration's business understanding, which is the point of drawing the circle at all.

The operational loop around promotion runs through GitHub workflows: retraining triggers on schedule or demand, a challenger registers against the champion, shadow replay scores it silently on historical races, and only gates-passing challengers take the alias. Every training run also writes its config, splits, and metrics next to the model binaries, so any deployed champion can be traced back to the exact data and settings that produced it. Latency budgets hold at serving time too: single-row pace predictions measure p95 at 11.9 ms, and batch simulation covers 200 runs across 10 remaining laps in roughly 49 seconds, fast enough to sit behind the API's simulate endpoint.

## 8. Iteration log

Three complete CRISP loops, all real, all reproducible from files under `artifacts/`.

| # | Question asked | Change made | Result | Lesson learned |
|---|---|---|---|---|
| 1 | Does the plumbing work end to end? | Full V1+V2 stack trained on synthetic data (six sessions, four drivers, injected degradation signal) | MAE 0.504 s, pit AUC 1.00, coverage 64.2%, 232 eval laps (`artifacts/smoke/metrics.json`) | Synthetic flatters. Perfect AUC and sub-second MAE said nothing about real laps. The run also crashed once on a degenerate split, teaching that fallback paths need the same rigor as happy paths. |
| 2 | Does it transfer to real laps unchanged? | First real ingest: five races, unfiltered next-lap targets | MAE 8.442 s, coverage 6.2%, intermediate error 13.87 s vs hard 6.70 s, 1,969 laps (`artifacts/real/comparison.json`) | Two bugs surfaced in order: the NaT leak poisoning 36 targets (fixed at the boundary), then the deeper one, that the unconditional target was the wrong question entirely. |
| 3 | Does fixing the target fix the model? | Full-season ingest (48 races); green-flag pair targets with 1.07x trim; CQR calibration fitted on validation only | MAE 1.635 s, coverage 80.8% raw rising to 84.4% calibrated at 3.18 s width, pit AUC 0.786, 1,885 test laps (`artifacts/real_v2/`) | Yes. Target hygiene moved MAE more than every model and infrastructure change combined. Calibration bought the last four coverage points honestly, using no test data. |
| 4 (planned) | Can the model reason about disrupted racing instead of ignoring it? | Queued in section 10: SC-aware features, HARD-compound investigation, same-split baseline bake-off, wider holdout | Not yet run; the section 10 checklist is its business-understanding phase | The cycle stays open on purpose. Writing the next question down before running it is what keeps iteration 4 from repeating iteration 2's mistake of shipping an unexamined target. |

Read the table as the cycle working as intended: each loop's evaluation fed the next loop's understanding, and the biggest win came from re-examining a phase-3 assumption, not from a smarter learner.

Each row regenerates from its artifact directory: `artifacts/smoke/metrics.json` for the first, `artifacts/real/comparison.json` for the second, `artifacts/real_v2/metrics.json` and `splits.json` for the third. Nothing in the table is hand-tuned or aspirational; all of it is what the pipeline printed when it finished.

## 9. Gap analysis

Where practice deviated from the methodology, stated plainly:

1. **Deployment preceded evaluation.** CRISP-DM puts deployment after evaluation; this project inverted them on purpose. The API, dashboard, and replay engine existed before any real-data evaluation ran, because the pieces only prove each other once they run end to end. The cost was serving a model whose accuracy was unknown; the benefit was that when real data arrived, the entire loop was ready to receive it. A deliberate trade, but a deviation.
2. **Formal EDA was light.** Data understanding leaned on the quality-report contracts in `quality.py` alone. No distribution studies, no correlation sweeps, no target histograms until the error collapse forced a per-compound breakdown. The first genuine exploratory artifact was reactive.
3. **MLflow experiment tracking went unused for the real runs.** The registry, promotion, and shadow-replay code works on synthetic runs, but the three real iterations logged flat JSON files under `artifacts/` instead (file-store maintenance mode). Consequence: no side-by-side parameter/metric history for the runs that mattered most, only per-run directories.
4. **The test set is two races.** 1,885 laps sounds like a lot; they come from two circuits in one season. Variance across a different pair of holdout races is unquantified, and any claim of precision beyond that is unsupported.
5. **The same-split baseline bake-off is pending.** The shipped heuristics were scored on the test rows, but richer candidates (gradient-boosted baselines, per-driver medians, sequence models) have not been compared on identical splits. "Beats the baseline" currently means beats two simple ones.
6. **No feature ablation study.** SHAP provides attribution, not causal contribution. No leave-one-feature-out retrains have measured what each feature actually buys.

None of these gaps invalidate the results; they bound what the results mean. Each one maps to an entry in the section 10 checklist, which is the mechanism CRISP-DM offers for turning known deviations into next-loop scope rather than quiet guilt.

## 10. Future-iteration checklist

A reusable template for the next CRISP loop, written so the next cycle starts with the gaps filled rather than rediscovered:

- [ ] **Business:** restate the three objectives; confirm the promotion gates still encode them; decide whether wet-pace skill enters scope
- [ ] **Data:** ingest new rounds idempotently; rerun the quality report; diff incoming data against the training reference for drift
- [ ] **Preparation:** re-audit the target definition against new regimes; add safety-car-aware context as explicit inputs instead of filtering it out
- [ ] **Modeling:** work the queued candidates: SC-aware features, the HARD-compound investigation, a richer baseline ladder, feature ablation
- [ ] **Evaluation:** expand the holdout beyond two races; run the same-split bake-off; refit CQR on fresh validation data, never test
- [ ] **Deployment:** shadow-replay the challenger across historical races; verify gauges move and alerts fire before promoting
- [ ] **Process:** update the iteration log and gap analysis in this document with every new loop, so the methodology and the practice never drift apart again

## Claim provenance

Every number and rule quoted above traces to a checked-in source:

| Claim in this document | Source |
|---|---|
| Promotion gates and thresholds | `configs/promotion.yaml` |
| Quality checks and severities | `src/pitwall/data/quality.py` |
| Target hygiene rules (green pair, 1.07x trim) | `src/pitwall/features/pace.py` |
| Shift-1 rolling construction | `src/pitwall/features/common.py` |
| Split definition (45 train / 1 val / 2 test races) | `artifacts/real_v2/splits.json` |
| Final metrics, including calibration | `artifacts/real_v2/metrics.json`, `artifacts/real_v2/comparison.json` |
| Iteration 1 numbers | `artifacts/smoke/metrics.json` |
| Iteration 2 numbers | `artifacts/real/comparison.json` |
| CQR method and fit-on-validation discipline | `src/pitwall/evaluation/calibration.py` |
| Serving gauges and drift signals | `src/pitwall/monitoring/metrics.py` |

The honest summary: this project iterated like CRISP-DM because the problem forced it to, and this document supplies the vocabulary after the fact. The gaps in section 9 are real. So are the artifacts backing every number above.
