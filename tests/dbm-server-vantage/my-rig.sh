#!/usr/bin/env bash
# MYSQL-ONLY rig, TWO LANES against the SAME database:
#
#   ./my-rig.sh up my     -> org mysql_server
#                            SERVER data only: dbm_server logs + mysql metrics.
#                            No traces: no exporter, no pipeline, otlp unused.
#
#   ./my-rig.sh up mycs   -> org mysql_client_server
#                            The SAME server data, PLUS the workload's client
#                            spans (CLIENT + SERVER vantage).
#
# Both lanes carry the FULL server-vantage feed -- the only difference is whether
# spans have a route. Run them side by side (each has its own containers, state
# volume and raw sink) and the two orgs differ by exactly one signal, which is
# what makes the client-vantage half testable in isolation.
#
#   server   http://localhost:5080   (the one OpenObserve running on this box)
#   NOT sent no pg/mariadb/mssql/redis data on either lane
#
# THE ORGS. Both were created by the FIRST INGEST, not by the org-create API:
# POST /api/organizations ignores a supplied identifier, mints a random ksuid and
# is not idempotent on name, so calling it produces ghost orgs that cannot be
# deleted on a non-cloud build. Ingesting as root to /api/<id>/... auto-creates
# <id> exactly (validator.rs:758). See gen-my-config.py's header.
#
# COEXISTENCE WITH THE PG LANES. dbm-sv-col-pg / dbm-sv-col-pgcs and their
# workloads are expected to be RUNNING while these lanes run. Everything here is
# per-lane-suffixed -- container names (dbm-sv-col-$LANE / dbm-sv-wl-$LANE),
# state volume (dbm-sv-colstate-$LANE) and raw sink (captures/raw_$LANE) -- so
# nothing collides. This script never touches the postgres container, the pg
# collectors, or their configs; `up` starts ONLY the mysql service by name.
#
# ON THE `my` LANE, no-traces is enforced in four independent places, any one of
# which suffices -- it is a structural absence, not a filter that could be
# misconfigured:
#   1. the workload runs WORKLOAD_TRACES=0, so no span is ever exported
#   2. the collector config defines NO traces exporter
#   3. it defines NO traces pipeline
#   4. the `otlp` receiver (the only span ingress) is in no pipeline, the
#      container publishes no 4317/4318 port, and the workload is given no
#      OTEL_EXPORTER_OTLP_ENDPOINT, so a span has no address to go to
#
# The `mycs` lane reverses exactly those four and changes nothing else.
#
# TRAP: `file/raw_events` OPENS its path but never CREATES it. A missing /rawout
# kills the collector within seconds and `docker ps` shows nothing -- always
# check `docker ps -a` and `docker logs`. This script pre-creates the directory.
#
# TRAP: MySQL splits ONE InnoDB deadlock across MANY error-log entries --
# MY-012468 is only the banner, and each `*** (N) TRANSACTION:` block is its own
# MY-012469 entry. filelog/mysql routes BOTH codes and the product stitches them
# downstream; `verify` below counts them separately so a half-captured deadlock
# is visible rather than looking like a whole one.
#
# Usage: ./my-rig.sh up|down|status|logs|verify [my|mycs]
set -uo pipefail

HOSTBASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Docker Desktop on macOS bind-mounts host paths under /host_mnt.
BASE="/host_mnt${HOSTBASE}"
IMAGE="otel/opentelemetry-collector-contrib:0.158.0"
# LANE SELECTION. `my` (default) is server-vantage only; `mycs` adds the
# workload's client spans. Both scrape the SAME MySQL with the SAME recipes and
# BOTH receive the full server-vantage feed -- the ONLY difference is whether
# traces have a route. Usage: ./my-rig.sh up [my|mycs]
LANE="${2:-my}"
case "$LANE" in
  my)
    ORG="mysql_server"; ORGNAME="mysql_server"
    CFG="config.my.yaml"; TRACES=0 ;;
  mycs)
    ORG="mysql_client_server"; ORGNAME="mysql_client_server"
    CFG="config.mycs.yaml"; TRACES=1 ;;
  *) echo "unknown lane '$LANE' (expected my|mycs)"; exit 1 ;;
esac

# SPAN INGRESS, only on the traces lane.
#   COL_ALIAS  gives the collector a stable DNS name on the compose network.
#   WL_OTLP    points the workload's OTel SDK at it. The SDK's default is
#              http://localhost:4318 -- inside the WORKLOAD container, which
#              listens on nothing, so without this every span is silently
#              dropped and a traces lane looks identical to a no-traces one.
# On the my lane both are empty: no alias, no endpoint, no route for a span.
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
# command only names `mysql`. So this must be exported before any compose call,
# or `up --wait mysql` fails on an unrelated service's variable.
export O2_AUTH="$AUTH"
NET="dbm-sv_default"
COL="dbm-sv-col-$LANE"
WL="dbm-sv-wl-$LANE"
# NOTE: no `-f docker-compose.pg.yml` here. That override exists solely to turn
# on Postgres log rotation and would drag the postgres service's command into
# this invocation for no reason. MySQL needs no equivalent: the base compose
# already caps nothing, but MySQL's error log holds only deadlock/startup
# records (the *statement* firehose goes to slow.log, which nothing tails), so
# it does not grow the way postgresql.log did.
COMPOSE="docker compose -f docker-compose.yml"

case "${1:-up}" in
  up)
    cd "$HOSTBASE" || exit 1

    python3 "$HOSTBASE/gen-my-config.py" || { echo "config generation FAILED"; exit 1; }

    # MySQL ONLY. --wait blocks until its healthcheck passes, which is what keeps
    # the workload from racing it. The pg lanes' postgres container is left
    # alone: naming the service explicitly means compose starts nothing else.
    echo "== starting mysql =="
    $COMPOSE up -d --wait mysql || { echo "mysql FAILED to come up"; exit 1; }

    mkdir -p "$HOSTBASE/captures/raw_$LANE"
    : > "$HOSTBASE/captures/raw_$LANE/receiver-events.jsonl"

    timeout 30 docker rm -f "$COL" "$WL" >/dev/null 2>&1

    echo "== starting collector =="
    # No -p 4317/4318: this collector accepts no OTLP ingress from the host.
    timeout 60 docker run -d --name "$COL" \
      --network "$NET" \
      $COL_ALIAS \
      --user 0:0 -m 2048m \
      --restart unless-stopped \
      --add-host host.docker.internal:host-gateway \
      `# MYSQLHOST is the rig's INSTANCE IDENTITY, not just a connection target:` \
      `# the sqlquery recipes stamp it into every row as server_address and` \
      `# resource/ident upserts it as server.address/host.name, so it is the` \
      `# value the UI's "database" (instance) filter offers. my-prod-1 is a` \
      `# compose network ALIAS for the same container -- a production-shaped` \
      `# host name rather than the placeholder-looking service name. The` \
      `# workload below deliberately keeps MYSQL_HOST=mysql: it only connects,` \
      `# and leaving it untouched keeps this change to the telemetry path.` \
      -e MYSQLHOST=my-prod-1 -e MYSQLPORT=3306 -e MYSQLUSER=root -e MYSQLPASS=dbm -e MYSQLDB=dbmlab \
      `# "A receiver a pipeline does not name is inert" is only HALF true, and` \
      `# this lane is where the other half bites. OTel resolves ${env:...} across` \
      `# the WHOLE file and unmarshals + Validate()s EVERY defined receiver; it` \
      `# merely does not START the unnamed ones. postgresqlreceiver's Validate()` \
      `# rejects an empty username/password, so the inert postgresql definition` \
      `# inherited from the shared config KILLS this collector at startup with` \
      `#   Error: invalid configuration: receivers::postgresql: invalid config:` \
      `#   missing username; invalid config: missing password` \
      `# The pg lane never hit this only because mysqlreceiver's Validate() is` \
      `# LENIENT about the same emptiness -- an asymmetry between the two` \
      `# receivers, not a difference between the lanes. These PG* values are` \
      `# therefore PLACEHOLDERS to satisfy a validator, NOT a connection: the` \
      `# postgresql receiver is in no pipeline here, so it is never instantiated` \
      `# and never dials. Deliberately NOT the real pg credentials -- if a` \
      `# future edit ever did put it in a pipeline, it must fail loudly rather` \
      `# than quietly start scraping the pg lanes' database into a mysql org.` \
      -e PGHOST=unused.invalid -e PGPORT=5432 -e PGUSER=unused -e PGPASS=unused -e PGDATABASE=unused \
      -e "O2_AUTH=$AUTH" \
      -v dbm-sv-colstate-$LANE:/var/lib/otelcol \
      -v "$BASE/captures/raw_$LANE":/rawout \
      -v dbm-sv_mysqllogs:/mysqllogs:ro \
      -v "$BASE/collector/$CFG":/etc/otelcol-contrib/config.yaml:ro \
      "$IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null \
      || { echo "collector docker run FAILED"; exit 1; }

    echo "== starting mysql-only workload (traces $([ "$TRACES" = 1 ] && echo ON || echo OFF)) =="
    $COMPOSE build workload >/dev/null 2>&1 || { echo "workload build FAILED"; exit 1; }
    # WORKLOAD_ENGINES=mysql keeps the pg/maria/mssql/redis threads unspawned --
    # their connect() runs once outside the retry loop, so against a container
    # this lane does not start they would die permanently and silently.
    timeout 60 docker run -d --name "$WL" \
      --network "$NET" \
      --restart unless-stopped \
      -e WORKLOAD_ENGINES=mysql \
      -e WORKLOAD_TRACES=$TRACES \
      $WL_OTLP \
      -e MYSQL_HOST=mysql -e MYSQL_PORT=3306 -e MYSQL_USER=root -e MYSQL_PASSWORD=dbm -e MYSQL_DB=dbmlab \
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
    echo "NOTE: dbm-sv-mysql left running. Stop it with: docker compose stop mysql"
    ;;

  status)
    timeout 30 docker ps -a --filter "name=$COL" --filter "name=$WL" \
      --filter "name=dbm-sv-mysql" --format '{{.Names}}\t{{.Status}}'
    ;;

  logs)
    timeout 30 docker logs --tail "${3:-60}" "$COL" 2>&1 | cut -c1-240
    ;;

  verify)
    # Proves what THIS lane claims: server data is arriving, traces are present
    # exactly when the lane says they should be, the instance identity is single-
    # valued, and the deadlock split is visible. Window: last 15 min.
    echo "== lane $LANE -> $ORG ($ORGNAME), traces expected: $([ "$TRACES" = 1 ] && echo YES || echo NO) =="
    echo -n "   traces streams in org: "
    curl -s -m 20 -u "$O2_USER:$O2_PASS" "$O2_URL/api/$ORG/streams?type=traces" \
      | python3 -c 'import sys,json;print(len(json.load(sys.stdin).get("list",[])))'

    FROM=$(( ($(date +%s)-900)*1000000 )); TO=$(( ($(date +%s)+60)*1000000 ))
    q() {
      curl -s -m 60 -u "$O2_USER:$O2_PASS" -H 'Content-Type: application/json' \
        "$O2_URL/api/$ORG/_search?type=logs" \
        -d "{\"query\":{\"sql\":\"$1\",\"start_time\":$FROM,\"end_time\":$TO,\"size\":100}}" \
        | python3 -c 'import sys,json;d=json.load(sys.stdin);h=d.get("hits",[]);[print("  ",json.dumps(x)) for x in h] or print("  no hits", d.get("error",""))'
    }
    echo "== streams in $ORG =="
    curl -s -u "$O2_USER:$O2_PASS" "$O2_URL/api/$ORG/streams" \
      | python3 -c 'import sys,json;d=json.load(sys.stdin);[print("   %-8s %s" % (s["stream_type"], s["name"])) for s in d.get("list",[])] or print("  none")'
    echo "== o2_dbm_kind distribution =="
    q "SELECT o2_dbm_kind, count(*) AS n FROM dbm_server GROUP BY o2_dbm_kind ORDER BY n DESC"
    echo "== o2_dbm_instance (MUST be non-null and SINGLE-valued) =="
    q "SELECT o2_dbm_instance, count(*) AS n FROM dbm_server GROUP BY o2_dbm_instance ORDER BY n DESC"
    echo "== o2_dbm_engine (MUST be mysql only -- no leakage from the pg lanes) =="
    q "SELECT o2_dbm_engine, count(*) AS n FROM dbm_server GROUP BY o2_dbm_engine ORDER BY n DESC"
    echo "== deadlock entries by MySQL error code (012468 banner vs 012469 blocks) =="
    q "SELECT my_code, count(*) AS n FROM dbm_server WHERE o2_my_event = 'deadlock' GROUP BY my_code ORDER BY n DESC"
    ;;
esac
