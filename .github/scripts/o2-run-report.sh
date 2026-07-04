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
# Optional EXTRA_JSON (env): a JSON OBJECT the caller can pass to fold extra fields into the run
# doc (e.g. test-case counts). Shallow-merged via jq `*` (EXTRA_JSON keys win on conflict). On any
# parse/merge error the base payload is kept unchanged.
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
# $1 = floor epoch (the attempt's run_started_at). On a RE-RUN, GitHub's per-attempt jobs API
# carries over jobs that did NOT re-run with their ORIGINAL (earlier-attempt) timestamps, so a
# naive min(started) spans the idle gap between a failed run and a much-later manual re-run —
# inflating the duration by hours. Flooring the start at run_started_at counts only this
# attempt's actual work (no effect on normal runs, where min(started) >= run_started_at).
attempt_wall(){ jq --argjson floor "${1:-0}" '[.jobs[]|select(.completed_at!=null and .started_at!=null)] as $j
  | (if ($j|length)>0 then (($j|map(.completed_at|fromdateiso8601)|max)-([($j|map(.started_at|fromdateiso8601)|min), $floor]|max)) else 0 end)
  | if . < 0 then 0 else . end'; }
# Epoch seconds of a run/attempt object's run_started_at (0 if absent).
run_started_epoch(){ jq 'if .run_started_at then (.run_started_at|fromdateiso8601) else 0 end'; }

RUN_JSON=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}" 2>/dev/null)
[ -n "$RUN_JSON" ] || { echo "::warning::could not fetch run object — skipping"; exit 0; }
ATT="${GITHUB_RUN_ATTEMPT:-1}"
# This attempt's start — the floor for its wall-clock (see attempt_wall).
RUN_STARTED=$(printf '%s' "$RUN_JSON" | run_started_epoch 2>/dev/null || echo 0)
[ -n "$RUN_STARTED" ] || RUN_STARTED=0

THIS_JOBS=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${ATT}/jobs?per_page=100" 2>/dev/null)
FINAL_DUR=$(printf '%s' "$THIS_JOBS" | attempt_wall "$RUN_STARTED" 2>/dev/null || echo 0)

# total across attempts: add each prior attempt's wall-clock.
TOTAL_DUR="$FINAL_DUR"
if [ "$ATT" -gt 1 ] 2>/dev/null; then
  SUM="$FINAL_DUR"
  for n in $(seq 1 $((ATT-1))); do
    NFLOOR=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${n}" 2>/dev/null | run_started_epoch 2>/dev/null || echo 0)
    W=$(gh_get "repos/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${n}/jobs?per_page=100" 2>/dev/null | attempt_wall "${NFLOOR:-0}" 2>/dev/null || echo 0)
    SUM=$(awk -v a="$SUM" -v b="$W" 'BEGIN{print a+b}')
  done
  TOTAL_DUR="$SUM"
fi

WORKFLOW_TAG="test"; [ "$STREAM" = "ci_regression" ] && WORKFLOW_TAG="regression"

# Build-job duration + shard tallies from this attempt's jobs, added to the run doc:
#   build_duration_sec  — wall-clock of the "build_binary" job (null if absent)
#   shards_total/passed/failed/skipped — counts of the "e2e / *" shard jobs by conclusion
# Shard jobs are matched by the "e2e /" name prefix; the build job by exact name "build_binary".
# Suites without these jobs (e.g. API) get null/0 — harmless, those panels just stay empty.
JOBDUR='if (.completed_at and .started_at) then ((.completed_at|fromdateiso8601)-(.started_at|fromdateiso8601)) else null end'
BUILD_DUR=$(printf '%s' "$THIS_JOBS" | jq "[.jobs[]|select(.name==\"build_binary\")]|.[0]|if . then ($JOBDUR) else null end" 2>/dev/null)
[ -n "$BUILD_DUR" ] || BUILD_DUR=null
SHARDS=$(printf '%s' "$THIS_JOBS" | jq -c '[.jobs[]|select(.name|startswith("e2e /"))] as $s
  | {shards_total:($s|length),
     shards_passed:([$s[]|select(.conclusion=="success")]|length),
     shards_failed:([$s[]|select(.conclusion=="failure")]|length),
     shards_skipped:([$s[]|select(.conclusion=="skipped" or .conclusion=="cancelled")]|length)}' 2>/dev/null)
[ -n "$SHARDS" ] || SHARDS='{}'

printf '%s' "$RUN_JSON" | jq \
  --arg suite "$SUITE" --arg conclusion "$CONCLUSION" --arg wf "$WORKFLOW_TAG" \
  --arg repo "$GITHUB_REPOSITORY" --arg run_id "$GITHUB_RUN_ID" --arg attempt "$ATT" \
  --arg run_url "${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}/attempts/${ATT}" \
  --argjson final "${FINAL_DUR:-0}" --argjson total "${TOTAL_DUR:-0}" \
  --argjson build "$BUILD_DUR" --argjson shards "$SHARDS" \
  '($attempt|tonumber) as $a |
   {
     _timestamp: ((.run_started_at // .created_at | fromdateiso8601) * 1000000 | floor),
     workflow: $wf, suite: $suite, repo: $repo, ingest_source: "live",
     run_id: $run_id, run_attempt: $a, retries: ($a-1), was_retried: ($a>1),
     conclusion: (if $conclusion=="" then .conclusion else $conclusion end),
     trigger: .event, author: (.actor.login // null), branch: .head_branch,
     commit_sha: ((.head_sha // "")[0:12]),
     pr_number: (.pull_requests[0].number // null),
     run_url: $run_url,
     final_duration_sec: ($final|round), total_duration_sec: ($total|round),
     retry_wasted_sec: (($total-$final)|round),
     build_duration_sec: ($build | if .==null then null else round end),
     shards_total: ($shards.shards_total // null), shards_passed: ($shards.shards_passed // null),
     shards_failed: ($shards.shards_failed // null), shards_skipped: ($shards.shards_skipped // null)
   }' > "$PAYLOAD_FILE" 2>/dev/null || { echo "::warning::payload build failed"; exit 0; }

# Optional EXTRA_JSON: shallow-merge caller-supplied fields into the doc (e.g. test counts).
# On any merge error, keep the base payload (never fail the report).
if [ -n "${EXTRA_JSON:-}" ] && printf '%s' "$EXTRA_JSON" | jq -e . >/dev/null 2>&1; then
  if jq -s '.[0] * .[1]' "$PAYLOAD_FILE" <(printf '%s' "$EXTRA_JSON") > "$PAYLOAD_FILE.m" 2>/dev/null; then
    mv "$PAYLOAD_FILE.m" "$PAYLOAD_FILE"
  else
    echo "::warning::EXTRA_JSON merge failed — keeping base payload"; rm -f "$PAYLOAD_FILE.m"
  fi
fi

bash "$(dirname "$0")/o2-report.sh" "$STREAM" "$PAYLOAD_FILE"

# For runs with e2e shard jobs (UI), also emit one row per shard to <STREAM>_shards so dashboards
# can break down per-shard duration / slowest shard / per-module health (mirrors ci_regression_shards).
# API runs have no "e2e /" jobs, so this is a no-op there. Row schema:
#   run_id, repo, suite, workflow, ingest_source, shard_name, module (shard minus "e2e / "),
#   conclusion, duration_sec. _timestamp left unset -> ingest time (aligned with the run doc).
# Notes: THIS_JOBS is the jobs API object {jobs:[...]}, piped in (so .jobs[]); workflow:"test" is
# fixed to match the run doc's tag; duration clamped to >=0 to guard against runner clock skew.
SHARD_FILE=$(mktemp "${TMPDIR:-/tmp}/o2_shards.XXXXXX")
shard_rows=$(printf '%s' "$THIS_JOBS" | jq -c --arg repo "$GITHUB_REPOSITORY" --arg run_id "$GITHUB_RUN_ID" --arg suite "$SUITE" \
  '[.jobs[]? | select(.name|startswith("e2e /")) | {
     run_id:$run_id, repo:$repo, suite:$suite, workflow:"test", ingest_source:"live",
     shard_name:.name, module:(.name|sub("^e2e / ";"")), conclusion:.conclusion,
     duration_sec: (if (.completed_at and .started_at) then ([((.completed_at|fromdateiso8601)-(.started_at|fromdateiso8601)|floor), 0] | max) else null end)
   }]' 2>/dev/null) && printf '%s' "$shard_rows" > "$SHARD_FILE" || { echo '[]' > "$SHARD_FILE"; echo "::warning::shard-row extraction failed — skipping ${STREAM}_shards"; }
if [ "$(jq 'length' "$SHARD_FILE" 2>/dev/null || echo 0)" -gt 0 ]; then
  bash "$(dirname "$0")/o2-report.sh" "${STREAM}_shards" "$SHARD_FILE"
fi
rm -f "$SHARD_FILE"
