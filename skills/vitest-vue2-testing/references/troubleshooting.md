# Troubleshooting

> Load this when a test suite already mocks the obvious surface area in `setup.ts` but still produces noise — or when deciding whether to keep iterating vs. accept the residual.

## Global vs. per-test mock precedence

**A `vi.mock(...)` written inside a test file completely replaces — not merges with — the same-name mock in `setup.ts`.**

The most common trap: an author wants to tweak one method's default behavior and writes either

```ts
vi.mock('@zz-common/lego', () => ({}))
vi.mock('@zz-common/lego', () => ({ legoInit: { setUserBackup: vi.fn() } }))
```

This wipes out the named exports the production code accesses (`lego`, `legoPerf`, `pageId`, ...). Vitest then falls back to the real package for those names and runs its top-level side effects.

### Three correct options

**Option 1 — Delete the per-test mock** if the global default is already correct:

```ts
// (just remove the per-file vi.mock call)
```

**Option 2 — Repeat the full mock** if you genuinely need to override, then change only what you need:

```ts
vi.mock('@zz-common/native-adapter', () => ({
  default: {
    isLogin: vi.fn(() => true), // this test needs "logged in"
    close: vi.fn(),
    skipToUrl: vi.fn(),
    getClient: vi.fn(() => 'zhuanzhuan'),
    in: vi.fn(() => false),
  },
  isLogin: vi.fn(() => true),
  close: vi.fn(),
  skipToUrl: vi.fn(),
  getClient: vi.fn(() => 'zhuanzhuan'),
  in: vi.fn(() => false),
}))
```

**Option 3 — Tweak the `vi.fn` returned by the global mock** (preferred when only one method differs):

```ts
import native from '@zz-common/native-adapter'

beforeEach(() => {
  vi.mocked(native.isLogin).mockReturnValue(true)
})
```

## Accepted residual noise

After `setup.ts` covers every named export the source tree actually accesses, you may still see 1–2 lines like:

```
DOMException [NotSupportedError]: Failed to load script ".../lego-pagelife/index.js"
```

**This is benign. Accept it.**

### Why it persists

pnpm hoists multiple lego copies (e.g. `@zz-common+lego@6.4.7` for direct usage, `@zz-common+lego@6.4.9` for sentry's transitive dependency). A transitive consumer can `require('./internal-module')` against its private copy via a relative path that never goes through Vitest's module-id resolver, so `vi.mock('@zz-common/lego', ...)` cannot intercept it.

### Impact

- Pure stderr lines
- Exit code 0
- Assertions unaffected
- CI does not flag it

### Approaches that DO NOT work

Each of these was tried and either failed or made things worse:

| Approach | Why it fails |
|----------|--------------|
| Monkey-patch `HTMLScriptElement.prototype.src` setter | happy-dom uses a private `#loadScript` method that bypasses the public setter |
| `environmentOptions.happyDOM.settings.handleDisabledFileLoadingAsSuccess: true` | Forces a `load` event to dispatch, which then sends the SDK down a code path happy-dom doesn't support — adds 8+ new Error entries |
| `test.onConsoleLog` | The stderr writes come from happy-dom's internal virtual console, not from the test runner's console capture |
| `vi.mock('@zz-common/lego/lib/lego-pagelife', ...)` | Transitive code does `require('./lego-pagelife')` from inside the package — a relative path that never sees Vitest's resolver |

### The one option that does work (but costs startup time)

In `vitest.config.mts`:

```ts
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

This forces Vitest to inline-bundle the listed packages into the worker, after which `vi.mock` covers them across all import paths. The cost is a few hundred milliseconds of cold-start time per test file. Evaluate whether the noise warrants it for your project.

## Decision tree when investigating new noise

1. **Does the message name a missing named export?** (`No "XXX" export is defined on the "@zz-common/..." mock`) → add the export to `setup.ts`. See `mock-patterns.md` §"Minimum-complete mock checklist".

2. **Does the stack trace go into `node_modules/.pnpm/.../lego-pagelife` or `.../BaseAdapter`?** → some named import in production code is not in your mock. Run the grep in `mock-patterns.md` §"Collecting the symbols production code uses".

3. **Does a single test file produce noise when run alone but not in the full suite (or vice versa)?** → look for `vi.mock` overrides inside that test file that wipe the global mock. See §"Global vs. per-test mock precedence" above.

4. **Did you patch the `setup.ts` mocks and noise still persists in exactly the same form?** → likely the transitive-copy issue described in §"Accepted residual noise". Decide whether to enable `server.deps.inline` or accept it.
