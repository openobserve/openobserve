#!/usr/bin/env bash
# scripts/test-assist-ci-batch.sh — batch dispatcher for the Test-Assist CI engine.
#
# Fires the `test-assist.yml` engine (in o2-enterprise) in parallel for a list of OSS issues.
# Each engine run is its own concurrency group (keyed on source_repo+issue), so GitHub Actions
# runs them in parallel up to the runner cap.
#
# Usage:
#   ./scripts/test-assist-ci-batch.sh < issue-numbers.txt          # one number per line (stdin)
#   ./scripts/test-assist-ci-batch.sh 12452 11700 12647            # positional args
#   echo "12452 11700 12647" | tr ' ' '\n' | ./scripts/test-assist-ci-batch.sh
#
# Requires: `gh` authenticated with a token that has Actions:write on openobserve/o2-enterprise
# (typically the maintainer's PAT — `gh auth login` interactively works).
#
# Options:
#   --repo-engine REPO    Override the engine repo (default: openobserve/o2-enterprise).
#                         Restricted to an allowlist to prevent redirecting dispatches.
#   --source-repo NAME    Override the source repo short name (default: openobserve).
#   --write-mode          Set write_mode=true (default: false — no GitHub verdict writes).
#   --max-parallel N      Cap concurrent dispatches (default: 20). Waits when at cap.
#   --throttle SECS       Sleep between dispatches (default: 2). Reduces API burst.
#   --dry-run             Print what would be dispatched; don't call gh.
#
set -euo pipefail

REPO_ENGINE="openobserve/o2-enterprise"
SOURCE_REPO="openobserve"
WORKFLOW="test-assist.yml"
WRITE_MODE="false"
THROTTLE="2"
MAX_PARALLEL="20"
DRY_RUN=""

# Allowlist of accepted engine-repos. Prevents an accidental (or malicious) override from
# redirecting maintainer-PAT dispatches to an unrelated repo.
ALLOWED_ENGINES=("openobserve/o2-enterprise")

is_allowed_engine() {
  local candidate="$1"
  for e in "${ALLOWED_ENGINES[@]}"; do
    [ "$candidate" = "$e" ] && return 0
  done
  return 1
}

# Parse flags.
args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --repo-engine)   REPO_ENGINE="$2"; shift 2;;
    --source-repo)   SOURCE_REPO="$2"; shift 2;;
    --write-mode)    WRITE_MODE="true"; shift;;
    --max-parallel)  MAX_PARALLEL="$2"; shift 2;;
    --throttle)      THROTTLE="$2"; shift 2;;
    --dry-run)       DRY_RUN="1"; shift;;
    -h|--help)       grep -E '^# ' "$0" | sed 's/^# //'; exit 0;;
    *)               args+=("$1"); shift;;
  esac
done

# Validate the engine target BEFORE reading any input.
if ! is_allowed_engine "$REPO_ENGINE"; then
  echo "::error::--repo-engine \"$REPO_ENGINE\" is not in the allowlist (${ALLOWED_ENGINES[*]})" >&2
  echo "::error::Extend ALLOWED_ENGINES in this script if you need a new target." >&2
  exit 1
fi

# Read issue list from positional args, or stdin if no args.
if [ "${#args[@]}" -eq 0 ]; then
  mapfile -t NUMS < <(grep -E '^[0-9]+$')
else
  NUMS=("${args[@]}")
fi

[ "${#NUMS[@]}" -gt 0 ] || { echo "::error::no issue numbers provided" >&2; exit 1; }

echo "==========================================="
echo "Test-Assist CI — batch dispatch"
echo "  engine:       $REPO_ENGINE (workflow: $WORKFLOW)"
echo "  source:       $SOURCE_REPO"
echo "  count:        ${#NUMS[@]}"
echo "  max_parallel: $MAX_PARALLEL"
echo "  throttle:     ${THROTTLE}s"
echo "  write_mode:   $WRITE_MODE"
[ -n "$DRY_RUN" ] && echo "  (DRY RUN — no dispatches)"
echo "==========================================="

# Pre-flight: verify gh auth works and can hit the workflow.
if [ -z "$DRY_RUN" ]; then
  gh workflow view "$WORKFLOW" --repo "$REPO_ENGINE" >/dev/null 2>&1 \
    || { echo "::error::cannot access workflow $WORKFLOW on $REPO_ENGINE — check gh auth + PAT scopes"; exit 1; }
fi

# Track results properly (previous version silently swallowed backgrounded failures).
TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

PID_TO_ISSUE="$TMPDIR/pid-to-issue"
: > "$PID_TO_ISSUE"
DISPATCHED=0
FAILED=0
SKIPPED=0
ACTIVE=0

for N in "${NUMS[@]}"; do
  if ! [[ "$N" =~ ^[0-9]+$ ]]; then
    echo "  skip non-numeric: $N" >&2
    SKIPPED=$(( SKIPPED + 1 ))
    continue
  fi

  # Bounded parallelism: wait for a slot before firing the next dispatch.
  while [ "$ACTIVE" -ge "$MAX_PARALLEL" ]; do
    wait -n
    ACTIVE=$(( ACTIVE - 1 ))
  done

  if [ -n "$DRY_RUN" ]; then
    echo "  DRY: would dispatch #$N"
    DISPATCHED=$(( DISPATCHED + 1 ))
    continue
  fi

  echo "  dispatch #$N"
  gh workflow run "$WORKFLOW" \
    --repo "$REPO_ENGINE" \
    --ref main \
    -f source_repo="$SOURCE_REPO" \
    -f issue_number="$N" \
    -f fixture_mode=false \
    -f write_mode="$WRITE_MODE" \
    >/dev/null 2>>"$TMPDIR/errors.log" &
  echo "$! $N" >> "$PID_TO_ISSUE"
  ACTIVE=$(( ACTIVE + 1 ))
  sleep "$THROTTLE"
done

# Wait for the remaining background jobs, tallying failures.
while read -r pid issue; do
  if ! wait "$pid" 2>/dev/null; then
    echo "  FAILED: dispatch for #$issue" >&2
    FAILED=$(( FAILED + 1 ))
  else
    DISPATCHED=$(( DISPATCHED + 1 ))
  fi
done < "$PID_TO_ISSUE"

echo ""
echo "==========================================="
echo "Done."
echo "  Dispatched: $DISPATCHED"
echo "  Failed:     $FAILED"
echo "  Skipped:    $SKIPPED  (non-numeric input)"
if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "See errors:"
  head -30 "$TMPDIR/errors.log" 2>/dev/null || true
fi
echo ""
echo "Track progress:"
echo "  https://github.com/${REPO_ENGINE}/actions/workflows/${WORKFLOW}"
echo "==========================================="

# Non-zero exit if any dispatches failed — lets CI-invoked callers detect.
[ "$FAILED" -eq 0 ]
