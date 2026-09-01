"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export type DriverDot = {
  driverNumber: number;
  code: string;
  color: string;
  progress: number;
};

export type CircuitMeta = {
  id: string;
  name: string;
  country: string;
  lengthKm: string;
  turns: number;
  drsZones: number;
  path: string;
  viewBox: string;
  turnMarkers: { n: number; x: number; y: number }[];
  speedTraps: { x: number; y: number; label: string }[];
  drsSegments: { x1: number; y1: number; x2: number; y2: number; label: string }[];
  sectorSplits: number[];
};

type Flag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";

export const CIRCUITS: CircuitMeta[] = [
  {
    id: "bahrain",
    name: "Bahrain",
    country: "Sakhir",
    lengthKm: "5.412",
    turns: 15,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 90 300 L 300 300 Q 350 300 380 270 L 430 220 Q 470 180 530 210 L 620 270 Q 680 310 700 360 L 700 410 Q 700 450 640 460 L 500 470 Q 420 470 380 430 L 280 350 Q 240 320 190 330 L 90 350 Z",
    turnMarkers: [
      { n: 1, x: 310, y: 285 }, { n: 2, x: 365, y: 255 }, { n: 4, x: 470, y: 185 }, { n: 8, x: 680, y: 300 },
      { n: 10, x: 700, y: 430 }, { n: 11, x: 580, y: 465 }, { n: 13, x: 360, y: 415 }, { n: 14, x: 210, y: 310 },
    ],
    speedTraps: [{ x: 690, y: 395, label: "ST 312 km/h" }, { x: 310, y: 330, label: "ST" }],
    drsSegments: [
      { x1: 95, y1: 315, x2: 295, y2: 315, label: "DRS" },
      { x1: 540, y1: 435, x2: 695, y2: 435, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "monaco",
    name: "Monaco",
    country: "Monte Carlo",
    lengthKm: "3.337",
    turns: 19,
    drsZones: 1,
    viewBox: "0 0 800 500",
    path: "M 90 280 Q 120 200 240 190 L 520 185 Q 640 185 680 250 L 680 360 Q 680 440 590 445 L 380 450 Q 300 450 250 410 L 200 340 Q 170 310 120 310 L 90 310 Z",
    turnMarkers: [
      { n: 1, x: 160, y: 260 }, { n: 3, x: 340, y: 175 }, { n: 6, x: 640, y: 210 }, { n: 10, x: 640, y: 400 },
      { n: 11, x: 480, y: 445 }, { n: 16, x: 260, y: 395 },
    ],
    speedTraps: [{ x: 500, y: 210, label: "ST 285 km/h" }],
    drsSegments: [{ x1: 140, y1: 295, x2: 260, y2: 295, label: "DRS" }],
    sectorSplits: [0.35, 0.68],
  },
  {
    id: "spa",
    name: "Spa-Francorchamps",
    country: "Belgium",
    lengthKm: "7.004",
    turns: 19,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 80 400 L 220 400 Q 260 400 280 360 L 320 280 Q 360 200 420 200 L 520 200 Q 620 200 680 280 L 720 360 Q 740 420 680 450 L 560 470 Q 480 470 440 420 L 380 340 Q 340 300 280 310 L 80 360 Z",
    turnMarkers: [
      { n: 1, x: 150, y: 385 }, { n: 3, x: 285, y: 335 }, { n: 5, x: 380, y: 210 }, { n: 9, x: 620, y: 230 },
      { n: 12, x: 700, y: 390 }, { n: 15, x: 540, y: 455 }, { n: 19, x: 180, y: 340 },
    ],
    speedTraps: [{ x: 650, y: 320, label: "ST 334 km/h" }, { x: 240, y: 385, label: "ST" }],
    drsSegments: [
      { x1: 90, y1: 380, x2: 220, y2: 380, label: "DRS" },
      { x1: 520, y1: 220, x2: 640, y2: 260, label: "X-MODE" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "monza",
    name: "Monza",
    country: "Italy",
    lengthKm: "5.793",
    turns: 11,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 60 350 L 260 350 Q 320 350 340 300 L 380 200 Q 410 130 480 120 L 620 110 Q 700 110 720 180 L 730 350 Q 730 440 650 460 L 480 470 Q 380 470 320 420 L 180 340 Q 120 310 60 350 Z",
    turnMarkers: [
      { n: 1, x: 285, y: 335 }, { n: 4, x: 395, y: 175 }, { n: 6, x: 640, y: 135 }, { n: 8, x: 715, y: 300 },
      { n: 11, x: 420, y: 455 },
    ],
    speedTraps: [{ x: 680, y: 150, label: "ST 352 km/h" }],
    drsSegments: [
      { x1: 70, y1: 330, x2: 250, y2: 330, label: "DRS" },
      { x1: 530, y1: 130, x2: 670, y2: 140, label: "X-MODE" },
    ],
    sectorSplits: [0.35, 0.7],
  },
  {
    id: "silverstone",
    name: "Silverstone",
    country: "Great Britain",
    lengthKm: "5.891",
    turns: 18,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 70 260 L 220 260 Q 300 260 330 220 L 380 120 Q 420 60 500 80 L 650 140 Q 730 200 720 300 L 700 400 Q 680 460 580 460 L 400 460 Q 320 460 260 400 L 180 300 Q 130 260 70 260 Z",
    turnMarkers: [
      { n: 1, x: 180, y: 240 }, { n: 3, x: 340, y: 170 }, { n: 7, x: 580, y: 90 }, { n: 10, x: 700, y: 260 },
      { n: 13, x: 640, y: 430 }, { n: 16, x: 360, y: 445 },
    ],
    speedTraps: [{ x: 600, y: 120, label: "ST 325 km/h" }],
    drsSegments: [
      { x1: 80, y1: 240, x2: 210, y2: 240, label: "DRS" },
      { x1: 560, y1: 430, x2: 690, y2: 430, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "baku",
    name: "Baku",
    country: "Azerbaijan",
    lengthKm: "6.003",
    turns: 20,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 60 120 L 680 120 Q 730 120 730 170 L 730 350 Q 730 400 690 430 L 450 470 Q 380 470 340 430 L 280 340 Q 250 290 180 290 L 60 290 Q 20 290 20 240 L 20 170 Q 20 120 60 120 Z",
    turnMarkers: [
      { n: 1, x: 140, y: 110 }, { n: 3, x: 620, y: 110 }, { n: 8, x: 720, y: 280 }, { n: 16, x: 450, y: 455 },
      { n: 18, x: 300, y: 350 }, { n: 20, x: 80, y: 270 },
    ],
    speedTraps: [{ x: 670, y: 150, label: "ST 350 km/h" }],
    drsSegments: [
      { x1: 70, y1: 135, x2: 660, y2: 135, label: "X-MODE 2.2 km" },
      { x1: 80, y1: 275, x2: 240, y2: 275, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "miami",
    name: "Miami",
    country: "USA",
    lengthKm: "5.412",
    turns: 19,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 80 400 L 200 400 Q 260 400 290 340 L 340 240 Q 380 160 460 150 L 620 140 Q 700 140 720 200 L 730 340 Q 730 410 660 440 L 520 470 Q 420 470 360 420 L 240 340 Q 180 310 100 340 L 80 380 Z",
    turnMarkers: [
      { n: 1, x: 140, y: 385 }, { n: 7, x: 350, y: 200 }, { n: 11, x: 660, y: 160 }, { n: 14, x: 715, y: 320 },
      { n: 17, x: 520, y: 455 },
    ],
    speedTraps: [{ x: 620, y: 170, label: "ST 320 km/h" }],
    drsSegments: [
      { x1: 90, y1: 380, x2: 200, y2: 380, label: "DRS" },
      { x1: 520, y1: 155, x2: 640, y2: 155, label: "DRS" },
    ],
    sectorSplits: [0.34, 0.67],
  },
  {
    id: "singapore",
    name: "Singapore",
    country: "Marina Bay",
    lengthKm: "4.940",
    turns: 19,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 80 330 L 250 330 Q 320 330 340 270 L 380 160 Q 420 80 500 90 L 640 110 Q 720 140 720 220 L 720 380 Q 720 440 650 460 L 400 470 Q 320 470 280 410 L 220 340 Q 180 310 100 310 L 80 310 Z",
    turnMarkers: [
      { n: 1, x: 180, y: 315 }, { n: 5, x: 360, y: 190 }, { n: 10, x: 640, y: 130 }, { n: 14, x: 700, y: 350 },
      { n: 18, x: 400, y: 455 },
    ],
    speedTraps: [{ x: 600, y: 130, label: "ST 304 km/h" }],
    drsSegments: [
      { x1: 90, y1: 315, x2: 240, y2: 315, label: "DRS" },
      { x1: 540, y1: 110, x2: 640, y2: 130, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "austria",
    name: "Red Bull Ring",
    country: "Austria",
    lengthKm: "4.318",
    turns: 10,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 80 400 L 320 400 Q 380 400 400 340 L 440 200 Q 470 120 540 100 L 640 80 Q 710 70 730 140 L 730 340 Q 730 420 660 450 L 480 470 Q 380 470 300 400 L 180 340 Q 120 310 80 360 Z",
    turnMarkers: [
      { n: 1, x: 210, y: 385 }, { n: 3, x: 410, y: 280 }, { n: 6, x: 590, y: 85 }, { n: 8, x: 720, y: 270 },
      { n: 10, x: 500, y: 455 },
    ],
    speedTraps: [{ x: 610, y: 110, label: "ST 325 km/h" }],
    drsSegments: [
      { x1: 90, y1: 380, x2: 310, y2: 380, label: "DRS" },
      { x1: 540, y1: 95, x2: 660, y2: 105, label: "X-MODE" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "barcelona",
    name: "Barcelona",
    country: "Catalunya",
    lengthKm: "4.657",
    turns: 14,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 60 340 L 240 340 Q 300 340 330 290 L 380 190 Q 420 110 500 110 L 620 120 Q 700 130 720 200 L 730 360 Q 730 440 650 460 L 460 470 Q 360 470 300 420 L 180 340 Q 120 310 60 340 Z",
    turnMarkers: [
      { n: 1, x: 160, y: 325 }, { n: 3, x: 340, y: 240 }, { n: 5, x: 480, y: 105 }, { n: 10, x: 700, y: 220 },
      { n: 12, x: 580, y: 445 },
    ],
    speedTraps: [{ x: 680, y: 170, label: "ST 315 km/h" }],
    drsSegments: [
      { x1: 70, y1: 325, x2: 240, y2: 325, label: "DRS" },
      { x1: 500, y1: 125, x2: 620, y2: 135, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "suzuka",
    name: "Suzuka",
    country: "Japan",
    lengthKm: "5.807",
    turns: 18,
    drsZones: 1,
    viewBox: "0 0 800 500",
    path: "M 120 400 L 260 400 Q 340 400 370 320 L 420 200 Q 480 80 580 80 L 660 80 Q 720 80 730 150 L 710 350 Q 690 440 600 460 L 420 470 Q 320 470 280 390 L 220 300 Q 180 250 120 280 L 80 320 Q 60 350 120 400 Z",
    turnMarkers: [
      { n: 1, x: 190, y: 385 }, { n: 5, x: 400, y: 180 }, { n: 9, x: 620, y: 75 }, { n: 13, x: 700, y: 300 },
      { n: 16, x: 520, y: 455 },
    ],
    speedTraps: [{ x: 620, y: 110, label: "ST 312 km/h" }],
    drsSegments: [{ x1: 130, y1: 380, x2: 260, y2: 380, label: "DRS" }],
    sectorSplits: [0.34, 0.67],
  },
  {
    id: "zandvoort",
    name: "Zandvoort",
    country: "Netherlands",
    lengthKm: "4.259",
    turns: 14,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 80 320 L 240 320 Q 300 320 330 260 L 380 140 Q 420 60 500 50 L 640 50 Q 720 60 730 130 L 730 350 Q 730 430 650 460 L 440 470 Q 340 470 280 410 L 180 320 Q 130 290 80 320 Z",
    turnMarkers: [
      { n: 1, x: 160, y: 305 }, { n: 3, x: 340, y: 210 }, { n: 7, x: 580, y: 45 }, { n: 11, x: 720, y: 280 },
      { n: 14, x: 480, y: 455 },
    ],
    speedTraps: [{ x: 580, y: 70, label: "ST 315 km/h" }],
    drsSegments: [
      { x1: 90, y1: 300, x2: 240, y2: 300, label: "DRS" },
      { x1: 520, y1: 60, x2: 640, y2: 70, label: "X-MODE" },
    ],
    sectorSplits: [0.32, 0.64],
  },
  {
    id: "interlagos",
    name: "Interlagos",
    country: "Brazil",
    lengthKm: "4.309",
    turns: 15,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 80 280 L 240 280 Q 300 280 340 210 L 420 80 Q 480 20 580 40 L 700 100 Q 740 150 730 230 L 700 400 Q 680 460 590 470 L 400 470 Q 320 470 270 410 L 200 330 Q 150 280 80 280 Z",
    turnMarkers: [
      { n: 1, x: 160, y: 265 }, { n: 4, x: 360, y: 150 }, { n: 8, x: 640, y: 60 }, { n: 11, x: 715, y: 300 },
      { n: 13, x: 560, y: 455 },
    ],
    speedTraps: [{ x: 640, y: 80, label: "ST 318 km/h" }],
    drsSegments: [
      { x1: 90, y1: 260, x2: 230, y2: 260, label: "DRS" },
      { x1: 560, y1: 55, x2: 680, y2: 95, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "cota",
    name: "COTA",
    country: "Austin",
    lengthKm: "5.513",
    turns: 20,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 80 350 L 220 350 Q 280 350 300 290 L 340 180 Q 380 80 460 80 L 560 90 Q 650 110 680 180 L 700 340 Q 700 430 620 460 L 440 470 Q 340 470 280 410 L 180 320 Q 130 290 80 330 Z",
    turnMarkers: [
      { n: 1, x: 150, y: 335 }, { n: 7, x: 370, y: 120 }, { n: 11, x: 630, y: 135 }, { n: 15, x: 690, y: 380 },
      { n: 19, x: 420, y: 455 },
    ],
    speedTraps: [{ x: 620, y: 140, label: "ST 330 km/h" }],
    drsSegments: [
      { x1: 90, y1: 330, x2: 220, y2: 330, label: "DRS" },
      { x1: 520, y1: 105, x2: 650, y2: 135, label: "X-MODE" },
    ],
    sectorSplits: [0.34, 0.66],
  },
  {
    id: "lasvegas",
    name: "Las Vegas",
    country: "USA",
    lengthKm: "6.201",
    turns: 17,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 60 400 L 200 400 Q 260 400 280 340 L 320 140 Q 340 60 400 60 L 700 60 Q 740 60 740 110 L 740 380 Q 740 430 680 450 L 420 470 Q 340 470 300 420 L 220 340 Q 180 310 80 340 L 60 360 Z",
    turnMarkers: [
      { n: 1, x: 130, y: 385 }, { n: 5, x: 310, y: 200 }, { n: 9, x: 540, y: 55 }, { n: 12, x: 730, y: 180 },
      { n: 14, x: 730, y: 400 }, { n: 17, x: 380, y: 455 },
    ],
    speedTraps: [{ x: 640, y: 80, label: "ST 350 km/h" }],
    drsSegments: [
      { x1: 340, y1: 90, x2: 700, y2: 90, label: "X-MODE 1.9 km" },
      { x1: 70, y1: 380, x2: 200, y2: 380, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "yasmarina",
    name: "Yas Marina",
    country: "Abu Dhabi",
    lengthKm: "5.281",
    turns: 16,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 60 260 L 240 260 Q 320 260 350 200 L 420 110 Q 480 60 560 80 L 680 130 Q 730 180 730 260 L 730 380 Q 730 440 660 460 L 440 470 Q 320 470 260 410 L 180 300 Q 130 250 60 260 Z",
    turnMarkers: [
      { n: 1, x: 150, y: 245 }, { n: 5, x: 370, y: 160 }, { n: 9, x: 640, y: 110 }, { n: 13, x: 715, y: 340 },
      { n: 16, x: 520, y: 455 },
    ],
    speedTraps: [{ x: 620, y: 130, label: "ST 322 km/h" }],
    drsSegments: [
      { x1: 70, y1: 240, x2: 230, y2: 240, label: "DRS" },
      { x1: 520, y1: 95, x2: 660, y2: 120, label: "DRS" },
    ],
    sectorSplits: [0.33, 0.66],
  },
];

const FALLBACK_DRIVERS: DriverDot[] = [
  { driverNumber: 1, code: "VER", color: "#3671C6", progress: 0.12 },
  { driverNumber: 4, code: "NOR", color: "#FF8000", progress: 0.11 },
  { driverNumber: 16, code: "LEC", color: "#E8002D", progress: 0.085 },
  { driverNumber: 63, code: "RUS", color: "#27F4D2", progress: 0.06 },
  { driverNumber: 44, code: "HAM", color: "#E8002D", progress: 0.045 },
  { driverNumber: 81, code: "PIA", color: "#FF8000", progress: 0.02 },
];

export function CircuitMap({
  circuitId,
  drivers,
  lap,
  flag = "GREEN",
}: {
  circuitId?: string;
  drivers?: DriverDot[];
  lap?: number;
  flag?: Flag;
}) {
  const [selected, setSelected] = useState<string>(circuitId ?? "barcelona");
  const activeId = circuitId ?? selected;
  const circuit = useMemo(
    () => CIRCUITS.find((c) => c.id === activeId) ?? CIRCUITS.find((c) => c.id === "barcelona")!,
    [activeId]
  );

  const pathRef = useRef<SVGPathElement | null>(null);
  const [mockProgress, setMockProgress] = useState<DriverDot[]>(FALLBACK_DRIVERS);
  useEffect(() => {
    if (drivers && drivers.length) return;
    const iv = setInterval(
      () =>
        setMockProgress((prev) =>
          prev.map((d, i) => ({
            ...d,
            progress: (d.progress + 0.004 + i * 0.0002) % 1,
          }))
        ),
      90
    );
    return () => clearInterval(iv);
  }, [drivers]);

  const dots = drivers && drivers.length ? drivers : mockProgress;

  const [dotPos, setDotPos] = useState<{ x: number; y: number; d: DriverDot }[]>([]);
  useEffect(() => {
    const el = pathRef.current;
    if (!el) return;
    try {
      const len = el.getTotalLength();
      const pts = dots.map((d) => {
        const p = el.getPointAtLength(((d.progress % 1) + 1) % 1 * len);
        return { x: p.x, y: p.y, d };
      });
      setDotPos(pts);
    } catch {
      const fallback = dots.map((d, i) => ({
        x: 400 + Math.cos(d.progress * Math.PI * 2 + i) * 140,
        y: 250 + Math.sin(d.progress * Math.PI * 2 + i) * 90,
        d,
      }));
      setDotPos(fallback);
    }
  }, [dots.map((d) => d.progress).join(","), circuit.id]);

  const displayDots = dotPos.length
    ? dotPos
    : dots.map((d, i) => ({
        x: 400 + Math.cos(d.progress * Math.PI * 2 + i) * 140,
        y: 250 + Math.sin(d.progress * Math.PI * 2 + i) * 90,
        d,
      }));

  const flagStyles: Record<Flag, { bg: string; text: string; glow: string; label: string }> = {
    GREEN: { bg: "bg-[#052e1a] border-[#00d084]/30", text: "text-[#22c55e]", glow: "shadow-[0_0_22px_rgba(34,197,94,0.35)]", label: "GREEN — RACING" },
    YELLOW: { bg: "bg-[#3a2d00] border-[#eab308]/40", text: "text-[#facc15]", glow: "shadow-[0_0_22px_rgba(234,179,8,0.4)]", label: "YELLOW — CAUTION" },
    SC: { bg: "bg-[#3a1a00] border-[#ff8000]/40", text: "text-[#ff8000]", glow: "shadow-[0_0_22px_rgba(255,128,0,0.45)]", label: "SAFETY CAR" },
    VSC: { bg: "bg-[#1e2a00] border-[#84cc16]/40", text: "text-[#a3e635]", glow: "shadow-[0_0_22px_rgba(132,204,22,0.35)]", label: "VIRTUAL SAFETY CAR" },
    RED: { bg: "bg-[#3a0a0a] border-[#ef4444]/50", text: "text-[#f87171]", glow: "shadow-[0_0_22px_rgba(239,68,68,0.5)]", label: "RED FLAG" },
  };
  const flagCfg = flagStyles[flag] ?? flagStyles.GREEN;

  return (
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#1e293b] bg-[#080c14]">
        <div className="flex items-center gap-3">
          <div className="w-2 h-2 rounded-full bg-[#00d2be] animate-pulse" />
          <h3 className="font-black tracking-tight text-sm">CIRCUIT MAP</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#64748b]">VECTOR SPLINE • ANIMATED DOTS</span>
          {typeof lap === "number" && (
            <span className="ml-2 text-[11px] font-mono px-2 py-1 rounded bg-[#1e293b] border border-[#334155] text-[#94a3b8]">
              LAP {lap}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!circuitId && (
            <select
              value={activeId}
              onChange={(e) => setSelected(e.target.value)}
              className="bg-[#0f172a] border border-[#1e293b] rounded px-2 py-1.5 text-xs font-mono text-[#cbd5e1] focus:outline-none focus:border-[#00d2be]/40"
              aria-label="Select circuit"
            >
              {CIRCUITS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} • {c.country}
                </option>
              ))}
            </select>
          )}
          <span
            className={`hidden md:inline-flex items-center gap-1.5 text-[10px] font-bold tracking-widest px-2.5 py-1 rounded-full border ${flagCfg.bg} ${flagCfg.text} ${flagCfg.glow} ${flag === "YELLOW" || flag === "RED" ? "animate-pulse" : ""}`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${flag === "GREEN" ? "bg-[#22c55e]" : flag === "YELLOW" ? "bg-[#eab308]" : flag === "SC" ? "bg-[#ff8000]" : flag === "VSC" ? "bg-[#a3e635]" : "bg-[#ef4444]"} ${flag !== "GREEN" ? "animate-ping" : "animate-pulse"}`}
            />
            {flagCfg.label}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-3 divide-x divide-[#1e293b] border-b border-[#1e293b] bg-[#0f172a]">
        <div className="px-4 py-2">
          <div className="text-[10px] tracking-widest text-[#64748b]">CIRCUIT</div>
          <div className="text-sm font-black">{circuit.name}</div>
          <div className="text-[11px] text-[#94a3b8]">
            {circuit.country} • {circuit.lengthKm} km
          </div>
        </div>
        <div className="px-4 py-2 text-center">
          <div className="text-[10px] tracking-widest text-[#64748b]">TURNS / DRS</div>
          <div className="font-mono font-bold text-sm mt-1">
            {circuit.turns} turns • {circuit.drsZones} zones
          </div>
          <div className="text-[10px] text-[#00d2be] mt-0.5">S1 / S2 / S3 • X-Mode</div>
        </div>
        <div className="px-4 py-2 text-right">
          <div className="text-[10px] tracking-widest text-[#64748b]">SURFACE</div>
          <div className="text-xs font-mono text-[#cbd5e1]">Track 38.4°C • Air 26.1°C</div>
          <div className="text-[10px] text-[#f59e0b]">High deg • 2-stop</div>
        </div>
      </div>

      <div className="relative bg-[#080c14] p-2 sm:p-4">
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage: "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
        <svg viewBox={circuit.viewBox} className="relative w-full h-[280px] sm:h-[360px]" role="img" aria-label={`${circuit.name} circuit map`} key={circuit.id}>
          <path d={circuit.path} fill="none" stroke="#020617" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          <path ref={pathRef} d={circuit.path} fill="none" stroke="#1e293b" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
          <path d={circuit.path} fill="none" stroke="#334155" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
          <path d={circuit.path} fill="none" stroke="#0f172a" strokeWidth={1} strokeDasharray="8 12" opacity={0.35} />

          {circuit.drsSegments.map((s, i) => (
            <g key={`drs-${i}`}>
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#00d2be" strokeWidth={6} strokeLinecap="round" opacity={0.95} />
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#0f172a" strokeWidth={1.2} strokeDasharray="6 8" opacity={0.9} />
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#22d3ee" strokeWidth={2} strokeDasharray="12 20" opacity={0.6} className="animate-[dash_1.1s_linear_infinite]" />
              <text x={(s.x1 + s.x2) / 2} y={s.y1 - 10} textAnchor="middle" fontSize={9} fontWeight={900} fill="#00d2be" letterSpacing={1.2} className="select-none">
                {s.label}
              </text>
            </g>
          ))}

          {circuit.sectorSplits.map((frac, i) => {
            const cx = 180 + frac * 440;
            const cy = 500 * 0.45;
            return (
              <g key={`sector-${i}`}>
                <line x1={cx} y1={cy - 14} x2={cx} y2={cy + 14} stroke="#eab308" strokeWidth={2.5} strokeLinecap="round" opacity={0.9} />
                <rect x={cx - 16} y={cy - 26} width={32} height={12} rx={6} fill="#eab308" opacity={0.95} />
                <text x={cx} y={cy - 17} textAnchor="middle" fontSize={7} fontWeight={900} fill="#0f172a">
                  S{i + 1}
                </text>
              </g>
            );
          })}
          <rect x={90} y={465} width={36} height={14} rx={7} fill="#eab308" />
          <text x={108} y={475} textAnchor="middle" fontSize={7} fontWeight={900} fill="#0f172a">
            S3
          </text>

          <g>
            <line x1={90} y1={305} x2={90} y2={355} stroke="#fff" strokeWidth={3} />
            <rect x={90} y={305} width={6} height={6} fill="#fff" />
            <rect x={96} y={311} width={6} height={6} fill="#0f172a" />
            <rect x={90} y={317} width={6} height={6} fill="#0f172a" />
            <rect x={96} y={323} width={6} height={6} fill="#fff" />
            <text x={76} y={300} fontSize={7} fontWeight={800} fill="#94a3b8" textAnchor="middle">
              S/F
            </text>
          </g>

          {circuit.turnMarkers.map((t) => (
            <g key={`t-${t.n}`}>
              <circle cx={t.x} cy={t.y} r={11} fill="#0f172a" stroke="#334155" strokeWidth={1.2} />
              <text x={t.x} y={t.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={900} fill="#e2e8f0">
                {t.n}
              </text>
            </g>
          ))}

          {circuit.speedTraps.map((s, i) => (
            <g key={`trap-${i}`}>
              <g transform={`translate(${s.x},${s.y}) rotate(45)`}>
                <rect x={-8} y={-8} width={16} height={16} fill="#ff8000" stroke="#ffedd5" strokeWidth={1.2} rx={2} />
                <g transform="rotate(-45)">
                  <text x={0} y={2.5} textAnchor="middle" fontSize={5} fontWeight={900} fill="white">
                    ◈
                  </text>
                </g>
              </g>
              <text x={s.x} y={s.y - 14} textAnchor="middle" fontSize={7} fontWeight={700} fill="#ff8000">
                {s.label}
              </text>
            </g>
          ))}

          {displayDots.map(({ x, y, d }) => (
            <g key={`dot-${d.driverNumber}`} style={{ transition: "all 420ms ease-out" }}>
              <circle cx={x} cy={y} r={18} fill={d.color} opacity={0.18} className="animate-pulse" />
              <circle cx={x} cy={y} r={13} fill={d.color} opacity={0.32} />
              <circle cx={x} cy={y} r={9} fill="#020617" stroke={d.color} strokeWidth={2} />
              <text x={x} y={y + 3.2} textAnchor="middle" fontSize={7} fontWeight={900} fill="white">
                {d.driverNumber}
              </text>
              <g transform={`translate(${x},${y - 16})`}>
                <rect x={-14} y={-7} width={28} height={11} rx={5} fill="#0f172a" stroke={d.color} strokeWidth={1} opacity={0.95} />
                <text x={0} y={1} textAnchor="middle" fontSize={6} fontWeight={900} fill={d.color}>
                  {d.code}
                </text>
              </g>
            </g>
          ))}

          <g transform="translate(740,40)">
            <circle cx={0} cy={0} r={16} fill="#0f172a" stroke="#334155" strokeWidth={1} />
            <path d="M 0 -10 L 4 4 L 0 0 L -4 4 Z" fill="#e2e8f0" />
            <text x={0} y={26} textAnchor="middle" fontSize={7} fontWeight={700} fill="#64748b">
              N
            </text>
          </g>
        </svg>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px]">
          <div className="flex flex-wrap items-center gap-3 text-[#94a3b8]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-5 h-1 rounded bg-[#00d2be]" />
              DRS / X-Mode
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded bg-[#eab308]" />
              Sector
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rotate-45 bg-[#ff8000] border border-[#ffedd5] inline-block" />
              Speed trap
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full border border-[#334155] bg-[#0f172a] inline-flex items-center justify-center text-[7px]">3</span>
              Turn
            </span>
          </div>
          <span className="font-mono text-[#475569] hidden sm:inline">interpolated via getPointAtLength • progress 0→1</span>
        </div>
      </div>

      <div
        className={`px-4 py-2 flex items-center justify-between border-t border-[#1e293b] text-[11px] ${flag === "GREEN" ? "bg-[#052e1a]/40" : flag === "YELLOW" ? "bg-[#422006]/50" : flag === "SC" ? "bg-[#4a1f00]/60" : flag === "RED" ? "bg-[#450a0a]/70" : "bg-[#1a2e05]/50"}`}
      >
        <span className={`inline-flex items-center gap-2 font-black tracking-widest ${flagCfg.text} ${flag === "YELLOW" || flag === "SC" || flag === "RED" ? "animate-pulse" : ""}`}>
          <span
            className={`w-2 h-2 rounded-full ${flag === "GREEN" ? "bg-[#22c55e] shadow-[0_0_10px_rgba(34,197,94,0.7)]" : flag === "YELLOW" ? "bg-[#eab308] shadow-[0_0_10px_rgba(234,179,8,0.8)]" : flag === "SC" ? "bg-[#ff8000] shadow-[0_0_10px_rgba(255,128,0,0.8)]" : flag === "RED" ? "bg-[#ef4444] shadow-[0_0_10px_rgba(239,68,68,0.9)]" : "bg-[#a3e635]"}`}
          />
          TRACK: {flagCfg.label}
          <span className="hidden sm:inline font-normal opacity-70">
            — {circuit.name}{" "}
            {flag === "GREEN"
              ? "is green — push is allowed"
              : flag === "YELLOW"
                ? "— lift & coast, no overtake"
                : flag === "SC"
                  ? "— safety car deployed"
                  : flag === "VSC"
                    ? "— VSC, delta positive"
                    : "— session stopped"}
          </span>
        </span>
        <span className="font-mono text-[#64748b] hidden sm:inline">
          {circuit.lengthKm} km • {circuit.turns} turns • {circuit.drsZones} DRS zones
        </span>
      </div>

      <style>{`@keyframes dash { to { stroke-dashoffset: -32; } }`}</style>
    </div>
  );
}

export default CircuitMap;
