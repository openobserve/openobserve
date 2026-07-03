#!/usr/bin/env bash
# Idempotent seeding for test-assist CI. Throwaway — replace once real Needs-Testing flow is up.
#
# pipefail is intentional — without it, `curl … | tee …` would mask a non-zero curl exit (set -e
# does NOT propagate through pipes). Auth is passed via Authorization header (NOT `curl -u`) so
# the password never appears in `ps` output on shared runners.
set -euo pipefail

: "${ZO_BASE_URL:?ZO_BASE_URL not set}"
: "${ZO_ROOT_USER_EMAIL:?ZO_ROOT_USER_EMAIL not set}"
: "${ZO_ROOT_USER_PASSWORD:?ZO_ROOT_USER_PASSWORD not set}"
ORG="${ORGNAME:-default}"
STREAM="${CI_SEED_STREAM:-ci_seed_stream}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Seeding $STREAM on $ZO_BASE_URL (org=$ORG)"

# Build basic-auth header in-process; the resulting variable is passed via -H, not as a CLI arg
# visible in process listings.
AUTH_B64=$(printf '%s' "${ZO_ROOT_USER_EMAIL}:${ZO_ROOT_USER_PASSWORD}" | base64)

curl -sS --fail-with-body \
  -H "Authorization: Basic ${AUTH_B64}" \
  -H 'Content-Type: application/json' \
  --data-binary "@${HERE}/logs_seed.json" \
  "${ZO_BASE_URL%/}/api/${ORG}/${STREAM}/_json" \
  | tee /tmp/test-assist-ci-seed.log

echo
echo "Seed complete."
