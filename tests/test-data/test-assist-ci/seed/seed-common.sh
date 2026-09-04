#!/usr/bin/env bash
# tests/test-data/test-assist-ci/seed/seed-common.sh
#
# Common data seed for the Test-Assist CI engine. Runs for BOTH fixture and real-issue
# dispatches. Populates the ephemeral OpenObserve Docker instance so verification agents
# (Tester + Playwright MCP) find non-empty pages.
#
# Seeds (in order):
#   1. Fixture logs → ci_seed_stream  (kept for fixture #90001 backward compat)
#   2. Bulk logs → default, e2e_automate, web_logs, k8s_logs streams
#      (~3.8k entries × 4 streams = general log coverage for Logs / Streams / SQL editor bugs)
#   3. OTLP traces → default trace stream  (unblocks Traces-page bugs)
#   4. OTLP metrics → default metrics stream (Metrics-page bugs)
#   5. Alert definitions  (Alerts-page bugs)
#   6. A basic pipeline   (Pipelines-page bugs)
#
# All ingestion via HTTP Basic auth (matches OSS Playwright's ingestion utilities).
# The password is base64-encoded into an Authorization header — never on the command line.
#
# Idempotent: re-running is safe. Data-ingestion endpoints tolerate duplicates; config
# endpoints (alert / pipeline) silently no-op on 409 "already exists".
#
set -euo pipefail

: "${ZO_BASE_URL:?ZO_BASE_URL not set}"
: "${ZO_ROOT_USER_EMAIL:?ZO_ROOT_USER_EMAIL not set}"
: "${ZO_ROOT_USER_PASSWORD:?ZO_ROOT_USER_PASSWORD not set}"
ORG="${ORGNAME:-default}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE="${ZO_BASE_URL%/}"
AUTH_B64="$(printf '%s' "${ZO_ROOT_USER_EMAIL}:${ZO_ROOT_USER_PASSWORD}" | base64)"

# Compact curl wrapper. All calls best-effort — we log per-step but don't abort the whole
# seed on any single failure (the pipeline should still start up; unpopulated areas just
# get INCONCLUSIVE later, which is a better outcome than the whole engine failing at seed).
_curl() {
  local method="$1"; local url="$2"; local data_arg="$3"
  local resp code
  # -w writes status code to stdout after the body; -o /dev/null suppresses body.
  if [ -n "$data_arg" ]; then
    code=$(curl -sS -o /dev/null -w '%{http_code}' \
      -X "$method" \
      -H "Authorization: Basic ${AUTH_B64}" \
      -H 'Content-Type: application/json' \
      --data-binary "$data_arg" \
      --max-time 30 \
      "$url" || echo "ERR")
  else
    code=$(curl -sS -o /dev/null -w '%{http_code}' \
      -X "$method" \
      -H "Authorization: Basic ${AUTH_B64}" \
      --max-time 30 \
      "$url" || echo "ERR")
  fi
  echo "$code"
}

echo "==============================================="
echo "Test-Assist CI — common data seed"
echo "  target: $BASE (org=$ORG)"
echo "==============================================="

# ------------------------------------------------------------------------
# 1. Fixture logs → ci_seed_stream (kept for fixture #90001)
# ------------------------------------------------------------------------
if [ -f "${HERE}/logs_seed.json" ]; then
  echo "[1/6] Fixture logs → ci_seed_stream"
  code=$(_curl POST "${BASE}/api/${ORG}/ci_seed_stream/_json" "@${HERE}/logs_seed.json")
  echo "     status: $code"
else
  echo "[1/6] Skipping fixture logs (logs_seed.json missing)"
fi

# ------------------------------------------------------------------------
# 2. Bulk logs → 4 streams (default, e2e_automate, web_logs, k8s_logs)
#    Reuses the existing test-data/logs_data.json used by OSS Playwright's globalSetup.
# ------------------------------------------------------------------------
BULK_LOGS="${HERE}/../../logs_data.json"
if [ -f "$BULK_LOGS" ]; then
  echo "[2/6] Bulk logs → default, e2e_automate, web_logs, k8s_logs"
  for STREAM in default e2e_automate web_logs k8s_logs; do
    code=$(_curl POST "${BASE}/api/${ORG}/${STREAM}/_json" "@${BULK_LOGS}")
    echo "     $STREAM: $code"
  done
else
  echo "[2/6] Skipping bulk logs (tests/test-data/logs_data.json not found)"
fi

# ------------------------------------------------------------------------
# 3. OTLP traces → default trace stream
# ------------------------------------------------------------------------
if [ -f "${HERE}/traces_seed.json" ]; then
  echo "[3/6] OTLP traces"
  # OpenObserve trace endpoint: /api/{org}/v1/traces  (OTLP HTTP)
  code=$(_curl POST "${BASE}/api/${ORG}/v1/traces" "@${HERE}/traces_seed.json")
  echo "     status: $code"
else
  echo "[3/6] Skipping traces (traces_seed.json missing)"
fi

# ------------------------------------------------------------------------
# 4. OTLP metrics → default metrics stream
# ------------------------------------------------------------------------
if [ -f "${HERE}/metrics_seed.json" ]; then
  echo "[4/6] OTLP metrics"
  # OpenObserve OTLP metrics HTTP endpoint: /api/{org}/v1/metrics
  code=$(_curl POST "${BASE}/api/${ORG}/v1/metrics" "@${HERE}/metrics_seed.json")
  echo "     status: $code"
else
  echo "[4/6] Skipping metrics (metrics_seed.json missing)"
fi

# ------------------------------------------------------------------------
# 5. Alert definitions
#    Endpoint: POST /api/{org}/{stream}/alerts (JSON body per alert)
#    The alerts_seed.json is an ARRAY — we split into one POST per alert so a single
#    conflict doesn't nuke the whole batch.
# ------------------------------------------------------------------------
if [ -f "${HERE}/alerts_seed.json" ]; then
  echo "[5/6] Alerts"
  ALERT_COUNT=$(jq 'length' "${HERE}/alerts_seed.json")
  for i in $(seq 0 $((ALERT_COUNT - 1))); do
    ALERT=$(jq -c ".[$i]" "${HERE}/alerts_seed.json")
    STREAM=$(echo "$ALERT" | jq -r '.stream_name')
    NAME=$(echo "$ALERT" | jq -r '.name')
    code=$(_curl POST "${BASE}/api/${ORG}/${STREAM}/alerts" "$ALERT")
    echo "     $NAME → $STREAM: $code"
  done
else
  echo "[5/6] Skipping alerts (alerts_seed.json missing)"
fi

# ------------------------------------------------------------------------
# 6. Pipeline
#    Endpoint: POST /api/{org}/pipelines
# ------------------------------------------------------------------------
if [ -f "${HERE}/pipeline_seed.json" ]; then
  echo "[6/6] Pipeline"
  code=$(_curl POST "${BASE}/api/${ORG}/pipelines" "@${HERE}/pipeline_seed.json")
  echo "     status: $code"
else
  echo "[6/6] Skipping pipeline (pipeline_seed.json missing)"
fi

echo ""
echo "==============================================="
echo "Seed complete."
echo "==============================================="
