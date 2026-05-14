# CDN assets and async noise

> Load when stack profile reports `cdnDomains` non-empty OR after init you see stderr noise like `DOMException: Failed to load script ".../*.min.js"`.

## Are these errors real?

happy-dom blocks remote script/CSS loading by default. Three sources of the noise:

1. **`<img src="https://s1.zhuanstatic.com/...">`** in `.vue` templates
   → harmless. happy-dom does not fire image requests. Just DOM string. **No action needed.**

2. **Third-party SDK initialization** (`@zz-common/lego` → `PageLife.initSdk` → injects `<script>` to fetch zzapp/zzlego runtime)
   → harmless, but noisy. happy-dom rejects and writes a DOMException via its internal virtual console which Vitest forwards to stderr. **See "Accepted residual noise" below.**

3. **Code path explicitly calls `fetch(cdnUrl)`** (e.g. `src/utils/uploadImages.ts` that streams to a CDN)
   → real. The fetch will hang or fail unless mocked. **See "Real fetches" below.**

## Real fetches: mock `global.fetch`

If detect-stack reports CDN domains AND a `grep -rn "fetch(" src` finds explicit `fetch(cdnUrl)` calls, install a default global mock in `tests/unit/setup.ts`:

```ts
import { vi } from 'vitest'

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  status: 200,
  json: async () => ({}),
  text: async () => '',
  blob: async () => new Blob(),
  arrayBuffer: async () => new ArrayBuffer(0),
} as unknown as Response)
```

Per-test override:

```ts
beforeEach(() => {
  vi.mocked(fetch).mockResolvedValueOnce({
    ok: true, status: 200,
    json: async () => ({ uploadedUrl: 'https://test/x.png' }),
  } as unknown as Response)
})
```

## Accepted residual noise

After all `vi.mock` factories cover production-accessed exports completely (see `private-deps-mock-catalog.md`), some `DOMException: Failed to load script` lines may still appear. Two known sources:

### Source 1 — pnpm multi-copy bypass

pnpm hoists multiple versions of a package (e.g. `@zz-common+lego@6.4.7` and `@zz-common+lego@6.4.9` if a transitive dep needs the newer one). A consumer can `require('./internal-module')` against its private copy via a relative path that Vitest's `vi.mock('@zz-common/lego', ...)` cannot intercept.

### Source 2 — SDK internal timers

`@zz-common/native-adapter` schedules a `setTimeout` during `BaseAdapter` construction that calls `waitJsLoaded`. Even when the package is mocked, the side-effect copy may keep running in parallel paths.

### What does NOT work (verified failures)

| Approach | Why it fails |
|----------|--------------|
| Monkey-patching `HTMLScriptElement.prototype.src` setter | happy-dom uses a private `#loadScript` that bypasses the setter |
| `environmentOptions.happyDOM.settings.handleDisabledFileLoadingAsSuccess: true` | Dispatches a `load` event that drives the SDK into code paths happy-dom doesn't support — produces NEW Error entries |
| `test.onConsoleLog` filter | Writes come from happy-dom's internal virtual console, not the test runner's console capture |
| `vi.mock('@zz-common/lego/lib/lego-pagelife', ...)` | Transitive code uses `require('./lego-pagelife')` (relative); never goes through Vitest's resolver |

### What DOES work (at a cost)

```ts
// vitest.config.mts
export default defineConfig({
  test: {
    server: {
      deps: {
        inline: [
          '@zz-common/lego',
          '@zz-common/native-adapter',
          '@zz-common/sentry',
        ],
      },
    },
  },
})
```

This forces Vitest to inline-bundle the listed packages into the worker, after which `vi.mock` covers them across all import paths. Cost: ~hundreds of ms per test file in cold start. Decide whether the noise reduction warrants it.

## Decision matrix

| Situation | Action |
|-----------|--------|
| `cdnDomains` empty, no `fetch(cdnUrl)` calls | Do nothing |
| `cdnDomains` non-empty but only in templates/CSS strings | Do nothing |
| `fetch(cdnUrl)` calls exist | Install `global.fetch` mock in setup.ts |
| Residual `DOMException` noise after complete mocks | Accept it OR enable `server.deps.inline` |
| Tests timeout because real fetch hangs | Mandatory `global.fetch` mock |
