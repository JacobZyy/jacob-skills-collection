# Mock Completeness Patterns

> Load this when authoring or auditing `tests/unit/setup.ts`, or when noise points to incomplete mocks.

## Core principle

**A `vi.mock` factory must export every named symbol the production code actually accesses. Any missing export makes Vitest fall back to the real package and execute its top-level side effects.**

Typical symptoms of an incomplete mock:
- Repeated `DOMException [NotSupportedError]: Failed to load script "https://s1.zhuanstatic.com/.../index.min.js"` lines in stderr
- Stack frames pointing into `node_modules/.pnpm/@zz-common+lego@x.y.z/.../lego-pagelife/index.js` or `native-adapter/.../BaseAdapter.js`
- Tests pass, but logs are heavily polluted

Root cause: SDKs like `@zz-common/lego` and `@zz-common/native-adapter` have top-level side effects that inject `<script src=remoteURL>`. happy-dom refuses to load and writes the rejection to stderr.

## Collecting the symbols production code uses

```bash
# List every named import from @zz-common/lego across the source tree
grep -rh "from ['\"]@zz-common/lego['\"]" src --include="*.ts" --include="*.js" --include="*.vue" \
  | grep -oE "\{[^}]+\}" | tr -d "{}" | tr ',' '\n' | sort -u
```

Run the same against `@zz-common/zz-ui`, `@zz-common/zz-utils`, `@zz-common/native-adapter`. The mock for each package must include the union of what production accesses.

## The `Vue.extend()` shared-options pitfall

`Vue.extend(opts)` mutates `opts.props` from an array into Vue's internal normalized form. Reusing the same `opts` reference will throw `TypeError: props is not iterable` on the second use.

```ts
// ❌ Bug: Vue.extend rewrites componentStub.props on first call,
//   so [...componentStub.props] on the next line throws "props is not iterable"
const componentStub = { template: '...', props: ['a', 'b'] }
return {
  A: Vue.extend(componentStub),
  B: Vue.extend({ ...componentStub, props: [...componentStub.props, 'c'] }), // ← crashes
}

// ✅ Fix: factory function returns a fresh object every call
const makeStub = () => ({ template: '...', props: ['a', 'b'] })
return {
  A: Vue.extend(makeStub()),
  B: Vue.extend({ ...makeStub(), props: [...makeStub().props, 'c'] }),
}
```

## Minimum-complete mock checklist (empirically silences most noise)

### `@zz-common/zz-ui`

Imperative services (`Toast`, `Dialog`, `Notify`, `ImagePreview`) **must be functions with static methods**, not plain stubs:

```ts
const toastFn: any = vi.fn()
toastFn.success = vi.fn()
toastFn.fail = vi.fn()
toastFn.clear = vi.fn()
toastFn.loading = vi.fn()

const dialogFn: any = vi.fn(() => Promise.resolve())
dialogFn.confirm = vi.fn(() => Promise.resolve())
dialogFn.alert = vi.fn(() => Promise.resolve())
```

Component stubs to include at minimum:
`Button`, `ButtonGroup`, `NavBar`, `Icon`, `Info`, `Popup`, `Actionsheet`, `FixTop`, `IndexBar`, `IndexAnchor`, `Tabs`, `Tab`, `List`, `PullRefresh`, `ActionPicker`, `Picker`, `Stance`, `Field`, `Cell`, `CellGroup`, `Checkbox`, `CheckboxGroup`, `Radio`, `RadioGroup`, `Switch`, `Tag`, `Image`, `Loading`, `Overlay`, `Sticky`, `Swipe`, `SwipeItem`, `FloatBtn`.

### `@zz-common/native-adapter`

`src/utils/env.ts` calls `getClient()` and `in()` at the top level. Missing either of them crashes other tests at import time.

```ts
const native = {
  isLogin: vi.fn(() => false),
  close: vi.fn(),
  skipToUrl: vi.fn(),
  getClient: vi.fn(() => 'zhuanzhuan'),
  in: vi.fn(() => false),
}

vi.mock('@zz-common/native-adapter', () => ({
  default: native,
  ...native, // expose the same shape as named exports too
}))
```

### `@zz-common/zz-utils`

`src/utils/helper.ts` reads `cookie.get`; `src/utils/env.ts` reads `url.getParams()`.

```ts
vi.mock('@zz-common/zz-utils', () => ({
  setPicSize: (url: string) => url,
  getCookie: vi.fn(),
  cookie: { get: vi.fn(() => ''), set: vi.fn(), remove: vi.fn() },
  url: {
    getParams: vi.fn(() => ({})),
    getQuery: vi.fn(() => ({})),
    parse: vi.fn(() => ({})),
    stringify: vi.fn(() => ''),
  },
  env: { isZZ: false, isZZB: false, isApp: false, isAndroid: false, isIOS: false },
}))
```

### `@zz-common/lego`

Cover every symbol production actually imports. The current usage set is:
`lego`, `legoInit`, `legoPerf`, `legoReport`, `legoGoodsExposure`, `legoAreaExposure`, `legoZPMExposure`, `pageId`.

```ts
vi.mock('@zz-common/lego', () => {
  const noop = vi.fn()
  return {
    lego: { send: noop, sendNew: noop, resumePV: noop },
    legoInit: { setUserBackup: noop, resumePV: noop, init: noop, setExtraInfo: noop },
    legoPerf: { send: noop, mark: noop, measure: noop },
    legoReport: noop,
    legoGoodsExposure: noop,
    legoAreaExposure: noop,
    legoZPMExposure: noop,
    pageId: vi.fn(() => ''),
  }
})
```

### `@zz/fetch`

Mock the whole package to neutralize the JSONP whitelist call (`fetchUrlDomainWhiteList`) that happens during init:

```ts
vi.mock('@zz/fetch', () => {
  const okResp = { respCode: 0, respData: {} }
  return {
    default: vi.fn(() => Promise.resolve(okResp)),
    get: vi.fn(() => Promise.resolve(okResp)),
    post: vi.fn(() => Promise.resolve(okResp)),
    jsonp: vi.fn(() => Promise.resolve(okResp)),
  }
})
```

Note: this **contradicts** the general rule "do not mock `@zz/fetch`, mock `@/utils/http` instead." When `@/utils/http` is mocked per-test, `@zz/fetch` is unreachable and the rule applies; but `setup.ts` runs before any per-test mock and gets pulled in by side-effect chains, so neutralizing `@zz/fetch` at the global level is the safer default.

## See also

- `references/troubleshooting.md` — global-vs-local mock precedence, accepted residual noise
- `mocks/*.ts.txt` — ready-to-paste reference mock files
