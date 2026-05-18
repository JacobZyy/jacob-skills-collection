import { EventEmitter } from "node:events";
import type {
  AttachmentRecord,
  MessageRecord,
  ProjectRecord,
  SessionRecord,
} from "@ai-chat-viewer/schema";
import type { SessionMetaPatch } from "@ai-chat-viewer/ingestion";

// Process-wide event bus connecting the ingestion runner (producer) to all
// SSE subscribers (consumers).
//
// Why this exists:
//   - The runner (packages/ingestion + apps/server/src/runner.ts) commits
//     parsed JSONL rows to SQLite in transactions. After each commit, it
//     publishes the change here so any connected /api/stream client gets
//     the update in <2s (AC-3).
//   - SSE clients connect at /api/stream and subscribe to these events
//     for the duration of their HTTP connection.
//
// Why a typed wrapper around EventEmitter:
//   - node:events EventEmitter is untyped — `emit(name, ...args)` and
//     `on(name, listener)` both default to `any`. That violates project
//     discipline (zero `any`) and means a runner bug emitting the wrong
//     payload shape would silently propagate to web clients.
//   - The `EmitterEvents` map declares each event name's argument tuple.
//     `IngestionBus.emit/on` are typed via method overloads against this
//     map. Any mismatch is a compile error.
//
// Why static event names (not arbitrary strings):
//   - The SSE endpoint converts `EmitterEvents` keys 1:1 to SSE `event:`
//     names. Worker-web's sse-client (#38) consumes the same set. Locking
//     them down prevents drift between producer, server, and consumer.

// Map of event name → emit arg tuple. Each entry is what the runner
// pushes when the corresponding state change is committed.
//
// Payload guarantees (the producer's contract):
//   - message-appended: a full MessageRecord that was just inserted. The
//     consumer can render it directly without a re-fetch.
//   - attachment-appended: a full AttachmentRecord. Same as above.
//   - session-updated: a {sessionId, patch} pair where `patch` is a
//     partial SessionRecord with ONLY the fields that changed (e.g.
//     {lastActivityAt, lastPrompt}). Consumers merge into existing state.
//   - project-updated: a full ProjectRecord. Project-level changes are
//     rare enough (new project observed, displayName change) that
//     sending the full row is cheaper than a patch schema.
//
// AC-3 measurement endpoint: time from JSONL byte arrival → here is the
// runner's responsibility; time from here → client.onmessage fires is
// the SSE pipeline's responsibility. The runner publishes synchronously
// inside the post-commit hook so there's no buffering delay.
export interface EmitterEvents {
  "message-appended": [MessageRecord];
  "attachment-appended": [AttachmentRecord];
  "session-updated": [
    {
      sessionId: string;
      patch: Partial<SessionRecord> & SessionMetaPatch;
    },
  ];
  "project-updated": [ProjectRecord];
}

// Allowed event names as a runtime-iterable tuple. The SSE route walks
// this when wiring listeners so adding a new event in EmitterEvents only
// requires adding the key here (TS catches a mismatch via the const-tuple
// inclusion).
export const EVENT_NAMES = [
  "message-appended",
  "attachment-appended",
  "session-updated",
  "project-updated",
] as const satisfies ReadonlyArray<keyof EmitterEvents>;

export type EventName = (typeof EVENT_NAMES)[number];

// Typed facade over EventEmitter. We keep the runtime EventEmitter so that
// listener removal semantics (off, listener counts) are stock Node, but
// erase its `any`-typed surface via overloads.
class IngestionBus {
  private readonly inner = new EventEmitter();

  constructor() {
    // setMaxListeners default is 10; SSE clients are 1 listener-per-event
    // each, so 10 concurrent clients would already warn. 100 is generous
    // for V1 (single-user local app) and still flags a real leak.
    this.inner.setMaxListeners(100);
  }

  emit<K extends EventName>(event: K, ...args: EmitterEvents[K]): void {
    this.inner.emit(event, ...args);
  }

  on<K extends EventName>(
    event: K,
    listener: (...args: EmitterEvents[K]) => void
  ): void {
    this.inner.on(event, listener as (...a: unknown[]) => void);
  }

  off<K extends EventName>(
    event: K,
    listener: (...args: EmitterEvents[K]) => void
  ): void {
    this.inner.off(event, listener as (...a: unknown[]) => void);
  }
}

// Module-singleton. The runner imports this exact instance and emits;
// the SSE route imports the same instance and subscribes.
export const ingestionBus = new IngestionBus();

// Strongly-typed emit helpers. The runner is expected to call THESE, not
// `ingestionBus.emit("...")` directly. The helpers exist so the call site
// reads as a verb (`emitMessageAppended(record)`) and so any payload type
// change forces a refactor through this file (single source of truth).

export function emitMessageAppended(record: MessageRecord): void {
  ingestionBus.emit("message-appended", record);
}

export function emitAttachmentAppended(record: AttachmentRecord): void {
  ingestionBus.emit("attachment-appended", record);
}

export function emitSessionUpdated(
  sessionId: string,
  patch: Partial<SessionRecord> & SessionMetaPatch
): void {
  ingestionBus.emit("session-updated", { sessionId, patch });
}

export function emitProjectUpdated(record: ProjectRecord): void {
  ingestionBus.emit("project-updated", record);
}
