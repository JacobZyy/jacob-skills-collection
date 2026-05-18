// claude-code source-level only, do not re-export from packages/schema.
//
// Discriminated 8-type union over the JSONL line shapes claude-code writes
// into ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl. The `type`
// field is the discriminator.
//
// This file lives ONLY inside the claude-code adapter. The domain layer
// (packages/schema) uses MessageRecord with `content: z.unknown()` — the
// adapter is the bridge.
//
// Shape evidence: derived empirically from this machine's 30+ claude-code
// session JSONLs (10k+ lines). All 8 line types appear in real data. Two
// additional line types — "progress" and "ai-title" — were also observed
// but are out of V1 scope per the task spec. Anything that does not match
// this union is dropped to ingestion.log by parseLine (#18 T14); we do NOT
// extend this union unilaterally.

import { z } from "zod";

/* -------------------------------------------------------------------------- */
/*                              Shared field bag                              */
/* -------------------------------------------------------------------------- */

/**
 * Identity / provenance fields present on most "message-shaped" lines
 * (user, assistant, attachment, system). We declare them once and merge
 * them into each line schema via z.object({...}).extend(...) to keep the
 * union members compact.
 */
const baseMessageFields = {
  parentUuid: z.string().nullable(),
  logicalParentUuid: z.string().optional(),
  isSidechain: z.boolean(),
  uuid: z.string(),
  timestamp: z.string(),
  userType: z.string().optional(),
  entrypoint: z.string().optional(),
  cwd: z.string().optional(),
  sessionId: z.string(),
  version: z.string().optional(),
  gitBranch: z.string().optional(),
};

/* -------------------------------------------------------------------------- */
/*                                  1. user                                   */
/* -------------------------------------------------------------------------- */

export const UserLineSchema = z
  .object({
    type: z.literal("user"),
    promptId: z.string().optional(),
    /**
     * Anthropic API "message" shape — { role, content: Block[] }.
     * Kept as unknown here; the adapter validates inner content blocks via
     * ClaudeCodeBlockSchema (./blocks.ts) when it walks the union.
     */
    message: z.unknown(),
    ...baseMessageFields,
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                               2. assistant                                 */
/* -------------------------------------------------------------------------- */

export const AssistantLineSchema = z
  .object({
    type: z.literal("assistant"),
    requestId: z.string().optional(),
    message: z.unknown(),
    ...baseMessageFields,
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                                 3. system                                  */
/* -------------------------------------------------------------------------- */

export const SystemLineSchema = z
  .object({
    type: z.literal("system"),
    subtype: z.string().optional(),
    content: z.string().optional(),
    isMeta: z.boolean().optional(),
    level: z.string().optional(),
    compactMetadata: z.unknown().optional(),
    slug: z.string().optional(),
    /**
     * Hook telemetry fields observed on hook-related system lines.
     * All optional — present only on the relevant subtype.
     */
    hookCount: z.number().optional(),
    hookInfos: z.array(z.unknown()).optional(),
    hookErrors: z.array(z.unknown()).optional(),
    preventedContinuation: z.boolean().optional(),
    stopReason: z.string().optional(),
    hasOutput: z.boolean().optional(),
    toolUseID: z.string().optional(),
    ...baseMessageFields,
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                              4. attachment                                 */
/* -------------------------------------------------------------------------- */

export const AttachmentLineSchema = z
  .object({
    type: z.literal("attachment"),
    /**
     * The attachment payload (file path, mime, base64, etc.). Shape varies
     * by attachment subtype — keep as opaque object here; renderers can
     * narrow on read.
     */
    attachment: z.unknown(),
    ...baseMessageFields,
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                          5. permission-mode                                */
/* -------------------------------------------------------------------------- */

export const PermissionModeLineSchema = z
  .object({
    type: z.literal("permission-mode"),
    permissionMode: z.string(),
    sessionId: z.string(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                           6. last-prompt                                   */
/* -------------------------------------------------------------------------- */

export const LastPromptLineSchema = z
  .object({
    type: z.literal("last-prompt"),
    lastPrompt: z.string(),
    sessionId: z.string(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                      7. file-history-snapshot                              */
/* -------------------------------------------------------------------------- */

export const FileHistorySnapshotLineSchema = z
  .object({
    type: z.literal("file-history-snapshot"),
    messageId: z.string(),
    snapshot: z.unknown(),
    isSnapshotUpdate: z.boolean().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                        8. queue-operation                                  */
/* -------------------------------------------------------------------------- */

export const QueueOperationLineSchema = z
  .object({
    type: z.literal("queue-operation"),
    operation: z.string(),
    timestamp: z.string(),
    sessionId: z.string(),
    content: z.string().optional(),
  })
  .passthrough();

/* -------------------------------------------------------------------------- */
/*                                 Union                                      */
/* -------------------------------------------------------------------------- */

export const ClaudeCodeLineSchema = z.discriminatedUnion("type", [
  UserLineSchema,
  AssistantLineSchema,
  SystemLineSchema,
  AttachmentLineSchema,
  PermissionModeLineSchema,
  LastPromptLineSchema,
  FileHistorySnapshotLineSchema,
  QueueOperationLineSchema,
]);

export type UserLine = z.infer<typeof UserLineSchema>;
export type AssistantLine = z.infer<typeof AssistantLineSchema>;
export type SystemLine = z.infer<typeof SystemLineSchema>;
export type AttachmentLine = z.infer<typeof AttachmentLineSchema>;
export type PermissionModeLine = z.infer<typeof PermissionModeLineSchema>;
export type LastPromptLine = z.infer<typeof LastPromptLineSchema>;
export type FileHistorySnapshotLine = z.infer<typeof FileHistorySnapshotLineSchema>;
export type QueueOperationLine = z.infer<typeof QueueOperationLineSchema>;
export type ClaudeCodeLine = z.infer<typeof ClaudeCodeLineSchema>;
