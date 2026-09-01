"use client";

export const TEAM_LIVERY: Record<string, string> = {
  "Red Bull": "#3671c6",
  "Red Bull Racing": "#3671c6",
  McLaren: "#ff8000",
  Ferrari: "#e8002d",
  Mercedes: "#00d2be",
  "Aston Martin": "#229971",
  Alpine: "#0093cc",
  Williams: "#64c4ff",
  Haas: "#b6babd",
  "Racing Bulls": "#6692ff",
  RB: "#6692ff",
  Sauber: "#52e252",
  Audi: "#52e252",
  "Sauber/Audi": "#52e252",
  Cadillac: "#c9a86a",
};

export type SizeProp = number | "sm" | "md" | "lg";

function parseSize(s?: SizeProp): number {
  if (typeof s === "number") return s;
  if (s === "sm") return 48;
  if (s === "lg") return 120;
  return 88; // "md" or default
}

export function getTeamColor(team?: string): string {
  if (!team) return "#1e293b";
  return TEAM_LIVERY[team] ?? "#3671c6";
}

export function CarTopView({
  team = "Red Bull",
  size = 88,
}: {
  team?: string;
  size?: SizeProp;
}) {
  const numSize = parseSize(size);
  const c = getTeamColor(team);
  return (
    <svg width={numSize * 1.8} height={numSize} viewBox="0 0 180 88" className="shrink-0">
      <rect x={60} y={30} width={60} height={28} rx={6} fill={c} stroke="#080c14" strokeWidth={2} />
      <rect x={28} y={34} width={32} height={20} rx={3} fill={c} opacity={0.9} />
      <rect x={120} y={34} width={32} height={20} rx={3} fill={c} opacity={0.9} />
      <rect x={72} y={18} width={36} height={12} rx={4} fill="#0f172a" stroke={c} strokeWidth={1.2} />
      <circle cx={48} cy={62} r={10} fill="#0f172a" stroke="#334155" strokeWidth={2} />
      <circle cx={132} cy={62} r={10} fill="#0f172a" stroke="#334155" strokeWidth={2} />
      <circle cx={48} cy={62} r={4} fill={c} />
      <circle cx={132} cy={62} r={4} fill={c} />
    </svg>
  );
}

export function CarSideView({
  team = "Red Bull",
  size = 88,
}: {
  team?: string;
  size?: SizeProp;
}) {
  const numSize = parseSize(size);
  const c = getTeamColor(team);
  return (
    <svg width={numSize * 2} height={numSize} viewBox="0 0 200 88" className="shrink-0">
      <path
        d="M 20 50 L 50 30 L 110 28 L 150 34 L 175 48 L 160 62 L 30 62 Z"
        fill={c}
        stroke="#080c14"
        strokeWidth={1.5}
      />
      <circle cx={50} cy={62} r={12} fill="#0f172a" stroke="#334155" strokeWidth={2} />
      <circle cx={140} cy={62} r={12} fill="#0f172a" stroke="#334155" strokeWidth={2} />
      <rect x={70} y={32} width={40} height={14} rx={3} fill="#0f172a" stroke={c} strokeWidth={1} />
    </svg>
  );
}

export function CarRender({
  team = "Red Bull",
  size = 88,
  view = "top",
}: {
  team?: string;
  size?: SizeProp;
  view?: "top" | "side";
}) {
  return view === "side" ? (
    <CarSideView team={team} size={size} />
  ) : (
    <CarTopView team={team} size={size} />
  );
}
