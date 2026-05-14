# Test Template Overview

> Load this when authoring a new test and you want to know which template to start from. The actual paste-ready code lives next to this file in `../templates/`.

## Four templates, by target type

| Target type | Template file | Key pattern |
|-------------|---------------|-------------|
| API module | `templates/api.template.ts.txt` | `vi.mock('@/utils/http')` then assert request shape on the mock |
| Pinia store | `templates/store.template.ts.txt` | `setActivePinia(createPinia())` in `beforeEach`; call actions; assert state |
| Vue component | `templates/component.template.ts.txt` | `createLocalVue().use(PiniaVuePlugin)` + `mount(Component, { localVue, pinia, props })` |
| Pure utility | `templates/utils.template.ts.txt` | Direct import + call; no environment setup needed |

## Choosing the right one

- **Does the target make HTTP calls?** → Start from `api.template.ts.txt`. Mock `@/utils/http`, not `@zz/fetch` (the per-test mock — `@zz/fetch` is already globally mocked in `setup.ts`).
- **Is the target a `defineStore(...)`?** → Start from `store.template.ts.txt`. Activate Pinia in `beforeEach` so each test gets a fresh store.
- **Is the target a `.vue` file?** → Start from `component.template.ts.txt`. Decide whether the component needs Pinia; if not, skip the `localVue.use(PiniaVuePlugin)` line.
- **Is the target a function that takes inputs and returns outputs without touching globals?** → Use `utils.template.ts.txt`. The simplest case.

## Placeholder smoke tests are an anti-pattern

Avoid:

```ts
it('is imported successfully', async () => {
  const m = await import('@/components/Foo.vue')
  expect(m).toBeDefined()
})
```

These tests verify nothing meaningful. Replace with real `mount` + assertions on rendered DOM, emitted events, or method calls.

The one exception: a whole-page component whose dependency graph (Pinia stores, child components, async data) is too expensive to wire up. In that case, an import-only smoke test guards against the module failing to load — but should carry a TODO note for the proper test once the dependencies are isolated.

## File path convention

Test path must mirror the source path:

```
src/views/foo/Bar.vue
→ tests/unit/views/foo/Bar.test.ts

src/store/userType.ts
→ tests/unit/store/userType.test.ts

src/api/publish.ts
→ tests/unit/api/publish.test.ts
```

## Existing good examples in this project

- API: `tests/unit/api/nlabSkuSelect.test.ts`
- Store: `tests/unit/views/newStandard/directSaleHome/components/directSaleFlowBanner/flowDataStore.test.ts`
- Component: `tests/unit/views/newStandard/directSaleHome/components/directSaleFlowBanner/index.test.ts`

## Per-test mock conventions

- **Do** mock `@/api/*` per test — control the response shape your test needs
- **Do** mock `@/utils/http` if the target uses it directly
- **Do NOT** mock `@zz-common/*` packages per test unless overriding global behavior — see `troubleshooting.md` §"Global vs. per-test mock precedence" for the precedence trap
- **Do NOT** mock `@zz/fetch` per test — it is globally mocked in `setup.ts`
