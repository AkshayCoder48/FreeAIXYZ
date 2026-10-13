import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        /* ── HyperDimension AI "Crimson Orb" kit palette ──────────────────── */
        /* Primary crimson + ember + gold accents (Stitch UI kit tokens).    */
        crimson: {
          DEFAULT: "#ff2a55",
          deep: "#b80028",
          glow: "rgba(255, 42, 85, 0.85)",
          soft: "rgba(255, 42, 85, 0.15)",
        },
        ember: {
          DEFAULT: "#ff850d",
          soft: "#ffb68a",
          deep: "#5c2800",
        },
        gold: {
          DEFAULT: "#ffba27",
          soft: "#ffdea9",
        },
        blush: "#ffb68a",
        rosy: "#ffb3b6",
        /* Dark surface scale (surface-dim → surface-container-highest).    */
        hd: {
          ground: "#111319",
          deep: "#0c0e13",
          low: "#191c21",
          container: "#1d2025",
          high: "#282a30",
          highest: "#33353b",
          line: "#5d3f40",
        },
        card: {
          DEFAULT: "var(--card)",
          foreground: "var(--card-foreground)",
        },
        popover: {
          DEFAULT: "var(--popover)",
          foreground: "var(--popover-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        secondary: {
          DEFAULT: "var(--secondary)",
          foreground: "var(--secondary-foreground)",
        },
        muted: {
          DEFAULT: "var(--muted)",
          foreground: "var(--muted-foreground)",
        },
        accent: {
          DEFAULT: "var(--accent)",
          secondary: "var(--accent-secondary)",
          foreground: "var(--accent-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
        },
        border: "var(--border)",
        input: "var(--input)",
        ring: "var(--ring)",
        chart: {
          "1": "var(--chart-1)",
          "2": "var(--chart-2)",
          "3": "var(--chart-3)",
          "4": "var(--chart-4)",
          "5": "var(--chart-5)",
        },
      },
      fontFamily: {
        sans: ["var(--font-body)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
        display: ["var(--font-display)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        accent: "var(--shadow-accent)",
        "accent-lg": "var(--shadow-accent-lg)",
        /* HyperDimension crimson glow (kit primary-button shadow). */
        "crimson-glow":
          "0 0 24px rgba(255, 42, 85, 0.5), inset 0 1px 1px rgba(255, 255, 255, 0.6)",
        "crimson-glow-lg":
          "0 0 36px rgba(255, 133, 13, 0.7), 0 0 18px rgba(255, 42, 85, 0.9)",
        panel:
          "0 12px 32px rgba(0, 0, 0, 0.7), inset 0 1px 1px rgba(255, 255, 255, 0.08)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 8px)",
      },
      keyframes: {
        "spin-slow": {
          from: { transform: "rotate(0deg)" },
          to: { transform: "rotate(360deg)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "float-lg": {
          "0%, 100%": { transform: "translateY(0px)" },
          "50%": { transform: "translateY(-14px)" },
        },
        "pulse-dot": {
          "0%, 100%": { transform: "scale(1)", opacity: "1" },
          "50%": { transform: "scale(1.3)", opacity: "0.7" },
        },
        "fade-in-up": {
          from: { opacity: "0", transform: "translateY(28px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "spin-slow": "spin-slow 60s linear infinite",
        float: "float 5s ease-in-out infinite",
        "float-lg": "float-lg 7s ease-in-out infinite",
        "pulse-dot": "pulse-dot 2s ease-in-out infinite",
        "fade-in-up": "fade-in-up 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};
export default config;
