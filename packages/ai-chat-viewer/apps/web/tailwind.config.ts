import type { Config } from "tailwindcss";
import daisyui from "daisyui";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {},
  },
  plugins: [daisyui],
  // daisyUI v4 config goes top-level, not under theme.
  daisyui: {
    themes: ["light", "dark"],
    logs: false,
  },
};

export default config;
