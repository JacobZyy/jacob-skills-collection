import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { logIngestionFailure, logger, resolveIngestionLogPath } from "../lib/logger";

// Bun's os.homedir() snapshots $HOME at process start, so per-test HOME
// mutation does NOT work. We thread `home: tmp` through the resolver and
// `logIngestionFailure` instead. process.env.HOME is still set per-test as a
// belt-and-suspenders against any code path that reads env directly.
let originalHome: string | undefined;
let tmp: string;

function captureConsole(): {
  restore: () => void;
  lines: { level: string; text: string }[];
} {
  const lines: { level: string; text: string }[] = [];
  const orig = {
    log: console.log,
    warn: console.warn,
    error: console.error,
    debug: console.debug,
  };
  console.log = (...args: unknown[]) => lines.push({ level: "log", text: args.join(" ") });
  console.warn = (...args: unknown[]) => lines.push({ level: "warn", text: args.join(" ") });
  console.error = (...args: unknown[]) =>
    lines.push({ level: "error", text: args.join(" ") });
  console.debug = (...args: unknown[]) =>
    lines.push({ level: "debug", text: args.join(" ") });
  return {
    lines,
    restore: () => {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
      console.debug = orig.debug;
    },
  };
}

beforeEach(() => {
  originalHome = process.env["HOME"];
  tmp = mkdtempSync(join(tmpdir(), "ai-chat-viewer-logger-"));
  process.env["HOME"] = tmp;
});

afterEach(() => {
  if (originalHome === undefined) {
    delete process.env["HOME"];
  } else {
    process.env["HOME"] = originalHome;
  }
  rmSync(tmp, { recursive: true, force: true });
});

describe("logger console channel", () => {
  it("renders sessionId + projectCwdHash as bracketed prefix with 8-char shortIds", () => {
    const c = captureConsole();
    try {
      logger.info("catch-up walked file", {
        sessionId: "84e7aabbccdd11ee22ff33445566778899",
        projectCwdHash: "abc12345def6789012",
      });
    } finally {
      c.restore();
    }
    expect(c.lines).toHaveLength(1);
    expect(c.lines[0]?.level).toBe("log");
    expect(c.lines[0]?.text).toBe(
      "[sess=84e7aabb…/proj=abc12345…] catch-up walked file"
    );
  });

  it("renders only sessionId when projectCwdHash is missing", () => {
    const c = captureConsole();
    try {
      logger.warn("partial-line at EOF", { sessionId: "84e7aabbccdd" });
    } finally {
      c.restore();
    }
    expect(c.lines[0]?.level).toBe("warn");
    expect(c.lines[0]?.text).toBe("[sess=84e7aabb…] partial-line at EOF");
  });

  it("emits without prefix when no recognized context is provided", () => {
    const c = captureConsole();
    try {
      logger.error("boot failed");
    } finally {
      c.restore();
    }
    expect(c.lines[0]?.level).toBe("error");
    expect(c.lines[0]?.text).toBe("boot failed");
  });

  it("renders unknown context keys as a trailing JSON blob", () => {
    const c = captureConsole();
    try {
      logger.info("scan tick", {
        sessionId: "84e7aabbccdd",
        lineNo: 42,
        durationMs: 150,
      });
    } finally {
      c.restore();
    }
    expect(c.lines[0]?.text).toBe(
      `[sess=84e7aabb…] scan tick {"lineNo":42,"durationMs":150}`
    );
  });

  it("uses console.debug for debug level", () => {
    const c = captureConsole();
    try {
      logger.debug("hot path tick");
    } finally {
      c.restore();
    }
    expect(c.lines[0]?.level).toBe("debug");
  });

  it("does not truncate ids that are already 8 chars or shorter", () => {
    const c = captureConsole();
    try {
      logger.info("short ids", { sessionId: "short", projectCwdHash: "12345678" });
    } finally {
      c.restore();
    }
    expect(c.lines[0]?.text).toBe("[sess=short/proj=12345678] short ids");
  });
});

describe("logger ingestion.log channel", () => {
  it("appends a single JSON line per call to the resolved path", async () => {
    const filePath = resolveIngestionLogPath({ home: tmp });
    expect(filePath.startsWith(tmp)).toBe(true);
    expect(filePath.endsWith("/ingestion.log")).toBe(true);

    await logIngestionFailure(
      {
        ts: "2026-05-11T00:00:00.000Z",
        tool: "claude-code",
        sessionId: "84e7aabbccdd",
        lineNo: 17,
        reason: "zod: content[0].type must be 'text' | 'thinking' | ...",
      },
      { home: tmp },
    );
    await logIngestionFailure(
      {
        ts: "2026-05-11T00:00:01.000Z",
        tool: "claude-code",
        sessionId: "84e7aabbccdd",
        lineNo: 18,
        reason: "JSON.parse: unexpected end of input",
      },
      { home: tmp },
    );

    expect(existsSync(filePath)).toBe(true);
    const body = readFileSync(filePath, "utf8");
    const lines = body.split("\n").filter(Boolean);
    expect(lines).toHaveLength(2);

    const first = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(first.ts).toBe("2026-05-11T00:00:00.000Z");
    expect(first.tool).toBe("claude-code");
    expect(first.sessionId).toBe("84e7aabbccdd");
    expect(first.lineNo).toBe(17);
    expect(typeof first.reason).toBe("string");

    const second = JSON.parse(lines[1] ?? "{}") as Record<string, unknown>;
    expect(second.lineNo).toBe(18);
  });

  it("creates the parent directory if it does not exist", async () => {
    const filePath = resolveIngestionLogPath({ home: tmp });
    expect(existsSync(filePath)).toBe(false);
    await logIngestionFailure(
      {
        ts: "2026-05-11T00:00:00.000Z",
        tool: "claude-code",
        sessionId: "x",
        lineNo: 1,
        reason: "test",
      },
      { home: tmp },
    );
    expect(existsSync(filePath)).toBe(true);
  });
});

describe("sensitive-payload audit", () => {
  it("logger source has no occurrences of message.content / raw / lastPrompt as captured fields", async () => {
    // Tests run from apps/server/, so the source is at src/lib/logger.ts.
    const src = readFileSync(`${process.cwd()}/src/lib/logger.ts`, "utf8");
    // We allow the *names* to appear in comments (the spec mentions them). What
    // we forbid is them appearing as object keys or property accesses in code.
    // Strip comments first so the audit only inspects executable lines.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(stripped).not.toMatch(/\.content\b/);
    expect(stripped).not.toMatch(/\braw\b\s*[:=]/);
    expect(stripped).not.toMatch(/\blastPrompt\b/);
  });
});
