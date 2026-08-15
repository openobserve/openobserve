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
        ],
    )?;

    let query = first_str(rec, &["db_query_text"]);
    let (query_norm, fingerprint) = query
        .as_deref()
        .map(|q| fingerprint_statement(q, engine.as_deref()))
        .unwrap_or((None, None));

    // The blocked-ness predicate, and the only one.
    let blocking_pids = first_str(rec, &["postgresql_blocking_pids"])
        .filter(|p| p != UNBLOCKED_PIDS)
        .map(|p| parse_blocking_pids(&p))
        .unwrap_or_default();

    // Exec time. Postgres ships milliseconds on this event; MySQL ships no exec
    // time at all, only a `timer_wait` in SECONDS, which is converted here so the
    // `_ms` column always means what its name says.
    let exec_time_ms = first_f64(rec, &["postgresql_total_exec_time"]).or_else(|| {
        first_f64(rec, &["mysql_events_statements_current_timer_wait"]).map(|s| s * 1000.0)
    });

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
        session_app: first_str(rec, &["postgresql_application_name", "mysql_client_app"]),
        state: first_str(
            rec,
            &[
                "postgresql_state",
                "mysql_session_status",
                "mysql_threads_processlist_state",
            ],
        ),
        query_start: first_str(rec, &["postgresql_query_start"]),
        // Transaction start is read INDEPENDENTLY of blocked-ness despite its
        // `blocking.*` namespace: measured, 784 of 1072 populated values are on
        // UNBLOCKED sessions, including all 261 `idle in transaction` ones —
        // which are never blocked and are precisely the bloat condition this
        // column exists to age.
        xact_start: first_str(rec, &["postgresql_blocking_transaction_start_time"]),
        wait_start: first_str(rec, &["postgresql_blocking_start_time"]),
        exec_time_ms,
        // The SHARED wait columns (D-D): one wait-event view reads across
        // activity and blocking alike.
        wait_event_type: first_str(rec, &["postgresql_wait_event_type"]),
        wait_event: first_str(rec, &["postgresql_wait_event", "mysql_wait_type"]),
        // `0` is the COALESCE sentinel, not a measured wait — the numeric twin
        // of the `{}` trap above. It is present on all 5495 unblocked rows, so
        // storing it would pollute every AVG/percentile over
        // `o2_dbm_wait_seconds` with thousands of zero-wait sessions and flatten
        // the wait-time chart during a real incident. Note the receiver ships
        // WHOLE SECONDS, so sub-second lock waits round to 0 and are
        // indistinguishable from the sentinel — dropping both is the honest
        // reading of a field with that resolution.
        wait_seconds: first_f64(rec, &["postgresql_blocking_wait_duration"]).filter(|w| *w > 0.0),
        server_query_id: first_str(
            rec,
            &[
                "postgresql_query_id",
                "mysql_events_statements_current_digest",
            ],
        ),
        query: query_norm.or(query),
        fingerprint,
        blocking_pids,
        lock_mode: first_str(rec, &["postgresql_blocking_lock_mode"]),
        lock_type: first_str(rec, &["postgresql_blocking_lock_type"]),
        lock_relation: first_str(rec, &["postgresql_blocking_lock_relation"]),
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

// ─── Query fingerprinting (Deliverable D — the cross-vantage join) ───────────

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
    // Invariant 1 (module docs): canonical `o2_dbm_*` names are outputs, never
    // input aliases — derivation reads receiver fields only.
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
    // `body` is not a fallback here, it is the NORMAL case: the recipe declares
    // `mssql_query` as its `body_column`, so that key is never among the
    // `attribute_columns` and the statement arrives in the record body. Reading
    // only `mssql_query` meant every SQL Server deadlock rendered with no SQL
    // (measured: absent on 22/22 rows, body populated on 40/40, contrib
    // v0.158.0). `mssql_query` stays first for any recipe that does project it
    // as a column, and `canonicalize_blocking` reads `body` the same way.
    let query = first_str(rec, &["mssql_query", "body"]);
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
    // Invariant 1 (module docs): receiver fields only — a caller cannot inject
    // a blocking relationship.
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
        // Stored as a JSON *string*, not a JSON array (Invariant 2, module
        // docs). Since canonicalization runs after flattening (it must: it
        // reads the flattened receiver fields), a nested array here silently
        // killed every batch containing a deadlock — the incident the
        // invariant records. Readers parse it back via `participants_of`.
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

/// Read `o2_dbm_participants` off a stored row, tolerating BOTH storage forms.
///
/// The canonical write path stores the array as a JSON **string** (Invariant 2,
/// module docs). A row produced by a VRL pipeline, or by an older build, may
/// still carry a real JSON array, so both parse.
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
    }
}

/// Canonicalize any server-vantage log record: dispatches on the recipe/event tags the collector
/// configs set. Returns the flattened `o2_dbm_*` fields to merge onto the record, or `None` when
/// the record is not a server-vantage DBM event.
///
/// This is the single ingest-side entry point (the logs analogue of [`super::enrich`]).
pub fn canonicalize_record(rec: &Map<String, Value>) -> Option<BTreeMap<String, Value>> {
    // One config load per record — the gated arms below all read from it.
    let cfg = config::get_config();
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
    // Real executed plans (W-E3) — auto_explain filelog records. Same tag
    // family as the deadlock arms above: filelog produces no OTLP EventName,
    // so the collector tag is the only discriminator there is. Gated on its
    // own knob (D-G), scoped to THIS arm only — deadlocks and blocking
    // shipped enabled and must not switch off behind a knob about a sixth
    // record type.
    if cfg.db_monitoring.explain_enabled
        && rec.get("o2_pg_event").and_then(|v| v.as_str()) == Some("explain")
    {
        return canonicalize_pg_auto_explain(rec).map(|e| e.to_record());
    }
    // Completed-statement durations (W-S1) — `log_min_duration_statement`
    // filelog records. Same tag family as deadlock/explain: filelog produces
    // no OTLP EventName, so the collector tag is the discriminator. Gated on
    // its own knob, scoped to THIS arm only, like explain above — but the
    // knob defaults ON (see the config docs: these lines are already being
    // ingested, so the knob gates columns, not a feed).
    //
    // POSTGRES ONLY, deliberately: MySQL/MariaDB's per-execution equivalent
    // is the slow query log, which no shipped recipe tails (only error.log
    // is) and whose records span multiple lines (`# Time:` / `# User@Host:` /
    // `# Query_time:` headers), needing multi-line stitching nothing here
    // does yet. An arm without a producer would be dead code that reads as
    // coverage — add the MySQL arm together with a slow-log tailer recipe.
    if cfg.db_monitoring.statement_enabled
        && rec.get("o2_pg_event").and_then(|v| v.as_str()) == Some("statement_duration")
    {
        return canonicalize_pg_statement_duration(rec).map(|e| e.to_record());
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

    // Table health (W10) — the table-stats sqlquery recipes. Keyed on the
    // recipe tag, the same extension point the blocking match above uses: these
    // rows carry no OTLP event name and no engine attribute, so the tag is the
    // only discriminator there is. The three engines' recipes emit the SAME
    // column aliases (the `mariadb_lock_waits` precedent), so one canonicalizer
    // serves all three and `detect_engine` reads the engine off the tag.
    //
    // Ungated, unlike activity and top_query. Those two are opt-in because of
    // VOLUME — one row per session per poll, and 2.4 KB plan documents. This
    // recipe emits one row per TABLE per 60 s (measured: 448 rows/hour on the
    // reference rig, against ~200 rows/SECOND for activity), which is the same
    // order as the deadlock and blocking feeds that already ship enabled. A
    // knob whose only effect is to hide a cheap signal is a knob nobody sets
    // correctly.
    if recipe == "pg_table_stats"
        || recipe == "mysql_table_stats"
        || recipe == "mariadb_table_stats"
    {
        return canonicalize_table_stats(rec).map(|s| s.to_record());
    }

    // Index health (W11) — the index-stats sqlquery recipes, keyed on the same
    // extension point and sharing one canonicalizer across engines exactly as
    // table stats does. Ungated for the same reason: one row per INDEX per 60 s
    // is the same order as the deadlock and blocking feeds that already ship
    // enabled, not the per-session volume that made activity opt-in.
    if recipe == "pg_index_stats"
        || recipe == "mysql_index_stats"
        || recipe == "mariadb_index_stats"
    {
        return canonicalize_index_stats(rec).map(|s| s.to_record());
    }

    // Active sessions (W2) — LAST, and gated on its own knob.
    //
    // The gate is scoped to this arm rather than being an early return: activity
    // is opt-in (D-G) because it is the highest-volume signal DBM has
    // (~200 rows/sec for a 200-session instance), but deadlocks and blocking
    // already shipped enabled and must not switch off behind a knob about a
    // third record type.
    if cfg.db_monitoring.activity_enabled && resolve_event_name(rec) == Some(EVENT_QUERY_SAMPLE) {
        return canonicalize_query_sample(rec).map(|s| s.to_record());
    }
    // Top queries + plans (W3) — gated on its own knob, for the same reason
    // activity is: plan documents are large (the captured Postgres plans reach
    // 2.4 KB each) and a user upgrading must not silently acquire the cost.
    if cfg.db_monitoring.top_query_enabled && resolve_event_name(rec) == Some(EVENT_TOP_QUERY) {
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

        // The plan and its hash travel together or not at all: a hash with no
        // plan cannot be inspected, and a plan with no hash cannot be compared.
        if let (Some(plan), Some(hash)) = (self.plan.as_ref(), self.plan_hash.as_ref()) {
            out.insert(O2_DBM_PLAN.into(), json!(plan));
            out.insert(O2_DBM_PLAN_HASH.into(), json!(hash));
            out.insert(O2_DBM_PLAN_HASH_VERSION.into(), json!(PLAN_HASH_VERSION));
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
    let plan = first_str(rec, &["postgresql_query_plan", "mysql_query_plan"]);
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
        instance: detect_instance(rec),
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
        instance: detect_instance(rec),
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

// ─── W10 · Table health (`pg_table_stats`) ───────────────────────────────────
//
// One snapshot of one RELATION's storage and maintenance state, from the
// `pg_table_stats` sqlquery recipe (capture rig `server.yaml` R3a). The recipe
// joins `pg_class` (size) to `pg_stat_user_tables` (activity, vacuum history).
//
// **This is a fifth record kind, not a variant of the four that exist.**
// Activity describes a SESSION, top_query a STATEMENT, deadlock and blocking an
// EVENT between sessions. A table row describes a RELATION: it has no pid, no
// statement, no participants, and it persists between snapshots rather than
// occurring at one. Filing it under any existing kind would put rows with no
// session and no query into a table whose every column is about one or the
// other.
//
// **Two honesty properties bind everything downstream, and both are stated as
// COLUMNS rather than left to the reader** (see `O2_DBM_COUNTERS_ARE_CUMULATIVE`
// and `O2_DBM_TUPLES_ARE_ESTIMATED`).
//
// **Postgres, MySQL and MariaDB.** The three engines expose schema statistics
// through entirely different catalogs (`pg_stat_user_tables`,
// `information_schema.TABLES` + `mysql.innodb_table_stats`), but their recipes
// emit the SAME aliased columns — the `mariadb_lock_waits` precedent — so this
// one canonicalizer reads all three and the recipe tag names the engine. The
// engine-specific columns simply stay absent where an engine has no source for
// them (MySQL reports no dead-tuple or vacuum state, for instance). SQL Server
// still has no table-stats recipe, and the read surface must say "not
// collected for this engine" rather than render an empty table that reads as
// "no problems found".

/// One relation's storage and maintenance state at one snapshot.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct TableStatsSample {
    pub engine: Option<String>,
    /// Always `None` from this recipe — see [`O2_DBM_SCHEMA`]. Kept on the
    /// struct so the field's absence is an explicit decision at every
    /// construction site rather than an omission nobody notices.
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    pub relation: Option<String>,
    pub schema: Option<String>,
    pub total_bytes: Option<i64>,
    pub heap_bytes: Option<i64>,
    pub live_tuples: Option<i64>,
    pub dead_tuples: Option<i64>,
    pub dead_tup_pct: Option<f64>,
    pub mod_since_analyze: Option<i64>,
    pub seq_scan: Option<i64>,
    pub seq_tup_read: Option<i64>,
    pub idx_scan: Option<i64>,
    pub autovacuum_count: Option<i64>,
    pub frozen_xid_age: Option<i64>,
    pub last_vacuum: Option<String>,
    pub last_autovacuum: Option<String>,
    pub last_analyze: Option<String>,
}

impl TableStatsSample {
    /// The flattened canonical record. Every value is a SCALAR (Invariant 2,
    /// module docs).
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_TABLE_STATS));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        insert_opt(&mut out, O2_DBM_RELATION, self.relation.clone());
        insert_opt(&mut out, O2_DBM_SCHEMA, self.schema.clone());
        // `if let Some` and never `unwrap_or(0)`: a measured zero and an absent
        // column are different facts, and defaulting turns "the recipe did not
        // report this" into "there were none of these".
        for (col, val) in [
            (O2_DBM_TOTAL_BYTES, self.total_bytes),
            (O2_DBM_HEAP_BYTES, self.heap_bytes),
            (O2_DBM_LIVE_TUPLES, self.live_tuples),
            (O2_DBM_DEAD_TUPLES, self.dead_tuples),
            (O2_DBM_MOD_SINCE_ANALYZE, self.mod_since_analyze),
            (O2_DBM_SEQ_SCAN_COUNT, self.seq_scan),
            (O2_DBM_SEQ_TUP_READ, self.seq_tup_read),
            (O2_DBM_IDX_SCAN_COUNT, self.idx_scan),
            (O2_DBM_AUTOVACUUM_COUNT, self.autovacuum_count),
            (O2_DBM_FROZEN_XID_AGE, self.frozen_xid_age),
        ] {
            if let Some(v) = val {
                out.insert(col.into(), json!(v));
            }
        }
        if let Some(p) = self.dead_tup_pct {
            out.insert(O2_DBM_DEAD_TUP_PCT.into(), json!(p));
        }
        insert_opt(&mut out, O2_DBM_LAST_VACUUM, self.last_vacuum.clone());
        insert_opt(
            &mut out,
            O2_DBM_LAST_AUTOVACUUM,
            self.last_autovacuum.clone(),
        );
        insert_opt(&mut out, O2_DBM_LAST_ANALYZE, self.last_analyze.clone());
        // Both UNCONDITIONAL — see the two consts. A flag on only some rows
        // would read as a claim about the rows that lack it.
        out.insert(O2_DBM_COUNTERS_ARE_CUMULATIVE.into(), json!(true));
        out.insert(O2_DBM_TUPLES_ARE_ESTIMATED.into(), json!(true));
        out
    }
}

// ─── W11 · Index health (`pg_index_stats`) ───────────────────────────────────
//
// One snapshot of one INDEX, from the `pg_index_stats` sqlquery recipe. These
// rows have been arriving on the live rig all along (312 per window, measured)
// and falling through to the trailing `None` because no arm claimed them.
//
// **A sixth kind, not a table-stats variant.** A table row and an index row
// share a relation but not an identity: two indexes on one table are two rows
// with the same `o2_dbm_relation`, so filing them under `table_stats` would
// make the relation a non-unique key and silently collapse them in any
// newest-per-relation read.
//
// **The identity is `index_name`, NOT `body`.** `pg_table_stats` declares
// `table_name` as its `body_column`, so there the name arrives as `body`. This
// recipe declares no body column: `index_name` and `table_name` are ordinary
// attributes and `body` carries the `CREATE INDEX ...` DDL. Reusing the
// table-stats convention here would file every index under a DDL statement —
// the same producer/parser mismatch that shipped two DBM bugs green.
//
// **Postgres, MySQL and MariaDB**, exactly as table health is: the MySQL and
// MariaDB recipes read `information_schema.STATISTICS` (+
// `performance_schema.table_io_waits_summary_by_index_usage` for usage counts,
// MySQL only — MariaDB ships with performance_schema OFF, so its rows honestly
// omit `idx_scan` rather than reporting zero) and emit the same aliased
// columns as `pg_index_stats`. SQL Server still has no index-stats recipe.

/// One index's size and usage at one snapshot.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct IndexStatsSample {
    pub engine: Option<String>,
    /// Always `None` — the recipe never names a database. See [`O2_DBM_SCHEMA`].
    pub database: Option<String>,
    pub instance: Option<String>,
    pub timestamp: Option<i64>,
    pub index_name: Option<String>,
    /// The table the index belongs to.
    pub relation: Option<String>,
    pub schema: Option<String>,
    pub index_bytes: Option<i64>,
    pub idx_scan: Option<i64>,
    pub idx_tup_read: Option<i64>,
    pub idx_tup_fetch: Option<i64>,
    /// `None` when the recipe predates the column — UNKNOWN, not "ordinary".
    pub is_unique: Option<bool>,
}

impl IndexStatsSample {
    /// The flattened canonical record. Every value is a SCALAR.
    pub fn to_record(&self) -> BTreeMap<String, Value> {
        let mut out = BTreeMap::new();
        out.insert(O2_DBM_KIND.into(), json!(KIND_INDEX_STATS));
        insert_opt(&mut out, O2_DBM_ENGINE, self.engine.clone());
        insert_opt(&mut out, O2_DBM_DATABASE, self.database.clone());
        insert_opt(&mut out, O2_DBM_INSTANCE, self.instance.clone());
        if let Some(ts) = self.timestamp {
            out.insert(O2_DBM_TIMESTAMP.into(), json!(ts));
        }
        insert_opt(&mut out, O2_DBM_INDEX_NAME, self.index_name.clone());
        insert_opt(&mut out, O2_DBM_RELATION, self.relation.clone());
        insert_opt(&mut out, O2_DBM_SCHEMA, self.schema.clone());
        // `if let Some` and never `unwrap_or(0)`: a measured zero is the
        // never-scanned FINDING, and an absent column is a different fact.
        for (col, val) in [
            (O2_DBM_INDEX_BYTES, self.index_bytes),
            (O2_DBM_IDX_SCAN_COUNT, self.idx_scan),
            (O2_DBM_IDX_TUP_READ, self.idx_tup_read),
            (O2_DBM_IDX_TUP_FETCH, self.idx_tup_fetch),
        ] {
            if let Some(v) = val {
                out.insert(col.into(), json!(v));
            }
        }
        // Written only when the recipe reported it. An absent flag is UNKNOWN,
        // and defaulting it to `false` would assert that a primary key is an
        // ordinary index — the exact confusion this column exists to prevent.
        if let Some(u) = self.is_unique {
            out.insert(O2_DBM_INDEX_IS_UNIQUE.into(), json!(u));
        }
        // UNCONDITIONAL: `pg_stat_user_indexes` counts from the last stats
        // reset. Without this the read surface cannot say "never scanned"
        // without implying "never scanned in this window".
        out.insert(O2_DBM_COUNTERS_ARE_CUMULATIVE.into(), json!(true));
        out
    }
}

/// Canonicalize one index-stats recipe row (`pg_index_stats`,
/// `mysql_index_stats` or `mariadb_index_stats` — all three emit the same
/// aliased columns) into an [`IndexStatsSample`].
///
/// Reads only the recipe's own column names (Invariant 1, module docs), so a
/// caller cannot POST a fabricated index row.
pub fn canonicalize_index_stats(rec: &Map<String, Value>) -> Option<IndexStatsSample> {
    // The index's own name is the identity. Absent, there is no index to show
    // and a fabricated name would invent a row in the health list. NOT read
    // from `body`, which holds the CREATE INDEX statement.
    let index_name = first_str(rec, &["index_name"])?;

    Some(IndexStatsSample {
        // Stated by the RECIPE TAG via `detect_engine` — the row carries no
        // `db.system` attribute, and the same aliased columns arrive from the
        // Postgres, MySQL and MariaDB recipes. Legacy rows written before the
        // MySQL/MariaDB twins existed can only have come from `pg_index_stats`,
        // hence the Postgres fallback.
        engine: detect_engine(rec).or_else(|| Some("postgresql".to_string())),
        database: None,
        instance: detect_instance(rec),
        timestamp: detect_timestamp(rec),
        index_name: Some(index_name),
        relation: first_str(rec, &["table_name"]),
        schema: first_str(rec, &["schema_name"]),
        // Every column is `::text` in the recipe. `idx_tup_read` exceeds i32 on
        // real data (2,937,877,460 measured), so these must be i64.
        index_bytes: first_i64(rec, &["index_bytes"]),
        idx_scan: first_i64(rec, &["idx_scan"]),
        idx_tup_read: first_i64(rec, &["idx_tup_read"]),
        idx_tup_fetch: first_i64(rec, &["idx_tup_fetch"]),
        // Postgres renders a boolean `::text` as "true"/"false"; a JSON bool is
        // accepted too so the column survives a producer that sends one.
        is_unique: match rec.get("is_unique") {
            Some(Value::Bool(b)) => Some(*b),
            Some(Value::String(s)) => match s.as_str() {
                "true" | "t" => Some(true),
                "false" | "f" => Some(false),
                // An unrecognised value is UNKNOWN, never silently `false`.
                _ => None,
            },
            _ => None,
        },
    })
}

/// Canonicalize one table-stats recipe row (`pg_table_stats`,
/// `mysql_table_stats` or `mariadb_table_stats` — all three emit the same
/// aliased columns) into a [`TableStatsSample`].
///
/// Follows the module invariants (Invariant 1: the recipe's own column names
/// only): returns `None` without a relation identity, and reuses the shared
/// detectors where they apply.
pub fn canonicalize_table_stats(rec: &Map<String, Value>) -> Option<TableStatsSample> {
    // The table name is the recipe's `body_column`, so it arrives as `body` and
    // there is NO `table_name` attribute. `canonicalize_mssql_deadlock` reads
    // `body` for the same reason. Without a relation there is no table to show,
    // and inventing a name would fabricate a row in the health list.
    let relation = first_str(rec, &["body"])?;

    Some(TableStatsSample {
        // Stated by the RECIPE TAG via `detect_engine`, not sniffed: the row
        // carries no `db.system` attribute at all, and the Postgres, MySQL and
        // MariaDB recipes emit the same aliased columns — the tag is the only
        // thing naming the engine. Without it the engine would be null and a
        // fleet view could not tell which engines it is missing data for.
        // Legacy rows written before the MySQL/MariaDB twins existed can only
        // have come from `pg_table_stats`, hence the Postgres fallback.
        engine: detect_engine(rec).or_else(|| Some("postgresql".to_string())),
        // Deliberately absent — the recipe never names a database, and
        // `schema_name` is NOT one. See `O2_DBM_SCHEMA`.
        database: None,
        instance: detect_instance(rec),
        timestamp: detect_timestamp(rec),
        relation: Some(relation),
        schema: first_str(rec, &["schema_name"]),
        // Every column is `::text` in the recipe, so all of these parse from
        // strings. `first_i64`/`first_f64` already handle both forms.
        total_bytes: first_i64(rec, &["total_bytes"]),
        heap_bytes: first_i64(rec, &["heap_bytes"]),
        live_tuples: first_i64(rec, &["n_live_tup"]),
        dead_tuples: first_i64(rec, &["n_dead_tup"]),
        // f64, not i64: the recipe rounds to two decimals and an integer parse
        // would collapse every sub-1% bloat figure to zero.
        dead_tup_pct: first_f64(rec, &["dead_tup_pct"]),
        mod_since_analyze: first_i64(rec, &["n_mod_since_analyze"]),
        seq_scan: first_i64(rec, &["seq_scan"]),
        seq_tup_read: first_i64(rec, &["seq_tup_read"]),
        idx_scan: first_i64(rec, &["idx_scan"]),
        autovacuum_count: first_i64(rec, &["autovacuum_count"]),
        frozen_xid_age: first_i64(rec, &["frozen_xid_age"]),
        // `first_str` treats `""` as absent, which is exactly right here: the
        // recipe COALESCEs "never vacuumed" to the empty string, and omitting
        // the column is how "never" is expressed. Relied on deliberately rather
        // than inherited by accident.
        last_vacuum: first_str(rec, &["last_vacuum"]),
        last_autovacuum: first_str(rec, &["last_autovacuum"]),
        last_analyze: first_str(rec, &["last_analyze"]),
    })
}
