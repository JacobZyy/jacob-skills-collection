// Domain-level IngestionSource schema.
//
// One row per source tool currently feeding the store. V1 has exactly one
// row (tool="claude-code", rootPath=~/.claude/projects). The shape exists
// at the domain level so future tools (Cursor, Cline, ...) can be wired in
// without a contract change — they only differ in `tool` discriminator and
// `rootPath`.

import { z } from "zod";

export const IngestionSourceRecordSchema = z.object({
  /**
   * V1 hard pin. Each source tool registers exactly one row keyed by this
   * literal. New tools widen the literal AND ship a DB migration.
   */
  tool: z.literal("claude-code"),
  /**
   * Root directory the adapter watches. For claude-code this is
   * ~/.claude/projects.
   */
  rootPath: z.string(),
  /**
   * Wall-clock time of the most recent completed catch-up scan. Updated by
   * the ingestion runner after each full scan; informs whether a fresh
   * full scan is needed on boot.
   */
  lastScannedAt: z.string(),
});

export type IngestionSourceRecord = z.infer<typeof IngestionSourceRecordSchema>;
