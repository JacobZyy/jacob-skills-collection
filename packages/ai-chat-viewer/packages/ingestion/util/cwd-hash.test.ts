import { describe, expect, it } from "bun:test";
import { computeCwdHash } from "./cwd-hash";

describe("computeCwdHash", () => {
  it("returns the same hash for the same cwd", () => {
    const a = computeCwdHash("/Users/jane/work/web");
    const b = computeCwdHash("/Users/jane/work/web");
    expect(a).toBe(b);
  });

  it("returns different hashes for different cwds", () => {
    const a = computeCwdHash("/Users/jane/work/web");
    const b = computeCwdHash("/Users/jane/personal/web");
    expect(a).not.toBe(b);
  });

  it("returns a 16-character hex string", () => {
    const h = computeCwdHash("/any/path");
    expect(h).toHaveLength(16);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
  });
});
