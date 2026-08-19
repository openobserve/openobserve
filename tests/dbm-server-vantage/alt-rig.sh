#!/usr/bin/env bash
# The REMAINING engines: MariaDB and SQL Server, one lane each.
#
#   ./alt-rig.sh up maria   -> org `mariadb_server`   (+ the shared fan-out org)
#   ./alt-rig.sh up mssql   -> org `mssql_server`     (+ the shared fan-out org)
#   ./alt-rig.sh down maria | down mssql | status | logs <lane> | verify <lane>
#
# SERVER VANTAGE ONLY on both. Postgres and MySQL each get a client-vantage twin
# because the client half is the thing under test there; that question is
# already answered by those four orgs. What these two add is ENGINE coverage --
# a second InnoDB implementation, and a non-InnoDB engine whose deadlock graph
# and blocking DMVs share no code path with either.
#
# WHAT THEY CAN FILL, and what they cannot: neither engine has receiver-native
# db.server.* events adopted, so neither fills Activity or Top queries. MariaDB
# fills Blocked queries + Table health + Deadlocks (the last ONLY from the error
# log); SQL Server fills Blocked queries + Deadlocks. An empty Activity tab on
# these lanes is the CORRECT answer, and the suite's "empty must explain itself"
# rule is what checks it says so.
#
# SQL SERVER IS EMULATED on Apple Silicon -- no arm64 image. It starts slowly
# (30s start_period) and costs real CPU, which is why it is its own lane:
# bringing MariaDB up should not mean waiting on it.
#
# TRAP: `file/raw_events` OPENS its path but never CREATES it. A missing /rawout
# kills the collector within seconds and `docker ps` shows nothing -- always
# check `docker ps -a` and `docker logs`. This script pre-creates the directory.
set -uo pipefail

HOSTBASE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Docker Desktop on macOS bind-mounts host paths under /host_mnt.
BASE="/host_mnt${HOSTBASE}"
IMAGE="otel/opentelemetry-collector-contrib:0.158.0"

LANE="${2:-maria}"
case "$LANE" in
  maria)
    SERVICE="mariadb"; CFG="config.maria.yaml"
    ENGINE_ENV=(-e MARIAHOST=maria-prod-1 -e MARIAPORT=3306 -e MARIAUSER=root -e MARIAPASS=dbm -e MARIADB=dbmlab)
    ORG="mariadb_server"; WL_ENGINES="mariadb" ;;
  mssql)
    SERVICE="mssql"; CFG="config.mssql.yaml"
    ENGINE_ENV=(-e MSSQLHOST=mssql-prod-1 -e MSSQLPORT=1433 -e MSSQLUSER=sa -e "MSSQLPASS=dbm_Passw0rd#1" -e MSSQLDB=dbmlab)
    ORG="mssql_server"; WL_ENGINES="mssql" ;;
  *) echo "unknown lane '$LANE' (expected maria|mssql)"; exit 1 ;;
esac

O2_URL="http://localhost:5080"
O2_USER="a@a.com"
O2_PASS='Pass#123'
AUTH="$(printf '%s:%s' "$O2_USER" "$O2_PASS" | base64)"
# Compose interpolates EVERY service in the file -- including the compose
# `collector`, whose O2_AUTH is declared `${O2_AUTH:?...}` -- even when the
# command only names one service. Export before any compose call.
export O2_AUTH="$AUTH"
NET="dbm-sv_default"
COL="dbm-sv-col-$LANE"
WL="dbm-sv-wl-$LANE"
COMPOSE="docker compose -f docker-compose.yml"

# PLACEHOLDERS, not connections. "A receiver a pipeline does not name is inert"
# is only HALF true: OTel resolves ${env:...} across the whole file and
# unmarshals + Validate()s EVERY defined receiver, merely skipping START for the
# unnamed ones. postgresqlreceiver's Validate() rejects an empty
# username/password, so the inert `postgresql:` definition inherited from the
# shared config KILLS this collector at startup. mysqlreceiver is LENIENT about
# the same emptiness -- an asymmetry between receivers, not between lanes.
# Deliberately NOT the real credentials: if a future edit ever did put those
# receivers in a pipeline, it must fail loudly rather than quietly scrape
# another lane's database into this org.
INERT_ENV=(
  -e PGHOST=unused.invalid -e PGPORT=5432 -e PGUSER=unused -e PGPASS=unused -e PGDATABASE=unused
  -e MYSQLHOST=unused.invalid -e MYSQLPORT=3306 -e MYSQLUSER=unused -e MYSQLPASS=unused -e MYSQLDB=unused
)

case "${1:-up}" in
  up)
    cd "$HOSTBASE" || exit 1
    python3 "$HOSTBASE/gen-alt-config.py" || { echo "config generation FAILED"; exit 1; }

    echo "== starting $SERVICE =="
    # Naming the service explicitly means compose starts nothing else -- the pg
    # and mysql lanes' containers are left alone.
    $COMPOSE up -d --wait "$SERVICE" || { echo "$SERVICE FAILED to come up"; exit 1; }

    mkdir -p "$HOSTBASE/captures/raw_$LANE"
    : > "$HOSTBASE/captures/raw_$LANE/receiver-events.jsonl"

    timeout 30 docker rm -f "$COL" "$WL" >/dev/null 2>&1

    echo "== starting collector =="
    timeout 60 docker run -d --name "$COL" \
      --network "$NET" \
      --user 0:0 -m 1536m \
      --restart unless-stopped \
      --add-host host.docker.internal:host-gateway \
      "${ENGINE_ENV[@]}" \
      "${INERT_ENV[@]}" \
      -e "O2_AUTH=$AUTH" \
      -v "dbm-sv-colstate-$LANE:/var/lib/otelcol" \
      -v "$BASE/captures/raw_$LANE":/rawout \
      -v "$BASE/collector/$CFG":/etc/otelcol-contrib/config.yaml:ro \
      -v dbm-sv_mariadblogs:/mariadblogs:ro \
      "$IMAGE" --config=/etc/otelcol-contrib/config.yaml >/dev/null \
      || { echo "collector docker run FAILED"; exit 1; }

    echo "== starting workload (engine=$WL_ENGINES, traces OFF) =="
    $COMPOSE build workload >/dev/null 2>&1 || { echo "workload build FAILED"; exit 1; }
    timeout 60 docker run -d --name "$WL" \
      --network "$NET" \
      --restart unless-stopped \
      -e WORKLOAD_ENGINES="$WL_ENGINES" \
      -e WORKLOAD_TRACES=0 \
      -e MARIA_HOST=mariadb -e MARIA_PORT=3306 -e MARIA_USER=root -e MARIA_PASSWORD=dbm -e MARIA_DB=dbmlab \
      -e MSSQL_HOST=mssql -e MSSQL_PORT=1433 -e MSSQL_USER=sa -e "MSSQL_PASSWORD=dbm_Passw0rd#1" -e MSSQL_DB=dbmlab \
      -e DEPLOY_ENV=dbm-sv -e DEADLOCK_PERIOD_SECS=20 \
      dbm-sv-workload >/dev/null \
      || { echo "workload docker run FAILED"; exit 1; }

    sleep 20
    for c in "$COL" "$WL"; do
      st=$(timeout 30 docker inspect "$c" --format 'status={{.State.Status}} oom={{.State.OOMKilled}} exit={{.State.ExitCode}}' 2>/dev/null)
      echo "$c: $st"
    done
    echo "org: $ORG   (plus the fan-out org in gen-alt-config.py)"
    ;;

  down)
    timeout 60 docker rm -f "$COL" "$WL" >/dev/null 2>&1
    timeout 60 docker volume rm "dbm-sv-colstate-$LANE" >/dev/null 2>&1
    echo "removed $COL, $WL and their state volume (the database container is left running)"
    ;;

  status)
    docker ps -a --filter "name=dbm-sv-col-" --filter "name=dbm-sv-wl-" \
      --format '{{.Names}}\t{{.Status}}'
    ;;

  logs)
    docker logs --tail=80 "$COL"
    ;;

  verify)
    NOW=$(date +%s)
    FROM=$(( (NOW-1800)*1000000 )); TO=$(( NOW*1000000 ))
    echo "== $ORG =="
    curl -s -u "$O2_USER:$O2_PASS" \
      "$O2_URL/api/$ORG/traces/db_monitoring/badges?start_time=$FROM&end_time=$TO" \
      | python3 -c '
import sys, json
d = json.load(sys.stdin)
for k in ["activity","deadlocks","blocking","table_health","server_queries","server_samples"]:
    v = d.get(k) or {}
    print(f"  {k:16s} total={v.get(\"total\")}")'
    ;;

  *) echo "usage: $0 up|down|status|logs|verify [maria|mssql]"; exit 1 ;;
esac
