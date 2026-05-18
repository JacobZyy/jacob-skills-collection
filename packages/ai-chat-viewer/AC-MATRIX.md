# AC-MATRIX — 验收标准验证矩阵

> 生成时间: 2026-05-11
> 数据来源: 自动化验证脚本执行结果

## 验证结果总览

| AC | 描述 | 验证方式 | 状态 | 关键指标 |
|----|------|---------|------|---------|
| AC-1 | bun dev 双启 web+api | `scripts/verify-ac1.sh` | **PASS** | server:3001 + web:5173 均 200 |
| AC-2 | 首启全量 catch-up 60s 内 | `scripts/verify-ac2.ts` | **PASS** | p95=22.42s (budget: 60s) |
| AC-2b | Parser 按 type 分流正确入表 | AC-2 子验证 | **PASS** | ChatMessage/Attachment/Session 元数据均正确 |
| AC-3 | 增量 tail，新行 2s 内同步 | `scripts/verify-ac3.ts` | **PASS** | p95=137ms (budget: 2000ms) |
| AC-4 | 首页按最近使用倒序 <1s 渲染 | 联调验证 | **Implemented** | TanStack Query + 后端索引 |
| AC-5 | 项目→sessions→消息流端到端走通 | 联调验证 | **Implemented** | 路由 /projects/:cwdHash/sessions + /sessions/:sessionId |
| AC-6 | sidechain/tool_use/thinking 默认折叠 | 代码审查 | **Implemented** | MessageRenderer 4 种 block 子件均支持折叠 |
| AC-7 | 删 DB 重启可重建 | `scripts/verify-ac7.sh` | **PASS** | JSONL 为 source of truth，重建前后数据一致 |
| AC-8 | Prisma schema 含 ChatMessage.tool + raw JSON | 代码审查 | **Implemented** | `tool String`, `raw Json` |
| AC-9 | packages/schema 在前/后/ingestion 三处复用 | 代码审查 | **Implemented** | workspace:* 依赖 |
| AC-10 | OXC lint pass，零 any、零 as unknown as T | `scripts/verify-ac10.sh` | **PASS** | 0 errors, 0 warnings |

## 验证详情

### AC-1 — bun dev 双端口 200

脚本 `scripts/verify-ac1.sh` 轮询检查：
- `http://127.0.0.1:3001/health` → 200
- `http://127.0.0.1:5173/` → 200

最大等待 60s，双端口就绪即 PASS。

### AC-2 — 首启全量 catch-up 60s 内

脚本 `scripts/verify-ac2.ts` 测量首次启动时从扫描 `~/.claude/projects` 到所有 JSONL 文件被解析入库的 wall time。

实测规模（本机）：
- 29 个项目
- 325 个 session
- 203MB JSONL 数据

结果：p95=22.42s，远低于 60s 预算。

### AC-3 — 增量 tail 2s 内同步

脚本 `scripts/verify-ac3.ts` 进行 10 轮测试：
1. 创建独立测试 session JSONL
2. 打开 SSE 连接到 `/api/stream`
3. 追加一行 synthetic message
4. 测量从 append 到 `message-appended` SSE 事件的 wall time

结果（复用已运行的 server）：
```
samples: [11ms, 6ms, 11ms, 8ms, 8ms, 5ms, 137ms, 8ms, 5ms, 8ms]
p95=137ms p99=137ms (budget p95<2000ms)
```

### AC-7 — 删 DB 重启可重建

脚本 `scripts/verify-ac7.sh`：
1. 备份当前 DB
2. 删除 DB 文件
3. 重启 server（触发 catch-up）
4. 对比重建前后的项目数、session 数、消息数
5. 数据一致即 PASS

JSONL 为唯一 source of truth，SQLite 仅为衍生只读索引。

### AC-10 — OXC lint pass

脚本 `scripts/verify-ac10.sh` 运行 `oxlint src` 于 `apps/web/`，要求：
- 0 errors
- 0 warnings
- 零 `any`
- 零 `as unknown as T`

## 需手动验证项

| AC | 原因 | 验证步骤 |
|----|------|---------|
| AC-4 | 渲染性能与具体机器/数据量相关 | 打开首页，Chrome DevTools Network 面板确认 `/api/projects` 请求 <1s |
| AC-5 | 端到端需要真实浏览器交互 | 点击项目 → 进入 session 列表 → 点击 session → 消息流正常渲染 |

## 运行全部验证

```bash
# 快速运行（需 server 已在 :3001 运行）
bash scripts/verify-ac1.sh
bun run scripts/verify-ac2.ts --yes
bun run scripts/verify-ac3.ts --yes
bash scripts/verify-ac7.sh
bash scripts/verify-ac10.sh
```
