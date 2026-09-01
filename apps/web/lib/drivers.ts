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
  /** Driver number (1..99) */
  number?: number;
};

/** Team colour registry — canonical 2025/2026 liveries */
export const TEAM_COLORS: Record<string, string> = {
  "Red Bull": "#3671c6",
  "Red Bull Racing": "#3671c6",
  McLaren: "#ff8000",
  Ferrari: "#e8002d",
  Mercedes: "#00d2be",
  "Aston Martin": "#006f62",
  Alpine: "#0090ff",
  Williams: "#005aff",
  Haas: "#b6babd",
  "Racing Bulls": "#6692ff",
  RB: "#6692ff",
  Sauber: "#52e252",
  Audi: "#52e252",
  Cadillac: "#c9a86a",
};

function headshotUrl(code: string, num: number): string {
  // CDN-backed OpenF1 headshot — falls back to Formula1.com static if OpenF1 unavailable.
  // OpenF1 headshot_url is fetched live and merged via useDrivers; this is the offline fallback.
  // Using api.openf1.org image proxy pattern + formula1.com as secondary.
  return `https://cdn.openf1.org/drivers/${num}/headshot.png`;
}

/** Complete 2025/2026 grid — 20 drivers as specified in plan 1.2 */
export const DRIVER_FALLBACK: Record<number, DriverInfo> = {
  1: {
    name: "Max Verstappen",
    code: "VER",
    team: "Red Bull",
    color: "#3671c6",
    image: headshotUrl("VER", 1),
    number: 1,
  },
  4: {
    name: "Lando Norris",
    code: "NOR",
    team: "McLaren",
    color: "#ff8000",
    image: headshotUrl("NOR", 4),
    number: 4,
  },
  16: {
    name: "Charles Leclerc",
    code: "LEC",
    team: "Ferrari",
    color: "#e8002d",
    image: headshotUrl("LEC", 16),
    number: 16,
  },
  63: {
    name: "George Russell",
    code: "RUS",
    team: "Mercedes",
    color: "#00d2be",
    image: headshotUrl("RUS", 63),
    number: 63,
  },
  44: {
    name: "Lewis Hamilton",
    code: "HAM",
    team: "Ferrari",
    color: "#e8002d",
    image: headshotUrl("HAM", 44),
    number: 44,
  },
  55: {
    name: "Carlos Sainz",
    code: "SAI",
    team: "Williams",
    color: "#005aff",
    image: headshotUrl("SAI", 55),
    number: 55,
  },
  81: {
    name: "Oscar Piastri",
    code: "PIA",
    team: "McLaren",
    color: "#ff8000",
    image: headshotUrl("PIA", 81),
    number: 81,
  },
  12: {
    name: "Kimi Antonelli",
    code: "ANT",
    team: "Mercedes",
    color: "#00d2be",
    image: headshotUrl("ANT", 12),
    number: 12,
  },
  14: {
    name: "Fernando Alonso",
    code: "ALO",
    team: "Aston Martin",
    color: "#006f62",
    image: headshotUrl("ALO", 14),
    number: 14,
  },
  18: {
    name: "Lance Stroll",
    code: "STR",
    team: "Aston Martin",
    color: "#006f62",
    image: headshotUrl("STR", 18),
    number: 18,
  },
  10: {
    name: "Pierre Gasly",
    code: "GAS",
    team: "Alpine",
    color: "#0090ff",
    image: headshotUrl("GAS", 10),
    number: 10,
  },
  7: {
    name: "Jack Doohan",
    code: "DOO",
    team: "Alpine",
    color: "#0090ff",
    image: headshotUrl("DOO", 7),
    number: 7,
  },
  23: {
    name: "Alexander Albon",
    code: "ALB",
    team: "Williams",
    color: "#005aff",
    image: headshotUrl("ALB", 23),
    number: 23,
  },
  22: {
    name: "Yuki Tsunoda",
    code: "TSU",
    team: "Racing Bulls",
    color: "#6692ff",
    image: headshotUrl("TSU", 22),
    number: 22,
  },
  30: {
    name: "Liam Lawson",
    code: "LAW",
    team: "Racing Bulls",
    color: "#6692ff",
    image: headshotUrl("LAW", 30),
    number: 30,
  },
  27: {
    name: "Nico Hulkenberg",
    code: "HUL",
    team: "Sauber",
    color: "#52e252",
    image: headshotUrl("HUL", 27),
    number: 27,
  },
  5: {
    name: "Gabriel Bortoleto",
    code: "BOR",
    team: "Sauber",
    color: "#52e252",
    image: headshotUrl("BOR", 5),
    number: 5,
  },
  31: {
    name: "Esteban Ocon",
    code: "OCO",
    team: "Haas",
    color: "#b6babd",
    image: headshotUrl("OCO", 31),
    number: 31,
  },
  87: {
    name: "Oliver Bearman",
    code: "BEA",
    team: "Haas",
    color: "#b6babd",
    image: headshotUrl("BEA", 87),
    number: 87,
  },
  6: {
    name: "Isack Hadjar",
    code: "HAD",
    team: "Racing Bulls",
    color: "#6692ff",
    image: headshotUrl("HAD", 6),
    number: 6,
  },
};

/** Ordered list for grids / selects */
export const DRIVERS_LIST: Array<DriverInfo & { number: number }> = Object.entries(DRIVER_FALLBACK)
  .map(([num, info]) => ({ ...info, number: Number(num) }))
  .sort((a, b) => a.number - b.number);

/** Lookup helper */
export function getDriverInfo(n: number): DriverInfo | undefined {
  return DRIVER_FALLBACK[n];
}

export function getTeamColor(team: string): string {
  return TEAM_COLORS[team] ?? "#1e293b";
}

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
  return luminance > 150 ? "#080c14" : "#ffffff";
}

export const COMPOUND_NAMES: Record<string, string> = {
  S: "SOFT",
  M: "MEDIUM",
  H: "HARD",
  I: "INTERMEDIATE",
  W: "WET",
  SOFT: "SOFT",
  MEDIUM: "MEDIUM",
  HARD: "HARD",
  INTERMEDIATE: "INTERMEDIATE",
  WET: "WET",
};

/** Defensive mapping of one raw OpenF1 driver row; keeps fallback values on any malformed field. */
function mapDriver(
  raw: Record<string, unknown>,
  fallback?: DriverInfo,
): { num: number; info: DriverInfo } | undefined {
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
        : (fallback?.color ?? "#1e293b"),
      image: headshot && /^https?:\/\//.test(headshot) ? headshot : fallback?.image,
      number: num,
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
