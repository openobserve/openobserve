# DBM server-vantage proof rig

Proves that **stock OpenTelemetry collector-contrib receivers can capture the
server-side database telemetry Datadog DBM captures** — deadlocks, blocking
chains, wait events, query stats, execution plans, active sessions, schema stats
— and that it lands in a real OpenObserve alongside the client-side spans, so
both vantages can be joined.

Findings + evidence: [`docs/___databsepages/dbm-server-vantage-proof.md`](../../docs/___databsepages/dbm-server-vantage-proof.md).

This rig is deliberately separate from `tests/dbm-capture` (which is a *client*-side
fixture factory). Distinct compose project (`dbm-sv`), container names and ports,
so it never collides with `dbm-capture` or the dev machine's own stack.

| Component | Container | Host port |
|---|---|---|
| Postgres 16 | `dbm-sv-postgres` | `55432` |
| MySQL 8.4 | `dbm-sv-mysql` | `33306` |
| MariaDB 11 | `dbm-sv-mariadb` | `33307` |
| SQL Server 2022 | `dbm-sv-mssql` | `14330` |
| Redis 7 | `dbm-sv-redis` | `63790` |
| collector-contrib 0.135.0 | `dbm-sv-collector` | `14318`/`14317` OTLP, `13134` health |
| workload generator | `dbm-sv-workload` | — |

## Run

1. **Start OpenObserve.** Launch it with `env -i` and a cwd **outside the repo** —
   the repo's `.env` otherwise hijacks the meta store to your shared Postgres/NATS.

   ```bash
   cargo build                       # debug, per project rules
   mkdir -p /tmp/o2sv/data /tmp/o2sv/run && cd /tmp/o2sv/run
   env -i HOME=/tmp/o2sv/run PATH=/usr/bin:/bin \
     ZO_ROOT_USER_EMAIL=root@example.com ZO_ROOT_USER_PASSWORD='Complexpass#123' \
     ZO_DATA_DIR=/tmp/o2sv/data ZO_HTTP_PORT=5096 ZO_GRPC_PORT=5097 \
     ZO_META_STORE=sqlite ZO_LOCAL_MODE=true ZO_LOCAL_MODE_STORAGE=disk \
     ZO_TELEMETRY=false \
     ZO_DB_MONITORING_ENABLED=true ZO_DB_MONITORING_INTERVAL_SECS=60 \
     /path/to/target/debug/openobserve
   ```

   Confirm isolation: the log must say `[SQLITE]`, and `GET /api/default/streams`
   must return an empty list on a fresh data dir.

2. **Start the rig.**

   ```bash
   export O2_AUTH=$(printf 'root@example.com:Complexpass#123' | base64)
   docker compose up -d --build          # or: make up
   ```

3. **Let it run 10+ minutes.** The workload fires a real deadlock on each engine
   every ~20 s, plus lock contention, temp-spilling sorts, N+1 loops and full scans.

4. **Query the proof.** See the findings doc for the full capability-by-capability
   SQL. Quick check:

   ```bash
   curl -s -u 'root@example.com:Complexpass#123' -H 'Content-Type: application/json' \
     'http://localhost:5096/api/default/_search?type=logs' -d '{"query":{
       "sql":"SELECT o2_pg_event, count(*) n FROM dbm_server GROUP BY o2_pg_event",
       "start_time":<micros>,"end_time":<micros>,"size":50}}'
   ```

5. **Tear down** (`make down` / `docker compose down -v`) — removes only `dbm-sv-*`.

## Where data lands

| Stream | Type | Contents |
|---|---|---|
| `dbm_server` | logs | every server-vantage signal, tagged `o2_vantage=server` |
| `default` | traces | client spans, enriched by O2 with `o2_db_fingerprint` / `o2_db_query_norm` |
| `_o2_db_stats` | logs | O2's own DBM rollup of the client spans |
| `postgresql_*`, `mysql_*` | metrics | 74 receiver metric streams |

Within `dbm_server`, `o2_recipe` selects the sqlquery recipe (`pg_blocking_chain`,
`pg_activity`, `pg_stat_statements`, `pg_explain`, `pg_table_stats`,
`pg_index_stats`, `pg_stat_database`, `pg_ungranted_locks`, `mysql_digest`,
`mysql_lock_waits`) and `o2_pg_event` / `o2_my_event` select the log-tailed event
kind (`deadlock`, `lock_wait`, `temp_file`, `statement_duration`).

## Version-specific notes — contrib 0.135.0

Discovered empirically with `docker run ... validate`; the parity roadmap's
recipe assumptions do not all hold at this version.

* **`postgresqlreceiver`** — `query_sample_collection` and `top_query_collection`
  exist but have **no `enabled` key**; putting the receiver in a *logs* pipeline is
  what turns the events on. Accepted subkeys are
  `query_sample_collection.max_rows_per_query` and
  `top_query_collection.{top_n_query, max_explain_each_interval, query_plan_cache_size}`.
  `top_query_collection.collection_interval` and `.max_query_length` are **rejected**.
* **`mysqlreceiver`** — has `query_sample_collection.max_rows_per_query` but **no
  `top_query_collection` block at all**, and emitted **no** log events in this run.
  MySQL top-queries therefore come from the authored `sqlquery/mysql_digest`
  recipe against `performance_schema` instead.
* **`pg_stat_statements` must exist in the `postgres` maintenance database**, not
  only in the monitored one — the receiver's top-query collector connects there.
  Without it the receiver logs `relation "pg_stat_statements" does not exist`
  every interval and silently emits zero `top_query` events
  (`pg/init/00-maintenance-db.sh`).
* **EXPLAIN cannot be inlined** in a sqlquery recipe (`EXPLAIN` is not allowed in
  a subquery). It needs a `SECURITY DEFINER` function — the same prerequisite
  Datadog imposes via `datadog.explain_statement()`. Ours is `o2_explain_statement`
  in `pg/init/01-extensions.sql`, and because it is set-returning it must be
  called from a `CROSS JOIN LATERAL`, never wrapped in `COALESCE`.
* **Postgres splits a deadlock across two log entries** — the `ERROR: deadlock
  detected` line and a separate `DETAIL:` entry that holds the wait cycle and every
  participant's SQL. The filelog router must match **both**.
* **MySQL splits a deadlock across many entries** — `MY-012468` is only the banner;
  each `*** (N) TRANSACTION:` block is its own `MY-012469` entry. Route both codes.

## Files

```
docker-compose.yml           compose project `dbm-sv`
collector/config.yaml        receivers + recipes R1..R4 + filelog operators
workload/workload.py         continuous OTel-instrumented load, incl. deadlock pairs
pg/init/00-maintenance-db.sh pg_stat_statements in the `postgres` db
pg/init/01-extensions.sql    schema, seed, o2_monitor role, o2_explain_statement()
pg/mysql-init/01-schema.sql  MySQL schema, seed, o2_monitor grants
pg/mariadb-init/01-schema.sql  MariaDB schema — MIRRORS the MySQL one on purpose
mssql-init/01-schema.sql     SQL Server schema, seed, o2_monitor login
mssql-init/entrypoint.sh     applies the schema (the MSSQL image runs no init.d)
captures/                    real MariaDB deadlock log + MSSQL deadlock XML
Makefile                     up / down / logs / proof helpers
```

## Why MariaDB and SQL Server are here

They answer two questions `dbm-engine-support.md` refused to guess at, and they
close a verification gap:

* **MariaDB (§3)** — does it split a deadlock across log entries like MySQL 8?
  **No: one block, both sides present.** The only incompatibility with the
  shipped MySQL regex is the literal `MariaDB thread id` vs `MySQL thread id`.
* **SQL Server (§4)** — is the victim named inline? **Yes**, so no cross-record
  stitching is needed, unlike MySQL.
* **`sqlquery/mssql_blocking` already ships** but had never run against a real
  SQL Server. It does now, returning all 12 columns populated.

Evidence and the full analysis: [`captures/README.md`](captures/README.md).

**SQL Server has no arm64 image** and runs emulated on Apple Silicon. It works
(the captures were taken that way) but starts slowly, hence its 30s
`start_period`. If you only care about the Postgres/MySQL proof, bring those up
by name to skip it.
