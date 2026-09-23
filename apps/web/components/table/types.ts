export type Pace = {
  q10?: number;
  q50?: number;
  q90?: number;
};

export type PitHazard = {
  p1: number;
  p3: number;
  p5: number;
};

export type FinishingDist = {
  p1: number;
  podium: number;
  points: number;
};

export type RaceRow = {
  driver_number?: number;
  position?: number;
  code?: string;
  name?: string;
  team?: string;
  color?: string;
  image?: string;
  gap?: string;
  gapToLeader?: string;
  gapToAhead?: string;
  gapToLeaderSeconds?: number;
  gapToAheadSeconds?: number;
  gapDelta?: number;
  drs?: boolean;
  tyre?: "S" | "M" | "H" | "I" | "W";
  tyreAge?: number;
  tyreWear?: number;
  forecast?: string;
  pace?: Pace;
  interval?: string;
  pitProb?: number;
  pit?: PitHazard;
  finishing?: FinishingDist;
  stintLaps?: number[];
  pitStopLaps?: number[];
  sectorTimes?: { s1?: number; s2?: number; s3?: number };
  lastLap?: string;
};

export type EnrichedRow = RaceRow & {
  rowKey: string;
  info: {
    name?: string;
    code?: string;
    team?: string;
    color: string;
    image?: string;
  };
  paceVal: Pace | null;
  pitVal: PitHazard | null;
  finishingVal: FinishingDist | null;
  sectorTimesVal: { s1?: number; s2?: number; s3?: number } | null;
};
