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
//!    the SAME [`config::meta::db_normalizer::normalize`] the span enrichment uses, so a deadlock
//!    JOINs to the query rows the UI already shows (proof §2.6). gxhash + the dialect lexer are not
//!    reachable from VRL.
//! 3. **Schema drift must be absorbed once.** Read-time normalization would spread the vendor
//!    vocabulary across every query and every UI component — precisely what D1 exists to prevent;
//!    when a receiver renames a field, one `FieldAliases` table changes here instead.
//!
//! The collector recipes remain the customer-facing artifact for *collection*; this module owns
//! *canonicalization*. Recipes stay declarative and version-pinned, and no customer edits VRL
//! when a receiver renames a column.
//!
//! ## Module invariants
//!
//! Two invariants hold at every canonicalizer and every `to_record` writer in this module. They
//! are stated once here; the code below references them as "Invariant 1/2 (module docs)".
//!
//! 1. **Canonical `o2_dbm_*` names are OUTPUTS, never inputs.** Every canonicalizer reads only
//!    receiver/recipe vendor field names. Accepting a canonical name as an input alias would let a
//!    caller POSTing a log record (the logs paths flatten caller keys straight onto the record)
//!    hand us a fabricated event — a deadlock, a session, an executed plan — and have it stored as
//!    engine-derived truth. [`apply_to_record`] additionally strips every caller-supplied
//!    [`ALL_DBM_FIELDS`] member before canonicalization (D1 condition 1).
//! 2. **Every stored value is a SCALAR (X5 / D-B).** The logs schema inferrer
//!    (`config::utils::schema`) accepts only basic types and hard-errors with "Cannot infer schema
//!    from non-basic type value" on an array or object — and that error rejects the WHOLE ingest
//!    batch, not just the offending record. Anything tree- or list-shaped (participants, plans,
//!    blocker pids) is therefore stored as a JSON **string**, with a tolerant reader
//!    ([`participants_of`], [`plan_of`], [`blocking_pids_of`]) on the way back.

use std::collections::BTreeMap;

// ─── Canonical column names (the stable read surface) ────────────────────────
//
// The shared vocabulary — the 83-member `ALL_DBM_FIELDS`, every `O2_DBM_*` and
// `KIND_*` const, and the receiver-field parsing helpers — lives in `config` so
// `o2_enterprise` can reach it. Enterprise cannot depend on this crate (Cargo
// rejects the cycle), but both crates depend on `config`. Re-exported here so
// the ~250 existing `server_vantage::` call sites keep resolving unchanged.
//
// A glob re-export does not collide with items still defined locally — locals
// shadow globs — so `RESERVED_DBM_PREFIX`, `WarnDecision` and friends below are
// unaffected.
pub use config::meta::db_monitoring::*;
/// Deadlocks, blocking and table/index health are ENTERPRISE capabilities;
/// their canonicalizers and types live in
/// `o2_enterprise::enterprise::db_monitoring`. Re-exported at
/// their original `server_vantage::` paths so the existing `api.rs` call sites
/// resolve unchanged on an enterprise build. On OSS these names do not exist and
/// every use of them is `cfg`-gated off.
#[cfg(feature = "enterprise")]
pub use o2_enterprise::enterprise::db_monitoring::{
    blocking::{BlockingSample, canonicalize_blocking},
    deadlock::{
        DeadlockEvent, Participant, canonicalize_mariadb_deadlock, canonicalize_mssql_deadlock,
        canonicalize_mysql_deadlock, canonicalize_pg_deadlock, merge_mysql_deadlocks,
        participants_of,
    },
    table_stats::{
        IndexStatsSample, TableStatsSample, canonicalize_index_stats, canonicalize_table_stats,
    },
};
use serde_json::{Map, Value, json};

// ─── OTLP event name (W1) ────────────────────────────────────────────────────

/// Read the OTLP-derived event name off a record.
///
/// An empty value reads as absent: the producer loop only writes non-empty names, and
/// `Some("")` would make a nameless record match a catch-all dispatch arm as though it
/// were a receiver event.
pub fn event_name_of(rec: &Map<String, Value>) -> Option<&str> {
    rec.get(O2_EVENT_NAME)
        .and_then(|v| v.as_str())
        .filter(|s| !s.is_empty())
}

/// Identify a receiver event from its ATTRIBUTE SHAPE, for records that never had an
/// OTLP envelope (design D-A option A2).
///
/// [`apply_to_record`] is called from the JSON ingest path (`logs/ingest.rs`) as well as
/// the OTLP one, and a `/{org}/{stream}/_json` POST has no `EventName` — so shape is the
/// only discriminator that path can ever offer. Deliberately a FALLBACK, never an
/// override: upstream attribute names have moved twice in 14 releases, so a present
/// event name always wins (see [`resolve_event_name`]).
///
/// Keyed strictly on attributes that belong to exactly one event. `db.query.text` is
/// carried by BOTH events and by ordinary database logs, so it is never a discriminator.
///
/// **Postgres only.** MySQL records carry no `postgresql.*` attributes at all, so a
/// MySQL receiver event arriving on the JSON path cannot be classified by shape and
/// returns `None` — correctly, since guessing would route it to the wrong arm. MySQL
/// events are discriminated by the OTLP event name, or not at all.
///
/// **The `queryid` / `query_id` spelling split is load-bearing, not a typo.** Postgres
/// spells the same identifier two ways depending on the event: `postgresql.queryid` on
/// `top_query`, `postgresql.query_id` on `query_sample`. Only the underscored form is a
/// discriminator here; "normalising" the two spellings to one would silently reclassify
/// every `top_query` record as a `query_sample`.
pub fn sniff_event_name(rec: &Map<String, Value>) -> Option<&'static str> {
    // `postgresql.calls` is top_query-exclusive (a per-statement call counter), so it is
    // the strongest signal and takes precedence on a record carrying both.
    if rec.contains_key("postgresql_calls") {
        return Some(EVENT_TOP_QUERY);
    }
    // Per-session fields, present only on a sampled activity row. Note `query_id` with
    // the underscore — the `query_sample` spelling; `postgresql.queryid` (no underscore)
    // is top_query's, and is deliberately NOT matched here.
    if rec.contains_key("postgresql_state") || rec.contains_key("postgresql_query_id") {
        return Some(EVENT_QUERY_SAMPLE);
    }
    None
}

/// The event name for a record: the trusted OTLP value if present, else the shape sniff.
pub fn resolve_event_name(rec: &Map<String, Value>) -> Option<&str> {
    event_name_of(rec).or_else(|| sniff_event_name(rec))
}

// ─── W2 · Active sessions (`db.server.query_sample`) ─────────────────────────
//
// One sampled row from `pg_stat_activity` / `performance_schema`, canonicalized
// into the same `o2_dbm_*` namespace the deadlock and blocking paths use.
//
// Attribute names below are the MEASURED v0.158.0 wire shape (captures under
// `tests/dbm-server-vantage/captures/`), not the documented one. Where the two
// disagree the measurement wins — three of the columns an earlier draft
// specified (`state_change`, `duration_ms`, `client_addr`) do not exist on the
// wire at all, and reserving them would have shipped permanently-null columns.

/// The unblocked sentinel for `postgresql.blocking.pids`.
///
/// It is exactly `{}` — an EMPTY PG ARRAY LITERAL, not an empty string. The
/// template is `COALESCE(pg_blocking_pids(sa.pid)::TEXT, '{}')`, so the field is
/// always present and always non-empty. A rule testing for `""` sees a non-empty
/// string on every row and marks EVERY sampled session blocked.
const UNBLOCKED_PIDS: &str = "{}";

/// One sampled session (`db.server.query_sample`), canonicalized.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ActivitySample {
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    pub session_pid: Option<i64>,
    pub session_user: Option<String>,
    pub session_app: Option<String>,
    pub state: Option<String>,
    pub query_start: Option<String>,
    pub xact_start: Option<String>,
    pub wait_start: Option<String>,
    pub exec_time_ms: Option<f64>,
    pub wait_event_type: Option<String>,
    pub wait_event: Option<String>,
    pub wait_seconds: Option<f64>,
    pub server_query_id: Option<String>,
    pub query: Option<String>,
    pub fingerprint: Option<String>,
    /// Every blocker, in wire order. Empty means NOT BLOCKED.
    pub blocking_pids: Vec<i32>,
    pub lock_mode: Option<String>,
    pub lock_type: Option<String>,
    pub lock_relation: Option<String>,
    pub client_addr: Option<String>,
    pub client_host: Option<String>,
    pub client_port: Option<i64>,
    pub raw: Option<String>,
}

impl ActivitySample {
    /// Is this session waiting on another session?
    ///
    /// `blocking_pids` is the SOLE predicate. Deliberately not inferred from
    /// `wait_duration > 0` or a populated `lock.mode`: `bl` comes from a
    /// `LEFT JOIN LATERAL` on `pg_locks WHERE NOT granted`, so a session can hold
    /// an ungranted lock row while `pg_blocking_pids()` returns empty (a
    /// tuple-lock queue). One field, one meaning.
    pub fn is_blocked(&self) -> bool {
        !self.blocking_pids.is_empty()
    }

    /// Does [`Self::exec_time_ms`] describe a query that is STILL RUNNING?
    ///
    /// The same number means two different things depending on state: for a live
    /// session it is elapsed-so-far, for an idle one it is the duration of the
    /// LAST COMPLETED query. Rendering both in one column puts "running 40s and
    /// still going" beside "last query took 40s, now idle" — which demand
    /// opposite responses.
    ///
    /// Engine-aware by necessity: MySQL has no `active` state at all. Its
    /// observed states are `running`, `waiting` and `other`, so a predicate of
    /// `state == "active"` would report every live MySQL session as idle.
    pub fn duration_is_live(&self) -> bool {
        match self.state.as_deref() {
            // Postgres.
            Some("active") => true,
            // MySQL: a waiting session is running — it is blocked on a lock or
            // on IO, not idle.
            Some("running") | Some("waiting") => true,
            _ => false,
        }
    }

    /// The flattened canonical record written onto the log row.
    ///
    /// Every value is a SCALAR (Invariant 2, module docs). `blocking_pids` is
    /// the live risk here: it is a list, and the obvious encoding is a JSON
    /// array.
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_ACTIVITY));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        if let Some(p) = self.session_pid {
            out.insert(O2_DBM_SESSION_PID.into(), json!(p));
        }
        insert_opt(&mut out, O2_DBM_SESSION_USER, self.session_user.clone());
        insert_opt(&mut out, O2_DBM_SESSION_APP, self.session_app.clone());
        insert_opt(&mut out, O2_DBM_SESSION_STATE, self.state.clone());
        insert_opt(&mut out, O2_DBM_QUERY_START, self.query_start.clone());
        insert_opt(&mut out, O2_DBM_XACT_START, self.xact_start.clone());
        insert_opt(&mut out, O2_DBM_WAIT_START, self.wait_start.clone());
        if let Some(ms) = self.exec_time_ms {
            out.insert(O2_DBM_EXEC_TIME_MS.into(), json!(ms));
            // The LIVE duration is published only for a running session. For an
            // idle one this same number is the last-completed time, and
            // republishing it as a duration renders "running 859ms" beside a
            // session that has been idle in transaction for twenty minutes.
            if self.duration_is_live() {
                out.insert(O2_DBM_DURATION_MS.into(), json!(ms));
            }
        }
        insert_opt(
            &mut out,
            O2_DBM_WAIT_EVENT_TYPE,
            self.wait_event_type.clone(),
        );
        insert_opt(&mut out, O2_DBM_WAIT_EVENT, self.wait_event.clone());
        if let Some(w) = self.wait_seconds {
            out.insert(O2_DBM_WAIT_SECONDS.into(), json!(w));
        }
        insert_opt(
            &mut out,
            O2_DBM_SERVER_QUERY_ID,
            self.server_query_id.clone(),
        );
        insert_opt(&mut out, O2_DBM_ACTIVITY_QUERY, self.query.clone());
        insert_opt(&mut out, O2_DBM_FINGERPRINT, self.fingerprint.clone());
        if !self.blocking_pids.is_empty() {
            out.insert(
                O2_DBM_BLOCKING_PIDS.into(),
                store_blocking_pids(&self.blocking_pids),
            );
        }
        insert_opt(&mut out, O2_DBM_LOCK_MODE, self.lock_mode.clone());
        insert_opt(&mut out, O2_DBM_LOCK_TYPE, self.lock_type.clone());
        insert_opt(&mut out, O2_DBM_LOCK_RELATION, self.lock_relation.clone());
        insert_opt(&mut out, O2_DBM_CLIENT_ADDR, self.client_addr.clone());
        insert_opt(&mut out, O2_DBM_CLIENT_HOST, self.client_host.clone());
        if let Some(p) = self.client_port {
            out.insert(O2_DBM_CLIENT_PORT.into(), json!(p));
        }
        insert_opt(&mut out, O2_DBM_RAW, self.raw.clone());
        out
    }
}

/// Encode blocker pids for storage: a comma-joined SCALAR string (Invariant 2,
/// module docs — the `O2_DBM_PARTICIPANTS` precedent).
///
/// Comma-joined rather than the PG literal so the stored form is
/// engine-neutral and needs no brace-stripping on read.
pub fn store_blocking_pids(pids: &[i32]) -> Value {
    json!(
        pids.iter()
            .map(|p| p.to_string())
            .collect::<Vec<_>>()
            .join(",")
    )
}

/// Read blocker pids back off a stored row, tolerating both the stored scalar
/// and a raw PG array literal (a row produced by a VRL pipeline, or an older
/// build, may carry the wire form verbatim).
pub fn blocking_pids_of(row: &Value) -> Vec<i32> {
    match row.get(O2_DBM_BLOCKING_PIDS) {
        Some(Value::String(s)) => parse_blocking_pids(s),
        Some(Value::Number(n)) => n.as_i64().map(|v| vec![v as i32]).unwrap_or_default(),
        Some(Value::Array(a)) => a
            .iter()
            .filter_map(as_i64_loose)
            .map(|v| v as i32)
            .collect(),
        _ => Vec::new(),
    }
}

/// Parse a Postgres `int[]` literal (or our comma-joined storage form) into pids.
///
/// Braces are stripped FIRST, then emptiness is tested — the ordering is
/// load-bearing. `{}` is the unblocked sentinel and must yield no blockers;
/// testing emptiness before stripping sees a two-character string and reports a
/// blocked session.
///
/// Multiple blockers are normal (a lock queue). An element we cannot read is
/// DROPPED rather than failing the record: a receiver change that adds a
/// non-numeric element must not delete the session from the view entirely.
fn parse_blocking_pids(raw: &str) -> Vec<i32> {
    let inner = raw
        .trim()
        .trim_start_matches('{')
        .trim_end_matches('}')
        .trim();
    if inner.is_empty() {
        return Vec::new();
    }
    inner
        .split(',')
        .filter_map(|p| p.trim().parse::<i32>().ok())
        .collect()
}

/// Whether a MySQL `wait_type` names a LOCK wait, as opposed to I/O, a mutex or
/// the receiver's own non-instrument placeholders.
///
/// `mysqlreceiver` fills this from `events_waits_current.event_name`, whose
/// instruments are namespaced (`wait/lock/table/sql/handler`,
/// `wait/synch/mutex/...`, `wait/io/file/...`). Only the lock family answers the
/// question Blocked queries asks, so only it may contribute a wait duration.
///
/// `wait/synch/` is EXCLUDED even though it is contention: a mutex or rwlock is
/// internal server serialization with no session on the other side to name as
/// the blocker, so ranking it beside row-lock waits would put an un-actionable
/// row at the top of a page whose whole purpose is naming who to terminate.
///
/// The receiver also emits two values that are not instrument names at all —
/// `CPU` (the wait already ended) and `other`/`User sleep` (no wait row joined).
/// Neither is a wait being served, and neither starts with `wait/`, so the
/// prefix test rejects them without needing to enumerate them.
fn is_mysql_lock_wait(wait_type: Option<&str>) -> bool {
    wait_type.is_some_and(|w| {
        let w = w.trim().to_ascii_lowercase();
        // `wait/lock/` is the documented family root; MariaDB reports the same
        // namespace. Anchored, so a table named "wait/lock" inside some other
        // instrument's path cannot match.
        w.starts_with("wait/lock/")
    })
}

/// Canonicalize one `db.server.query_sample` row into an [`ActivitySample`].
///
/// Follows the module invariants (Invariant 1: vendor names in, canonical names
/// out only): returns `None` without a session identity, reuses the shared
/// detectors, runs statement text through the same normalizer the span path
/// uses, and prefers normalized text over raw.
pub fn canonicalize_query_sample(rec: &Map<String, Value>) -> Option<ActivitySample> {
    let engine = detect_engine(rec);

    // Session identity: PG backend pid, or the MySQL session/thread id. Without
    // one there is no session, and inventing an identity would fabricate a row
    // in the Activity table.
    let session_pid = first_i64(
        rec,
        &[
            "postgresql_pid",
            "mysql_session_id",
            "mysql_threads_thread_id",
            // SQL Server's SPID. Its absence here is what silently DROPPED
            // every SQL Server sample: sqlserverreceiver emits a complete
            // `db.server.query_sample` (session id, request status, wait type,
            // blocking spid, reads, cpu time), but with no key in this list the
            // `?` below bailed and the whole record was discarded. The Activity
            // tab was then empty on SQL Server for want of one field name, and
            // the rows arrived carrying no `o2_dbm_kind` at all.
            "sqlserver_session_id",
        ],
    )?;

    let query = first_str(rec, &["db_query_text"]);
    let (query_norm, fingerprint) = query
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));

    // The blocked-ness predicate, and the only one.
    //
    // SQL Server expresses it as a single scalar SPID rather than Postgres's
    // array, and uses 0 — not the `{}` literal — as its "not blocked"
    // sentinel. Both are normalised to the same list here so one rule reads
    // blocked-ness across every engine. A row whose blocker is itself is
    // discarded: SQL Server reports that for some intra-session waits, and
    // rendering "blocked by itself" in the Activity table is worse than saying
    // nothing.
    let blocking_pids = first_str(rec, &["postgresql_blocking_pids"])
        .filter(|p| p != UNBLOCKED_PIDS)
        .map(|p| parse_blocking_pids(&p))
        .or_else(|| {
            first_i64(rec, &["sqlserver_blocking_session_id"])
                .filter(|b| *b > 0 && *b != session_pid)
                // SPIDs are smallint in SQL Server, so this always fits; the
                // checked conversion is here so a malformed value is DROPPED
                // rather than wrapping into some other session's id.
                .and_then(|b| i32::try_from(b).ok())
                .map(|b| vec![b])
        })
        .unwrap_or_default();

    // Exec time. Postgres ships milliseconds on this event; MySQL ships no exec
    // time at all, only a `timer_wait` in SECONDS, which is converted here so the
    // `_ms` column always means what its name says.
    let exec_time_ms = first_f64(rec, &["postgresql_total_exec_time"])
        .or_else(|| {
            first_f64(rec, &["mysql_events_statements_current_timer_wait"]).map(|s| s * 1000.0)
        })
        // SQL Server ships `total_elapsed_time` already in milliseconds, so it
        // needs no conversion — unlike the MySQL branch above.
        .or_else(|| first_f64(rec, &["sqlserver_total_elapsed_time"]));

    Some(ActivitySample {
        engine,
        database: detect_database(rec),
        // The SERVER, from the resource attributes. Deliberately not
        // `network_peer_address`, which on a query_sample is the CLIENT's
        // address — using it labels every session with the client IP.
        // `mysql.instance.endpoint` precedes `service.instance.id` because the
        // latter is an opaque server UUID on MySQL, while the endpoint is the
        // addressable identity the `?instance=` filter is expressed in.
        instance: first_str(rec, &["mysql_instance_endpoint", "service_instance_id"])
            .map(|a| super::strip_port(&a))
            .or_else(|| detect_instance(rec)),
        timestamp: detect_timestamp(rec),
        session_pid: Some(session_pid),
        session_user: first_str(rec, &["user_name"]),
        session_app: first_str(
            rec,
            &[
                "postgresql_application_name",
                "mysql_client_app",
                "sqlserver_client_app_name",
            ],
        ),
        // SQL Server carries TWO status columns and they answer different
        // questions: `request_status` describes the running request
        // (`running` / `suspended` / `runnable`) and is absent when the session
        // is idle; `session_status` describes the session itself (`running` /
        // `sleeping`). The request one is preferred because a suspended request
        // is the interesting state — it is the one waiting on a lock — and the
        // session-level value would report it as merely `running`.
        state: first_str(
            rec,
            &[
                "postgresql_state",
                "mysql_session_status",
                "mysql_threads_processlist_state",
                "sqlserver_request_status",
                "sqlserver_session_status",
            ],
        ),
        query_start: first_str(rec, &["postgresql_query_start", "sqlserver_query_start"]),
        // Transaction start is read INDEPENDENTLY of blocked-ness despite its
        // `blocking.*` namespace: measured, 784 of 1072 populated values are on
        // UNBLOCKED sessions, including all 261 `idle in transaction` ones —
        // which are never blocked and are precisely the bloat condition this
        // column exists to age.
        xact_start: first_str(rec, &["postgresql_blocking_transaction_start_time"]),
        wait_start: first_str(
            rec,
            &["postgresql_blocking_start_time", "sqlserver_blocking_start_time"],
        ),
        exec_time_ms,
        // The SHARED wait columns (D-D): one wait-event view reads across
        // activity and blocking alike.
        // SQL Server names the RESOURCE class it is waiting on
        // (`KEY` / `PAGE` / `OBJECT`) separately from the wait type
        // (`LCK_M_X`), which lines up with Postgres's type/event split.
        wait_event_type: first_str(
            rec,
            &["postgresql_wait_event_type", "sqlserver_wait_resource_type"],
        ),
        wait_event: first_str(
            rec,
            &["postgresql_wait_event", "mysql_wait_type", "sqlserver_wait_type"],
        ),
        // `0` is the COALESCE sentinel, not a measured wait — the numeric twin
        // of the `{}` trap above. It is present on all 5495 unblocked rows, so
        // storing it would pollute every AVG/percentile over
        // `o2_dbm_wait_seconds` with thousands of zero-wait sessions and flatten
        // the wait-time chart during a real incident. Note the receiver ships
        // WHOLE SECONDS, so sub-second lock waits round to 0 and are
        // indistinguishable from the sentinel — dropping both is the honest
        // reading of a field with that resolution.
        // UNITS DIFFER, and getting this wrong would misreport lock waits by
        // 1000x. Postgres's `blocking.wait_duration` is SECONDS; SQL Server's
        // `wait_time` is MILLISECONDS (measured: 11.839 on a row whose
        // `total_elapsed_time` is also 11.839 ms). The same `> 0.0` filter
        // applies to both — a zero wait is the COALESCE sentinel, not a
        // measurement.
        // MYSQL IS GATED ON THE WAIT CLASS, and that is the whole point of the
        // arm rather than an extra safeguard on it.
        //
        // Postgres and SQL Server publish a duration that is already specific
        // to a LOCK wait. MySQL's `events_waits_current.timer_wait` is the
        // current wait of ANY performance_schema instrument, so the same column
        // carries `wait/io/file/innodb/innodb_data_file` and
        // `wait/synch/mutex/...` alongside `wait/lock/...`. `wait_seconds` is
        // read only by Blocked queries — it ranks contention severity and picks
        // out the notably-longest waiter — so an ungated map would let a slow
        // disk read present as a lock wait and outrank a genuine blocker.
        //
        // `mysql_wait_type` is the instrument name the same sample already
        // carries, so the class is decided by the row itself, not inferred.
        wait_seconds: first_f64(rec, &["postgresql_blocking_wait_duration"])
            .or_else(|| first_f64(rec, &["sqlserver_wait_time"]).map(|ms| ms / 1000.0))
            .or_else(|| {
                is_mysql_lock_wait(first_str(rec, &["mysql_wait_type"]).as_deref())
                    .then(|| first_f64(rec, &["mysql_events_waits_current_timer_wait"]))
                    .flatten()
            })
            .filter(|w| *w > 0.0),
        server_query_id: first_str(
            rec,
            &[
                "postgresql_query_id",
                "mysql_events_statements_current_digest",
                // SQL Server's stable statement identity, the same value its
                // plan cache is keyed on.
                "sqlserver_query_hash",
            ],
        ),
        query: query_norm.or(query),
        fingerprint,
        blocking_pids,
        lock_mode: first_str(rec, &["postgresql_blocking_lock_mode"]),
        lock_type: first_str(rec, &["postgresql_blocking_lock_type"]),
        // `wait_resource` is SQL Server's nearest analogue: the concrete object
        // under contention ("KEY: 5:72057594045726720 (d123aa1a66e6)"), which
        // is what the lock columns exist to name.
        lock_relation: first_str(
            rec,
            &["postgresql_blocking_lock_relation", "sqlserver_wait_resource"],
        ),
        // Postgres ships the peer address under the OTel network.* convention;
        // MySQL under client.*. There is no `client_addr` attribute on either.
        // Postgres ships `172.21.0.6/32` (a CIDR from `inet`), MySQL ships the
        // bare `172.21.0.6`. Left as-is the same host renders two ways in one
        // table, defeating the column's "which host to go kill" purpose.
        client_addr: first_str(rec, &["client_address", "network_peer_address"])
            .map(|a| a.split('/').next().unwrap_or(&a).to_string())
            .filter(|a| !a.is_empty()),
        client_host: first_str(rec, &["postgresql_client_hostname"]),
        // Postgres spells "not a TCP connection" two ways: `-1` and `0`, both
        // paired with an empty peer address (measured: 10 and 203 records
        // respectively). Neither is a port — port 0 is not assignable — and
        // rendering either in a "which host to go kill" column invents an
        // endpoint that does not exist. Only a real port survives.
        client_port: first_i64(rec, &["client_port", "network_peer_port"]).filter(|p| *p > 0),
        raw: first_str(rec, &["body"]),
    })
}

// ─── Canonical structures ────────────────────────────────────────────────────

// ─── Receiver-field aliases (the ONLY place vendor names appear) ─────────────

// ─── Query fingerprinting (Deliverable D — the cross-vantage join) ───────────

// ─── Canonicalization entry points ───────────────────────────────────────────
//
// DEADLOCKS AND BLOCKING MOVED TO ENTERPRISE. `Participant`, `DeadlockEvent`,
// `BlockingSample`, the six deadlock canonicalizers, `merge_mysql_deadlocks`,
// `participants_of`, `canonicalize_blocking` and the whole chain assembler now
// live in `o2_enterprise::enterprise::db_monitoring::{deadlock, blocking,
// chains}`. They are reached from [`canonicalize_record`] through the two
// `#[cfg(feature = "enterprise")]` hooks, at exactly the positions their arms
// occupied, and re-exported from this module's parent so existing `api.rs` call
// sites resolve unchanged on an enterprise build.
//
// The shared vocabulary they consume (`first_str`, `detect_engine`,
// `fingerprint_statement`, the `O2_DBM_*` consts) is in `config`, which both
// crates depend on — enterprise cannot depend on `openobserve-core`.

// ─── Serialization to the canonical record ───────────────────────────────────

/// The tag on a record whose `o2_recipe` matches no dispatch arm, if any (W8).
///
/// A custom recipe is a supported thing to write — the blocking arms are
/// deliberately engine-agnostic so "a new engine is a recipe, not a parser".
/// But a tag we do not know produces NO `o2_dbm_*` at all, and every read
/// endpoint projects `ALL_DBM_FIELDS` and gates on `present_dbm_columns`, so
/// the row is invisible. Worse, the liveness probe counts a row with no
/// `o2_dbm_kind` as a `non_event_record` — the "the tail is running and none of
/// those lines was a deadlock" signal — so the read path answers the author's
/// empty page with an affirmative *wrong* story about a healthy quiet database.
///
/// Returning the tag is what lets [`apply_to_record`] distinguish
/// collecting-but-nothing-matched from collecting-but-I-could-not-read-your-recipe,
/// the same discipline as `plan_capture: "on"|"off"` on the plans endpoint.
///
/// Allocates only once a tag is actually unrecognized — which for every shipped
/// recipe and every non-DBM log record, i.e. essentially all traffic, is never.
pub fn take_unrecognized_recipe(rec: &Map<String, Value>) -> Option<String> {
    let tag = rec.get("o2_recipe").and_then(|v| v.as_str())?;
    // An empty tag is what a broken recipe TEMPLATE renders. It names nothing,
    // so a warning quoting `""` would send its author looking for a recipe by
    // that name.
    if tag.is_empty() || RECOGNIZED_RECIPES.contains(&tag) {
        return None;
    }
    Some(tag.to_string())
}

/// What this BUILD can do with an `o2_recipe` tag.
///
/// W8's job is to make sure the author of a recipe whose rows produce no
/// `o2_dbm_*` columns learns WHY. Before the enterprise split there were only
/// two answers — a canonicalizer claims the tag, or nobody does — and
/// [`take_unrecognized_recipe`] returning `None`/`Some` expressed both.
///
/// The split adds a third, and it is the dangerous one. Every one of the 11
/// [`RECOGNIZED_RECIPES`] is ENTERPRISE-owned, so on an OSS build all 13 tags
/// dispatch to nothing: the row canonicalizes to zero `o2_dbm_*` columns, no
/// read endpoint can see it, and the liveness probe counts it as a
/// `non_event_record` — the "the tail is running and none of those lines was an
/// event" signal. Left as `None` (i.e. "recognized, stay quiet"), the read path
/// would answer the author's empty page with an affirmative *wrong* story about
/// a healthy quiet database. That is exactly the failure W8 exists to prevent,
/// reintroduced by the split.
///
/// A `log::warn!` alone is not enough here: no log-capture harness exists in
/// this suite, so a warning-only fix is a behaviour no test can observe. This
/// enum is the assertable form, and it makes the W8 classification tests
/// behavioural on BOTH builds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecipeStatus {
    /// A canonicalizer in THIS build claims the tag.
    Handled,
    /// A shipped recipe whose canonicalizer is an Enterprise capability and is
    /// not compiled into this build. The rows ingest raw and produce no
    /// `o2_dbm_*` columns — a materially different answer from [`Self::Unknown`],
    /// because the recipe is correct and the fix is a licence, not an edit.
    EnterpriseOnly,
    /// No canonicalizer anywhere claims the tag — a custom or mistyped recipe.
    Unknown,
}

/// Every [`RECOGNIZED_RECIPES`] member whose canonicalizer lives in
/// `o2_enterprise`. All 13 of them: the four blocking recipes, `mssql_deadlock`,
/// and the eight table/index-stats recipes.
///
/// Kept as a predicate over the array rather than a second list, so it cannot
/// drift from it. `w8_every_recognized_recipe_is_enterprise_only_on_oss` pins
/// that all 13 members are covered, count included — if an OSS-owned recipe is
/// ever added to the array, that test fails and this function must grow a real
/// distinction rather than answering "every member".
fn is_enterprise_owned_recipe(tag: &str) -> bool {
    RECOGNIZED_RECIPES.contains(&tag)
}

/// Classify one `o2_recipe` tag for THIS build.
///
/// The empty tag is [`RecipeStatus::Unknown`] with the same reasoning as
/// [`take_unrecognized_recipe`]: it names nothing, so nothing is reported by
/// name — the caller decides, and [`apply_to_record`] uses
/// `take_unrecognized_recipe` (which filters the empty tag) for the warning.
pub fn classify_recipe(tag: &str) -> RecipeStatus {
    if !is_enterprise_owned_recipe(tag) {
        return RecipeStatus::Unknown;
    }
    #[cfg(feature = "enterprise")]
    {
        RecipeStatus::Handled
    }
    #[cfg(not(feature = "enterprise"))]
    {
        RecipeStatus::EnterpriseOnly
    }
}

/// Tags already warned about, so a 200-row/second recipe logs once, not
/// 200 times a second.
///
/// BOUNDED at [`UNRECOGNIZED_TAG_BUDGET`] entries: the tag is author-controlled
/// and unbounded, and this set is reachable from anyone who can POST a log
/// record. An unbounded set here would be a memory-growth vector driven by
/// caller-chosen strings — the same reason a metric LABELLED by tag was the
/// wrong answer for W8. Past the budget every further distinct tag shares one
/// generic warning, so the signal degrades instead of the process.
static WARNED_RECIPES: std::sync::LazyLock<std::sync::Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(Default::default);

/// How many DISTINCT unrecognized tags get named before the warning goes
/// generic. A real deployment has a handful of custom recipes; past this is
/// noise or abuse, and neither is worth unbounded memory.
const UNRECOGNIZED_TAG_BUDGET: usize = 32;

/// What [`warn_unrecognized_recipe`] should do about one tag, given what has
/// already been warned about.
///
/// Split out as a PURE function over the set because the cardinality bound is
/// the security-relevant half of W8 — the set is keyed by an author-controlled
/// string and reachable from anyone who can POST a log record — and a bound
/// that lives only inside a `static` is a guarantee no test can observe.
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum WarnDecision {
    /// Name this tag, and remember it.
    NameIt,
    /// Budget exhausted: warn once generically and remember only the sentinel.
    GenericOnce,
    /// Already covered — stay quiet.
    Silent,
}

/// The sentinel remembered once the budget is spent. Cannot collide with a real
/// tag: [`take_unrecognized_recipe`] never returns an empty tag.
const BUDGET_SPENT_SENTINEL: &str = "";

pub(crate) fn decide_warn(seen: &std::collections::HashSet<String>, tag: &str) -> WarnDecision {
    if seen.contains(tag) {
        return WarnDecision::Silent;
    }
    if seen.len() >= UNRECOGNIZED_TAG_BUDGET {
        // Do not grow the set past the budget, whatever the caller sends.
        if seen.contains(BUDGET_SPENT_SENTINEL) {
            return WarnDecision::Silent;
        }
        return WarnDecision::GenericOnce;
    }
    WarnDecision::NameIt
}

fn warn_unrecognized_recipe(tag: &str) {
    let Ok(mut seen) = WARNED_RECIPES.lock() else {
        return; // a poisoned mutex must never take an ingest path down
    };
    match decide_warn(&seen, tag) {
        WarnDecision::Silent => {}
        WarnDecision::GenericOnce => {
            seen.insert(BUDGET_SPENT_SENTINEL.to_string());
            log::warn!(
                "[DbMonitoring] more than {UNRECOGNIZED_TAG_BUDGET} distinct unrecognized \
                 `o2_recipe` tags seen; further tags will not be named individually"
            );
        }
        WarnDecision::NameIt => {
            seen.insert(tag.to_string());
            log::warn!(
                "[DbMonitoring] unrecognized `o2_recipe` tag {tag:?}: these records are stored \
                 raw and will NOT appear on any Database Monitoring page, because no \
                 canonicalizer claims that tag. Recognized tags are {RECOGNIZED_RECIPES:?}. If \
                 this is a custom recipe it needs a canonicalizer; if it is a typo, fix the tag \
                 in your collector config."
            );
        }
    }
}

/// Warn once per enterprise-only recipe tag on an OSS build.
///
/// Separate from [`warn_unrecognized_recipe`] because the two situations need
/// OPPOSITE remedies and conflating them misdirects the author: an unrecognized
/// tag means "fix your collector config", while this means "your collector
/// config is right and this capability is not in this build".
///
/// Shares the same warn-once set, so a 200-row/second table-stats recipe logs
/// once rather than 200 times a second. The set stays bounded for free here —
/// the tag must be one of the 11 [`RECOGNIZED_RECIPES`] members to reach this
/// function at all, so it is not an author-controlled growth vector the way the
/// unrecognized path is. The key is prefixed so the two paths cannot silence
/// each other for the same string.
#[cfg(not(feature = "enterprise"))]
fn warn_enterprise_only_recipe(tag: &str) {
    let Ok(mut seen) = WARNED_RECIPES.lock() else {
        return; // a poisoned mutex must never take an ingest path down
    };
    let key = format!("enterprise:{tag}");
    if !seen.insert(key) {
        return;
    }
    log::warn!(
        "[DbMonitoring] `o2_recipe` tag {tag:?} is an Enterprise capability. This is an \
         Open Source build, so these records are stored raw and will NOT appear on any Database \
         Monitoring page — the recipe itself is correct, and no collector-config change will fix \
         it. Deadlocks, Blocked Queries and Table Health require an Enterprise licence."
    );
}

/// The reserved namespace prefix. Every [`ALL_DBM_FIELDS`] member is either
/// under it or is exactly [`O2_EVENT_NAME`] —
/// `the_strip_prescan_covers_every_reserved_field` pins that coverage, so a
/// future field outside both would fail the test rather than silently dodge
/// the pre-scan below.
const RESERVED_DBM_PREFIX: &str = "o2_dbm_";

/// Fast pre-scan: could the reservation strip touch this record at all?
///
/// Prefix-based rather than per-member membership so one pass over the
/// record's OWN keys decides. A key that matches the prefix without being an
/// `ALL_DBM_FIELDS` member merely routes the record through the strip, which
/// still removes exact members only — behavior is identical, just via the
/// slow path.
pub(crate) fn has_reserved_dbm_key(rec: &Map<String, Value>) -> bool {
    rec.keys()
        .any(|k| k.starts_with(RESERVED_DBM_PREFIX) || k == O2_EVENT_NAME)
}

// ─── Read-path pruning: the `o2_dbm_kind` secondary index ────────────────────
//
// Every DBM read over the server-vantage stream is `WHERE _timestamp BETWEEN …
// AND o2_dbm_kind = '<one kind>'`, and until this seed landed NOTHING could
// skip rows for it. Measured on a stream carrying 2.84 M rows/hour of which
// 21.6 % were DBM records, `/badges` took 7.33 s against 0.14 s on an empty
// org — same binary, same query, same window.
//
// This seeds `o2_dbm_kind` as a SECONDARY INDEX (`index_fields`), i.e. a
// tantivy inverted index. Explicitly NOT full-text search, and the distinction
// is structural rather than cosmetic — `tantivy_utils::index_builder` takes
// `full_text_search_keys` and `index_fields` as two separate inputs and unions
// them into one tantivy file, but treats them differently:
//
//   * FTS fields are concatenated into ONE shared `_all` column tokenized with `O2_TOKENIZER`, so a
//     term match there cannot tell you WHICH field produced it;
//   * each `index_fields` member gets its OWN column, `.set_tokenizer("raw")` and `.set_fast(None)`
//     — one term per whole cell value, so `o2_dbm_kind = 'activity'` is an exact-match lookup on a
//     dedicated column.
//
// Adding the field to `full_text_search_keys` would therefore be both wrong
// (wrong tokenizer, wrong column) and REJECTED: `persist_stream_settings`
// refuses a field that is both FTS and secondary index. `index_fields` alone
// is the correct and only input.
//
// The other storage mechanisms were considered and do not apply:
//
//   * per-file column min/max statistics do not exist — `FileMeta` carries `min_ts`/`max_ts`/
//     `records`/sizes and nothing per-column;
//   * bloom filters would be near-useless here: a bloom answers "is this value CERTAINLY absent",
//     and `activity` is present in nearly every file, which is the case bloom filters are worst at.
//     `bloom_filter_fields` is deliberately NOT seeded. (The both-lists rule in `compaction::bloom`
//     gates only the `.bf` sidecar; the tantivy index needs `index_fields` alone, so declining the
//     bloom costs nothing on the index path.)
//   * parquet row-group pushdown skips row groups INSIDE a file already fetched and opened — it
//     reduces decode, never the file count.
//
// How the pruning actually lands: `is_expr_valid_for_index` accepts `=`, `!=`,
// `IN`, `NOT`, `AND`, `OR`, `str_match` and `match_all` over an indexed column
// (it rejects raw SQL `LIKE`, range comparisons and `IS NULL`). Most DBM SQL
// builders emit a plain top-level `o2_dbm_kind = '<literal>'`, which qualifies.
//
// The deadlock and blocking reads do NOT. When the A1 read-time fallback is
// active they widen that predicate to an OR across marker COLUMNS, and
// `is_expr_valid_for_index` recurses an `Or` with `&&` — so every operand must
// independently name an indexed column or the whole condition is rejected and
// no index is used at all. That is why the seed covers the marker columns too;
// see `server_stream_index_fields` for the derivation and the per-column
// justification.
// The resulting row bitmap becomes a parquet `ParquetAccessPlan`, applied BELOW
// any aggregate — so `GROUP BY` and `COUNT(DISTINCT …)` both benefit, including
// the activity badge's own aggregate, which a partition key could help only at
// file granularity.
//
// Precedent, and the reason this lives at ingest rather than in the rollup
// job: `crate::traces::time_index::ensure_index_stream` seeds the trace time
// index stream's `index_fields` from the ingest path, per request, reading the
// existing settings first and writing only when something is actually missing.
// This is the same shape for the same reason — the settings must be in place on
// the node about to write parquet, and only ingest knows the stream exists.
//
// ── KNOWN RISK: selectivity. Read this before claiming the fix works. ────────
//
// A tantivy index only pays off when the predicate is SELECTIVE. `guard_matched_rows`
// returns `Skipped` — falling back to DataFusion for that file — when matched
// rows exceed `inverted_index_skip_threshold` PERCENT of the file's rows; and if
// `cpu_num` files each blow that threshold, the whole tantivy step is abandoned
// for the entire file list and every filter is added back.
//
// The effective default threshold is **35%** (declared `default = 35`, and a
// configured 0 is rewritten to 35 at config load). On the measured stream
// `o2_dbm_kind='activity'` was ~21.6% of rows — UNDER 35, so it should index
// today, but it is the same order of magnitude as the cutoff and not a
// comfortable margin. A deployment whose activity share runs higher (a stream
// carrying little else, or a tightened threshold) will trip the guard, skip
// tantivy, and see NO improvement at all.
//
// So this is NOT an unconditional fix for the 7.33 s: it helps when the kind
// being queried is a small minority of the file, and degrades to exactly
// today's behavior when it is not. The rarer kinds (deadlock, blocking,
// explain) are the strongest case; `activity` is the weakest. Measure before
// claiming a win.

/// The canonical secondary-index field: the column every DBM read filters on.
///
/// Its values come from the `KIND_*` consts, a compile-time-bounded set pinned
/// by `idx_seed_kind_cardinality_stays_small` below.
///
/// This is necessary but NOT sufficient on its own — see
/// [`server_stream_index_fields`] for why the marker columns must be seeded
/// beside it.
pub const SERVER_STREAM_INDEX_FIELD: &str = O2_DBM_KIND;

/// Every field DBM seeds as a secondary index on a server-vantage stream.
///
/// # Why this is a SET and not just `o2_dbm_kind`
///
/// Seeding the kind column alone looks sufficient — every DBM read filters on
/// it — but it silently delivers NOTHING for the two kinds that need the index
/// most. `api.rs`'s `build_dbm_events_sql` does not emit a bare
/// `o2_dbm_kind = 'deadlock'` when the A1 read-time fallback is active; it
/// widens the predicate to an OR across marker COLUMNS:
///
/// ```sql
/// (o2_dbm_kind = 'deadlock' OR o2_pg_event = 'deadlock'
///  OR o2_my_event = 'deadlock' OR o2_maria_event = 'deadlock'
///  OR o2_recipe = 'mssql_deadlock')
/// ```
///
/// and the two presence probes (`build_raw_deadlock_presence_sql`,
/// `build_raw_blocking_presence_sql`) emit the marker OR with **no canonical
/// operand at all** — `WHERE (<markers>) LIMIT 1`.
///
/// `is_expr_valid_for_index`, in
/// `search/src/datafusion/optimizer/physical_optimizer/index.rs`, recurses
/// `Operator::And | Operator::Or` with `&&`. For an OR that means EVERY operand
/// must independently name an indexed column: one un-indexed marker rejects the
/// **entire** condition, no `IndexCondition` is built, and the read falls back
/// to a full scan. Seeding four of the five fields is therefore worth exactly
/// as much as seeding none of them.
///
/// That failure lands in the worst possible place. Deadlock and blocking are
/// the RARE kinds — the ones whose row share sits far below
/// `inverted_index_skip_threshold` (35%), where a tantivy index actually pays
/// off. The common kinds are already past that cutoff (`statement` was measured
/// at 50.4% of rows) and gain nothing from the index either way. So the kinds
/// the single-field seed helped were precisely the kinds that needed no help.
///
/// # Why exactly these fields, and no others
///
/// Derived programmatically from [`DEADLOCK_MARKERS`] and [`BLOCKING_MARKERS`]
/// — the same arrays `RawDeadlockFallback::marker_terms` and
/// `RawBlockingFallback::marker_terms` build the OR operands from — so the
/// seeding list cannot drift from the detection lists. A fifth engine added
/// there is seeded automatically rather than silently de-optimizing the page.
///
/// The union collapses to FIVE fields, because the two marker arrays are
/// deliberately different shapes:
///
/// | Field | Justified by |
/// |---|---|
/// | `o2_dbm_kind` | the canonical operand of every DBM read |
/// | `o2_pg_event` | `DEADLOCK_MARKERS` — Postgres deadlocks (filelog) |
/// | `o2_my_event` | `DEADLOCK_MARKERS` — MySQL deadlocks (filelog) |
/// | `o2_maria_event` | `DEADLOCK_MARKERS` — MariaDB deadlocks (filelog) |
/// | `o2_recipe` | `DEADLOCK_MARKERS` (MSSQL, `mssql_deadlock`) **and** all four `BLOCKING_MARKERS` values |
///
/// `BLOCKING_MARKERS` adds no column of its own: every blocking recipe is a
/// **sqlquery** recipe with no log line to tag, so all four engines key on
/// `o2_recipe` alone — one column with four values, unlike the deadlock array's
/// four columns. `o2_recipe` is shared between the two arrays and must appear
/// once, which is why this dedupes rather than concatenating.
///
/// Every extra indexed column costs tantivy work at parquet-write time and
/// bytes in the index file, so the set is kept closed: an addition here needs a
/// real OR operand in a real read query behind it.
///
/// # Seeding a column the stream does not have is SAFE
///
/// Worth stating explicitly, because it is easily conflated with a hazard that
/// looks identical and is not: naming a marker column in a SQL `WHERE` on a
/// stream that lacks it fails the whole query with a 400, which is why
/// `marker_terms` schema-gates every term it emits. **Writing a name into
/// `index_fields` is a different operation and carries no such requirement.**
///
/// `persist_stream_settings` validates only cross-list conflicts (FTS ∩ index,
/// bloom ⊄ index, partition key ∩ index, reserved names) and never checks
/// `index_fields` against the arrow schema. The write path filters absent
/// fields out before building the tantivy schema, so they simply produce no
/// column; the read path filters `index_fields` against the live schema before
/// it ever reaches `is_expr_valid_for_index`, and per-file misses set
/// `has_skipped_conditions`, which adds the DataFusion filter back and keeps
/// results correct. `traces::time_index::ensure_index_stream` already seeds
/// `trace_id`/`session_id` this way on streams that may hold no data at all.
///
/// So a deployment that has never run a MariaDB recipe carries an
/// `o2_maria_event` entry that indexes nothing, costs nothing, and becomes
/// live the day that recipe first ships.
pub fn server_stream_index_fields() -> Vec<&'static str> {
    let mut fields = Vec::with_capacity(1 + DEADLOCK_MARKERS.len() + BLOCKING_MARKERS.len());
    fields.push(SERVER_STREAM_INDEX_FIELD);
    for (col, _) in DEADLOCK_MARKERS.iter().chain(BLOCKING_MARKERS.iter()) {
        if !fields.contains(col) {
            fields.push(col);
        }
    }
    fields
}

/// Decide whether `settings` needs the DBM secondary index added, and add it.
///
/// Returns `true` when the caller must persist; `false` leaves `settings`
/// untouched. Split out from the async seed so the decision — which is the part
/// with the idempotency and don't-clobber obligations — is testable without a
/// schema store.
///
/// Properties this function is responsible for:
///
/// The fields it seeds are [`server_stream_index_fields`] — the canonical
/// `o2_dbm_kind` plus the marker columns of the deadlock/blocking OR
/// predicates. That doc explains why the set cannot be trimmed to the
/// canonical column alone. Each property below holds PER FIELD:
///
/// 1. **Idempotent.** A second call over settings this function already seeded returns `false`, so
///    a stream being written to a thousand times a second issues at most one settings write. A
///    field that is blocked and can never be added counts as no work, so a partly-blocked stream
///    settles too instead of writing forever.
/// 2. **Never clobbers the user.** Each field is APPENDED to whatever `index_fields` already holds;
///    every other field of `StreamSettings` is left exactly as read. A user who indexed their own
///    column keeps it, in its original position, and gains ours beside it.
/// 3. **Sets the index cutoff explicitly, for every field it adds.** `normalize_stream_settings`
///    stamps `index_fields_updated_at` only for fields it promotes out of `bloom_filter_fields`; a
///    field appended straight to `index_fields` gets NO timestamp and would inherit the stream-wide
///    `index_updated_at`, which on an old stream is its creation time. That would advertise the
///    index over files written long before it existed, whose parquet carries no index at all. We
///    stamp `now` per field so the cutoff means what it says — and never re-stamp a field that was
///    already there, which would un-index everything written since.
/// 4. **Declines PER FIELD when that field is already a PARTITION KEY or an FTS key.** The store's
///    rejections are per field but fail the whole settings write, so one conflicted field must not
///    take the rest down with it. The partition-key arm is the migration case, and it is a genuine
///    dead end rather than a case we can seed through — see below.
/// 5. **Completes a half-seeded stream.** A stream carrying only `o2_dbm_kind` — the shape the
///    single-field version of this code left behind — still has three un-indexed operands in its
///    deadlock OR and so still gets no index. The missing markers are added; the field already
///    present keeps its original cutoff.
///
/// **The migration case (a stream carrying the previous implementation's
/// partition key).** `persist_stream_settings` rejects any field that is both a
/// partition key and a secondary index, and the check is SYMMETRIC — it fails
/// the same way whichever list we add to. Worse, partition keys are effectively
/// APPEND-ONLY: a key omitted from an incoming settings write is not dropped,
/// it is marked `disabled: true` and KEPT, and it stays in `partition_keys`
/// where the intersection check still sees it. So a stream that was already
/// seeded by the partition-key implementation **cannot** be converted to the
/// index from this code path at all — not by removing the key, not by disabling
/// it. We detect that shape and stand down, logging once, rather than failing
/// the settings save on every batch forever. Such a stream keeps the partition
/// key it already has (which does prune, at file granularity) and simply does
/// not gain the index; converting it requires an operator to edit the stream
/// settings, which is the only place that can rewrite `partition_keys`.
pub fn needs_kind_index_field(settings: &mut config::meta::stream::StreamSettings) -> bool {
    // Every property below is decided PER FIELD, not once for the set. That is
    // what makes the multi-field form correct rather than merely longer:
    //
    //  * the conflict checks must be per field because the store's rejections are per field but
    //    fail the WHOLE settings write — including one conflicted field would take the other four
    //    down with it, forever, on every batch. Skipping only the conflicted one keeps the rest
    //    indexed and keeps the write legal.
    //  * the already-present check must be per field because of the UPGRADE case: a stream seeded
    //    by the single-field version of this code has `o2_dbm_kind` and nothing else, and its
    //    deadlock/blocking reads still get no index at all. Asking only about the first field would
    //    report "nothing to do" and leave it permanently half-seeded.
    //
    // Idempotency is preserved across both: a field that is present, or that is
    // blocked and can never be added, contributes no work — so a stream seeded
    // as far as it legally can be reports `false` forever, exactly as before.
    let mut added_any = false;
    for field in server_stream_index_fields() {
        if settings.index_fields.iter().any(|f| f == field) {
            // Already indexed — by us on an earlier batch, or by the user.
            // Either way we must not re-stamp its cutoff: moving it forward
            // would silently un-index every file written since it was seeded.
            continue;
        }
        // The store rejects a field that is both a secondary index and an FTS
        // key, and rejects one that is both a secondary index and a partition
        // key. The partition-key arm is the migration case: it cannot be
        // cleared from here (keys are append-only; omitting one only disables
        // it), so we stand down on that field rather than fail the save on
        // every batch forever.
        if settings.full_text_search_keys.iter().any(|f| f == field)
            || settings.partition_keys.iter().any(|p| p.field == field)
        {
            continue;
        }
        settings.index_fields.push(field.to_string());
        // See property 3: without this the cutoff falls back to stream creation
        // time and claims index coverage over files that have none.
        settings
            .index_fields_updated_at
            .insert(field.to_string(), config::utils::time::now_micros());
        added_any = true;
    }
    added_any
}

/// Does this batch contain at least one canonicalized DBM record?
///
/// The seed trigger is DATA-driven, not name-driven, and that is deliberate.
/// The read API defaults to the `dbm_server` stream but every endpoint accepts
/// a `stream` override, so a deployment may export the recipes anywhere; keying
/// the seed on the literal name would miss those and would also fire on a
/// user's own stream that merely happened to be called `dbm_server`. Asking
/// "did canonicalization actually stamp a kind onto anything in this batch"
/// answers exactly the question that matters — this stream carries DBM data, so
/// DBM reads will filter it by kind.
///
/// Cheap by construction: it stops at the first hit, and on the overwhelmingly
/// common case (a stream carrying no DBM data at all) it is one `get` per
/// record over a map the ingest loop has already built.
pub fn batch_has_dbm_records(records: &[(i64, Map<String, Value>)]) -> bool {
    records
        .iter()
        .any(|(_, rec)| rec.get(O2_DBM_KIND).and_then(Value::as_str).is_some())
}

/// Seed [`server_stream_index_fields`] as secondary indexes on a stream that is
/// receiving DBM records, so DBM reads can prune rows via tantivy instead of
/// scanning them.
///
/// Modelled on [`crate::traces::time_index`]'s `ensure_index_stream`: called
/// from the ingest path, once per (request, stream), it reads the existing
/// settings first and writes only when the field is genuinely absent. Every
/// failure mode is logged and swallowed — a settings write that does not
/// happen costs read latency, and must never cost the customer their ingest.
///
/// **Not retroactive, by construction.** Index files are written per-parquet at
/// the WAL→parquet move and again at compaction merge, so only files produced
/// AFTER this seed carry an index at all. The read side agrees:
/// `split_file_list_by_time_range` keeps a file on the index path only when
/// `file.meta.min_ts >= index_updated_at && file.meta.index_size > 0`, so
/// `index_fields_updated_at` is a "from here on" cutoff, never a backfill
/// trigger. Pre-seed files fall to the ordinary DataFusion scan and remain
/// fully queryable — old and new coexist in one window. The improvement
/// therefore arrives as pre-seed data ages out, which is why a before/after
/// measurement MUST use post-change data only.
///
/// **Untagged rows stay queryable.** Rows with no `o2_dbm_kind` — the
/// receiver-native events and the customer's ordinary log lines — simply
/// produce no term in the indexed column. A query with no `o2_dbm_kind`
/// predicate builds no `IndexCondition` for it and reads everything; a query
/// for `kind = 'activity'` matches only rows carrying that term. Nothing is
/// dropped.
///
/// **Reversible**, which the partition key it replaces was not. A partition key
/// is append-only — omitting it from a settings write marks it `disabled: true`
/// and keeps it forever, so seeding one was a one-way door per stream. An
/// `index_fields` entry can simply be removed by an operator, and the stream
/// reverts to full scans with no residue in its layout. That is a real
/// operational advantage of this approach.
pub async fn ensure_server_stream_index_field(org_id: &str, stream_name: &str) {
    use config::meta::stream::StreamType;

    let Some(settings) = infra::schema::get_settings(org_id, stream_name, StreamType::Logs).await
    else {
        // No settings row yet. `save_stream_settings` requires the stream to
        // exist, and on the very first batch it may not — the schema is
        // created later in this same request. Returning here costs one
        // unindexed batch and the next request seeds it, which is far cheaper
        // than racing schema creation.
        return;
    };
    let mut settings = (*settings).clone();
    if !needs_kind_index_field(&mut settings) {
        return;
    }
    if let Err(e) =
        schema::save_stream_settings(org_id, stream_name, StreamType::Logs, settings).await
    {
        // Warn, never fail: the ingest this is attached to must land either
        // way. A stream stuck without the index reads exactly as slowly as it
        // does today — the pre-fix status quo, not a regression.
        log::warn!(
            "[DbMonitoring] could not seed the {} secondary index fields on {org_id}/{stream_name}; \
             DBM reads on this stream will keep scanning every row: {e}",
            server_stream_index_fields().len(),
        );
    } else {
        log::info!(
            "[DbMonitoring] seeded secondary index fields {:?} on {org_id}/{stream_name}; \
             newly-written files will prune by kind, and the deadlock/blocking marker OR is now \
             index-eligible",
            server_stream_index_fields(),
        );
    }
}

pub fn apply_to_record(local_val: &mut Map<String, Value>) {
    if !config::get_config().db_monitoring.enabled {
        return;
    }
    // The strip is gated on a fast pre-scan: this function runs on EVERY log
    // record every customer ships, and essentially all of them carry no
    // reserved key at all — for those, one O(record keys) scan replaces 83
    // `remove` calls. A record that DOES carry a reserved-looking key takes
    // the identical strip path it always did (the strip still removes exact
    // `ALL_DBM_FIELDS` members only), so behavior is unchanged either way.
    // The event-name save/restore is skipped with it: `O2_EVENT_NAME` is
    // itself covered by the pre-scan, so a record the scan clears cannot
    // carry one.
    let event_name = if has_reserved_dbm_key(local_val) {
        // The event name has to survive the strip, because for some engines it is the ONLY
        // discriminator there is.
        //
        // `O2_EVENT_NAME` is an `ALL_DBM_FIELDS` member, so the loop below removes it along
        // with every other caller-settable key — correctly, since a forged value and a
        // receiver-derived one are byte-identical in a flattened map. But `canonicalize_record`
        // then has nothing to dispatch on and falls back to `sniff_event_name`, which matches
        // Postgres attribute shapes ONLY. MySQL records carry no `postgresql.*` attribute at
        // all, so every MySQL receiver event was dropped: measured 0 of 170 `top_query` and
        // 0 of 11 `query_sample` canonicalized in one window, against 373/373 and 242/242 for
        // Postgres on the same binary. Postgres survived purely by accident of the sniff.
        //
        // Carrying the value across the strip restores dispatch WITHOUT weakening the strip:
        // the name is re-read from the record we were handed, and the ingest paths still
        // overwrite it afterwards with the value taken from the OTLP envelope, which is what
        // makes the stored field trusted. This only decides which arm runs.
        let event_name = local_val
            .get(O2_EVENT_NAME)
            .and_then(|v| v.as_str())
            .filter(|s| !s.is_empty())
            .map(str::to_owned);
        for f in ALL_DBM_FIELDS {
            local_val.remove(f);
        }
        if let Some(name) = &event_name {
            local_val.insert(O2_EVENT_NAME.to_string(), Value::String(name.clone()));
        }
        event_name
    } else {
        None
    };
    let canon = canonicalize_record(local_val);
    // Put the map back the way the strip left it: the caller owns this field, and a
    // record we could not canonicalize must not keep a key the strip was meant to remove.
    if event_name.is_some() {
        local_val.remove(O2_EVENT_NAME);
    }
    if let Some(canon) = canon {
        for (k, v) in canon {
            local_val.insert(k, v);
        }
        return;
    }
    // W8 — nothing canonicalized. If a recipe TAG was the reason, say so once
    // per tag: the author's only other signal is an empty page that the
    // liveness probe is simultaneously describing as healthy.
    if let Some(tag) = take_unrecognized_recipe(local_val) {
        warn_unrecognized_recipe(&tag);
        return;
    }
    // The enterprise-split half of the same defect. On OSS every shipped recipe
    // tag is `EnterpriseOnly`: the recipe is CORRECT, and staying silent about
    // it would tell exactly the wrong story — "recognized" plus an empty page
    // plus a liveness probe reporting a healthy quiet database. The message
    // must therefore be distinct from the unrecognized-tag one: the fix is a
    // licence, not a collector-config edit.
    #[cfg(not(feature = "enterprise"))]
    if let Some(tag) = local_val.get("o2_recipe").and_then(|v| v.as_str())
        && classify_recipe(tag) == RecipeStatus::EnterpriseOnly
    {
        warn_enterprise_only_recipe(tag);
    }
}

/// Canonicalize any server-vantage log record: dispatches on the recipe/event tags the collector
/// configs set. Returns the flattened `o2_dbm_*` fields to merge onto the record, or `None` when
/// the record is not a server-vantage DBM event.
///
/// This is the single ingest-side entry point (the logs analogue of [`super::enrich`]).
pub fn canonicalize_record(rec: &Map<String, Value>) -> Option<BTreeMap<String, Value>> {
    // No per-signal gating: DBM is a single switch (`ZO_DB_MONITORING_ENABLED`,
    // checked by the CALLER before dispatch reaches this function), so every
    // arm below canonicalizes whenever DBM is enabled. The per-kind knobs that
    // used to gate the explain/statement/activity/top_query arms were removed
    // when the config collapsed to that one flag.
    //
    // Deadlocks — Postgres DETAIL entries and MySQL/MariaDB per-transaction
    // entries. ENTERPRISE-OWNED: the canonicalizers moved to
    // `o2_enterprise::enterprise::db_monitoring::deadlock`, and the hook below
    // reads exactly these three markers. They are named here, in the
    // dispatcher's own body, because the shipped filelog recipes stamp them and
    // `shipped_filelog_event_keys_and_backend_dispatch_agree` reads this
    // function's source to prove the two sides of that contract still agree —
    // a check that cannot reach across the repo boundary.
    //
    // The three lookups are performed HERE rather than only inside the hook so
    // that the marker set stays visible to the source-scraping contract test and
    // so an OSS build still cheaply distinguishes "this is an enterprise
    // deadlock record" from "this is not a DBM record at all".
    let is_enterprise_deadlock = rec.get("o2_pg_event").and_then(|v| v.as_str())
        == Some("deadlock")
        || rec.get("o2_my_event").and_then(|v| v.as_str()) == Some("deadlock")
        || rec.get("o2_maria_event").and_then(|v| v.as_str()) == Some("deadlock");
    // On OSS a deadlock marker ENDS dispatch with `None` rather than falling
    // through. That is the same behaviour the enterprise hook's
    // `ClaimedButUnparsed` produces, and it stops a deadlock record being
    // re-examined by the explain / statement arms below, which read the SAME
    // `o2_pg_event` key and would otherwise see a record that is not theirs.
    #[cfg(not(feature = "enterprise"))]
    if is_enterprise_deadlock {
        return None;
    }
    #[cfg(feature = "enterprise")]
    let _ = is_enterprise_deadlock;
    // Enterprise: deadlock markers. Sits exactly where the OSS deadlock arms
    // sat, so no record changes hands. On OSS this compiles away and these
    // records are not canonicalized — the raw fields still ingest as ordinary
    // log columns.
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::db_monitoring::Claim;
        match o2_enterprise::enterprise::db_monitoring::claim_deadlock_markers(rec) {
            Claim::Canonicalized(canon) => return Some(canon),
            // Mirrors today's `return canonicalize_pg_deadlock(rec).map(…)`
            // yielding None: a claimed record ends dispatch either way.
            Claim::ClaimedButUnparsed => return None,
            Claim::NotMine => {}
        }
    }
    // Real executed plans (W-E3) — auto_explain filelog records. Same tag
    // family as the deadlock arms above: filelog produces no OTLP EventName,
    // so the collector tag is the only discriminator there is.
    if rec.get("o2_pg_event").and_then(|v| v.as_str()) == Some("explain") {
        return canonicalize_pg_auto_explain(rec).map(|e| e.to_record());
    }
    // Completed-statement durations (W-S1) — `log_min_duration_statement`
    // filelog records. Same tag family as deadlock/explain: filelog produces
    // no OTLP EventName, so the collector tag is the discriminator.
    //
    // POSTGRES ONLY, deliberately: MySQL/MariaDB's per-execution equivalent
    // is the slow query log, which no shipped recipe tails (only error.log
    // is) and whose records span multiple lines (`# Time:` / `# User@Host:` /
    // `# Query_time:` headers), needing multi-line stitching nothing here
    // does yet. An arm without a producer would be dead code that reads as
    // coverage — add the MySQL arm together with a slow-log tailer recipe.
    if rec.get("o2_pg_event").and_then(|v| v.as_str()) == Some("statement_duration") {
        return canonicalize_pg_statement_duration(rec).map(|e| e.to_record());
    }
    // Enterprise: recipe-tag records (mssql deadlock, blocking, table/index
    // stats). Placed after `statement_duration` deliberately — hoisting it
    // above would let a dual-marker record (constructible on the untrusted
    // `/_json` path) change which arm claims it. Pinned by
    // `enterprise_hooks_do_not_shadow_oss_arms`.
    #[cfg(feature = "enterprise")]
    {
        use o2_enterprise::enterprise::db_monitoring::Claim;
        match o2_enterprise::enterprise::db_monitoring::claim_recipe_tags(rec) {
            Claim::Canonicalized(canon) => return Some(canon),
            Claim::ClaimedButUnparsed => return None,
            Claim::NotMine => {}
        }
    }
    // Every ENTERPRISE-OWNED sqlquery recipe tag, named here in the
    // dispatcher's own body: MSSQL deadlocks (a sqlquery recipe, not a filelog
    // one, so keyed on the tag), the four engine-agnostic blocking recipes, and
    // the six table/index-stats recipes. `claim_recipe_tags` above claims all
    // eleven.
    //
    // The literals are NOT redundant with the hook. `shipped_recipe_tags_and_
    // backend_dispatch_agree` reads THIS function's source to prove the shipped
    // collector recipes (`dbmShared.ts`) and the backend still tag the same set
    // — a check that cannot reach across the repo boundary, so deleting the
    // literals would make it silently pass over a shorter list.
    let recipe = rec.get("o2_recipe").and_then(|v| v.as_str()).unwrap_or("");
    let is_enterprise_recipe = recipe == "mssql_deadlock"
        || recipe == "pg_blocking_chain"
        || recipe == "mysql_lock_waits"
        || recipe == "mariadb_lock_waits"
        || recipe == "mssql_blocking_chain"
        // Table health (W10) and index health (W11) — one row per relation /
        // per index per 60 s. The three engines' recipes emit the SAME column
        // aliases (the `mariadb_lock_waits` precedent), so one enterprise
        // canonicalizer serves all three and `detect_engine` reads the engine
        // off the tag.
        || recipe == "pg_table_stats"
        || recipe == "mysql_table_stats"
        || recipe == "mariadb_table_stats"
        || recipe == "pg_index_stats"
        || recipe == "mysql_index_stats"
        || recipe == "mariadb_index_stats"
        || recipe == "mssql_table_stats"
        || recipe == "mssql_index_stats";
    // Same rule as the deadlock markers above: on OSS an enterprise-owned tag
    // ENDS dispatch rather than falling through to the arms below, which is
    // what the enterprise build's `Claim` does for the identical record.
    #[cfg(not(feature = "enterprise"))]
    if is_enterprise_recipe {
        return None;
    }
    #[cfg(feature = "enterprise")]
    let _ = is_enterprise_recipe;

    // Active sessions (W2) — LAST: the EventName-keyed arms sit below every
    // tag-keyed arm so a dual-marker record (constructible on the untrusted
    // `/_json` path) cannot change which arm claims it.
    if resolve_event_name(rec) == Some(EVENT_QUERY_SAMPLE) {
        return canonicalize_query_sample(rec).map(|s| s.to_record());
    }
    // Top queries + plans (W3).
    if resolve_event_name(rec) == Some(EVENT_TOP_QUERY) {
        return canonicalize_top_query(rec).map(|s| s.to_record());
    }
    None
}

// ─── W3 · Top queries + plan visibility (`db.server.top_query`) ──────────────
//
// One aggregated statement row from `pg_stat_statements` /
// `events_statements_summary_by_digest`, plus — when the receiver managed to
// EXPLAIN it — the statement's plan.
//
// **What this plan IS, stated once here so no reader has to infer it (D-H).**
// The receiver runs `SET plan_cache_mode = force_generic_plan`, PREPAREs the
// statement, and EXPLAINs it with every bind parameter bound to literal `null`
// (upstream `postgresqlreceiver/client.go:177-215`). So it is a GENERIC,
// NULL-BOUND, ESTIMATED plan for a query nobody executed:
//
//   * selectivity estimation collapses — `col = NULL` is never true;
//   * partition pruning cannot happen at plan time, so the UNPRUNED shape shows;
//   * Postgres's default `plan_cache_mode = auto` means production may well have run a CUSTOM plan
//     that this deliberately overrides.
//
// Consequences that bind the code below and everything reading it:
//
//   * A hash CHANGE is a real signal — a schema/stats change that moves the generic plan (an index
//     dropped, a table repartitioned) shows up reliably.
//   * A STABLE hash is NOT an all-clear. Generic plans are a pure function of (statement, schema,
//     stats) and so are stable by construction; the classic "planner flipped to a seq scan at
//     03:04" incident happens in the CUSTOM plan and may never move this hash. The signal is
//     false-negative-prone.
//   * Latency is NEVER attributed to a plan. Per-plan latency would come from `pg_stat_statements`
//     real executions while this plan was never executed, so correlating them fabricates causality.

// ─── W-E3 · Executed plans (auto_explain) — per-record plan provenance ───────

/// One aggregated statement (`db.server.top_query`), canonicalized.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TopQuerySample {
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    /// The engine's OWN statement id, verbatim: PG `queryid` (note the spelling
    /// — no underscore on this event) or the MySQL digest.
    pub server_query_id: Option<String>,
    pub query: Option<String>,
    /// Cross-vantage join key to CLIENT SPANS — a different identifier space
    /// from `server_query_id`, and both are needed (D-C).
    pub fingerprint: Option<String>,
    pub plan: Option<String>,
    pub plan_hash: Option<String>,
    pub calls: Option<i64>,
    pub rows: Option<i64>,
    /// SECONDS on this event. See [`O2_DBM_EXEC_TIME_S`].
    pub exec_time_s: Option<f64>,
    pub shared_blks_hit: Option<i64>,
    pub shared_blks_read: Option<i64>,
    pub shared_blks_dirtied: Option<i64>,
    pub shared_blks_written: Option<i64>,
    pub temp_blks_read: Option<i64>,
    pub temp_blks_written: Option<i64>,
    pub receiver_version: Option<String>,
    pub raw: Option<String>,
}

impl TopQuerySample {
    /// The flattened canonical record written onto the log row.
    ///
    /// Every value is a SCALAR (Invariant 2, module docs).
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_TOP_QUERY));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        insert_opt(
            &mut out,
            O2_DBM_SERVER_QUERY_ID,
            self.server_query_id.clone(),
        );
        insert_opt(&mut out, O2_DBM_ACTIVITY_QUERY, self.query.clone());
        insert_opt(&mut out, O2_DBM_FINGERPRINT, self.fingerprint.clone());

        // A HASH REQUIRES A PLAN, but a plan does NOT require a hash.
        //
        // These used to travel strictly together, on the reasoning that a plan
        // with no hash cannot be compared. That is true and still worth having
        // — but it silently DISCARDED every SQL Server plan: `plan_hash`
        // canonicalizes a plan by walking its JSON structure, and SQL Server
        // ships XML, so the hash is legitimately None and the plan went with
        // it. The receiver produced a perfectly readable showplan, the
        // canonicalizer read it, and this condition threw it away.
        //
        // A plan you can READ but not diff is worth strictly more than no plan
        // at all: plan comparison is one feature of this column, inspection is
        // the other, and only comparison needs the hash. Readers already gate
        // on the hash where they diff (see `plan_drift`), so an unhashed plan
        // renders and simply never claims to have drifted.
        // A BLANK or LITERAL-NULL plan is not a plan. The hash requirement used
        // to filter these as a side effect — `plan_hash` parses the text and
        // declines on anything structureless — so dropping that requirement
        // means filtering them HERE, explicitly, rather than leaning on a
        // second rule to do it. Storing `"   "` or `"null"` (which a VRL
        // pipeline or a transformed record really can deliver) puts a blank
        // plan tree in the UI beside a query that looks like it was explained.
        if let Some(plan) = self
            .plan
            .as_ref()
            .filter(|p| !p.trim().is_empty() && p.trim() != "null")
        {
            out.insert(O2_DBM_PLAN.into(), json!(plan));
            if let Some(hash) = self.plan_hash.as_ref() {
                out.insert(O2_DBM_PLAN_HASH.into(), json!(hash));
                out.insert(O2_DBM_PLAN_HASH_VERSION.into(), json!(PLAN_HASH_VERSION));
            }
            // E-C: provenance travels with the plan. This producer's plan is
            // the generic NULL-bound estimate, stated per record so a window
            // holding both producers never mislabels a row.
            out.insert(O2_DBM_PLAN_SOURCE.into(), json!(PLAN_SOURCE_GENERIC));
        }

        for (col, val) in [
            (O2_DBM_CALLS, self.calls),
            (O2_DBM_ROWS, self.rows),
            (O2_DBM_SHARED_BLKS_HIT, self.shared_blks_hit),
            (O2_DBM_SHARED_BLKS_READ, self.shared_blks_read),
            (O2_DBM_SHARED_BLKS_DIRTIED, self.shared_blks_dirtied),
            (O2_DBM_SHARED_BLKS_WRITTEN, self.shared_blks_written),
            (O2_DBM_TEMP_BLKS_READ, self.temp_blks_read),
            (O2_DBM_TEMP_BLKS_WRITTEN, self.temp_blks_written),
        ] {
            if let Some(v) = val {
                out.insert(col.into(), json!(v));
            }
        }
        if let Some(s) = self.exec_time_s {
            out.insert(O2_DBM_EXEC_TIME_S.into(), json!(s));
        }
        // Unconditional — see the const's docs.
        out.insert(O2_DBM_METRICS_ARE_DELTA.into(), json!(true));
        insert_opt(
            &mut out,
            O2_DBM_RECEIVER_VERSION,
            self.receiver_version.clone(),
        );
        insert_opt(&mut out, O2_DBM_RAW, self.raw.clone());
        out
    }
}

/// Canonicalize one `db.server.top_query` row into a [`TopQuerySample`].
///
/// Follows the module invariants (Invariant 1: a caller cannot POST a
/// fabricated plan): returns `None` without a statement identity, reuses the
/// shared detectors, and runs the statement text through the same normalizer
/// the span path uses.
pub fn canonicalize_top_query(rec: &Map<String, Value>) -> Option<TopQuerySample> {
    let engine = detect_engine(rec);

    // Statement identity. `postgresql.queryid` has NO underscore on this event —
    // `query_sample` spells the same identifier `postgresql.query_id`, and
    // reading the wrong one yields no id at all and silently breaks the join
    // between the two server-vantage events (X4/E5).
    let server_query_id = first_str(
        rec,
        &[
            "postgresql_queryid",
            "mysql_events_statements_summary_by_digest_digest",
        ],
    );
    let query = first_str(rec, &["db_query_text"]);
    // Without either we have an unnamed statement, and this whole feature is
    // about naming statements.
    if server_query_id.is_none() && query.is_none() {
        return None;
    }

    let (query_norm, fingerprint) = query
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));

    // E6: the plan key is ALWAYS present and is the empty string 159/275 times —
    // the EXPLAIN budget, un-EXPLAIN-able statements (COMMIT/BEGIN/DDL), and a
    // receiver bug that EXPLAINs the normalised text. `first_str` already treats
    // "" as absent, which is the correct reading: "no plan THIS interval", not
    // "no plan exists".
    // SQL Server ships an obfuscated XML SHOWPLAN under its own vendor prefix.
    // Its absence from this list is why SQL Server top queries carried no plan
    // while the receiver was emitting one: the attribute reached the stream
    // (`sqlserver.query_plan` is in the raw capture) and nothing read it.
    //
    // The three engines' plans are DIFFERENT FORMATS — Postgres JSON, MySQL
    // JSON, SQL Server XML — and are deliberately stored in one column anyway:
    // the reader wants "the plan for this statement", and a per-engine column
    // would be null on two engines out of three. `o2_dbm_plan_source` already
    // records which vantage produced it.
    let plan = first_str(
        rec,
        &[
            "postgresql_query_plan",
            "mysql_query_plan",
            "sqlserver_query_plan",
        ],
    );
    // Computed by US over the plan's structure. Deliberately NOT
    // `mysql.query_plan.hash`: measured, that attribute EQUALS the statement
    // digest, so it moves only when the statement moves — i.e. never, since the
    // statement is the grouping key (E8).
    let plan_hash = plan.as_deref().and_then(plan_hash);

    Some(TopQuerySample {
        engine,
        // MySQL top_query carries no `db.namespace` at all, so a MySQL top query
        // cannot be attributed to a database. Inventing one (from the instance,
        // say) would attribute rows to a database the record never named.
        database: detect_database(rec),
        instance: first_str(rec, &["mysql_instance_endpoint", "service_instance_id"])
            .map(|a| super::strip_port(&a))
            .or_else(|| detect_instance(rec)),
        timestamp: detect_timestamp(rec),
        server_query_id,
        query: query_norm.or(query),
        fingerprint,
        plan,
        plan_hash,
        calls: first_i64(
            rec,
            &[
                "postgresql_calls",
                "mysql_events_statements_summary_by_digest_count_star",
            ],
        ),
        // Postgres only — MySQL's top_query ships no row or block counters.
        rows: first_i64(rec, &["postgresql_rows"]),
        // SECONDS here, milliseconds on query_sample. MySQL's `sum_timer_wait`
        // is already seconds on this event.
        exec_time_s: first_f64(
            rec,
            &[
                "postgresql_total_exec_time",
                "mysql_events_statements_summary_by_digest_sum_timer_wait",
            ],
        ),
        shared_blks_hit: first_i64(rec, &["postgresql_shared_blks_hit"]),
        shared_blks_read: first_i64(rec, &["postgresql_shared_blks_read"]),
        shared_blks_dirtied: first_i64(rec, &["postgresql_shared_blks_dirtied"]),
        shared_blks_written: first_i64(rec, &["postgresql_shared_blks_written"]),
        temp_blks_read: first_i64(rec, &["postgresql_temp_blks_read"]),
        temp_blks_written: first_i64(rec, &["postgresql_temp_blks_written"]),
        receiver_version: first_str(rec, &["instrumentation_library_version"]),
        raw: first_str(rec, &["body"]),
    })
}

/// Read a stored plan back off a row, tolerating anything (D-B).
///
/// Mirrors `participants_of`: returns `None` on malformed input rather than
/// propagating an error, because a bad plan must never fail a read that would
/// otherwise succeed. A plan is supplementary detail on a query page; the query
/// is the point.
pub fn plan_of(row: &Value) -> Option<Value> {
    let text = row.get(O2_DBM_PLAN)?.as_str()?;
    serde_json::from_str(text).ok()
}

/// Structural hash of an EXPLAIN plan — `None` when there is no plan to hash.
///
/// **Structure only.** Costs and row estimates are re-derived on every ANALYZE,
/// so including them would report a plan change on essentially every collection
/// interval and the signal would be pure noise. Runtime outcomes
/// (`Workers Launched`, `Actual *`) vary with server load and are not properties
/// of the plan at all.
///
/// Included, per W3.2: `Node Type`, `Relation Name`, `Index Name`, `Join Type`,
/// `Scan Direction`, `Parallel Aware`, `Workers Planned`, `Strategy`,
/// `Partial Mode` — all verified to survive the receiver's obfuscation.
/// `Index Name` matters most: an index flip on the same Index Scan node is the
/// canonical plan regression, and excluding it makes that invisible.
///
/// Engine-agnostic by walking the document rather than a Postgres-specific
/// schema: MySQL's `EXPLAIN FORMAT=JSON` is a completely different shape
/// (`query_block` / `table_name` / `access_type`, no `Node Type` anywhere), and
/// a PG-shaped parser would silently give MySQL no drift detection at all.
///
/// Never panics on malformed input — this runs on the ingest hot path.
pub fn plan_hash(plan_json: &str) -> Option<String> {
    let doc: Value = serde_json::from_str(plan_json.trim()).ok()?;
    let mut canon = String::new();
    let mut fields = 0usize;
    walk_plan_structure(&doc, &mut canon, &mut fields);
    // Count STRUCTURAL FIELDS, not output length: the walker emits `[]`/`()`
    // delimiters for shape, so `[]`, `{}` and `[{"NotAPlan":1}]` all produce a
    // non-empty canonical form while describing no plan at all. Hashing those
    // mints a stable hash for "no plan", which every reader downstream would
    // treat as a real plan that never changes.
    if fields == 0 {
        // Parsed, but contained nothing structural — a bare scalar, `[]`, `{}`,
        // or a document whose keys we do not recognise. Hashing that would mint
        // a stable hash for "no plan", which reads downstream as a real plan.
        return None;
    }
    Some(crate::traces::db_monitoring::normalizer::fingerprint_hex(
        &canon,
    ))
}

/// The structural fields, in the order they are appended to the canonical form.
///
/// Ordering is fixed and explicit so the hash cannot drift with serde's key
/// ordering or a future map implementation.
const PLAN_STRUCTURAL_KEYS: [&str; 12] = [
    // Postgres.
    "Node Type",
    "Relation Name",
    "Index Name",
    "Join Type",
    "Scan Direction",
    "Parallel Aware",
    "Workers Planned",
    "Strategy",
    "Partial Mode",
    // MySQL: the same three roles under a different vocabulary — which node,
    // over which table, reached how.
    "table_name",
    "access_type",
    "key",
];

/// Append a node's structural identity to `out`, then recurse into children.
///
/// Walks EVERY nested object and array rather than following a known child key,
/// because the two engines nest differently: Postgres uses a `Plans` array,
/// MySQL uses named sub-objects (`ordering_operation`, `grouping_operation`,
/// `nested_loop`, …). Walking generically covers both and any future shape.
///
/// Structure is captured positionally — each node contributes its own fields and
/// a delimiter, and children are wrapped in parentheses — so tree SHAPE is part
/// of the hash. A child and a sibling are different plans, and a flattened bag
/// of node types would conflate them.
fn walk_plan_structure(node: &Value, out: &mut String, fields: &mut usize) {
    match node {
        Value::Object(map) => {
            for key in PLAN_STRUCTURAL_KEYS {
                if let Some(v) = map.get(key) {
                    out.push_str(key);
                    out.push('=');
                    match v {
                        // Escaped, so a delimiter INSIDE an identifier cannot
                        // forge a field boundary. Postgres identifiers are
                        // freely unicode and may contain any punctuation, so an
                        // unescaped join collides a relation literally named
                        // `a;Index Name=b` with the genuine pair
                        // (`Relation Name`=a, `Index Name`=b) — two different
                        // plans reporting as unchanged. Measured: they hashed
                        // identically before this escape.
                        Value::String(s) => {
                            out.push_str(&s.replace('\\', r"\\").replace(';', r"\;"))
                        }
                        other => out.push_str(&other.to_string()),
                    }
                    out.push(';');
                    *fields += 1;
                }
            }
            // Recurse in the map's own key order. `serde_json` preserves input
            // order only with `preserve_order`; BTreeMap ordering is
            // deterministic either way, and both are stable for a given input,
            // which is what the hash requires.
            out.push('(');
            for (_, v) in map {
                if v.is_object() || v.is_array() {
                    walk_plan_structure(v, out, fields);
                }
            }
            out.push(')');
        }
        Value::Array(items) => {
            out.push('[');
            for item in items {
                walk_plan_structure(item, out, fields);
            }
            out.push(']');
        }
        _ => {}
    }
}

// ─── W-E3 · Real executed plans (`auto_explain`) ─────────────────────────────
//
// One EXECUTION of one statement, from a Postgres `auto_explain` log entry the
// filelog recipe tagged `o2_pg_event = explain`. A sixth record kind, not a
// top_query variant: top_query rows are per-statement aggregates over a
// collection interval (their counters are flagged `o2_dbm_metrics_are_delta`),
// while an auto_explain record is ONE execution with its own real duration.
// Merging them would put a single-execution duration into a column family
// whose entire contract is "these are interval deltas".

/// Rewrap an auto_explain document into the receiver's plan shape, so the two
/// producers' hashes are comparable.
///
/// **Measured on the rig (T1, 2026-08-13, `corpus/auto_explain_rig.json`):**
/// [`plan_hash`] includes tree SHAPE — [`walk_plan_structure`] emits `[`/`]`
/// and `(`/`)` delimiters — so auto_explain's object wrapper
/// `{"Query Text":…, "Plan":{…}}` hashed `899486bea45213dd` while the
/// receiver's array wrapper `[{"Plan":{…}}]` for the SAME Seq Scan structure
/// hashed `4145e48d63cf272e`. Left unfixed, one logical plan would split into
/// two hashes and the executed-vs-generic comparison story would collapse.
/// The design doc's contingency applies: normalize the WRAPPER before hashing.
/// Rewrapping the `Plan` subtree as `[{"Plan":…}]` reproduced the receiver's
/// hash exactly, including on a 17-node nested tree.
///
/// The rewrapped STRING is also what gets stored in [`O2_DBM_PLAN`]: one
/// wrapper shape on disk means [`plan_of`], the API and the UI flattener all
/// read both producers identically. The `Plan` subtree keeps its `Actual *`
/// fields (they are not structural keys, so the hash ignores them and the UI
/// can render estimate-vs-actual). The top-level `Query Text` is dropped here
/// — it is stored separately as `o2_dbm_activity_query`.
pub fn rewrap_auto_explain_plan(doc: &Value) -> Option<String> {
    let plan = doc.get("Plan")?;
    if !plan.is_object() {
        return None;
    }
    serde_json::to_string(&json!([{ "Plan": plan }])).ok()
}

/// One executed plan (`auto_explain`), canonicalized.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct AutoExplainEvent {
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    /// Normalized statement text (falls back to the raw `Query Text`).
    pub query: Option<String>,
    /// Cross-vantage join key — SAME normalizer as top_query, proven on the
    /// rig to join auto_explain's raw text to `pg_stat_statements`' `$1` text
    /// (T1: literal, `$n`-bind and IN-list forms all landed on one
    /// fingerprint; `= ANY($1)` and >16 KB statements are the known
    /// divergences, which is why `server_query_id` below also exists).
    pub fingerprint: Option<String>,
    /// The rewrapped `[{"Plan":…}]` document — see [`rewrap_auto_explain_plan`].
    pub plan: String,
    pub plan_hash: String,
    /// Executed wall-clock milliseconds from the entry header.
    pub duration_ms: Option<f64>,
    /// Root-node `Actual Rows` — present only under `log_analyze = on`.
    pub rows_actual: Option<i64>,
    /// Postgres `queryid` from a `%Q` `log_line_prefix`, when configured —
    /// the exact join key that survives every text-normalization concern.
    pub server_query_id: Option<String>,
    pub raw: Option<String>,
}

impl AutoExplainEvent {
    /// The flattened canonical record. Every value is a SCALAR (Invariant 2,
    /// module docs).
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_EXPLAIN));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        insert_opt(&mut out, O2_DBM_ACTIVITY_QUERY, self.query.clone());
        insert_opt(&mut out, O2_DBM_FINGERPRINT, self.fingerprint.clone());
        insert_opt(
            &mut out,
            O2_DBM_SERVER_QUERY_ID,
            self.server_query_id.clone(),
        );
        // Plan + hash + version + provenance travel together (the top_query
        // precedent). This producer is the one that may claim execution.
        out.insert(O2_DBM_PLAN.into(), json!(self.plan));
        out.insert(O2_DBM_PLAN_HASH.into(), json!(self.plan_hash));
        out.insert(O2_DBM_PLAN_HASH_VERSION.into(), json!(PLAN_HASH_VERSION));
        out.insert(O2_DBM_PLAN_SOURCE.into(), json!(PLAN_SOURCE_AUTO_EXPLAIN));
        // Absent-not-zero: under `log_analyze = off` the plan is still real
        // but carries no duration and no actuals, and a fabricated 0 would be
        // read as "instant".
        if let Some(ms) = self.duration_ms {
            out.insert(O2_DBM_PLAN_DURATION_MS.into(), json!(ms));
        }
        if let Some(rows) = self.rows_actual {
            out.insert(O2_DBM_PLAN_ROWS_ACTUAL.into(), json!(rows));
        }
        insert_opt(&mut out, O2_DBM_RAW, self.raw.clone());
        out
    }
}

/// Canonicalize one `o2_pg_event = explain` filelog record into an
/// [`AutoExplainEvent`].
///
/// Follows the module invariants (Invariant 1: only collector-produced field
/// names — `ae_plan_json`, `ae_duration_ms`, `pg_query_id`, `pg_db`, … — are
/// read, so a `/_json` caller cannot hand us a fabricated executed plan;
/// Invariant 2: the plan is stored as a STRING): returns `None` without a plan
/// document (an auto_explain record with no plan is nothing), reuses the
/// shared detectors, and runs the statement text through the SAME normalizer
/// the span path uses.
pub fn canonicalize_pg_auto_explain(rec: &Map<String, Value>) -> Option<AutoExplainEvent> {
    // The recipe ships the whole auto_explain document as ONE string attr
    // (`ae_plan_json`) — never a nested value (Invariant 2). Query text, plan
    // tree and actuals are all read from it here, on the trusted side of the
    // strip.
    let doc_str = first_str(rec, &["ae_plan_json"])?;
    let doc: Value = serde_json::from_str(doc_str.trim()).ok()?;
    let plan = rewrap_auto_explain_plan(&doc)?;
    // A hash with no plan cannot be inspected; a plan whose structure the
    // walker cannot see (zero structural fields) must not mint a stable hash
    // for "no plan" — `plan_hash` already refuses, and we follow it.
    let plan_hash = plan_hash(&plan)?;

    let engine = detect_engine(rec).or_else(|| Some("postgresql".to_string()));
    let query = doc
        .get("Query Text")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let (query_norm, fingerprint) = query
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));

    // `%Q` prints 0 for statements whose queryid was not computed; a literal
    // "0" join key would glue every such statement together.
    let server_query_id = first_str(rec, &["pg_query_id"]).filter(|s| s != "0");

    // Root-node actuals only — the per-node values stay inside the plan
    // string (extracting them into columns re-creates the X5 hazard for no
    // read-path benefit).
    let rows_actual = doc
        .get("Plan")
        .and_then(|p| p.get("Actual Rows"))
        .and_then(|v| v.as_i64());

    Some(AutoExplainEvent {
        engine,
        database: detect_database(rec),
        // Same derivation chain as the receiver-event siblings (N5): the
        // collector's resource attributes first, then the shared detectors —
        // filelog records carry no receiver endpoint field, so without the
        // resource-attr fallback these rows stored NO instance and the
        // `?instance=` filter silently excluded every one of them.
        instance: first_str(rec, &["mysql_instance_endpoint", "service_instance_id"])
            .map(|a| super::strip_port(&a))
            .or_else(|| detect_instance(rec)),
        timestamp: detect_timestamp(rec),
        query: query_norm.or(query),
        fingerprint,
        plan,
        plan_hash,
        duration_ms: first_f64(rec, &["ae_duration_ms"]),
        rows_actual,
        server_query_id,
        raw: first_str(rec, &["body"]),
    })
}

// ─── W-S1 · Completed-statement durations (`log_min_duration_statement`) ─────
//
// One COMPLETED execution of one statement, from a Postgres session log line:
//
//   `duration: 63.149 ms  statement: SELECT count(*) ... WHERE ref = 'CUST-00879'`
//
// written by `log_min_duration_statement` when the statement finished. This is
// the per-execution signal Percona PMM builds its statement story on: an exact
// in-engine wall-clock duration for EVERY client's statements, no tracing
// required. The demo tailer tags these lines `o2_pg_event = statement_duration`
// and pre-parses `stmt_duration_ms` / `stmt_kind` / `stmt_text`; canonicalization
// is keyed on those existing attributes and needs no collector change.
//
// **A seventh kind, not an explain variant.** An auto_explain record is one
// execution WITH its plan, admitted by `auto_explain.log_min_duration`; a
// statement-duration record is one execution with only its duration, admitted
// by `log_min_duration_statement`. The two thresholds are set independently,
// so folding them into one kind would make "which threshold admitted this row"
// unanswerable — and the honesty line on every read of this data is exactly
// that threshold.
//
// **Postgres only, deliberately (v1).** MySQL's equivalent per-execution
// record is the slow query log (`Query_time` per statement), but the shipped
// recipes tail only `error.log` — the slow log is a different file that no
// shipped tailer reads — and its records span MULTIPLE lines (`# Time:` /
// `# User@Host:` / `# Query_time:` headers above the statement), so reading it
// needs multi-line stitching that nothing here does yet. A MySQL/MariaDB arm
// without a producer would be dead code that looks like coverage; it is
// deferred until a slow-log tailer ships. See the dispatch note in
// [`canonicalize_record`].

/// One completed statement execution, canonicalized.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct StatementDurationEvent {
    pub engine: Option<String>,
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    /// In-engine completion time, milliseconds.
    pub duration_ms: f64,
    /// Backend pid from the log-line prefix.
    pub session_pid: Option<i64>,
    /// `user` from the `user@db` prefix segment.
    pub user: Option<String>,
    /// Client `application_name` from the `app=` prefix segment.
    pub app: Option<String>,
    /// Postgres `queryid` from a `%Q` prefix, when configured — the exact join
    /// key to top_query rows.
    pub server_query_id: Option<String>,
    /// NORMALIZED statement text ONLY — never the raw text. See
    /// [`canonicalize_pg_statement_duration`] for the privacy rule.
    pub query: Option<String>,
    pub fingerprint: Option<String>,
}

impl StatementDurationEvent {
    /// The flattened canonical record. Every value is a SCALAR.
    ///
    /// Deliberately NO `o2_dbm_raw` here, unlike every other kind: the raw
    /// line IS the raw statement with its literals, this is the
    /// highest-volume filelog feed DBM has, and the record's own `body` /
    /// `pg_message` fields already retain the evidence. Copying it into a
    /// canonical column would double the stored text per row and put raw
    /// literals under a column the read surface projects by default.
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_STATEMENT));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        out.insert(O2_DBM_STMT_DURATION_MS.into(), json!(self.duration_ms));
        if let Some(p) = self.session_pid {
            out.insert(O2_DBM_SESSION_PID.into(), json!(p));
        }
        insert_opt(&mut out, O2_DBM_SESSION_USER, self.user.clone());
        insert_opt(&mut out, O2_DBM_SESSION_APP, self.app.clone());
        insert_opt(
            &mut out,
            O2_DBM_SERVER_QUERY_ID,
            self.server_query_id.clone(),
        );
        insert_opt(&mut out, O2_DBM_ACTIVITY_QUERY, self.query.clone());
        insert_opt(&mut out, O2_DBM_FINGERPRINT, self.fingerprint.clone());
        out
    }
}

/// Parse a `duration: N.NNN ms  <kind>: <text>` message into
/// `(duration_ms, statement_text)`.
///
/// Accepts the two forms that describe a COMPLETED EXECUTION:
///
///   * `statement: <sql>` — simple-protocol execution;
///   * `execute <name>: <sql>` — extended-protocol execution of a prepared statement (Postgres
///     substitutes the bind values into the logged text).
///
/// `parse <name>:` and `bind <name>:` lines are deliberately REJECTED: under
/// the extended protocol `log_min_duration_statement` times each phase
/// separately, so one logical query can log up to three lines — and only the
/// execute phase is the execution. Admitting the other two would count one
/// call three times on a Slowest-calls list.
pub fn parse_statement_duration_message(msg: &str) -> Option<(f64, &str)> {
    let rest = msg.strip_prefix("duration: ")?;
    let (num, rest) = rest.split_once(" ms")?;
    let duration_ms: f64 = num.trim().parse().ok()?;
    let rest = rest.trim_start();
    let (kind, text) = rest.split_once(':')?;
    // Same phase filter as the pre-parsed `stmt_kind` route in
    // `canonicalize_pg_statement_duration` — the two must not drift.
    if kind != "statement" && !kind.starts_with("execute") {
        return None;
    }
    Some((duration_ms, text.trim_start()))
}

/// Canonicalize one `o2_pg_event = statement_duration` filelog record into a
/// [`StatementDurationEvent`].
///
/// Follows the module invariants (Invariant 1: only collector-produced field
/// names — `stmt_duration_ms`, `stmt_text`, `pg_user`, `pg_db`, … — are read):
/// returns `None` without a measured duration (a duration record with no
/// duration is nothing), and reuses the shared detectors.
///
/// **The privacy rule is STRICTER here than in the sibling canonicalizers, on
/// purpose.** The logged text is the raw statement WITH ITS LITERALS — that is
/// what `log_min_duration_statement` writes — so, per the design §3.2 failure
/// rule the span path enforces, a lexer error yields NO normalized text and NO
/// fingerprint, and the raw text is NEVER stored as fallback in
/// `o2_dbm_activity_query` (the `query_norm.or(query)` fallback the
/// receiver-event canonicalizers use is safe there only because those
/// receivers hand us pre-normalized `$1` text). The row itself still
/// canonicalizes — a measured duration with an unreadable statement is honest
/// as "a call took 900ms", and the evidence stays on the record's own
/// caller-side fields.
///
/// The tailer pre-parses `stmt_duration_ms` / `stmt_text`; when a tailer
/// classified the line but did not parse it (regex `on_error: send` drops the
/// captures silently), the message itself is the fallback source, so a
/// half-configured tailer degrades to the same rows rather than to nothing.
pub fn canonicalize_pg_statement_duration(
    rec: &Map<String, Value>,
) -> Option<StatementDurationEvent> {
    // Collector-parsed fields first; the message parsed here only when they
    // are absent. `pg_message` is the prefix-stripped message; `body` still
    // carries the whole line, so the header is FOUND rather than anchored.
    let pre_duration = first_f64(rec, &["stmt_duration_ms"]);
    let pre_text = first_str(rec, &["stmt_text"]);
    let parsed_from_msg = if pre_duration.is_none() || pre_text.is_none() {
        first_str(rec, &["pg_message", "body"]).and_then(|m| {
            let start = m.find("duration: ")?;
            parse_statement_duration_message(&m[start..]).map(|(d, t)| (d, t.to_string()))
        })
    } else {
        None
    };
    let duration_ms = pre_duration.or(parsed_from_msg.as_ref().map(|(d, _)| *d))?;
    // The pre-parsed route must apply the SAME phase filter the message parser
    // does: the tailer's regex also captures `parse`/`bind` phase lines, and
    // admitting them here would count one extended-protocol call three times.
    if let Some(kind) = first_str(rec, &["stmt_kind"])
        && kind != "statement"
        && !kind.starts_with("execute")
    {
        return None;
    }
    let text = pre_text.or(parsed_from_msg.map(|(_, t)| t));

    let engine = detect_engine(rec).or_else(|| Some("postgresql".to_string()));
    let (query_norm, fingerprint) = text
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));

    // `%Q` prints 0 for statements whose queryid was not computed — same
    // filter as the auto_explain path.
    let server_query_id = first_str(rec, &["pg_query_id"]).filter(|s| s != "0");

    Some(StatementDurationEvent {
        engine,
        database: detect_database(rec),
        // Same derivation chain as the receiver-event siblings (N5) — see the
        // auto_explain arm above for why the resource-attr fallback matters on
        // filelog records.
        instance: first_str(rec, &["mysql_instance_endpoint", "service_instance_id"])
            .map(|a| super::strip_port(&a))
            .or_else(|| detect_instance(rec)),
        timestamp: detect_timestamp(rec),
        duration_ms,
        session_pid: first_i64(rec, &["pg_pid"]),
        user: first_str(rec, &["pg_user"]),
        app: first_str(rec, &["pg_app"]),
        server_query_id,
        // Normalized ONLY — never `.or(text)`. See the privacy rule above.
        query: query_norm,
        fingerprint,
    })
}
