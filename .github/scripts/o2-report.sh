#!/usr/bin/env bash
# Post a single CI run-summary JSON document to an OpenObserve stream.
#
#   Usage: o2-report.sh <stream> <payload-file>
#
# Reads the destination from the environment (set these as repo/org secrets):
#   O2_REPORTING_INGEST_BASE  e.g. https://<host>/api/<org-identifier>
#   O2_REPORTING_AUTH         base64("<email>:<passcode>")  — the Basic-auth credential
#   O2_REPORTING_INSECURE     optional; "true" skips TLS verification (curl -k) for hosts
#                             with a self-signed cert (e.g. *.internal.zinclabs.dev).
#
# This NEVER fails the caller: a missing secret, a rotated passcode (401), or any
# non-2xx response only warns. The reporting layer must not break the real CI run.
set -uo pipefail

STREAM="${1:?stream name required}"
PAYLOAD="${2:?payload file required}"

if [ -z "${O2_REPORTING_INGEST_BASE:-}" ] || [ -z "${O2_REPORTING_AUTH:-}" ]; then
  echo "::warning::O2_REPORTING_INGEST_BASE / O2_REPORTING_AUTH not set — skipping OpenObserve ingest"
  exit 0
fi

if [ ! -s "$PAYLOAD" ]; then
  echo "::warning::payload file '$PAYLOAD' missing or empty — skipping OpenObserve ingest"
  exit 0
fi

# OpenObserve's _json endpoint accepts a single object or an array; wrap to an array.
URL="${O2_REPORTING_INGEST_BASE%/}/${STREAM}/_json"
BODY="[$(cat "$PAYLOAD")]"

INSECURE=""
[ "${O2_REPORTING_INSECURE:-}" = "true" ] && INSECURE="-k"

echo "::group::OpenObserve ingest → ${STREAM}"
echo "payload:"; cat "$PAYLOAD"
HTTP_CODE=$(curl -s $INSECURE --max-time 20 -o /tmp/o2_report_resp.txt -w '%{http_code}' -X POST "$URL" \
  -H "Authorization: Basic ${O2_REPORTING_AUTH}" \
  -H "Content-Type: application/json" \
  --data "$BODY" 2>/dev/null || echo "000")

if [ "$HTTP_CODE" -ge 200 ] 2>/dev/null && [ "$HTTP_CODE" -lt 300 ] 2>/dev/null; then
  echo "::notice::Ingested CI metrics to OpenObserve stream '${STREAM}' (HTTP ${HTTP_CODE})"
  cat /tmp/o2_report_resp.txt 2>/dev/null || true
else
  echo "::warning::OpenObserve ingest to '${STREAM}' returned HTTP ${HTTP_CODE} — passcode may have rotated, or the host is unreachable. Metrics for this run were not recorded."
  cat /tmp/o2_report_resp.txt 2>/dev/null || true
fi
echo "::endgroup::"
exit 0
