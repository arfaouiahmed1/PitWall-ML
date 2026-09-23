import { z } from "zod";

export type RaceFlag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED" | "UNKNOWN";
export type ConnectionProvenance = "LIVE" | "REPLAY" | "STALE" | "OFFLINE";
export type RaceSource = "live" | "replay";

export type RaceSocketEvent = {
  readonly id: string;
  readonly lap: number | null;
  readonly type: string;
  readonly text: string;
  readonly driver?: string;
  readonly sourceTimestamp: string | null;
  readonly receivedAt: string | null;
  readonly provenance: string | null;
  readonly dataAgeSeconds: number | null;
  readonly stale: boolean | null;
};

export type RacePrediction = {
  readonly q10: number | null;
  readonly q50: number | null;
  readonly q90: number | null;
  readonly tyreDeg: number | null;
  readonly pitNext3: number | null;
};

export type RaceSocketSnapshot = {
  readonly connected: boolean;
  readonly modelVersion: string | null;
  readonly lap: number;
  readonly lapAvailable: boolean;
  readonly flag: RaceFlag;
  readonly latencyMs: number | null;
  readonly speed: string;
  readonly events: readonly RaceSocketEvent[];
  readonly status: ConnectionProvenance;
  readonly sessionId: string | null;
  readonly totalLaps: number | null;
  readonly eventCount: number | null;
  readonly drivers: Readonly<Record<string, Record<string, unknown>>>;
  readonly prediction: RacePrediction;
  readonly sourceTimestamp: string | null;
  readonly observedAt: string | null;
  readonly receivedAt: string | null;
  readonly sourceId: string | null;
  readonly provenance: string | null;
  readonly dataAgeSeconds: number | null;
  readonly stale: boolean | null;
};

export type RaceSocketOptions = {
  readonly source: RaceSource;
  readonly replayId: string | null;
  readonly speed: string | null;
};

export type ParsedFrame = { readonly kind: "connected" | "snapshot" | "update"; readonly snapshot: RaceSocketSnapshot };
type UnknownRecord = Record<string, unknown>;

const RecordSchema = z.record(z.string(), z.unknown());
const MAX_EVENTS = 30;
const EMPTY_PREDICTION: RacePrediction = { q10: null, q50: null, q90: null, tyreDeg: null, pitNext3: null };

export const EMPTY_RACE_SOCKET_SNAPSHOT: RaceSocketSnapshot = {
  connected: false,
  modelVersion: null,
  lap: 0,
  lapAvailable: false,
  flag: "UNKNOWN",
  latencyMs: null,
  speed: "20x",
  events: [],
  status: "OFFLINE",
  sessionId: null,
  totalLaps: null,
  eventCount: null,
  drivers: {},
  prediction: EMPTY_PREDICTION,
  sourceTimestamp: null,
  observedAt: null,
  receivedAt: null,
  sourceId: null,
  provenance: null,
  dataAgeSeconds: null,
  stale: null,
};

function record(value: unknown): UnknownRecord {
  const parsed = RecordSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function flag(value: unknown): RaceFlag | null {
  const normalized = typeof value === "string" ? value.toUpperCase() : "";
  if (!normalized) return null;
  if (normalized.includes("VSC") || normalized.includes("VIRTUAL")) return "VSC";
  if (normalized === "SC" || normalized.includes("SAFETY")) return "SC";
  if (normalized === "RED") return "RED";
  if (normalized === "YELLOW") return "YELLOW";
  return "GREEN";
}

function provenance(value: unknown, eventSource: unknown, isStale: unknown, sourceMode: RaceSource, current: ConnectionProvenance): ConnectionProvenance {
  if (isStale === true || value === "STALE") return "STALE";
  if (value === "OFFLINE" || value === "UNAVAILABLE") return "OFFLINE";
  if (value === "LIVE" || eventSource === "openf1" || eventSource === "live") return "LIVE";
  if (value === "REPLAY" || eventSource === "parquet" || sourceMode === "replay") return "REPLAY";
  return current;
}

function parseFrameValue(value: unknown, current: RaceSocketSnapshot, sourceMode: RaceSource): ParsedFrame | null {
  const msg = record(value);
  if (msg.type === "connected") {
    return {
      kind: "connected",
      snapshot: {
        ...current,
        connected: true,
        speed: text(msg.speed) ?? current.speed,
        modelVersion: text(msg.model_version) ?? current.modelVersion,
      },
    };
  }
  if (msg.type !== "race_snapshot" && msg.type !== "race_update") return null;
  const state = record(msg.race_state);
  const event = record(msg.event);
  const prediction = record(msg.prediction);
  const sourceTimestamp = text(event.source_timestamp) ?? text(event.event_ts);
  const receivedAt = text(event.received_at);
  const observedAt = text(event.observed_at);
  const sourceId = text(event.source_id);
  const sourceProvenance = text(event.provenance);
  const eventSource = event.source;
  const nextStatus = msg.type === "race_update"
    ? provenance(sourceProvenance, eventSource, event.stale, sourceMode, current.status)
    : sourceMode === "replay" ? "REPLAY" : current.status;
  const driverNumber = number(event.driver_number);
  const eventType = text(event.event_type);
  const parsedEvent = msg.type === "race_update" && sourceId && eventType
    ? [{
        id: sourceId,
        lap: number(state.lap),
        type: eventType,
        text: driverNumber === null ? eventType : `#${driverNumber} ${eventType}`,
        driver: driverNumber === null ? undefined : String(driverNumber),
        sourceTimestamp,
        receivedAt,
        provenance: sourceProvenance,
        dataAgeSeconds: number(event.data_age_seconds),
        stale: typeof event.stale === "boolean" ? event.stale : null,
      }, ...current.events].slice(0, MAX_EVENTS)
    : msg.type === "race_snapshot" ? [] : current.events;

  const rawDrivers = record(state.drivers);
  const snapshotDrivers: Record<string, Record<string, unknown>> = {};
  for (const [key, val] of Object.entries(rawDrivers)) {
    snapshotDrivers[key] = record(val);
  }

  const updateDrivers = state.driver && driverNumber !== null
    ? { ...current.drivers, [String(driverNumber)]: record(state.driver) }
    : current.drivers;

  const nextDrivers = msg.type === "race_snapshot"
    ? (Object.keys(snapshotDrivers).length > 0 ? snapshotDrivers : current.drivers)
    : updateDrivers;

  const nextPrediction = msg.type === "race_snapshot"
    ? EMPTY_PREDICTION
    : {
        q10: number(prediction.q10),
        q50: number(prediction.q50),
        q90: number(prediction.q90),
        tyreDeg: number(prediction.tyre_deg),
        pitNext3: number(prediction.pit_next_3),
      };

  return {
    kind: msg.type === "race_snapshot" ? "snapshot" : "update",
    snapshot: {
      ...current,
      lap: number(state.lap) ?? current.lap,
      lapAvailable: number(state.lap) !== null || current.lapAvailable,
      flag: flag(state.track_status ?? state.flag) ?? current.flag,
      latencyMs: number(state.latency_ms) ?? current.latencyMs,
      sessionId: text(state.session_id) ?? current.sessionId,
      totalLaps: number(state.total_laps) ?? current.totalLaps,
      eventCount: number(state.event_count) ?? current.eventCount,
      drivers: nextDrivers,
      events: parsedEvent,
      status: nextStatus,
      prediction: nextPrediction,
      sourceTimestamp: msg.type === "race_snapshot" ? null : sourceTimestamp,
      observedAt: msg.type === "race_snapshot" ? null : observedAt,
      receivedAt: msg.type === "race_snapshot" ? null : receivedAt,
      sourceId: msg.type === "race_snapshot" ? null : sourceId,
      provenance: msg.type === "race_snapshot" ? null : sourceProvenance,
      dataAgeSeconds: msg.type === "race_snapshot" ? null : number(event.data_age_seconds),
      stale: msg.type === "race_snapshot" ? null : (typeof event.stale === "boolean" ? event.stale : null),
    },
  };
}

export function parseRaceSocketFrame(raw: string, current = EMPTY_RACE_SOCKET_SNAPSHOT, source: RaceSource = "live"): ParsedFrame | null {
  try {
    return parseFrameValue(JSON.parse(raw), current, source);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function buildRaceSocketUrl(baseUrl: string, options: RaceSocketOptions): string | null {
  if (!baseUrl) return null;
  const params = new URLSearchParams();
  if (options.source === "replay") {
    if (!options.replayId) return null;
    params.set("replay_id", options.replayId);
    if (options.speed) params.set("speed", options.speed);
  } else {
    params.set("source", "live");
  }
  return `${baseUrl.replace(/\/$/, "")}/ws/race?${params.toString()}`;
}
