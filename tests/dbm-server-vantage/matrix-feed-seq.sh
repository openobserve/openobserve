#!/usr/bin/env bash
# ============================ OBSOLETE -- DO NOT USE ============================
# Superseded by ./matrix-collector.sh (ONE collector, four orgs).
#
# Why this script is wrong: it assumed the target ORG is a per-PROCESS property, so
# feeding four orgs needed four collectors. It is not -- the org appears only in the
# exporter URL, and an OTel pipeline accepts a LIST of exporters. Everything costly
# (17 receivers against five databases) sat upstream of that URL, so this design ran
# 4x the scrape load on the same databases to vary one string.
#
# The OOM that motivated it was also misdiagnosed. The "1.4-2.4 GiB per collector"
# figure was not a working set: it was an UNBOUNDED IN-MEMORY RETRY QUEUE. The
# shared config sets retry_on_failure with no max_elapsed_time and no sending_queue
# bound, and no memory_limiter anywhere, so when host.docker.internal DNS started
# timing out, a collector buffered instead of shedding. Evidence: dbm-sv-collector-oss
# logged 28,308 "sending queue is full" against 0 for its identical sibling, and sat
# at 2.06 GiB while that sibling sat at 95 MiB on the SAME config. Its file_storage
# volume was 76 KB and held only filelog offsets -- persistence was never involved.
#
# config.matrix.yaml fixes the actual defect (memory_limiter + bounded queue +
# capped retry) and fans out from one process.
# ===============================================================================
# Feed the four 2x2 matrix orgs SEQUENTIALLY, one collector at a time.
#
# WHY SEQUENTIAL: Docker on this host has ~7.8 GiB total and the baseline rig
# already holds ~3.3 GiB. This collector config drives ~17 receivers against four
# databases and measures 1.4-2.2 GiB RESIDENT in steady state (not a spike, and not
# an export backlog -- "Sender failed" count was 0 while it sat at 1.442 GiB of a
# 1.5 GiB cap). Four concurrent collectors therefore cannot fit: every parallel
# attempt ended in State.OOMKilled=true, at 512m and again at 1536m, and the OOM
# killer also took down dbm-sv-mssql and dbm-sv-collector-oss as collateral.
#
# Running one at a time fits in the ~4.5 GiB of headroom with room to spare and
# still lands real data in all four orgs, because DBM only needs each org to have
# been scraped -- the orgs do not have to be scraped simultaneously.
#
# Usage: ./matrix-feed-seq.sh [seconds_per_org]   (default 240)
set -uo pipefail

HOSTBASE="/Users/ashishkolhe/Documents/github/openobserve/.claude/worktrees/db-monitoring/tests/dbm-server-vantage"
BASE="/host_mnt${HOSTBASE}"
IMAGE="otel/opentelemetry-collector-contrib:0.158.0"
AUTH="YUBhLmNvbTpQYXNzIzEyMw=="   # a@a.com:Pass#123
NET="dbm-sv_default"
DWELL="${1:-240}"

run_org() {
  local name="$1" org="$2" endpoint="$3" alias="$4"

  mkdir -p "$HOSTBASE/captures/raw_matrix/$org"
  : > "$HOSTBASE/captures/raw_matrix/$org/receiver-events.jsonl"
  : > "$HOSTBASE/captures/raw_matrix/$org/recipe-rows.jsonl"

  timeout 30 docker rm -f "$name" >/dev/null 2>&1

  local alias_args=(); alias_args=()
  [ -n "$alias" ] && alias_args=(--network-alias "$alias")

  timeout 60 docker run -d --name "$name" \
    --network "$NET" ${alias_args[@]+"${alias_args[@]}"} \
    --user 0:0 -m 2560m \
    --add-host host.docker.internal:host-gateway \
    -e PGHOST=postgres -e PGPORT=5432 -e PGUSER=dbm -e PGPASS=dbm -e PGDATABASE=dbmlab \
    -e MYSQLHOST=mysql -e MYSQLPORT=3306 -e MYSQLUSER=root -e MYSQLPASS=dbm -e MYSQLDB=dbmlab \
    -e MARIAHOST=mariadb -e MARIAPORT=3306 -e MARIAUSER=root -e MARIAPASS=dbm -e MARIADB=dbmlab \
    -e MSSQLHOST=mssql -e MSSQLPORT=1433 -e MSSQLUSER=sa -e 'MSSQLPASS=dbm_Passw0rd#1' -e MSSQLDB=dbmlab \
    -e "O2_ENDPOINT=$endpoint" -e "O2_ORG=$org" -e "O2_AUTH=$AUTH" \
    -v "dbm-sv-colstate-seq:/var/lib/otelcol" \
    -v "$BASE/captures/raw_matrix/$org":/rawout \
    -v "$BASE/collector/config.yaml":/etc/otelcol-contrib/config.yaml:ro \
    -v dbm-sv_pglogs:/pglogs:ro -v dbm-sv_mysqllogs:/mysqllogs:ro -v dbm-sv_mariadblogs:/mariadblogs:ro \
    "$IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null

  sleep 10
  local st
  st=$(timeout 30 docker inspect "$name" --format '{{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' 2>/dev/null)
  echo "  [$org] after 10s: $st"
  if ! printf '%s' "$st" | grep -q '^running'; then
    echo "  [$org] FAILED TO STAY UP -- last log lines:"
    timeout 30 docker logs --tail 5 "$name" 2>&1 | cut -c1-200 | sed 's/^/      /'
    return 1
  fi

  echo "  [$org] scraping for ${DWELL}s ..."
  sleep "$DWELL"
  local mem
  mem=$(timeout 30 docker stats --no-stream --format '{{.MemUsage}}' "$name" 2>/dev/null)
  echo "  [$org] done. mem=$mem"
  timeout 30 docker rm -f "$name" >/dev/null 2>&1
  sleep 5
}

echo "=== sequential feed, ${DWELL}s per org ==="
# traces orgs need their workload replica resolvable via the collector alias.
run_org dbm-sv-seq-col e_traces   http://host.docker.internal:5090 collector-e-traces
run_org dbm-sv-seq-col e_noTraces http://host.docker.internal:5090 ""
run_org dbm-sv-seq-col o_traces   http://host.docker.internal:5080 collector-o-traces
run_org dbm-sv-seq-col o_noTraces http://host.docker.internal:5080 ""
echo "=== feed complete ==="
