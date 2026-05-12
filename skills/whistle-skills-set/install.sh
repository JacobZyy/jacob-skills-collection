#!/usr/bin/env bash
set -euo pipefail

# Whistle Skills Set Installer
# 支持 4 种平台的 skill 安装：cc-switch / Claude Code / Codex / Gemini CLI

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILLS=(
  whistle-quickstart
  whistle-rules
  whistle-proxy
  whistle-rewrite
  whistle-advanced
  whistle-rules-inject
)

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*"; }

usage() {
  cat <<EOF
用法: bash install.sh [选项]

选项:
  --target <平台>   目标平台: cc-switch | claude | codex | gemini
                    不指定则自动检测

示例:
  bash install.sh                    # 自动检测
  bash install.sh --target claude    # 安装到 Claude Code
EOF
  exit 0
}

# 解析参数
TARGET=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --target) TARGET="$2"; shift 2 ;;
    --help|-h) usage ;;
    *) error "未知参数: $1"; usage ;;
  esac
done

# 自动检测平台
detect_platform() {
  # 检测 cc-switch
  if [ -d "$HOME/.cc-switch/skills" ]; then
    echo "cc-switch"
    return
  fi
  # 检测 Claude Code
  if [ -d "$HOME/.claude" ] && command -v claude &>/dev/null; then
    echo "claude"
    return
  fi
  # 检测 Gemini CLI
  if [ -d "$HOME/.gemini" ] || command -v gemini &>/dev/null; then
    echo "gemini"
    return
  fi
  # 检测 Codex
  if [ -d "$HOME/.codex" ] || command -v codex &>/dev/null; then
    echo "codex"
    return
  fi
  echo ""
}

resolve_target_dir() {
  case "$1" in
    cc-switch) echo "$HOME/.cc-switch/skills" ;;
    claude)    echo "$HOME/.claude/skills" ;;
    codex)     echo "$HOME/.codex/skills" ;;
    gemini)    echo "$HOME/.gemini/skills" ;;
    *)
      error "不支持的平台: $1 (支持: cc-switch, claude, codex, gemini)"
      exit 1
      ;;
  esac
}

if [ -z "$TARGET" ]; then
  info "未指定平台，自动检测..."
  TARGET=$(detect_platform)
  if [ -z "$TARGET" ]; then
    error "未检测到任何支持的平台。请使用 --target 手动指定。"
    echo ""
    echo "支持的平台: cc-switch, claude, codex, gemini"
    exit 1
  fi
  info "自动检测到平台: $TARGET"
fi

TARGET_DIR=$(resolve_target_dir "$TARGET")

info "平台: $TARGET"
info "安装目录: $TARGET_DIR"

# 创建目标目录
mkdir -p "$TARGET_DIR"

# 逐 skill 安装
INSTALLED=0
for skill in "${SKILLS[@]}"; do
  SRC="$SCRIPT_DIR/$skill"
  DST="$TARGET_DIR/$skill"

  if [ ! -d "$SRC" ]; then
    warn "跳过 $skill（源目录不存在: $SRC）"
    continue
  fi

  # 如果目标已存在，先备份（copy-then-rename，避免 cp 失败时丢失旧版）
  if [ -e "$DST" ]; then
    BACKUP="$DST.bak.$(date +%Y%m%d%H%M%S)"
    cp -r "$DST" "$BACKUP" && rm -rf "$DST"
    info "备份旧版本: $BACKUP"
  fi

  cp -r "$SRC" "$DST"
  info "已安装: $skill"
  INSTALLED=$((INSTALLED + 1))
done

# 检查 Python 依赖
NEEDS_PYTHON=false
PYTHON_SCRIPTS="$TARGET_DIR/whistle-rules-inject/scripts"
if [ -d "$PYTHON_SCRIPTS" ]; then
  for f in "$PYTHON_SCRIPTS"/*.py; do
    if [ -f "$f" ]; then
      NEEDS_PYTHON=true
      break
    fi
  done
fi

echo ""
echo "============================================"
info "安装完成！已安装 $INSTALLED/${#SKILLS[@]} 个 skill"
echo ""
echo "安装位置: $TARGET_DIR"

if $NEEDS_PYTHON; then
  echo ""
  warn "whistle-rules-inject 依赖 Python 3，请确认 Python 可用:"
  echo "    python3 --version"
fi

echo ""
echo "现在可以在 AI 助手中使用 whistle 相关功能了。"
echo "尝试输入: '帮我给 api.example.com 配一个 mock 返回'"
echo "============================================"
