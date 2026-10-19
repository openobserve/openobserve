#!/usr/bin/env bash
# Usage: prepare-worktree.sh <issue_repo> <issue> <target_repo> <target_checkout> — creates or reuses the autofix worktree; prints key=value lines.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

ISSUE_REPO="${1:-}"; ISSUE="${2:-}"; TARGET_REPO="${3:-}"; CHECKOUT="${4:-}"
load_private || exit 3
for r in "$ISSUE_REPO" "$TARGET_REPO"; do check_repo "$r" || exit 2; done
[[ "$ISSUE" =~ ^[0-9]{1,9}$ ]] || { echo "invalid issue number" >&2; exit 2; }
[ -d "$CHECKOUT" ] || { echo "target checkout not found: $CHECKOUT" >&2; exit 2; }

MAIN="$(dirname "$(git -C "$CHECKOUT" rev-parse --path-format=absolute --git-common-dir)")"
BRANCH="autofix/$ISSUE_REPO-issue-$ISSUE"
WT="$(dirname "$MAIN")/wt-autofix-$ISSUE_REPO-$ISSUE"

# A private repo with needs_oss_sibling builds against ../openobserve path deps, so its worktree must sit next to that checkout.
if [ "$TARGET_REPO" != openobserve ] && [ "$NEEDS_OSS_SIBLING" = true ]; then
  OSS="$(dirname "$WT")/openobserve"
  if [ ! -f "$OSS/src/config/Cargo.toml" ]; then
    echo "missing $OSS: the private repo builds against ../openobserve" >&2
    exit 5
  fi
  echo "oss_sibling=$OSS"
  echo "oss_sibling_branch=$(git -C "$OSS" rev-parse --abbrev-ref HEAD)"
  echo "oss_sibling_behind_main=$(git -C "$OSS" rev-list --count HEAD..origin/main 2>/dev/null || echo unknown)"
fi

git -C "$MAIN" fetch --quiet origin main
if [ -e "$WT" ]; then
  [ "$(git -C "$WT" rev-parse --abbrev-ref HEAD 2>/dev/null)" = "$BRANCH" ] || { echo "$WT exists but is not on $BRANCH" >&2; exit 4; }
  echo "reused=true"
elif git -C "$MAIN" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  echo "branch $BRANCH already exists locally without the worktree; inspect it before reusing or deleting it" >&2
  exit 4
else
  git -C "$MAIN" worktree add --quiet --no-track -b "$BRANCH" "$WT" origin/main
  echo "reused=false"
fi

# Same derivation as o2-loop's loop-state.py default_ledger: main checkout dir name, branch with / turned into -.
echo "worktree=$WT"
echo "branch=$BRANCH"
echo "ledger=$HOME/.claude/o2-loop/$(basename "$MAIN")/${BRANCH//\//-}"
