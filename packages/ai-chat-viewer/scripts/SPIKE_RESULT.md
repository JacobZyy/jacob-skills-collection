# Spike: chokidar v4 under Bun (T03.5)

**Date:** 2026-05-11
**Runtime:** Bun 1.3.11, macOS Darwin 25.3.0
**chokidar:** 4.0.3

## One-line conclusion

chokidar v4 + Bun on darwin works reliably for ingestion when the watcher is given a **directory path** plus an `ignored` predicate — passing a glob string silently matches nothing because chokidar v4 dropped glob support.

## Decision

**KEEP chokidar v4 as the V1 file watcher.** No downgrade to Node `fs.watch` + watchman is required.

## Evidence

`bun scripts/spike-chokidar.ts` while another terminal does:

```sh
TEST=~/.claude/projects/-Users-jacobzha-Documents-workspace-jacob-open-source-ai-chat-viewer/spike-test.jsonl
echo '{"spike":"add"}' >  "$TEST"
echo '{"spike":"c","ts":1}' >> "$TEST"
echo '{"spike":"c","ts":2}' >> "$TEST"
rm -f "$TEST"
```

Captured log:

```
[spike][#1] add     .../spike-test.jsonl
[spike][#2] change  .../spike-test.jsonl
[spike][#3] change  .../spike-test.jsonl
[spike][#4] unlink  .../spike-test.jsonl
total events: 4
```

All 4 expected events fired in native-watch mode (`usePolling: false`); polling was not needed.

## Critical gotcha for the ingestion runner

chokidar v4 (released Aug 2024) **removed glob support**. `chokidar.watch("~/.claude/projects/**/*.jsonl")` returns 0 events — it does not throw, just silently watches nothing. Use this pattern instead:

```ts
chokidar.watch(rootDir, {
  ignored: (p, stats) => {
    if (stats?.isDirectory()) return false;
    return !p.endsWith(".jsonl");
  },
});
```

Document this in the ingestion runner so a future maintainer doesn't reintroduce a glob.

## Fallback (NOT taken)

If a future Bun release breaks chokidar's native watch path on darwin, the documented escape hatch is:

1. `usePolling: true` (already verified to be wired correctly in the spike — same API surface)
2. Switch to Node `fs.watch(dir, { recursive: true })` directly (Bun supports recursive on darwin)
3. Watchman as last resort (extra OS-level dependency — avoid)
