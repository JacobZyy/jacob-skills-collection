import { describe, expect, it } from "bun:test";
import { Hono } from "hono";
import {
  AttachmentRecordSchema,
  MessageRecordSchema,
  ProjectRecordSchema,
  type AttachmentRecord,
  type MessageRecord,
  type ProjectRecord,
  type SessionRecord,
} from "@ai-chat-viewer/schema";
import {
  emitAttachmentAppended,
  emitMessageAppended,
  emitProjectUpdated,
  emitSessionUpdated,
} from "../sse/bus";
import { streamRouter } from "../sse/stream";

// E2E for the SSE mechanism (#28). Strategy:
//   - Build a tiny Hono app with just streamRouter mounted.
//   - app.fetch() a /stream Request, get back a Response whose body is a
//     ReadableStream of the SSE wire frames.
//   - Spin a microtask queue: read the first chunk to confirm "hello", then
//     emit a typed payload from the producer side and read the next chunk.
//   - Parse the SSE frame text into {event, data} and validate `data` against
//     its Zod schema. Schema validation is the contract gate — if the bus
//     ever serialized the wrong shape this test goes red.
//
// AC-3 (p95<2s catch-up) is verified end-to-end by worker-1's verify-ac3
// script after #16 + #38 land. THIS file only verifies that the mechanism
// (emit → SSE frame → parse → schema-valid) works at all.

interface ParsedFrame {
  event: string;
  id: string | null;
  data: string;
}

// Parse a single SSE frame block (terminated by a blank line). The wire
// format used by hono/streaming matches the SSE spec:
//   event: <name>\n
//   id: <n>\n
//   data: <json>\n
//   \n
// Comment lines start with `:` and we ignore them (heartbeat, etc.).
function parseSseFrame(block: string): ParsedFrame | null {
  const lines = block.split("\n").filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  let event = "message";
  let id: string | null = null;
  const dataParts: string[] = [];
  for (const line of lines) {
    if (line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("id:")) id = line.slice(3).trim();
    else if (line.startsWith("data:")) dataParts.push(line.slice(5).trim());
  }
  if (event === "message" && dataParts.length === 0) return null;
  return { event, id, data: dataParts.join("\n") };
}

// Pull frames from a ReadableStream<Uint8Array>. Returns the async iterator
// alongside a `close()` we can call from the test once we have what we need.
// Cancelling the underlying reader (rather than the body) is required because
// `getReader()` locks the stream — `body.cancel()` after lock acquisition
// throws ERR_INVALID_STATE.
interface FrameSource {
  next(): Promise<IteratorResult<ParsedFrame>>;
  close(): Promise<void>;
}

function readFrames(body: ReadableStream<Uint8Array>): FrameSource {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const queue: ParsedFrame[] = [];
  let closed = false;

  async function pump(): Promise<void> {
    while (queue.length === 0 && !closed) {
      const { value, done } = await reader.read();
      if (done) {
        closed = true;
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf("\n\n");
      while (idx !== -1) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const parsed = parseSseFrame(block);
        if (parsed) queue.push(parsed);
        idx = buffer.indexOf("\n\n");
      }
    }
  }

  return {
    async next(): Promise<IteratorResult<ParsedFrame>> {
      await pump();
      const value = queue.shift();
      if (value === undefined) return { value: undefined, done: true };
      return { value, done: false };
    },
    async close(): Promise<void> {
      closed = true;
      // reader.cancel() releases the lock and triggers the route's onAbort
      // hook so listeners detach. Do not call body.cancel() here — the
      // reader holds the lock.
      try {
        await reader.cancel();
      } catch {
        // already closed by the producer; nothing to clean up.
      }
    },
  };
}

// Build a fixture that satisfies a given Zod schema. We hand-roll these
// rather than auto-generate so a renamed field surfaces as a compile error
// here, not a runtime test failure.

function fakeMessage(): MessageRecord {
  return {
    id: "msg-1",
    sessionId: "session-abc",
    parentUuid: null,
    tool: "claude-code",
    role: "user",
    content: { type: "text", text: "hello" },
    isSidechain: false,
    timestamp: "2026-05-10T19:00:00.000Z",
    raw: { line: 1 },
  };
}

function fakeAttachment(): AttachmentRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    sessionId: "session-abc",
    tool: "claude-code",
    type: "hook_success",
    payload: { ok: true },
    relatedMessageUuid: null,
    timestamp: "2026-05-10T19:00:01.000Z",
  };
}

function fakeSessionPatch(): { sessionId: string; patch: Partial<SessionRecord> } {
  return {
    sessionId: "session-abc",
    patch: {
      lastActivityAt: "2026-05-10T19:00:02.000Z",
      lastPrompt: "what's the time?",
    },
  };
}

function fakeProject(): ProjectRecord {
  return {
    cwdHash: "0123456789abcdef",
    cwd: "/tmp/some/project",
    displayName: "project",
    lastSeenAt: "2026-05-10T19:00:03.000Z",
    firstSeenAt: "2026-05-10T18:00:00.000Z",
  };
}

// One helper that runs the whole connect → emit → assert dance for any
// event. Keeping it generic over the schema means each test below is a
// one-liner — and adding a new event to the bus is one more it() call.
async function emitAndExpect<T>(
  emit: () => void,
  expectedEvent: string,
  validate: (data: unknown) => T
): Promise<T> {
  const app = new Hono().route("/api", streamRouter);
  // app.fetch resolves AS SOON AS the response headers have been sent — the
  // body stays open and is consumed via the ReadableStream below.
  const res = await app.fetch(
    new Request("http://localhost/api/stream", {
      headers: { Accept: "text/event-stream" },
    })
  );
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const body = res.body;
  if (body === null) throw new Error("expected SSE response to have a body");

  const frames = readFrames(body);

  // The endpoint sends `hello` synchronously after install. Wait for it
  // before we emit — otherwise we race the listener-install path and the
  // emit can fire before the bus has our subscriber wired up.
  const hello = await frames.next();
  expect(hello.done).toBe(false);
  expect(hello.value?.event).toBe("hello");

  emit();

  // Pull frames until we see the one we care about. We may receive a
  // heartbeat in between if the test is slow, so loop rather than assume
  // the next frame is ours.
  let received: ParsedFrame | null = null;
  for (let i = 0; i < 5; i++) {
    const next = await frames.next();
    if (next.done) break;
    if (next.value.event === expectedEvent) {
      received = next.value;
      break;
    }
  }
  if (received === null) {
    throw new Error(`did not receive event ${expectedEvent}`);
  }

  const parsedData = JSON.parse(received.data) as unknown;
  const validated = validate(parsedData);
  // Cancel via the reader (frames.close) — body.cancel() would throw
  // because getReader() has locked the body.
  await frames.close();
  return validated;
}

describe("SSE /api/stream", () => {
  it("emits an initial `hello` frame on connect", async () => {
    const app = new Hono().route("/api", streamRouter);
    const res = await app.fetch(
      new Request("http://localhost/api/stream", {
        headers: { Accept: "text/event-stream" },
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const body = res.body;
    if (body === null) throw new Error("expected body");
    const frames = readFrames(body);
    const first = await frames.next();
    expect(first.done).toBe(false);
    expect(first.value?.event).toBe("hello");
    expect(first.value?.id).toBe("0");
    const payload = JSON.parse(first.value!.data) as { ts: string };
    expect(typeof payload.ts).toBe("string");
    // Cancel so the connection's onAbort cleanup runs.
    await frames.close();
  });

  it("forwards message-appended payloads that round-trip through MessageRecordSchema", async () => {
    const fixture = fakeMessage();
    const validated = await emitAndExpect(
      () => emitMessageAppended(fixture),
      "message-appended",
      (data) => MessageRecordSchema.parse(data)
    );
    expect(validated.id).toBe(fixture.id);
    expect(validated.sessionId).toBe(fixture.sessionId);
    expect(validated.role).toBe("user");
  });

  it("forwards attachment-appended payloads that round-trip through AttachmentRecordSchema", async () => {
    const fixture = fakeAttachment();
    const validated = await emitAndExpect(
      () => emitAttachmentAppended(fixture),
      "attachment-appended",
      (data) => AttachmentRecordSchema.parse(data)
    );
    expect(validated.id).toBe(fixture.id);
    expect(validated.type).toBe("hook_success");
  });

  it("forwards session-updated patches with sessionId + partial patch", async () => {
    const fixture = fakeSessionPatch();
    // session-updated payload is {sessionId, patch}; patch is Partial<SessionRecord>
    // so we can't run the full schema.parse — assert structurally instead.
    const validated = await emitAndExpect<{
      sessionId: string;
      patch: Partial<SessionRecord>;
    }>(
      () => emitSessionUpdated(fixture.sessionId, fixture.patch),
      "session-updated",
      (data) => {
        if (
          typeof data !== "object" ||
          data === null ||
          !("sessionId" in data) ||
          !("patch" in data)
        ) {
          throw new Error("expected {sessionId, patch} shape");
        }
        return data as { sessionId: string; patch: Partial<SessionRecord> };
      }
    );
    expect(validated.sessionId).toBe("session-abc");
    expect(validated.patch.lastPrompt).toBe("what's the time?");
  });

  it("forwards project-updated payloads that round-trip through ProjectRecordSchema", async () => {
    const fixture = fakeProject();
    const validated = await emitAndExpect(
      () => emitProjectUpdated(fixture),
      "project-updated",
      (data) => ProjectRecordSchema.parse(data)
    );
    expect(validated.cwdHash).toBe(fixture.cwdHash);
    expect(validated.displayName).toBe("project");
  });
});
