"use client";

// PitWall ML - Authentic FIA Formula 1 Open-Wheel Car Vector Illustrations
// High-fidelity top-down and side-profile SVG renders with verified 2025/2026 team liveries,
// aerodynamic ground-effect floors, Halo titanium safety rings, and Pirelli compound sidewalls.

export type TeamLivery = {
  primary: string;      // Main chassis bodywork
  secondary: string;    // Accent / sidepod highlight
  dark: string;         // Raw carbon fiber / undertray
  highlight: string;    // Detail line / wingtip
  halo: string;         // Titanium safety hoop
  helmet: string;       // Driver helmet primary
  visor: string;        // Helmet visor tint
};

export const TEAM_LIVERIES: Record<string, TeamLivery> = {
  "McLaren": {
    primary: "#ff8000",   // Papaya Orange
    secondary: "#141416", // Anthracite Carbon
    dark: "#0b0c0e",
    highlight: "#58b9ff", // Chrome Blue accent
    halo: "#1f2228",
    helmet: "#ff8000",
    visor: "#00d2be",
  },
  "Ferrari": {
    primary: "#e8002d",   // Scuderia Red
    secondary: "#fff200", // Modena Yellow stripe
    dark: "#0a0a0c",
    highlight: "#ffffff",
    halo: "#1a1b1e",
    helmet: "#e8002d",
    visor: "#1e293b",
  },
  "Red Bull": {
    primary: "#142448",   // Matte Navy Blue
    secondary: "#fcd34d", // Yellow nose ring
    dark: "#080f1d",
    highlight: "#ef4444", // Bull Red
    halo: "#142448",
    helmet: "#142448",
    visor: "#f59e0b",
  },
  "Red Bull Racing": {
    primary: "#142448",
    secondary: "#fcd34d",
    dark: "#080f1d",
    highlight: "#ef4444",
    halo: "#142448",
    helmet: "#142448",
    visor: "#f59e0b",
  },
  "Mercedes": {
    primary: "#d1d5db",   // Silver / Chrome
    secondary: "#00d2be", // Petronas Teal
    dark: "#0f172a",
    highlight: "#00d2be",
    halo: "#111827",
    helmet: "#00d2be",
    visor: "#38bdf8",
  },
  "Aston Martin": {
    primary: "#00594f",   // British Racing Green
    secondary: "#cedc00", // Lime Essence
    dark: "#061f1c",
    highlight: "#cedc00",
    halo: "#0f2e29",
    helmet: "#00594f",
    visor: "#cbd5e1",
  },
  "Alpine": {
    primary: "#0093cc",   // Alpine Blue
    secondary: "#fd4bc7", // BWT Pink
    dark: "#0b1219",
    highlight: "#fd4bc7",
    halo: "#111827",
    helmet: "#0093cc",
    visor: "#fd4bc7",
  },
  "Williams": {
    primary: "#005aff",   // Heritage Blue
    secondary: "#00a0dd", // Electric Blue
    dark: "#051630",
    highlight: "#ffffff",
    halo: "#0d2240",
    helmet: "#005aff",
    visor: "#e2e8f0",
  },
  "Haas": {
    primary: "#f8fafc",   // Pure White
    secondary: "#dc2626", // Racing Red
    dark: "#1e293b",
    highlight: "#dc2626",
    halo: "#1e293b",
    helmet: "#dc2626",
    visor: "#38bdf8",
  },
  "Racing Bulls": {
    primary: "#1634cf",   // Royal Blue
    secondary: "#ffffff", // White stripe
    dark: "#081347",
    highlight: "#ef4444",
    halo: "#1634cf",
    helmet: "#ffffff",
    visor: "#f59e0b",
  },
  "RB": {
    primary: "#1634cf",
    secondary: "#ffffff",
    dark: "#081347",
    highlight: "#ef4444",
    halo: "#1634cf",
    helmet: "#ffffff",
    visor: "#f59e0b",
  },
  "Sauber": {
    primary: "#52e252",   // Kick Neon Green
    secondary: "#0a0a0a", // Stealth Carbon
    dark: "#050505",
    highlight: "#52e252",
    halo: "#0f0f0f",
    helmet: "#52e252",
    visor: "#0a0a0a",
  },
  "Audi": {
    primary: "#52e252",
    secondary: "#0a0a0a",
    dark: "#050505",
    highlight: "#52e252",
    halo: "#0f0f0f",
    helmet: "#52e252",
    visor: "#0a0a0a",
  },
  "Sauber/Audi": {
    primary: "#52e252",
    secondary: "#0a0a0a",
    dark: "#050505",
    highlight: "#52e252",
    halo: "#0f0f0f",
    helmet: "#52e252",
    visor: "#0a0a0a",
  },
  "Cadillac": {
    primary: "#c9a86a",   // Cadillac Gold
    secondary: "#18181b", // Matte Carbon
    dark: "#09090b",
    highlight: "#ef4444",
    halo: "#27272a",
    helmet: "#c9a86a",
    visor: "#ef4444",
  },
};

// Legacy fallback map for backward compatibility
export const TEAM_LIVERY: Record<string, string> = Object.fromEntries(
  Object.entries(TEAM_LIVERIES).map(([k, v]) => [k, v.primary])
);

export type SizeProp = number | "sm" | "md" | "lg";
export type Compound = "S" | "M" | "H" | "I" | "W";

const COMPOUND_COLORS: Record<Compound, string> = {
  S: "#ef4444", // Soft (Red)
  M: "#eab308", // Medium (Yellow)
  H: "#ffffff", // Hard (White)
  I: "#22c55e", // Intermediate (Green)
  W: "#3b82f6", // Wet (Blue)
};

export function getTeamLivery(team?: string): TeamLivery {
  if (!team) return TEAM_LIVERIES["Red Bull"];
  return TEAM_LIVERIES[team] ?? TEAM_LIVERIES["Red Bull"];
}

export function getTeamColor(team?: string): string {
  return getTeamLivery(team).primary;
}

function resolvePixelSize(size?: SizeProp, fallback = 88): number {
  if (typeof size === "number") return size;
  if (size === "sm") return 48;
  if (size === "lg") return 140;
  return fallback;
}

/**
 * Authentic Top-Down Open-Wheel Formula 1 Race Car Render
 * Includes tapered nosecone, front wing with endplates, suspension wishbones,
 * Halo titanium cockpit ring, driver helmet, sidepod intakes, airbox roll hoop,
 * floor edge vortex strakes, rear wing DRS assembly, and Pirelli slick tyres.
 */
export function CarTopView({
  team = "Red Bull",
  size = 88,
  compound = "M",
}: {
  team?: string;
  size?: SizeProp;
  compound?: Compound;
}) {
  const pixelHeight = resolvePixelSize(size, 88);
  const pixelWidth = pixelHeight * 2.2;
  const livery = getTeamLivery(team);
  const tyreStripe = COMPOUND_COLORS[compound] ?? COMPOUND_COLORS.M;

  return (
    <svg
      width={pixelWidth}
      height={pixelHeight}
      viewBox="0 0 400 160"
      className="shrink-0 drop-shadow-lg select-none"
      role="img"
      aria-label={`${team} Formula 1 Car - Top View`}
    >
      <defs>
        {/* Carbon fiber undertray gradient */}
        <linearGradient id={`carbon-${livery.primary.replace("#", "")}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#080c14" />
          <stop offset="50%" stopColor="#172033" />
          <stop offset="100%" stopColor="#080c14" />
        </linearGradient>
        {/* Tyre tread gradient */}
        <linearGradient id="tyreTread" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#111827" />
          <stop offset="50%" stopColor="#243046" />
          <stop offset="100%" stopColor="#111827" />
        </linearGradient>
      </defs>

      {/* 1. Ground Effect Floor / Venturi Edge Strakes */}
      <path
        d="M 160 38 L 290 38 Q 315 38 325 55 L 325 105 Q 315 122 290 122 L 160 122 Q 145 105 145 80 Q 145 55 160 38 Z"
        fill={`url(#carbon-${livery.primary.replace("#", "")})`}
        stroke="#1e293b"
        strokeWidth={1.5}
      />
      {/* Floor edge vortex slits */}
      <line x1={180} y1={36} x2={270} y2={36} stroke={livery.highlight} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.8} />
      <line x1={180} y1={124} x2={270} y2={124} stroke={livery.highlight} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.8} />

      {/* 2. Front Suspension Wishbones (Carbon arms) */}
      <line x1={80} y1={76} x2={105} y2={28} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={115} y1={76} x2={105} y2={28} stroke="#475569" strokeWidth={1.8} strokeLinecap="round" />
      <line x1={80} y1={84} x2={105} y2={132} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={115} y1={84} x2={105} y2={132} stroke="#475569" strokeWidth={1.8} strokeLinecap="round" />

      {/* 3. Rear Suspension Wishbones */}
      <line x1={295} y1={76} x2={325} y2={28} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={330} y1={78} x2={325} y2={28} stroke="#475569" strokeWidth={1.8} strokeLinecap="round" />
      <line x1={295} y1={84} x2={325} y2={132} stroke="#334155" strokeWidth={2.2} strokeLinecap="round" />
      <line x1={330} y1={82} x2={325} y2={132} stroke="#475569" strokeWidth={1.8} strokeLinecap="round" />

      {/* 4. Front Wheels / Tyres (Open-Wheel Pirelli Slicks) */}
      {/* Front Left */}
      <rect x={82} y={14} width={46} height={26} rx={5} fill="url(#tyreTread)" stroke="#090d16" strokeWidth={1.5} />
      <circle cx={105} cy={27} r={6} fill="#0f172a" stroke="#475569" strokeWidth={1.5} />
      <ellipse cx={105} cy={27} rx={16} ry={9} fill="none" stroke={tyreStripe} strokeWidth={1.2} opacity={0.9} />
      {/* Front Right */}
      <rect x={82} y={120} width={46} height={26} rx={5} fill="url(#tyreTread)" stroke="#090d16" strokeWidth={1.5} />
      <circle cx={105} cy={133} r={6} fill="#0f172a" stroke="#475569" strokeWidth={1.5} />
      <ellipse cx={105} cy={133} rx={16} ry={9} fill="none" stroke={tyreStripe} strokeWidth={1.2} opacity={0.9} />

      {/* 5. Rear Wheels / Tyres (Wide 405mm Pirelli Slicks) */}
      {/* Rear Left */}
      <rect x={300} y={10} width={52} height={32} rx={6} fill="url(#tyreTread)" stroke="#090d16" strokeWidth={1.5} />
      <circle cx={326} cy={26} r={7} fill="#0f172a" stroke="#475569" strokeWidth={1.5} />
      <ellipse cx={326} cy={26} rx={19} ry={11} fill="none" stroke={tyreStripe} strokeWidth={1.4} opacity={0.9} />
      {/* Rear Right */}
      <rect x={300} y={118} width={52} height={32} rx={6} fill="url(#tyreTread)" stroke="#090d16" strokeWidth={1.5} />
      <circle cx={326} cy={134} r={7} fill="#0f172a" stroke="#475569" strokeWidth={1.5} />
      <ellipse cx={326} cy={134} rx={19} ry={11} fill="none" stroke={tyreStripe} strokeWidth={1.4} opacity={0.9} />

      {/* 6. Aerodynamic Front Wing Assembly */}
      {/* Flaps */}
      <path d="M 24 16 L 38 18 L 48 40 L 40 78 L 40 82 L 48 120 L 38 142 L 24 144 Z" fill={livery.secondary} opacity={0.95} />
      <path d="M 28 20 L 42 22 L 52 48 L 44 80 L 52 112 L 42 138 L 28 140 Z" fill={livery.primary} />
      {/* Wing endplates */}
      <rect x={20} y={14} width={26} height={5} rx={2} fill={livery.dark} stroke={livery.highlight} strokeWidth={0.8} />
      <rect x={20} y={141} width={26} height={5} rx={2} fill={livery.dark} stroke={livery.highlight} strokeWidth={0.8} />

      {/* 7. Main Monocoque Chassis & Nosecone */}
      <path
        d="M 22 80 Q 24 74 55 73 L 135 70 Q 155 52 180 50 L 265 52 Q 295 56 315 74 L 340 76 L 340 84 L 315 86 Q 295 104 265 108 L 180 110 Q 155 108 135 90 L 55 87 Q 24 86 22 80 Z"
        fill={livery.primary}
        stroke="#080c14"
        strokeWidth={1.5}
      />

      {/* Sidepod Undercuts & Livery Accents */}
      <path d="M 180 52 L 260 54 Q 285 58 295 72 L 270 72 Q 245 58 180 56 Z" fill={livery.secondary} opacity={0.9} />
      <path d="M 180 108 L 260 106 Q 285 102 295 88 L 270 88 Q 245 102 180 104 Z" fill={livery.secondary} opacity={0.9} />

      {/* Radiator air intakes */}
      <path d="M 172 54 L 182 54 L 180 66 L 170 65 Z" fill="#000000" />
      <path d="M 172 106 L 182 106 L 180 94 L 170 95 Z" fill="#000000" />

      {/* 8. Cockpit & Driver */}
      {/* Cockpit opening */}
      <ellipse cx={185} cy={80} rx={28} ry={13} fill="#050811" stroke="#1e293b" strokeWidth={1.2} />
      {/* Driver helmet */}
      <circle cx={188} cy={80} r={8.5} fill={livery.helmet} stroke="#0f172a" strokeWidth={1} />
      <rect x={183} y={75} width={9} height={4} rx={1.5} fill={livery.visor} />

      {/* 9. Titanium Halo Safety Ring */}
      <path
        d="M 164 80 L 178 80 M 178 80 Q 186 69 204 69 Q 218 69 218 80 Q 218 91 204 91 Q 186 91 178 80"
        fill="none"
        stroke={livery.halo}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Halo highlight glow */}
      <path
        d="M 180 79 Q 187 71 204 71 Q 216 71 216 80 Q 216 89 204 89 Q 187 89 180 81"
        fill="none"
        stroke={livery.highlight}
        strokeWidth={0.8}
        opacity={0.8}
      />

      {/* 10. Engine Airbox & Shark Fin Spine */}
      {/* Triangular Airbox intake */}
      <polygon points="214,75 224,72 224,88 214,85" fill="#0f172a" stroke="#334155" strokeWidth={1} />
      {/* Longitudinal Shark Fin Spine */}
      <line x1={224} y1={80} x2={330} y2={80} stroke={livery.secondary} strokeWidth={2.8} strokeLinecap="round" />
      <line x1={235} y1={80} x2={325} y2={80} stroke={livery.highlight} strokeWidth={1} strokeLinecap="round" />

      {/* 11. Rear Wing & DRS Assembly */}
      {/* Dual element mainplanes */}
      <rect x={352} y={34} width={14} height={92} rx={3} fill={livery.secondary} stroke="#090d16" strokeWidth={1.2} />
      <rect x={368} y={32} width={8} height={96} rx={2} fill={livery.primary} stroke={livery.highlight} strokeWidth={0.8} />
      {/* Endplates */}
      <rect x={348} y={28} width={30} height={4} rx={1.5} fill={livery.dark} />
      <rect x={348} y={128} width={30} height={4} rx={1.5} fill={livery.dark} />
      {/* Center DRS actuator pod */}
      <rect x={360} y={76} width={14} height={8} rx={2} fill="#ef4444" opacity={0.9} />
    </svg>
  );
}

/**
 * Authentic Side-Profile Open-Wheel Formula 1 Race Car Render
 * Low-slung ground-effect stance, front wing cascade, curved nose, stepped floor edge,
 * Halo titanium hoop, sculpted sidepod undercut, engine cover shark fin, dual-element rear wing,
 * and rear diffuser exit.
 */
export function CarSideView({
  team = "Red Bull",
  size = 88,
  compound = "M",
}: {
  team?: string;
  size?: SizeProp;
  compound?: Compound;
}) {
  const pixelHeight = resolvePixelSize(size, 88);
  const pixelWidth = pixelHeight * 2.4;
  const livery = getTeamLivery(team);
  const tyreStripe = COMPOUND_COLORS[compound] ?? COMPOUND_COLORS.M;

  return (
    <svg
      width={pixelWidth}
      height={pixelHeight}
      viewBox="0 0 440 140"
      className="shrink-0 drop-shadow-lg select-none"
      role="img"
      aria-label={`${team} Formula 1 Car - Side Profile`}
    >
      <defs>
        <linearGradient id={`chassisGrad-${livery.primary.replace("#", "")}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={livery.primary} />
          <stop offset="65%" stopColor={livery.primary} />
          <stop offset="100%" stopColor={livery.secondary} />
        </linearGradient>
        <linearGradient id="tyreSideGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#1f293d" />
          <stop offset="100%" stopColor="#0b0f17" />
        </linearGradient>
      </defs>

      {/* 1. Track reference line */}
      <line x1={10} y1={118} x2={430} y2={118} stroke="#1e293b" strokeWidth={1.5} strokeDasharray="8 6" opacity={0.4} />

      {/* 2. Ground Effect Floor & Rear Diffuser Kickup */}
      <path
        d="M 125 114 L 330 114 L 375 94 L 380 98 L 335 116 L 125 116 Z"
        fill="#090d16"
        stroke="#1e293b"
        strokeWidth={1.2}
      />

      {/* 3. Aerodynamic Front Wing Assembly */}
      {/* Endplate */}
      <path d="M 22 108 L 68 108 Q 74 100 70 88 L 32 88 Q 20 92 22 108 Z" fill={livery.dark} stroke={livery.highlight} strokeWidth={0.8} />
      {/* Cascade flaps */}
      <path d="M 34 102 L 64 100 L 62 94 L 36 96 Z" fill={livery.primary} />
      <path d="M 38 94 L 62 92 L 60 88 L 40 90 Z" fill={livery.secondary} />

      {/* 4. Front Suspension Arm Shadows */}
      <line x1={80} y1={92} x2={108} y2={86} stroke="#334155" strokeWidth={2.4} strokeLinecap="round" />
      <line x1={82} y1={82} x2={108} y2={86} stroke="#475569" strokeWidth={2} strokeLinecap="round" />

      {/* 5. Main Aerodynamic Chassis Silhouette */}
      <path
        d="M 64 94 Q 100 86 130 80 L 175 75 Q 195 55 215 50 L 235 48 Q 248 48 250 56 L 255 64 Q 285 64 340 78 L 360 88 L 360 102 L 315 106 Q 235 106 175 102 L 140 102 Q 105 104 64 94 Z"
        fill={`url(#chassisGrad-${livery.primary.replace("#", "")})`}
        stroke="#080c14"
        strokeWidth={1.5}
      />

      {/* Sidepod Undercut Sculpting & Highlight Line */}
      <path
        d="M 175 76 Q 220 78 280 84 Q 315 88 335 96 L 315 104 Q 230 102 175 100 Z"
        fill={livery.secondary}
        opacity={0.85}
      />
      <path
        d="M 180 78 Q 225 80 280 85"
        fill="none"
        stroke={livery.highlight}
        strokeWidth={1.5}
        strokeLinecap="round"
      />

      {/* 6. Engine Cover Shark Fin */}
      <polygon
        points="235,48 355,56 355,80 255,64"
        fill={livery.secondary}
        stroke="#090d16"
        strokeWidth={1}
        opacity={0.92}
      />
      <line x1={240} y1={48} x2={355} y2={56} stroke={livery.highlight} strokeWidth={1.4} />

      {/* 7. Driver Helmet inside Cockpit */}
      <circle cx={202} cy={64} r={8.5} fill={livery.helmet} stroke="#0f172a" strokeWidth={1} />
      <polygon points="196,62 205,62 203,66 195,65" fill={livery.visor} />

      {/* 8. Titanium Halo Safety Hoop */}
      <path
        d="M 175 74 Q 185 58 208 58 L 225 59"
        fill="none"
        stroke={livery.halo}
        strokeWidth={3.5}
        strokeLinecap="round"
      />
      <path
        d="M 176 74 Q 186 59 208 59 L 225 60"
        fill="none"
        stroke={livery.highlight}
        strokeWidth={1}
        strokeLinecap="round"
      />

      {/* 9. Rear Wing Assembly & Swan-Neck Pylon */}
      {/* Swan-neck mount */}
      <path d="M 345 78 Q 360 62 375 52 L 375 60" fill="none" stroke="#334155" strokeWidth={3} strokeLinecap="round" />
      {/* Endplate */}
      <path d="M 372 44 L 406 44 L 402 96 L 378 96 Z" fill={livery.dark} stroke={livery.highlight} strokeWidth={0.8} />
      {/* Mainplane & DRS Flap */}
      <rect x={366} y={48} width={38} height={5} rx={1.5} fill={livery.primary} />
      <rect x={368} y={56} width={34} height={4} rx={1.5} fill={livery.secondary} />
      {/* FIA Rain light */}
      <rect x={372} y={100} width={4} height={6} rx={1} fill="#ef4444" opacity={0.9} />

      {/* 10. Front Wheel Assembly (18-Inch Pirelli Slick) */}
      <g>
        {/* Tyre Rubber */}
        <circle cx={108} cy={86} r={28} fill="url(#tyreSideGrad)" stroke="#090d16" strokeWidth={2} />
        {/* Sidewall Compound Color Ring */}
        <circle cx={108} cy={86} r={23} fill="none" stroke={tyreStripe} strokeWidth={2.2} opacity={0.95} />
        {/* Wheel Rim & Aerodynamic Wheel Cover */}
        <circle cx={108} cy={86} r={17} fill="#0a0f1d" stroke="#334155" strokeWidth={1.5} />
        <circle cx={108} cy={86} r={6} fill="#1e293b" stroke="#475569" strokeWidth={1.5} />
      </g>

      {/* 11. Rear Wheel Assembly (Wide Pirelli Slick) */}
      <g>
        {/* Tyre Rubber */}
        <circle cx={346} cy={86} r={29} fill="url(#tyreSideGrad)" stroke="#090d16" strokeWidth={2} />
        {/* Sidewall Compound Color Ring */}
        <circle cx={346} cy={86} r={24} fill="none" stroke={tyreStripe} strokeWidth={2.4} opacity={0.95} />
        {/* Wheel Rim & Aerodynamic Wheel Cover */}
        <circle cx={346} cy={86} r={18} fill="#0a0f1d" stroke="#334155" strokeWidth={1.5} />
        <circle cx={346} cy={86} r={6.5} fill="#1e293b" stroke="#475569" strokeWidth={1.5} />
      </g>
    </svg>
  );
}

/**
 * Universal Car Render wrapper
 */
export function CarRender({
  team = "Red Bull",
  size = 88,
  view = "top",
  compound = "M",
}: {
  team?: string;
  size?: SizeProp;
  view?: "top" | "side";
  compound?: Compound;
}) {
  return view === "side" ? (
    <CarSideView team={team} size={size} compound={compound} />
  ) : (
    <CarTopView team={team} size={size} compound={compound} />
  );
}

export default CarRender;
