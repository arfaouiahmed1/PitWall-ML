/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "sans-serif"],
        mono: ["var(--font-geist-mono)", "JetBrains Mono", "monospace"],
      },
      colors: {
        pitwall: {
          // Core surfaces (dark-only cockpit)
          bg: "#080c14", // app background
          card: "#0f172a", // outer card surface
          border: "#1e293b", // card/row borders
          edge: "#243447", // chip borders on dark chips
          steel: "#334155", // hover borders, standby fills
          // Brand / signal hues
          accent: "#ff1801", // primary CTA / what-if
          ember: "#ff6b35", // accent gradient end, banner glow
          cyan: "#00d2be", // live / DRS / secondary CTA
          blue: "#3671c6", // team/info blue
          papaya: "#ff8000", // McLaren papaya
          ferrari: "#e8002d", // Ferrari red
          green: "#22c55e", // pass / fresh / healthy base
          yellow: "#eab308", // caution / medium base
          muted: "#8b9bb4", // secondary copy (see fog for chips)
          // Text roles on tinted/dark surfaces (contrast-checked)
          danger: "#ef4444", // alert text
          amber: "#f59e0b", // SC/VSC semantics only
          amberlight: "#fbbf24", // SC/VSC light text on tints
          mint: "#4ade80", // pass text on tints
          rose: "#f87171", // fail text on tints
          fog: "#cbd5e1", // text on #1e293b chips
          ink: "#e2e8f0", // primary body text on bg
        },
      },
      // NOTE: boxShadow.neon/neon-red removed (zero usages); glow lives in globals.css flag classes.
      keyframes: {
        breathe: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.7" } },
        flash: { "0%,100%": { opacity: "1" }, "50%": { opacity: "0.35" } },
      },
      animation: {
        breathe: "breathe 2.2s ease-in-out infinite",
        flash: "flash 0.9s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
