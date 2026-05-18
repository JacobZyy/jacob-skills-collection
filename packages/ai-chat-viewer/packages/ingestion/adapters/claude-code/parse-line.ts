// Single-line parser for claude-code session JSONL lines.
//
// Contract (T14):
//   - Input: one raw JSONL line (no trailing newline) + the owning sessionId
//     (the runner already knows it from the file path).
//   - Output: a discriminated `ParseLineResult` (or `null` for "drop me").
//   - NEVER throws. Every failure path is reported via the injected logger
//     and yields a `null` to the caller; the surrounding scan/tail loop
//     keeps going.
//
// Drop reasons (all logged to ingestion.log via the injected sink):
//   - "json-parse-failed"           : JSON.parse threw
//   - "schema-mismatch"             : not one of the 8 known line types
//   - "unsupported-line-type-v1"    : file-history-snapshot / queue-operation
//                                     are kept in raw form on disk only;
//                                     V1 does not surface them in any DB
//                                     table (per task spec)
//   - "message-payload-malformed"   : user/assistant/system line, but the
//                                     embedded message.role / message.content
//                                     could not be narrowed to a domain role
//
// Why this routing:
//   user/assistant/system → MessageRecord (role from message.role)
//   attachment            → AttachmentRecord
//   permission-mode       → SessionMetaPatch (permissionMode field)
//   last-prompt           → SessionMetaPatch (lastPrompt field)
//   file-history-snapshot → null (drop: not in scope for V1 main tables)
//   queue-operation       → null (drop: not in scope for V1 main tables)
//   anything else         → null (drop: schema-mismatch — covers progress,
//                                  ai-title, and any future unknown type)

import type { AttachmentRecord, MessageRecord, MessageRole } from "@ai-chat-viewer/schema";
import { z } from "zod";

import type { SessionMetaPatch } from "../../types";

import {
  ClaudeCodeLineSchema,
  type AssistantLine,
  type AttachmentLine,
  type ClaudeCodeLine,
  type LastPromptLine,
  type PermissionModeLine,
  type SystemLine,
  type UserLine,
} from "./source-schema";

/* -------------------------------------------------------------------------- */
/*                              Logger contract                               */
/* -------------------------------------------------------------------------- */

/**
 * Reason codes for ingestion-line drops. Stable strings — they appear in
 * ingestion.log and may be greppable in support workflows.
 */
export type DropReason =
  | "json-parse-failed"
  | "schema-mismatch"
  | "unsupported-line-type-v1"
  | "message-payload-malformed";

export interface DropEvent {
  /** Wall-clock time the drop was observed (ISO 8601 UTC). */
  timestamp: string;
  /** Session this line belonged to (from the owning file path). */
  sessionId: string;
  /** 1-based line number within the file, when known to the caller. */
  lineNo?: number;
  /** Stable reason code. */
  reason: DropReason;
  /** Free-form human-readable detail (e.g. zod issue, byte length). */
  detail?: string;
}

/**
 * Sink the surrounding ingestion loop wires up. The default in production is
 * an append to `~/Library/Application Support/ai-chat-viewer/ingestion.log`
 * (#41 T40); tests pass a noop or an in-memory recorder.
 *
 * The sink MUST NOT throw — parseLine has no rescue path. Implementations
 * should swallow disk errors locally.
 */
export type DropLogger = (event: DropEvent) => void;

const noopLogger: DropLogger = () => {};

/* -------------------------------------------------------------------------- */
/*                            Session-meta patch                              */
/* -------------------------------------------------------------------------- */

// Re-export SessionMetaPatch (defined in packages/ingestion/types.ts so the
// IngestionEvent union and parseLine share a single source of truth).
export type { SessionMetaPatch };

/* -------------------------------------------------------------------------- */
/*                              Public result                                 */
/* -------------------------------------------------------------------------- */

export type ParseLineResult =
  | { kind: "message"; record: MessageRecord }
  | { kind: "attachment"; record: AttachmentRecord }
  | { kind: "session-meta-patch"; patch: SessionMetaPatch };

/* -------------------------------------------------------------------------- */
/*                          Inner-message narrowing                           */
/* -------------------------------------------------------------------------- */

// user / assistant / system lines all carry `message: unknown` at the source
// schema level (see source-schema.ts) because the inner Anthropic Messages
// API shape is opaque to the union. We narrow it here just enough to pull
// out `role` for the MessageRecord; the entire payload is kept on `content`.
const InnerMessageShape = z
  .object({
    role: z.string().optional(),
    content: z.unknown().optional(),
  })
  .passthrough();

type RoleOwner = UserLine | AssistantLine | SystemLine;

/**
 * Resolve the domain MessageRole for a user/assistant/system source line.
 *
 * Priority:
 *   1. inner message.role (the canonical Anthropic-shape field)
 *   2. fall back to the line `type` itself when it already matches one of
 *      "user" / "assistant" / "system" (system lines often omit message.role)
 *
 * Returns null when neither resolves to a known domain role — the caller
 * drops the line as "message-payload-malformed".
 */
function resolveRole(line: RoleOwner, parsedMessage: unknown): MessageRole | null {
  const inner = InnerMessageShape.safeParse(parsedMessage);
  const innerRole = inner.success ? inner.data.role : undefined;
  // Prefer the inner message.role only when it's already a domain role.
  // Otherwise fall through to the line discriminator (which itself is one of
  // user/assistant/system thanks to the switch in parseLine).
  if (innerRole === "user" || innerRole === "assistant" || innerRole === "system") {
    return innerRole;
  }
  if (line.type === "user" || line.type === "assistant" || line.type === "system") {
    return line.type;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                              Per-type builders                             */
/* -------------------------------------------------------------------------- */

function buildMessageRecord(line: RoleOwner, raw: unknown): MessageRecord | null {
  const role = resolveRole(line, line.message);
  if (role === null) return null;
  return {
    id: line.uuid,
    sessionId: line.sessionId,
    parentUuid: line.parentUuid,
    tool: "claude-code",
    role,
    content: line.message,
    isSidechain: line.isSidechain,
    timestamp: line.timestamp,
    raw,
  };
}

function buildAttachmentRecord(line: AttachmentLine): AttachmentRecord {
  // The domain AttachmentRecord requires a UUID `id`, a `type` category, and
  // a non-null payload field. claude-code's attachment lines carry their own
  // `uuid` (we reuse it) and a free-form `attachment` payload. The category
  // string isn't directly modelled at the source layer — we tag everything
  // with the line type itself, leaving room for adapters to subdivide later
  // without a domain bump.
  return {
    id: line.uuid,
    sessionId: line.sessionId,
    tool: "claude-code",
    type: "attachment",
    payload: line.attachment,
    relatedMessageUuid: line.parentUuid,
    timestamp: line.timestamp,
  };
}

function buildPermissionModePatch(line: PermissionModeLine): SessionMetaPatch {
  return { sessionId: line.sessionId, permissionMode: line.permissionMode };
}

function buildLastPromptPatch(line: LastPromptLine): SessionMetaPatch {
  return { sessionId: line.sessionId, lastPrompt: line.lastPrompt };
}

/* -------------------------------------------------------------------------- */
/*                                  Public                                    */
/* -------------------------------------------------------------------------- */

export interface ParseLineOptions {
  /** Owning session — known from the file path the runner is iterating. */
  sessionId: string;
  /** 1-based line number, optional. Surfaced in ingestion.log for debug. */
  lineNo?: number;
  /** Drop sink. Defaults to noop so unit tests don't need to wire one. */
  log?: DropLogger;
}

/**
 * Parse a single JSONL line into a domain record (or session-meta patch).
 *
 * Returns:
 *   - `ParseLineResult` on a known, well-formed line
 *   - `null` on any drop (logged to `log` via the injected sink)
 *
 * Never throws.
 */
export function parseLine(
  rawLine: string,
  opts: ParseLineOptions,
): ParseLineResult | null {
  const log = opts.log ?? noopLogger;
  const drop = (reason: DropReason, detail?: string): null => {
    const evt: DropEvent = {
      timestamp: new Date().toISOString(),
      sessionId: opts.sessionId,
      reason,
    };
    if (opts.lineNo !== undefined) evt.lineNo = opts.lineNo;
    if (detail !== undefined) evt.detail = detail;
    log(evt);
    return null;
  };

  // Step 1 — JSON.parse. Be defensive: empty / whitespace-only input is a
  // benign drop (the tail can split on '\n' and yield a trailing '').
  const trimmed = rawLine.trim();
  if (trimmed.length === 0) {
    return drop("json-parse-failed", "empty-line");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(rawLine);
  } catch (err) {
    return drop("json-parse-failed", err instanceof Error ? err.message : String(err));
  }

  // Step 2 — discriminated union safeParse against the 8 known shapes.
  const parsed = ClaudeCodeLineSchema.safeParse(raw);
  if (!parsed.success) {
    return drop("schema-mismatch", parsed.error.issues[0]?.message ?? "no-issue");
  }

  // Step 3 — route by discriminator. Exhaustive switch + `never` fallthrough
  // means a future source-schema extension fails type-check rather than
  // silently dropping unknown variants.
  const line: ClaudeCodeLine = parsed.data;
  switch (line.type) {
    case "user":
    case "assistant":
    case "system": {
      const record = buildMessageRecord(line, raw);
      if (record === null) {
        return drop("message-payload-malformed", `type=${line.type}`);
      }
      return { kind: "message", record };
    }
    case "attachment":
      return { kind: "attachment", record: buildAttachmentRecord(line) };
    case "permission-mode":
      return { kind: "session-meta-patch", patch: buildPermissionModePatch(line) };
    case "last-prompt":
      return { kind: "session-meta-patch", patch: buildLastPromptPatch(line) };
    case "file-history-snapshot":
    case "queue-operation":
      return drop("unsupported-line-type-v1", `type=${line.type}`);
    default: {
      // Exhaustiveness guard. If a new variant is added to ClaudeCodeLine
      // (V2 widens the union), this becomes a compile error pointing here.
      const _exhaustive: never = line;
      void _exhaustive;
      return drop("schema-mismatch", "unreachable");
    }
  }
}
