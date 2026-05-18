import { describe, expect, it } from "bun:test";
import type { SpawnSyncReturns } from "node:child_process";
import { runMigrateDeploy, type SpawnSyncFn } from "../migrate";

// Build a SpawnSyncReturns<Buffer>-shaped stub. The Bun runtime never reads
// pid/output/signal in our happy-path branch — only `status` and `error`.
function spawnReturn(overrides: Partial<SpawnSyncReturns<Buffer>>): SpawnSyncReturns<Buffer> {
  return {
    pid: 1,
    output: [],
    stdout: Buffer.from(""),
    stderr: Buffer.from(""),
    status: 0,
    signal: null,
    ...overrides,
  };
}

describe("runMigrateDeploy fail-fast", () => {
  it("returns normally when prisma exits 0", () => {
    const spawn: SpawnSyncFn = () => spawnReturn({ status: 0 });
    expect(() => runMigrateDeploy("/fake/root", spawn)).not.toThrow();
  });

  it("throws when prisma exits non-zero (e.g. SQL syntax error in migration.sql)", () => {
    const spawn: SpawnSyncFn = () => spawnReturn({ status: 1 });
    expect(() => runMigrateDeploy("/fake/root", spawn)).toThrow(
      /prisma migrate deploy exited with status=1/
    );
  });

  it("throws when prisma exits with status=2 (CLI usage error)", () => {
    const spawn: SpawnSyncFn = () => spawnReturn({ status: 2 });
    expect(() => runMigrateDeploy("/fake/root", spawn)).toThrow(
      /status=2/
    );
  });

  it("throws when spawn itself fails (e.g. bun binary missing)", () => {
    const spawn: SpawnSyncFn = () =>
      spawnReturn({
        status: null,
        error: new Error("ENOENT: command not found: bun"),
      });
    expect(() => runMigrateDeploy("/fake/root", spawn)).toThrow(
      /failed to spawn prisma migrate deploy: ENOENT/
    );
  });

  it("passes --schema pointing at <repoRoot>/prisma/schema.prisma", () => {
    let capturedArgs: ReadonlyArray<string> = [];
    const spawn: SpawnSyncFn = (_cmd, args) => {
      capturedArgs = args;
      return spawnReturn({ status: 0 });
    };
    runMigrateDeploy("/repo/root", spawn);
    expect(capturedArgs).toContain("--schema");
    expect(capturedArgs).toContain("/repo/root/prisma/schema.prisma");
  });

  it("runs `bun x prisma migrate deploy` (the documented invocation)", () => {
    let capturedCmd = "";
    let capturedArgs: ReadonlyArray<string> = [];
    const spawn: SpawnSyncFn = (cmd, args) => {
      capturedCmd = cmd;
      capturedArgs = args;
      return spawnReturn({ status: 0 });
    };
    runMigrateDeploy("/repo", spawn);
    expect(capturedCmd).toBe("bun");
    expect(capturedArgs.slice(0, 4)).toEqual(["x", "prisma", "migrate", "deploy"]);
  });
});
