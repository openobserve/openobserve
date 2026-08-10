// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.
//
// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

//! Server-vantage DBM canonicalization (proof: `docs/___databsepages/dbm-server-vantage-proof.md`
//! §2.1 deadlocks, §2.2 blocking chains; recipes:
//! `docs/___databsepages/pipeline-recipes/postgres-deadlocks.md`,
//! `postgres-blocking-chain.md`, `mysql-deadlocks.md`).
//!
//! Server-vantage signals arrive as **logs** carrying receiver-local, vendor-prefixed field
//! names (`dl_waiter_pid`, `my_trx_side`, `blocked_pid`, …). Those names are
//! Development-stability OTel conventions plus our own recipe columns: they WILL shift with
//! collector releases. This module applies the design's **D1 philosophy** — resolve the vendor
//! vocabulary ONCE, at ingest, into stable `o2_dbm_*` columns — so the read API (`api.rs`) and
//! the UI never touch a raw receiver field.
//!
//! ## Why here (and not VRL, and not read-time)
//!
//! Three properties rule out the alternatives:
//!
//! 1. **Multi-entry assembly is stateful.** Postgres emits a deadlock's `ERROR: deadlock detected`
//!    line and its `DETAIL:` block as TWO separate log entries; MySQL 8.4 splits one InnoDB
//!    deadlock across a banner (`MY-012468`) plus one `MY-012469` entry per participant.
//!    Correlating those into one event needs cross-record state, which a per-record VRL transform
//!    cannot express.
//! 2. **The fingerprint must match the span path byte-for-byte.** Participant SQL is run through
//!    the SAME [`normalizer::normalize`] the span enrichment uses, so a deadlock JOINs to the query
//!    rows the UI already shows (proof §2.6). gxhash + the dialect lexer are not reachable from
//!    VRL.
//! 3. **Schema drift must be absorbed once.** Read-time normalization would spread the vendor
//!    vocabulary across every query and every UI component — precisely what D1 exists to prevent;
//!    when a receiver renames a field, one `FieldAliases` table changes here instead.
//!
//! The collector recipes remain the customer-facing artifact for *collection*; this module owns
//! *canonicalization*. Recipes stay declarative and version-pinned, and no customer edits VRL
//! when a receiver renames a column.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::{Dialect, normalizer, route_dialect};

// ─── Canonical column names (the stable read surface) ────────────────────────

/// Record kind discriminator: `deadlock` | `blocking`.
pub const O2_DBM_KIND: &str = "o2_dbm_kind";
/// Engine: `postgresql` | `mysql` | … (same vocabulary as `o2_db_system`).
pub const O2_DBM_ENGINE: &str = "o2_dbm_engine";
/// Database / schema name the event occurred in.
pub const O2_DBM_DATABASE: &str = "o2_dbm_database";
/// Server instance (host, port-stripped) — joins to `o2_db_instance` on spans.
pub const O2_DBM_INSTANCE: &str = "o2_dbm_instance";
/// Event time in microseconds.
pub const O2_DBM_TIMESTAMP: &str = "o2_dbm_timestamp";
/// Raw receiver body, always retained (schemas are Development-stability: keep the evidence).
pub const O2_DBM_RAW: &str = "o2_dbm_raw";

// deadlock-specific
/// PID/thread the engine chose to abort.
pub const O2_DBM_VICTIM_PID: &str = "o2_dbm_victim_pid";
/// Assembled participant array (see [`Participant`]).
pub const O2_DBM_PARTICIPANTS: &str = "o2_dbm_participants";
/// Count of participants — cheap ranking column so the UI need not unpack the array.
pub const O2_DBM_PARTICIPANT_COUNT: &str = "o2_dbm_participant_count";
/// MySQL only: side number InnoDB rolled back, from its separately-logged
/// `*** WE ROLL BACK TRANSACTION (N)` entry. Joined to participants at read time.
pub const O2_DBM_VICTIM_SIDE: &str = "o2_dbm_victim_side";

// blocking-specific
pub const O2_DBM_BLOCKED_PID: &str = "o2_dbm_blocked_pid";
pub const O2_DBM_BLOCKED_APP: &str = "o2_dbm_blocked_app";
pub const O2_DBM_BLOCKED_QUERY: &str = "o2_dbm_blocked_query";
pub const O2_DBM_BLOCKED_FINGERPRINT: &str = "o2_dbm_blocked_fingerprint";
pub const O2_DBM_BLOCKING_PID: &str = "o2_dbm_blocking_pid";
pub const O2_DBM_BLOCKING_APP: &str = "o2_dbm_blocking_app";
pub const O2_DBM_BLOCKING_QUERY: &str = "o2_dbm_blocking_query";
pub const O2_DBM_BLOCKING_FINGERPRINT: &str = "o2_dbm_blocking_fingerprint";
pub const O2_DBM_WAIT_EVENT_TYPE: &str = "o2_dbm_wait_event_type";
pub const O2_DBM_WAIT_EVENT: &str = "o2_dbm_wait_event";
pub const O2_DBM_WAIT_SECONDS: &str = "o2_dbm_wait_seconds";

/// Every canonical field, for reservation against user-supplied keys (D1 condition 1).
pub const ALL_DBM_FIELDS: [&str; 22] = [
    O2_DBM_KIND,
    O2_DBM_ENGINE,
    O2_DBM_DATABASE,
    O2_DBM_INSTANCE,
    O2_DBM_TIMESTAMP,
    O2_DBM_RAW,
    O2_DBM_VICTIM_PID,
    O2_DBM_PARTICIPANTS,
    O2_DBM_PARTICIPANT_COUNT,
    O2_DBM_VICTIM_SIDE,
    O2_DBM_BLOCKED_PID,
    O2_DBM_BLOCKED_APP,
    O2_DBM_BLOCKED_QUERY,
    O2_DBM_BLOCKED_FINGERPRINT,
    O2_DBM_BLOCKING_PID,
    O2_DBM_BLOCKING_APP,
    O2_DBM_BLOCKING_QUERY,
    O2_DBM_BLOCKING_FINGERPRINT,
    O2_DBM_WAIT_EVENT_TYPE,
    O2_DBM_WAIT_EVENT,
    O2_DBM_WAIT_SECONDS,
    "o2_dbm_query_shape",
];

/// Record kind values.
pub const KIND_DEADLOCK: &str = "deadlock";
pub const KIND_BLOCKING: &str = "blocking";

/// Max stored query text per participant — same cap the span path applies to `o2_db_query_norm`.
const MAX_PARTICIPANT_QUERY: usize = 4096;

// ─── Canonical structures ────────────────────────────────────────────────────

/// One side of a deadlock cycle.
///
/// `fingerprint`/`query_norm` are computed with the SAME normalizer the span enrichment uses,
/// so a participant JOINs to `o2_db_fingerprint` on client spans (proof §2.6: both vantages
/// normalize a statement to byte-identical text).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Participant {
    /// Backend pid (Postgres) or MySQL thread id.
    pub pid: Option<i64>,
    /// Client `application_name` — the pivot back to a service in the trace store.
    pub app: Option<String>,
    pub user: Option<String>,
    /// Raw statement text as the engine logged it.
    pub query: Option<String>,
    /// Normalized (literal-free) statement text.
    pub query_norm: Option<String>,
    /// Cross-vantage join key — identical to the span path's `o2_db_fingerprint`.
    pub fingerprint: Option<String>,
    /// e.g. `ShareLock`, `lock_mode X`.
    pub lock_mode: Option<String>,
    /// e.g. `transaction 1430`, `test/accounts`.
    pub lock_target: Option<String>,
    /// Engine transaction id, when the engine reports one.
    pub transaction_id: Option<String>,
    /// True for the participant the engine rolled back.
    pub victim: bool,
    /// MySQL side number (`*** (N) TRANSACTION:`), the join key for the
    /// separately-logged rollback verdict.
    ///
    /// SERIALIZED, because the join happens at READ time: ingest canonicalizes
    /// one record at a time, so a side and the verdict naming it are written as
    /// different rows and only meet when the reader stitches them. Always
    /// `None` on Postgres, which names its victim inline.
    pub side: Option<i64>,
}

impl Participant {
    fn to_json(&self) -> Value {
        json!({
            "pid": self.pid,
            "app": self.app,
            "user": self.user,
            "query": self.query,
            "query_norm": self.query_norm,
            "fingerprint": self.fingerprint,
            "lock_mode": self.lock_mode,
            "lock_target": self.lock_target,
            "transaction_id": self.transaction_id,
            "victim": self.victim,
            // The join key for MySQL's separately-logged verdict — stored
            // because read-time stitching is where the join happens.
            "side": self.side,
        })
    }

    /// Rebuild from the stored JSON shape (the read path's inverse of [`to_json`]).
    pub fn from_json(v: &Value) -> Self {
        Participant {
            pid: v.get("pid").and_then(|x| x.as_i64()),
            app: str_field(v, "app"),
            user: str_field(v, "user"),
            query: str_field(v, "query"),
            query_norm: str_field(v, "query_norm"),
            fingerprint: str_field(v, "fingerprint"),
            lock_mode: str_field(v, "lock_mode"),
            lock_target: str_field(v, "lock_target"),
            transaction_id: str_field(v, "transaction_id"),
            victim: v.get("victim").and_then(|x| x.as_bool()).unwrap_or(false),
            side: v.get("side").and_then(|x| x.as_i64()),
        }
    }
}

fn str_field(v: &Value, key: &str) -> Option<String> {
    v.get(key)
        .and_then(|x| x.as_str())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
}

/// A canonicalized deadlock event.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DeadlockEvent {
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    pub victim_pid: Option<i64>,
    pub participants: Vec<Participant>,
    pub raw: Option<String>,
    /// MySQL only: the side number InnoDB rolled back, from
    /// `*** WE ROLL BACK TRANSACTION (N)`.
    ///
    /// InnoDB logs that verdict as its OWN entry, separate from the per-side
    /// `*** (N) TRANSACTION:` blocks, so it arrives as an event carrying only
    /// this field and no participants. `merge_mysql_deadlocks` joins it to the
    /// sides on `Participant::side` once the group is complete.
    pub victim_side: Option<i64>,
}

/// A canonicalized blocking sample (one blocked→blocking edge at one poll).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct BlockingSample {
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    pub blocked_pid: Option<i64>,
    pub blocked_app: Option<String>,
    pub blocked_query: Option<String>,
    pub blocked_fingerprint: Option<String>,
    pub blocking_pid: Option<i64>,
    pub blocking_app: Option<String>,
    pub blocking_query: Option<String>,
    pub blocking_fingerprint: Option<String>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    pub wait_seconds: Option<f64>,
    pub raw: Option<String>,
}

// ─── Receiver-field aliases (the ONLY place vendor names appear) ─────────────

/// Read the first present, non-empty value among `keys`, as a string.
fn first_str(rec: &Map<String, Value>, keys: &[&str]) -> Option<String> {
    for k in keys {
        match rec.get(*k) {
            Some(Value::String(s)) if !s.is_empty() => return Some(s.clone()),
            Some(Value::Number(n)) => return Some(n.to_string()),
            _ => {}
        }
    }
    None
}

/// Read the first present value among `keys` as an i64 — receivers frequently ship numeric
/// columns as STRINGS (`sqlqueryreceiver` `attribute_columns` are all text), so both forms parse.
fn first_i64(rec: &Map<String, Value>, keys: &[&str]) -> Option<i64> {
    for k in keys {
        match rec.get(*k) {
            Some(Value::Number(n)) => {
                if let Some(i) = n.as_i64() {
                    return Some(i);
                }
                if let Some(f) = n.as_f64() {
                    return Some(f as i64);
                }
            }
            Some(Value::String(s)) if !s.is_empty() => {
                if let Ok(i) = s.trim().parse::<i64>() {
                    return Some(i);
                }
                if let Ok(f) = s.trim().parse::<f64>() {
                    return Some(f as i64);
                }
            }
            _ => {}
        }
    }
    None
}

fn first_f64(rec: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
    for k in keys {
        match rec.get(*k) {
            Some(Value::Number(n)) => return n.as_f64(),
            Some(Value::String(s)) if !s.is_empty() => {
                if let Ok(f) = s.trim().parse::<f64>() {
                    return Some(f);
                }
            }
            _ => {}
        }
    }
    None
}

/// Engine detection. The recipes tag every record, but a bare filelog record may not be tagged,
/// so vendor-specific field presence is the fallback.
fn detect_engine(rec: &Map<String, Value>) -> Option<String> {
    if let Some(sys) = first_str(rec, &["db_system_name", "db_system"]) {
        return Some(super::canonical_system(&sys));
    }
    // The blocking recipes' `sqlqueryreceiver` rows carry ONLY the columns the recipe selects —
    // no `pg_*`/`my_*` field and no `db_system`. Without this the engine (and therefore the
    // `?system=` filter on /blocking) is null for every blocking sample, even though the recipe
    // tag names the engine unambiguously.
    match rec.get("o2_recipe").and_then(|v| v.as_str()) {
        Some("pg_blocking_chain") => return Some("postgresql".to_string()),
        Some("mysql_lock_waits") => return Some("mysql".to_string()),
        // MariaDB's blocking SQL is a copy of MySQL's, so the TAG is the only
        // thing distinguishing the two servers here.
        Some("mariadb_lock_waits") => return Some("mariadb".to_string()),
        Some("mssql_blocking_chain") | Some("mssql_deadlock") => {
            return Some("mssql".to_string());
        }
        _ => {}
    }
    if rec.contains_key("o2_pg_event")
        || rec
            .keys()
            .any(|k| k.starts_with("dl_") || k.starts_with("pg_"))
    {
        return Some("postgresql".to_string());
    }
    // MariaDB BEFORE MySQL: `maria_*` does not start with `my_`, so the order is
    // not strictly required today — but keeping it first documents the intent and
    // survives anyone shortening the prefix later. Mislabelling here is not
    // cosmetic: `stitch_mysql_deadlocks` groups on (engine, instance, database)
    // with "" defaults, so a MariaDB row calling itself "mysql" could merge with a
    // real MySQL deadlock and fabricate a cross-server event.
    if rec.contains_key("o2_maria_event") || rec.keys().any(|k| k.starts_with("maria_")) {
        return Some("mariadb".to_string());
    }
    if rec.contains_key("o2_my_event") || rec.keys().any(|k| k.starts_with("my_")) {
        return Some("mysql".to_string());
    }
    None
}

fn detect_database(rec: &Map<String, Value>) -> Option<String> {
    first_str(
        rec,
        &[
            "pg_db",
            "datname",
            "db_namespace",
            "schema_name",
            "my_db",
            "database",
        ],
    )
}

fn detect_instance(rec: &Map<String, Value>) -> Option<String> {
    first_str(
        rec,
        &[
            "server_address",
            "net_peer_name",
            "db_instance",
            "host_name",
            "instance",
        ],
    )
    .map(|a| super::strip_port(&a))
}

fn detect_timestamp(rec: &Map<String, Value>) -> Option<i64> {
    // `_timestamp` is resolved by the ingest path before canonicalization runs, so it is
    // trustworthy; the canonical name is an output only.
    first_i64(rec, &["_timestamp"])
}

// ─── Query fingerprinting (Deliverable D — the cross-vantage join) ───────────

/// Normalize a server-logged statement through the SAME path the span enrichment uses.
///
/// Returns `(query_norm, fingerprint)`. Per the design §3.2 failure rule, a lexer error yields
/// NO normalized text and NO fingerprint — raw text is never used as fallback normalized text,
/// and a fabricated fingerprint would join a deadlock to the wrong query row.
pub fn fingerprint_statement(text: &str, engine: Option<&str>) -> (Option<String>, Option<String>) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return (None, None);
    }
    let dialect = engine
        .and_then(route_dialect)
        .unwrap_or(Dialect::Postgresql);
    match normalizer::normalize(trimmed, dialect) {
        Ok(ns) => {
            let norm = ns
                .query_norm
                .as_deref()
                .map(|s| normalizer::truncate_at_boundary(s, MAX_PARTICIPANT_QUERY).to_string());
            (norm, Some(ns.fingerprint))
        }
        Err(_) => (None, None),
    }
}

// ─── Canonicalization entry points ───────────────────────────────────────────

/// Canonicalize a Postgres deadlock `DETAIL:` record (the entry that carries the wait cycle and
/// every participant's SQL) into a [`DeadlockEvent`].
///
/// **The multi-line trap** (proof §5.4): Postgres emits the `ERROR: deadlock detected` banner and
/// the `DETAIL:` block as two separate entries. A pipeline matching only "deadlock detected"
/// captures a banner with NO participants. This function therefore accepts the DETAIL-shaped
/// record (`dl_*` fields populated) and treats a participant-less record as a banner to skip.
pub fn canonicalize_pg_deadlock(rec: &Map<String, Value>) -> Option<DeadlockEvent> {
    let engine = detect_engine(rec).or_else(|| Some("postgresql".to_string()));
    // NOTE: the canonical `o2_dbm_*` names are deliberately NOT read as input aliases here (or
    // anywhere in this module). They are OUTPUTS. Accepting one as input would let a client that
    // POSTs a log record hand us a fabricated victim/pid and have it stored as engine-derived
    // truth — the logs path flattens caller keys directly. Derivation reads receiver fields only.
    let victim_pid = first_i64(rec, &["deadlock_victim_pid", "pg_pid"]);

    // The two edges of the wait cycle, as the filelog operators captured them.
    let edges: [(&str, &str, &str, &str); 2] = [
        ("dl_waiter_pid", "dl_lock_mode", "dl_lock_target", "dl_p1"),
        (
            "dl_waiter2_pid",
            "dl_lock_mode2",
            "dl_lock_target2",
            "dl_p2",
        ),
    ];
    let queries = ["dl_query_1", "dl_query_2"];

    let mut participants: Vec<Participant> = Vec::new();
    for (i, (pid_key, mode_key, target_key, stmt_pid_key)) in edges.iter().enumerate() {
        let pid = first_i64(rec, &[pid_key]);
        // `dl_query_N` is attributed to `dl_pN` when the operators captured the statement pid;
        // otherwise it falls back to positional order, which is how the DETAIL block prints.
        let stmt_pid = first_i64(rec, &[stmt_pid_key]).or(pid);
        let query = first_str(rec, &[queries[i]]);
        if pid.is_none() && query.is_none() {
            continue;
        }
        let (query_norm, fingerprint) = query
            .as_deref()
            .map(|q| fingerprint_statement(q, engine.as_deref()))
            .unwrap_or((None, None));
        participants.push(Participant {
            pid: pid.or(stmt_pid),
            app: first_str(rec, &["pg_app"]).filter(|_| i == 0),
            user: first_str(rec, &["pg_user"]).filter(|_| i == 0),
            query,
            query_norm,
            fingerprint,
            lock_mode: first_str(rec, &[mode_key]),
            lock_target: first_str(rec, &[target_key]),
            transaction_id: first_str(rec, &["pg_txid"]).filter(|_| i == 0),
            victim: pid.is_some() && pid == victim_pid,
            // Postgres names its victim inline on the DETAIL entry, so it needs
            // no cross-record side correlation.
            side: None,
        });
    }

    // A banner-only entry (no wait cycle, no SQL) is NOT a deadlock event — it is the trap.
    if participants.is_empty() {
        return None;
    }

    Some(DeadlockEvent {
        engine,
        database: detect_database(rec),
        instance: detect_instance(rec),
        timestamp: detect_timestamp(rec),
        victim_pid,
        participants,
        raw: first_str(rec, &["o2_deadlock_raw", "body", "pg_message"]),
        // Postgres names its victim pid inline on the DETAIL entry, so there is
        // no side number to correlate across records.
        victim_side: None,
    })
}

/// Canonicalize ONE MySQL `*** (N) TRANSACTION:` entry into a single-participant
/// [`DeadlockEvent`].
///
/// MySQL 8.4 splits a deadlock across a `MY-012468` banner plus one `MY-012469` entry per
/// participant, so each entry yields one participant; [`merge_mysql_deadlocks`] stitches the
/// sides back together by timestamp proximity.
pub fn canonicalize_mysql_deadlock(rec: &Map<String, Value>) -> Option<DeadlockEvent> {
    canonicalize_innodb_deadlock(rec, "mysql", "my")
}

/// MariaDB deadlocks — the SAME InnoDB record shape as MySQL, under a different
/// field prefix.
///
/// MariaDB prints the whole deadlock inside one clock second, but every physical
/// line carries its own timestamp, so `filelog` still cuts it into separate
/// entries: side 1, side 2 and the `WE ROLL BACK TRANSACTION (N)` verdict each
/// arrive as their own record. That is exactly MySQL's N+1 shape, so MariaDB owes
/// the same read-time stitch and this delegates to the shared implementation.
/// Verified against a real capture in `tests/dbm-server-vantage/captures/`.
pub fn canonicalize_mariadb_deadlock(rec: &Map<String, Value>) -> Option<DeadlockEvent> {
    canonicalize_innodb_deadlock(rec, "mariadb", "maria")
}

/// SQL Server deadlocks, from the T-SQL-shredded `system_health` graph.
///
/// ONE ROW PER PARTICIPANT, victim already resolved. SQL Server names its victim
/// inline in the same XML document, so the recipe decides `mssql_is_victim` at
/// query time and there is no cross-record verdict to stitch — unlike MySQL and
/// MariaDB. Each row is therefore a complete single-participant event that
/// `merge_mysql_deadlocks` must NOT touch; the sides of one deadlock are joined
/// by their shared `mssql_dl_ts`, which the shred copies onto every row.
pub fn canonicalize_mssql_deadlock(rec: &Map<String, Value>) -> Option<DeadlockEvent> {
    let spid = first_i64(rec, &["mssql_spid"]);
    let query = first_str(rec, &["mssql_query"]);
    // A row with neither identity nor statement carries nothing to show.
    spid?;

    let (query_norm, fingerprint) = query
        .as_deref()
        .map(|q| fingerprint_statement(q, Some("mssql")))
        .unwrap_or((None, None));

    // The shred emits "1"/"0"; treat anything else as not-the-victim rather than
    // guessing, so a recipe change can never silently flag every participant.
    let is_victim = first_str(rec, &["mssql_is_victim"]).as_deref() == Some("1");

    let participant = Participant {
        pid: spid,
        app: first_str(rec, &["mssql_app"]),
        user: first_str(rec, &["mssql_user"]),
        query,
        query_norm,
        fingerprint,
        lock_mode: first_str(rec, &["mssql_lock_mode"]),
        lock_target: first_str(rec, &["mssql_lock_target"]),
        transaction_id: None,
        victim: is_victim,
        side: None,
    };

    Some(DeadlockEvent {
        engine: Some("mssql".to_string()),
        database: first_str(rec, &["mssql_db"]).or_else(|| detect_database(rec)),
        instance: detect_instance(rec),
        timestamp: detect_timestamp(rec),
        // Already resolved — no side→pid post-pass needed.
        victim_pid: if is_victim { spid } else { None },
        participants: vec![participant],
        raw: first_str(rec, &["body"]),
        victim_side: None,
    })
}

/// Shared InnoDB deadlock canonicalizer for MySQL and MariaDB.
///
/// The two servers emit byte-identical InnoDB bodies; only the log envelope and
/// therefore the recipe's field prefix differ (`my_trx_side` vs
/// `maria_trx_side`). Parameterising the prefix keeps one implementation of the
/// subtle part — the participant-less verdict record — rather than two copies
/// that can drift apart.
fn canonicalize_innodb_deadlock(
    rec: &Map<String, Value>,
    engine_name: &str,
    prefix: &str,
) -> Option<DeadlockEvent> {
    let key = |suffix: &str| format!("{prefix}_{suffix}");
    let engine = Some(engine_name.to_string());
    let side = first_i64(rec, &[&key("trx_side")]);
    let victim_side = first_i64(rec, &[&key("victim_side")]);
    let thread = first_i64(rec, &[&key("trx_thread")]);
    let query = first_str(rec, &[&key("trx_query")]);

    // The ROLLBACK VERDICT arrives on its own entry.
    //
    // InnoDB writes `*** WE ROLL BACK TRANSACTION (N)` separately from the
    // per-side `*** (N) TRANSACTION:` blocks, so this record has a
    // `my_victim_side` and nothing else — no side, no thread, no statement.
    // Returning `None` here (as this did) threw the verdict away, which is why
    // no MySQL participant was ever flagged `victim` and the UI rendered an
    // empty "cancelled by the database" panel. Emit a participant-LESS event
    // instead; `merge_mysql_deadlocks` joins it to the sides.
    if side.is_none() && query.is_none() {
        return victim_side.map(|v| DeadlockEvent {
            engine,
            database: detect_database(rec),
            instance: detect_instance(rec),
            timestamp: detect_timestamp(rec),
            victim_side: Some(v),
            ..Default::default()
        });
    }

    let (query_norm, fingerprint) = query
        .as_deref()
        .map(|q| fingerprint_statement(q, Some(engine_name)))
        .unwrap_or((None, None));

    // NOT resolved here: on the real log shape `victim_side` is never present
    // on a side's own record, so any same-record comparison is dead code that
    // silently yields `false`. Resolution happens in `merge_mysql_deadlocks`,
    // the first place that sees every side of one deadlock together.
    let participant = Participant {
        pid: thread,
        app: first_str(rec, &[&key("trx_user"), &key("trx_host")]),
        user: first_str(rec, &[&key("trx_user")]),
        query,
        query_norm,
        fingerprint,
        lock_mode: first_str(rec, &[&key("lock_mode")]),
        lock_target: first_str(rec, &[&key("lock_table"), &key("lock_index")]),
        transaction_id: first_str(rec, &[&key("trx_id")]),
        victim: false,
        side,
    };

    Some(DeadlockEvent {
        engine,
        database: detect_database(rec),
        instance: detect_instance(rec),
        timestamp: detect_timestamp(rec),
        victim_pid: None,
        participants: vec![participant],
        raw: first_str(rec, &[&key("message"), "body"]),
        victim_side,
    })
}

/// Stitch per-participant MySQL deadlock entries into whole events.
///
/// InnoDB writes each `*** (N) TRANSACTION:` block as its own timestamped entry, all within a few
/// milliseconds. Entries whose timestamps fall inside `window_micros` of the group's first entry
/// merge into one event; a participant whose side number repeats starts a NEW group (that is a
/// second deadlock, not a duplicate side).
pub fn merge_mysql_deadlocks(
    mut events: Vec<DeadlockEvent>,
    window_micros: i64,
) -> Vec<DeadlockEvent> {
    events.sort_by_key(|e| e.timestamp.unwrap_or(0));
    let mut out: Vec<DeadlockEvent> = Vec::new();
    for ev in events {
        let ts = ev.timestamp.unwrap_or(0);
        let side_ids: Vec<Option<String>> = ev
            .participants
            .iter()
            .map(|p| p.transaction_id.clone())
            .collect();
        let merged_into = out.iter_mut().rev().find(|prev| {
            let prev_ts = prev.timestamp.unwrap_or(0);
            (ts - prev_ts).abs() <= window_micros
                && prev.engine == ev.engine
                // a repeated transaction id means a NEW deadlock, not another side
                && !prev
                    .participants
                    .iter()
                    .any(|p| side_ids.contains(&p.transaction_id))
        });
        match merged_into {
            Some(prev) => {
                if prev.victim_pid.is_none() {
                    prev.victim_pid = ev.victim_pid;
                }
                // The rollback verdict rides its own record, so whichever entry
                // carries it hands it to the group.
                if prev.victim_side.is_none() {
                    prev.victim_side = ev.victim_side;
                }
                if prev.database.is_none() {
                    prev.database = ev.database.clone();
                }
                if prev.instance.is_none() {
                    prev.instance = ev.instance.clone();
                }
                prev.participants.extend(ev.participants);
            }
            None => out.push(ev),
        }
    }

    // Resolve victimhood AFTER every group is closed, never during the merge.
    //
    // InnoDB logs `WE ROLL BACK TRANSACTION (N)` last — after both side blocks
    // — so at merge time the sides it refers to may not have arrived yet.
    // A post-pass is the only ordering that always sees the whole group.
    for ev in &mut out {
        let Some(victim_side) = ev.victim_side else {
            continue;
        };
        for p in &mut ev.participants {
            if p.side == Some(victim_side) {
                p.victim = true;
                if ev.victim_pid.is_none() {
                    ev.victim_pid = p.pid;
                }
            }
        }
    }
    out
}

/// Canonicalize a `pg_blocking_chain` / `mysql_lock_waits` recipe row into a [`BlockingSample`].
pub fn canonicalize_blocking(rec: &Map<String, Value>) -> Option<BlockingSample> {
    let engine = detect_engine(rec);
    // Receiver fields only — see the note in `canonicalize_pg_deadlock`: canonical `o2_dbm_*`
    // names are outputs, never inputs, so a caller cannot inject a blocking relationship.
    let blocked_pid = first_i64(rec, &["blocked_pid", "waiting_thread"]);
    let blocking_pid = first_i64(rec, &["blocking_pid", "blocking_thread"]);
    // An edge needs both ends; a half-populated row is not a blocking relationship.
    if blocked_pid.is_none() || blocking_pid.is_none() {
        return None;
    }

    let blocked_query = first_str(rec, &["blocked_query", "waiting_query", "body"]);
    let blocking_query = first_str(rec, &["blocking_query"]);
    let (blocked_norm, blocked_fp) = blocked_query
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));
    let (blocking_norm, blocking_fp) = blocking_query
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));

    Some(BlockingSample {
        engine,
        database: detect_database(rec),
        instance: detect_instance(rec),
        timestamp: detect_timestamp(rec),
        blocked_pid,
        blocked_app: first_str(rec, &["blocked_app", "blocked_user"]),
        blocked_query: blocked_norm.or(blocked_query),
        blocked_fingerprint: blocked_fp,
        blocking_pid,
        blocking_app: first_str(rec, &["blocking_app", "blocking_state"]),
        blocking_query: blocking_norm.or(blocking_query),
        blocking_fingerprint: blocking_fp,
        wait_event_type: first_str(rec, &["wait_event_type"]),
        wait_event: first_str(rec, &["wait_event"]),
        wait_seconds: first_f64(rec, &["blocked_wait_s", "wait_secs"]),
        raw: first_str(rec, &["body"]),
    })
}

// ─── Serialization to the canonical record ───────────────────────────────────

impl DeadlockEvent {
    /// The flattened canonical record written onto the log row.
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_DEADLOCK));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        if let Some(v) = self.victim_pid {
            out.insert(O2_DBM_VICTIM_PID.into(), json!(v));
        }
        // MySQL's rollback verdict must SURVIVE STORAGE.
        //
        // Ingest canonicalizes one record at a time, so the verdict entry
        // (`WE ROLL BACK TRANSACTION (N)`, which carries no side and no
        // statement) lands as its own row. Read-time stitching is the first
        // place it can meet the side rows, so the side number has to be on the
        // row — otherwise the victim is unknowable no matter what the merge
        // does. Scalar, per the non-basic-type constraint above.
        if let Some(v) = self.victim_side {
            out.insert(O2_DBM_VICTIM_SIDE.into(), json!(v));
        }
        // Stored as a JSON *string*, not a JSON array.
        //
        // The logs schema inferrer (`config::utils::schema`) accepts ONLY scalar values and
        // hard-errors with "Cannot infer schema from non-basic type value" on an array or object
        // — and that error rejects the WHOLE ingest batch, not just this record. Since
        // canonicalization runs after flattening (it must: it reads the flattened receiver
        // fields), a nested array here silently killed every batch containing a deadlock.
        // Readers parse it back via `participants_of`.
        out.insert(
            O2_DBM_PARTICIPANTS.into(),
            json!(
                Value::Array(self.participants.iter().map(|p| p.to_json()).collect()).to_string()
            ),
        );
        out.insert(
            O2_DBM_PARTICIPANT_COUNT.into(),
            json!(self.participants.len()),
        );
        // Query-shape ranking key: the sorted set of participant fingerprints identifies the
        // recurring lock-ordering bug across firings even when the victim alternates (proof
        // Demo 2 — the victim swapping is the SIGNATURE, so it must not split the group).
        if let Some(shape) = self.query_shape() {
            out.insert("o2_dbm_query_shape".into(), json!(shape));
        }
        insert_opt(&mut out, O2_DBM_RAW, self.raw.clone());
        out
    }

    /// Stable identity of the *statement pair* involved, independent of which side lost.
    pub fn query_shape(&self) -> Option<String> {
        let mut fps: Vec<&str> = self
            .participants
            .iter()
            .filter_map(|p| p.fingerprint.as_deref())
            .collect();
        if fps.is_empty() {
            return None;
        }
        fps.sort_unstable();
        fps.dedup();
        Some(fps.join("+"))
    }
}

impl BlockingSample {
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_BLOCKING));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        if let Some(p) = self.blocked_pid {
            out.insert(O2_DBM_BLOCKED_PID.into(), json!(p));
        }
        insert_opt(&mut out, O2_DBM_BLOCKED_APP, self.blocked_app.clone());
        insert_opt(&mut out, O2_DBM_BLOCKED_QUERY, self.blocked_query.clone());
        insert_opt(
            &mut out,
            O2_DBM_BLOCKED_FINGERPRINT,
            self.blocked_fingerprint.clone(),
        );
        if let Some(p) = self.blocking_pid {
            out.insert(O2_DBM_BLOCKING_PID.into(), json!(p));
        }
        insert_opt(&mut out, O2_DBM_BLOCKING_APP, self.blocking_app.clone());
        insert_opt(&mut out, O2_DBM_BLOCKING_QUERY, self.blocking_query.clone());
        insert_opt(
            &mut out,
            O2_DBM_BLOCKING_FINGERPRINT,
            self.blocking_fingerprint.clone(),
        );
        insert_opt(
            &mut out,
            O2_DBM_WAIT_EVENT_TYPE,
            self.wait_event_type.clone(),
        );
        insert_opt(&mut out, O2_DBM_WAIT_EVENT, self.wait_event.clone());
        if let Some(w) = self.wait_seconds {
            out.insert(O2_DBM_WAIT_SECONDS.into(), json!(w));
        }
        insert_opt(&mut out, O2_DBM_RAW, self.raw.clone());
        out
    }

    /// Rebuild a sample from a canonical stored row (the read path).
    pub fn from_record(row: &Value) -> Option<Self> {
        let blocked_pid = row.get(O2_DBM_BLOCKED_PID).and_then(as_i64_loose);
        let blocking_pid = row.get(O2_DBM_BLOCKING_PID).and_then(as_i64_loose);
        if blocked_pid.is_none() || blocking_pid.is_none() {
            return None;
        }
        Some(BlockingSample {
            engine: str_field(row, O2_DBM_ENGINE),
            database: str_field(row, O2_DBM_DATABASE),
            instance: str_field(row, O2_DBM_INSTANCE),
            timestamp: row
                .get(O2_DBM_TIMESTAMP)
                .and_then(as_i64_loose)
                .or_else(|| row.get("_timestamp").and_then(as_i64_loose)),
            blocked_pid,
            blocked_app: str_field(row, O2_DBM_BLOCKED_APP),
            blocked_query: str_field(row, O2_DBM_BLOCKED_QUERY),
            blocked_fingerprint: str_field(row, O2_DBM_BLOCKED_FINGERPRINT),
            blocking_pid,
            blocking_app: str_field(row, O2_DBM_BLOCKING_APP),
            blocking_query: str_field(row, O2_DBM_BLOCKING_QUERY),
            blocking_fingerprint: str_field(row, O2_DBM_BLOCKING_FINGERPRINT),
            wait_event_type: str_field(row, O2_DBM_WAIT_EVENT_TYPE),
            wait_event: str_field(row, O2_DBM_WAIT_EVENT),
            wait_seconds: row.get(O2_DBM_WAIT_SECONDS).and_then(|v| match v {
                Value::Number(n) => n.as_f64(),
                Value::String(s) => s.parse().ok(),
                _ => None,
            }),
            raw: str_field(row, O2_DBM_RAW),
        })
    }
}

/// Numbers arrive as JSON numbers from our own canonicalizer but as STRINGS when a record was
/// canonicalized by a VRL pipeline (all `sqlqueryreceiver` columns are text).
pub(crate) fn as_i64_loose(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

fn insert_opt(out: &mut BTreeMap<String, Value>, key: &str, val: Option<String>) {
    if let Some(v) = val.filter(|s| !s.is_empty()) {
        out.insert(key.to_string(), json!(v));
    }
}

/// Read `o2_dbm_participants` off a stored row, tolerating BOTH storage forms.
///
/// The canonical write path stores the array as a JSON **string** (the logs schema inferrer
/// rejects nested values — see [`DeadlockEvent::to_record`]). A row produced by a VRL pipeline,
/// or by an older build, may still carry a real JSON array, so both parse.
pub fn participants_of(row: &Value) -> Vec<Participant> {
    let parsed;
    let arr = match row.get(O2_DBM_PARTICIPANTS) {
        Some(Value::Array(a)) => Some(a),
        Some(Value::String(s)) => {
            parsed = serde_json::from_str::<Value>(s).ok();
            parsed.as_ref().and_then(|v| v.as_array())
        }
        _ => None,
    };
    arr.map(|a| a.iter().map(Participant::from_json).collect())
        .unwrap_or_default()
}

/// Apply server-vantage canonicalization to one flattened log record, in place.
///
/// This is the hook every logs ingest path must call, and it MUST run before
/// `refactor_map` so a user-defined schema listing the canonical columns keeps them
/// (D1 condition 2).
///
/// It first drops any client-supplied `o2_dbm_*` key: the logs paths flatten caller keys
/// straight onto the record, so without this a caller could POST a fabricated deadlock and
/// have it stored as engine-derived truth (D1 condition 1).
///
/// No-ops when db_monitoring is disabled, so callers need no `cfg` check of their own.
///
/// # Why a shared helper
///
/// The OTLP logs path (`logs/otlp.rs`) assembles records at THREE separate sites and the JSON
/// path (`logs/ingest.rs`) at one. The canonicalizer was originally inlined at the JSON site
/// only, which meant the shipped collector recipes — every one of which exports over OTLP to
/// `/v1/logs` — ingested raw `dl_*`/`my_*` fields and produced ZERO `o2_dbm_*` columns, so the
/// read endpoints returned nothing from real captured data. Centralizing the logic here means a
/// new ingest path gets it by calling one function.
pub fn apply_to_record(local_val: &mut Map<String, Value>) {
    if !config::get_config().db_monitoring.enabled {
        return;
    }
    for f in ALL_DBM_FIELDS {
        local_val.remove(f);
    }
    if let Some(canon) = canonicalize_record(local_val) {
        for (k, v) in canon {
            local_val.insert(k, v);
        }
    }
}

/// Canonicalize any server-vantage log record: dispatches on the recipe/event tags the collector
/// configs set. Returns the flattened `o2_dbm_*` fields to merge onto the record, or `None` when
/// the record is not a server-vantage DBM event.
///
/// This is the single ingest-side entry point (the logs analogue of [`super::enrich`]).
pub fn canonicalize_record(rec: &Map<String, Value>) -> Option<BTreeMap<String, Value>> {
    // Deadlocks — Postgres DETAIL entries and MySQL per-transaction entries.
    let is_pg_deadlock = rec.get("o2_pg_event").and_then(|v| v.as_str()) == Some("deadlock");
    let is_my_deadlock = rec.get("o2_my_event").and_then(|v| v.as_str()) == Some("deadlock");
    let is_maria_deadlock = rec.get("o2_maria_event").and_then(|v| v.as_str()) == Some("deadlock");
    if is_pg_deadlock {
        return canonicalize_pg_deadlock(rec).map(|e| e.to_record());
    }
    if is_my_deadlock {
        return canonicalize_mysql_deadlock(rec).map(|e| e.to_record());
    }
    if is_maria_deadlock {
        return canonicalize_mariadb_deadlock(rec).map(|e| e.to_record());
    }
    // MSSQL deadlocks arrive from a sqlquery recipe, not a filelog one, so they
    // are keyed on the recipe tag rather than an o2_*_event field.
    if rec.get("o2_recipe").and_then(|v| v.as_str()) == Some("mssql_deadlock") {
        return canonicalize_mssql_deadlock(rec).map(|e| e.to_record());
    }

    // Blocking chains — the sqlqueryreceiver recipes.
    //
    // Engine-agnostic by construction: `canonicalize_blocking` reads only the
    // recipe's aliased columns (`blocked_pid`, `blocking_query`, …), so a new
    // engine is a recipe that SELECTs those names plus a tag here — no new
    // parser. SQL Server's `sys.dm_exec_requests` join supplies all of them,
    // which is why mssql blocking works while mssql DEADLOCKS do not: those
    // arrive as an XML deadlock graph in the system_health session, a shape
    // nothing below can read yet.
    let recipe = rec.get("o2_recipe").and_then(|v| v.as_str()).unwrap_or("");
    if recipe == "pg_blocking_chain"
        || recipe == "mysql_lock_waits"
        || recipe == "mariadb_lock_waits"
        || recipe == "mssql_blocking_chain"
    {
        return canonicalize_blocking(rec).map(|s| s.to_record());
    }
    None
}
