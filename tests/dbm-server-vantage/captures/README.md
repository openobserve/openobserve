# Captured evidence

Four capture sets live here:

* **[contrib 0.158.0 receiver events](#captured-evidence--contrib-01580-receiver-events)** — the
  `db.server.query_sample` / `db.server.top_query` upgrade proof (below).
* **[MariaDB and SQL Server](#captured-evidence--mariadb-and-sql-server)** — deadlock log formats.
* **[MariaDB + SQL Server at 0.158.0](#captured-evidence--mariadb--sql-server-at-01580)** — closes
  the "postgres + mysql only" gap the first set left open. **Two shipped-product
  bugs found**: the MariaDB blocking recipe cannot run on MariaDB at all, and
  MSSQL deadlock SQL text never reaches the parser.
* **[MySQL/MariaDB table & index stats + mysql_limits (WP2)](#captured-evidence--mysqlmariadb-table--index-stats--mysql_limits-wp2)** —
  the four schema-health recipes and the connection-limit gauge, run against
  real engines for the first time. **One shipped-recipe bug found and fixed**:
  a MySQL functional index NULLs the entire `index_def` body.

---

# Captured evidence — contrib 0.158.0 receiver events

Captured 2026-08-11 · collector-contrib **0.158.0** (digest
`sha256:c5918f78992ee73b0d6f0e599423ac5ec52dd5d9726733114d6eca53d5a32ed5`) ·
postgres:16 · mysql:8.4 · arm64/darwin.

Taken when this rig was bumped **0.135.0 → 0.158.0**. Upstream v0.148.0 flipped
both events from default-ON to default-OFF, so a naive image bump keeps a
*green, error-free* collector that emits **nothing**. These files are the proof
that the new `events:` block restores them, plus the answers to six questions
that had previously only been *inferred from reading upstream source*.

## What each file proves

| File | Proves |
|---|---|
| `pg-query-sample.jsonl` | postgresqlreceiver emits `db.server.query_sample`; full 23-attribute shape |
| `pg-query-sample-blocked.jsonl` | the same event during **real lock contention** — the only way to see non-empty `postgresql.blocking.*` |
| `pg-top-query.jsonl` | postgresqlreceiver emits `db.server.top_query`; 17 attrs; `postgresql.query_plan` populated |
| `mysql-query-sample.jsonl` | mysqlreceiver emits `db.server.query_sample`; 21 attrs |
| `mysql-top-query.jsonl` | mysqlreceiver emits `db.server.top_query` — **new at 0.158.0**, it had no such block at 0.135.0 |
| `no-events-block-negative-control.jsonl` | the silent-failure mode: identical rig, `events:` block removed |

`raw/receiver-events.jsonl` is the unabridged sink written by the
`file/raw_events` exporter (multi-MB, gitignored). The files above are
representative records extracted from it.

## The headline: the negative control

Same collector, same receivers, same databases, `events:` block **deleted**.
Ran 75 s ≈ 7 collection cycles at `collection_interval: 10s`:

```
$ cat no-events-block-negative-control.jsonl
{}
{}
… 16 identical empty batches …

$ grep -c eventName no-events-block-negative-control.jsonl
0
$ docker logs neg-ctl 2>&1 | tail   # telemetry level = warn
                                    # (no output — not one warning)
```

versus the same window with the block present:

```
$ grep -o '"eventName":"[^"]*"' raw/receiver-events.jsonl | sort | uniq -c
 621 "eventName":"db.server.query_sample"
1475 "eventName":"db.server.top_query"
```

**16 empty batches and zero log lines is what a wrong upgrade looks like.** It is
indistinguishable from "this database is idle". Nothing else in this document
matters as much as that.

## Accepted config at 0.158.0 (`validate`-verified, key by key)

Every 0.135.0 constraint in the old `collector/config.yaml` header **changed**.

| Key | 0.135.0 | 0.158.0 |
|---|---|---|
| `events:` block | did not exist | **required**, sibling of `metrics:` |
| pg `top_query_collection.collection_interval` | REJECTED | **accepted** |
| pg `top_query_collection.max_query_length` | REJECTED | still REJECTED |
| pg `query_sample_collection.collection_interval` | — | REJECTED (no own interval) |
| mysql `top_query_collection` | **block absent entirely** | **exists** |
| mysql `top_query_collection.{top_query_count, collection_interval, lookback_time, query_plan_cache_size}` | — | accepted |
| mysql `top_query_collection.{max_rows_per_query, max_explain_each_interval}` | — | REJECTED |
| `enabled:` inside the tuning blocks | REJECTED | still REJECTED (lives only under `events:`) |

Note the cross-engine spelling asymmetry: postgres `top_n_query` vs mysql
`top_query_count`.

The `events:` block is **strictly key-validated**, which is how the two event
names were confirmed rather than guessed:

```
$ # events: { db.server.bogus_event: { enabled: true } }
Error: failed to get config: cannot unmarshal the configuration:
'receivers' error reading configuration for "postgresql":
'events' has invalid keys: db.server.bogus_event
```

> ⚠️ **`validate` short-circuits.** A config with errors in *two* receivers
> reports only the first. An early probe here read as "postgres accepts
> `max_query_length`" purely because mysql failed first. Validate one receiver at
> a time, or you will record a false positive.

## The six questions

### 1. Is `postgresql.blocking.pids` a string holding a PG array literal?

**Yes — `stringValue`, PG array-literal syntax, `{}` when not blocked.** Never
absent, never null, never `[]`.

```
$ # all pg query_sample records, distinct values of postgresql.blocking.pids
'{}'                x173      <- NOT blocked
'{82334}'           x5        <- single blocker
'{82363}'           x4
'{82363,81491}'     x3        <- TWO blockers, comma-separated, no spaces
```

Consumers must parse `{...}`, strip the braces, split on `,`, and treat `{}` as
empty. Confirmed against `pg_stat_activity`:

```
$ psql -tAc "SELECT pid, pg_blocking_pids(pid) FROM pg_stat_activity
             WHERE cardinality(pg_blocking_pids(pid))>0"
81491|{82363}
81517|{82363,81491}
82363|{82334}
```

### 2. Are the other six `postgresql.blocking.*` attributes omitted when not blocked?

**No — all seven are ALWAYS present, with empty/zero sentinels.** Present in
58/58 records including entirely unblocked ones:

```
present 58/58  postgresql.blocking.pids                    stringValue  '{}'
present 58/58  postgresql.blocking.lock.mode               stringValue  ''
present 58/58  postgresql.blocking.lock.relation           stringValue  ''
present 58/58  postgresql.blocking.lock.type               stringValue  ''
present 58/58  postgresql.blocking.start_time              stringValue  ''
present 58/58  postgresql.blocking.transaction.start_time  stringValue  ''
present 58/58  postgresql.blocking.wait_duration           intValue     '0'
```

So **presence is not a blocked-signal** — `pids != '{}'` is. Note the type split:
six strings and one `intValue`. When genuinely blocked they populate:

```
postgresql.blocking.pids       = '{82334}'
postgresql.blocking.lock.mode  = 'ShareLock'
postgresql.blocking.lock.type  = 'transactionid'
postgresql.blocking.start_time = '2026-08-11T02:33:28Z'
postgresql.blocking.wait_duration = 11          <- seconds
postgresql.pid                 = '82363'
```

`postgresql.blocking.lock.relation` stayed `''` even while blocked, because these
were `transactionid`/`tuple` locks which have no relation. Not proven for
relation-level locks.

### 3. Is `postgresql.total_exec_time` seconds or milliseconds?

**SECONDS on `top_query` — upstream issue #50113 is CONFIRMED.** The docs say ms;
the emitted value is ms÷1000. Measured against `pg_stat_statements` ground truth
in the same window:

```
query prefix                          emitted   pg_stat_statements ms      ratio
UPDATE inventory                  118335.0996          118377113.876    1000.3550
SELECT pg_sleep                    65976.9779           65999016.302    1000.3340
SELECT o.customer_ref              24921.5932           24931812.046    1000.4100
SELECT customer_ref                 7302.0700            7305349.498    1000.4491
SELECT count ( * )                  5993.4452            5995974.732    1000.4220
SELECT sku, qty                       70.2316              70249.043    1000.2480
```

A uniform ~1000.3 across six queries spanning four orders of magnitude. (The
0.03% excess is the counter advancing between the two reads, not a different
factor.) The cleanest single proof — `SELECT pg_sleep($1)` with a 2-second
argument:

```
pg_stat_statements mean_exec_time = 2004.8295   (ms)
receiver per-call delta           =    2.0035   <- seconds
```

**The two events DISAGREE.** `query_sample`'s `postgresql.total_exec_time` is in
genuine **milliseconds** — the same `pg_sleep(2)` shows up as `1000.462` for a
1-second sleep and the slow join as `946.83`:

```
-- pg query_sample: postgresql.total_exec_time (top values) --
   total_exec_time=1000.462   q=SELECT pg_sleep ( ? ) AS marker
   total_exec_time=946.83     q=SELECT o.customer_ref, o.note, count ( l.id ) …
```

Same attribute name, same receiver, **two different units**. Any consumer must
scale by event type. Both are `doubleValue`.

### 3b. (Unasked, found anyway) top_query is a DELTA feed after the first emission

Not in the brief, but it changes how the numbers must be read. The **first**
emission per query carries the cumulative `pg_stat_statements` backlog; every
subsequent one is a **per-interval delta**:

```
q=SELECT pg_sleep ( ? ) AS marker
   total_exec_time=65976.9779  calls=32909   <- first: cumulative backlog
   total_exec_time=6.0086      calls=3       <- then: per-interval deltas
   total_exec_time=8.0123      calls=4
   total_exec_time=6.0102      calls=3
```

`6.0086 / 3 = 2.003 s` per call — consistent with `pg_sleep(2)`. Summing these
as if cumulative double-counts the backlog; treating the first as a delta
produces a huge false spike on collector start. MySQL behaves the same way, with
its first emission carrying `count_star=0`.

### 4. Does the `queryid` vs `query_id` spelling difference still hold?

**Yes, unchanged at 0.158.0.**

```
pg db.server.top_query:    ['postgresql.queryid']    <- no underscore
pg db.server.query_sample: ['postgresql.query_id']   <- underscore
```

Joining the two events requires normalising the key name. Both are
`stringValue`; values are signed 64-bit and **can be negative**
(`-4641257188670446815`).

### 5. Is `postgresql.query_plan` present, absent, or empty on top_query?

**Always present as a key; sometimes an empty string.** Never absent.

```
{'PRESENT (non-empty)': 116, 'EMPTY STRING': 159}
```

Non-empty values are the full `EXPLAIN (FORMAT JSON)` document:

```
[{"Plan":{"Node Type":"ModifyTable","Operation":"?","Relation Name":"inventory",
  "Startup Cost":0.27,"Total Cost":8.30,"Plans":[{"Node Type":"Index Scan",
  "Index Name":"inventory_pkey",…
```

The empty ones are the `max_explain_each_interval` budget, un-EXPLAIN-able
statements (`COMMIT`, `BEGIN`, DDL) — and a **receiver bug**, below. **Treat `''`
as "no plan this interval", not "no plan exists"** — the same queryid alternates
between populated and empty across intervals. In `pg-top-query.jsonl` the five
saved records have plan lengths 525, 525, 146, 2385, 1712.

#### 5b. The receiver EXPLAINs the *normalised* query, which can be invalid SQL

Found in the collector log, not the data. The receiver parameterises literals to
`$N` **before** running EXPLAIN, which corrupts any construct where the token was
never a parameter. `EXTRACT(EPOCH FROM ...)` becomes `EXTRACT($8 FROM ...)`:

```
postgresqlreceiver@v0.158.0/client.go:183 failed to explain statement
  error: pq: syntax error at or near "$8" at position 9:31 (42601)
  query: … coalesce(round(EXTRACT($8 FROM (now()-query_start))::numeric,$9),$10) …
```

It even fails on **its own** built-in query_sample SQL
(`EXTRACT($12 FROM query_start)`, scraper.go:491). Other observed causes:

```
   8  pq: syntax error at or near "$N"
   3  pq: function generate_series(unknown, unknown) is not unique   <- $N lost the type
   1  pq: column "…" does not exist
```

These are logged at `error` but are **non-fatal** — the event is still emitted,
just with `postgresql.query_plan: ''`. Consequence for us: a permanently
plan-less subset of queries that is *not* explained by budget or statement kind,
and a recurring `error`-level line that is harmless. Only 12 occurrences here,
all against the rig's own monitoring SQL, so it did not affect the workload
queries whose plans are captured above.

### 6. What does MySQL's top_query emit?

**mysqlreceiver now HAS `top_query_collection`** (it had none at 0.135.0 — the
reason this rig grew the authored `sqlquery/mysql_digest` recipe). It emits a
lean **8 attributes**:

```
db.query.text                                            stringValue
db.system.name                                           stringValue  'mysql'
mysql.events_statements_summary_by_digest.count_star     intValue
mysql.events_statements_summary_by_digest.digest         stringValue
mysql.events_statements_summary_by_digest.sum_timer_wait doubleValue
mysql.query_plan                                         stringValue
mysql.query_plan.hash                                    stringValue
o2_vantage                                               stringValue  (ours)
```

Far thinner than Postgres's 17 — **no rows, no shared/temp block counters, no
plan time, no user/namespace**. `sqlquery/mysql_digest` still carries
`rows_examined`, `tmp_disk_tables`, `full_scans`, `no_index_used` etc., so it is
**not** made redundant by this receiver block.

`sum_timer_wait` is converted to **seconds** (performance_schema stores
picoseconds): emitted `2.079` over `count_star=28` ≈ 74 ms/call, against a
ground-truth `AVG_TIMER_WAIT/1e12 = 0.0531 s`. Also delta-per-interval.

`mysql.query_plan` behaves like the PG one — present-but-sometimes-empty
(89 populated / 39 empty), holding MySQL's `EXPLAIN FORMAT=JSON`
(`{"query_block":{"select_id":1,"cost_info":{"query_cost":"33432.95"},…`).
`mysql.query_plan.hash` is **not a plan hash** — whenever a plan is present it is
byte-identical to `…summary_by_digest.digest`, i.e. a *statement* digest, so it
cannot be used to detect a plan change:

```
hash == digest : 386   (every record that has a plan)
hash != digest : 166   (all of them hash='' with plan len 0)
```

MySQL `query_sample` (21 attrs) has no blocking attributes at all — the
`postgresql.blocking.*` family has **no MySQL counterpart**, so MySQL blocking
still requires `sqlquery/mysql_locks`.

## Reproducing

```bash
export O2_AUTH=$(printf 'root@example.com:Complexpass#123' | base64)
docker compose up -d --wait postgres mysql
docker compose up -d collector workload
# raw sink appears at captures/raw/receiver-events.jsonl (no live O2 needed)
grep -o '"eventName":"[^"]*"' captures/raw/receiver-events.jsonl | sort | uniq -c
```

To see non-empty `postgresql.blocking.*`, force contention and wait one interval:

```bash
docker exec dbm-sv-postgres psql -U dbm -d dbmlab \
  -c "BEGIN; UPDATE accounts SET balance=balance+999 WHERE id=1; SELECT pg_sleep(45); COMMIT;" &
sleep 3
docker exec dbm-sv-postgres psql -U dbm -d dbmlab \
  -c "UPDATE accounts SET balance=balance-999 WHERE id=1;" &
```

## Verified vs assumed

**Verified by running:** both events emit for both engines at 0.158.0; the
`events:` block is required and strictly validated; the negative control is
silent; every accepted/rejected config key in the table above; all six answers;
`postgresql.total_exec_time` unit disagreement against ground truth; delta
semantics; the normalised-EXPLAIN failure (§5b).

**Non-fatal noise this upgrade leaves in the log:** `failed to explain
statement` / `failed to explain query` from §5b. Neither the `postgresql` nor the
`mysql` receiver produced any other error; the remaining log errors
(`sending queue is full`, HTTP POST failures) are the absent local OpenObserve,
and the `filelog/*` "regex pattern does not match" lines pre-date this bump.

**Assumed / not tested:** rotation behaviour of the `file` exporter (left
unconfigured); `postgresql.blocking.lock.relation` under relation-level locks
(only `transactionid`/`tuple` observed); ~~MariaDB and MSSQL receiver events (this
run covered postgres + mysql only)~~ — **now covered, see
[MariaDB + SQL Server at 0.158.0](#captured-evidence--mariadb--sql-server-at-01580)**;
whether the delta/cumulative split survives a
`pg_stat_statements_reset()`; behaviour under `max_explain_each_interval`
saturation at scale.

---

# Captured evidence — MariaDB and SQL Server

Real output from the rig's `mariadb` and `mssql` containers, kept because two
design questions in `docs/___databsepages/dbm-engine-support.md` were explicitly
blocked on *"do not guess the format"*. These files are the answers.

Captured 2026-08-10 · MariaDB 11.8.8 · SQL Server 2022 (RTM-CU26) 16.0.4265.3

---

## `mariadb-deadlock.log` — settles §3

**Question:** does MariaDB write a deadlock as ONE multi-line block, or split it
across entries like MySQL 8?

**Answer: it SPLITS, exactly like MySQL.**

⚠️ **A first reading of this file got that backwards** — worth keeping, because
the mistake is easy to repeat. MariaDB prints an entire deadlock inside one clock
second, so in a text editor it reads as one block. But every physical line
carries its own timestamp prefix, so `filelog`'s `line_start_pattern` cuts it
into **eight** entries:

```
entry 1  Transactions deadlock detected, dumping detailed information.
entry 2  *** (1) TRANSACTION:  →  trx 48, MariaDB thread id 14
entry 5  *** (2) TRANSACTION:  →  trx 47, MariaDB thread id 15
entry 8  *** WE ROLL BACK TRANSACTION (2)
```

"Same timestamp" and "same record" look identical in a log file and are
completely different to the collector. MariaDB therefore owes the same stitching
tax as MySQL, and the shipped recipe uses one side-regex per record plus the
existing `merge_mysql_deadlocks` join.

**The one real incompatibility is a vendor literal**, not a structure:

| | MySQL 8.4 | MariaDB 11.8 |
|---|---|---|
| Thread line | `MySQL thread id 14, OS thread handle …` | `MariaDB thread id 14, OS thread handle …` |

Measured against the shipped patterns in `dbmShared.ts`:

| Shipped pattern | Matches on MariaDB |
|---|---|
| `my_trx_*` (side/id/thread/host/user/query) | **0** — fails only on `MySQL thread id` |
| same pattern with `MariaDB thread id` | **2** — both sides, all groups populated |
| RECORD LOCKS (`my_lock_*`) | 4 — works unchanged |
| `*** WE ROLL BACK TRANSACTION (N)` (`my_victim_side`) | 1 — works unchanged |

So MariaDB needs its **own** receiver whose transaction regex differs by one
literal. Do **not** loosen the shared MySQL regex to `(MySQL|MariaDB) thread id`
— §3's first trap says why, and it applies unchanged.

### The routing trap (found by running the config, not reading it)

The side entries' own text is a bare `InnoDB:` — they contain **neither**
`Transactions deadlock detected` (entry 1) **nor** `WE ROLL BACK TRANSACTION`
(entry 8). A router keyed on only those two phrases captures the verdict and
**silently drops both sides**, yielding deadlocks with no participants. The first
draft of the shipped receiver had exactly that bug; it passed unit tests and
looked correct against this static capture, and was only caught by piping the
generated config through collector-contrib against the live server:

```
before fix:  maria_victim_side=2                       (sides missing)
after fix:   maria_trx_side=1/2, maria_trx_id=359/360,
             maria_trx_thread=96/97, maria_trx_query=…,
             maria_victim_side=2                       (complete)
```

The shipped receiver routes on `*** (N) TRANSACTION:` as a third condition.
`web/src/components/ingestion/setupCard/content/dbmMariadb.spec.ts` asserts it.

Note the victim verdict (`WE ROLL BACK TRANSACTION (2)`) lands under the **same**
timestamp as both sides here, unlike MySQL 8 where it arrives on its own record.
If that holds generally, MariaDB needs **no** `stitch_mysql_deadlocks`
equivalent — but this is one capture of one deadlock shape, so confirm on a
multi-participant deadlock before relying on it.

## `mssql-deadlock.xml` — settles §4

**Question:** is the victim named inline, making MSSQL structurally the Postgres
case rather than the MySQL one?

**Answer: yes, confirmed.**

```
<victim-list><victimProcess id="processe94d9e108"/></victim-list>
<process-list>
  <process id="processe94d9e108" spid="87" …>   <- the victim
  <process id="processe80423468" spid="89" …>   <- the survivor
```

The victim id resolves to a `<process>` in the same document, and each
participant's SQL is inline in its `<inputbuf>`. **No cross-record stitching, no
`victim_side` column, no read-time join** — the whole MySQL tax is avoidable, as
§4 predicted.

> ⚠️ **`VIEW SERVER STATE` IS NOT ENOUGH** — found when the shred was run as the
> restricted `o2_monitor` login rather than `sa`. Reading `system_health` via
> `sys.fn_xe_file_target_read_file` also needs **`VIEW SERVER PERFORMANCE
> STATE`**, or it fails with msg 300 ("permission was denied on object
> 'server'"). Blocking keeps working throughout, so the symptom is a Deadlocks
> tab that stays empty while everything else looks healthy — indistinguishable
> from "this server has no deadlocks". The shipped `MSSQL_DBM_GRANT_SQL` now
> issues both grants.

Practical notes for whoever writes the receiver:

- `<stackFrames>` is the bulk of the 12 KB document and is useless to us. Shred
  in T-SQL and project only victim/process/SQL, per §4's "shred in T-SQL, not
  Rust" decision.
- Reading `system_health` needs `SET QUOTED_IDENTIFIER ON` — XML methods fail
  without it. The `sqlcmd -Q` default is OFF, which is a silent trap.

## Blocking — the shipped recipe, verified live for the first time

`sqlquery/mssql_blocking` has shipped in `dbmShared.ts` since the Databases UI
landed but had **never been executed against a real SQL Server** (the rig ran
Postgres and MySQL only). Run here against a genuine blocked session, it returns
all 12 columns populated:

```
blocked_pid=91  blocked_user=sa  blocked_app=SQLCMD
blocked_query=(@1 int,@2 tinyint)UPDATE [accounts] set [balance]…
wait_event_type=LCK_M_X
wait_event=KEY: 5:72057594045726720 (d123aa1a66e6)
blocked_wait_s=5.076000
blocking_pid=90  blocking_state=running  blocking_app=SQLCMD
blocking_query=BEGIN TRAN; UPDATE accounts SET balance=balance+1 WHERE id=2…
o2_recipe=mssql_blocking_chain
```

`mssql_blocking_chain` is accepted by the parser at `server_vantage.rs:319` and
`:904`, so this row canonicalizes. **MSSQL blocking is now live-verified, not
merely reviewed.**

---

## Reproducing

```
make up                     # brings up all five engines
docker exec -it dbm-sv-mariadb mariadb -uroot -pdbm -D dbmlab
docker exec -it dbm-sv-mssql /opt/mssql-tools18/bin/sqlcmd \
  -S localhost -U sa -P "$MSSQL_SA_PASSWORD" -C -d dbmlab
```

The `mariadb-deadlock` and `mssql-deadlock` workload threads generate these
continuously; the files here are single representative captures.

**SQL Server runs under emulation on arm64 Macs** (no arm64 image). It works —
these captures were taken that way — but it is slow to start, which is why its
healthcheck has a 30s `start_period` and 60 retries.

---

# Captured evidence — MariaDB + SQL Server at 0.158.0

Captured 2026-08-11 · collector-contrib **0.158.0** ·
`mariadb:11` = **11.8.8-MariaDB** (digest `sha256:d9f7eb26…acb75fbf`) ·
`mssql/server:2022-latest` = **SQL Server 2022 (RTM-CU26) 16.0.4265.3**
(digest `sha256:ba4c8329…5e457c89`) · arm64/darwin (MSSQL under emulation).

The first capture set above covered **postgres + mysql only** and listed
"MariaDB and MSSQL receiver events" as *assumed / not tested*. This set closes
that gap. It matters more than a coverage tick: deadlock support for these two
engines is the capability where we most clearly beat Datadog (which does
deadlocks for SQL Server only), so it was the least-verified part of our
strongest claim.

**It found two shipped-product bugs — B1 and B2 below.** Both are silent: the
pipeline stays green and the UI simply shows nothing.

## What each file proves

| File | Proves |
|---|---|
| `mariadb-top-query.jsonl` | `mysqlreceiver` DOES emit `db.server.top_query` against MariaDB 11 — 8 attrs, but `mysql.query_plan` **always empty** |
| `mariadb-query-sample.jsonl` | it also emits `db.server.query_sample` — 21 attrs, same shape as MySQL, but **rare** (9 vs 20 in the same window) |
| `mssql-query-sample-v0158.jsonl` | **`sqlserverreceiver` exists and emits `query_sample`** — 42 attrs, incl. native `sqlserver.blocking_session_id` |
| `mssql-top-query-v0158.jsonl` | it emits `top_query` too — 21 attrs with a real `ShowPlanXML` execution plan (plans truncated to 600 chars for the repo) |
| `mariadb-deadlock-v0158.jsonl` | the `filelog` + `o2_maria_event` recipe captures both sides + the verdict; field names match the parser |
| `mssql-deadlock-v0158.jsonl` | the `system_health` XE shred works; victim resolved inline — **and exposes B2** |
| `mssql-blocking-chain-v0158.jsonl` | `mssql_blocking_chain` populated from a real blocked session |
| `mariadb-lock-waits.jsonl` | `mariadb_lock_waits` rows — **produced by a rewritten query, not the shipped one (B1)** |
| `mariadb-shipped-locks-failure.txt` | the literal error the **shipped** MariaDB blocking recipe returns every cycle |

Raw sinks are `raw2/` (multi-MB). The files above are representative records
extracted from them.

## How this was run

These captures were taken while `collector/config.yaml` was being edited
concurrently, so they ran from a temporary `collector/overlay-probe.yaml`
passed as a second `--config` (validated to merge cleanly) in its **own**
collector container (`dbm-sv-overlay`, own pipeline names and file exporters),
leaving the shared `dbm-sv-collector` untouched.

**That overlay no longer exists — `collector/config.yaml` now carries all four
recipes directly**, so a re-run needs only the single config. The overlay is
described here because it is how the evidence below was produced, not because
you need it.

One difference between the overlay and what is now shipped: the overlay's
MariaDB blocking query used `information_schema.INNODB_LOCK_WAITS`, proving a
working shape was reachable, while the then-shipped recipe still used MySQL's
`performance_schema.data_lock_waits`. That bug is now **fixed** in both
`dbmShared.ts` and `config.yaml`, so the two agree again. The SQL for all four
recipes is otherwise copied verbatim from `dbmShared.ts` with `{host}`/`{port}`/
`{database}` substituted.

---

## B1 — the shipped MariaDB blocking recipe CANNOT RUN on MariaDB

**Severity: the `mariadb_lock_waits` capability is entirely non-functional as
shipped.** Not degraded — zero rows, ever.

`MARIADB_BLOCKING_RECEIVER` in `dbmShared.ts` is a deliberate copy of the MySQL
query (the doc comment says so, and explains that only the `o2_recipe` tag
needed to change). But the table it reads is a **MySQL 8.0 addition that MariaDB
never adopted**:

```
$ docker logs dbm-sv-overlay | grep -oE 'Error 1146[^"]*' | sort -u
Error 1146 (42S02): Table 'performance_schema.data_lock_waits' doesn't exist
```

Confirmed against the server's own catalog — MariaDB has **neither** of the two
P_S tables the recipe needs, and kept the pre-8.0 `information_schema` ones:

```
$ mariadb -e "SELECT COUNT(*) FROM information_schema.tables
              WHERE TABLE_SCHEMA='performance_schema' AND TABLE_NAME='data_lock_waits'"
0
$ … AND TABLE_NAME='data_locks'
0
$ … WHERE TABLE_SCHEMA='information_schema' AND TABLE_NAME='INNODB_LOCK_WAITS'
1
```

So the row count is not "low because the rig was quiet" — the statement errors
on **every** collection interval. The failure is silent end-to-end: the
collector logs it at `error` but keeps running, and the Databases page shows an
empty Blocking tab, indistinguishable from "this server has no contention".

**A working shape is reachable** — the overlay's `sqlquery/mariadb_locks_native`
keeps the exact same 12-column output contract (so `canonicalize_blocking` is
unchanged) and only swaps the FROM clause to
`information_schema.INNODB_LOCK_WAITS` joined to `INNODB_TRX`. Against a real
two-session lock wait it returns everything populated:

```
waiting_trx=10405   blocking_trx=10404
waiting_thread=21325  blocking_thread=21323
waiting_state=LOCK WAIT   blocking_state=LOCK WAIT
wait_secs=3
blocking_query=UPDATE accounts SET balance=balance+999 WHERE id=1
body(waiting_query)=UPDATE accounts SET balance=balance-999 WHERE id=1
server_address=mariadb   o2_recipe=mariadb_lock_waits
```

Cross-checked against the server at the same moment:

```
$ mariadb -e "SELECT requesting_trx_id, blocking_trx_id
              FROM information_schema.INNODB_LOCK_WAITS"
10405   10398
```

> ⚠️ The five `mariadb_lock_waits` rows in `mariadb-lock-waits.jsonl` come from
> the **rewritten** query. The shipped one produced **zero**. The tag is
> identical in both, which is precisely why this bug is invisible downstream —
> nothing about a row's contents reveals which query produced it.

*(The rewritten SQL is a demonstration that the contract is satisfiable, not a
reviewed fix — `INNODB_LOCK_WAITS` is deprecated in MySQL 8 and its
`wait_secs`/`trx_state` semantics on MariaDB were not audited beyond this run.)*

## B2 — MSSQL deadlock SQL text never reaches the parser

**Severity: every MSSQL deadlock participant canonicalizes with `query: None`** —
no statement, no `query_norm`, no fingerprint. The deadlock still renders, but
the single most useful field on it is blank.

`canonicalize_mssql_deadlock` (`server_vantage.rs:520`) reads the statement from
**one** key and has no fallback:

```rust
let query = first_str(rec, &["mssql_query"]);
```

But the shipped recipe declares `mssql_query` as the **`body_column`**, not an
attribute — so no record ever carries a key by that name:

```
-- mssql_deadlock rows: attribute frequency (22 rows) --
   22  mssql_dl_ts      22  mssql_is_victim   22  mssql_lock_mode
   22  mssql_spid       22  mssql_app         22  mssql_lock_target
   22  mssql_db         22  mssql_user        22  server_address

-- parser-required fields --
        PRESENT  mssql_app          (22/22)
        PRESENT  mssql_dl_ts        (22/22)
        PRESENT  mssql_is_victim    (22/22)
        PRESENT  mssql_lock_mode    (22/22)
        PRESENT  mssql_lock_target  (22/22)
        PRESENT  mssql_spid         (22/22)
        PRESENT  mssql_user         (22/22)
 *** ABSENT ***  mssql_query        (0/22)     <-- the parser reads ONLY this
```

The text is not lost — it is in the body, 40/40 non-empty:

```
spid= 56 victim=1 mode=X target=dbmlab.dbo.accounts
    body='UPDATE accounts SET balance = balance - 1 WHERE id = 32'
spid= 57 victim=0 mode=X target=dbmlab.dbo.accounts
    body='UPDATE accounts SET balance = balance - 1 WHERE id = 31'
```

**Why this is a genuine bug and not a harness artifact:** the sibling
canonicalizers already do the fallback. `canonicalize_blocking` reads
`&["blocked_query", "waiting_query", "body"]` (`:720`), and this same function
reads `raw: first_str(rec, &["body"])` two lines below the miss — so `body` is
demonstrably reachable at that point, and only the `query` lookup omits it.

**Why the tests do not catch it:** the fixture at
`tests_server_vantage.rs:479` synthesizes `"mssql_query": query` as a literal
attribute — a record shape the collector never produces. The test proves the
parser works on input that cannot occur.

Suggested one-line fix, matching the sibling's existing pattern:
`first_str(rec, &["mssql_query", "body"])`.

**MariaDB is NOT affected** — its query arrives as a real attribute
(`maria_trx_query`), because the filelog regex names it rather than routing it
through `body_column`.

---

## Q1 — Does `mysqlreceiver` emit the two events against MariaDB 11?

**YES, both — but `top_query` is plan-less, and the receiver knows it is talking
to MariaDB.**

```
$ grep -o '"eventName":"[^"]*"' raw2/mariadb-receiver-events.jsonl | sort | uniq -c
   9 "eventName":"db.server.query_sample"
  20 "eventName":"db.server.top_query"
```

The receiver version-sniffs and records the verdict in its own startup log —
this is the mechanism, not an inference:

```
mysqlreceiver@v0.158.0/scraper.go:137 detected database version
  {"otelcol.component.id": "mysql/mariadb",
   "product": "MariaDB", "version": "11.8.8",
   "supports_query_sample_text": false}
```

Against real MySQL 8.4 the same field is `true`.

### Attribute diff vs real MySQL 8.4

`db.server.query_sample` — **identical 21 attributes**, same names, same types.
No MariaDB-specific attribute, none missing. `db.server.top_query` — **identical
8 attributes**. The shapes are interchangeable; only the *values* differ.

## Q2 — the query-plan constraint: CONFIRMED

The brief's assumption ("MySQL plans require `query_sample_text` (8.0.22+),
MariaDB gets NO query plan") is **confirmed exactly**, and it is `top_query`'s
`mysql.query_plan` that is affected:

| Engine | `top_query` records | `mysql.query_plan` non-empty |
|---|---|---|
| **MariaDB 11.8.8** | 40 | **0** |
| MySQL 8.4 (this run) | 5 | 4 |
| MySQL 8.4 (large raw sink) | 1454 | **1017** |

Zero out of forty, against a receiver that fills two thirds of them on MySQL.
Combined with `supports_query_sample_text: false` above, the mechanism and the
outcome both check out.

**Consequence for the product:** on MariaDB, `top_query` degrades to a digest +
latency feed. It is still useful (it is how you rank slow statements), but the
Query Plan surface is permanently empty and no amount of configuration changes
that.

> **The shipped MariaDB setup card does not offer these receiver events at all** —
> it ships only `sqlquery/mariadb_locks` + `filelog/mariadb_deadlocks`. So this
> is an opportunity (top_query works and is not being offered), not a
> regression. But it must not be advertised as MySQL parity: **no plans**, and
> see B1 for the blocking half.

## Q3 — Does contrib 0.158.0 have a usable `sqlserverreceiver`? YES

The brief's fallback position ("if it does not, SQL Server DBM depends entirely
on the `sqlquery` recipes") **does not apply**. The component exists:

```
$ otelcol-contrib components | grep sqlserver
    - name: sqlserver
      module: …/receiver/sqlserverreceiver v0.158.0
```

and it accepts **both** event names. Proven by the strict key validation the
first capture set documented — a bogus name is fatal, the two real ones pass:

```
$ # events: { db.server.bogus_event: { enabled: true } }
Error: 'receivers' error reading configuration for "sqlserver":
       'events' has invalid keys: db.server.bogus_event

$ # events: { db.server.query_sample: … }   -> accepted (no output)
$ # events: { db.server.top_query:    … }   -> accepted (no output)
```

### Accepted config keys at 0.158.0 (probed one receiver at a time)

| Key | sqlserver |
|---|---|
| `query_sample_collection.max_rows_per_query` | **accepted** |
| `query_sample_collection.collection_interval` | REJECTED |
| `query_sample_collection.enabled` | REJECTED |
| `top_query_collection.top_query_count` | **accepted** (MySQL spelling, not pg's `top_n_query`) |
| `top_query_collection.lookback_time` | **accepted** |
| `top_query_collection.collection_interval` | **accepted** |
| `top_query_collection.top_n_query` | REJECTED |
| `top_query_collection.max_rows_per_query` | REJECTED |
| `top_query_collection.query_plan_cache_size` | REJECTED |
| `top_query_collection.max_query_length` | REJECTED |

So the cross-engine spelling asymmetry is **2-vs-1, not 1-vs-1**: postgres alone
says `top_n_query`; mysql and sqlserver both say `top_query_count`.

### What it emits

`db.server.query_sample` — **42 attributes**, the richest of the three engines
(pg 23, mysql 21). Most valuable: it carries blocking **natively**, which the
first capture set established has *no MySQL counterpart*:

```
sqlserver.blocking_session_id      '54'
sqlserver.blocking.start_time      '2026-08-11T02:56:25.917+00:00'   (5/10 — only when blocked)
sqlserver.wait_type                'LCK_M_X'
sqlserver.wait_resource            'KEY: 5:72057594045726720 (d123aa1a66e6)'
sqlserver.wait.resource.type       'KEY'      (5/10)
sqlserver.wait.resource.id         '72057594045726720'
sqlserver.request_status           'suspended'
```

Note the presence split — `blocking_session_id` is present on all 10 records but
`blocking.start_time` / `wait.resource.*` only on the 5 genuinely blocked ones.
That is the **opposite** convention to postgres, where all seven
`postgresql.blocking.*` are always present with empty sentinels. A consumer
cannot use one presence rule for both engines.

`db.server.top_query` — **21 attributes**, with a genuine execution plan:

```
sqlserver.query_plan        '<ShowPlanXML xmlns="http://schemas.microsoft…'   7/10 non-empty
sqlserver.query_plan_hash   'ff9e7fd201e9d9d9'
sqlserver.query_hash        '113a60cd5aa2d772'
sqlserver.execution_count   '4'
sqlserver.total_elapsed_time '29.033095'
sqlserver.total_worker_time  '0.000456'
sqlserver.total_logical_reads '20'
```

`sqlserver.query_plan_hash` **differs from** `sqlserver.query_hash`, i.e. it is a
real *plan* hash and plan-change detection is possible. This is strictly better
than MySQL, where the first capture set proved `mysql.query_plan.hash` is
byte-identical to the statement digest and therefore useless for that purpose.
Plans are `ShowPlanXML`, not JSON — a third plan format alongside pg's
`EXPLAIN (FORMAT JSON)` and MySQL's `EXPLAIN FORMAT=JSON`.

> ⚠️ **`top_query` looks broken for the first minute and logs nothing at `info`.**
> It emitted `query_sample` immediately but no `top_query` for 2+ minutes, with
> zero errors — the same "green but silent" signature as the missing `events:`
> block. It is only a throttle, visible **at `debug` level only**:
> ```
> sqlserverreceiver@v0.158.0/scraper.go:155 Skipping the collection of top
>   queries because the current time has not yet exceeded the last execution
>   time plus the specified collection interval
> ```
> Do not conclude "no top_query on SQL Server" from a short run. Wait out
> `top_query_collection.collection_interval`, or set `--set` telemetry to debug.

## Q4 — Deadlock and blocking evidence

### MariaDB deadlock — captured, and field names MATCH the parser

10 308 deadlock-tagged records over the run. Every field
`canonicalize_mariadb_deadlock` → `canonicalize_innodb_deadlock` reads
(per `tests_server_vantage.rs`) is present:

```
   5154  maria_trx_side       5154  maria_trx_id
   5154  maria_trx_thread     5154  maria_trx_query
   2577  maria_victim_side
   5154  maria_trx_host       5154  maria_trx_user   (extra, unread)
```

The exact 2:1:1 ratio (sides : verdict : deadlock) is the split-entry shape the
earlier capture set predicted, now at n=2592 rather than n=1. Sample:

```
maria_trx_side=1  maria_trx_id=48  maria_trx_thread=14
maria_trx_query='UPDATE accounts SET balance = balance - 1 WHERE id = 11'
```

### ⚠️ Correction to the earlier "MariaDB may need no stitch" note

The MariaDB/SQL-Server section above ends with: *"the victim verdict lands under
the same timestamp as both sides here, unlike MySQL 8… If that holds generally,
MariaDB needs no `stitch_mysql_deadlocks` equivalent — but this is one capture of
one deadlock shape."* It was right to hedge. **It does not hold generally.**

Across 2592 distinct deadlock timestamps:

```
(sides, victims, banners) -> timestamps
  (2, 1, 1) -> 2590     <- canonical: everything in one clock second
  (1, 0, 1) ->    1     <- 2026-08-10 22:23:42
  (1, 1, 0) ->    1     <- 2026-08-10 22:23:43
```

Those two are **one deadlock split across a second boundary** — confirmed in the
raw log:

```
113753: 2026-08-10 22:23:42 96 [Note] InnoDB: Transactions deadlock detected…
113762: 2026-08-10 22:23:42 96 [Note] InnoDB: *** WAITING FOR THIS LOCK…
113772: 2026-08-10 22:23:43 96 [Note] InnoDB: *** CONFLICTING WITH:
113810: 2026-08-10 22:23:43 96 [Note] InnoDB: *** WE ROLL BACK TRANSACTION (2)
```

So MariaDB **does** owe the read-time stitch, exactly as the code already
assumes (`canonicalize_mariadb_deadlock` delegates to the shared InnoDB path —
correct, and now positively justified rather than merely inherited). At 0.077%
(2/2592) the boundary case is rare enough that a small sample will always look
like "no stitch needed", which is exactly how this would have been got wrong.

### MSSQL deadlock — captured; victim resolution correct; see B2 for the gap

22 rows over 11 distinct deadlocks, **exactly 2 participants each**, and the
victim flag splits perfectly 11/11:

```
victim distribution: {'1': 11, '0': 11}
distinct mssql_dl_ts: 11
```

That is the inline-victim property confirmed on live data at n=11 (the earlier
set proved it on one static XML). No cross-record verdict, no `victim_side`.

The `QUOTED_IDENTIFIER` trap the earlier section flagged **reproduced exactly**,
which is worth recording as a live confirmation:

```
$ sqlcmd -Q "SELECT … fn_xe_file_target_read_file('system_health*.xel'…)"
Msg 1934 … SELECT failed because the following SET options have incorrect
settings: 'QUOTED_IDENTIFIER'.

$ sqlcmd -Q "SET QUOTED_IDENTIFIER ON; SELECT … "
2330
```

### MSSQL blocking chain — captured

`mssql_blocking_chain` rows arrived with all 12 attribute columns present
(`blocked_pid`, `blocked_user`, `blocked_app`, `wait_event_type`, `wait_event`,
`blocked_wait_s`, `blocking_pid`, `blocking_state`, `blocking_app`,
`blocking_query`, `server_address`, `o2_recipe`), the blocked statement in the
body. `canonicalize_blocking` reads `body` as a fallback for `blocked_query`, so
unlike B2 **this one canonicalizes correctly**.

### ⚠️ A `#` in a password silently truncates every `sqlquery` DSN

Not engine behaviour — a config trap that cost real time here and will hit any
user with a punctuation-rich password. Both MSSQL recipes failed with:

```
"error": "scraper: parse \"sqlserver://sa:dbm_Passw0rd\": invalid port
          \":dbm_Passw0rd\" after host"
```

The DSN is a URL, so `#` begins a **fragment** and everything after it —
including `@host:port?database=` — is discarded:

```
raw      'sqlserver://sa:dbm_Passw0rd#1@mssql:1433?database=dbmlab'
         -> netloc='sa:dbm_Passw0rd'  fragment='1@mssql:1433?database=dbmlab'
encoded  password percent-encoded as %23
         -> netloc='sa:dbm_Passw0rd%231@mssql:1433'   password='dbm_Passw0rd#1'
```

Percent-encoding the password fixed both receivers. Note the error names a
*port* problem for what is a *password* problem — and `dbmShared.ts` interpolates
`${env:MSSQL_PASSWORD}` straight into the URL, so a customer whose password
contains `#`, `/`, `?` or `@` gets this with no hint that encoding is required.
The MySQL/MariaDB DSN form (`user:pass@tcp(host:port)/db`) is not a URL and is
unaffected.

## Reproducing

All four recipes now live in `collector/config.yaml`, so the overlay dance that
produced these files is no longer needed — one config is enough:

```bash
export O2_AUTH=$(printf 'root@example.com:Complexpass#123' | base64)
make up                                  # all five engines

# sanity-check the config before starting anything
docker run --rm -v "$PWD/collector":/c otel/opentelemetry-collector-contrib:0.158.0 \
  validate --config=/c/config.yaml

# the MariaDB/MSSQL env the recipes read (docker-compose already sets these for
# the bundled collector; listed here for a standalone run)
#   MARIAHOST/MARIAPORT/MARIAUSER/MARIAPASS/MARIADB
#   MSSQLHOST/MSSQLPORT/MSSQLUSER/MSSQLPASS/MSSQLPASSENC/MSSQLDB
```

`MSSQLPASSENC` is the percent-encoded twin of `MSSQLPASS` and is not optional —
see the DSN note above: a `#` in a SQL Server password silently truncates the
`sqlquery` datasource URL at the fragment marker.

`MSSQLPASSENC` is the percent-encoded twin — see the `#` trap above.

A MariaDB lock wait needs two sessions **held open**; a `mariadb -e "…"` one-shot
exits and releases the lock before the 10 s scrape:

```bash
docker exec -d dbm-sv-mariadb sh -c \
  "(echo 'BEGIN;'; echo 'UPDATE accounts SET balance=balance+999 WHERE id=1;'; sleep 45) | mariadb -uroot -pdbm -D dbmlab"
sleep 4
docker exec -d dbm-sv-mariadb sh -c \
  "(echo 'BEGIN;'; echo 'UPDATE accounts SET balance=balance-999 WHERE id=1;'; sleep 30) | mariadb -uroot -pdbm -D dbmlab"
```

Deadlocks at both engines need no help — the existing workload threads drive
them continuously (~1 MariaDB deadlock/25 s).

## Verified vs assumed

**Verified by running:** `mysqlreceiver` emits both events against MariaDB 11.8.8
and the receiver self-reports `supports_query_sample_text: false`; MariaDB
`top_query` plans are 0/40 while MySQL's are 1017/1454; MariaDB's attribute
shapes are byte-identical to MySQL's for both events; `sqlserverreceiver` exists
at 0.158.0, accepts both event names, and emits 42-attr `query_sample` +
21-attr `top_query` with real `ShowPlanXML` and a distinct `query_plan_hash`;
its accepted/rejected key matrix; the `top_query` startup throttle and its
debug-only log line; B1 (shipped MariaDB blocking SQL errors every cycle,
MariaDB has no `data_lock_waits`/`data_locks`) and that a rewritten
`INNODB_LOCK_WAITS` query satisfies the same contract on a live lock wait;
B2 (`mssql_query` absent on 22/22 rows, text present in body on 40/40);
MariaDB deadlock field names match the parser; the 2/2592 second-boundary
deadlock split; MSSQL 11/11 victim resolution; `mssql_blocking_chain` fully
populated; the `QUOTED_IDENTIFIER` msg 1934 trap; the `#`-in-password DSN
truncation.

**Assumed / not tested:** whether the rewritten `INNODB_LOCK_WAITS` query is the
*right* fix for B1 (contract satisfied, semantics not audited;
`INNODB_LOCK_WAITS` is deprecated in MySQL 8, so a shared query may not be
wanted); MariaDB versions other than 11.8.8 and SQL Server other than 2022
CU26; whether `supports_query_sample_text` gates anything besides the plan;
MSSQL `top_query` behaviour once `lookback_time` is exceeded on a busy server;
deadlocks with **more than two** participants at either engine (all 11 MSSQL and
all 2592 MariaDB deadlocks here were 2-way, so the multi-participant stitch is
still unproven for both); whether B2 also affects any other body-column recipe
not exercised here; MSSQL under a non-`sa` login for the receiver events (the
first capture set's `VIEW SERVER PERFORMANCE STATE` finding was for the
`sqlquery` shred — the receiver's own DMV permissions were not re-checked).

---

# Captured evidence — MySQL/MariaDB table & index stats + mysql_limits (WP2)

Captured 2026-08-13 · collector-contrib **0.158.0** · mysql:8.4 · mariadb:11
(11.8) · arm64/darwin. The WP2 release gate: the four schema-health recipes and
the `sqlquery/mysql_limits` connection-limit gauge had been transcribed from
catalog docs but **never executed against a real server** — the same state the
MariaDB blocking recipe (B1) was in when it turned out to be entirely
non-functional.

## What each file proves

| File | Proves |
|---|---|
| `mysql-table-stats.jsonl` | `mysql_table_stats` emits on MySQL 8.4; `innodb_table_stats.n_rows` + `last_update` populate `n_live_tup` / `last_analyze` |
| `mysql-index-stats.jsonl` | `mysql_index_stats` emits; `COUNT_READ` rides `idx_scan` (800 measured reads); **contains the functional-index row that exposed B3** |
| `mariadb-table-stats.jsonl` | `mariadb_table_stats` emits on MariaDB 11; includes a `STATS_PERSISTENT=0` table whose `last_analyze` arrives as `''` and whose `n_live_tup` is the `TABLE_ROWS` fallback |
| `mariadb-index-stats.jsonl` | `mariadb_index_stats` emits with NO `idx_scan` key on any row — absent, not a fabricated zero |
| `mysql-connection-max.jsonl` | `sqlquery/mysql_limits` (metrics mode) emits gauge `mysql.connection.max` = 151 with the `mysql_instance_endpoint` attribute the read side joins on |

All five were captured through a probe collector running the **shipped
pipeline shape** (`filter/dbm` + `transform/tag_source` + `resource/ident`), so
the rows are proven to SURVIVE the filter, with the **restricted `o2_monitor`
user** — the shipped card's `SELECT, PROCESS, REPLICATION CLIENT ON *.*` grant
set, not root. Zero receiver errors on any cycle for these five receivers. The
log records are flattened `{eventName, body, attributes}` extractions; the
metric lines are the file exporter's OTLP-JSON verbatim.

The four log fixtures in
`src/core/src/traces/db_monitoring/tests_server_vantage.rs`
(`mysql_table_stats_record` …) are transcribed VERBATIM from these files.

## B3 — a MySQL functional index NULLs the entire `index_def` body

**Found live, fixed in `dbmShared.ts` + `collector/config.yaml`.** An
expression key part (`CREATE INDEX … ((LOWER(col)))`, MySQL 8.0.13+) has
`COLUMN_NAME = NULL` in `information_schema.STATISTICS`. `GROUP_CONCAT` over
that yields NULL, and `CONCAT(…, NULL, …)` nulls the **whole** `index_def` —
which is the recipe's `body_column`:

```
| index_name           | index_def |
| idx_orders_lower_ref | NULL      |     <- as shipped
```

A mixed index (`(col, (expr))`) is worse: GROUP_CONCAT skips the NULL, so the
definition silently omits the expression part and reads as a plausible,
complete, WRONG column list. The fix renders the expression instead:

```sql
GROUP_CONCAT(COALESCE(st.COLUMN_NAME, CONCAT('(', st.EXPRESSION, ')'))
             ORDER BY st.SEQ_IN_INDEX SEPARATOR ', ')
```

```
| idx_orders_lower_ref | INDEX idx_orders_lower_ref ON dbmlab.orders ((lower(`customer_ref`))) |
```

**MySQL-ONLY.** MariaDB's `STATISTICS` has no `EXPRESSION` column (verified:
`ERROR 1054 (42S22): Unknown column 'EXPRESSION'`) and no functional-index
syntax to need it — copying the COALESCE into the MariaDB twin would break it
on every server. This is why the two index recipes must NOT be re-merged.

## Everything else worked as written

* `mysql_table_stats` / `mariadb_table_stats` — correct rows on the first run,
  including the estimate/fallback chain (`COALESCE(s.n_rows, t.TABLE_ROWS, 0)`)
  and empty-string `last_analyze` for a stats-less table.
* The shared-catalog assumption for MariaDB **holds**: `mysql.innodb_table_stats`
  and `mysql.innodb_index_stats` exist and populate on MariaDB 11, unlike the
  `data_lock_waits` divergence that produced B1.
* `@@innodb_page_size` in the select list is legal under ONLY_FULL_GROUP_BY on
  both engines (it is a constant, not a grouped column).
* `SELECT @@max_connections` needs no special grant; the gauge emitted every
  interval as `asInt: 151` (the MySQL default), attribute
  `mysql_instance_endpoint: "mysql:3306"`.
* `is_unique` renders `'true'`/`'false'` as designed (`MIN(NON_UNIQUE) = 0`),
  PRIMARY KEYs included.

## Reproducing

```bash
export O2_AUTH=$(printf 'root@example.com:Complexpass#123' | base64)
docker compose up -d --wait postgres mysql mariadb
docker compose up -d collector          # runs sqlquery/mysql_schema + mariadb_schema

# the schema ships only PRIMARY keys — add a secondary + functional index and
# drive reads through them so idx_scan is non-zero:
docker exec -i dbm-sv-mysql mysql -uroot -pdbm dbmlab -e "
  CREATE INDEX idx_orders_acct_sku ON orders (account_id, sku);
  CREATE INDEX idx_orders_lower_ref ON orders ((LOWER(customer_ref)));
  SELECT COUNT(*) FROM orders FORCE INDEX (idx_orders_acct_sku) WHERE account_id = 7;
  SELECT COUNT(*) FROM orders WHERE LOWER(customer_ref) = 'cust-00001';
  ANALYZE TABLE orders;"
docker exec -i dbm-sv-mariadb mariadb -uroot -pdbm dbmlab -e "
  CREATE INDEX idx_orders_acct_sku ON orders (account_id, sku);
  CREATE TABLE session_scratch (id INT PRIMARY KEY, payload VARCHAR(255))
    ENGINE=InnoDB STATS_PERSISTENT=0;   -- the empty-last_analyze case
  INSERT INTO session_scratch VALUES (1,'a'),(2,'b'),(3,'c');
  ANALYZE TABLE orders;"
```

These captures were taken via a probe collector (the overlay precedent above)
whose receiver SQL is byte-identical to `collector/config.yaml`, running as
`o2_monitor`, with `file` exporters on its logs and metrics pipelines.

## Verified vs assumed

**Verified by running:** all four schema recipes return rows on their engines
under the restricted grant set; the rows pass the shipped `filter/dbm`; B3 and
its fix (functional-index `index_def`, before/after captured); MariaDB 11 has
no `STATISTICS.EXPRESSION` column; `STATS_PERSISTENT=0` produces `''`
`last_analyze` + `TABLE_ROWS` fallback; `mysql.connection.max` gauge with
`mysql_instance_endpoint`; `validate` passes on the full rig config.

**Assumed / not tested:** other MySQL/MariaDB versions (only 8.4 / 11.8);
`index_bytes` accuracy (`innodb_index_stats stat_name='size'` is an estimate —
values were plausible, not audited against `information_schema.INNODB_SYS_*`);
behaviour on a table with sub-part indexes (`col(10)`) or invisible indexes;
`mysql_limits` against a `max_connections` raised at runtime (`SET GLOBAL` is
picked up next interval by construction, not observed here).

---

# auto_explain — real executed plans (W-E1/T1, 2026-08-13)

Postgres 16.14, contrib collector 0.158.0, auto_explain LAB profile
(`log_format=json, log_analyze=on, log_timing=off, log_buffers=on,
log_min_duration=0`), `compute_query_id=on` + `qid=%Q` in `log_line_prefix`.

## What each file proves

- **`pg-auto-explain.log`** — verbatim Postgres log entries from the probe run
  (`app=t1probe`): the first-line shape is exactly
  `<prefix> LOG:  duration: N.NNN ms  plan:` with the pretty-printed JSON
  document on TAB-prefixed continuation lines, joined by the existing
  `multiline.line_start_pattern`. Covers: literal, `$1` extended-protocol bind,
  IN-list literals and binds, `= ANY($1)`, `= ANY('{…}'::int[])`,
  PREPARE/EXECUTE, a 20.8 KB IN-list and a 5.6 KB IN-list.
- **`pg-auto-explain-v0158.jsonl`** — 10 REAL collector-emitted records from
  the post-`filter/dbm` raw sink (`file/raw_recipes`), so their existence
  proves explain rows SURVIVE the shipped filter (the branch's silent failure
  shape is a tag left at `"other"` being dropped while the collector reports
  healthy). Each carries `o2_pg_event=explain`, `ae_duration_ms`,
  `ae_plan_json` (ONE string attr — never json_parser-expanded), and
  `pg_query_id` from `%Q`.

## The three T1 measurements (fixtures: `src/core/src/traces/db_monitoring/corpus/auto_explain_rig.json`)

1. **Wrapper hash: DIVERGES.** `plan_hash` includes tree shape, so
   auto_explain's object wrapper `{"Query Text":…,"Plan":{…}}` hashed
   `899486bea45213dd` while the receiver's `[{"Plan":{…}}]` for the same
   Seq Scan hashed `4145e48d63cf272e`. The contingency holds: rewrapping the
   `Plan` subtree as `[{"Plan":…}]` reproduces the receiver hash exactly
   (incl. a 17-node nested tree) — `canonicalize_pg_auto_explain` stores the
   rewrapped form.
2. **Fingerprint join: HOLDS** for literal / `$n`-bind / pgss / receiver
   texts (one fingerprint), and for IN-lists across style and arity (5 and
   700). **Documented divergences:** `= ANY($1)` vs IN-lists (different token
   streams before our lexer), the `::int[]` cast variant, and statements over
   `MAX_NORM_INPUT` (16 KB) — both sides truncate at different content.
3. **`%Q` queryid: WORKS.** The extended-protocol explain record's
   `pg_query_id` (`-679379679796231264`) equals the `pg_stat_statements`
   `queryid` for the same statement, measured live — the exact join key that
   survives every text-normalization concern, which is why T6 shipped rather
   than being skipped.

Two shapes worth knowing, both captured:

- Under `SET auto_explain.log_analyze = off` the document is still the real
  executed plan but carries NO `Actual *` keys and no buffer counters
  (fixture `auto_explain.analyze_off`) — absent, never zero, downstream.
- Extended-protocol executions under `%Q` add a top-level
  `"Query Parameters": "$1 = '42'"` key — REAL bind values. The rewrap drops
  every top-level key except `Plan`, so parameters do not ride into the
  stored plan document (pinned by
  `a_real_collector_emitted_explain_record_canonicalizes_end_to_end`).

## Reproducing

```sh
# compose already carries the lab profile + %Q; recreate postgres + collector
docker compose up -d postgres && docker compose restart collector
# run the probe (any psql session; app name only aids grepping)
PGAPPNAME=t1probe psql -h localhost -p 55432 -U dbm -d dbmlab -f probe.sql
# entries: the pglogs volume; survivors: captures/raw/recipe-rows.jsonl
```

## Verified vs assumed

**Verified by running:** the first-line shape and multiline join; route order
ahead of the rig's `^duration:` statement route (before the fix, plan entries
were mislabelled `statement_duration` by the unguarded parser); filter/dbm
survival; `%Q`-vs-pgss queryid equality; both wrapper hashes; every
fingerprint claim above; `log_analyze=off` document shape.

**Assumed / not tested:** other Postgres versions (only 16.14); managed
platforms (RDS/Aurora/Cloud SQL — no filesystem for filelog, same limit as
deadlock capture); `syslog` log_destination (unsupported — it splits and
re-prefixes multi-line entries); auto_explain overhead numbers (mechanism
documented in the setup card; not benchmarked here).
