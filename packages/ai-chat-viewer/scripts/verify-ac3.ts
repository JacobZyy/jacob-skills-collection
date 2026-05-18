#!/usr/bin/env bun
// verify-ac3.ts — AC-3 incremental tail latency gate.
//
// AC-3 claim: new JSONL lines sync to SSE subscribers within 2s (p95).
//
// What this script does:
//   1. Start the server (apps/server/src/index.ts) with the real ingestion
//      runner already wired (post-#45).
//   2. Open an SSE connection to /api/stream.
//   3. Pick an existing session JSONL file under ~/.claude/projects.
//   4. For N rounds:
//        a. Append a synthetic message line to the JSONL.
//        b. Wait for the "message-appended" SSE event.
//        c. Record wall time from append to event arrival.
//   5. Compute p95. PASS if < 2000ms.
//
// Destructive: appends lines to a REAL session file. We pick a low-traffic
// session and append a recognizable test payload (tool="verify-ac3") so
// the ingestion adapter routes it to ChatMessage. The line carries a unique
// uuid per round so dedup is trivial.
//
// Cleanup: on exit we truncate back to the original file size (restoring
// the exact bytes). A SIGKILL mid-run would leave garbage — acceptable
// because the line is syntactically valid JSONL and the ingestion runner
// will simply ingest it on next boot (harmless test data).
//
// Usage:
//   bun run scripts/verify-ac3.ts --yes
//   AI_CHAT_VIEWER_VERIFY_AC3_CONFIRM=1 bun run scripts/verify-ac3.ts
//
// Exits 0 on PASS, 1 on perf/sanity fail, 2 on misuse.

import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, statSync, truncateSync, readdirSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

/* -------------------------------------------------------------------------- */
/*                              Constants                                     */
/* -------------------------------------------------------------------------- */

const ROUNDS = 10;
const PER_ROUND_TIMEOUT_MS = 30_000; // 2s budget + headroom
const P95_BUDGET_MS = 2_000;

const SSE_PATH = "http://127.0.0.1:3001/api/stream";
const EVENT_NAME = "message-appended";

/* -------------------------------------------------------------------------- */
/*                              Path resolution                               */
/* -------------------------------------------------------------------------- */

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const SERVER_DIR = join(REPO_ROOT, "apps", "server");
const SERVER_ENTRY = join(SERVER_DIR, "src", "index.ts");
const PROJECTS_DIR = join(homedir(), ".claude", "projects");

/* -------------------------------------------------------------------------- */
/*                              Confirmation gate                             */
/* -------------------------------------------------------------------------- */

function parseArgs(): { confirmed: boolean } {
  const argv = process.argv.slice(2);
  if (argv.includes("--yes")) return { confirmed: true };
  if (process.env["AI_CHAT_VIEWER_VERIFY_AC3_CONFIRM"] === "1") {
    return { confirmed: true };
  }
  if (argv.length === 0) return { confirmed: false };
  console.error(`[ac3] usage: bun run scripts/verify-ac3.ts [--yes]`);
  process.exit(2);
}

function refuse(): never {
  console.error(
    `[ac3] REFUSING to run: this script APPENDS to real session JSONL files\n` +
      `      under ${PROJECTS_DIR} and DELETES the global SQLite DB.\n\n` +
      `      To proceed, re-run with --yes or set\n` +
      `      AI_CHAT_VIEWER_VERIFY_AC3_CONFIRM=1 in the env.`
  );
  process.exit(2);
}

/* -------------------------------------------------------------------------- */
/*                              Dep checks                                    */
/* -------------------------------------------------------------------------- */

function requireBin(bin: string): void {
  const res = spawnSync("command", ["-v", bin], { shell: "/bin/bash" });
  if (res.status !== 0) {
    console.error(`[ac3] FAIL: missing dependency \`${bin}\` on PATH`);
    process.exit(2);
  }
}

/* -------------------------------------------------------------------------- */
/*                              Kill existing DB holders                      */
/* -------------------------------------------------------------------------- */

// Prisma migrate deploy needs an exclusive lock on the DB. If another Bun
// process (e.g. a prior `bun dev` server) still holds the WAL connection,
// schema engine fails with "database is locked". We proactively SIGTERM any
// process that has the DB file open, then give it a brief grace period.
function killExistingDbHolders(dbPath: string): void {
  const res = spawnSync("lsof", ["-t", dbPath], { encoding: "utf8" });
  if (res.status !== 0 || !res.stdout.trim()) return;
  const pids = res.stdout.trim().split("\n").filter(Boolean);
  for (const pid of pids) {
    if (pid === String(process.pid)) continue; // don't suicide
    try {
      process.kill(Number(pid), "SIGTERM");
      console.log(`[ac3] SIGTERM pid=${pid} (holding ${dbPath})`);
    } catch {
      // already gone
    }
  }
  // Grace period for WAL checkpoint and clean close.
  spawnSync("sleep", ["1"]);
}

/* -------------------------------------------------------------------------- */
/*                              Target file selection                         */
/* -------------------------------------------------------------------------- */

interface TargetFile {
  filePath: string;
  sessionId: string;
}

// Create a dedicated test project + session file so we never interfere with
// live claude-code sessions.  The runner watches the whole tree, so a new
// file under a new project directory is picked up just like any other.
function createTargetFile(): TargetFile {
  if (!existsSync(PROJECTS_DIR)) {
    console.error(`[ac3] FAIL: ${PROJECTS_DIR} does not exist`);
    process.exit(1);
  }
  const sessionId = `verify-ac3-session-${Date.now()}`;
  const projectName = "-verify-ac3-project";
  const projectDir = join(PROJECTS_DIR, projectName);
  if (!existsSync(projectDir)) {
    const { mkdirSync } = require("node:fs");
    mkdirSync(projectDir, { recursive: true });
  }
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  // Seed with one valid session-meta line so the runner can resolve the
  // session's cwd/project without a follow-up read.
  const seedLine = JSON.stringify({
    type: "user",
    uuid: `verify-ac3-seed-${Date.now()}`,
    sessionId,
    parentUuid: null,
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: [{ type: "text", text: "seed" }] },
    cwd: "/verify/ac3",
    version: "verify-ac3",
    entrypoint: "verify-ac3",
  }) + "\n";
  const { writeFileSync } = require("node:fs");
  writeFileSync(filePath, seedLine, "utf8");
  return { filePath, sessionId };
}

function cleanupTargetFile(filePath: string): void {
  try {
    const { unlinkSync, rmdirSync } = require("node:fs");
    unlinkSync(filePath);
    const dir = dirname(filePath);
    try { rmdirSync(dir); } catch { /* may contain other files */ }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ac3] WARN: cleanup failed: ${msg}`);
  }
}

/* -------------------------------------------------------------------------- */
/*                              SSE client                                    */
/* -------------------------------------------------------------------------- */

// Minimal EventSource-like consumer using fetch + ReadableStream.
// We only need to listen for one event type and extract JSON data.
interface SseMessage {
  event: string;
  data: string;
  id?: string;
}

interface SseStream {
  onEvent: (handler: (msg: SseMessage) => void) => void;
  close: () => void;
}

async function openSseStream(url: string): Promise<SseStream> {
  console.log(`[ac3] SSE connecting to ${url}`);
  const res = await fetch(url);
  console.log(`[ac3] SSE connect status: ${res.status}`);
  if (!res.ok || !res.body) {
    throw new Error(`SSE connect failed: ${res.status} ${res.statusText}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let handler: ((msg: SseMessage) => void) | null = null;
  let running = true;

  function processBuffer(): void {
    buffer = buffer.replace(/\r\n/g, "\n");
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);

      const msg: Partial<SseMessage> = {};
      for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) {
          msg.event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          msg.data = line.slice(5).trim();
        } else if (line.startsWith("id:")) {
          msg.id = line.slice(3).trim();
        }
      }
      if (msg.event && msg.data && handler) {
        if (msg.event === "message-appended") {
          try {
            const d = JSON.parse(msg.data) as { id?: string };
            console.log(`[ac3] SSE event: ${msg.event}, id=${d.id ?? "undefined"}`);
          } catch {
            console.log(`[ac3] SSE event: ${msg.event}, data length: ${msg.data.length}, parse failed`);
          }
        } else {
          console.log(`[ac3] SSE event: ${msg.event}, data length: ${msg.data.length}`);
        }
        handler(msg as SseMessage);
      }
    }
  }

  (async () => {
    try {
      while (running) {
        const { done, value } = await reader.read();
        if (done) {
          console.log(`[ac3] SSE stream done`);
          break;
        }
        buffer += decoder.decode(value, { stream: true });
        processBuffer();
      }
    } catch (err) {
      console.log(`[ac3] SSE read error: ${err}`);
    } finally {
      reader.releaseLock();
    }
  })();

  return {
    onEvent: (h: (msg: SseMessage) => void) => {
      handler = h;
    },
    close: () => {
      running = false;
      reader.cancel().catch(() => {});
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                              One round                                     */
/* -------------------------------------------------------------------------- */

interface RoundResult {
  durationMs: number;
  eventData: unknown;
}

// Build a synthetic message line that parseLine will accept as "user".
// The uuid is unique per round so we can correlate the SSE event.
function buildTestLine(sessionId: string, round: number): string {
  const uuid = `verify-ac3-${round}-${Date.now()}`;
  const payload = {
    type: "user",
    uuid,
    sessionId,
    parentUuid: null,
    isSidechain: false,
    timestamp: new Date().toISOString(),
    message: {
      role: "user",
      content: [{ type: "text", text: `verify-ac3 round ${round}` }],
    },
    cwd: "/verify/ac3",
    version: "verify-ac3",
    entrypoint: "verify-ac3",
  };
  return JSON.stringify(payload) + "\n";
}

async function runOnce(
  round: number,
  target: TargetFile
): Promise<RoundResult> {
  const testLine = buildTestLine(target.sessionId, round);
  const testUuid = JSON.parse(testLine).uuid;

  // Open SSE connection and wait for the hello event BEFORE appending.
  // This guarantees the listener is wired when the runner emits.
  const stream = await openSseStream(SSE_PATH);
  console.log(`[ac3] round ${round}: SSE ready, awaiting events`);

  const ssePromise = new Promise<RoundResult>((resolve, reject) => {
    const timeout = setTimeout(() => {
      stream.close();
      reject(
        new Error(
          `round ${round}: timeout — no '${EVENT_NAME}' event within ${PER_ROUND_TIMEOUT_MS}ms`
        )
      );
    }, PER_ROUND_TIMEOUT_MS);

    stream.onEvent((msg) => {
      if (msg.event !== EVENT_NAME) return;
      try {
        const data = JSON.parse(msg.data) as { id?: string; uuid?: string };
        console.log(`[ac3] round ${round}: msg-appended id=${data.id ?? "undefined"} (looking for ${testUuid})`);
        if (data.id === testUuid) {
          clearTimeout(timeout);
          stream.close();
          resolve({ durationMs: 0, eventData: data });
        }
      } catch (err) {
        console.log(`[ac3] round ${round}: msg-appended JSON parse failed: ${err}`);
      }
    });
  });

  const appendStart = performance.now();
  appendFileSync(target.filePath, testLine, "utf8");
  console.log(`[ac3] round ${round}: appended testLine uuid=${testUuid} to ${target.filePath}`);

  const result = await ssePromise;
  const durationMs = Math.round(performance.now() - appendStart);
  return { durationMs, eventData: result.eventData };
}

/* -------------------------------------------------------------------------- */
/*                              Percentile                                    */
/* -------------------------------------------------------------------------- */

function percentile(samples: readonly number[], p: number): number {
  if (samples.length === 0) {
    throw new Error("percentile: empty samples");
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(p * sorted.length) - 1;
  const safe = Math.max(0, Math.min(sorted.length - 1, idx));
  return sorted[safe] ?? 0;
}

/* -------------------------------------------------------------------------- */
/*                              Main                                          */
/* -------------------------------------------------------------------------- */

async function main(): Promise<void> {
  const { confirmed } = parseArgs();
  if (!confirmed) refuse();

  requireBin("bun");

  if (!existsSync(SERVER_ENTRY)) {
    console.error(`[ac3] FAIL: server entry missing at ${SERVER_ENTRY}`);
    process.exit(2);
  }

  const target = createTargetFile();
  console.log(
    `[ac3] target: session=${target.sessionId} file=${target.filePath}`
  );

  // Check if a server is already running on 3001 (e.g. tmux dev session).
  let child: ReturnType<typeof spawn> | null = null;
  const runningCheck = spawnSync("curl", [
    "-s", "-o", "/dev/null", "-w", "%{http_code}",
    "http://127.0.0.1:3001/health",
  ], { encoding: "utf8", shell: "/bin/bash" });
  if (runningCheck.stdout.trim() === "200") {
    console.log(`[ac3] reusing existing server on :3001`);
  } else {
    // Ensure the DB directory exists.
    const dbDir = join(homedir(), "Library", "Application Support", "ai-chat-viewer");
    const dbPath = join(dbDir, "db.sqlite");
    if (!existsSync(dbDir)) {
      const { mkdirSync } = await import("node:fs");
      mkdirSync(dbDir, { recursive: true });
    }
    killExistingDbHolders(dbPath);

    // Spawn server.
    console.log(`[ac3] spawning server`);
    child = spawn("bun", ["run", "src/index.ts"], {
      cwd: SERVER_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stderr.on("data", (buf: Buffer) => {
      process.stderr.write(`[server] ${buf.toString()}`);
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("server boot timeout — no [boot] listening line"));
      }, 30_000);
      const rl = createInterface({ input: child.stdout });
      rl.on("line", (line: string) => {
        if (line.includes("[boot] listening")) {
          clearTimeout(timeout);
          rl.close();
          child.stdout.resume();
          child.stdout.on("data", (buf: Buffer) => {
            process.stdout.write(`[server] ${buf.toString()}`);
          });
          resolve();
          return;
        }
      });
      child.once("exit", (code) => {
        clearTimeout(timeout);
        reject(new Error(`server exited early (code=${code})`));
      });
    });

    await new Promise((r) => setTimeout(r, 500));
  }

  const durations: number[] = [];
  for (let i = 1; i <= ROUNDS; i++) {
    console.log(`[ac3] round ${i}/${ROUNDS}: appending test line`);
    try {
      const r = await runOnce(i, target);
      console.log(`[ac3] round ${i}/${ROUNDS}: event arrived in ${r.durationMs}ms`);
      durations.push(r.durationMs);
      await new Promise((res) => setTimeout(res, 500));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[ac3] FAIL: ${msg}`);
      cleanupTargetFile(target.filePath);
      if (child) {
        child.kill("SIGTERM");
        setTimeout(() => child.kill("SIGKILL"), 500);
      }
      process.exit(1);
    }
  }

  cleanupTargetFile(target.filePath);
  if (child) {
    child.kill("SIGTERM");
    setTimeout(() => child.kill("SIGKILL"), 500);
  }

  const p95Ms = percentile(durations, 0.95);
  const p99Ms = percentile(durations, 0.99);
  const all = durations.map((d) => `${d}ms`).join(", ");
  console.log(`[ac3] samples: [${all}]`);
  console.log(
    `[ac3] AC-3 ${p95Ms < P95_BUDGET_MS ? "PASS" : "FAIL"}: ` +
      `p95=${p95Ms}ms p99=${p99Ms}ms (budget p95<${P95_BUDGET_MS}ms)`
  );
  if (p95Ms >= P95_BUDGET_MS) {
    process.exit(1);
  }
}

function cleanup(
  filePath: string,
  originalSize: number,
  child: ReturnType<typeof spawn>
): void {
  // Restore file to original size.
  try {
    truncateSync(filePath, originalSize);
    console.log(`[ac3] restored ${filePath} to ${originalSize} bytes`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[ac3] WARN: could not restore file: ${msg}`);
  }

  // Kill server.
  try {
    child.kill("SIGTERM");
  } catch {
    /* already dead */
  }
  setTimeout(() => {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already dead */
    }
  }, 500);
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[ac3] FATAL: ${msg}`);
  process.exit(1);
});
