import type { Prisma } from "./prisma";

// SQLite PRAGMAs we want active for the lifetime of the process.
//
//   journal_mode=WAL — write-ahead logging lets the ingestion runner write
//     while readers (Hono handlers) read concurrently. Without WAL, every
//     SELECT serializes against the writer and tail latency for AC-3 (<2s
//     SSE) collapses.
//   busy_timeout=5000 — ms to retry on SQLITE_BUSY before erroring. WAL
//     reduces but doesn't eliminate contention; 5s is generous enough that
//     even a slow filesystem (network-mounted home) won't false-positive.
//   synchronous=NORMAL — durability/perf tradeoff. NORMAL is the documented
//     pairing with WAL: still safe against application crashes, only loses
//     the most recent committed transaction on power loss. We are a derived
//     index (MNC#1: JSONL is source of truth) so even total DB loss is
//     recoverable; trading the last-tx durability for ~10x write throughput
//     during catch-up is a clear win.
//
// $queryRawUnsafe is required for `PRAGMA journal_mode=WAL` because SQLite
// returns the new journal mode as a result row; $executeRawUnsafe rejects
// statements that produce results. busy_timeout / synchronous don't return
// rows but we use $queryRawUnsafe uniformly so any future PRAGMA addition
// (e.g. cache_size, temp_store) is row-safe by default. The values are
// literals from this file, not user input, so the "Unsafe" suffix is
// acceptable here.
export async function applyPragma(prisma: Prisma): Promise<void> {
  await prisma.$queryRawUnsafe("PRAGMA journal_mode=WAL");
  await prisma.$queryRawUnsafe("PRAGMA busy_timeout=5000");
  await prisma.$queryRawUnsafe("PRAGMA synchronous=NORMAL");
}
