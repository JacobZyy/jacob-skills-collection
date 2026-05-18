import { describe, expect, it } from "bun:test";
import { decodeCwd } from "./decode-cwd";

// IMPORTANT: claude-code's encoded-cwd scheme is LOSSY. It encodes
// '/path/to/dir' as '-path-to-dir' AND additionally replaces the leading
// '.' of dot-prefixed segments with '-' (so '/Users/x/.cc-switch' becomes
// '-Users-x--cc-switch'). On decode, a single '-' is indistinguishable
// between a path separator and a literal hyphen inside an original
// directory name. The decoder below picks a single deterministic
// interpretation: every '-' is a separator, and '--' marks a
// dot-prefixed next segment. Callers who need the *exact* original cwd
// MUST read the explicit `cwd` field present on every JSONL line. This
// helper is for the project-listing fallback path only.

describe("decodeCwd", () => {
  it("decodes a basic absolute path with no dots or hyphens in segments", () => {
    expect(decodeCwd("-Users-jacobzha-Documents-foo")).toBe(
      "/Users/jacobzha/Documents/foo",
    );
  });

  it("decodes a homebrew-cask style path with leading absolute root", () => {
    expect(decodeCwd("-opt-homebrew-Caskroom-google-chrome")).toBe(
      "/opt/homebrew/Caskroom/google/chrome",
    );
  });

  it("recognises a dot-prefix marker ('--') and decodes it as a '.'-led segment", () => {
    // '/Users/x/.config' encodes to '-Users-x--config'. Segment is
    // hyphen-free, so the round-trip is exact.
    expect(decodeCwd("-Users-x--config")).toBe("/Users/x/.config");
  });

  it("decodes a dot-prefix marker even when followed by hyphen-containing input (lossy: hyphen becomes separator)", () => {
    // Real folder: '-Users-jacobzha--cc-switch' was written by claude-code
    // for cwd '/Users/jacobzha/.cc-switch'. The decoder cannot recover the
    // intra-segment hyphen and emits '/Users/jacobzha/.cc/switch'. This is
    // the documented lossy behavior; downstream code that needs the exact
    // cwd reads the JSONL `cwd` field directly.
    expect(decodeCwd("-Users-jacobzha--cc-switch")).toBe(
      "/Users/jacobzha/.cc/switch",
    );
  });

  it("decodes long Documents/workspace paths (intra-segment hyphens become separators)", () => {
    expect(
      decodeCwd(
        "-Users-jacobzha-Documents-workspace-jacob-open-source-ai-chat-viewer",
      ),
    ).toBe(
      "/Users/jacobzha/Documents/workspace/jacob/open/source/ai/chat/viewer",
    );
  });

  it("returns input unchanged when it does not start with '-' or is empty", () => {
    expect(decodeCwd("already/absolute")).toBe("already/absolute");
    expect(decodeCwd("")).toBe("");
  });
});
