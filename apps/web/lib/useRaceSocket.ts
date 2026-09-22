"use client";

// Single shared race WebSocket for the whole cockpit.
//
// Backend truth (apps/api/pitwall_api/main.py::ws_race):
// - Query: /ws/race?speed=<1x|5x|20x|MAX>. Reads NEXT_PUBLIC_WS_URL.
// - First frame: {"type": "connected", ...}.
// - Live frames: {"type": "race_update", event: {event_type, driver_number, ...},
//   race_state: {lap, track_status, driver}, prediction: {q10,q50,q90,...}}.
// - The backend sends NO flag and NO latency_ms fields; flag is derived from
//   race_state.track_status and latencyMs stays null (rendered as LOCAL).
//
// Ownership model: the cockpit page owns the connection by passing its replay
// speed; the header (and any other component) subscribes with no argument and
// never triggers connect/disconnect. Passing `null` pauses (owner release).
// Exactly one socket exists no matter how many components subscribe.

import { useEffect, useState } from "react";

export type RaceFlag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";

export type RaceSocketEvent = {
  id: string;
  lap: number;
  type: string;
  text: string;
  driver?: string;
};

export type RaceSocketSnapshot = {
  connected: boolean;
  lap: number;
  flag: RaceFlag;
  latencyMs: number | null;
  speed: string;
  events: RaceSocketEvent[];
};

const DEFAULT_LAP = 31;
const MAX_EVENTS = 30;
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_EXP = 5;
const MAX_BACKOFF_MS = 30000;

let snapshot: RaceSocketSnapshot = {
  connected: false,
  lap: DEFAULT_LAP,
  flag: "GREEN",
  latencyMs: null,
  speed: "20x",
  events: [],
};

const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
/** Last non-undefined speed requested by an owner. Null = paused. Undefined = no owner yet. */
let ownerSpeed: string | null | undefined;
let subscriberCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let eventSeq = 0;
let malformedFrames = 0;

function emit(): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener();
    } catch {
      /* listener must never break the socket */
    }
  }
}

function patch(p: Partial<RaceSocketSnapshot>): void {
  snapshot = { ...snapshot, ...p };
  emit();
}

/** Backend sends track_status (default "GREEN"); accept legacy flag values too. */
function normalizeFlag(raw: unknown): RaceFlag {
  const normalized = String(raw ?? "GREEN").toUpperCase();
  if (normalized.includes("VSC") || normalized.includes("VIRTUAL")) return "VSC";
  if (normalized === "SC" || normalized.includes("SAFETY")) return "SC";
  if (normalized === "RED") return "RED";
  if (normalized === "YELLOW") return "YELLOW";
  return "GREEN";
}

function socketUrl(speed: string): string | null {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (!configured || typeof window === "undefined") return null;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = configured.replace(/^wss?:\/\//, "");
  return `${proto}://${host}/ws/race?speed=${encodeURIComponent(speed)}`;
}

function clearReconnect(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function scheduleReconnect(): void {
  if (typeof document !== "undefined" && document.hidden) return; // visibility-pause: onVisibility resumes
  if (reconnectTimer) return;
  const delay = Math.min(MAX_BACKOFF_MS, RECONNECT_BASE_MS * 2 ** Math.min(reconnectAttempt, RECONNECT_MAX_EXP));
  reconnectAttempt++;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function detachSocketHandlers(sock: WebSocket): void {
  sock.onopen = null;
  sock.onclose = null;
  sock.onerror = null;
  sock.onmessage = null;
}

function closeSocket(): void {
  clearReconnect();
  if (socket) {
    try {
      detachSocketHandlers(socket);
      socket.close();
    } catch {
      /* already closing */
    }
    socket = null;
  }
}

function handleRaceUpdate(msg: {
  race_state?: { lap?: unknown; flag?: unknown; track_status?: unknown; latency_ms?: unknown };
  event?: { event_type?: unknown; driver_number?: unknown };
  prediction?: { q50?: unknown };
}): void {
  const raceState = msg.race_state ?? {};
  const lap = typeof raceState.lap === "number" && Number.isFinite(raceState.lap) ? raceState.lap : snapshot.lap;
  const flag = normalizeFlag(raceState.flag ?? raceState.track_status);
  const latencyMs =
    typeof raceState.latency_ms === "number" && Number.isFinite(raceState.latency_ms) ? raceState.latency_ms : snapshot.latencyMs;
  const driverNum = msg.event?.driver_number;
  const eventType = String(msg.event?.event_type ?? "update");
  const q50 = msg.prediction?.q50;
  const text =
    `${driverNum ?? ""} ${eventType} ${typeof q50 === "number" ? `${q50}s` : ""}`.trim() ||
    eventType;
  eventSeq++;
  const ev: RaceSocketEvent = {
    id: `ws-${Date.now()}-${eventSeq}-${lap}-${driverNum ?? 0}`,
    lap,
    type: eventType,
    text,
    driver: driverNum != null ? String(driverNum) : undefined,
  };
  patch({ lap, flag, latencyMs, events: [ev, ...snapshot.events].slice(0, MAX_EVENTS) });
}

function connect(): void {
  if (typeof window === "undefined" || socket || subscriberCount <= 0) return;
  if (typeof ownerSpeed !== "string") return; // no owner (or paused): stay offline
  const url = socketUrl(ownerSpeed);
  if (!url) return;
  patch({ speed: ownerSpeed });
  let wsInstance: WebSocket;
  try {
    wsInstance = new WebSocket(url);
  } catch {
    scheduleReconnect();
    return;
  }
  socket = wsInstance;
  wsInstance.onopen = () => {
    reconnectAttempt = 0;
    patch({ connected: true });
  };
  wsInstance.onclose = () => {
    if (socket === wsInstance) socket = null;
    patch({ connected: false, latencyMs: null });
    scheduleReconnect(); // backoff; deferred while tab hidden
  };
  wsInstance.onerror = () => {
    try {
      wsInstance.close();
    } catch {
      /* onclose handles the rest */
    }
  };
  wsInstance.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as { type?: unknown } & Parameters<typeof handleRaceUpdate>[0];
      if (msg.type === "race_update") handleRaceUpdate(msg);
      // {"type": "connected"} handshake needs no state change beyond onopen.
    } catch {
      malformedFrames++;
      if (malformedFrames % 25 === 0) console.warn(`Race socket: ${malformedFrames} malformed frames ignored`);
    }
  };
}

function onVisibility(): void {
  if (typeof document !== "undefined" && !document.hidden) {
    reconnectAttempt = 0;
    connect(); // catch-up after visibility-pause
  }
}

/**
 * Subscribe to the shared race socket.
 * @param speed Owner speed ("1x"|"5x"|"20x"|"MAX"). Omit to subscribe only
 * (header). Pass `null` to pause (owner releases the connection).
 */
export function useRaceSocket(speed?: string | null): RaceSocketSnapshot {
  const [snap, setSnap] = useState<RaceSocketSnapshot>(snapshot);

  useEffect(() => {
    const listener = () => setSnap(snapshot);
    listeners.add(listener);
    subscriberCount++;
    const owned = speed !== undefined;
    if (owned) {
      const changed = ownerSpeed !== speed;
      ownerSpeed = speed;
      if (changed) {
        // Owner switched speed (or paused/resumed): drop the stale socket and
        // reconnect immediately instead of riding the backoff schedule.
        closeSocket();
        reconnectAttempt = 0;
      }
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", onVisibility);
      }
    }
    connect();
    return () => {
      listeners.delete(listener);
      subscriberCount--;
      if (owned) {
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", onVisibility);
        }
        ownerSpeed = undefined;
        // Owner left (unmount or stopped passing speed): no owner, no socket.
        closeSocket();
        if (subscriberCount <= 0) {
          clearReconnect();
          reconnectAttempt = 0;
        }
      } else if (subscriberCount <= 0) {
        closeSocket();
        clearReconnect();
        reconnectAttempt = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [speed]);

  return snap;
}
