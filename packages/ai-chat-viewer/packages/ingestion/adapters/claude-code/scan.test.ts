import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { IngestionEvent } from "../../types";

import { scan } from "./scan";

const SESSION_A = "0a599564-6dba-4fe7-8b56-7edf510dc670";
const SESSION_B = "11111111-2222-3333-4444-555555555555";

async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "ai-chat-viewer-scan-test-"));
}

async function writeJsonl(
  root: string,
  encodedCwd: string,
  filename: string,
  lines: object[],
): Promise<string> {
  const projectDir = join(root, encodedCwd);
  await mkdir(projectDir, { recursive: true });
  const filePath = join(projectDir, filename);
  const body = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  await writeFile(filePath, body, "utf8");
  return filePath;
}

async function collect(
  iter: AsyncGenerator<IngestionEvent>,
): Promise<IngestionEvent[]> {
  const out: IngestionEvent[] = [];
  for await (const e of iter) out.push(e);
  return out;
}

const realAttachment = {
  parentUuid: null,
  isSidechain: false,
  attachment: { type: "hook_success", content: "ok" },
  type: "attachment",
  uuid: "att-1",
  timestamp: "2026-04-13T11:51:58.791Z",
  userType: "external",
  entrypoint: "cli",
  cwd: "/Users/jacobzha",
  sessionId: SESSION_A,
  version: "2.1.104",
  gitBranch: "HEAD",
};

const realUserLine = {
  parentUuid: "att-1",
  isSidechain: false,
  type: "user",
  uuid: "u-1",
  timestamp: "2026-04-13T11:52:00.000Z",
  cwd: "/Users/jacobzha",
  sessionId: SESSION_A,
  version: "2.1.104",
  gitBranch: "HEAD",
  message: { role: "user", content: "hello" },
};

const realAssistantLine = {
  parentUuid: "u-1",
  isSidechain: false,
  type: "assistant",
  uuid: "a-1",
  timestamp: "2026-04-13T11:52:01.000Z",
  cwd: "/Users/jacobzha",
  sessionId: SESSION_A,
  version: "2.1.104",
  gitBranch: "HEAD",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "hi" }],
  },
};

const realPermissionMode = {
  type: "permission-mode",
  permissionMode: "bypassPermissions",
  sessionId: SESSION_A,
};

describe("scan", () => {
  it("yields message + attachment + session-meta + session-meta-patch in physical order", async () => {
    const root = await makeRoot();
    await writeJsonl(root, "-Users-jacobzha", `${SESSION_A}.jsonl`, [
      realPermissionMode,
      realAttachment,
      realUserLine,
      realAssistantLine,
    ]);

    const events = await collect(scan(root));

    // permission-mode  → 1 patch (no cwd → no secondary session-meta)
    // attachment       → 1 attachment + 1 session-meta
    // user             → 1 message    + 1 session-meta
    // assistant        → 1 message    + 1 session-meta
    // total: 7
    const kinds = events.map((e) => e.kind);
    expect(kinds).toEqual([
      "session-meta-patch",
      "attachment",
      "session-meta",
      "message",
      "session-meta",
      "message",
      "session-meta",
    ]);
  });

  it("emits both attachment AND session-meta on a real attachment line (canonical carrier)", async () => {
    const root = await makeRoot();
    await writeJsonl(root, "-Users-jacobzha", `${SESSION_A}.jsonl`, [realAttachment]);

    const events = await collect(scan(root));
    expect(events.length).toBe(2);

    const att = events.find((e) => e.kind === "attachment");
    const meta = events.find((e) => e.kind === "session-meta");
    expect(att).toBeDefined();
    expect(meta).toBeDefined();
    if (meta?.kind !== "session-meta") throw new Error("narrow");

    expect(meta.record.cwd).toBe("/Users/jacobzha");
    expect(meta.record.gitBranch).toBe("HEAD");
    expect(meta.record.version).toBe("2.1.104");
    expect(meta.record.entrypoint).toBe("cli");
    expect(meta.record.observedAt).toBe("2026-04-13T11:51:58.791Z");
    expect(meta.record.sessionId).toBe(SESSION_A);

    // Both events share the SAME sourceOffset — they came from the same line.
    if (att?.kind !== "attachment") throw new Error("narrow");
    expect(att.sourceOffset).toBe(meta.sourceOffset);
  });

  it("computes sourceOffset = bytes-consumed-after-line (utf-8 + newline)", async () => {
    const root = await makeRoot();
    const filePath = await writeJsonl(root, "-Users-jacobzha", `${SESSION_A}.jsonl`, [
      realPermissionMode,
      realAttachment,
    ]);

    const events = await collect(scan(root));
    expect(events.length).toBeGreaterThanOrEqual(2);

    // First line is permission-mode, so emits exactly 1 event (no session-meta).
    const firstPatch = events.find((e) => e.kind === "session-meta-patch");
    expect(firstPatch).toBeDefined();
    if (firstPatch?.kind !== "session-meta-patch") throw new Error("narrow");

    const firstLineBytes = Buffer.byteLength(JSON.stringify(realPermissionMode), "utf8");
    expect(firstPatch.sourceOffset).toBe(firstLineBytes + 1);

    // Second line yields attachment + meta sharing the same offset.
    const att = events.find((e) => e.kind === "attachment");
    if (att?.kind !== "attachment") throw new Error("narrow");
    const secondLineBytes = Buffer.byteLength(JSON.stringify(realAttachment), "utf8");
    expect(att.sourceOffset).toBe(firstLineBytes + 1 + secondLineBytes + 1);

    void filePath;
  });

  it("returns empty stream for an empty rootDir", async () => {
    const root = await makeRoot();
    const events = await collect(scan(root));
    expect(events).toEqual([]);
  });

  it("ignores non-jsonl files and hidden / non-project dirs", async () => {
    const root = await makeRoot();
    // Hidden file inside an otherwise-valid project dir.
    const projectDir = join(root, "-Users-jacobzha");
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, ".DS_Store"), "junk", "utf8");
    await writeFile(join(projectDir, "notes.txt"), "{}\n", "utf8");
    // Hidden dir at root.
    await mkdir(join(root, ".hidden"), { recursive: true });
    await writeFile(
      join(root, ".hidden", "x.jsonl"),
      JSON.stringify(realAttachment) + "\n",
      "utf8",
    );

    const events = await collect(scan(root));
    expect(events).toEqual([]);
  });

  it("walks multiple project dirs and multiple sessions", async () => {
    const root = await makeRoot();
    await writeJsonl(root, "-Users-jacobzha", `${SESSION_A}.jsonl`, [realAttachment]);
    await writeJsonl(
      root,
      "-Users-jacobzha-Documents-foo",
      `${SESSION_B}.jsonl`,
      [{ ...realAttachment, sessionId: SESSION_B, uuid: "att-b", cwd: "/Users/jacobzha/Documents/foo" }],
    );

    const events = await collect(scan(root));
    const sessions = new Set(
      events.flatMap((e) => {
        if (e.kind === "message") return [e.record.sessionId];
        if (e.kind === "attachment") return [e.record.sessionId];
        if (e.kind === "session-meta") return [e.record.sessionId];
        return [e.patch.sessionId];
      }),
    );
    expect(sessions.has(SESSION_A)).toBe(true);
    expect(sessions.has(SESSION_B)).toBe(true);
  });

  it("drops malformed lines via parseLine.log without throwing", async () => {
    const root = await makeRoot();
    const projectDir = join(root, "-Users-jacobzha");
    await mkdir(projectDir, { recursive: true });
    await writeFile(
      join(projectDir, `${SESSION_A}.jsonl`),
      "this is not json\n" + JSON.stringify(realAttachment) + "\n",
      "utf8",
    );

    const drops: string[] = [];
    const events = await collect(
      scan(root, {
        log: (e) => {
          drops.push(e.reason);
        },
      }),
    );

    expect(drops).toContain("json-parse-failed");
    // The valid line still produces 2 events.
    expect(events.length).toBe(2);
  });

  it("permission-mode line yields a session-meta-patch but NO session-meta", async () => {
    const root = await makeRoot();
    await writeJsonl(root, "-Users-jacobzha", `${SESSION_A}.jsonl`, [
      realPermissionMode,
    ]);

    const events = await collect(scan(root));
    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("session-meta-patch");
  });
});
