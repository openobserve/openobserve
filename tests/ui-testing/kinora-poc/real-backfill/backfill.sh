#!/usr/bin/env bash
# Backfill real OpenObserve CI Playwright runs into the self-hosted Kinora "real" org.
# For each run in runs.tsv: download blob-report artifacts -> merge to json -> kinora upload.
#
# Usage:
#   KINORA_TOKEN=<token> ./backfill.sh            # all runs in runs.tsv
#   KINORA_TOKEN=<token> ./backfill.sh 28227606924  # single run id (validation)
set -uo pipefail

cd "$(dirname "$0")"
HERE="$(pwd)"
POC_DIR="$(dirname "$HERE")"          # kinora-poc (has @playwright/test 1.50 + node_modules)
URL="${KINORA_URL:-http://localhost:8099}"
PROJECT="openobserve-e2e-real"
REPO_URL="https://github.com/openobserve/openobserve"
: "${KINORA_TOKEN:?set KINORA_TOKEN to the real-org workspace token}"

ONLY="${1:-}"

ok=0; skip=0; fail=0
while IFS=$'\t' read -r id concl branch sha url; do
  [ -z "$id" ] && continue
  if [ -n "$ONLY" ] && [ "$id" != "$ONLY" ]; then continue; fi
  wd="work/$id"
  echo "=================================================================="
  echo ">> run $id  [$concl]  $branch"
  rm -rf "$wd"; mkdir -p "$wd/blobs" "$wd/flat"

  if ! gh run download "$id" --pattern 'blob-report-*' -D "$wd/blobs" 2>"$wd/download.log"; then
    echo "   no blob artifacts (expired or none) -> skip"; skip=$((skip+1)); continue
  fi

  # Flatten every blob zip into one dir, naming each by its shard folder (unique).
  n=0
  while IFS= read -r f; do
    cp "$f" "$wd/flat/$(basename "$(dirname "$f")").zip"; n=$((n+1))
  done < <(find "$wd/blobs" -name '*.zip')
  echo "   collected $n blob shard(s)"
  if [ "$n" -eq 0 ]; then echo "   nothing to merge -> skip"; skip=$((skip+1)); continue; fi

  # Merge blob shards into a single Playwright json report (uses kinora-poc's PW 1.50).
  if ! (cd "$POC_DIR" && npx playwright merge-reports --reporter json "$HERE/$wd/flat" > "$HERE/$wd/results.json" 2>"$HERE/$wd/merge.log"); then
    echo "   merge failed (see $wd/merge.log) -> skip"; fail=$((fail+1)); continue
  fi

  # Upload to kinora with git + CI metadata so shas link to commits and runs link back.
  if (cd "$POC_DIR" && npx @kinora/cli upload "$HERE/$wd/results.json" \
        --project "$PROJECT" --url "$URL" --token "$KINORA_TOKEN" \
        --git-sha "$sha" --git-branch "$branch" --git-repo-url "$REPO_URL" \
        --ci-provider github --ci-run-url "$url" --ci-run-number "$id" 2>&1 | sed 's/^/   /'); then
    echo "   uploaded OK"; ok=$((ok+1))
  else
    echo "   upload failed"; fail=$((fail+1))
  fi

  # Free disk: blobs are uploaded, the local copy is no longer needed.
  rm -rf "$wd"
  echo "   cleaned up $wd"
done < runs.tsv

echo "=================================================================="
echo "DONE  uploaded=$ok  skipped=$skip  failed=$fail"
