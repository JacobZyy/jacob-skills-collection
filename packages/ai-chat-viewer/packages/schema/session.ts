// Domain-level Session schema.
//
// A Session represents one continuous claude-code conversation, identified
// by the JSONL filename (sessionId UUID). Metadata fields are surfaced from
// `attachment` lines by the ingestion adapter (T16) so renderers don't have
// to walk the raw stream — they read denormalized fields off the Session.
//
// Discipline (same as message.ts / attachment.ts):
//   - NO tool-specific line-type literals leak through here.
//   - `tool` discriminator is `z.literal('claude-code')` in V1.
//   - Optional fields use `.nullable()` so the DB layer can store NULL when
//     the source tool never emitted them (e.g. a session that never picked
//     up a gitBranch attachment).

import { z } from "zod";

export const SessionRecordSchema = z.object({
  /**
   * The session UUID — equal to the JSONL filename stem in claude-code.
   * Globally unique; PK on the Session table.
   */
  id: z.string(),
  /**
   * FK to Project.cwdHash. The project a session belongs to is determined
   * by the cwd recorded in the session's attachment metadata, not by the
   * encoded-cwd directory name on disk.
   */
  projectCwdHash: z.string(),
  /**
   * V1 hard pin. Future tools widen this literal AND ship a DB migration.
   */
  tool: z.literal("claude-code"),
  /**
   * Timestamp of the first line in the session.
   */
  startedAt: z.string(),
  /**
   * Timestamp of the most recent line. Drives the recent-first sort within
   * a project (AC-4 secondary).
   */
  lastActivityAt: z.string(),
  /**
   * Git branch recorded in the session's attachment metadata. Null when the
   * session ran outside a git repo or before the metadata was emitted.
   */
  gitBranch: z.string().nullable(),
  /**
   * Tool version (e.g. claude-code "2.1.116"). Useful for forward-compat
   * triage when parser logic needs to fork by source version.
   */
  version: z.string().nullable(),
  /**
   * Entrypoint surface (e.g. "cli"). Free-form per tool; not enumerated.
   */
  entrypoint: z.string().nullable(),
  /**
   * Permission mode in effect for the session ("default", "acceptEdits",
   * etc.). Tool-specific free-form string — NOT enumerated at the domain
   * level so new modes don't require a schema bump.
   */
  permissionMode: z.string().nullable(),
  /**
   * The most recent user prompt observed in the session. Used as the
   * second-tier session title fallback (after `summary`, before first user
   * message).
   */
  lastPrompt: z.string().nullable(),
  /**
   * AI-generated session summary if the source tool emitted one. Used as
   * the primary session title in the UI.
   */
  summary: z.string().nullable(),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;
