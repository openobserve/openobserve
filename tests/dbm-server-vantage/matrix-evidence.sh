#!/usr/bin/env bash
# Supplementary evidence for the 2x2 matrix, beyond the endpoint status table:
#   A) dbm_server row count per org  (proves ingest actually landed)
#   B) trace stream presence         (proves the traces / noTraces dimension)
#   C) raw-vs-canonical o2_dbm_engine (proves canonicalizers are enterprise-only)
#
# Usage: ./matrix-evidence.sh [window_seconds]   (default 7200)
set -uo pipefail

WINDOW="${1:-7200}"
AUTH='a@a.com:Pass#123'
NOW=$(python3 -c "import time; print(int(time.time()*1_000_000))")
AGO=$(python3 -c "import time,sys; print(int((time.time()-float(sys.argv[1]))*1_000_000))" "$WINDOW")

o2search() { # org port sql
  curl -s -m 90 -u "$AUTH" -H 'Content-Type: application/json' \
    -X POST "http://localhost:$2/api/$1/_search?type=logs" \
    -d "{\"query\":{\"sql\":$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$3"),\"start_time\":$AGO,\"end_time\":$NOW,\"size\":50}}" 2>/dev/null
}

echo "############ A) dbm_server ROW COUNT per org ############"
printf '%-12s %-6s %s\n' ORG PORT ROWS
while read -r org port; do
  r=$(o2search "$org" "$port" "select count(*) as c from dbm_server" \
      | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); h=d.get("hits") or [{}]
  print(h[0].get("c","ERR") if h else 0)
except Exception: print("ERR")' 2>/dev/null)
  printf '%-12s %-6s %s\n' "$org" "$port" "$r"
done <<EOF
e_traces 5090
e_noTraces 5090
o_traces 5080
o_noTraces 5080
EOF

echo
echo "############ B) TRACE STREAM presence per org ############"
printf '%-12s %-6s %-10s %s\n' ORG PORT TRACE_STRMS NAMES
while read -r org port; do
  out=$(curl -s -m 60 -u "$AUTH" "http://localhost:$port/api/$org/streams?type=traces" 2>/dev/null \
    | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin); L=d.get("list",[])
  print(len(L), ",".join(x.get("name","?") for x in L) or "-")
except Exception: print("ERR -")' 2>/dev/null)
  printf '%-12s %-6s %-10s %s\n' "$org" "$port" ${out:-ERR -}
done <<EOF
e_traces 5090
e_noTraces 5090
o_traces 5080
o_noTraces 5080
EOF

echo
echo "############ C) RAW vs CANONICAL: o2_dbm_engine on RECIPE-TAGGED rows ############"
echo "# Filtered to o2_recipe IS NOT NULL. Receiver-native rows carry an engine on the"
echo "# wire and would blur the contrast. Enterprise => engine POPULATED; OSS => NULL."
for pair in "e_traces 5090" "e_noTraces 5090" "o_traces 5080" "o_noTraces 5080"; do
  set -- $pair; org=$1; port=$2
  echo "--- $org (port $port) ---"
  o2search "$org" "$port" \
    "select o2_recipe, o2_dbm_engine, count(*) as c from dbm_server where o2_recipe is not null group by o2_recipe, o2_dbm_engine order by c desc" \
    | python3 -c 'import sys,json
try:
  d=json.load(sys.stdin)
except Exception:
  print("   (no/invalid response)"); raise SystemExit
h=d.get("hits")
if not h: print("   (no recipe-tagged rows)"); raise SystemExit
print("   %-28s %-14s %s" % ("o2_recipe","o2_dbm_engine","count"))
for r in h[:25]:
  print("   %-28s %-14s %s" % (r.get("o2_recipe"), r.get("o2_dbm_engine") if r.get("o2_dbm_engine") is not None else "NULL", r.get("c")))
' 2>/dev/null
done
echo
echo "window: last ${WINDOW}s ($AGO .. $NOW)"
