#!/usr/bin/env bash
# Usage (GH_TOKEN set): post-paired-pointer.sh <repo> <pr-number> <marker> <paired-pr-ref> <pending|reviewed> <login of the GH_TOKEN identity>
set -euo pipefail

repo="$1"
pr="$2"
marker="$3"
paired="$4"
state="$5"
bot_login="$6"

case "$state" in
  pending)
    note="> This branch has a paired enterprise PR, **$paired**. Both PRs are reviewed together there once it is out of draft and carries \`ready-for-ci\`, so this PR is not reviewed separately." ;;
  reviewed)
    note="> This branch has a paired enterprise PR, **$paired**. Both PRs are reviewed together there, so this PR is not reviewed separately. Findings for files in this repository are listed there under \`openobserve/\`." ;;
  *)
    echo "unknown state: $state" >&2
    exit 2 ;;
esac

body="$marker
<!-- o2-paired-pointer -->
## 🔎 OpenObserve Code Review

> [!NOTE]
$note"

comment_id="$(gh api "repos/$repo/issues/$pr/comments" --paginate \
  | jq -rs --arg m "$marker" --arg login "$bot_login" '[.[][] | select(.user.login == $login and (.body | contains($m))) | .id] | last // empty')"
if [ -n "$comment_id" ]; then
  gh api -X PATCH "repos/$repo/issues/comments/$comment_id" -f body="$body" > /dev/null
else
  gh api -X POST "repos/$repo/issues/$pr/comments" -f body="$body" > /dev/null
fi
