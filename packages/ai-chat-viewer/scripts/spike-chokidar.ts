// Spike: chokidar v4 + Bun runtime compatibility check.
//
// IMPORTANT: chokidar v4 dropped glob support — passing a glob string like
// "~/.claude/projects/**/*.jsonl" silently matches NOTHING. The correct usage
// is to pass a directory path and supply an `ignored` predicate.
//
// Usage:
//   1) Terminal A: `bun scripts/spike-chokidar.ts`
//   2) Terminal B: `echo '{"spike":1}' >> ~/.claude/projects/<encoded-cwd>/spike-test.jsonl`
//   3) Terminal A should print `add` then `change` events.
//
// Result (recorded in SPIKE_RESULT.md): chokidar v4 + Bun 1.3.11 on darwin
// fires add/change/unlink reliably for *.jsonl when watching the parent
// directory with an ignored() predicate. Native fs.watch path is used (no
// fsevents bundle in v4); polling is unnecessary on darwin.
//
// Decision: KEEP chokidar v4 as the primary file watcher; do NOT downgrade.

import { homedir } from "node:os";
import { join } from "node:path";
import { statSync } from "node:fs";
import chokidar from "chokidar";

const root = join(homedir(), ".claude", "projects");

console.log(`[spike] pid=${process.pid} runtime=${typeof Bun !== "undefined" ? `bun ${Bun.version}` : "node"}`);
console.log(`[spike] watching directory: ${root}`);
console.log(`[spike] filter: only *.jsonl files (directories always allowed)`);

const watcher = chokidar.watch(root, {
  persistent: true,
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
  usePolling: false,
  atomic: true,
  // chokidar v4 ignored predicate: return true to ignore. Receives the path
  // and an optional fs.Stats. We must allow directories so traversal works.
  ignored: (entryPath, stats) => {
    const s = stats ?? safeStat(entryPath);
    if (s?.isDirectory()) return false;
    return !entryPath.endsWith(".jsonl");
  },
});

function safeStat(p: string) {
  try {
    return statSync(p);
  } catch {
    return undefined;
  }
}

let eventCount = 0;
const onEvent = (kind: string) => (path: string) => {
  eventCount += 1;
  console.log(`[spike][#${eventCount}] ${kind}  ${path}`);
};

watcher
  .on("ready", () => {
    console.log("[spike] ready — initial scan done. Now append to a *.jsonl under the watch root.");
  })
  .on("add", onEvent("add   "))
  .on("change", onEvent("change"))
  .on("unlink", onEvent("unlink"))
  .on("error", (err) => {
    console.error("[spike][error]", err);
  });

const shutdown = async () => {
  console.log(`[spike] received signal — closing watcher. total events: ${eventCount}`);
  await watcher.close();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
