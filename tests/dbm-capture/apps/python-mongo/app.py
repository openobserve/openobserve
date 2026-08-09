"""DBM capture cell: python-mongo (pymongo).

Executes the canonical Mongo workload from apps/WORKLOAD.md against mongo
(single-node replica set rs0 — required for the S09 session transaction).
Each step is wrapped in a client span carrying `test.step_id`.

Two variants of this cell (selected via CAPTURE_STATEMENT env, default false):
  - default (capture_statement=False) → command-name-only spans — the
    operation-collection degraded cell (service.name=dbm-python-mongo)
  - CAPTURE_STATEMENT=true → PymongoInstrumentor().instrument(capture_statement=True)
    (service.name=dbm-python-mongo-stmt)
Semconv mode via OTEL_SEMCONV_STABILITY_OPT_IN (unset | database/dup | database).
"""

import os
import sys
import time
from contextlib import contextmanager

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.pymongo import PymongoInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from pymongo import MongoClient
from pymongo.errors import OperationFailure, PyMongoError

CAPTURE = os.environ.get("CAPTURE_STATEMENT", "false").lower() == "true"
SERVICE = "dbm-python-mongo-stmt" if CAPTURE else "dbm-python-mongo"
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://mongo:27017/?directConnection=true")

# --- replica-set init BEFORE instrument(): this bootstrap client is created
# before the command listener is registered, so its commands emit no spans ---
boot = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
try:
    boot.admin.command(
        "replSetInitiate",
        {"_id": "rs0", "members": [{"_id": 0, "host": "mongo:27017"}]},
    )
    print("[python-mongo] replSetInitiate issued", flush=True)
except OperationFailure as e:
    print(f"[python-mongo] replSetInitiate skipped: {e.details.get('codeName')}", flush=True)
for _ in range(60):
    try:
        if boot.admin.command("hello").get("isWritablePrimary"):
            break
    except PyMongoError:
        pass
    time.sleep(1)
else:
    print("[python-mongo] FATAL: no primary after 60s", flush=True)
    sys.exit(1)
boot.close()

# --- telemetry setup (before the instrumented client is created) ---
resource = Resource.create(
    {
        "service.name": SERVICE,
        "deployment.environment.name": os.environ.get("DEPLOY_ENV", "capture-env-a"),
    }
)
provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

PymongoInstrumentor().instrument(capture_statement=CAPTURE)

tracer = trace.get_tracer("dbm-capture-workload")

print(
    f"[python-mongo] service={SERVICE} capture_statement={CAPTURE} "
    f"OTEL_SEMCONV_STABILITY_OPT_IN="
    f"{os.environ.get('OTEL_SEMCONV_STABILITY_OPT_IN', '')!r}",
    flush=True,
)
with open("/app/pins.txt") as f:
    pins = [
        line.strip()
        for line in f
        if line.startswith(("opentelemetry", "pymongo"))
    ]
print("[python-mongo] pins: " + ", ".join(pins), flush=True)


@contextmanager
def step(step_id: str):
    with tracer.start_as_current_span(step_id) as span:
        span.set_attribute("test.step_id", step_id)
        yield
    print(f"[python-mongo] {step_id} done", flush=True)


client = MongoClient(MONGO_URI)
db = client["dbm"]
col = db["dbm_items"]

# S00 — drop + seed (unasserted)
with step("S00"):
    col.drop()
    names = ["alpha", "beta", "gamma", "delta", "epsilon",
             "zeta", "eta", "theta", "iota", "kappa"]
    cats = ["a", "a", "b", "b", "c", "c", "d", "d", "e", "e"]
    col.insert_many(
        [
            {"_id": n, "name": names[n - 1], "price": 10 * n, "category": cats[n - 1]}
            for n in range(1, 11)
        ]
    )

# S01 — find, 1 filter
with step("S01"):
    list(col.find({"_id": 3}))

# S02 — find, 2 filters
with step("S02"):
    list(col.find({"price": {"$gt": 25}, "category": "b"}))

# S03/S04/S05 — $in arity 3/8/20
for sid, arity in (("S03", 3), ("S04", 8), ("S05", 20)):
    with step(sid):
        list(col.find({"_id": {"$in": list(range(1, arity + 1))}}))

# S06 — insert_one
with step("S06"):
    col.insert_one({"_id": 101, "name": "ins-1", "price": 11, "category": "x"})

# S07 — insert_many 5 docs
with step("S07"):
    col.insert_many(
        [{"_id": 110 + i, "name": f"batch-{i}", "price": 10 * i, "category": "y"}
         for i in range(1, 6)]
    )

# S08 — insert_many 10 docs
with step("S08"):
    col.insert_many(
        [{"_id": 120 + i, "name": f"many-{i}", "price": 10 * i, "category": "z"}
         for i in range(1, 11)]
    )

# S09 — session transaction: two update_one calls (no savepoint support)
with step("S09"):
    with client.start_session() as sess:
        with sess.start_transaction():
            col.update_one({"_id": 1}, {"$inc": {"price": 1}}, session=sess)
            col.update_one({"_id": 2}, {"$inc": {"price": 100}}, session=sess)

# S10 — ping
with step("S10"):
    client.admin.command("ping")

# S11 — intentional error: bad operator (span must be ERROR)
with step("S11"):
    try:
        list(col.find({"price": {"$badOperator": 1}}))
    except PyMongoError as e:
        print(f"[python-mongo] S11 expected error: {getattr(e, 'code', None)}", flush=True)
    else:
        print("[python-mongo] S11 UNEXPECTEDLY SUCCEEDED", flush=True)
        sys.exit(1)

# S12 — deadlock: NOT run in this cell (Java×PG / .NET×PG only per spec)

client.close()
provider.shutdown()  # flush BatchSpanProcessor
print("[python-mongo] workload complete", flush=True)
