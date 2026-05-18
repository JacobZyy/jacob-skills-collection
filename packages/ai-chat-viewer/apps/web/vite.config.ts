import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// React 19 + Vite 7. @vitejs/plugin-react v5 uses Oxc internally for React
// Refresh transform — Babel is no longer a dependency, satisfying the
// "OXC plugin replacing ESLint/Babel" requirement of T04. We rely on this
// out-of-the-box behaviour and do NOT pin a separate vite-plugin-react-oxc
// (deprecated since plugin-react v5).
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // Dev proxy → apps/server (port 3001). Prod will run as a Tauri sidecar
    // over same-origin loopback, so the proxy is dev-only. We deliberately
    // keep changeOrigin: false: the server's CORS middleware accepts the
    // 127.0.0.1:5173 origin explicitly, and rewriting Host would obscure
    // which origin actually called when debugging CORS issues.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
      "/health": {
        target: "http://127.0.0.1:3001",
        changeOrigin: false,
      },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});
