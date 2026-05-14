# vitest-vue2-testing —— 中文说明

> 本文件不会被 AI 自动加载（skill 加载器只读取 `SKILL.md`），仅作为人类可读的设计说明、使用指南和踩坑记录。
>
> 实际指令逻辑见英文版 `SKILL.md`。

---

# Vitest + Vue 2.7 单测规范（针对本项目）

> **本规范明确针对 Vitest，不是 Jest。** 不要把 Jest 的 `jest.fn()`/`jest.mock()`/`jest.config.js` 套到这里。

## 一、概览

本项目栈：

| 维度 | 版本 |
|------|------|
| Vue | 2.7.8（npm alias → vue@2.7.8） |
| TypeScript | 6.0.3（Babel 转译为主） |
| Vitest | 4.1.6 |
| @vitejs/plugin-vue2 | 2.3.4 |
| @vue/test-utils | 1.x（Vue 2 系列） |
| happy-dom | 20.9.0 |
| Pinia | 2.0.22 + PiniaVuePlugin |

**核心命令**：

```bash
pnpm test           # 跑单测
pnpm test:ui        # vitest UI
pnpm test:coverage  # 覆盖率（需 @vitest/coverage-v8）
```

---

## 二、vitest.config.mts

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue2'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': new URL('./src', import.meta.url).pathname },
  },
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

**关键点**：
- `@vitejs/plugin-vue2` —— Vue 2 SFC 编译；不要用 `@vitejs/plugin-vue`（那是 Vue 3）
- `environment: 'happy-dom'` —— 轻量浏览器环境；不真发网络请求
- coverage provider 用 `v8`（无需 babel，速度更快）

---

## 三、公共 mock 约定（核心）

**所有 `@zz-*` 私有依赖统一在 `tests/unit/setup.ts` 全局 mock，业务用例不重复声明。**

参考 `mocks/` 目录下的 4 个模板：
- `mocks/zz-ui.ts`
- `mocks/native-adapter.ts`
- `mocks/lego.ts`
- `mocks/zz-utils.ts`

`tests/unit/setup.ts` 示例：

```ts
import { vi } from 'vitest'
import Vue from 'vue'

// 1. lottie-web —— 替代手工 canvas mock
vi.mock('lottie-web', () => ({
  default: {
    loadAnimation: vi.fn(() => ({
      destroy: vi.fn(),
      play: vi.fn(),
      stop: vi.fn(),
      pause: vi.fn(),
      goToAndPlay: vi.fn(),
      goToAndStop: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  },
}))

// 2. @zz-common/zz-ui —— UI 组件 stub
vi.mock('@zz-common/zz-ui', async () => await import('./../__mocks__/zz-ui'))

// 3. @zz-common/native-adapter —— JSBridge
vi.mock('@zz-common/native-adapter', async () => await import('./../__mocks__/native-adapter'))

// 4. @zz-common/lego —— 埋点
vi.mock('@zz-common/lego', async () => await import('./../__mocks__/lego'))

// 5. @zz-common/zz-utils —— 工具
vi.mock('@zz-common/zz-utils', async () => await import('./../__mocks__/zz-utils'))

// 6. Vue 原型方法（业务模板里直接用 $setPicSize(url, size)）
Vue.prototype.$setPicSize = (url: string, _size?: number) => url
```

### 3.1 `@zz-common/zz-ui` mock

详见 `mocks/zz-ui.ts`，原理：为所有 z-* 组件返回一个透传 slots 的最小 stub，让 `mount` 能成功渲染，业务断言不依赖 UI 库内部实现。

### 3.2 `@zz-common/native-adapter` mock

详见 `mocks/native-adapter.ts`。所有 JSBridge 方法导出为 `vi.fn()`，用例里可：

```ts
import { getUserInfo } from '@zz-common/native-adapter'
vi.mocked(getUserInfo).mockResolvedValue({ uid: '123' })
```

### 3.3 `@zz-common/lego` mock

详见 `mocks/lego.ts`。`legoReport`/`pageId` 等导出全为 `vi.fn()`。**不需要断言上报参数时无需特殊处理。**

### 3.4 `@zz-common/zz-utils` mock

详见 `mocks/zz-utils.ts`。`setPicSize`、`getCookie`、`url`、`env` 这几个高频方法给到占位实现。

### 3.5 业务 HTTP 层 mock 规则

| 不要 mock | 要 mock |
|---|---|
| ❌ `@zz/fetch`（HTTP 底层） | ✅ `@/utils/http`（业务封装） |

**理由**：业务 API 全部走 `@/utils/http`，mock 业务层既隔离了网络又避开了 zzfetch 的内部细节。

```ts
// ✅ 正确
vi.mock('@/utils/http', () => ({
  default: {
    post: vi.fn(),
    get: vi.fn(),
  },
}))
```

### 3.6 mock 完备性原则（**血泪经验**）

**`vi.mock` 返回的对象必须覆盖业务代码真正访问的所有命名导出，缺失一个就会让 Vitest 回退到真实包并跑其顶层副作用。**

诊断特征：
- 终端反复刷出 `DOMException [NotSupportedError]: Failed to load script "https://s1.zhuanstatic.com/...index.min.js"`
- 栈帧深入到 `node_modules/.pnpm/@zz-common+lego@x.y.z/.../lego-pagelife/index.js` 或 `native-adapter/.../BaseAdapter.js`
- 用例本身通过，但日志噪声极大

根因：lego/native-adapter 等 SDK 顶层副作用会主动注入 `<script src=远程URL>`，happy-dom 拒载并 stderr 报错。

**收集业务实际用到的导出**：

```bash
# 列出业务代码所有从 @zz-common/lego 命名导入的符号
grep -rh "from ['\"]@zz-common/lego['\"]" src --include="*.ts" --include="*.js" --include="*.vue" \
  | grep -oE "\{[^}]+\}" | tr -d "{}" | tr ',' '\n' | sort -u
```

**`Vue.extend()` 共享 options 的坑**：

```ts
// ❌ 反例：Vue.extend 第一次调用就改写 componentStub.props 从数组→对象，
//   第二次 [...componentStub.props] 报 "props is not iterable"
const componentStub = { template: '...', props: ['a', 'b'] }
return {
  A: Vue.extend(componentStub),
  B: Vue.extend({ ...componentStub, props: [...componentStub.props, 'c'] }), // ← 崩
}

// ✅ 正解：工厂函数每次返回新对象
const makeStub = () => ({ template: '...', props: ['a', 'b'] })
return {
  A: Vue.extend(makeStub()),
  B: Vue.extend({ ...makeStub(), props: [...makeStub().props, 'c'] }),
}
```

**最低完备 mock 清单**（本项目实测可消大部分噪声）：

```ts
// @zz-common/zz-ui：命令式服务（Toast/Dialog/Notify/ImagePreview）必须是函数+静态方法
const toastFn: any = vi.fn()
toastFn.success = vi.fn(); toastFn.fail = vi.fn(); toastFn.clear = vi.fn(); toastFn.loading = vi.fn()
const dialogFn: any = vi.fn(() => Promise.resolve())
dialogFn.confirm = vi.fn(() => Promise.resolve()); dialogFn.alert = vi.fn(() => Promise.resolve())
// 组件 stub 至少覆盖：Button/ButtonGroup/NavBar/Icon/Info/Popup/Actionsheet/FixTop/
// IndexBar/IndexAnchor/Tabs/Tab/List/PullRefresh/ActionPicker/Picker/Stance/Field/
// Cell/CellGroup/Checkbox/Radio/Switch/Tag/Image/Loading/Overlay/Sticky/Swipe/SwipeItem/FloatBtn

// @zz-common/native-adapter：env.ts 顶层就会调用 getClient/in，必须存在
{ default: { isLogin, close, skipToUrl, getClient: () => 'zhuanzhuan', in: () => false }, ...同上顶层导出 }

// @zz-common/zz-utils：helper.ts 用 cookie.get；env.ts 用 url.getParams()
{ setPicSize, getCookie, cookie: { get, set, remove }, url: { getParams, getQuery, parse, stringify }, env: {...} }

// @zz-common/lego：业务实际用到 lego/legoInit/legoPerf/legoReport/legoGoodsExposure/legoAreaExposure/legoZPMExposure/pageId
```

### 3.7 setup.ts 与用例 mock 的优先级

**用例文件里写 `vi.mock(...)` 会**完全覆盖** setup.ts 的同名 mock，而不是合并。**

最常见的坑：用例只想覆盖某个方法默认行为，于是写 `vi.mock('@zz-common/lego', () => ({}))`——这会让 `lego`/`legoPerf`/`pageId` 等业务用的导出全部消失，业务模块 import 这些命名时 Vitest 回退到真实包并跑顶层副作用。

```ts
// ❌ 反例：用空对象/不完整对象覆盖 setup 的全局 mock
vi.mock('@zz-common/lego', () => ({}))
vi.mock('@zz-common/lego', () => ({ legoInit: { setUserBackup: vi.fn() } }))

// ✅ 正解 1：默认行为已合适，直接删掉这行，让 setup.ts 生效

// ✅ 正解 2：必须覆盖时，复制 setup.ts 的完整 mock 再改你要改的方法
vi.mock('@zz-common/native-adapter', () => ({
  default: {
    isLogin: vi.fn(() => true), // 本用例需要"已登录"
    close: vi.fn(), skipToUrl: vi.fn(),
    getClient: vi.fn(() => 'zhuanzhuan'),
    in: vi.fn(() => false),
  },
  isLogin: vi.fn(() => true),
  close: vi.fn(), skipToUrl: vi.fn(),
  getClient: vi.fn(() => 'zhuanzhuan'),
  in: vi.fn(() => false),
}))

// ✅ 正解 3：只想改单个方法，用 vi.mocked 修改 setup 已提供的 vi.fn
import native from '@zz-common/native-adapter'
beforeEach(() => {
  vi.mocked(native.isLogin).mockReturnValue(true)
})
```

### 3.8 残留噪声的接受边界

**已知良性 stderr**：setup.ts mock 已完备后，若仍偶发 1–2 条 `DOMException: Failed to load script .../lego-pagelife/...` 噪声，**接受它**：

- 触发条件：第三方包通过 pnpm 软链跨副本（如 sentry 间接依赖 `@zz-common/lego@x.y.z`）直接子路径 require lego 内部模块，绕过 `vi.mock('@zz-common/lego', ...)` 的包名拦截
- 影响：纯 stderr，exit code 0，断言不受影响，CI 不感知
- **不要做**的尝试（都试过、都无效或有副作用）：
  - monkey-patch `HTMLScriptElement.prototype.src` setter — 被 happy-dom 私有 `#loadScript` 绕过
  - `environmentOptions.happyDOM.settings.handleDisabledFileLoadingAsSuccess: true` — 会让 load 事件 dispatch 后 SDK 跑到 happy-dom 不支持的代码路径，**新增 8+ 条 Error**
  - `test.onConsoleLog` — 拦不到 happy-dom 内部虚拟 console
  - 给 `@zz-common/lego/lib/lego-pagelife` 加子路径 vi.mock — 第三方包内部的 `require('./lego-pagelife')` 是相对路径，根本不经过 vi.mock 解析器
- 真要消干净的合规手段：`vitest.config.mts` 加 `server.deps.inline: ['@zz-common/lego', '@zz-common/native-adapter', '@zz-common/sentry']`，让 Vitest 把整包 inline 到 worker 进程，让 vi.mock 重新覆盖到。代价是冷启动慢若干百毫秒

---

## 四、四类测试模板

完整可复制代码见 `templates/` 目录：

| 模板 | 文件 | 关键模式 |
|------|------|---------|
| API | `templates/api.template.ts` | `vi.mock('@/utils/http')` + 校验入参 |
| Store | `templates/store.template.ts` | `setActivePinia(createPinia())` |
| Component | `templates/component.template.ts` | `createLocalVue` + `PiniaVuePlugin` + `mount` |
| Utils | `templates/utils.template.ts` | 直接 import 调用 |

---

## 五、CDN 静态文件处理

**默认无需处理**：happy-dom 不会真发图片请求。`<img src="https://s1.zhuanstatic.com/...">` 在测试里只是 DOM 字符串。

**例外**：代码层面用 `fetch(cdnUrl)` 真发请求（如 `uploadImages.ts`）时，需要：

```ts
beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ data: 'mock' }),
    text: async () => 'mock',
    blob: async () => new Blob(),
  } as unknown as Response)
})
```

---

## 六、接口 mock 数据策略

| 场景 | 策略 |
|------|------|
| 接口已就绪 + 有 TS 类型 | AI 按类型直接构造合法 mock 数据 |
| 接口已就绪 + 无 TS 类型 | 占位 + 在测试文件顶部留 `// TODO: 接口字段待 PM/后端确认` |
| 接口未就绪 | 用最小合理结构 + 注释 `// @todo 接口就绪后回填` |
| `mock.local`（本地 gitignore 临时数据） | **本阶段不接入**，后续按需 |

---

## 七、避坑/禁止清单

| 禁止 | 原因 |
|------|------|
| ❌ 在每个 `.test.ts` 重复 `vi.mock('@zz-common/zz-ui')` | 应集中在 `setup.ts` |
| ❌ `vi.mock('@zz/fetch')` | 业务全走 `@/utils/http`，mock 后者就够 |
| ❌ 用 canvas 手工 mock 绕 lottie | 治标不治本，直接 `vi.mock('lottie-web')` |
| ❌ 占位测试 `expect(Comp).toBeDefined()` | 没价值，应改为真 mount + 行为断言 |
| ❌ `jest.fn()` / `jest.mock()` | 这是 Vitest，要用 `vi.fn()` / `vi.mock()` |
| ❌ `import { ... } from '@vue/test-utils-next'` | Vue 2 用 `@vue/test-utils` 1.x，不是 next |
| ❌ 测试里 `createApp()` / `createPinia().use()` Vue 3 写法 | 用 `createLocalVue().use(PiniaVuePlugin)` |
| ❌ `vi.mock('@zz-common/lego', () => ({}))` 等空覆盖 | 完全覆盖而非合并 setup mock；业务 import 缺失导出时 Vitest 回退真实包跑顶层副作用 |
| ❌ `Vue.extend()` 复用同一 options 对象 | `Vue.extend` 会改写 `props` 数组为内部对象形式，第二次展开报 "props is not iterable"；用工厂函数 |
| ❌ `handleDisabledFileLoadingAsSuccess: true` 消噪声 | 会让 load 事件 dispatch 后 SDK 跑到 happy-dom 不支持的代码路径，新增 Error |
| ❌ monkey-patch `HTMLScriptElement.prototype.src` setter | happy-dom 用私有 `#loadScript` 绕过 setter，无效 |

---

## 八、何时触发本 skill

- ✅ 新增 `tests/unit/**/*.test.ts` 前
- ✅ 修改 `vitest.config.mts` / `tests/unit/setup.ts` 前
- ✅ 遇到 `Cannot find module '@zz-common/...'` 类 mock 报错
- ✅ 测试报 `document is not defined` / `window is not defined`
- ✅ 测试出现 `loadAnimation is not a function`（lottie 相关）
- ✅ 测试日志反复刷出 `DOMException: Failed to load script ".../index.min.js"`、`PageLife.initSdk`、`fetchUrlDomainWhiteList`、`waitJsLoaded` — 见 §3.6
- ✅ 测试报 `No "XXX" export is defined on the "@zz-common/..." mock` — 见 §3.6
- ✅ 测试报 `props is not iterable`（Vue.extend stub 共享 options）— 见 §3.6
- ✅ 给 Pinia store / Vue 组件写单测前
- ✅ 提交 PR 前自查测试质量

---

## 九、快速开始 checklist（5 分钟上手）

写一个新组件测试：

- [ ] 测试文件路径与源码对齐：`src/views/foo/Bar.vue` → `tests/unit/views/foo/Bar.test.ts`
- [ ] 复制 `templates/component.template.ts` 重命名
- [ ] mock 业务 API：`vi.mock('@/api/foo', () => ({ getBar: vi.fn() }))`
- [ ] 准备 props/store 初始数据
- [ ] `mount` + 断言关键 DOM / emit / 调用
- [ ] `pnpm test path/to/your.test.ts` 跑通
- [ ] 删掉 `console.log`，commit

---

## 十、参考

本项目已落地的良好模板（可直接对照）：

- API 测试：`tests/unit/api/nlabSkuSelect.test.ts`
- Store 测试：`tests/unit/views/newStandard/directSaleHome/components/directSaleFlowBanner/flowDataStore.test.ts`
- Component 测试：`tests/unit/views/newStandard/directSaleHome/components/directSaleFlowBanner/index.test.ts`

需要重做的占位测试（反例）：

- `tests/unit/App.test.ts`（只 mount 不断言）
- `tests/unit/views/newStandard/directSaleHome/components/SaleHeader.test.ts`（只 `expect(defined)`）
