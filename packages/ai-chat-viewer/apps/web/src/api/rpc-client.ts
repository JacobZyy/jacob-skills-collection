import { hc } from "hono/client";
import type { AppType } from "@ai-chat-viewer/server/app-type";

// Hono RPC client. The `hc<AppType>` generic threads the server's chained
// route inference (apps/server/src/app.ts `createApp().route(...).route(...)`)
// into a typed proxy where every endpoint, path param, and JSON response is
// derived directly from the server code. No hand-maintained interface, no
// drift: if a route's Zod schema changes server-side, the call site here
// stops type-checking.
//
// Base URL "/" means requests go to the same origin as the page. In dev
// that origin is http://127.0.0.1:5173, and vite.config.ts proxies /api +
// /health to the server on :3001 (see apps/web/vite.config.ts). In V1 prod
// (Tauri sidecar) the server will be loopback same-origin too, so the
// relative base continues to work without a build-time flag.
//
// `credentials: "omit"` is intentional: this app talks to localhost only,
// never carries auth cookies, and explicitly omitting credentials avoids
// any future credential-leak surprise if a cross-origin proxy is added.
export const rpc = hc<AppType>("/", {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, credentials: "omit" }),
});

export type RpcClient = typeof rpc;
