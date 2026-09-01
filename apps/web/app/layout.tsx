import "./globals.css";
import type { Metadata } from "next";
import SiteHeader from "@/components/SiteHeader";

export const metadata: Metadata = {
  title: "PitWall ML — Real-Time F1 Race Intelligence",
  description:
    "Replayable race-intelligence platform with continual learning and probabilistic forecasting — live telemetry, strategy sandbox, and drift monitoring.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen antialiased bg-[#080c14] text-slate-200">
        <SiteHeader />
        <main className="max-w-[1400px] mx-auto px-6 py-6">{children}</main>
        <footer className="border-t border-[#1e293b] mt-12 py-6 text-center text-xs text-[#5a6b84]">
          PitWall ML — Real-Time F1 Race Intelligence with Continual Learning • Built with FastF1 • Polars • LightGBM • FastAPI •
          Next.js
          {process.env.NEXT_PUBLIC_GIT_SHA ? ` • ${process.env.NEXT_PUBLIC_GIT_SHA}` : ""}
        </footer>
      </body>
    </html>
  );
}
