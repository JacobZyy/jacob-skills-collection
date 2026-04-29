#!/bin/bash
# 一键提交到 GitLab（临时切换 remote，完成后切回 GitHub）
# 用法: ./scripts/commit-to-gitlab.sh [提交信息]

set -e

MSG="${1:-chore: update}"
GITHUB_URL="https://github.com/JacobZyy/jacob-skills-collection.git"
GITLAB_URL="https://gitlab.zhuanspirit.com/zhayang/jacob-open-source.git"

echo "=== GitLab 提交 ==="
echo "提交信息: $MSG"

# 1. 提交到 GitHub（主仓库）
git add -A
git commit -m "$MSG" || echo "没有需要提交的改动"
git push origin main

# 2. 临时切到 GitLab，同步并推送
echo "=== 同步到 GitLab ==="
git remote set-url origin "$GITLAB_URL"
git pull origin main --rebase 2>/dev/null || true
git push origin main

# 3. 切回 GitHub
git remote set-url origin "$GITHUB_URL"
echo "=== 已切回 GitHub origin ==="
echo "=== 完成 ==="
