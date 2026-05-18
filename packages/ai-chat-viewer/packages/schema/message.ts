// Domain-level message schema.
//
// IMPORTANT: This file is the public domain contract for chat messages
// across all tools. It MUST NOT reference tool-specific shapes:
//
//   - NO claude-code 8-line type strings (`attachment`, `permission-mode`,
//     `last-prompt`, `file-history-snapshot`, `queue-operation`)
//   - NO references to ClaudeCodeBlockSchema / ClaudeCodeLineSchema
//   - `content` stays `z.unknown()` — the adapter parses it into its
//     private union (e.g. packages/ingestion/adapters/claude-code/blocks.ts)
//     and the raw JSON lands in the DB `raw` column.
//
// V1 hard pin: `tool` is `z.literal('claude-code')`. Adding a second tool
// is a future schema bump (NOT a union widening in V1).

import { z } from "zod";

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);

export const MessageRecordSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  parentUuid: z.string().nullable(),
  tool: z.literal("claude-code"),
  role: MessageRoleSchema,
  /**
   * The message payload. Shape is tool-specific (e.g. claude-code emits an
   * Anthropic Messages API content-block array). The domain layer treats it
   * as opaque; adapters narrow it, renderers parse it on demand.
   */
  content: z.unknown(),
  isSidechain: z.boolean(),
  timestamp: z.string(),
  /**
   * The original line as emitted by the source tool, preserved verbatim for
   * audit / replay / future re-parse. Adapters write this to the DB `raw`
   * column unchanged.
   */
  raw: z.unknown(),
});

export type MessageRole = z.infer<typeof MessageRoleSchema>;
export type MessageRecord = z.infer<typeof MessageRecordSchema>;
