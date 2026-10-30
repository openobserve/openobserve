# shellcheck shell=bash
# Sourced by the bounty-board scripts: loads the private repo config (if any) and validates repo names against it.

BB_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Inherited GIT_DIR / GIT_WORK_TREE (hooks, wrappers) override `git -C`, so every git call here would hit some other repo.
# shellcheck disable=SC2046
unset $(git rev-parse --local-env-vars)

BB_TMP_MARK=".bounty-board-tmp"

# Prints a fresh temp dir with a marker file, or fails; never prints an empty or existing path.
bb_mktemp() {
  local d
  d="$(mktemp -d "${TMPDIR:-/tmp}/bounty-board.XXXXXX")" || return 1
  [ -n "$d" ] && [ -d "$d" ] || return 1
  d="$(cd "$d" && pwd -P)" || return 1
  : >"$d/$BB_TMP_MARK" || return 1
  echo "$d"
}

# Removes only a dir that bb_mktemp made: marker present and named bounty-board.*.
bb_rmtemp() {
  local d="${1:-}"
  [ -n "$d" ] && [ -d "$d" ] && [ -f "$d/$BB_TMP_MARK" ] || return 0
  case "$(basename "$d")" in bounty-board.??????) rm -rf "$d" ;; esac
}

# Sets PRIVATE_DIR, PRIVATE_REPO, NEEDS_OSS_SIBLING and REPOS for the sourcing script; BB_OSS_DIR picks the checkout to search next to.
# shellcheck disable=SC2034
load_private() {
  local out k v
  PRIVATE_DIR=""; PRIVATE_REPO=""; NEEDS_OSS_SIBLING=false
  out="$(node "$BB_LIB_DIR/private-config.mjs" env)" || return 1
  while IFS='=' read -r k v; do
    case "$k" in
      private_dir) PRIVATE_DIR="$v" ;;
      private_repo) PRIVATE_REPO="$v" ;;
      needs_oss_sibling) NEEDS_OSS_SIBLING="$v" ;;
    esac
  done <<<"$out"
  REPOS=(openobserve)
  [ -z "$PRIVATE_REPO" ] || REPOS+=("$PRIVATE_REPO")
}

check_repo() {
  if [ "$1" = openobserve ] || { [ -n "$PRIVATE_REPO" ] && [ "$1" = "$PRIVATE_REPO" ]; }; then return 0; fi
  if [ -z "$PRIVATE_REPO" ]; then
    echo "$1: no private-repo config found next to this checkout" >&2
  else
    echo "invalid repo: $1 (use openobserve or $PRIVATE_REPO)" >&2
  fi
  return 1
}

# Prints the openobserve-org repo name of a checkout's origin from the raw config, so url rewrites do not change it.
gh_repo_of() {
  local url
  url="$(git -C "$1" config --get remote.origin.url 2>/dev/null || true)"
  url="${url%.git}"
  if [[ "$url" =~ [/:]openobserve/([A-Za-z0-9][A-Za-z0-9._-]*)$ ]]; then echo "${BASH_REMATCH[1]}"; fi
}
