#!/usr/bin/env bash
# testRunCommand wrapper for the tests/db-testing pytest suite.
#
# This suite validates metadata-store state directly, so it needs its OWN
# OpenObserve instance running with ZO_META_STORE=postgres — the primary SUT
# (setup.sh) stays on the default sqlite backend for every other suite. Per
# the "suite boots its own app instance" pattern, this script owns spawning
# that secondary instance; setup.sh owns the Postgres substrate it reuses.
# Forwards all appended args ("$@" — reporter flags + test selectors) to
# pytest untouched, and never `cd`s, so repo-root-relative paths resolve.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BIN="target/debug/openobserve"
DB_PORT=5081
PG_PORT=5433
PG_CONTAINER="skyramp-db-testing-postgres"
DSN="postgres://postgres:password@localhost:${PG_PORT}/postgres"
LOG_DIR=".skyramp/sut/logs"
mkdir -p "$LOG_DIR"

if command -v docker >/dev/null 2>&1; then
  if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    docker run -d --name "$PG_CONTAINER" \
      -e POSTGRES_PASSWORD=password -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres \
      -p "${PG_PORT}:5432" postgres:17.5-alpine3.22 >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER")" != "true" ]; then
    docker start "$PG_CONTAINER" >/dev/null
  fi
  for _ in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
else
  echo "[run-db-testing] ERROR: docker not available, cannot start Postgres substrate" >&2
  exit 1
fi

if ! curl -sf "http://localhost:${DB_PORT}/healthz" >/dev/null 2>&1; then
  echo "[run-db-testing] starting secondary OpenObserve (postgres metastore) on :${DB_PORT}"
  ZO_ROOT_USER_EMAIL="root@example.com" \
  ZO_ROOT_USER_PASSWORD='Complexpass#123' \
  ZO_META_STORE=postgres \
  ZO_META_POSTGRES_DSN="$DSN" \
  ZO_TEXT_DATA_TYPE=text \
  ZO_HTTP_PORT="$DB_PORT" \
  ZO_MEM_PERSIST_INTERVAL=1 \
  ZO_MAX_FILE_RETENTION_TIME=1 \
  ZO_FILE_PUSH_INTERVAL=1 \
  nohup "$BIN" > "$LOG_DIR/openobserve-dbtest.log" 2>&1 &
  disown

  ready=false
  for _ in $(seq 1 60); do
    if curl -sf "http://localhost:${DB_PORT}/healthz" >/dev/null 2>&1; then
      ready=true
      break
    fi
    sleep 1
  done
  if [ "$ready" != "true" ]; then
    echo "[run-db-testing] ERROR: secondary OpenObserve did not become ready" >&2
    tail -n 100 "$LOG_DIR/openobserve-dbtest.log" >&2 || true
    exit 1
  fi
fi

export ZO_BASE_URL="http://localhost:${DB_PORT}"
export ZO_ROOT_USER_EMAIL="root@example.com"
export ZO_ROOT_USER_PASSWORD='Complexpass#123'
export ZO_META_POSTGRES_DSN="$DSN"

exec tests/db-testing/.venv/bin/python -m pytest -c tests/db-testing/pyproject.toml "$@"
