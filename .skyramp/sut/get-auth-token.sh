#!/bin/bash
# Output the HTTP Basic auth credential for OpenObserve API calls.
# Emit the bare base64 only — no "Basic " prefix, no trailing newline. The caller
# supplies the scheme, so adding it here produces a malformed header.
# Idempotent: the admin user is seeded at server startup so no creation is needed.
EMAIL="${ZO_ROOT_USER_EMAIL:-root@example.com}"
PASSWORD="${ZO_ROOT_USER_PASSWORD:-Complexpass#123}"
printf '%s' "$(printf '%s:%s' "$EMAIL" "$PASSWORD" | base64 -w0)"
