#!/usr/bin/env bash
# Copyright 2026 OpenObserve Inc.
# Regenerates the quantitative numbers in web/SPACING_AUDIT.md.
# Usage: bash web/scripts/spacing-audit.sh   (requires ripgrep + python3)
# Writes per-category lists to /tmp/spacing_audit_*.txt
set -euo pipefail
cd "$(dirname "$0")/../src"

# ripgrep: use the real binary, or fall back to the one bundled with Claude Code
if ! command -v rg >/dev/null 2>&1; then
  _cc="${CLAUDE_CODE_EXECPATH:-$HOME/.local/bin/claude}"
  if [[ -x "$_cc" ]]; then
    rg() { ( exec -a rg "$_cc" "$@" ); }
  else
    echo "ripgrep (rg) is required: brew install ripgrep" >&2; exit 1
  fi
fi

OUT=/tmp
EXCL=(-g '!*.spec.*' -g '!test/**' -g '!__mocks__/**' -g '!assets/dashboard/echarts.min.js')
PROPS='(?:p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y)'

echo "== 1. Tailwind spacing utility histogram =="
rg -o --no-filename -g '*.vue' "${EXCL[@]}" "\\b${PROPS}-(?:\\d+(?:\\.\\d+)?|\\[[^\\]]+\\])" \
  | sort | uniq -c | sort -rn > "$OUT/spacing_audit_utilities.txt"
awk '{s+=$1} END {print "total:", s, "distinct:", NR}' "$OUT/spacing_audit_utilities.txt"

echo "== 2. Scale-step histogram (props aggregated) =="
awk '{n=$1; cls=$2; sub(/^[a-z-]+-/,"",cls); steps[cls]+=n} END {for (s in steps) print steps[s], s}' \
  "$OUT/spacing_audit_utilities.txt" | grep -v ' \[' | sort -rn | tee "$OUT/spacing_audit_steps.txt"

echo "== 3. Arbitrary values: convertible vs off-grid =="
grep ' \S*\[' "$OUT/spacing_audit_utilities.txt" > "$OUT/spacing_audit_arbitrary.txt" || true
python3 - "$OUT/spacing_audit_arbitrary.txt" <<'EOF'
import re, sys
conv=off=pxv=other=0; offs=[]
for line in open(sys.argv[1]):
    n, cls = int(line.split()[0]), line.split()[1]
    m = re.search(r'\[([0-9.]+)rem\]', cls)
    if m:
        suffix = float(m.group(1)) / 0.25
        if abs(suffix*4 - round(suffix*4)) < 1e-9: conv += n
        else: off += n; offs.append((n, cls))
    elif re.search(r'\[[0-9.]+px\]', cls): pxv += n
    else: other += n
print("convertible-to-class:", conv, "| off-grid:", off, "| px:", pxv, "| other:", other)
for n, c in sorted(offs, reverse=True): print(f"  {n:4d} {c}")
EOF

echo "== 4. CSS padding/margin declarations =="
rg -o --no-filename -g '*.vue' -g '*.css' -g '*.scss' "${EXCL[@]}" -g '!lib/styles/tokens/**' \
  '(?:padding|margin)(?:-(?:top|right|bottom|left))?\s*:\s*[^;}"]+' \
  | sed 's/\s\+/ /g' | sort | uniq -c | sort -rn > "$OUT/spacing_audit_css.txt"
awk '{s+=$1} END {print "total:", s, "distinct:", NR}' "$OUT/spacing_audit_css.txt"

echo "== 5. Spacing token adoption =="
printf 'var(--spacing-*) outside token files: '
rg --no-filename -g '!lib/styles/tokens/**' -g '!*.spec.*' 'var\(--spacing-' | wc -l | tr -d ' '

echo "== 6. Top files by arbitrary spacing =="
rg -c -g '*.vue' "${EXCL[@]}" "\\b${PROPS}-\\[[^\\]]+\\]" | sort -t: -k2 -rn | head -15
