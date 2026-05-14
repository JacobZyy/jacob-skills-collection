# Class-based Vue 2 components

> Load when stack profile reports `syntaxStyles.classComponent > 0`.

## Detection patterns

The detect-stack script flags class components when it sees:
- `@Component` decorator (from `vue-class-component` or `vue-property-decorator`)
- `extends Vue` class syntax

Either pattern requires decorator support in the test pipeline.

## Required `vitest.config.mts` change

Class components in Vue 2 use TC39 stage-2 decorators. Vitest's esbuild does not handle stage-2 decorators directly. Two options:

### Option A — Babel pipeline (recommended for class-heavy projects)

```bash
pnpm add -D @babel/preset-env @babel/preset-typescript \
            @babel/plugin-proposal-decorators \
            @babel/plugin-proposal-class-properties
```

Add to `vitest.config.mts`:

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue2'

export default defineConfig({
  plugins: [
    vue({
      babel: {
        babelrc: false,
        configFile: false,
        presets: [
          ['@babel/preset-env', { targets: { node: 'current' } }],
          '@babel/preset-typescript',
        ],
        plugins: [
          ['@babel/plugin-proposal-decorators', { legacy: true }],
          ['@babel/plugin-proposal-class-properties', { loose: true }],
        ],
      },
    }),
  ],
  test: { /* ... */ },
})
```

`legacy: true` matches the TC39 stage-1 / "legacy" decorator semantics that `vue-property-decorator` was built on. Strict stage-2 / stage-3 decorators are NOT compatible.

### Option B — TypeScript compiler path

If the project already compiles class decorators via `tsc` with `experimentalDecorators: true`, you can let vitest use `vite-tsconfig-paths` + a `swc`-based transformer. Avoid this if Option A works — the Babel approach is more battle-tested with `vue-class-component`.

## `tsconfig.json` requirements

```json
{
  "compilerOptions": {
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true
  }
}
```

These are read by the IDE / type-check pipeline; the runtime transform happens via Babel above.

## Testing class components

```ts
// src/components/Counter.vue
<script lang="ts">
import { Component, Vue, Prop } from 'vue-property-decorator'

@Component
export default class Counter extends Vue {
  @Prop({ default: 0 }) initial!: number
  count = this.initial
  increment() { this.count += 1 }
}
</script>
<template>
  <button @click="increment">{{ count }}</button>
</template>
```

Test:

```ts
import { mount } from '@vue/test-utils'
import Counter from '@/components/Counter.vue'

it('increments on click', async () => {
  const wrapper = mount(Counter, { propsData: { initial: 5 } })
  await wrapper.find('button').trigger('click')
  expect(wrapper.text()).toBe('6')
})
```

`wrapper.vm.count` is accessible because class component instance methods bind to the Vue instance as usual.

## Mixins on class components

`vue-class-component`'s `Mixins(MixinA, MixinB)` works under the same Babel config — no additional plugin needed. Both base mixin classes and the consuming class go through the decorator transform together.

## Common errors and fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `Unexpected token (after @)` | Decorator transform not applied | Add `@babel/plugin-proposal-decorators` |
| `Cannot assign to read only property` for class field | Class fields without `loose: true` | Set `{ loose: true }` on plugin-proposal-class-properties |
| `@Prop` value is undefined at test time | Reading `this.foo` outside class body | Decorator usage is correct only inside the class — confirm the Prop is declared inside @Component class |
| `Mixins is not a constructor` | Missing decorator import | `import { Mixins } from 'vue-class-component'` |

## When to skip this reference

`syntaxStyles.classComponent === 0` — main-line config is enough, no decorator support needed.
