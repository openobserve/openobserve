#!/usr/bin/env bash
# Prints the Basic-auth Authorization header value for the SUT's root user.
# No API call needed: the root user is auto-provisioned by the server itself
# from ZO_ROOT_USER_EMAIL/ZO_ROOT_USER_PASSWORD at boot (baked into
# setup.sh's server launch env), so this script only ever needs to run the
# same base64 encoding — genuinely idempotent, safe to call every run.
set -euo pipefail

ROOT_EMAIL="root@example.com"
ROOT_PASSWORD='Complexpass#123'

printf 'Basic %s\n' "$(printf '%s' "${ROOT_EMAIL}:${ROOT_PASSWORD}" | base64 -w0)"
