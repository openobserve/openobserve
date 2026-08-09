"""DBM capture cell: python-pg (psycopg2).

Executes the canonical workload from apps/WORKLOAD.md against postgres.
Each step is wrapped in a client span carrying `test.step_id`.
Semconv mode is controlled by OTEL_SEMCONV_STABILITY_OPT_IN (unset | database/dup | database)
set by the Makefile per CELL.
"""

import os
import sys
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

# --- telemetry setup (before any instrumented connect) ---
resource = Resource.create(
    {
        "service.name": "dbm-python-pg",
        "deployment.environment.name": os.environ.get("DEPLOY_ENV", "capture-env-a"),
    }
)
provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

Psycopg2Instrumentor().instrument()

import psycopg2  # noqa: E402  (import after instrument() by convention)

tracer = trace.get_tracer("dbm-capture-workload")

print(
    f"[python-pg] OTEL_SEMCONV_STABILITY_OPT_IN="
    f"{os.environ.get('OTEL_SEMCONV_STABILITY_OPT_IN', '')!r}",
    flush=True,
)
with open("/app/pins.txt") as f:
    pins = [
        line.strip()
        for line in f
        if line.startswith(("opentelemetry", "psycopg2"))
    ]
print("[python-pg] pins: " + ", ".join(pins), flush=True)


@contextmanager
def step(step_id: str):
    with tracer.start_as_current_span(step_id) as span:
        span.set_attribute("test.step_id", step_id)
        yield
    print(f"[python-pg] {step_id} done", flush=True)


conn = psycopg2.connect(
    host=os.environ.get("PGHOST", "postgres"),
    port=int(os.environ.get("PGPORT", "5432")),
    user=os.environ.get("PGUSER", "dbm"),
    password=os.environ.get("PGPASSWORD", "dbm"),
    dbname=os.environ.get("PGDATABASE", "dbm"),
)
conn.autocommit = True
cur = conn.cursor()

# S00 — schema setup + seed (unasserted)
with step("S00"):
    cur.execute("DROP TABLE IF EXISTS dbm_items")
    cur.execute(
        "CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), "
        "price INT, category VARCHAR(32))"
    )
    cur.execute(
        "INSERT INTO dbm_items (id, name, price, category) VALUES "
        "(1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b'),"
        "(5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d'),"
        "(9,'iota',90,'e'),(10,'kappa',100,'e')"
    )
    cur.execute("DROP TABLE IF EXISTS deadlock_t")
    cur.execute("CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT)")
    cur.execute("INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0)")

# S01 — parameterized SELECT, 1 param
with step("S01"):
    cur.execute("SELECT id, name, price FROM dbm_items WHERE id = %s", (3,))
    cur.fetchall()

# S02 — parameterized SELECT, 2 params
with step("S02"):
    cur.execute(
        "SELECT id, name FROM dbm_items WHERE price > %s AND category = %s",
        (25, "b"),
    )
    cur.fetchall()

# S03/S04/S05 — IN-lists arity 3/8/20
for sid, arity in (("S03", 3), ("S04", 8), ("S05", 20)):
    with step(sid):
        placeholders = ", ".join(["%s"] * arity)
        cur.execute(
            f"SELECT id, name FROM dbm_items WHERE id IN ({placeholders})",
            tuple(range(1, arity + 1)),
        )
        cur.fetchall()

# S06 — single-row INSERT
with step("S06"):
    cur.execute(
        "INSERT INTO dbm_items (id, name, price, category) VALUES (%s, %s, %s, %s)",
        (101, "ins-1", 11, "x"),
    )

# S07 — multi-row VALUES INSERT (5 rows, one statement)
with step("S07"):
    rows = [(110 + i, f"batch-{i}", 10 * i, "y") for i in range(1, 6)]
    flat = [v for row in rows for v in row]
    values_sql = ", ".join(["(%s, %s, %s, %s)"] * 5)
    cur.execute(
        f"INSERT INTO dbm_items (id, name, price, category) VALUES {values_sql}",
        flat,
    )

# S08 — batch INSERT via executemany (10 rows)
with step("S08"):
    rows = [(120 + i, f"many-{i}", 10 * i, "z") for i in range(1, 11)]
    cur.executemany(
        "INSERT INTO dbm_items (id, name, price, category) VALUES (%s, %s, %s, %s)",
        rows,
    )

# S09 — transaction block + savepoint
with step("S09"):
    conn.autocommit = False
    cur.execute("UPDATE dbm_items SET price = price + 1 WHERE id = %s", (1,))
    cur.execute("SAVEPOINT sp1")
    cur.execute("UPDATE dbm_items SET price = price + 100 WHERE id = %s", (2,))
    cur.execute("ROLLBACK TO SAVEPOINT sp1")
    conn.commit()
    conn.autocommit = True

# S10 — ping
with step("S10"):
    cur.execute("SELECT 1")
    cur.fetchall()

# S11 — intentional error: bad column (span must be ERROR)
with step("S11"):
    try:
        cur.execute("SELECT no_such_column FROM dbm_items")
    except psycopg2.Error as e:
        print(f"[python-pg] S11 expected error: {e.pgcode}", flush=True)
    else:
        print("[python-pg] S11 UNEXPECTEDLY SUCCEEDED", flush=True)
        sys.exit(1)

# S12 — deadlock: NOT run in this cell (Java×PG / .NET×PG only per spec)

cur.close()
conn.close()
provider.shutdown()  # flush BatchSpanProcessor
print("[python-pg] workload complete", flush=True)
