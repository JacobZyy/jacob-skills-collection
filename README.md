# jacob-skills-collection

个人 AI 相关工具合集仓库。

## 简介

这是一个收集和整理我个人开发的 AI 相关工具、脚本和配置的仓库。

## 内容

- `scripts/` — 实用脚本（GitLab 代理开关等）
- `skills/` — AI 相关 skills（持续补充中）

## 仓库配置

- **GitHub（主仓库）**: `https://github.com/JacobZyy/jacob-skills-collection`
  - `origin` 指向 GitHub
  - 普通 `git push` 只同步到 GitHub
- **GitLab（公司备份）**: `https://gitlab.zhuanspirit.com/zhayang/jacob-open-source`
  - 通过 `gitlab-sync` skill 临时切换推送

## 双仓库提交

- **普通提交**（仅 GitHub）：`git add -A && git commit -m "msg" && git push origin main`
- **同步 GitLab 备份**：使用 `gitlab-sync` skill（`.claude/skills/gitlab-sync/SKILL.md`）

## GitLab 代理开关

公司内网访问 GitLab 需要代理时：

```bash
# 查看状态
pnpm proxy:status

# 开启代理
pnpm proxy:on

# 关闭代理
pnpm proxy:off
```

## 使用

```bash
git clone https://github.com/JacobZyy/jacob-skills-collection.git
```
