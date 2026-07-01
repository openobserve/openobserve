#!/usr/bin/env bash
# scripts/test-assist-ci-batch.sh — batch dispatcher for the Test-Assist CI engine.
#
# Fires the `test-assist.yml` engine (in o2-enterprise) in parallel for a list of OSS issues.
# Each engine run is its own concurrency group (keyed on source_repo+issue), so GitHub Actions
# runs them in parallel up to the runner cap.
#
# Usage:
#   ./scripts/test-assist-ci-batch.sh < issue-numbers.txt          # one number per line
#   ./scripts/test-assist-ci-batch.sh 12452 11700 12647            # positional args
#   echo "12452 11700" | ./scripts/test-assist-ci-batch.sh --stdin
#
# Requires: `gh` authenticated with a token that has Actions:write on openobserve/o2-enterprise
# (typically the maintainer's PAT — `gh auth login` interactively works).
#
# Options:
#   --repo-engine REPO    Override the engine repo (default: openobserve/o2-enterprise)
#   --source-repo NAME    Override the source repo (default: openobserve)
#   --write-mode          Set write_mode=true (default: false — no GitHub writes)
#   --throttle SECS       Sleep between dispatches (default: 0.5)
#   --dry-run             Print what would be dispatched; don't call gh
#
set -euo pipefail

REPO_ENGINE="openobserve/o2-enterprise"
SOURCE_REPO="openobserve"
WORKFLOW="test-assist.yml"
WRITE_MODE="false"
THROTTLE="0.5"
DRY_RUN=""

# Parse flags.
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo-engine) REPO_ENGINE="$2"; shift 2;;
    --source-repo) SOURCE_REPO="$2"; shift 2;;
    --write-mode)  WRITE_MODE="true"; shift;;
    --throttle)    THROTTLE="$2"; shift 2;;
    --dry-run)     DRY_RUN="1"; shift;;
    --stdin)       args=(); shift;;
    -h|--help)     grep -E '^# ' "$0" | sed 's/^# //'; exit 0;;
    *)             args+=("$1"); shift;;
  esac
done

# Read issue list from positional args, or stdin if no args.
if [ "${#args[@]}" -eq 0 ]; then
  mapfile -t NUMS < <(grep -E '^[0-9]+$')
else
  NUMS=("${args[@]}")
fi

[ "${#NUMS[@]}" -gt 0 ] || { echo "::error::no issue numbers provided" >&2; exit 1; }

echo "==========================================="
echo "Test-Assist CI — batch dispatch"
echo "  engine: $REPO_ENGINE (workflow: $WORKFLOW)"
echo "  source: $SOURCE_REPO"
echo "  count:  ${#NUMS[@]}"
echo "  write_mode: $WRITE_MODE"
[ -n "$DRY_RUN" ] && echo "  (DRY RUN — no dispatches)"
echo "==========================================="

# Pre-flight: verify gh auth works and can hit the workflow.
if [ -z "$DRY_RUN" ]; then
  gh workflow view "$WORKFLOW" --repo "$REPO_ENGINE" >/dev/null 2>&1 \
    || { echo "::error::cannot access workflow $WORKFLOW on $REPO_ENGINE — check gh auth + PAT scopes"; exit 1; }
fi

DISPATCHED=0
SKIPPED=0
for N in "${NUMS[@]}"; do
  if ! [[ "$N" =~ ^[0-9]+$ ]]; then
    echo "  skip non-numeric: $N" >&2
    SKIPPED=$(( SKIPPED + 1 ))
    continue
  fi
  if [ -n "$DRY_RUN" ]; then
    echo "  DRY: would dispatch #$N"
  else
    echo "  dispatch #$N"
    gh workflow run "$WORKFLOW" \
      --repo "$REPO_ENGINE" \
      --ref main \
      -f source_repo="$SOURCE_REPO" \
      -f issue_number="$N" \
      -f fixture_mode=false \
      -f write_mode="$WRITE_MODE" &
  fi
  DISPATCHED=$(( DISPATCHED + 1 ))
  sleep "$THROTTLE"
done
wait

echo ""
echo "==========================================="
echo "Done. Dispatched: $DISPATCHED  Skipped: $SKIPPED"
echo ""
echo "Track progress:"
echo "  https://github.com/${REPO_ENGINE}/actions/workflows/${WORKFLOW}"
echo ""
echo "After runs complete, populate qa-reports/test-assist-ci-backlog-sweep.md by:"
echo "  - reading each run's artifact (test-assist-ci-evidence-<run_id>)"
echo "  - extracting bug-<N>-verdict.json"
echo "  - appending a row to the sweep table"
echo "==========================================="
