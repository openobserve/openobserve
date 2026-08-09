# Capture log (temp evidence — NOT the MANIFEST; MANIFEST.md lands with Task 4 scrub)

## 2026-08-07 — Task 1 rig bring-up + Task 2 python-pg (all three env-var modes)

Rig: docker compose (postgres:16, redis:7 up; mysql:8.4 / mongo:7 defined, not yet exercised).
Collector: `otel/opentelemetry-collector-contrib:0.135.0`, health_check OK on :13133
("Server available"), file exporter → `out/${CELL}.jsonl`, batch 200ms, rotation/compression off.
Host DB ports deliberately NOT published (dev machine already binds 5432).

### python-pg pins (from `pip freeze` inside the image; locked into requirements.txt)

| package | version |
|---|---|
| psycopg2-binary | 2.9.12 |
| opentelemetry-api / sdk / exporter-otlp-proto-http | 1.44.0 |
| opentelemetry-instrumentation(-psycopg2/-dbapi) / semantic-conventions | 0.65b0 |
| base image | python:3.12-slim |
| engine | postgres:16 |

### Results (all three modes VERIFY PASS, first attempt — no version bumps needed)

| cell | file | spans (total / db) | query-text vocabulary observed | other db attrs |
|---|---|---|---|---|
| python-pg-legacy | out/python-pg-legacy.jsonl | 32 / 20 | `db.statement` only | db.system, db.name, db.user, net.peer.name/port |
| python-pg-dup | out/python-pg-dup.jsonl | 32 / 20 | `db.statement` AND `db.query.text` on the SAME 20 spans | both vocabularies: db.system+db.system.name, db.name+db.namespace, db.user |
| python-pg-new | out/python-pg-new.jsonl | 32 / 20 | `db.query.text` only (no db.statement) | db.system.name, db.namespace; **db.user dropped** (no new-mode emission); still old-style net.peer.name/port |

All three files also verified: resource attrs `service.name=dbm-python-pg`,
`deployment.environment.name=capture-env-a`; wrapper spans for every step S00–S11 with
`test.step_id`; exactly one ERROR-status span (S11 bad-column, pgcode 42703); span count
identical across modes (32 = 12 step wrappers + 20 psycopg2 client spans; S12 deadlock
correctly absent — Java/.NET-only per spec).

Observations worth carrying into the corpus:
- New mode keeps OLD network attrs (`net.peer.name`/`net.peer.port` — the database opt-in
  does not migrate net→server.* in dbapi 0.65b0).
- `db.user` has no new-semconv emission in dbapi → absent in new-only capture.
- psycopg2 emits no separate spans for BEGIN/COMMIT/SAVEPOINT via `conn.commit()`;
  `SAVEPOINT sp1` / `ROLLBACK TO SAVEPOINT sp1` executed via `cursor.execute` DO appear
  as their own spans.
- Error span name is `SELECT` with status ERROR + exception event; **no
  `db.response.status_code`** (as the spec predicted for Python).

### Re-run commands

```sh
cd tests/dbm-capture
make up                        # postgres + redis (make up DBS="..." for more)
make capture CELL=python-pg-legacy
make capture CELL=python-pg-dup
make capture CELL=python-pg-new
make down
```

Verification used a throwaway script (scratchpad) parsing each JSONL:
iterate `resourceSpans[].scopeSpans[].spans[]`, count spans, assert per-mode
must/must-not attr sets, dup-mode both-on-same-span, resource attrs, step ids, ERROR span.

## 2026-08-07 — Task 3: remaining cells (python-mongo, node ×4×2 eras, java, dotnet, go-pg)

Rig unchanged (collector contrib 0.135.0; postgres:16, mysql:8.4, redis:7, mongo:7).
mongo now runs as a single-node replica set `rs0` (compose `--replSet rs0`) — required
for the S09 session transaction; rs.initiate is done by each mongo app cell BEFORE its
instrumentation/provider is wired, so bootstrap emits no recorded spans.

Span-count convention below: total / driver (driver = non-`dbm-capture-workload` scope).
All files verified with the shared checker: resource attrs (`service.name=dbm-<cell>`,
`deployment.environment.name=capture-env-a`), full step-id set (S00–S11; +S12 where noted),
per-mode must/must-not attr vocabulary, dup=both-vocab-on-same-span, exactly the expected
ERROR span(s).

### python-mongo (pymongo 4.15.5, otel 1.44.0 / 0.65b0, python:3.12-slim, mongo:7 rs0)

Two variants × three env-var modes (env var honored, as spec predicted):
`python-mongo-*` = default `capture_statement=False` (the operation-collection degraded
cell); `python-mongo-stmt-*` = `PymongoInstrumentor().instrument(capture_statement=True)`.

| cell | file | spans | query-text attrs | notes |
|---|---|---|---|---|
| python-mongo-legacy | out/python-mongo-legacy.jsonl | 28/16 | `db.statement` = **command name only** ("find", "insert") | db.system, db.name, db.mongodb.collection, net.peer.* |
| python-mongo-dup | out/python-mongo-dup.jsonl | 28/16 | both keys, both command-name-only | + db.system.name, db.namespace, db.collection.name, server.* , error.type |
| python-mongo-new | out/python-mongo-new.jsonl | 28/16 | `db.query.text` command-name-only | old keys fully gone |
| python-mongo-stmt-{legacy,dup,new} | out/python-mongo-stmt-*.jsonl | 28/16 each | same keys per mode, value = full command doc (`find {'_id': 3}` …), **UNMASKED literals** | vocabulary identical to non-stmt variant |

Observations:
- Degraded cell nuance: `capture_statement=False` does NOT drop the query-text attr — it
  still emits `db.statement`/`db.query.text` whose VALUE is the bare command name.
- `capture_statement=True` values carry raw literals (python dict repr, single quotes) —
  scrub/curation must treat these as sensitive.
- S11 error span (`dbm.find`): status ERROR, **no exception event** (unlike psycopg2),
  `error.type=BadValue` in dup/new only, no `db.response.status_code` (as spec predicted).
- 16 driver spans = drop, 4×insert (incl. seed), 6×find, 2×update, commitTransaction,
  ping, endSessions (endSessions arrives at client.close()).

### node cells (node:22-slim; drivers pg 8.22.0, mysql2 3.23.2, redis 5.12.1, mongodb 6.21.0)

Era is a PACKAGE-PIN mechanism (two package.json variants, `ERA` build arg):
- **cur** = 2026-07-23 contrib wave: instrumentation-pg 0.73.0 / -mysql2 0.67.0 /
  -redis 0.69.0 / -mongodb 0.74.0 — tarballs contain **zero** semconv-stability code
  (grep evidence): hard cutover, new-only.
- **era** = 2026-06-11 wave: instrumentation-pg 0.71.0 / -mysql2 0.65.0 / -redis 0.67.0 /
  -mongodb 0.72.0 — env var honored (last wave before the cutover; 0.72.0/0.66.0/0.68.0/0.73.0
  on 2026-07-03 dropped it).
Core: api 1.9.1, sdk-trace-node/resources 2.10.0, exporter-trace-otlp-http +
instrumentation 0.221.0 (both eras).

**cur runs were executed with the mode env var UNSET (cells named `*-cur-legacy`) and
still emitted new-semconv only — that IS the hard-cutover proof.**

| cell | file | spans | query-text attrs | other db attrs |
|---|---|---|---|---|
| node-pg-cur-legacy | out/node-pg-cur-legacy.jsonl | 43/31 | `db.query.text` only | db.system.name, db.namespace, server.* ; **no db.user** |
| node-mysql-cur-legacy | out/node-mysql-cur-legacy.jsonl | 43/31 | `db.query.text` only | db.system.name, db.namespace, server.* |
| node-redis-cur-legacy | out/node-redis-cur-legacy.jsonl | 48/36 | `db.query.text` only (`SET item:1 [1 other arguments]` serializer shape) | db.system.name, **db.operation.name**, server.* |
| node-mongo-cur-legacy | out/node-mongo-cur-legacy.jsonl | 28/16 | `db.query.text` = masked command doc (`{"find":"?","filter":{"_id":"?"}}`) | db.system.name, db.namespace, db.operation.name, db.collection.name, server.* |
| node-pg-era-legacy | out/node-pg-era-legacy.jsonl | 43/31 | `db.statement` only | db.system, db.name, **db.user**, net.peer.*, db.connection_string |
| node-pg-era-dup | out/node-pg-era-dup.jsonl | 43/31 | both on same span | both vocabularies + server.* |
| node-mysql-era-legacy | out/node-mysql-era-legacy.jsonl | 43/31 | `db.statement` only | db.system, db.name, db.user, net.peer.*, db.connection_string |
| node-mysql-era-dup | out/node-mysql-era-dup.jsonl | 43/31 | both | adds db.system.name/db.namespace but **NO server.address/port** (mysql2 0.65.0 dup gap) |
| node-redis-era-legacy | out/node-redis-era-legacy.jsonl | 48/36 | `db.statement` only | db.system, net.peer.*, db.connection_string; no db.name |
| node-redis-era-dup | out/node-redis-era-dup.jsonl | 48/36 | both | + db.system.name, db.operation.name, server.* |
| node-mongo-era-legacy | out/node-mongo-era-legacy.jsonl | 28/16 | `db.statement` masked doc | db.system, db.name, db.operation, db.mongodb.collection, net.peer.*, db.connection_string |
| node-mongo-era-dup | out/node-mongo-era-dup.jsonl | 28/16 | both | full double vocabulary incl. db.operation+db.operation.name, db.mongodb.collection+db.collection.name |

Deviations / findings (evidence over the table):
- **instrumentation-mongodb (0.72.0 AND 0.74.0) emits ZERO spans with default config on
  driver ≥6.4** (verified with drivers 6.21.0 and 7.5.0): patch applies
  (`patchedV4ServerCommand`) but the driver executes commands from its own wait-queue
  async context, so the caller's ALS context is lost inside `Connection.command`;
  `requireParentSpan` (default true) then skips every span. Rig sets
  `requireParentSpan: false` → spans appear but as **ROOT spans** (no parent link to the
  step wrapper; step attribution for extraction = timestamp containment).
- node driver has no executemany/addBatch → S08 = 10 sequential parameterized INSERTs.
- node-redis S09 `MULTI…EXEC` yields only the 2 INCR spans (no MULTI/EXEC spans);
  S07/S08 use auto-pipelining (Promise.all), spans per command.
- Error spans: pg = exception event, no error.type, no status code; mysql2 = no exception
  event; redis MEMORY DOCTOR-BOGUS = exception event; mongo = no exception event.
  **No `db.response.status_code` anywhere in node** (as spec predicted).

### java (single app: PG + MySQL + Redis + S12; javaagent v2.30.0)

Pins: opentelemetry-javaagent **v2.30.0** (latest release 2026-07-22), postgresql JDBC
42.7.7, mysql-connector-j 9.3.0, jedis 6.0.0, temurin 21. Env var honored
(`OTEL_SEMCONV_STABILITY_OPT_IN=database/dup` as plain env var works).
Files: out/java-{legacy,dup,new}.jsonl — 157/120 spans each; step ids S00–S12
(37 wrappers = 12 PG + S12 + 12 MySQL + 12 Redis). S12 deadlock fired in all three runs
(app log: `victim SQLSTATE: 40P01`; exactly one errored UPDATE span + errored S11 spans).

| mode | query-text attrs | notes |
|---|---|---|
| legacy | `db.statement` (119) | db.system/db.name/db.user/db.operation/db.sql.table, server.*, db.connection_string |
| dup | `db.statement` AND `db.query.text` on agent spans | + db.system.name/db.namespace/db.operation.name/db.query.summary, db.operation.batch.size (S08), error.type |
| new | agent spans `db.query.text` only | old keys persist ONLY on MySQL Connector/J native spans (below) |

**Findings that contradict the spec table (record: evidence beats table):**
- **`db.response.status_code` is NOT emitted by javaagent 2.30.0 in ANY mode** — including
  `database` opt-in. The S12 deadlock victim span (`UPDATE deadlock_t`) errors with
  exception event `org.postgresql.util.PSQLException: ERROR: deadlock detected` but its
  only code-ish attr is `error.type='0'` (JDBC getErrorCode vendor code — PG always 0).
  MySQL S11 gets `error.type='1054'` (errno). SQLSTATE 40P01/42703 appears NOWHERE as an
  attribute on Java — the flagship 40P01-fixture route is .NET-only in practice.
- **mysql-connector-j 9.3.0 ships NATIVE OTel spans** (scope `MySQL Connector/J`, 54 spans:
  nested `Execute statement`/connection spans under the agent's jdbc spans) which use OLD
  semconv **in all three modes** (db.statement value masked by the driver: `SELECT (...)`),
  ignore the opt-in env var, and carry no server.address. Real-world double-instrumentation
  shape worth keeping in the corpus.
- PG `db.namespace` in dup/new = `dbm|dbm` (database|schema composite with `|` separator).
- Jedis spans (`io.opentelemetry.jedis-4.0`, 22): legacy `db.statement`; new
  `db.query.text` + `db.operation.name`; pipeline S07/S08 = one span per command.

### dotnet (net8.0; OpenTelemetry SDK 1.17.0, OTLP exporter 1.17.0 via gRPC :4317)

dotnet-pg semconv is PACKAGE-cut (Npgsql native ActivitySource; `AddSource("Npgsql")`).
Both PG cells ran S12; app log `victim SQLSTATE: 40P01` in every run.

| cell | file | spans | query-text attrs | status_code |
|---|---|---|---|---|
| dotnet-pg9-legacy (Npgsql 9.0.5, env unset) | out/dotnet-pg9-legacy.jsonl | 35/22 | `db.statement` only | **none** |
| dotnet-pg9-new (Npgsql 9.0.5, env=database) | out/dotnet-pg9-new.jsonl | 35/22 | `db.statement` only — **identical vocab to pg9-legacy: env var ignored, proof** | **none** |
| dotnet-pg10-legacy (Npgsql 10.0.3, env UNSET) | out/dotnet-pg10-legacy.jsonl | 37/24 | `db.query.text` only — new-only despite unset env: package-cut proof | **`db.response.status_code='42703'` (S11) and `='40P01'` (S12 victim)** + error.type same values |
| dotnet-mysql-legacy (MySqlConnector 2.6.1) | out/dotnet-mysql-legacy.jsonl | 32/20 | `db.statement` | `db.response.status_code='1054'` on S11 (**even in legacy mode**), error.type=exception type name |
| dotnet-mysql-dup | out/dotnet-mysql-dup.jsonl | 32/20 | both on same span | status_code '1054'; error.type='1054'; + network.peer.*, db.operation.batch.size (S08 DbBatch) |
| dotnet-mysql-new | out/dotnet-mysql-new.jsonl | 32/20 | `db.query.text` only | status_code '1054'; **no exception event on the error span** |

Notes:
- Npgsql 9 span names = database name (`dbm`); Npgsql 10 = `postgresql`, plus 2 `CONNECT dbm`
  spans (they carry no query text → db.query.text 22 of 24) and db.npgsql.* attrs.
- The **only real capture of `db.response.status_code=40P01` in the whole matrix is
  dotnet-pg10** (spec expected Java too — it doesn't, see java section).
- MySqlConnector honors the env var (legacy/dup/new distinct), and emits status_code in
  every mode.
- .NET S08 uses the real batch API (`DbBatch`); MySqlConnector marks db.operation.batch.size.

### go-pg (XSAM/otelsql v0.43.0, pgx v5.10.0, otel-go v1.45.0, golang:1.25)

Cell sets `otelsql.SpanOptions{DisableQuery: true}` per spec — the FR-2 **unknown bucket**.
Files: out/go-pg-{legacy,dup,new}.jsonl — 75/63 spans each.

Verified exactly as predicted: driver spans carry **NO db.statement, NO db.query.text and
NO db.operation.name**; the only db attr is the app-supplied static `db.system=postgresql`
(from `WithAttributes(semconv.DBSystemPostgreSQL)`, semconv 1.26 old key). Span names are
method-level (`sql.conn.query`, `sql.conn.exec`, `sql.conn.reset_session`, `sql.rows`,
`sql.conn.begin_tx`, `sql.tx.commit`, `sql.connector.connect`). S11 error span
(`sql.conn.query`) = status ERROR + exception event, no code attrs.
**All three mode files are attribute-identical** — with query capture disabled there is
nothing left for the opt-in to rename, so the env var is a no-op in this cell (the three
files are kept as evidence of that).
Note: otelsql v0.43.0 requires go ≥1.25 (golang:1.24 build fails).

### Deviations from plan/spec (rollup)

1. Java emits NO `db.response.status_code` (agent v2.30.0, any mode) — spec §1 said Java
   is a status-code SDK. Authored substitutes needed for the java status-code corpus row.
2. node instrumentation-mongodb needs `requireParentSpan:false` on driver ≥6.4 or it emits
   nothing; resulting spans are roots (step attribution by timestamp containment).
3. node-mongo cur pin uses driver 6.21.0 (not 7.5.0): 7.5.0 also emits zero spans and the
   0.74.0 instrumentation range claims `<8` — silent no-op either way; 6.21.0 chosen so
   the requireParentSpan workaround yields spans.
4. S08 "driver batch API" is per-driver reality: executemany (python), addBatch (JDBC),
   DbBatch (.NET) are real batch APIs; node/go drivers have none → 10 sequential INSERTs.
5. mongo compose service now runs as single-node RS (S09 transactions); python-pg cell
   unaffected.
6. dotnet-pg cells parameterize with `@pN` named params; Npgsql 10 rewrites to `$N` on the
   wire but `db.query.text` shows `@pN` (placeholder-style raw material preserved).

### Re-run commands

```sh
cd tests/dbm-capture
make up DBS="postgres mysql redis mongo"
# python-mongo (default = capture_statement=False; -stmt = True)
make capture CELL=python-mongo-legacy    # also: -dup -new
make capture CELL=python-mongo-stmt-legacy
# node: <engine> ∈ pg|mysql|redis|mongo; cur pins ran with env UNSET (-legacy suffix)
make capture CELL=node-pg-cur-legacy
make capture CELL=node-pg-era-legacy     # also: -dup
# java / go-pg: 3 modes each
make capture CELL=java-legacy            # also: -dup -new (S12 included)
make capture CELL=go-pg-legacy
# dotnet: pg9/pg10 are package pins; mysql honors the env var
make capture CELL=dotnet-pg9-legacy      # also: dotnet-pg9-new (ignored-env proof)
make capture CELL=dotnet-pg10-legacy     # new-only + 40P01 despite unset env
make capture CELL=dotnet-mysql-legacy    # also: -dup -new
make down
```

## 2026-08-07 — Task 4 (Step 4) + Task 5: scrub all cells, MANIFEST, verification gate

Scrubbed all 33 raw captures (`out/*.jsonl`) through `scrub/scrub.py` →
`fixtures/<cell>.json` (33 files, 1,649 spans total). Verification:
- every fixture parses and has `t0` + `resourceSpans`; span counts match the raw-capture
  tables above exactly;
- zero raw hex trace/span ids remain (grep + full-walk assertion: all id fields are
  `trace-NNN`/`span-NNN` tokens);
- byte-determinism confirmed: re-scrub of java-dup and node-pg-era-dup is `cmp`-identical
  to the committed fixtures. No scrub failures, no tool changes needed.

Wrote `MANIFEST.md`: 33 rows with the full Global-Constraints column set (pins lifted from
this log; collector 0.135.0; capture date 2026-08-07; workload SHA = branch HEAD
`8303be0b4c` since apps/WORKLOAD.md is not yet git-tracked). Equivalence classes:
python-mongo default (non-stmt) ×3 = operation-collection; go-pg ×3 = unknown-bucket;
remaining 27 = text.

Task-5 gate results:
- Expected-file matrix: 33 expected / 33 present — no missing, no unexpected; forbidden
  files (dotnet-pg-dup, dotnet-pg9-dup, dotnet-pg10-dup, dotnet-pg10-new) confirmed absent;
  node cur cells = only `-cur-legacy`, era cells = legacy+dup, per the evidence.
- Cross-cell S01: one logical SELECT, four placeholder styles —
  java `WHERE id = ?` · dotnet pg9/pg10 `WHERE id = @p1` (NOT `@p0`; 1-based) ·
  python `WHERE id = %s` · node era/cur `WHERE id = $1`. Exact strings recorded in the
  MANIFEST appendix as the equivalence-suite anchors.
- New side finding during extraction: **ALL node fixtures are 100% root spans** (wrappers
  included — no parentSpanId anywhere), so the mongo timestamp-containment note applies to
  every node cell during corpus extraction.

Corpus extraction is the next plan; no rig changes made here.
