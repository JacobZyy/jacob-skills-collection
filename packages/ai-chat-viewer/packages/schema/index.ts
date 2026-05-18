// Domain-level public API surface for @ai-chat-viewer/schema.
//
// =============================================================================
// BAN LIST — DO NOT EXPORT FROM THIS FILE
// =============================================================================
// The following symbols are tool-specific source-level types and live only
// inside packages/ingestion/adapters/<tool>/. They MUST NOT leak through
// this barrel:
//
//   - ClaudeCodeBlock / ClaudeCodeBlockSchema (and per-block variants:
//     ClaudeCodeTextBlock, ClaudeCodeThinkingBlock, ClaudeCodeToolUseBlock,
//     ClaudeCodeToolResultBlock)
//   - ClaudeCodeLine / ClaudeCodeLineSchema (and per-line variants:
//     UserLine, AssistantLine, SystemLine, AttachmentLine,
//     PermissionModeLine, LastPromptLine, FileHistorySnapshotLine,
//     QueueOperationLine)
//   - Any identifier (type, schema, or variable) whose name contains the
//     substrings 'ClaudeCode', 'claudeCode', or 'JSONL'
//   - Any tool-specific line-type literal string: "permission-mode",
//     "last-prompt", "file-history-snapshot", "queue-operation",
//     "tool_use", "tool_result", "thinking"
//
// NOTE on the discriminator value: the bare string "claude-code" is
// INTENTIONALLY allowed in domain schema — it is the v1 `tool` discriminator
// value (`z.literal('claude-code')`). What we ban is tool-specific type/
// schema *names* (e.g. `ClaudeCodeBlockSchema`), not the discriminator
// literal that the domain layer uses to tag records by source.
//
// The role enum legitimately contains the strings "user", "assistant",
// "system" — these are domain-level role names and are NOT banned.
//
// V1 hard pin: `tool` discriminator is `z.literal('claude-code')`. Adding a
// second tool means bumping the schema (new literal + DB migration), NOT
// widening this barrel.
//
// CI enforcement: scripts/check-schema-banlist.sh greps this file (and any
// file under packages/schema/) for banned identifiers and fails the build
// on a match. Edit with care.
// =============================================================================

export { MessageRecordSchema, MessageRoleSchema } from "./message";
export type { MessageRecord, MessageRole } from "./message";

export { AttachmentRecordSchema } from "./attachment";
export type { AttachmentRecord } from "./attachment";

export { ProjectRecordSchema } from "./project";
export type { ProjectRecord } from "./project";

export { SessionRecordSchema } from "./session";
export type { SessionRecord } from "./session";

export { IngestionSourceRecordSchema } from "./ingestion-source";
export type { IngestionSourceRecord } from "./ingestion-source";
