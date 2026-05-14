# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

个人 AI 相关工具合集仓库。收集和整理个人开发的 AI 工具、脚本和配置。

- 主仓库: GitHub `https://github.com/JacobZyy/jacob-skills-collection`
- 公司备份: GitLab `https://gitlab.zhuanspirit.com/zhayang/jacob-open-source`
- 包管理: pnpm
- 类型: ESM (`"type": "module"`)

## Common Commands

```bash
# 安装依赖
pnpm install

# 代码检查
pnpm lint          # 运行 ESLint
pnpm lint:fix      # 自动修复 ESLint 问题

# GitLab 代理开关（公司内网需要）
pnpm proxy:status  # 查看代理状态
pnpm proxy:on      # 开启代理 (127.0.0.1:12639)
pnpm proxy:off     # 关闭代理
```

## Code Style

- ESLint: `@antfu/eslint-config@8.2.0` with `formatters: true`
- 配置文件: `eslint.config.js` (ESM 格式)
- `pnpm lint:fix` 会自动排序 JSON keys、格式化代码等
- 提交前运行 `pnpm lint:fix` 确保代码通过检查

## Repository Workflow

### Git Remote Setup

- `origin` → GitHub（主仓库，普通 push 目标）
- `github` → GitLab（公司备份）

### 提交规范

**普通提交（仅 GitHub）**：

```bash
git add -A
git commit -m "提交信息"
git push origin main
```

**同步到 GitLab 备份**：
必须使用 `gitlab-sync` skill。当用户要求提交到 GitLab、同步两个仓库、或提到 GitLab/备份时，触发此 skill 执行：

1. push 到 GitHub（origin）
2. 临时切 origin 到 GitLab URL，push
3. 切回 GitHub URL

不要直接用脚本，不要执行 `git pull` 从 GitLab 拉取。

### 代理配置

公司内网访问 GitLab 需要挂代理 `127.0.0.1:12639`：

```bash
# 方式一: pnpm script
pnpm proxy:on

# 方式二: git config 直接设置
git config --local http.https://gitlab.zhuanspirit.com/.proxy http://127.0.0.1:12639
```

代理仅影响 GitLab HTTP 请求，不影响 npm/pnpm（npm 使用独立的公司 registry `https://rcnpm.zhuanspirit.com/`）。

## Project Structure

```
scripts/          # 实用脚本
  gitlab-proxy.sh       # GitLab 代理开关
skills/           # AI 相关 skills（持续补充中）
eslint.config.js  # ESLint 配置 (ESM)
.claude/skills/gitlab-sync/SKILL.md  # GitLab 同步 skill
```

## Notes

- `.omc/` 和 `node_modules/` 在 `.gitignore` 中，不会被提交
- `.idea/` 目录包含 IntelliJ IDEA 配置，已纳入版本控制
- 当前无测试框架，`pnpm test` 会报错退出
