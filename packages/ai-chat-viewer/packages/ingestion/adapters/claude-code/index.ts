// claude-code adapter assembly (T18).
//
// Wires up the four pieces this directory has produced (#15 scan, #17 tail,
// #18 parseLine, #21 session-meta) into the single `IngestionAdapter`
// shape the runner consumes (#16 T20).
//
// Public surface (re-exported from packages/ingestion/index.ts):
//   - `claudeCodeAdapter`   — the assembled IngestionAdapter instance
//   - `detectClaudeCodeRoot()` — exposed for tests / CLI tools that need
//     the canonical path independently of constructing the adapter
//
// Why a value-object instead of a factory: the adapter is stateless. There
// is no per-instance config (drop logger threads through the per-call
// options on scan/tail). Exporting a frozen singleton keeps imports cheap
// and lets the runner type-narrow on `tool === "claude-code"` if it ever
// holds a list of adapters.
//
// What this file does NOT do:
//   - Does not open the SQLite DB or know about Prisma.
//   - Does not own the chokidar watcher; that's the runner.
//   - Does not log drops itself — every drop event flows back through the
//     `log: DropLogger` option the caller passes per-scan/per-tail.

import { homedir } from "node:os";
import { join } from "node:path";

import type {
  IngestionAdapter,
  IngestionEvent,
  TailCursor,
} from "../../types";

import { scan, type ScanOptions } from "./scan";
import { tailFile, type TailOptions } from "./tail";

/* -------------------------------------------------------------------------- */
/*                              detectRoot                                    */
/* -------------------------------------------------------------------------- */

/**
 * Resolve the canonical claude-code data directory.
 *
 * V1 hard-codes `~/.claude/projects` because that is what the claude-code
 * CLI itself writes — it is not user-configurable on the source side. If
 * a future claude-code release exposes a config knob, this is the single
 * place to honor it.
 *
 * Pure: same return value every call within a process. No filesystem I/O,
 * no env-var lookup beyond `homedir()`'s own resolution.
 */
export function detectClaudeCodeRoot(): string {
  return join(homedir(), ".claude", "projects");
}

/* -------------------------------------------------------------------------- */
/*                              Adapter object                                */
/* -------------------------------------------------------------------------- */

/**
 * The claude-code IngestionAdapter. Stateless singleton — the runner is
 * expected to import it directly:
 *
 *   import { claudeCodeAdapter } from "@ai-chat-viewer/ingestion/adapters/claude-code";
 *
 * Per-call options (drop logger) are threaded through `opts` on each
 * scan/tail invocation, NOT carried on this object — keeping the adapter
 * itself reusable across runner contexts (tests, real boot, future MCP).
 */
export const claudeCodeAdapter: IngestionAdapter = Object.freeze({
  tool: "claude-code" as const,

  detectRoot: detectClaudeCodeRoot,

  // The IngestionAdapter contract types scan/tail as AsyncIterable<IngestionEvent>;
  // our concrete implementations return AsyncGenerator (a subtype of
  // AsyncIterable), so the structural assignment is sound. We forward
  // straight to the generators so callers can also `for await` directly.
  scan(rootDir: string): AsyncIterable<IngestionEvent> {
    return scan(rootDir);
  },

  tail(filePath: string, fromOffset: TailCursor): AsyncIterable<IngestionEvent> {
    return tailFile(filePath, fromOffset);
  },
});

/* -------------------------------------------------------------------------- */
/*                              Re-exports                                    */
/* -------------------------------------------------------------------------- */

// Type re-exports for callers wiring options without importing the
// individual files. Surface stays narrow on purpose — the option types
// are the only thing the runner needs to spell.
export type { ScanOptions, TailOptions };

// Lower-level function re-exports. The IngestionAdapter contract does not
// thread per-call ScanOptions/TailOptions through (scan/tail on the adapter
// take only rootDir / filePath + offset), so a caller that needs to pipe a
// DropLogger into parseLine must reach the underlying generators directly.
// The runner (#16 T20) is the sole production consumer. This is the subpath
// access promised in the file header — narrow on purpose: only the two
// generators and their drop-logging types.
export { scan, tailFile };
export type { DropEvent, DropLogger, DropReason } from "./parse-line";
