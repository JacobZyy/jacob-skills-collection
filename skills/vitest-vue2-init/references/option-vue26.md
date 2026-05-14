# Vue 2.6 + `@vue/composition-api` adaptation

> Load when stack profile reports `vueMajorMinor: "2.6"` AND/OR `hasCompositionApi: true` on a 2.6 project.

## Why this needs special handling

`@vitejs/plugin-vue2` targets Vue 2.7 by default. Vue 2.6 projects that use Composition API rely on the standalone `@vue/composition-api` plugin which must be registered explicitly. Without registration, `ref` / `reactive` / `computed` throw at module load.

## Required changes vs. main-line config

### 1. Install verification

```bash
node -e "console.log(require('./package.json').devDependencies['@vue/composition-api'] || require('./package.json').dependencies['@vue/composition-api'])"
```

If `@vue/composition-api` is missing on a 2.6 project but `ref` / `setup()` usage is detected, that is a project bug, not a test bug — flag it and stop.

### 2. `tests/unit/setup.ts` additions

```ts
import Vue from 'vue'
import VueCompositionAPI from '@vue/composition-api'

// MUST run before any test imports a module that uses ref/reactive
Vue.use(VueCompositionAPI)
```

Place this **before** any `vi.mock` calls so the plugin is registered first.

### 3. Pinia on Vue 2.6

Pinia 2.x supports Vue 2 only through `PiniaVuePlugin`, and on 2.6 it additionally requires `@vue/composition-api` to be active:

```ts
import { createPinia, PiniaVuePlugin } from 'pinia'

Vue.use(VueCompositionAPI) // first
Vue.use(PiniaVuePlugin)    // then
```

In each test using a store:

```ts
import { createLocalVue, mount } from '@vue/test-utils'
import { createPinia, PiniaVuePlugin, setActivePinia } from 'pinia'

const localVue = createLocalVue()
localVue.use(VueCompositionAPI)
localVue.use(PiniaVuePlugin)

const pinia = createPinia()
setActivePinia(pinia)

mount(Component, { localVue, pinia })
```

### 4. `vitest.config.mts` — no plugin change needed

`@vitejs/plugin-vue2` does compile 2.6 SFCs correctly. The runtime difference is purely about API registration in `setup.ts`.

## Cross-file mixed style (allowed by user contract)

When the project has files that use only Options API and other files that use Composition API, both work side-by-side as long as `@vue/composition-api` is registered. The plugin is idempotent and never harms Options-API-only code.

## Common failure modes and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `ref is not a function` | `@vue/composition-api` not registered | Add `Vue.use(VueCompositionAPI)` in setup.ts |
| `getCurrentInstance returns null` | calling Composition API outside `setup()` | Project bug; not a test config issue |
| `Cannot read 'install' of undefined` for pinia | PiniaVuePlugin registered before Composition API | Reorder: composition-api FIRST, then PiniaVuePlugin |

## When to skip this reference

- `vueMajorMinor === "2.7"` — no plugin needed, 2.7 has Composition API built in
- `vueMajorMinor === "2.6"` AND `hasCompositionApi === false` AND `syntaxStyles.scriptSetup === 0` AND `syntaxStyles.defineComponent === 0` — pure Options API project, skip entirely
