"use client";

export type DominanceRow = {
  code: string;
  driverNumber?: number;
  color: string;
  team?: string;
  s1: number; // delta vs leader seconds (+ slower)
  s2: number;
  s3: number;
  total: number;
};

const MOCK_ROWS: DominanceRow[] = [
  { code: "VER", driverNumber: 1, color: "#3671C6", team: "Red Bull", s1: 0, s2: 0, s3: 0, total: 0 },
  { code: "NOR", driverNumber: 4, color: "#FF8000", team: "McLaren", s1: 0.042, s2: -0.018, s3: 0.031, total: 0.055 },
  { code: "LEC", driverNumber: 16, color: "#E8002D", team: "Ferrari", s1: 0.11, s2: 0.04, s3: -0.022, total: 0.128 },
  { code: "RUS", driverNumber: 63, color: "#27F4D2", team: "Mercedes", s1: -0.025, s2: 0.098, s3: 0.052, total: 0.125 },
  { code: "HAM", driverNumber: 44, color: "#E8002D", team: "Ferrari", s1: 0.067, s2: 0.021, s3: 0.089, total: 0.177 },
  { code: "PIA", driverNumber: 81, color: "#FF8000", team: "McLaren", s1: 0.02, s2: 0.015, s3: 0.02, total: 0.055 },
  { code: "ANT", driverNumber: 12, color: "#27F4D2", team: "Mercedes", s1: 0.14, s2: 0.06, s3: 0.03, total: 0.23 },
];

function cellColor(delta: number, isLeader: boolean): string {
  if (isLeader) return "bg-[#1e293b] text-[#64748b] border-[#334155]";
  if (delta <= -0.05) return "bg-[#052e1a] text-[#22c55e] border-[#16a34a]/40 shadow-[inset_0_0_8px_rgba(34,197,94,0.15)]";
  if (delta <= -0.015) return "bg-[#052e1a]/70 text-[#4ade80] border-[#22c55e]/30";
  if (delta < 0.015) return "bg-[#1e293b] text-[#e2e8f0] border-[#334155]";
  if (delta < 0.08) return "bg-[#451a03]/40 text-[#fb923c] border-[#ea580c]/30";
  if (delta < 0.15) return "bg-[#7f1d1d]/30 text-[#fca5a5] border-[#ef4444]/30";
  return "bg-[#7f1d1d]/50 text-[#fecaca] border-[#ef4444]/40 shadow-[inset_0_0_8px_rgba(239,68,68,0.2)]";
}

function barWidth(total: number): number {
  const a = Math.abs(total);
  return Math.min(100, (a / 0.35) * 100);
}

export function TrackDominance({
  rows,
  leaderCode,
}: {
  rows?: DominanceRow[];
  leaderCode?: string;
}) {
  const data = rows && rows.length ? rows : MOCK_ROWS;
  const leader = leaderCode ?? data[0]?.code ?? "VER";
  const leaderRow = data.find((r) => r.code === leader) ?? data[0];

  return (
    <div className="rounded-xl overflow-hidden border border-[#1e293b] bg-[#0f172a]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#1e293b] bg-[#080c14]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-[#eab308] shadow-[0_0_8px_rgba(234,179,8,0.5)]" />
          <h3 className="font-black tracking-tight text-sm">TRACK DOMINANCE</h3>
          <span className="hidden sm:inline text-[10px] tracking-widest text-[#475569]">SECTOR Δ vs LEADER</span>
        </div>
        <span className="text-[10px] font-mono px-2 py-1 rounded bg-[#1e293b] border border-[#334155] text-[#94a3b8]">
          leader <span className="font-black text-white">{leaderRow.code}</span> • gap in s
        </span>
      </div>

      {/* heatmap table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] tracking-widest text-[#64748b] border-b border-[#1e293b] bg-[#0f172a]">
              <th className="text-left px-4 py-2 font-bold">DRIVER</th>
              <th className="text-center px-2 py-2">S1</th>
              <th className="text-center px-2 py-2">S2</th>
              <th className="text-center px-2 py-2">S3</th>
              <th className="text-center px-2 py-2">TOTAL Δ</th>
              <th className="text-left px-3 py-2 hidden sm:table-cell">MAP</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {data.map((r) => {
              const isLeader = r.code === leaderRow.code;
              return (
                <tr key={r.code} className={`border-b border-[#1e293b]/60 ${isLeader ? "bg-[#00d084]/[0.04]" : "hover:bg-[#1e293b]/30"}`}>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="w-1 h-6 rounded-full shrink-0" style={{ background: r.color }} />
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-black border border-[#1e293b] bg-[#080c14] text-white shrink-0">
                        {r.code.slice(0, 3)}
                      </span>
                      <span className="flex flex-col leading-none">
                        <span className="font-black text-xs">{r.code}</span>
                        <span className="text-[10px] text-[#64748b] font-sans">{r.team ?? ""} {r.driverNumber ? `#${r.driverNumber}` : ""}</span>
                      </span>
                      {isLeader && <span className="ml-1 text-[9px] px-1.5 py-0.5 rounded bg-[#22c55e] text-[#052e1a] font-black">LEADER</span>}
                    </div>
                  </td>
                  {[r.s1, r.s2, r.s3].map((v, idx) => (
                    <td key={idx} className="px-2 py-2 text-center">
                      <span className={`inline-flex min-w-[64px] justify-center px-2 py-1.5 rounded-lg border font-bold text-xs ${cellColor(v, isLeader)}`}>
                        {isLeader ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(3)}`}
                      </span>
                    </td>
                  ))}
                  <td className="px-2 py-2 text-center">
                    <span
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border font-black text-xs ${isLeader ? "bg-[#1e293b] text-[#64748b] border-[#334155]" : r.total < 0.015 ? "bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]/30" : r.total < 0.12 ? "bg-[#eab308]/10 text-[#facc15] border-[#eab308]/30" : "bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30"}`}
                    >
                      {isLeader ? "0.000" : `${r.total > 0 ? "+" : ""}${r.total.toFixed(3)}`}
                      {!isLeader && r.total < 0 && <span className="text-[10px]">▲</span>}
                      {!isLeader && r.total > 0.08 && <span className="text-[10px]">▼</span>}
                    </span>
                  </td>
                  <td className="px-3 py-2 hidden sm:table-cell">
                    <div className="flex items-center gap-1 w-24">
                      <div className="flex-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden flex">
                        <div className="bg-[#334155] h-full" style={{ width: "33%" }} />
                        <div className="bg-[#475569] h-full" style={{ width: "34%" }} />
                        <div className="bg-[#64748b] h-full" style={{ width: "33%" }} />
                      </div>
                      {/* overlay delta bar */}
                      <div className="flex-1 h-1.5 rounded-full bg-[#1e293b] overflow-hidden ml-2 hidden lg:block">
                        <div
                          className={`h-full rounded-full ${isLeader ? "bg-[#334155]" : r.total > 0.12 ? "bg-[#ef4444]" : r.total > 0.04 ? "bg-[#f59e0b]" : "bg-[#22c55e]"}`}
                          style={{ width: `${isLeader ? 6 : Math.max(10, barWidth(r.total))}%` }}
                        />
                      </div>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* legend */}
      <div className="px-4 py-3 border-t border-[#1e293b] bg-[#080c14] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[10px]">
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#052e1a] border border-[#22c55e]/40" /> Faster than leader</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#1e293b] border border-[#334155]" /> Neutral ±15ms</span>
          <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-[#7f1d1d]/30 border border-[#ef4444]/30" /> Slower</span>
        </div>
        <span className="text-[10px] font-mono text-[#475569]">Δ = sector time − leader sector • green = purple sector pace</span>
      </div>
    </div>
  );
}

export default TrackDominance;
