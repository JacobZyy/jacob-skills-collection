#!/usr/bin/env bash
# CI guard: ensure tool-specific identifiers/literals never leak through the
# domain-level @ai-chat-viewer/schema barrel.
#
# What we check
#   Files under packages/schema/ (root barrel + any sub-modules), with all
#   line-comments (`// ...`) and block-comments (`/* ... */`) stripped, must
#   not contain any tool-specific banned identifier or line-type literal.
#
# Banned identifiers (substring match, case-sensitive):
#   ClaudeCode (PascalCase types/schemas), claudeCode (camelCase vars), JSONL
#
# NOTE: the bare string "claude-code" is INTENTIONALLY allowed — it is the
# v1 `tool` discriminator value (`z.literal('claude-code')`) per the spec.
# We ban the identifier *forms* used for tool-specific types/schemas, not
# the domain-level discriminator literal.
#
# Banned line-type / block-type literal strings (whole-token, in quotes):
#   "permission-mode", "last-prompt", "file-history-snapshot",
#   "queue-operation", "tool_use", "tool_result", "thinking"
#
# Why role enum stays allowed
#   The strings "user", "assistant", "system" are legitimate domain-level
#   role names (MessageRoleSchema) and are NOT in the banlist.
#
# Exit codes
#   0 = clean
#   1 = banned content detected (build should fail)

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCHEMA_DIR="$ROOT/packages/schema"

if [[ ! -d "$SCHEMA_DIR" ]]; then
  echo "check-schema-banlist: $SCHEMA_DIR not found" >&2
  exit 1
fi

# Collect all .ts files under packages/schema/, excluding tests + dist + node_modules.
# Use NUL-delimited reads for portability with macOS default bash 3.2 (no mapfile).
FILES=()
while IFS= read -r -d '' f; do
  FILES+=("$f")
done < <(find "$SCHEMA_DIR" \
  -type f \
  -name '*.ts' \
  ! -path '*/node_modules/*' \
  ! -path '*/dist/*' \
  ! -name '*.test.ts' \
  ! -name '*.spec.ts' \
  -print0)

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "check-schema-banlist: no .ts files under $SCHEMA_DIR" >&2
  exit 1
fi

# Patterns. Identifiers are substring; literals are quoted whole-token.
IDENT_PATTERN='ClaudeCode|claudeCode|JSONL'
LITERAL_PATTERN='"permission-mode"|"last-prompt"|"file-history-snapshot"|"queue-operation"|"tool_use"|"tool_result"|"thinking"'
COMBINED="${IDENT_PATTERN}|${LITERAL_PATTERN}"

violations=0

for file in "${FILES[@]}"; do
  # Strip comments before grepping. Order: block comments first, then line comments.
  # - Block comments via perl (handles multiline /* ... */).
  # - Line comments via sed (only `//` outside of strings is non-trivial; we
  #   accept the simplification because schema files don't embed `//` in strings).
  stripped="$(perl -0777 -pe 's{/\*.*?\*/}{}gs' "$file" | sed -E 's://.*$::')"

  if matches="$(printf '%s' "$stripped" | grep -nE "$COMBINED" || true)"; [[ -n "$matches" ]]; then
    echo "check-schema-banlist: BANNED content in ${file#$ROOT/}:"
    while IFS= read -r line; do
      printf '  %s\n' "$line"
    done <<< "$matches"
    violations=$((violations + 1))
  fi
done

if [[ $violations -gt 0 ]]; then
  echo
  echo "check-schema-banlist: FAILED — $violations file(s) contain banned identifiers/literals." >&2
  echo "Tool-specific symbols belong under packages/ingestion/adapters/<tool>/, not in the domain schema barrel." >&2
  exit 1
fi

echo "check-schema-banlist: OK (${#FILES[@]} file(s) scanned, banlist clean)"
