"use client";

import React, { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { useRaceSocket, type RaceSocketEvent } from "@/lib/useRaceSocket";

export type FeedEventType = "SC" | "VSC" | "YELLOW" | "GREEN" | "PIT" | "FASTEST" | "ANOMALY" | "OVERTAKE" | "DRS";

export type FeedEvent = {
  readonly id: string | number;
  readonly lap?: number | null;
  readonly type: FeedEventType;
  readonly driverNumber?: number;
  readonly driver?: string;
  readonly code?: string;
  readonly text: string;
  readonly detail?: string;
  readonly time?: string | null;
};

type SafetyCarObservation = {
  readonly p_sc_next_1: number;
  readonly p_vsc_next_1: number;
  readonly p_neutralization_next_3: number;
  readonly circuit_risk_tier: string;
  readonly risk_factors: readonly string[];
  readonly timestamp?: string;
};

function isSafetyCarObservation(value: unknown): value is SafetyCarObservation {
  if (typeof value !== "object" || value === null) return false;
  const observation = value as Record<string, unknown>;
  return typeof observation.p_sc_next_1 === "number"
    && typeof observation.p_vsc_next_1 === "number"
    && typeof observation.p_neutralization_next_3 === "number"
    && typeof observation.circuit_risk_tier === "string"
    && Array.isArray(observation.risk_factors);
}

const EVENT_TYPES: Readonly<Record<string, FeedEventType>> = {
  SC: "SC", SAFETY_CAR: "SC", VSC: "VSC", YELLOW: "YELLOW", YELLOW_FLAG: "YELLOW",
  GREEN: "GREEN", GREEN_FLAG: "GREEN", PIT: "PIT", PIT_IN: "PIT", PIT_OUT: "PIT",
  FASTEST: "FASTEST", FASTEST_LAP: "FASTEST", ANOMALY: "ANOMALY", OVERTAKE: "OVERTAKE", DRS: "DRS",
};

function eventType(type: string): FeedEventType {
  const normalized = type.toUpperCase().replace(/[ -]/g, "_");
  return EVENT_TYPES[normalized] ?? "ANOMALY";
}

function eventCategory(type: FeedEventType): string {
  switch (type) {
    case "SC": case "VSC": case "YELLOW": case "GREEN": return "FLAG";
    case "PIT": case "FASTEST": case "ANOMALY": case "OVERTAKE": case "DRS": return type;
  }
}

function formatProbability(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function EventFeed({
  maxItems = 12,
  title = "LIVE EVENT FEED",
  isOffTrack = false,
}: {
  events?: readonly FeedEvent[];
  maxItems?: number;
  title?: string;
  isOffTrack?: boolean;
}) {
  const socket = useRaceSocket();
  const [safetyCar, setSafetyCar] = useState<SafetyCarObservation | null>(null);
  const [predictionUnavailable, setPredictionUnavailable] = useState(false);

  useEffect(() => {
    if (!API_URL || isOffTrack) {
      setSafetyCar(null);
      setPredictionUnavailable(true);
      return;
    }
    const controller = new AbortController();
    setSafetyCar(null);
    setPredictionUnavailable(false);
    void fetch(`${API_URL}/predictions/safety-car`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Safety car prediction returned ${response.status}`);
        const payload: unknown = await response.json();
        if (!isSafetyCarObservation(payload)) throw new Error("Invalid safety car prediction");
        setSafetyCar(payload);
      })
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === "AbortError") return;
        setSafetyCar(null);
        setPredictionUnavailable(true);
      });
    return () => controller.abort();
  }, [isOffTrack]);

  const events = isOffTrack ? [] : socket.events;
  const visible = events.slice(0, maxItems);
  const safetyCarState = socket.flag === "UNKNOWN" || socket.status === "OFFLINE" ? "Unavailable" : socket.flag;

  return (
    <section aria-label={title} className="rounded-xl overflow-hidden border border-pitwall-border bg-pitwall-card flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 border-b border-pitwall-border bg-pitwall-bg">
        <h3 className="font-black tracking-tight text-sm">{title}</h3>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-pitwall-border border border-pitwall-steel text-pitwall-fog" aria-live="polite">{events.length} events</span>
      </header>

      <div className="px-3 py-2 border-b border-pitwall-border text-[11px] text-pitwall-fog" aria-live="polite">
        Safety car: <strong>{safetyCarState}</strong>
        {safetyCar ? <span> · Next lap SC {formatProbability(safetyCar.p_sc_next_1)} · VSC {formatProbability(safetyCar.p_vsc_next_1)} · 3-lap neutralization {formatProbability(safetyCar.p_neutralization_next_3)}{safetyCar.timestamp ? ` · ${safetyCar.timestamp}` : ""}</span> : <span>{predictionUnavailable ? " · Forecast unavailable" : " · Forecast loading"}</span>}
      </div>

      <div className="flex-1 overflow-auto max-h-[380px] divide-y divide-pitwall-border/60 bg-pitwall-bg">
        {visible.length === 0 ? (
          <div className="p-8 text-center text-xs font-mono text-pitwall-muted" role="status">No race events available</div>
        ) : visible.map((event: RaceSocketEvent) => (
          <div key={event.id} className="flex items-center justify-between gap-3 px-3 py-2 border-b border-pitwall-border/50 text-xs font-mono">
            <div className="flex min-w-0 items-center gap-2.5">
              {event.lap !== null ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-pitwall-bg border border-pitwall-border text-pitwall-muted">L{event.lap}</span> : null}
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded border border-pitwall-border text-pitwall-fog">{eventCategory(eventType(event.type))}</span>
              <span className="truncate text-pitwall-fog">{event.text}</span>
            </div>
            <time className="shrink-0 text-[10px] text-pitwall-muted" dateTime={event.sourceTimestamp ?? undefined}>{event.sourceTimestamp ?? "Time unavailable"}</time>
          </div>
        ))}
      </div>
    </section>
  );
}

export default EventFeed;
