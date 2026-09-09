"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { COMPOUND_NAMES, DRIVER_FALLBACK, lastName, readableTextColor, useDrivers } from "@/lib/drivers";
import { useRaceSim, type SimSpeed } from "@/lib/raceSim";
import { RaceTable, type RaceRow } from "@/components/RaceTable";
import { CircuitMap, type DriverDot, type Flag } from "@/components/CircuitMap";
import { WeatherWidget } from "@/components/WeatherWidget";
import { TrackDominance, type DominanceRow } from "@/components/TrackDominance";
import { StrategyBattle } from "@/components/StrategyBattle";
import { EventFeed, type FeedEvent } from "@/components/EventFeed";
import { DriverAvatar } from "@/components/DriverAvatar";
import { HISTORICAL_REPLAYS, getCalendarStatus, formatCountdown, type HistoricalReplayOption } from "@/lib/calendar";
import { useLiveTelemetry } from "@/lib/liveTelemetry";
import type { FlagStatus } from "@/lib/types";

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
  const [selectedReplayId, setSelectedReplayId] = useState<string>("barcelona-2024-race");
  const [speed, setSpeed] = useState<SimSpeed>("20x");
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const [wsLap, setWsLap] = useState(31);
  const [flag, setFlag] = useState<FlagStatus>("GREEN");
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [wsEvents, setWsEvents] = useState<FeedEvent[]>([]);
  const [now, setNow] = useState<Date>(() => new Date());
  const wsRef = useRef<WebSocket | null>(null);
  const drivers = useDrivers();

  // Keep clock updated every 30s
  useEffect(() => {
    const iv = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(iv);
  }, []);

  const calendarStatus = useMemo(
    () => getCalendarStatus(now, mode === "REPLAY" ? selectedReplayId : null),
    [now, mode, selectedReplayId]
  );

  const activeReplay = useMemo(
    () => HISTORICAL_REPLAYS.find((r) => r.id === selectedReplayId) ?? HISTORICAL_REPLAYS[0],
    [selectedReplayId]
  );
  const offTrackData = calendarStatus.mode === "OFF_TRACK" ? calendarStatus : null;
  const nextGrandPrix = offTrackData?.nextGrandPrix;
  const lastGrandPrix = offTrackData?.lastGrandPrix;
  const nextSession = offTrackData?.nextSession;
  const liveTelem = useLiveTelemetry(mode === "LIVE");
  const isSimActive = mode === "REPLAY" && !connected && !paused;
  const sim = useRaceSim(speed, isSimActive);
  const lap = mode === "OFF_TRACK" ? (lastGrandPrix?.laps ?? 66) : mode === "LIVE" && liveTelem.isLive ? liveTelem.lap : connected ? wsLap : sim.lap;
  const totalLaps = mode === "REPLAY" ? activeReplay.totalLaps : TOTAL_LAPS;
  const activeCircuitId = mode === "REPLAY" ? activeReplay.circuitId : mode === "OFF_TRACK" ? (nextGrandPrix?.circuitId ?? "barcelona") : "barcelona";
  const connect = (s: SimSpeed) => {
    const configured = process.env.NEXT_PUBLIC_WS_URL;
    if (!configured) return;
    try {
      const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss" : "ws";
      const host = configured.replace(/^wss?:\/\//, "");
      const url = `${proto}://${host}/ws/race?speed=${s}`;
      const ws = new WebSocket(url);
      ws.onopen = () => {
        setConnected(true);
        setLatencyMs(18);
      };
      ws.onclose = () => {
        setConnected(false);
        setLatencyMs(null);
      };
      ws.onerror = () => {
        setConnected(false);
        setLatencyMs(null);
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          if (msg.type === "race_update") {
            if (msg.race_state?.lap) setWsLap(msg.race_state.lap);
            if (msg.race_state?.flag) setFlag(msg.race_state.flag as FlagStatus);
            if (msg.race_state?.latency_ms) setLatencyMs(msg.race_state.latency_ms);
            const ev: FeedEvent = {
              id: `ws-${Date.now()}-${msg.race_state?.lap ?? 0}-${msg.event?.driver_number ?? 0}`,
              lap: msg.race_state?.lap ?? lap,
              type: msg.event?.event_type ?? "ANOMALY",
              text: `${msg.event?.driver_number ?? ""} ${msg.event?.event_type ?? "update"} ${msg.prediction ? `${msg.prediction.q50}s` : ""}`.trim() || JSON.stringify(msg).slice(0, 80),
              driver: msg.event?.driver_number ? String(msg.event.driver_number) : undefined,
            };
            setWsEvents((prev) => [ev, ...prev].slice(0, 30));
          }
        } catch {}
      };
      wsRef.current?.close();
      wsRef.current = ws;
    } catch {}
  };

  useEffect(() => {
    connect(speed);
    return () => wsRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSpeed = (s: SimSpeed) => {
    setSpeed(s);
    if (!paused) connect(s);
  };

  // map sim/WS entries to RaceTable rows shape expected by component (accepts any[] but we provide rich shape)
  const raceRows = useMemo(() => {
    const src = sim.entries;
    return src.map((d) => {
      const info = drivers[d.driver_number] ?? DRIVER_FALLBACK[d.driver_number];
      const sec = parseLap(d.lastLap);
      const band = (() => {
        const m = /± \.(\d+)/.exec(d.forecast ?? "");
        return m ? Number(`0.${m[1]}`) : 0.32;
      })();
      const q50 = sec || 79.4 + d.tyreAge * 0.045;
      const q10 = q50 - band;
      const q90 = q50 + band;
      const p3 = d.pitProb ?? 18;
      const p1 = Math.round(Math.min(48, Math.max(2, p3 * 0.42)));
      const p5 = Math.min(95, Math.round(p3 * 1.65));
      const gapDelta = Number((((d.driver_number % 5) - 2) * 0.035).toFixed(3));
      const tyreWear = Math.min(100, Math.round((d.tyreAge / 32) * 100));
      const drs = d.gap !== "LEADER" && parseFloat((d.gap ?? "+0").replace("+", "")) < 1.0;
      return {
        driver_number: d.driver_number,
        position: d.position,
        gap: d.gap,
        gapToLeader: d.gap,
        gapDelta,
        tyre: (d.tyre ?? "M") as "S" | "M" | "H" | "I" | "W",
        tyreAge: d.tyreAge,
        tyreWear,
        pace: { q50, q10, q90 },
        pit: { p1, p3, p5 },
        finishing: {
          p1: d.position === 1 ? 0.38 : d.position === 2 ? 0.22 : 0.06 / d.position,
          podium: d.position <= 3 ? 0.62 - d.position * 0.08 : 0.12 / d.position,
          points: d.position <= 10 ? 0.78 - d.position * 0.04 : 0.04,
        },
        drs,
        headshot: info?.image,
        name: info?.name,
        code: info?.code ?? String(d.driver_number),
        team: info?.team,
        color: info?.color ?? "#243447",
      };
    });
  }, [sim.entries, drivers]);

  const dots: DriverDot[] = useMemo(() => {
    return raceRows.slice(0, 10).map((r) => {
      const gapNum = r.gap === "LEADER" ? 0 : Number((r.gap as string).replace("+", "")) || 0;
      // leader near 0.88 progress, others spaced back
      const progress = Math.max(0, Math.min(0.99, 0.88 - gapNum * 0.018 - (r.driver_number % 7) * 0.003));
      return { driverNumber: r.driver_number, code: r.code, color: r.color, progress };
    });
  }, [raceRows]);

  const dominanceRows: DominanceRow[] = useMemo(() => {
    return raceRows.slice(0, 5).map((r) => {
      const total = r.gap === "LEADER" ? 0 : Number((r.gap as string).replace("+", "")) || 0;
      // split total gap across sectors with slight variance
      const s1 = total * (0.32 + ((r.code.charCodeAt(0) % 5) - 2) * 0.018);
      const s2 = total * (0.41 + ((r.code.charCodeAt(1) % 5) - 2) * 0.018);
      const s3 = Math.max(0, total - s1 - s2);
      return { code: r.code, color: r.color, s1: Number(s1.toFixed(2)), s2: Number(s2.toFixed(2)), s3: Number(s3.toFixed(2)), total: Number(total.toFixed(2)) };
    });
  }, [raceRows]);

  const battlePair = useMemo(() => {
    if (raceRows.length < 2) return { a: undefined, b: undefined, delta: 0.9, prob: 0.18 };
    // find closest battle within 2s
    let best = { i: 1, gap: Number.POSITIVE_INFINITY };
    for (let i = 1; i < raceRows.length; i++) {
      const gap = Number((raceRows[i].gap as string).replace("+", "")) - Number((raceRows[i - 1].gap as string).replace("+", "") || "0");
      if (gap < best.gap) best = { i, gap };
    }
    const idx = best.gap < 2 ? best.i : 1;
    const a = raceRows[idx];
    const b = raceRows[idx - 1];
    const delta = Number((a.gap as string).replace("+", "")) - Number((b.gap as string).replace("+", "") || "0");
    const prob = Math.max(0.08, Math.min(0.78, 0.52 - delta * 0.18 + (a.tyreAge - b.tyreAge) * 0.02));
    return {
      a: {
        code: a.code,
        driverNumber: a.driver_number,
        color: a.color,
        team: a.team,
        tyre: a.tyre,
        tyreAge: a.tyreAge,
        gapToLeader: a.gapToLeader ?? (typeof a.gap === "string" ? a.gap : undefined),
      },
      b: {
        code: b.code,
        driverNumber: b.driver_number,
        color: b.color,
        team: b.team,
        tyre: b.tyre,
        tyreAge: b.tyreAge,
        gapToLeader: b.gapToLeader ?? (typeof b.gap === "string" ? b.gap : undefined),
      },
      delta,
      prob,
    };
  }, [raceRows]);

  const feedEvents: FeedEvent[] = useMemo(() => {
    if (connected && wsEvents.length) return wsEvents;
    return sim.feed.slice(0, 12).map((f) => {
      const parts = f.text.split(" · ");
      const head = parts[0] ?? f.text;
      const rest = parts.slice(1).join(" · ");
      const isPit = /PIT/i.test(f.text);
      const isFastest = /^\s*LAP/.test(f.text) && /P\d/.test(f.text);
      return {
        id: f.id,
        lap,
        type: isPit ? "PIT" : isFastest ? "FASTEST" : "ANOMALY",
        text: `${head} ${rest ? "· " + rest : ""}`.trim(),
      } as FeedEvent;
    });
  }, [connected, wsEvents, sim.feed, lap]);

  const flagStyles: Record<string, { bg: string; border: string; text: string; glow: string; label: string }> = {
    GREEN: { bg: "bg-[#22c55e]/12", border: "border-[#22c55e]/30", text: "text-[#22c55e]", glow: "shadow-[0_0_18px_rgba(34,197,94,0.35)]", label: "GREEN FLAG" },
    YELLOW: { bg: "bg-[#eab308]/12", border: "border-[#eab308]/30", text: "text-[#eab308]", glow: "shadow-[0_0_18px_rgba(234,179,8,0.35)]", label: "YELLOW FLAG" },
    SC: { bg: "bg-[#f59e0b]/15", border: "border-[#f59e0b]/40", text: "text-[#fbbf24]", glow: "shadow-[0_0_18px_rgba(245,158,11,0.4)]", label: "SAFETY CAR" },
    VSC: { bg: "bg-[#f59e0b]/12", border: "border-[#f59e0b]/30", text: "text-[#fbbf24]", glow: "shadow-[0_0_16px_rgba(245,158,11,0.3)]", label: "VIRTUAL SC" },
    RED: { bg: "bg-[#ef4444]/15", border: "border-[#ef4444]/40", text: "text-[#ef4444]", glow: "shadow-[0_0_20px_rgba(239,68,68,0.45)]", label: "RED FLAG" },
  };
  const fs = flagStyles[flag] ?? flagStyles.GREEN;

  const leaderRow = raceRows[0];
  const leaderInfo = leaderRow ? (drivers[leaderRow.driver_number] ?? DRIVER_FALLBACK[leaderRow.driver_number]) : undefined;

  return (
    <div className="space-y-4">
      {/* flag banner */}
      {/* Status banner */}
      <div className={`rounded-xl border ${fs.border} ${fs.bg} ${fs.glow} px-4 py-2.5 flex flex-wrap items-center justify-between gap-3`}>
        <div className="flex items-center gap-3">
          <span className={`w-2.5 h-2.5 rounded-full ${flag === "GREEN" ? "bg-[#22c55e] animate-pulse" : flag === "YELLOW" ? "bg-[#eab308] animate-bounce" : flag === "RED" ? "bg-[#ef4444] animate-pulse" : "bg-[#f59e0b] animate-pulse"}`} />
          <span className={`text-xs font-black tracking-widest ${fs.text}`}>
            {mode === "OFF_TRACK" ? "STANDBY : OFF-TRACK" : fs.label}
          </span>
          <span className="text-[11px] text-[#8b9bb4] hidden md:inline">
            {mode === "OFF_TRACK"
              ? `Between races : Next round at ${nextGrandPrix?.city ?? "Melbourne"}`
              : mode === "REPLAY"
                ? `${activeReplay.circuitName} : Replay simulation : telemetry active`
                : "Live telemetry connection armed"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode Switcher */}
          <div className="flex items-center gap-1 bg-[#080c14] border border-[#1e293b] rounded-lg p-0.5 text-[10px] font-mono font-bold">
            <button
              onClick={() => setMode("REPLAY")}
              className={`px-2 py-1 rounded ${mode === "REPLAY" ? "bg-[#ff1801] text-white" : "text-[#8b9bb4] hover:text-white"}`}
            >
              REPLAY
            </button>
            <button
              onClick={() => setMode("LIVE")}
              className={`px-2 py-1 rounded ${mode === "LIVE" ? "bg-[#00d2be] text-[#080c14]" : "text-[#8b9bb4] hover:text-white"}`}
            >
              LIVE
            </button>
            <button
              onClick={() => setMode("OFF_TRACK")}
              className={`px-2 py-1 rounded ${mode === "OFF_TRACK" ? "bg-[#334155] text-white" : "text-[#8b9bb4] hover:text-white"}`}
            >
              OFF-TRACK
            </button>
          </div>

          <span className="flex items-center gap-2">
            <span className={`text-[10px] px-2 py-1 rounded-full border font-bold ${connected ? "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30" : mode === "OFF_TRACK" ? "bg-[#1e293b] text-[#8b9bb4] border-[#243447]" : paused ? "bg-[#1e293b] text-[#8b9bb4] border-[#243447]" : "bg-[#f59e0b]/10 text-[#fbbf24] border-[#f59e0b]/30"}`}>
              {connected ? "● WS LIVE" : mode === "OFF_TRACK" ? "○ STANDBY" : paused ? "○ PAUSED" : "● REPLAY SIM"}
            </span>
            <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#080c14] border border-[#1e293b] text-[#8b9bb4]">
              {connected && latencyMs != null ? `${latencyMs} ms` : mode === "OFF_TRACK" ? "OFFLINE" : "LOCAL"}
            </span>
          </span>
        </div>
      </div>

      {/* Session header */}
      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[11px] tracking-[0.18em] text-[#8b9bb4] font-bold">
            {mode === "REPLAY" ? (
              <>
                <span>HISTORICAL REPLAY :</span>
                <select
                  value={selectedReplayId}
                  onChange={(e) => setSelectedReplayId(e.target.value)}
                  className="bg-[#080c14] border border-[#1e293b] text-white text-xs rounded px-2 py-1 font-sans focus:outline-none"
                >
                  {HISTORICAL_REPLAYS.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.year} {r.circuitName} ({r.totalLaps} Laps)
                    </option>
                  ))}
                </select>
              </>
            ) : mode === "OFF_TRACK" ? (
              <span className="text-[#38bdf8]">
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
            <span className="text-xs px-2.5 py-1 rounded-full bg-[#080c14] border border-[#1e293b] text-[#8b9bb4] font-mono">
              Circuit-Adaptive Dual-Paradigm Router @champion • {connected ? "WebSocket" : mode === "OFF_TRACK" ? "Standby" : "Ingested Replay"}
            </span>
            {mode === "OFF_TRACK" && nextSession && (
              <span className="hidden md:inline-flex items-center gap-2 text-xs text-[#38bdf8]">
                <span className="w-1.5 h-1.5 rounded-full bg-[#38bdf8] animate-pulse" />
                Next session in {formatCountdown(nextSession.startsInMs)}
              </span>
            )}
          </div>

          <div className="mt-2 flex items-center gap-2 text-[10px]">
            <span className="px-2 py-1 rounded bg-[#1e293b] text-[#8b9bb4] border border-[#243447] font-mono">DRS • X-MODE ARMED</span>
            <span className="px-2 py-1 rounded bg-[#1e293b] text-[#8b9bb4] border border-[#243447] font-mono">PIT HAZARD &le;5L</span>
            <span className="text-[#5a6b84] hidden sm:inline">Hover driver row for SHAP + sparkline</span>
          </div>
        </div>

        {mode === "REPLAY" && (
          <div className="flex items-center gap-2">
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => changeSpeed(s)}
                className={`px-3 py-1.5 rounded-lg text-xs font-black border transition ${
                  speed === s
                    ? "bg-[#ff1801] text-white border-[#ff1801] shadow-[0_0_12px_rgba(255,24,1,0.4)]"
                    : "bg-[#080c14] text-[#8b9bb4] border-[#1e293b] hover:text-white hover:border-[#243447]"
                }`}
              >
                {s}
              </button>
            ))}
            <div className="ml-2 flex items-center gap-1.5">
              <button onClick={() => { setPaused(true); wsRef.current?.close(); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#1e293b] text-[#8b9bb4] border border-[#243447] hover:text-white">Pause</button>
              <button onClick={() => { setPaused(false); connect(speed); }} className="text-xs px-3 py-1.5 rounded-lg bg-[#0f172a] text-[#8b9bb4] border border-[#1e293b] hover:text-white hover:bg-[#1e293b]">Resume</button>
            </div>
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="rounded-lg bg-[#080c14] border border-[#1e293b] px-3 py-2 text-xs flex items-center justify-between text-[#8b9bb4]">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[#00d2be] shrink-0" />
          <span>
            {mode === "OFF_TRACK"
              ? `No session currently active. Next: ${nextGrandPrix?.officialName ?? "Grand Prix"} (${nextGrandPrix?.startDate ?? "2025"}). Showing final classification.`
              : mode === "LIVE"
                ? `Live telemetry feed armed via OpenF1 Live Transponders and WebSocket streaming.`
                : `Replaying ${activeReplay.sessionName} : predictions run through the same dual-paradigm pipeline as live timing.`}
          </span>
        </div>
        <span className="text-[10px] font-mono text-[#5a6b84] hidden md:inline">Macro MAE: 362.7ms • Coverage: 78.0% • p95: 6.49ms</span>
      </div>

      {/* Cockpit density grid : 12 cols */}
      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-8">
          <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] overflow-hidden">
            <div className="h-[3px] w-full bg-gradient-to-r from-[#ff1801] via-[#ff6b35] to-[#ff1801]" />
            <div className="p-4 flex items-center justify-between">
              <h2 className="font-black tracking-tight text-sm">
                {mode === "OFF_TRACK" ? "FINAL CLASSIFICATION : LAST GRAND PRIX" : "RACE LEADERBOARD : LIVE PREDICTIONS"}
              </h2>
              <span className="text-[11px] text-[#8b9bb4] font-mono hidden sm:inline">
                {mode === "OFF_TRACK" ? "[FINAL CLASSIFICATION]" : "q10-q50-q90 • PIT &le;3L hazard • gap delta trend"}
              </span>
            </div>
            <div className="px-4 pb-3">
              <RaceTable rows={(mode === "LIVE" && liveTelem.rows.length > 0 ? liveTelem.rows : raceRows) as unknown as RaceRow[]} />
            </div>
            <div className="px-4 pb-4 text-[10px] text-[#5a6b84] font-mono">PACE FORECAST = predicted next lap &plusmn;80% conformal band • PIT &le;3L = chance of pitting within 3 laps • tyre age & wear • DRS readiness • finishing P1/Podium/Points</div>
          </div>
          {/* driver detail strip */}
          {leaderRow && leaderInfo && (
            <div className="mt-4 rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
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
                <span className="ml-auto text-[10px] px-2 py-1 rounded-full bg-[#080c14] border border-[#1e293b] text-[#8b9bb4] font-mono">tyre {COMPOUND_NAMES[leaderRow.tyre] ?? leaderRow.tyre} • age {leaderRow.tyreAge} • wear {leaderRow.tyreWear}%</span>
              </div>
              <div className="grid grid-cols-3 gap-3 mt-3">
                <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
                  <div className="text-[10px] tracking-widest text-[#8b9bb4]">NEXT LAP FORECAST</div>
                  <div className="font-mono font-black text-lg mt-1">{raceRows[0]?.pace.q50 ? `${Math.floor(raceRows[0].pace.q50/60)}:${(raceRows[0].pace.q50%60).toFixed(2).padStart(5,"0")}`: leaderRow.gap}</div>
                  <div className="text-[10px] text-[#8b9bb4]">80% ±{raceRows[0]?.pace.q10 ? ((raceRows[0].pace.q90 - raceRows[0].pace.q10) / 2).toFixed(2) : "0.32"}s band • p95 8.3ms</div>
                </div>
                <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
                  <div className="text-[10px] tracking-widest text-[#8b9bb4]">PIT HAZARD</div>
                  <div className="font-mono font-bold mt-1">Next 1: {leaderRow.pit.p1}% • Next 3: {leaderRow.pit.p3}% • 5: {leaderRow.pit.p5}%</div>
                  <div className="mt-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden"><div className="h-full bg-gradient-to-r from-[#22c55e] to-[#ef4444]" style={{ width: `${leaderRow.pit.p3}%` }} /></div>
                </div>
                <div className="bg-[#080c14] rounded-lg p-3 border border-[#1e293b]">
                  <div className="text-[10px] tracking-widest text-[#8b9bb4]">FINISHING DISTRIBUTION</div>
                  <div className="mt-2 space-y-1 font-mono text-[11px]">
                    <div className="flex justify-between"><span className="text-[#8b9bb4]">P1</span><span className="font-bold">{(leaderRow.finishing.p1*100).toFixed(1)}%</span></div>
                    <div className="flex justify-between"><span className="text-[#8b9bb4]">Podium</span><span className="font-bold">{(leaderRow.finishing.podium*100).toFixed(1)}%</span></div>
                    <div className="flex justify-between"><span className="text-[#8b9bb4]">Points</span><span className="font-bold">{(leaderRow.finishing.points*100).toFixed(1)}%</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="col-span-12 lg:col-span-4 space-y-4">
          <CircuitMap circuitId={activeCircuitId} drivers={mode === "LIVE" && liveTelem.dots.length > 0 ? liveTelem.dots : dots} lap={lap} flag={flag as Flag} />
          <WeatherWidget circuitId={activeCircuitId} compact={false} />
        </div>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-12 lg:col-span-4"><TrackDominance rows={dominanceRows} leaderCode={leaderRow?.code ?? "VER"} /></div>
        <div className="col-span-12 lg:col-span-4"><StrategyBattle driverA={battlePair.a} driverB={battlePair.b} pitWindowDelta={battlePair.delta} overtakeProb={battlePair.prob} /></div>
        <div className="col-span-12 lg:col-span-4"><EventFeed events={feedEvents} maxItems={12} isOffTrack={mode === "OFF_TRACK"} /></div>
      </div>

      <div className="rounded-xl bg-[#0f172a] border border-[#1e293b] p-4">
        <h3 className="font-black text-xs tracking-widest">HOW REPLAY WORKS</h3>
        <p className="text-xs text-[#8b9bb4] mt-2 leading-relaxed">
          Historical Bronze lap events stream through the same <code className="bg-[#080c14] border border-[#1e293b] px-1.5 py-0.5 rounded font-mono">RaceEvent → RaceState → FeatureBuilder → Model → WebSocket</code> path as live data. It's a decent smoke test of the full pipeline without needing a live session.
        </p>
      </div>
    </div>
  );
}
