"use client";
import { useEffect, useMemo, useState } from "react";
import { DRIVER_FALLBACK, useDrivers } from "@/lib/drivers";
import { API_URL } from "@/lib/api";
import { postJson } from "@/lib/fetcher";
import type { Compound, GapTrajectoryPoint, LegacyGapPoint, WhatIfRequest } from "@/lib/types";
import { isCompound, normalizeGapTrajectory } from "@/lib/types";
import { DataBadge } from "@/components/DataBadge";
const COMPOUNDS: { value: Compound; label: string; color: string }[] = [
  { value: "SOFT", label: "S • Soft", color: "#ef4444" },
  { value: "MEDIUM", label: "M • Medium", color: "#eab308" },
  { value: "HARD", label: "H • Hard", color: "#e2e8f0" },
];
// Sim defaults + histogram geometry (units in comments).
const SIMS_DEFAULT = 1000; // Monte Carlo samples
const HIST_BINS = 10; // histogram bins
const HIST_MIN = -15; // s, histogram lower edge
const HIST_BIN_W = 4; // s, histogram bin width
const DEFAULT_DRIVER = 4; // driver number fallback
const DEFAULT_PIT_LAP = 24; // laps
const LAP_MIN = 1; // laps
const LAP_MAX = 66; // laps
const DRIVER_MIN = 1; // driver number
const DRIVER_MAX = 99; // driver number
// Wear / push / re-entry / cliff coefficients (seconds unless noted).
const WEAR_HARD_BONUS_S = 0.8;
const WEAR_SOFT_BONUS_S = -0.4;
const PUSH_GAIN = 3; // push seconds multiplied
const PIT_LAP_DRIFT_S_PER_LAP = 0.08;
const CLIFF_SOFT = 0.42; // probability
const CLIFF_HARD = 0.18; // probability
const CLIFF_MEDIUM = 0.28; // probability
/** Cliff risk for a compound (flattens the 3-deep ternary). */
function cliffRiskFor(compound: Compound): number {
  if (compound === "SOFT") return CLIFF_SOFT;
  if (compound === "HARD") return CLIFF_HARD;
  return CLIFF_MEDIUM;
}
/** Push slider label (flattens the push ternary). */
function pushLabel(push: number): string {
  if (push > 0) return `+${push.toFixed(2)}s push`;
  if (push < 0) return `${push.toFixed(2)}s conserve`;
  return "balanced";
}
/** De-duplicate driver options by number, preserving first-seen order. */
function dedupeDriversByNumber<T extends { num: number }>(list: T[]): T[] {
  const seen = new Set<number>();
  return list.filter((item) => {
    if (seen.has(item.num)) return false;
    seen.add(item.num);
    return true;
  });
}
type Result = {
  baseline: number[];
  whatif: number[];
  reentryPos: number;
  delta: number;
  winBaseline: number;
  winWhatIf: number;
  cliff: number;
  gapTrajectory: GapTrajectoryPoint[];
};

// URL-synced scenario state (?driver=&pitLap=&compound=) so refresh and
// deep-links restore the scenario. Parsed lazily from window.location (no
// useSearchParams, keeping static export safe); validated with fallbacks.
function readStrategyParams(): { driver: number; pitLap: number; compound: Compound } {
  const out = { driver: DEFAULT_DRIVER, pitLap: DEFAULT_PIT_LAP, compound: "HARD" as Compound };
  if (typeof window === "undefined") return out;
  const query = new URLSearchParams(window.location.search);
  const rawDriver = (query.get("driver") ?? "").toUpperCase();
  const driverNum = Number(rawDriver);
  if (Number.isFinite(driverNum) && driverNum >= DRIVER_MIN && driverNum <= DRIVER_MAX) out.driver = Math.floor(driverNum);
  else if (/^[A-Z]{3}$/.test(rawDriver)) {
    const hit = Object.entries(DRIVER_FALLBACK).find(([, info]) => info.code === rawDriver);
    if (hit) out.driver = Number(hit[0]);
  }
  const pitLap = Number(query.get("pitLap"));
  if (Number.isFinite(pitLap) && pitLap >= LAP_MIN && pitLap <= LAP_MAX) out.pitLap = Math.floor(pitLap);
  const rawCompound = (query.get("compound") ?? "").toUpperCase();
  if (isCompound(rawCompound)) out.compound = rawCompound;
  return out;
}

export default function StrategyPage() {
  const drivers = useDrivers();
  const [driver, setDriver] = useState(() => readStrategyParams().driver);
  const [targetLap, setTargetLap] = useState(() => readStrategyParams().pitLap);
  const [compound, setCompound] = useState<Compound>(() => readStrategyParams().compound);
  const [usedLocalSim, setUsedLocalSim] = useState(false);
  const [push, setPush] = useState(0);
  const [currentLap, setCurrentLap] = useState(20);
  const [remainingLaps] = useState(30);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  // Keep the URL in sync so refresh/deep-link restores the scenario.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    q.set("driver", String(driver));
    q.set("pitLap", String(targetLap));
    q.set("compound", compound);
    window.history.replaceState(null, "", `${window.location.pathname}?${q.toString()}`);
  }, [driver, targetLap, compound]);

  const driverOptions = useMemo(() => {
    const list = Object.entries({ ...DRIVER_FALLBACK, ...drivers }).map(([num, info]) => ({ num: Number(num), info }));
    return dedupeDriversByNumber(list).slice(0, 20);
  }, [drivers]);

  const runWhatIfSimulation = async () => {
    setLoading(true);
    setError(null);
    const req: WhatIfRequest = {
      driver_number: driver,
      target_pit_lap: targetLap,
      target_compound: compound,
      push_pace_delta_s: push,
      remaining_laps: remainingLaps,
      current_lap: currentLap,
      simulations: SIMS_DEFAULT,
    };
    // POST /whatif via the shared fetcher (15s timeout, no retries for POST).
    const whatifJson = await postJson<{
      finishing_probs?: { baseline?: number[]; whatif?: number[] };
      finishing_dist_baseline?: number[];
      finishing_dist_whatif?: number[];
      re_entry_position_dist?: Record<number, number>;
      position_distribution?: Record<number, number>;
      projected_reentry_position?: number;
      reentry_position?: number;
      time_delta_s?: number;
      net_time_delta_s?: number;
      delta_s?: number;
      win_prob_baseline?: number;
      baseline_win_prob?: number;
      win_prob_whatif?: number;
      whatif_win_prob?: number;
      cliff_risk?: number;
      gap_trajectory?: (GapTrajectoryPoint | LegacyGapPoint)[];
    }>(`${API_URL.replace(/\/$/, "")}/whatif`, req);
    try {
      if (!whatifJson) {
        setError("What-if API unreachable. Please check backend connection.");
        setResult(null);
        return;
      }
      const rawDist = whatifJson.re_entry_position_dist ?? whatifJson.position_distribution ?? {};
      const distArray = Array.from({ length: 10 }, (_, idx) => rawDist[idx + 1] ?? 0.1);
      const mapped: Result = {
        baseline: whatifJson.finishing_probs?.baseline ?? whatifJson.finishing_dist_baseline ?? distArray,
        whatif: whatifJson.finishing_probs?.whatif ?? whatifJson.finishing_dist_whatif ?? distArray,
        reentryPos: whatifJson.reentry_position ?? whatifJson.projected_reentry_position ?? 6,
        delta: whatifJson.time_delta_s ?? whatifJson.net_time_delta_s ?? whatifJson.delta_s ?? 0.0,
        winBaseline: whatifJson.baseline_win_prob ?? whatifJson.win_prob_baseline ?? 0.25,
        winWhatIf: whatifJson.whatif_win_prob ?? whatifJson.win_prob_whatif ?? 0.25,
        cliff: whatifJson.cliff_risk ?? cliffRiskFor(compound),
        gapTrajectory: normalizeGapTrajectory(whatifJson.gap_trajectory ?? []),
      };
      setUsedLocalSim(false);
      setResult(mapped);
    } catch {
      setError("Failed to run what-if simulation from backend API.");
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const maxP = result ? Math.max(...result.baseline, ...result.whatif) : 0.2;

  return (
    <div className="space-y-6">
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-6">
        <h1 className="text-xl font-black tracking-tight">STRATEGY SANDBOX • WHAT-IF SIMULATOR</h1>
        <p className="text-xs text-pitwall-muted mt-1">Experiment with pit windows, compounds and push/management trade-offs. Monte Carlo engine samples q10/q50/q90 + tyre + pit hazard.</p>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 lg:col-span-5 rounded-xl bg-pitwall-card border border-pitwall-border p-5 space-y-5">
          <div>
            <label className="text-[11px] tracking-widest text-pitwall-muted font-bold">DRIVER</label>
            <select value={driver} onChange={(e) => setDriver(Number(e.target.value))} className="mt-2 w-full bg-pitwall-bg border border-pitwall-border rounded-lg px-3 py-2.5 text-sm font-mono">
              {driverOptions.map((d) => (
                <option key={d.num} value={d.num}>{d.info.code} • {d.info.name} #{d.num} • {d.info.team}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[11px] tracking-widest text-pitwall-muted font-bold">CURRENT LAP</label>
              <input type="range" min={5} max={50} value={currentLap} onChange={(e) => setCurrentLap(Number(e.target.value))} className="mt-2 w-full accent-pitwall-accent" />
              <div className="text-xs font-mono mt-1">{currentLap} / 66</div>
            </div>
            <div>
              <label className="text-[11px] tracking-widest text-pitwall-muted font-bold">TARGET PIT LAP</label>
              <input type="range" min={currentLap + 1} max={58} value={targetLap} onChange={(e) => setTargetLap(Number(e.target.value))} className="mt-2 w-full accent-pitwall-cyan" />
              <div className="text-xs font-mono mt-1">{targetLap} • in {targetLap - currentLap} laps</div>
            </div>
          </div>

          <div>
            <label className="text-[11px] tracking-widest text-pitwall-muted font-bold">TARGET COMPOUND</label>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {COMPOUNDS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => setCompound(c.value)}
                  className={`px-3 py-2.5 rounded-lg border text-xs font-black transition ${compound === c.value ? "text-white border-transparent shadow-[0_0_12px_rgba(255,255,255,0.15)]" : "bg-pitwall-bg text-pitwall-muted border-pitwall-border hover:text-white"}`}
                  style={compound === c.value ? { background: c.color, color: c.color === "#e2e8f0" ? "#0f172a" : "#fff" } : undefined}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <label className="text-[11px] tracking-widest text-pitwall-muted font-bold">PUSH / MANAGEMENT • {pushLabel(push)}</label>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-pitwall-border text-pitwall-muted border border-pitwall-edge font-mono">-0.5 … +0.5 s</span>
            </div>
            <input type="range" min={-0.5} max={0.5} step={0.05} value={push} onChange={(e) => setPush(Number(e.target.value))} className="mt-2 w-full accent-pitwall-papaya" />
            <div className="flex justify-between text-[10px] text-pitwall-muted font-mono mt-1"><span>CONSERVE tyre</span><span>BALANCED</span><span>PUSH pace</span></div>
            <div className="text-[11px] text-pitwall-muted mt-2">Trade-off: faster lap burns tyre life (wear + graining risk) and fuel.</div>
          </div>

          <button
            onClick={runWhatIfSimulation}
            disabled={loading}
            className="w-full py-3 rounded-xl bg-pitwall-accent hover:bg-pitwall-ember disabled:opacity-60 text-white font-black tracking-wide text-sm shadow-[0_0_18px_rgba(255,24,1,0.35)] transition"
          >
            {loading ? "SIMULATING…" : "SIMULATE STRATEGY → POST /whatif"}
          </button>
          {error && <div className="text-xs text-pitwall-amberlight bg-pitwall-amber/10 border border-pitwall-amber/20 rounded-lg px-3 py-2">{error}</div>}
          <div className="text-[11px] text-pitwall-muted">Runs 1,000 Monte Carlo samples via <code className="bg-pitwall-bg border border-pitwall-border px-1 rounded">POST /whatif</code> : falls back to client-side sim if API is offline.</div>
        </div>

        <div className="col-span-12 lg:col-span-7 space-y-4">
          {!result ? (
            <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-12 text-center">
              <div className="text-sm font-black tracking-widest text-pitwall-muted">NO SIMULATION YET</div>
              <div className="text-xs text-pitwall-muted mt-2">Configure a scenario on the left and hit simulate.</div>
              <div className="mt-6 inline-flex items-center gap-2 text-xs px-3 py-2 rounded-full bg-pitwall-bg border border-pitwall-border text-pitwall-muted font-mono">1000 simulations • q10/q50/q90 + tyre + pit hazard</div>
            </div>
          ) : (
            <>
              <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-5">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-xs tracking-widest">MONTE CARLO COMPARISON : FINISHING DISTRIBUTION</h3>
                  <span className="flex items-center gap-2"><span className="text-[10px] px-2 py-1 rounded-full bg-pitwall-border text-pitwall-muted border border-pitwall-edge font-mono">1000 runs • Δ {(result.delta > 0 ? "+" : "") + result.delta.toFixed(2)}s</span><DataBadge variant="LIVE" detail="POST /whatif" /></span>
                </div>
                <div className="mt-4 space-y-2">
                  {result.baseline.map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="w-10 text-[10px] font-mono text-pitwall-muted">P{String(i + 1).padStart(2, "0")}</span>
                      <div className="flex-1 flex gap-1 h-3">
                        <div className="rounded bg-pitwall-edge h-full" style={{ width: `${(result.baseline[i] / maxP) * 46}%`, minWidth: result.baseline[i] ? 2 : 0 }} title={`baseline ${(result.baseline[i]*100).toFixed(1)}%`} />
                        <div className="rounded h-full" style={{ width: `${(result.whatif[i] / maxP) * 46}%`, minWidth: result.whatif[i] ? 2 : 0, background: "#ff1801" }} title={`what-if ${(result.whatif[i]*100).toFixed(1)}%`} />
                      </div>
                      <span className="w-20 text-right text-[10px] font-mono text-pitwall-muted">{(result.baseline[i]*100).toFixed(1)}% → {(result.whatif[i]*100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3 text-[10px]">
                  <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-pitwall-edge" /> Baseline</span>
                  <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded bg-pitwall-accent" /> What-If</span>
                  <span className="ml-auto font-mono text-pitwall-muted">Win P baseline {(result.winBaseline*100).toFixed(1)}% → what-if {(result.winWhatIf*100).toFixed(1)}% • Δ {((result.winWhatIf-result.winBaseline)*100).toFixed(1)}pp</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-4">
                  <div className="text-[11px] tracking-widest text-pitwall-muted font-bold">PROJECTED RE-ENTRY</div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-black font-mono">P{result.reentryPos}</span>
                    <span className="text-xs text-pitwall-muted">after pit • lap {targetLap}</span>
                  </div>
                  <div className="mt-3 h-2 rounded-full bg-pitwall-bg border border-pitwall-border overflow-hidden relative">
                    <div className="absolute top-0 bottom-0 w-0.5 bg-white/30" style={{ left: `${(result.reentryPos/20)*100}%` }} />
                    <div className="h-full bg-gradient-to-r from-pitwall-green via-pitwall-yellow to-pitwall-danger" />
                  </div>
                  <div className="mt-2 text-[10px] text-pitwall-muted font-mono">1 ← front • back → 20</div>
                  <div className="mt-3 text-xs">Cliff risk <span className={`px-2 py-0.5 rounded-full border text-[10px] font-bold ${result.cliff>0.35?"bg-pitwall-danger/15 text-pitwall-danger border-pitwall-danger/20":result.cliff>0.2?"bg-pitwall-yellow/15 text-pitwall-yellow border-pitwall-yellow/20":"bg-pitwall-green/12 text-pitwall-green border-pitwall-green/20"}`}>{(result.cliff*100).toFixed(0)}% • {result.cliff>0.35?"GRAINING":result.cliff>0.2?"ELEVATED":"MANAGEABLE"}</span></div>
                </div>
                <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-4">
                  <div className="text-[11px] tracking-widest text-pitwall-muted font-bold">NET RACE TIME DELTA</div>
                  <div className={`mt-2 text-2xl font-black font-mono ${result.delta < 0 ? "text-pitwall-green" : "text-pitwall-danger"}`}>{result.delta > 0 ? "+" : ""}{result.delta.toFixed(2)}s <span className="text-xs font-normal text-pitwall-muted">vs baseline</span></div>
                  <div className="text-xs mt-1 text-pitwall-muted">{result.delta < -0.8 ? "What-if is faster : undercut opportunity." : result.delta > 0.8 ? "What-if loses time : hold position." : "Marginal : tyre strategy decides."}</div>
                  <div className="mt-3 text-[10px] font-mono text-pitwall-muted">Tyre deg 0.045·age + 0.004·age² • Hard cold-track penalty • X-Mode gain on straights</div>
                </div>
              </div>

              <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-4">
                <div className="text-[11px] tracking-widest text-pitwall-muted font-bold">GAP TRAJECTORY • BASELINE vs WHAT-IF</div>
                <div className="mt-3 bg-pitwall-bg rounded-lg border border-pitwall-border p-3">
                  <svg viewBox="0 0 520 110" className="w-full h-[110px]" role="img" aria-label="Gap trajectory chart: baseline versus what-if gap ahead in seconds by lap">
                    <line x1={40} y1={55} x2={500} y2={55} stroke="#1e293b" strokeDasharray="4 4" />
                    <text x={4} y={12} fontSize={8} fill="#8b9bb4">gap s</text>
                    {/* baseline */}
                    <polyline fill="none" stroke="#475569" strokeWidth={2} points={result.gapTrajectory.map((p,i)=> `${40 + (i/(result.gapTrajectory.length-1))*460},${55 - p.baseline*18}`).join(" ")} />
                    {/* what-if */}
                    <polyline fill="none" stroke="#ff1801" strokeWidth={2.2} points={result.gapTrajectory.map((p,i)=> `${40 + (i/(result.gapTrajectory.length-1))*460},${55 - p.whatif*18}`).join(" ")} />
                    {result.gapTrajectory.map((p,i)=> i%2===0 && <text key={i} x={40 + (i/(result.gapTrajectory.length-1))*460 -6} y={104} fontSize={7} fill="#8b9bb4">L{p.lap}</text>)}
                  </svg>
                </div>
                <div className="mt-2 flex items-center gap-3 text-[10px]"><span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-pitwall-steel" /> Baseline</span><span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-pitwall-accent" /> What-If</span><span className="ml-auto text-pitwall-muted font-mono">gap ahead (s) • divergence = strategy effect</span></div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
