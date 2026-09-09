// PitWall ML - Official FIA 2025/2026 Formula 1 Calendar & Deterministic Session Engine
// Provides verified calendar rounds, circuit keys, session schedules, and off-track status resolution.

export type SessionType = "FP1" | "FP2" | "FP3" | "SQ" | "Sprint" | "Qualifying" | "Race";

export type WeekendSession = {
  type: SessionType;
  label: string;
  startUtc: string; // ISO 8601
  endUtc: string;   // ISO 8601
  durationMin: number;
};

export type GrandPrixRound = {
  round: number;
  year: number;
  circuitId: string;
  name: string;
  officialName: string;
  country: string;
  city: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  isSprint: boolean;
  lengthKm: number;
  laps: number;
  turns: number;
  sessions: WeekendSession[];
};

export type HistoricalReplayOption = {
  id: string;
  year: number;
  round: number;
  circuitId: string;
  circuitName: string;
  sessionName: string;
  totalLaps: number;
  description: string;
};

// Available ingested historical replay sessions for deterministic offline replay
export const HISTORICAL_REPLAYS: HistoricalReplayOption[] = [
  {
    id: "barcelona-2024-race",
    year: 2024,
    round: 10,
    circuitId: "barcelona",
    circuitName: "Circuit de Barcelona-Catalunya",
    sessionName: "Grand Prix Race (Lap 1 to 66)",
    totalLaps: 66,
    description: "Verstappen vs Norris strategic battle with high-deg 2-stop undercut telemetry.",
  },
  {
    id: "monza-2024-race",
    year: 2024,
    round: 16,
    circuitId: "monza",
    circuitName: "Autodromo Nazionale Monza",
    sessionName: "Grand Prix Race (Lap 1 to 53)",
    totalLaps: 53,
    description: "Temple of Speed low-downforce telemetry, Leclerc 1-stop hard tyre masterclass.",
  },
  {
    id: "spa-2024-race",
    year: 2024,
    round: 14,
    circuitId: "spa",
    circuitName: "Circuit de Spa-Francorchamps",
    sessionName: "Grand Prix Race (Lap 1 to 44)",
    totalLaps: 44,
    description: "Kemmel Straight slipstream, Pouhon high-speed stability, and tyre degradation analysis.",
  },
  {
    id: "silverstone-2024-race",
    year: 2024,
    round: 12,
    circuitId: "silverstone",
    circuitName: "Silverstone Circuit",
    sessionName: "Grand Prix Race (Lap 1 to 52)",
    totalLaps: 52,
    description: "Maggotts-Becketts lateral load, crossover dry-inter weather transitions.",
  },
  {
    id: "monaco-2024-race",
    year: 2024,
    round: 8,
    circuitId: "monaco",
    circuitName: "Circuit de Monaco",
    sessionName: "Grand Prix Race (Lap 1 to 78)",
    totalLaps: 78,
    description: "Tight barrier navigation, Fairmont hairpin maximum steering lock, track position lock.",
  },
];

// Helper to construct standard GP sessions
function createStandardSessions(year: number, m: number, d1: number, d2: number, d3: number, tzOffsetHour = 0): WeekendSession[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStr = pad(m);
  const tz = (h: number) => {
    const utcHour = h - tzOffsetHour;
    return `${pad(Math.floor(utcHour))}:${pad(Math.round((utcHour % 1) * 60))}:00Z`;
  };
  return [
    { type: "FP1", label: "Practice 1", startUtc: `${year}-${monthStr}-${pad(d1)}T${tz(13.5)}`, endUtc: `${year}-${monthStr}-${pad(d1)}T${tz(14.5)}`, durationMin: 60 },
    { type: "FP2", label: "Practice 2", startUtc: `${year}-${monthStr}-${pad(d1)}T${tz(17.0)}`, endUtc: `${year}-${monthStr}-${pad(d1)}T${tz(18.0)}`, durationMin: 60 },
    { type: "FP3", label: "Practice 3", startUtc: `${year}-${monthStr}-${pad(d2)}T${tz(12.5)}`, endUtc: `${year}-${monthStr}-${pad(d2)}T${tz(13.5)}`, durationMin: 60 },
    { type: "Qualifying", label: "Qualifying", startUtc: `${year}-${monthStr}-${pad(d2)}T${tz(16.0)}`, endUtc: `${year}-${monthStr}-${pad(d2)}T${tz(17.0)}`, durationMin: 60 },
    { type: "Race", label: "Grand Prix Race", startUtc: `${year}-${monthStr}-${pad(d3)}T${tz(15.0)}`, endUtc: `${year}-${monthStr}-${pad(d3)}T${tz(17.0)}`, durationMin: 120 },
  ];
}

// Helper to construct sprint GP sessions
function createSprintSessions(year: number, m: number, d1: number, d2: number, d3: number, tzOffsetHour = 0): WeekendSession[] {
  const pad = (n: number) => String(n).padStart(2, "0");
  const monthStr = pad(m);
  const tz = (h: number) => {
    const utcHour = h - tzOffsetHour;
    return `${pad(Math.floor(utcHour))}:${pad(Math.round((utcHour % 1) * 60))}:00Z`;
  };
  return [
    { type: "FP1", label: "Practice 1", startUtc: `${year}-${monthStr}-${pad(d1)}T${tz(13.5)}`, endUtc: `${year}-${monthStr}-${pad(d1)}T${tz(14.5)}`, durationMin: 60 },
    { type: "SQ", label: "Sprint Qualifying", startUtc: `${year}-${monthStr}-${pad(d1)}T${tz(17.5)}`, endUtc: `${year}-${monthStr}-${pad(d1)}T${tz(18.25)}`, durationMin: 44 },
    { type: "Sprint", label: "Sprint Race", startUtc: `${year}-${monthStr}-${pad(d2)}T${tz(12.0)}`, endUtc: `${year}-${monthStr}-${pad(d2)}T${tz(12.75)}`, durationMin: 45 },
    { type: "Qualifying", label: "Qualifying", startUtc: `${year}-${monthStr}-${pad(d2)}T${tz(16.0)}`, endUtc: `${year}-${monthStr}-${pad(d2)}T${tz(17.0)}`, durationMin: 60 },
    { type: "Race", label: "Grand Prix Race", startUtc: `${year}-${monthStr}-${pad(d3)}T${tz(15.0)}`, endUtc: `${year}-${monthStr}-${pad(d3)}T${tz(17.0)}`, durationMin: 120 },
  ];
}

// Authentic 24-round FIA Formula 1 World Championship Calendar
export const CALENDAR_2025: GrandPrixRound[] = [
  {
    round: 1,
    year: 2025,
    circuitId: "melbourne",
    name: "Australian Grand Prix",
    officialName: "Formula 1 Louis Vuitton Australian Grand Prix 2025",
    country: "Australia",
    city: "Melbourne",
    startDate: "2025-03-14",
    endDate: "2025-03-16",
    isSprint: false,
    lengthKm: 5.278,
    laps: 58,
    turns: 14,
    sessions: createStandardSessions(2025, 3, 14, 15, 16, 11),
  },
  {
    round: 2,
    year: 2025,
    circuitId: "shanghai",
    name: "Chinese Grand Prix",
    officialName: "Formula 1 Lenovo Chinese Grand Prix 2025",
    country: "China",
    city: "Shanghai",
    startDate: "2025-03-21",
    endDate: "2025-03-23",
    isSprint: true,
    lengthKm: 5.451,
    laps: 56,
    turns: 16,
    sessions: createSprintSessions(2025, 3, 21, 22, 23, 8),
  },
  {
    round: 3,
    year: 2025,
    circuitId: "suzuka",
    name: "Japanese Grand Prix",
    officialName: "Formula 1 MSC Cruises Japanese Grand Prix 2025",
    country: "Japan",
    city: "Suzuka",
    startDate: "2025-04-04",
    endDate: "2025-04-06",
    isSprint: false,
    lengthKm: 5.807,
    laps: 53,
    turns: 18,
    sessions: createStandardSessions(2025, 4, 4, 5, 6, 9),
  },
  {
    round: 4,
    year: 2025,
    circuitId: "bahrain",
    name: "Bahrain Grand Prix",
    officialName: "Formula 1 Gulf Air Bahrain Grand Prix 2025",
    country: "Bahrain",
    city: "Sakhir",
    startDate: "2025-04-11",
    endDate: "2025-04-13",
    isSprint: false,
    lengthKm: 5.412,
    laps: 57,
    turns: 15,
    sessions: createStandardSessions(2025, 4, 11, 12, 13, 3),
  },
  {
    round: 5,
    year: 2025,
    circuitId: "jeddah",
    name: "Saudi Arabian Grand Prix",
    officialName: "Formula 1 STC Saudi Arabian Grand Prix 2025",
    country: "Saudi Arabia",
    city: "Jeddah",
    startDate: "2025-04-18",
    endDate: "2025-04-20",
    isSprint: false,
    lengthKm: 6.174,
    laps: 50,
    turns: 27,
    sessions: createStandardSessions(2025, 4, 18, 19, 20, 3),
  },
  {
    round: 6,
    year: 2025,
    circuitId: "miami",
    name: "Miami Grand Prix",
    officialName: "Formula 1 Crypto.com Miami Grand Prix 2025",
    country: "United States",
    city: "Miami",
    startDate: "2025-05-02",
    endDate: "2025-05-04",
    isSprint: true,
    lengthKm: 5.412,
    laps: 57,
    turns: 19,
    sessions: createSprintSessions(2025, 5, 2, 3, 4, -4),
  },
  {
    round: 7,
    year: 2025,
    circuitId: "imola",
    name: "Emilia Romagna Grand Prix",
    officialName: "Formula 1 MSC Cruises Gran Premio del Made in Italy e dell'Emilia-Romagna 2025",
    country: "Italy",
    city: "Imola",
    startDate: "2025-05-16",
    endDate: "2025-05-18",
    isSprint: false,
    lengthKm: 4.909,
    laps: 63,
    turns: 19,
    sessions: createStandardSessions(2025, 5, 16, 17, 18, 2),
  },
  {
    round: 8,
    year: 2025,
    circuitId: "monaco",
    name: "Monaco Grand Prix",
    officialName: "Formula 1 Grand Prix de Monaco 2025",
    country: "Monaco",
    city: "Monte Carlo",
    startDate: "2025-05-23",
    endDate: "2025-05-25",
    isSprint: false,
    lengthKm: 3.337,
    laps: 78,
    turns: 19,
    sessions: createStandardSessions(2025, 5, 23, 24, 25, 2),
  },
  {
    round: 9,
    year: 2025,
    circuitId: "barcelona",
    name: "Spanish Grand Prix",
    officialName: "Formula 1 Aramco Gran Premio de Espana 2025",
    country: "Spain",
    city: "Barcelona",
    startDate: "2025-05-30",
    endDate: "2025-06-01",
    isSprint: false,
    lengthKm: 4.657,
    laps: 66,
    turns: 14,
    sessions: createStandardSessions(2025, 5, 30, 31, 1, 2),
  },
  {
    round: 10,
    year: 2025,
    circuitId: "montreal",
    name: "Canadian Grand Prix",
    officialName: "Formula 1 AWS Grand Prix du Canada 2025",
    country: "Canada",
    city: "Montreal",
    startDate: "2025-06-13",
    endDate: "2025-06-15",
    isSprint: false,
    lengthKm: 4.361,
    laps: 70,
    turns: 14,
    sessions: createStandardSessions(2025, 6, 13, 14, 15, -4),
  },
  {
    round: 11,
    year: 2025,
    circuitId: "austria",
    name: "Austrian Grand Prix",
    officialName: "Formula 1 Grosser Preis von Osterreich 2025",
    country: "Austria",
    city: "Spielberg",
    startDate: "2025-06-27",
    endDate: "2025-06-29",
    isSprint: true,
    lengthKm: 4.318,
    laps: 71,
    turns: 10,
    sessions: createSprintSessions(2025, 6, 27, 28, 29, 2),
  },
  {
    round: 12,
    year: 2025,
    circuitId: "silverstone",
    name: "British Grand Prix",
    officialName: "Formula 1 Qatar Airways British Grand Prix 2025",
    country: "United Kingdom",
    city: "Silverstone",
    startDate: "2025-07-04",
    endDate: "2025-07-06",
    isSprint: false,
    lengthKm: 5.891,
    laps: 52,
    turns: 18,
    sessions: createStandardSessions(2025, 7, 4, 5, 6, 1),
  },
  {
    round: 13,
    year: 2025,
    circuitId: "spa",
    name: "Belgian Grand Prix",
    officialName: "Formula 1 Rolex Belgian Grand Prix 2025",
    country: "Belgium",
    city: "Spa-Francorchamps",
    startDate: "2025-07-25",
    endDate: "2025-07-27",
    isSprint: true,
    lengthKm: 7.004,
    laps: 44,
    turns: 19,
    sessions: createSprintSessions(2025, 7, 25, 26, 27, 2),
  },
  {
    round: 14,
    year: 2025,
    circuitId: "hungaroring",
    name: "Hungarian Grand Prix",
    officialName: "Formula 1 Magyar Nagydij 2025",
    country: "Hungary",
    city: "Budapest",
    startDate: "2025-08-01",
    endDate: "2025-08-03",
    isSprint: false,
    lengthKm: 4.381,
    laps: 70,
    turns: 14,
    sessions: createStandardSessions(2025, 8, 1, 2, 3, 2),
  },
  {
    round: 15,
    year: 2025,
    circuitId: "zandvoort",
    name: "Dutch Grand Prix",
    officialName: "Formula 1 Heineken Dutch Grand Prix 2025",
    country: "Netherlands",
    city: "Zandvoort",
    startDate: "2025-08-29",
    endDate: "2025-08-31",
    isSprint: false,
    lengthKm: 4.259,
    laps: 72,
    turns: 14,
    sessions: createStandardSessions(2025, 8, 29, 30, 31, 2),
  },
  {
    round: 16,
    year: 2025,
    circuitId: "monza",
    name: "Italian Grand Prix",
    officialName: "Formula 1 Pirelli Gran Premio d'Italia 2025",
    country: "Italy",
    city: "Monza",
    startDate: "2025-09-05",
    endDate: "2025-09-07",
    isSprint: false,
    lengthKm: 5.793,
    laps: 53,
    turns: 11,
    sessions: createStandardSessions(2025, 9, 5, 6, 7, 2),
  },
  {
    round: 17,
    year: 2025,
    circuitId: "baku",
    name: "Azerbaijan Grand Prix",
    officialName: "Formula 1 Qatar Airways Azerbaijan Grand Prix 2025",
    country: "Azerbaijan",
    city: "Baku",
    startDate: "2025-09-19",
    endDate: "2025-09-21",
    isSprint: false,
    lengthKm: 6.003,
    laps: 51,
    turns: 20,
    sessions: createStandardSessions(2025, 9, 19, 20, 21, 4),
  },
  {
    round: 18,
    year: 2025,
    circuitId: "singapore",
    name: "Singapore Grand Prix",
    officialName: "Formula 1 Singapore Airlines Singapore Grand Prix 2025",
    country: "Singapore",
    city: "Marina Bay",
    startDate: "2025-10-03",
    endDate: "2025-10-05",
    isSprint: false,
    lengthKm: 4.940,
    laps: 62,
    turns: 19,
    sessions: createStandardSessions(2025, 10, 3, 4, 5, 8),
  },
  {
    round: 19,
    year: 2025,
    circuitId: "cota",
    name: "United States Grand Prix",
    officialName: "Formula 1 Pirelli United States Grand Prix 2025",
    country: "United States",
    city: "Austin",
    startDate: "2025-10-17",
    endDate: "2025-10-19",
    isSprint: true,
    lengthKm: 5.513,
    laps: 56,
    turns: 20,
    sessions: createSprintSessions(2025, 10, 17, 18, 19, -5),
  },
  {
    round: 20,
    year: 2025,
    circuitId: "mexico",
    name: "Mexico City Grand Prix",
    officialName: "Formula 1 Gran Premio de la Ciudad de Mexico 2025",
    country: "Mexico",
    city: "Mexico City",
    startDate: "2025-10-24",
    endDate: "2025-10-26",
    isSprint: false,
    lengthKm: 4.304,
    laps: 71,
    turns: 17,
    sessions: createStandardSessions(2025, 10, 24, 25, 26, -6),
  },
  {
    round: 21,
    year: 2025,
    circuitId: "interlagos",
    name: "Sao Paulo Grand Prix",
    officialName: "Formula 1 Lenovo Grande Premio de Sao Paulo 2025",
    country: "Brazil",
    city: "Sao Paulo",
    startDate: "2025-11-07",
    endDate: "2025-11-09",
    isSprint: true,
    lengthKm: 4.309,
    laps: 71,
    turns: 15,
    sessions: createSprintSessions(2025, 11, 7, 8, 9, -3),
  },
  {
    round: 22,
    year: 2025,
    circuitId: "lasvegas",
    name: "Las Vegas Grand Prix",
    officialName: "Formula 1 Heineken Silver Las Vegas Grand Prix 2025",
    country: "United States",
    city: "Las Vegas",
    startDate: "2025-11-20",
    endDate: "2025-11-22",
    isSprint: false,
    lengthKm: 6.201,
    laps: 50,
    turns: 17,
    sessions: createStandardSessions(2025, 11, 20, 21, 22, -8),
  },
  {
    round: 23,
    year: 2025,
    circuitId: "lusail",
    name: "Qatar Grand Prix",
    officialName: "Formula 1 Qatar Airways Qatar Grand Prix 2025",
    country: "Qatar",
    city: "Lusail",
    startDate: "2025-11-28",
    endDate: "2025-11-30",
    isSprint: true,
    lengthKm: 5.419,
    laps: 57,
    turns: 16,
    sessions: createSprintSessions(2025, 11, 28, 29, 30, 3),
  },
  {
    round: 24,
    year: 2025,
    circuitId: "yasmarina",
    name: "Abu Dhabi Grand Prix",
    officialName: "Formula 1 Etihad Airways Abu Dhabi Grand Prix 2025",
    country: "United Arab Emirates",
    city: "Abu Dhabi",
    startDate: "2025-12-05",
    endDate: "2025-12-07",
    isSprint: false,
    lengthKm: 5.281,
    laps: 58,
    turns: 16,
    sessions: createStandardSessions(2025, 12, 5, 6, 7, 4),
  },
];

// Authentic 24-round FIA Formula 1 World Championship 2026 Calendar (New Regulations & Madrid GP Entry)
export const CALENDAR_2026: GrandPrixRound[] = [
  {
    round: 1,
    year: 2026,
    circuitId: "melbourne",
    name: "Australian Grand Prix",
    officialName: "Formula 1 Australian Grand Prix 2026",
    country: "Australia",
    city: "Melbourne",
    startDate: "2026-03-13",
    endDate: "2026-03-15",
    isSprint: false,
    lengthKm: 5.278,
    laps: 58,
    turns: 14,
    sessions: createStandardSessions(2026, 3, 13, 14, 15, 11),
  },
  {
    round: 2,
    year: 2026,
    circuitId: "shanghai",
    name: "Chinese Grand Prix",
    officialName: "Formula 1 Chinese Grand Prix 2026",
    country: "China",
    city: "Shanghai",
    startDate: "2026-03-20",
    endDate: "2026-03-22",
    isSprint: true,
    lengthKm: 5.451,
    laps: 56,
    turns: 16,
    sessions: createSprintSessions(2026, 3, 20, 21, 22, 8),
  },
  {
    round: 3,
    year: 2026,
    circuitId: "suzuka",
    name: "Japanese Grand Prix",
    officialName: "Formula 1 Japanese Grand Prix 2026",
    country: "Japan",
    city: "Suzuka",
    startDate: "2026-04-03",
    endDate: "2026-04-05",
    isSprint: false,
    lengthKm: 5.807,
    laps: 53,
    turns: 18,
    sessions: createStandardSessions(2026, 4, 3, 4, 5, 9),
  },
  {
    round: 4,
    year: 2026,
    circuitId: "bahrain",
    name: "Bahrain Grand Prix",
    officialName: "Formula 1 Bahrain Grand Prix 2026",
    country: "Bahrain",
    city: "Sakhir",
    startDate: "2026-04-10",
    endDate: "2026-04-12",
    isSprint: false,
    lengthKm: 5.412,
    laps: 57,
    turns: 15,
    sessions: createStandardSessions(2026, 4, 10, 11, 12, 3),
  },
  {
    round: 5,
    year: 2026,
    circuitId: "jeddah",
    name: "Saudi Arabian Grand Prix",
    officialName: "Formula 1 Saudi Arabian Grand Prix 2026",
    country: "Saudi Arabia",
    city: "Jeddah",
    startDate: "2026-04-17",
    endDate: "2026-04-19",
    isSprint: false,
    lengthKm: 6.174,
    laps: 50,
    turns: 27,
    sessions: createStandardSessions(2026, 4, 17, 18, 19, 3),
  },
  {
    round: 6,
    year: 2026,
    circuitId: "miami",
    name: "Miami Grand Prix",
    officialName: "Formula 1 Miami Grand Prix 2026",
    country: "United States",
    city: "Miami",
    startDate: "2026-05-01",
    endDate: "2026-05-03",
    isSprint: true,
    lengthKm: 5.412,
    laps: 57,
    turns: 19,
    sessions: createSprintSessions(2026, 5, 1, 2, 3, -4),
  },
  {
    round: 7,
    year: 2026,
    circuitId: "montreal",
    name: "Canadian Grand Prix",
    officialName: "Formula 1 Grand Prix du Canada 2026",
    country: "Canada",
    city: "Montreal",
    startDate: "2026-05-22",
    endDate: "2026-05-24",
    isSprint: false,
    lengthKm: 4.361,
    laps: 70,
    turns: 14,
    sessions: createStandardSessions(2026, 5, 22, 23, 24, -4),
  },
  {
    round: 8,
    year: 2026,
    circuitId: "monaco",
    name: "Monaco Grand Prix",
    officialName: "Formula 1 Grand Prix de Monaco 2026",
    country: "Monaco",
    city: "Monte Carlo",
    startDate: "2026-06-05",
    endDate: "2026-06-07",
    isSprint: false,
    lengthKm: 3.337,
    laps: 78,
    turns: 19,
    sessions: createStandardSessions(2026, 6, 5, 6, 7, 2),
  },
  {
    round: 9,
    year: 2026,
    circuitId: "madrid",
    name: "Spanish Grand Prix",
    officialName: "Formula 1 Gran Premio de Espana Madrid 2026",
    country: "Spain",
    city: "Madrid",
    startDate: "2026-06-19",
    endDate: "2026-06-21",
    isSprint: false,
    lengthKm: 5.474,
    laps: 56,
    turns: 20,
    sessions: createStandardSessions(2026, 6, 19, 20, 21, 2),
  },
  {
    round: 10,
    year: 2026,
    circuitId: "austria",
    name: "Austrian Grand Prix",
    officialName: "Formula 1 Grosser Preis von Osterreich 2026",
    country: "Austria",
    city: "Spielberg",
    startDate: "2026-06-26",
    endDate: "2026-06-28",
    isSprint: true,
    lengthKm: 4.318,
    laps: 71,
    turns: 10,
    sessions: createSprintSessions(2026, 6, 26, 27, 28, 2),
  },
  {
    round: 11,
    year: 2026,
    circuitId: "silverstone",
    name: "British Grand Prix",
    officialName: "Formula 1 British Grand Prix 2026",
    country: "United Kingdom",
    city: "Silverstone",
    startDate: "2026-07-03",
    endDate: "2026-07-05",
    isSprint: false,
    lengthKm: 5.891,
    laps: 52,
    turns: 18,
    sessions: createStandardSessions(2026, 7, 3, 4, 5, 1),
  },
  {
    round: 12,
    year: 2026,
    circuitId: "spa",
    name: "Belgian Grand Prix",
    officialName: "Formula 1 Belgian Grand Prix 2026",
    country: "Belgium",
    city: "Spa-Francorchamps",
    startDate: "2026-07-24",
    endDate: "2026-07-26",
    isSprint: true,
    lengthKm: 7.004,
    laps: 44,
    turns: 19,
    sessions: createSprintSessions(2026, 7, 24, 25, 26, 2),
  },
  {
    round: 13,
    year: 2026,
    circuitId: "hungaroring",
    name: "Hungarian Grand Prix",
    officialName: "Formula 1 Hungarian Grand Prix 2026",
    country: "Hungary",
    city: "Budapest",
    startDate: "2026-07-31",
    endDate: "2026-08-02",
    isSprint: false,
    lengthKm: 4.381,
    laps: 70,
    turns: 14,
    sessions: createStandardSessions(2026, 7, 31, 1, 2, 2),
  },
  {
    round: 14,
    year: 2026,
    circuitId: "zandvoort",
    name: "Dutch Grand Prix",
    officialName: "Formula 1 Dutch Grand Prix 2026",
    country: "Netherlands",
    city: "Zandvoort",
    startDate: "2026-08-28",
    endDate: "2026-08-30",
    isSprint: false,
    lengthKm: 4.259,
    laps: 72,
    turns: 14,
    sessions: createStandardSessions(2026, 8, 28, 29, 30, 2),
  },
  {
    round: 15,
    year: 2026,
    circuitId: "monza",
    name: "Italian Grand Prix",
    officialName: "Formula 1 Gran Premio d'Italia 2026",
    country: "Italy",
    city: "Monza",
    startDate: "2026-09-04",
    endDate: "2026-09-06",
    isSprint: false,
    lengthKm: 5.793,
    laps: 53,
    turns: 11,
    sessions: createStandardSessions(2026, 9, 4, 5, 6, 2),
  },
  {
    round: 16,
    year: 2026,
    circuitId: "baku",
    name: "Azerbaijan Grand Prix",
    officialName: "Formula 1 Azerbaijan Grand Prix 2026",
    country: "Azerbaijan",
    city: "Baku",
    startDate: "2026-09-18",
    endDate: "2026-09-20",
    isSprint: false,
    lengthKm: 6.003,
    laps: 51,
    turns: 20,
    sessions: createStandardSessions(2026, 9, 18, 19, 20, 4),
  },
  {
    round: 17,
    year: 2026,
    circuitId: "singapore",
    name: "Singapore Grand Prix",
    officialName: "Formula 1 Singapore Grand Prix 2026",
    country: "Singapore",
    city: "Marina Bay",
    startDate: "2026-10-02",
    endDate: "2026-10-04",
    isSprint: false,
    lengthKm: 4.940,
    laps: 62,
    turns: 19,
    sessions: createStandardSessions(2026, 10, 2, 3, 4, 8),
  },
  {
    round: 18,
    year: 2026,
    circuitId: "cota",
    name: "United States Grand Prix",
    officialName: "Formula 1 United States Grand Prix 2026",
    country: "United States",
    city: "Austin",
    startDate: "2026-10-16",
    endDate: "2026-10-18",
    isSprint: true,
    lengthKm: 5.513,
    laps: 56,
    turns: 20,
    sessions: createSprintSessions(2026, 10, 16, 17, 18, -5),
  },
  {
    round: 19,
    year: 2026,
    circuitId: "mexico",
    name: "Mexico City Grand Prix",
    officialName: "Formula 1 Mexico City Grand Prix 2026",
    country: "Mexico",
    city: "Mexico City",
    startDate: "2026-10-23",
    endDate: "2026-10-25",
    isSprint: false,
    lengthKm: 4.304,
    laps: 71,
    turns: 17,
    sessions: createStandardSessions(2026, 10, 23, 24, 25, -6),
  },
  {
    round: 20,
    year: 2026,
    circuitId: "interlagos",
    name: "Sao Paulo Grand Prix",
    officialName: "Formula 1 Grande Premio de Sao Paulo 2026",
    country: "Brazil",
    city: "Sao Paulo",
    startDate: "2026-11-06",
    endDate: "2026-11-08",
    isSprint: true,
    lengthKm: 4.309,
    laps: 71,
    turns: 15,
    sessions: createSprintSessions(2026, 11, 6, 7, 8, -3),
  },
  {
    round: 21,
    year: 2026,
    circuitId: "lasvegas",
    name: "Las Vegas Grand Prix",
    officialName: "Formula 1 Las Vegas Grand Prix 2026",
    country: "United States",
    city: "Las Vegas",
    startDate: "2026-11-19",
    endDate: "2026-11-21",
    isSprint: false,
    lengthKm: 6.201,
    laps: 50,
    turns: 17,
    sessions: createStandardSessions(2026, 11, 19, 20, 21, -8),
  },
  {
    round: 22,
    year: 2026,
    circuitId: "lusail",
    name: "Qatar Grand Prix",
    officialName: "Formula 1 Qatar Grand Prix 2026",
    country: "Qatar",
    city: "Lusail",
    startDate: "2026-11-27",
    endDate: "2026-11-29",
    isSprint: true,
    lengthKm: 5.419,
    laps: 57,
    turns: 16,
    sessions: createSprintSessions(2026, 11, 27, 28, 29, 3),
  },
  {
    round: 23,
    year: 2026,
    circuitId: "yasmarina",
    name: "Abu Dhabi Grand Prix",
    officialName: "Formula 1 Abu Dhabi Grand Prix 2026",
    country: "United Arab Emirates",
    city: "Abu Dhabi",
    startDate: "2026-12-04",
    endDate: "2026-12-06",
    isSprint: false,
    lengthKm: 5.281,
    laps: 58,
    turns: 16,
    sessions: createStandardSessions(2026, 12, 4, 5, 6, 4),
  },
  {
    round: 24,
    year: 2026,
    circuitId: "barcelona",
    name: "Barcelona Grand Prix",
    officialName: "Formula 1 Gran Premio de Barcelona-Catalunya 2026",
    country: "Spain",
    city: "Barcelona",
    startDate: "2026-12-11",
    endDate: "2026-12-13",
    isSprint: false,
    lengthKm: 4.657,
    laps: 66,
    turns: 14,
    sessions: createStandardSessions(2026, 12, 11, 12, 13, 2),
  },
];

export const ALL_SEASONS: Record<number, GrandPrixRound[]> = {
  2025: CALENDAR_2025,
  2026: CALENDAR_2026,
};

export type CalendarStatus =
  | {
      mode: "LIVE_SESSION";
      round: GrandPrixRound;
      session: WeekendSession;
      elapsedMinutes: number;
      remainingMinutes: number;
    }
  | {
      mode: "OFF_TRACK";
      lastGrandPrix?: GrandPrixRound;
      nextGrandPrix?: GrandPrixRound;
      nextSession?: {
        round: GrandPrixRound;
        session: WeekendSession;
        startsInMs: number;
      };
    }
  | {
      mode: "HISTORICAL_REPLAY";
      replay: HistoricalReplayOption;
      round?: GrandPrixRound;
    };

/**
 * Deterministic calendar status resolver.
 * Evaluates current timestamp or user-selected replay option.
 * Zero random hallucinations: if no live session is actively on track,
 * returns OFF_TRACK with exact countdown to next official FIA session.
 */
export function getCalendarStatus(now: Date = new Date(), selectedReplayId?: string | null): CalendarStatus {
  if (selectedReplayId) {
    const replay = HISTORICAL_REPLAYS.find((r) => r.id === selectedReplayId) ?? HISTORICAL_REPLAYS[0];
    const round = CALENDAR_2025.find((c) => c.circuitId === replay.circuitId);
    return {
      mode: "HISTORICAL_REPLAY",
      replay,
      round,
    };
  }

  const nowMs = now.getTime();
  const year = now.getUTCFullYear();
  const calendar = ALL_SEASONS[year] ?? (year > 2025 ? CALENDAR_2026 : CALENDAR_2025);

  // Check for any currently active session
  for (const round of calendar) {
    for (const session of round.sessions) {
      const startMs = new Date(session.startUtc).getTime();
      const endMs = new Date(session.endUtc).getTime();
      if (nowMs >= startMs && nowMs <= endMs) {
        const elapsedMinutes = Math.floor((nowMs - startMs) / 60000);
        const remainingMinutes = Math.max(0, Math.floor((endMs - nowMs) / 60000));
        return {
          mode: "LIVE_SESSION",
          round,
          session,
          elapsedMinutes,
          remainingMinutes,
        };
      }
    }
  }

  // Find next upcoming session across calendar
  let nextSessionInfo: { round: GrandPrixRound; session: WeekendSession; startsInMs: number } | undefined;
  let lastRound: GrandPrixRound | undefined;
  let nextRound: GrandPrixRound | undefined;

  for (const round of calendar) {
    const roundEndMs = new Date(`${round.endDate}T23:59:59Z`).getTime();
    if (roundEndMs < nowMs) {
      lastRound = round;
    } else if (!nextRound) {
      nextRound = round;
    }

    for (const session of round.sessions) {
      const startMs = new Date(session.startUtc).getTime();
      if (startMs > nowMs) {
        if (!nextSessionInfo || startMs - nowMs < nextSessionInfo.startsInMs) {
          nextSessionInfo = {
            round,
            session,
            startsInMs: startMs - nowMs,
          };
        }
      }
    }
  }

  // If year has ended or not started yet, fall back gracefully
  if (!nextRound && calendar.length > 0) {
    nextRound = calendar[0];
  }
  if (!lastRound && calendar.length > 0) {
    lastRound = calendar[calendar.length - 1];
  }

  return {
    mode: "OFF_TRACK",
    lastGrandPrix: lastRound,
    nextGrandPrix: nextRound,
    nextSession: nextSessionInfo,
  };
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "NOW";
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return `${days}d ${hours % 24}h ${minutes % 60}m`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  }
  return `${minutes}m ${seconds % 60}s`;
}
