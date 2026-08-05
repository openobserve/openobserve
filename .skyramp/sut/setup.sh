#!/usr/bin/env bash
# Brings up the OpenObserve SUT (built from PR source in the preceding GHA
# pre-steps) plus everything the repo's own test suites need to run against
# it. Idempotent: safe to re-run on every Testbot fix-loop retry.
set -uo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

BIN="target/debug/openobserve"
LOG_DIR=".skyramp/sut/logs"
mkdir -p "$LOG_DIR"

PRIMARY_PORT=5080
ROOT_EMAIL="root@example.com"
ROOT_PASSWORD='Complexpass#123'

# ---------------------------------------------------------------------------
# 0. Fallback build: normally the GHA pre-steps (frontend build + `cargo
#    build --features mimalloc`) already produced $BIN before this script
#    ever runs. If a fix-loop retry lands in an environment where that
#    didn't happen (e.g. $BIN missing), build it here instead of failing —
#    this keeps setup.sh idempotent per the comment above.
# ---------------------------------------------------------------------------
if [ ! -x "$BIN" ]; then
  echo "[setup] $BIN not found — building OpenObserve from source"
  if ! command -v protoc >/dev/null 2>&1; then
    echo "[setup] protoc not found — installing"
    bash ./.github/protoc.sh
  fi
  if [ ! -f "web/dist/index.html" ]; then
    echo "[setup] building frontend (embedded into the binary via RustEmbed)"
    (cd web && npm ci && NODE_OPTIONS="--max-old-space-size=8192" npm run build-only)
  fi
  cargo build --features mimalloc
fi

# ---------------------------------------------------------------------------
# 1. Primary SUT: single OpenObserve process, sqlite metastore (default),
#    serving both the REST API and the embedded frontend on :5080.
# ---------------------------------------------------------------------------
if ! curl -sf "http://localhost:${PRIMARY_PORT}/healthz" >/dev/null 2>&1; then
  echo "[setup] starting primary OpenObserve on :${PRIMARY_PORT}"
  ZO_ROOT_USER_EMAIL="$ROOT_EMAIL" \
  ZO_ROOT_USER_PASSWORD="$ROOT_PASSWORD" \
  ZO_BASE_URL="http://localhost:${PRIMARY_PORT}" \
  WS_ZO_BASE_URL="ws://localhost:${PRIMARY_PORT}" \
  ORGNAME=default \
  ZO_QUICK_MODE_NUM_FIELDS=100 \
  ZO_QUICK_MODE_STRATEGY=first \
  ZO_ALLOW_USER_DEFINED_SCHEMAS=true \
  ZO_INGEST_ALLOWED_UPTO=48 \
  ZO_FEATURE_QUERY_EXCLUDE_ALL=false \
  ZO_USAGE_BATCH_SIZE=200 \
  ZO_USAGE_PUBLISH_INTERVAL=2 \
  ZO_USAGE_REPORTING_ENABLED=true \
  ZO_MIN_AUTO_REFRESH_INTERVAL=5 \
  ZO_STREAMING_ENABLED=true \
  ZO_COLS_PER_RECORD_LIMIT=80000 \
  ZO_SMTP_ENABLED=true \
  ZO_FORMAT_STREAM_NAME_TO_LOWERCASE=false \
  ZO_CREATE_ORG_THROUGH_INGESTION=true \
  ZO_UTF8_VIEW_ENABLED=false \
  ZO_ENABLE_CROSS_LINKING=true \
  ZO_TIMECHART_ENABLED=true \
  ZO_SSRF_ALLOW_LOOPBACK=true \
  ZO_MODEL_PRICING_ENABLED=true \
  ZO_ALERT_SCHEDULE_INTERVAL=3 \
  nohup "$BIN" > "$LOG_DIR/openobserve.log" 2>&1 &
  disown
else
  echo "[setup] primary OpenObserve already running on :${PRIMARY_PORT}"
fi

echo "[setup] waiting for primary OpenObserve readiness..."
ready=false
for _ in $(seq 1 120); do
  if curl -sf "http://localhost:${PRIMARY_PORT}/healthz" >/dev/null 2>&1 \
     && curl -sf "http://localhost:${PRIMARY_PORT}/web/login" >/dev/null 2>&1; then
    ready=true
    break
  fi
  sleep 1
done
if [ "$ready" != "true" ]; then
  echo "[setup] ERROR: primary OpenObserve did not become ready in time" >&2
  tail -n 100 "$LOG_DIR/openobserve.log" >&2 || true
  exit 1
fi
echo "[setup] primary OpenObserve is ready"

# ---------------------------------------------------------------------------
# 2. Seed data: a fresh sqlite instance starts with zero streams, which
#    starves any list/search/filter/pagination test of anything to assert on.
#    Reuse the SAME fixture the Playwright suite's global-setup already
#    ingests (tests/test-data/logs_data.json, ~3.8k log records) instead of
#    inventing new seed data. Ingestion is additive, so re-running is safe.
# ---------------------------------------------------------------------------
AUTH_B64=$(printf '%s' "${ROOT_EMAIL}:${ROOT_PASSWORD}" | base64 -w0)
if [ -f "tests/test-data/logs_data.json" ]; then
  echo "[setup] seeding tests/test-data/logs_data.json into default/e2e_automate"
  curl -sf -X POST "http://localhost:${PRIMARY_PORT}/api/default/e2e_automate/_json" \
    -H "Authorization: Basic ${AUTH_B64}" \
    -H "Content-Type: application/json" \
    --data-binary @tests/test-data/logs_data.json >/dev/null \
    || echo "[setup] WARNING: seed ingestion failed (non-fatal)" >&2
else
  echo "[setup] WARNING: tests/test-data/logs_data.json not found — skipping seed" >&2
fi

# ---------------------------------------------------------------------------
# 3. tests/ui-testing (Playwright) — reuses the running primary SUT over
#    HTTP (no webServer in its config). Install its own deps + browser here
#    so `testRunCommand` can invoke the runner directly with no setup cost.
# ---------------------------------------------------------------------------
echo "[setup] installing tests/ui-testing dependencies"
npm --prefix tests/ui-testing ci
echo "[setup] installing Playwright chromium browser"
tests/ui-testing/node_modules/.bin/playwright install --with-deps chromium

# ---------------------------------------------------------------------------
# 4. tests/api-testing (pytest) — reuses the running primary SUT over HTTP.
#    Install from the repo's OWN lockfile (requirements.lock), plus
#    pytest-json-report which the maintenance/canary tool requires to emit
#    a machine-readable report (pytest exits on the unrecognised flag
#    without it) — not part of the suite's own lockfile, so added on top.
# ---------------------------------------------------------------------------
echo "[setup] installing tests/api-testing python environment"
python3 -m venv tests/api-testing/.venv
tests/api-testing/.venv/bin/pip install -q --upgrade pip
# requirements.lock's "-e file:." is relative to the CWD pip is invoked from,
# not the lock file's location — must run from tests/api-testing/ (a `cd` is
# fine here; this is setup.sh, not a suite's testRunCommand).
(cd tests/api-testing && .venv/bin/pip install -q -r requirements.lock)
tests/api-testing/.venv/bin/pip install -q "pytest-json-report>=1.5"

# ---------------------------------------------------------------------------
# 5. tests/db-testing (pytest) — validates metadata-store state directly, so
#    it needs its OWN OpenObserve instance running with ZO_META_STORE=postgres
#    (the primary SUT above stays on the default sqlite backend). Bring up
#    the Postgres substrate here; the secondary app instance is spawned
#    on-demand by the suite's own wrapper (run-db-testing.sh) per the
#    "suite boots its own app instance" pattern, reusing this Postgres and
#    the already-built binary rather than standing up a duplicate build.
# ---------------------------------------------------------------------------
echo "[setup] installing tests/db-testing python environment"
python3 -m venv tests/db-testing/.venv
tests/db-testing/.venv/bin/pip install -q --upgrade pip
tests/db-testing/.venv/bin/pip install -q "pytest>=7.4.0" "requests>=2.31.0" \
  "psycopg2-binary>=2.9.9" "python-dotenv>=1.0.0" "pytest-json-report>=1.5"

PG_CONTAINER="skyramp-db-testing-postgres"
PG_PORT=5433
if command -v docker >/dev/null 2>&1; then
  if ! docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    echo "[setup] starting Postgres sidecar for tests/db-testing on :${PG_PORT}"
    docker run -d --name "$PG_CONTAINER" \
      -e POSTGRES_PASSWORD=password -e POSTGRES_USER=postgres -e POSTGRES_DB=postgres \
      -p "${PG_PORT}:5432" postgres:17.5-alpine3.22 >/dev/null
  elif [ "$(docker inspect -f '{{.State.Running}}' "$PG_CONTAINER")" != "true" ]; then
    echo "[setup] restarting existing Postgres sidecar"
    docker start "$PG_CONTAINER" >/dev/null
  else
    echo "[setup] Postgres sidecar already running"
  fi
  for _ in $(seq 1 30); do
    docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1 && break
    sleep 1
  done
else
  echo "[setup] WARNING: docker not available — tests/db-testing suite will be unrunnable" >&2
fi

echo "[setup] SUT setup complete"
