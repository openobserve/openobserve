#!/usr/bin/env bash
# Idempotent seeding for test-assist CI. Throwaway — replace once real Needs-Testing flow is up.
set -euo pipefail

: "${ZO_BASE_URL:?ZO_BASE_URL not set}"
: "${ZO_ROOT_USER_EMAIL:?ZO_ROOT_USER_EMAIL not set}"
: "${ZO_ROOT_USER_PASSWORD:?ZO_ROOT_USER_PASSWORD not set}"
ORG="${ORGNAME:-default}"
STREAM="${CI_SEED_STREAM:-ci_seed_stream}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "Seeding $STREAM on $ZO_BASE_URL (org=$ORG)"

curl -sS -u "$ZO_ROOT_USER_EMAIL:$ZO_ROOT_USER_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data-binary "@${HERE}/logs_seed.json" \
  "${ZO_BASE_URL%/}/api/${ORG}/${STREAM}/_json" \
  | tee /tmp/test-assist-ci-seed.log

echo
echo "Seed complete."
