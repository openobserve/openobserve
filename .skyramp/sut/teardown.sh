#!/usr/bin/env bash
# Tears down everything setup.sh started, so every fix-loop retry (and the
# next Testbot run) begins from a clean slate — no leftover process holding
# :5080/:5081, no dangling Postgres sidecar.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

echo "[teardown] stopping OpenObserve processes"
# Matches both the primary (:5080, sqlite) and the secondary db-testing
# instance (:5081, postgres) spawned by run-db-testing.sh — both run the
# same target/debug/openobserve binary.
pkill -f 'target/debug/openobserve' 2>/dev/null || true

PG_CONTAINER="skyramp-db-testing-postgres"
if command -v docker >/dev/null 2>&1; then
  if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    echo "[teardown] removing Postgres sidecar"
    docker rm -f "$PG_CONTAINER" >/dev/null 2>&1 || true
  fi
fi

echo "[teardown] complete"
