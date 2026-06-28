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

# Stream names are workflow-controlled, but validate defensively so this is safe to reuse:
# only [a-z0-9_], which can't break out of the URL path.
if ! printf '%s' "$STREAM" | grep -qE '^[a-z0-9_]+$'; then
  echo "::warning::invalid stream name '$STREAM' (expected [a-z0-9_]) — skipping OpenObserve ingest"
  exit 0
fi

if [ -z "${O2_REPORTING_INGEST_BASE:-}" ] || [ -z "${O2_REPORTING_AUTH:-}" ]; then
  echo "::warning::O2_REPORTING_INGEST_BASE / O2_REPORTING_AUTH not set — skipping OpenObserve ingest"
  exit 0
fi

if [ ! -s "$PAYLOAD" ]; then
  echo "::warning::payload file '$PAYLOAD' missing or empty — skipping OpenObserve ingest"
  exit 0
fi

# Stream the body from a temp file (mktemp → unique per invocation, no shared-/tmp races,
# no whole-payload-in-a-shell-var).
URL="${O2_REPORTING_INGEST_BASE%/}/${STREAM}/_json"
BODY_FILE=$(mktemp "${TMPDIR:-/tmp}/o2_report_body.XXXXXX")
RESP_FILE=$(mktemp "${TMPDIR:-/tmp}/o2_report_resp.XXXXXX")
trap 'rm -f "$BODY_FILE" "$RESP_FILE"' EXIT
# _json accepts a single object OR an array. Wrap a bare object in [ ]; pass an existing array
# through unchanged so multi-row callers (e.g. per-shard rows) aren't double-wrapped into [[...]].
if [ "$(tr -d '[:space:]' < "$PAYLOAD" | cut -c1)" = "[" ]; then
  cat "$PAYLOAD" > "$BODY_FILE"
else
  { printf '['; cat "$PAYLOAD"; printf ']'; } > "$BODY_FILE"
fi

INSECURE=""
[ "${O2_REPORTING_INSECURE:-}" = "true" ] && INSECURE="-k"

echo "::group::OpenObserve ingest → ${STREAM}"
echo "payload:"; cat "$PAYLOAD"
HTTP_CODE=$(curl -s $INSECURE --max-time 20 -o "$RESP_FILE" -w '%{http_code}' -X POST "$URL" \
  -H "Authorization: Basic ${O2_REPORTING_AUTH}" \
  -H "Content-Type: application/json" \
  --data-binary @"$BODY_FILE" 2>/dev/null || echo "000")

if printf '%s' "$HTTP_CODE" | grep -qE '^[0-9]+$' && [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  echo "::notice::Ingested CI metrics to OpenObserve stream '${STREAM}' (HTTP ${HTTP_CODE})"
  cat "$RESP_FILE" 2>/dev/null || true
else
  echo "::warning::OpenObserve ingest to '${STREAM}' returned HTTP ${HTTP_CODE} — passcode may have rotated, or the host is unreachable. Metrics for this run were not recorded."
  cat "$RESP_FILE" 2>/dev/null || true
fi
echo "::endgroup::"
exit 0
