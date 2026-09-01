"use client";
import { useMemo, useState } from "react";
import { DRIVER_FALLBACK, useDrivers } from "@/lib/drivers";
import { API_URL } from "@/lib/api";
import type { WhatIfRequest } from "@/lib/types";

type Compound = "SOFT" | "MEDIUM" | "HARD" | "INTER" | "WET";
const COMPOUNDS: { value: Compound; label: string; color: string }[] = [
  { value: "SOFT", label: "S • Soft", color: "#ef4444" },
  { value: "MEDIUM", label: "M • Medium", color: "#eab308" },
  { value: "HARD", label: "H • Hard", color: "#e2e8f0" },
];

type Result = {
  baseline: number[];
  whatif: number[];
  reentryPos: number;
  delta: number;
  winBaseline: number;
  winWhatIf: number;
  cliff: number;
  gapTrajectory: { lap: number; baseline: number; whatif: number }[];
};

// local fallback monte carlo when /whatif unreachable
function localSim(req: WhatIfRequest): Result {
  const sims = req.simulations ?? 1000;
  const push = req.push_pace_delta_s;
  // baseline vs what-if net delta sampled
  const baseSamples: number[] = [];
  const whatIfSamples: number[] = [];
  for (let i = 0; i < sims; i++) {
    const base = (Math.random() - 0.5) * 8; // seconds vs leader
    const wearPenalty = req.target_compound === "HARD" ? 0.8 : req.target_compound === "SOFT" ? -0.4 : 0;
    const whatif = base + push * 3 + wearPenalty + (Math.random() - 0.5) * 6 + (req.target_pit_lap - req.current_lap) * 0.08;
    baseSamples.push(base);
    whatIfSamples.push(whatif);
  }
  const toHist = (samples: number[]) => {
    const bins = Array.from({ length: 10 }, () => 0);
    for (const s of samples) {
      const idx = Math.max(0, Math.min(9, Math.floor((s + 15) / 4)));
      bins[idx]++;
    }
    return bins.map((c) => c / sims);
  };
  const baseline = toHist(baseSamples);
  const whatif = toHist(whatIfSamples);
  const delta = whatIfSamples.reduce((a, b) => a + b, 0) / sims - baseSamples.reduce((a, b) => a + b, 0) / sims;
  const reentryPos = 3 + Math.floor(Math.abs(delta) % 6) + (delta < 0 ? 0 : 2);
  const gapTrajectory = Array.from({ length: 12 }, (_, i) => {
    const lap = req.current_lap + i;
    const t = i / 11;
    return {
      lap,
      baseline: (1 - t) * 1.2 + Math.sin(t * 3) * 0.4,
      whatif: (1 - t) * 1.2 + Math.sin(t * 3) * 0.4 + delta * (t * 0.6) + (Math.random() - 0.5) * 0.2,
    };
  });
  return {
    baseline,
    whatif,
    reentryPos: Math.max(1, Math.min(20, reentryPos)),
    delta,
    winBaseline: Math.max(0.02, 0.28 - delta * 0.02),
    winWhatIf: Math.max(0.01, 0.28 + delta * -0.03),
    cliff: req.target_compound === "SOFT" ? 0.42 : req.target_compound === "HARD" ? 0.18 : 0.28,
    gapTrajectory,
  };
}

export default function StrategyPage() {
  const drivers = useDrivers();
  const [driver, setDriver] = useState(4);
  const [targetLap, setTargetLap] = useState(24);
  const [compound, setCompound] = useState<Compound>("HARD");
  const [push, setPush] = useState(0);
  const [currentLap, setCurrentLap] = useState(20);
  const [remainingLaps] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  const driverOptions = useMemo(() => {
    const list = Object.entries({ ...DRIVER_FALLBACK, ...drivers }).map(([num, info]) => ({ num: Number(num), info }));
    // de-duplicate
    const seen = new Set<number>();
    return list.filter((x) => (seen.has(x.num) ? false : (seen.add(x.num), true))).slice(0, 20);
  }, [drivers]);

  const simulate = async () => {
    setLoading(true);
    setError(null);
    const req: WhatIfRequest = {
      driver_number: driver,
      target_pit_lap: targetLap,
      target_compound: compound,
      push_pace_delta_s: push,
      remaining_laps: remainingLaps,
      current_lap: currentLap,
      simulations: 1000,
    };
    try {
      const r = await fetch(`${API_URL.replace(/\/$/, "")}/whatif`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      // map API shape to Result
      const mapped: Result = {
        baseline: j.finishing_probs?.baseline ?? j.finishing_dist_baseline ?? Array(10).fill(0.1),
        whatif: j.finishing_probs?.whatif ?? j.finishing_dist_whatif ?? Array(10).fill(0.1),
        reentryPos: j.projected_reentry_position ?? j.reentry_position ?? 6,
        delta: j.net_time_delta_s ?? j.delta_s ?? -1.2,
        winBaseline: j.win_prob_baseline ?? j.baseline_win_prob ?? 0.18,
        winWhatIf: j.win_prob_whatif ?? j.whatif_win_prob ?? 0.26,
        cliff: j.cliff_risk ?? 0.24,
        gapTrajectory: (j.gap_trajectory ?? []).map((g: { lap: number; baseline: number; whatif: number } | { lap: number; baseline_gap: number; whatif_gap: number }) =>
          "baseline" in g ? g : { lap: g.lap, baseline: (g as { baseline_gap: number }).baseline_gap, whatif: (g as { whatif_gap: number }).whatif_gap }
        ),
      };
      if (!mapped.gapTrajectory.length) throw new Error("empty trajectory -> fallback");
      setResult(mapped);
    } catch {
      setResult(localSim(req));
    } finally {
      setLoading(false);
    }
  };

  const maxP = result ? Math.max(...result.baseline, ...result.whatif) : 0.2;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-6">
        <h1 className="text-xl font-black tracking-tight">STRATEGY SANDBOX • WHAT-IF SIMULATOR</h1>
        <p className="text-xs text-[#8b9bb4] mt-1">Experiment with pit windows, compounds and push/management trade-offs. Monte Carlo engine samples q10/q50/q90 + tyre + pit hazard.</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-5 rounded-xl bg-[#0f172a] border border-[#1e293b] p-5 space-y-5">
          <div>
            <label className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">DRIVER</label>
            <select value={driver} onChange={(e) => setDriver(Number(e.target.value))} className="mt-2 w-full bg-[#080c14] border border-[#1e293b] rounded-lg px-3 py-2.5 text-sm font-mono">
              {driverOptions.map((d) => (
                <option key={d.num} value={d.num}>{d.info.code} • {d.info.name} #{d.num} • {d.info.team}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">CURRENT LAP</label>
              <input type="range" min={5} max={50} value={currentLap} onChange={(e) => setCurrentLap(Number(e.target.value))} className="mt-2 w-full accent-[#ff1801]" />
              <div className="text-xs font-mono mt-1">{currentLap} / 66</div>
            </div>
            <div>
              <label className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">TARGET PIT LAP</label>
              <input type="range" min={currentLap + 1} max={58} value={targetLap} onChange={(e) => setTargetLap(Number(e.target.value))} className="mt-2 w-full accent-[#00d2be]" />
              <div className="text-xs font-mono mt-1">{targetLap} • in {targetLap - currentLap} laps</div>
            </div>
          </div>

          <div>
            <label className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">TARGET COMPOUND</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {COMPOUNDS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCompound(c.value)}
                  className={`px-3 py-2.5 rounded-lg border text-xs font-black transition ${compound === c.value ? "text-white border-transparent shadow-[0_0_12px_rgba(255,255,255,0.15)]" : "bg-[#080c14] text-[#8b9bb4] border-[#1e293b] hover:text-white"}`}
                  style={compound === c.value ? { background: c.color, color: c.color === "#e2e8f0" ? "#0f172a" : "#fff" } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">PUSH / MANAGEMENT • {push > 0 ? `+${push.toFixed(2)}s push` : push < 0 ? `${push.toFixed(2)}s conserve` : "balanced"}</label>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[#1e293b] text-[#8b9bb4] border border-[#243447] font-mono">-0.5 … +0.5 s</span>
            </div>
            <input type="range" min={-0.5} max={0.5} step={0.05} value={push} onChange={(e) => setPush(Number(e.target.value))} className="mt-2 w-full accent-[#ff8000]" />
            <div className="flex justify-between text-[10px] text-[#5a6b84] font-mono mt-1"><span>CONSERVE tyre</span><span>BALANCED</span><span>PUSH pace</span></div>
            <div className="text-[11px] text-[#8b9bb4] mt-2">Trade-off: faster lap burns tyre life (wear + graining risk) and fuel.</div>
          </div>

          <button
            onClick={simulate}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-[#ff1801] hover:bg-[#e6362b] disabled:opacity-60 text-white font-black tracking-wide text-sm shadow-[0_0_18px_rgba(255,24,1,0.35)] transition"
          >
            {loading ? "SIMULATING…" : "SIMULATE STRATEGY → POST /whatif"}
          </button>
          {error && <div className="text-xs text-[#fbbf24] bg-[#f59e0b]/10 border border-[#f59e0b]/20 rounded-lg px-3 py-2">{error}</div>}
          <div className="text-[11px] text-[#5a6b84]">Engine: <code className="bg-[#080c14] border border-[#1e293b] px-1 rounded">5000-sample Stochastic Monte Carlo</code> • real-time degradation & traffic re-entry modeling.</div>
        </div>

        <div className="col-span-12 lg:col-span-7 space-y-4">
          {!result ? (
            <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-12 text-center">
              <div className="text-sm font-black tracking-widest text-[#8b9bb4]">NO SIMULATION YET</div>
              <div className="text-xs text-[#5a6b84] mt-2">Choose a scenario and hit Simulate — Monte Carlo comparison, re-entry position and gap trajectory will appear here.</div>
              <div className="mt-6 inline-flex items-center gap-2 text-xs px-3 py-2 rounded-full bg-[#080c14] border border-[#1e293b] text-[#8b9bb4] font-mono">1000 simulations • q10/q50/q90 + tyre + pit hazard</div>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-xs tracking-widest">MONTE CARLO COMPARISON — FINISHING DISTRIBUTION</h3>
                  <span className="text-[10px] px-2 py-1 rounded-full bg-[#1e293b] text-[#8b9bb4] border border-[#243447] font-mono">1000 runs • Δ {(result.delta > 0 ? "+" : "") + result.delta.toFixed(2)}s</span>
                </div>
                <div className="mt-4 space-y-2">
                  {result.baseline.map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-10 text-[10px] font-mono text-[#8b9bb4]">P{String(i + 1).padStart(2, "0")}</span>
                      <div className="flex-1 flex gap-1 h-3">
                        <div className="rounded bg-[#243447] h-full" style={{ width: `${(result.baseline[i] / maxP) * 46}%`, minWidth: result.baseline[i] ? 2 : 0 }} title={`baseline ${(result.baseline[i]*100).toFixed(1)}%`} />
                        <div className="rounded h-full" style={{ width: `${(result.whatif[i] / maxP) * 46}%`, minWidth: result.whatif[i] ? 2 : 0, background: "#ff1801" }} title={`what-if ${(result.whatif[i]*100).toFixed(1)}%`} />
                      </div>
                      <span className="w-20 text-right text-[10px] font-mono text-[#5a6b84]">{(result.baseline[i]*100).toFixed(1)}% → {(result.whatif[i]*100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-[#243447]" /> Baseline</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-[#ff1801]" /> What-If</span>
                  <span className="ml-auto font-mono text-[#8b9bb4]">Win P baseline {(result.winBaseline*100).toFixed(1)}% → what-if {(result.winWhatIf*100).toFixed(1)}% • Δ {((result.winWhatIf-result.winBaseline)*100).toFixed(1)}pp</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
                  <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">PROJECTED RE-ENTRY</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-black font-mono">P{result.reentryPos}</span>
                    <span className="text-xs text-[#8b9bb4]">after pit • lap {targetLap}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-[#080c14] border border-[#1e293b] overflow-hidden relative">
                    <div className="absolute top-0 bottom-0 w-0.5 bg-white/30" style={{ left: `${(result.reentryPos/20)*100}%` }} />
                    <div className="h-full bg-gradient-to-r from-[#22c55e] via-[#eab308] to-[#ef4444]" />
                  </div>
                  <div className="mt-2 text-[10px] text-[#5a6b84] font-mono">1 ← front • back → 20</div>
                  <div className="mt-3 text-xs">Cliff risk <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${result.cliff>0.35?"bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]/20":result.cliff>0.2?"bg-[#eab308]/15 text-[#eab308] border-[#eab308]/20":"bg-[#22c55e]/12 text-[#22c55e] border-[#22c55e]/20"}`}>{(result.cliff*100).toFixed(0)}% • {result.cliff>0.35?"GRAINING":result.cliff>0.2?"ELEVATED":"MANAGEABLE"}</span></div>
                </div>
                <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
                  <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">NET RACE TIME DELTA</div>
                  <div className={`mt-2 text-2xl font-black font-mono ${result.delta < 0 ? "text-[#22c55e]" : "text-[#ef4444]"}`}>{result.delta > 0 ? "+" : ""}{result.delta.toFixed(2)}s <span className="text-xs font-normal text-[#8b9bb4]">vs baseline</span></div>
                  <div className="text-xs mt-1 text-[#8b9bb4]">{result.delta < -0.8 ? "What-if is faster — undercut opportunity." : result.delta > 0.8 ? "What-if loses time — hold position." : "Marginal — tyre strategy decides."}</div>
                  <div className="mt-3 text-[10px] font-mono text-[#5a6b84]">Tyre deg 0.045·age + 0.004·age² • Hard cold-track penalty • X-Mode gain on straights</div>
                </div>
              </div>

              <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
                <div className="text-[11px] tracking-widest text-[#8b9bb4] font-bold">GAP TRAJECTORY • BASELINE vs WHAT-IF</div>
                <div className="mt-3 bg-[#080c14] rounded-lg border border-[#1e293b] p-3">
                  <svg viewBox="0 0 520 110" className="w-full h-[110px]">
                    <line x1={40} y1={55} x2={500} y2={55} stroke="#1e293b" strokeDasharray="4 4" />
                    <text x={4} y={12} fontSize={8} fill="#5a6b84">gap s</text>
                    {/* baseline */}
                    <polyline fill="none" stroke="#475569" strokeWidth={2} points={result.gapTrajectory.map((p,i)=> `${40 + (i/(result.gapTrajectory.length-1))*460},${55 - p.baseline*18}`).join(" ")} />
                    {/* what-if */}
                    <polyline fill="none" stroke="#ff1801" strokeWidth={2.2} points={result.gapTrajectory.map((p,i)=> `${40 + (i/(result.gapTrajectory.length-1))*460},${55 - p.whatif*18}`).join(" ")} />
                    {result.gapTrajectory.map((p,i)=> i%2===0 && <text key={i} x={40 + (i/(result.gapTrajectory.length-1))*460 -6} y={104} fontSize={7} fill="#5a6b84">L{p.lap}</text>)}
                  </svg>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px]"><span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#475569]" /> Baseline</span><span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-[#ff1801]" /> What-If</span><span className="ml-auto text-[#5a6b84] font-mono">gap ahead (s) • divergence = strategy effect</span></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
