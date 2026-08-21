"use client";
import { useEffect, useRef, useState } from "react";

type DriverRow = {
  driver_number: number;
  position?: number;
  gap?: string;
  tyre: string;
  tyreAge: number;
  lastLap: string;
  forecast: string;
  interval: string;
  pitProb: number;
};

const DRIVERS: DriverRow[] = [
  { driver_number: 1, position: 1, gap: "LEADER", tyre: "M", tyreAge: 18, lastLap: "1:19.42", forecast: "1:19.31 ± .32", interval: "61%", pitProb: 61 },
  { driver_number: 4, position: 2, gap: "+2.41", tyre: "H", tyreAge: 11, lastLap: "1:19.31", forecast: "1:19.28 ± .29", interval: "18%", pitProb: 18 },
  { driver_number: 16, position: 3, gap: "+6.92", tyre: "M", tyreAge: 21, lastLap: "1:19.87", forecast: "1:19.87 ± .51", interval: "83%", pitProb: 83 },
  { driver_number: 63, position: 4, gap: "+9.11", tyre: "M", tyreAge: 16, lastLap: "1:19.55", forecast: "1:19.60 ± .35", interval: "41%", pitProb: 41 },
  { driver_number: 44, position: 5, gap: "+12.03", tyre: "H", tyreAge: 8, lastLap: "1:19.22", forecast: "1:19.18 ± .31", interval: "12%", pitProb: 12 },
];

export default function RacePage() {
  const [speed, setSpeed] = useState("20x");
  const [connected, setConnected] = useState(false);
  const [lap, setLap] = useState(31);
  const [events, setEvents] = useState<any[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = (s: string) => {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const host = process.env.NEXT_PUBLIC_WS_URL?.replace(/^wss?:\/\//, "") || "localhost:8000";
    const url = `${proto}://${host}/ws/race?speed=${s}`;
    const ws = new WebSocket(url);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "race_update") {
          setEvents((prev) => [msg, ...prev].slice(0, 50));
          if (msg.race_state?.lap) setLap(msg.race_state.lap);
        }
      } catch {}
    };
    wsRef.current?.close();
    wsRef.current = ws;
  };

  useEffect(() => {
    connect(speed);
    return () => wsRef.current?.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeSpeed = (s: string) => {
    setSpeed(s);
    wsRef.current?.close();
    connect(s);
  };

  return (
    <div className="space-y-6">
      {/* Header bar */}
      <div className="card p-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs tracking-widest text-[#8b9bb4]">SPANISH GP • CIRCUIT DE BARCELONA-CATALUNYA</div>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-2xl font-black mono">LAP {lap} / 66</span>
            <span className={`text-xs px-2 py-1 rounded-full border ${connected ? "bg-[#00d084]/10 text-[#00d084] border-[#00d084]/30" : "bg-[#ff3b30]/10 text-[#ff3b30] border-[#ff3b30]/30"}`}>
              {connected ? "● REPLAY ACTIVE" : "○ DISCONNECTED"}
            </span>
            <span className="text-xs text-[#8b9bb4]">Model: pace-v13 @champion</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {["1x", "5x", "20x", "MAX"].map((s) => (
            <button
              key={s}
              onClick={() => changeSpeed(s)}
              className={`px-3 py-1.5 rounded text-xs font-bold border ${speed === s ? "bg-[#ff3b30] text-white border-[#ff3b30]" : "bg-[#1e2a3a] text-[#8b9bb4] border-[#243447] hover:text-white"}`}
            >
              {s}
            </button>
          ))}
          <button onClick={() => wsRef.current?.close()} className="ml-2 text-xs text-[#8b9bb4] hover:text-white">
            Pause
          </button>
          <button onClick={() => connect(speed)} className="text-xs text-[#8b9bb4] hover:text-white">
            Resume
          </button>
        </div>
      </div>

      {/* Track status */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { k: "Track", v: "37.2°C" },
          { k: "Air", v: "25.1°C" },
          { k: "Status", v: "GREEN" },
          { k: "Data lag", v: "132 ms" },
        ].map((s) => (
          <div key={s.k} className="card p-3 text-center">
            <div className="text-[10px] tracking-widest text-[#8b9bb4]">{s.k.toUpperCase()}</div>
            <div className="mono font-bold text-sm mt-1">{s.v}</div>
          </div>
        ))}
      </div>

      {/* Main table */}
      <div className="card overflow-hidden">
        <div className="accent-bar" />
        <div className="p-4 flex items-center justify-between">
          <h2 className="font-black tracking-tight">RACE LEADERBOARD — LIVE PREDICTIONS</h2>
          <span className="text-xs text-[#8b9bb4]">q10–q50–q90 pace forecast • Pit hazard ≤3 laps</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[10px] tracking-widest text-[#8b9bb4] border-y border-[#1e2a3a] bg-[#0f141c]">
              <tr>
                <th className="text-left px-4 py-2">POS</th>
                <th className="text-left px-3 py-2">DRIVER</th>
                <th className="text-left px-3 py-2">GAP</th>
                <th className="text-left px-3 py-2">TYRE AGE</th>
                <th className="text-left px-3 py-2">PACE FORECAST (80% interval)</th>
                <th className="text-left px-3 py-2">PIT ≤3L</th>
              </tr>
            </thead>
            <tbody className="mono text-xs">
              {DRIVERS.map((d) => (
                <tr key={d.driver_number} className="border-b border-[#1e2a3a]/60 hover:bg-[#0f141c] cursor-pointer">
                  <td className="px-4 py-3 font-bold">{d.position}</td>
                  <td className="px-3 py-3 flex items-center gap-2">
                    <span className="w-6 h-6 rounded bg-[#1e2a3a] flex items-center justify-center text-[10px] font-black">{d.driver_number}</span>
                    <span className="font-bold">DRV {d.driver_number}</span>
                  </td>
                  <td className="px-3 py-3 text-[#8b9bb4]">{d.gap}</td>
                  <td className="px-3 py-3">
                    <span className="px-1.5 py-0.5 rounded bg-[#1e2a3a] text-[10px] border border-[#243447]">{d.tyre}</span> <span className="ml-1">{d.tyreAge}</span>
                  </td>
                  <td className="px-3 py-3">{d.forecast}</td>
                  <td className="px-3 py-3">
                    <span className={`px-2 py-1 rounded text-[10px] font-bold ${d.pitProb > 60 ? "bg-[#ff3b30]/20 text-[#ff6b6b] border border-[#ff3b30]/30" : d.pitProb > 30 ? "bg-[#f59e0b]/15 text-[#fbbf24] border border-[#f59e0b]/20" : "bg-[#00d084]/10 text-[#00d084] border border-[#00d084]/20"}`}>{d.pitProb}%</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Driver detail + live feed */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <h3 className="font-black text-sm tracking-tight">SELECTED DRIVER — NORRIS P1</h3>
          <div className="grid grid-cols-3 gap-4 mt-4">
            <div className="bg-[#0a0e14] rounded p-3 border border-[#1e2a3a]">
              <div className="text-[10px] tracking-widest text-[#8b9bb4]">NEXT LAP</div>
              <div className="mono font-black text-lg mt-1">1:19.42</div>
              <div className="text-[10px] text-[#8b9bb4]">80% 1:19.08 – 1:19.79</div>
            </div>
            <div className="bg-[#0a0e14] rounded p-3 border border-[#1e2a3a]">
              <div className="text-[10px] tracking-widest text-[#8b9bb4]">TYRE — MEDIUM</div>
              <div className="mono font-bold mt-1">Age 18 laps</div>
              <div className="text-[10px] text-[#ffb020]">Degradation +0.08 s/lap</div>
            </div>
            <div className="bg-[#0a0e14] rounded p-3 border border-[#1e2a3a]">
              <div className="text-[10px] tracking-widest text-[#8b9bb4]">PIT HAZARD</div>
              <div className="mono font-bold mt-1">Next 3: 61%</div>
              <div className="text-[10px] text-[#8b9bb4]">Next lap 16% • Next 5 82%</div>
            </div>
          </div>
          <div className="mt-4 h-32 rounded bg-[#0a0e14] border border-[#1e2a3a] flex items-center justify-center text-xs text-[#5a6b84]">
            Actual vs Predicted lap time chart — wired to WebSocket predictions in V2 (Recharts)
          </div>
        </div>
        <div className="card p-4">
          <h3 className="font-bold text-xs tracking-widest text-[#8b9bb4]">LIVE EVENT FEED</h3>
          <div className="mt-3 space-y-2 max-h-[320px] overflow-auto mono text-[11px]">
            {events.length === 0 ? <div className="text-[#5a6b84] text-xs">Awaiting replay events... Click 20x to start. If API is offline, UI shows demo data.</div> : events.slice(0, 12).map((e, i) => (
              <div key={i} className="flex gap-2 py-1 border-b border-[#1e2a3a]/40">
                <span className="text-[#00d084]">{e.event?.driver_number ?? "--"}</span>
                <span className="text-[#8b9bb4]">{e.event?.event_type}</span>
                <span className="ml-auto text-[#5a6b84]">{e.prediction ? `${e.prediction.q50}s` : ""}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-4 bg-[#111820] border-[#1e2a3a]">
        <h3 className="font-black text-xs tracking-widest">HOW REPLAY VALIDATES LIVE ARCHITECTURE</h3>
        <p className="text-xs text-[#8b9bb4] mt-2 leading-relaxed">
          Replay is not fake UI playback — it is an <span className="text-white">event-time integration test</span> of the live pipeline. Historical Bronze events are streamed through the same <code className="bg-[#1e2a3a] px-1 rounded">RaceEvent</code> → <code className="bg-[#1e2a3a] px-1 rounded">RaceState</code> → <code className="bg-[#1e2a3a] px-1 rounded">FeatureBuilder</code> → <code className="bg-[#1e2a3a] px-1 rounded">Model@champion</code> → WebSocket path that Live MQTT will use. This proves the full MLOps loop locally with zero paid F1 subscription.
        </p>
      </div>
    </div>
  );
}
