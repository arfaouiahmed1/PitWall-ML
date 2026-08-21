"use client";
import { useEffect, useState } from "react";
import { API_URL } from "../../lib/api";

type ShapSummary = Record<string, number>;
type Metrics = {
  mae: number;
  rmse: number;
  coverage_80: number;
  mean_width: number;
  p95_ms: number;
  tyre_mae?: number;
  tyre_rmse?: number;
  pit_auc?: number;
  pit_logloss?: number;
  per_compound?: Record<string, number>;
};

const fallbackMetrics: Metrics = {
  mae: 0.504,
  rmse: 0.616,
  coverage_80: 0.642,
  mean_width: 1.09,
  p95_ms: 8.3,
  tyre_mae: 0.445,
  tyre_rmse: 0.568,
  pit_auc: 1.0,
  pit_logloss: 0.000006,
  per_compound: { HARD: 0.487, MEDIUM: 0.521 },
};

const fallbackShap: ShapSummary = {
  rolling_std_5: 100,
  rolling_median_3: 92.02,
  rolling_median_5: 72.09,
  tyre_age: 65.34,
  lap_number: 50.0,
  stint_no: 1.23,
  position: 0,
  compound: 0,
  race_progress: 0,
};

export default function ModelsPage() {
  const [metrics, setMetrics] = useState<Metrics>(fallbackMetrics);
  const [shap, setShap] = useState<ShapSummary>(fallbackShap);
  const [version, setVersion] = useState("v2-quantile+tyre+pit • local:v2_shap_test");
  const [pitAUC, setPitAUC] = useState(fallbackMetrics.pit_auc);

  useEffect(() => {
    const base = API_URL.replace(/\/$/, "");
    fetch(`${base}/models/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        if (j.metrics) setMetrics(j.metrics);
        if (j.shap_summary && Object.keys(j.shap_summary).length) setShap(j.shap_summary);
        if (j.model_version) setVersion(j.model_version);
        if (j.metrics?.pit_auc) setPitAUC(j.metrics.pit_auc);
      })
      .catch(() => {});
  }, []);

  const shapEntries = Object.entries(shap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6">
      <div className="card p-6">
        <h1 className="text-xl font-black tracking-tight">PACE MODEL — V2</h1>
        <p className="text-xs text-[#8b9bb4] mt-1">
          Champion vs Challenger • MLflow Model Registry @champion alias • {version}
        </p>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          <div className="rounded-lg bg-[#0a0e14] border border-[#00d084]/30 p-4">
            <div className="text-[10px] tracking-widest text-[#00d084]">PRODUCTION — @CHAMPION (quantile)</div>
            <div className="font-black mt-1">pace-v2 • LightGBM Quantile (q10/q50/q90)</div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-center mono text-xs">
              <div>
                <div className="text-[#8b9bb4] text-[10px]">MAE</div>
                <div className="font-bold">{metrics.mae.toFixed(3)}s</div>
              </div>
              <div>
                <div className="text-[#8b9bb4] text-[10px]">COVERAGE 80%</div>
                <div className="font-bold">{(metrics.coverage_80 * 100).toFixed(1)}%</div>
              </div>
              <div>
                <div className="text-[#8b9bb4] text-[10px]">P95</div>
                <div className="font-bold">{metrics.p95_ms.toFixed(1)}ms</div>
              </div>
            </div>
            <div className="mt-2 text-[10px] text-[#8b9bb4]">mean width {metrics.mean_width.toFixed(2)}s • pinball q50 {metrics.rmse ? "—" : ""}</div>
            <div className="mt-3 flex gap-2 text-[10px] flex-wrap">
              <span className="px-2 py-1 rounded bg-[#00d084]/15 text-[#00d084] border border-[#00d084]/20">
                {metrics.coverage_80 >= 0.75 ? "COVERAGE OK" : "COVERAGE LOW"}
              </span>
              <span className="px-2 py-1 rounded bg-[#1e2a3a] text-[#8b9bb4] border border-[#243447]">q10–q90 {metrics.mean_width.toFixed(2)}s</span>
            </div>
          </div>

          <div className="rounded-lg bg-[#0a0e14] border border-[#1e2a3a] p-4">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">TYRE — DEGRADATION</div>
            <div className="font-black mt-1">tyre-v2 • LightGBM (Δ vs rolling_median_5)</div>
            <div className="grid grid-cols-2 gap-3 mt-4 text-center mono text-xs">
              <div>
                <div className="text-[#8b9bb4] text-[10px]">MAE</div>
                <div className="font-bold">{metrics.tyre_mae?.toFixed(3) ?? "—"}s</div>
              </div>
              <div>
                <div className="text-[#8b9bb4] text-[10px]">RMSE</div>
                <div className="font-bold">{metrics.tyre_rmse?.toFixed(3) ?? "—"}s</div>
              </div>
            </div>
            <div className="text-[11px] text-[#8b9bb4] mt-3">Predicts tyre deg 0.07s/lap + 0.004·age² • MEDIUM/HARD scaling</div>
            <div className="mt-2 text-[10px] text-[#5a6b84]">Features: tyre_age, tyre_age_sq, stint_lap, rolling_median_5, track_temp</div>
          </div>

          <div className="rounded-lg bg-[#0a0e14] border border-[#1e2a3a] p-4">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">PIT HAZARD — NEXT 3 LAPS</div>
            <div className="font-black mt-1">pit-v2 • LightGBM Classifier</div>
            <div className="grid grid-cols-3 gap-2 mt-4 text-center mono text-xs">
              <div>
                <div className="text-[#8b9bb4] text-[10px]">AUC</div>
                <div className="font-bold">{pitAUC ? pitAUC.toFixed(3) : "—"}</div>
              </div>
              <div>
                <div className="text-[#8b9bb4] text-[10px]">LOGLOSS</div>
                <div className="font-bold">{metrics.pit_logloss?.toExponential(1) ?? "—"}</div>
              </div>
              <div>
                <div className="text-[#8b9bb4] text-[10px]">POS RATE</div>
                <div className="font-bold">10.0%</div>
              </div>
            </div>
            <div className="text-[11px] text-[#8b9bb4] mt-3">P(pit ≤3) • scale_pos_weight • horizon 3</div>
            <div className="mt-2 text-[10px] text-[#5a6b84]">Triggered by tyre_age ≥12 (prob 12% → 35% at 14+)</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-4 text-xs">
          <div className="bg-[#0a0e14] rounded p-3 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">PER-COMPOUND MAE</div>
            <div className="mt-2 mono space-y-1">
              {metrics.per_compound &&
                Object.entries(metrics.per_compound).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-[#8b9bb4]">{k}</span>
                    <span className="font-bold">{(v as number).toFixed(3)}s</span>
                  </div>
                ))}
            </div>
            <div className="text-[10px] text-[#5a6b84] mt-2">gate max_group_regression 10%</div>
          </div>
          <div className="bg-[#0a0e14] rounded p-3 border border-[#1e2a3a]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">SIMULATOR</div>
            <div className="mt-2 text-[#8b9bb4]">Monte Carlo • 200–5000 runs • samples q10/q50/q90 (σ = width/2.563) + tyre + pit hazard • batch predictions</div>
            <div className="mt-2 mono text-[11px]">POST /simulate {"{ laps_remaining, n_simulations }"}</div>
          </div>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="font-black text-sm">FEATURE IMPORTANCE (SHAP TreeExplainer)</h2>
        <p className="text-[11px] text-[#8b9bb4] mt-1">Live from /models/shap or artifacts/shap_summary.json • fallback = LightGBM gain</p>
        <div className="mt-4 space-y-2 text-xs mono">
          {shapEntries.slice(0, 8).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3">
              <span className="w-36 text-[#8b9bb4] truncate">{k}</span>
              <div className="flex-1 bg-[#0a0e14] rounded h-2">
                <div className="bg-[#ff3b30] h-2 rounded" style={{ width: `${Math.min(v, 100)}%` }} />
              </div>
              <span className="w-12 text-right">{v.toFixed(1)}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-[#5a6b84] mt-4">SHAP explains the model&apos;s attribution; it does not prove causal effect on lap time.</p>
      </div>
    </div>
  );
}
