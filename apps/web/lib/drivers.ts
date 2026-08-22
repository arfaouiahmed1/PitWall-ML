"use client";

import { useEffect, useState } from "react";

export type DriverInfo = {
  /** Full name, e.g. "Max Verstappen" */
  name: string;
  /** Three-letter acronym, e.g. "VER" */
  code: string;
  team: string;
  /** Team hex colour including "#", e.g. "#3671C6" */
  color: string;
  /** OpenF1 headshot URL when available */
  image?: string;
};

/** Offline-safe identity for the demo leaderboard rows (numbers match DRIVERS in app/page.tsx). */
export const DRIVER_FALLBACK: Record<number, DriverInfo> = {
  1: { name: "Max Verstappen", code: "VER", team: "Red Bull", color: "#3671C6" },
  4: { name: "Lando Norris", code: "NOR", team: "McLaren", color: "#FF8000" },
  16: { name: "Charles Leclerc", code: "LEC", team: "Ferrari", color: "#E8002D" },
  63: { name: "George Russell", code: "RUS", team: "Mercedes", color: "#27F4D2" },
  55: { name: "Carlos Sainz", code: "SAI", team: "Williams", color: "#64C4FF" },
  44: { name: "Lewis Hamilton", code: "HAM", team: "Ferrari", color: "#E8002D" },
  12: { name: "Kimi Antonelli", code: "ANT", team: "Mercedes", color: "#27F4D2" },
  81: { name: "Oscar Piastri", code: "PIA", team: "McLaren", color: "#FF8000" },
};

const OPENF1_DRIVERS_URL = "https://api.openf1.org/v1/drivers?session_key=latest";

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

export function lastName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1] || fullName;
}

/** Relative-luminance pick (WCAG coefficients); >150 reads as light on dark UI. */
export function readableTextColor(hex: string): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return "#ffffff";
  const n = parseInt(match[1], 16);
  const luminance = 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
  return luminance > 150 ? "#0a0e14" : "#ffffff";
}

export const COMPOUND_NAMES: Record<string, string> = {
  S: "SOFT",
  M: "MEDIUM",
  H: "HARD",
  I: "INTERMEDIATE",
  W: "WET",
};

/** Defensive mapping of one raw OpenF1 driver row; keeps fallback values on any malformed field. */
function mapDriver(raw: Record<string, unknown>, fallback?: DriverInfo): { num: number; info: DriverInfo } | undefined {
  const numRaw = raw.driver_number;
  const num = typeof numRaw === "string" ? Number(numRaw) : numRaw;
  if (typeof num !== "number" || !Number.isFinite(num)) return undefined;

  const teamColour = str(raw.team_colour);
  const headshot = str(raw.headshot_url);

  return {
    num,
    info: {
      name: str(raw.full_name) ?? fallback?.name ?? `Driver ${num}`,
      code: str(raw.name_acronym) ?? fallback?.code ?? String(num).slice(0, 3),
      team: str(raw.team_name) ?? fallback?.team ?? "",
      color: teamColour
        ? teamColour.startsWith("#")
          ? teamColour
          : `#${teamColour}`
        : (fallback?.color ?? "#243447"),
      image: headshot && /^https?:\/\//.test(headshot) ? headshot : undefined,
    },
  };
}

/**
 * Live driver identities keyed by driver_number. Starts from DRIVER_FALLBACK so the
 * leaderboard always renders, then merges OpenF1 `?session_key=latest` data on mount.
 * Any fetch/parse error is swallowed — fallback entries stay untouched.
 */
export function useDrivers(): Record<number, DriverInfo> {
  const [drivers, setDrivers] = useState<Record<number, DriverInfo>>(DRIVER_FALLBACK);

  useEffect(() => {
    let cancelled = false;
    fetch(OPENF1_DRIVERS_URL)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`OpenF1 HTTP ${res.status}`))))
      .then((rows: unknown) => {
        if (cancelled || !Array.isArray(rows)) return;
        const merged: Record<number, DriverInfo> = { ...DRIVER_FALLBACK };
        for (const row of rows) {
          if (row === null || typeof row !== "object") continue;
          const raw = row as Record<string, unknown>;
          const mapped = mapDriver(raw, DRIVER_FALLBACK[Number(raw.driver_number)]);
          if (mapped) merged[mapped.num] = mapped.info;
        }
        setDrivers(merged);
      })
      .catch(() => {
        /* offline / blocked — keep fallback identities */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return drivers;
}
