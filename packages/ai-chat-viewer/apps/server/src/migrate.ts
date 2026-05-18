import type { SpawnSyncReturns } from "node:child_process";
import { spawnSync as nodeSpawnSync } from "node:child_process";
import { resolve } from "node:path";

// Run `prisma migrate deploy` synchronously at boot. Fail-fast: any non-zero
// exit code is fatal — a half-migrated DB silently breaks AC-7 (delete DB →
// rebuild). The runner's catch-up scan would then upsert into a schema that
// doesn't match the writes, producing FK / column mismatch errors mid-scan.
//
// We shell out to the prisma CLI rather than calling a programmatic migrate
// API because Prisma does not expose `migrate deploy` as a stable JS function.
// `bun x prisma migrate deploy` resolves the workspace-installed prisma binary
// without requiring a global install.
//
// Schema location: prisma/schema.prisma is at the repo root (workspace root),
// not inside apps/server/. We pass --schema explicitly so the CLI can be
// invoked from any cwd without ambiguity.
//
// The `spawn` injection point exists for unit tests — production callers
// pass nothing and the real `node:child_process.spawnSync` is used.

export type SpawnSyncFn = (
  command: string,
  args: ReadonlyArray<string>,
  options: {
    cwd: string;
    stdio: "inherit";
    env: NodeJS.ProcessEnv;
  }
) => SpawnSyncReturns<Buffer>;

export function runMigrateDeploy(
  repoRoot: string,
  spawn: SpawnSyncFn = nodeSpawnSync
): void {
  const schemaPath = resolve(repoRoot, "prisma", "schema.prisma");
  const result = spawn(
    "bun",
    ["x", "prisma", "migrate", "deploy", "--schema", schemaPath],
    {
      cwd: repoRoot,
      stdio: "inherit",
      env: process.env,
    }
  );

  if (result.error) {
    throw new Error(
      `[migrate] failed to spawn prisma migrate deploy: ${result.error.message}`
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `[migrate] prisma migrate deploy exited with status=${result.status}`
    );
  }
}
