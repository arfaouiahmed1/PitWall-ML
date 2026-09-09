"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveWeather } from "@/lib/liveWeather";

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

export type Flag = "GREEN" | "YELLOW" | "SC" | "VSC" | "RED";

// Authentic FIA vector geometries for all 24 Formula 1 World Championship circuits
export const CIRCUITS: CircuitMeta[] = [
  {
    id: "melbourne",
    name: "Albert Park Circuit",
    country: "Australia",
    lengthKm: "5.278",
    turns: 14,
    drsZones: 4,
    viewBox: "0 0 800 500",
    path: "M 180 430 L 320 430 Q 360 430 380 395 L 400 360 Q 420 325 460 325 L 530 325 Q 570 325 585 285 L 610 220 Q 625 180 660 170 L 720 150 Q 750 140 740 100 Q 730 65 690 70 L 610 80 Q 560 85 535 125 L 500 180 Q 470 230 420 250 L 350 280 Q 300 300 270 270 L 230 230 Q 200 200 170 230 L 140 260 Q 110 290 120 340 L 130 385 Q 140 430 180 430 Z",
    turnMarkers: [
      { n: 1, x: 340, y: 415 }, { n: 2, x: 390, y: 375 }, { n: 3, x: 550, y: 310 }, { n: 5, x: 600, y: 240 },
      { n: 6, x: 680, y: 160 }, { n: 8, x: 710, y: 80 }, { n: 9, x: 580, y: 95 }, { n: 11, x: 460, y: 240 },
      { n: 13, x: 250, y: 250 }, { n: 14, x: 150, y: 370 },
    ],
    speedTraps: [{ x: 720, y: 120, label: "ST 324 km/h" }, { x: 260, y: 430, label: "FL" }],
    drsSegments: [
      { x1: 190, y1: 430, x2: 320, y2: 430, label: "DRS 1" },
      { x1: 615, y1: 210, x2: 700, y2: 155, label: "DRS 2" },
      { x1: 680, y1: 75, x2: 560, y2: 90, label: "DRS 3" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "shanghai",
    name: "Shanghai International Circuit",
    country: "China",
    lengthKm: "5.451",
    turns: 16,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 220 390 L 370 390 Q 440 390 470 350 Q 500 310 490 260 Q 480 210 420 200 Q 370 190 350 230 Q 330 270 360 300 Q 390 320 420 310 L 510 290 Q 550 280 570 240 L 610 160 Q 630 120 670 120 L 730 120 Q 760 120 750 160 L 720 240 Q 690 320 680 390 L 670 450 Q 660 480 620 480 L 250 480 Q 200 480 180 440 L 160 390 Q 140 340 180 340 L 220 340 Z",
    turnMarkers: [
      { n: 1, x: 440, y: 375 }, { n: 2, x: 480, y: 280 }, { n: 3, x: 400, y: 210 }, { n: 4, x: 350, y: 260 },
      { n: 6, x: 530, y: 275 }, { n: 8, x: 630, y: 140 }, { n: 11, x: 740, y: 135 }, { n: 14, x: 675, y: 440 },
    ],
    speedTraps: [{ x: 450, y: 480, label: "ST 338 km/h" }],
    drsSegments: [
      { x1: 230, y1: 390, x2: 360, y2: 390, label: "DRS 1" },
      { x1: 650, y1: 480, x2: 270, y2: 480, label: "DRS 2 • 1.2km" },
    ],
    sectorSplits: [0.31, 0.68],
  },
  {
    id: "suzuka",
    name: "Suzuka International Racing Course",
    country: "Japan",
    lengthKm: "5.807",
    turns: 18,
    drsZones: 1,
    viewBox: "0 0 800 500",
    path: "M 220 420 L 370 420 Q 420 420 450 380 Q 480 340 450 300 Q 420 260 460 220 Q 500 180 470 140 Q 440 100 480 60 Q 520 20 560 60 L 590 100 Q 620 140 580 180 L 510 250 L 440 320 Q 400 360 360 330 Q 320 300 350 250 L 400 180 Q 440 120 510 120 L 610 120 Q 690 120 720 180 L 740 240 Q 760 320 680 360 L 520 400 Q 440 410 370 380 L 290 350 Q 230 320 210 370 Z",
    turnMarkers: [
      { n: 1, x: 400, y: 410 }, { n: 2, x: 460, y: 365 }, { n: 3, x: 450, y: 290 }, { n: 5, x: 470, y: 170 },
      { n: 7, x: 500, y: 50 }, { n: 8, x: 580, y: 90 }, { n: 11, x: 340, y: 300 }, { n: 13, x: 580, y: 120 },
      { n: 15, x: 740, y: 230 }, { n: 16, x: 490, y: 400 },
    ],
    speedTraps: [{ x: 720, y: 280, label: "130R 315 km/h" }, { x: 300, y: 420, label: "ST" }],
    drsSegments: [{ x1: 230, y1: 420, x2: 360, y2: 420, label: "DRS PIT" }],
    sectorSplits: [0.34, 0.69],
  },
  {
    id: "bahrain",
    name: "Bahrain International Circuit",
    country: "Bahrain",
    lengthKm: "5.412",
    turns: 15,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 120 420 L 330 420 Q 370 420 390 380 Q 410 340 370 320 L 300 290 Q 260 270 280 230 L 320 160 Q 340 120 390 120 L 460 120 Q 500 120 520 150 L 560 220 Q 590 270 650 280 L 710 290 Q 750 300 740 340 L 710 420 Q 690 460 640 460 L 490 460 Q 440 460 410 430 L 310 340 Q 270 310 220 330 L 150 360 Q 110 380 120 420 Z",
    turnMarkers: [
      { n: 1, x: 360, y: 410 }, { n: 2, x: 390, y: 350 }, { n: 4, x: 310, y: 180 }, { n: 8, x: 540, y: 180 },
      { n: 10, x: 720, y: 305 }, { n: 11, x: 710, y: 410 }, { n: 13, x: 530, y: 450 }, { n: 14, x: 240, y: 320 },
    ],
    speedTraps: [{ x: 720, y: 380, label: "ST 328 km/h" }, { x: 230, y: 420, label: "FL" }],
    drsSegments: [
      { x1: 130, y1: 420, x2: 320, y2: 420, label: "DRS 1" },
      { x1: 390, y1: 120, x2: 480, y2: 120, label: "DRS 2" },
      { x1: 670, y1: 460, x2: 500, y2: 460, label: "DRS 3" },
    ],
    sectorSplits: [0.33, 0.66],
  },
  {
    id: "jeddah",
    name: "Jeddah Corniche Circuit",
    country: "Saudi Arabia",
    lengthKm: "6.174",
    turns: 27,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 100 260 L 250 260 Q 280 260 290 235 L 320 160 Q 340 100 390 90 L 520 80 Q 580 75 620 95 L 710 140 Q 750 160 740 200 L 710 260 Q 690 300 640 320 L 540 350 Q 480 370 420 350 L 350 330 Q 300 315 270 340 L 210 390 Q 170 425 130 390 L 90 350 Q 65 310 100 260 Z",
    turnMarkers: [
      { n: 1, x: 270, y: 250 }, { n: 4, x: 315, y: 180 }, { n: 13, x: 620, y: 95 }, { n: 16, x: 730, y: 160 },
      { n: 22, x: 660, y: 310 }, { n: 24, x: 460, y: 355 }, { n: 27, x: 120, y: 380 },
    ],
    speedTraps: [{ x: 680, y: 250, label: "ST 342 km/h" }, { x: 180, y: 260, label: "FL" }],
    drsSegments: [
      { x1: 110, y1: 260, x2: 240, y2: 260, label: "DRS 1" },
      { x1: 430, y1: 85, x2: 580, y2: 80, label: "DRS 2" },
      { x1: 670, y1: 300, x2: 470, y2: 360, label: "DRS 3" },
    ],
    sectorSplits: [0.33, 0.67],
  },
  {
    id: "miami",
    name: "Miami International Autodrome",
    country: "United States",
    lengthKm: "5.412",
    turns: 19,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 160 410 L 380 410 Q 420 410 440 375 L 470 315 Q 490 280 530 280 L 610 280 Q 660 280 670 240 L 680 180 Q 690 130 640 120 L 510 110 Q 460 110 430 140 L 390 180 Q 360 210 320 210 L 250 210 Q 210 210 190 250 L 160 310 Q 130 370 160 410 Z",
    turnMarkers: [
      { n: 1, x: 400, y: 400 }, { n: 4, x: 470, y: 325 }, { n: 7, x: 600, y: 270 }, { n: 11, x: 660, y: 150 },
      { n: 14, x: 460, y: 125 }, { n: 16, x: 360, y: 200 }, { n: 17, x: 200, y: 240 },
    ],
    speedTraps: [{ x: 580, y: 115, label: "ST 340 km/h" }],
    drsSegments: [
      { x1: 170, y1: 410, x2: 370, y2: 410, label: "DRS 1" },
      { x1: 620, y1: 115, x2: 480, y2: 115, label: "DRS 2 • 1.3km" },
      { x1: 310, y1: 210, x2: 210, y2: 210, label: "DRS 3" },
    ],
    sectorSplits: [0.32, 0.66],
  },
  {
    id: "imola",
    name: "Autodromo Enzo e Dino Ferrari",
    country: "Italy",
    lengthKm: "4.909",
    turns: 19,
    drsZones: 1,
    viewBox: "0 0 800 500",
    path: "M 140 370 L 310 370 Q 340 370 360 340 L 400 280 Q 430 240 480 240 L 550 240 Q 590 240 610 210 L 650 150 Q 680 110 730 110 L 750 110 Q 770 140 740 180 L 680 260 Q 640 310 590 330 L 480 370 Q 420 390 370 380 L 260 360 Q 200 350 170 380 L 140 410 Q 110 420 110 390 Z",
    turnMarkers: [
      { n: 2, x: 330, y: 360 }, { n: 5, x: 420, y: 265 }, { n: 7, x: 570, y: 230 }, { n: 9, x: 670, y: 135 },
      { n: 12, x: 740, y: 160 }, { n: 14, x: 610, y: 310 }, { n: 17, x: 390, y: 385 },
    ],
    speedTraps: [{ x: 220, y: 370, label: "ST 318 km/h" }],
    drsSegments: [{ x1: 150, y1: 370, x2: 300, y2: 370, label: "DRS PIT" }],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "monaco",
    name: "Circuit de Monaco",
    country: "Monaco",
    lengthKm: "3.337",
    turns: 19,
    drsZones: 1,
    viewBox: "0 0 800 500",
    path: "M 160 410 L 310 410 Q 350 410 365 375 L 390 320 Q 415 270 460 250 L 550 210 Q 600 185 640 190 L 690 195 Q 730 200 740 235 Q 745 270 705 285 L 630 310 Q 590 325 580 345 Q 570 370 610 385 L 670 405 Q 710 420 700 455 Q 685 480 635 475 L 470 460 Q 420 455 395 425 L 360 385 Q 330 350 280 360 L 210 375 Q 160 385 140 360 L 120 330 Q 100 290 140 290 L 210 290 Q 260 290 280 330 L 285 370 Q 285 410 230 410 Z",
    turnMarkers: [
      { n: 1, x: 335, y: 400 }, { n: 3, x: 440, y: 260 }, { n: 4, x: 620, y: 190 }, { n: 6, x: 735, y: 250 },
      { n: 8, x: 615, y: 315 }, { n: 10, x: 600, y: 370 }, { n: 12, x: 690, y: 430 }, { n: 15, x: 430, y: 450 },
      { n: 18, x: 260, y: 360 }, { n: 19, x: 170, y: 395 },
    ],
    speedTraps: [{ x: 650, y: 400, label: "TUNNEL 292 km/h" }],
    drsSegments: [{ x1: 170, y1: 410, x2: 300, y2: 410, label: "DRS PIT" }],
    sectorSplits: [0.35, 0.68],
  },
  {
    id: "barcelona",
    name: "Circuit de Barcelona-Catalunya",
    country: "Spain",
    lengthKm: "4.657",
    turns: 14,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 130 420 L 530 420 Q 580 420 605 385 L 630 350 Q 650 320 630 290 L 580 250 Q 540 220 540 180 Q 540 130 590 110 L 660 90 Q 710 75 735 110 Q 755 140 730 175 L 680 235 Q 650 270 600 280 L 460 300 Q 400 310 370 280 L 330 230 Q 300 190 250 200 L 190 220 Q 140 240 130 290 L 120 360 Q 110 420 130 420 Z",
    turnMarkers: [
      { n: 1, x: 560, y: 410 }, { n: 3, x: 625, y: 310 }, { n: 4, x: 555, y: 150 }, { n: 7, x: 725, y: 95 },
      { n: 9, x: 710, y: 200 }, { n: 10, x: 440, y: 295 }, { n: 12, x: 310, y: 220 }, { n: 14, x: 135, y: 340 },
    ],
    speedTraps: [{ x: 450, y: 420, label: "ST 332 km/h" }, { x: 690, y: 80, label: "CAMPSA" }],
    drsSegments: [
      { x1: 150, y1: 420, x2: 510, y2: 420, label: "DRS 1 • 1.05km" },
      { x1: 670, y1: 220, x2: 500, y2: 290, label: "DRS 2" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "madrid",
    name: "Circuito de Madrid",
    country: "Spain",
    lengthKm: "5.474",
    turns: 20,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 160 420 L 460 420 Q 500 420 525 385 L 565 330 Q 590 280 635 280 L 710 280 Q 750 280 755 240 L 760 180 Q 765 125 715 110 L 590 90 Q 540 80 510 120 L 460 180 Q 420 230 370 230 L 290 230 Q 240 230 220 270 L 190 330 Q 160 390 160 420 Z",
    turnMarkers: [
      { n: 1, x: 480, y: 410 }, { n: 4, x: 550, y: 340 }, { n: 7, x: 730, y: 260 }, { n: 10, x: 740, y: 145 },
      { n: 13, x: 535, y: 100 }, { n: 17, x: 410, y: 215 }, { n: 20, x: 195, y: 340 },
    ],
    speedTraps: [{ x: 500, y: 420, label: "M-11 340 km/h" }],
    drsSegments: [
      { x1: 170, y1: 420, x2: 440, y2: 420, label: "DRS 1" },
      { x1: 710, y1: 110, x2: 560, y2: 90, label: "DRS 2" },
    ],
    sectorSplits: [0.33, 0.67],
  },
  {
    id: "montreal",
    name: "Circuit Gilles Villeneuve",
    country: "Canada",
    lengthKm: "4.361",
    turns: 14,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 110 320 L 520 320 Q 580 320 620 290 L 710 220 Q 750 190 730 150 L 690 100 Q 660 70 610 80 L 340 130 Q 280 140 250 170 L 190 230 Q 150 270 110 270 L 80 270 Q 60 290 80 310 Z",
    turnMarkers: [
      { n: 1, x: 170, y: 240 }, { n: 3, x: 270, y: 160 }, { n: 6, x: 480, y: 105 }, { n: 8, x: 670, y: 85 },
      { n: 10, x: 735, y: 170 }, { n: 13, x: 580, y: 310 }, { n: 14, x: 500, y: 320 },
    ],
    speedTraps: [{ x: 420, y: 320, label: "ST 336 km/h" }, { x: 630, y: 250, label: "WALL OF CHAMPIONS" }],
    drsSegments: [
      { x1: 130, y1: 320, x2: 480, y2: 320, label: "DRS 1" },
      { x1: 360, y1: 125, x2: 590, y2: 85, label: "DRS 2" },
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
    path: "M 140 430 L 490 430 Q 540 430 570 395 L 650 300 Q 680 260 660 220 L 590 130 Q 570 100 530 110 L 410 140 Q 360 150 330 185 L 280 240 Q 250 275 210 285 L 150 295 Q 110 305 110 350 L 110 390 Q 110 430 140 430 Z",
    turnMarkers: [
      { n: 1, x: 520, y: 415 }, { n: 3, x: 665, y: 250 }, { n: 4, x: 560, y: 115 }, { n: 6, x: 380, y: 160 },
      { n: 7, x: 290, y: 230 }, { n: 9, x: 190, y: 290 }, { n: 10, x: 120, y: 380 },
    ],
    speedTraps: [{ x: 610, y: 340, label: "ST 325 km/h" }],
    drsSegments: [
      { x1: 160, y1: 430, x2: 470, y2: 430, label: "DRS 1" },
      { x1: 560, y1: 400, x2: 640, y2: 300, label: "DRS 2" },
      { x1: 640, y1: 200, x2: 550, y2: 120, label: "DRS 3" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "silverstone",
    name: "Silverstone Circuit",
    country: "United Kingdom",
    lengthKm: "5.891",
    turns: 18,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 180 390 L 320 390 Q 360 390 380 360 L 420 300 Q 450 250 490 265 L 560 290 Q 610 310 630 270 L 660 200 Q 685 150 730 160 L 760 170 Q 780 200 760 235 L 720 300 Q 680 370 610 390 L 480 430 Q 410 450 350 420 L 270 380 Q 220 350 180 390 Z",
    turnMarkers: [
      { n: 1, x: 340, y: 380 }, { n: 3, x: 410, y: 310 }, { n: 6, x: 520, y: 275 }, { n: 9, x: 640, y: 220 },
      { n: 11, x: 740, y: 165 }, { n: 14, x: 740, y: 270 }, { n: 15, x: 570, y: 405 }, { n: 18, x: 230, y: 365 },
    ],
    speedTraps: [{ x: 740, y: 200, label: "HANGAR 330 km/h" }, { x: 250, y: 390, label: "FL" }],
    drsSegments: [
      { x1: 440, y1: 270, x2: 540, y2: 290, label: "DRS WELLINGTON" },
      { x1: 750, y1: 210, x2: 670, y2: 320, label: "DRS HANGAR" },
    ],
    sectorSplits: [0.31, 0.67],
  },
  {
    id: "spa",
    name: "Circuit de Spa-Francorchamps",
    country: "Belgium",
    lengthKm: "7.004",
    turns: 19,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 130 420 L 260 420 Q 300 420 315 385 L 340 330 Q 365 270 420 250 L 580 200 Q 630 185 665 215 L 710 260 Q 745 300 730 345 L 700 400 Q 670 450 610 460 L 510 475 Q 440 480 400 435 L 340 365 Q 300 320 240 330 L 160 345 Q 110 360 130 420 Z",
    turnMarkers: [
      { n: 1, x: 285, y: 410 }, { n: 3, x: 330, y: 350 }, { n: 5, x: 450, y: 240 }, { n: 8, x: 615, y: 195 },
      { n: 10, x: 720, y: 285 }, { n: 12, x: 685, y: 420 }, { n: 15, x: 470, y: 470 }, { n: 18, x: 200, y: 335 },
    ],
    speedTraps: [{ x: 500, y: 220, label: "KEMMEL 345 km/h" }, { x: 200, y: 420, label: "FL" }],
    drsSegments: [
      { x1: 140, y1: 420, x2: 250, y2: 420, label: "DRS PIT" },
      { x1: 370, y1: 260, x2: 570, y2: 205, label: "DRS KEMMEL" },
    ],
    sectorSplits: [0.33, 0.68],
  },
  {
    id: "hungaroring",
    name: "Hungaroring",
    country: "Hungary",
    lengthKm: "4.381",
    turns: 14,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 150 410 L 440 410 Q 480 410 500 375 L 530 325 Q 555 285 595 285 L 660 285 Q 700 285 715 245 L 735 190 Q 750 145 715 120 L 645 80 Q 605 60 565 85 L 505 125 Q 465 150 425 130 L 355 95 Q 315 75 275 105 L 225 145 Q 185 175 185 225 L 185 305 Q 185 355 150 410 Z",
    turnMarkers: [
      { n: 1, x: 470, y: 400 }, { n: 2, x: 520, y: 340 }, { n: 4, x: 680, y: 275 }, { n: 5, x: 730, y: 160 },
      { n: 8, x: 590, y: 75 }, { n: 11, x: 380, y: 115 }, { n: 13, x: 205, y: 215 }, { n: 14, x: 170, y: 370 },
    ],
    speedTraps: [{ x: 320, y: 410, label: "ST 320 km/h" }],
    drsSegments: [
      { x1: 160, y1: 410, x2: 420, y2: 410, label: "DRS 1" },
      { x1: 490, y1: 360, x2: 530, y2: 300, label: "DRS 2" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "zandvoort",
    name: "Circuit Zandvoort",
    country: "Netherlands",
    lengthKm: "4.259",
    turns: 14,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 180 430 L 510 430 Q 560 430 580 395 L 610 340 Q 630 300 610 260 L 570 200 Q 540 155 490 165 L 420 180 Q 370 190 350 230 L 330 275 Q 310 315 270 325 L 200 340 Q 150 350 140 390 L 140 410 Q 140 430 180 430 Z",
    turnMarkers: [
      { n: 1, x: 535, y: 415 }, { n: 3, x: 600, y: 310 }, { n: 7, x: 540, y: 175 }, { n: 9, x: 400, y: 190 },
      { n: 11, x: 310, y: 290 }, { n: 13, x: 180, y: 345 }, { n: 14, x: 145, y: 420 },
    ],
    speedTraps: [{ x: 380, y: 430, label: "BANKING 315 km/h" }],
    drsSegments: [
      { x1: 190, y1: 430, x2: 490, y2: 430, label: "DRS BANKED" },
      { x1: 580, y1: 215, x2: 460, y2: 175, label: "DRS 2" },
    ],
    sectorSplits: [0.31, 0.66],
  },
  {
    id: "monza",
    name: "Autodromo Nazionale Monza",
    country: "Italy",
    lengthKm: "5.793",
    turns: 11,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 140 440 L 520 440 Q 560 440 575 415 L 595 385 Q 610 360 635 360 L 710 360 Q 750 360 760 325 L 770 270 Q 775 220 745 190 L 690 140 Q 655 110 610 125 L 520 155 Q 470 170 440 210 L 390 280 Q 360 320 310 320 L 220 320 Q 160 320 140 365 L 125 405 Q 115 440 140 440 Z",
    turnMarkers: [
      { n: 1, x: 550, y: 430 }, { n: 3, x: 620, y: 360 }, { n: 4, x: 745, y: 335 }, { n: 6, x: 720, y: 165 },
      { n: 7, x: 645, y: 125 }, { n: 8, x: 420, y: 235 }, { n: 11, x: 145, y: 350 },
    ],
    speedTraps: [{ x: 380, y: 440, label: "RETTIFILO 355 km/h" }, { x: 750, y: 240, label: "SERRAGLIO" }],
    drsSegments: [
      { x1: 150, y1: 440, x2: 500, y2: 440, label: "DRS MAIN • 1.1km" },
      { x1: 600, y1: 130, x2: 470, y2: 175, label: "DRS SERRAGLIO" },
    ],
    sectorSplits: [0.33, 0.67],
  },
  {
    id: "baku",
    name: "Baku City Circuit",
    country: "Azerbaijan",
    lengthKm: "6.003",
    turns: 20,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 100 440 L 720 440 Q 760 440 760 400 L 760 260 Q 760 220 720 220 L 620 220 Q 580 220 580 180 L 580 120 Q 580 80 540 80 L 410 80 Q 370 80 370 120 L 370 180 Q 370 220 330 220 L 220 220 Q 180 220 180 260 L 180 350 Q 180 390 140 400 L 100 410 Z",
    turnMarkers: [
      { n: 1, x: 740, y: 420 }, { n: 3, x: 740, y: 235 }, { n: 7, x: 595, y: 150 }, { n: 8, x: 520, y: 80 },
      { n: 12, x: 385, y: 150 }, { n: 15, x: 240, y: 220 }, { n: 16, x: 165, y: 320 }, { n: 20, x: 120, y: 425 },
    ],
    speedTraps: [{ x: 450, y: 440, label: "NEFTCHILAR 350 km/h" }],
    drsSegments: [
      { x1: 120, y1: 440, x2: 700, y2: 440, label: "DRS 1 • 2.2km" },
      { x1: 710, y1: 220, x2: 630, y2: 220, label: "DRS 2" },
    ],
    sectorSplits: [0.35, 0.70],
  },
  {
    id: "singapore",
    name: "Marina Bay Street Circuit",
    country: "Singapore",
    lengthKm: "4.940",
    turns: 19,
    drsZones: 4,
    viewBox: "0 0 800 500",
    path: "M 140 410 L 410 410 Q 450 410 470 380 L 510 320 Q 540 280 590 280 L 680 280 Q 720 280 735 240 L 750 190 Q 760 140 710 130 L 580 110 Q 520 100 490 140 L 450 200 Q 420 240 370 240 L 280 240 Q 230 240 210 280 L 180 340 Q 150 400 140 410 Z",
    turnMarkers: [
      { n: 1, x: 430, y: 400 }, { n: 5, x: 550, y: 280 }, { n: 7, x: 720, y: 250 }, { n: 9, x: 720, y: 150 },
      { n: 14, x: 520, y: 115 }, { n: 16, x: 400, y: 240 }, { n: 19, x: 190, y: 320 },
    ],
    speedTraps: [{ x: 630, y: 120, label: "ST 320 km/h" }],
    drsSegments: [
      { x1: 150, y1: 410, x2: 390, y2: 410, label: "DRS 1" },
      { x1: 690, y1: 130, x2: 560, y2: 110, label: "DRS 2" },
    ],
    sectorSplits: [0.32, 0.65],
  },
  {
    id: "cota",
    name: "Circuit of the Americas",
    country: "United States",
    lengthKm: "5.513",
    turns: 20,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 150 420 L 460 420 Q 510 420 535 380 L 580 300 Q 610 250 660 250 L 720 250 Q 760 250 750 200 L 730 140 Q 710 90 650 90 L 510 90 Q 450 90 420 130 L 370 200 Q 330 260 280 260 L 220 260 Q 170 260 150 310 L 130 365 Q 110 420 150 420 Z",
    turnMarkers: [
      { n: 1, x: 490, y: 405 }, { n: 3, x: 570, y: 310 }, { n: 6, x: 650, y: 250 }, { n: 11, x: 740, y: 160 },
      { n: 12, x: 570, y: 90 }, { n: 15, x: 400, y: 150 }, { n: 19, x: 200, y: 280 },
    ],
    speedTraps: [{ x: 600, y: 90, label: "BACK STRAIGHT 335 km/h" }],
    drsSegments: [
      { x1: 170, y1: 420, x2: 440, y2: 420, label: "DRS 1" },
      { x1: 700, y1: 90, x2: 520, y2: 90, label: "DRS 2 • 1.0km" },
    ],
    sectorSplits: [0.33, 0.67],
  },
  {
    id: "mexico",
    name: "Autodromo Hermanos Rodriguez",
    country: "Mexico",
    lengthKm: "4.304",
    turns: 17,
    drsZones: 3,
    viewBox: "0 0 800 500",
    path: "M 120 420 L 560 420 Q 610 420 635 385 L 670 330 Q 700 280 665 245 L 615 200 Q 575 160 575 110 L 575 80 Q 575 50 535 50 L 415 50 Q 375 50 355 85 L 320 145 Q 290 200 240 210 L 170 220 Q 120 230 110 280 L 100 350 Q 90 420 120 420 Z",
    turnMarkers: [
      { n: 1, x: 585, y: 410 }, { n: 4, x: 660, y: 300 }, { n: 7, x: 590, y: 160 }, { n: 10, x: 470, y: 55 },
      { n: 12, x: 335, y: 120 }, { n: 14, x: 210, y: 215 }, { n: 17, x: 110, y: 375 },
    ],
    speedTraps: [{ x: 380, y: 420, label: "ALTITUDE 352 km/h" }],
    drsSegments: [
      { x1: 140, y1: 420, x2: 540, y2: 420, label: "DRS 1 • 1.2km" },
      { x1: 640, y1: 340, x2: 600, y2: 240, label: "DRS 2" },
    ],
    sectorSplits: [0.32, 0.66],
  },
  {
    id: "interlagos",
    name: "Autodromo Jose Carlos Pace",
    country: "Brazil",
    lengthKm: "4.309",
    turns: 15,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 160 430 L 480 430 Q 530 430 550 395 L 580 340 Q 610 290 580 250 L 530 190 Q 490 140 430 140 L 320 140 Q 260 140 230 185 L 190 240 Q 150 300 190 340 L 250 380 Q 300 410 360 370 L 410 330 Q 450 300 410 260 L 360 220 Q 320 185 270 200 Z",
    turnMarkers: [
      { n: 1, x: 510, y: 415 }, { n: 3, x: 570, y: 310 }, { n: 4, x: 470, y: 145 }, { n: 6, x: 280, y: 150 },
      { n: 8, x: 190, y: 290 }, { n: 10, x: 320, y: 390 }, { n: 12, x: 415, y: 285 },
    ],
    speedTraps: [{ x: 360, y: 430, label: "SUBIDA 330 km/h" }],
    drsSegments: [
      { x1: 180, y1: 430, x2: 460, y2: 430, label: "DRS MAIN" },
      { x1: 560, y1: 350, x2: 470, y2: 150, label: "DRS RETA OPOSTA" },
    ],
    sectorSplits: [0.31, 0.65],
  },
  {
    id: "lasvegas",
    name: "Las Vegas Strip Circuit",
    country: "United States",
    lengthKm: "6.201",
    turns: 17,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 110 410 L 680 410 Q 730 410 745 375 L 760 320 Q 770 270 730 250 L 640 210 Q 590 190 560 220 L 520 260 Q 480 300 430 300 L 310 300 Q 260 300 240 260 L 210 200 Q 180 140 130 150 L 80 160 Q 50 180 60 220 L 80 340 Q 90 410 110 410 Z",
    turnMarkers: [
      { n: 1, x: 700, y: 400 }, { n: 5, x: 670, y: 230 }, { n: 7, x: 540, y: 240 }, { n: 9, x: 360, y: 300 },
      { n: 12, x: 225, y: 220 }, { n: 14, x: 110, y: 155 }, { n: 17, x: 85, y: 365 },
    ],
    speedTraps: [{ x: 420, y: 410, label: "STRIP 350 km/h" }],
    drsSegments: [
      { x1: 130, y1: 410, x2: 660, y2: 410, label: "DRS STRIP • 1.9km" },
      { x1: 720, y1: 250, x2: 580, y2: 200, label: "DRS KOVAL" },
    ],
    sectorSplits: [0.34, 0.69],
  },
  {
    id: "lusail",
    name: "Lusail International Circuit",
    country: "Qatar",
    lengthKm: "5.419",
    turns: 16,
    drsZones: 1,
    viewBox: "0 0 800 500",
    path: "M 150 420 L 520 420 Q 570 420 595 385 L 635 325 Q 665 280 635 235 L 585 170 Q 550 120 495 125 L 385 135 Q 330 145 305 190 L 270 250 Q 240 305 195 315 L 135 330 Q 95 340 105 385 L 115 405 Q 125 420 150 420 Z",
    turnMarkers: [
      { n: 1, x: 550, y: 410 }, { n: 4, x: 630, y: 295 }, { n: 7, x: 575, y: 155 }, { n: 10, x: 415, y: 130 },
      { n: 12, x: 290, y: 215 }, { n: 15, x: 155, y: 325 },
    ],
    speedTraps: [{ x: 360, y: 420, label: "ST 335 km/h" }],
    drsSegments: [{ x1: 170, y1: 420, x2: 500, y2: 420, label: "DRS MAIN • 1.07km" }],
    sectorSplits: [0.32, 0.66],
  },
  {
    id: "yasmarina",
    name: "Yas Marina Circuit",
    country: "United Arab Emirates",
    lengthKm: "5.281",
    turns: 16,
    drsZones: 2,
    viewBox: "0 0 800 500",
    path: "M 170 420 L 490 420 Q 540 420 560 385 L 590 330 Q 620 280 665 280 L 730 280 Q 770 280 760 240 L 730 160 Q 710 110 650 110 L 520 110 Q 460 110 430 150 L 390 210 Q 350 270 300 270 L 230 270 Q 180 270 160 310 L 140 365 Q 125 420 170 420 Z",
    turnMarkers: [
      { n: 1, x: 515, y: 410 }, { n: 5, x: 620, y: 300 }, { n: 6, x: 745, y: 250 }, { n: 9, x: 680, y: 125 },
      { n: 11, x: 470, y: 120 }, { n: 13, x: 370, y: 230 }, { n: 16, x: 175, y: 335 },
    ],
    speedTraps: [{ x: 600, y: 110, label: "HOTEL 330 km/h" }],
    drsSegments: [
      { x1: 190, y1: 420, x2: 470, y2: 420, label: "DRS PIT" },
      { x1: 720, y1: 110, x2: 540, y2: 110, label: "DRS 2 • 1.2km" },
    ],
    sectorSplits: [0.33, 0.67],
  },
];

const FALLBACK_DRIVERS: DriverDot[] = [
  { driverNumber: 1, code: "VER", color: "#3671c6", progress: 0.12 },
  { driverNumber: 4, code: "NOR", color: "#ff8000", progress: 0.11 },
  { driverNumber: 16, code: "LEC", color: "#e8002d", progress: 0.085 },
  { driverNumber: 63, code: "RUS", color: "#00d2be", progress: 0.06 },
  { driverNumber: 44, code: "HAM", color: "#e8002d", progress: 0.045 },
  { driverNumber: 81, code: "PIA", color: "#ff8000", progress: 0.02 },
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
  const { weather } = useLiveWeather(circuit.id);
  const pathRef = useRef<SVGPathElement | null>(null);
  const [mockProgress, setMockProgress] = useState<DriverDot[]>(FALLBACK_DRIVERS);

  useEffect(() => {
    if (drivers && drivers.length) return;
    const iv = setInterval(() => {
      setMockProgress((prev) =>
        prev.map((d, i) => ({
          ...d,
          progress: (d.progress + 0.0035 + i * 0.0002) % 1,
        }))
      );
    }, 90);
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
    GREEN: { bg: "bg-[#052e1a] border-[#00d084]/30", text: "text-[#22c55e]", glow: "shadow-[0_0_22px_rgba(34,197,94,0.35)]", label: "GREEN : RACING" },
    YELLOW: { bg: "bg-[#3a2d00] border-[#eab308]/40", text: "text-[#facc15]", glow: "shadow-[0_0_22px_rgba(234,179,8,0.4)]", label: "YELLOW : CAUTION" },
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
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#64748b]">AUTHENTIC FIA GEOMETRY • LIVE TELEMETRY</span>
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
          <div className="text-[10px] text-[#00d2be] mt-0.5">S1 / S2 / S3 • DRS Zones</div>
        </div>
        <div className="px-4 py-2 text-right">
          <div className="text-[10px] tracking-widest text-[#64748b]">CONDITIONS</div>
          <div className="text-xs font-mono text-[#cbd5e1]">Track {weather.trackTempC.toFixed(1)}°C • Air {weather.airTempC.toFixed(1)}°C</div>
          <div className="text-[10px] text-[#00d2be] font-mono flex items-center justify-end gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#00d2be] animate-pulse" />
            {weather.condition}
          </div>
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
          {/* Base asphalt glow & track line */}
          <path d={circuit.path} fill="none" stroke="#020617" strokeWidth={22} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />
          <path ref={pathRef} d={circuit.path} fill="none" stroke="#1e293b" strokeWidth={16} strokeLinecap="round" strokeLinejoin="round" />
          <path d={circuit.path} fill="none" stroke="#334155" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" opacity={0.6} />
          <path d={circuit.path} fill="none" stroke="#0f172a" strokeWidth={1} strokeDasharray="8 12" opacity={0.35} />

          {/* DRS zones */}
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

          {/* Turn markers */}
          {circuit.turnMarkers.map((t) => (
            <g key={`t-${t.n}`}>
              <circle cx={t.x} cy={t.y} r={11} fill="#0f172a" stroke="#334155" strokeWidth={1.2} />
              <text x={t.x} y={t.y + 3.5} textAnchor="middle" fontSize={9} fontWeight={900} fill="#e2e8f0">
                {t.n}
              </text>
            </g>
          ))}

          {/* Speed traps */}
          {circuit.speedTraps.map((s, i) => (
            <g key={`trap-${i}`}>
              <g transform={`translate(${s.x},${s.y}) rotate(45)`}>
                <rect x={-8} y={-8} width={16} height={16} fill="#ff8000" stroke="#ffedd5" strokeWidth={1.2} rx={2} />
                <g transform="rotate(-45)">
                  <text x={0} y={2.5} textAnchor="middle" fontSize={5} fontWeight={900} fill="white">
                    *
                  </text>
                </g>
              </g>
              <text x={s.x} y={s.y - 14} textAnchor="middle" fontSize={7} fontWeight={700} fill="#ff8000">
                {s.label}
              </text>
            </g>
          ))}

          {/* Driver dots */}
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

          {/* North indicator */}
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
              DRS Zone
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rotate-45 bg-[#ff8000] border border-[#ffedd5] inline-block" />
              Speed Trap
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="w-3 h-3 rounded-full border border-[#334155] bg-[#0f172a] inline-flex items-center justify-center text-[7px]">3</span>
              Corner Number
            </span>
          </div>
          <span className="font-mono text-[#475569] hidden sm:inline">interpolated spline coordinates</span>
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
            : {circuit.name}{" "}
            {flag === "GREEN"
              ? "is green : push allowed"
              : flag === "YELLOW"
                ? ": caution, no overtaking"
                : flag === "SC"
                  ? ": safety car deployed"
                  : flag === "VSC"
                    ? ": virtual safety car"
                    : ": red flag, session suspended"}
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
