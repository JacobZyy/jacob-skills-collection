// claude-code source-level only, do not re-export from packages/schema.
//
// This file defines the *private* Block union that mirrors the Anthropic
// Messages API content-block shapes appearing inside claude-code session
// JSONL files at ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl.
//
// V1 supports exactly four block kinds: text, thinking, tool_use, tool_result.
// The union MUST stay inside packages/ingestion/adapters/claude-code/. The
// domain layer (packages/schema) only exposes `content: z.unknown()`; the
// adapter parses it into this union, then writes the raw JSON to the
// derived DB index. If we ever add a second tool (e.g. another agent CLI),
// it gets its own private union here, NOT a merge with this one.

import { z } from "zod";

/** Plain text the assistant or user emitted. */
export const ClaudeCodeTextBlockSchema = z
  .object({
    type: z.literal("text"),
    text: z.string(),
  })
  .passthrough();

/** Inline reasoning trace emitted by claude with extended thinking. */
export const ClaudeCodeThinkingBlockSchema = z
  .object({
    type: z.literal("thinking"),
    thinking: z.string(),
    // Anthropic ships a signature for extended-thinking redaction; treat as
    // opaque string when present.
    signature: z.string().optional(),
  })
  .passthrough();

/**
 * A tool invocation request from the assistant. `input` is the JSON payload
 * sent to the tool — its shape varies per tool (Bash, Read, Edit, MCP tools,
 * ...). We keep it as unknown here; downstream renderers may narrow.
 */
export const ClaudeCodeToolUseBlockSchema = z
  .object({
    type: z.literal("tool_use"),
    id: z.string(),
    name: z.string(),
    input: z.unknown(),
  })
  .passthrough();

/**
 * The tool's response, paired to a prior tool_use by `tool_use_id`. `content`
 * may be a string OR a nested array of sub-blocks (Anthropic API allows this
 * for multi-modal results). We accept both and let the adapter normalise.
 */
export const ClaudeCodeToolResultBlockSchema = z
  .object({
    type: z.literal("tool_result"),
    tool_use_id: z.string(),
    content: z.union([z.string(), z.array(z.unknown())]).optional(),
    is_error: z.boolean().optional(),
  })
  .passthrough();

export const ClaudeCodeBlockSchema = z.discriminatedUnion("type", [
  ClaudeCodeTextBlockSchema,
  ClaudeCodeThinkingBlockSchema,
  ClaudeCodeToolUseBlockSchema,
  ClaudeCodeToolResultBlockSchema,
]);

export type ClaudeCodeTextBlock = z.infer<typeof ClaudeCodeTextBlockSchema>;
export type ClaudeCodeThinkingBlock = z.infer<typeof ClaudeCodeThinkingBlockSchema>;
export type ClaudeCodeToolUseBlock = z.infer<typeof ClaudeCodeToolUseBlockSchema>;
export type ClaudeCodeToolResultBlock = z.infer<typeof ClaudeCodeToolResultBlockSchema>;
export type ClaudeCodeBlock = z.infer<typeof ClaudeCodeBlockSchema>;
