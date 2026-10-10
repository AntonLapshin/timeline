import type { Config } from "tailwindcss";

/**
 * Timeline design tokens (design refresh).
 *
 * The palette builds on Tailwind's indigo/violet/slate with a small set of
 * brand extensions:
 * - `brand` — the primary indigo ramp used for interactive accents.
 * - `ink` — deep navy surfaces for the dark theme.
 * - Motion: `enter` (staggered rise), `pop` (menus/modals), `slide-in-right`
 *   (drawer), `sheet-up` (mobile bottom sheet), `shimmer` (skeletons),
 *   `drift` (ambient background orbs).
 *
 * All animations honor `prefers-reduced-motion` (see styles/index.css).
 */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        display: [
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      colors: {
        brand: {
          50: "#eef2ff",
          100: "#e0e7ff",
          200: "#c7d2fe",
          300: "#a5b4fc",
          400: "#818cf8",
          500: "#6366f1",
          600: "#4f46e5",
          700: "#4338ca",
          800: "#3730a3",
          900: "#312e81",
          950: "#1e1b4b",
        },
        ink: {
          800: "#141b2e",
          900: "#0d1322",
          950: "#080c18",
        },
      },
      boxShadow: {
        card: "0 1px 2px rgb(15 23 42 / 0.05), 0 10px 30px -12px rgb(15 23 42 / 0.18)",
        "card-hover":
          "0 2px 4px rgb(15 23 42 / 0.06), 0 20px 44px -16px rgb(79 70 229 / 0.28)",
        popover:
          "0 4px 8px rgb(15 23 42 / 0.06), 0 24px 48px -12px rgb(15 23 42 / 0.25)",
        glow: "0 0 0 1px rgb(99 102 241 / 0.25), 0 8px 24px -8px rgb(99 102 241 / 0.45)",
        "glow-sm": "0 0 16px -2px rgb(99 102 241 / 0.5)",
      },
      keyframes: {
        enter: {
          from: { opacity: "0", transform: "translateY(14px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        pop: {
          from: { opacity: "0", transform: "translateY(-6px) scale(0.97)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        "slide-in-right": {
          from: { transform: "translateX(100%)" },
          to: { transform: "translateX(0)" },
        },
        "sheet-up": {
          from: { opacity: "0", transform: "translateY(48px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        fade: {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        shimmer: {
          from: { backgroundPosition: "200% 0" },
          to: { backgroundPosition: "-200% 0" },
        },
        drift: {
          "0%, 100%": { transform: "translate(0, 0) scale(1)" },
          "50%": { transform: "translate(24px, -18px) scale(1.06)" },
        },
        "pulse-ring": {
          "0%": { boxShadow: "0 0 0 0 rgb(99 102 241 / 0.45)" },
          "70%": { boxShadow: "0 0 0 8px rgb(99 102 241 / 0)" },
          "100%": { boxShadow: "0 0 0 0 rgb(99 102 241 / 0)" },
        },
      },
      animation: {
        enter: "enter 0.55s cubic-bezier(0.22, 1, 0.36, 1) both",
        pop: "pop 0.16s cubic-bezier(0.22, 1, 0.36, 1) both",
        "slide-in-right": "slide-in-right 0.32s cubic-bezier(0.22, 1, 0.36, 1) both",
        "sheet-up": "sheet-up 0.34s cubic-bezier(0.22, 1, 0.36, 1) both",
        fade: "fade 0.2s ease-out both",
        shimmer: "shimmer 1.6s linear infinite",
        drift: "drift 14s ease-in-out infinite",
        "pulse-ring": "pulse-ring 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
    },
  },
  plugins: [],
} satisfies Config;
