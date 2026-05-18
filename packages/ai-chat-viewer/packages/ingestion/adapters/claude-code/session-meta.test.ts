import { describe, expect, it } from "bun:test";

import {
  extractSessionMetaFromLine,
  reduceSessionMeta,
} from "./session-meta";

const SESSION_ID = "0a599564-6dba-4fe7-8b56-7edf510dc670";

// Real attachment line from
// ~/.claude/projects/-Users-jacobzha/0a599564-...jsonl  (truncated payload).
const realAttachmentRaw = {
  parentUuid: null,
  isSidechain: false,
  attachment: { type: "hook_success", content: "ok" },
  type: "attachment",
  uuid: "36998cf0-1497-4de1-bab9-c1b4cec9b526",
  timestamp: "2026-04-13T11:51:58.791Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/jacobzha",
  sessionId: SESSION_ID,
  version: "2.1.104",
  gitBranch: "HEAD",
};

const realUserLineRaw = {
  parentUuid: null,
  isSidechain: false,
  type: "user",
  uuid: "u-2",
  timestamp: "2026-04-13T11:52:00.000Z",
  cwd: "/Users/jacobzha/Documents/workspace/jacob-open-source/ai-chat-viewer",
  sessionId: SESSION_ID,
  version: "2.1.116",
  gitBranch: "main",
  entrypoint: "cli",
  message: { role: "user", content: [] },
};

describe("extractSessionMetaFromLine", () => {
  it("extracts cwd / gitBranch / version / entrypoint from a real attachment line", () => {
    const meta = extractSessionMetaFromLine(realAttachmentRaw);
    expect(meta).not.toBeNull();
    expect(meta?.tool).toBe("claude-code");
    expect(meta?.sessionId).toBe(SESSION_ID);
    expect(meta?.cwd).toBe("/Users/jacobzha");
    expect(meta?.gitBranch).toBe("HEAD");
    expect(meta?.version).toBe("2.1.104");
    expect(meta?.entrypoint).toBe("cli");
    expect(meta?.observedAt).toBe("2026-04-13T11:51:58.791Z");
  });

  it("extracts meta from a user line (claude-code stamps the same fields there too)", () => {
    const meta = extractSessionMetaFromLine(realUserLineRaw);
    expect(meta?.cwd).toBe(
      "/Users/jacobzha/Documents/workspace/jacob-open-source/ai-chat-viewer",
    );
    expect(meta?.gitBranch).toBe("main");
    expect(meta?.version).toBe("2.1.116");
    expect(meta?.sessionId).toBe(SESSION_ID);
  });

  it("returns null on permission-mode line (no cwd)", () => {
    const line = {
      type: "permission-mode",
      permissionMode: "bypassPermissions",
      sessionId: SESSION_ID,
    };
    expect(extractSessionMetaFromLine(line)).toBeNull();
  });

  it("returns null on file-history-snapshot line (no sessionId/cwd)", () => {
    const line = {
      type: "file-history-snapshot",
      messageId: "x",
      snapshot: { trackedFileBackups: {} },
    };
    expect(extractSessionMetaFromLine(line)).toBeNull();
  });

  it("returns null when input is not an object", () => {
    expect(extractSessionMetaFromLine(null)).toBeNull();
    expect(extractSessionMetaFromLine(42)).toBeNull();
    expect(extractSessionMetaFromLine("foo")).toBeNull();
  });

  it("fills missing optional fields with null", () => {
    const minimal = {
      sessionId: SESSION_ID,
      cwd: "/x",
      timestamp: "2026-05-01T00:00:00.000Z",
    };
    const meta = extractSessionMetaFromLine(minimal);
    expect(meta?.cwd).toBe("/x");
    expect(meta?.gitBranch).toBeNull();
    expect(meta?.version).toBeNull();
    expect(meta?.entrypoint).toBeNull();
  });

  it("treats empty cwd as 'no meta'", () => {
    const line = {
      sessionId: SESSION_ID,
      cwd: "",
      timestamp: "2026-05-01T00:00:00.000Z",
    };
    expect(extractSessionMetaFromLine(line)).toBeNull();
  });

  it("returns null when sessionId is missing", () => {
    const line = { cwd: "/x", timestamp: "2026-05-01T00:00:00.000Z" };
    expect(extractSessionMetaFromLine(line)).toBeNull();
  });
});

describe("reduceSessionMeta", () => {
  it("returns null when no metas seen", () => {
    expect(reduceSessionMeta([])).toBeNull();
  });

  it("picks the earliest observation by observedAt", () => {
    const earlier = extractSessionMetaFromLine(realAttachmentRaw);
    const later = extractSessionMetaFromLine(realUserLineRaw);
    expect(earlier).not.toBeNull();
    expect(later).not.toBeNull();
    if (earlier === null || later === null) throw new Error("type narrowing");

    // Reverse the iteration order: the reducer must still pick the earliest.
    const winner = reduceSessionMeta([later, earlier]);
    expect(winner?.cwd).toBe("/Users/jacobzha");
    expect(winner?.observedAt).toBe("2026-04-13T11:51:58.791Z");
  });

  it("keeps a single observation untouched", () => {
    const only = extractSessionMetaFromLine(realAttachmentRaw);
    if (only === null) throw new Error("setup");
    expect(reduceSessionMeta([only])).toEqual(only);
  });
});
