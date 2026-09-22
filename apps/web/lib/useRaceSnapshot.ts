"use client";

import { useEffect, useRef, useState } from "react";
import { API_URL, WS_URL, fetchJson, startPoller } from "@/lib/api";
import type { RaceRow } from "@/components/RaceTable";
import type { DriverDot } from "@/components/CircuitMap";
import type { FeedEvent } from "@/components/EventFeed";

export type Provenance = "REPLAY" | "LIVE" | "STALE" | "UNAVAILABLE";

export type ReplaySessionSummary = {
  id: string;
  season: number | null;
  event: string;
  session_type: string;
  label: string;
  available: boolean;
};

export type RaceSnapshotState = {
  provenance: Provenance;
  reason: string | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  lap: number;
  trackStatus: string;
  rows: RaceRow[];
  dots: DriverDot[];
  events: FeedEvent[];
  availableSessions: ReplaySessionSummary[];
};

type ApiSnapshotResponse = {
  provenance: Provenance;
  reason: string | null;
  observed_at: string | null;
  source_id: string | null;
  race_state: {
    session_id?: string;
    lap?: number;
    track_status?: string;
    event_count?: number;
  } | null;
  rows: Array<Record<string, unknown>>;
  dots?: DriverDot[];
  events?: Array<Record<string, unknown>>;
  drivers?: Array<{ driver_number: number; name?: string; code?: string; team_name?: string }>;
};

const INITIAL_STATE: RaceSnapshotState = {
  provenance: "UNAVAILABLE",
  reason: "initializing",
  loading: true,
  error: null,
  lastUpdated: null,
  lap: 1,
  trackStatus: "GREEN",
  rows: [],
  dots: [],
  events: [],
  availableSessions: [],
};

function normalizeRow(raw: Record<string, unknown>, index: number): RaceRow {
  const driverNum = typeof raw.driver_number === "number" ? raw.driver_number : index + 1;
  const pos = typeof raw.position === "number" ? raw.position : index + 1;
  const compoundRaw = String(raw.compound ?? "M").toUpperCase();
  const validTyres = ["S", "M", "H", "I", "W"] as const;
  const tyre = (validTyres.find((t) => t === compoundRaw || compoundRaw.startsWith(t)) ?? "M") as "S" | "M" | "H" | "I" | "W";
  
  const gapAhead = raw.gap_ahead_s != null ? Number(raw.gap_ahead_s) : null;
  const gapLeader = raw.gap_to_leader_s != null ? Number(raw.gap_to_leader_s) : null;

  return {
    driver_number: driverNum,
    position: pos,
    code: typeof raw.code === "string" ? raw.code : String(driverNum),
    name: typeof raw.name === "string" ? raw.name : `Driver ${driverNum}`,
    team: typeof raw.team_name === "string" ? raw.team_name : typeof raw.team === "string" ? raw.team : "",
    gap: pos === 1 ? "LEADER" : gapLeader != null ? `+${gapLeader.toFixed(2)}` : `+${(index * 1.5).toFixed(2)}`,
    gapToLeader: pos === 1 ? "LEADER" : gapLeader != null ? `+${gapLeader.toFixed(2)}` : undefined,
    gapToAhead: pos === 1 ? "LEADER" : gapAhead != null ? `+${gapAhead.toFixed(2)}` : "+0.85",
    gapDelta: 0.02,
    tyre,
    tyreAge: typeof raw.tyre_age === "number" ? raw.tyre_age : 10,
    drs: pos > 1 && gapAhead != null && gapAhead < 1.0,
    pace: raw.pace && typeof raw.pace === "object" ? (raw.pace as RaceRow["pace"]) : undefined,
    pit: raw.pit && typeof raw.pit === "object" ? (raw.pit as RaceRow["pit"]) : undefined,
  };
}

export function useRaceSnapshot(params: {
  source: "replay" | "live";
  replayId: string | null;
  speed: string | null;
}): RaceSnapshotState {
  const { source, replayId, speed } = params;
  const [state, setState] = useState<RaceSnapshotState>(INITIAL_STATE);
  const activeWsRef = useRef<WebSocket | null>(null);

  // Fetch replay sessions catalog once
  useEffect(() => {
    if (!API_URL) return;
    fetchJson<ReplaySessionSummary[]>(`${API_URL}/race/sessions`).then((sessions) => {
      if (Array.isArray(sessions) && sessions.length > 0) {
        setState((prev) => ({ ...prev, availableSessions: sessions }));
      }
    });
  }, []);

  // Poll snapshot endpoint
  useEffect(() => {
    if (!API_URL) {
      setState((prev) => ({
        ...prev,
        provenance: "UNAVAILABLE",
        reason: "API not configured",
        loading: false,
      }));
      return;
    }

    let cancelled = false;

    const loadSnapshot = async () => {
      const url =
        source === "replay" && replayId
          ? `${API_URL}/race/snapshot?source=replay&replay_id=${encodeURIComponent(replayId)}`
          : `${API_URL}/race/snapshot?source=live`;

      const data = await fetchJson<ApiSnapshotResponse>(url);
      if (cancelled) return;

      if (!data) {
        setState((prev) => ({
          ...prev,
          provenance: prev.rows.length > 0 ? "STALE" : "UNAVAILABLE",
          reason: "fetch_failed",
          loading: false,
        }));
        return;
      }

      const rows = Array.isArray(data.rows) ? data.rows.map(normalizeRow) : [];
      const lap = data.race_state?.lap ?? (rows[0]?.position ? 1 : 0);
      const trackStatus = data.race_state?.track_status ?? "GREEN";

      setState((prev) => ({
        ...prev,
        provenance: data.provenance,
        reason: data.reason,
        loading: false,
        error: null,
        lastUpdated: data.observed_at ?? new Date().toISOString(),
        lap: Math.max(prev.lap, lap),
        trackStatus,
        rows: rows.length > 0 ? rows : prev.rows,
      }));
    };

    loadSnapshot();
    const cleanupPoller = startPoller(loadSnapshot, source === "live" ? 4000 : 8000);

    return () => {
      cancelled = true;
      cleanupPoller();
    };
  }, [source, replayId]);

  // Connect replay WebSocket if in replay mode with active speed and replayId
  useEffect(() => {
    if (source !== "replay" || !replayId || !speed || !WS_URL) {
      if (activeWsRef.current) {
        activeWsRef.current.close();
        activeWsRef.current = null;
      }
      return;
    }

    let ws: WebSocket | null = null;
    try {
      const wsUrl = `${WS_URL}/ws/race?replay_id=${encodeURIComponent(replayId)}&speed=${encodeURIComponent(speed)}`;
      ws = new WebSocket(wsUrl);
      activeWsRef.current = ws;

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "race_update") {
            const rs = msg.race_state;
            const ev = msg.event;
            setState((prev) => {
              const updatedLap = typeof rs?.lap === "number" ? rs.lap : prev.lap;
              const updatedStatus = typeof rs?.track_status === "string" ? rs.track_status : prev.trackStatus;

              let updatedEvents = prev.events;
              if (ev) {
                const newEv: FeedEvent = {
                  id: `ev-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  lap: updatedLap,
                  type: typeof ev.event_type === "string" ? (ev.event_type as FeedEvent["type"]) : "ANOMALY",
                  driverNumber: ev.driver_number,
                  text: `${ev.driver_number ? `#${ev.driver_number} ` : ""}${ev.event_type ?? "Update"}`,
                  detail: typeof ev.payload === "object" ? JSON.stringify(ev.payload) : undefined,
                };
                updatedEvents = [newEv, ...prev.events].slice(0, 30);
              }

              return {
                ...prev,
                provenance: "REPLAY",
                lastUpdated: msg.ts ?? new Date().toISOString(),
                lap: updatedLap,
                trackStatus: updatedStatus,
                events: updatedEvents,
              };
            });
          }
        } catch {
          // ignore malformed ws messages
        }
      };

      ws.onerror = () => {
        // ws error fallback to polling
      };
    } catch {
      // ws connection error
    }

    return () => {
      if (ws) {
        ws.close();
      }
      if (activeWsRef.current === ws) {
        activeWsRef.current = null;
      }
    };
  }, [source, replayId, speed]);

  return state;
}
