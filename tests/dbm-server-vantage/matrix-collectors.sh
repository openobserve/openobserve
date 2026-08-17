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
# 2x2 matrix collectors: build type (OSS 5080 / enterprise 5090) x trace vantage.
#
# Orgs (exact spelling, camelCase on the noTraces side):
#   o_traces    OSS   5080  WITH client spans
#   o_noTraces  OSS   5080  NO client spans
#   e_traces    ENT   5090  WITH client spans
#   e_noTraces  ENT   5090  NO client spans
#
# Each collector is an independent instance of the SAME shared collector/config.yaml
# (org + endpoint are env-driven), so no edit to that shared file is required.
#
#   *_traces   orgs additionally receive CLIENT spans. The collector takes a
#              --network-alias and a dedicated workload replica exports OTLP to it.
#   *_noTraces orgs receive SERVER vantage only: no alias, so no workload can
#              resolve them and no span can ever arrive.
#
# TRAP 1 (fixed here): the `file/raw_events` exporter OPENS but never CREATES its
# path. A shared /rawout gave "open /rawout/receiver-events.jsonl: no such file or
# directory" and the container exited(1) within seconds. Each collector now gets its
# OWN captures/raw_matrix/<org>/ directory with the file pre-created by this script.
#
# TRAP 2: Docker on this host has only ~8 GiB. Six collectors + five databases
# OOM-killed dbm-sv-mssql and dbm-sv-collector-oss (exit 137). Each matrix collector
# is capped with -m 1536m and the workload replicas with -m 256m. 512m was tried
# first and OOM-killed all four (State.OOMKilled=true) -- a healthy collector idles
# near 135 MiB, but the initial scrape burst plus the export retry queue spikes far
# above that. Starts are also staggered 20s apart so the four bursts do not coincide.
#
# Usage: ./matrix-collectors.sh up | down | status
set -euo pipefail

HOSTBASE="/Users/ashishkolhe/Documents/github/openobserve/.claude/worktrees/db-monitoring/tests/dbm-server-vantage"
BASE="/host_mnt${HOSTBASE}"
IMAGE="otel/opentelemetry-collector-contrib:0.158.0"
WORKLOAD_IMAGE="dbm-sv-workload"
AUTH="YUBhLmNvbTpQYXNzIzEyMw=="   # a@a.com:Pass#123
NET="dbm-sv_default"

# org -> container suffix (container names cannot rely on case, so map explicitly)
ORGS_ENT_TRACES="e_traces"
ORGS_ENT_NOTRACES="e_noTraces"
ORGS_OSS_TRACES="o_traces"
ORGS_OSS_NOTRACES="o_noTraces"

COLS="dbm-sv-col-e-traces dbm-sv-col-e-notraces dbm-sv-col-o-traces dbm-sv-col-o-notraces"
WLS="dbm-sv-wl-e-traces dbm-sv-wl-o-traces"
VOLS="dbm-sv-colstate-e-traces dbm-sv-colstate-e-notraces dbm-sv-colstate-o-traces dbm-sv-colstate-o-notraces"

start_one() {
  local name="$1" org="$2" endpoint="$3" alias_arg="$4"

  # TRAP 1 fix: per-collector rawout dir, with the file pre-created.
  mkdir -p "$HOSTBASE/captures/raw_matrix/$org"
  : > "$HOSTBASE/captures/raw_matrix/$org/receiver-events.jsonl"
  : > "$HOSTBASE/captures/raw_matrix/$org/recipe-rows.jsonl"

  # shellcheck disable=SC2086
  timeout 60 docker run -d --name "$name" \
    --network "$NET" $alias_arg \
    --user 0:0 -m 2048m \
    --add-host host.docker.internal:host-gateway \
    -e PGHOST=postgres -e PGPORT=5432 -e PGUSER=dbm -e PGPASS=dbm -e PGDATABASE=dbmlab \
    -e MYSQLHOST=mysql -e MYSQLPORT=3306 -e MYSQLUSER=root -e MYSQLPASS=dbm -e MYSQLDB=dbmlab \
    -e MARIAHOST=mariadb -e MARIAPORT=3306 -e MARIAUSER=root -e MARIAPASS=dbm -e MARIADB=dbmlab \
    -e MSSQLHOST=mssql -e MSSQLPORT=1433 -e MSSQLUSER=sa -e 'MSSQLPASS=dbm_Passw0rd#1' -e MSSQLDB=dbmlab \
    -e "O2_ENDPOINT=$endpoint" -e "O2_ORG=$org" -e "O2_AUTH=$AUTH" \
    -v "dbm-sv-colstate-${name#dbm-sv-col-}:/var/lib/otelcol" \
    -v "$BASE/captures/raw_matrix/$org":/rawout \
    -v "$BASE/collector/config.yaml":/etc/otelcol-contrib/config.yaml:ro \
    -v dbm-sv_pglogs:/pglogs:ro -v dbm-sv_mysqllogs:/mysqllogs:ro -v dbm-sv_mariadblogs:/mariadblogs:ro \
    "$IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null
  echo "started $name -> org=$org endpoint=$endpoint ${alias_arg:+alias=${alias_arg#--network-alias }}"
}

# A workload replica that drives the SAME databases but exports its client spans
# to the given collector alias. This is what makes a *_traces org differ.
start_workload() {
  local name="$1" collector_alias="$2"
  timeout 60 docker run -d --name "$name" \
    --network "$NET" --user 0:0 -m 256m \
    -e "OTEL_EXPORTER_OTLP_ENDPOINT=http://${collector_alias}:4318" \
    -e PGHOST=postgres -e PGPORT=5432 -e PGUSER=dbm -e PGPASSWORD=dbm -e PGDATABASE=dbmlab \
    -e MYSQL_HOST=mysql -e MYSQL_PORT=3306 -e MYSQL_USER=root -e MYSQL_PASSWORD=dbm -e MYSQL_DB=dbmlab \
    -e MARIA_HOST=mariadb -e MARIA_PORT=3306 -e MARIA_USER=root -e MARIA_PASSWORD=dbm -e MARIA_DB=dbmlab \
    -e MSSQL_HOST=mssql -e MSSQL_PORT=1433 -e MSSQL_USER=sa -e 'MSSQL_PASSWORD=dbm_Passw0rd#1' -e MSSQL_DB=dbmlab \
    -e REDIS_HOST=redis -e REDIS_PORT=6379 \
    -e DEPLOY_ENV=dbm-sv -e DEADLOCK_PERIOD_SECS=20 \
    "$WORKLOAD_IMAGE" >/dev/null
  echo "started $name -> spans to http://${collector_alias}:4318"
}

case "${1:-up}" in
  up)
    start_one dbm-sv-col-e-traces   "$ORGS_ENT_TRACES"     http://host.docker.internal:5090 "--network-alias collector-e-traces"
    sleep 20
    start_one dbm-sv-col-e-notraces "$ORGS_ENT_NOTRACES"   http://host.docker.internal:5090 ""
    sleep 20
    start_one dbm-sv-col-o-traces   "$ORGS_OSS_TRACES"     http://host.docker.internal:5080 "--network-alias collector-o-traces"
    sleep 20
    start_one dbm-sv-col-o-notraces "$ORGS_OSS_NOTRACES"   http://host.docker.internal:5080 ""
    sleep 15
    start_workload dbm-sv-wl-e-traces collector-e-traces
    start_workload dbm-sv-wl-o-traces collector-o-traces
    ;;
  down)
    for c in $COLS $WLS; do
      timeout 30 docker rm -f "$c" >/dev/null 2>&1 && echo "removed $c" || true
    done
    for v in $VOLS; do
      timeout 30 docker volume rm "$v" >/dev/null 2>&1 && echo "removed vol $v" || true
    done
    ;;
  status)
    timeout 30 docker ps -a --filter "name=dbm-sv-col" --filter "name=dbm-sv-wl" \
      --format '{{.Names}}\t{{.Status}}'
    ;;
esac
