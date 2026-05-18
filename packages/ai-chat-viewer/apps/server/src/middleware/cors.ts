// Dev-only CORS middleware.
//
// Why this exists:
//   In dev, the web app runs on Vite (http://localhost:5173) and the API on
//   Hono (http://localhost:3001). Cross-origin fetches from the browser
//   require ACA-Origin headers; without them every /api request fails the
//   browser's same-origin check.
//
// Why this is dev-only:
//   The shipping target is a Tauri sidecar (#issue: future) which serves the
//   web bundle and proxies /api on the same origin. Same-origin = no CORS.
//   Keeping the middleware live in prod would either widen the allowed
//   origin list (security regression) or hard-code localhost:5173 (broken
//   for end-users). Both are wrong, so we gate by env.
//
// Configuration:
//   - Default origin: http://localhost:5173 (Vite default for V1).
//   - Override via AI_CHAT_VIEWER_CORS_ORIGIN if a developer runs Vite on a
//     different port. Comma-separated list supported.
//   - Disable entirely by setting AI_CHAT_VIEWER_CORS_DISABLED=1 (Tauri
//     sidecar future-proofing — same-origin doesn't want CORS at all).
//
// We do NOT enable credentials. V1 has no cookies, no auth, no sessions —
// `credentials: true` would just expand the attack surface for nothing.
//
// We do NOT restrict exposeHeaders. SSE responses (#28) carry custom
// headers and an explicit allowlist would silently break clients reading
// them.

import { cors } from "hono/cors";
import type { MiddlewareHandler } from "hono";

const DEFAULT_DEV_ORIGIN = "http://localhost:5173";

export interface CorsOptions {
  // Override env reads — used by tests to assert behavior without mutating
  // the live process env.
  envOrigin?: string | undefined;
  envDisabled?: string | undefined;
}

// Returns the configured origin list. Exported so tests can probe it
// without binding to the middleware itself.
export function resolveCorsOrigins(options: CorsOptions = {}): string[] {
  const raw = options.envOrigin ?? process.env["AI_CHAT_VIEWER_CORS_ORIGIN"];
  if (raw === undefined || raw === "") return [DEFAULT_DEV_ORIGIN];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Returns true when the middleware should short-circuit (no headers added).
// Used by Tauri / prod builds that want same-origin only.
export function isCorsDisabled(options: CorsOptions = {}): boolean {
  const flag = options.envDisabled ?? process.env["AI_CHAT_VIEWER_CORS_DISABLED"];
  return flag === "1" || flag === "true";
}

// Build a Hono CORS middleware honoring the env config above. When
// disabled, returns a passthrough so callers don't have to branch at the
// mount site.
export function buildCorsMiddleware(options: CorsOptions = {}): MiddlewareHandler {
  if (isCorsDisabled(options)) {
    return async (_c, next) => {
      await next();
    };
  }

  const origins = resolveCorsOrigins(options);
  return cors({
    origin: origins,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    // We do not whitelist headers — Hono's default echoes the request's
    // Access-Control-Request-Headers, which is what the browser sends.
    // Pinning a list here would silently break new request headers.
    credentials: false,
  });
}
