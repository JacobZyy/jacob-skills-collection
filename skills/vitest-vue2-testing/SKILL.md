---
name: vitest-vue2-testing
description: Vitest (NOT Jest) + Vue 2.7 + TS + Pinia unit-testing conventions for this project — covers global mocks, four test templates (api/store/component/utils), happy-dom quirks, and noise diagnosis. Triggers on keywords like vitest, unit test, vue 2 test, mock zz-ui, mock lottie, DOMException happy-dom.
---

# Vitest + Vue 2.7 Unit Testing (this project)

> This guide is for **Vitest, not Jest.** Do not port `jest.fn()` / `jest.mock()` / `jest.config.js` patterns here.

> **Prerequisite skill** — if the project has NO `vitest.config.*` yet, stop here and run `vitest-vue2-init` first to bootstrap the framework. This skill assumes the framework is already in place.

## Stack reference

| Dimension | Version |
|-----------|---------|
| Vue | 2.7.8 (npm alias → vue@2.7.8) |
| TypeScript | 6.0.3 (Babel-transpiled) |
| Vitest | 4.1.6 |
| `@vitejs/plugin-vue2` | 2.3.4 |
| `@vue/test-utils` | 1.x (Vue 2 line) |
| happy-dom | 20.9.0 |
| Pinia | 2.0.22 + PiniaVuePlugin |

Commands:

```bash
pnpm test           # run unit tests
pnpm test:ui        # vitest UI
pnpm test:coverage  # needs @vitest/coverage-v8
```

## `vitest.config.mts` shape

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue2'

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } },
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.{test,spec}.{ts,tsx,js,jsx}'],
    setupFiles: ['./tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.{ts,js,vue}'],
      exclude: ['src/**/*.d.ts', 'src/main.ts', 'src/App.vue'],
    },
  },
})
```

Key points:
- Use `@vitejs/plugin-vue2` — **not** `@vitejs/plugin-vue` (that one is for Vue 3)
- `happy-dom` is lightweight; it does **not** make real network requests
- `v8` coverage provider needs no Babel and is faster

## Global mocks live in `setup.ts`

**All `@zz-*` private dependencies are mocked once in `tests/unit/setup.ts`. Test files must not redeclare them unless they specifically need to override behavior.**

The four mock files in `mocks/` are the source of truth:
- `mocks/zz-ui.ts.txt`
- `mocks/native-adapter.ts.txt`
- `mocks/lego.ts.txt`
- `mocks/zz-utils.ts.txt`

Minimal `setup.ts` skeleton:

```ts
import { vi } from 'vitest'
import Vue from 'vue'

vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      destroy: vi.fn(), play: vi.fn(), stop: vi.fn(), pause: vi.fn(),
      goToAndPlay: vi.fn(), goToAndStop: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })),
  },
}))

vi.mock('@zz-common/zz-ui', async () => await import('./../__mocks__/zz-ui'))
vi.mock('@zz-common/native-adapter', async () => await import('./../__mocks__/native-adapter'))
vi.mock('@zz-common/lego', async () => await import('./../__mocks__/lego'))
vi.mock('@zz-common/zz-utils', async () => await import('./../__mocks__/zz-utils'))

Vue.prototype.$setPicSize = (url: string, _size?: number) => url
```

**Mock factories must cover every named export production code actually accesses** — see `references/mock-patterns.md` for the minimum-complete checklist for each `@zz-common/*` package, the `Vue.extend()` shared-options pitfall, and an empirically silenced minimum mock for `@zz/fetch`.

## HTTP layer rule

| Do not mock | Mock instead |
|---|---|
| ❌ `@zz/fetch` (transport) — globally neutralized in `setup.ts`; do not repeat per-test | ✅ `@/utils/http` per-test (the business wrapper) |

```ts
vi.mock('@/utils/http', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}))
```

## Test templates

Four target types, four templates. See `references/templates-overview.md` for which to pick.

| Target | Template |
|--------|----------|
| API | `templates/api.template.ts.txt` |
| Pinia store | `templates/store.template.ts.txt` |
| Vue component | `templates/component.template.ts.txt` |
| Utility | `templates/utils.template.ts.txt` |

## CDN assets

happy-dom does not fire real image requests. `<img src="https://s1.zhuanstatic.com/...">` is just DOM string content in the test environment — no setup needed.

Exception: if the code under test calls `fetch(cdnUrl)` directly (e.g. `uploadImages.ts`), mock `global.fetch` in `beforeEach`:

```ts
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true, status: 200,
    json: async () => ({ data: 'mock' }),
    text: async () => 'mock',
    blob: async () => new Blob(),
  } as unknown as Response)
})
```

## Mock data strategy for API contracts

| Situation | Strategy |
|-----------|----------|
| API ready + TS types exist | Construct from the types directly |
| API ready + no TS types | Placeholder + a top-of-file `// TODO: confirm fields with PM/backend` |
| API not ready | Minimal reasonable shape + `// @todo backfill once API is ready` |
| Per-developer local mock files (gitignored) | Not used in this project |

## Don't list

| Anti-pattern | Reason |
|--------------|--------|
| ❌ Re-declaring `vi.mock('@zz-common/zz-ui')` in every test | Belongs in `setup.ts` |
| ❌ `vi.mock('@zz/fetch')` per-test | Already globally neutralized; production uses `@/utils/http` |
| ❌ Hand-rolled canvas mock to work around lottie | Just `vi.mock('lottie-web')` |
| ❌ Placeholder tests like `expect(Comp).toBeDefined()` | No value; write real mount + assertions |
| ❌ `jest.fn()` / `jest.mock()` | This is Vitest — use `vi.fn()` / `vi.mock()` |
| ❌ `import ... from '@vue/test-utils-next'` | Vue 2 uses `@vue/test-utils` 1.x |
| ❌ `createApp()` / Vue 3 Pinia install | Use `createLocalVue().use(PiniaVuePlugin)` |
| ❌ `vi.mock('@zz-common/lego', () => ({}))` and similar empty overrides | Full override, not merge — wipes the global mock. See `references/troubleshooting.md` |
| ❌ Reusing a shared `Vue.extend(options)` reference | `Vue.extend` mutates `options.props` — see `references/mock-patterns.md` |
| ❌ `handleDisabledFileLoadingAsSuccess: true` to silence noise | Creates new Error entries — see `references/troubleshooting.md` |
| ❌ Patching `HTMLScriptElement.prototype.src` setter | happy-dom uses a private `#loadScript` that bypasses it |

## When to invoke this skill

- Before adding a `tests/unit/**/*.test.ts` file
- Before editing `vitest.config.mts` or `tests/unit/setup.ts`
- When you see `Cannot find module '@zz-common/...'` style mock errors
- When tests report `document is not defined` / `window is not defined`
- When you see `loadAnimation is not a function` (lottie)
- When logs repeatedly emit `DOMException: Failed to load script ".../index.min.js"`, `PageLife.initSdk`, `fetchUrlDomainWhiteList`, `waitJsLoaded` — read `references/troubleshooting.md`
- When you see `No "XXX" export is defined on the "@zz-common/..." mock` — read `references/mock-patterns.md`
- When you see `props is not iterable` (Vue.extend stub sharing options) — read `references/mock-patterns.md`
- Before writing a unit test for a Pinia store or Vue component
- Before opening a PR — sanity-check the test quality

## Five-minute new-component-test checklist

- [ ] Mirror the source path: `src/views/foo/Bar.vue` → `tests/unit/views/foo/Bar.test.ts`
- [ ] Copy `templates/component.template.ts.txt` and rename
- [ ] Mock business APIs: `vi.mock('@/api/foo', () => ({ getBar: vi.fn() }))`
- [ ] Prepare props / store initial data
- [ ] `mount` + assert relevant DOM / emits / method calls
- [ ] Run `pnpm test path/to/your.test.ts` and make sure it passes
- [ ] Strip any `console.log` and commit

## References

| File | When to load |
|------|--------------|
| `references/mock-patterns.md` | Authoring or auditing `setup.ts`; noise points to incomplete mocks |
| `references/troubleshooting.md` | Per-test `vi.mock` overrides causing confusion; residual stderr noise after `setup.ts` looks complete |
| `references/templates-overview.md` | Deciding which test template to start from |
| `mocks/*.ts.txt` | Paste-ready reference mock files |
| `templates/*.template.ts.txt` | Paste-ready test scaffolds |

## Known-good and known-bad examples in this project

Good:
- API: `tests/unit/api/nlabSkuSelect.test.ts`
- Store: `tests/unit/views/newStandard/directSaleHome/components/directSaleFlowBanner/flowDataStore.test.ts`
- Component: `tests/unit/views/newStandard/directSaleHome/components/directSaleFlowBanner/index.test.ts`

Placeholder tests that should be rewritten with real assertions:
- `tests/unit/App.test.ts` (mount only, no assertions)
- `tests/unit/views/newStandard/directSaleHome/components/SaleHeader.test.ts` (only `expect(defined)`)
