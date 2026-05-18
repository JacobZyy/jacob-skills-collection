// Incremental tail generator for the claude-code adapter (T17).
//
// Contract:
//   tailFile(filePath, fromOffset): AsyncGenerator<IngestionEvent>
//
//   Streams events appended to `filePath` since byte offset `fromOffset`.
//   Used by the runner on chokidar `change` notifications. The cursor is
//   the same shape scan() persists: byte position immediately AFTER the
//   last successfully emitted line (counting its newline).
//
// Per-line emission rules:
//   Identical to scan.ts — for each accepted line we yield:
//     1. The primary parseLine event (message / attachment / patch), if any
//     2. A secondary "session-meta" observation, if the line carries the
//        cwd + sessionId top-level pair (attachment is the canonical
//        carrier; user/assistant/system also stamp it)
//
//   Both events from the same line share the SAME `sourceOffset` (the
//   post-newline byte position). The runner reduces by uuid / first-seen.
//
// Streaming guarantees:
//   - createReadStream({ start: fromOffset }): we never re-read the prefix
//     already digested by previous scan/tail runs. Constant memory.
//   - byteCursor is INITIALIZED to fromOffset (not 0). Every emitted
//     event's sourceOffset is therefore directly comparable to the cursor
//     the runner persists.
//   - Buffer.byteLength(line, "utf8") for the per-line advance — char
//     length would corrupt offsets on multi-byte content (Chinese, emoji).
//
// Partial-line tolerance:
//   Node's readline emits the residual buffer on stream close whether or
//   not it ended with a \n — so an in-progress writer (claude-code
//   appends a full JSONL line atomically, but we do not assume so) would
//   surface a truncated, possibly invalid-JSON line as the final emit.
//   We filter the trailing partial against the file size to avoid
//   emitting a malformed half-line:
//   stat() the file first and compare the per-line "prospective cursor"
//   (byteCursor + lineBytes + 1) against stat.size:
//     - prospectiveCursor <= stat.size → the line is complete (a \n
//       actually exists at that position in the file). Emit.
//     - prospectiveCursor >  stat.size → the final emit had no trailing
//       newline. Skip silently. The next tail() call (after the writer
//       finishes the line) will re-read from the same fromOffset and
//       pick up the now-complete line.
//
// Truncate detection:
//   NOT this layer's job. The runner compares stat.size with the persisted
//   cursor and resets to 0 + delegates to scan() when shrinkage is seen.
//   Here we just refuse to over-read past stat.size and tolerate
//   fromOffset > stat.size by yielding nothing (no throw).
//
// Idempotency:
//   tailFile(path, X) called twice in a row, with no intervening writes,
//   yields the same byte-identical sequence both times. The runner's
//   uuid-keyed upsert dedupes if it ever re-emits an old line, but
//   tail.ts itself does not deliberately re-emit — every yielded event
//   represents bytes physically present at [fromOffset, stat.size) at the
//   moment the stream was opened.

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { createInterface } from "node:readline";

import type { IngestionEvent, TailCursor } from "../../types";

import { parseLine, type DropLogger } from "./parse-line";
import { extractSessionMetaFromLine } from "./session-meta";

/* -------------------------------------------------------------------------- */
/*                              Public options                                */
/* -------------------------------------------------------------------------- */

export interface TailOptions {
  /**
   * Drop sink forwarded to parseLine. Defaults to noop so tests/quick
   * callers don't need to wire ingestion.log.
   */
  log?: DropLogger;
}

/* -------------------------------------------------------------------------- */
/*                              Helpers                                       */
/* -------------------------------------------------------------------------- */

/**
 * Best-effort JSON parse. Used for the secondary session-meta path —
 * parseLine does its own parse + log for the primary event, so we do not
 * want to double-log on malformed JSON here.
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

/**
 * Derive sessionId from the absolute file path. claude-code session files
 * are named `<uuid>.jsonl`; we strip `.jsonl` and forward to parseLine for
 * drop-log context. (parseLine itself does not validate that the id looks
 * like a uuid — it is purely a label for ingestion.log.)
 */
function sessionIdFromPath(filePath: string): string {
  const name = basename(filePath);
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
}

/* -------------------------------------------------------------------------- */
/*                              Public entry                                  */
/* -------------------------------------------------------------------------- */

/**
 * Stream events appended to `filePath` since `fromOffset`.
 *
 * Caller contract:
 *   - `filePath` is absolute and points at one session JSONL file.
 *   - `fromOffset` is the cursor the runner persisted after the previous
 *     scan/tail completed for this file. May equal stat.size (no new
 *     bytes — yields nothing) or exceed it (truncated upstream — yields
 *     nothing without throwing; runner is expected to reset and re-scan).
 *
 * Errors:
 *   - Missing file → stat() rejects; the generator throws on first
 *     `next()`. The runner's chokidar layer should not invoke tail on a
 *     vanished path, so this is treated as a configuration bug rather
 *     than a per-line drop.
 */
export async function* tailFile(
  filePath: string,
  fromOffset: TailCursor,
  opts: TailOptions = {},
): AsyncGenerator<IngestionEvent> {
  const log = opts.log;
  const sessionId = sessionIdFromPath(filePath);

  // Snapshot the file size up-front so partial-line detection has a
  // stable upper bound. If the writer appends more bytes WHILE we are
  // streaming, those bytes belong to the next tail() invocation — we
  // explicitly do not race the writer.
  const fileStat = await stat(filePath);
  const endByte = fileStat.size;

  // No new bytes (or the runner's cursor is somehow ahead of the file —
  // e.g. truncate happened between stat calls upstream). Yield nothing,
  // do not throw. The runner detects truncate by comparing stat.size to
  // its persisted cursor itself.
  if (fromOffset >= endByte) return;

  const stream = createReadStream(filePath, {
    start: fromOffset,
    encoding: "utf8",
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });

  let byteCursor = fromOffset;
  let lineNo = 0;

  try {
    for await (const line of rl) {
      lineNo += 1;

      const lineBytes = Buffer.byteLength(line, "utf8");
      const prospectiveCursor = byteCursor + lineBytes + 1;

      // Partial-line guard: if advancing the cursor past this line plus
      // one newline would overshoot stat.size, the writer hadn't yet
      // committed the trailing \n when we stat'd. Refuse to emit; the
      // next tail() with the same fromOffset will see the completed line.
      if (prospectiveCursor > endByte) {
        break;
      }

      const sourceOffset = prospectiveCursor;
      byteCursor = sourceOffset;

      const noopLog: DropLogger = () => {};
      const result = parseLine(line, {
        sessionId,
        lineNo,
        log: log ?? noopLog,
      });

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

      // Secondary session-meta observation. Same trade-off documented in
      // scan.ts: re-parsing JSON costs microseconds and avoids coupling
      // the session-meta extraction to parseLine's drop-logging contract.
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
