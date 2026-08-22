"use client";

import { useEffect, useRef, useState } from "react";
import { DRIVER_FALLBACK } from "./drivers";

/**
 * Client-side race simulator for the hosted demo.
 *
 * The GitHub Pages deployment has no backend to stream from, so this hook
 * advances a lightweight race model entirely in the browser: per-driver base
 * pace, tyre degradation, stochastic lap noise, occasional slow laps and pit
 * stops inside the classic 12–40 window. It keeps the dashboard alive without
 * touching the real WebSocket path — when a live replay connects, the page
 * simply passes `enabled=false` and the sim freezes.
 */

export type SimSpeed = "1x" | "5x" | "20x" | "MAX";

export type DriverTick = {
  driver_number: number;
  position: number;
  gap: string;
  tyre: string;
  tyreAge: number;
  lastLap: string;
  forecast: string;
  interval: string;
  pitProb: number;
};

export type FeedItem = {
  id: number;
  text: string;
};

export type RaceSimState = {
  lap: number;
  totalLaps: number;
  entries: DriverTick[];
  feed: FeedItem[];
};

export const TOTAL_LAPS = 66;

/** Race snapshot the static page ships with — the sim resumes from here. */
const START_LAP = 31;

const TICK_MS: Record<Exclude<SimSpeed, "MAX">, number> = {
  "1x": 900,
  "5x": 300,
  "20x": 120,
};

const PIT_LOSS_S = 21;
const PIT_WINDOW_START = 12;
const PIT_WINDOW_END = 40;

type Compound = "S" | "M" | "H";

type SimDriver = {
  driver_number: number;
  basePace: number;
  compound: Compound;
  tyreAge: number;
  /** Cumulative race time behind the leader baseline (leader starts at 0). */
  totalTime: number;
  lastLapS: number | null;
};

type SimWorld = {
  lap: number;
  drivers: SimDriver[];
};

/**
 * Seed grid mirrors the static DRIVERS rows in app/page.tsx (lap-31 snapshot),
 * extended to all 8 DRIVER_FALLBACK entries. Base pace spans ~0.6 s so the
 * rendered laps land in the same 1:19–1:20 window every other surface on the
 * dashboard already displays.
 */
const SEED: Array<{
  driver_number: number;
  basePace: number;
  compound: Compound;
  tyreAge: number;
  gap: number;
}> = [
  { driver_number: 1, basePace: 79.62, compound: "M", tyreAge: 18, gap: 0 },
  { driver_number: 4, basePace: 79.7, compound: "H", tyreAge: 11, gap: 2.41 },
  { driver_number: 16, basePace: 79.78, compound: "M", tyreAge: 21, gap: 6.92 },
  { driver_number: 63, basePace: 79.9, compound: "M", tyreAge: 16, gap: 9.11 },
  { driver_number: 44, basePace: 80.04, compound: "H", tyreAge: 8, gap: 12.03 },
  { driver_number: 55, basePace: 79.84, compound: "S", tyreAge: 14, gap: 13.5 },
  { driver_number: 81, basePace: 79.96, compound: "H", tyreAge: 10, gap: 15.2 },
  { driver_number: 12, basePace: 80.12, compound: "M", tyreAge: 19, gap: 18.4 },
];

function createWorld(): SimWorld {
  return {
    lap: START_LAP,
    drivers: SEED.map((s) => ({
      driver_number: s.driver_number,
      basePace: s.basePace,
      compound: s.compound,
      tyreAge: s.tyreAge,
      totalTime: s.gap,
      lastLapS: s.basePace + 0.045 * s.tyreAge,
    })),
  };
}

function code(driverNumber: number): string {
  return DRIVER_FALLBACK[driverNumber]?.code ?? String(driverNumber);
}

function fmtLap(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const rest = seconds - m * 60;
  return `${m}:${rest.toFixed(2).padStart(5, "0")}`;
}

/** Box-Muller; only called inside client effects, never during render/SSR. */
function gauss(std: number): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * std;
}

/** Per-lap pit hazard grows with tyre age; fresh tyres almost never stop. */
function perLapPitHazard(tyreAge: number): number {
  return Math.min(Math.max((tyreAge - 10) / 26, 0.01), 0.45);
}

function threeLapPitProb(tyreAge: number): number {
  const p = perLapPitHazard(tyreAge);
  return Math.round((1 - Math.pow(1 - p, 3)) * 100);
}

function forecastBand(tyreAge: number): number {
  return Math.min(0.18 + 0.02 * tyreAge, 0.6);
}

function snapshot(world: SimWorld): Omit<RaceSimState, "feed"> {
  const sorted = [...world.drivers].sort((a, b) => a.totalTime - b.totalTime);
  const leaderTime = sorted[0].totalTime;
  const entries: DriverTick[] = sorted.map((d, i) => {
    const band = forecastBand(d.tyreAge);
    return {
      driver_number: d.driver_number,
      position: i + 1,
      gap: i === 0 ? "LEADER" : `+${(d.totalTime - leaderTime).toFixed(2)}`,
      tyre: d.compound,
      tyreAge: d.tyreAge,
      lastLap: d.lastLapS !== null ? fmtLap(d.lastLapS) : "--",
      forecast: `${fmtLap(d.basePace + 0.045 * d.tyreAge)} ± .${String(Math.round(band * 100)).padStart(2, "0")}`,
      interval: `${threeLapPitProb(d.tyreAge)}%`,
      pitProb: threeLapPitProb(d.tyreAge),
    };
  });
  return { lap: world.lap, totalLaps: TOTAL_LAPS, entries };
}

/**
 * Advance the whole race by one lap. Mutates `world`, returns feed items in
 * chronological order (pit stops first, then the fastest lap of the tour).
 */
function stepLap(world: SimWorld, nextFeedId: () => number): FeedItem[] {
  const items: FeedItem[] = [];
  if (world.lap >= TOTAL_LAPS) return items;

  world.lap += 1;
  // Fuel burns off through the stint, so the field gently speeds up.
  const fuelEffect = Math.min(0.035 * (world.lap - START_LAP), 1.2);

  type LapResult = { driver: SimDriver; lapTime: number; pitted: boolean };
  const results: LapResult[] = [];

  for (const d of world.drivers) {
    const slowLap = Math.random() < 0.07 ? 0.4 + Math.random() * 0.8 : 0;
    let lapTime = d.basePace + 0.045 * d.tyreAge + gauss(0.25) - fuelEffect + slowLap;

    let pitted = false;
    if (world.lap >= PIT_WINDOW_START && world.lap <= PIT_WINDOW_END) {
      if (Math.random() < perLapPitHazard(d.tyreAge)) {
        lapTime += PIT_LOSS_S + Math.abs(gauss(0.4));
        d.compound = d.compound === "M" ? "H" : "M";
        d.tyreAge = 0;
        pitted = true;
        items.push({
          id: nextFeedId(),
          text: `LAP ${world.lap} · ${code(d.driver_number)} PIT — box confirmed, +${PIT_LOSS_S}s, out on ${d.compound}·fresh`,
        });
      }
    }

    d.totalTime += lapTime;
    d.lastLapS = lapTime;
    d.tyreAge += 1;
    results.push({ driver: d, lapTime, pitted });
  }

  const fastest = results.filter((r) => !r.pitted).sort((a, b) => a.lapTime - b.lapTime)[0];
  if (fastest) {
    const order = [...world.drivers].sort((a, b) => a.totalTime - b.totalTime);
    const pos = order.indexOf(fastest.driver) + 1;
    items.push({
      id: nextFeedId(),
      text: `LAP ${world.lap} · ${code(fastest.driver.driver_number)} ${fmtLap(fastest.lapTime)} · P${pos} · tyre ${fastest.driver.compound}·${fastest.driver.tyreAge}`,
    });
  }

  if (world.lap >= TOTAL_LAPS) {
    items.push({
      id: nextFeedId(),
      text: `LAP ${TOTAL_LAPS} · CHEQUERED FLAG — simulated race complete`,
    });
  }

  return items;
}

/**
 * Drive the dashboard from a local simulation.
 *
 * @param speed   tick cadence — 900ms (1x), 300ms (5x), 120ms (20x); MAX resolves
 *                every remaining lap up to 66 in a single synchronous burst.
 * @param enabled false pauses the ticks (Pause button, or a real WS connected).
 */
export function useRaceSim(speed: SimSpeed, enabled: boolean): RaceSimState {
  const worldRef = useRef<SimWorld | null>(null);
  const feedIdRef = useRef(1);
  const [state, setState] = useState<RaceSimState>(() => ({
    ...snapshot(createWorld()),
    feed: [],
  }));

  useEffect(() => {
    if (!enabled) return;
    if (!worldRef.current) worldRef.current = createWorld();
    const world = worldRef.current;

    const commit = (items: FeedItem[]) => {
      setState((prev) => ({
        ...snapshot(world),
        feed: [...items].reverse().concat(prev.feed).slice(0, 30),
      }));
    };

    if (speed === "MAX") {
      const all: FeedItem[] = [];
      while (world.lap < TOTAL_LAPS) {
        all.push(...stepLap(world, () => feedIdRef.current++));
      }
      commit(all);
      return;
    }

    const tick = () => commit(stepLap(world, () => feedIdRef.current++));
    tick(); // move immediately on start/resume/speed change — no dead first second
    const interval = setInterval(tick, TICK_MS[speed]);
    return () => clearInterval(interval);
  }, [speed, enabled]);

  return state;
}
