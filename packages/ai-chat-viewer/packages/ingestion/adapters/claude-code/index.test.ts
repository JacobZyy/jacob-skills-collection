// Smoke test for the assembled claudeCodeAdapter (T18).
//
// We do not re-test scan / tail / parseLine here — each has its own focused
// suite. This file's job is to verify:
//   - the adapter object is structurally assignable to IngestionAdapter
//   - `tool === "claude-code"`
//   - `detectRoot()` returns an absolute path under the user's home dir
//   - calling scan() / tail() routes into the real generators by piping
//     through a tiny on-disk fixture and counting events
//
// If a future change to the IngestionAdapter contract slips past
// types-contract.test.ts, this file's compile failure is the next net.

import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import type { IngestionAdapter, IngestionEvent } from "../../types";
import { claudeCodeAdapter, detectClaudeCodeRoot } from "./index";

const tempRoots: string[] = [];
afterAll(async () => {
  await Promise.all(tempRoots.map((p) => rm(p, { recursive: true, force: true })));
});

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

async function makeFixture(): Promise<{ root: string; filePath: string }> {
  const root = await mkdtemp(join(tmpdir(), "adapter-smoke-"));
  tempRoots.push(root);
  const projectDir = join(root, "-Users-x-foo");
  await mkdir(projectDir, { recursive: true });
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const filePath = join(projectDir, `${sessionId}.jsonl`);

  const userLine = JSON.stringify({
    type: "user",
    uuid: "bbb22222-2222-2222-2222-222222222222",
    parentUuid: null,
    isSidechain: false,
    sessionId,
    timestamp: "2026-05-11T00:00:01.000Z",
    cwd: "/Users/x/foo",
    gitBranch: "main",
    version: "2.1.116",
    entrypoint: "cli",
    message: { role: "user", content: "hi" },
  });
  await writeFile(filePath, userLine + "\n", "utf8");
  return { root, filePath };
}

describe("claudeCodeAdapter (assembled)", () => {
  test("assigns to IngestionAdapter and is a frozen singleton", () => {
    const a: IngestionAdapter = claudeCodeAdapter;
    expect(a.tool).toBe("claude-code");
    expect(Object.isFrozen(claudeCodeAdapter)).toBe(true);
  });

  test("detectRoot returns ~/.claude/projects under the user's home", () => {
    const root = claudeCodeAdapter.detectRoot();
    expect(root).toBe(detectClaudeCodeRoot());
    expect(root).toBe(join(homedir(), ".claude", "projects"));
  });

  test("scan() routes into the real generator (events flow through)", async () => {
    const { root } = await makeFixture();
    const events: IngestionEvent[] = await collect(claudeCodeAdapter.scan(root));
    // user-line yields message + session-meta
    expect(events.map((e) => e.kind)).toEqual(["message", "session-meta"]);
  });

  test("tail() routes into the real generator (events flow through)", async () => {
    const { filePath } = await makeFixture();
    const events: IngestionEvent[] = await collect(
      claudeCodeAdapter.tail(filePath, 0),
    );
    expect(events.map((e) => e.kind)).toEqual(["message", "session-meta"]);
  });
});
