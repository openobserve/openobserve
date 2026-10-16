#!/usr/bin/env bash
# Usage: scope-check.sh <worktree> <allowed_paths_file> [base] — exit 0 in scope, 1 out of scope (reasons on stdout). Read-only.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

TARGET_DIR="${1:-}"; ALLOWED="${2:-}"; BASE="${3:-origin/main}"
MAX_EXTRA="${MAX_EXTRA:-2}"
MAX_LINES="${MAX_LINES:-300}"
[ -d "$TARGET_DIR" ] && [ -f "$ALLOWED" ] || { echo "usage: scope-check.sh <worktree> <allowed_paths_file> [base]" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROTECTED="$(node "$HERE/triage-rules.mjs" protected-regex)"
# Lint, format and test configs are not in the triage list because no bug report names them, but a fix must not change them.
PROTECTED="($PROTECTED)|(^|/)(clippy\.toml|rustfmt\.toml|deny\.toml|\.prettierrc[^/]*|\.eslintrc[^/]*|\.gitignore|\.gitattributes|\.nvmrc)$"
# Test files may always change: web specs per vitest.config include, Rust tests/ dirs and tests modules, pytest files.
TEST_RE='^web/src/.+\.spec\.(ts|js|vue)$|(^|/)tests/.+\.rs$|(^|/)tests?\.rs$|_tests?\.rs$|(^|/)tests/.*test_[^/]+\.py$'

cd "$TARGET_DIR"
MB="$(git merge-base "$BASE" HEAD)"
FAIL=()
STATUS="$(git diff --no-renames --name-status "$MB" --)"
UNTRACKED="$(git ls-files --others --exclude-standard)"
[ -z "$UNTRACKED" ] || FAIL+=("untracked files are not part of the change: $(paste -sd, - <<<"$UNTRACKED")")
if [ -z "$STATUS" ]; then
  echo "scope: no files changed against $BASE"
  exit 1
fi

DELETED=$(awk '$1 != "A" && $1 != "M" {print $2}' <<<"$STATUS" | paste -sd, -)
[ -z "$DELETED" ] || FAIL+=("deleting or retyping files is not allowed: $DELETED")

is_allowed() {
  local f="$1" p
  while IFS= read -r p || [ -n "$p" ]; do
    p="${p%/}"
    [ -n "$p" ] || continue
    if [ "$f" = "$p" ]; then return 0; fi
  done <"$ALLOWED"
  return 1
}

EXTRA=()
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if grep -Eiq "$PROTECTED" <<<"$f"; then FAIL+=("protected file changed: $f"); continue; fi
  if is_allowed "$f" || grep -Eq "$TEST_RE" <<<"$f"; then continue; fi
  EXTRA+=("$f")
done < <(cut -f2 <<<"$STATUS")
if [ "${#EXTRA[@]}" -gt "$MAX_EXTRA" ]; then
  FAIL+=("${#EXTRA[@]} files outside the accepted items' paths (max $MAX_EXTRA): ${EXTRA[*]}")
fi

NUMSTAT="$(git diff --no-renames --numstat "$MB" --)"
if awk '$1 == "-" {bad=1} END {exit !bad}' <<<"$NUMSTAT"; then FAIL+=("binary file changes are not allowed"); fi
LINES=$(awk '{s += $1 + $2} END {print s + 0}' <<<"$NUMSTAT")
[ "$LINES" -le "$MAX_LINES" ] || FAIL+=("$LINES changed lines (max $MAX_LINES)")

if [ "${#FAIL[@]}" -gt 0 ]; then
  printf 'scope: %s\n' "${FAIL[@]}"
  exit 1
fi
echo "scope: ok — $(wc -l <<<"$STATUS" | tr -d ' ') file(s), $LINES line(s), ${#EXTRA[@]} extra${EXTRA[*]:+: ${EXTRA[*]}}"
