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
  FP1: "bg-[#1e293b] text-[#94a3b8] border-[#334155]",
  FP2: "bg-[#1e293b] text-[#94a3b8] border-[#334155]",
  FP3: "bg-[#1e293b] text-[#94a3b8] border-[#334155]",
  SQ: "bg-[#7c3aed]/15 text-[#a78bfa] border-[#7c3aed]/30",
  Sprint: "bg-[#7c3aed]/15 text-[#a78bfa] border-[#7c3aed]/30",
  Quali: "bg-[#eab308]/12 text-[#facc15] border-[#eab308]/30",
  Race: "bg-[#ff1801]/12 text-[#ff453a] border-[#ff1801]/30",
};

export function WeekendSchedule({
  sessions,
  circuitName = "Circuit de Barcelona-Catalunya",
  sprintWeekend = false,
}: {
  sessions?: WeekendSession[];
  circuitName?: string;
  sprintWeekend?: boolean;
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
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#1e293b] bg-[#080c14]">
        <div>
          <h3 className="font-black tracking-tight text-sm">GRAND PRIX WEEKEND</h3>
          <p className="text-[11px] text-[#64748b]">{circuitName} • Round 9 • {nextUpcoming ? countdown(nextUpcoming.utc, nowMs) + " to " + nextUpcoming.label : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#475569]">TIMES IN</span>
          <div className="inline-flex rounded-full border border-[#1e293b] bg-[#0f172a] p-0.5">
            <button
              onClick={() => setUtcMode(true)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition ${utcMode ? "bg-[#e2e8f0] text-[#0f172a]" : "text-[#64748b] hover:text-[#cbd5e1]"}`}
            >
              UTC
            </button>
            <button
              onClick={() => setUtcMode(false)}
              className={`px-3 py-1 rounded-full text-[11px] font-bold transition ${!utcMode ? "bg-[#e2e8f0] text-[#0f172a]" : "text-[#64748b] hover:text-[#cbd5e1]"}`}
            >
              LOCAL
            </button>
          </div>
        </div>
      </div>

      {/* countdown banner for next session */}
      {nextUpcoming && new Date(nextUpcoming.utc).getTime() > nowMs && (
        <div className="px-4 py-2 flex items-center justify-between bg-[#ff1801]/[0.07] border-b border-[#1e293b]">
          <span className="text-[11px] font-bold tracking-widest text-[#ff453a]">NEXT — {nextUpcoming.label.toUpperCase()}</span>
          <span className="font-mono text-xs font-black text-[#ffedd5] tracking-wide">
            {countdown(nextUpcoming.utc, nowMs)} <span className="font-normal text-[#94a3b8]">• {fmtDate(nextUpcoming.utc)} {fmtTime(nextUpcoming.utc, utcMode)}</span>
          </span>
        </div>
      )}

      <div className="divide-y divide-[#1e293b]">
        {baseSessions.map((s) => {
          const isLive = s.status === "live" || (new Date(s.utc).getTime() <= nowMs && new Date(s.utc).getTime() + s.durationMin * 60000 > nowMs);
          const isCompleted = s.status === "completed" || new Date(s.utc).getTime() + s.durationMin * 60000 < nowMs;
          const isUpcoming = !isLive && !isCompleted;
          return (
            <div
              key={s.kind + s.utc}
              className={`flex items-center gap-3 px-4 py-3 ${isLive ? "bg-[#00d084]/[0.06]" : isCompleted ? "opacity-60" : "hover:bg-[#1e293b]/40"}`}
            >
              <div className={`w-10 h-10 rounded-lg border flex flex-col items-center justify-center font-black text-[10px] leading-none ${kindBadge[s.kind]}`}>
                <span className="text-[11px]">{s.kind}</span>
                <span className="text-[8px] opacity-60 font-normal">{s.durationMin}m</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">{s.label}</span>
                  {isLive && <span className="inline-flex items-center gap-1 text-[10px] font-black tracking-widest px-2 py-0.5 rounded-full bg-[#00d084] text-[#052e1a] animate-pulse">● LIVE</span>}
                  {isCompleted && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#1e293b] border border-[#334155] text-[#64748b]">DONE</span>}
                  {isUpcoming && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#0f172a] border border-[#1e293b] text-[#475569]">{countdown(s.utc, nowMs)}</span>}
                </div>
                <div className="text-[11px] text-[#94a3b8] truncate">{s.day} • {fmtDate(s.utc)} • {isLive ? "in progress" : isCompleted ? "completed" : "upcoming"}</div>
              </div>
              <div className="text-right">
                <div className="font-mono font-bold text-sm">{fmtTime(s.utc, utcMode)}</div>
                <div className="text-[10px] text-[#64748b]">{utcMode ? new Date(s.utc).toLocaleDateString([], { weekday: "short" }) : "Local"}</div>
              </div>
              {/* status rail */}
              <div className={`w-1 self-stretch rounded-full ${isLive ? "bg-[#00d084] shadow-[0_0_8px_rgba(0,208,132,0.6)] animate-pulse" : isCompleted ? "bg-[#334155]" : "bg-[#1e293b]"}`} />
            </div>
          );
        })}
      </div>

      <div className="px-4 py-2.5 flex items-center justify-between border-t border-[#1e293b] bg-[#080c14] text-[10px]">
        <span className="text-[#475569]">Sprint weekends replace FP2 with Sprint Qualifying + Sprint. Toggle above for your timezone.</span>
        <span className="hidden sm:inline font-mono text-[#64748b]">FIA • {new Date().getFullYear()} calendar</span>
      </div>
    </div>
  );
}

export default WeekendSchedule;
