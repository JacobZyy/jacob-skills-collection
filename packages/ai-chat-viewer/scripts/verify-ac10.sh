#!/usr/bin/env bash
# verify-ac10.sh — AC-10 lint gate
#
# Two-pass enforcement:
#   1. oxlint with no-explicit-any denied (configured in .oxlintrc.json).
#      oxlint covers `: any` / `as any` / function param `any` / generic any.
#   2. grep audit for the literal pattern `as unknown as` — oxlint has no
#      dedicated rule for the double-assertion escape hatch in V1, so we
#      enforce it via a precise text match.
#
# Why both passes?
#   - oxlint catches the noisy form (`any`).
#   - The grep pass catches the surreptitious form (`as unknown as T`)
#     — explicitly banned by CLAUDE.md "能用类型体操解决的，禁止使用断言".
#
# Failure modes:
#   - oxlint exit non-zero  → AC-10 fail
#   - any `as unknown as` match in src → AC-10 fail
#
# Usage:
#   bash scripts/verify-ac10.sh             # main gate
#   bash scripts/verify-ac10.sh --self-check # sanity probe — must FAIL
#
# The self-check writes a temporary "dirty" file containing both `: any`
# and `as unknown as` and asserts that the script's main pass would reject
# it. Useful as a CI smoke test.
#
# Exits non-zero on any failure.

set -euo pipefail

# Resolve repo root regardless of where the script is invoked from.
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

# When run directly (not via bunx), node_modules/.bin/oxlint forwards its
# real exit code. bunx swallows it. We use the binary directly.
OXLINT_BIN="$REPO_ROOT/node_modules/.bin/oxlint"
if [[ ! -x "$OXLINT_BIN" ]]; then
  echo "[ac10] FAIL: oxlint binary missing at $OXLINT_BIN — run 'bun install' first" >&2
  exit 2
fi

# Lint scope: every workspace under apps/ and packages/. The .oxlintrc.json
# at repo root scopes ignorePatterns; we still pass explicit dirs so an
# accidental run from a subdir doesn't silently lint zero files.
LINT_TARGETS=(apps packages)

main_pass() {
  echo "[ac10] running oxlint over: ${LINT_TARGETS[*]}"
  "$OXLINT_BIN" "${LINT_TARGETS[@]}" -D no-explicit-any
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    echo "[ac10] FAIL: oxlint reported errors (exit=$rc)" >&2
    return $rc
  fi

  # Pass 2 — grep audit for `as unknown as`. We grep .ts and .tsx
  # explicitly; .d.ts files in dist are already excluded via ignorePattern
  # but grep doesn't honor that, so we exclude paths defensively.
  echo "[ac10] grep audit for \`as unknown as\`"
  local matches
  # Use --include for file types and --exclude-dir for excluded paths.
  # GNU grep semantics work on macOS via /usr/bin/grep too.
  matches=$(grep -RIn --include='*.ts' --include='*.tsx' \
    --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=.data \
    --exclude-dir=build --exclude-dir=coverage \
    --exclude-dir=migrations \
    'as unknown as' "${LINT_TARGETS[@]}" || true)
  if [[ -n "$matches" ]]; then
    echo "[ac10] FAIL: forbidden \`as unknown as\` found:" >&2
    echo "$matches" >&2
    echo "[ac10] hint: replace with type guard / DistributiveOmit / generic — see CLAUDE.md '能用类型体操解决的，禁止使用断言'" >&2
    return 1
  fi

  echo "[ac10] OK: oxlint clean and no \`as unknown as\` found"
}

self_check() {
  # Write a deliberately broken file in a repo-local sandbox dir and run
  # oxlint + grep on it. We do NOT touch real source. Sandbox lives under
  # `.ac10-self-check/` which is .gitignored. We use a repo-local path
  # because oxlint panics when given a file outside the gitignore root
  # (e.g. /tmp).
  #
  # Critical wiring detail: the main .oxlintrc.json includes
  # `.ac10-self-check/**` in its ignorePatterns so that a leftover sandbox
  # from a crashed previous run cannot poison the main pass. BUT that same
  # ignore would make the self-check meaningless ("No files found to lint"
  # produces a non-zero exit that LOOKS like a rule violation but proves
  # nothing). We sidestep this by handing oxlint its own minimal config
  # via `-c`, which DOES NOT carry the self-check ignore. That way the
  # rule actually evaluates the fixture and we observe a real diagnostic.
  local sandbox="$REPO_ROOT/.ac10-self-check"
  rm -rf "$sandbox"
  mkdir -p "$sandbox"
  trap "rm -rf '$sandbox'" EXIT

  cat > "$sandbox/dirty.ts" <<'EOF'
const x: any = 1;
const y = ({} as unknown as { foo: string });
console.log(x, y);
EOF

  # Minimal config for the self-check run only — no ignorePatterns so the
  # fixture is genuinely linted. Same rule, same deny level, isolated path.
  cat > "$sandbox/.oxlintrc.json" <<'EOF'
{
  "rules": { "no-explicit-any": "deny" }
}
EOF

  echo "[ac10:self-check] running oxlint on dirty fixture (must fail with a real diagnostic)"
  set +e
  # Capture stdout+stderr so we can assert oxlint actually emitted a
  # no-explicit-any diagnostic (not just exited non-zero for some other
  # reason like "no files found").
  local oxlint_out
  oxlint_out=$("$OXLINT_BIN" -c "$sandbox/.oxlintrc.json" "$sandbox/dirty.ts" 2>&1)
  local oxlint_rc=$?
  set -e
  echo "$oxlint_out"
  if [[ $oxlint_rc -eq 0 ]]; then
    echo "[ac10:self-check] FAIL: oxlint did NOT catch \`: any\` (exit=0) — rule miswired" >&2
    return 1
  fi
  # Belt-and-suspenders: require the diagnostic text. "No files found to
  # lint" also exits non-zero, and that would be a false pass.
  if ! grep -q 'no-explicit-any\|Unexpected `any`' <<<"$oxlint_out"; then
    echo "[ac10:self-check] FAIL: oxlint exited non-zero but did NOT report no-explicit-any" >&2
    echo "[ac10:self-check] output was:" >&2
    echo "$oxlint_out" >&2
    return 1
  fi
  echo "[ac10:self-check] OK: oxlint emitted no-explicit-any diagnostic (exit=$oxlint_rc)"

  echo "[ac10:self-check] running grep on dirty fixture (must match)"
  if ! grep -q 'as unknown as' "$sandbox/dirty.ts"; then
    echo "[ac10:self-check] FAIL: grep did NOT find \`as unknown as\` — script is broken" >&2
    return 1
  fi
  echo "[ac10:self-check] OK: grep found \`as unknown as\`"

  echo "[ac10:self-check] OK: lint gate is wired correctly"
}

case "${1:-}" in
  --self-check)
    self_check
    ;;
  "")
    main_pass
    ;;
  *)
    echo "usage: $0 [--self-check]" >&2
    exit 2
    ;;
esac
