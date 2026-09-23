import type { GapTrajectoryPoint, LegacyGapPoint } from "@/lib/types";

export type { GapTrajectoryPoint, LegacyGapPoint };

export interface GapTrajectoryChartProps {
  points?: (GapTrajectoryPoint | LegacyGapPoint)[];
  data?: (GapTrajectoryPoint | LegacyGapPoint)[];
  className?: string;
  height?: number | string;
  baselineLabel?: string;
  whatifLabel?: string;
  title?: string;
  showLegend?: boolean;
  showZeroAxis?: boolean;
  ariaLabel?: string;
}

export const GAP_CHART_LAYOUT = {
  viewBoxW: 560,
  viewBoxH: 140,
  padLeft: 46,
  padRight: 22,
  padTop: 18,
  padBottom: 28,
} as const;
