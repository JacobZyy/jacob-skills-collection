// Server-side structured logger for ai-chat-viewer.
//
// Two outputs:
//   1. Console — bracketed prefix `[sess=84e7…/proj=abc12345]` so tail-style
//      monitoring stays readable. Uses console.{log,warn,error,debug} so it
//      composes with whatever the parent harness (concurrently, pm2, ...) is
//      already doing.
//   2. ingestion.log file (append-only JSONL) — only failed-line records, so
//      a forensic pass over a long run stays grep-able. Lives next to db.sqlite
//      under `~/Library/Application Support/ai-chat-viewer/`.
//
// Discipline (per spec & CLAUDE.md):
//   - NEVER log message.content, raw, or lastPrompt to disk. The console
//     channel can include free-form msg text the caller passes, but the
//     `logIngestionFailure` API on the file channel is shape-pinned to
//     {ts, sessionId, lineNo, reason, tool} — no payload field.
//   - File appends are fire-and-forget (no await on the hot path) so a slow
//     disk never stalls ingestion.
//   - On file-write failure we surface ONCE to console.error and silently
//     drop subsequent failures — the runner must not crash because the log
//     dir went read-only.

import { appendFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

import { resolveDbPath } from "../db/path";

// ────────────────────────────────────────────────────────────────────────────
// Context

// Free-form context bag the caller threads through their call site. Only
// recognized keys render into the bracketed prefix; arbitrary extras are
// stringified into a trailing JSON blob so callers can attach ad-hoc info
// (lineNo, durationMs, ...) without us pre-defining every key.
export interface LogContext {
  sessionId?: string;
  projectCwdHash?: string;
  // Anything else — rendered as `key=<json>` after the prefix when present.
  [extraKey: string]: unknown;
}

// Recognized context keys — order matters (it's the render order).
const KNOWN_CONTEXT_KEYS = ["sessionId", "projectCwdHash"] as const;

// 8 chars is enough to disambiguate ~4B UUIDs informally; the full UUID lives
// in ingestion.log when forensics matter.
const ID_PREFIX_LEN = 8;

function shortId(id: string): string {
  if (id.length <= ID_PREFIX_LEN) return id;
  return `${id.slice(0, ID_PREFIX_LEN)}…`;
}

function renderPrefix(ctx: LogContext): string {
  const parts: string[] = [];
  if (ctx.sessionId) parts.push(`sess=${shortId(ctx.sessionId)}`);
  if (ctx.projectCwdHash) parts.push(`proj=${shortId(ctx.projectCwdHash)}`);
  if (parts.length === 0) return "";
  return `[${parts.join("/")}] `;
}

function renderExtras(ctx: LogContext): string {
  const extras: Record<string, unknown> = {};
  for (const key of Object.keys(ctx)) {
    if ((KNOWN_CONTEXT_KEYS as readonly string[]).includes(key)) continue;
    extras[key] = ctx[key];
  }
  if (Object.keys(extras).length === 0) return "";
  return ` ${JSON.stringify(extras)}`;
}

// ────────────────────────────────────────────────────────────────────────────
// ingestion.log (file channel)

// Path resolution mirrors db/path: same parent dir as db.sqlite. The file is
// created lazily on first append (appendFile creates if missing).
//
// `home` is a test-only override forwarded to resolveDbPath. Bun's
// `os.homedir()` snapshots $HOME at process start, so tests cannot mutate
// process.env.HOME after-the-fact; they pass home explicitly instead.
export interface ResolveIngestionLogPathOptions {
  home?: string;
}

function resolveIngestionLogPath(options: ResolveIngestionLogPathOptions = {}): string {
  const dbPath = resolveDbPath(options.home === undefined ? {} : { home: options.home });
  return join(dirname(dbPath), "ingestion.log");
}

// Failed-line record shape — pinned per spec. Stored one JSON-per-line so
// `grep` and `jq -c` both work without a parser.
export interface IngestionFailureRecord {
  // ISO 8601 UTC.
  ts: string;
  // Source tool, V1 always "claude-code".
  tool: string;
  // Session UUID. Required even on parse failures (filename gives us the id
  // before the line is parsed).
  sessionId: string;
  // 1-indexed line number within the JSONL file.
  lineNo: number;
  // Human-readable reason — typically a flattened zod error message. Caller
  // is responsible for not stuffing the failed payload in here.
  reason: string;
}

// Track whether we've already surfaced an ingestion.log write failure so we
// don't spam stderr on every subsequent line.
let loggedFileWriteFailure = false;

// Ensure the log directory exists (idempotent). Called by injectDatabaseUrl
// already in the boot sequence, but log writes can predate boot in tests so
// we mkdir defensively.
function ensureLogDir(filePath: string): void {
  try {
    mkdirSync(dirname(filePath), { recursive: true });
  } catch {
    // Surfacing happens on the appendFile call below.
  }
}

// Append one failed-line record. Fire-and-forget — the returned promise is
// awaited by tests but ignored on the ingestion hot path.
//
// `options.home` is a test-only override forwarded to resolveIngestionLogPath.
// Production callers omit it.
export function logIngestionFailure(
  record: IngestionFailureRecord,
  options: ResolveIngestionLogPathOptions = {},
): Promise<void> {
  const filePath = resolveIngestionLogPath(options);
  ensureLogDir(filePath);
  const line = `${JSON.stringify(record)}\n`;
  return appendFile(filePath, line, { encoding: "utf8" }).catch((err: unknown) => {
    if (!loggedFileWriteFailure) {
      loggedFileWriteFailure = true;
      const msg = err instanceof Error ? err.message : String(err);
      // Bare console.error here — going through the logger would loop.
      console.error(
        `[logger] FATAL: ingestion.log append failed (${msg}). Subsequent failures will be silenced.`
      );
    }
  });
}

// ────────────────────────────────────────────────────────────────────────────
// Console channel

type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, ctx: LogContext = {}): void {
  const line = `${renderPrefix(ctx)}${msg}${renderExtras(ctx)}`;
  switch (level) {
    case "debug":
      console.debug(line);
      return;
    case "info":
      console.log(line);
      return;
    case "warn":
      console.warn(line);
      return;
    case "error":
      console.error(line);
      return;
  }
}

// Public API. Same shape across levels: (msg, ctx?) — ctx threads sessionId /
// projectCwdHash plus arbitrary extras. Extras render after the message as a
// trailing JSON blob; the prefix renders before.
export const logger = {
  debug(msg: string, ctx?: LogContext): void {
    emit("debug", msg, ctx);
  },
  info(msg: string, ctx?: LogContext): void {
    emit("info", msg, ctx);
  },
  warn(msg: string, ctx?: LogContext): void {
    emit("warn", msg, ctx);
  },
  error(msg: string, ctx?: LogContext): void {
    emit("error", msg, ctx);
  },
};

// Re-export the resolver so tests / boot can introspect / tail the path.
export { resolveIngestionLogPath };
