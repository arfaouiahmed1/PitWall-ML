"use client";
import { useEffect, useMemo, useState } from "react";
import { API_URL } from "@/lib/api";

type Overview = {
  model_version: string;
  metrics: { mae: number; rmse: number; coverage_80: number; p95_ms: number; tyre_mae?: number; pit_auc?: number };
  drift_ratio: number;
  drifted_features: string[];
  promotion_passed?: boolean;
  // extended
  wasserstein?: number;
  psi?: number;
  ks_p?: number;
  js?: number;
  health?: { ws_clients: number; freshness_s: number; error_rate: number; events_per_sec?: number; processing_lag_s?: number };
};

type DriftRow = { feature: string; wasserstein: number; ks: number; ks_p: number; psi: number; js: number; severity: "none" | "moderate" | "severe" };

const FALLBACK_DRIFT: DriftRow[] = [
  { feature: "speed_trap_max_kmh", wasserstein: 1.82, ks: 0.34, ks_p: 0.002, psi: 0.31, js: 0.18, severity: "severe" },
  { feature: "brake_intensity_mean", wasserstein: 1.21, ks: 0.22, ks_p: 0.018, psi: 0.19, js: 0.11, severity: "moderate" },
  { feature: "x_mode_ratio", wasserstein: 1.64, ks: 0.29, ks_p: 0.004, psi: 0.27, js: 0.15, severity: "severe" },
  { feature: "lap_time_variance", wasserstein: 0.42, ks: 0.11, ks_p: 0.21, psi: 0.08, js: 0.04, severity: "none" },
  { feature: "track_temp_c", wasserstein: 0.88, ks: 0.18, ks_p: 0.07, psi: 0.14, js: 0.07, severity: "moderate" },
  { feature: "compound", wasserstein: 0.31, ks: 0.09, ks_p: 0.34, psi: 0.06, js: 0.03, severity: "none" },
  { feature: "tyre_age", wasserstein: 0.55, ks: 0.13, ks_p: 0.12, psi: 0.09, js: 0.05, severity: "none" },
  { feature: "lift_and_coast_ratio", wasserstein: 0.71, ks: 0.15, ks_p: 0.09, psi: 0.12, js: 0.06, severity: "moderate" },
];

const fallback: Overview = {
  model_version: "pace-v14-quantile @champion",
  metrics: { mae: 0.504, rmse: 0.616, coverage_80: 0.642, p95_ms: 8.3, tyre_mae: 0.445, pit_auc: 1.0 },
  drift_ratio: 0.12,
  drifted_features: ["track_temp_c", "compound"],
  promotion_passed: true,
  wasserstein: 1.34,
  psi: 0.18,
  ks_p: 0.04,
  js: 0.09,
  health: { ws_clients: 3, freshness_s: 1.2, error_rate: 0.004, events_per_sec: 42, processing_lag_s: 0.18 },
};

export default function MonitoringPage() {
  const [data, setData] = useState<Overview>(fallback);
  const [driftRows, setDriftRows] = useState<DriftRow[]>(FALLBACK_DRIFT);
  const [live, setLive] = useState(false);

  useEffect(() => {
    const base = API_URL.replace(/\/$/, "");
    fetch(`${base}/monitoring/overview`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!j) return;
        setData((prev) => ({
          ...prev,
          model_version: j.model_version ?? prev.model_version,
          metrics: j.metrics ?? prev.metrics,
          drift_ratio: j.drift_ratio ?? prev.drift_ratio,
          drifted_features: j.drifted_features ?? prev.drifted_features,
          promotion_passed: j.promotion_passed ?? prev.promotion_passed,
          wasserstein: j.wasserstein ?? j.overall_wasserstein ?? prev.wasserstein,
          psi: j.psi ?? j.overall_psi ?? prev.psi,
          js: j.js ?? j.overall_js ?? prev.js,
          health: j.health ?? prev.health,
        }));
        if (j.drift_features && Array.isArray(j.drift_features)) {
          setDriftRows(j.drift_features);
        }
        setLive(true);
      })
      .catch(() => {});
    fetch(`${base}/monitoring/drift`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (j && Array.isArray(j.features)) setDriftRows(j.features);
        else if (Array.isArray(j)) setDriftRows(j);
      })
      .catch(() => {});
  }, []);

  const m = data.metrics;
  const covOk = m.coverage_80 >= 0.72 && m.coverage_80 <= 0.88;
  const maeOk = m.mae < 2.5;
  const psiSevere = (data.psi ?? 0) > 0.25;
  const wSevere = (data.wasserstein ?? 0) > 1.5;

  const health = data.health ?? fallback.health!;

  const maxW = useMemo(() => Math.max(...driftRows.map((r) => r.wasserstein), 1), [driftRows]);
  const maxPsi = useMemo(() => Math.max(...driftRows.map((r) => r.psi), 0.3), [driftRows]);

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-black tracking-tight">MLOPS & DRIFT • 2025 → 2026 ERA TRANSITION</h1>
            <p className="text-xs text-[#8b9bb4] mt-1">Regulation era drift panel + serving health gauges • Prometheus → Grafana • Evidently rolling 3-race window</p>
          </div>
          <span className={`text-xs px-3 py-1.5 rounded-full border font-bold ${live ? "bg-[#22c55e]/12 text-[#22c55e] border-[#22c55e]/30" : "bg-[#f59e0b]/10 text-[#fbbf24] border-[#f59e0b]/20"}`}>{live ? "● LIVE API" : "● FALLBACK DEMO"} • {data.model_version}</span>
        </div>

        {/* serving health gauges */}
        <div className="mt-6 grid grid-cols-2 lg:grid-cols-5 gap-3">
          {[
            { k: "p95 LATENCY", v: `${m.p95_ms.toFixed(1)} ms`, sub: m.p95_ms < 25 ? "HEALTHY" : "ELEVATED", col: m.p95_ms < 25 ? "#22c55e" : "#eab308" },
            { k: "WS CLIENTS", v: `${health.ws_clients}`, sub: health.ws_clients ? "connected" : "idle", col: "#00d2be" },
            { k: "FRESHNESS", v: `${health.freshness_s.toFixed(1)} s`, sub: health.freshness_s < 2 ? "fresh" : "stale", col: health.freshness_s < 2 ? "#22c55e" : "#ef4444" },
            { k: "ERROR RATE", v: `${(health.error_rate * 100).toFixed(2)}%`, sub: health.error_rate < 0.01 ? "low" : "high", col: health.error_rate < 0.01 ? "#22c55e" : "#ef4444" },
            { k: "DRIFT RATIO", v: `${(data.drift_ratio * 100).toFixed(1)}%`, sub: data.drift_ratio > 0.25 ? "drift" : "stable", col: data.drift_ratio > 0.25 ? "#ef4444" : "#22c55e" },
          ].map((g) => (
            <div key={g.k} className="rounded-xl bg-[#080c14] border border-[#1e293b] p-4 text-center relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-0.5" style={{ background: g.col }} />
              <div className="text-[10px] tracking-widest text-[#8b9bb4] font-bold">{g.k}</div>
              <div className="font-mono font-black text-lg mt-1">{g.v}</div>
              <div className="text-[10px] font-bold mt-1" style={{ color: g.col }}>{g.sub.toUpperCase()}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid grid-cols-3 gap-3 text-xs">
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex justify-between"><span className="text-[#8b9bb4]">Events/sec</span><span className="font-mono font-bold">{health.events_per_sec ?? 42}</span></div>
          <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex justify-between"><span className="text-[#8b9bb4]">Processing lag</span><span className="font-mono font-bold">{(health.processing_lag_s ?? 0.18).toFixed(2)}s</span></div>
          <div className={`rounded-lg border p-3 flex justify-between ${covOk ? "bg-[#22c55e]/10 border-[#22c55e]/20" : "bg-[#ef4444]/10 border-[#ef4444]/20"}`}><span className={covOk ? "text-[#22c55e]" : "text-[#ef4444]"}>Coverage 80%</span><span className="font-mono font-black">{(m.coverage_80 * 100).toFixed(1)}% • {covOk ? "OK" : "ALERT"}</span></div>
        </div>
      </div>

      {/* era drift panel */}
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-6">
        <div className="flex items-center justify-between">
          <h2 className="font-black text-xs tracking-widest">REGULATION ERA DRIFT • 2025 → 2026 ACTIVE AERO & ENERGY</h2>
          <span className="text-[10px] px-2 py-1 rounded-full bg-[#1e293b] text-[#8b9bb4] border border-[#243447] font-mono">W₁ • KS • PSI • JS</span>
        </div>
        <p className="text-[11px] text-[#8b9bb4] mt-1">2026 Active Aero X/Z-Mode, speed traps, brake intensity and energy difficulty vs 2025 baseline • tuned alerts: W₁{">"}1.5 warning, PSI{">"}0.25 severe, MAE{">"}2.5s</p>

        <div className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className={`rounded-xl border p-4 text-center ${wSevere ? "bg-[#ef4444]/10 border-[#ef4444]/30" : "bg-[#080c14] border-[#1e293b]"}`}>
            <div className="text-[10px] tracking-widest text-[#8b9bb4] font-bold">WASSERSTEIN W₁</div>
            <div className={`font-mono font-black text-xl mt-1 ${wSevere ? "text-[#ef4444]" : "text-[#e2e8f0]"}`}>{(data.wasserstein ?? 1.34).toFixed(2)}</div>
            <div className={`text-[10px] font-bold mt-1 ${wSevere ? "text-[#ef4444]" : "text-[#22c55e]"}`}>{wSevere ? "DRIFT HIGH" : "WITHIN TOLERANCE"}</div>
            <div className="text-[10px] text-[#5a6b84]">threshold 1.5 • 10m window</div>
          </div>
          <div className="rounded-xl bg-[#080c14] border border-[#1e293b] p-4 text-center">
            <div className="text-[10px] tracking-widest text-[#8b9bb4] font-bold">KS STATISTIC</div>
            <div className="font-mono font-black text-xl mt-1">{(driftRows[0]?.ks ?? 0.34).toFixed(2)}</div>
            <div className="text-[10px] text-[#8b9bb4]">p={(driftRows[0]?.ks_p ?? 0.002).toExponential(1)} • {driftRows[0]?.ks_p != null && driftRows[0].ks_p < 0.05 ? "significant" : "ns"}</div>
            <div className="text-[10px] text-[#5a6b84]">Kolmogorov–Smirnov</div>
          </div>
          <div className={`rounded-xl border p-4 text-center ${psiSevere ? "bg-[#ef4444]/10 border-[#ef4444]/30" : "bg-[#080c14] border-[#1e293b]"}`}>
            <div className="text-[10px] tracking-widest text-[#8b9bb4] font-bold">PSI</div>
            <div className={`font-mono font-black text-xl mt-1 ${psiSevere ? "text-[#ef4444]" : "text-[#e2e8f0]"}`}>{(data.psi ?? 0.18).toFixed(2)}</div>
            <div className={`text-[10px] font-bold mt-1 ${psiSevere ? "text-[#ef4444]" : "text-[#8b9bb4]"}`}>{psiSevere ? "SEVERE" : data.psi != null && data.psi > 0.15 ? "MODERATE" : "STABLE"}</div>
            <div className="text-[10px] text-[#5a6b84]">threshold 0.25 severe</div>
          </div>
          <div className="rounded-xl bg-[#080c14] border border-[#1e293b] p-4 text-center">
            <div className="text-[10px] tracking-widest text-[#8b9bb4] font-bold">JENSEN–SHANNON</div>
            <div className="font-mono font-black text-xl mt-1">{(data.js ?? 0.09).toFixed(2)}</div>
            <div className="text-[10px] text-[#8b9bb4]">divergence • 0 = identical</div>
            <div className="text-[10px] text-[#5a6b84]">symmetric KL</div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-[10px]">
          <span className={`px-2 py-1 rounded-full border font-bold ${maeOk ? "bg-[#22c55e]/12 text-[#22c55e] border-[#22c55e]/20" : "bg-[#ef4444]/12 text-[#ef4444] border-[#ef4444]/20"}`}>MAE {m.mae.toFixed(3)}s • {maeOk ? "OK (<2.5s)" : "ALERT (>2.5s)"}</span>
          <span className="px-2 py-1 rounded-full bg-[#1e293b] text-[#8b9bb4] border border-[#243447]">coverage {(m.coverage_80 * 100).toFixed(1)}% • band 72–88%</span>
          <span className={`px-2 py-1 rounded-full border ${data.promotion_passed ? "bg-[#22c55e]/12 text-[#22c55e] border-[#22c55e]/20" : "bg-[#1e293b] text-[#8b9bb4] border-[#243447]"}`}>{data.promotion_passed ? "PROMOTION PASS" : "PROMOTION HOLD"}</span>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-7 rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
          <h3 className="font-black text-xs tracking-widest">TOP DRIFTING FEATURES • PSI & WASSERSTEIN</h3>
          <div className="mt-4 space-y-2">
            {driftRows.slice(0, 8).map((r) => (
              <div key={r.feature} className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-bold">{r.feature}</span>
                  <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${r.severity === "severe" ? "bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/30" : r.severity === "moderate" ? "bg-[#eab308]/15 text-[#eab308] border-[#eab308]/30" : "bg-[#1e293b] text-[#8b9bb4] border-[#243447]"}`}>{r.severity.toUpperCase()}</span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between text-[10px] font-mono"><span className="text-[#8b9bb4]">W₁</span><span className="font-bold">{r.wasserstein.toFixed(2)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.wasserstein / maxW) * 100)}%`, background: r.wasserstein > 1.5 ? "#ef4444" : r.wasserstein > 0.8 ? "#eab308" : "#22c55e" }} /></div>
                  </div>
                  <div>
                    <div className="flex justify-between text-[10px] font-mono"><span className="text-[#8b9bb4]">PSI</span><span className="font-bold">{r.psi.toFixed(2)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, (r.psi / maxPsi) * 100)}%`, background: r.psi > 0.25 ? "#ef4444" : r.psi > 0.12 ? "#eab308" : "#22c55e" }} /></div>
                  </div>
                </div>
                <div className="mt-2 flex gap-3 text-[10px] font-mono text-[#5a6b84]"><span>KS {r.ks.toFixed(2)} • p {r.ks_p.toExponential(1)}</span><span>JS {r.js.toFixed(2)}</span></div>
              </div>
            ))}
          </div>
        </div>

        <div className="col-span-12 lg:col-span-5 space-y-4">
          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
            <h3 className="font-black text-xs tracking-widest">KS P-VALUE HEATMAP • PHYSICAL TELEMETRY</h3>
            <p className="text-[11px] text-[#8b9bb4] mt-1">Lower p = stronger drift vs 2025 era baseline</p>
            <div className="mt-4 grid grid-cols-4 gap-2 text-[10px] font-mono">
              {driftRows.map((r) => {
                const intensity = Math.max(0, Math.min(1, 1 - r.ks_p * 8));
                const bg = `rgba(239,68,68,${0.12 + intensity * 0.75})`;
                const col = intensity > 0.5 ? "#fff" : "#8b9bb4";
                return (
                  <div key={r.feature} className="rounded-lg border border-[#1e293b] p-2 text-center" style={{ background: bg, color: col }}>
                    <div className="truncate font-bold text-[10px]">{r.feature.slice(0, 12)}</div>
                    <div className="text-[10px]">p {r.ks_p.toExponential(1)}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-[#5a6b84]"><span className="w-3 h-3 rounded bg-[#ef4444]" /> drift (p &lt; 0.05) <span className="w-3 h-3 rounded bg-[#1e293b] ml-2" /> stable</div>
          </div>

          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
            <h3 className="font-black text-xs tracking-widest">SERVING HEALTH • REAL-TIME PIPELINE</h3>
            <div className="mt-3 space-y-2 text-xs">
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex justify-between"><span className="text-[#8b9bb4]">Replay ingestion</span><span className="font-mono font-bold">{health.events_per_sec} events/s</span></div>
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex justify-between"><span className="text-[#8b9bb4]">Processing lag</span><span className="font-mono font-bold">{(health.processing_lag_s ?? 0.18).toFixed(2)}s</span></div>
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex justify-between"><span className="text-[#8b9bb4]">HTTP latency buckets</span><span className="font-mono text-[11px]">p50 4ms • p95 {m.p95_ms}ms • p99 22ms</span></div>
              <div className="bg-[#080c14] rounded-lg border border-[#1e293b] p-3 flex justify-between"><span className="text-[#8b9bb4]">Feature freshness</span><span className="font-mono font-bold">{health.freshness_s.toFixed(1)}s</span></div>
            </div>
            <div className="mt-3 text-[11px] text-[#5a6b84]">Prometheus scrapes <code className="bg-[#080c14] border border-[#1e293b] px-1 rounded">/metrics</code> • alerts: PaceMAE{">"}2.5s, Coverage 72–88%, W₁{">"}1.5, PSI{">"}0.25, HardMAE{">"}5s</div>
          </div>

          <div className="rounded-xl bg-[#080c14] border border-[#1e293b] p-4">
            <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">EVIDENTLY • 3-RACE ROLLING DRIFT RATIO</div>
            <div className="mt-2 flex items-baseline gap-2"><span className="text-2xl font-mono font-black">{(data.drift_ratio * 100).toFixed(1)}%</span><span className="text-xs text-[#8b9bb4]">features drifted • {data.drifted_features.length} flagged</span></div>
            <div className="mt-2 h-2 rounded-full bg-[#1e293b] overflow-hidden"><div className="h-full rounded-full" style={{ width: `${Math.min(100, data.drift_ratio * 100)}%`, background: data.drift_ratio > 0.25 ? "#ef4444" : data.drift_ratio > 0.12 ? "#eab308" : "#22c55e" }} /></div>
            <div className="mt-2 text-[11px] text-[#5a6b84]">Flagged: {data.drifted_features.join(", ") || "—"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
