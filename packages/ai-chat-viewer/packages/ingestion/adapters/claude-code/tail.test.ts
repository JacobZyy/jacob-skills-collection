// Test suite for the incremental tail generator (T17).
//
// Cases (per team-lead spec):
//   (a) mid-offset start: fromOffset > 0 yields only the suffix
//   (b) no-new-lines: fromOffset == stat.size → empty, no throw
//   (c) partial-line tolerance: a line lacking a trailing \n is NOT yielded
//   (d) fromOffset > stat.size: empty, no throw (caller is expected to
//       detect truncate independently)
//   (e) cross-validation: scan(rootDir) over a single file yields the
//       SAME N events / order / sourceOffsets as tail(filePath, 0).

import { afterAll, describe, expect, test } from "bun:test";
import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IngestionEvent } from "../../types";

import { scan } from "./scan";
import { tailFile } from "./tail";

const tempRoots: string[] = [];
afterAll(async () => {
  await Promise.all(tempRoots.map((p) => rm(p, { recursive: true, force: true })));
});

async function makeTempProject(): Promise<{
  root: string;
  projectDir: string;
  filePath: string;
  sessionId: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "tail-test-"));
  tempRoots.push(root);
  const projectDir = join(root, "-Users-x-foo");
  await import("node:fs/promises").then((m) => m.mkdir(projectDir, { recursive: true }));
  const sessionId = "11111111-2222-3333-4444-555555555555";
  const filePath = join(projectDir, `${sessionId}.jsonl`);
  return { root, projectDir, filePath, sessionId };
}

/**
 * A few canonical claude-code lines we can append in any order. Every line
 * is JSON-stringified onto a single physical row and ends with `\n` when
 * written via writeJsonl/append helpers below.
 */
function attachmentLine(uuid: string, sessionId: string): string {
  return JSON.stringify({
    type: "attachment",
    uuid,
    parentUuid: null,
    isSidechain: false,
    sessionId,
    timestamp: "2026-05-11T00:00:01.000Z",
    cwd: "/Users/x/foo",
    gitBranch: "main",
    version: "2.1.116",
    entrypoint: "cli",
    userType: "external",
    attachment: { type: "hook_success", hookName: "SessionStart:startup" },
  });
}

function userLine(uuid: string, parent: string | null, sessionId: string, body: string): string {
  return JSON.stringify({
    type: "user",
    uuid,
    parentUuid: parent,
    isSidechain: false,
    sessionId,
    timestamp: "2026-05-11T00:00:02.000Z",
    cwd: "/Users/x/foo",
    gitBranch: "main",
    version: "2.1.116",
    entrypoint: "cli",
    message: { role: "user", content: body },
  });
}

function permissionModeLine(sessionId: string): string {
  return JSON.stringify({
    type: "permission-mode",
    uuid: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    sessionId,
    timestamp: "2026-05-11T00:00:00.000Z",
    permissionMode: "acceptEdits",
  });
}

async function writeJsonl(filePath: string, lines: string[]): Promise<void> {
  await writeFile(filePath, lines.map((l) => l + "\n").join(""), "utf8");
}

async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

/* -------------------------------------------------------------------------- */
/*                              Test cases                                    */
/* -------------------------------------------------------------------------- */

describe("tailFile", () => {
  test("(a) mid-offset start yields only the suffix", async () => {
    const { filePath, sessionId } = await makeTempProject();
    const l1 = permissionModeLine(sessionId);
    const l2 = attachmentLine("aaa11111-1111-1111-1111-111111111111", sessionId);
    const l3 = userLine("bbb22222-2222-2222-2222-222222222222", null, sessionId, "hi");
    await writeJsonl(filePath, [l1, l2, l3]);

    // Compute the byte cursor at the boundary between l1 and l2: that's
    // exactly the sourceOffset scan would have persisted after l1.
    const offsetAfterL1 = Buffer.byteLength(l1, "utf8") + 1;
    const events = await collect(tailFile(filePath, offsetAfterL1));

    // Expect: l2 → 1 attachment + 1 session-meta, l3 → 1 message + 1 session-meta
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["attachment", "session-meta", "message", "session-meta"]);
    // First event's sourceOffset must land at the end of l2's newline.
    const offsetAfterL2 = offsetAfterL1 + Buffer.byteLength(l2, "utf8") + 1;
    expect(events[0]!.sourceOffset).toBe(offsetAfterL2);
    expect(events[1]!.sourceOffset).toBe(offsetAfterL2);
  });

  test("(b) no-new-lines yields nothing without throwing", async () => {
    const { filePath, sessionId } = await makeTempProject();
    const l1 = permissionModeLine(sessionId);
    await writeJsonl(filePath, [l1]);

    const size = Buffer.byteLength(l1, "utf8") + 1;
    const events = await collect(tailFile(filePath, size));
    expect(events).toEqual([]);
  });

  test("(c) partial-line (no trailing newline) is NOT yielded", async () => {
    const { filePath, sessionId } = await makeTempProject();
    const l1 = permissionModeLine(sessionId);
    const l2Partial = attachmentLine("aaa11111-1111-1111-1111-111111111111", sessionId);
    // Write l1 fully + l2 WITHOUT trailing newline (mid-write simulation).
    await writeFile(filePath, l1 + "\n" + l2Partial, "utf8");

    const events = await collect(tailFile(filePath, 0));
    // Only l1's events should appear: 1 patch (permission-mode → patch),
    // no session-meta because permission-mode lines have no cwd field.
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual(["session-meta-patch"]);

    // Now finish writing the trailing newline: a fresh tail() from the
    // same fromOffset (= byte after l1) should now pick up the now-
    // complete l2.
    await appendFile(filePath, "\n", "utf8");
    const offsetAfterL1 = Buffer.byteLength(l1, "utf8") + 1;
    const events2 = await collect(tailFile(filePath, offsetAfterL1));
    expect(events2.map((e) => e.kind)).toEqual(["attachment", "session-meta"]);
  });

  test("(d) fromOffset > stat.size yields empty, no throw", async () => {
    const { filePath, sessionId } = await makeTempProject();
    const l1 = permissionModeLine(sessionId);
    await writeJsonl(filePath, [l1]);
    const size = Buffer.byteLength(l1, "utf8") + 1;

    // Cursor 10x the file size — runner-level truncate would have caught
    // this; tailFile must just yield nothing.
    const events = await collect(tailFile(filePath, size * 10));
    expect(events).toEqual([]);
  });

  test("(e) tail(0) emits the same sequence as scan() over the same file", async () => {
    const { root, filePath, sessionId } = await makeTempProject();
    const lines = [
      permissionModeLine(sessionId),
      attachmentLine("aaa11111-1111-1111-1111-111111111111", sessionId),
      userLine("bbb22222-2222-2222-2222-222222222222", null, sessionId, "hi"),
      userLine("ccc33333-3333-3333-3333-333333333333", "bbb22222-2222-2222-2222-222222222222", sessionId, "你好世界🌏"),
    ];
    await writeJsonl(filePath, lines);

    // scan walks the whole rootDir; we only have one project / one file.
    const scanEvents: IngestionEvent[] = await collect(scan(root));
    const tailEvents: IngestionEvent[] = await collect(tailFile(filePath, 0));

    // Identical length, identical kind sequence, identical sourceOffsets.
    expect(tailEvents.length).toBe(scanEvents.length);
    expect(tailEvents.map((e) => e.kind)).toEqual(scanEvents.map((e) => e.kind));
    expect(tailEvents.map((e) => e.sourceOffset)).toEqual(
      scanEvents.map((e) => e.sourceOffset),
    );
  });
});
