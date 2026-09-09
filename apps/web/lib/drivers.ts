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

/** Team colour registry : canonical 2025/2026 liveries */
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
  // High-resolution Formula1 CDN media headshots with OpenF1 fallback
  const SLUGS: Record<number, string> = {
    1: "M/MAXVER01_Max_Verstappen/maxver01.png",
    4: "L/LANNOR01_Lando_Norris/lannor01.png",
    16: "C/CHALEC01_Charles_Leclerc/chalec01.png",
    44: "L/LEWHAM01_Lewis_Hamilton/lewham01.png",
    63: "G/GEORUS01_George_Russell/georus01.png",
    81: "O/OSCPIA01_Oscar_Piastri/oscpia01.png",
    55: "C/CARSAI01_Carlos_Sainz/carsai01.png",
    14: "F/FERALO01_Fernando_Alonso/feralo01.png",
    18: "L/LANSTR01_Lance_Stroll/lanstr01.png",
    10: "P/PIEGAS01_Pierre_Gasly/piegas01.png",
    23: "A/ALEALB01_Alexander_Albon/alealb01.png",
    22: "Y/YUKTSU01_Yuki_Tsunoda/yuktsu01.png",
    27: "N/NICHUL01_Nico_Hulkenberg/nichul01.png",
    31: "E/ESTOCO01_Esteban_Ocon/estoco01.png",
    12: "K/KIMANT01_Kimi_Antonelli/kimant01.png",
    87: "O/OLIBEA01_Oliver_Bearman/olibea01.png",
    30: "L/LIALAW01_Liam_Lawson/lialaw01.png",
    7: "J/JACDOO01_Jack_Doohan/jacdoo01.png",
    5: "G/GABBOR01_Gabriel_Bortoleto/gabbor01.png",
    6: "I/ISAHAD01_Isack_Hadjar/isahad01.png",
  };
  const slug = SLUGS[num];
  if (slug) {
    return `https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/${slug}`;
  }
  return `https://cdn.openf1.org/drivers/${num}/headshot.png`;
}

/** Complete 2025/2026 grid : 20 drivers as specified in plan 1.2 */
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
 * Live driver identities keyed strictly by canonical driver number.
 * Starts from DRIVER_FALLBACK so the leaderboard always renders.
 * Protects against test session artifacts where multiple drivers drive the same car number
 * or test cars swap numbers (e.g. Norris in car 1 during 2026 tests).
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
        const seenCodes = new Set<string>();

        for (const f of Object.values(DRIVER_FALLBACK)) {
          seenCodes.add(f.code);
        }

        for (const row of rows) {
          if (row === null || typeof row !== "object") continue;
          const raw = row as Record<string, unknown>;
          const rawNum = typeof raw.driver_number === "string" ? Number(raw.driver_number) : Number(raw.driver_number);
          const rawCode = str(raw.name_acronym);
          const rawName = str(raw.full_name);

          const canonical = Object.values(DRIVER_FALLBACK).find(
            (d) => (rawCode && d.code === rawCode) || (rawName && d.name.toLowerCase() === rawName.toLowerCase())
          );

          if (canonical) {
            const targetNum = canonical.number ?? Number(rawNum);
            const fallback = DRIVER_FALLBACK[targetNum];
            const mapped = mapDriver(raw, fallback);
            if (mapped) {
              merged[targetNum] = {
                ...mapped.info,
                number: targetNum,
                code: canonical.code,
                name: canonical.name,
              };
            }
          } else if (Number.isFinite(rawNum) && !DRIVER_FALLBACK[rawNum]) {
            const mapped = mapDriver(raw);
            if (mapped && !seenCodes.has(mapped.info.code)) {
              merged[mapped.num] = mapped.info;
              seenCodes.add(mapped.info.code);
            }
          }
        }
        setDrivers(merged);
      })
      .catch(() => {
        // offline or blocked: keep canonical fallback identities
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return drivers;
}
