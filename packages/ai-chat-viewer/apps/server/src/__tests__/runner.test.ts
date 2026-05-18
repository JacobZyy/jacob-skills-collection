import { describe, expect, it } from "bun:test";
import { _internalsForTest } from "../ingestion/runner";
import type { IngestionEvent, SessionMeta } from "@ai-chat-viewer/ingestion";

// Whitebox unit tests for the runner's per-session reducer and helpers.
//
// We do NOT exercise prisma.$transaction here. The DB layer is integration-
// tested via the catch-up stopwatch (AC-2 on real ~/.claude/projects). What
// we MUST pin down at the unit level:
//
//   1. SessionMeta first-wins by earliest observedAt (team-lead-pinned).
//   2. SessionMetaPatch last-wins per field (team-lead-pinned).
//   3. pickFirst/LastActivity scans messages + attachments + meta correctly.
//   4. sessionIdFromEvent returns the right id for all 4 event kinds.
//   5. toDropLogger forwards DropEvents through the (e: unknown) sink unchanged.

const {
  emptyBuffer,
  applyEventToBuffer,
  pickFirstActivity,
  pickLastActivity,
  sessionIdFromEvent,
  toDropLogger,
} = _internalsForTest;

function metaAt(observedAt: string, overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    tool: "claude-code",
    sessionId: "S1",
    cwd: "/Users/dev/repo",
    gitBranch: "main",
    version: "2.1.116",
    entrypoint: "cli",
    observedAt,
    ...overrides,
  };
}

function metaEvent(meta: SessionMeta, sourceOffset = 100): IngestionEvent {
  return { kind: "session-meta", sourceOffset, record: meta };
}

function patchEvent(
  patch: { sessionId: string; permissionMode?: string; lastPrompt?: string },
  sourceOffset = 200,
): IngestionEvent {
  return { kind: "session-meta-patch", sourceOffset, patch };
}

describe("applyEventToBuffer — SessionMeta first-wins by observedAt", () => {
  it("keeps the earlier observedAt when the second meta is later", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, metaEvent(metaAt("2026-05-10T10:00:00.000Z")));
    applyEventToBuffer(buf, metaEvent(metaAt("2026-05-10T11:00:00.000Z")));
    expect(buf.meta?.observedAt).toBe("2026-05-10T10:00:00.000Z");
  });

  it("replaces with the earlier observedAt when the second meta is earlier", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, metaEvent(metaAt("2026-05-10T10:00:00.000Z")));
    applyEventToBuffer(buf, metaEvent(metaAt("2026-05-10T09:00:00.000Z")));
    expect(buf.meta?.observedAt).toBe("2026-05-10T09:00:00.000Z");
  });

  it("retains the existing record on observedAt tie (no replacement)", () => {
    const buf = emptyBuffer("S1");
    const first = metaAt("2026-05-10T10:00:00.000Z", { gitBranch: "first" });
    const second = metaAt("2026-05-10T10:00:00.000Z", { gitBranch: "second" });
    applyEventToBuffer(buf, metaEvent(first));
    applyEventToBuffer(buf, metaEvent(second));
    expect(buf.meta?.gitBranch).toBe("first");
  });
});

describe("applyEventToBuffer — SessionMetaPatch last-wins per field", () => {
  it("overwrites permissionMode on each patch", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, patchEvent({ sessionId: "S1", permissionMode: "plan" }));
    applyEventToBuffer(buf, patchEvent({ sessionId: "S1", permissionMode: "acceptEdits" }));
    expect(buf.permissionMode).toBe("acceptEdits");
  });

  it("overwrites lastPrompt on each patch", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, patchEvent({ sessionId: "S1", lastPrompt: "first" }));
    applyEventToBuffer(buf, patchEvent({ sessionId: "S1", lastPrompt: "second" }));
    expect(buf.lastPrompt).toBe("second");
  });

  it("preserves fields not present in the latest patch (independent last-wins)", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, patchEvent({ sessionId: "S1", permissionMode: "plan", lastPrompt: "p1" }));
    applyEventToBuffer(buf, patchEvent({ sessionId: "S1", permissionMode: "acceptEdits" }));
    expect(buf.permissionMode).toBe("acceptEdits");
    expect(buf.lastPrompt).toBe("p1"); // not touched by second patch
  });

  it("leaves fields null until the first patch arrives", () => {
    const buf = emptyBuffer("S1");
    expect(buf.permissionMode).toBeNull();
    expect(buf.lastPrompt).toBeNull();
  });
});

describe("applyEventToBuffer — message/attachment append in physical order", () => {
  it("appends messages preserving insertion order", () => {
    const buf = emptyBuffer("S1");
    const events: IngestionEvent[] = [
      {
        kind: "message",
        sourceOffset: 10,
        record: {
          uuid: "m1",
          sessionId: "S1",
          tool: "claude-code",
          role: "user",
          timestamp: "2026-05-10T10:00:00.000Z",
          parentUuid: null,
          content: [],
          raw: {},
        },
      },
      {
        kind: "message",
        sourceOffset: 20,
        record: {
          uuid: "m2",
          sessionId: "S1",
          tool: "claude-code",
          role: "assistant",
          timestamp: "2026-05-10T10:00:05.000Z",
          parentUuid: "m1",
          content: [],
          raw: {},
        },
      },
    ];
    for (const e of events) applyEventToBuffer(buf, e);
    expect(buf.messages.map((m) => m.uuid)).toEqual(["m1", "m2"]);
  });
});

describe("pickFirstActivity / pickLastActivity", () => {
  it("returns null when buffer is empty", () => {
    const buf = emptyBuffer("S1");
    expect(pickFirstActivity(buf)).toBeNull();
    expect(pickLastActivity(buf)).toBeNull();
  });

  it("derives from messages alone", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, {
      kind: "message",
      sourceOffset: 10,
      record: {
        uuid: "m1",
        sessionId: "S1",
        tool: "claude-code",
        role: "user",
        timestamp: "2026-05-10T10:00:00.000Z",
        parentUuid: null,
        content: [],
        raw: {},
      },
    });
    applyEventToBuffer(buf, {
      kind: "message",
      sourceOffset: 20,
      record: {
        uuid: "m2",
        sessionId: "S1",
        tool: "claude-code",
        role: "assistant",
        timestamp: "2026-05-10T12:00:00.000Z",
        parentUuid: "m1",
        content: [],
        raw: {},
      },
    });
    expect(pickFirstActivity(buf)).toBe("2026-05-10T10:00:00.000Z");
    expect(pickLastActivity(buf)).toBe("2026-05-10T12:00:00.000Z");
  });

  it("includes meta.observedAt in the scan", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, metaEvent(metaAt("2026-05-10T09:00:00.000Z")));
    applyEventToBuffer(buf, {
      kind: "message",
      sourceOffset: 10,
      record: {
        uuid: "m1",
        sessionId: "S1",
        tool: "claude-code",
        role: "user",
        timestamp: "2026-05-10T11:00:00.000Z",
        parentUuid: null,
        content: [],
        raw: {},
      },
    });
    // meta is earlier than the only message
    expect(pickFirstActivity(buf)).toBe("2026-05-10T09:00:00.000Z");
    expect(pickLastActivity(buf)).toBe("2026-05-10T11:00:00.000Z");
  });

  it("includes attachments in the scan", () => {
    const buf = emptyBuffer("S1");
    applyEventToBuffer(buf, {
      kind: "attachment",
      sourceOffset: 30,
      record: {
        uuid: "a1",
        sessionId: "S1",
        tool: "claude-code",
        timestamp: "2026-05-10T14:00:00.000Z",
        type: "tool-use-result",
        payload: {},
        raw: {},
      },
    });
    expect(pickFirstActivity(buf)).toBe("2026-05-10T14:00:00.000Z");
    expect(pickLastActivity(buf)).toBe("2026-05-10T14:00:00.000Z");
  });
});

describe("sessionIdFromEvent", () => {
  it("returns sessionId for message events", () => {
    expect(
      sessionIdFromEvent({
        kind: "message",
        sourceOffset: 10,
        record: {
          uuid: "m1",
          sessionId: "S-msg",
          tool: "claude-code",
          role: "user",
          timestamp: "2026-05-10T10:00:00.000Z",
          parentUuid: null,
          content: [],
          raw: {},
        },
      }),
    ).toBe("S-msg");
  });

  it("returns sessionId for attachment events", () => {
    expect(
      sessionIdFromEvent({
        kind: "attachment",
        sourceOffset: 10,
        record: {
          uuid: "a1",
          sessionId: "S-att",
          tool: "claude-code",
          timestamp: "2026-05-10T10:00:00.000Z",
          type: "tool-use-result",
          payload: {},
          raw: {},
        },
      }),
    ).toBe("S-att");
  });

  it("returns sessionId for session-meta events", () => {
    expect(
      sessionIdFromEvent(metaEvent(metaAt("2026-05-10T10:00:00.000Z", { sessionId: "S-meta" }))),
    ).toBe("S-meta");
  });

  it("returns sessionId for session-meta-patch events", () => {
    expect(
      sessionIdFromEvent(patchEvent({ sessionId: "S-patch", permissionMode: "plan" })),
    ).toBe("S-patch");
  });
});

describe("toDropLogger — shape-preserving forward", () => {
  it("forwards DropEvent verbatim through the unknown sink", () => {
    const captured: unknown[] = [];
    const log = toDropLogger((e) => captured.push(e));
    const drop = {
      timestamp: "2026-05-10T10:00:00.000Z",
      sessionId: "S1",
      lineNo: 42,
      reason: "schema-violation" as const,
      detail: "missing uuid",
    };
    log(drop);
    expect(captured.length).toBe(1);
    expect(captured[0]).toBe(drop); // reference-equal: no mutation/cloning
  });
});
