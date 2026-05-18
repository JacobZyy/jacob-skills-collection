// Public barrel for @ai-chat-viewer/ingestion.
//
// What this package exposes to consumers (apps/server, future MCP):
//   - The adapter contract (`IngestionAdapter`, `IngestionEvent`,
//     `SessionMeta`, `SessionMetaPatch`, `TailCursor`) — the runner-facing
//     interface every adapter must satisfy.
//   - The single concrete V1 adapter (`claudeCodeAdapter`) plus its
//     detect helper (`detectClaudeCodeRoot`).
//
// What we deliberately do NOT re-export:
//   - The internal source-schema (`ClaudeCodeLineSchema`, the 8-line
//     union types). They live behind the adapter on purpose; surfacing
//     them would let callers parse JSONL without going through the
//     adapter's drop-logging contract.
//   - `parseLine`, `tailFile`, `scan` as standalone functions. The
//     adapter object is the supported surface; the underlying functions
//     are reachable via the subpath export `@ai-chat-viewer/ingestion/
//     adapters/claude-code` for tests and tooling that need the lower
//     level, but they are not part of the package's public contract.

export type {
  IngestionAdapter,
  IngestionEvent,
  SessionMeta,
  SessionMetaPatch,
  TailCursor,
} from "./types";

export {
  claudeCodeAdapter,
  detectClaudeCodeRoot,
} from "./adapters/claude-code";
export type {
  ScanOptions,
  TailOptions,
} from "./adapters/claude-code";

// Pure utilities the runner uses when writing Project rows. Co-located
// with the writer so the data flow is one-way (ingestion produces, server
// consumes from DB). See util/*.ts for rationale.
export { computeCwdHash } from "./util/cwd-hash";
export { computeDisplayNames } from "./util/display-name";
