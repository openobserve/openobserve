#!/usr/bin/env bash
# Usage: open-pr.sh [--dry-run] <worktree> <title-file> <body-file> <msg-file> — re-gates, scope-checks, squashes, pushes, opens the PR, comments the link.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

DRY=0
if [ "${1:-}" = "--dry-run" ]; then DRY=1; shift; fi
WT="${1:-}"; TITLE_FILE="${2:-}"; BODY_FILE="${3:-}"; MSG_FILE="${4:-}"
[ -d "$WT" ] && [ -f "$TITLE_FILE" ] && [ -f "$BODY_FILE" ] && [ -f "$MSG_FILE" ] || {
  echo "usage: open-pr.sh [--dry-run] <worktree> <title-file> <body-file> <msg-file>" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL="$(dirname "$HERE")"
die() { echo "open-pr: $1" >&2; exit "${2:-1}"; }

BRANCH="$(git -C "$WT" rev-parse --abbrev-ref HEAD)"
[[ "$BRANCH" =~ ^autofix/([A-Za-z0-9][A-Za-z0-9._-]*)-issue-([0-9]{1,9})$ ]] || die "worktree is not on an autofix/<repo>-issue-<n> branch: $BRANCH" 2
ISSUE_REPO="${BASH_REMATCH[1]}"; ISSUE="${BASH_REMATCH[2]}"
load_private || exit 3
check_repo "$ISSUE_REPO" || exit 2
TARGET="$(gh_repo_of "$WT")"
check_repo "$TARGET" || die "worktree origin is not openobserve/openobserve or the configured private repo" 2
[ -z "$(git -C "$WT" status --porcelain)" ] || die "worktree has uncommitted changes; finish the o2-loop round first"

W="$(bb_mktemp)" || die "could not create a temp dir"
WIP_REF="refs/bounty-board/${BRANCH#autofix/}-wip"
PUSHED_REF="refs/bounty-board/${BRANCH#autofix/}-pushed"
SAVED_WIP=0
on_exit() {
  local rc=$?
  bb_rmtemp "$W"
  if [ "$rc" -ne 0 ] && [ "$SAVED_WIP" -eq 1 ]; then echo "open-pr: the o2-loop WIP commits are saved at $WIP_REF ($(git -C "$WT" rev-parse "$WIP_REF"))" >&2; fi
}
trap on_exit EXIT
set +e
REASON="$("$HERE/gate-issue.sh" --hunt "$ISSUE_REPO" "$ISSUE" "$W")"
RC=$?
set -e
[ "$RC" -ne 10 ] || die "gate: $REASON" 10
[ "$RC" -eq 0 ] || die "gate failed (exit $RC)" "$RC"
ME="$(cat "$W/me.txt")"

node "$HERE/triage-rules.mjs" marker "$W/comments.jsonl" "$ISSUE_REPO" "$ISSUE" >"$W/marker.json"
[ "$(cat "$W/marker.json")" != "null" ] || die "no trusted verdict marker on the issue"
node "$HERE/parse-bug-items.mjs" "$W/body.md" >"$W/parsed.json"
node "$HERE/triage-rules.mjs" hunt-items "$W/parsed.json" "$ISSUE_REPO" "$W/marker.json" >"$W/hunt.json"
jq -e '.body_changed | not' "$W/hunt.json" >/dev/null || die "issue body changed since triage; re-triage first"
ACCEPTED="$(jq -r '.accepted | map(tostring) | join(",")' "$W/hunt.json")"
[ -n "$ACCEPTED" ] || die "no accepted items left on the current body"
[ "$(jq -r .target_repo "$W/hunt.json")" = "$TARGET" ] || die "accepted items target $(jq -r .target_repo "$W/hunt.json"), worktree is $TARGET"

node "$HERE/triage-rules.mjs" paths "$W/parsed.json" "$ACCEPTED" >"$W/allowed.txt"
"$HERE/scope-check.sh" "$WT" "$W/allowed.txt" origin/main || die "scope check failed"
"$HERE/no-close-check.sh" "$MSG_FILE" "$TITLE_FILE" "$BODY_FILE" || die "closing keyword found"

TITLE="$(cat "$TITLE_FILE")"
if [ "$(wc -l <"$TITLE_FILE" | tr -d ' ')" -gt 1 ] || ! [[ "$TITLE" =~ ^fix(\(|:) ]]; then die "title must be one line starting with fix( or fix:"; fi
REFS="Refs openobserve/$ISSUE_REPO#$ISSUE"
if ! grep -qF "$REFS" "$MSG_FILE" || ! grep -qF "$REFS" "$BODY_FILE"; then die "commit message and PR body must contain '$REFS'"; fi

MB="$(git -C "$WT" merge-base origin/main HEAD)"
AREA=backend
if git -C "$WT" diff --name-only "$MB" HEAD | grep -q '^web/'; then AREA=ui; fi
REVIEWERS=""
if jq -e '.enabled == true' "$SKILL/reviewers.json" >/dev/null; then
  REVIEWERS="$(jq -r --arg a "$AREA" --arg me "$ME" '.[$a] | map(select(. != $me)) | join(",")' "$SKILL/reviewers.json")"
fi
PR_ARGS=(-R "openobserve/$TARGET" --base main --head "$BRANCH" --title "$TITLE" --body-file "$BODY_FILE" --assignee @me)
[ -z "$REVIEWERS" ] || PR_ARGS+=(--reviewer "$REVIEWERS")

# A rerun after a failed push or create must not re-squash, or the new SHA would no longer match what was pushed.
SQUASHED=0
if [ "$(git -C "$WT" rev-list --count "$MB"..HEAD)" = 1 ] && [ "$(git -C "$WT" log -1 --format=%B HEAD)" = "$(cat "$MSG_FILE")" ]; then SQUASHED=1; fi

if [ "$DRY" -eq 1 ]; then
  echo "dry-run: gate, marker, scope and no-close checks passed for $ISSUE_REPO#$ISSUE (items $ACCEPTED)"
  if [ "$SQUASHED" -eq 1 ]; then echo "already squashed into one commit"; else echo "would squash $(git -C "$WT" rev-list --count "$MB"..HEAD) commit(s) onto $MB"; fi
  echo "would push $BRANCH to openobserve/$TARGET"
  printf 'would run: gh pr create'; printf ' %q' "${PR_ARGS[@]}"; echo
  echo "would comment on openobserve/$ISSUE_REPO#$ISSUE: 🪧 Autofix PR: <url>"
  exit 0
fi

if [ "$SQUASHED" -eq 0 ]; then
  # The first squash's WIP chain is the one o2-loop reviewed; a later squash must not replace it.
  git -C "$WT" rev-parse -q --verify "$WIP_REF" >/dev/null || git -C "$WT" update-ref "$WIP_REF" HEAD ""
  SAVED_WIP=1
  echo "wip_ref=$WIP_REF"
  git -C "$WT" reset -q --soft "$MB"
  git -C "$WT" commit -q -F "$MSG_FILE"
fi
HEAD_SHA="$(git -C "$WT" rev-parse HEAD)"
REMOTE_TIP="$(git -C "$WT" ls-remote "$(git -C "$WT" remote get-url --push origin)" "refs/heads/$BRANCH" | cut -f1)"
ours() {
  local tip="$1"
  git -C "$WT" cat-file -e "$tip^{commit}" 2>/dev/null || return 1
  git -C "$WT" merge-base --is-ancestor "$MB" "$tip" || return 1
  [ "$tip" = "$(git -C "$WT" rev-parse -q --verify "$PUSHED_REF" || true)" ] && return 0
  git -C "$WT" rev-parse -q --verify "$WIP_REF" >/dev/null && git -C "$WT" merge-base --is-ancestor "$tip" "$WIP_REF"
}
if [ "$REMOTE_TIP" = "$HEAD_SHA" ]; then
  echo "branch already pushed"
elif [ -z "$REMOTE_TIP" ]; then
  git -C "$WT" push -q -u origin "HEAD:refs/heads/$BRANCH"
elif ours "$REMOTE_TIP"; then
  # Only a tip this runner pushed or built is overwritten, and only if it is still that tip.
  git -C "$WT" push -q -u --force-with-lease="refs/heads/$BRANCH:$REMOTE_TIP" origin "HEAD:refs/heads/$BRANCH"
else
  die "remote $BRANCH is at $REMOTE_TIP, which this worktree did not push; someone else pushed to it, so check with them before going on"
fi
git -C "$WT" update-ref "$PUSHED_REF" HEAD
URL="$(cd "$WT" && gh pr create "${PR_ARGS[@]}")"
echo "pr_url=$URL"
if ! gh issue comment -R "openobserve/$ISSUE_REPO" "$ISSUE" --body "🪧 Autofix PR: $URL" >/dev/null; then
  echo "open-pr: the PR is open but the issue comment failed; retry with:" >&2
  printf 'gh issue comment -R %q %q --body %q\n' "openobserve/$ISSUE_REPO" "$ISSUE" "🪧 Autofix PR: $URL" >&2
  exit 6
fi
