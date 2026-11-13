#!/usr/bin/env bash
# Usage: assign-milestone.sh pr|issue <number>; env GH_REPO, TAG_REPO, DRY_RUN=1, GH (test stub).
set -euo pipefail

GH=${GH:-gh}
REPO=${GH_REPO:?GH_REPO is required}
TAG_REPO=${TAG_REPO:-$REPO}
DRY_RUN=${DRY_RUN:-0}
SEMVER_RE='^v?[0-9]+\.[0-9]+\.[0-9]+$'
BRANCH_RE='^branch-(v[0-9]+\.[0-9]+\.[0-9]+)(-rc[0-9]+)?$'
LABEL_COLOR=C5DEF5
MAX_REFS=50
# Real conflict-resolved backports share >=46% of changed lines with their source; unrelated pairs <=4%.
MIN_OVERLAP_PCT=20

TARGET_NUM=""
TARGET_TITLE=""
LABEL_READY=""
MATCHED=""
CANDIDATES=""
CANDIDATES_READY=0
WORK_DIR=""

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

# A milestone with an rc/GA tag is frozen; if all are, $1=1 creates the next minor.
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

fetch_diff() {
  local f="$WORK_DIR/$1.diff"
  if [ ! -s "$f" ]; then
    "$GH" api -H "Accept: application/vnd.github.diff" "repos/$REPO/commits/$1" </dev/null >"$f" 2>/dev/null || {
      rm -f "$f"
      return 1
    }
  fi
  echo "$f"
}

same_patch() {
  local a b
  a=$(git patch-id --stable <"$1" | awk '{ print $1 }')
  b=$(git patch-id --stable <"$2" | awk '{ print $1 }')
  [ -n "$a" ] && [ "$a" = "$b" ]
}

changed_lines() {
  { grep -E '^[+-]' "$1" || true; } | { grep -vE '^(\+\+\+ (b/|/dev/null)|--- (a/|/dev/null))' || true; } |
    sed -E 's/^([+-])[[:space:]]+/\1/; s/[[:space:]]+/ /g; s/ $//' | awk 'length > 3' | LC_ALL=C sort -u
}

# Jaccard share, in percent, of the distinct changed lines of two diffs.
overlap_pct() {
  local a="$WORK_DIR/lines.a" b="$WORK_DIR/lines.b" inter union
  changed_lines "$1" >"$a"
  changed_lines "$2" >"$b"
  inter=$(($(LC_ALL=C comm -12 "$a" "$b" | wc -l)))
  union=$(($(LC_ALL=C sort -u "$a" "$b" | wc -l)))
  if [ "$union" -eq 0 ]; then
    echo 0
  else
    echo $((inter * 100 / union))
  fi
}

main_pr() {
  local f="$WORK_DIR/pr-$1.json"
  if [ ! -f "$f" ]; then
    api_get "repos/$REPO/pulls/$1" >"$f" 2>/dev/null || echo '{}' >"$f"
  fi
  jq -e '.merged_at != null and .base.ref == "main"' "$f" >/dev/null && cat "$f"
}

add_match() {
  case " $MATCHED " in
    *" $1 "*) ;;
    *) MATCHED="${MATCHED:+$MATCHED }$1" ;;
  esac
  echo "Matched: $2"
}

match_cherry_pick() {
  local short=$1 bdiff=$2 src prs sdiff how pct p
  for src in $3; do
    prs=$(api_get "repos/$REPO/commits/$src/pulls" 2>/dev/null |
      jq -r '.[] | select(.merged_at != null and .base.ref == "main") | .number') || prs=""
    if [ -z "$prs" ]; then
      echo "::notice::Commit $short cherry-picks ${src:0:10}, which is in no PR merged into main; no backport label"
      continue
    fi
    if ! sdiff=$(fetch_diff "$src"); then
      echo "::notice::Commit $short: the diff of ${src:0:10} is unavailable; no backport label"
      continue
    fi
    if same_patch "$bdiff" "$sdiff"; then
      how="cherry-pick line, same patch-id"
    else
      pct=$(overlap_pct "$bdiff" "$sdiff")
      if [ "$pct" -lt "$MIN_OVERLAP_PCT" ]; then
        echo "::notice::Commit $short cherry-picks ${src:0:10} but shares only $pct% of its changed lines; no backport label"
        continue
      fi
      how="cherry-pick line, $pct% of changed lines shared"
    fi
    for p in $prs; do
      add_match "$p" "commit $short -> #$p ($how)"
    done
  done
}

text_candidates() {
  local n p
  if [ "$CANDIDATES_READY" = 1 ]; then
    return 0
  fi
  CANDIDATES_READY=1
  for n in $(local_refs "$1"); do
    [ "$n" != "$2" ] || continue
    p=$(main_pr "$n") || continue
    CANDIDATES="${CANDIDATES:+$CANDIDATES }$n:$(jq -r '.merge_commit_sha' <<<"$p")"
  done
}

match_by_patch_id() {
  local short=$1 bdiff=$2 c cdiff names=""
  text_candidates "$4" "$3"
  for c in $CANDIDATES; do
    names="$names #${c%%:*}"
    cdiff=$(fetch_diff "${c#*:}") || continue
    if same_patch "$bdiff" "$cdiff"; then
      add_match "${c%%:*}" "commit $short -> #${c%%:*} (no cherry-pick line, same patch-id as its merge commit)"
      return 0
    fi
  done
  if [ -z "$names" ]; then
    echo "::notice::Commit $short has no cherry-pick line and the title/body names no PR merged into main; no backport label"
  else
    echo "::notice::Commit $short has no cherry-pick line and its patch-id matches none of$names; no backport label"
  fi
}

# Each commit must prove it carries a main PR's change; a number in the text alone proves nothing.
match_backports() {
  local self=$1 text=$2 rows sha parents picks short bdiff
  MATCHED=""
  rows=$(api_list "repos/$REPO/pulls/$self/commits?per_page=100" | jq -r '.[] | [.sha, (.parents | length),
    ([.commit.message | scan("\\(cherry picked from commit ([0-9a-f]{7,40})\\)") | .[0]] | join(" "))] | @tsv') ||
    die "could not list the commits of #$self"
  while IFS=$'\t' read -r sha parents picks; do
    [ -n "$sha" ] || continue
    short=${sha:0:10}
    if [ "$parents" -gt 1 ]; then
      echo "::notice::Commit $short is a merge commit; not used for backport matching"
      continue
    fi
    if ! bdiff=$(fetch_diff "$sha"); then
      echo "::notice::Commit $short: its diff is unavailable; no backport label"
      continue
    fi
    if [ -n "$picks" ]; then
      match_cherry_pick "$short" "$bdiff" "$picks"
    else
      match_by_patch_id "$short" "$bdiff" "$self" "$text"
    fi
  done <<<"$rows"
  [ -n "$MATCHED" ] || echo "::notice::No commit of #$self matched a PR merged into main; no backport label added"
}

label_main_pr() {
  local n=$1 label=$2 p
  p=$(main_pr "$n") || return 0
  if jq -e --arg l "$label" 'any(.labels[]; .name == $l)' <<<"$p" >/dev/null; then
    echo "#$n already has label $label"
    return 0
  fi
  ensure_label "$label"
  write "add label $label to #$n" POST "repos/$REPO/issues/$n/labels" -f "labels[]=$label"
}

issue_refs() {
  local n p
  {
    closing_refs "$1"
    for n in $MATCHED; do
      p=$(main_pr "$n") || continue
      closing_refs "$(jq -r '(.title // "") + "\n" + (.body // "")' <<<"$p")"
    done
  } | sort -un
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
  local number=$1 rel=$2 current=$3 pr=$4 ms state text n
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
  match_backports "$number" "$text"
  for n in $MATCHED; do
    label_main_pr "$n" "backport:$rel"
  done
  if [ "$state" = open ]; then
    move_closed_issues "$(jq -r .number <<<"$ms")" "$rel" "$(issue_refs "$text")"
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
  WORK_DIR=$(mktemp -d)
  trap 'rm -rf "$WORK_DIR"' EXIT
  case $1 in
    pr) handle_pr "$2" ;;
    issue) handle_issue "$2" ;;
    *) die "unknown kind '$1' (expected pr or issue)" ;;
  esac
}

main "$@"
