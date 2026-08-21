// Static export requires enumerating dynamic params at build time for GitHub Pages.
export function generateStaticParams() {
  // Pre-render a representative subset; client can still navigate to any driver via fallback shell.
  const drivers = ["1", "4", "16", "44", "63", "55", "11", "14", "81", "27"];
  return drivers.map((driver) => ({ driver }));
}

export default function DriverPage({ params }: { params: { driver: string } }) {
  return (
    <div className="card p-6">
      <h1 className="text-xl font-black">DRIVER {params.driver} — Detail (V2)</h1>
      <p className="text-xs text-[#8b9bb4] mt-2">
        Pace vs predicted, tyre degradation, pit hazard, and SHAP local explanation will be wired here in V2.
      </p>
      <p className="text-[11px] text-[#5a6b84] mt-4">
        Static export on GitHub Pages pre-renders top drivers; other IDs load client-side.
      </p>
    </div>
  );
}
