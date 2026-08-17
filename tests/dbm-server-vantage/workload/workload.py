"""DBM server-vantage workload generator.

Runs CONTINUOUS realistic load against postgres + mysql + redis, instrumented
with OTel so CLIENT spans flow to the same collector that scrapes the SERVER
vantage. That gives us both halves of the correlation proof (capability g).

Threads:
  pg-oltp        multi-table transactions, N+1 pattern, index-less full scan
  pg-slow        pg_sleep + a big sort that spills to temp files (work_mem=64kB)
  pg-lockpair    two sessions, one holds a row lock while the other waits
  pg-deadlock    REAL deadlock: two connections, opposite-order updates, loops
  mysql-oltp     transactions + full scans + slow sort
  mysql-deadlock REAL InnoDB deadlock (1213)
  mysql-lockpair held row lock + waiter — the blocked state the ALREADY-SHIPPED
                 sqlquery/mysql_locks recipe reads but had never been run against
  mariadb-deadlock REAL deadlock, IDENTICAL shape to mysql-deadlock so the two
                 error logs differ only by server (settles the single-entry vs
                 split-entry question in dbm-engine-support.md §3)
  mariadb-lockpair same, for sqlquery/mariadb_locks (INNODB_LOCK_WAITS, which
                 MariaDB kept and MySQL 8 dropped)
  mssql-lockpair held row lock + waiter — the blocked state the ALREADY-SHIPPED
                 sqlquery/mssql_blocking recipe reads but has never been run
                 against
  mssql-deadlock REAL SQL Server deadlock (1205) for the system_health XML graph
  redis          command traffic
"""

import os
import random
import threading
import time
import traceback

from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.psycopg2 import Psycopg2Instrumentor
from opentelemetry.instrumentation.pymysql import PyMySQLInstrumentor
from opentelemetry.instrumentation.redis import RedisInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

ENV = os.environ.get("DEPLOY_ENV", "dbm-sv")
resource = Resource.create(
    {
        "service.name": "dbm-sv-workload",
        "deployment.environment.name": ENV,
    }
)
provider = TracerProvider(resource=resource)
provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
trace.set_tracer_provider(provider)

Psycopg2Instrumentor().instrument()
PyMySQLInstrumentor().instrument()
RedisInstrumentor().instrument()

import psycopg2  # noqa: E402
import pymssql  # noqa: E402
import pymysql  # noqa: E402
import redis  # noqa: E402

tracer = trace.get_tracer("dbm-sv-workload")

PG = dict(
    host=os.environ.get("PGHOST", "postgres"),
    port=int(os.environ.get("PGPORT", "5432")),
    user=os.environ.get("PGUSER", "dbm"),
    password=os.environ.get("PGPASSWORD", "dbm"),
    dbname=os.environ.get("PGDATABASE", "dbmlab"),
)
MY = dict(
    host=os.environ.get("MYSQL_HOST", "mysql"),
    port=int(os.environ.get("MYSQL_PORT", "3306")),
    user=os.environ.get("MYSQL_USER", "root"),
    password=os.environ.get("MYSQL_PASSWORD", "dbm"),
    database=os.environ.get("MYSQL_DB", "dbmlab"),
)
MARIA = dict(
    host=os.environ.get("MARIA_HOST", "mariadb"),
    port=int(os.environ.get("MARIA_PORT", "3306")),
    user=os.environ.get("MARIA_USER", "root"),
    password=os.environ.get("MARIA_PASSWORD", "dbm"),
    database=os.environ.get("MARIA_DB", "dbmlab"),
)
MSSQL = dict(
    host=os.environ.get("MSSQL_HOST", "mssql"),
    port=int(os.environ.get("MSSQL_PORT", "1433")),
    user=os.environ.get("MSSQL_USER", "sa"),
    password=os.environ.get("MSSQL_PASSWORD", "dbm_Passw0rd#1"),
    database=os.environ.get("MSSQL_DB", "dbmlab"),
)
DEADLOCK_PERIOD = float(os.environ.get("DEADLOCK_PERIOD_SECS", "20"))


def _mssql_kwargs():
    """pymssql spells the connection args differently from PyMySQL."""
    return dict(
        server=MSSQL["host"],
        port=MSSQL["port"],
        user=MSSQL["user"],
        password=MSSQL["password"],
        database=MSSQL["database"],
    )

STOP = threading.Event()


def pgconn(app_name, autocommit=True):
    c = psycopg2.connect(application_name=app_name, **PG)
    c.autocommit = autocommit
    return c


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def loop(name, fn, period):
    """Run fn forever, swallowing per-iteration errors (deadlocks are expected)."""
    while not STOP.is_set():
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            log(f"[{name}] {type(e).__name__}: {str(e)[:200]}")
        STOP.wait(period)


# --------------------------------------------------------------------------
# Postgres: OLTP mix
# --------------------------------------------------------------------------
def pg_oltp():
    conn = pgconn("dbm-sv-oltp", autocommit=False)
    cur = conn.cursor()

    def once():
        with tracer.start_as_current_span("checkout") as sp:
            sp.set_attribute("workload.scenario", "pg-oltp")
            acct = random.randint(1, 50)
            sku = "SKU-%05d" % random.randint(1, 500)
            cust = "CUST-%05d" % random.randint(0, 996)
            # multi-table transaction
            cur.execute(
                "UPDATE accounts SET balance = balance - %s, updated_at = now() WHERE id = %s",
                (random.randint(1, 100), acct),
            )
            cur.execute(
                "INSERT INTO orders (customer_ref, account_id, sku, amount, note) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (cust, acct, sku, random.randint(1, 9999), "n" * 64),
            )
            oid = cur.fetchone()[0]
            for i in range(3):
                cur.execute(
                    "INSERT INTO order_lines (order_id, sku, qty) VALUES (%s, %s, %s)",
                    (oid, sku, i + 1),
                )
            cur.execute(
                "INSERT INTO audit_log (actor, action) VALUES (%s, %s)",
                ("svc-checkout", "order.created"),
            )
            conn.commit()

            # N+1: one parent read, then a per-row child read
            cur.execute("SELECT id FROM orders WHERE account_id = %s LIMIT 12", (acct,))
            for (row_id,) in cur.fetchall():
                cur.execute(
                    "SELECT sku, qty FROM order_lines WHERE order_id = %s", (row_id,)
                )
                cur.fetchall()
            conn.commit()

            # index-less full scan on orders.customer_ref
            cur.execute(
                "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = %s", (cust,)
            )
            cur.fetchall()
            conn.commit()

    loop("pg-oltp", once, 0.4)


def pg_slow():
    conn = pgconn("dbm-sv-slow")
    cur = conn.cursor()

    def once():
        with tracer.start_as_current_span("nightly-report") as sp:
            sp.set_attribute("workload.scenario", "pg-slow")
            # intentional sleep -> long-running visible in pg_stat_activity
            cur.execute("SELECT pg_sleep(2), 'slow-marker' AS marker")
            cur.fetchall()
            # big sort on a wide column with work_mem=64kB -> temp file spill
            cur.execute(
                "SELECT customer_ref, note, sum(amount) AS total "
                "FROM orders GROUP BY customer_ref, note ORDER BY total DESC, note LIMIT 50"
            )
            cur.fetchall()
            # cross-table sort spill
            cur.execute(
                "SELECT o.customer_ref, o.note, count(l.id) FROM orders o "
                "JOIN order_lines l ON l.order_id = o.id "
                "GROUP BY o.customer_ref, o.note ORDER BY 3 DESC LIMIT 25"
            )
            cur.fetchall()

    loop("pg-slow", once, 3)


def pg_lockpair():
    """Holder takes a row lock for ~6s; waiter blocks on it. Feeds R1/R2."""
    holder = pgconn("dbm-sv-lock-holder", autocommit=False)
    waiter = pgconn("dbm-sv-lock-waiter", autocommit=False)
    hc, wc = holder.cursor(), waiter.cursor()

    def once():
        with tracer.start_as_current_span("inventory-adjust") as sp:
            sp.set_attribute("workload.scenario", "pg-lockpair")
            target = random.randint(1, 20)
            hc.execute(
                "UPDATE inventory SET qty = qty - 1, updated_at = now() WHERE id = %s",
                (target,),
            )
            t = threading.Thread(
                target=lambda: (
                    wc.execute(
                        "UPDATE inventory SET qty = qty + 5, updated_at = now() "
                        "WHERE id = %s /* blocked-waiter */",
                        (target,),
                    ),
                    waiter.commit(),
                )
            )
            t.start()
            time.sleep(6)  # hold the lock; waiter is blocked & logged
            holder.commit()
            t.join(timeout=30)

    loop("pg-lockpair", once, 4)


def pg_deadlock():
    """TRUE PG deadlock: A locks acct X then Y; B locks Y then X."""
    a = pgconn("dbm-sv-deadlock-a", autocommit=False)
    b = pgconn("dbm-sv-deadlock-b", autocommit=False)
    ac, bc = a.cursor(), b.cursor()
    n = {"i": 0}

    def once():
        n["i"] += 1
        x, y = 1, 2
        barrier = threading.Barrier(2, timeout=30)
        results = {}

        def side(tag, conn, cur, first, second):
            try:
                with tracer.start_as_current_span(f"transfer-{tag}") as sp:
                    sp.set_attribute("workload.scenario", "pg-deadlock")
                    sp.set_attribute("workload.deadlock.round", n["i"])
                    cur.execute(
                        f"UPDATE accounts SET balance = balance + 1 "
                        f"WHERE id = %s /* deadlock-{tag}-step1 */",
                        (first,),
                    )
                    barrier.wait()
                    cur.execute(
                        f"UPDATE accounts SET balance = balance - 1 "
                        f"WHERE id = %s /* deadlock-{tag}-step2 */",
                        (second,),
                    )
                    conn.commit()
                    results[tag] = "ok"
            except Exception as e:  # noqa: BLE001
                results[tag] = f"{type(e).__name__}:{getattr(e, 'pgcode', '')}"
                try:
                    conn.rollback()
                except Exception:
                    pass

        t1 = threading.Thread(target=side, args=("a", a, ac, x, y))
        t2 = threading.Thread(target=side, args=("b", b, bc, y, x))
        t1.start()
        t2.start()
        t1.join(timeout=40)
        t2.join(timeout=40)
        log(f"[pg-deadlock] round={n['i']} results={results}")

    loop("pg-deadlock", once, DEADLOCK_PERIOD)


# --------------------------------------------------------------------------
# MySQL
# --------------------------------------------------------------------------
def my_oltp():
    conn = pymysql.connect(autocommit=False, **MY)

    def once():
        with tracer.start_as_current_span("my-checkout") as sp:
            sp.set_attribute("workload.scenario", "mysql-oltp")
            cur = conn.cursor()
            acct = random.randint(1, 50)
            cust = "CUST-%05d" % random.randint(0, 996)
            cur.execute(
                "UPDATE accounts SET balance = balance - %s WHERE id = %s",
                (random.randint(1, 100), acct),
            )
            cur.execute(
                "INSERT INTO orders (customer_ref, account_id, sku, amount, note) "
                "VALUES (%s, %s, %s, %s, %s)",
                (cust, acct, "SKU-00001", random.randint(1, 9999), "n" * 32),
            )
            conn.commit()
            # full scan (customer_ref unindexed)
            cur.execute(
                "SELECT COUNT(*), SUM(amount) FROM orders WHERE customer_ref = %s", (cust,)
            )
            cur.fetchall()
            # sort-heavy
            cur.execute(
                "SELECT customer_ref, SUM(amount) t FROM orders "
                "GROUP BY customer_ref ORDER BY t DESC LIMIT 20"
            )
            cur.fetchall()
            conn.commit()
            cur.close()

    loop("mysql-oltp", once, 0.6)


def my_deadlock():
    a = pymysql.connect(autocommit=False, **MY)
    b = pymysql.connect(autocommit=False, **MY)
    n = {"i": 0}

    def once():
        n["i"] += 1
        barrier = threading.Barrier(2, timeout=30)
        results = {}

        def side(tag, conn, first, second):
            try:
                with tracer.start_as_current_span(f"my-transfer-{tag}") as sp:
                    sp.set_attribute("workload.scenario", "mysql-deadlock")
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE accounts SET balance = balance + 1 WHERE id = %s", (first,)
                    )
                    barrier.wait()
                    cur.execute(
                        "UPDATE accounts SET balance = balance - 1 WHERE id = %s", (second,)
                    )
                    conn.commit()
                    results[tag] = "ok"
            except Exception as e:  # noqa: BLE001
                results[tag] = f"{type(e).__name__}:{getattr(e, 'args', ('',))[0]}"
                try:
                    conn.rollback()
                except Exception:
                    pass

        t1 = threading.Thread(target=side, args=("a", a, 11, 12))
        t2 = threading.Thread(target=side, args=("b", b, 12, 11))
        t1.start()
        t2.start()
        t1.join(timeout=40)
        t2.join(timeout=40)
        log(f"[mysql-deadlock] round={n['i']} results={results}")

    loop("mysql-deadlock", once, DEADLOCK_PERIOD + 3)


def maria_deadlock():
    """MariaDB deadlock — DELIBERATELY IDENTICAL to my_deadlock().

    This exists to answer one question (dbm-engine-support.md §3): does MariaDB
    write a deadlock as ONE multi-line block, or split it across entries like
    MySQL 8? Running the SAME transaction shape against both servers makes the
    error log the only variable, so a diff of the two logs IS the answer. Any
    divergence here would confound that, which is why this is a copy rather
    than a shared helper.
    """
    a = pymysql.connect(autocommit=False, **MARIA)
    b = pymysql.connect(autocommit=False, **MARIA)
    n = {"i": 0}

    def once():
        n["i"] += 1
        barrier = threading.Barrier(2, timeout=30)
        results = {}

        def side(tag, conn, first, second):
            try:
                with tracer.start_as_current_span(f"maria-transfer-{tag}") as sp:
                    sp.set_attribute("workload.scenario", "mariadb-deadlock")
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE accounts SET balance = balance + 1 WHERE id = %s", (first,)
                    )
                    barrier.wait()
                    cur.execute(
                        "UPDATE accounts SET balance = balance - 1 WHERE id = %s", (second,)
                    )
                    conn.commit()
                    results[tag] = "ok"
            except Exception as e:  # noqa: BLE001
                results[tag] = f"{type(e).__name__}:{getattr(e, 'args', ('',))[0]}"
                try:
                    conn.rollback()
                except Exception:
                    pass

        t1 = threading.Thread(target=side, args=("a", a, 11, 12))
        t2 = threading.Thread(target=side, args=("b", b, 12, 11))
        t1.start()
        t2.start()
        t1.join(timeout=40)
        t2.join(timeout=40)
        log(f"[mariadb-deadlock] round={n['i']} results={results}")

    loop("mariadb-deadlock", once, DEADLOCK_PERIOD + 5)


def _innodb_lockpair(label, connect_kwargs, row_id):
    """Held row lock + a waiter on an InnoDB server (MySQL or MariaDB).

    This manufactures the state the ALREADY-SHIPPED `sqlquery/mysql_locks` and
    `sqlquery/mariadb_locks` recipes read. Both filter on a lock-wait join that
    can only return rows while a transaction is genuinely parked waiting for
    another's row lock, so without this thread those two recipes scrape a
    permanently empty result set and are never exercised. (Measured before this
    existed: pg 14 / mssql 110 / mysql 0 / mariadb 0 blocking rows. The MSSQL
    arm shipped with a broken DSN precisely because no fixture caught it.)

    Timing is bounded by `innodb_lock_wait_timeout`, which this rig sets to 10s
    (NOT the MySQL default of 50). The holder therefore sleeps 8s: long enough
    to overlap the 10s receiver scrape interval, short enough that the waiter
    parks rather than dying with error 1205 — a timed-out waiter rolls back and
    the lock-wait row vanishes, which is the failure mode to avoid here.

    MySQL and MariaDB share this helper because, unlike the deadlock threads,
    nothing here is trying to diff the two servers' behaviour — the recipes
    differ (data_lock_waits vs INNODB_LOCK_WAITS) but the transaction shape that
    provokes them is identical, so a copy would only invite drift.
    """
    holder = pymysql.connect(autocommit=False, **connect_kwargs)
    waiter = pymysql.connect(autocommit=False, **connect_kwargs)
    n = {"i": 0}

    def once():
        n["i"] += 1
        with tracer.start_as_current_span(f"{label}-lockpair") as sp:
            sp.set_attribute("workload.scenario", f"{label}-lockpair")
            hc = holder.cursor()
            hc.execute(
                "UPDATE accounts SET balance = balance + 1 WHERE id = %s", (row_id,)
            )

            def waiting_side():
                try:
                    wc = waiter.cursor()
                    wc.execute(
                        "UPDATE accounts SET balance = balance - 1 "
                        "WHERE id = %s /* blocked-waiter */",
                        (row_id,),
                    )
                    waiter.commit()
                except Exception:  # noqa: BLE001
                    try:
                        waiter.rollback()
                    except Exception:
                        pass

            t = threading.Thread(target=waiting_side)
            t.start()
            time.sleep(8)  # < innodb_lock_wait_timeout (10s); > scrape interval
            holder.commit()
            t.join(timeout=30)
            log(f"[{label}-lockpair] round={n['i']}")

    loop(f"{label}-lockpair", once, 12)


def my_lockpair():
    """MySQL held row lock + waiter. Feeds the `mysql_lock_waits` recipe."""
    _innodb_lockpair("mysql", MY, 13)


def maria_lockpair():
    """MariaDB held row lock + waiter. Feeds the `mariadb_lock_waits` recipe."""
    _innodb_lockpair("mariadb", MARIA, 14)


def mssql_lockpair():
    """Held row lock + a waiter — the state `sqlquery/mssql_blocking` reads.

    The SHIPPED recipe joins sys.dm_exec_requests to sys.dm_exec_sessions and
    filters on `blocking_session_id <> 0`, so it can only ever return rows while
    a session is genuinely blocked. This thread manufactures exactly that state
    on a schedule: one connection holds an uncommitted UPDATE inside an explicit
    transaction, a second tries to touch the same row and parks.
    """
    holder = pymssql.connect(**_mssql_kwargs(), autocommit=False)
    waiter = pymssql.connect(**_mssql_kwargs(), autocommit=False)
    n = {"i": 0}

    def once():
        n["i"] += 1
        with tracer.start_as_current_span("mssql-lockpair") as sp:
            sp.set_attribute("workload.scenario", "mssql-lockpair")
            hc = holder.cursor()
            hc.execute("UPDATE accounts SET balance = balance + 1 WHERE id = 21")
            # Hold long enough for the 10s-interval sqlquery receiver to sample.
            def waiting_side():
                try:
                    wc = waiter.cursor()
                    wc.execute("UPDATE accounts SET balance = balance - 1 WHERE id = 21")
                    waiter.commit()
                except Exception:
                    try:
                        waiter.rollback()
                    except Exception:
                        pass

            t = threading.Thread(target=waiting_side)
            t.start()
            time.sleep(14)
            holder.commit()
            t.join(timeout=30)
            log(f"[mssql-lockpair] round={n['i']}")

    loop("mssql-lockpair", once, 20)


def mssql_deadlock():
    """REAL SQL Server deadlock (error 1205).

    Captured so dbm-engine-support.md §4 can be written against a real
    `system_health` XML graph rather than the docs. SQL Server names its victim
    INLINE in <victim-list>, so unlike MySQL there should be no cross-record
    stitching to do — this workload is what proves that.
    """
    a = pymssql.connect(**_mssql_kwargs(), autocommit=False)
    b = pymssql.connect(**_mssql_kwargs(), autocommit=False)
    n = {"i": 0}

    def once():
        n["i"] += 1
        barrier = threading.Barrier(2, timeout=30)
        results = {}

        def side(tag, conn, first, second):
            try:
                with tracer.start_as_current_span(f"mssql-transfer-{tag}") as sp:
                    sp.set_attribute("workload.scenario", "mssql-deadlock")
                    cur = conn.cursor()
                    cur.execute(
                        "UPDATE accounts SET balance = balance + 1 WHERE id = %d", (first,)
                    )
                    barrier.wait()
                    cur.execute(
                        "UPDATE accounts SET balance = balance - 1 WHERE id = %d", (second,)
                    )
                    conn.commit()
                    results[tag] = "ok"
            except Exception as e:  # noqa: BLE001
                results[tag] = f"{type(e).__name__}:{getattr(e, 'args', ('',))[0]}"
                try:
                    conn.rollback()
                except Exception:
                    pass

        t1 = threading.Thread(target=side, args=("a", a, 31, 32))
        t2 = threading.Thread(target=side, args=("b", b, 32, 31))
        t1.start()
        t2.start()
        t1.join(timeout=40)
        t2.join(timeout=40)
        log(f"[mssql-deadlock] round={n['i']} results={results}")

    loop("mssql-deadlock", once, DEADLOCK_PERIOD + 7)


def redis_traffic():
    r = redis.Redis(
        host=os.environ.get("REDIS_HOST", "redis"),
        port=int(os.environ.get("REDIS_PORT", "6379")),
    )

    def once():
        with tracer.start_as_current_span("cache-path") as sp:
            sp.set_attribute("workload.scenario", "redis")
            k = "order:%d" % random.randint(1, 500)
            r.set(k, "v" * 64, ex=60)
            r.get(k)
            r.incr("counter:orders")
            r.lpush("recent", k)
            r.ltrim("recent", 0, 99)
            r.hset("stats", "last", k)

    loop("redis", once, 0.5)


THREADS = [
    ("pg-oltp", pg_oltp),
    ("pg-slow", pg_slow),
    ("pg-lockpair", pg_lockpair),
    ("pg-deadlock", pg_deadlock),
    ("mysql-oltp", my_oltp),
    ("mysql-deadlock", my_deadlock),
    ("mysql-lockpair", my_lockpair),
    ("mariadb-deadlock", maria_deadlock),
    ("mariadb-lockpair", maria_lockpair),
    ("mssql-lockpair", mssql_lockpair),
    ("mssql-deadlock", mssql_deadlock),
    ("redis", redis_traffic),
]

if __name__ == "__main__":
    log("workload starting:", ", ".join(n for n, _ in THREADS))

    # SUPERVISED START — NOT STYLE, THIS IS THE `mssql_*`-ZERO-ROWS BUG FIX.
    #
    # Every worker calls its driver's connect() once, at function entry, OUTSIDE
    # the retrying `loop()` body. So a connect() that raises kills the thread for
    # the lifetime of the container, permanently and silently: the process stays
    # up (the supervisor loop below is the main thread), the container stays
    # "healthy", and only the periodic "alive; threads: N / 12" line records it.
    #
    # That is exactly what happened on 2026-08-17T03:55:28. The compose stack was
    # recreated and the workload won the race against Docker's embedded DNS, so
    # all ELEVEN database threads died within 2s of start:
    #   psycopg2.OperationalError: could not translate host name "postgres" ...
    #   ... Name or service not known            (x198 across pg/mysql/maria/mssql)
    # Only `redis` survived, because redis-py resolves lazily inside the loop.
    # The stack then ran for 44 minutes at "threads: 1 / 12" emitting NO database
    # traffic at all, while every container reported healthy — and MSSQL was the
    # engine where that showed up as total absence, because unlike PG/MySQL its
    # recipes are the ONLY source of `mssql_*` rows (there is no native mssql
    # receiver in the pipeline, just sqlquery/mssql_blocking + _deadlocks, both of
    # which can only return rows while the workload is actively holding a lock).
    #
    # `depends_on: condition: service_healthy` does NOT prevent this: it gates on
    # the DB containers, not on the workload's own DNS resolver being ready.
    # So supervise instead of trusting a one-shot start — restart any worker that
    # dies, and the transient-DNS case self-heals within one 30s tick.
    live: dict[str, threading.Thread] = {}

    def spawn(name, fn):
        t = threading.Thread(target=fn, name=name, daemon=True)
        t.start()
        live[name] = t

    for name, fn in THREADS:
        spawn(name, fn)
        time.sleep(0.5)

    try:
        while True:
            time.sleep(30)
            dead = [n for n, f in THREADS if not live[n].is_alive()]
            for name in dead:
                fn = dict(THREADS)[name]
                log(f"[supervisor] thread {name} is dead — restarting")
                spawn(name, fn)
            log(
                "alive; threads:",
                sum(1 for t in live.values() if t.is_alive()),
                "/",
                len(THREADS),
            )
    except KeyboardInterrupt:
        STOP.set()
