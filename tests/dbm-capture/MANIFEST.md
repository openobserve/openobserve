# DBM Capture Fixture MANIFEST

One row per checked-in fixture under `fixtures/` (scrubbed via `scrub/scrub.py`; raw
captures in `out/` are gitignored and never committed). Schema per the capture-rig plan's
Global Constraints: file · SDK/agent + version · driver + version · engine + version ·
collector version · semconv mechanism + exact value/pin · capture date · workload git SHA ·
equivalence_class.

Shared pins for every row: collector = `otel/opentelemetry-collector-contrib:0.135.0`;
capture date = 2026-08-07; workload git SHA = `8303be0b4c` (branch HEAD at scrub time —
`apps/WORKLOAD.md` is not yet tracked by git, so the file-scoped SHA is empty; update this
column when the rig lands in a commit).

Equivalence classes (spec §2): `text` = query-text-emitting cell; `operation-collection` =
Python×Mongo default `capture_statement=False` degraded cell; `unknown-bucket` = Go×PG
`SpanOptions{DisableQuery:true}` cell (no text, no operation).

`env` below = `OTEL_SEMCONV_STABILITY_OPT_IN`.

## Fixture rows

| file (fixtures/) | SDK/agent + version | driver + version | engine + version | collector | semconv mechanism + exact value/pin | capture date | workload SHA | equivalence_class |
|---|---|---|---|---|---|---|---|---|
| python-pg-legacy.json | otel-python 1.44.0 / instr 0.65b0 (psycopg2+dbapi), python:3.12-slim | psycopg2-binary 2.9.12 | postgres:16 | 0.135.0 | env-var; env unset (old-only) | 2026-08-07 | 8303be0b4c | text |
| python-pg-dup.json | otel-python 1.44.0 / instr 0.65b0 | psycopg2-binary 2.9.12 | postgres:16 | 0.135.0 | env-var; `env=database/dup` | 2026-08-07 | 8303be0b4c | text |
| python-pg-new.json | otel-python 1.44.0 / instr 0.65b0 | psycopg2-binary 2.9.12 | postgres:16 | 0.135.0 | env-var; `env=database` (new-only) | 2026-08-07 | 8303be0b4c | text |
| python-mongo-legacy.json | otel-python 1.44.0 / instr 0.65b0 (pymongo) | pymongo 4.15.5 | mongo:7 (rs0) | 0.135.0 | env-var; env unset + `capture_statement=False` (default) | 2026-08-07 | 8303be0b4c | operation-collection |
| python-mongo-dup.json | otel-python 1.44.0 / instr 0.65b0 | pymongo 4.15.5 | mongo:7 (rs0) | 0.135.0 | env-var; `env=database/dup` + `capture_statement=False` | 2026-08-07 | 8303be0b4c | operation-collection |
| python-mongo-new.json | otel-python 1.44.0 / instr 0.65b0 | pymongo 4.15.5 | mongo:7 (rs0) | 0.135.0 | env-var; `env=database` + `capture_statement=False` | 2026-08-07 | 8303be0b4c | operation-collection |
| python-mongo-stmt-legacy.json | otel-python 1.44.0 / instr 0.65b0 | pymongo 4.15.5 | mongo:7 (rs0) | 0.135.0 | env-var; env unset + `capture_statement=True` (kwarg) | 2026-08-07 | 8303be0b4c | text |
| python-mongo-stmt-dup.json | otel-python 1.44.0 / instr 0.65b0 | pymongo 4.15.5 | mongo:7 (rs0) | 0.135.0 | env-var; `env=database/dup` + `capture_statement=True` | 2026-08-07 | 8303be0b4c | text |
| python-mongo-stmt-new.json | otel-python 1.44.0 / instr 0.65b0 | pymongo 4.15.5 | mongo:7 (rs0) | 0.135.0 | env-var; `env=database` + `capture_statement=True` | 2026-08-07 | 8303be0b4c | text |
| node-pg-cur-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / exporter+instr-core 0.221.0, node:22-slim | pg 8.22.0 | postgres:16 | 0.135.0 | package pin; instrumentation-pg **0.73.0** (2026-07-23 hard-cutover wave, zero stability code) — env UNSET, still new-only (cutover proof) | 2026-08-07 | 8303be0b4c | text |
| node-pg-era-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | pg 8.22.0 | postgres:16 | 0.135.0 | package pin + env-var; instrumentation-pg **0.71.0** (last env-var-era wave), env unset (old-only) | 2026-08-07 | 8303be0b4c | text |
| node-pg-era-dup.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | pg 8.22.0 | postgres:16 | 0.135.0 | package pin + env-var; instrumentation-pg 0.71.0, `env=database/dup` | 2026-08-07 | 8303be0b4c | text |
| node-mysql-cur-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | mysql2 3.23.2 | mysql:8.4 | 0.135.0 | package pin; instrumentation-mysql2 **0.67.0** (cutover wave) — env UNSET, new-only | 2026-08-07 | 8303be0b4c | text |
| node-mysql-era-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | mysql2 3.23.2 | mysql:8.4 | 0.135.0 | package pin + env-var; instrumentation-mysql2 **0.65.0**, env unset (old-only) | 2026-08-07 | 8303be0b4c | text |
| node-mysql-era-dup.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | mysql2 3.23.2 | mysql:8.4 | 0.135.0 | package pin + env-var; instrumentation-mysql2 0.65.0, `env=database/dup` (dup gap: no server.address/port) | 2026-08-07 | 8303be0b4c | text |
| node-redis-cur-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | redis 5.12.1 | redis:7 | 0.135.0 | package pin; instrumentation-redis **0.69.0** (cutover wave) — env UNSET, new-only | 2026-08-07 | 8303be0b4c | text |
| node-redis-era-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | redis 5.12.1 | redis:7 | 0.135.0 | package pin + env-var; instrumentation-redis **0.67.0**, env unset (old-only) | 2026-08-07 | 8303be0b4c | text |
| node-redis-era-dup.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | redis 5.12.1 | redis:7 | 0.135.0 | package pin + env-var; instrumentation-redis 0.67.0, `env=database/dup` | 2026-08-07 | 8303be0b4c | text |
| node-mongo-cur-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | mongodb 6.21.0 | mongo:7 (rs0) | 0.135.0 | package pin; instrumentation-mongodb **0.74.0** (cutover wave) — env UNSET, new-only; `requireParentSpan:false` required (driver ≥6.4 emits nothing otherwise; spans are roots) | 2026-08-07 | 8303be0b4c | text |
| node-mongo-era-legacy.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | mongodb 6.21.0 | mongo:7 (rs0) | 0.135.0 | package pin + env-var; instrumentation-mongodb **0.72.0**, env unset (old-only); `requireParentSpan:false` | 2026-08-07 | 8303be0b4c | text |
| node-mongo-era-dup.json | otel-js api 1.9.1 / sdk 2.10.0 / 0.221.0 | mongodb 6.21.0 | mongo:7 (rs0) | 0.135.0 | package pin + env-var; instrumentation-mongodb 0.72.0, `env=database/dup`; `requireParentSpan:false` | 2026-08-07 | 8303be0b4c | text |
| java-legacy.json | opentelemetry-javaagent **v2.30.0**, temurin 21 | postgresql JDBC 42.7.7 + mysql-connector-j 9.3.0 + jedis 6.0.0 | postgres:16 + mysql:8.4 + redis:7 | 0.135.0 | env-var; env unset (old-only agent spans; Connector/J native spans old-semconv in ALL modes) | 2026-08-07 | 8303be0b4c | text |
| java-dup.json | opentelemetry-javaagent v2.30.0 | JDBC 42.7.7 + connector-j 9.3.0 + jedis 6.0.0 | postgres:16 + mysql:8.4 + redis:7 | 0.135.0 | env-var; `env=database/dup` | 2026-08-07 | 8303be0b4c | text |
| java-new.json | opentelemetry-javaagent v2.30.0 | JDBC 42.7.7 + connector-j 9.3.0 + jedis 6.0.0 | postgres:16 + mysql:8.4 + redis:7 | 0.135.0 | env-var; `env=database` (new-only agent spans; Connector/J native spans stay old) | 2026-08-07 | 8303be0b4c | text |
| dotnet-pg9-legacy.json | OpenTelemetry .NET SDK 1.17.0 + OTLP 1.17.0 (gRPC), net8.0; `AddSource("Npgsql")` | **Npgsql 9.0.5** (native ActivitySource) | postgres:16 | 0.135.0 | package pin; Npgsql 9.x = old-only, env unset. NO dup mode exists for this cell | 2026-08-07 | 8303be0b4c | text |
| dotnet-pg9-new.json | OpenTelemetry .NET SDK 1.17.0, net8.0 | Npgsql 9.0.5 | postgres:16 | 0.135.0 | package pin; Npgsql 9.0.5 + `env=database` → **env IGNORED, output identical to pg9-legacy** (ignored-env proof run) | 2026-08-07 | 8303be0b4c | text |
| dotnet-pg10-legacy.json | OpenTelemetry .NET SDK 1.17.0, net8.0 | **Npgsql 10.0.3** | postgres:16 | 0.135.0 | package pin; Npgsql 10.x = new-only despite env UNSET (package-cut proof). Only cell in the matrix with real `db.response.status_code` = 40P01/42703 | 2026-08-07 | 8303be0b4c | text |
| dotnet-mysql-legacy.json | OpenTelemetry .NET SDK 1.17.0, net8.0; `AddSource("MySqlConnector")` | MySqlConnector 2.6.1 | mysql:8.4 | 0.135.0 | env-var; env unset (old-only; still emits `db.response.status_code='1054'`) | 2026-08-07 | 8303be0b4c | text |
| dotnet-mysql-dup.json | OpenTelemetry .NET SDK 1.17.0, net8.0 | MySqlConnector 2.6.1 | mysql:8.4 | 0.135.0 | env-var; `env=database/dup` | 2026-08-07 | 8303be0b4c | text |
| dotnet-mysql-new.json | OpenTelemetry .NET SDK 1.17.0, net8.0 | MySqlConnector 2.6.1 | mysql:8.4 | 0.135.0 | env-var; `env=database` (new-only) | 2026-08-07 | 8303be0b4c | text |
| go-pg-legacy.json | XSAM/otelsql **v0.43.0** + otel-go v1.45.0, golang:1.25 | pgx v5.10.0 | postgres:16 | 0.135.0 | env-var (no-op here); env unset + `SpanOptions{DisableQuery:true}` — no text, no operation | 2026-08-07 | 8303be0b4c | unknown-bucket |
| go-pg-dup.json | XSAM/otelsql v0.43.0 + otel-go v1.45.0 | pgx v5.10.0 | postgres:16 | 0.135.0 | env-var (no-op); `env=database/dup` + DisableQuery — attribute-identical to legacy (evidence the opt-in has nothing to rename) | 2026-08-07 | 8303be0b4c | unknown-bucket |
| go-pg-new.json | XSAM/otelsql v0.43.0 + otel-go v1.45.0 | pgx v5.10.0 | postgres:16 | 0.135.0 | env-var (no-op); `env=database` + DisableQuery — attribute-identical to legacy | 2026-08-07 | 8303be0b4c | unknown-bucket |

## Capture evidence — span counts per fixture (total / driver)

Driver = spans whose instrumentation scope is not the app's `dbm-capture-workload` wrapper
tracer. Counts verified against the scrubbed fixtures (they match the raw-capture counts in
`CAPTURE_LOG.md` exactly).

| fixture | spans total/driver | | fixture | spans total/driver |
|---|---|---|---|---|
| python-pg-{legacy,dup,new} | 32 / 20 each | | node-redis-cur-legacy | 48 / 36 |
| python-mongo-{legacy,dup,new} | 28 / 16 each | | node-redis-era-{legacy,dup} | 48 / 36 each |
| python-mongo-stmt-{legacy,dup,new} | 28 / 16 each | | node-mongo-cur-legacy | 28 / 16 |
| node-pg-cur-legacy | 43 / 31 | | node-mongo-era-{legacy,dup} | 28 / 16 each |
| node-pg-era-{legacy,dup} | 43 / 31 each | | java-{legacy,dup,new} | 157 / 120 each |
| node-mysql-cur-legacy | 43 / 31 | | dotnet-pg9-{legacy,new} | 35 / 22 each |
| node-mysql-era-{legacy,dup} | 43 / 31 each | | dotnet-pg10-legacy | 37 / 24 |
| dotnet-mysql-{legacy,dup,new} | 32 / 20 each | | go-pg-{legacy,dup,new} | 75 / 63 each |

**Totals: 33 fixtures · 1,649 spans.**

## Expected-file matrix check (Task-5 gate, run 2026-08-07)

Expected set derived from spec §1 as corrected by live evidence (CAPTURE_LOG wins over the
stale table): python-pg ×3 modes · python-mongo ×3 + stmt ×3 · node ×4 engines ×
{cur-legacy (new-only, env unset), era-legacy, era-dup} · java ×3 · dotnet-pg =
{pg9-legacy, pg9-new (ignored-env proof), pg10-legacy} · dotnet-mysql ×3 · go-pg ×3 = **33**.

- Missing: **NONE** · Unexpected: **NONE**
- Forbidden files confirmed absent: `dotnet-pg-dup`, `dotnet-pg9-dup`, `dotnet-pg10-dup`,
  `dotnet-pg10-new` (Npgsql dup-on-one-span cannot exist; pg10 new-only is the env-unset run)
- Node era cells have exactly legacy+dup (no `era-new`: the era pins' new-only mode is
  already covered by the cur pins' hard cutover); node cur cells have only `-cur-legacy`
  (env unset, new-only output = the cutover proof).

## Appendix — S01 cross-SDK anchor strings (equivalence-suite raw material)

The same logical statement (S01: parameterized single-row SELECT per `apps/WORKLOAD.md`),
as captured in each SDK's query-text attribute. These exact strings are the anchor inputs
the cross-SDK fingerprint-equivalence suite must bind to ONE fingerprint (text class):

| fixture | attr key | exact captured value | placeholder style |
|---|---|---|---|
| java-legacy / java-dup (jdbc, PG; MySQL identical) | db.statement (+db.query.text in dup, same value) | `SELECT id, name, price FROM dbm_items WHERE id = ?` | `?` |
| dotnet-pg9-legacy (Npgsql 9) | db.statement | `SELECT id, name, price FROM dbm_items WHERE id = @p1` | `@p1` (named; 1-based — spec's `@p0` guess was off by one) |
| dotnet-pg10-legacy (Npgsql 10) | db.query.text | `SELECT id, name, price FROM dbm_items WHERE id = @p1` | `@p1` (Npgsql rewrites to `$N` on the wire but reports `@pN`) |
| python-pg-legacy (psycopg2) | db.statement | `SELECT id, name, price FROM dbm_items WHERE id = %s` | `%s` |
| node-pg-era-legacy (pg + instr 0.71.0) | db.statement | `SELECT id, name, price FROM dbm_items WHERE id = $1` | `$1` |
| node-pg-cur-legacy (pg + instr 0.73.0) | db.query.text | `SELECT id, name, price FROM dbm_items WHERE id = $1` | `$1` |

Confirmed: four distinct placeholder styles (`?` / `@p1` / `%s` / `$1`) for one logical
statement — the exact canonicalization problem the equivalence suite exists to test.

Side finding recorded during extraction: in ALL node fixtures every span (wrapper spans
included) is a root span — no parentSpanId anywhere (43/43, 48/48, 28/28 roots). The
CAPTURE_LOG mongo note (`requireParentSpan:false` → roots) generalizes: node step
attribution for corpus extraction must use timestamp containment, not parent links.
Java Connector/J native spans additionally carry a driver-masked S01 text
(`SELECT (...)`) in every mode — a real-world masked-statement shape worth a corpus case.

## Scrub verification (Task-4 Step 4, run 2026-08-07)

- `scrub/scrub.py` run over all 33 `out/*.jsonl` → `fixtures/*.json`: 0 failures.
- Every fixture parses; every fixture has `t0` + `resourceSpans`; span counts match raw.
- No raw hex IDs: grep for 16/32-char hex `traceId|spanId|parentSpanId` values = 0 hits;
  full-walk assertion: every id field is a `trace-NNN` / `span-NNN` token (0 violations).
- Byte-determinism: re-scrub of `java-dup` and `node-pg-era-dup` → `cmp` byte-identical.

Regeneration: `make capture CELL=<cell>` per CAPTURE_LOG re-run commands, then
`python3 scrub/scrub.py out/<cell>.jsonl fixtures/<cell>.json`, review the diff, update the
row here (bump pins/date/SHA).
