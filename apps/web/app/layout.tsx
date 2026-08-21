import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PitWall ML — Real-Time F1 Race Intelligence",
  description: "Replayable race-intelligence platform with continual learning and probabilistic forecasting",
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
const href = (p: string) => `${basePath}${p}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased">
        <nav className="sticky top-0 z-50 backdrop-blur bg-[#0a0e14]/80 border-b border-[#1e2a3a]">
          <div className="max-w-[1400px] mx-auto px-6 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded bg-[#ff3b30] flex items-center justify-center font-black text-white text-sm">PW</div>
              <span className="font-black tracking-tight text-lg">PITWALL<span className="text-[#ff3b30] ml-1">ML</span></span>
              <span className="ml-4 text-xs px-2 py-1 rounded-full bg-[#1e2a3a] text-[#8b9bb4] border border-[#243447]">V1 MVP • REPLAY MODE</span>
            </div>
            <div className="flex items-center gap-6 text-sm">
              <a href={href("/")} className="hover:text-white text-[#8b9bb4]">Race</a>
              <a href={href("/models")} className="hover:text-white text-[#8b9bb4]">Models</a>
              <a href={href("/monitoring")} className="hover:text-white text-[#8b9bb4]">Monitoring</a>
              <span className="flex items-center gap-2 text-xs"><span className="w-2 h-2 rounded-full bg-[#00d084] animate-pulse" />LIVE REPLAY</span>
            </div>
          </div>
        </nav>
        <main className="max-w-[1400px] mx-auto px-6 py-6">{children}</main>
        <footer className="border-t border-[#1e2a3a] mt-12 py-6 text-center text-xs text-[#5a6b84]">
          PitWall ML — Real-Time F1 Race Intelligence with Continual Learning • Built with FastF1 • Polars • LightGBM • FastAPI • Next.js
          {process.env.NEXT_PUBLIC_GIT_SHA ? ` • ${process.env.NEXT_PUBLIC_GIT_SHA}` : ""}
        </footer>
      </body>
    </html>
  );
}
