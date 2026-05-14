# Private Deps Mock Catalog (zz-common / zz-biz / zz)

> Load when `privateDeps` is non-empty in the stack profile. Each entry below is paste-ready into `tests/unit/setup.ts`.

## Coverage principle

**Every `vi.mock(...)` factory must expose every named symbol production code accesses.** Any missing export makes Vitest fall back to the real package and run its top-level side effects — for zz-common SDKs this means `<script src=remote>` injection that floods stderr with `DOMException`.

Collect what production code uses for any package:

```bash
grep -rh "from ['\"]<pkg-name>['\"]" src --include="*.ts" --include="*.js" --include="*.vue" \
  | grep -oE "\{[^}]+\}" | tr -d "{}" | tr ',' '\n' | sort -u
```

## `@zz-common/zz-ui`

Imperative services (Toast/Dialog/Notify/ImagePreview) **must** be functions with static methods, not plain stubs.

```ts
import Vue from 'vue'
import { vi } from 'vitest'

vi.mock('@zz-common/zz-ui', () => {
  // factory function — Vue.extend mutates options, never share a single object
  const makeStub = () => ({
    template: '<div class="zz-stub"><slot /></div>',
    props: ['index', 'indexList', 'sticky', 'scrollDom', 'forceAdaptIndexListAnchor',
      'position', 'zIndex', 'customClass', 'text', 'info', 'type', 'keepPosition',
      'enableFadeIn', 'headerTaskbarBG', 'name', 'classPrefix', 'cancelText',
      'modelValue', 'className'],
    methods: { $emit: vi.fn() }
  })
  const stub = () => Vue.extend(makeStub())

  const toastFn: any = vi.fn()
  toastFn.success = vi.fn()
  toastFn.fail = vi.fn()
  toastFn.loading = vi.fn()
  toastFn.clear = vi.fn()

  const dialogFn: any = vi.fn(() => Promise.resolve())
  dialogFn.confirm = vi.fn(() => Promise.resolve())
  dialogFn.alert = vi.fn(() => Promise.resolve())
  dialogFn.close = vi.fn()

  return {
    default: stub(),
    // Imperative services
    Toast: toastFn,
    Dialog: dialogFn,
    Notify: vi.fn(),
    ImagePreview: vi.fn(),
    // Component stubs (the common subset; extend per project)
    IndexBar: stub(), IndexAnchor: stub(),
    Popup: Vue.extend({ ...makeStub(), props: [...makeStub().props, 'position', 'zIndex'] }),
    Actionsheet: stub(), FixTop: stub(),
    Icon: stub(), Info: stub(), FloatBtn: stub(),
    Button: stub(), ButtonGroup: stub(),
    NavBar: stub(), Tabs: stub(), Tab: stub(),
    PullRefresh: stub(), List: stub(),
    ActionPicker: stub(), Picker: stub(), Stance: stub(),
    Field: stub(), Cell: stub(), CellGroup: stub(),
    Checkbox: stub(), CheckboxGroup: stub(),
    Radio: stub(), RadioGroup: stub(),
    Switch: stub(), Tag: stub(), Image: stub(),
    Loading: stub(), Overlay: stub(), Sticky: stub(),
    Swipe: stub(), SwipeItem: stub(),
    __esModule: true
  }
})
```

## `@zz-common/native-adapter`

`src/utils/env.ts` calls `getClient()` and `in()` at module load time. Missing either crashes other tests at import.

```ts
vi.mock('@zz-common/native-adapter', () => {
  const native = {
    isLogin: vi.fn(() => false),
    close: vi.fn(),
    skipToUrl: vi.fn(),
    getClient: vi.fn(() => 'zhuanzhuan'),
    in: vi.fn(() => false),
  }
  return { default: native, ...native }
})
```

## `@zz-common/zz-utils`

```ts
vi.mock('@zz-common/zz-utils', () => ({
  setPicSize: (url: string, _size?: number) => url,
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

## `@zz-common/lego`

Production typically imports `lego`, `legoInit`, `legoPerf`, `legoReport`, `legoGoodsExposure`, `legoAreaExposure`, `legoZPMExposure`, `pageId`. Re-run the grep at the top of this file to confirm for your project.

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

## `@zz/fetch`

Mock the transport globally. Production should call business HTTP wrappers (`@/utils/http`), and per-test mocks should target those — but `@zz/fetch` still pulls in JSONP whitelist init that hits the network, so neutralize it at setup time:

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

## `@zz-common/sentry` (if present)

```ts
vi.mock('@zz-common/sentry/lib/sentry-capture', () => ({
  default: { captureException: vi.fn(), captureMessage: vi.fn() }
}))
vi.mock('@zz-common/sentry', () => ({
  default: { init: vi.fn(), captureException: vi.fn() },
  init: vi.fn(),
  captureException: vi.fn(),
}))
```

## `@zz-common/call-app` (if present)

```ts
vi.mock('@zz-common/call-app', () => ({
  default: vi.fn(() => Promise.resolve()),
  callApp: vi.fn(() => Promise.resolve()),
}))
```

## `@zz-biz/utils` (if present)

Re-exports many sub-utilities; mock by named exports per usage:

```ts
vi.mock('@zz-biz/utils', () => ({
  Query: { get: vi.fn(() => ({})), set: vi.fn() },
  Cookie: { get: vi.fn(() => ''), set: vi.fn() },
  Dates: { format: vi.fn((d: any) => String(d)) },
  Money: { fen2yuan: (n: number) => n / 100, yuan2fen: (n: number) => n * 100 },
  SetPicSize: (url: string) => url,
  LoadJS: vi.fn(() => Promise.resolve()),
  Time: { now: () => Date.now() },
}))
```

## `lottie-web` (always mock if @zz-common/zz-ui or any animation lib in use)

```ts
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      destroy: vi.fn(), play: vi.fn(), stop: vi.fn(), pause: vi.fn(),
      goToAndPlay: vi.fn(), goToAndStop: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })),
  },
}))
```

## Vue prototype methods

```ts
// Vue.prototype.$setPicSize is consumed inside many templates
Vue.prototype.$setPicSize = (url: string, _size?: number) => url
```
