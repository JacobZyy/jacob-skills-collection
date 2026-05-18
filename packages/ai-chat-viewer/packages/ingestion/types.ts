// Ingestion adapter contract.
//
// This is the layer that turns a tool's raw on-disk format (JSONL files,
// SQLite stores, log directories, ...) into the domain-level records
// defined in @ai-chat-viewer/schema.
//
// V1 ships a single implementation (claude-code) under
// packages/ingestion/adapters/claude-code/. The interface is shaped now
// so V2 adapters (Cursor, Cline, Aider, ...) plug in without rewiring
// the runner or the API.
//
// Discipline:
//   - This interface MUST NOT reference any tool-private symbol
//     (no claude-code Block union, no JSONL line literals, no decode-cwd
//     return shape). Tool-specific shapes belong inside their adapter
//     directory; the runner only ever sees domain records flowing through
//     this contract.
//   - `tool` is `'claude-code'` for V1. V2+ widens to a string-literal
//     union — adding a new tool means extending that union AND providing
//     a corresponding domain-schema bump (since MessageRecord.tool is
//     also pinned at v1).

import type { AttachmentRecord, MessageRecord } from "@ai-chat-viewer/schema";

/**
 * Per-session metadata extracted from source-side context (e.g. the `cwd`,
 * `gitBranch`, and `version` fields claude-code stamps on attachment rows).
 *
 * The runner uses this to hydrate the `Session` row — values are typically
 * stable across the session, so emitting the first one wins; later
 * occurrences should match. The adapter is allowed to emit zero or more
 * SessionMeta events per scan; the runner deduplicates by `sessionId`.
 */
export interface SessionMeta {
  /** Tool tag, mirrors the discriminator on MessageRecord/AttachmentRecord. */
  tool: "claude-code";
  /** Session UUID — must match the `sessionId` of message/attachment events. */
  sessionId: string;
  /** Absolute working directory captured by the source tool. */
  cwd: string;
  /** Optional git branch name at session start. */
  gitBranch: string | null;
  /** Optional source-tool version string (e.g. claude-code "2.1.116"). */
  version: string | null;
  /** Optional CLI entrypoint identifier (e.g. claude-code "cli"). */
  entrypoint: string | null;
  /**
   * Wall-clock timestamp of the source row that produced this metadata, so
   * the runner can prefer the earliest observation when the same session
   * yields multiple variants.
   */
  observedAt: string;
}

/**
 * Per-line incremental update for session-scoped fields that do NOT live on
 * SessionMeta because they are "latest wins" rather than "first observation
 * wins". Two carriers in V1:
 *
 *   - `permission-mode` source line  → emits `permissionMode`
 *   - `last-prompt` source line      → emits `lastPrompt`
 *
 * The runner folds these directly onto the Session row, overwriting on every
 * occurrence. Either field may be present in isolation; an event with both
 * unset is meaningless and should not be emitted.
 */
export interface SessionMetaPatch {
  /** Owning session — pairs with the same id on accompanying records. */
  sessionId: string;
  /** Most recent permission mode (e.g. claude-code "acceptEdits"). */
  permissionMode?: string;
  /** Most recent user-typed prompt for this session. */
  lastPrompt?: string;
}

/**
 * Discriminated union of everything an adapter can emit during a scan or
 * tail. The runner switches on `kind` and routes each event into the
 * appropriate table (or onto the SSE bus).
 *
 * Every event carries `sourceOffset` — the byte position immediately AFTER
 * the source line that produced it (i.e. the offset the runner should
 * persist as `lastByteOffset` once this event is durably committed). On
 * truncate the runner detects shrinkage and resets independent of this.
 *
 * Note: messages and attachments are already domain records — by the time
 * an event leaves the adapter, all tool-private shapes have been parsed
 * away into `content` / `payload` / `raw` opaque fields.
 */
export type IngestionEvent =
  | { kind: "message"; sourceOffset: number; record: MessageRecord }
  | { kind: "attachment"; sourceOffset: number; record: AttachmentRecord }
  | { kind: "session-meta"; sourceOffset: number; record: SessionMeta }
  | { kind: "session-meta-patch"; sourceOffset: number; patch: SessionMetaPatch };

/**
 * Cursor describing where in a tail-able file the adapter should resume
 * reading. `byteOffset` is the standard form (claude-code's append-only
 * JSONL); other adapters may choose a different cursor shape inside their
 * own implementation as long as the tail() input remains a `number`.
 *
 * V1 uses a plain byte offset because:
 *   - JSONL is line-delimited, so byte offsets land on line boundaries
 *     after a successful parse.
 *   - On truncate the runner detects shrinkage and resets the cursor to 0
 *     (this is the runner's job, not the adapter's).
 */
export type TailCursor = number;

/**
 * Adapter contract. One implementation per source tool. Live under
 * packages/ingestion/adapters/<tool>/.
 *
 * Lifecycle (driven by the ingestion runner):
 *   1. detectRoot() — locate the tool's data directory on disk.
 *   2. scan(rootDir) — full catch-up: yield every event in physical order,
 *      session-by-session. Used at boot and after DB reset (AC-2, AC-7).
 *   3. tail(filePath, fromOffset) — incremental: yield events appended
 *      since `fromOffset`. Used by the watcher when chokidar reports a
 *      change. Must be safe to call repeatedly with the same offset
 *      (idempotent re-reads on partial-line tail).
 *
 * The adapter MUST NOT throw on malformed input. Parse errors are reported
 * via the per-event channel (V2 may add a `{ kind: "parse-error", ... }`
 * variant; for V1 the runner's logger handles drops out-of-band).
 */
export interface IngestionAdapter {
  /**
   * Tag identifying which source tool this adapter handles. V1 fixed at
   * `'claude-code'`; V2+ widens to a union.
   */
  readonly tool: "claude-code";

  /**
   * Resolve the tool's on-disk data directory (e.g. claude-code returns
   * `~/.claude/projects`). Pure / side-effect-free; result is the
   * canonical absolute path used as input to scan().
   */
  detectRoot(): string;

  /**
   * Stream every event under `rootDir` in physical order. The runner
   * consumes the iterable inside a transaction-batched upsert loop; back-
   * pressure is implicit (adapter only reads when the consumer awaits).
   *
   * Caller contract:
   *   - `rootDir` MUST be an absolute path (typically detectRoot()).
   *   - The adapter walks every session file under it.
   *   - Events for the same session SHOULD be contiguous, so the runner
   *     can amortize transaction starts.
   */
  scan(rootDir: string): AsyncIterable<IngestionEvent>;

  /**
   * Stream every event appended to `filePath` since `fromOffset`. The
   * runner calls this on chokidar `change` notifications.
   *
   * Caller contract:
   *   - `filePath` is an absolute path to a single session file.
   *   - `fromOffset` is the cursor the runner stored after the previous
   *     tail/scan completed for this file. The adapter is allowed to
   *     re-emit events at exactly `fromOffset` if it cannot reliably
   *     resume mid-line — the runner deduplicates on uuid upsert.
   *   - Truncation (file shrunk below `fromOffset`) is the runner's
   *     concern; this method may treat negative or stale offsets as 0.
   */
  tail(filePath: string, fromOffset: TailCursor): AsyncIterable<IngestionEvent>;
}
