"use client";
export function RaceTable({ rows }: { rows: any[] }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-[10px] tracking-widest text-[#8b9bb4]"><th>POS</th><th>DRIVER</th><th>GAP</th></tr></thead>
      <tbody>{rows.map((r,i)=><tr key={i}><td>{r.pos}</td><td>{r.driver}</td><td>{r.gap}</td></tr>)}</tbody>
    </table>
  );
}
