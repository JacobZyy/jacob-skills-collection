# Vuex testing adaptation

> Load when stack profile reports `stateManagement: "vuex"` or `"both"`.

## Setup file additions

```ts
import Vue from 'vue'
import Vuex from 'vuex'

Vue.use(Vuex)
```

This registers the plugin on the global Vue. For per-test isolation, prefer `createLocalVue`:

```ts
import { createLocalVue, mount } from '@vue/test-utils'
import Vuex from 'vuex'

const localVue = createLocalVue()
localVue.use(Vuex)

const store = new Vuex.Store({
  state: { user: null },
  mutations: { setUser: (s, u) => { s.user = u } },
  actions: { fetchUser: vi.fn() }
})

mount(Component, { localVue, store })
```

## Mocking strategy

### Option A — real store with mocked actions

Use when the component reads state directly and you want to verify dispatched action shapes:

```ts
const store = new Vuex.Store({
  modules: {
    user: {
      namespaced: true,
      state: { id: '', name: '' },
      actions: { fetch: vi.fn(() => Promise.resolve({ id: '1', name: 'Alice' })) },
    }
  }
})
```

### Option B — fully mock store

Use when the component only dispatches/commits and you don't care about real state machinery:

```ts
const store = {
  state: { user: { id: '1' } },
  getters: { isLoggedIn: true },
  commit: vi.fn(),
  dispatch: vi.fn(() => Promise.resolve()),
}

mount(Component, {
  mocks: { $store: store }
})
```

`mocks: { $store }` is faster but the component cannot use `mapState` etc. — only `this.$store.xxx`. Pick A if the component uses helper functions.

## Pinia + Vuex coexistence (`stateManagement: "both"`)

Both plugins can register on the same `localVue`:

```ts
const localVue = createLocalVue()
localVue.use(VueCompositionAPI)  // if 2.6
localVue.use(PiniaVuePlugin)
localVue.use(Vuex)

mount(Component, { localVue, pinia: createPinia(), store: vuexStore })
```

For tests that touch only one of them, only install the one you need.

## Common gotchas

| Symptom | Cause | Fix |
|---------|-------|-----|
| `Cannot find module 'vuex'` in test | Vuex not installed for tests | Verify devDependencies; do not install just for tests |
| `[vuex] unknown action type: foo` | Action namespace mismatch | Match `dispatch('namespace/foo', ...)` to module's `namespaced: true` |
| Module mutations not firing in tests | Using `mocks: { $store }` (Option B) | Switch to real store (Option A) |
| Actions not awaited | Forgot `await wrapper.vm.someMethod()` | Always `await` async store interactions before assertions |

## When tests should mock at the API layer instead

If a Vuex action just wraps `@/utils/http`, mock the HTTP wrapper, not the action. Tests then exercise the real action and verify it dispatches/commits correctly given the mocked HTTP response:

```ts
vi.mock('@/utils/http', () => ({
  default: { post: vi.fn(() => Promise.resolve({ data: { id: '1' } })) }
}))
```

This gives broader coverage than action-level mocks.
