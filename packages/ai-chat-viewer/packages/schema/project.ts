// Domain-level Project schema.
//
// A Project represents a single distinct working directory observed in the
// source tool's history. Per spec, Project.cwdHash (sha256(cwd) prefix) is
// the stable PK — the encoded-cwd directory name on disk is mathematically
// lossy and unsafe to use as an identity (see
// packages/ingestion/adapters/claude-code/decode-cwd.ts).
//
// `displayName` is the M3 basename-disambiguation landing point: when two
// projects share the same basename (e.g. /a/web and /b/web), the ingestion
// layer (T22 + T23) emits a disambiguated display string like "web (a)".
// The schema keeps it as a plain string so renderers don't need to repeat
// the disambiguation logic.

import { z } from "zod";

export const ProjectRecordSchema = z.object({
  /**
   * sha256(cwd) prefix used as the stable PK. Computed in T22.
   */
  cwdHash: z.string(),
  /**
   * Absolute filesystem path of the working directory, exactly as observed
   * in the source tool's session metadata. Source of truth for the project.
   */
  cwd: z.string(),
  /**
   * Disambiguated human-readable name. Default = basename(cwd); on basename
   * collision the ingestion layer escalates per T23's three-step fallback.
   */
  displayName: z.string(),
  /**
   * Most recent activity observed across this project's sessions. Drives
   * the homepage "most recently used" sort (AC-4).
   */
  lastSeenAt: z.string(),
  /**
   * First time this project was observed by ingestion. Stable; never
   * regresses on subsequent re-scans.
   */
  firstSeenAt: z.string(),
});

export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
