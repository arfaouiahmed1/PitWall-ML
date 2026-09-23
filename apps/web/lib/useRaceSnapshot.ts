"use client";

import { useEffect, useState } from "react";
import { API_URL, fetchJson, startPoller } from "@/lib/api";
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
  sourceTimestamp: string | null;
  observedAt: string | null;
  receivedAt: string | null;
  sourceId: string | null;
  dataAgeSeconds: number | null;
  stale: boolean | null;
  lap: number;
  lapAvailable: boolean;
  trackStatus: string | null;
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
  source_timestamp?: string | null;
  received_at?: string | null;
  data_age_seconds?: number | null;
  stale?: boolean | null;
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
  sourceTimestamp: null,
  observedAt: null,
  receivedAt: null,
  sourceId: null,
  dataAgeSeconds: null,
  stale: null,
  lap: 0,
  lapAvailable: false,
  trackStatus: null,
  rows: [],
  dots: [],
  events: [],
  availableSessions: [],
};

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function normalizeCompound(value: unknown): RaceRow["tyre"] {
  const compound = nonEmptyString(value)?.toUpperCase();
  if (!compound) return undefined;

  if (compound === "S" || compound === "SOFT") return "S";
  if (compound === "M" || compound === "MEDIUM") return "M";
  if (compound === "H" || compound === "HARD") return "H";
  if (compound === "I" || compound === "INTERMEDIATE") return "I";
  if (compound === "W" || compound === "WET") return "W";
  return undefined;
}

function normalizePace(value: unknown): RaceRow["pace"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;

  const pace = value as Record<string, unknown>;
  const q10 = finiteNumber(pace.q10);
  const q50 = finiteNumber(pace.q50);
  const q90 = finiteNumber(pace.q90);
  return q10 === undefined && q50 === undefined && q90 === undefined ? undefined : { q10, q50, q90 };
}

export function normalizeRow(raw: Record<string, unknown>, _index: number): RaceRow {
  void _index;
  const driverNumber = finiteNumber(raw.driver_number);
  const position = finiteNumber(raw.position);
  const gapAhead = finiteNumber(raw.gap_ahead_s);
  const gapLeader = finiteNumber(raw.gap_to_leader_s);
  const tyreAge = finiteNumber(raw.tyre_age);
  const isLeader = position === 1;

  return {
    driver_number: driverNumber,
    position,
    code: nonEmptyString(raw.code),
    name: nonEmptyString(raw.name),
    team: nonEmptyString(raw.team_name) ?? nonEmptyString(raw.team),
    gap: isLeader ? "LEADER" : gapLeader === undefined ? undefined : `+${gapLeader.toFixed(2)}`,
    gapToLeader: isLeader ? "LEADER" : gapLeader === undefined ? undefined : `+${gapLeader.toFixed(2)}`,
    gapToAhead: isLeader ? "LEADER" : gapAhead === undefined ? undefined : `+${gapAhead.toFixed(2)}`,
    gapToLeaderSeconds: gapLeader,
    gapToAheadSeconds: gapAhead,
    gapDelta: finiteNumber(raw.gap_delta),
    tyre: normalizeCompound(raw.compound),
    tyreAge,
    drs: typeof raw.drs === "boolean" ? raw.drs : undefined,
    pace: normalizePace(raw.pace),
  };
}

export function useRaceSnapshot(params: {
  source: "replay" | "live";
  replayId: string | null;
  speed?: string | null;
}): RaceSnapshotState {
  const { source, replayId } = params;
  const [state, setState] = useState<RaceSnapshotState>(INITIAL_STATE);

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
      const lap = data.race_state?.lap ?? null;
      const trackStatus = data.race_state?.track_status ?? null;

      setState((prev) => ({
        ...prev,
        provenance: data.provenance,
        reason: data.reason,
        loading: false,
        error: null,
        lastUpdated: data.observed_at,
        sourceTimestamp: data.source_timestamp ?? data.observed_at,
        observedAt: data.observed_at,
        receivedAt: data.received_at ?? null,
        sourceId: data.source_id,
        dataAgeSeconds: data.data_age_seconds ?? null,
        stale: data.stale ?? null,
        lap: lap ?? prev.lap,
        lapAvailable: lap !== null || prev.lapAvailable,
        trackStatus: trackStatus ?? prev.trackStatus,
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

  return state;
}
