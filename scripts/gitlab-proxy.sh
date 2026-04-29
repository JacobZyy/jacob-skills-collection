#!/bin/bash
# GitLab 代理开关脚本
# 用法: ./scripts/gitlab-proxy.sh [on|off|status]

PROXY_URL="http://127.0.0.1:12639"
GITLAB_HOST="https://gitlab.zhuanspirit.com/"
CONFIG_KEY="http.${GITLAB_HOST}.proxy"

status() {
  local current
  current=$(git config --local "${CONFIG_KEY}" 2>/dev/null)
  if [ -n "$current" ]; then
    echo "GitLab proxy: ON ($current)"
  else
    echo "GitLab proxy: OFF"
  fi
}

turn_on() {
  git config --local "${CONFIG_KEY}" "$PROXY_URL"
  echo "GitLab proxy: ON ($PROXY_URL)"
}

turn_off() {
  git config --local --unset "${CONFIG_KEY}" 2>/dev/null || true
  echo "GitLab proxy: OFF"
}

case "${1:-status}" in
  on)
    turn_on
    ;;
  off)
    turn_off
    ;;
  status|*)
    status
    ;;
esac
