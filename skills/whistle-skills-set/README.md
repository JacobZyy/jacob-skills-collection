# Whistle Skills Set

Whistle 代理工具全套 AI 辅助 skills，覆盖从安装启动到高级插件开发的完整工作流。

## 包含的 Skills

| Skill | 用途 | 触发场景 |
|-------|------|----------|
| `whistle-quickstart` | 安装、启动、HTTPS 证书、移动端抓包 | 首次配置 Whistle、证书问题 |
| `whistle-rules` | 规则语法结构、pattern 系统、过滤器 | 需要了解规则怎么写 |
| `whistle-proxy` | Map Local/Remote、DNS 劫持、host/proxy | Mock 接口、本地开发、跨域调试 |
| `whistle-rewrite` | 请求/响应改写、HTML/CSS/JS 注入、限速 | 修改请求头、注入脚本、弱网测试 |
| `whistle-advanced` | 插件开发、CLI 参数、FAQ 排查 | 排查故障、开发插件 |
| `whistle-rules-inject` | 将 AI 生成的规则注入本地 Whistle 配置 | 规则写好后需要生效 |

## 依赖

- **所有 skill**：需要 AI 助手支持 skill 系统（Claude Code / Codex / Gemini CLI / cc-switch）
- **whistle-rules-inject**：额外需要 Python 3（运行注入脚本）
- **whistle-* 功能**：需要本地已安装 Whistle（参考 whistle-quickstart 安装）

## 快速安装

```bash
# 自动检测平台并安装
bash install.sh

# 或指定平台
bash install.sh --target cc-switch    # cc-switch
bash install.sh --target claude       # Claude Code
bash install.sh --target codex        # OpenAI Codex CLI
bash install.sh --target gemini       # Gemini CLI
```

## 使用

安装后，在 AI 助手中直接描述需求即可触发对应 skill。例如：

- "帮我给 `api.example.com` 配一个 mock 返回" → 触发 `whistle-proxy` + `whistle-rules-inject`
- "这个接口的响应头要加 CORS" → 触发 `whistle-rewrite`
- "Whistle HTTPS 抓包配置不生效" → 触发 `whistle-quickstart`

## 参考文档

`llm.txt` 包含 Whistle 官方文档的完整摘要，可直接喂给 LLM 作为上下文。

## 许可

MIT
