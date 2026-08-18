#!/usr/bin/env bash
# POSTGRES-ONLY rig, TWO LANES against the SAME database:
#
#   ./pg-rig.sh up pg     -> org 3I5P2XLx14DvzepfpUikQX0nV9Y ("pg_server")
#                            SERVER data only: dbm_server logs + pg metrics.
#                            No traces: no exporter, no pipeline, otlp unused.
#
#   ./pg-rig.sh up pgcs   -> org 3I5dk6zTLaUO6mehphFztiODMKh ("pg_clinet_server")
#                            The SAME server data, PLUS the workload's client
#                            spans (CLIENT + SERVER vantage).
#
# Both lanes carry the FULL server-vantage feed -- the only difference is whether
# spans have a route. Run them side by side (each has its own containers, state
# volume and raw sink) and the two orgs differ by exactly one signal, which is
# what makes the client-vantage half testable in isolation.
#
#   server   http://localhost:5080   (the one OpenObserve running on this box)
#   NOT sent no mysql/mariadb/mssql/redis data on either lane
#
# Brings up ONLY dbm-sv-postgres + a pg-only workload + a pg-only collector. The
# other four database containers stay down -- they cost ~4 GiB on this Docker VM
# and produce nothing this lane ships.
#
# ON THE `pg` LANE, no-traces is enforced in four independent places, any one of
# which suffices -- it is a structural absence, not a filter that could be
# misconfigured:
#   1. the workload runs WORKLOAD_TRACES=0, so no span is ever exported
#   2. the collector config defines NO traces exporter
#   3. it defines NO traces pipeline
#   4. the `otlp` receiver (the only span ingress) is in no pipeline, the
#      container publishes no 4317/4318 port, and the workload is given no
#      OTEL_EXPORTER_OTLP_ENDPOINT, so a span has no address to go to
#
# The `pgcs` lane reverses exactly those four and changes nothing else.
#
# Unlike quad-rig.sh this derives its own path instead of hardcoding one (that
# script still points at a worktree that no longer exists here).
#
# TRAP: `file/raw_events` OPENS its path but never CREATES it. A missing /rawout
# kills the collector within seconds and `docker ps` shows nothing -- always
# check `docker ps -a` and `docker logs`. This script pre-creates the directory.
#
# Usage: ./pg-rig.sh up | down | status | logs | verify
set -uo pipefail

HOSTBASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Docker Desktop on macOS bind-mounts host paths under /host_mnt.
BASE="/host_mnt${HOSTBASE}"
IMAGE="otel/opentelemetry-collector-contrib:0.158.0"
# LANE SELECTION. `pg` (default) is server-vantage only; `pgcs` adds the
# workload's client spans. Both scrape the SAME Postgres with the SAME recipes
# and BOTH receive the full server-vantage feed -- the ONLY difference is
# whether traces have a route. Usage: ./pg-rig.sh up [pg|pgcs]
#
# The two lanes are independent containers with their own state volumes and raw
# sinks, so they can run side by side against one database. That is the point:
# it makes "same server data, one org also gets traces" directly comparable.
LANE="${2:-pg}"
case "$LANE" in
  pg)
    ORG="3I5P2XLx14DvzepfpUikQX0nV9Y"; ORGNAME="pg_server"
    CFG="config.pg.yaml"; TRACES=0 ;;
  pgcs)
    ORG="3I5dk6zTLaUO6mehphFztiODMKh"; ORGNAME="pg_clinet_server"
    CFG="config.pgcs.yaml"; TRACES=1 ;;
  *) echo "unknown lane '$LANE' (expected pg|pgcs)"; exit 1 ;;
esac

# SPAN INGRESS, only on the traces lane.
#   COL_ALIAS  gives the collector a stable DNS name on the compose network.
#   WL_OTLP    points the workload's OTel SDK at it. The SDK's default is
#              http://localhost:4318 -- inside the WORKLOAD container, which
#              listens on nothing, so without this every span is silently
#              dropped and a traces lane looks identical to a no-traces one.
# On the pg lane both are empty: no alias, no endpoint, no route for a span.
if [ "$TRACES" = "1" ]; then
  COL_ALIAS="--network-alias collector-$LANE"
  WL_OTLP="-e OTEL_EXPORTER_OTLP_ENDPOINT=http://collector-$LANE:4318"
else
  COL_ALIAS=""
  WL_OTLP=""
fi
O2_URL="http://localhost:5080"
O2_USER="a@a.com"
O2_PASS='Pass#123'
AUTH="$(printf '%s:%s' "$O2_USER" "$O2_PASS" | base64)"
# Compose interpolates EVERY service in the file -- including the compose
# `collector`, whose O2_AUTH is declared `${O2_AUTH:?...}` -- even when the
# command only names `postgres`. So this must be exported before any compose
# call, or `up --wait postgres` fails on an unrelated service's variable.
export O2_AUTH="$AUTH"
NET="dbm-sv_default"
COL="dbm-sv-col-$LANE"
WL="dbm-sv-wl-$LANE"
# The -f pair applies docker-compose.pg.yml ON TOP of the base file. That
# override exists for ONE reason: it enables Postgres log rotation, which the
# base compose disables. Without it postgresql.log grows without bound (measured
# 119 GB) and filelog/pg silently stops delivering events. See that file's header.
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.pg.yml"

case "${1:-up}" in
  up)
    cd "$HOSTBASE" || exit 1

    python3 "$HOSTBASE/gen-pg-config.py" || { echo "config generation FAILED"; exit 1; }

    # Postgres ONLY. --wait blocks until its healthcheck passes, which is what
    # keeps the workload from racing it.
    echo "== starting postgres =="
    $COMPOSE up -d --wait postgres || { echo "postgres FAILED to come up"; exit 1; }

    mkdir -p "$HOSTBASE/captures/raw_$LANE"
    : > "$HOSTBASE/captures/raw_$LANE/receiver-events.jsonl"

    timeout 30 docker rm -f "$COL" "$WL" >/dev/null 2>&1

    echo "== starting collector =="
    # No -p 4317/4318: this collector accepts no OTLP ingress at all.
    timeout 60 docker run -d --name "$COL" \
      --network "$NET" \
      $COL_ALIAS \
      --user 0:0 -m 2048m \
      --restart unless-stopped \
      --add-host host.docker.internal:host-gateway \
      `# PGHOST is the rig's INSTANCE IDENTITY, not just a connection target:` \
      `# the sqlquery recipes stamp it into every row as server_address and` \
      `# resource/ident upserts it as server.address/host.name, so it is the` \
      `# value the UI's "database" (instance) filter offers. pg-prod-1 is a` \
      `# compose network ALIAS for the same container -- a production-shaped` \
      `# host name rather than the placeholder-looking service name. The` \
      `# workload below deliberately keeps PGHOST=postgres: it only connects,` \
      `# and leaving it untouched keeps this change to the telemetry path.` \
      -e PGHOST=pg-prod-1 -e PGPORT=5432 -e PGUSER=dbm -e PGPASS=dbm -e PGDATABASE=dbmlab \
      -e "O2_AUTH=$AUTH" \
      -v dbm-sv-colstate-$LANE:/var/lib/otelcol \
      -v "$BASE/captures/raw_$LANE":/rawout \
      -v "$BASE/collector/$CFG":/etc/otelcol-contrib/config.yaml:ro \
      -v dbm-sv_pglogs:/pglogs:ro \
      "$IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null \
      || { echo "collector docker run FAILED"; exit 1; }

    echo "== starting pg-only workload (traces $([ "$TRACES" = 1 ] && echo ON || echo OFF)) =="
    $COMPOSE build workload >/dev/null 2>&1 || { echo "workload build FAILED"; exit 1; }
    timeout 60 docker run -d --name "$WL" \
      --network "$NET" \
      --restart unless-stopped \
      -e WORKLOAD_ENGINES=pg \
      -e WORKLOAD_TRACES=$TRACES \
      $WL_OTLP \
      -e PGHOST=postgres -e PGPORT=5432 -e PGUSER=dbm -e PGPASSWORD=dbm -e PGDATABASE=dbmlab \
      -e DEPLOY_ENV=dbm-sv -e DEADLOCK_PERIOD_SECS=20 \
      dbm-sv-workload >/dev/null \
      || { echo "workload docker run FAILED"; exit 1; }

    sleep 20
    for c in "$COL" "$WL"; do
      st=$(timeout 30 docker inspect "$c" --format 'status={{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' 2>/dev/null)
      echo "$c: $st"
      if ! printf '%s' "$st" | grep -q 'status=running'; then
        echo "  FAILED TO STAY UP -- last logs:"
        timeout 30 docker logs --tail 20 "$c" 2>&1 | cut -c1-220 | sed 's/^/    /'
        exit 1
      fi
    done
    # `docker logs | grep -q` exits 141 (SIGPIPE) because grep -q closes the pipe
    # on first match, which reads as a false failure. Count instead.
    if [ "$(timeout 30 docker logs "$COL" 2>&1 | grep -c 'Everything is ready')" -gt 0 ]; then
      echo "pipelines ready -> $ORG ($ORGNAME) on $O2_URL (logs + metrics$([ "$TRACES" = 1 ] && echo " + TRACES" || echo ", no traces"))"
    fi
    ;;

  down)
    timeout 30 docker rm -f "$COL" "$WL" >/dev/null 2>&1 && echo "removed $COL, $WL"
    timeout 30 docker volume rm dbm-sv-colstate-$LANE >/dev/null 2>&1 && echo "removed state volume"
    echo "NOTE: dbm-sv-postgres left running. Stop it with: docker compose stop postgres"
    ;;

  status)
    timeout 30 docker ps -a --filter "name=$COL" --filter "name=$WL" \
      --filter "name=dbm-sv-postgres" --format '{{.Names}}\t{{.Status}}'
    ;;

  logs)
    timeout 30 docker logs --tail "${2:-60}" "$COL" 2>&1 | cut -c1-240
    ;;

  verify)
    # Proves what THIS lane claims: server data is arriving, and traces are
    # present exactly when the lane says they should be. Window: last 15 min.
    echo "== lane $LANE -> $ORG ($ORGNAME), traces expected: $([ "$TRACES" = 1 ] && echo YES || echo NO) =="
    echo -n "   traces streams in org: "
    curl -s -m 20 -u "$O2_USER:$O2_PASS" "$O2_URL/api/$ORG/streams?type=traces" \
      | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("list",[])))'

    FROM=$(( ($(date +%s)-900)*1000000 )); TO=$(( ($(date +%s)+60)*1000000 ))
    echo "== streams in $ORG =="
    curl -s -u "$O2_USER:$O2_PASS" "$O2_URL/api/$ORG/streams" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);[print("   %-8s %s" % (s["stream_type"], s["name"])) for s in d.get("list",[])] or print("  none")'
    echo "== dbm_server rows by recipe/event (last 15m) =="
    curl -s -u "$O2_USER:$O2_PASS" -H 'Content-Type: application/json' \
      "$O2_URL/api/$ORG/_search?type=logs" \
      -d "{\"query\":{\"sql\":\"SELECT o2_recipe, o2_pg_event, count(*) AS n FROM dbm_server GROUP BY o2_recipe, o2_pg_event ORDER BY n DESC\",\"start_time\":$FROM,\"end_time\":$TO,\"size\":50}}" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);h=d.get("hits",[]);[print("  ",x) for x in h] or print("  no hits")'
    ;;
esac
