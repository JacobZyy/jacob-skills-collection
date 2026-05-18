import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildDatabaseUrl,
  ensureDbDir,
  injectDatabaseUrl,
  resolveDbPath,
} from "../db/path";

describe("resolveDbPath", () => {
  it("returns the apple Application Support DB path under a custom home", () => {
    const home = "/tmp/fake-home";
    expect(resolveDbPath({ home })).toBe(
      "/tmp/fake-home/Library/Application Support/ai-chat-viewer/db.sqlite"
    );
  });

  it("preserves spaces in the path (caller is responsible for URL-encoding)", () => {
    const home = "/Users/jane doe";
    const p = resolveDbPath({ home });
    expect(p).toContain(" ");
    expect(p).toContain("Application Support");
  });

  it("falls back to homedir() when no home override is provided", () => {
    const p = resolveDbPath();
    expect(p.endsWith("/Library/Application Support/ai-chat-viewer/db.sqlite")).toBe(true);
  });
});

describe("buildDatabaseUrl", () => {
  it("encodes spaces as %20", () => {
    const url = buildDatabaseUrl("/Users/jane/Library/Application Support/ai-chat-viewer/db.sqlite");
    expect(url).toBe(
      "file:/Users/jane/Library/Application%20Support/ai-chat-viewer/db.sqlite"
    );
  });

  it("preserves slashes and colons (encodeURI does not touch them)", () => {
    const url = buildDatabaseUrl("/a/b/c.sqlite");
    expect(url).toBe("file:/a/b/c.sqlite");
  });

  it("encodes other reserved characters that may appear in localized home dirs", () => {
    const url = buildDatabaseUrl("/Users/José/Library/Application Support/ai-chat-viewer/db.sqlite");
    expect(url).toContain("%20");
    expect(url).toContain("Jos%C3%A9");
  });
});

describe("ensureDbDir", () => {
  it("creates the parent directory recursively", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ai-chat-viewer-test-"));
    const dbPath = join(tmp, "Library", "Application Support", "ai-chat-viewer", "db.sqlite");
    try {
      ensureDbDir(dbPath);
      const parent = join(tmp, "Library", "Application Support", "ai-chat-viewer");
      expect(existsSync(parent)).toBe(true);
      expect(statSync(parent).isDirectory()).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("is idempotent (calling twice does not throw)", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ai-chat-viewer-test-"));
    const dbPath = join(tmp, "deep", "nested", "db.sqlite");
    try {
      ensureDbDir(dbPath);
      ensureDbDir(dbPath);
      expect(existsSync(join(tmp, "deep", "nested"))).toBe(true);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("injectDatabaseUrl", () => {
  it("sets process.env.DATABASE_URL to the encoded file URL and returns the absolute path", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ai-chat-viewer-test-"));
    const previous = process.env["DATABASE_URL"];
    try {
      const dbPath = injectDatabaseUrl({ home: tmp });
      expect(dbPath).toBe(
        join(tmp, "Library", "Application Support", "ai-chat-viewer", "db.sqlite")
      );
      const url = process.env["DATABASE_URL"];
      expect(url).toBeDefined();
      expect(url).toContain("file:");
      expect(url).toContain("Application%20Support");
      const parent = join(tmp, "Library", "Application Support", "ai-chat-viewer");
      expect(existsSync(parent)).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env["DATABASE_URL"];
      } else {
        process.env["DATABASE_URL"] = previous;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
