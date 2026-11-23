#!/usr/bin/env bash
# Reports the newest real result of CHECK_NAME on HEAD_SHA, so a label-only run neither re-tests nor hides a failure.
set -euo pipefail

: "${GH_TOKEN:?}" "${REPO:?}" "${HEAD_SHA:?}" "${CHECK_NAME:?}" "${MIRROR_STEP:?}" "${CHECKOUT_STEP:?}"
POLL_MINUTES=${POLL_MINUTES:-90}
SKIPPED_IS_RESULT=${SKIPPED_IS_RESULT:-false}
CHECKS="repos/$REPO/commits/$HEAD_SHA/check-runs?check_name=$(jq -rn --arg n "$CHECK_NAME" '$n | @uri')&filter=all&per_page=100"

ERRORS=0
api_error() {
  ERRORS=$((ERRORS + 1))
  if [ "$ERRORS" -ge 10 ]; then echo "::error::The GitHub API kept failing, so the result of $CHECK_NAME cannot be reported."; exit 1; fi
  sleep 30
}

OWN=${OWN_CHECK_ID:-}
if [ -z "$OWN" ]; then
  : "${RUN_ID:?}"
  for _ in 1 2 3 4 5 6; do
    OWN=$(gh api --paginate "$CHECKS" --jq ".check_runs[] | select(.details_url | contains(\"/actions/runs/$RUN_ID/\")) | .id" | sort -n | tail -n 1) && [ -n "$OWN" ] && break
    sleep 10
  done
  [ -n "$OWN" ] || { echo "::error::Could not find this job's own $CHECK_NAME check run on $HEAD_SHA."; exit 1; }
fi

DEADLINE=$((SECONDS + POLL_MINUTES * 60))
IGNORE=" "
while :; do
  # Only older checks count: a newer real run of this check overrides this mirror on its own.
  if ! LIST=$(gh api --paginate "$CHECKS" --jq ".check_runs[] | select(.id < $OWN) | \"\(.id) \(.status) \(.conclusion // \"-\") \(.details_url // \"-\")\""); then
    api_error; continue
  fi
  CAND=$(sort -rn <<<"$LIST" | awk -v ign="$IGNORE" -v sk="$SKIPPED_IS_RESULT" 'index(ign, " " $1 " ") == 0 && (sk == "true" || $3 != "skipped") { print; exit }')
  if [ -z "$CAND" ]; then
    # Passing here would turn the required check green without the check ever having run on this commit.
    echo "::error::No earlier $CHECK_NAME result on $HEAD_SHA to report. Push a commit or re-add the 'ready-for-ci' label to run it."
    exit 1
  fi
  read -r ID STATUS CONCL URL <<<"$CAND"

  # Check runs that are not Actions jobs (the auto-merge placeholder) carry no steps and are real results.
  if [[ "$URL" =~ /actions/runs/[0-9]+/job/[0-9]+ ]]; then
    if ! JOB=$(gh api "repos/$REPO/actions/jobs/$ID"); then
      api_error; continue
    fi
    # A mirror that failed at checkout never reached its mirror step, so either step having run marks it.
    KIND=$(jq -r --arg s "$MIRROR_STEP" --arg c "$CHECKOUT_STEP" \
      'if any(.steps[]?; (.name == $s or .name == $c) and (.status == "in_progress" or (.conclusion != null and .conclusion != "skipped"))) then "mirror"
       elif .conclusion == "cancelled" and ((.steps // []) | length) == 0 then "never-started"
       else "real" end' <<<"$JOB")
    if [ "$KIND" != "real" ]; then
      echo "Skipping $CHECK_NAME check $ID ($KIND)."
      IGNORE="$IGNORE$ID "; continue
    fi
  fi
  ERRORS=0

  if [ "$STATUS" = "completed" ]; then break; fi
  if [ "$SECONDS" -ge "$DEADLINE" ]; then
    echo "::error::$CHECK_NAME check $ID on $HEAD_SHA was still $STATUS after $POLL_MINUTES min. Re-run this job once it finishes."
    exit 1
  fi
  echo "$CHECK_NAME check $ID is $STATUS; waiting for its result."
  sleep 30
done

echo "::notice::Reporting $CHECK_NAME check $ID on $HEAD_SHA: $CONCL ($URL)."
if [ "$CONCL" = "success" ] || { [ "$CONCL" = "skipped" ] && [ "$SKIPPED_IS_RESULT" = "true" ]; }; then exit 0; fi
echo "::error::The last real $CHECK_NAME result on this commit is '$CONCL'."
exit 1
