export type DominanceRow = {
  code: string;
  driverNumber?: number;
  color: string;
  team?: string;
  s1: number;
  s2: number;
  s3: number;
  total: number;
};

export type SectorStatus = "purple" | "green" | "amber" | "red";

export const STATUS_CONFIG: Record<
  SectorStatus,
  {
    cellClass: string;
    barClass: string;
    name: string;
  }
> = {
  purple: {
    cellClass: "bg-purple-950/40 text-purple-300 border-purple-500/40",
    barClass: "bg-[#a855f7]",
    name: "Fastest / Benchmark",
  },
  green: {
    cellClass: "bg-emerald-950/40 text-emerald-300 border-emerald-500/40",
    barClass: "bg-[#22c55e]",
    name: "Faster than Benchmark",
  },
  amber: {
    cellClass: "bg-amber-950/40 text-amber-300 border-amber-500/40",
    barClass: "bg-[#f59e0b]",
    name: "Normal Delta",
  },
  red: {
    cellClass: "bg-rose-950/40 text-rose-300 border-rose-500/40",
    barClass: "bg-[#ef4444]",
    name: "Severe Loss (>+0.12s)",
  },
};

export function getSectorStatus(
  val: number,
  minVal: number,
  isLeader: boolean
): SectorStatus {
  const isSessionFastest = val <= minVal + 0.0005;
  const isLeaderBenchmark = isLeader && val <= 0.0005;

  if (isSessionFastest || isLeaderBenchmark) {
    return "purple";
  }
  if (val < -0.0005) {
    return "green";
  }
  if (val > 0.12) {
    return "red";
  }
  return "amber";
}

export function getTotalStatus(total: number, isLeader: boolean): SectorStatus {
  if (isLeader) return "purple";
  if (total < -0.0005) return "green";
  if (total > 0.12) return "red";
  return "amber";
}

export function formatDelta(val: number, isLeaderBenchmark: boolean = false): string {
  if (isLeaderBenchmark || Math.abs(val) < 0.0005) return "0.000";
  const sign = val > 0 ? "+" : "";
  return `${sign}${val.toFixed(3)}`;
}

export type SectorBenchmarks = {
  minS1: number;
  minS2: number;
  minS3: number;
  s1Fastest: DominanceRow;
  s2Fastest: DominanceRow;
  s3Fastest: DominanceRow;
};