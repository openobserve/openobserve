#!/usr/bin/env bash
# Usage: list-bounties.sh [work_dir] — one JSON line per open, claimable bounty in openobserve and the private repo (if configured); skipped issues go to stderr. Read-only.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
load_private
WORK="${1:-}"
if [ -z "$WORK" ]; then WORK="$(bb_mktemp)" || { echo "could not create a temp dir" >&2; exit 3; }; fi
mkdir -p "$WORK"
BB_ME="$(gh api user -q .login)"
export BB_ME
NOW="$(date +%s)"

for REPO in "${REPOS[@]}"; do
  gh issue list -R "openobserve/$REPO" --state open --label bug-me-not --label autofix --limit 200 \
    --json number,title,createdAt,labels \
    --jq '.[] | select([.labels[].name] | index("autofix-failed") | not) | [(.number | tostring), .createdAt, (.title | gsub("[\t\r\n]"; " "))] | join("\t")' \
    > "$WORK/$REPO.tsv"
  while IFS=$'\t' read -r N CREATED TITLE; do
    D="$WORK/$REPO-$N"
    mkdir -p "$D"
    set +e
    REASON="$("$HERE/gate-issue.sh" --hunt "$REPO" "$N" "$D")"
    RC=$?
    set -e
    if [ "$RC" -eq 10 ]; then echo "skip $REPO#$N: $REASON" >&2; continue; fi
    if [ "$RC" -ne 0 ]; then echo "error $REPO#$N: gate exit $RC" >&2; continue; fi
    if ! node "$HERE/triage-rules.mjs" marker "$D/comments.jsonl" "$REPO" "$N" > "$D/marker.json"; then echo "error $REPO#$N: unreadable comments" >&2; continue; fi
    if [ "$(cat "$D/marker.json")" = "null" ]; then echo "skip $REPO#$N: autofix label but no trusted verdict marker" >&2; continue; fi
    if ! node "$HERE/parse-bug-items.mjs" "$D/body.md" > "$D/parsed.json" \
      || ! node "$HERE/triage-rules.mjs" hunt-items "$D/parsed.json" "$REPO" "$D/marker.json" > "$D/hunt.json"; then
      echo "error $REPO#$N: could not parse the issue body" >&2; continue
    fi
    if ! CREATED_S="$(date -j -u -f '%Y-%m-%dT%H:%M:%SZ' "$CREATED" +%s 2>/dev/null || date -u -d "$CREATED" +%s 2>/dev/null)"; then CREATED_S="$NOW"; fi
    AGE=$(( (NOW - CREATED_S) / 86400 ))
    jq -c --arg repo "$REPO" --argjson n "$N" --arg title "$TITLE" --argjson age "$AGE" '{
      repo: $repo, issue: $n, title: $title, age_days: $age,
      accepted: .accepted, dropped: .dropped, target_repo: .target_repo, body_changed: .body_changed,
      area: (if ([.items[].paths[]] | any(startswith("web/"))) then "ui" else "backend" end)
    }' "$D/hunt.json" || echo "error $REPO#$N: could not format the row" >&2
  done < "$WORK/$REPO.tsv"
done
