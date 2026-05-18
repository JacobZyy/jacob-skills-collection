/**
 * ⚠️ V1 LOSSY HEURISTIC: This decode is NOT a perfect inverse of claude-code's encoding.
 *   - Encoding rule: cwd.split('/').map(seg => seg.startsWith('.') ? '-' + seg.slice(1) : seg).join('-')
 *   - Single '-' is ambiguous (segment separator vs literal hyphen in dir name).
 *   - Heuristic: treat every '-' as separator, '--' as next segment starting with '.'.
 *
 * ⚠️ DO NOT USE FOR PRECISE cwd. JSONL rows carry the exact `cwd` field — read it directly.
 *   This helper is only for "directory-name fallback display" when the cwd field is absent.
 */

// Decode the encoded-cwd directory name claude-code uses for project
// folders under ~/.claude/projects/<encoded-cwd>/.
//
// Encoding shape (empirically derived from this machine's project folders
// + their cwd fields):
//   - Every '/' in the original cwd becomes '-'
//   - Every '.' that introduces a dot-prefixed segment also becomes '-'
//     (so '/Users/x/.cc-switch' is stored as '-Users-x--cc-switch')
//   - Hyphens that appear inside the original path segments are PRESERVED
//     verbatim ('/Users/x/jacob-open-source' → '-Users-x-jacob-open-source')
//
// The encoding is LOSSY: a single '-' may stand for '/', for '.', or for
// a literal hyphen, and the decoder cannot perfectly recover ambiguous
// cases (e.g. an original segment that itself contains '-' is
// indistinguishable from a '/'-separated multi-segment chunk on decode).
// In V1 we treat this best-effort: every JSONL line already carries an
// explicit `cwd` field, so this helper is only used for the project
// listing / fallback path when the cwd field is missing.
//
// Heuristic rules:
//   1. Leading '-' represents the root '/'.
//   2. A double '-' (empty slot between two '-' characters) marks the
//      following segment as dot-prefixed (e.g. '--cc-switch' → '/.cc-switch').
//   3. Every other '-' is treated as a path separator '/'.
//   4. Inputs that don't start with '-' are returned as-is (the caller is
//      expected to have already validated the encoded directory shape).
//
// This is deliberately a pure string transform — no fs lookup, no
// existence check. Callers may pair it with `fs.access` for confidence,
// but that is out of this helper's scope.

export function decodeCwd(encoded: string): string {
  if (typeof encoded !== "string" || encoded.length === 0) return encoded;
  if (!encoded.startsWith("-")) return encoded;

  // Split on '-'. Leading '-' produces a leading empty string we drop.
  // Subsequent empty strings (from '--') become dot-prefix markers.
  const parts = encoded.split("-");
  // First element is always '' from the leading '-'. Drop it.
  const segments: string[] = [];
  let pendingDot = false;
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i] ?? "";
    if (part === "") {
      // Empty slot: next non-empty part is dot-prefixed.
      pendingDot = true;
      continue;
    }
    segments.push(pendingDot ? `.${part}` : part);
    pendingDot = false;
  }

  return "/" + segments.join("/");
}
