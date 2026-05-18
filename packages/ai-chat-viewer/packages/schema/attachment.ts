// Domain-level attachment schema.
//
// IMPORTANT: This file is the public domain contract for attachments
// (hook output, file upload, etc.) across all tools. Same discipline as
// packages/schema/message.ts:
//
//   - NO claude-code 8-line type strings (`attachment`, `permission-mode`,
//     `last-prompt`, `file-history-snapshot`, `queue-operation`)
//   - NO references to the claude-code private Block / Line unions
//   - `payload` stays `z.unknown()` — the adapter writes the original
//     attachment object here; renderers narrow on read.
//
// V1 hard pin: `tool` is `z.literal('claude-code')`.
//
// On `type`: this is the attachment *category* emitted by the source
// (e.g. claude-code uses hook event names like "hook_success", "tool_use",
// etc.). We keep it as `z.string()` rather than an enum because the set is
// open-ended per tool and we don't want adapter-specific values to leak
// into the domain schema. Renderers may special-case known values, but the
// schema does not enumerate them.

import { z } from "zod";

export const AttachmentRecordSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string(),
  tool: z.literal("claude-code"),
  /**
   * Attachment category. Tool-specific free-form string — NOT enumerated.
   * Examples (claude-code): "hook_success", "hook_failure", etc.
   */
  type: z.string(),
  /**
   * Original attachment payload, preserved verbatim. Shape varies per
   * `type` and tool.
   */
  payload: z.unknown(),
  /**
   * UUID of the message this attachment relates to (e.g. the tool_use it
   * extends, the prompt it was emitted alongside). Null when the
   * attachment is session-level rather than message-level.
   */
  relatedMessageUuid: z.string().nullable(),
  timestamp: z.string(),
});

export type AttachmentRecord = z.infer<typeof AttachmentRecordSchema>;
