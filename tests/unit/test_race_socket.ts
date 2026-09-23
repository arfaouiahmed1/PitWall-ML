import { buildRaceSocketUrl, EMPTY_RACE_SOCKET_SNAPSHOT, parseRaceSocketFrame } from "../../apps/web/lib/raceSocketProtocol";
import { normalizeRow } from "../../apps/web/lib/useRaceSnapshot";

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

assert(!EMPTY_RACE_SOCKET_SNAPSHOT.lapAvailable && EMPTY_RACE_SOCKET_SNAPSHOT.flag === "UNKNOWN",
  "Initial lap and flag must be unavailable until backend state arrives.");
assert(EMPTY_RACE_SOCKET_SNAPSHOT.modelVersion === null, "Initial modelVersion must be null.");
assert(Object.keys(EMPTY_RACE_SOCKET_SNAPSHOT.drivers).length === 0, "Initial drivers must be empty object.");

const connectedFrame = parseRaceSocketFrame(JSON.stringify({
  type: "connected",
  speed: "20x",
  model_version: "lightgbm-v3.0.0",
}));
assert(connectedFrame?.kind === "connected", "Connected frame must be recognized with kind: connected.");
assert(connectedFrame.snapshot.connected === true, "Connected frame must set connected: true.");
assert(connectedFrame.snapshot.speed === "20x", "Connected frame must record speed.");
assert(connectedFrame.snapshot.modelVersion === "lightgbm-v3.0.0", "Connected frame must parse model_version.");

const replayUrl = buildRaceSocketUrl("ws://localhost:8000", {
  source: "replay",
  replayId: "session 2025",
  speed: "5x",
});
assert(replayUrl !== null && new URL(replayUrl).searchParams.get("replay_id") === "session 2025",
  "Replay id must round-trip through query encoding.");
assert(replayUrl !== null && new URL(replayUrl).searchParams.get("speed") === "5x", "Replay speed must be sent.");

const liveUrl = buildRaceSocketUrl("ws://localhost:8000", { source: "live", speed: null });
assert(liveUrl?.endsWith("source=live"), "Live source must be explicit.");
assert(buildRaceSocketUrl("", { source: "live", replayId: null, speed: null }) === null,
  "Missing backend configuration must remain disconnected.");
assert(buildRaceSocketUrl("ws://localhost:8000", { source: "replay", replayId: null, speed: "20x" }) === null,
  "Replay without an id must not fall through to live.");

const snapshot = parseRaceSocketFrame(JSON.stringify({
  type: "race_snapshot",
  race_state: {
    session_id: "replay-1",
    lap: 7,
    track_status: "YELLOW",
    total_laps: 52,
    event_count: 140,
    drivers: {
      "44": { driver_number: 44, position: 2, compound: "HARD", tyre_age: 12 },
    },
  },
}));
assert(snapshot?.kind === "snapshot", "Initial race_snapshot must be accepted.");
assert(snapshot.snapshot.sessionId === "replay-1" && snapshot.snapshot.lap === 7, "Snapshot race state was not parsed.");
assert(snapshot.snapshot.eventCount === 140, "Snapshot event_count was not parsed.");
assert(snapshot.snapshot.drivers["44"]?.position === 2, "Snapshot drivers map was not parsed.");
assert(snapshot.snapshot.prediction.q10 === null && snapshot.snapshot.dataAgeSeconds === null,
  "Unavailable initial prediction and freshness must be explicit.");

const update = parseRaceSocketFrame(JSON.stringify({
  type: "race_update",
  ts: "2026-09-22T12:00:00Z",
  event: {
    source: "openf1", event_type: "lap", driver_number: 4, source_timestamp: "2026-09-22T11:59:59Z",
    observed_at: "2026-09-22T11:59:59Z", received_at: "2026-09-22T12:00:00Z", source_id: "evt-42",
    provenance: "LIVE", data_age_seconds: 1, stale: false,
  },
  race_state: {
    lap: 7,
    track_status: "GREEN",
    driver: { driver_number: 4, position: 1, compound: "MEDIUM", tyre_age: 5 },
  },
  prediction: { q10: 80.1, q50: 80.4, q90: 80.9, tyre_deg: 0.12, pit_next_3: 0.34 },
}));
assert(update?.kind === "update", "Race update must be accepted.");
assert(update.snapshot.prediction.q10 === 80.1 && update.snapshot.prediction.q50 === 80.4 && update.snapshot.prediction.q90 === 80.9,
  "Pace quantiles were not parsed.");
assert(update.snapshot.prediction.tyreDeg === 0.12 && update.snapshot.prediction.pitNext3 === 0.34,
  "Tyre and pit predictions were not parsed.");
assert(update.snapshot.status === "LIVE" && update.snapshot.events[0]?.id === "evt-42",
  "Live provenance must come from source data and event id from backend source_id.");
assert(update.snapshot.events[0]?.receivedAt === "2026-09-22T12:00:00Z", "Backend receive timestamp was lost.");
assert(update.snapshot.drivers["4"]?.position === 1, "Race update driver was not merged into snapshot drivers.");

const replaySnapshot = parseRaceSocketFrame(JSON.stringify({
  type: "race_snapshot",
  race_state: { session_id: "replay-2", lap: 1, track_status: "GREEN" },
}), update.snapshot, "replay");
assert(replaySnapshot?.snapshot.status === "REPLAY" && replaySnapshot.snapshot.events.length === 0,
  "A replay snapshot must replace prior stream provenance and events.");
assert(replaySnapshot.snapshot.prediction.q50 === null && replaySnapshot.snapshot.sourceId === null,
  "Unavailable snapshot predictions and provenance must not inherit old stream values.");

const staleUpdate = parseRaceSocketFrame(JSON.stringify({
  type: "race_update", event: { source: "openf1", source_id: "stale-event", provenance: "LIVE", stale: true },
}));
assert(staleUpdate?.snapshot.status === "STALE", "Stale source data must not be presented as LIVE.");

const replayUpdate = parseRaceSocketFrame(JSON.stringify({
  type: "race_update", event: { source: "parquet", source_id: "replay-event" },
}), undefined, "replay");
assert(replayUpdate?.kind === "update" && replayUpdate.snapshot.status === "REPLAY", "Replay source was mislabeled LIVE.");
assert(parseRaceSocketFrame("{bad json") === null, "Malformed input must be rejected at the frame boundary.");

const p1Raw = { driver_number: 1, position: 1, compound: "HARD", tyre_age: 15 };
const p1Row = normalizeRow(p1Raw, 0);
assert(p1Row.gap === "LEADER" && p1Row.gapToLeader === "LEADER", "Leader gap must be LEADER.");
assert(p1Row.tyreAge === 15, "Explicit tyre age must be preserved.");

const p2MissingGaps = { driver_number: 2, position: 2 };
const p2Row = normalizeRow(p2MissingGaps, 1);
assert(p2Row.gap === undefined, "Missing gap_to_leader must NOT use synthetic (index * 1.5) math.");
assert(p2Row.gapToAhead === undefined, "Missing gap_ahead must NOT use hardcoded +0.85 fallback.");
assert(p2Row.gapDelta === undefined, "Missing gap_delta must NOT use hardcoded 0.02 fallback.");
assert(p2Row.tyreAge === 0, "Missing tyre_age must default to 0, not fabricated 10 laps.");
assert(p2Row.drs === false, "Missing gaps must not trigger DRS flag.");

console.log("Race socket contracts verified.");
