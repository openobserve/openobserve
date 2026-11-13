#!/usr/bin/env bash
# Usage: assign-milestone.sh pr|issue <number>. Env: GH_REPO, TAG_REPO (default GH_REPO),
# DRY_RUN=1 only reads and prints the decision. GH overrides the gh binary (tests).
set -euo pipefail

GH=${GH:-gh}
REPO=${GH_REPO:?GH_REPO is required}
TAG_REPO=${TAG_REPO:-$REPO}
DRY_RUN=${DRY_RUN:-0}
SEMVER_RE='^v?[0-9]+\.[0-9]+\.[0-9]+$'
BRANCH_RE='^branch-(v[0-9]+\.[0-9]+\.[0-9]+)(-rc[0-9]+)?$'
LABEL_COLOR=C5DEF5
MAX_REFS=50

TARGET_NUM=""
TARGET_TITLE=""
LABEL_READY=""

die() {
  echo "::error::$*"
  exit 1
}

api_get() {
  "$GH" api "$1" </dev/null
}

api_list() {
  "$GH" api --paginate "$1" </dev/null | jq -s 'add // []'
}

# Usage: write "<what>" METHOD PATH [gh api field args...]
write() {
  local what=$1
  shift
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY_RUN: would $what"
    return 0
  fi
  "$GH" api -X "$@" </dev/null >/dev/null || die "could not $what"
  echo "Done: $what"
}

is_frozen() {
  local v="v${1#v}" refs
  refs=$(api_list "repos/$TAG_REPO/git/matching-refs/tags/$v") || die "could not read tags for $v"
  jq -e --arg v "$v" \
    'any(.[]; .ref == "refs/tags/\($v)" or (.ref | startswith("refs/tags/\($v)-rc")))' \
    <<<"$refs" >/dev/null
}

open_numeric_milestones() {
  api_list "repos/$REPO/milestones?state=open&per_page=100" | jq -r --arg re "$SEMVER_RE" '
    map(select(.title | test($re)))
    | sort_by(.title | ltrimstr("v") | split(".") | map(tonumber))
    | .[] | "\(.number)\t\(.title)"'
}

milestone_by_title() {
  api_list "repos/$REPO/milestones?state=all&per_page=100" |
    jq -c --arg t "$1" 'map(select(.title == $t)) | .[0] // empty'
}

next_minor() {
  awk -F. '{ sub(/^v/, "", $1); printf "v%d.%d.0", $1, $2 + 1 }' <<<"$1"
}

create_milestone() {
  local title=$1 out errf
  if [ "$DRY_RUN" = 1 ]; then
    echo "DRY_RUN: would create milestone $title"
    TARGET_NUM=0
    TARGET_TITLE=$title
    return 0
  fi
  errf=$(mktemp)
  if out=$("$GH" api -X POST "repos/$REPO/milestones" -f title="$title" 2>"$errf" </dev/null); then
    rm -f "$errf"
    TARGET_NUM=$(jq -r '.number' <<<"$out")
    TARGET_TITLE=$title
    echo "Created milestone $title"
    return 0
  fi
  out="$out $(cat "$errf")"
  rm -f "$errf"
  grep -q already_exists <<<"$out" || die "could not create milestone $title: $out"
  # Another run created it between our read and our POST; use theirs.
  TARGET_NUM=$(api_list "repos/$REPO/milestones?state=open&per_page=100" |
    jq -r --arg t "$title" 'map(select(.title == $t)) | .[0].number // empty')
  [ -n "$TARGET_NUM" ] || die "milestone $title exists but is not open"
  TARGET_TITLE=$title
  echo "Milestone $title was created concurrently; using it"
}

# Lowest open numeric milestone with no release tag yet; if all are frozen and $1=1,
# create the next minor after the highest one.
find_target() {
  local create=$1 list num title highest=""
  list=$(open_numeric_milestones) || die "could not list milestones"
  while IFS=$'\t' read -r num title; do
    [ -n "$num" ] || continue
    highest=$title
    if is_frozen "$title"; then
      echo "Milestone $title is frozen (release tag exists); skipping it"
      continue
    fi
    TARGET_NUM=$num
    TARGET_TITLE=$title
    return 0
  done <<<"$list"
  if [ -z "$highest" ]; then
    echo "::warning::No open numeric milestones found"
    return 1
  fi
  [ "$create" = 1 ] || return 1
  create_milestone "$(next_minor "$highest")"
}

set_milestone() {
  local number=$1 ms_num=$2 ms_title=$3
  write "set milestone $ms_title on #$number" PATCH "repos/$REPO/issues/$number" -F milestone="$ms_num"
}

ensure_label() {
  local name=$1 enc out
  [ "$LABEL_READY" != "$name" ] || return 0
  enc=$(jq -rn --arg n "$name" '$n | @uri')
  if api_get "repos/$REPO/labels/$enc" >/dev/null 2>&1; then
    :
  elif [ "$DRY_RUN" = 1 ]; then
    echo "DRY_RUN: would create label $name"
  elif out=$("$GH" api -X POST "repos/$REPO/labels" -f name="$name" -f color="$LABEL_COLOR" \
    -f description="Backported to ${name#backport:}" 2>&1 </dev/null); then
    echo "Done: create label $name"
  elif ! grep -q already_exists <<<"$out"; then
    die "could not create label $name: $out"
  fi
  LABEL_READY=$name
}

local_refs() {
  {
    grep -oE "github\.com/$REPO/(pull|issues)/[0-9]+" <<<"$1" || true
    grep -oE "$REPO#[0-9]+" <<<"$1" || true
    grep -oE "(^|[^A-Za-z0-9_./#-])#[0-9]+" <<<"$1" || true
  } | grep -oE '[0-9]+$' | sort -un | head -n "$MAX_REFS" || true
}

closing_refs() {
  grep -oiE "(^|[^A-Za-z])(close[sd]?|fix(e[sd])?|resolve[sd]?):?[[:space:]]+(#|$REPO#|https://github\.com/$REPO/issues/)[0-9]+" <<<"$1" |
    grep -oE '[0-9]+$' | sort -un | head -n "$MAX_REFS" || true
}

label_main_prs() {
  local self=$1 label=$2 refs=$3 n p
  for n in $refs; do
    [ "$n" != "$self" ] || continue
    if ! p=$(api_get "repos/$REPO/pulls/$n" 2>/dev/null); then
      continue
    fi
    if ! jq -e '.merged_at != null and .base.ref == "main"' <<<"$p" >/dev/null; then
      echo "#$n is not a PR merged into main; no backport label"
      continue
    fi
    if jq -e --arg l "$label" 'any(.labels[]; .name == $l)' <<<"$p" >/dev/null; then
      echo "#$n already has label $label"
      continue
    fi
    ensure_label "$label"
    write "add label $label to #$n" POST "repos/$REPO/issues/$n/labels" -f "labels[]=$label"
  done
}

move_closed_issues() {
  local rel_num=$1 rel_title=$2 refs=$3 n issue current next=""
  [ -n "$refs" ] || return 0
  if find_target 0; then
    next=$TARGET_TITLE
  fi
  for n in $refs; do
    issue=$(api_get "repos/$REPO/issues/$n" 2>/dev/null) || {
      echo "::warning::Could not read #$n"
      continue
    }
    jq -e '.pull_request == null' <<<"$issue" >/dev/null || continue
    current=$(jq -r '.milestone.title // empty' <<<"$issue")
    if [ -z "$current" ] || { [ "$current" = "$next" ] && [ "$current" != "$rel_title" ]; }; then
      set_milestone "$n" "$rel_num" "$rel_title"
    else
      echo "Issue #$n keeps milestone $current"
    fi
  done
}

handle_branch_pr() {
  local number=$1 rel=$2 current=$3 pr=$4 ms state text
  ms=$(milestone_by_title "$rel") || die "could not list milestones"
  state=missing
  [ -z "$ms" ] || state=$(jq -r '.state' <<<"$ms")
  if [ -n "$current" ]; then
    echo "Milestone already set to '$current'; skipping"
  elif [ "$state" = open ]; then
    set_milestone "$number" "$(jq -r .number <<<"$ms")" "$rel"
  else
    echo "::notice::Milestone $rel is $state; not setting it on #$number"
  fi

  text=$(jq -r '(.title // "") + "\n" + (.body // "")' <<<"$pr")
  label_main_prs "$number" "backport:$rel" "$(local_refs "$text")"
  if [ "$state" = open ]; then
    move_closed_issues "$(jq -r .number <<<"$ms")" "$rel" "$(closing_refs "$text")"
  fi
}

handle_pr() {
  local number=$1 pr base current
  pr=$(api_get "repos/$REPO/pulls/$number") || die "could not read PR #$number"
  base=$(jq -r '.base.ref' <<<"$pr")
  current=$(jq -r '.milestone.title // empty' <<<"$pr")
  if [ "$base" = main ]; then
    if [ -n "$current" ]; then
      echo "Milestone already set to '$current'; skipping"
      return 0
    fi
    find_target 1 || return 0
    set_milestone "$number" "$TARGET_NUM" "$TARGET_TITLE"
  elif [[ "$base" =~ $BRANCH_RE ]]; then
    handle_branch_pr "$number" "${BASH_REMATCH[1]}" "$current" "$pr"
  else
    echo "Base branch $base has no milestone rule; skipping"
  fi
}

handle_issue() {
  local number=$1 current
  current=$(api_get "repos/$REPO/issues/$number" | jq -r '.milestone.title // empty') ||
    die "could not read issue #$number"
  if [ -n "$current" ]; then
    echo "Milestone already set to '$current'; skipping"
    return 0
  fi
  find_target 1 || return 0
  set_milestone "$number" "$TARGET_NUM" "$TARGET_TITLE"
}

main() {
  [ $# -eq 2 ] || die "usage: $0 pr|issue <number>"
  case $1 in
    pr) handle_pr "$2" ;;
    issue) handle_issue "$2" ;;
    *) die "unknown kind '$1' (expected pr or issue)" ;;
  esac
}

main "$@"
