#!/bin/bash
# 一键提交到 GitLab
# 用法: ./scripts/commit-to-gitlab.sh [提交信息]

set -e

MSG="${1:-chore: update}"

echo "=== GitLab 提交 ==="
echo "提交信息: $MSG"

git add -A
git commit -m "$MSG" || echo "没有需要提交的改动"
git push origin main

echo "=== 完成 ==="
