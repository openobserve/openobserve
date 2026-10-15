#!/usr/bin/env bash
# Usage: gate-issue.sh [--hunt] <repo> <issue> <out_dir> — exit 0 pass, 10 skip (reason on stdout), else error; writes issue.json, body.md, comments.jsonl, me.txt. Read-only.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

HUNT=0
if [ "${1:-}" = "--hunt" ]; then HUNT=1; shift; fi
REPO="${1:-}"; ISSUE="${2:-}"; OUT="${3:-}"
load_private || exit 3
check_repo "$REPO" || exit 2
[[ "$ISSUE" =~ ^[0-9]{1,9}$ ]] || { echo "invalid issue number" >&2; exit 2; }
[ -n "$OUT" ] && [ -d "$OUT" ] || { echo "missing out dir" >&2; exit 2; }
MAX_BODY_BYTES="${MAX_BODY_BYTES:-100000}"
API="repos/openobserve/$REPO/issues/$ISSUE"

skip() { echo "$1"; exit 10; }

ME="${BB_ME:-$(gh api user -q .login)}"
[ -n "$ME" ] || { echo "gh is not logged in" >&2; exit 3; }
echo "$ME" > "$OUT/me.txt"

gh api "$API" > "$OUT/issue.json"
jq -e 'has("pull_request") | not' "$OUT/issue.json" >/dev/null || skip "is a pull request, not an issue"
[ "$(jq -r .state "$OUT/issue.json")" = "open" ] || skip "issue is closed"
jq -e '[.labels[].name] | index("bug-me-not")' "$OUT/issue.json" >/dev/null || skip "no bug-me-not label"
if [ "$HUNT" -eq 1 ]; then
  jq -e '[.labels[].name] | index("autofix")' "$OUT/issue.json" >/dev/null || skip "no autofix label (not triaged as a bounty)"
  jq -e '[.labels[].name] | index("autofix-failed") | not' "$OUT/issue.json" >/dev/null || skip "labelled autofix-failed"
fi
[ "$(jq -j '.body // ""' "$OUT/issue.json" | wc -c)" -le "$MAX_BODY_BYTES" ] || skip "issue body is larger than $MAX_BODY_BYTES bytes"
jq -j '.body // ""' "$OUT/issue.json" > "$OUT/body.md"

gh api --paginate "$API/comments?per_page=100" \
  --jq '.[] | {user: .user.login, author_association, created_at, body}' > "$OUT/comments.jsonl"

# A testing-stage label (Needs-Testing, Testing-InProgress, Testing-Completed, Test-Assist-*, Retested-Failed) means a fix already exists.
IN_TESTING=$(jq -r '[.labels[].name | select(test("testing|retested|verified"; "i"))] | join(",")' "$OUT/issue.json")
[ -z "$IN_TESTING" ] || skip "already in testing: $IN_TESTING"
AUTHOR=$(jq -r .user.login "$OUT/issue.json")

# shellcheck disable=SC2016
QUERY='query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){issue(number:$number){
  lastEditedAt editor{login}
  timelineItems(last:100,itemTypes:[CROSS_REFERENCED_EVENT,CONNECTED_EVENT]){nodes{
    __typename
    ... on CrossReferencedEvent{source{... on PullRequest{url state}}}
    ... on ConnectedEvent{subject{... on PullRequest{url state}}}}}}}}'
gh api graphql -f query="$QUERY" -F owner=openobserve -F name="$REPO" -F number="$ISSUE" > "$OUT/issue-graph.json"
jq -e '.data.repository.issue' "$OUT/issue-graph.json" >/dev/null || { echo "graphql lookup failed" >&2; exit 3; }

# A body rewritten by a third person is a public-repo injection vector; BB_ALLOW_EDITOR accepts one named editor after a human read it.
EDITOR=$(jq -r '.data.repository.issue | if .lastEditedAt then (.editor.login // "ghost") else "" end' "$OUT/issue-graph.json")
if [ -n "$EDITOR" ] && [ "$EDITOR" != "$AUTHOR" ] && [ "$EDITOR" != "$ME" ] && [ "$EDITOR" != "${BB_ALLOW_EDITOR:-}" ]; then
  skip "issue body was last edited by $EDITOR (not the author or you)"
fi

OPEN_PRS=$(jq -r '[.data.repository.issue.timelineItems.nodes[] | (.source // .subject // {})
  | select(.state == "OPEN") | .url] | unique | join(" ")' "$OUT/issue-graph.json")
[ -z "$OPEN_PRS" ] || skip "an open PR is linked to it: $OPEN_PRS"

# Any autofix PR, even closed or merged, means the issue was already hunted.
BRANCH="autofix/$REPO-issue-$ISSUE"
for T in "${REPOS[@]}"; do
  HUNTED=$(gh pr list -R "openobserve/$T" --head "$BRANCH" --state all --limit 1 --json url --jq '.[0].url // ""')
  [ -z "$HUNTED" ] || skip "already hunted: $HUNTED"
done
exit 0
