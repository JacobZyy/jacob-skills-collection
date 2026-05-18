// Session-meta extractor for claude-code source lines.
//
// Contract (T16):
//   - Input: a parsed JSON object (unknown) coming from one source line.
//   - Output: a domain SessionMeta (cwd / gitBranch / version / entrypoint)
//     when the line carries those fields, otherwise null.
//
// Source of truth:
//   The four fields the runner cares about are stamped on every claude-code
//   `attachment` line (verified empirically — every session JSONL begins
//   with a hook-success attachment carrying cwd/gitBranch/version/entrypoint
//   plus the user/assistant/system identity bag). See source-schema.ts for
//   the underlying union; we accept a wider input here (any line shape can
//   carry these fields) and only emit when at minimum `cwd` + `sessionId`
//   are present, since the real cwd is the ONE field the runner cannot
//   recover from elsewhere (decode-cwd.ts is a lossy display fallback, not
//   a source of truth).
//
// Why a single-parameter signature:
//   The scan layer iterates over lines without tracking which session each
//   line belongs to outside the file path. To keep this helper stateless
//   and uniformly callable per line, we read `sessionId` directly off the
//   line — every meta-carrying line type (attachment / user / assistant /
//   system) stamps it.
//
// permission-mode / last-prompt are NOT handled here. They flow through
// parseLine as `SessionMetaPatch` results and the runner reduces them
// directly into the Session row. This keeps the SessionMeta contract
// (defined in packages/ingestion/types.ts) narrow.

import type { SessionMeta } from "../../types";
import { z } from "zod";

const MetaCarryingShape = z
  .object({
    sessionId: z.string(),
    cwd: z.string().optional(),
    gitBranch: z.string().optional(),
    version: z.string().optional(),
    entrypoint: z.string().optional(),
    timestamp: z.string().optional(),
  })
  .passthrough();

/**
 * Extract a domain `SessionMeta` from one parsed source-line JSON object.
 *
 * Returns:
 *   - `SessionMeta` when the line carries non-empty `cwd` AND `sessionId`.
 *     Other fields are filled when present, else `null`.
 *   - `null` otherwise (line has no cwd / sessionId / is not an object).
 *
 * Pure / side-effect-free. Never throws. The caller (scan / runner) folds
 * results into the Session row by "first observation wins"; ties or
 * subsequent mismatches are tolerated.
 *
 * Accepts any line shape — attachment lines are the canonical carriers in
 * claude-code's JSONL but user / assistant / system lines stamp the same
 * top-level fields and we accept them silently.
 */
export function extractSessionMetaFromLine(
  parsedLine: unknown,
): SessionMeta | null {
  const parsed = MetaCarryingShape.safeParse(parsedLine);
  if (!parsed.success) return null;

  const { sessionId, cwd, gitBranch, version, entrypoint, timestamp } =
    parsed.data;
  if (cwd === undefined || cwd.length === 0) return null;

  return {
    tool: "claude-code",
    sessionId,
    cwd,
    gitBranch: gitBranch ?? null,
    version: version ?? null,
    entrypoint: entrypoint ?? null,
    observedAt: timestamp ?? "1970-01-01T00:00:00.000Z",
  };
}

/**
 * Reduce a stream of per-line meta extractions into a single SessionMeta
 * for a session. "Earliest observation wins" by `observedAt`; subsequent
 * cwd/gitBranch/version/entrypoint mismatches are tolerated.
 *
 * Returns null when no input line carried meta.
 */
export function reduceSessionMeta(
  metas: Iterable<SessionMeta>,
): SessionMeta | null {
  let best: SessionMeta | null = null;
  for (const m of metas) {
    if (best === null) {
      best = m;
      continue;
    }
    if (m.observedAt < best.observedAt) {
      best = m;
    }
  }
  return best;
}
