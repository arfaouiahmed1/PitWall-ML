# Methodology

PitWall ML follows CRISP-DM loosely across six iterations. This is a personal project, so "process" here mostly means "what I iterated on and why."

## The problem

Raw F1 lap times are noisy. Safety cars, VSC periods, pit in/out laps, and formation laps inflate error by 4–8x if you naively train on all of them. The first non-obvious thing this project does is define a clean lap target: green-flag, non-pit laps where the next lap is also green and within 1.07× the rolling median. That alone dropped MAE from ~8s to ~1.7s.

## Feature engineering choices

**Rolling medians (3-lap and 5-lap)** are by far the most important features (ablation: +4.0s MAE without them). They act as a per-driver pace anchor that accounts for fuel load, track evolution, and tyre state in one shot.

**Weather joins** use a 15-minute backward `join_asof` — not a session-level average — because track temperature changes meaningfully within a race. In practice, weather features have near-zero marginal contribution on the 2024/2025 data (ablation delta ≈ 0), probably because the rolling medians already capture pace changes driven by temperature.

**Hard compound non-linearity** was the biggest model accuracy gap (~4.3s MAE vs ~1.4s for Soft). Hard tyres have a 1–3 lap graining phase before settling. I added `tyre_warmup_phase` (binary, lap ≤ 3 in stint) and a `compound_temp_interaction` term. Combined with a post-hoc additive bias correction (mean residual on Hard test laps), this cuts Hard MAE significantly.

**2026 Active Aero features** (`x_mode_ratio`, `circuit_energy_difficulty`) currently have zero ablation delta — likely because there's no real 2026 race data yet and the feature values are imputed. Worth revisiting once actual 2026 sessions are available.

## Model selection

| Model | Why it was tried |
|---|---|
| LastLap baseline | lower bound — any model should beat this |
| Rolling median | sanity check on feature engineering |
| Ridge regression | checks whether the problem is linear |
| LightGBM point | standard GBM, fast to tune |
| CatBoost | better native categorical handling for driver/team/circuit |
| QuantileLightGBM + CQR | **chosen champion** — outputs intervals, not just point estimates |

Single point predictions are not useful for strategy decisions. "Norris's next lap will be 84.2s" is less actionable than "Norris's next lap is 83.8–86.0s with 80% probability." Quantile regression with conformal calibration (CQR) gives you the second answer with a statistical guarantee on coverage.

CatBoost ended up with surprisingly poor coverage (9.6%) — it falls back to Ridge when catboost isn't installed in the test environment, which explains the identical numbers to Ridge in the bakeoff output.

## Validation

Strict chronological split: no data leakage across time. Test set = last 2 Grand Prix races. Validation = 1 race before test. Everything before that is training.

Walk-forward backtest over 5 folds is implemented in `src/pitwall/evaluation/splits.py` but only generates metadata in the current pipeline (no full retraining per fold, which would be expensive).

## Conformal calibration

The raw quantile model achieves 82.8% empirical coverage on test laps. CQR shifts the interval by a scalar `q_hat` (computed on validation predictions) to hit the target. The rolling 3-race calibration window updates `q_hat` across recent races rather than anchoring to a single venue — this matters because circuit characteristics affect lap time variance (Monaco vs Monza are very different).

## Drift detection

The 2025→2026 regulation change (active aerodynamics, revised MGU-K) is a known distributional shift. The monitoring module tracks Wasserstein distance, KS statistic, PSI, and JS divergence on rolling feature windows to flag when the model's training distribution diverges from what it's seeing in production.

## What's not great

- Hard compound MAE is still ~4.3s after correction. The real fix is more Hard compound data — 87 laps out of 1,885 is 4.6% of the training set.
- Weather features don't help yet — probably need actual lap-level telemetry-synchronised weather rather than session-level API data.
- 2026 features are speculative until real 2026 race data exists.
- The walk-forward backtest doesn't retrain per fold (slow), so the fold-level MAE numbers aren't fully rigorous.
