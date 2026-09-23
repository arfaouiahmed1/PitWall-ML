"use client";

import { useEffect, useMemo, useState } from "react";

export type SessionKind = "FP1" | "FP2" | "FP3" | "SQ" | "Sprint" | "Quali" | "Race";
export type WeekendSession = {
  kind: SessionKind;
  label: string;
  day: string; // e.g. Fri 30 May
  utc: string; // ISO string
  durationMin: number;
  status?: "upcoming" | "live" | "completed";
};

const DEFAULT_SESSIONS: WeekendSession[] = [
  { kind: "FP1", label: "Practice 1", day: "Fri 30 May", utc: "2026-05-30T11:30:00Z", durationMin: 60, status: "completed" },
  { kind: "FP2", label: "Practice 2", day: "Fri 30 May", utc: "2026-05-30T15:00:00Z", durationMin: 60, status: "completed" },
  { kind: "FP3", label: "Practice 3", day: "Sat 31 May", utc: "2026-05-31T10:30:00Z", durationMin: 60, status: "live" },
  { kind: "Quali", label: "Qualifying", day: "Sat 31 May", utc: "2026-05-31T14:00:00Z", durationMin: 60, status: "upcoming" },
  { kind: "Race", label: "Grand Prix", day: "Sun 1 Jun", utc: "2026-06-01T13:00:00Z", durationMin: 120, status: "upcoming" },
];

const SPRINT_WEEKEND: WeekendSession[] = [
  { kind: "FP1", label: "Practice 1", day: "Fri 18 Jul", utc: "2026-07-18T11:30:00Z", durationMin: 60 },
  { kind: "SQ", label: "Sprint Quali", day: "Fri 18 Jul", utc: "2026-07-18T15:30:00Z", durationMin: 44 },
  { kind: "Sprint", label: "Sprint", day: "Sat 19 Jul", utc: "2026-07-19T10:00:00Z", durationMin: 40 },
  { kind: "Quali", label: "Qualifying", day: "Sat 19 Jul", utc: "2026-07-19T14:00:00Z", durationMin: 60 },
  { kind: "Race", label: "Grand Prix", day: "Sun 20 Jul", utc: "2026-07-20T13:00:00Z", durationMin: 120 },
];

function fmtTime(iso: string, utcMode: boolean): string {
  const d = new Date(iso);
  if (utcMode) {
    return d.toISOString().slice(11, 16) + " UTC";
  }
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function countdown(targetIso: string, nowMs: number): string {
  const diff = new Date(targetIso).getTime() - nowMs;
  if (diff <= 0) return "• LIVE";
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const s = Math.floor((diff % 60000) / 1000);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

const kindBadge: Record<SessionKind, string> = {
  FP1: "bg-pitwall-border text-pitwall-fog border-pitwall-steel",
  FP2: "bg-pitwall-border text-pitwall-fog border-pitwall-steel",
  FP3: "bg-pitwall-border text-pitwall-fog border-pitwall-steel",
  SQ: "bg-pitwall-blue/15 text-pitwall-blue border-pitwall-blue/30",
  Sprint: "bg-pitwall-blue/15 text-pitwall-blue border-pitwall-blue/30",
  Quali: "bg-pitwall-yellow/12 text-pitwall-amberlight border-pitwall-yellow/30",
  Race: "bg-pitwall-accent/12 text-pitwall-accent border-pitwall-accent/30",
};

export function WeekendSchedule({
  sessions,
  circuitName = "Circuit de Barcelona-Catalunya",
  sprintWeekend = false,
  roundNumber,
}: {
  sessions?: WeekendSession[];
  circuitName?: string;
  sprintWeekend?: boolean;
  roundNumber?: number;
}) {
  const baseSessions = useMemo(() => {
    if (sessions && sessions.length) return sessions;
    return sprintWeekend ? SPRINT_WEEKEND : DEFAULT_SESSIONS;
  }, [sessions, sprintWeekend]);

  const [utcMode, setUtcMode] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(iv);
  }, []);

  const nextUpcoming = useMemo(() => {
    const upcoming = baseSessions.find((s) => new Date(s.utc).getTime() > nowMs);
    return upcoming ?? baseSessions[baseSessions.length - 1];
  }, [baseSessions, nowMs]);

  return (
    <div className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <div>
          <h3 className="font-black tracking-tight text-sm">GRAND PRIX WEEKEND</h3>
          <p className="text-[11px] text-pitwall-muted">{circuitName} • Round {roundNumber ?? 9} • {nextUpcoming ? countdown(nextUpcoming.utc, nowMs) + " to " + nextUpcoming.label : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-steel">TIMES IN</span>
          <div className="inline-flex rounded-full border border-pitwall-border bg-pitwall-card p-0.5">
            <button
              onClick={() => setUtcMode(true)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition ${utcMode ? "bg-pitwall-ink text-pitwall-card" : "text-pitwall-muted hover:text-pitwall-fog"}`}
            >
              UTC
            </button>
            <button
              onClick={() => setUtcMode(false)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition ${!utcMode ? "bg-pitwall-ink text-pitwall-card" : "text-pitwall-muted hover:text-pitwall-fog"}`}
            >
              LOCAL
            </button>
          </div>
        </div>
      </div>

      {/* countdown banner for next session */}
      {nextUpcoming && new Date(nextUpcoming.utc).getTime() > nowMs && (
        <div className="px-4 py-2 flex flex-wrap items-center justify-between gap-2 bg-pitwall-accent/[0.07] border-b border-pitwall-border">
          <span className="text-[11px] font-bold tracking-widest text-pitwall-accent min-w-0">NEXT : {nextUpcoming.label.toUpperCase()}</span>
          <span className="font-mono text-xs font-black text-pitwall-fog tracking-wide min-w-0 text-right">
            {countdown(nextUpcoming.utc, nowMs)} <span className="font-normal text-pitwall-fog">• {fmtDate(nextUpcoming.utc)} {fmtTime(nextUpcoming.utc, utcMode)}</span>
          </span>
        </div>
      )}

      <div className="divide-y divide-pitwall-border">
        {baseSessions.map((s) => {
          const isLive = s.status === "live" || (new Date(s.utc).getTime() <= nowMs && new Date(s.utc).getTime() + s.durationMin * 60000 > nowMs);
          const isCompleted = s.status === "completed" || new Date(s.utc).getTime() + s.durationMin * 60000 < nowMs;
          const isUpcoming = !isLive && !isCompleted;
          return (
            <div
              key={s.kind + s.utc}
              className={`flex items-center gap-3 px-4 py-3 ${isLive ? "bg-pitwall-cyan/[0.06]" : isCompleted ? "opacity-60" : "hover:bg-pitwall-border/40"}`}
            >
              <div className={`w-10 h-10 rounded-lg border flex flex-col items-center justify-center font-black text-[10px] leading-none ${kindBadge[s.kind]}`}>
                <span className="text-[11px]">{s.kind}</span>
                <span className="text-[8px] opacity-60 font-normal">{s.durationMin}m</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{s.label}</span>
                  {isLive && <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full bg-pitwall-cyan text-pitwall-green animate-pulse">● LIVE</span>}
                  {isCompleted && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pitwall-border border border-pitwall-steel text-pitwall-muted">DONE</span>}
                  {isUpcoming && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pitwall-card border border-pitwall-border text-pitwall-steel">{countdown(s.utc, nowMs)}</span>}
                </div>
                <div className="text-[11px] text-pitwall-fog truncate">{s.day} • {fmtDate(s.utc)} • {isLive ? "in progress" : isCompleted ? "completed" : "upcoming"}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="font-mono font-bold text-sm">{fmtTime(s.utc, utcMode)}</div>
                <div className="text-[10px] text-pitwall-muted">{utcMode ? new Date(s.utc).toLocaleDateString([], { weekday: "short" }) : "Local"}</div>
              </div>
              {/* status rail */}
              <div className={`w-1 self-stretch rounded-full shrink-0 ${isLive ? "bg-pitwall-cyan shadow-[0_0_8px_rgba(0,208,132,0.6)] animate-pulse" : isCompleted ? "bg-pitwall-steel" : "bg-pitwall-border"}`} />
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 flex items-center justify-between border-t border-pitwall-border bg-pitwall-bg text-[10px]">
        <span className="text-pitwall-steel">Sprint weekends replace FP2 with Sprint Qualifying + Sprint. Toggle above for your timezone.</span>
        <span className="hidden sm:inline font-mono text-pitwall-muted">FIA • {new Date().getFullYear()} calendar</span>
      </div>
    </div>
  );
}

export default WeekendSchedule;
