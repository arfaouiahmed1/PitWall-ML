"use client";

import { useEffect, useRef, useState } from "react";

export type FeedEventType = "SC" | "VSC" | "YELLOW" | "GREEN" | "PIT" | "FASTEST" | "ANOMALY" | "OVERTAKE" | "DRS";

export type FeedEvent = {
  id: string | number;
  lap: number;
  type: FeedEventType;
  driverNumber?: number;
  driver?: string;
  code?: string;
  text: string;
  detail?: string;
  time?: string;
};

const MOCK_EVENTS: FeedEvent[] = [
  { id: 1, lap: 31, type: "FASTEST", driverNumber: 4, code: "NOR", text: "Fastest lap", detail: "1:19.31 • +0.22 vs predicted", time: "14:32:11" },
  { id: 2, lap: 31, type: "PIT", driverNumber: 16, code: "LEC", text: "Pit stop — MED → HARD", detail: "Box, box — 2.34s • age 21", time: "14:32:48" },
  { id: 3, lap: 32, type: "ANOMALY", driverNumber: 63, code: "RUS", text: "Anomalous lap delta", detail: "+1.42s — traffic / lift & coast", time: "14:33:22" },
  { id: 4, lap: 32, type: "OVERTAKE", driverNumber: 81, code: "PIA", text: "Overtake — PIA → P5", detail: "DRS on main straight vs HAM", time: "14:34:02" },
  { id: 5, lap: 33, type: "YELLOW", text: "Yellow flag — Sector 2", detail: "Turn 9 — debris • delta +2.1s", time: "14:35:11" },
  { id: 6, lap: 33, type: "GREEN", text: "Green flag", detail: "Racing resumes — gaps frozen", time: "14:35:42" },
  { id: 7, lap: 34, type: "PIT", driverNumber: 44, code: "HAM", text: "Pit stop — HARD → MED", detail: "Undercut attempt • 2.18s", time: "14:36:30" },
  { id: 8, lap: 35, type: "SC", text: "Safety Car deployed", detail: "Incident — field bunched", time: "14:37:05" },
];

function typeMeta(t: FeedEventType): { icon: string; bg: string; border: string; text: string; stripe: string } {
  switch (t) {
    case "SC": return { icon: "⛔", bg: "bg-[#ff8000]/10", border: "border-[#ff8000]/30", text: "text-[#ff8000]", stripe: "bg-[#ff8000]" };
    case "VSC": return { icon: "⚠️", bg: "bg-[#a3e635]/10", border: "border-[#a3e635]/30", text: "text-[#a3e635]", stripe: "bg-[#a3e635]" };
    case "YELLOW": return { icon: "⚠️", bg: "bg-[#eab308]/10", border: "border-[#eab308]/30", text: "text-[#facc15]", stripe: "bg-[#eab308]" };
    case "GREEN": return { icon: "🟢", bg: "bg-[#22c55e]/10", border: "border-[#22c55e]/30", text: "text-[#22c55e]", stripe: "bg-[#22c55e]" };
    case "PIT": return { icon: "🔧", bg: "bg-[#38bdf8]/10", border: "border-[#38bdf8]/30", text: "text-[#7dd3fc]", stripe: "bg-[#38bdf8]" };
    case "FASTEST": return { icon: "⏱️", bg: "bg-[#a78bfa]/10", border: "border-[#a78bfa]/30", text: "text-[#c4b5fd]", stripe: "bg-[#a78bfa]" };
    case "ANOMALY": return { icon: "📉", bg: "bg-[#ef4444]/10", border: "border-[#ef4444]/30", text: "text-[#f87171]", stripe: "bg-[#ef4444]" };
    case "OVERTAKE": return { icon: "↗", bg: "bg-[#22c55e]/10", border: "border-[#22c55e]/30", text: "text-[#4ade80]", stripe: "bg-[#22c55e]" };
    case "DRS": return { icon: "💨", bg: "bg-[#00d2be]/10", border: "border-[#00d2be]/30", text: "text-[#00d2be]", stripe: "bg-[#00d2be]" };
    default: return { icon: "•", bg: "bg-[#1e293b]", border: "border-[#334155]", text: "text-[#94a3b8]", stripe: "bg-[#334155]" };
  }
}

export function EventFeed({
  events,
  maxItems = 12,
  title = "LIVE EVENT FEED",
}: {
  events?: FeedEvent[];
  maxItems?: number;
  title?: string;
}) {
  const feed = events && events.length ? events : MOCK_EVENTS;
  const visible = feed.slice(0, maxItems);
  const [liveIdx, setLiveIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // gentle live highlight pulse
  useEffect(() => {
    const iv = setInterval(() => setLiveIdx((i) => (i + 1) % Math.min(3, visible.length)), 1400);
    return () => clearInterval(iv);
  }, [visible.length]);

  return (
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a] flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b] bg-[#080c14]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#ef4444] animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
          <h3 className="font-black tracking-tight text-sm">{title}</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#475569]">RACE CONTROL • TIME LOST</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#1e293b] border border-[#334155] text-[#94a3b8]">{feed.length} events</span>
      </div>

      {/* flag banner integration */}
      <div className="px-3 py-1.5 bg-[#052e1a]/30 border-b border-[#1e293b] flex items-center gap-2 text-[11px]">
        <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.7)]" />
        <span className="font-bold tracking-widest text-[#22c55e] text-[10px]">GREEN</span>
        <span className="text-[#475569]">•</span>
        <span className="text-[#94a3b8] font-mono text-[11px]">Last SC: Lap 28 • Time lost ~18.4s</span>
        <span className="ml-auto hidden sm:inline text-[10px] text-[#475569]">auto-scroll • newest first</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto max-h-[380px] divide-y divide-[#1e293b]/60 bg-[#080c14] scroll-smooth">
        {visible.length === 0 ? (
          <div className="p-6 text-center text-sm text-[#64748b]">No events — waiting for race control…</div>
        ) : (
          visible.map((e, idx) => {
            const meta = typeMeta(e.type);
            const isPulsing = idx === liveIdx && (e.type === "SC" || e.type === "YELLOW" || e.type === "FASTEST");
            return (
              <div
                key={e.id}
                className={`flex gap-3 px-3 py-2.5 items-start border-l-2 ${meta.border} ${meta.bg} ${isPulsing ? "animate-pulse" : ""} hover:brightness-110 transition`}
                style={{ borderLeftColor: meta.stripe === "bg-[#ff8000]" ? "#ff8000" : meta.stripe === "bg-[#eab308]" ? "#eab308" : meta.stripe === "bg-[#ef4444]" ? "#ef4444" : meta.stripe === "bg-[#22c55e]" ? "#22c55e" : undefined }}
              >
                <div className={`w-7 h-7 rounded-lg border flex items-center justify-center text-xs font-black shrink-0 ${meta.bg} ${meta.border} ${meta.text}`}>
                  {meta.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1e293b] border border-[#334155] text-[#94a3b8] shrink-0">L{e.lap}</span>
                    {e.code && <span className="font-black text-xs">{e.code}</span>}
                    {e.driverNumber && <span className="text-[10px] text-[#64748b] font-mono">#{e.driverNumber}</span>}
                    <span className={`text-xs font-bold ${meta.text}`}>{e.text}</span>
                    {e.type === "ANOMALY" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ef4444]/15 text-[#f87171] border border-[#ef4444]/30">+1.42s</span>}
                    {e.type === "FASTEST" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#a78bfa]/15 text-[#c4b5fd] border border-[#a78bfa]/30">FL</span>}
                  </div>
                  {e.detail && <div className="text-[11px] text-[#94a3b8] leading-snug mt-0.5 truncate">{e.detail}</div>}
                </div>
                <div className="text-right shrink-0 hidden sm:block">
                  <div className="text-[10px] font-mono text-[#64748b]">{e.time ?? "--:--"}</div>
                  <div className={`text-[10px] font-bold ${e.type === "PIT" ? "text-[#7dd3fc]" : e.type === "SC" ? "text-[#ff8000]" : "text-[#475569]"}`}>{e.type}</div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="px-3 py-2 border-t border-[#1e293b] bg-[#0f172a] flex items-center justify-between text-[10px]">
        <span className="inline-flex items-center gap-1.5 text-[#475569]">
          <span className="w-2 h-2 rounded-full bg-[#22c55e] animate-pulse" /> Green
          <span className="w-2 h-2 rounded bg-[#eab308] animate-pulse" /> Yellow
          <span className="w-2 h-2 rounded bg-[#ff8000]" /> SC
          <span className="w-2 h-2 rounded bg-[#ef4444]" /> Anomaly
        </span>
        <span className="hidden sm:inline font-mono text-[#475569]">Δ vs predicted • hazard pings</span>
      </div>
    </div>
  );
}

export default EventFeed;
