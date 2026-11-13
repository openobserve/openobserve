#!/usr/bin/env bash
# Scenario tests for assign-milestone.sh against a fake gh that serves fixtures.
# Run: bash .github/scripts/assign-milestone.test.sh (exits non-zero on any failure).
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SCRIPT="$HERE/assign-milestone.sh"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
R=o/r
FAILED=0
PASSED=0

cat >"$WORK/fake-gh" <<'FAKE'
#!/usr/bin/env bash
set -euo pipefail
[ "$1" = api ] || { echo "fake gh: unsupported command $1" >&2; exit 2; }
shift
method=GET path="" fields="" ext=json
while [ $# -gt 0 ]; do
  case $1 in
    -X) method=$2; shift 2 ;;
    -H) [ "$2" = "Accept: application/vnd.github.diff" ] || { echo "fake gh: header $2" >&2; exit 2; }
      ext=diff; shift 2 ;;
    --paginate) shift ;;
    -f | -F) fields="$fields $2"; shift 2 ;;
    -*) echo "fake gh: unsupported flag $1" >&2; exit 2 ;;
    *) path=$1; shift ;;
  esac
done
key="$method/$(printf '%s' "$path" | tr '/?&=%:' '______')"
count_file="$FIX/.count_${key//\//_}"
n=$(( $(cat "$count_file" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$count_file"
[ "$method" = GET ] || echo "$method $path$fields" >>"$FIX/writes.log"
body="$FIX/$key.$ext"
[ -f "$FIX/$key.$n.$ext" ] && body="$FIX/$key.$n.$ext"
if [ -f "$body" ]; then
  cat "$body"
  if [ -f "$FIX/$key.exit" ]; then
    echo "gh: HTTP $(cat "$FIX/$key.exit")" >&2
    exit 1
  fi
  exit 0
fi
if [ "$method" = GET ]; then
  echo '{"message":"Not Found"}'
  echo "gh: Not Found (HTTP 404)" >&2
  exit 1
fi
echo '{}'
FAKE
chmod +x "$WORK/fake-gh"

new_case() {
  FIX="$WORK/$1"
  mkdir -p "$FIX/GET" "$FIX/POST" "$FIX/PATCH"
  : >"$FIX/writes.log"
}

# Usage: fixture METHOD PATH JSON [suffix]; suffix ".2" serves the 2nd call, ".exit" fails it.
fixture() {
  local key
  key="$1/$(printf '%s' "$2" | tr '/?&=%:' '______')"
  printf '%s\n' "$3" >"$FIX/$key${4:-.json}"
}

open_ms() { fixture GET "repos/$R/milestones?state=open&per_page=100" "$1" "${2:-.json}"; }
all_ms() { fixture GET "repos/$R/milestones?state=all&per_page=100" "$1"; }
tags() { fixture GET "repos/$R/git/matching-refs/tags/$1" "$2"; }
pr() { fixture GET "repos/$R/pulls/$1" "$2"; }
issue() { fixture GET "repos/$R/issues/$1" "$2"; }
commits() { fixture GET "repos/$R/pulls/$1/commits?per_page=100" "$2"; }
commit_prs() { fixture GET "repos/$R/commits/$1/pulls" "$2"; }
commit_diff() { fixture GET "repos/$R/commits/$1" "$2" .diff; }

# Usage: mkdiff FILE TAG N [LAST]; a valid one-hunk diff, LAST replaces the final added line.
mkdiff() {
  local f=$1 tag=$2 n=$3 last=${4:-} i
  printf 'diff --git a/%s b/%s\nindex 1111111..2222222 100644\n--- a/%s\n+++ b/%s\n@@ -1,%d +1,%d @@\n' \
    "$f" "$f" "$f" "$f" "$n" "$n"
  for ((i = 1; i <= n; i++)); do echo "-old $tag line $i"; done
  for ((i = 1; i < n; i++)); do echo "+new $tag line $i"; done
  echo "+${last:-new $tag line $n}"
}

commit_json() {
  jq -cn --arg sha "$1" --arg msg "$2" '{sha: $sha, parents: [{}], commit: {message: $msg}}'
}

run_case() {
  local name=$1 kind=$2 number=$3 want_writes=$4 want_out=$5 dry=${6:-0} out rc=0 got
  out=$(GH="$WORK/fake-gh" FIX="$FIX" GH_REPO=$R DRY_RUN=$dry bash "$SCRIPT" "$kind" "$number" 2>&1) || rc=$?
  got=$(cat "$FIX/writes.log")
  if [ $rc -eq 0 ] && [ "$got" = "$want_writes" ] && grep -qF -- "$want_out" <<<"$out"; then
    PASSED=$((PASSED + 1))
    echo "PASS  $name"
    return 0
  fi
  FAILED=$((FAILED + 1))
  echo "FAIL  $name (exit $rc)"
  printf '  want writes:\n%s\n  got writes:\n%s\n  want output containing: %s\n  output:\n%s\n' \
    "$want_writes" "$got" "$want_out" "$out" | sed 's/^/    /'
  return 1
}

MS_BACKLOG='{"number":1,"title":"Backlog","state":"open"}'
MS_110='{"number":40,"title":"v1.1.0","state":"open"}'
MS_120='{"number":50,"title":"v1.2.0","state":"open"}'
TAGS_120_RC='[{"ref":"refs/tags/v1.2.0-rc1"},{"ref":"refs/tags/v1.2.0-rc2"}]'
PR_MAIN='{"number":100,"base":{"ref":"main"},"milestone":null,"title":"t","body":""}'

scenario_pre_rc1() {
  new_case pre_rc1
  open_ms "[$MS_BACKLOG,$MS_120]"
  tags v1.2.0 '[{"ref":"refs/tags/v1.2.0-dev"}]'
  pr 100 "$PR_MAIN"
  run_case "pre-rc1: main PR gets v1.2.0" pr 100 \
    "PATCH repos/$R/issues/100 milestone=50" "set milestone v1.2.0 on #100"
}

scenario_post_rc1_creates_next() {
  local kind
  for kind in pr issue; do
    new_case "post_rc1_$kind"
    open_ms "[$MS_BACKLOG,$MS_120]"
    tags v1.2.0 "$TAGS_120_RC"
    pr 100 "$PR_MAIN"
    issue 100 '{"number":100,"milestone":null}'
    fixture POST "repos/$R/milestones" '{"number":51,"title":"v1.3.0"}'
    run_case "post-rc1, no next milestone: $kind creates and gets v1.3.0" "$kind" 100 \
      "POST repos/$R/milestones title=v1.3.0
PATCH repos/$R/issues/100 milestone=51" "set milestone v1.3.0 on #100"
  done
}

scenario_post_rc1_dry_run() {
  new_case post_rc1_dry
  open_ms "[$MS_BACKLOG,$MS_120]"
  tags v1.2.0 "$TAGS_120_RC"
  pr 100 "$PR_MAIN"
  run_case "post-rc1 DRY_RUN: prints decision, writes nothing" pr 100 \
    "" "DRY_RUN: would create milestone v1.3.0" 1
}

scenario_renamed_next() {
  new_case renamed
  open_ms "[$MS_BACKLOG,$MS_120,{\"number\":51,\"title\":\"v1.2.5\",\"state\":\"open\"}]"
  tags v1.2.0 "$TAGS_120_RC"
  tags v1.2.5 '[]'
  pr 100 "$PR_MAIN"
  run_case "post-rc1, v1.3.0 renamed to v1.2.5: uses it, creates nothing" pr 100 \
    "PATCH repos/$R/issues/100 milestone=51" "set milestone v1.2.5 on #100"
}

scenario_old_frozen_open() {
  new_case old_frozen
  open_ms "[$MS_110,$MS_120,$MS_BACKLOG]"
  tags v1.1.0 '[{"ref":"refs/tags/v1.1.0"},{"ref":"refs/tags/v1.1.0-rc1"}]'
  tags v1.2.0 '[]'
  pr 100 "$PR_MAIN"
  run_case "GA'd v1.1.0 still open: skipped, v1.2.0 used" pr 100 \
    "PATCH repos/$R/issues/100 milestone=50" "Milestone v1.1.0 is frozen"

  new_case all_frozen
  open_ms "[$MS_120,$MS_110]"
  tags v1.1.0 '[{"ref":"refs/tags/v1.1.0"}]'
  tags v1.2.0 "$TAGS_120_RC"
  pr 100 "$PR_MAIN"
  fixture POST "repos/$R/milestones" '{"number":51,"title":"v1.3.0"}'
  run_case "all open milestones frozen: next is created from the highest" pr 100 \
    "POST repos/$R/milestones title=v1.3.0
PATCH repos/$R/issues/100 milestone=51" "set milestone v1.3.0 on #100"
}

scenario_create_race() {
  new_case race
  open_ms "[$MS_120]"
  open_ms "[$MS_120,{\"number\":52,\"title\":\"v1.3.0\",\"state\":\"open\"}]" .2.json
  tags v1.2.0 "$TAGS_120_RC"
  pr 100 "$PR_MAIN"
  fixture POST "repos/$R/milestones" \
    '{"message":"Validation Failed","errors":[{"resource":"Milestone","code":"already_exists","field":"title"}]}'
  fixture POST "repos/$R/milestones" 422 .exit
  run_case "creation race (422 already_exists): re-reads and uses it" pr 100 \
    "POST repos/$R/milestones title=v1.3.0
PATCH repos/$R/issues/100 milestone=52" "created concurrently"
}

scenario_existing_milestone() {
  new_case existing_pr
  open_ms "[$MS_120]"
  tags v1.2.0 "$TAGS_120_RC"
  pr 100 '{"number":100,"base":{"ref":"main"},"milestone":{"title":"v1.1.0"},"title":"t","body":""}'
  run_case "PR with a milestone already set is not overwritten" pr 100 \
    "" "Milestone already set to 'v1.1.0'"

  new_case existing_issue
  issue 100 '{"number":100,"milestone":{"title":"Backlog"}}'
  run_case "issue with a milestone already set is not overwritten" issue 100 \
    "" "Milestone already set to 'Backlog'"
}

scenario_branch_closed_milestone() {
  new_case branch_closed
  all_ms '[{"number":40,"title":"v1.1.0","state":"closed"},{"number":50,"title":"v1.2.0","state":"open"}]'
  pr 300 '{"number":300,"base":{"ref":"branch-v1.1.0"},"milestone":null,"title":"t","body":""}'
  commits 300 '[]'
  run_case "PR into branch-v1.1.0 with closed milestone: skipped with notice" pr 300 \
    "" "::notice::Milestone v1.1.0 is closed"
}

MAIN_16499='{"number":16499,"merged_at":"2026-11-01T00:00:00Z","base":{"ref":"main"},"labels":[],
  "merge_commit_sha":"m16499","title":"fix: thing","body":"Fixes #910"}'
MAIN_16502='{"number":16502,"merged_at":"2026-11-01T00:00:00Z","base":{"ref":"main"},"labels":[],
  "merge_commit_sha":"m16502","title":"other","body":""}'
PICK="fix: thing (#16499)

(cherry picked from commit aaaa111)"

# Usage: backport_case NAME BODY COMMIT_MSG BACKPORT_DIFF; source of the pick is aaaa111 (PR 16499).
backport_case() {
  new_case "$1"
  all_ms "[$MS_120]"
  pr 300 "$(jq -cn --arg b "$2" '{number: 300, base: {ref: "branch-v1.2.0"}, milestone: null,
    title: "fix: thing [v1.2]", body: $b}')"
  commits 300 "[$(commit_json b0000001 "$3")]"
  commit_diff b0000001 "$4"
  commit_prs aaaa111 "[$MAIN_16499]"
  commit_diff aaaa111 "$(mkdiff src/a.rs a 10)"
  commit_diff m16499 "$(mkdiff src/a.rs a 10)"
  commit_diff m16502 "$(mkdiff src/b.rs b 4)"
  pr 16499 "$MAIN_16499"
  pr 16502 "$MAIN_16502"
  open_ms "[$MS_120,{\"number\":51,\"title\":\"v1.3.0\",\"state\":\"open\"}]"
  tags v1.2.0 "$TAGS_120_RC"
  tags v1.3.0 '[]'
  issue 910 '{"number":910,"milestone":{"title":"v1.1.0"}}'
}

LABEL_WRITES="POST repos/$R/labels name=backport:v1.2.0 color=C5DEF5 description=Backported to v1.2.0
POST repos/$R/issues/16499/labels labels[]=backport:v1.2.0"

scenario_backport_cherry_pick_same_patch() {
  backport_case cp_same "Backport of #16499, context in #16502.
Fixes #900. Closes #901.
Resolves https://github.com/o/r/issues/902
prefixes #903" "$PICK" "$(mkdiff src/a.rs a 10)"
  issue 900 '{"number":900,"milestone":null}'
  issue 901 '{"number":901,"milestone":{"title":"v1.1.0"}}'
  issue 902 '{"number":902,"milestone":{"title":"v1.3.0"}}'
  issue 903 '{"number":903,"milestone":null}'
  issue 910 '{"number":910,"milestone":null}'
  run_case "cherry-pick line + same patch: labels it, moves its and the main PR's issues" pr 300 \
    "PATCH repos/$R/issues/300 milestone=50
$LABEL_WRITES
PATCH repos/$R/issues/900 milestone=50
PATCH repos/$R/issues/902 milestone=50
PATCH repos/$R/issues/910 milestone=50" "#16499 (cherry-pick line, same patch-id)"
}

scenario_backport_cherry_pick_overlap() {
  backport_case cp_overlap "Backport." "$PICK" "$(mkdiff src/a.rs a 10 "resolved conflict line")"
  run_case "cherry-pick line + conflict-resolved change (19 of 21 lines shared): labels it" pr 300 \
    "PATCH repos/$R/issues/300 milestone=50
$LABEL_WRITES" "#16499 (cherry-pick line, 90% of changed lines shared)"
}

scenario_backport_cherry_pick_unrelated() {
  backport_case cp_unrelated "Backport of #16499." "$PICK" "$(mkdiff src/a.rs zzz 10)"
  run_case "cherry-pick line to an unrelated change: no label, notice" pr 300 \
    "PATCH repos/$R/issues/300 milestone=50" "cherry-picks aaaa111 but shares only 0% of its changed lines"
}

scenario_backport_patch_id_only() {
  backport_case pid_only "Backport of #16502 and #16499." "fix: thing" "$(mkdiff src/a.rs a 10)"
  run_case "no cherry-pick line, exact patch-id of a named PR: labels only that one" pr 300 \
    "PATCH repos/$R/issues/300 milestone=50
$LABEL_WRITES" "#16499 (no cherry-pick line, same patch-id as its merge commit)"
}

scenario_backport_mention_only() {
  backport_case mention_only "Backport of #16499, on top of #16502." "fix: thing" \
    "$(mkdiff src/a.rs a 10 "resolved conflict line")"
  run_case "number only mentioned in the text: no label, notice" pr 300 \
    "PATCH repos/$R/issues/300 milestone=50" "its patch-id matches none of #16499 #16502"
}

scenario_self_check() {
  local saved_failed=$FAILED
  new_case self_check
  open_ms "[$MS_120]"
  tags v1.2.0 '[]'
  pr 100 "$PR_MAIN"
  if run_case "self-check: a wrong expectation must fail" pr 100 \
    "PATCH repos/$R/issues/100 milestone=999" "set milestone" >/dev/null; then
    FAILED=$((saved_failed + 1))
    echo "FAIL  self-check: harness accepted a wrong expectation"
  else
    FAILED=$saved_failed
    echo "PASS  self-check: harness rejects a wrong expectation"
  fi
}

for s in pre_rc1 post_rc1_creates_next post_rc1_dry_run renamed_next old_frozen_open \
  create_race existing_milestone branch_closed_milestone backport_cherry_pick_same_patch \
  backport_cherry_pick_overlap backport_cherry_pick_unrelated backport_patch_id_only \
  backport_mention_only self_check; do
  "scenario_$s" || true
done

echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ]
