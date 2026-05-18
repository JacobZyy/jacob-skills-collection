import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createApp } from "../app";
import {
  buildCorsMiddleware,
  isCorsDisabled,
  resolveCorsOrigins,
} from "../middleware/cors";
import { Hono } from "hono";

// We exercise both the helpers (unit) and the app surface (integration via
// app.fetch). Going through createApp() catches mount-order regressions —
// e.g. CORS mounted AFTER routes would silently fail OPTIONS preflight.

describe("cors helpers", () => {
  it("defaults to http://localhost:5173 when env unset", () => {
    expect(resolveCorsOrigins({ envOrigin: undefined })).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("parses single origin from env", () => {
    expect(resolveCorsOrigins({ envOrigin: "http://localhost:5174" })).toEqual([
      "http://localhost:5174",
    ]);
  });

  it("parses comma-separated list and trims whitespace", () => {
    expect(
      resolveCorsOrigins({
        envOrigin: " http://localhost:5173 , http://localhost:5174 ",
      })
    ).toEqual(["http://localhost:5173", "http://localhost:5174"]);
  });

  it("treats empty string as default", () => {
    expect(resolveCorsOrigins({ envOrigin: "" })).toEqual([
      "http://localhost:5173",
    ]);
  });

  it("isCorsDisabled honors '1' and 'true'", () => {
    expect(isCorsDisabled({ envDisabled: "1" })).toBe(true);
    expect(isCorsDisabled({ envDisabled: "true" })).toBe(true);
    expect(isCorsDisabled({ envDisabled: "0" })).toBe(false);
    expect(isCorsDisabled({ envDisabled: undefined })).toBe(false);
  });
});

describe("cors middleware behavior", () => {
  let originalOrigin: string | undefined;
  let originalDisabled: string | undefined;

  beforeEach(() => {
    originalOrigin = process.env["AI_CHAT_VIEWER_CORS_ORIGIN"];
    originalDisabled = process.env["AI_CHAT_VIEWER_CORS_DISABLED"];
    delete process.env["AI_CHAT_VIEWER_CORS_ORIGIN"];
    delete process.env["AI_CHAT_VIEWER_CORS_DISABLED"];
  });

  afterEach(() => {
    if (originalOrigin === undefined) {
      delete process.env["AI_CHAT_VIEWER_CORS_ORIGIN"];
    } else {
      process.env["AI_CHAT_VIEWER_CORS_ORIGIN"] = originalOrigin;
    }
    if (originalDisabled === undefined) {
      delete process.env["AI_CHAT_VIEWER_CORS_DISABLED"];
    } else {
      process.env["AI_CHAT_VIEWER_CORS_DISABLED"] = originalDisabled;
    }
  });

  it("adds ACA-Origin to a simple GET when Origin matches default", async () => {
    // Build a tiny app to isolate cors from /api/* routes (which require a
    // live Prisma DB).
    const app = new Hono().use("*", buildCorsMiddleware()).get("/ping", (c) =>
      c.text("pong")
    );
    const res = await app.fetch(
      new Request("http://localhost:3001/ping", {
        headers: { Origin: "http://localhost:5173" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
  });

  it("answers OPTIONS preflight with 204 + ACA-Methods", async () => {
    const app = new Hono().use("*", buildCorsMiddleware()).get("/ping", (c) =>
      c.text("pong")
    );
    const res = await app.fetch(
      new Request("http://localhost:3001/ping", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
          "Access-Control-Request-Headers": "content-type",
        },
      })
    );
    expect(res.status).toBe(204);
    const allowMethods = res.headers.get("access-control-allow-methods") ?? "";
    expect(allowMethods).toContain("GET");
    expect(allowMethods).toContain("OPTIONS");
  });

  it("omits ACA-Origin when Origin is not in the allowlist", async () => {
    const app = new Hono().use("*", buildCorsMiddleware()).get("/ping", (c) =>
      c.text("pong")
    );
    const res = await app.fetch(
      new Request("http://localhost:3001/ping", {
        headers: { Origin: "http://evil.example.com" },
      })
    );
    // Hono's cors() omits the ACA-Origin header for unmatched origins (the
    // browser will then block the response). The body still flows so non-
    // browser callers (curl) still see 200.
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("does not set Access-Control-Allow-Credentials (V1 has no auth)", async () => {
    const app = new Hono().use("*", buildCorsMiddleware()).get("/ping", (c) =>
      c.text("pong")
    );
    const res = await app.fetch(
      new Request("http://localhost:3001/ping", {
        headers: { Origin: "http://localhost:5173" },
      })
    );
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });

  it("when disabled, no CORS headers are added", async () => {
    process.env["AI_CHAT_VIEWER_CORS_DISABLED"] = "1";
    const app = new Hono().use("*", buildCorsMiddleware()).get("/ping", (c) =>
      c.text("pong")
    );
    const res = await app.fetch(
      new Request("http://localhost:3001/ping", {
        headers: { Origin: "http://localhost:5173" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("createApp wiring", () => {
  it("/health responds 200 with ACA-Origin from default", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:3001/health", {
        headers: { Origin: "http://localhost:5173" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:5173"
    );
    expect(await res.text()).toBe("ok");
  });

  it("OPTIONS preflight to /api/projects responds 204 (CORS mounted before routes)", async () => {
    const app = createApp();
    const res = await app.fetch(
      new Request("http://localhost:3001/api/projects", {
        method: "OPTIONS",
        headers: {
          Origin: "http://localhost:5173",
          "Access-Control-Request-Method": "GET",
        },
      })
    );
    // 204 (not 404 / 405) confirms CORS short-circuited BEFORE route lookup.
    expect(res.status).toBe(204);
  });
});
