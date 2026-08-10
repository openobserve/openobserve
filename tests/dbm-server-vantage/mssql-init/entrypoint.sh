#!/bin/bash
# SQL Server has no /docker-entrypoint-initdb.d — unlike the Postgres and MySQL
# images, it runs no init scripts of its own. So we start sqlservr in the
# background, poll until it accepts connections, apply the schema once, and then
# hand the foreground back to sqlservr so the container's lifetime is still the
# database's lifetime.
set -euo pipefail

SA_PASS="${MSSQL_SA_PASSWORD:?MSSQL_SA_PASSWORD must be set}"
INIT_MARKER=/var/opt/mssql/.dbm-initialized

# sqlcmd moved between image versions; take whichever exists.
SQLCMD=$(command -v sqlcmd || echo /opt/mssql-tools18/bin/sqlcmd)
[ -x "$SQLCMD" ] || SQLCMD=/opt/mssql-tools/bin/sqlcmd

/opt/mssql/bin/sqlservr &
SQLSERVR_PID=$!

ready=0
for _ in $(seq 1 90); do
  # -C trusts the self-signed cert (mssql-tools18 verifies by default).
  if "$SQLCMD" -S localhost -U sa -P "$SA_PASS" -C -Q "SELECT 1" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 2
done

if [ "$ready" -ne 1 ]; then
  echo "[dbm-init] SQL Server did not become ready in time" >&2
  # Do not kill the server — let the healthcheck report the real state.
  wait "$SQLSERVR_PID"
  exit 1
fi

if [ ! -f "$INIT_MARKER" ]; then
  echo "[dbm-init] applying schema"
  # -b so a failing batch fails the script instead of silently continuing and
  # leaving a half-built fixture that produces confusing capture results.
  if "$SQLCMD" -S localhost -U sa -P "$SA_PASS" -C -b -i /init/01-schema.sql; then
    touch "$INIT_MARKER"
    echo "[dbm-init] schema applied"
  else
    echo "[dbm-init] SCHEMA FAILED — the rig will run against an empty database" >&2
  fi
else
  echo "[dbm-init] schema already applied, skipping"
fi

wait "$SQLSERVR_PID"
