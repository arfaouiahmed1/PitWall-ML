/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}", "./components/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: { mono: ["JetBrains Mono", "monospace"], sans: ["Inter", "sans-serif"] },
      colors: {
        pitwall: { bg: "#0a0e14", card: "#111820", accent: "#ff3b30", accent2: "#00d084", muted: "#8b9bb4" },
      },
    },
  },
  plugins: [],
};
