import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { injectDatabaseUrl } from "./db/path";
import { runMigrateDeploy } from "./migrate";
import { applyPragma } from "./pragma";
import { prisma } from "./prisma";
import {
  runIngestionCatchUp,
  startIngestionWatcher,
} from "./ingestion/runner";
import type { IngestionLogSink } from "./ingestion/runner";
import { claudeCodeAdapter } from "@ai-chat-viewer/ingestion";
import { logger, logIngestionFailure } from "./lib/logger";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Server boot orchestration. Order matters — see comments below.
//
// MNC#3 — CATCH-UP FAIL-FAST: any error during the catch-up scan is fatal
// (process.exit(1)). The runner is responsible for surfacing per-event Prisma
// errors as a thrown exception during catch-up. Tail-mode (started after the
// listener) catches and logs per-event errors and continues.
//
// AC-2: catch-up p95 < 60s on 29 projects / 325 sessions / 203MB. We log a
// stopwatch for both [boot] and [catch-up]. The Hono listener does NOT start
// until catch-up resolves so external probes don't observe a partial DB.

const PORT = 3001;

// Resolve the workspace root (= the directory containing prisma/schema.prisma).
// Walking up from this file: apps/server/src/index.ts → apps/server/src →
// apps/server → apps → repo root.
function resolveRepoRoot(): string {
  const here = fileURLToPath(import.meta.url);
  return resolve(here, "..", "..", "..", "..");
}

// Log sink wired into the ingestion runner.  Fan-out by shape:
//   - IngestionFailureRecord  → ingestion.log (async, fire-and-forget)
//   - everything else         → logger.error (sync, structured)
const ingestionLog: IngestionLogSink = (event: unknown): void => {
  const rec = event as { ts?: string; tool?: string; sessionId?: string; lineNo?: number; reason?: string };
  if (
    rec &&
    typeof rec.ts === "string" &&
    typeof rec.tool === "string" &&
    typeof rec.sessionId === "string" &&
    typeof rec.lineNo === "number" &&
    typeof rec.reason === "string"
  ) {
    void logIngestionFailure(rec as { ts: string; tool: string; sessionId: string; lineNo: number; reason: string });
    return;
  }
  logger.error("ingestion runner error", { err: event });
};

async function main(): Promise<void> {
  const bootStart = performance.now();

  // 1. Compose DB path. injectDatabaseUrl mutates process.env.DATABASE_URL
  //    AND ensures the parent directory exists. Must precede any Prisma
  //    client instantiation, which is why apps/server/src/prisma.ts is
  //    imported lazily below — see step 4.
  const dbPath = injectDatabaseUrl();
  console.log(`[boot] db=${dbPath}`);

  // 2. Run prisma migrate deploy (fail-fast on non-zero exit). Required so
  //    the schema is present before the runner upserts (MNC#3).
  const repoRoot = resolveRepoRoot();
  runMigrateDeploy(repoRoot);

  // 3. Apply SQLite PRAGMAs (WAL, busy_timeout, synchronous=NORMAL). Must
  //    run on a live connection, so PrismaClient must already be open.
  await applyPragma(prisma);

  // 4. Catch-up scan. AC-2 timing wraps this only — boot/listener overhead
  //    is excluded. MNC#3: throws here are fatal.
  const adapter = claudeCodeAdapter;
  const catchUpStart = performance.now();
  let result;
  try {
    result = await runIngestionCatchUp(prisma, adapter, ingestionLog);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[catch-up] FATAL: ${msg}`);
    process.exit(1);
  }
  const catchUpDurationMs = Math.round(performance.now() - catchUpStart);
  console.log(
    `[catch-up] complete projects=${result.projectCount} sessions=${result.sessionCount} messages=${result.messageCount} attachments=${result.attachmentCount} duration=${catchUpDurationMs}ms`
  );

  // 5. Start the ingestion watcher (tail loop) AFTER catch-up.
  //    log-and-continue: tail-mode errors never crash the server.
  //    Awaits chokidar 'ready' so the first change event is never dropped.
  const watcherHandle = await startIngestionWatcher(prisma, adapter, ingestionLog);

  // 6. Start the Hono listener AFTER catch-up. AC-1 (port 3001) and
  //    /health become reachable here.
  const app = createApp();
  serve({ fetch: app.fetch, port: PORT }, (info) => {
    const bootMs = Math.round(performance.now() - bootStart);
    console.log(
      `[boot] listening on http://localhost:${info.port} (total bootMs=${bootMs})`
    );
  });
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[boot] FATAL: ${msg}`);
  process.exit(1);
});
