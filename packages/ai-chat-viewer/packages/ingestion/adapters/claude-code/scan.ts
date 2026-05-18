// Full-scan generator for the claude-code adapter (T15).
//
// Contract:
//   scan(rootDir): AsyncGenerator<IngestionEvent>
//
//   Walks `rootDir/<encoded-cwd>/<session-uuid>.jsonl`, streams each file
//   line-by-line, and yields domain `IngestionEvent`s in physical order.
//   Files are visited project-by-project, lines within a file in append
//   order — the runner relies on this to amortize transactions per session.
//
// Per-line emission rules:
//   - parseLine() result drives the primary event:
//       * "message"             → { kind: "message", record, sourceOffset }
//       * "attachment"          → { kind: "attachment", record, sourceOffset }
//       * "session-meta-patch"  → { kind: "session-meta-patch", patch, sourceOffset }
//   - Additionally, ANY line that carries top-level meta fields (cwd +
//     sessionId) yields a secondary "session-meta" event. attachment lines
//     are the canonical carrier; user/assistant/system stamp the same bag,
//     so we accept them too. The runner reduces by earliest observedAt.
//
// `sourceOffset` semantics (matches runner expectation):
//   The byte position immediately AFTER the line that produced the event,
//   counting newline. Persisting this offset means "next read starts here".
//
// Streaming guarantees:
//   - Files are read with createReadStream + readline → constant memory
//     even on 14MB+ JSONLs.
//   - We compute byte length of each raw line (UTF-8 byte length, NOT char
//     length) so the offset is durable and resumable across runs.
//   - parseLine never throws; any per-line failure is logged via the
//     caller-supplied DropLogger and skipped (no event yielded).
//
// What we do NOT do here:
//   - We do not open the SQLite DB or know about tables — we are a pure
//     event source.
//   - We do not handle truncation / partial lines mid-write — that is the
//     tail() implementation's concern (#17 T17).
//   - We do not deduplicate; the runner's uuid-based upsert is authoritative.
//
// Why secondary session-meta runs its own JSON.parse (instead of refactoring
// parseLine to expose the already-parsed object): intentional. The "twice
// parse" cost is microseconds per line and never crosses the streaming
// memory line. Hoisting the parse into a shared helper would couple the
// session-meta extraction path to parseLine's drop-logging contract — every
// future change to parseLine's signature would force a co-edit in scan.
// We chose the cheaper coupling cost. Do NOT "optimize" this by collapsing
// the two parses into one; the duplication is load-bearing.

import { createReadStream } from "node:fs";
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";

import type { IngestionEvent } from "../../types";

import { parseLine, type DropLogger } from "./parse-line";
import { extractSessionMetaFromLine } from "./session-meta";

/* -------------------------------------------------------------------------- */
/*                              Public options                                */
/* -------------------------------------------------------------------------- */

export interface ScanOptions {
  /**
   * Drop sink forwarded to parseLine. Defaults to a noop so quick callers
   * (tests, smoke runners) don't have to wire ingestion.log.
   */
  log?: DropLogger;
}

/* -------------------------------------------------------------------------- */
/*                              Filename gate                                 */
/* -------------------------------------------------------------------------- */

// claude-code session files: <uuid>.jsonl. We accept any *.jsonl to remain
// tolerant of forks / future variants, but reject hidden files (".DS_Store",
// "._*" macOS metadata) outright.
function isSessionFile(name: string): boolean {
  if (name.startsWith(".")) return false;
  return name.endsWith(".jsonl");
}

function isProjectDir(name: string): boolean {
  // claude-code encodes cwd by replacing "/" with "-", so every project dir
  // begins with "-" on macOS/Linux. Reject hidden / unrelated dirs.
  return name.startsWith("-");
}

/* -------------------------------------------------------------------------- */
/*                              Per-file walker                               */
/* -------------------------------------------------------------------------- */

/**
 * Stream one session file, yielding events line-by-line.
 *
 * `filePath` is absolute. `sessionId` is taken from the filename minus
 * `.jsonl` so we can pass it to parseLine (which needs it for drop logging
 * and would otherwise have to re-derive it from the line itself).
 *
 * The byte cursor advances as `byteLength(line) + 1` to count the newline
 * separator, matching how the runner persists `lastByteOffset` and how
 * tail() will resume on next change notification.
 */
async function* scanFile(
  filePath: string,
  sessionId: string,
  log: DropLogger,
): AsyncGenerator<IngestionEvent> {
  const stream = createReadStream(filePath, { encoding: "utf8" });
  // crlfDelay: Infinity makes readline collapse \r\n to \n boundaries — we
  // still count one newline byte either way (claude-code writes LF, but
  // being explicit costs nothing).
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let byteCursor = 0;
  let lineNo = 0;

  try {
    for await (const line of rl) {
      lineNo += 1;
      // UTF-8 byte length of the raw line content (without the newline).
      const lineBytes = Buffer.byteLength(line, "utf8");
      // After this line: include the trailing newline byte.
      const sourceOffset = byteCursor + lineBytes + 1;
      byteCursor = sourceOffset;

      // parseLine never throws and routes drops to `log`.
      const result = parseLine(line, { sessionId, lineNo, log });

      // Emit the primary event (when parseLine accepted the line).
      if (result !== null) {
        switch (result.kind) {
          case "message":
            yield { kind: "message", sourceOffset, record: result.record };
            break;
          case "attachment":
            yield { kind: "attachment", sourceOffset, record: result.record };
            break;
          case "session-meta-patch":
            yield {
              kind: "session-meta-patch",
              sourceOffset,
              patch: result.patch,
            };
            break;
        }
      }

      // Independent of parseLine's routing, ANY line that stamps cwd +
      // sessionId at top level yields a session-meta observation. We re-
      // parse the JSON here cheaply: parseLine already accepted (or
      // rejected) the discriminated shape, but session-meta has its own
      // tolerant shape (see session-meta.ts) and reads the same string.
      // For drops the line text was malformed JSON anyway, so json-parse
      // will simply return null and we skip silently.
      const metaCandidate = tryParseJson(line);
      if (metaCandidate !== undefined) {
        const meta = extractSessionMetaFromLine(metaCandidate);
        if (meta !== null) {
          yield { kind: "session-meta", sourceOffset, record: meta };
        }
      }
    }
  } finally {
    rl.close();
    stream.destroy();
  }
}

/**
 * Best-effort JSON parse. Returns `undefined` on any error. Used only for
 * the session-meta secondary emission — parseLine does its own parse + log
 * for the primary path, and we do not want to double-log here.
 */
function tryParseJson(line: string): unknown {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Public entry                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stream every event under `rootDir` (typically `~/.claude/projects`).
 *
 * Iteration order:
 *   - Project directories are visited in the order `opendir` yields them
 *     (filesystem-defined; on APFS this is roughly insertion order, which
 *     is good enough for V1 — the runner does not depend on cross-project
 *     ordering).
 *   - Within a project, session files are visited in the order returned by
 *     opendir as well. The first observation of a session's metadata wins,
 *     so visit order across files of the same session does not matter.
 *   - Within a single file, lines are yielded in physical append order.
 *
 * `rootDir` is consumed lazily — we only call `opendir` once we are awaited.
 *
 * Errors:
 *   - If `rootDir` itself is missing or unreadable, the generator throws on
 *     first `next()` (this is a configuration bug, not a per-line drop).
 *   - Per-file errors (read EACCES, mid-file decode error) propagate; the
 *     runner is expected to wrap one project at a time and continue. V1
 *     ships the simpler "throw on file error" semantic; #20 T18 may add a
 *     try/catch around scanFile if real-world data forces it.
 */
export async function* scan(
  rootDir: string,
  opts: ScanOptions = {},
): AsyncGenerator<IngestionEvent> {
  const log = opts.log;

  const projects = await opendir(rootDir);
  for await (const projectEntry of projects) {
    if (!projectEntry.isDirectory()) continue;
    if (!isProjectDir(projectEntry.name)) continue;

    const projectDir = join(rootDir, projectEntry.name);

    // opendir yields one entry at a time — keep it streaming.
    const files = await opendir(projectDir);
    for await (const fileEntry of files) {
      if (!fileEntry.isFile()) continue;
      if (!isSessionFile(fileEntry.name)) continue;

      const filePath = join(projectDir, fileEntry.name);
      const sessionId = fileEntry.name.slice(0, -".jsonl".length);

      const noopLog: DropLogger = () => {};
      yield* scanFile(filePath, sessionId, log ?? noopLog);
    }
  }
}
