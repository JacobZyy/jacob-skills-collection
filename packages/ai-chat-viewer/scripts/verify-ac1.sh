#!/usr/bin/env bash
# verify-ac1.sh — AC-1 bun dev 双端口 200 校验。
#
# 验证 bun dev 启动后，server (3001) 和 web (5173) 都能返回 HTTP 200。
# Usage: bash scripts/verify-ac1.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_URL="http://127.0.0.1:3001/health"
WEB_URL="http://127.0.0.1:5173/"
MAX_WAIT_SECONDS=60

# Wait for a URL to return 200.
wait_for_200() {
  local url=$1
  local name=$2
  local waited=0

  echo "[ac1] waiting for $name at $url ..."
  while true; do
    local code
    code=$(curl -s -o /dev/null -w "%{http_code}" "$url" 2>/dev/null || echo "000")
    if [ "$code" = "200" ]; then
      echo "[ac1] $name ready (200) after ${waited}s"
      return 0
    fi
    if [ "$waited" -ge "$MAX_WAIT_SECONDS" ]; then
      echo "[ac1] FAIL: $name did not return 200 within ${MAX_WAIT_SECONDS}s (last code=$code)"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

echo "[ac1] AC-1 verify: checking both ports return 200"

wait_for_200 "$SERVER_URL" "server(3001)"
wait_for_200 "$WEB_URL" "web(5173)"

echo "[ac1] PASS: both ports return 200"
