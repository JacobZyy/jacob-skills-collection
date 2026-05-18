// Type-level test: confirm a minimal claude-code-shaped stub satisfies the
// IngestionAdapter contract.
//
// This file is purely for compile-time verification — `tsc --noEmit` is the
// pass condition. There is no runtime test here because the contract is
// structural and lives entirely in the type system.
//
// When the real adapter lands (#20 / T18), it should be assignable to
// IngestionAdapter the same way this stub is. If a future change to
// IngestionAdapter breaks the real adapter, this stub will break too and
// surface the regression in CI before #20's own typecheck.

import { describe, expect, it } from "bun:test";
import type {
  IngestionAdapter,
  IngestionEvent,
  SessionMeta,
  TailCursor,
} from "../types";

const stub: IngestionAdapter = {
  tool: "claude-code",
  detectRoot: () => "/some/abs/path",
  async *scan(_rootDir: string): AsyncIterable<IngestionEvent> {
    // empty generator
  },
  async *tail(_filePath: string, _fromOffset: TailCursor): AsyncIterable<IngestionEvent> {
    // empty generator
  },
};

describe("IngestionAdapter contract", () => {
  it("a minimal stub assigns to the interface", () => {
    expect(stub.tool).toBe("claude-code");
  });

  it("scan and tail return AsyncIterables", async () => {
    // Drain both — proves the runtime shape matches the type-level signature.
    const scanned: IngestionEvent[] = [];
    for await (const ev of stub.scan("/some/abs/path")) scanned.push(ev);
    const tailed: IngestionEvent[] = [];
    for await (const ev of stub.tail("/some/abs/path/x.jsonl", 0)) tailed.push(ev);
    expect(scanned).toEqual([]);
    expect(tailed).toEqual([]);
  });

  it("SessionMeta has the documented shape", () => {
    const meta: SessionMeta = {
      tool: "claude-code",
      sessionId: "00000000-0000-0000-0000-000000000000",
      cwd: "/Users/x/project",
      gitBranch: "main",
      version: "2.1.116",
      entrypoint: "cli",
      observedAt: "2026-04-24T18:57:15.292Z",
    };
    expect(meta.tool).toBe("claude-code");
  });
});
