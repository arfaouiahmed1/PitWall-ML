"use client";

import { useEffect, useRef, useState } from "react";
import { DataBadge } from "@/components/DataBadge";
import { RaceEventRow, type RaceEventItem } from "@/components/ops/RaceEventRow";
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
  { id: 2, lap: 31, type: "PIT", driverNumber: 16, code: "LEC", text: "Pit stop : MED → HARD", detail: "Box, box : 2.34s • age 21", time: "14:32:48" },
  { id: 3, lap: 32, type: "ANOMALY", driverNumber: 63, code: "RUS", text: "Anomalous lap delta", detail: "+1.42s : traffic / lift & coast", time: "14:33:22" },
  { id: 4, lap: 32, type: "OVERTAKE", driverNumber: 81, code: "PIA", text: "Overtake : PIA → P5", detail: "DRS on main straight vs HAM", time: "14:34:02" },
  { id: 5, lap: 33, type: "YELLOW", text: "Yellow flag : Sector 2", detail: "Turn 9 : debris • delta +2.1s", time: "14:35:11" },
  { id: 6, lap: 33, type: "GREEN", text: "Green flag", detail: "Racing resumes : gaps frozen", time: "14:35:42" },
  { id: 7, lap: 34, type: "PIT", driverNumber: 44, code: "HAM", text: "Pit stop : HARD → MED", detail: "Undercut attempt • 2.18s", time: "14:36:30" },
  { id: 8, lap: 35, type: "SC", text: "Safety Car deployed", detail: "Incident : field bunched", time: "14:37:05" },
];

function typeMeta(t: FeedEventType): { icon: string; bg: string; border: string; text: string; stripe: string } {
  switch (t) {
    case "SC": return { icon: "⛔", bg: "bg-pitwall-papaya/10", border: "border-pitwall-papaya/30", text: "text-pitwall-papaya", stripe: "bg-pitwall-papaya" };
    case "VSC": return { icon: "⚠️", bg: "bg-pitwall-mint/10", border: "border-pitwall-mint/30", text: "text-pitwall-mint", stripe: "bg-pitwall-mint" };
    case "YELLOW": return { icon: "⚠️", bg: "bg-pitwall-yellow/10", border: "border-pitwall-yellow/30", text: "text-pitwall-amberlight", stripe: "bg-pitwall-yellow" };
    case "GREEN": return { icon: "🟢", bg: "bg-pitwall-green/10", border: "border-pitwall-green/30", text: "text-pitwall-green", stripe: "bg-pitwall-green" };
    case "PIT": return { icon: "🔧", bg: "bg-pitwall-cyan/10", border: "border-pitwall-cyan/30", text: "text-pitwall-cyan", stripe: "bg-pitwall-cyan" };
    case "FASTEST": return { icon: "⏱️", bg: "bg-pitwall-blue/10", border: "border-pitwall-blue/30", text: "text-pitwall-fog", stripe: "bg-pitwall-blue" };
    case "ANOMALY": return { icon: "📉", bg: "bg-pitwall-danger/10", border: "border-pitwall-danger/30", text: "text-pitwall-rose", stripe: "bg-pitwall-danger" };
    case "OVERTAKE": return { icon: "↗", bg: "bg-pitwall-green/10", border: "border-pitwall-green/30", text: "text-pitwall-mint", stripe: "bg-pitwall-green" };
    case "DRS": return { icon: "💨", bg: "bg-pitwall-cyan/10", border: "border-pitwall-cyan/30", text: "text-pitwall-cyan", stripe: "bg-pitwall-cyan" };
    default: return { icon: "•", bg: "bg-pitwall-border", border: "border-pitwall-steel", text: "text-pitwall-fog", stripe: "bg-pitwall-steel" };
  }
}

export function EventFeed({
  events,
  maxItems = 12,
  title = "LIVE EVENT FEED",
  isOffTrack = false,
}: {
  events?: FeedEvent[];
  maxItems?: number;
  title?: string;
  isOffTrack?: boolean;
}) {
  const feed = isOffTrack ? [] : events && events.length ? events : MOCK_EVENTS;
  const isMock = !isOffTrack && !(events && events.length);
  const visible = feed.slice(0, maxItems);
  const [liveIdx, setLiveIdx] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);

  // gentle live highlight pulse
  useEffect(() => {
    const iv = setInterval(() => setLiveIdx((i) => (i + 1) % Math.min(3, visible.length)), 1400);
    return () => clearInterval(iv);
  }, [visible.length]);

  return (
    <div className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-pitwall-danger animate-pulse shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
          <h3 className="font-black tracking-tight text-sm">{title}</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-pitwall-steel">RACE CONTROL • TIME LOST</span>
        </div>
        <span className="flex items-center gap-2"><span className="text-[10px] font-mono px-2 py-1 rounded bg-pitwall-border border border-pitwall-steel text-pitwall-fog">{feed.length} events</span>{isMock ? <DataBadge variant="MOCK" detail="illustrative events" /> : null}</span>
      </div>

      {/* flag banner integration */}
      <div className="px-3 py-1.5 bg-pitwall-green/30 border-b border-pitwall-border flex items-center gap-2 text-[11px]">
        <span className="w-1.5 h-1.5 rounded-full bg-pitwall-green animate-pulse shadow-[0_0_6px_rgba(34,197,94,0.7)]" />
        <span className="font-bold tracking-widest text-pitwall-green text-[10px]">GREEN</span>
        <span className="text-pitwall-steel">•</span>
        <span className="text-pitwall-fog font-mono text-[11px]">Last SC: Lap 28 • Time lost ~18.4s</span>
        <span className="ml-auto hidden sm:inline text-[10px] text-pitwall-steel">auto-scroll • newest first</span>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-auto max-h-[380px] divide-y divide-pitwall-border/60 bg-pitwall-bg scroll-smooth">
        {visible.length === 0 ? (
          <div className="p-8 text-center space-y-2">
            <div className="text-xs font-mono font-bold text-pitwall-muted">NO ACTIVE RACE CONTROL EVENTS</div>
            <div className="text-[11px] text-pitwall-muted">Event stream and safety car flags arm automatically upon session green light.</div>
          </div>
        ) : (
          visible.map((e) => {
            const cat = (e.type === "SC" || e.type === "VSC" || e.type === "YELLOW" || e.type === "GREEN"
              ? "FLAG"
              : e.type === "PIT"
              ? "PIT"
              : e.type === "FASTEST"
              ? "FASTEST"
              : e.type === "OVERTAKE"
              ? "OVERTAKE"
              : e.type === "DRS"
              ? "DRS"
              : "ANOMALY") as RaceEventItem["category"];
            return (
              <RaceEventRow
                key={e.id}
                event={{
                  id: e.id,
                  lap: e.lap,
                  source: "telemetry",
                  category: cat,
                  summary: e.text,
                  detail: e.detail,
                  driverNumber: e.driverNumber,
                }}
              />
            );
          })
        )}
      </div>

      <div className="px-3 py-2 border-t border-pitwall-border bg-pitwall-card flex items-center justify-between text-[10px]">
        <span className="inline-flex items-center gap-1.5 text-pitwall-steel">
          <span className="w-2 h-2 rounded-full bg-pitwall-green animate-pulse" /> Green
          <span className="w-2 h-2 rounded bg-pitwall-yellow animate-pulse" /> Yellow
          <span className="w-2 h-2 rounded bg-pitwall-papaya" /> SC
          <span className="w-2 h-2 rounded bg-pitwall-danger" /> Anomaly
        </span>
        <span className="hidden sm:inline font-mono text-pitwall-steel">Δ vs predicted • hazard pings</span>
      </div>
    </div>
  );
}

export default EventFeed;
