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
method=GET path="" fields=""
while [ $# -gt 0 ]; do
  case $1 in
    -X) method=$2; shift 2 ;;
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
body="$FIX/$key.json"
[ -f "$FIX/$key.$n.json" ] && body="$FIX/$key.$n.json"
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
  run_case "PR into branch-v1.1.0 with closed milestone: skipped with notice" pr 300 \
    "" "::notice::Milestone v1.1.0 is closed"
}

scenario_branch_backport_links() {
  new_case backport
  all_ms "[$MS_120]"
  open_ms "[$MS_120,{\"number\":51,\"title\":\"v1.3.0\",\"state\":\"open\"}]"
  tags v1.2.0 "$TAGS_120_RC"
  tags v1.3.0 '[]'
  pr 300 '{"number":300,"base":{"ref":"branch-v1.2.0"},"milestone":null,
    "title":"fix: thing (#16499) [v1.2]",
    "body":"Backport of #16500 and o/r#16501. Paired with o/other#7.\nFixes #900. Closes #901.\nResolves https://github.com/o/r/issues/902\nprefixes #903"}'
  pr 16499 '{"number":16499,"merged_at":"2026-11-01T00:00:00Z","base":{"ref":"main"},"labels":[]}'
  pr 16500 '{"number":16500,"merged_at":"2026-11-01T00:00:00Z","base":{"ref":"main"},"labels":[{"name":"backport:v1.2.0"}]}'
  pr 16501 '{"number":16501,"merged_at":null,"base":{"ref":"main"},"labels":[]}'
  issue 900 '{"number":900,"milestone":null}'
  issue 901 '{"number":901,"milestone":{"title":"v1.1.0"}}'
  issue 902 '{"number":902,"milestone":{"title":"v1.3.0"}}'
  issue 903 '{"number":903,"milestone":null}'
  run_case "backport PR: milestone, main PR label, closed issues moved" pr 300 \
    "PATCH repos/$R/issues/300 milestone=50
POST repos/$R/labels name=backport:v1.2.0 color=C5DEF5 description=Backported to v1.2.0
POST repos/$R/issues/16499/labels labels[]=backport:v1.2.0
PATCH repos/$R/issues/900 milestone=50
PATCH repos/$R/issues/902 milestone=50" "Issue #901 keeps milestone v1.1.0"
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
  create_race existing_milestone branch_closed_milestone branch_backport_links self_check; do
  "scenario_$s" || true
done

echo "passed: $PASSED  failed: $FAILED"
[ "$FAILED" -eq 0 ]
