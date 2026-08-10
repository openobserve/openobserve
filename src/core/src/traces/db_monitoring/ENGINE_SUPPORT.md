# Server-vantage engine support — what ships, and what it costs to add more

Scope: **server vantage only** (Deadlocks and Blocked queries). The client vantage
is unaffected by everything here — it reads OTel spans and already covers 11
dialects with no per-engine setup.

Status as of the MySQL victim fix (2026-08-10).

| Engine | Blocking | Deadlocks | Notes |
|---|---|---|---|
| PostgreSQL | ✅ | ✅ | Victim named inline on the `DETAIL:` entry |
| MySQL | ✅ | ✅ | Victim arrives on its **own** record — see below |
| SQL Server | ✅ | ❌ | Deadlocks are an XML graph; analysed, not built |
| MariaDB | ❌ | ❌ | Client vantage only; no recipe ships |
| Everything else | ❌ | ❌ | No server-vantage recipe |

---

## The axis that actually matters

Adding an engine is not "write another parser". Every difficulty in this
subsystem traces to one question:

> **Does the engine emit one deadlock as ONE record, or several?**

- **Postgres** splits into two log entries (`ERROR:` banner + `DETAIL:` block),
  but the `DETAIL:` entry carries the victim pid inline — so each record is
  self-sufficient. Easy.
- **MySQL** splits into N+1 entries: one `*** (N) TRANSACTION:` block per side,
  plus `*** WE ROLL BACK TRANSACTION (N)` **as its own record**. Nothing is
  self-sufficient; the verdict must be correlated across records at read time.
- **SQL Server** emits one atomic XML document containing everything, including
  `<victim-list>`. Easy — structurally the Postgres case, not the MySQL one.

Ingest canonicalizes **one record at a time** (`apply_to_record`), so anything
cross-record has to survive storage and be joined at read time. That is why
`o2_dbm_victim_side` is a stored column and why `stitch_mysql_deadlocks` exists.
It is machinery MySQL forced on us — do not adopt it for an engine that doesn't
need it.

### The bug this axis produced

Every MySQL participant was `victim: false` and `victim_pid` was null, because
`canonicalize_mysql_deadlock` compared `my_trx_side == my_victim_side` on a
single record — a shape InnoDB never emits. The UI's "cancelled by the database"
panel is gated on a flagged victim, so it rendered **blank**, and the
"What happened, in order" band was suppressed entirely.

It shipped green because the test fixture put both fields on one record. Fixed
in `tests_server_vantage.rs`; the regression test now uses the real three-record
split.

**Rule for any future engine: fixture-test against CAPTURED collector output,
never hand-authored records.** That is what `tests/dbm-capture` is for.

---

## MariaDB — not collected today, and the format is only half-shared

### What happens now

Pointing the existing `filelog/mysql_deadlocks` recipe at a MariaDB error log
fails at the **first** step, not the parser:

- MariaDB writes `2016-06-15 16:53:33 1396512511 [Note] InnoDB: …` —
  space separator (no `T`), **no `[MY-nnnnnn]` code**, no bracketed `[InnoDB]`.
- The `line_start_pattern` (`^\d{4}-\d{2}-\d{2}T…`) never matches, so multiline
  assembly is broken before the regex is reached.
- The regex requires three bracket groups; MariaDB has one. `my_message` is
  never populated, so the router's `matches "(?i)deadlock"` branch can't fire
  either, and the record falls to the default.
- Result: `o2_dbm_engine` is never set and no deadlock is produced.

**Also note:** the `filter/dbm` processor originally tested `o2_my_event == nil`,
but both filelog pipelines stamp `"other"` on every line *before* routing — so
the filter passed the entire error log through. Fixed to test the value; this
affected MySQL and Postgres too, not just MariaDB.

### What would be involved

The InnoDB **body** is shared (`*** (N) TRANSACTION:`, `WE ROLL BACK
TRANSACTION (N)`, `RECORD LOCKS …`), and `innodb_print_all_deadlocks` is
identical. The **envelope** is not. So: a separate `MARIADB_DEADLOG_RECEIVER`
with its own timestamp/prefix regex, reusing the three body regexes.

### The unknown that must be settled first

**Does MariaDB split a deadlock across entries, or write one multi-line block?**
MySQL 8.0's splitting is a consequence of its error-log *component*
architecture, which MariaDB never adopted — so MariaDB is likely single-entry.

This is not a detail. If MariaDB is single-entry, the current single-capture
`my_trx_*` regex grabs only side 1 and silently emits a **one-participant
"deadlock" with no counterparty** — a plausible-looking half-truth, worse than
collecting nothing. It would need two positionally-anchored regexes (as the
Postgres recipe already does for its second edge), or a different assembly
strategy entirely.

Settle it by running a MariaDB container through `tests/dbm-capture`. Do not
guess the format.

### Two traps

1. **Do not loosen the shared MySQL regex** to accept both formats. Making the
   `[MY-…]` group optional lets the fallback `matches "(?i)deadlock"` branch
   start catching MySQL notes that merely mention deadlocks. Keep two separate
   receiver consts; the duplication buys a bit-identical MySQL path.
2. **Do not reuse `o2_my_event`.** `detect_engine`'s fallback hardcodes
   `"mysql"` for any `my_*` key, and `canonicalize_mysql_deadlock` hardcodes the
   engine string. Worse, `stitch_mysql_deadlocks` groups on
   `(engine, instance, database)` where instance and database both default to
   `""` — so under-tagged MariaDB and MySQL rows land in the **same group** and
   can fabricate a cross-server deadlock. Use a distinct tag, and have the
   recipe set `db_system: mariadb` explicitly.

---

## SQL Server — deadlocks are tractable, and behave like Postgres

Blocking already ships (`sqlquery/mssql_blocking`, `o2_recipe:
mssql_blocking_chain`) and needed no parser, because `canonicalize_blocking`
reads only the recipe's aliased columns.

Deadlocks were deliberately left out: they live in the `system_health` Extended
Events session as an XML graph. But the graph names its victim **inline**
(`<victim-list><victimProcess id=…>`), so there is no cross-record verdict, no
`victim_side`, and **no stitching** — structurally the Postgres case.

### Shred in T-SQL, one row per deadlock

Two decisions, both load-bearing:

- **T-SQL, not Rust XML.** `apply_to_record` runs on *every* log record at four
  ingest sites. Parsing a 5–50 KB XML document there is a new class of hot-path
  cost and an ingest-path DoS surface. `.nodes()`/`.value()` emits flat scalars,
  which is exactly what the ingest layer wants — nested values are rejected
  outright (the reason `participants` is stored as a JSON *string*).
- **One row per DEADLOCK, not per participant.** Per-participant rows would drag
  in `merge_mysql_deadlocks`/`stitch_mysql_deadlocks` — machinery that exists
  only because InnoDB forces it — and would voluntarily recreate the empty-victim
  bug above. Positional `p1_*`/`p2_*` columns mirror what
  `canonicalize_pg_deadlock` already does. 3+ participant deadlocks truncate to
  two; `o2_dbm_raw` keeps the full XML.

### Shape of the work

- New `MSSQL_DEADLOCK_RECEIVER` recipe reading
  `sys.fn_xe_file_target_read_file(N'system_health*.xel', …)` (file target, not
  ring buffer — the ring buffer truncates large graphs, and a truncated graph is
  unparseable).
- `canonicalize_mssql_deadlock` in `server_vantage.rs`, ~60 lines, a structural
  clone of the Postgres one.
- Two dispatch edits: `detect_engine` and `canonicalize_record`.
- **Zero read-path changes** — the `/deadlocks` SELECT already contains every
  column this would populate, and `stitch_mysql_deadlocks` gates on
  `engine == "mysql"` so MSSQL passes through untouched.

### Known limitations to state up front

- **Query text is weaker than PG/MySQL.** `inputbuf` is the whole client batch,
  not the deadlocking statement; the precise statement is in
  `executionStack/frame` but SQL Server truncates it mid-token, which fails the
  lexer (and by design a lexer error yields no fingerprint rather than raw text).
  For stored procedures `inputbuf` is just `EXEC p1 4`. So the cross-vantage
  fingerprint join is materially weaker for MSSQL, and absent for proc-based
  workloads. A product limitation to document, not a bug.
- **Dedup is novel to this signal.** The `.xel` file holds *history*, so every
  poll re-returns every deadlock — unlike the blocking recipes, where each poll
  is a fresh sample. Needs a time window matched to the collection interval.
- **Platform variance:** Azure SQL Database lacks
  `sys.fn_xe_file_target_read_file`; SQL 2025 optimized locking changes
  `resource-list` to `<xactlock>`; parallel deadlocks add `exchangeEvent` and
  repeat a spid across `ecid`s. Each degrades `lock_target` to null rather than
  breaking, but the recipe likely needs platform variants.

---

## Recommendation

**SQL Server deadlocks are the better next investment.** Clean victim semantics,
no stitching, contained blast radius, and the collection story is understood.

**MariaDB is cheap only after someone captures a real deadlock log.** Guessing
the format risks shipping the one-participant half-truth, which is worse than
the current honest "not collected" empty state.

Neither is a bug today: MariaDB has no recipe, and the SQL Server card states
plainly that deadlocks are not collected and why, rather than promising a tab it
cannot fill.
