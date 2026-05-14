# vitest-vue2-init —— 中文说明

> 本文件不会被 AI 自动加载（skill 加载器只读取 `SKILL.md`），仅作为人类可读的设计说明、使用指南和取舍记录。
>
> 实际指令逻辑见英文版 `SKILL.md`。

## 这个 skill 是干什么的？

为转转前端项目（Vue 2 系列）从零搭建一套 **Vitest 4.x** 单元测试框架，**一次到位**。和姊妹 skill `vitest-vue2-testing`（在已搭好框架下写测试）配合使用。

## 触发时机

| 场景 | 应该走的 skill |
|------|---------------|
| 项目根目录**没有** `vitest.config.*`，准备从零搭建单测能力 | `vitest-vue2-init`（本 skill） |
| 项目已有 `tests/unit/setup.ts`，要写新测试 / 修 mock / 排查噪声 | `vitest-vue2-testing` |
| 接到任意 `.test.ts` 报错 | `vitest-vue2-testing` |

如果你在 init 主入口看到"Preconditions"段说要 bail out，那就是触发场景错了，应该走 testing skill。

## 设计原则

### 1. 零 token 探测

老办法是让 AI 用 Read / Grep / Glob 自己扫项目结构，**token 烧得快、容易漏**。本 skill 把这一步交给一个零依赖的 Node 脚本：

```bash
node $SKILL_DIR/scripts/detect-stack.mjs $PROJECT_ROOT
```

输出结构化 JSON：vue 版本、是否装了 `@vue/composition-api`、状态管理、语法风格分布（setup script / defineComponent / class / TSX / template-only 各多少个）、私有依赖清单、CDN 域名出现次数、已存在的测试配置。AI 只解析这一份 JSON，避免上下文被项目代码挤爆。

### 2. 主线 + 可选模块按需拼接

转转前端的真实栈跨度太大：

- Vue 2.7 + composition + setup script（最新主线）
- Vue 2.6 + `@vue/composition-api` 插件
- Vue 2.6 + Options API + Vuex（最老栈）
- TSX / JSX 写法
- vue-class-component 装饰器写法

如果把所有变体都写进主入口，**主入口 token 会爆掉**。本 skill 的做法：

- **主入口 SKILL.md**：只描述 vue 2.7 + composition + pinia 主线 + 工作流
- **references/**：按探测结果按需加载的可选模块
  - `option-vue26.md` —— Vue 2.6 适配
  - `option-vuex.md` —— Vuex 测试
  - `option-tsx-jsx.md` —— `@vitejs/plugin-vue2-jsx` 集成
  - `option-class-component.md` —— 装饰器 Babel 配置
  - `private-deps-mock-catalog.md` —— `@zz-*` 完备 mock 清单
  - `cdn-and-async-noise.md` —— CDN 静态文件 + 良性 stderr 噪声策略

主入口只在「探测脚本输出符合某条件」时引用对应 reference，AI 才会去 Read 它。

### 3. 强制 5 问审查（来自项目 lead 的搭建提示词）

探测脚本能告诉你"项目里有什么"，但告诉不了你"哪些在测试范围内 / 哪些 mock 要走特殊行为"。所以主入口在写文件**之前**强制 AI 走一遍 5 问：

| 问题 | 解决什么 |
|------|---------|
| Q1 版本 | Vitest 4.x 是否可接受？团队有没有版本锁要遵守？ |
| Q2 文件类型范围 | 探测到的所有写法是否都纳入测试范围？ |
| Q3 私有依赖 | 不在 catalog 里的 `@zz-*` 包要怎么 mock？ |
| Q4 CDN 静态文件 | 仅模板字符串引用就够了吗？还是有 `fetch(cdnUrl)`？ |
| Q5 接口契约 | API 是否就绪？有没有 `mock.local`？ |

跳过 5 问会导致后续配置错误——这是踩过坑后总结的硬约束。

## 文件清单

```
vitest-vue2-init/
├── SKILL.md                          ← AI 实际读的主入口（英文）
├── README.zh-CN.md                   ← 本文件（人类读）
├── scripts/
│   └── detect-stack.mjs              ← 探测脚本（零依赖 Node.js）
├── references/                       ← 按需加载的可选模块
│   ├── option-vue26.md
│   ├── option-vuex.md
│   ├── option-tsx-jsx.md
│   ├── option-class-component.md
│   ├── private-deps-mock-catalog.md
│   └── cdn-and-async-noise.md
└── templates/                        ← 不进 AI 上下文，由 AI 通过文件操作落盘到目标项目
    ├── vitest.config.mts.tpl
    ├── setup.ts.tpl
    ├── package-scripts.json.tpl
    ├── sample-utils.test.ts.tpl
    └── sample-component.test.ts.tpl
```

## 工作流（AI 实际执行的步骤）

1. **Bash 跑探测脚本**，拿到 JSON
2. **按 JSON 决定要加载哪些 references**（vue 2.6 → option-vue26.md；TSX → option-tsx-jsx.md；等等）
3. **走完 5 问审查**，确认项目 lead 关心的灰区
4. **组装并写文件**：
   - `vitest.config.mts`（按需启用 jsx / decorator plugin）
   - `tests/unit/setup.ts`（按 catalog 装齐私有依赖 mock）
   - `tests/unit/sample-utils.test.ts` + `sample-component.test.ts`（样例）
   - merge `package.json` scripts
5. **告诉用户跑 `pnpm test`** 验证 2 个文件 4 个测试通过
6. **输出私有依赖扫描报告**，标记 catalog 没覆盖到的包供用户补齐

## 验收标准

- [ ] `pnpm test` 跑通（即使无任何业务测试）
- [ ] 样例测试 2 个文件全部通过
- [ ] 私有依赖扫描报告输出，标记 mock 覆盖状态
- [ ] 探测脚本能在 vue 2.6 + composition / vue 2.6 + options / vue 2.7 + setup script / vue 2.7 + defineComponent 四种场景下都给出正确 profile

## 已知限制

### 跨副本 mock 绕过的良性 stderr 噪声

pnpm 可能锁出多份 `@zz-common/lego`（如 6.4.7 直依、6.4.9 由 sentry 间接拉入）。`vi.mock('@zz-common/lego', ...)` 拦的是包 ID，**不拦传递依赖通过相对路径 require 子模块**的情况，所以有时会出现 1-2 条 `DOMException: Failed to load script .../lego-pagelife/...` 残留 stderr。

**不影响测试 exit code、不影响断言、CI 不感知**。要彻底消除可在 `vitest.config.mts` 加 `server.deps.inline`，但代价是冷启动多几百 ms。本 skill 默认接受这点噪声，参考 `references/cdn-and-async-noise.md`。

### 探测脚本不识别软链 / monorepo

`detect-stack.mjs` 假设单仓库单栈。pnpm/lerna monorepo 需要 per-package 重新跑一遍。这是基于"你的项目当前都是单仓单栈"的现实做的简化，跨栈分布通过 references 体系覆盖。

## 与 `vitest-vue2-testing` 的边界

| | `vitest-vue2-init`（本 skill） | `vitest-vue2-testing` |
|---|---|---|
| 触发 | 项目无 `vitest.config.*` | 测试基础设施已就位 |
| 频率 | 每仓库一次 | 高频日常 |
| 入口动作 | Bash 跑 detect-stack | Read 已有 setup.ts |
| 输出 | 框架配置 + 样例测试 + 扫描报告 | 测试用例 + mock 调整 + 噪声诊断 |

init 完成后，AI 会显式提示："Framework ready. For test authoring, the skill `vitest-vue2-testing` takes over from here."

## 修改本 skill 时注意

- **必须保持 SKILL.md 全英文**——AI 读它时不应被混合语言干扰
- 中文说明、设计取舍、踩坑记录全部放在本文件
- 探测脚本 `scripts/detect-stack.mjs` 的注释可以保持英文，方便其他人读
- references/*.md 也应保持英文（AI 按需加载，不要给它中英混合）

## 一句话总结

**先探测、按需加载、强制 5 问、模板拼接、零 token 起步、跨仓库可复用。**
