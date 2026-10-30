#!/usr/bin/env bash
# Usage: no-close-check.sh [file...] (stdin when none) — exit 1 when a GitHub closing keyword references an issue.
set -euo pipefail

# Markdown emphasis/code/link wrappers around the keyword or the reference still close the issue.
W='[*_~`]*'
RE="(^|[^[:alnum:]_])${W}(close[sd]?|fix(e[sd])?|resolve[sd]?)${W}:?${W}[[:space:]]+${W}\\[?${W}(([[:alnum:]_.-]+(/[[:alnum:]_.-]+)?)?#[0-9]+|https://github\\.com/[^[:space:]]+/issues/[0-9]+)"

check() {
  local name="$1" text
  # Newlines are folded so a keyword split from its reference by a line break still counts.
  text=$(tr '\n\r' '  ')
  if grep -Eiq "$RE" <<<"$text"; then
    echo "closing keyword found in $name: $(grep -Eio "$RE" <<<"$text" | head -1)" >&2
    return 1
  fi
}

HIT=0
if [ "$#" -eq 0 ]; then
  check stdin || HIT=1
else
  for f in "$@"; do name="$(basename "$f")"; check "$name" <"$f" || HIT=1; done
fi
exit "$HIT"
