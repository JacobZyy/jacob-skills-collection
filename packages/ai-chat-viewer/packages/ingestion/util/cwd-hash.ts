import { createHash } from "node:crypto";

// Stable derived primary key for the Project table.
//
// Why hash: claude-code's per-project on-disk dir name is the cwd with `/`
// rewritten to `-` (lossy, see adapters/claude-code/decode-cwd.ts). Two
// distinct cwds can collide at the encoded layer ("/Users/a-b" and
// "/Users/a/b" both encode to "-Users-a-b"), so we hash the *real*
// (decoded, absolute) cwd and store that as the PK. Hashing also gives us
// a fixed-width 16-char id that's safe to embed in URLs without escaping.
//
// 16 hex chars = 64 bits of randomness — astronomically safe against
// accidental collision across the ~30 projects a single user has, and
// across user growth far beyond V1.
//
// Why this lives in ingestion (not server): the runner is the *writer* of
// Project rows. It computes cwdHash when it observes a new session whose
// sessionMeta carries a cwd. The server only reads cwdHash from the DB —
// it never needs to compute one. Co-locating with the writer makes the
// dependency direction match the data flow.
//
// Spec ref: deep-interview Q7 — Project PK strategy.

export function computeCwdHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}
