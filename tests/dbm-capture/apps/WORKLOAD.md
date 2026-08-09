# DBM Capture Workload — canonical per-engine statement list

Every app cell executes exactly these logical steps, in order. Each step is wrapped in a
client wrapper span carrying the span attribute `test.step_id` (value = the step id below).
Every app sets resource attributes `service.name=dbm-<lang>-<engine>` and
`deployment.environment.name` (default `capture-env-a`; a second run per the spec uses
`capture-env-b`).

Steps `S00` (schema setup/seed) and `S99` (cleanup, optional) exist for rig hygiene and are
NOT asserted by the corpus. `S12` (PG deadlock choreography) runs ONLY in the Java×PG and
.NET×PG cells (the only status-code-emitting SDKs).

Notes that apply to every SQL engine:
- Placeholder style is whatever the driver natively uses (`%s` psycopg2, `$1` pg/Npgsql10,
  `@p0` Npgsql legacy, `?` JDBC/MySQL) — the cross-SDK equivalence suite binds these later.
- Whether TCL statements (`BEGIN`/`COMMIT`/`SAVEPOINT`) appear as separate spans or batched
  text is driver-dependent; capture whatever the driver emits. Savepoint-collapse corpus
  cases are additionally authored regardless.

## Schema (S00 — setup, unasserted)

SQL engines (PostgreSQL / MySQL):

```sql
DROP TABLE IF EXISTS dbm_items;
CREATE TABLE dbm_items (id INT PRIMARY KEY, name VARCHAR(64), price INT, category VARCHAR(32));
INSERT INTO dbm_items (id, name, price, category) VALUES
  (1,'alpha',10,'a'),(2,'beta',20,'a'),(3,'gamma',30,'b'),(4,'delta',40,'b'),
  (5,'epsilon',50,'c'),(6,'zeta',60,'c'),(7,'eta',70,'d'),(8,'theta',80,'d'),
  (9,'iota',90,'e'),(10,'kappa',100,'e');
DROP TABLE IF EXISTS deadlock_t;
CREATE TABLE deadlock_t (id INT PRIMARY KEY, v INT);
INSERT INTO deadlock_t (id, v) VALUES (1,0),(2,0);
```

Mongo: drop + seed collection `dbm_items` with the same ten documents
`{_id: n, name: ..., price: ..., category: ...}`.
Redis: `FLUSHDB`, then `SET item:<n> <name>` for n = 1..10.

## Step list

| Step | Logical intent | PostgreSQL / MySQL (parameterized) | Redis | MongoDB |
|------|----------------|-------------------------------------|-------|---------|
| S01 | Parameterized SELECT, 1 param | `SELECT id, name, price FROM dbm_items WHERE id = ?` (param: 3) | `GET item:3` | `find({_id: 3})` on `dbm_items` |
| S02 | Parameterized SELECT, 2 params | `SELECT id, name FROM dbm_items WHERE price > ? AND category = ?` (params: 25, 'b') | `SET item:tmp scratch EX 60` | `find({price: {$gt: 25}, category: "b"})` |
| S03 | IN-list arity 3 | `SELECT id, name FROM dbm_items WHERE id IN (?, ?, ?)` (1,2,3) | `MGET item:1 item:2 item:3` | `find({_id: {$in: [1,2,3]}})` |
| S04 | IN-list arity 8 | `SELECT id, name FROM dbm_items WHERE id IN (?×8)` (1..8) | `MGET item:1 … item:8` | `find({_id: {$in: [1..8]}})` |
| S05 | IN-list arity 20 | `SELECT id, name FROM dbm_items WHERE id IN (?×20)` (1..20) | `MGET item:1 … item:20` | `find({_id: {$in: [1..20]}})` |
| S06 | Single-row INSERT | `INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)` (101,'ins-1',11,'x') | `SET batch:1 v1` | `insert_one({_id:101, …})` |
| S07 | Multi-row VALUES INSERT (5 rows, one statement) | `INSERT INTO dbm_items (id, name, price, category) VALUES (…),(…),(…),(…),(…)` (ids 111–115) | pipeline of 5 `SET batch:<n>` | `insert_many` 5 docs (ids 111–115) |
| S08 | Batch INSERT via driver batch API (10 rows) | `INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)` executemany/addBatch, ids 121–130 | pipeline of 10 `SET batch:<n>` | `insert_many` 10 docs (ids 121–130) |
| S09 | Transaction block + savepoint (where supported) | begin txn; `UPDATE dbm_items SET price = price + 1 WHERE id = ?` (1); `SAVEPOINT sp1`; `UPDATE dbm_items SET price = price + 100 WHERE id = ?` (2); `ROLLBACK TO SAVEPOINT sp1`; commit | `MULTI` … `INCR txn:counter` ×2 … `EXEC` | session txn: two `update_one` calls (no savepoint support) |
| S10 | Ping | `SELECT 1` | `PING` | `{ping: 1}` admin command |
| S11 | Intentional error: bad column / bad op (span must be ERROR) | `SELECT no_such_column FROM dbm_items` | `MEMORY DOCTOR-BOGUS` (unknown command via execute_command) | `find({price: {$badOperator: 1}})` |
| S12 | **PG deadlock (Java×PG and .NET×PG cells ONLY)** | Two connections, opposite-order `UPDATE deadlock_t SET v = v + 1 WHERE id = ?` on ids 1/2 with a sync barrier; victim fails with SQLSTATE 40P01; only the victim span errors | — | — |

Engine dialect specifics:
- PostgreSQL: placeholders per driver (`%s`, `$1`, `@p0`); savepoint syntax as above.
- MySQL: same statements with `?` placeholders; savepoint supported.
- Errors: S11 must leave the connection usable for later steps (rollback first if needed).
