#!/usr/bin/env bash
# Reproduction: unauthenticated MCP POST must return 401 WITH a WWW-Authenticate
# header advertising RFC 9728 resource metadata. Fails before Task 4.
set -euo pipefail
BASE="${O2_BASE:-http://localhost:5080}"
ORG="${O2_ORG:-default}"
hdrs=$(curl -sS -D - -o /dev/null -X POST "$BASE/api/$ORG/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}')
echo "$hdrs" | grep -qi "^HTTP/.* 401" || { echo "FAIL: expected 401"; exit 1; }
echo "$hdrs" | grep -qi "^WWW-Authenticate:.*resource_metadata=" \
  || { echo "FAIL: missing WWW-Authenticate resource_metadata"; exit 1; }
echo "PASS"
