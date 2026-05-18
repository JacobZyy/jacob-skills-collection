import { Hono } from "hono";
import { buildCorsMiddleware } from "./middleware/cors";
import { projectsRouter } from "./routes/projects";
import { sessionsByProjectRouter, sessionsRouter } from "./routes/sessions";
import { streamRouter } from "./sse/stream";

// Hono app factory. Routes are mounted here; index.ts owns the listen() call.
//
// Routes are chained (not re-assigned) so the inferred return type captures
// every route — that's what AppType (T27) consumes for Hono RPC. If you
// `const app = new Hono(); app.route(...)`, the chained type is lost.
//
// Why a factory rather than a top-level singleton: tests can construct an
// app with stub dependencies (e.g. an in-memory prisma) without paying the
// cost of importing the live boot sequence.
//
// CORS is mounted BEFORE routes so OPTIONS preflights short-circuit before
// route matching. The middleware is dev-only (Tauri sidecar will serve
// same-origin in prod); see middleware/cors.ts for env knobs.
export function createApp() {
  // /health: liveness probe. Used by:
  //   - verify-ac1.sh (confirm port 3001 bound)
  //   - Future PM tooling
  // Plain text + 200; no DB touch so a degraded DB doesn't mask process
  // liveness.
  return new Hono()
    .use("*", buildCorsMiddleware())
    .get("/health", (c) => c.text("ok"))
    .route("/api/projects", projectsRouter)
    .route("/api/projects", sessionsByProjectRouter)
    .route("/api/sessions", sessionsRouter)
    .route("/api", streamRouter)
    .onError((err, c) => {
      console.error("[server] unhandled error:", err);
      return c.json({ error: "Internal Server Error", message: err.message }, 500);
    });
}

export type AppType = ReturnType<typeof createApp>;
