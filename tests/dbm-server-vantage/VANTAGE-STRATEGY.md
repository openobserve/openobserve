# DBM Vantage Strategy — server vantage vs trace vantage

**Status:** Decided. This document records a strategy already chosen by the product owner, plus the evidence that forced each choice.
**Scope:** OpenObserve Database Monitoring (DBM) — all pages that render a number derived from either the server vantage or the trace vantage.
**Audience:** anyone adding a tile, column, chart, or API field to DBM.

## Vocabulary

| Term | Meaning |
|---|---|
| **Server vantage** | Data scraped from the database itself — `pg_stat_statements`, MySQL `performance_schema`, MSSQL DMVs — ingested through `server_vantage.rs`. |
| **Trace vantage** | Client-side spans emitted by instrumented applications, ingested through the DB-span path (`mod.rs`) and rolled up into `_o2_db_stats`. |
| **Overlap measure** | A measure both vantages produce a number for. There are exactly two: call count and database time. |
| **Enrichment** | Attaching context from one vantage onto rows from the other. Never arithmetic. |

**Core principle.** Each vantage owns the questions only it can answer. The server vantage is AUTHORITATIVE for *what the database did*. The trace vantage is AUTHORITATIVE for *who called it and what they experienced*. Overlapping measures resolve server-first. Enrichment means joining context, never merging numbers.

---

## 1. Decision summary

**D1.** Overlap measures (call count, database time) resolve **SERVER-FIRST on ALL pages**, rendered under the generic label ("Database time", "Calls"); the trace value is **DROPPED** from that tile, not demoted to a secondary line.

**D2.** The **engine qualifier is MANDATORY** wherever an overlap number renders — including list columns, which currently lack it — because on MySQL/MariaDB `exec_time_s` is **wait** time while on Postgres it is **execution** time, and a wait time under an unqualified "Database time" heading is a wrong number, not a generic one.

**D3.** Trace-only measures are **HIDDEN** (not rendered as "—") when the fingerprint/scope has no trace data, decided per-section and per-fingerprint; server-only sections are unaffected.

**D4.** When the trace vantage is absent, **the server section LEADS the page**.

**D5.** Enrichment attaches **CALLING SERVICES** (trace vantage) onto server-vantage rows via the join key — the Datadog DBM↔APM pattern: the server says what is expensive, traces say who to talk to.

**D6.** **Never** sum vantages; **never** average their latencies; **never** render an overlap value without a qualifier; **never** render absent as `0`.

---

## 2. Why server-first

The two vantages do not measure the same population, and the gap is not small.

**Live measurement** (org `default`, 7d window), fingerprint `17e5b5a191ddb2f8`:

| Vantage | Calls |
|---|---|
| Trace | 1,495,679 |
| Server | 5,581,260 |
| Ratio | **~3.7×** |

The server counts *every client*. The trace vantage counts only:

- **Instrumented** callers — anything without the SDK is invisible.
- **Finished** calls — an in-flight or abandoned call never emits.
- Spans passing the structural gates: span kind must be `CLIENT` or `PRODUCER` (`mod.rs:301-305`) and the span must carry a DB attribute (`has_db_attr`, `mod.rs:308-310`). A span that fails either gate is silently not a DB call.

Additionally, trace `calls` is a **raw span count with no head-sampling compensation anywhere in the path**. If a caller samples at 10%, its contribution to `calls` is understated 10× and nothing in the pipeline corrects it. This makes the trace call count structurally unfit to be a denominator or a fleet total.

Consequently: for "how much work did this database do", the server number is the only defensible one. The trace number answers a different question ("how much work did my instrumented services observe"), which is valuable — but it is not the same tile.

**Corroborating live shape** of the two populations (org `default`, 7d): 42 fingerprints appear in **both** vantages, 143 are **server-only**, 49 are **trace-only**. A UI that leads with the trace vantage leads with the smaller and more biased of the two sets.

---

## 3. Authority matrix

The overlap set is **exactly two measures** — call count and database time (`overlapMetrics.ts:19-21`). Everything else is exclusive to one vantage; there is nothing to reconcile.

### 3.1 Overlap (resolve server-first, D1)

| Measure | Server value | Trace value | Resolution |
|---|---|---|---|
| Calls | `calls` from `pg_stat_statements` / `events_statements_summary_by_digest` | span count | Server wins; trace value dropped from the tile |
| Database time | `exec_time_s` (**engine-dependent meaning**, see §7) | `total_time_ns` | Server wins; trace value dropped from the tile |

### 3.2 Server authoritative (exclusive)

| Measure | Why only the server can answer |
|---|---|
| Load / total time, executions | Counted by the engine over all clients |
| Rows examined / returned | Engine-internal; the client sees only what it fetched |
| Block counters (shared/local/temp hit+read) | Postgres-only engine internals; no client equivalent |
| Query plans | Produced by the planner |
| Wait analysis | Only observable inside the engine |
| Lock / blocking / deadlocks | Engine state; the client sees only elapsed time |
| Table + index health | Catalog/statistics state, unrelated to any single call |
| Active sessions | A point-in-time engine state, not a call |

### 3.3 Trace authoritative (exclusive)

| Measure | Why only traces can answer |
|---|---|
| Caller / service attribution | The server has no reliable notion of which service issued a statement (see §3.4) |
| Latency distribution (p50/p95/p99) | See the note below — for us this is a collection choice |
| Error context as the caller saw it | Includes **timeouts and pool exhaustion the server never sees** — a call that never reached the database leaves no server row at all |
| Per-request drill-down | Requires the request identity, which the server does not carry |
| End-to-end context | The database call in the context of the surrounding request |

### 3.4 NOTE — percentiles are trace-only *for us*, by collection choice, not physics

A common assumption is that server-side percentiles are impossible. They are not:

- MySQL's `events_statements_summary_by_digest` **does** expose `QUANTILE_95` / `QUANTILE_99` / `QUANTILE_999`.
- Postgres `pg_stat_statements` **does** expose `mean_exec_time` and `stddev_exec_time`.

~~**But our receivers ship neither.** The MySQL wire is exactly 8 attributes; the Postgres wire is `calls` / `rows` / `total_exec_time` / `total_plan_time` / `blks` / `queryid` / `rolname` / `query_plan`. Neither carries a quantile column.~~

**CORRECTED (audit E).** The conclusion survives but two premises were wrong, and the difference is material because it changes a capability ceiling into an un-done piece of work.

**(i) MySQL "exactly 8 attributes" — CONFIRMED.** Verified against the capture fixture `tests/dbm-server-vantage/captures/mysql-top-query.jsonl` at receiver v0.158.0: `db.query.text`, `db.system.name`, `mysql.events_statements_summary_by_digest.count_star`, `.digest`, `.sum_timer_wait`, `mysql.query_plan`, `mysql.query_plan.hash`, `o2_vantage`. `sum_timer_wait` is a **sum**, not a quantile. No `AVG_TIMER_WAIT`.

**(ii) The Postgres field list was INCOMPLETE — 14 attributes, not 8.** The real wire (`tests/dbm-server-vantage/captures/pg-top-query.jsonl`) is `postgresql.queryid` / `.calls` / `.rows` / `.total_exec_time` / `.total_plan_time` / `.rolname` / `.query_plan` / `.shared_blks_hit` / `.shared_blks_read` / `.shared_blks_dirtied` / `.shared_blks_written` / `.temp_blks_read` / `.temp_blks_written`, plus `db.namespace` / `db.query.text` / `db.system.name`. "`blks`" collapsed six distinct columns into one token. The substantive point holds: every time-valued attribute is a **total**. Side finding — `postgresql.total_plan_time` is on the wire but **never read**; `canonicalize_top_query` (`server_vantage.rs:2091`) does not reference it, so it is silently dropped.

**(iii) "Our receivers ship neither" is FALSE for mean/stddev/max.** Our own rig receiver ships all three and they are **stored in the live `dbm_server` schema today**: `mean_exec_time_ms`, `stddev_exec_time_ms`, `max_exec_time_ms`. Source is `tests/dbm-server-vantage/collector/config.yaml` — a custom `sqlquery` recipe whose SQL we fully control: `sqlquery/pg_statements` selects `mean_exec_time` / `max_exec_time` / `stddev_exec_time` (lines 253-255) and promotes all three to `attribute_columns` (284-286); `sqlquery/mysql_digest` selects `AVG_TIMER_WAIT AS mean_exec_time_ms` and `MAX_TIMER_WAIT AS max_exec_time_ms` (479-480).

**(iv) The schema does not block this — ingest is ADDITIVE, not closed.** `apply_to_record` (`server_vantage.rs:1655`) strips only exact `ALL_DBM_FIELDS` members, then merges canonicalized `o2_dbm_*` keys **on top of** the surviving record. Unrecognized attributes are never dropped; they persist as ordinary log fields. That is exactly why `mean_exec_time_ms` is queryable today while having no `o2_dbm_*` counterpart. `ALL_DBM_FIELDS` itself (`server_vantage.rs:117`, `[&str; 83]`, length-pinned by a test) contains **no** mean/stddev/min/max/quantile member — every time-valued member is a total or a single-sample duration.

**The accurate three-part statement:**

1. **True percentiles (p95/p99/p999) are genuinely out of reach from these server catalogs on the shipped path** — the upstream `postgresql/dbm_events` and `mysql/dbm_events` receivers ship no quantile, and Postgres itself does not expose one (mean/stddev/min/max do not yield p95). This is a real external limit.
2. **Mean / stddev / max ARE obtainable and already flowing** through a custom `sqlquery` recipe we author. Shipping them is a recipe edit + `ALL_DBM_FIELDS` entries + a canonicalizer arm — **not** a receiver-capability blocker.
3. **Storable-but-not-canonicalized ≠ cannot.**

**How the error was made:** the shipped recipes in `dbmShared.ts` were grepped for quantile columns (correctly finding none), and that absence was generalised to "our receivers ship neither" — without checking the rig's own `sqlquery` config or the live stream schema, where mean/stddev/max are present. Grepping the shipped path does not establish what the system stores.

So the strategy statement "percentiles come from traces" is accurate *today*. If a receiver ever ships quantiles — or if we canonicalize the mean/stddev/max already on the wire — this row of the matrix must be revisited.

Related: `mean_exec_time_s` is a **read-time quotient**, `exec_time_s / calls` (`api.rs:5280-5283`). The code already refuses to call it p95, and the UI must too (§8).

---

## 4. The join key

**Verdict: CONDITIONAL YES.** The two vantages *can* be joined, on a composite key, subject to a checklist of silent failure modes.

### 4.1 Why the fingerprints converge

Both vantages call the **same** `fingerprint_statement` function (`server_vantage.rs:943-961`), which routes through the same `normalizer` to the same `fingerprint_hex` (`normalizer.rs:126-131` — gxhash64, seed 0, 16 hex characters). This is not two implementations that happen to agree: `server_vantage.rs:71` imports the *ingest path's own* `route_dialect` / `normalizer`. There is one normalizer.

`FP_VERSION = 2` (`mod.rs:94`) exists **specifically** to fix a measured cross-vantage join failure. From the constraint comment at `mod.rs:83-93`: the server never sees driver text — `pg_stat_statements` and MySQL `performance_schema` hand us statements that *their own* jumbler has already re-spaced, so a whitespace-sensitive fingerprint put the same query in two buckets depending on which vantage saw it. v2 is the whitespace-insensitive form that makes the join work at all.

Regression coverage lives in `tests_equivalence.rs:190-407`, culminating in `server_vantage_entry_point_converges_with_client_span` (`tests_equivalence.rs:365-385`).

**Live convergence example** (org `default`, 7d), fingerprint `fa61ae4b0c9ff1a2`:

```
SERVER: SELECT status, count ( * ) FROM demo_orders WHERE status = ? GROUP BY status
TRACE:  SELECT status, count(*)   FROM demo_orders WHERE status = ? GROUP BY status
```

Different text, same fingerprint. That is v2 doing its job.

### 4.2 The key is (fingerprint, engine, database) — not fingerprint alone

The fingerprint hashes **statement text only**. Engine, database, and service are not inputs (`normalizer.rs:888`, `:967`, `:1028`, `:1342`). Identical SQL running on two engines therefore collides by design.

**Live proof** (org `default`, 7d): **9 fingerprints appear under two engines at once.** Example — fingerprint `69219a9c7fc5039d`:

| Engine | Calls | `exec_time_kind` |
|---|---|---|
| postgresql | 465,105 | execution |
| mysql | 195,751 | **wait** |

Joining on fingerprint alone here fuses 660,856 calls of two different engines and adds an execution time to a wait time. Both halves of that result are wrong.

The API already enforces the composite key: it returns `400 "engine is required"`, then `400 "database is required"`. One exception — **`database` must be DROPPED for mysql/mariadb** (`api.rs:5373-5394`), because those records carry none (§7).

### 4.3 Operational checklist — six ways the join breaks SILENTLY

Every one of these produces no error, no log, no red pipeline. They produce a join that quietly returns fewer rows, or none.

| # | Hazard | Mechanism | Where |
|---|---|---|---|
| **H1** | `ZO_DB_MONITORING_NORMALIZE_IDENTIFIERS=false` | The client honours the knob (`mod.rs:369`), but `fingerprint_statement` calls `normalize()` with `fold_identifiers` **hardcoded true** (`normalizer.rs:148-150`). Every digit-suffixed identifier (`orders_2024`, `shard_7`) then fingerprints differently on the two vantages. No error. | `mod.rs:369`, `normalizer.rs:148-150` |
| **H2** | Asymmetric dialect fallback | The server falls back to `unwrap_or(Postgresql)` (`server_vantage.rs:950`); the client instead falls back to an `op+coll:` hash. Same statement, two different fingerprint families. | `server_vantage.rs:950` |
| **H3** | Truncation asymmetry | Client caps statements at 16 KB (`mod.rs:99-102`); `pg_stat_statements` truncates at `track_activity_query_size`, default **1024 bytes**. Any statement between the two limits fingerprints on different text. Both truncations are silent. | `mod.rs:99-102` |
| **H4** | Degraded client text | With `DisableQuery` / `capture_statement=False`, the client emits `op+coll:` or `summary:` hashes which **by design never collide** with real statement fingerprints. The join is not broken so much as intentionally impossible. | `mod.rs:403-417` |
| **H5** | FP_VERSION is not stamped where it matters | `FP_VERSION` is stored on `_o2_db_stats` (`rollup.rs:430`) but on **neither raw spans nor server rows**. During a rolling v1→v2 upgrade, both fingerprint generations coexist **indistinguishably** — you cannot filter or migrate what you cannot identify. Contrast `o2_dbm_plan_hash_version`, which *is* a column (`server_vantage.rs:1880-1885`) and is therefore recoverable. | `rollup.rs:430`, `server_vantage.rs:1880-1885` |
| **H6** | gxhash cargo-feature skew | If the gxhash feature is not uniformly enabled across the fleet, the hash falls back to `DefaultHasher` (`gxhash.rs:50-56`). The same statement then fingerprints differently per binary build, splitting fingerprints fleet-wide with no signal. | `gxhash.rs:50-56` |

**Rule:** any feature that depends on the join must degrade gracefully to server-only when the join returns nothing. A zero-row join is indistinguishable from "this query genuinely has no traced callers", and the UI must not claim the latter.

---

## 5. Enrichment model

**What enrichment is:** taking a row the server vantage produced, and attaching to it the *calling services* the trace vantage observed for the same `(fingerprint, engine, database)`.

**What enrichment is not:** arithmetic. No sum, no average, no ratio that crosses the vantage boundary.

| | |
|---|---|
| **Base rows** | Server vantage — the authoritative list of what the database actually spent time on, ranked by server cost |
| **Join key** | `(fingerprint, engine, database)`; `database` dropped for mysql/mariadb (`api.rs:5373-5394`) |
| **What is attached** | Calling service names, and per-service trace-side context (their observed latency distribution, their errors) |
| **What is never attached** | A trace call count or trace database time **into** a server measure — those are D1 overlap measures and the server value already occupies the tile |

**The pattern, stated as the product owner stated it:** *the server says what is expensive, traces say who to talk to.* This is exactly the Datadog DBM↔APM correlation model (§10 vendor evidence): the expensive-query list is server-ranked, and APM supplies the navigational handle to the owning service.

**Consequence for the residual.** Because the trace population is a strict subset (§2), the calling-services list attached to a server row is *always potentially incomplete*. It must be presented as "services we saw calling this", never as a complete or exhaustive attribution, and never normalized to 100% (§9).

---

## 6. Never-do list — the twelve traps

Each trap is stated with the concrete wrong number it produces.

| # | Trap | The wrong number | Citation |
|---|---|---|---|
| **T1** | Summing the two vantages | Every traced call counted twice. On fp `17e5b5a191ddb2f8`: 5,581,260 + 1,495,679 = 7,076,939 calls that never happened. | §2 live |
| **T2** | MySQL denominator swap | Dividing a call/time value by a "database total" when the MySQL value is **instance-wide**. Any "% of this database" so computed is wrong by the ratio of instance traffic to database traffic. | `api.rs:5237-5255` |
| **T3** | MySQL wait-vs-execution swap | Presenting MySQL `exec_time_s` (**wait** time) as execution time. The user reads a lock-contention number as CPU/IO cost and tunes the wrong thing. | §7 |
| **T4** | Summing `o2_dbm_calls` across intervals | `metrics_are_delta` is **unconditionally true**, and the **first emission carries the entire `pg_stat_statements` backlog** — potentially days of accumulated calls attributed to one interval. Summing intervals therefore double-counts history into a window. | `server_vantage.rs:1904-1914` |
| **T5** | Treating `traces` as additive | `traces` is a **non-additive** measure (distinct trace count); summing across buckets over-counts every trace that spans buckets. | `rollup.rs:290-293` |
| **T6** | Merging percentiles | There is **no stored sketch**. p95 of two buckets is not derivable from the two p95s. `_other` rows carry no percentiles at all, so any merged percentile is a fabrication. | §6 note, `rollup.rs` |
| **T7** | Equating `total_time_ns` with `exec_time_s` | They are not the same metric. The client's `total_time_ns` includes **network time and connection-pool wait**; the server's `exec_time_s` does not. Comparing them as a "discrepancy" reports infrastructure latency as a database anomaly. | `server_vantage.rs:2513-2521` |
| **T8** | `_other` bucket contamination | Server-side `top_n` is ranked by **CALLS, not cost**. A rare-but-catastrophic query falls into `_other` and its cost is **unrecoverable downstream** — no amount of client-side work reconstructs it. Any "total" including `_other` is a floor, not a total. | `server_vantage.rs:1973-1984` |
| **T9** | Instance-scoped numbers under a database heading | A MySQL instance-wide value rendered inside a per-database page reads as that database's load; it is the whole server's. | `api.rs:5237-5255` |
| **T10** | Reading a generic plan as all-clear | The captured Postgres plan can be a **generic, NULL-bound** plan. Reading "no problem" from a plan that was never bound to the real parameters is the classic parameter-sniffing miss. | `server_vantage.rs:1852-1871` |
| **T11** | Reading cumulative table stats as windowed | Table-stat counters are **cumulative since stats reset**. Charting them as a windowed rate shows a permanently rising line and makes every table look like it is degrading. | `server_vantage.rs:2780-2798` |
| **T12** | Fingerprint-only joins | Fuses engines. Live: fp `69219a9c7fc5039d` merges 465,105 postgres executions with 195,751 mysql **waits** into one meaningless 660,856 / summed-time row. | §4.2 live |

**Pooler refusal (not a trap — a designed refusal, honour it).** When more than one candidate instance matches, the API **withholds** the numbers rather than guessing: `matched:false`, `unmatched_reason:"pooler"` (`api.rs:5259-5268`). The UI must render this as *withheld and why*, never as zero and never as an empty state that implies no activity.

---

## 7. Engine divergence

There are roughly **25 engine-conditional semantics** in the server vantage. The load-bearing ones:

| Concern | Postgres | MySQL | MariaDB | MSSQL |
|---|---|---|---|---|
| `exec_time_kind` | **execution** | **wait** | **wait** | — |
| `database` on top_query | present | **ABSENT** | **ABSENT** | — |
| `rows` | present | absent | absent | — |
| All 6 block counters | present | **PG-only** | PG-only | PG-only |
| Plan capture | generic plan + `auto_explain` | requires **≥ 8.0.22** | **measured 204/204 EMPTY** | — |
| Statement-id attribute | `postgresql_queryid` | `postgresql_query_id` (spelling split) | — | — |
| Blocking source | `pg_locks` | `data_lock_waits` (8.0+) | **`INNODB_LOCK_WAITS`** | DMVs |
| Index `idx_scan` | present | present | **OMITTED** | — |
| Deadlocks permission | — | — | — | needs **BOTH** `VIEW SERVER STATE` **and** `VIEW SERVER PERFORMANCE STATE` |

Notes that must not be "cleaned up" by a later refactor:

- **The statement-id spelling split (`postgresql_queryid` vs `postgresql_query_id`) is load-bearing, not a typo.** It reflects what the two receivers actually emit on the wire. Normalizing the spelling breaks ingestion.
- **MariaDB blocking uses `INNODB_LOCK_WAITS`** because MariaDB never adopted MySQL 8.0's `data_lock_waits`. Query the MySQL table on MariaDB and it **fails silently with a green pipeline** — the collector reports healthy and the blocking page is simply always empty.
- **MariaDB index `idx_scan` is OMITTED, deliberately.** `performance_schema` is OFF by default on MariaDB, so the value is unavailable; emitting a fabricated `0` would render as the "never scanned — drop this index" finding, which is a destructive false positive. Absent is correct; zero is a lie.
- **MariaDB plan capture measured 204/204 EMPTY.** Not "sometimes flaky" — zero successes in the measured run. Any UI promising plans must not promise them on MariaDB.
- **MSSQL Deadlocks with only one of the two permissions is "empty forever, which reads as deadlocks never happen."** A permission gap must surface as a permission gap, never as a clean result.

**The rule:** *any strategy that treats server metrics as engine-uniform is wrong.* Engine is a required input to every read path that renders an overlap measure, which is why it is part of the join key (§4.2) and why the qualifier is mandatory (D2).

---

## 8. UI labelling rules

| Rule | Statement | Rationale |
|---|---|---|
| **L1 — Qualifier mandatory** | Every rendered overlap value carries its engine qualifier — in tiles **and in list columns**. | D2. On MySQL, "Database time" without a qualifier is a wait time presented as execution time (T3). |
| **L2 — Absent ≠ 0** | Never render missing data as `0`. Hide the measure (D3), or state it as unavailable with the reason. | MariaDB `idx_scan` is the canonical case: a fabricated `0` reads as the never-scanned finding (§7). |
| **L3 — Mean ≠ percentile** | `mean_exec_time_s` is labelled as a **mean**, never as p95/p99. | It is the quotient `exec_time_s / calls` (`api.rs:5280-5283`); the code already refuses to call it a percentile. |
| **L4 — Samples are samples** | Sampled data is labelled as sampled and never presented as a population total or a denominator. | Trace `calls` has **no head-sampling compensation** (§2). |
| **L5 — Attribution captions** | Any value whose `attribution` is `"instance"` renders with an instance-wide caption, and is never placed inside a per-database percentage. | `api.rs:5237-5255`; T2/T9. |
| **L6 — Withheld is not zero** | `matched:false` / `unmatched_reason:"pooler"` renders as *withheld, and why*. | `api.rs:5259-5268`. |
| **L7 — Totals that include `_other` are floors** | Any aggregate over a `top_n`-truncated set is labelled as a lower bound. | `top_n` ranks by calls, not cost (`server_vantage.rs:1973-1984`); T8. |

---

## 9. Degradation

| Situation | Behaviour |
|---|---|
| **Zero trace data** (no instrumented callers, or the join broke per §4.3) | Server section **LEADS** the page (D4). All trace-only measures **HIDDEN**, per-section and per-fingerprint (D3). No "—" placeholders — a dash invites the reader to conclude the value is zero. |
| **Zero server data** (no DB scrape configured) | Trace sections render normally, explicitly labelled as the **client-observed** view; no server-authoritative claims (load ranking, plans, waits, locks, table health) are made. Overlap tiles show the trace value **with an explicit trace-vantage label** — this is the one case where a trace overlap number is rendered, and it must say so. |
| **Partial instrumentation** (the normal case) | Server totals lead. Calling-services enrichment renders with an **untraced residual** — an explicit "unattributed" remainder — **never** normalizing the attributed traffic to 100%. |

**On the residual.** Given the ~3.7× live population gap (§2), normalizing attributed callers to 100% would tell a user that a service responsible for 27% of calls is responsible for 100% of them. The residual is the honest representation and it is also the actionable one: a large residual is itself the finding ("most of this load comes from something you are not tracing").

---

## 10. Vendor evidence

No vendor merges vantages. Every one of them either navigates between vantages or slices one by the other's tags.

| Vendor | Model | Source |
|---|---|---|
| **Datadog DBM↔APM** | Every cross-vantage capability is described in **navigational verbs** — view, break down, filter, navigate — and **never** arithmetic. Ranking is by **total time from the server vantage**; the latency figure shown is **"Average latency"**, never a server percentile. | https://docs.datadoghq.com/database_monitoring/ , https://docs.datadoghq.com/database_monitoring/connect_dbm_and_apm/ |
| **Google Cloud SQL Insights** | Client tags are **ORTHOGONAL axes** to slice server-measured load by. Nothing is summed, so double-counting is **structurally impossible** in their model. | https://cloud.google.com/sql/docs/postgres/using-query-insights |
| **AWS Performance Insights** | Organizes everything on **DB load in Average Active Sessions** (a server-vantage measure). Notably documents that even its **own two server-side methods disagree slightly** — *"because the inputs to the calculations are different data sources"*. If two server-side methods can disagree, cross-vantage arithmetic is indefensible. | https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html |
| **sqlcommenter** | Tags **do NOT survive into `pg_stat_statements`**: Postgres computes `queryid` from the **parsed tree** (comments are not in the tree), and the stored query text is **frozen at first sight**. pgsql-hackers reproduction: `-- test1` and `-- test2` yield **identical query ids**, and the text you read back is whichever arrived first. Reading trace context out of `pg_stat_statements` is therefore **ACTIVELY MISLEADING** — you get a real tag attached to the wrong calls. sqlcommenter **is** readable pre-parse: `pg_stat_activity`, the slow log, and `pg_stat_monitor`. | https://google.github.io/sqlcommenter/ , https://www.postgresql.org/message-id/flat/CAOBaU_ZQOh8bGxpJZK_JmTVeCLcJEB_x8b-ADvhZLGnzCe3nGA%40mail.gmail.com |

**On "Signals".** "Signals" is **not** a DB-observability vendor. The closest real referents are OpenTelemetry's **"signals"** (traces / metrics / logs) and **AWS CloudWatch Application Signals**. Neither is a DBM product, and neither should be cited as prior art for this strategy.

---

## 11. Current state and the primary defect

`overlapMetrics.ts` implements server-first resolution, but it landed on **QueryDetailPage ONLY**.

The strings **"Database time"** and **"Calls"** are the *same user-facing strings* on **Queries**, **Databases**, and **Samples** — where they are still **trace-derived**, and where the list columns carry **no vantage sub-label at all**.

**Wider than first recorded (F4, F5).** The unqualified-overlap problem is not confined to those three pages' tables. The shared tab-badge strip (`DbmPageChrome` → `DbmSectionTabs`) renders a **call count** on **every DBM page**, including the four documented as server-only, with no qualifier and with silently swapping provenance. Any fix scoped to page templates alone will miss it — the defect lives in shared chrome.

**The observable defect:** on a MySQL fleet, the list shows client **round-trip** time and the detail page shows server **wait** time, under the identical heading "Database time", with nothing on screen distinguishing them. A user comparing a list row to its own detail page sees two different numbers for what the product told them is one measure.

This is the primary defect the rollout must fix.

---

## 12. Rollout plan

### Per page

| Page | Change required |
|---|---|
| **Queries** | Switch overlap tiles/columns to **server-first** (D1); add **engine qualifier to list columns** (D2); hide trace-only measures per-fingerprint when absent (D3). |
| **Databases** | **Done.** Columns are labelled `client` — this page's measures are trace-derived and there is deliberately no server figure to prefer (see F1, which was withdrawn). Percentiles and failure rate hide when the scope has no trace vantage (D3). |
| **Samples** | ~~**No overlap measures exist**~~ — **CORRECTED, see F4.** The two *tables* are per-execution durations and `/server_samples` does carry no `calls`/`exec_time_s` — true at the endpoint layer only. But the page renders the **"Slowest calls" tab badge**, which IS a call count, IS supplied by both vantages, and carries **no qualifier**. Resolve it under D1/D2 like any other overlap value, and label the tables as samples (L4). |
| **QueryDetail** | **Already done** — `overlapMetrics.ts` server-first is live here. Verify qualifier presence against D2. |
| **Activity** | Server vantage for its own table, chart and empty-state *condition* — but **not "pure", see F5**: it renders the shared trace-derived tab badges and a trace-derived not-collecting checklist row. |
| **Deadlocks** | As Activity (F5), **plus** a trace-derived `databaseCount` in the *healthy* empty-state copy (`DeadlocksPage.vue:791,795`) — i.e. on the normal no-deadlocks path. Also see MSSQL permission note, §7. |
| **Blocked** | As Activity (F5). |
| **Table Health** | Server vantage for its own reads; carries the shared trace-derived tab badges only (F5). Also see MariaDB `idx_scan` omission, §7. |

### Open follow-ups

| # | Follow-up | Impact |
|---|---|---|
| ~~**F1**~~ | **WITHDRAWN — the claim was false.** F1 asserted that `/databases` has no server fallback and that a zero-trace org therefore sees only the setup checklist. It does not. The server path is on the **frontend**, not in `read_databases_body`: `DatabasesPage` unions **server-known instances** into the fleet list from `counts.sessions` + `counts.blockingSamples` (the snapshot the shell already fetched for the tab badges) via `unionFleetRows(..., serverInstances)`, and layers `collectInstanceMetrics` on top. The page's own comment states the intent: *"this is what keeps the overview honest for the user who wired up collector recipes but has no APM: their fleet is one no application ever queried, and without this source the page would be empty while working server-vantage data sits one tab away."* Verified live: `dbm_notraces` exposes mysql, postgres and mssql instances to that union. **How the error was made, so it is not repeated:** the handler was grepped for `dbm_server`/`exec_time_s`, found nothing, and the absence was generalised to the page — while `hits=0` on the API was read as "the page is empty", when `hits` is only the client half of a union. Grepping one layer does not establish a feature's absence. | None — page already handles the zero-trace case |
| ~~**F2**~~ | **WITHDRAWN AS STATED — it is a measurement artifact, not bad data.** F2 asserted a 36.7M-row `dbm_server` bucket with null `o2_dbm_engine` and null `o2_dbm_kind` blocking D2. Re-verified live (org `default`, 7d): the bucket is real (36,856,213 rows) but it is **not server-vantage metric data at all** — it is **raw database log lines** shipped by a filelog receiver into the same stream. Composition: `postgresql.log` 36,105,078 · unnamed 683,202 · MariaDB `error.log` 59,937 · `postgresql.log` deadlock events 7,995. Sampled rows carry `body`, `log_file_name`, `pg_severity`/`maria_severity`, `o2_vantage:"server"` — and **zero** `o2_dbm_*` fields (`SELECT count(*) WHERE o2_dbm_engine IS NULL AND (o2_dbm_calls IS NOT NULL OR o2_dbm_fingerprint IS NOT NULL)` returns **0**). These rows are correctly null: they were never canonicalized because they are not metric records. Every DBM read path projects `ALL_DBM_FIELDS` and gates on `present_dbm_columns` (`api.rs:3049-3059`), and the event endpoints filter `o2_dbm_kind = '<kind>'` — so **no page ever reads them** and **no join key is ever formed from them**. D2 is not blocked. **How the error was made:** a `GROUP BY o2_dbm_engine, o2_dbm_kind` over the whole stream was read as "36.7M malformed DBM rows", when the stream also carries non-DBM log traffic that is *supposed* to have null DBM columns. Counting a bucket is not the same as characterising it — one `SELECT *` on the bucket would have shown `body` and `log_file_name` immediately. | None — D2 unblocked |
| **F2a** | The one **real** consequence of those untagged rows, and it is by design: `build_probe_sql` (`api.rs:3783`) deliberately applies **no kind predicate**, and `probe_collection` (`api.rs:3873`) counts every kind-less row as a `non_event_record` — the "collector is alive, this database simply has not deadlocked" signal. With ~36.8M kind-less log rows in the stream, the probe's `PROBE_SCAN_LIMIT` (2000) window can be **saturated entirely by log lines**, so `kind_sample_times` stays empty and `sample_interval_seconds` returns null. The lock empty-states then lose their sampling disclosure. Same failure shape the activity code already worked around with `SELECT DISTINCT` (`api.rs:3063-3074`). | Degrades the lock empty-state disclosure; does not produce a wrong number |
| **F4** | **SamplesPage has an unqualified overlap value** (audit A). The "Slowest calls" tab badge is a **call count** — one of the exactly two overlap measures — rendered with no source and no qualifier, under a label ("Every finished call in this window", `DbmSectionTabs.vue:91-94`) that reads as population truth. Its provenance silently swaps: client via `/badges → databases[].calls` (`useDbmTabCounts.ts:271-276`, live sum 141,984) or server via `server_samples.hits.length` (`useDbmTabCounts.ts:315`), with a third override in the page itself (`SamplesPage.vue:381-391`). One badge, one label, three provenances. `DatabasesPage.vue:190-203` renders the **identical field** through `DbmOverlapValue` with `CLIENT_OBSERVED`, commenting *"a call count exists in BOTH vantages: the cell refuses to print a figure it cannot qualify"* — so the same number is qualified on one page and unqualified on another. The second overlap measure (database time) rides in the same `/badges` rows as `total_time_ns` but is not rendered. **How the error was made:** `/server_samples` was grepped for `calls`/`exec_time_s`, correctly found none, and endpoint-level absence was generalised to the page. The overlap enters at the *composable/header* layer, three files from the endpoint, invisible to any endpoint-shaped grep. | Violates D1 + D2 on a shipped page |
| **F5** | **The four "pure server vantage" pages are not pure** (audit B). All four — Activity, Deadlocks, Blocked, TableHealth — render the shared seven-tab badge strip, and two of its badges come from the `_o2_db_stats` **trace rollup**: `queryCount` ← `badges.queries` ← `read_queries_body` (`api.rs:2023`) → `build_stats_sql` over `_o2_db_stats`; `sampleCallsCount` ← `badges.databases` ← `read_databases_body` (`api.rs:1572`). Both are `DbmVantage::Client` (`api.rs:141-147`); `DbmSectionTabs.vue` applies no qualifier to either. Additionally, Activity / Deadlocks / Blocked feed trace-derived `queryCount`+`databaseCount` (`useDbmListPage.ts:135-136`) into `notCollecting.ts:56-66`, where they decide a **rendered pass/fail check row** and its detail text; Deadlocks also puts `databaseCount` in the *healthy* empty-state copy (`:791,:795`). What IS clean: none of the four imports a trace composable or overlap util; each makes exactly one service call, all server-vantage (`getActivity`/`getDeadlocks`/`getBlocking`/`getTableHealth` → `dbm_server`); the not-collecting *condition* itself is server-sourced. **How the error was made:** "pure server vantage" was confirmed by reading the four page templates only. The contamination arrives via a shared chrome component (`DbmPageChrome` → `DbmSectionTabs`) and a shared composable — neither visible in the pages' own markup. | Two of seven tab badges unqualified on pages documented as server-only |
| **F6** | **Timer inventory correction** (audit C). "No polling anywhere" is **TRUE and looks deliberate** — zero `setInterval`, zero self-rescheduling `setTimeout`, zero rAF loops, zero `visibilitychange`/`focus` listeners, no shared auto-refresh, no store-subscription fetch, and `useDbmTabCounts.ts:70` explicitly documents "There is no TTL". `DbmShell.vue:184` even keys its watcher off `range` rather than `window` with a comment that keying on `window` "would fire this watcher forever" — an anti-polling guard. But "**the only timer is a 2400ms reveal highlight**" is **FALSE**: there are three one-shot timers — the 2400ms reveal (`QueriesPage.vue:1464`), a 2000ms copied-state reset (`DbmTerminateSql.vue:97`, **no unmount cleanup**), and a **400ms search debounce** (`OInput.vue:179` via `DbmTableToolbar.vue:34`) that **gates refetches on eight DBM tables**. The third sits directly in the fetch path — still user-driven, not polling, but DBM's data fetching is not timer-free. | Minor: one uncleaned timer; claim wording overstated |
| **F3** | **Stream stats report `doc_num=0` despite millions of rows.** Any UI or capacity logic reading `doc_num` as a row count is reading zero. Not caused by this strategy, but it will be blamed on it the first time a tile is empty. | Diagnostic noise; must be resolved before "no data" states are trusted |
| **F7** | **VERIFIED TRUE — no action.** `/query/insights` merged the Logs-side pair, and the two superseded routes remain registered **and functionally correct**. All three are registered (`router/mod.rs:810-812`). Verified live end-to-end (org `default`, fp `17e5b5a191ddb2f8`, engine `postgresql`, db `dbmlab`, 7d): all return HTTP 200, and a field-by-field flatten shows the standalone payloads are **structurally identical** to the corresponding `insights` sections — zero key differences in either direction. The only value deltas are last-ulp float noise from non-deterministic aggregation order (`exec_time_s` 130.92505272800506 vs …508; `mean_exec_time_s` 2.3457974136307046e-05 vs …705e-05; `avg_duration_ms` differing in the 17th significant digit). Registration was checked *and* payloads were compared, per the method this audit exists to enforce. | None |

---

## 12a. Audit log — negative claims tested

Every assertion in this document of the form "X has no Y" / "X cannot Z" / "there is no …" that is testable, and its result. Method rule applied throughout: **an absence claim is only true if every layer that could supply the thing has been checked** — Rust handler → response envelope → TS service types → composable/util → page template → what actually renders. A verdict from a single grep is not a verdict.

| Claim | Verdict | Evidence |
|---|---|---|
| §3.1 "The overlap set is **exactly two** measures" | **TRUE** | `overlapMetrics.ts` header states database time + call count only; no third measure resolved anywhere in the module. |
| §3.4 "Our receivers ship neither quantiles nor mean/stddev" | **PARTLY-TRUE → corrected in §3.4** | Quantiles: true. Mean/stddev/max: **false** — shipped by our `sqlquery` rig recipe and stored live. |
| §6 T4 "`metrics_are_delta` is unconditionally true" | **TRUE** | `server_vantage.rs` doc comment: *"the receiver ships no flag and no reset counter — so the marker is UNCONDITIONAL."* |
| §6 T5 "`traces` is non-additive" | **TRUE** | `ADDITIVE_METRICS` is `[&str; 7]`; the comment names `traces` as NOT additive, derived value an upper bound. |
| §6 T6 "There is **no stored sketch**; `_other` carries no percentiles" | **TRUE** | Percentiles are computed at rollup time via `approx_median` / `approx_percentile_cont` (`rollup.rs:863-865`) and stored as **scalars** — grep for tdigest/hdrhistogram/ddsketch across the DBM tree returns only unrelated `*_digest` MySQL column names. `rollup.rs:292` confirms `_other` omits percentiles/max entirely. Merged percentiles are therefore genuinely underivable. |
| §6 T8 "`top_n` ranked by CALLS, not cost; unrecoverable downstream" | **TRUE** | `server_vantage.rs` KIND_TOP_QUERY comment: *"The receiver's `top_query` SQL orders by `calls DESC` … No read-side re-ranking can recover a row that was never sent."* |
| §6 T2/T9 "MySQL values are instance-wide" | **TRUE** | `api.rs:5243-5245` — instance is SELECTed and GROUPed but *deliberately never constrained* ("or every match behind a pooler is lost"). |
| §11 "Overlap strings are unqualified on Queries / Databases / Samples" | **TRUE, and UNDERSTATED** | The same defect also reaches all four "server-only" pages via shared chrome — see F4/F5. |
| §12 "Samples has no overlap measures" | **FALSE** | See F4. |
| §12 "Activity/Deadlocks/Blocked/TableHealth are pure server vantage" | **FALSE** | See F5. |
| F2 "36.7M rows of null-engine null-kind DBM data" | **FALSE (artifact)** | See F2 — the rows are raw DB log lines, correctly null, never read. |
| Session claim: "no polling anywhere; only timer is 2400ms reveal" | **PARTLY-TRUE** | See F6 — no polling confirmed; three timers, not one. |
| Session claim: "`/query/insights` merged the pair; superseded routes still work" | **TRUE** | See F7 — registration *and* payload equivalence both verified live. |

**Not verified.** §4.3's six silent join-failure hazards (H1–H6) are code-path reasoning about *misconfigured* deployments; H1/H2/H6 could not be exercised on the live instance because reproducing them requires re-ingesting under a changed env knob or a differently-compiled binary, which is out of scope for a read-only audit. Their code citations were spot-checked and hold; their *runtime* consequences remain untested. Likewise §7's "MariaDB plan capture measured 204/204 EMPTY" is a prior measurement not re-run here, and §10's vendor claims are documentation citations, not testable against this codebase.

---

## 13. Open questions and out of scope

**Open questions**

1. **If a receiver ships quantiles**, does §3.3's "percentiles are trace-only" row flip to server-authoritative, or do both render side by side as distinct measures (server = engine-observed, trace = caller-observed)? *(Inference: side by side is the consistent answer — they measure different populations, so they are not an overlap pair. Not decided.)*
2. **H5 remediation** — should `FP_VERSION` become a stamped column on raw spans and server rows, matching the `o2_dbm_plan_hash_version` precedent (`server_vantage.rs:1880-1885`)? Without it, no rolling upgrade is auditable.
3. **H1** — should `ZO_DB_MONITORING_NORMALIZE_IDENTIFIERS=false` be rejected outright, given `fingerprint_statement` hardcodes `fold_identifiers=true` (`normalizer.rs:148-150`) and the knob therefore only ever breaks the join? *(Inference: a startup warning is the minimum; the knob currently has no correct setting other than its default.)*
4. **Enrichment cardinality** — how many calling services do we attach per server row before the column becomes unreadable, and what is the overflow representation?
5. **Residual presentation** — how is the untraced residual (§9) visually distinguished from a service literally named "unknown"?

**Explicitly out of scope for this document**

- Which server-side metrics we *should* start collecting (the receiver contract is treated as fixed input; see §3.4).
- Sampling-rate reconstruction for the trace vantage. There is no compensation in the path today and adding one is a separate design.
- `_other` bucket redesign (ranking by cost rather than calls, `server_vantage.rs:1973-1984`). Recorded as trap T8; the fix is its own change.
- Any cross-vantage *reconciliation* feature ("why do these differ?"). Under D6 this is not a numeric comparison; if it is ever built, it must be built as a diagnostics view with T7's network+pool-wait caveat front and centre.
