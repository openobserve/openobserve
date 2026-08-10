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
