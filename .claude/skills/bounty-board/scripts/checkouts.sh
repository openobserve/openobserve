#!/usr/bin/env bash
# Usage: checkouts.sh [dir] — prints openobserve=<path>, and private=<path> + private_repo=<name> when a private repo config is found.
set -euo pipefail
# shellcheck source=SCRIPTDIR/lib.sh
. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"

# The git common dir's parent is the main checkout even when run from a worktree.
main_of() { dirname "$(git -C "$1" rev-parse --path-format=absolute --git-common-dir)"; }

OSS="${BB_OSS_DIR:-}"
if [ -z "$OSS" ]; then
  START="$(main_of "${1:-.}")"
  for d in "$START" "$(dirname "$START")/openobserve"; do
    if [ -e "$d/.git" ] && [ "$(gh_repo_of "$d")" = openobserve ]; then OSS="$(main_of "$d")"; break; fi
  done
fi
[ -n "$OSS" ] || { echo "no openobserve checkout found; start in the openobserve checkout or set BB_OSS_DIR" >&2; exit 3; }
echo "openobserve=$OSS"
export BB_OSS_DIR="$OSS"
load_private
[ -n "$PRIVATE_DIR" ] || exit 0
PMAIN="$(main_of "$PRIVATE_DIR")"
[ "$(gh_repo_of "$PMAIN")" = "$PRIVATE_REPO" ] || { echo "$PMAIN carries the private repo config but its origin is not openobserve/$PRIVATE_REPO" >&2; exit 3; }
echo "private=$PMAIN"
echo "private_repo=$PRIVATE_REPO"
