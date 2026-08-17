#!/usr/bin/env bash
# Verify every DBM endpoint for every org in the 2x2 matrix.
# Records HTTP status AND hit count so 403-vs-200 and populated-vs-empty are both visible.
#
# Usage: ./matrix-verify.sh [window_seconds]   (default 3600)
set -uo pipefail

WINDOW="${1:-3600}"
USER='a@a.com'
PASS='Pass#123'
NOW=$(python3 -c "import time; print(int(time.time()*1_000_000))")
AGO=$(python3 -c "import time,sys; print(int((time.time()-float(sys.argv[1]))*1_000_000))" "$WINDOW")

EPS="databases queries activity deadlocks blocking table_health"

printf '%-14s %-8s %-14s %-6s %-9s %s\n' ORG PORT ENDPOINT HTTP HITS NOTE
printf '%s\n' "---------------------------------------------------------------------------"

check() {
  local org="$1" port="$2"
  for ep in $EPS; do
    local body code hits note
    body=$(curl -s -m 90 -w $'\n%{http_code}' -u "$USER:$PASS" \
      "http://localhost:$port/api/$org/traces/db_monitoring/$ep?start_time=$AGO&end_time=$NOW" 2>/dev/null)
    code=$(printf '%s' "$body" | tail -1)
    payload=$(printf '%s' "$body" | sed '$d')
    read -r hits note <<<"$(printf '%s' "$payload" | python3 -c '
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print("-", (sys.stdin.read() or "")[:40].replace("\n"," ")); raise SystemExit
if isinstance(d,dict) and "message" in d and len(d)<=3:
    print("-", str(d.get("message"))[:48].replace("\n"," ")); raise SystemExit
# "hits" is the canonical payload list for every DBM endpoint; trust it first
# and only fall back to other shapes. Counting nested lists indiscriminately
# under-reported responses whose hits carry list-valued fields.
def count(x):
    if isinstance(x,list): return len(x)
    if isinstance(x,dict):
        if isinstance(x.get("hits"),list): return len(x["hits"])
        for k in ("data","databases","queries","rows","samples","items","events","tables","results"):
            v=x.get(k)
            if isinstance(v,list): return len(v)
    return 0
n=count(d)
keys=",".join(list(d.keys())[:4]) if isinstance(d,dict) else type(d).__name__
print(n, keys)
' 2>/dev/null)"
    [ -z "${hits:-}" ] && hits="?"
    printf '%-14s %-8s %-14s %-6s %-9s %s\n' "$org" "$port" "$ep" "$code" "$hits" "${note:0:52}"
  done
  echo
}

check e_traces   5090
check e_noTraces 5090
check o_traces   5080
check o_noTraces 5080

echo "window: last ${WINDOW}s  ($AGO .. $NOW)"
