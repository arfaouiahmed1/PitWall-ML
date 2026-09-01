"use client";

import { useMemo, useState } from "react";
import { DRIVER_FALLBACK } from "@/lib/drivers";

export type TracePoint = {
  distance: number; // 0-100% of lap
  speed: number; // km/h
  throttle: number; // 0-100
  brake: number; // 0-100
  gear: number; // 1-8
  drs: boolean;
};

type DriverOpt = { number: number; code: string; color: string };

const DRIVER_OPTS: DriverOpt[] = Object.entries(DRIVER_FALLBACK).map(([num, info]) => ({
  number: Number(num),
  code: info.code,
  color: info.color,
})).slice(0, 8);

function synthTrace(seed: number, offset: number): TracePoint[] {
  const pts: TracePoint[] = [];
  for (let d = 0; d <= 100; d += 2) {
    // speed profile: high on straights, low in corners
    const corner = Math.sin((d / 100) * Math.PI * 6 + seed) * 0.5 + 0.5;
    const straightBoost = d > 12 && d < 28 ? 0.9 : d > 58 && d < 78 ? 0.85 : 0;
    const speed = 88 + corner * -42 + straightBoost * 62 + Math.sin(d * 0.3 + seed) * 4 + offset;
    const throttle = d > 15 && d < 30 ? 100 : corner < 0.3 ? 28 : 78 + Math.random() * 18;
    const brake = corner < 0.22 && d % 18 < 7 ? 88 - corner * 60 : Math.random() * 8;
    const gear = speed > 285 ? 8 : speed > 255 ? 7 : speed > 210 ? 6 : speed > 165 ? 5 : speed > 125 ? 4 : 3;
    const drs = (d > 14 && d < 28) || (d > 60 && d < 77);
    pts.push({
      distance: d,
      speed: Math.max(78, Math.min(348, Math.round(speed))),
      throttle: Math.round(Math.max(0, Math.min(100, throttle))),
      brake: Math.round(Math.max(0, Math.min(100, brake))),
      gear,
      drs,
    });
  }
  return pts;
}

function pathFor(values: number[], min: number, max: number, w: number, h: number, padL: number, padR: number, padT: number, padB: number): string {
  const plotW = w - padL - padR, plotH = h - padT - padB;
  const span = max - min || 1;
  return values.map((v, i) => {
    const x = padL + (i / (values.length - 1)) * plotW;
    const y = padT + (1 - (v - min) / span) * plotH;
    return `${i === 0 ? "M" : "L"} ${x} ${y}`;
  }).join(" ");
}

export function TelemetryOverlay({
  driverA: driverAProp,
  driverB: driverBProp,
  driver1Num,
  driver2Num,
  dataA,
  dataB,
}: {
  driverA?: number;
  driverB?: number;
  driver1Num?: number;
  driver2Num?: number;
  dataA?: TracePoint[];
  dataB?: TracePoint[];
}) {
  const [aNum, setANum] = useState<number>(driverAProp ?? driver1Num ?? 4);
  const [bNum, setBNum] = useState<number>(driverBProp ?? driver2Num ?? 1);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const aInfo = DRIVER_FALLBACK[aNum] ?? DRIVER_FALLBACK[4];
  const bInfo = DRIVER_FALLBACK[bNum] ?? DRIVER_FALLBACK[1];

  const traceA = useMemo(() => dataA ?? synthTrace(aNum * 0.7, 0), [dataA, aNum]);
  const traceB = useMemo(() => dataB ?? synthTrace(bNum * 0.7, -4), [dataB, bNum]);

  // corner delta analysis (aggregate)
  const cornerDelta = useMemo(() => {
    const apexA = Math.min(...traceA.map((p) => p.speed));
    const apexB = Math.min(...traceB.map((p) => p.speed));
    const maxA = Math.max(...traceA.map((p) => p.speed));
    const maxB = Math.max(...traceB.map((p) => p.speed));
    // brake point distance delta — approximate by where brake >80 first occurs
    const brakeIdxA = traceA.findIndex((p) => p.brake > 70);
    const brakeIdxB = traceB.findIndex((p) => p.brake > 70);
    const brakeDeltaM = ((brakeIdxA - brakeIdxB) * 12); // ~12m per 2% distance on ~4.6km lap
    const avgThrottleA = traceA.reduce((s, p) => s + p.throttle, 0) / traceA.length;
    const avgThrottleB = traceB.reduce((s, p) => s + p.throttle, 0) / traceB.length;
    return {
      apexDelta: apexA - apexB,
      topSpeedDelta: maxA - maxB,
      brakeDeltaM,
      throttleDelta: avgThrottleA - avgThrottleB,
    };
  }, [traceA, traceB]);

  const W = 640, H = 120, padL = 36, padR = 10, padT = 10, padB = 18;

  const speedPathA = pathFor(traceA.map((p) => p.speed), 70, 360, W, H, padL, padR, padT, padB);
  const speedPathB = pathFor(traceB.map((p) => p.speed), 70, 360, W, H, padL, padR, padT, padB);
  const throttlePathA = pathFor(traceA.map((p) => p.throttle), 0, 100, W, 86, padL, padR, 6, 14);
  const throttlePathB = pathFor(traceB.map((p) => p.throttle), 0, 100, W, 86, padL, padR, 6, 14);
  const brakePathA = pathFor(traceA.map((p) => p.brake), 0, 100, W, 86, padL, padR, 6, 14);
  const brakePathB = pathFor(traceB.map((p) => p.brake), 0, 100, W, 86, padL, padR, 6, 14);

  const idx = hoverIdx ?? 25;
  const pA = traceA[Math.min(idx, traceA.length - 1)];
  const pB = traceB[Math.min(idx, traceB.length - 1)];

  return (
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a]">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-[#1e293b] bg-[#080c14]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#00d2be] shadow-[0_0_8px_rgba(0,210,190,0.6)] animate-pulse" />
          <h3 className="font-black tracking-tight text-sm">TELEMETRY OVERLAY</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#475569]">HEAD-TO-HEAD • SYNCED TRACES</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={aNum} onChange={(e) => setANum(Number(e.target.value))} className="bg-[#0f172a] border border-[#1e293b] rounded px-2 py-1.5 text-xs font-mono text-[#e2e8f0]" aria-label="Driver A">
            {DRIVER_OPTS.map((o) => <option key={o.number} value={o.number}>{o.code} #{o.number}</option>)}
          </select>
          <span className="text-[11px] font-black text-[#475569]">VS</span>
          <select value={bNum} onChange={(e) => setBNum(Number(e.target.value))} className="bg-[#0f172a] border border-[#1e293b] rounded px-2 py-1.5 text-xs font-mono text-[#e2e8f0]" aria-label="Driver B">
            {DRIVER_OPTS.map((o) => <option key={o.number} value={o.number}>{o.code} #{o.number}</option>)}
          </select>
        </div>
      </div>

      {/* driver badges */}
      <div className="grid grid-cols-2 divide-x divide-[#1e293b] border-b border-[#1e293b] bg-[#080c14]">
        <div className="flex items-center gap-3 px-4 py-2.5">
          <span className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white border border-white/10" style={{ background: aInfo.color }}>{aInfo.code.slice(0, 3)}</span>
          <div>
            <div className="font-black text-sm">{aInfo.code} <span className="text-[#94a3b8] font-normal">#{aNum}</span> <span className="hidden sm:inline text-[11px] text-[#64748b]">{aInfo.team}</span></div>
            <div className="text-[11px] font-mono text-[#94a3b8]">{pA.speed} km/h • {pA.throttle}% thr • G{pA.gear} {pA.drs ? "• DRS" : ""}</div>
          </div>
          <span className="ml-auto hidden sm:inline-flex w-2 h-2 rounded-full animate-pulse" style={{ background: aInfo.color, boxShadow: `0 0 8px ${aInfo.color}` }} />
        </div>
        <div className="flex items-center gap-3 px-4 py-2.5 justify-end text-right">
          <span className="hidden sm:inline-flex w-2 h-2 rounded-full animate-pulse" style={{ background: bInfo.color, boxShadow: `0 0 8px ${bInfo.color}` }} />
          <div>
            <div className="font-black text-sm">{bInfo.code} <span className="text-[#94a3b8] font-normal">#{bNum}</span> <span className="hidden sm:inline text-[11px] text-[#64748b]">{bInfo.team}</span></div>
            <div className="text-[11px] font-mono text-[#94a3b8]">{pB.speed} km/h • {pB.throttle}% thr • G{pB.gear} {pB.drs ? "• DRS" : ""}</div>
          </div>
          <span className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-white border border-white/10" style={{ background: bInfo.color }}>{bInfo.code.slice(0, 3)}</span>
        </div>
      </div>

      {/* SPEED trace */}
      <div className="p-3 bg-[#080c14] border-b border-[#1e293b]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-widest text-[#94a3b8]">SPEED <span className="font-normal text-[#475569]">km/h</span></span>
          <span className="flex items-center gap-3 text-[10px]">
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: aInfo.color }} />{aInfo.code}</span>
            <span className="inline-flex items-center gap-1.5"><span className="w-3 h-1 rounded" style={{ background: bInfo.color }} />{bInfo.code}</span>
            <span className="hidden sm:inline font-mono text-[#475569]">apex Δ {(cornerDelta.apexDelta > 0 ? "+" : "") + cornerDelta.apexDelta.toFixed(1)} km/h</span>
          </span>
        </div>
        <div
          className="relative mt-2 rounded-lg border border-[#1e293b] bg-[#0f172a] overflow-hidden"
          onMouseMove={(e) => {
            const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const frac = Math.max(0, Math.min(1, x / rect.width));
            setHoverIdx(Math.round(frac * (traceA.length - 1)));
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-[120px]">
            {[0.25, 0.5, 0.75].map((t) => (
              <line key={t} x1={padL} x2={W - padR} y1={padT + t * (H - padT - padB)} y2={padT + t * (H - padT - padB)} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="4 6" />
            ))}
            <text x={4} y={padT + 4} fontSize={8} fill="#64748b" fontFamily="monospace">360</text>
            <text x={4} y={H - padB + 8} fontSize={8} fill="#475569" fontFamily="monospace">70</text>
            {/* DRS zones background */}
            <rect x={padL + 0.14 * (W - padL - padR)} y={padT} width={0.14 * (W - padL - padR)} height={H - padT - padB} fill="#00d2be" opacity={0.06} />
            <rect x={padL + 0.60 * (W - padL - padR)} y={padT} width={0.17 * (W - padL - padR)} height={H - padT - padB} fill="#00d2be" opacity={0.06} />
            <text x={padL + 0.14 * (W - padL - padR) + 4} y={padT + 10} fontSize={7} fill="#00d2be" fontWeight={800}>DRS</text>
            <text x={padL + 0.60 * (W - padL - padR) + 4} y={padT + 10} fontSize={7} fill="#00d2be" fontWeight={800}>X-MODE</text>
            <path d={speedPathB} fill="none" stroke={bInfo.color} strokeWidth={1.6} opacity={0.95} strokeLinejoin="round" strokeLinecap="round" />
            <path d={speedPathA} fill="none" stroke={aInfo.color} strokeWidth={1.9} opacity={1} strokeLinejoin="round" strokeLinecap="round" />
            {/* hover crosshair */}
            {hoverIdx != null && (
              <g>
                <line x1={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} x2={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} y1={padT} y2={H - padB} stroke="#334155" strokeWidth={1} strokeDasharray="4 4" />
                <circle cx={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} cy={padT + (1 - (pA.speed - 70) / 290) * (H - padT - padB)} r={3.5} fill={aInfo.color} stroke="#0f172a" strokeWidth={1.2} />
                <circle cx={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} cy={padT + (1 - (pB.speed - 70) / 290) * (H - padT - padB)} r={3.5} fill={bInfo.color} stroke="#0f172a" strokeWidth={1.2} />
              </g>
            )}
            {/* gear markers */}
            {traceA.filter((_, i) => i % 14 === 0).map((p, i) => {
              const idx2 = i * 14;
              const x = padL + (idx2 / (traceA.length - 1)) * (W - padL - padR);
              return <text key={i} x={x} y={H - 2} textAnchor="middle" fontSize={7} fill="#475569" fontWeight={700}>{p.gear}</text>;
            })}
          </svg>
          {/* distance scrubber */}
          <input type="range" min={0} max={traceA.length - 1} value={hoverIdx ?? 25} onChange={(e) => setHoverIdx(Number(e.target.value))} className="absolute bottom-1 left-9 right-3 w-auto accent-[#00d2be] opacity-60 hover:opacity-100 h-1" />
        </div>
        <div className="mt-1 flex justify-between text-[9px] font-mono text-[#475569]"><span>0% lap</span><span>50%</span><span>100%</span></div>
      </div>

      {/* Throttle + Brake split */}
      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-[#1e293b] bg-[#080c14]">
        <div className="p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-widest text-[#22c55e]">THROTTLE %</span>
            <span className="text-[10px] font-mono text-[#475569]">0–100% • green</span>
          </div>
          <svg viewBox={`0 0 ${W} 86`} className="w-full h-[86px] mt-1 rounded border border-[#1e293b] bg-[#0f172a]">
            <rect x={0} y={0} width={W} height={86} fill="#0f172a" />
            <line x1={padL} x2={W - padR} y1={86 - 14} y2={86 - 14} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="4 6" />
            <path d={throttlePathB} fill="none" stroke={bInfo.color} strokeWidth={1.4} opacity={0.7} strokeLinejoin="round" />
            <path d={throttlePathA} fill="none" stroke="#22c55e" strokeWidth={1.6} strokeLinejoin="round" />
            {hoverIdx != null && <line x1={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} x2={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} y1={6} y2={72} stroke="#334155" strokeDasharray="3 4" />}
          </svg>
        </div>
        <div className="p-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold tracking-widest text-[#ef4444]">BRAKE %</span>
            <span className="text-[10px] font-mono text-[#475569]">0–100% • red</span>
          </div>
          <svg viewBox={`0 0 ${W} 86`} className="w-full h-[86px] mt-1 rounded border border-[#1e293b] bg-[#0f172a]">
            <rect x={0} y={0} width={W} height={86} fill="#0f172a" />
            <line x1={padL} x2={W - padR} y1={86 - 14} y2={86 - 14} stroke="#1e293b" strokeWidth={0.8} strokeDasharray="4 6" />
            <path d={brakePathB} fill="none" stroke={bInfo.color} strokeWidth={1.4} opacity={0.7} strokeLinejoin="round" />
            <path d={brakePathA} fill="none" stroke="#ef4444" strokeWidth={1.6} strokeLinejoin="round" />
            {hoverIdx != null && <line x1={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} x2={padL + (hoverIdx / (traceA.length - 1)) * (W - padL - padR)} y1={6} y2={72} stroke="#334155" strokeDasharray="3 4" />}
          </svg>
        </div>
      </div>

      {/* DRS / gear strip */}
      <div className="px-3 py-2 flex flex-wrap items-center gap-2 border-y border-[#1e293b] bg-[#0f172a]">
        <span className="text-[10px] tracking-widest font-bold text-[#64748b]">GEAR</span>
        <span className="flex items-center gap-0.5">
          {traceA.slice(0, 28).filter((_, i) => i % 3 === 0).map((p, i) => (
            <span key={i} className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-black border" style={{ background: p.gear >= 7 ? "#eab308" : p.gear >= 5 ? "#22c55e" : "#1e293b", color: p.gear >= 5 ? "#0f172a" : "#94a3b8", borderColor: p.gear >= 7 ? "#eab308" : "#334155" }}>{p.gear}</span>
          ))}
        </span>
        <span className="hidden sm:inline text-[10px] text-[#475569]">•</span>
        <span className="text-[10px] tracking-widest font-bold text-[#00d2be]">DRS / X-MODE</span>
        <span className="flex items-center gap-1">
          {traceA.slice(0, 28).filter((_, i) => i % 3 === 0).map((p, i) => (
            <span key={i} className={`w-6 h-2 rounded-full ${p.drs ? "bg-[#00d2be] shadow-[0_0_6px_rgba(0,210,190,0.5)]" : "bg-[#1e293b]"}`} />
          ))}
        </span>
        <span className="ml-auto text-[10px] font-mono text-[#475569] hidden sm:inline">Z-Mode (high downforce) vs X-Mode (low drag) • 2026 Active Aero</span>
      </div>

      {/* corner delta analysis + radar */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.1fr_0.9fr] gap-0 bg-[#080c14]">
        <div className="p-4">
          <div className="text-[11px] font-bold tracking-widest text-[#64748b]">CORNER DELTA ANALYSIS</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-3">
              <div className="text-[10px] tracking-widest text-[#64748b]">APEX SPEED Δ</div>
              <div className={`mt-1 font-mono font-black text-lg ${cornerDelta.apexDelta > 2 ? "text-[#22c55e]" : cornerDelta.apexDelta < -2 ? "text-[#ef4444]" : "text-[#eab308]"}`}>
                {cornerDelta.apexDelta > 0 ? "+" : ""}{cornerDelta.apexDelta.toFixed(1)} km/h
              </div>
              <div className="text-[10px] text-[#94a3b8]">{aInfo.code} {cornerDelta.apexDelta > 0 ? "faster at apex" : cornerDelta.apexDelta < 0 ? "slower at apex" : "matched"}</div>
            </div>
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-3">
              <div className="text-[10px] tracking-widest text-[#64748b]">TOP SPEED Δ</div>
              <div className={`mt-1 font-mono font-black text-lg ${cornerDelta.topSpeedDelta > 1 ? "text-[#22c55e]" : cornerDelta.topSpeedDelta < -1 ? "text-[#ef4444]" : "text-[#94a3b8]"}`}>
                {cornerDelta.topSpeedDelta > 0 ? "+" : ""}{cornerDelta.topSpeedDelta.toFixed(1)} km/h
              </div>
              <div className="text-[10px] text-[#94a3b8]">DRS / X-Mode gain</div>
            </div>
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-3">
              <div className="text-[10px] tracking-widest text-[#64748b]">BRAKING POINT</div>
              <div className="mt-1 font-mono font-black text-sm">{cornerDelta.brakeDeltaM > 0 ? "+" : ""}{Math.round(cornerDelta.brakeDeltaM)} m <span className="text-[11px] font-normal text-[#94a3b8]">{cornerDelta.brakeDeltaM > 8 ? "later" : cornerDelta.brakeDeltaM < -8 ? "earlier" : "matched"}</span></div>
              <div className="text-[10px] text-[#94a3b8]">distance delta</div>
            </div>
            <div className="rounded-lg border border-[#1e293b] bg-[#0f172a] p-3">
              <div className="text-[10px] tracking-widest text-[#64748b]">EXIT THROTTLE Δ</div>
              <div className={`mt-1 font-mono font-black text-sm ${cornerDelta.throttleDelta > 3 ? "text-[#22c55e]" : cornerDelta.throttleDelta < -3 ? "text-[#ef4444]" : "text-[#94a3b8]"}`}>
                {cornerDelta.throttleDelta > 0 ? "+" : ""}{cornerDelta.throttleDelta.toFixed(1)}%
              </div>
              <div className="text-[10px] text-[#94a3b8]">avg traction</div>
            </div>
          </div>
          <div className="mt-3 text-[10px] leading-relaxed text-[#94a3b8]">
            {aInfo.code} vs {bInfo.code}: <span className="text-white font-bold">{Math.abs(cornerDelta.apexDelta).toFixed(1)} km/h</span> apex gap • braking <span className="font-mono text-white">{Math.abs(Math.round(cornerDelta.brakeDeltaM))}m {cornerDelta.brakeDeltaM > 0 ? "later" : "earlier"}</span> for {cornerDelta.brakeDeltaM > 0 ? aInfo.code : bInfo.code}.
          </div>
        </div>

        {/* Performance radar — simple polygon */}
        <div className="p-4 border-t lg:border-t-0 lg:border-l border-[#1e293b] bg-[#0f172a]">
          <div className="text-[11px] font-bold tracking-widest text-[#64748b]">PERFORMANCE VECTOR</div>
          <div className="mt-2 flex items-center gap-4">
            <svg viewBox="0 0 140 140" className="w-36 h-36 shrink-0">
              {/* grid hex */}
              {[0.33, 0.66, 1].map((s) => (
                <polygon key={s} points={Array.from({ length: 6 }, (_, i) => {
                  const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                  const r = 52 * s;
                  return `${70 + Math.cos(a) * r},${70 + Math.sin(a) * r}`;
                }).join(" ")} fill="none" stroke="#1e293b" strokeWidth={0.8} />
              ))}
              {[0, 1, 2, 3, 4, 5].map((i) => {
                const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                return <line key={i} x1={70} y1={70} x2={70 + Math.cos(a) * 52} y2={70 + Math.sin(a) * 52} stroke="#1e293b" strokeWidth={0.6} strokeDasharray="3 4" />;
              })}
              {/* driver A polygon */}
              {(() => {
                const valsA = [0.82, 0.74, 0.68, 0.88, 0.62, 0.79];
                const valsB = [0.76, 0.85, 0.72, 0.71, 0.77, 0.84];
                const ptsA = valsA.map((v, i) => {
                  const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                  const r = 52 * v;
                  return `${70 + Math.cos(a) * r},${70 + Math.sin(a) * r}`;
                }).join(" ");
                const ptsB = valsB.map((v, i) => {
                  const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                  const r = 52 * v;
                  return `${70 + Math.cos(a) * r},${70 + Math.sin(a) * r}`;
                }).join(" ");
                return (
                  <>
                    <polygon points={ptsB} fill={bInfo.color} opacity={0.14} stroke={bInfo.color} strokeWidth={1.4} strokeLinejoin="round" />
                    <polygon points={ptsA} fill={aInfo.color} opacity={0.18} stroke={aInfo.color} strokeWidth={1.6} strokeLinejoin="round" />
                  </>
                );
              })()}
              {/* labels */}
              {["HIGH SPD", "LOW SPD", "TRACTION", "TYRE CONS", "ENERGY", "RELIAB"].map((lbl, i) => {
                const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
                const x = 70 + Math.cos(a) * 64;
                const y = 70 + Math.sin(a) * 64;
                return <text key={lbl} x={x} y={y} textAnchor="middle" dominantBaseline="middle" fontSize={5.5} fontWeight={800} fill="#64748b">{lbl}</text>;
              })}
            </svg>
            <div className="space-y-1.5 text-[11px]">
              {[
                { k: "High Speed", a: 82, b: 76 },
                { k: "Low Speed", a: 74, b: 85 },
                { k: "Traction", a: 68, b: 72 },
                { k: "Tyre Cons", a: 88, b: 71 },
                { k: "Energy Eff", a: 62, b: 77 },
                { k: "Reliability", a: 79, b: 84 },
              ].map((r) => (
                <div key={r.k} className="flex items-center gap-2">
                  <span className="w-20 text-[#94a3b8] font-bold text-[10px]">{r.k}</span>
                  <span className="flex-1 flex gap-1">
                    <span className="h-1.5 rounded-full" style={{ width: `${r.a * 0.6}px`, background: aInfo.color }} />
                    <span className="h-1.5 rounded-full opacity-60" style={{ width: `${r.b * 0.6}px`, background: bInfo.color }} />
                  </span>
                  <span className="font-mono text-[10px] text-[#475569] w-14 text-right">{r.a} / {r.b}</span>
                </div>
              ))}
              <div className="flex gap-3 pt-1 text-[10px]">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: aInfo.color }} />{aInfo.code}</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded" style={{ background: bInfo.color }} />{bInfo.code}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="px-4 py-2 border-t border-[#1e293b] bg-[#080c14] flex items-center justify-between text-[10px]">
        <span className="text-[#475569]">Shift lights: green → yellow → red → purple at 11,500 rpm • Hover or scrub to sync traces.</span>
        <span className="hidden sm:inline font-mono text-[#64748b]">distance 0–100% • DRS active where indicated</span>
      </div>
    </div>
  );
}

export default TelemetryOverlay;
