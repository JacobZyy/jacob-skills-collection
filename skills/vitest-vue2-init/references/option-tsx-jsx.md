# TSX / JSX support for Vue 2

> Load when stack profile reports `syntaxStyles.tsx > 0`.

## Why default config breaks

`@vitejs/plugin-vue2` handles `.vue` SFCs only. Vue 2's JSX syntax (`h` function injection, `v-model`/`v-on` shortcuts, slots-as-children) is NOT understood by vanilla esbuild/Babel. Without the JSX plugin:
- `<MyComponent v-model={value} />` throws — Vue 2 JSX `v-model` is plugin-only sugar
- Functional component `(h, ctx) => h('div', ctx.children)` may resolve but emit incorrect VNodes
- Refs via `ref="foo"` in JSX won't be picked up

## Required `vitest.config.mts` change

Install `@vitejs/plugin-vue2-jsx` (peer of `@vitejs/plugin-vue2`):

```bash
pnpm add -D @vitejs/plugin-vue2-jsx
```

Add it to plugins in `vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue2'
import vueJsx from '@vitejs/plugin-vue2-jsx'

export default defineConfig({
  plugins: [vue(), vueJsx()],
  // ... rest
})
```

Order does not matter; both plugins coordinate. The JSX plugin only affects `.tsx`/`.jsx` files plus JSX blocks inside `<script lang="jsx">` / `<script lang="tsx">`.

## TypeScript JSX configuration

If `tsconfig.json` doesn't already configure JSX, add:

```json
{
  "compilerOptions": {
    "jsx": "preserve",
    "jsxFactory": "h",
    "jsxFragmentFactory": "Fragment"
  }
}
```

`jsx: "preserve"` lets the Babel plugin handle the actual transformation — the TS compiler just keeps JSX as-is for the plugin to process.

## Testing TSX components

A TSX component file:

```tsx
// src/components/Greet.tsx
import Vue from 'vue'

export default Vue.extend({
  props: { name: { type: String, required: true } },
  render() {
    return <div class="greet">Hello {this.name}</div>
  }
})
```

Test:

```ts
// tests/unit/components/Greet.test.ts
import { mount } from '@vue/test-utils'
import Greet from '@/components/Greet'

it('renders the name prop', () => {
  const wrapper = mount(Greet, { propsData: { name: 'Alice' } })
  expect(wrapper.text()).toContain('Hello Alice')
})
```

No `.tsx` extension in import — TS resolves it automatically.

## Mixed templates calling TSX children

If a `.vue` file imports a `.tsx` component, the JSX plugin still kicks in for the `.tsx` side and the `.vue` side is handled by `@vitejs/plugin-vue2`. They cooperate without extra config.

```vue
<!-- src/views/Parent.vue -->
<template>
  <div>
    <Greet name="Alice" />
  </div>
</template>
<script>
import Greet from '@/components/Greet'  // .tsx
export default { components: { Greet } }
</script>
```

This pattern works under the dual-plugin setup with no additional changes.

## Common errors and fixes

| Error | Likely cause | Fix |
|-------|--------------|-----|
| `Unexpected token <` in TSX file | `@vitejs/plugin-vue2-jsx` missing | Install and add to plugins[] |
| `h is not defined` in render() | Vue 2 `h` not auto-injected | The plugin auto-injects; if disabled, manually import `import { h } from 'vue'` or use functional `render(h) {}` signature |
| `Cannot find name 'JSX'` in TS | Missing JSX types | Add `import 'vue/types/jsx'` once, or extend tsconfig types |
| Component renders but no event handlers fire | `vOn:` syntax misused | In Vue 2 JSX use `vOn:click={fn}` or `{...{ on: { click: fn }}}` for namespaced events |

## When to skip this reference

`syntaxStyles.tsx === 0` AND no plans to add TSX — main-line config is enough.
