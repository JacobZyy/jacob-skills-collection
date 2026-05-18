# ai-chat-viewer

本地优先的 AI 对话记录浏览器，自动读取 `claude-code` 会话 JSONL 并渲染为可读的对话流。

## 快速开始

```bash
# 安装依赖
bun install

# 启动开发服务器（前后端双启）
bun run dev

# 或：使用统一的 dev 启动脚本（server 日志写入 .log/server-dev.log）
bun run scripts/dev.ts
```

启动后访问：
- **Web UI**: http://127.0.0.1:5173/
- **API**: http://127.0.0.1:3001/
- **Health**: http://127.0.0.1:3001/health

## 项目结构

```
ai-chat-viewer/
├── apps/
│   ├── web/              # React 19 + Vite + Tailwind + daisyUI 前端
│   └── server/           # Hono.js + Prisma + SQLite 后端
├── packages/
│   ├── schema/           # Zod domain schemas（前后端 + ingestion 复用）
│   └── ingestion/        # claude-code JSONL 解析与增量同步
├── prisma/
│   └── schema.prisma     # SQLite 数据模型
└── scripts/              # 验证脚本（AC-1 ~ AC-10）
```

## 数据来源

自动扫描 `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`，解析 8 种行类型：

| 行类型 | 存储目标 |
|--------|---------|
| `user` / `assistant` / `system` | `ChatMessage` 表 |
| `attachment` | `Attachment` 表（含 cwd/gitBranch/version 元数据） |
| `permission-mode` | `Session.permissionMode` |
| `last-prompt` | `Session.lastPrompt` |
| `file-history-snapshot` / `queue-operation` | 仅保留 raw JSON |

首启时全量 catch-up，之后通过 chokidar 增量 tail，新行 2s 内通过 SSE 推送到前端。

## 技术栈

- **Runtime**: Bun 1.2+
- **Frontend**: React 19 + Tailwind CSS + daisyUI + Zustand + TanStack Query + Vite + OXC
- **Backend**: Hono.js + Hono RPC + Prisma (SQLite WAL) + Zod
- **Ingestion**: 流式 JSONL 解析 + chokidar 增量监听

## 验证

所有验收标准均有自动化验证脚本：

```bash
# AC-1: bun dev 双端口 200
bash scripts/verify-ac1.sh

# AC-2: 首启全量 catch-up 60s 内
bun run scripts/verify-ac2.ts --yes

# AC-3: 增量 tail，新行 2s 内同步
bun run scripts/verify-ac3.ts --yes

# AC-7: 删 DB 重启可重建
bash scripts/verify-ac7.sh

# AC-10: OXC lint pass
bash scripts/verify-ac10.sh
```

完整验收矩阵见 [AC-MATRIX.md](./AC-MATRIX.md)。

## 全局数据路径

- **SQLite DB**: `~/Library/Application Support/ai-chat-viewer/db.sqlite`
- **Ingestion log**: `~/Library/Application Support/ai-chat-viewer/ingestion.log`

## License

MIT
