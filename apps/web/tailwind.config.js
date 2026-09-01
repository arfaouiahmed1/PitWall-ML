/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}", "./lib/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["JetBrains Mono", "monospace"], sans: ["Inter", "sans-serif"] },
      colors: {
        pitwall: {
          bg: "#080c14",
          card: "#0f172a",
          border: "#1e293b",
          accent: "#ff1801",
          cyan: "#00d2be",
          blue: "#3671c6",
          papaya: "#ff8000",
          ferrari: "#e8002d",
          green: "#22c55e",
          yellow: "#eab308",
          muted: "#8b9bb4",
        },
        pit: {
          bg: "#080c14",
          card: "#0f172a",
          border: "#1e293b",
        },
      },
      boxShadow: {
        neon: "0 0 18px rgba(0, 210, 190, 0.35)",
        "neon-red": "0 0 18px rgba(255, 24, 1, 0.35)",
      },
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
