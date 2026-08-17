#!/usr/bin/env bash
# ONE collector, FOUR orgs. Replaces matrix-collectors.sh (4 collectors) and
# matrix-feed-seq.sh (sequential feed) -- both are obsolete; see NOTE at bottom.
#
# Orgs (exact spelling -- O2 org ids are CASE-SENSITIVE, o_notraces != o_noTraces):
#   e_traces    ENT 5090  spans YES
#   e_noTraces  ENT 5090  spans NO
#   o_traces    OSS 5080  spans YES
#   o_noTraces  OSS 5080  spans NO
#
# WHY ONE COLLECTOR: the org appeared in exactly ONE place in the old config -- the
# exporter URL. Everything expensive (17 receivers scraping postgres/mysql/mariadb/
# mssql/redis and tailing their logs) was upstream of it, so four collectors ran 4x
# the scrapes against the same five databases purely to vary that URL. OTel
# pipelines take a LIST of exporters, so the fan-out is a config concern, not a
# process concern. Measured: ONE collector at ~1.1 GiB replaces four that wanted
# 1.4-2.4 GiB EACH and OOM-killed both each other and dbm-sv-mssql.
#
# The traces/noTraces split is enforced STRUCTURALLY in config.matrix.yaml: the
# traces pipeline lists only the two *_traces exporters, and no *_noTraces traces
# exporter is defined at all, so a span has no route to a noTraces org. The old
# design leaned on network aliases (a noTraces collector simply had no alias) --
# an ambient property any stray OTLP client on the network could defeat.
#
# TRAP: `file/raw_events` OPENS its path but never CREATES it. A missing /rawout
# kills the collector in seconds and `docker ps` just shows nothing -- always check
# `docker ps -a` and `docker logs`. This script pre-creates the directory.
#
# Usage: ./matrix-collector.sh up | down | status | mem
set -uo pipefail

HOSTBASE="/Users/ashishkolhe/Documents/github/openobserve/.claude/worktrees/db-monitoring/tests/dbm-server-vantage"
BASE="/host_mnt${HOSTBASE}"
IMAGE="otel/opentelemetry-collector-contrib:0.158.0"
AUTH="YUBhLmNvbTpQYXNzIzEyMw=="   # a@a.com:Pass#123
NET="dbm-sv_default"
NAME="dbm-sv-col-matrix"

case "${1:-up}" in
  up)
    mkdir -p "$HOSTBASE/captures/raw_matrix/single"
    : > "$HOSTBASE/captures/raw_matrix/single/receiver-events.jsonl"
    : > "$HOSTBASE/captures/raw_matrix/single/recipe-rows.jsonl"

    timeout 30 docker rm -f "$NAME" >/dev/null 2>&1

    # The two collector-*-traces aliases keep the EXISTING dbm-sv-wl-* workload
    # replicas working unchanged -- they were pointed at the old per-org collectors.
    # Both now resolve to this one collector, whose traces pipeline fans their spans
    # out to e_traces and o_traces.
    timeout 60 docker run -d --name "$NAME" \
      --network "$NET" \
      --network-alias collector-matrix \
      --network-alias collector-e-traces \
      --network-alias collector-o-traces \
      --user 0:0 -m 4608m \
      --add-host host.docker.internal:host-gateway \
      -e PGHOST=postgres -e PGPORT=5432 -e PGUSER=dbm -e PGPASS=dbm -e PGDATABASE=dbmlab \
      -e MYSQLHOST=mysql -e MYSQLPORT=3306 -e MYSQLUSER=root -e MYSQLPASS=dbm -e MYSQLDB=dbmlab \
      -e MARIAHOST=mariadb -e MARIAPORT=3306 -e MARIAUSER=root -e MARIAPASS=dbm -e MARIADB=dbmlab \
      -e MSSQLHOST=mssql -e MSSQLPORT=1433 -e MSSQLUSER=sa -e 'MSSQLPASS=dbm_Passw0rd#1' -e MSSQLDB=dbmlab \
      -e "O2_AUTH=$AUTH" \
      -v dbm-sv-colstate-matrix:/var/lib/otelcol \
      -v "$BASE/captures/raw_matrix/single":/rawout \
      -v "$BASE/collector/config.matrix.yaml":/etc/otelcol-contrib/config.yaml:ro \
      -v dbm-sv_pglogs:/pglogs:ro -v dbm-sv_mysqllogs:/mysqllogs:ro -v dbm-sv_mariadblogs:/mariadblogs:ro \
      "$IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null || { echo "docker run FAILED"; exit 1; }

    sleep 20
    local_status=$(timeout 30 docker inspect "$NAME" --format 'status={{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' 2>/dev/null)
    echo "$NAME: $local_status"
    if ! printf '%s' "$local_status" | grep -q 'status=running'; then
      echo "FAILED TO STAY UP -- last logs:"
      timeout 30 docker logs --tail 15 "$NAME" 2>&1 | cut -c1-220 | sed 's/^/    /'
      exit 1
    fi
    # NOTE: `docker logs | grep -q` exits 141 (SIGPIPE) because grep -q closes the
    # pipe as soon as it matches, which made this script report a false failure on a
    # perfectly healthy start. Count instead of short-circuiting.
    if [ "$(timeout 30 docker logs "$NAME" 2>&1 | grep -c 'Everything is ready')" -gt 0 ]; then
      echo "pipelines ready -> e_traces, e_noTraces (5090) + o_traces, o_noTraces (5080)"
    fi
    ;;
  down)
    timeout 30 docker rm -f "$NAME" >/dev/null 2>&1 && echo "removed $NAME"
    timeout 30 docker volume rm dbm-sv-colstate-matrix >/dev/null 2>&1 && echo "removed state volume"
    ;;
  status)
    timeout 30 docker ps -a --filter "name=$NAME" --format '{{.Names}}\t{{.Status}}'
    ;;
  mem)
    timeout 30 docker stats --no-stream --format '{{.Name}}\t{{.MemUsage}}\tcpu={{.CPUPerc}}' "$NAME"
    echo -n "data refused (last 2m): "; timeout 60 docker logs --since 2m "$NAME" 2>&1 | grep -c "data refused"
    echo -n "queue full   (last 2m): "; timeout 60 docker logs --since 2m "$NAME" 2>&1 | grep -c "sending queue is full"
    ;;
esac

# NOTE ON OBSOLETE SCRIPTS
# ------------------------
# matrix-collectors.sh  -- started FOUR collectors. Its premise (org is per-process)
#                          is wrong; org is per-exporter. Superseded by this script.
# matrix-feed-seq.sh    -- fed the orgs one at a time to dodge an OOM that was never
#                          a genuine memory requirement (see task-4 finding: the 2 GiB
#                          collector was an unbounded in-memory retry queue against a
#                          backend whose DNS was timing out, not a working set).
#                          Parallel feeding works; sequential feeding is unnecessary.
# matrix-verify.sh / matrix-evidence.sh -- STILL VALID. They only query O2 and do not
#                          care how many collectors produced the data.
