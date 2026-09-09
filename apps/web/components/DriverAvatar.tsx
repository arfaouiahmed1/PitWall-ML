"use client";

import { useEffect, useState } from "react";
import { getTeamColor } from "@/lib/drivers";

export type DriverAvatarProps = {
  src?: string | null;
  name: string;
  code: string;
  number: number;
  color?: string;
  team?: string;
  size?: number; // diameter in pixels (default 32)
  className?: string;
};

/**
 * HelmetSvgFallback
 * Crisp vector Formula 1 aerodynamic racing helmet silhouette styled in
 * the driver's authentic team livery, featuring aerodynamic visor reflection,
 * chin spoiler, HANS tether clips, and an integrated driver number badge.
 */
function HelmetSvgFallback({
  code,
  number,
  color,
  size = 32,
}: {
  code: string;
  number: number;
  color: string;
  size?: number;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className="shrink-0 select-none overflow-visible"
      role="img"
      aria-label={`${code} #${number} Helmet`}
    >
      <defs>
        <linearGradient id={`helmet-grad-${number}`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="70%" stopColor={color} />
          <stop offset="100%" stopColor="#080c14" />
        </linearGradient>
        <linearGradient id={`visor-grad-${number}`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#0a0f1d" />
          <stop offset="40%" stopColor="#1e293b" />
          <stop offset="100%" stopColor="#0a0f1d" />
        </linearGradient>
      </defs>

      {/* Outer helmet background glow */}
      <circle cx={32} cy={32} r={30} fill="#080c14" stroke="#1e293b" strokeWidth={1.5} />

      {/* Aerodynamic helmet outer shell */}
      <path
        d="M 16 38 C 14 24, 22 12, 36 12 C 48 12, 53 20, 53 32 C 53 42, 46 48, 38 49 L 24 49 C 18 49, 16 44, 16 38 Z"
        fill={`url(#helmet-grad-${number})`}
        stroke="#0f172a"
        strokeWidth={1.5}
      />

      {/* Top ventilation dome stripe */}
      <path
        d="M 26 14 C 33 13, 42 15, 47 21"
        fill="none"
        stroke="#ffffff"
        strokeWidth={1.8}
        opacity={0.4}
        strokeLinecap="round"
      />

      {/* Dark tinted racing visor with chin aperture */}
      <path
        d="M 17 31 C 18 26, 23 23, 33 23 L 44 24 C 47 24, 48 26, 48 29 L 45 36 C 44 38, 41 39, 36 39 L 20 38 C 18 38, 17 35, 17 31 Z"
        fill={`url(#visor-grad-${number})`}
        stroke="#334155"
        strokeWidth={1}
      />

      {/* Visor aerodynamic highlight reflection */}
      <path
        d="M 22 26 L 41 27"
        fill="none"
        stroke="#38bdf8"
        strokeWidth={1.2}
        opacity={0.7}
        strokeLinecap="round"
      />

      {/* Lower chin air intake vent */}
      <line x1={20} y1={44} x2={27} y2={44} stroke="#0f172a" strokeWidth={2} strokeLinecap="round" />

      {/* Driver code / number badge pill at bottom-right */}
      <g transform="translate(36, 42)">
        <rect x={-2} y={-1} width={28} height={19} rx={5} fill="#080c14" stroke={color} strokeWidth={1.5} />
        <text
          x={12}
          y={13}
          textAnchor="middle"
          fontSize={11}
          fontWeight={900}
          fontFamily="monospace"
          fill="#ffffff"
        >
          {number}
        </text>
      </g>
    </svg>
  );
}

/**
 * Resilient Driver Avatar Component
 * Displays the high-resolution official driver headshot if available and valid.
 * Automatically falls back to a team-colored aerodynamic helmet vector with
 * the driver's number badge upon any load error, network failure, or missing source,
 * completely eliminating broken image placeholders and truncated alt text.
 */
export function DriverAvatar({
  src,
  name,
  code,
  number,
  color,
  team,
  size = 32,
  className = "",
}: DriverAvatarProps) {
  const [hasError, setHasError] = useState(false);
  const teamColor = color ?? getTeamColor(team ?? "");

  // Reset error state whenever image source changes
  useEffect(() => {
    setHasError(false);
  }, [src]);

  const showFallback = hasError || !src || src.trim() === "";

  if (showFallback) {
    return (
      <div
        className={`inline-flex items-center justify-center shrink-0 rounded-full ${className}`}
        style={{ width: size, height: size }}
      >
        <HelmetSvgFallback code={code} number={number} color={teamColor} size={size} />
      </div>
    );
  }

  return (
    <div
      className={`relative inline-flex items-center justify-center shrink-0 rounded-full overflow-hidden border border-[#334155] bg-[#080c14] ${className}`}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        aria-label={`${name} (${code})`}
        width={size}
        height={size}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setHasError(true)}
        className="w-full h-full object-cover rounded-full"
      />
    </div>
  );
}

export default DriverAvatar;
