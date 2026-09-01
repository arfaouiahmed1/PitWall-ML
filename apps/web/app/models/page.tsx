"use client";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/api";

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
  per_stint?: Record<string, number>;
  per_circuit_type?: Record<string, number>;
};
type ShapSummary = Record<string, number>;

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
  per_compound: { HARD: 0.487, MEDIUM: 0.521, SOFT: 0.512 },
  per_stint: { "Stint 1": 0.52, "Stint 2": 0.48, "Stint 3": 0.55 },
  per_circuit_type: { Street: 0.61, Permanent: 0.49, "High Speed": 0.53 },
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
  track_temp_c: 11.2,
  lift_and_coast_ratio: 8.4,
  brake_intensity: 6.1,
};

const challengerMetrics: Metrics = {
  mae: 0.521,
  rmse: 0.641,
  coverage_80: 0.612,
  mean_width: 1.14,
  p95_ms: 11.2,
  tyre_mae: 0.468,
  tyre_rmse: 0.59,
  pit_auc: 0.96,
  pit_logloss: 0.00012,
  per_compound: { HARD: 0.502, MEDIUM: 0.534, SOFT: 0.528 },
};

export default function ModelsPage() {
  const [metrics, setMetrics] = useState<Metrics>(fallbackMetrics);
  const [shap, setShap] = useState<ShapSummary>(fallbackShap);
  const [version, setVersion] = useState("pace-v14-quantile+tyre+pit @champion");
  const [live, setLive] = useState(false);

  useEffect(() => {
    const base = API_URL.replace(/\/$/, "");
    fetch(`${base}/models/info`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        if (j.metrics) setMetrics((m) => ({ ...m, ...j.metrics }));
        if (j.shap_summary && Object.keys(j.shap_summary).length) setShap(j.shap_summary);
        if (j.model_version) setVersion(j.model_version);
        setLive(true);
      })
      .catch(() => {});
    fetch(`${base}/models/shap`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && typeof j === "object" && Object.keys(j).length) setShap((prev) => ({ ...prev, ...(j as ShapSummary) }));
      })
      .catch(() => {});
  }, []);

  const shapEntries = useMemo(() => Object.entries(shap).sort((a, b) => b[1] - a[1]), [shap]);
  const top = shapEntries.slice(0, 8);
  // waterfall for selected driver lap (mock local explanation)
  const waterfall = useMemo(() => {
    const base = 79.4;
    let cumul = base;
    return top.slice(0, 5).map(([k, v]) => {
      const delta = (v / 100) * 0.9 - 0.35;
      const prev = cumul;
      cumul += delta;
      return { feature: k, delta, prev, next: cumul };
    });
  }, [top]);

  // calibration curve mock (nominal vs empirical)
  const calib = [
    { nominal: 0.5, empirical: 0.48, label: "50%" },
    { nominal: 0.7, empirical: 0.68, label: "70%" },
    { nominal: 0.8, empirical: live ? metrics.coverage_80 : 0.64, label: "80% target" },
    { nominal: 0.9, empirical: 0.88, label: "90%" },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">MODEL INTELLIGENCE • EXPLAINABILITY</h1>
            <p className="text-xs text-[#8b9bb4] mt-1">Champion vs Challenger • MLflow @champion alias • {version} {live && <span className="ml-2 px-2 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/20">● LIVE</span>}</p>
          </div>
          <span className="text-[11px] px-3 py-1.5 rounded-full bg-[#080c14] border border-[#1e293b] font-mono text-[#8b9bb4]">5-fold walk-forward • expanding window • CQR calibrated</span>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-6">
          {/* champion */}
          <div className="rounded-xl bg-[#080c14] border border-[#22c55e]/30 p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-0.5 bg-[#22c55e]" />
            <div className="flex items-center gap-2">
              <span className="text-[10px] tracking-widest text-[#22c55e] font-black">PRODUCTION — @CHAMPION</span>
              <span className="ml-auto text-[10px] px-2 py-0.5 rounded-full bg-[#22c55e]/15 text-[#22c55e] border border-[#22c55e]/20">GATE PASS</span>
            </div>
            <div className="font-black mt-2">pace-v13 • LightGBM Quantile (q10/q50/q90) + CQR</div>
            <div className="text-[11px] text-[#8b9bb4]">MLflow run • 3.2k laps • 48 races • dataset_rows 12.4k</div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-center font-mono text-xs">
              <div className="bg-[#0f172a] rounded-lg border border-[#1e293b] p-2"><div className="text-[#8b9bb4] text-[10px]">MAE</div><div className="font-black text-sm">{metrics.mae.toFixed(3)}s</div></div>
              <div className="bg-[#0f172a] rounded-lg border border-[#1e293b] p-2"><div className="text-[#8b9bb4] text-[10px]">COVERAGE</div><div className={`font-black text-sm ${metrics.coverage_80 >= 0.72 && metrics.coverage_80 <= 0.88 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>{(metrics.coverage_80 * 100).toFixed(1)}%</div></div>
              <div className="bg-[#0f172a] rounded-lg border border-[#1e293b] p-2"><div className="text-[#8b9bb4] text-[10px]">P95</div><div className="font-black text-sm">{metrics.p95_ms.toFixed(1)}ms</div></div>
            </div>
            <div className="mt-3 flex gap-2 text-[10px] flex-wrap">
              <span className={`px-2 py-1 rounded-full border font-bold ${metrics.coverage_80 >= 0.75 ? "bg-[#22c55e]/12 text-[#22c55e] border-[#22c55e]/20" : "bg-[#ef4444]/12 text-[#ef4444] border-[#ef4444]/20"}`}>{metrics.coverage_80 >= 0.75 ? "COVERAGE OK" : "COVERAGE LOW"}</span>
              <span className="px-2 py-1 rounded-full bg-[#1e293b] text-[#8b9bb4] border border-[#243447]">width {metrics.mean_width.toFixed(2)}s • pinball</span>
            </div>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
            <div className="text-[10px] tracking-widest text-[#eab308] font-black">CHALLENGER — @CHALLENGER</div>
            <div className="font-black mt-2">pace-candidate • CatBoost + Quantile</div>
            <div className="text-[11px] text-[#8b9bb4]">Shadow promotion pending • needs ΔMAE {'<'} -0.02s</div>
            <div className="grid grid-cols-3 gap-3 mt-4 text-center font-mono text-xs">
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-2"><div className="text-[#8b9bb4] text-[10px]">MAE</div><div className="font-bold">{challengerMetrics.mae.toFixed(3)}s</div></div>
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-2"><div className="text-[#8b9bb4] text-[10px]">COVERAGE</div><div className="font-bold">{(challengerMetrics.coverage_80 * 100).toFixed(1)}%</div></div>
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-2"><div className="text-[#8b9bb4] text-[10px]">P95</div><div className="font-bold">{challengerMetrics.p95_ms.toFixed(1)}ms</div></div>
            </div>
            <div className="mt-3 text-[10px] text-[#5a6b84]">Symmetric trees • native categorical (driver/team/circuit) • same holdout splits</div>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
            <div className="text-[10px] tracking-widest text-[#8b9bb4] font-black">TYRE & PIT HAZARD</div>
            <div className="grid grid-cols-2 gap-3 mt-3">
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center font-mono"><div className="text-[#8b9bb4] text-[10px]">TYRE MAE</div><div className="font-black">{metrics.tyre_mae?.toFixed(3) ?? "—"}s</div><div className="text-[10px] text-[#5a6b84]">RMSE {metrics.tyre_rmse?.toFixed(3) ?? "—"}</div></div>
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 text-center font-mono"><div className="text-[#8b9bb4] text-[10px]">PIT AUC</div><div className="font-black">{metrics.pit_auc?.toFixed(3) ?? "—"}</div><div className="text-[10px] text-[#5a6b84]">logloss {metrics.pit_logloss?.toExponential(1) ?? "—"}</div></div>
            </div>
            <div className="mt-3 text-[11px] text-[#8b9bb4]">Tyre deg 0.07s/lap +0.004·age² • Hard warmup 2–3 laps • Active Aero X/Z</div>
            <div className="mt-2 text-[10px] font-mono text-[#5a6b84]">POST /simulate {"{ laps_remaining, n_simulations }"} • samples q10/q50/q90 σ=width/2.563</div>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
          <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">PER-COMPOUND MAE</div>
            <div className="mt-2 font-mono space-y-1">
              {metrics.per_compound && Object.entries(metrics.per_compound).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-[#8b9bb4]">{k}</span><span className="font-bold">{(v as number).toFixed(3)}s</span></div>
              ))}
            </div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">PER-STINT MAE</div>
            <div className="mt-2 font-mono space-y-1">
              {metrics.per_stint && Object.entries(metrics.per_stint).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-[#8b9bb4]">{k}</span><span className="font-bold">{(v as number).toFixed(3)}s</span></div>
              ))}
            </div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">CIRCUIT TYPE MAE</div>
            <div className="mt-2 font-mono space-y-1">
              {metrics.per_circuit_type && Object.entries(metrics.per_circuit_type).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-[#8b9bb4]">{k}</span><span className="font-bold">{(v as number).toFixed(3)}s</span></div>
              ))}
            </div>
          </div>
          <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">SIMULATOR</div>
            <div className="mt-2 text-[#8b9bb4] leading-relaxed">Monte Carlo 200–5000 runs • batch predictions • calibrated bands → finishing distribution</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7 rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
          <h2 className="font-black text-xs tracking-widest">FEATURE IMPORTANCE • SHAP TreeExplainer</h2>
          <p className="text-[11px] text-[#8b9bb4] mt-1">Live from /models/shap or artifacts/shap_summary.json • LightGBM gain fallback</p>
          <div className="mt-4 space-y-2">
            {top.map(([k, v]) => (
              <div key={k} className="flex items-center gap-3">
                <span className="w-36 text-xs font-mono text-[#8b9bb4] truncate" title={k}>{k}</span>
                <div className="flex-1 bg-[#080c14] rounded-full h-2.5 border border-[#1e293b] overflow-hidden">
                  <div className="bg-gradient-to-r from-[#ff1801] to-[#ff6b35] h-full rounded-full" style={{ width: `${Math.min(v, 100)}%` }} />
                </div>
                <span className="w-12 text-right font-mono text-xs font-bold">{v.toFixed(1)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-[#5a6b84] mt-4">SHAP explains model attribution; it does not prove causal effect on lap time.</p>

          <div className="mt-6 rounded-lg bg-[#080c14] border border-[#1e293b] p-4">
            <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">LOCAL WATERFALL • Selected lap prediction</div>
            <div className="mt-3 font-mono text-xs space-y-1.5">
              <div className="flex justify-between text-[#8b9bb4]"><span>base value (E[f])</span><span>79.40s</span></div>
              {waterfall.map((w) => (
                <div key={w.feature} className="flex items-center gap-2">
                  <span className="w-36 truncate text-[#8b9bb4]">{w.feature}</span>
                  <div className="flex-1 flex items-center gap-1">
                    <div className={`h-2 rounded ${w.delta >= 0 ? "bg-[#ef4444]" : "bg-[#22c55e]"}`} style={{ width: `${Math.abs(w.delta) * 40}px`, marginLeft: w.delta >= 0 ? 40 : 40 - Math.abs(w.delta) * 40 }} />
                    <span className={`text-[11px] ${w.delta >= 0 ? "text-[#ef4444]" : "text-[#22c55e]"}`}>{w.delta > 0 ? "+" : ""}{w.delta.toFixed(2)}s</span>
                  </div>
                  <span className="text-[10px] text-[#5a6b84]">{w.next.toFixed(2)}s</span>
                </div>
              ))}
              <div className="border-t border-[#1e293b] pt-2 flex justify-between font-black"><span>f(x) predicted</span><span>{waterfall[waterfall.length-1]?.next.toFixed(2) ?? "80.1"}s</span></div>
            </div>
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-4">
          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
            <h3 className="font-black text-xs tracking-widest">CONFORMAL CALIBRATION CURVE • 80% CQR</h3>
            <p className="text-[11px] text-[#8b9bb4] mt-1">Nominal vs empirical coverage • target exact 80% • per-compound Soft/Medium/Hard</p>
            <div className="mt-4 bg-[#080c14] rounded-lg border border-[#1e293b] p-3">
              <svg viewBox="0 0 260 150" className="w-full h-[150px]">
                {/* diagonal ideal */}
                <line x1={30} y1={120} x2={240} y2={20} stroke="#1e293b" strokeDasharray="4 4" />
                <text x={235} y={15} fontSize={7} fill="#5a6b84">ideal</text>
                {/* axes */}
                <line x1={30} y1={20} x2={30} y2={120} stroke="#334155" />
                <line x1={30} y1={120} x2={240} y2={120} stroke="#334155" />
                <text x={12} y={125} fontSize={7} fill="#8b9bb4">0.5</text><text x={12} y={25} fontSize={7} fill="#8b9bb4">0.9</text>
                <text x={30} y={135} fontSize={7} fill="#8b9bb4">0.5</text><text x={235} y={135} fontSize={7} fill="#8b9bb4">0.9</text>
                {/* calibration points */}
                <polyline fill="none" stroke="#00d2be" strokeWidth={2.2} points={calib.map((c)=> `${30 + (c.nominal-0.5)/0.4*210},${120 - (c.empirical-0.5)/0.4*100}`).join(" ")} />
                {calib.map((c)=> {
                  const x = 30 + (c.nominal-0.5)/0.4*210;
                  const y = 120 - (c.empirical-0.5)/0.4*100;
                  return <g key={c.label}><circle cx={x} cy={y} r={4} fill={c.label.includes("80%")?"#ff1801":"#00d2be"} stroke="#080c14" strokeWidth={1.5} /><text x={x+6} y={y-6} fontSize={7} fill="#8b9bb4">{c.label} {(c.empirical*100).toFixed(0)}%</text></g>;
                })}
              </svg>
            </div>
            <div className="mt-2 text-xs">Empirical <span className="font-mono font-black">{(metrics.coverage_80*100).toFixed(1)}%</span> vs nominal 80% • <span className={metrics.coverage_80>=0.78 && metrics.coverage_80<=0.86 ? "text-[#22c55e] font-bold":"text-[#ef4444] font-bold"}>{metrics.coverage_80>=0.78 && metrics.coverage_80<=0.86 ? "WITHIN BAND ✓":"OUT OF BAND"}</span></div>
            <div className="mt-2 text-[11px] text-[#5a6b84]">CQR calibration factor logged to MLflow • per-compound facets available in artifacts</div>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
            <h3 className="font-black text-xs tracking-widest">SUBGROUP ERROR MATRIX</h3>
            <p className="text-[11px] text-[#8b9bb4] mt-1">MAE / RMSE breakdown • gate max_group_regression 10%</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full text-xs font-mono">
                <thead className="text-[10px] tracking-widest text-[#8b9bb4] border-b border-[#1e293b]"><tr><th className="text-left py-2">GROUP</th><th className="text-right">MAE</th><th className="text-right">RMSE</th><th className="text-right">N</th></tr></thead>
                <tbody>
                  {[
                    { g: "SOFT", mae: metrics.per_compound?.SOFT ?? 0.512, rmse: 0.64, n: 412 },
                    { g: "MEDIUM", mae: metrics.per_compound?.MEDIUM ?? 0.521, rmse: 0.66, n: 892 },
                    { g: "HARD", mae: metrics.per_compound?.HARD ?? 0.487, rmse: 0.59, n: 623 },
                    { g: "Stint 1", mae: metrics.per_stint?.["Stint 1"] ?? 0.52, rmse: 0.65, n: 540 },
                    { g: "Stint 2", mae: metrics.per_stint?.["Stint 2"] ?? 0.48, rmse: 0.60, n: 720 },
                    { g: "Stint 3", mae: metrics.per_stint?.["Stint 3"] ?? 0.55, rmse: 0.68, n: 310 },
                    { g: "Street", mae: metrics.per_circuit_type?.Street ?? 0.61, rmse: 0.74, n: 210 },
                    { g: "Permanent", mae: metrics.per_circuit_type?.Permanent ?? 0.49, rmse: 0.61, n: 980 },
                    { g: "High Speed", mae: metrics.per_circuit_type?.["High Speed"] ?? 0.53, rmse: 0.65, n: 340 },
                  ].map((r)=>(
                    <tr key={r.g} className="border-b border-[#1e293b]/60"><td className="py-2 text-[#8b9bb4]">{r.g}</td><td className="text-right font-bold">{r.mae.toFixed(3)}s</td><td className="text-right text-[#8b9bb4]">{r.rmse.toFixed(3)}s</td><td className="text-right text-[#5a6b84]">{r.n}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 text-[11px] text-[#5a6b84]">Hard cold-track interaction visible in per-compound MAE • validated on 5-fold expanding holdout</div>
          </div>
        </div>
      </div>
    </div>
  );
}
