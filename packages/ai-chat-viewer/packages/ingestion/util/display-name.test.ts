import { describe, expect, it } from "bun:test";
import { computeDisplayNames } from "./display-name";

const names = (cwds: string[]): string[] => {
  const m = computeDisplayNames(cwds);
  return cwds.map((c) => m.get(c)!);
};

describe("computeDisplayNames", () => {
  it("returns bare basenames when no collision", () => {
    expect(names(["/x/foo", "/y/bar"])).toEqual(["foo", "bar"]);
  });

  it("escalates to parent on basename collision", () => {
    expect(names(["/x/web", "/y/web"])).toEqual(["web (x)", "web (y)"]);
  });

  it("escalates to grandparent/parent when parent also collides", () => {
    expect(names(["/a/x/web", "/b/x/web"])).toEqual([
      "web (a/x)",
      "web (b/x)",
    ]);
  });

  it("falls back to full cwd when even three-level escalation collides", () => {
    expect(names(["/a/x/x/web", "/b/x/x/web"])).toEqual([
      "/a/x/x/web",
      "/b/x/x/web",
    ]);
  });

  it("handles single project", () => {
    expect(names(["/some/path/proj"])).toEqual(["proj"]);
  });

  it("handles mixed singletons and collision groups", () => {
    expect(names(["/a/web", "/b/web", "/x/foo"])).toEqual([
      "web (a)",
      "web (b)",
      "foo",
    ]);
  });

  it("returned Map iterates in input order", () => {
    const cwds = ["/y/bar", "/x/foo", "/z/baz"];
    const m = computeDisplayNames(cwds);
    expect(Array.from(m.keys())).toEqual(cwds);
  });

  it("is deterministic across calls", () => {
    const cwds = ["/a/web", "/b/web", "/c/foo"];
    const a = computeDisplayNames(cwds);
    const b = computeDisplayNames(cwds);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
