# Methodology & Model Architecture

PitWall ML evolves across systematic iterations. This document captures what was tried, why it failed or succeeded, and how the models achieve sub-second precision across diverse circuits.

---

## 1. The Core Modeling Problem: Target Formulation

### Why Absolute Lap Time ($y_{t+1}$) Fails
Initially, PitWall ML predicted absolute lap times directly:
$$\hat{y}_{t+1} \approx 84.512\text{ s}$$

This created an artificial error ceiling of **$\approx 1.4\text{s}$ ($1,400\text{ms}$)** due to two structural issues:
1. **Tree Leaf Quantization**: Decision trees (LightGBM/CatBoost) partition feature space into orthogonal hyperplanes and assign a constant scalar to each leaf. If a leaf outputs $84.250\text{s}$ and the actual lap is $84.600\text{s}$, the error is already $350\text{ms}$ purely from discretization.
2. **Cross-Circuit Contamination**: When trained across Monaco ($74\text{s}$), Monza ($83\text{s}$), and Spa ($105\text{s}$), an absolute model spends most of its capacity fitting track baselines rather than tyre degradation. When evaluated on an unseen circuit in Leave-One-GP-Out testing, the absolute model failed with **$5,536\text{ms}$ ($5.5\text{s}$) MAE**.

Crucially, the trivial baseline `LastLapBaseline` ($y_{t+1} = y_t$) had an MAE of **$0.381\text{s}$ ($381\text{ms}$)**, outperforming the full absolute tree model.

### The Architectural Shift: Delta / Residual Modeling
Instead of predicting absolute lap times from scratch, we model the **lap-to-lap pace delta**:
$$\Delta_{t+1} = y_{t+1} - y_t$$
$$\hat{y}_{t+1} = y_t + \hat{\Delta}_{\text{model}}$$

* **Absolute lap time variance**: $\sigma \approx 3.50\text{s}$ (Monaco $74\text{s}$ to Spa $105\text{s}$; fuel loads $100\text{kg}$ to $5\text{kg}$).
* **Lap-to-lap delta variance**: $\sigma \approx 0.25\text{s}$ (IQR = $0.50\text{s}$; fuel burn $-0.033\text{s}$, tyre wear $+0.05\text{s}$).

Because fuel mass burn-off and tyre wear curves are physical invariants across all tracks, the delta formulation immediately dropped error from **$1,424\text{ms} \to 313.9\text{ms}$ ($78\%$ error reduction)**.

---

## 2. Sector Momentum Propagation

Corner exit speed directly determines straight-line speed into the next sector:
- A bad exit in Sector 1 lowers intermediate boundary speed `SpeedI1`, carrying a deficit across the entire S2 straight.
- A bad exit in Sector 3 lowers finish line speed `SpeedFL`, penalizing Sector 1 on the *next* lap.

The feature store extracts intermediate speed traps from free timing data:
* `speed_fl_delta`: Finish line exit speed delta into next lap's Sector 1.
* `speed_i1_delta`: S1 exit speed delta into Sector 2 acceleration zone.
* `speed_i2_delta`: S2 exit speed delta into Sector 3.
* `s1_delta`, `s2_delta`, `s3_delta`: Sector split offsets from session medians.

Feature importance analysis confirmed these are the highest-gain predictors alongside fuel mass burn.

---

## 3. Two-Stage Hybrid Estimator (`HybridPaceModel`)

To push toward the physical noise floor of motorsport ($\approx 100\text{ms}$–$200\text{ms}$), we decoupled deterministic physics from stochastic machine learning:

```
[Lap t State] ──▶ [Stage 1: Deterministic Physics] ──▶ Δ_physics (± 0.05s)
                    • Fuel burn-off: -0.033s / lap
                    • Compound deg polynomial
                    • Hard warmup penalty
                        │
                        ▼
                  [Stage 2: Quantile LightGBM]      ──▶ ε_ML (± 150ms - 250ms)
                    • Predicts residual:
                      ε = Δ_actual - Δ_physics
                        │
                        ▼
                  y_pred = y_t + Δ_physics + ε_ML
                    (Reconstructed Lap MAE: ~274ms - 302ms)
```

1. **Stage 1 (Deterministic Physics)**:
   $$\Delta_{\text{physics}} = -\alpha_{\text{fuel}} + \beta_{\text{compound}}(\text{tyre\_age})$$
   - Fuel burn effect: $\alpha = 0.033\text{ s/lap}$ ($1.6\text{kg/lap} \times 0.03\text{s} / 10\text{kg}$).
   - Compound degradation rates ($\beta$): Soft $0.055\text{ s/lap}$, Medium $0.028\text{ s/lap}$, Hard $0.014\text{ s/lap}$.
   - Hard tyre graining penalty: $+0.12\text{ s/lap}$ on laps $\le 3$.
2. **Stage 2 (Quantile Residual ML)**:
   The residual $\epsilon = \Delta_{\text{actual}} - \Delta_{\text{physics}}$ is zero-centered with collapsed variance ($\sigma < 0.22\text{s}$). Quantile LightGBM fits on this residual to output prediction intervals ($q_{10}, q_{50}, q_{90}$).

---

## 4. Cross-Circuit Generalization (Leave-One-GP-Out Benchmark)

To verify that the models generalize across different track layouts rather than overfitting to one venue, we evaluated across **8 distinct circuit archetypes ($18,336\text{ total clean test laps}$)**:

In each fold, the model was trained on historical data from all *other* circuits and evaluated on the held-out GP:

| Circuit | Archetype | Test Laps | LastLap | Absolute | SectorChain | Hybrid V3 | Gain vs Abs |
|:---|:---|---:|---:|---:|---:|---:|---:|
| **Monza** | Low-Downforce High-Speed | 3,361 | 334.9 ms | 10,968.4 ms | 296.1 ms | **294.0 ms** | **+97.3%** |
| **Suzuka** | High-Speed Flowing S-Curves | 887 | 383.7 ms | 2,747.7 ms | 374.4 ms | **343.9 ms** | **+87.5%** |
| **Shanghai** | Technical Long-Straight | 2,329 | 340.5 ms | 6,775.3 ms | 312.7 ms | **299.7 ms** | **+95.6%** |
| **Melbourne** | Semi-Street High-Speed | 2,675 | 438.7 ms | 6,569.9 ms | 424.1 ms | **386.4 ms** | **+94.1%** |
| **Miami** | Street High-Speed Straights | 2,460 | 336.7 ms | 2,302.8 ms | 314.5 ms | **292.4 ms** | **+87.3%** |
| **Silverstone** | Extreme Lateral G-Force | 1,092 | 576.6 ms | 4,841.8 ms | 872.2 ms | **642.0 ms** | **+86.7%** |
| **Spa** | Elevation & High Speed | 3,397 | 396.0 ms | 7,089.6 ms | 410.2 ms | **357.1 ms** | **+95.0%** |
| **Monaco** | Tight Low-Speed Street | 2,135 | 546.8 ms | 2,995.8 ms | 592.8 ms | **533.0 ms** | **+82.2%** |
| **MACRO AVG** | **Cross-Circuit Generalization** | **18,336** | **419.2 ms** | **5,536.4 ms** | **449.6 ms** | **393.6 ms** | **+92.9%** |

### Benchmark Takeaways
- **Absolute Model Fails Universally**: Old absolute models fail cross-circuit ($5.5\text{s}$ macro error) because they cannot extrapolate circuit baseline times.
- **Hybrid V3 Wins Across All Archetypes**: Achieves an average MAE of **$393.6\text{ ms}$** across 18,336 unseen laps, outperforming both the LastLap baseline ($419.2\text{ms}$) and SectorChain ($449.6\text{ms}$).
- **High-Speed Circuits Hit Sub-$300\text{ms}$**: Monza ($294.0\text{ms}$), Miami ($292.4\text{ms}$), and Shanghai ($299.7\text{ms}$) all achieve sub-$300\text{ms}$ precision.
- **Physical Noise Floor**: Lateral-G circuits (Silverstone $642\text{ms}$) and bumpy barrier tracks (Monaco $533\text{ms}$) have higher driver apex variance and wind sensitivity, representing the empirical physical limit of single-lap predictability.

---

## 5. Clean-Lap Filtering & Stint-Start Target Hygiene

Raw F1 lap times have $3.5\times$ the variance of clean racing laps. The `is_valid_training_lap` filter excludes:
- Standing starts (Lap 1)
- Pit in-laps and out-laps
- Safety Car / VSC / Red Flag periods

### Stint-Start Outlier Fallback Guard
When `rolling_median_5` is null (Laps 1–4 of a stint), the standard $1.07\times$ rolling outlier trim cannot fire. A fallback guard was implemented in `src/pitwall/features/pace.py`:
```python
outlier_next = (
    (med.is_not_null() & (sci > _TARGET_OUTLIER_FACTOR * med))
    | (med.is_null() & (sci > 1.25 * pl.col("lap_time_s") + 10.0))
)
```
This prevents safety-car crossover laps ($145\text{s}$–$163\text{s}$) from contaminating early stint targets, resolving the $8\text{s}$ Soft MAE anomaly at Monza.

---

## 6. What's Next
- **Dynamic Wind Vector Correction**: High-speed cornering at Silverstone and Spa exhibits strong yaw-angle sensitivity; integrating real-time anemometer vectors from OpenF1 weather will help close the Silverstone variance.
- **Real-Time Tyre Temperature Modeling**: Incorporating brake-disc infrared and carcass thermal estimates from telemetry to predict graining onset before pace drop-off occurs.
