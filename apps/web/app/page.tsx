"use client";
import { useEffect, useMemo, useState } from "react";
import { COMPOUND_NAMES, DRIVER_FALLBACK, lastName, readableTextColor, useDrivers } from "@/lib/drivers";
import { RaceTable, type RaceRow } from "@/components/RaceTable";
import { useRaceSnapshot } from "@/lib/useRaceSnapshot";
import { CircuitMap, type DriverDot, type Flag } from "@/components/CircuitMap";
import { WeatherWidget } from "@/components/WeatherWidget";
import { TrackDominance, type DominanceRow } from "@/components/TrackDominance";
import { StrategyBattle } from "@/components/StrategyBattle";
import { EventFeed, type FeedEvent } from "@/components/EventFeed";
import { DriverAvatar } from "@/components/DriverAvatar";
import { DataBadge } from "@/components/DataBadge";
import { SessionStatusRail } from "@/components/ops/SessionStatusRail";
import { InsightMetric } from "@/components/ops/InsightMetric";
import { HISTORICAL_REPLAYS, getCalendarStatus, formatCountdown, type HistoricalReplayOption } from "@/lib/calendar";
import { useNow } from "@/lib/useNow";
import { useRaceSocket } from "@/lib/useRaceSocket";

type SimSpeed = "1x" | "5x" | "20x" | "MAX";
const SPEEDS: SimSpeed[] = ["1x", "5x", "20x", "MAX"];
const TOTAL_LAPS = 66;

function parseLap(str: string): number {
  if (!str || str === "--") return 79.5;
  const m = /^(\d+):(\d+\.\d+)$/.exec(str);
  if (!m) return 79.5;
  return Number(m[1]) * 60 + Number(m[2]);
}

export default function RacePage() {
  const [mode, setMode] = useState<"REPLAY" | "LIVE" | "OFF_TRACK">("REPLAY");
  const [selectedReplayId, setSelectedReplayId] = useState<string>("season-2024-event-spanish-grand-prix-session-r");
  const [speed, setSpeed] = useState<"1x" | "5x" | "20x" | "MAX">("20x");
  const [paused, setPaused] = useState(false);
  const snapshot = useRaceSnapshot({
    source: mode === "LIVE" ? "live" : "replay",
    replayId: selectedReplayId,
    speed: paused ? null : speed,
  });
  const { connected, flag, latencyMs } = useRaceSocket(paused ? null : speed);
  const now = useNow(30000);
  const drivers = useDrivers();

  const calendarStatus = useMemo(
    () => getCalendarStatus(now, mode === "REPLAY" ? selectedReplayId : null),
    [now, mode, selectedReplayId]
  );

  const activeReplay = useMemo(() => {
    const match = HISTORICAL_REPLAYS.find((r) => r.id === selectedReplayId);
    if (match) return match;
    const fromCatalog = snapshot.availableSessions.find((s) => s.id === selectedReplayId);
    return {
      id: selectedReplayId,
      year: fromCatalog?.season ?? 2024,
      circuitId: "barcelona",
      circuitName: fromCatalog?.event?.replace(/_/g, " ") ?? "Grand Prix",
      sessionName: fromCatalog?.session_type ?? "Race",
      totalLaps: 66,
    };
  }, [selectedReplayId, snapshot.availableSessions]);
  const offTrackData = calendarStatus.mode === "OFF_TRACK" ? calendarStatus : null;
  const nextGrandPrix = offTrackData?.nextGrandPrix;
  const lastGrandPrix = offTrackData?.lastGrandPrix;
  const nextSession = offTrackData?.nextSession;
  const lap = mode === "OFF_TRACK" ? (lastGrandPrix?.laps ?? 66) : snapshot.lap || 1;
  const totalLaps = mode === "REPLAY" ? activeReplay.totalLaps : TOTAL_LAPS;
  const activeCircuitId = mode === "REPLAY" ? activeReplay.circuitId : mode === "OFF_TRACK" ? (nextGrandPrix?.circuitId ?? "barcelona") : "barcelona";
  const changeSpeed = (s: "1x" | "5x" | "20x" | "MAX") => {
    setSpeed(s);
  };

  const baseRows: RaceRow[] = snapshot.rows.length > 0 ? snapshot.rows : [];

  const dots: DriverDot[] = useMemo(() => {
    return baseRows.slice(0, 10).map((row) => {
      const gapNum = row.gap === "LEADER" ? 0 : Number((row.gap ?? "0").replace("+", "")) || 0;
      // leader near 0.88 progress, others spaced back
      const progress = Math.max(0, Math.min(0.99, 0.88 - gapNum * 0.018 - (row.driver_number % 7) * 0.003));
      return { driverNumber: row.driver_number, code: row.code ?? String(row.driver_number), color: row.color ?? "#243447", progress };
    });
  }, [baseRows]);

  const dominanceRows: DominanceRow[] = useMemo(() => {
    return baseRows.slice(0, 5).map((row) => {
      const total = row.gap === "LEADER" ? 0 : Number((row.gap ?? "0").replace("+", "")) || 0;
      const code = row.code ?? String(row.driver_number);
      const color = row.color ?? "#243447";
      // split total gap across sectors with slight variance
      const s1 = total * (0.32 + ((code.charCodeAt(0) % 5) - 2) * 0.018);
      const s2 = total * (0.41 + ((code.charCodeAt(1) % 5) - 2) * 0.018);
      const s3 = Math.max(0, total - s1 - s2);
      return { code, color, s1: Number(s1.toFixed(2)), s2: Number(s2.toFixed(2)), s3: Number(s3.toFixed(2)), total: Number(total.toFixed(2)) };
    });
  }, [baseRows]);

  const battlePair = useMemo(() => {
    if (baseRows.length < 2) return { a: undefined, b: undefined, delta: 0.9, prob: 0.18 };
    // find closest battle within 2s
    let best = { i: 1, gap: Number.POSITIVE_INFINITY };
    for (let i = 1; i < baseRows.length; i++) {
      const gap = Number((baseRows[i].gap ?? "0").replace("+", "")) - Number((baseRows[i - 1].gap ?? "0").replace("+", ""));
      if (gap < best.gap) best = { i, gap };
    }
    const index = best.gap < 2 ? best.i : 1;
    const a = baseRows[index];
    const b = baseRows[index - 1];
    const delta = Number((a.gap ?? "0").replace("+", "")) - Number((b.gap ?? "0").replace("+", ""));
    const prob = Math.max(0.08, Math.min(0.78, 0.52 - delta * 0.18 + (a.tyreAge - b.tyreAge) * 0.02));
    return {
      a: {
        code: a.code ?? String(a.driver_number),
        driverNumber: a.driver_number,
        color: a.color ?? "#243447",
        team: a.team,
        tyre: a.tyre,
        tyreAge: a.tyreAge,
        gapToLeader: a.gapToLeader ?? a.gap,
      },
      b: {
        code: b.code ?? String(b.driver_number),
        driverNumber: b.driver_number,
        color: b.color ?? "#243447",
        team: b.team,
        tyre: b.tyre,
        tyreAge: b.tyreAge,
        gapToLeader: b.gapToLeader ?? b.gap,
      },
      delta,
      prob,
    };
  }, [baseRows]);

  const feedEvents: FeedEvent[] = useMemo(() => {
    if (snapshot.events.length > 0) return snapshot.events;
    return baseRows.slice(0, 12).map((row) => ({
      id: `pos-${row.driver_number}`,
      lap,
      type: (row.drs ? "DRS" : "GREEN") as FeedEvent["type"],
      driverNumber: row.driver_number,
      code: row.code,
      text: `${row.code ?? row.driver_number} • P${row.position}`,
      detail: row.gapToLeader ?? row.gap,
    }));
  }, [baseRows, lap, snapshot.events]);

  const flagStyles: Record<string, { bg: string; border: string; text: string; glow: string; label: string }> = {
    GREEN: { bg: "bg-pitwall-green/12", border: "border-pitwall-green/30", text: "text-pitwall-green", glow: "shadow-[0_0_18px_rgba(34,197,94,0.35)]", label: "GREEN FLAG" },
    YELLOW: { bg: "bg-pitwall-yellow/12", border: "border-pitwall-yellow/30", text: "text-pitwall-yellow", glow: "shadow-[0_0_18px_rgba(234,179,8,0.35)]", label: "YELLOW FLAG" },
    SC: { bg: "bg-pitwall-amber/15", border: "border-pitwall-amber/40", text: "text-pitwall-amberlight", glow: "shadow-[0_0_18px_rgba(245,158,11,0.4)]", label: "SAFETY CAR" },
    VSC: { bg: "bg-pitwall-amber/12", border: "border-pitwall-amber/30", text: "text-pitwall-amberlight", glow: "shadow-[0_0_16px_rgba(245,158,11,0.3)]", label: "VIRTUAL SC" },
    RED: { bg: "bg-pitwall-danger/15", border: "border-pitwall-danger/40", text: "text-pitwall-danger", glow: "shadow-[0_0_20px_rgba(239,68,68,0.45)]", label: "RED FLAG" },
  };
  const fs = flagStyles[flag] ?? flagStyles.GREEN;

  const leaderRow = baseRows[0];
  const leaderInfo = leaderRow ? (drivers[leaderRow.driver_number] ?? DRIVER_FALLBACK[leaderRow.driver_number]) : undefined;

  return (
    <div className="space-y-4">
      {/* flag banner */}
      {/* Status banner */}
      <SessionStatusRail
        stages={[
          {
            label: mode === "OFF_TRACK" ? "STANDBY" : mode === "LIVE" ? "LIVE TIMING" : "REPLAY",
            status: mode === "LIVE" ? "active" : mode === "REPLAY" ? "complete" : "pending",
            detail: mode === "LIVE" ? "OpenF1 stream" : activeReplay.sessionName,
          },
          {
            label: `FLAG ${flag}`,
            status: flag === "RED" ? "alert" : flag === "GREEN" ? "complete" : "active",
            detail: flag === "GREEN" ? "Track clear" : "Caution",
          },
          {
            label: connected ? "WS CONNECTED" : "POLLING",
            status: connected ? "complete" : "active",
            detail: latencyMs != null ? `${latencyMs}ms` : "API snapshot",
          },
          {
            label: `LAP ${lap}/${totalLaps}`,
            status: "active",
            detail: activeCircuitId,
          },
        ]}
        className="w-full"
      />
      <div className={`rounded-md border ${fs.border} ${fs.bg} px-4 py-2 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${flag === "GREEN" ? "bg-pitwall-green animate-pulse" : flag === "YELLOW" ? "bg-pitwall-yellow animate-bounce" : flag === "RED" ? "bg-pitwall-danger animate-pulse" : "bg-pitwall-amber animate-pulse"}`} />
          <span className={`text-xs font-black tracking-widest ${fs.text}`}>
            {mode === "OFF_TRACK" ? "STANDBY : OFF-TRACK" : fs.label}
          </span>
          <span className="text-[11px] text-pitwall-muted hidden md:inline">
            {mode === "OFF_TRACK"
              ? `Between races : Next round at ${nextGrandPrix?.city ?? "Melbourne"}`
              : mode === "REPLAY"
                ? `${activeReplay.circuitName} : Replay simulation : telemetry active`
                : "Live telemetry connection armed"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode Switcher */}
          <div role="group" aria-label="Session mode" className="flex items-center gap-1 bg-pitwall-bg border border-pitwall-border rounded-lg p-0.5 text-[10px] font-mono font-bold">
            <button
              onClick={() => setMode("REPLAY")}
              aria-pressed={mode === "REPLAY"}
              className={`px-2 py-1 rounded ${mode === "REPLAY" ? "bg-pitwall-accent text-white" : "text-pitwall-muted hover:text-white"}`}
            >
              REPLAY
            </button>
            <button
              onClick={() => setMode("LIVE")}
              aria-pressed={mode === "LIVE"}
              className={`px-2 py-1 rounded ${mode === "LIVE" ? "bg-pitwall-cyan text-pitwall-bg" : "text-pitwall-muted hover:text-white"}`}
            >
              LIVE
            </button>
            <button
              onClick={() => setMode("OFF_TRACK")}
              aria-pressed={mode === "OFF_TRACK"}
              className={`px-2 py-1 rounded ${mode === "OFF_TRACK" ? "bg-pitwall-steel text-white" : "text-pitwall-muted hover:text-white"}`}
            >
              OFF-TRACK
            </button>
          </div>

          <span className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-1 rounded-full border font-bold ${connected ? "bg-pitwall-green/15 text-pitwall-green border-pitwall-green/30" : mode === "OFF_TRACK" ? "bg-pitwall-border text-pitwall-muted border-pitwall-edge" : paused ? "bg-pitwall-border text-pitwall-muted border-pitwall-edge" : "bg-pitwall-amber/10 text-pitwall-amberlight border-pitwall-amber/30"}`}>
              {connected ? "● WS LIVE" : mode === "OFF_TRACK" ? "○ STANDBY" : paused ? "○ PAUSED" : "● REPLAY SIM"}
            </span>
            <span className="text-[10px] font-mono px-2 py-1 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-muted">
              {connected && latencyMs != null ? `${latencyMs} ms` : mode === "OFF_TRACK" ? "OFFLINE" : "LOCAL"}
            </span>
          </span>
        </div>
      </div>

      {/* Session header */}
      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] tracking-[0.18em] text-pitwall-muted font-bold">
            {mode === "REPLAY" ? (
              <>
                <span>HISTORICAL REPLAY :</span>
                <select
                  value={selectedReplayId}
                  onChange={(e) => setSelectedReplayId(e.target.value)}
                  className="bg-pitwall-bg border border-pitwall-border text-white text-xs rounded px-2 py-1 font-sans focus:outline-none"
                >
                  {(snapshot.availableSessions.length > 0 ? snapshot.availableSessions : HISTORICAL_REPLAYS).map((r) => (
                    <option key={r.id} value={r.id}>
                      {"label" in r ? r.label : `${r.year} ${r.circuitName} (${r.totalLaps} Laps)`}
                    </option>
                  ))}
                </select>
              </>
            ) : mode === "OFF_TRACK" ? (
              <span className="text-pitwall-cyan">
                OFF-TRACK STANDBY • NEXT: ROUND {nextGrandPrix?.round ?? 1} {nextGrandPrix?.name?.toUpperCase() ?? "AUSTRALIAN GRAND PRIX"}
              </span>
            ) : (
              <span>LIVE TIMING • {flag}</span>
            )}
          </div>

          <div className="flex items-center gap-3 mt-1">
            <span className="text-2xl font-black font-mono tracking-tight">
              {mode === "OFF_TRACK" ? `FINAL • ${lap} LAPS` : `LAP ${lap} / ${totalLaps}`}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-pitwall-bg border border-pitwall-border text-pitwall-muted font-mono">
              Circuit-Adaptive Dual-Paradigm Router @champion • {connected ? "WebSocket" : mode === "OFF_TRACK" ? "Standby" : "Ingested Replay"}
            </span>
            {mode === "OFF_TRACK" && nextSession && (
              <span className="hidden md:inline-flex items-center gap-2 text-xs text-pitwall-cyan">
                <span className="w-1.5 h-1.5 rounded-full bg-pitwall-cyan animate-pulse" />
                Next session in {formatCountdown(nextSession.startsInMs)}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 text-[10px]">
            <span className="px-2 py-1 rounded bg-pitwall-border text-pitwall-muted border border-pitwall-edge font-mono">DRS • X-MODE ARMED</span>
            <span className="px-2 py-1 rounded bg-pitwall-border text-pitwall-muted border border-pitwall-edge font-mono">PIT HAZARD &le;5L</span>
            <span className="text-pitwall-muted hidden sm:inline">Hover driver row for SHAP + sparkline</span>
          </div>
        </div>

        {mode === "REPLAY" && (
          <div role="group" aria-label="Replay speed" className="flex items-center gap-2">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                aria-pressed={speed === s}
                className={`px-3 py-1.5 rounded-lg text-xs font-black border transition ${
                  speed === s
                    ? "bg-pitwall-accent text-white border-pitwall-accent shadow-[0_0_12px_rgba(255,24,1,0.4)]"
                    : "bg-pitwall-bg text-pitwall-muted border-pitwall-border hover:text-white hover:border-pitwall-edge"
                }`}
              >
                {s}
              </button>
            ))}
            <div role="group" aria-label="Simulation" className="ml-2 flex items-center gap-1.5">
              <button aria-pressed={paused} onClick={() => setPaused(true)} className="text-xs px-3 py-1.5 rounded-lg bg-pitwall-border text-pitwall-muted border border-pitwall-edge hover:text-white">Pause</button>
              <button aria-pressed={!paused} onClick={() => setPaused(false)} className="text-xs px-3 py-1.5 rounded-lg bg-pitwall-card text-pitwall-muted border border-pitwall-border hover:text-white hover:bg-pitwall-border">Resume</button>
            </div>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="rounded-lg bg-pitwall-bg border border-pitwall-border px-3 py-2 text-xs flex items-center justify-between text-pitwall-muted">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-pitwall-cyan shrink-0" />
          <span>
            {mode === "OFF_TRACK"
              ? `No session currently active. Next: ${nextGrandPrix?.officialName ?? "Grand Prix"} (${nextGrandPrix?.startDate ?? "2025"}). Showing final classification.`
              : mode === "LIVE"
                ? `Live telemetry feed armed via OpenF1 Live Transponders and WebSocket streaming.`
                : `Replaying ${activeReplay.sessionName} : predictions run through the same dual-paradigm pipeline as live timing.`}
          </span>
        </div>
        <span className="hidden md:flex items-center gap-2"><span className="text-[10px] font-mono text-pitwall-muted">Macro MAE: 0.363s • Coverage: 78.0% • p95: 6.5ms</span><DataBadge variant="MOCK" detail="pinned benchmark snapshot" /></span>
      </div>

      {/* Cockpit density grid : 12 cols */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8 space-y-4">
          <RaceTable rows={baseRows} />
          {/* driver detail strip */}
          {leaderRow && leaderInfo && (
            <div className="mt-4 rounded-xl bg-pitwall-card border border-pitwall-border p-4">
              <div className="flex items-center gap-3">
                <DriverAvatar
                  src={leaderInfo.image}
                  name={leaderInfo.name}
                  code={leaderInfo.code}
                  number={leaderRow.driver_number}
                  color={leaderInfo.color}
                  team={leaderInfo.team}
                  size={32}
                />
                <h3 className="font-black text-xs tracking-widest">SELECTED • {lastName(leaderInfo.name).toUpperCase()} P{leaderRow.position} • {leaderInfo.team}</h3>
                <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-pitwall-bg border border-pitwall-border text-pitwall-muted font-mono">tyre {COMPOUND_NAMES[leaderRow.tyre] ?? leaderRow.tyre} • age {leaderRow.tyreAge} • wear {leaderRow.tyreWear}%</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-3">
                <InsightMetric
                  label="NEXT LAP FORECAST"
                  value={leaderRow.pace?.q50 ? `${Math.floor(leaderRow.pace.q50/60)}:${(leaderRow.pace.q50%60).toFixed(2).padStart(5,"0")}` : (leaderRow.gap ?? "LEADER")}
                  thresholdLabel="CQR 80%"
                  status="healthy"
                  note={`80% ±${leaderRow.pace?.q10 && leaderRow.pace?.q90 ? ((leaderRow.pace.q90 - leaderRow.pace.q10) / 2).toFixed(3) : "0.320"}s band`}
                />
                <InsightMetric
                  label="PIT HAZARD (NEXT 3L)"
                  value={`${leaderRow.pit?.p3 ?? 35}%`}
                  thresholdLabel={`1L: ${leaderRow.pit?.p1 ?? 15}%`}
                  status={(leaderRow.pit?.p3 ?? 35) > 60 ? "warning" : "normal"}
                  note={`5L cumulative risk: ${leaderRow.pit?.p5 ?? 75}%`}
                />
                <InsightMetric
                  label="PROJECTED WIN / PODIUM"
                  value={`${((leaderRow.finishing?.p1 ?? 0.35)*100).toFixed(0)}%`}
                  unit="P1"
                  status="healthy"
                  note={`Podium: ${((leaderRow.finishing?.podium ?? 0.65)*100).toFixed(0)}% • Points: ${((leaderRow.finishing?.points ?? 0.85)*100).toFixed(0)}%`}
                />
              </div>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <CircuitMap circuitId={activeCircuitId} drivers={dots} lap={lap} flag={flag as Flag} />
          <WeatherWidget circuitId={activeCircuitId} compact={false} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-4"><TrackDominance rows={dominanceRows} leaderCode={leaderRow?.code ?? "VER"} /></div>
        <div className="col-span-12 lg:col-span-4"><StrategyBattle driverA={battlePair.a} driverB={battlePair.b} pitWindowDelta={battlePair.delta} overtakeProb={battlePair.prob} /></div>
        <div className="col-span-12 lg:col-span-4"><EventFeed events={feedEvents} maxItems={12} isOffTrack={mode === "OFF_TRACK"} /></div>
      </div>

      <div className="rounded-xl bg-pitwall-card border border-pitwall-border p-4">
        <h3 className="font-black text-xs tracking-widest">HOW REPLAY WORKS</h3>
        <p className="text-xs text-pitwall-muted mt-2 leading-relaxed">
          Historical Bronze lap events stream through the same <code className="bg-pitwall-bg border border-pitwall-border px-1.5 py-0.5 rounded font-mono">RaceEvent → RaceState → FeatureBuilder → Model → WebSocket</code> path as live data. It&apos;s a decent smoke test of the full pipeline without needing a live session.
        </p>
      </div>
    </div>
  );
}
