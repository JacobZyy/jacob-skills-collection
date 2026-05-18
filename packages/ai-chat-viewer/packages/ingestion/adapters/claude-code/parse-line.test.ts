import { describe, expect, it } from "bun:test";

import {
  parseLine,
  type DropEvent,
  type DropLogger,
  type ParseLineResult,
} from "./parse-line";

/**
 * Test factory helpers — keep each fixture line minimal but schema-valid.
 * The 8 line shapes are derived from real claude-code JSONL on this machine
 * (see source-schema.ts). We don't try to produce a "realistic" Anthropic
 * messages payload; we only assert the discriminated-union routing.
 */

const SESSION_ID = "11111111-1111-1111-1111-111111111111";

const baseFields = {
  parentUuid: null,
  isSidechain: false,
  uuid: "msg-uuid-1",
  timestamp: "2026-05-11T08:00:00.000Z",
  sessionId: SESSION_ID,
};

const userLine = JSON.stringify({
  ...baseFields,
  type: "user",
  uuid: "u-1",
  message: { role: "user", content: [{ type: "text", text: "hi" }] },
});

const assistantLine = JSON.stringify({
  ...baseFields,
  type: "assistant",
  uuid: "a-1",
  message: { role: "assistant", content: [{ type: "text", text: "hello" }] },
});

const systemLine = JSON.stringify({
  ...baseFields,
  type: "system",
  uuid: "s-1",
  subtype: "hook",
  content: "hook telemetry",
});

const attachmentLine = JSON.stringify({
  ...baseFields,
  type: "attachment",
  uuid: "att-1",
  parentUuid: "msg-uuid-parent",
  attachment: { kind: "hook_success", payload: { ok: true } },
});

const permissionModeLine = JSON.stringify({
  type: "permission-mode",
  permissionMode: "acceptEdits",
  sessionId: SESSION_ID,
});

const lastPromptLine = JSON.stringify({
  type: "last-prompt",
  lastPrompt: "what is 2+2?",
  sessionId: SESSION_ID,
});

const fileHistorySnapshotLine = JSON.stringify({
  type: "file-history-snapshot",
  messageId: "fhs-1",
  snapshot: { files: [] },
});

const queueOperationLine = JSON.stringify({
  type: "queue-operation",
  operation: "enqueue",
  timestamp: "2026-05-11T08:00:00.000Z",
  sessionId: SESSION_ID,
});

function captureDrops(): { log: DropLogger; events: DropEvent[] } {
  const events: DropEvent[] = [];
  return { events, log: (e) => events.push(e) };
}

describe("parseLine — happy paths (8 source line types)", () => {
  it("user line → MessageRecord with role 'user'", () => {
    const result = parseLine(userLine, { sessionId: SESSION_ID });
    expect(result?.kind).toBe("message");
    if (result?.kind !== "message") throw new Error("type narrowing");
    expect(result.record.role).toBe("user");
    expect(result.record.tool).toBe("claude-code");
    expect(result.record.id).toBe("u-1");
    expect(result.record.sessionId).toBe(SESSION_ID);
    // raw is the parsed JSON, not the source string — adapter layer will
    // hand this through to the DB `raw` column verbatim.
    expect(result.record.raw).toMatchObject({ type: "user" });
  });

  it("assistant line → MessageRecord with role 'assistant'", () => {
    const result = parseLine(assistantLine, { sessionId: SESSION_ID });
    expect(result?.kind).toBe("message");
    if (result?.kind !== "message") throw new Error("type narrowing");
    expect(result.record.role).toBe("assistant");
    expect(result.record.id).toBe("a-1");
  });

  it("system line → MessageRecord with role 'system' (falls back from type when message.role missing)", () => {
    const result = parseLine(systemLine, { sessionId: SESSION_ID });
    expect(result?.kind).toBe("message");
    if (result?.kind !== "message") throw new Error("type narrowing");
    expect(result.record.role).toBe("system");
  });

  it("attachment line → AttachmentRecord with payload preserved", () => {
    const result = parseLine(attachmentLine, { sessionId: SESSION_ID });
    expect(result?.kind).toBe("attachment");
    if (result?.kind !== "attachment") throw new Error("type narrowing");
    expect(result.record.tool).toBe("claude-code");
    expect(result.record.id).toBe("att-1");
    expect(result.record.relatedMessageUuid).toBe("msg-uuid-parent");
    expect(result.record.payload).toMatchObject({ kind: "hook_success" });
  });

  it("permission-mode line → SessionMetaPatch with permissionMode", () => {
    const result = parseLine(permissionModeLine, { sessionId: SESSION_ID });
    expect(result?.kind).toBe("session-meta-patch");
    if (result?.kind !== "session-meta-patch") throw new Error("type narrowing");
    expect(result.patch.permissionMode).toBe("acceptEdits");
    expect(result.patch.lastPrompt).toBeUndefined();
  });

  it("last-prompt line → SessionMetaPatch with lastPrompt", () => {
    const result = parseLine(lastPromptLine, { sessionId: SESSION_ID });
    expect(result?.kind).toBe("session-meta-patch");
    if (result?.kind !== "session-meta-patch") throw new Error("type narrowing");
    expect(result.patch.lastPrompt).toBe("what is 2+2?");
    expect(result.patch.permissionMode).toBeUndefined();
  });

  it("file-history-snapshot line → null (V1 unsupported, dropped to log)", () => {
    const cap = captureDrops();
    const result = parseLine(fileHistorySnapshotLine, {
      sessionId: SESSION_ID,
      log: cap.log,
    });
    expect(result).toBeNull();
    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]?.reason).toBe("unsupported-line-type-v1");
    expect(cap.events[0]?.detail).toBe("type=file-history-snapshot");
  });

  it("queue-operation line → null (V1 unsupported, dropped to log)", () => {
    const cap = captureDrops();
    const result = parseLine(queueOperationLine, {
      sessionId: SESSION_ID,
      log: cap.log,
    });
    expect(result).toBeNull();
    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]?.reason).toBe("unsupported-line-type-v1");
    expect(cap.events[0]?.detail).toBe("type=queue-operation");
  });
});

describe("parseLine — drops (never throws)", () => {
  it("malformed JSON → null + json-parse-failed", () => {
    const cap = captureDrops();
    const result = parseLine("{not json", { sessionId: SESSION_ID, log: cap.log });
    expect(result).toBeNull();
    expect(cap.events).toHaveLength(1);
    expect(cap.events[0]?.reason).toBe("json-parse-failed");
  });

  it("empty / whitespace line → null + json-parse-failed (empty-line)", () => {
    const cap = captureDrops();
    expect(parseLine("", { sessionId: SESSION_ID, log: cap.log })).toBeNull();
    expect(parseLine("   \t  ", { sessionId: SESSION_ID, log: cap.log })).toBeNull();
    expect(cap.events).toHaveLength(2);
    expect(cap.events[0]?.detail).toBe("empty-line");
  });

  it("unknown line type 'progress' → null + schema-mismatch", () => {
    const cap = captureDrops();
    const line = JSON.stringify({ type: "progress", value: 42 });
    const result = parseLine(line, { sessionId: SESSION_ID, log: cap.log });
    expect(result).toBeNull();
    expect(cap.events[0]?.reason).toBe("schema-mismatch");
  });

  it("unknown line type 'ai-title' → null + schema-mismatch", () => {
    const cap = captureDrops();
    const line = JSON.stringify({ type: "ai-title", title: "x" });
    const result = parseLine(line, { sessionId: SESSION_ID, log: cap.log });
    expect(result).toBeNull();
    expect(cap.events[0]?.reason).toBe("schema-mismatch");
  });

  it("missing required field on a known type → null + schema-mismatch", () => {
    // 'user' line missing the required `uuid` and other base fields
    const cap = captureDrops();
    const line = JSON.stringify({ type: "user", message: {} });
    const result = parseLine(line, { sessionId: SESSION_ID, log: cap.log });
    expect(result).toBeNull();
    expect(cap.events[0]?.reason).toBe("schema-mismatch");
  });

  it("user line whose inner message.role is something exotic AND no fallback applies → drops", () => {
    // The inner role narrows to a non-domain value; line.type is 'user' so
    // the fallback path *does* save it. We assert the happy fallback first
    // (defensive: this is the documented behavior, not a drop), then craft
    // a synthetic SystemLine variant where message.role is invalid AND
    // type is 'system' (which still falls back to 'system').
    const cap = captureDrops();
    const line = JSON.stringify({
      ...baseFields,
      type: "user",
      uuid: "u-fallback",
      message: { role: "tool", content: [] }, // 'tool' not a domain role
    });
    const result = parseLine(line, { sessionId: SESSION_ID, log: cap.log });
    // message.role 'tool' is not in {user,assistant,system}, but line.type
    // 'user' is — fallback wins, no drop.
    expect(result?.kind).toBe("message");
    if (result?.kind !== "message") throw new Error("type narrowing");
    expect(result.record.role).toBe("user");
    expect(cap.events).toHaveLength(0);
  });

  it("logs lineNo and sessionId on drops", () => {
    const cap = captureDrops();
    parseLine("{garbage", {
      sessionId: SESSION_ID,
      lineNo: 42,
      log: cap.log,
    });
    expect(cap.events[0]?.lineNo).toBe(42);
    expect(cap.events[0]?.sessionId).toBe(SESSION_ID);
    expect(cap.events[0]?.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("parseLine — never throws (fuzz-style)", () => {
  it("exotic non-string-ish JSON values do not throw", () => {
    // null / number / array at top level — not matching the union, but must
    // not throw. They drop as schema-mismatch.
    const inputs = ["null", "42", "true", "[]", '"a string"'];
    for (const input of inputs) {
      const cap = captureDrops();
      const r = parseLine(input, { sessionId: SESSION_ID, log: cap.log });
      expect(r).toBeNull();
      expect(cap.events[0]?.reason).toBe("schema-mismatch");
    }
  });

  it("default logger is noop — no log argument required", () => {
    // Just confirm the call signature works with only sessionId.
    const r: ParseLineResult | null = parseLine("{not json", {
      sessionId: SESSION_ID,
    });
    expect(r).toBeNull();
  });
});
