#!/usr/bin/env python3
"""One-time extraction of captured DBM corpus cases from tests/dbm-capture/fixtures/.

Walks every scrubbed fixture, identifies DB client spans (any `db.*` attribute),
attributes each span to a workload step (WORKLOAD.md S00-S12) via the parentSpanId
chain up to a wrapper span carrying `test.step_id`, falling back to timestamp
containment within the wrapper spans' [start, end] ranges (all node fixtures are
100% root spans - see MANIFEST.md side finding), then applies a workload-derived
text-pattern sanity layer (async node driver spans drift +/-1 wrapper under pure
containment; the canonical statement list makes the true step unambiguous for
every curated shape). Rows are deduped by (engine, step, resolved text,
db.response.status_code) and a curation table selects the checked-in cases.

Output: corpus case files in the exact schema `db_monitoring/tests.rs` consumes:
  captured_sql.json / captured_redis.json / captured_mongodb.json /
  captured_degraded.json  under src/core/src/traces/db_monitoring/corpus/.

fingerprint_class encodes EXPECTED fingerprint equality (the harness asserts
same-class => same fingerprint AND cross-class => different fingerprint), so:
  - the fingerprint hashes normalized text only (design 3.1 - `o2_db_system` is a
    rollup GROUP BY dimension, not part of the hash), and the workload issues
    byte-identical statements to PostgreSQL and MySQL; both engines' cells
    therefore share one class, named `sql-<step>` rather than `<engine>-<step>`;
  - IN-list arities (S03/S04/S05) collapse by design => one `sql-S03-inlist` class;
  - single-row / multi-row VALUES / driver-batch INSERTs (S06/S07/S08) all
    normalize to `VALUES (?)` => one `sql-S06-insert` class;
  - captured `SELECT 1` and bare `COMMIT` fingerprint-collide with the authored
    `pg_ping` / `pg_tcl_commit` classes, so those class names are reused;
  - driver-degraded text shapes that genuinely cannot bind to the text-class
    fingerprint get suffixed classes: `-opcoll` (pymongo capture_statement=False),
    `-unknown` (go otelsql DisableQuery), `-argshidden` (node redis
    "[N other arguments]" serializer hides every key), `-masked`
    (Connector/J native spans), and pymongo dict-repr vs node masked-JSON
    command docs are distinct serializations => `-py` / `-node` suffixes.

Run:  python3 tests/dbm-capture/extract/extract.py
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
FIXTURES = HERE.parent / "fixtures"
CORPUS = HERE.parent.parent.parent / "src" / "core" / "src" / "traces" / "db_monitoring" / "corpus"

# Attribute keys copied into the case input (real span shapes, minus rig noise).
KEEP_PREFIXES = (
    "db.", "server.", "net.peer", "net.transport", "network.peer",
    "deployment.environment", "error.type", "url.", "http.",
)


def attr_value(v):
    if "stringValue" in v:
        return v["stringValue"]
    if "intValue" in v:
        return int(v["intValue"])
    if "boolValue" in v:
        return v["boolValue"]
    if "doubleValue" in v:
        return v["doubleValue"]
    return None


def attrs_of(kvs):
    return {kv["key"]: attr_value(kv.get("value", {})) for kv in kvs}


class Span:
    def __init__(self, scope, resource_attrs, raw):
        self.scope = scope
        self.resource_attrs = resource_attrs
        self.raw = raw
        self.attrs = attrs_of(raw.get("attributes", []))
        self.span_id = raw.get("spanId")
        self.parent_id = raw.get("parentSpanId")
        self.start = int(raw["startTimeUnixNano"])
        self.end = int(raw["endTimeUnixNano"])
        self.kind = raw.get("kind", 0)
        self.status = raw.get("status", {}).get("code", 0)

    @property
    def step_attr(self):
        return self.attrs.get("test.step_id")

    @property
    def is_db(self):
        return any(k.startswith("db.") for k in self.attrs)

    @property
    def system(self):
        s = self.attrs.get("db.system.name") or self.attrs.get("db.system")
        return str(s).lower() if s else None

    @property
    def text(self):
        return self.attrs.get("db.query.text") or self.attrs.get("db.statement")

    @property
    def status_code_attr(self):
        return self.attrs.get("db.response.status_code")

    def merged_attrs(self):
        """Resource env attrs + span attrs, filtered to the keep-list."""
        out = {}
        for src in (self.resource_attrs, self.attrs):
            for k, v in src.items():
                if any(k.startswith(p) for p in KEEP_PREFIXES):
                    out[k] = v
        return out


def load_fixture(path):
    doc = json.loads(path.read_text())
    spans = []
    for rs in doc["resourceSpans"]:
        res = attrs_of(rs.get("resource", {}).get("attributes", []))
        for ss in rs.get("scopeSpans", []):
            scope = ss.get("scope", {}).get("name", "")
            for sp in ss.get("spans", []):
                spans.append(Span(scope, res, sp))
    return spans


# ---------------------------------------------------------------------------
# Step attribution: parent chain, then timestamp containment, then pattern layer
# ---------------------------------------------------------------------------

def attribute_step(span, by_id, wrappers):
    """(step, how) via parentSpanId chain then timestamp containment."""
    cur, seen = span, set()
    while cur is not None and cur.parent_id and cur.parent_id in by_id:
        if cur.span_id in seen:
            break
        seen.add(cur.span_id)
        cur = by_id[cur.parent_id]
        if cur.step_attr:
            return cur.step_attr, "parent"
    # Root-span fixtures (all node cells): containment of the span midpoint in the
    # smallest wrapper window; fall back to maximum overlap.
    mid = (span.start + span.end) // 2
    best = None
    for w in wrappers:
        if w.start <= mid <= w.end:
            width = w.end - w.start
            if best is None or width < best[1]:
                best = (w.step_attr, width)
    if best:
        return best[0], "contain"
    best_ov = None
    for w in wrappers:
        ov = min(span.end, w.end) - max(span.start, w.start)
        if ov > 0 and (best_ov is None or ov > best_ov[1]):
            best_ov = (w.step_attr, ov)
    if best_ov:
        return best_ov[0], "overlap"
    return None, "none"


def canonical_step(system, text, span):
    """Workload-derived canonical step tag for a DB span (None = uncurated shape).

    Arities/variants that share a fingerprint by design share one tag
    (S03in = S03/S04/S05, S06ins = S06/S07/S08 dbm_items INSERTs).
    """
    t = (text or "").strip()
    if not t:
        return "NOTEXT"
    if system in ("postgresql", "mysql"):
        if t == "SELECT (...)":
            return "CJMASK"
        if "(...)" in t or t == "(SQL batch)":
            return None  # other Connector/J masked shapes: uncurated
        if "no_such_column" in t:
            return "S11"
        if t in ("SELECT 1", "SELECT ?"):
            return "S10"
        if "deadlock_t SET" in t:
            return "S12"
        if "price FROM dbm_items WHERE id" in t:
            return "S01"
        if "price > " in t:
            return "S02"
        if " IN (" in t:
            return "S03in"
        if t.startswith("INSERT INTO dbm_items") and "'alpha'" not in t:
            return "S06ins"
        if t.startswith("UPDATE dbm_items SET price"):
            return "S09u"
        if t.startswith("SAVEPOINT"):
            return "S09sp"
        if t.startswith("ROLLBACK TO"):
            return "S09rb"
        if t in ("BEGIN", "COMMIT", "ROLLBACK", "START TRANSACTION"):
            return "S09tcl"
        return None  # S00 schema/seed, CREATE/DROP, connection spans
    if system == "redis":
        if t.startswith("GET item:"):
            return "S01"
        if t.startswith("SETEX item:tmp") or t.startswith("SET item:tmp"):
            return "S02"
        if t.startswith("MGET"):
            return "S03in"
        if t.startswith("SET batch:"):
            return "S06ins"
        if t.startswith("INCR txn:counter"):
            return "S09"
        if t == "PING":
            return "S10"
        if t.startswith("MEMORY"):
            return "S11"
        return None  # FLUSHDB / SET item:N seeds
    if system == "mongodb":
        if "$badOperator" in t:
            return "S11"
        if "'$in'" in t or '"$in"' in t:
            return "S03in"
        if "$gt" in t:
            return "S02"
        if t.startswith("find {'_id'") or '"filter":{"_id":"?"' in t:
            return "S01"
        if t == "find":
            return "S01"
        if t.startswith("insert") or t == "insert" or t.startswith('{"_id"'):
            return "S06ins"
        if t.startswith("update") or t.startswith('{"update"'):
            return "S09"
        if t == "ping" or t.startswith('{"ping"'):
            return "S10"
        return None  # commitTransaction / endSessions / drop
    return "NOTEXT" if not text else None


# ---------------------------------------------------------------------------
# Expected-record shapes (fingerprint_class + normalizer-derived expects)
# ---------------------------------------------------------------------------

SHAPES = {
    # SQL (identical workload text on postgresql AND mysql => shared classes)
    "sql-S01": ("SELECT id, name, price FROM dbm_items WHERE id = ?", "SELECT", "query"),
    "sql-S02": ("SELECT id, name FROM dbm_items WHERE price > ? AND category = ?", "SELECT", "query"),
    "sql-S03-inlist": ("SELECT id, name FROM dbm_items WHERE id IN (?)", "SELECT", "query"),
    "sql-S06-insert": ("INSERT INTO dbm_items (id, name, price, category) VALUES (?)", "INSERT", "query"),
    "sql-S09-update": ("UPDATE dbm_items SET price = price + ? WHERE id = ?", "UPDATE", "query"),
    "sql-S09-savepoint": ("SAVEPOINT sp1", "SAVEPOINT", "transaction-control"),
    "sql-S09-rollback-sp": ("ROLLBACK TO SAVEPOINT sp1", "ROLLBACK", "transaction-control"),
    "sql-S09-start-transaction": ("START TRANSACTION", "START", "transaction-control"),
    # `SELECT 1` / bare `COMMIT` hash-collide with these authored classes: reuse.
    "pg_ping": ("SELECT ?", "SELECT", "ping"),
    "pg_tcl_commit": ("COMMIT", "COMMIT", "transaction-control"),
    "sql-S11-error": ("SELECT no_such_column FROM dbm_items", "SELECT", "query"),
    "sql-S12-deadlock": ("UPDATE deadlock_t SET v = v + ? WHERE id = ?", "UPDATE", "query"),
    "mysql-S01-connectorj-masked": ("SELECT (...)", "SELECT", "query"),
    # Redis
    "redis-S01-get": ("GET item:?", "GET", "query"),
    "redis-S02-setex": ("SETEX item:tmp", "SETEX", "query"),
    "redis-S02-set": ("SET item:tmp", "SET", "query"),
    "redis-S03-mget": ("MGET item:?", "MGET", "query"),
    "redis-S03-mget-argshidden": ("MGET", "MGET", "query"),
    "redis-S06-set-batch": ("SET batch:?", "SET", "query"),
    "redis-S09-incr": ("INCR txn:counter", "INCR", "query"),
    "redis-S10-ping": ("PING", "PING", "ping"),
    "redis-S11-error": ("MEMORY DOCTOR-BOGUS", "MEMORY", "query"),
    # MongoDB - pymongo dict-repr shapes (capture_statement=True)
    "mongodb-S01-py": ("find {'_id': \"?\"}", "find", "query"),
    "mongodb-S02-py": ("find {'price': {'$gt': \"?\"}, 'category': \"?\"}", "find", "query"),
    "mongodb-S03-inlist-py": ("find {'_id': {'$in': [\"?\"]}}", "find", "query"),
    "mongodb-S06-insert-py": (
        "insert [{'_id': \"?\", 'name': \"?\", 'price': \"?\", 'category': \"?\"}]",
        "insert", "query"),
    "mongodb-S09-update-py": (
        "update [{'q': {'_id': \"?\"}, 'u': {'$inc': {'price': \"?\"}}, 'multi': \"?\", 'upsert': \"?\"}]",
        "update", "query"),
    "mongodb-S10-ping-py": ("ping", "ping", "ping"),
    "mongodb-S11-error-py": ("find {'price': {'$badOperator': \"?\"}}", "find", "query"),
    # MongoDB - pymongo default capture_statement=False (command-name-only text)
    "mongodb-S01-opcoll": ("find", "find", "query"),
    # MongoDB - node masked-JSON command docs
    "mongodb-S01-node": ('{"find":"?","filter":{"_id":"?"}}', "find", "query"),
    "mongodb-S03-inlist-node": ('{"find":"?","filter":{"_id":{"$in":["?"]}}}', "find", "query"),
    "mongodb-S06-insert-node": ('{"_id":"?","name":"?","price":"?","category":"?"}', "insert", "query"),
    "mongodb-S09-update-node": (
        '{"update":"?","updates":[{"q":{"_id":"?"},"u":{"$inc":{"price":"?"}}}],"ordered":"?"}',
        "update", "query"),
    "mongodb-S10-ping-node": ('{"ping":"?"}', "ping", "ping"),
    "mongodb-S11-error-node": ('{"find":"?","filter":{"price":{"$badOperator":"?"}}}', "find", "query"),
}

DIALECT = {"postgresql": "postgresql", "mysql": "mysql", "redis": "redis", "mongodb": "mongodb"}


def T(frag):
    return lambda t: frag in t


def EQ(s):
    return lambda t: t == s


def ARITY(frag, n):
    return lambda t: frag in t and t.count("?") == n if '"?"' not in t else False


# Curation table: (case_id, fixture, engine, step_tag, text predicate, shape,
#                  literals, overrides)
# overrides: dict with optional batch_multiplier / no_dialect (op-attr diverges
# from normalizer-derived operation, so the direct normalize() contract - which
# has no attr channel - cannot express the case; enrich-level assertions still
# cover text, class and fingerprint) / require_status ('ERROR' span selection).
CURATION = [
    # ---- captured_sql.json -------------------------------------------------
    # S01 flagship: one logical SELECT, four placeholder styles
    ("cap-s01-python-pg-legacy-pct-s", "python-pg-legacy", "postgresql", "S01", T("= %s"), "sql-S01", [], {}),
    ("cap-s01-python-pg-dup-both-vocab", "python-pg-dup", "postgresql", "S01", T("= %s"), "sql-S01", [], {}),
    ("cap-s01-python-pg-new-vocab", "python-pg-new", "postgresql", "S01", T("= %s"), "sql-S01", [], {}),
    ("cap-s01-node-pg-era-legacy-dollar", "node-pg-era-legacy", "postgresql", "S01", T("= $1"), "sql-S01", [], {}),
    ("cap-s01-node-pg-cur-new-vocab", "node-pg-cur-legacy", "postgresql", "S01", T("= $1"), "sql-S01", [], {}),
    ("cap-s01-java-legacy-jdbc-qmark", "java-legacy", "postgresql", "S01", T("= ?"), "sql-S01", [], {}),
    ("cap-s01-java-new-jdbc-namespace-composite", "java-new", "postgresql", "S01", T("= ?"), "sql-S01", [], {}),
    ("cap-s01-dotnet-pg9-npgsql-at-p1", "dotnet-pg9-legacy", "postgresql", "S01", T("= @p1"), "sql-S01", [], {}),
    ("cap-s01-dotnet-pg10-new-vocab", "dotnet-pg10-legacy", "postgresql", "S01", T("= @p1"), "sql-S01", [], {}),
    ("cap-s01-node-mysql-cur", "node-mysql-cur-legacy", "mysql", "S01", T("= ?"), "sql-S01", [], {}),
    ("cap-s01-dotnet-mysql-dup", "dotnet-mysql-dup", "mysql", "S01", T("= @p1"), "sql-S01", [], {}),
    # S02
    ("cap-s02-python-pg-dup", "python-pg-dup", "postgresql", "S02", T("price > %s"), "sql-S02", [], {}),
    ("cap-s02-node-pg-cur", "node-pg-cur-legacy", "postgresql", "S02", T("price > $1"), "sql-S02", [], {}),
    ("cap-s02-dotnet-pg10", "dotnet-pg10-legacy", "postgresql", "S02", T("price > @p1"), "sql-S02", [], {}),
    # S03/S04/S05 IN-lists (arity collapse => one class)
    ("cap-s03-python-pg-arity3", "python-pg-legacy", "postgresql", "S03in", T("IN (%s, %s, %s)"), "sql-S03-inlist", [], {}),
    ("cap-s03-node-pg-cur-arity3", "node-pg-cur-legacy", "postgresql", "S03in", T("IN ($1, $2, $3)"), "sql-S03-inlist", [], {}),
    ("cap-s03-java-legacy-agent-precollapsed", "java-legacy", "postgresql", "S03in", T("IN (?)"), "sql-S03-inlist", [], {}),
    ("cap-s05-dotnet-pg9-arity20", "dotnet-pg9-legacy", "postgresql", "S03in", T("@p20"), "sql-S03-inlist", [], {}),
    # S06/S07/S08 INSERT family (multi-row VALUES + batch collapse => one class)
    ("cap-s07-python-pg-new-multirow", "python-pg-new", "postgresql", "S06ins", T("), (%s"), "sql-S06-insert", [], {}),
    ("cap-s07-node-pg-era-multirow", "node-pg-era-legacy", "postgresql", "S06ins", T("), ($5"), "sql-S06-insert", [], {}),
    ("cap-s07-java-dup-pg-multirow", "java-dup", "postgresql", "S06ins", T("), (?"), "sql-S06-insert", [], {}),
    ("cap-s06-java-legacy-mysql-single", "java-legacy", "mysql", "S06ins", EQ("INSERT INTO dbm_items (id, name, price, category) VALUES (?, ?, ?, ?)"), "sql-S06-insert", [], {}),
    ("cap-s06-dotnet-mysql-new-single", "dotnet-mysql-new", "mysql", "S06ins", EQ("INSERT INTO dbm_items (id, name, price, category) VALUES (@p1, @p2, @p3, @p4)"), "sql-S06-insert", [], {}),
    ("cap-s08-dotnet-pg10-multistatement-batch", "dotnet-pg10-legacy", "postgresql", "S06ins", T(";\nINSERT"), "sql-S06-insert", [], {"batch_multiplier": 10}),
    # S09 transaction step
    ("cap-s09-java-dup-pg-update100", "java-dup", "postgresql", "S09u", T("+ 100"), "sql-S09-update", ["100"], {}),
    # java-LEGACY agent pre-masks literals (`price + ?`) - same fingerprint member
    ("cap-s09-java-legacy-pg-premasked", "java-legacy", "postgresql", "S09u", T("price + ?"), "sql-S09-update", [], {}),
    ("cap-s09-python-pg-new-update100", "python-pg-new", "postgresql", "S09u", T("+ 100"), "sql-S09-update", ["100"], {}),
    ("cap-s09-python-pg-savepoint", "python-pg-legacy", "postgresql", "S09sp", EQ("SAVEPOINT sp1"), "sql-S09-savepoint", [], {}),
    ("cap-s09-java-dup-mysql-savepoint", "java-dup", "mysql", "S09sp", EQ("SAVEPOINT sp1"), "sql-S09-savepoint", [], {}),
    ("cap-s09-python-pg-rollback-sp", "python-pg-legacy", "postgresql", "S09rb", EQ("ROLLBACK TO SAVEPOINT sp1"), "sql-S09-rollback-sp", [], {}),
    ("cap-s09-node-mysql-cur-rollback-sp", "node-mysql-cur-legacy", "mysql", "S09rb", EQ("ROLLBACK TO SAVEPOINT sp1"), "sql-S09-rollback-sp", [], {}),
    ("cap-s09-node-pg-cur-commit", "node-pg-cur-legacy", "postgresql", "S09tcl", EQ("COMMIT"), "pg_tcl_commit", [], {}),
    ("cap-s09-node-mysql-cur-start-transaction", "node-mysql-cur-legacy", "mysql", "S09tcl", EQ("START TRANSACTION"), "sql-S09-start-transaction", [], {}),
    # S10 ping (java agent pre-masks to `SELECT ?`; literal `SELECT 1` elsewhere)
    ("cap-s10-python-pg-dup-select1", "python-pg-dup", "postgresql", "S10", EQ("SELECT 1"), "pg_ping", [], {}),
    ("cap-s10-java-new-pg-premasked", "java-new", "postgresql", "S10", EQ("SELECT ?"), "pg_ping", [], {}),
    ("cap-s10-node-mysql-cur-select1", "node-mysql-cur-legacy", "mysql", "S10", EQ("SELECT 1"), "pg_ping", [], {}),
    ("cap-s10-dotnet-pg9-select1", "dotnet-pg9-legacy", "postgresql", "S10", EQ("SELECT 1"), "pg_ping", [], {}),
    # S11 error (dotnet cells carry real db.response.status_code)
    ("cap-s11-python-pg-legacy", "python-pg-legacy", "postgresql", "S11", T("no_such_column"), "sql-S11-error", [], {}),
    ("cap-s11-node-pg-cur", "node-pg-cur-legacy", "postgresql", "S11", T("no_such_column"), "sql-S11-error", [], {}),
    ("cap-s11-java-legacy-mysql", "java-legacy", "mysql", "S11", T("no_such_column"), "sql-S11-error", [], {}),
    ("cap-s11-dotnet-pg10-status-42703", "dotnet-pg10-legacy", "postgresql", "S11", T("no_such_column"), "sql-S11-error", [], {}),
    ("cap-s11-dotnet-mysql-dup-status-1054", "dotnet-mysql-dup", "mysql", "S11", T("no_such_column"), "sql-S11-error", [], {}),
    # S12 deadlock victim - the only real 40P01 capture in the matrix
    ("cap-s12-dotnet-pg10-victim-40p01", "dotnet-pg10-legacy", "postgresql", "S12", T("deadlock_t SET"), "sql-S12-deadlock", [], {"require_status": "40P01"}),
    # Connector/J native spans: driver-masked statement text in every mode
    ("cap-connectorj-masked-select", "java-legacy", "mysql", "CJMASK", EQ("SELECT (...)"), "mysql-S01-connectorj-masked", [], {}),

    # ---- captured_redis.json ----------------------------------------------
    ("cap-redis-s01-java-legacy", "java-legacy", "redis", "S01", EQ("GET item:3"), "redis-S01-get", [], {}),
    ("cap-redis-s01-node-era-legacy", "node-redis-era-legacy", "redis", "S01", EQ("GET item:3"), "redis-S01-get", [], {}),
    ("cap-redis-s01-node-cur", "node-redis-cur-legacy", "redis", "S01", EQ("GET item:3"), "redis-S01-get", [], {}),
    ("cap-redis-s02-java-setex", "java-legacy", "redis", "S02", T("SETEX item:tmp"), "redis-S02-setex", ["60"], {}),
    ("cap-redis-s02-node-cur-set", "node-redis-cur-legacy", "redis", "S02", T("SET item:tmp"), "redis-S02-set", [], {}),
    ("cap-redis-s03-java-legacy-arity3", "java-legacy", "redis", "S03in", EQ("MGET item:1 item:2 item:3"), "redis-S03-mget", [], {}),
    ("cap-redis-s05-java-new-arity20", "java-new", "redis", "S03in", T("item:20"), "redis-S03-mget", [], {}),
    ("cap-redis-s03-node-cur-argshidden", "node-redis-cur-legacy", "redis", "S03in", EQ("MGET [3 other arguments]"), "redis-S03-mget-argshidden", [], {}),
    ("cap-redis-s06-java-legacy", "java-legacy", "redis", "S06ins", EQ("SET batch:1 ?"), "redis-S06-set-batch", [], {}),
    ("cap-redis-s07-java-new-pipeline", "java-new", "redis", "S06ins", T("SET batch:1 ?; SET batch:2"), "redis-S06-set-batch", [], {"no_dialect": True, "operation": "PIPELINE SET"}),
    ("cap-redis-s06-node-era-legacy", "node-redis-era-legacy", "redis", "S06ins", EQ("SET batch:1 [1 other arguments]"), "redis-S06-set-batch", [], {}),
    ("cap-redis-s09-node-era-legacy-incr", "node-redis-era-legacy", "redis", "S09", EQ("INCR txn:counter"), "redis-S09-incr", [], {}),
    ("cap-redis-s09-java-legacy-jedis-multi", "java-legacy", "redis", "S09", T("txn:counter;"), "redis-S09-incr", [], {"no_dialect": True, "operation": "MULTI INCR"}),
    ("cap-redis-s10-java-dup-ping", "java-dup", "redis", "S10", EQ("PING"), "redis-S10-ping", [], {}),
    ("cap-redis-s10-node-cur-ping", "node-redis-cur-legacy", "redis", "S10", EQ("PING"), "redis-S10-ping", [], {}),
    ("cap-redis-s11-java-legacy-memory", "java-legacy", "redis", "S11", T("DOCTOR-BOGUS"), "redis-S11-error", [], {}),
    ("cap-redis-s11-node-era-dup-memory", "node-redis-era-dup", "redis", "S11", T("DOCTOR-BOGUS"), "redis-S11-error", [], {}),

    # ---- captured_mongodb.json --------------------------------------------
    # pymongo capture_statement=True: python dict-repr with UNMASKED literals
    ("cap-mongo-s01-py-stmt-legacy", "python-mongo-stmt-legacy", "mongodb", "S01", T("find {'_id': 3}"), "mongodb-S01-py", [], {}),
    ("cap-mongo-s01-py-stmt-dup", "python-mongo-stmt-dup", "mongodb", "S01", T("find {'_id': 3}"), "mongodb-S01-py", [], {}),
    ("cap-mongo-s01-py-stmt-new", "python-mongo-stmt-new", "mongodb", "S01", T("find {'_id': 3}"), "mongodb-S01-py", [], {}),
    ("cap-mongo-s02-py-stmt-legacy", "python-mongo-stmt-legacy", "mongodb", "S02", T("'$gt': 25"), "mongodb-S02-py", ["25", "'b'"], {}),
    ("cap-mongo-s03-py-arity3", "python-mongo-stmt-legacy", "mongodb", "S03in", T("[1, 2, 3]}"), "mongodb-S03-inlist-py", ["[1, 2, 3]"], {}),
    ("cap-mongo-s05-py-arity20", "python-mongo-stmt-new", "mongodb", "S03in", T("19, 20]"), "mongodb-S03-inlist-py", ["19, 20"], {}),
    ("cap-mongo-s06-py-insert-one", "python-mongo-stmt-legacy", "mongodb", "S06ins", T("'ins-1'"), "mongodb-S06-insert-py", ["101", "'ins-1'"], {}),
    ("cap-mongo-s08-py-insert-many10", "python-mongo-stmt-new", "mongodb", "S06ins", T("'many-1'"), "mongodb-S06-insert-py", ["121", "'many-1'"], {}),
    ("cap-mongo-s09-py-update1", "python-mongo-stmt-dup", "mongodb", "S09", T("'price': 1}"), "mongodb-S09-update-py", ["False"], {}),
    ("cap-mongo-s09-py-update100", "python-mongo-stmt-dup", "mongodb", "S09", T("'price': 100}"), "mongodb-S09-update-py", ["100", "False"], {}),
    ("cap-mongo-s10-py-ping", "python-mongo-stmt-legacy", "mongodb", "S10", EQ("ping"), "mongodb-S10-ping-py", [], {}),
    ("cap-mongo-s11-py-badoperator", "python-mongo-stmt-new", "mongodb", "S11", T("$badOperator"), "mongodb-S11-error-py", [], {}),
    # pymongo default capture_statement=False: command-name-only degraded text
    ("cap-mongo-s01-opcoll-legacy", "python-mongo-legacy", "mongodb", "S01", EQ("find"), "mongodb-S01-opcoll", [], {}),
    ("cap-mongo-s01-opcoll-new", "python-mongo-new", "mongodb", "S01", EQ("find"), "mongodb-S01-opcoll", [], {}),
    # node driver-masked JSON command docs
    ("cap-mongo-s01-node-cur", "node-mongo-cur-legacy", "mongodb", "S01", T('"filter":{"_id":"?"}'), "mongodb-S01-node", [], {}),
    ("cap-mongo-s01-node-era-legacy", "node-mongo-era-legacy", "mongodb", "S01", T('"filter":{"_id":"?"}'), "mongodb-S01-node", [], {}),
    ("cap-mongo-s03-node-cur-arity3", "node-mongo-cur-legacy", "mongodb", "S03in", T('"$in":["?","?","?"]}'), "mongodb-S03-inlist-node", [], {}),
    ("cap-mongo-s06-node-cur-bare-doc", "node-mongo-cur-legacy", "mongodb", "S06ins", T('{"_id":"?","name"'), "mongodb-S06-insert-node", [], {"no_dialect": True}),
    ("cap-mongo-s09-node-cur-update", "node-mongo-cur-legacy", "mongodb", "S09", T('{"update"'), "mongodb-S09-update-node", [], {}),
    ("cap-mongo-s10-node-cur-ping", "node-mongo-cur-legacy", "mongodb", "S10", EQ('{"ping":"?"}'), "mongodb-S10-ping-node", [], {}),
    ("cap-mongo-s11-node-era-legacy", "node-mongo-era-legacy", "mongodb", "S11", T("$badOperator"), "mongodb-S11-error-node", [], {}),
]

# Shapes whose fingerprints legitimately coincide across engines get one shared class
# (the fingerprint hashes normalized text only; `o2_db_system` is a rollup dimension):
# redis `PING` and mongo `ping` case-fold to the same hashed text.
CLASS_ALIAS = {
    "redis-S10-ping": "probe-ping-command",
    "mongodb-S10-ping-py": "probe-ping-command",
}

FILE_OF = {
    "sql": "captured_sql.json",
    "redis": "captured_redis.json",
    "mongodb": "captured_mongodb.json",
    "degraded": "captured_degraded.json",
}


def family_of(shape):
    if shape.startswith("redis-"):
        return "redis"
    if shape.startswith("mongodb-"):
        return "mongodb"
    return "sql"


def strip_port(addr):
    if addr.startswith("["):
        end = addr.find("]")
        if end > 0:
            return addr[1:end]
    host, sep, port = addr.rpartition(":")
    if sep and port.isdigit():
        return host
    return addr


def resolve(attrs, names):
    for n in names:
        v = attrs.get(n)
        if v not in (None, ""):
            return str(v)
    return None


def expect_for(span, shape_key, overrides):
    qn, op, cls = SHAPES[shape_key]
    attrs = span.merged_attrs()
    instance = resolve(attrs, ["server.address", "net.peer.name"])
    return {
        "query_norm": qn,
        "operation": overrides.get("operation", op),
        "stmt_class": cls,
        "system": (resolve(attrs, ["db.system.name", "db.system"]) or "").lower() or None,
        "namespace": resolve(attrs, ["db.namespace", "db.name"]),
        "instance": strip_port(instance) if instance else None,
        "env": resolve(attrs, ["deployment.environment.name", "deployment.environment"]),
        "status_code": resolve(attrs, ["db.response.status_code"]),
        "user": resolve(attrs, ["db.user"]),
        "batch_multiplier": overrides.get("batch_multiplier"),
    }


def main():
    fixtures = {p.stem: load_fixture(p) for p in sorted(FIXTURES.glob("*.json"))}

    # -- attribution + dedup over every fixture ------------------------------
    rows = {}  # (fixture, engine, step, text, status_code) -> row
    stats = defaultdict(lambda: defaultdict(int))
    corrections = []
    for fx, spans in fixtures.items():
        by_id = {s.span_id: s for s in spans}
        wrappers = [s for s in spans if s.step_attr]
        for s in spans:
            if s.step_attr or not s.is_db:
                continue
            engine = s.system or "unknown"
            step, how = attribute_step(s, by_id, wrappers)
            canon = canonical_step(engine, s.text, s)
            stats[fx]["db_spans"] += 1
            stats[fx][how] += 1
            if canon and step and canon not in (step, "S03in", "S06ins", "CJMASK", "NOTEXT") \
                    and not (canon.startswith("S09") and step == "S09") \
                    and step not in ("S03", "S04", "S05", "S06", "S07", "S08"):
                corrections.append((fx, step, canon, (s.text or "")[:60]))
            key = (fx, engine, canon or step or "??", s.text or "", s.status_code_attr or "")
            row = rows.setdefault(key, {"span": s, "count": 0})
            row["count"] += 1
    print(f"fixtures: {len(fixtures)}; deduped (fixture, engine, step, text) rows: {len(rows)}")
    print(f"step corrections applied by the workload-pattern layer: {len(corrections)}")

    # -- curated case selection ----------------------------------------------
    out_files = defaultdict(list)
    seen_ids = set()
    per_cell = defaultdict(int)
    for case_id, fx, engine, step, pred, shape, literals, ov in CURATION:
        assert case_id not in seen_ids, f"duplicate case id {case_id}"
        seen_ids.add(case_id)
        matches = [
            r for (kfx, keng, kstep, ktext, kstatus), r in rows.items()
            if kfx == fx and keng == engine and kstep == step and pred(ktext)
            and (ov.get("require_status") is None or kstatus == ov["require_status"])
        ]
        if ov.get("require_status") is None:
            # prefer the non-status variant when both exist (e.g. S12 rows)
            no_status = [r for r in matches if not r["span"].status_code_attr] or matches
            # keep deterministic: shortest text first, then earliest span start
            matches = sorted(no_status, key=lambda r: (len(r["span"].text or ""), r["span"].start))
        if not matches:
            sys.exit(f"CURATION MISS: {case_id} ({fx}, {engine}, {step})")
        span = matches[0]["span"]
        case = {
            "id": case_id,
            "input": {"attrs": span.merged_attrs(), "span_kind": span.kind},
            "expect": expect_for(span, shape, ov),
            "fingerprint_class": CLASS_ALIAS.get(shape, shape),
            "literals": literals,
            "source": f"tests/dbm-capture/fixtures/{fx}.json",
        }
        if not ov.get("no_dialect"):
            case["dialect"] = DIALECT[engine]
        out_files[FILE_OF[family_of(shape)]].append(case)
        per_cell[(engine, fx)] += 1

    # -- go-pg unknown-bucket negative-shape case (no text, no operation) ----
    go = next(s for s in fixtures["go-pg-legacy.json".removesuffix(".json")]
              if s.is_db and s.raw.get("name") == "sql.conn.query")
    out_files[FILE_OF["degraded"]].append({
        "id": "cap-go-pg-disablequery-unknown-bucket",
        "dialect": "postgresql",
        "input": {"attrs": go.merged_attrs(), "span_kind": go.kind},
        "expect": {
            "query_norm": None, "operation": None, "stmt_class": "query",
            "system": "postgresql", "namespace": None, "instance": None,
            "env": "capture-env-a", "status_code": None, "user": None,
            "batch_multiplier": None,
        },
        "fingerprint_class": "postgresql-S01-unknown",
        "literals": [],
        "source": "tests/dbm-capture/fixtures/go-pg-legacy.json",
    })
    per_cell[("postgresql", "go-pg-legacy")] += 1

    for name, cases in sorted(out_files.items()):
        path = CORPUS / name
        path.write_text(json.dumps(cases, indent=2) + "\n")
        print(f"wrote {path.relative_to(CORPUS.parents[5])}: {len(cases)} cases")

    total = sum(len(c) for c in out_files.values())
    print(f"total captured cases: {total}")
    print("\ncases per engine x fixture cell:")
    for (engine, fx), n in sorted(per_cell.items()):
        print(f"  {engine:<12} {fx:<28} {n}")

    classes = defaultdict(int)
    for cases in out_files.values():
        for c in cases:
            classes[c["fingerprint_class"]] += 1
    print("\nfingerprint classes (members):")
    for cls, n in sorted(classes.items()):
        print(f"  {cls:<34} {n}")


if __name__ == "__main__":
    main()
