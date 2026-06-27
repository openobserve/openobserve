#!/usr/bin/env bash
# Emit ONE retry-aware run-summary document per workflow run to an OpenObserve stream.
#
# Generic across test workflows: the CALLER passes CONCLUSION (derived from needs.*.result),
# STREAM, and SUITE; this script derives wall-clock timing from the GitHub jobs API, sums the
# cost across ALL attempts (so a re-run's doc carries the cumulative compute), and pulls
# attribution (branch/author/commit/PR/trigger) from the run object. It then POSTs via the
# shared o2-report.sh. Live re-runs append one doc per attempt; dashboards keep the latest
# attempt per run_id (row_number() dedup), so retries become an attribute, not duplicate rows.
#
# Never fails the workflow: missing secrets or any API/ingest error only warns.
set -uo pipefail
: "${STREAM:?STREAM required}"
SUITE="${SUITE:-}"
CONCLUSION="${CONCLUSION:-}"

if [ -z "${O2_REPORTING_INGEST_BASE:-}" ] || [ -z "${O2_REPORTING_AUTH:-}" ]; then
  echo "::notice::O2_REPORTING_* secrets not set — skipping metrics ingest"; exit 0
fi
if [ -z "${GH_TOKEN:-}" ]; then
  echo "::warning::GH_TOKEN not set — skipping metrics ingest"; exit 0
fi

# Unique payload file (no fixed /tmp path), cleaned up on exit.
PAYLOAD_FILE=$(mktemp "${TMPDIR:-/tmp}/o2_run_payload.XXXXXX")
trap 'rm -f "$PAYLOAD_FILE"' EXIT

API="${GITHUB_API_URL:-https://api.github.com}"
gh_get(){ curl -s -H "Authorization: token ${GH_TOKEN}" -H "Accept: application/vnd.github+json" "$API/$1"; }

# wall-clock of one attempt = max(completed) - min(started) across its jobs (clamped non-negative
# to guard against clock-skew where a completed_at precedes a started_at).
attempt_wall(){ jq '[.jobs[]|select(.completed_at!=null and .started_at!=null)] as $j
  | (if ($j|length)>0 then (($j|map(.completed_at|fromdateiso8601)|max)-($j|map(.started_at|fromdateiso8601)|min)) else 0 end)
  | if . < 0 then 0 else . end'; }

RUN_JSON=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" 2>/dev/null)
[ -n "$RUN_JSON" ] || { echo "::warning::could not fetch run object — skipping"; exit 0; }
ATT="${GITHUB_RUN_ATTEMPT:-1}"

THIS_JOBS=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${ATT}/jobs?per_page=100" 2>/dev/null)
FINAL_DUR=$(printf '%s' "$THIS_JOBS" | attempt_wall 2>/dev/null || echo 0)

# total across attempts: add each prior attempt's wall-clock.
TOTAL_DUR="$FINAL_DUR"
if [ "$ATT" -gt 1 ] 2>/dev/null; then
  SUM="$FINAL_DUR"
  for n in $(seq 1 $((ATT-1))); do
    W=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${n}/jobs?per_page=100" 2>/dev/null | attempt_wall 2>/dev/null || echo 0)
    SUM=$(awk -v a="$SUM" -v b="$W" 'BEGIN{print a+b}')
  done
  TOTAL_DUR="$SUM"
fi

WORKFLOW_TAG="test"; [ "$STREAM" = "ci_regression" ] && WORKFLOW_TAG="regression"

printf '%s' "$RUN_JSON" | jq \
  --arg suite "$SUITE" --arg conclusion "$CONCLUSION" --arg wf "$WORKFLOW_TAG" \
  --arg repo "$GITHUB_REPOSITORY" --arg run_id "$GITHUB_RUN_ID" --arg attempt "$ATT" \
  --arg run_url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${ATT}" \
  --argjson final "${FINAL_DUR:-0}" --argjson total "${TOTAL_DUR:-0}" \
  '($attempt|tonumber) as $a |
   {
     _timestamp: ((.run_started_at // .created_at | fromdateiso8601) * 1000000 | floor),
     workflow: $wf, suite: $suite, repo: $repo,
     run_id: $run_id, run_attempt: $a, retries: ($a-1), was_retried: ($a>1),
     conclusion: (if $conclusion=="" then .conclusion else $conclusion end),
     trigger: .event, author: (.actor.login // null), branch: .head_branch,
     commit_sha: ((.head_sha // "")[0:12]),
     pr_number: (.pull_requests[0].number // null),
     run_url: $run_url,
     final_duration_sec: ($final|round), total_duration_sec: ($total|round),
     retry_wasted_sec: (($total-$final)|round)
   }' > "$PAYLOAD_FILE" 2>/dev/null || { echo "::warning::payload build failed"; exit 0; }

bash "$(dirname "$0")/o2-report.sh" "$STREAM" "$PAYLOAD_FILE"
