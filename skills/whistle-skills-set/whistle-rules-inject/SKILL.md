---
name: whistle-rules-inject
description: >
  将 Whistle 规则注入到本地 Whistle 配置的 defalutRules 中。
  支持所有规则类型（file://, resBody://, reqHeaders://, proxy://, host:// 等）。
  自动检测 whistle-node 和 whistle-client 实例，自动去重，预览后注入。
  当用户在 whistle-proxy 或 whistle-rewrite 对话中生成规则后需要注入本地时触发。
  触发场景："注入到 whistle"、"添加到 whistle 配置"、"写入 whistle 规则"、
  "更新 whistle 规则"、"加到本地 whistle"、"注入规则"。
---

# Whistle Rules Inject

将 AI 生成的 Whistle 规则注入到本地 Whistle 配置文件的 `defalutRules` 顶部。

## 工作流程

### 1. 确认规则内容

- 从上下文中提取要注入的规则（通常由 `whistle-proxy` 或 `whistle-rewrite` skill 生成）
- 规则格式：`pattern operation [filters...]`
- 支持所有操作类型：`file://`, `resBody://`, `reqHeaders://`, `proxy://`, `host://`, `resHeaders://`, `statusCode://` 等

### 2. 检测本地 Whistle 实例

```bash
python3 scripts/list_whistle_instances.py
```

脚本会自动检测 `~/.WhistleAppData/` 下的两种实例：
- **whistle-node**（CLI）：`~/.WhistleAppData/.whistle_client/.whistle`
- **whistle-client**（桌面）：`~/.WhistleAppData/.whistle`

### 3. 选择注入目标

- 如果只检测到 **1 个** 实例 → 自动使用该实例
- 如果检测到 **2 个** 实例 → 询问用户选择注入到哪个实例
- 如果 **0 个** 实例 → 报错，提示用户先启动 Whistle

### 4. 预览确认

- 向用户展示将要注入的规则内容
- 展示目标实例名称和路径
- **必须等用户确认后**才执行注入

### 5. 注入规则

```bash
python3 scripts/inject_rule.py \
  --whistle-home "/path/to/.whistle" \
  --rule "完整的规则行"
```

脚本行为：
- 读取 `rules/properties` 的 `defalutRules` 字段
- 将新规则插入到 `defalutRules` **最顶部**（优先级最高）
- 自动去重：如果已有相同 pattern + 相同操作协议的规则，移除旧规则
- 保留原有注释和空行结构

**预览模式（不实际写入）：**
```bash
python3 scripts/inject_rule.py \
  --whistle-home "/path/to/.whistle" \
  --rule "完整的规则行" \
  --dry-run
```

### 6. 验证结果

- 读取注入后的 defalutRules 顶部几行，确认规则已正确写入
- 告知用户注入成功，提醒可能需要刷新 Whistle 规则

## 去重逻辑

去重基于 **pattern + 操作协议** 的组合：
- 相同 `pattern` + 相同 `protocol://` → 视为重复，替换旧规则
- 例如：`www.example.com/api file://(old)` 和 `www.example.com/api file://(new)` → 新规则替换旧规则
- 不同 pattern 或不同操作协议 → 不冲突，共存

## 命令速查

```bash
# 1) 检测可用实例
python3 scripts/list_whistle_instances.py

# 2) 预览注入（不写入）
python3 scripts/inject_rule.py \
  --whistle-home ~/.WhistleAppData/.whistle_client/.whistle \
  --rule 'www.example.com/api file://({"status":"ok"})' \
  --dry-run

# 3) 执行注入
python3 scripts/inject_rule.py \
  --whistle-home ~/.WhistleAppData/.whistle_client/.whistle \
  --rule 'www.example.com/api file://({"status":"ok"})'

# JSON 输出（便于 AI 解析）
python3 scripts/inject_rule.py \
  --whistle-home ~/.WhistleAppData/.whistle_client/.whistle \
  --rule 'www.example.com/api file://({"status":"ok"})' \
  --json
```

## 注意事项

- 规则始终注入到 `defalutRules` 字段中（不是单独的规则文件）
- 新规则始终放在 `defalutRules` 最顶部
- `defalutRules` 位于 `rules/properties` JSON 文件中
- 注入不修改 `filesOrder` 或 `selectedList`
- 首次使用前确保 Python 3 可用
- 如果 Whistle 正在运行，注入后需要刷新规则（在 Rules 界面点击 Reload）

## 与 whistle-* skill 体系的关系

| 步骤 | 使用的 Skill |
|------|-------------|
| 编写规则 | `whistle-proxy` 或 `whistle-rewrite` |
| 了解规则语法 | `whistle-rules` |
| 注入到本地 | `whistle-rules-inject`（本 skill） |
| 排查问题 | `whistle-advanced` |
