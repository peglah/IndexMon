import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      animation: {
        "pop-in": "pop-in 0.5s cubic-bezier(0.34, 1.56, 0.64, 1) both",
        "alert-pulse": "alert-pulse 0.6s ease-out both",
        recover: "recover 0.5s ease-out both",
      },
      keyframes: {
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0) rotate(-12deg)" },
          "60%": { opacity: "1", transform: "scale(1.08) rotate(2deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(0deg)" },
        },
        "alert-pulse": {
          "0%": { transform: "scale(1)", boxShadow: "0 0 0px rgba(239,68,68,0)" },
          "25%": { transform: "scale(1.12)", boxShadow: "0 0 18px rgba(239,68,68,0.7)" },
          "100%": { transform: "scale(1)", boxShadow: "0 0 0px rgba(239,68,68,0)" },
        },
        recover: {
          "0%": { boxShadow: "0 0 0px rgba(34,197,94,0)" },
          "50%": { boxShadow: "0 0 14px rgba(34,197,94,0.6)" },
          "100%": { boxShadow: "0 0 0px rgba(34,197,94,0)" },
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;