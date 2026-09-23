"use client";

import { useEffect, useState } from "react";
import {
  buildRaceSocketUrl,
  EMPTY_RACE_SOCKET_SNAPSHOT,
  parseRaceSocketFrame,
  type ConnectionProvenance,
  type RaceSocketEvent,
  type RaceSocketOptions,
  type RaceSocketSnapshot,
} from "@/lib/raceSocketProtocol";

export type { ConnectionProvenance, RaceFlag, RacePrediction, RaceSocketEvent, RaceSocketOptions, RaceSocketSnapshot } from "@/lib/raceSocketProtocol";

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_EXP = 5;
const MAX_BACKOFF_MS = 30000;
let snapshot: RaceSocketSnapshot = EMPTY_RACE_SOCKET_SNAPSHOT;

const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let ownerOptions: RaceSocketOptions | null | undefined;
let ownerSpeed: string | null | undefined;
let subscriberCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectAttempt = 0;
let malformedFrames = 0;

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function patch(next: Partial<RaceSocketSnapshot>): void {
  snapshot = { ...snapshot, ...next };
  emit();
}

function socketUrl(): string | null {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (!configured || typeof window === "undefined" || !ownerOptions) return null;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = configured.replace(/^wss?:\/\//, "");
  return buildRaceSocketUrl(`${proto}://${host}`, ownerOptions);
}

function clearReconnect(): void {
  if (!reconnectTimer) return;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function scheduleReconnect(): void {
  if ((typeof document !== "undefined" && document.hidden) || reconnectTimer) return;
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
  if (!socket) return;
  detachSocketHandlers(socket);
  socket.close();
  socket = null;
}

function connect(): void {
  if (typeof window === "undefined" || socket || subscriberCount <= 0 || ownerSpeed === undefined || ownerSpeed === null) return;
  const url = socketUrl();
  if (!url) return;
  patch({ speed: ownerSpeed });
  const ws = new WebSocket(url);
  socket = ws;
  ws.onopen = () => {
    reconnectAttempt = 0;
    patch({ connected: true });
  };
  ws.onclose = () => {
    if (socket === ws) socket = null;
    patch({ connected: false, latencyMs: null, status: snapshot.events.length > 0 ? "STALE" : "OFFLINE" });
    scheduleReconnect();
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (event) => {
    const frame = parseRaceSocketFrame(String(event.data), snapshot, ownerOptions?.source ?? "live");
    if (!frame) {
      malformedFrames++;
      if (malformedFrames % 25 === 0) console.warn(`Race socket: ${malformedFrames} malformed frames ignored`);
      return;
    }
    snapshot = frame.snapshot;
    emit();
  };
}

function onVisibility(): void {
  if (typeof document !== "undefined" && !document.hidden) {
    reconnectAttempt = 0;
    connect();
  }
}

export function useRaceSocket(configuration?: RaceSocketOptions | string | null, legacyOptions?: RaceSocketOptions): RaceSocketSnapshot {
  const configuredOptions = typeof configuration === "object" && configuration !== null ? configuration : legacyOptions;
  const speed = typeof configuration === "string" || configuration === null
    ? configuration
    : configuredOptions?.speed ?? "20x";
  const source = configuredOptions?.source ?? (typeof configuration === "string" ? "replay" : "live");
  const replayId = configuredOptions?.replayId ?? null;
  const requestedSpeed = configuredOptions?.speed ?? null;
  const owns = configuration !== undefined;
  const [current, setCurrent] = useState(snapshot);
  useEffect(() => {
    const listener = () => setCurrent(snapshot);
    listeners.add(listener);
    subscriberCount++;
    if (owns) {
      const nextOptions: RaceSocketOptions = { source, replayId, speed: requestedSpeed };
      const changed = ownerSpeed !== speed || ownerOptions?.source !== nextOptions.source || ownerOptions?.replayId !== nextOptions.replayId || ownerOptions?.speed !== nextOptions.speed;
      ownerSpeed = speed;
      ownerOptions = nextOptions;
      if (changed) {
        closeSocket();
        reconnectAttempt = 0;
        snapshot = { ...EMPTY_RACE_SOCKET_SNAPSHOT, speed: speed ?? "20x" };
        emit();
      }
      document.addEventListener("visibilitychange", onVisibility);
    }
    connect();
    return () => {
      listeners.delete(listener);
      subscriberCount--;
      if (owns) {
        document.removeEventListener("visibilitychange", onVisibility);
        ownerSpeed = undefined;
        ownerOptions = undefined;
        closeSocket();
        if (subscriberCount <= 0) reconnectAttempt = 0;
      } else if (subscriberCount <= 0) {
        closeSocket();
        reconnectAttempt = 0;
      }
    };
  }, [owns, speed, source, replayId, requestedSpeed]);
  return current;
}
