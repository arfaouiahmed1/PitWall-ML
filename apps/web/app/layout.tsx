import "./globals.css";
import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Geist, JetBrains_Mono } from "next/font/google";
import SiteHeader from "@/components/SiteHeader";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = JetBrains_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PitWall ML",
  description: "F1 lap-time forecasting and race strategy. Quantile LightGBM, conformal calibration, Monte Carlo strategy simulator.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://unpkg.com/react-scan/dist/auto.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}

        {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-grab/dist/index.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )}
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased bg-pitwall-bg text-slate-200`}>
        <SiteHeader />
        <main className="max-w-[1400px] mx-auto px-6 py-6">{children}</main>
        <footer className="border-t border-pitwall-border mt-12 py-6 text-center text-xs text-pitwall-muted">
          PitWall ML • FastF1 • Polars • LightGBM • FastAPI • Next.js
          {process.env.NEXT_PUBLIC_GIT_SHA ? ` • ${process.env.NEXT_PUBLIC_GIT_SHA}` : ""}
        </footer>
      </body>
    </html>
  );
}
