#!/usr/bin/env bash
# verify-ac7.sh — AC-7 reproducibility gate
#
# AC-7: deleting the SQLite DB MUST reproduce row counts after a fresh boot.
# The claim is "DB is a derived cache; source of truth is on-disk JSONL".
# If the runner can re-walk every project and rebuild the same tables, the
# claim holds.
#
# Flow:
#   1. Read current row counts for ChatMessage / Attachment / Session /
#      Project from "$DB".
#   2. Delete "$DB" + WAL siblings ("$DB-shm", "$DB-wal").
#   3. Spawn `bun run apps/server/src/index.ts` as a background process,
#      piping stdout/stderr to a temp log.
#   4. Tail the log until "[catch-up] complete" appears (or timeout).
#   5. Re-read row counts.
#   6. For each table compute |new - old| / max(old, 1). If any exceeds
#      0.005 (0.5%) the script exits 1 with a per-table diff dump.
#
# Why ±0.5% tolerance:
#   The user may be running claude-code while this script runs — a session
#   appended mid-rebuild legitimately bumps counts. 0.5% covers that drift
#   without masking a real reconstruction bug.
#
# Safety:
#   This script DELETES the global DB. To prevent accidental local data loss
#   the script refuses to run unless `--yes` is passed OR
#   `AI_CHAT_VIEWER_VERIFY_AC7_CONFIRM=1` is in the env.
#
# Usage:
#   bash scripts/verify-ac7.sh --yes
#   AI_CHAT_VIEWER_VERIFY_AC7_CONFIRM=1 bash scripts/verify-ac7.sh
#
# Exits non-zero on any mismatch, missing dependency, or server failure.

set -euo pipefail

# ---------------------------------------------------------------------------
# Confirmation gate — destructive op, fail-closed by default.
# ---------------------------------------------------------------------------
case "${1:-}" in
  --yes) ;;
  "")
    if [[ "${AI_CHAT_VIEWER_VERIFY_AC7_CONFIRM:-}" != "1" ]]; then
      cat >&2 <<EOF
[ac7] REFUSING to run: this script DELETES the global SQLite DB at:
      \$HOME/Library/Application Support/ai-chat-viewer/db.sqlite

      To proceed, re-run with --yes or set
      AI_CHAT_VIEWER_VERIFY_AC7_CONFIRM=1 in the env.
EOF
      exit 2
    fi
    ;;
  *)
    echo "usage: $0 [--yes]" >&2
    exit 2
    ;;
esac

# ---------------------------------------------------------------------------
# Paths. The DB path embeds a literal space ("Application Support") so EVERY
# reference is double-quoted. shellcheck would otherwise flag word-splitting.
# ---------------------------------------------------------------------------
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

DB="$HOME/Library/Application Support/ai-chat-viewer/db.sqlite"
SERVER_LOG="$(mktemp -t ai-chat-viewer-ac7-server.XXXXXX.log)"
SERVER_PID=""

# ---------------------------------------------------------------------------
# Cleanup. trap fires on EVERY exit path, including SIGINT.
# We must NOT clobber the script's exit code — trap restores it after kill.
# ---------------------------------------------------------------------------
cleanup() {
  local rc=$?
  if [[ -n "$SERVER_PID" ]] && kill -0 "$SERVER_PID" 2>/dev/null; then
    kill "$SERVER_PID" 2>/dev/null || true
    # Give the process a beat to flush stdio before SIGKILL.
    for _ in 1 2 3 4 5; do
      kill -0 "$SERVER_PID" 2>/dev/null || break
      sleep 0.1
    done
    kill -9 "$SERVER_PID" 2>/dev/null || true
  fi
  if [[ $rc -ne 0 && -s "$SERVER_LOG" ]]; then
    echo "[ac7] server log (last 60 lines):" >&2
    tail -n 60 "$SERVER_LOG" >&2 || true
  fi
  rm -f "$SERVER_LOG"
  exit "$rc"
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Sanity: required tools.
# ---------------------------------------------------------------------------
for bin in sqlite3 bun awk; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[ac7] FAIL: missing dependency \`$bin\` on PATH" >&2
    exit 2
  fi
done

# ---------------------------------------------------------------------------
# Row count for one table. Returns 0 if DB is missing (post-delete state).
# Quoted everywhere because $DB has a space.
# ---------------------------------------------------------------------------
count_table() {
  local table="$1"
  if [[ ! -f "$DB" ]]; then
    echo 0
    return 0
  fi
  # sqlite3 prints the number directly when fed -batch. -readonly avoids
  # creating the DB if it somehow vanished between checks.
  sqlite3 -batch -readonly "$DB" "SELECT COUNT(*) FROM $table;"
}

# Snapshot all four tables. We read once to avoid race with the user's
# claude-code writing to disk between calls.
if [[ ! -f "$DB" ]]; then
  echo "[ac7] FAIL: DB does not exist at \"$DB\" — nothing to verify" >&2
  echo "[ac7] hint: run \`bun run apps/server\` once to seed it, then re-run" >&2
  exit 1
fi

echo "[ac7] reading baseline counts from \"$DB\""
OLD_MSG=$(count_table "ChatMessage")
OLD_ATT=$(count_table "Attachment")
OLD_SES=$(count_table "Session")
OLD_PRJ=$(count_table "Project")
echo "[ac7] baseline: ChatMessage=$OLD_MSG Attachment=$OLD_ATT Session=$OLD_SES Project=$OLD_PRJ"

# ---------------------------------------------------------------------------
# Delete the DB + WAL siblings. WAL mode creates `-shm` (shared memory) and
# `-wal` (write-ahead log) sidecars; leaving either behind makes the next
# Prisma boot try to replay an uncommitted transaction against an empty DB,
# which surfaces as a confusing "no such table" error.
# ---------------------------------------------------------------------------
echo "[ac7] deleting DB + WAL siblings"
rm -f "$DB" "$DB-shm" "$DB-wal"

# ---------------------------------------------------------------------------
# Spawn the server. We run `bun run src/index.ts` directly from apps/server
# so the cwd matches what `bun dev` uses (relative imports / prisma client
# generation rely on it). stdout+stderr → SERVER_LOG so we can tail-grep.
# ---------------------------------------------------------------------------
echo "[ac7] spawning server (log → $SERVER_LOG)"
(
  cd "$REPO_ROOT/apps/server"
  exec bun run src/index.ts
) >"$SERVER_LOG" 2>&1 &
SERVER_PID=$!

# ---------------------------------------------------------------------------
# Wait for "[catch-up] complete". AC-2 budgets 60s; we give 90s as a buffer
# (catch-up wallclock is bounded by disk IO, not the test budget). Exit 1
# if we timeout — the server log dump in cleanup will surface the cause.
# ---------------------------------------------------------------------------
WAIT_BUDGET_S=90
WAITED=0
echo "[ac7] waiting up to ${WAIT_BUDGET_S}s for [catch-up] complete"
while :; do
  if grep -q "\[catch-up\] complete" "$SERVER_LOG" 2>/dev/null; then
    break
  fi
  # If the server died (PID gone), no point waiting further.
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "[ac7] FAIL: server exited before catch-up completed" >&2
    exit 1
  fi
  if (( WAITED >= WAIT_BUDGET_S )); then
    echo "[ac7] FAIL: timeout waiting for [catch-up] complete after ${WAIT_BUDGET_S}s" >&2
    exit 1
  fi
  sleep 1
  WAITED=$((WAITED + 1))
done
echo "[ac7] catch-up complete after ${WAITED}s"

# ---------------------------------------------------------------------------
# Re-snapshot. We do NOT kill the server first — Prisma flushes WAL on
# transaction commit, and the runner commits per-session, so reads are
# consistent without a shutdown. Killing first would force Prisma to
# checkpoint, which is unnecessary work.
# ---------------------------------------------------------------------------
NEW_MSG=$(count_table "ChatMessage")
NEW_ATT=$(count_table "Attachment")
NEW_SES=$(count_table "Session")
NEW_PRJ=$(count_table "Project")
echo "[ac7] rebuilt: ChatMessage=$NEW_MSG Attachment=$NEW_ATT Session=$NEW_SES Project=$NEW_PRJ"

# ---------------------------------------------------------------------------
# Tolerance check. We use awk for float math (POSIX-portable, no `bc`
# dep). Returns the integer 1 if the table is within tolerance, 0
# otherwise — bash arithmetic can then branch on it.
# ---------------------------------------------------------------------------
within_tolerance() {
  local old="$1" new="$2"
  awk -v o="$old" -v n="$new" 'BEGIN {
    denom = (o > 1 ? o : 1);
    diff = n - o; if (diff < 0) diff = -diff;
    print (diff / denom <= 0.005) ? 1 : 0;
  }'
}

FAILED_TABLES=()
for pair in "ChatMessage:$OLD_MSG:$NEW_MSG" \
            "Attachment:$OLD_ATT:$NEW_ATT" \
            "Session:$OLD_SES:$NEW_SES" \
            "Project:$OLD_PRJ:$NEW_PRJ"; do
  IFS=":" read -r table old new <<<"$pair"
  ok=$(within_tolerance "$old" "$new")
  if [[ "$ok" != "1" ]]; then
    FAILED_TABLES+=("$table: old=$old new=$new")
  fi
done

if (( ${#FAILED_TABLES[@]} > 0 )); then
  echo "[ac7] FAIL: row count drift exceeds 0.5%" >&2
  for line in "${FAILED_TABLES[@]}"; do
    echo "[ac7]   $line" >&2
  done
  exit 1
fi

echo "[ac7] OK: rows match: ChatMessage=$NEW_MSG Attachment=$NEW_ATT Session=$NEW_SES Project=$NEW_PRJ"
