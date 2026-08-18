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

//! The SHARED Database Monitoring vocabulary: canonical `o2_dbm_*` column names,
//! record-kind discriminators, and the receiver-field parsing helpers every
//! canonicalizer reads through.
//!
//! ## Why this lives in `config` and not in `openobserve_core`
//!
//! DBM canonicalization is split across two repos: the OSS core owns ingest
//! dispatch and the read handlers, while `o2_enterprise` owns the deadlock,
//! blocking-chain and table-health canonicalizers. `o2_enterprise` **cannot**
//! `use openobserve_core::…` — Cargo rejects the dependency cycle — but both
//! crates already depend on `config`. So `config` is the only floor both halves
//! can stand on, and the vocabulary they must agree on byte-for-byte lives here.
//!
//! Everything here is pure `serde_json` plus [`super::db_normalizer`]; nothing in
//! this module reaches back into core.
//!
//! ## Invariants
//!
//! 1. **`ALL_DBM_FIELDS` is ONE array.** It does triple duty — write-side strip list, read-side
//!    projection allowlist, and schema gate — and splitting it across the OSS/enterprise boundary
//!    would let the two halves disagree about which columns are reserved, which is exactly the
//!    spoofing hole the strip exists to close.
//! 2. **No parsing helper is ever duplicated across the boundary.** These are moved here, not
//!    copied. [`fingerprint_statement`] in particular is the cross-vantage join key: a drifted copy
//!    would silently de-join server-vantage events from the client spans for the same statement.
//! 3. **Canonical `o2_dbm_*` names are OUTPUTS, never inputs.** Every helper here reads
//!    receiver/recipe vendor field names only.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::db_normalizer::{self, Dialect};
/// Cap on normalizer input (bytes): truncate at 16 KB, then lex; if truncation produces a lexer
/// error the standard failure rule applies (no `query_norm`, operation+collection fallback
/// fingerprint) so a mid-token cut can never leak a literal.
pub const MAX_NORM_INPUT: usize = 16 * 1024;

/// Normalize `db.system.name`/`db.system` values to the stable enum vocabulary (design §3.1):
/// new-semconv aliases fold onto the canonical short names; unknown systems pass through
/// lowercased (they route to the operation+collection fallback).
pub fn canonical_system(raw: &str) -> String {
    let lower = raw.to_lowercase();
    match lower.as_str() {
        "microsoft.sql_server" => "mssql".to_string(),
        "oracle.db" => "oracle".to_string(),
        _ => lower,
    }
}

/// Strip a trailing `:port` from `server.address`/`net.peer.name`. Bare IPs are deliberately
/// KEPT (deviation from `inferred.rs` — databases are commonly addressed by IP).
pub fn strip_port(addr: &str) -> String {
    if let Some(rest) = addr.strip_prefix('[') {
        // [IPv6]:port
        if let Some(end) = rest.find(']') {
            return rest[..end].to_string();
        }
    }
    match addr.rsplit_once(':') {
        Some((host, port)) if !port.is_empty() && port.bytes().all(|b| b.is_ascii_digit()) => {
            host.to_string()
        }
        _ => addr.to_string(),
    }
}

/// Engine → normalizer routing (design §3.2). Unlisted systems return `None` → the
/// operation+collection fallback hash with no query_norm.
pub fn route_dialect(system: &str) -> Option<Dialect> {
    Some(match system {
        "postgresql" => Dialect::Postgresql,
        "mysql" => Dialect::Mysql,
        "mariadb" => Dialect::Mariadb,
        "mssql" => Dialect::Mssql,
        "oracle" => Dialect::Oracle,
        "cockroachdb" => Dialect::Cockroachdb,
        "cassandra" => Dialect::Cassandra,
        "clickhouse" => Dialect::Clickhouse,
        "redis" | "valkey" => Dialect::Redis,
        "mongodb" => Dialect::Mongodb,
        "elasticsearch" | "opensearch" => Dialect::Elasticsearch,
        _ => return None,
    })
}
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

/// PID/thread the engine chose to abort.
pub const O2_DBM_VICTIM_PID: &str = "o2_dbm_victim_pid";

/// Assembled participant array (see [`Participant`]).
pub const O2_DBM_PARTICIPANTS: &str = "o2_dbm_participants";

/// Count of participants — cheap ranking column so the UI need not unpack the array.
pub const O2_DBM_PARTICIPANT_COUNT: &str = "o2_dbm_participant_count";

/// MySQL only: side number InnoDB rolled back, from its separately-logged
/// `*** WE ROLL BACK TRANSACTION (N)` entry. Joined to participants at read time.
pub const O2_DBM_VICTIM_SIDE: &str = "o2_dbm_victim_side";

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
///
/// Note this array does triple duty: write-side strip list (here), read-side projection
/// allowlist (`api.rs` `present_dbm_columns`, schema-intersected so unknown entries are
/// harmless), and schema gate. Adding an entry grows every DBM read's projection.
pub const ALL_DBM_FIELDS: [&str; 83] = [
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
    O2_EVENT_NAME,
    // W2 · activity columns.
    O2_DBM_SESSION_PID,
    O2_DBM_SESSION_USER,
    O2_DBM_SESSION_APP,
    O2_DBM_SESSION_STATE,
    O2_DBM_QUERY_START,
    O2_DBM_XACT_START,
    O2_DBM_WAIT_START,
    O2_DBM_DURATION_MS,
    O2_DBM_EXEC_TIME_MS,
    O2_DBM_SERVER_QUERY_ID,
    O2_DBM_ACTIVITY_QUERY,
    O2_DBM_FINGERPRINT,
    O2_DBM_BLOCKING_PIDS,
    O2_DBM_LOCK_MODE,
    O2_DBM_LOCK_TYPE,
    O2_DBM_LOCK_RELATION,
    O2_DBM_CLIENT_ADDR,
    O2_DBM_CLIENT_HOST,
    O2_DBM_CLIENT_PORT,
    // W3 · top-query + plan columns.
    O2_DBM_PLAN,
    O2_DBM_PLAN_HASH,
    O2_DBM_PLAN_HASH_VERSION,
    O2_DBM_CALLS,
    O2_DBM_ROWS,
    O2_DBM_EXEC_TIME_S,
    O2_DBM_SHARED_BLKS_HIT,
    O2_DBM_SHARED_BLKS_READ,
    O2_DBM_SHARED_BLKS_DIRTIED,
    O2_DBM_SHARED_BLKS_WRITTEN,
    O2_DBM_TEMP_BLKS_READ,
    O2_DBM_TEMP_BLKS_WRITTEN,
    O2_DBM_METRICS_ARE_DELTA,
    O2_DBM_RECEIVER_VERSION,
    // W-E3 · executed-plan (auto_explain) columns. `plan_source` is stamped on
    // EVERY plan-bearing row (generic and executed), so it must be reserved
    // like the rest — a caller-supplied value would let a forged record claim
    // executed-plan provenance.
    O2_DBM_PLAN_SOURCE,
    O2_DBM_PLAN_DURATION_MS,
    O2_DBM_PLAN_ROWS_ACTUAL,
    // W10 · table health columns.
    O2_DBM_RELATION,
    O2_DBM_SCHEMA,
    O2_DBM_TOTAL_BYTES,
    O2_DBM_HEAP_BYTES,
    O2_DBM_LIVE_TUPLES,
    O2_DBM_DEAD_TUPLES,
    O2_DBM_DEAD_TUP_PCT,
    O2_DBM_MOD_SINCE_ANALYZE,
    O2_DBM_SEQ_SCAN_COUNT,
    O2_DBM_SEQ_TUP_READ,
    O2_DBM_IDX_SCAN_COUNT,
    O2_DBM_AUTOVACUUM_COUNT,
    O2_DBM_FROZEN_XID_AGE,
    O2_DBM_LAST_VACUUM,
    O2_DBM_LAST_AUTOVACUUM,
    O2_DBM_LAST_ANALYZE,
    O2_DBM_COUNTERS_ARE_CUMULATIVE,
    O2_DBM_TUPLES_ARE_ESTIMATED,
    // W11 · index health columns. `o2_dbm_relation`, `o2_dbm_schema` and
    // `o2_dbm_idx_scan_count` are SHARED with table health above rather than
    // duplicated: an index's scan count is the same measurement on the same
    // catalog, and a second column for it would let the two disagree.
    O2_DBM_INDEX_NAME,
    O2_DBM_INDEX_BYTES,
    O2_DBM_IDX_TUP_READ,
    O2_DBM_IDX_TUP_FETCH,
    O2_DBM_INDEX_IS_UNIQUE,
    // W-S1 · completed-statement duration (log_min_duration_statement).
    O2_DBM_STMT_DURATION_MS,
];

/// The OTLP LogRecord `EventName`, surfaced onto the flattened log record.
///
/// The `postgresqlreceiver`/`mysqlreceiver` log events (`db.server.query_sample`,
/// `db.server.top_query`) carry their discriminator ONLY in the OTLP `EventName`
/// field — it is not an attribute, and the Body is unset. Logs ingest dropped it, so
/// nothing downstream could tell the two events apart; `logs/otlp.rs` now surfaces it
/// under this key.
///
/// It is a member of [`ALL_DBM_FIELDS`], so [`apply_to_record`] strips any
/// caller-supplied value. See [`event_name_of`] for why that strip is unconditional.
pub const O2_EVENT_NAME: &str = "o2_event_name";

/// Receiver event name: one sampled session row from `pg_stat_activity`.
pub const EVENT_QUERY_SAMPLE: &str = "db.server.query_sample";

/// Receiver event name: one aggregated statement row from `pg_stat_statements`.
pub const EVENT_TOP_QUERY: &str = "db.server.top_query";

/// Backend pid (Postgres) or session/thread id (MySQL) — the session identity.
pub const O2_DBM_SESSION_PID: &str = "o2_dbm_session_pid";

pub const O2_DBM_SESSION_USER: &str = "o2_dbm_session_user";

/// Client `application_name` — the pivot back to a service in the trace store.
pub const O2_DBM_SESSION_APP: &str = "o2_dbm_session_app";

/// `active` / `idle` / `idle in transaction` (PG); `running` / `waiting` (MySQL).
pub const O2_DBM_SESSION_STATE: &str = "o2_dbm_session_state";

/// When the CURRENT (or last) statement started.
pub const O2_DBM_QUERY_START: &str = "o2_dbm_query_start";

/// When the TRANSACTION started — a different clock from [`O2_DBM_QUERY_START`],
/// and the one that ages an `idle in transaction` session.
pub const O2_DBM_XACT_START: &str = "o2_dbm_xact_start";

/// When the lock wait began (blocked sessions only).
pub const O2_DBM_WAIT_START: &str = "o2_dbm_wait_start";

/// Elapsed time of a session whose query is STILL RUNNING. Written only when
/// [`ActivitySample::duration_is_live`] — see the state-dependent trap below.
pub const O2_DBM_DURATION_MS: &str = "o2_dbm_duration_ms";

/// Statement execution time in MILLISECONDS.
///
/// The unit is in the name deliberately. `total_exec_time` is SECONDS on
/// `top_query` but genuine MILLISECONDS on `query_sample` — the same attribute
/// name carrying two units, measured at a uniform ~1000.3 ratio against
/// `pg_stat_statements` ground truth. A unit-less column name is how that
/// ambiguity propagates into a 1000x wrong number on a latency page.
pub const O2_DBM_EXEC_TIME_MS: &str = "o2_dbm_exec_time_ms";

/// The engine's OWN statement id, stored verbatim: PG `query_id` (a SIGNED
/// 64-bit hash — 41% of real values are negative) or the MySQL digest. This is
/// the join key between server-vantage events; the fingerprint below is the
/// separate join key to client spans.
pub const O2_DBM_SERVER_QUERY_ID: &str = "o2_dbm_server_query_id";

pub const O2_DBM_ACTIVITY_QUERY: &str = "o2_dbm_activity_query";

/// Cross-vantage join key — identical to the span path's `o2_db_fingerprint`.
pub const O2_DBM_FINGERPRINT: &str = "o2_dbm_fingerprint";

/// Blocker pids, comma-joined. A SCALAR, never an array — see [`to_record`].
pub const O2_DBM_BLOCKING_PIDS: &str = "o2_dbm_blocking_pids";

pub const O2_DBM_LOCK_MODE: &str = "o2_dbm_lock_mode";

pub const O2_DBM_LOCK_TYPE: &str = "o2_dbm_lock_type";

pub const O2_DBM_LOCK_RELATION: &str = "o2_dbm_lock_relation";

/// Where the session connected FROM — "which host to go kill".
pub const O2_DBM_CLIENT_ADDR: &str = "o2_dbm_client_addr";

pub const O2_DBM_CLIENT_HOST: &str = "o2_dbm_client_host";

pub const O2_DBM_CLIENT_PORT: &str = "o2_dbm_client_port";

/// Record kind: one sampled active session.
pub const KIND_ACTIVITY: &str = "activity";

/// Record kind values.
pub const KIND_DEADLOCK: &str = "deadlock";

pub const KIND_BLOCKING: &str = "blocking";

/// Max stored query text per participant — same cap the span path applies to `o2_db_query_norm`.
pub const MAX_PARTICIPANT_QUERY: usize = 4096;

/// Apply server-vantage canonicalization to one flattened log record, in place.
///
/// This is the hook every logs ingest path must call, and it MUST run before
/// `refactor_map` so a user-defined schema listing the canonical columns keeps them
/// (D1 condition 2).
///
/// It first drops any client-supplied `o2_dbm_*` key — the strip half of Invariant 1
/// (module docs).
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
/// Every `o2_recipe` tag the ingest dispatcher recognizes.
///
/// This is the SAME list the dispatch arms match, held once so the two cannot
/// drift: a new recipe added to dispatch but not to this array would be reported
/// to its author as unrecognized while working perfectly, which is a worse lie
/// than the silence W8 exists to fix.
///
/// 🚨 **The two sides now live in DIFFERENT REPOS.** All 11 members are
/// enterprise-owned: the array is here in `config`, and every arm that handles
/// one is in `o2_enterprise::enterprise::db_monitoring::claim_recipe_tags`.
/// Nothing in the OSS repo can see both — `include_str!` does not cross the
/// boundary — so the pairing is pinned from the enterprise side by
/// `every_recognized_recipe_has_a_dispatch_arm`, and the OSS side pins only what
/// it can still see: that the tag literals remain in the dispatcher's own body
/// (`w8_recognized_recipes_match_the_dispatch_arms`, plus
/// `shipped_recipe_tags_and_backend_dispatch_agree` against the shipped
/// collector recipes).
///
/// Because all 11 are enterprise-owned, an OSS build canonicalizes NONE of them.
/// `server_vantage::classify_recipe` reports that as `EnterpriseOnly` rather than
/// leaving them silently "recognized" — silence here would be the W8
/// wrong-story defect arriving through a new door. If an OSS-owned recipe is
/// ever added to this array, `classify_recipe` needs a real per-tag distinction.
pub const RECOGNIZED_RECIPES: [&str; 11] = [
    "pg_blocking_chain",
    "mysql_lock_waits",
    "mariadb_lock_waits",
    "mssql_blocking_chain",
    "mssql_deadlock",
    "pg_table_stats",
    "pg_index_stats",
    "mysql_table_stats",
    "mysql_index_stats",
    "mariadb_table_stats",
    "mariadb_index_stats",
];

// ─── A1 · raw deadlock vocabulary (read-time fallback) ───────────────────────
//
// Rows ingested by an OSS build carry the RAW vendor fields and no `o2_dbm_*`
// column at all: OSS stores a deadlock log line verbatim and canonicalizes
// nothing (deadlocks are an Enterprise capability). An enterprise build reading
// that history therefore sees zero deadlocks — measured on a real stream, 239
// deadlock rows and 0 visible on the page.
//
// The read-time fallback closes that by ALSO projecting the raw columns and
// canonicalizing those rows in Rust. Both halves of the vocabulary live here,
// next to `ALL_DBM_FIELDS`, and NOT in the OSS read API, for the same reason
// `ALL_DBM_FIELDS` does: the canonicalizers that consume these names are in
// `o2_enterprise`, which cannot see the OSS crate. A copy on each side of the
// repo boundary would drift silently, and the drift is invisible — a column
// dropped from the projection does not error, it just makes that participant
// blank.

/// The four markers that identify a deadlock row, and the value each must equal.
///
/// THE FOURTH IS NOT LIKE THE OTHER THREE. pg/mysql/mariadb arrive via filelog
/// and are keyed on an `o2_*_event` field whose value is `deadlock`. SQL Server
/// deadlocks arrive from a **sqlquery recipe** — there is no log line to tag —
/// so they are keyed on the recipe tag itself, `o2_recipe = 'mssql_deadlock'`.
/// Writing `KIND_DEADLOCK` in that slot would compile, read naturally, and match
/// exactly zero rows.
///
/// Each marker is itself a COLUMN, so naming one in the widened `WHERE` on a
/// stream that lacks it fails the entire query — they are schema-gated exactly
/// like the projection.
pub const DEADLOCK_MARKERS: [(&str, &str); 4] = [
    ("o2_pg_event", KIND_DEADLOCK),
    ("o2_my_event", KIND_DEADLOCK),
    ("o2_maria_event", KIND_DEADLOCK),
    ("o2_recipe", "mssql_deadlock"),
];

/// Every RAW vendor column the deadlock canonicalizers read, across all four
/// engines.
///
/// This is the read-side mirror of `ALL_DBM_FIELDS`, and it carries the SAME
/// hazard: naming a column absent from the stream schema fails the whole query
/// with a 400 rather than yielding a null column. On a real OSS-ingested stream
/// 3 of the MariaDB names below are absent (`maria_lock_mode`,
/// `maria_lock_table`, `maria_lock_index`) because no MariaDB lock recipe ever
/// ran there, and `mssql_query` is absent even on a stream that HAS live SQL
/// Server deadlocks. So this array is a CANDIDATE list, always intersected with
/// the stream schema before it reaches a projection — never emitted whole.
///
/// Derived by enumerating the keys the enterprise canonicalizers actually read
/// (`canonicalize_pg_deadlock`, `canonicalize_innodb_deadlock`,
/// `canonicalize_mssql_deadlock`). The
/// `every_raw_field_this_projects_is_read_by_a_canonicalizer` contract test in
/// `o2_enterprise` pins the two together across the repo boundary — an entry
/// here that no canonicalizer reads is projected bytes nobody consumes, and a
/// key a canonicalizer reads that is missing here arrives absent and silently
/// blanks that field on every fallback event.
///
/// The generic detection helpers' inputs (`detect_engine`, `detect_database`,
/// `detect_instance`) are included: they are how a raw-derived event acquires
/// the engine/instance/database the Rust-side scope filter and the MySQL stitch
/// group on, so omitting them would leave every fallback event ungrouped and
/// unfilterable.
///
/// `_timestamp` is deliberately NOT here — the builder emits it itself, and it
/// is the one column DataFusion will not null-fill.
pub const RAW_DEADLOCK_FIELDS: [&str; 65] = [
    // ── Dispatch markers (also the widened WHERE's predicate columns) ──
    "o2_pg_event",
    "o2_my_event",
    "o2_maria_event",
    // ── Postgres DETAIL entry ──
    "deadlock_victim_pid",
    "pg_pid",
    "dl_waiter_pid",
    "dl_lock_mode",
    "dl_lock_target",
    "dl_p1",
    "dl_waiter2_pid",
    "dl_lock_mode2",
    "dl_lock_target2",
    "dl_p2",
    "dl_query_1",
    "dl_query_2",
    "pg_app",
    "pg_user",
    "pg_txid",
    "o2_deadlock_raw",
    "pg_message",
    // ── InnoDB, MySQL prefix ──
    "my_trx_side",
    "my_victim_side",
    "my_trx_thread",
    "my_trx_query",
    "my_trx_user",
    "my_trx_host",
    "my_lock_mode",
    "my_lock_table",
    "my_lock_index",
    "my_trx_id",
    "my_message",
    // ── InnoDB, MariaDB prefix ──
    //
    // Listed in FULL, not trimmed to what one measured stream happened to
    // contain: on the rig 3 of these (`maria_lock_mode`, `maria_lock_table`,
    // `maria_lock_index`) are absent from the schema, and the schema
    // intersection is what handles that. Trimming the vocabulary instead would
    // bake one deployment's shape into a shared constant.
    "maria_trx_side",
    "maria_victim_side",
    "maria_trx_thread",
    "maria_trx_query",
    "maria_trx_user",
    "maria_trx_host",
    "maria_lock_mode",
    "maria_lock_table",
    "maria_lock_index",
    "maria_trx_id",
    "maria_message",
    // ── SQL Server, from the shredded `system_health` graph ──
    //
    // ONE ROW PER PARTICIPANT with the victim already resolved inline, so unlike
    // InnoDB there is no verdict record and nothing to stitch.
    //
    // `mssql_query` is listed even though it is ABSENT from the rig's stream
    // schema: the shred emits it as an empty string for these statements and the
    // collector drops empty attributes, so the column never materialized. That
    // is not a reason to omit it — it is precisely the case the schema
    // intersection exists for, and the canonicalizer does read it (falling back
    // to `body`, which is where the recipe's `body_column` actually puts the
    // statement). Trimming the vocabulary to one deployment's observed shape is
    // the mistake this array's doc warns about for MariaDB.
    //
    // `mssql_dl_ts` is deliberately NOT here: the shred copies it onto every row
    // and it looks projectable, but no canonicalizer reads it — `detect_timestamp`
    // supplies the event time. See `the_mssql_graph_timestamp_is_not_projected`.
    "mssql_spid",
    "mssql_query",
    "mssql_is_victim",
    "mssql_app",
    "mssql_user",
    "mssql_lock_mode",
    "mssql_lock_target",
    "mssql_db",
    // ── Shared detection inputs ──
    //
    // These are not deadlock-specific, but they are how a raw-derived event
    // acquires the `engine` / `database` / `instance` that the Rust-side scope
    // filter narrows on and that `merge_mysql_deadlocks` groups on. Without
    // them every fallback event is ungrouped and invisible to `?system=`.
    //
    // `detect_engine` additionally PREFIX-SCANS the record's own keys
    // (`dl_`/`pg_`/`maria_`/`my_`), which works on a read row because a
    // null-valued column is OMITTED from the JSON row rather than present as
    // null — so a MySQL row never acquires the `dl_*` keys that would make it
    // report "postgresql".
    "db_system_name",
    "db_system",
    "o2_recipe",
    "pg_db",
    "datname",
    "db_namespace",
    "schema_name",
    "my_db",
    "database",
    "server_address",
    "net_peer_name",
    "db_instance",
    "host_name",
    "instance",
    // The InnoDB and MSSQL raw-body fallback, and the PG `raw` fallback. Last
    // resort for `raw` on every arm.
    "body",
];

// ─── A1 phase 2a · raw blocking vocabulary (read-time fallback) ──────────────
//
// The same A1 defect, on the Blocked Queries page: an OSS build stores a
// blocking-chain row verbatim and canonicalizes nothing, so an enterprise build
// reading that history finds no `o2_dbm_kind = 'blocking'` row and renders an
// empty page over real lock contention.
//
// Blocking is a materially SIMPLER fallback than deadlocks, for two reasons
// worth stating because they are why this phase is small:
//
//  1. It folds in Rust, like deadlocks and unlike table/index health — the read projects columns
//     and `assemble_chains` runs over the result, so there is no `GROUP BY` to rewrite.
//  2. `canonicalize_blocking` is already ENGINE-AGNOSTIC. It reads recipe-aliased column names
//     (`blocked_pid` OR `waiting_thread`, …) rather than dispatching per engine, so unlike
//     deadlocks there is no new enterprise entry point to add — the existing one already returns
//     `Option<BlockingSample>` and is already re-exported to OSS.

/// The blocking markers: ONE column, four accepted recipe values.
///
/// **This is deliberately NOT shaped like `DEADLOCK_MARKERS`.** Deadlocks span
/// two ingestion shapes — three filelog engines tagged with their own
/// `o2_*_event` field, plus MSSQL keyed on its recipe tag — so detection there
/// needs four different COLUMNS. Every blocking recipe is a **sqlquery** recipe;
/// there is no log line to tag, so all four engines are identified by
/// `o2_recipe` alone and the marker set collapses to one column with four values.
///
/// The values are exactly the four blocking entries of [`RECOGNIZED_RECIPES`],
/// pinned by `every_blocking_marker_value_is_a_recognized_recipe` — a tag that
/// no collector emits matches zero rows and leaves the page as empty as it was
/// before the fallback existed.
pub const BLOCKING_MARKERS: [(&str, &str); 4] = [
    ("o2_recipe", "pg_blocking_chain"),
    ("o2_recipe", "mysql_lock_waits"),
    ("o2_recipe", "mariadb_lock_waits"),
    ("o2_recipe", "mssql_blocking_chain"),
];

/// Every RAW vendor column `canonicalize_blocking` reads, across all four
/// engines.
///
/// Carries the same hazard as [`RAW_DEADLOCK_FIELDS`]: naming a column absent
/// from the stream schema fails the whole query with a 400 rather than yielding
/// a null column, so this is a CANDIDATE list always intersected with the stream
/// schema before it reaches a projection — never emitted whole.
///
/// The list is short because `canonicalize_blocking` is engine-agnostic: it
/// resolves each field through a small alias list (`blocked_pid` OR
/// `waiting_thread`) rather than carrying a per-engine column set, so the
/// vocabulary is the union of those aliases plus the shared detection inputs.
///
/// `_timestamp` is deliberately NOT here — the builder emits it itself, and it
/// is the one column DataFusion will not null-fill.
pub const RAW_BLOCKING_FIELDS: [&str; 20] = [
    // ── The blocking edge. BOTH ends are required: `canonicalize_blocking`
    //    returns None unless both pids resolve, so dropping either alias here
    //    silently discards every row from the engines that use it. ──
    "blocked_pid",
    "waiting_thread",
    "blocking_pid",
    "blocking_thread",
    // ── Statements. `body` is the recipe's `body_column` and the last-resort
    //    fallback for the blocked statement on every engine. ──
    "blocked_query",
    "waiting_query",
    "blocking_query",
    // ── Actor identity. `blocking_state` is read as the blocking APP, which
    //    reads oddly but is what the canonicalizer does: the InnoDB recipes have
    //    no application name and expose the transaction state in that slot. ──
    "blocked_app",
    "blocked_user",
    "blocking_state",
    // ── Wait attribution. The InnoDB recipes spell the wait `wait_secs`; pg and
    //    mssql spell it `blocked_wait_s`. ──
    "wait_event_type",
    "wait_event",
    "blocked_wait_s",
    "wait_secs",
    // ── Shared detection inputs — how a raw-derived sample acquires the
    //    engine / database / instance that the Rust-side scope filter narrows on.
    //    Without them every fallback sample is invisible to `?system=`. ──
    "o2_recipe",
    "db_system_name",
    "db_system",
    "server_address",
    "db_instance",
    // The last-resort statement fallback, and `canonicalize_blocking`'s `raw`.
    "body",
];

/// The EXPLAIN document, stored as a JSON **string** (Invariant 2, module docs
/// — a plan is a tree, and the deadlock path already paid for storing one
/// nested). [`plan_of`] is its tolerant reader.
pub const O2_DBM_PLAN: &str = "o2_dbm_plan";

/// Structural hash of [`O2_DBM_PLAN`] — see [`plan_hash`].
pub const O2_DBM_PLAN_HASH: &str = "o2_dbm_plan_hash";

/// The [`PLAN_HASH_VERSION`] that produced [`O2_DBM_PLAN_HASH`].
///
/// Stored as a COLUMN, mirroring how `FP_VERSION` is stored as `o2_db_fp_version`
/// rather than only living in code. Without it a hashing-scheme change silently
/// compares incomparable hashes — the exact failure versioning exists to prevent.
pub const O2_DBM_PLAN_HASH_VERSION: &str = "o2_dbm_plan_hash_version";

pub const O2_DBM_CALLS: &str = "o2_dbm_calls";

pub const O2_DBM_ROWS: &str = "o2_dbm_rows";

/// Statement execution time in SECONDS.
///
/// The unit is in the name deliberately, and it is the OPPOSITE of
/// [`O2_DBM_EXEC_TIME_MS`] on `query_sample`. `postgresql.total_exec_time` is
/// spelled identically on both events and carries different units on each:
/// upstream #50113 has `convertMillisecondToSecond` dividing by 1000 here, while
/// `query_sample` computes `* 1e3` in SQL and is genuine milliseconds. Measured
/// at a uniform ~1000.3 ratio against `pg_stat_statements` ground truth. A
/// unit-less column name is how that ambiguity becomes a 1000x wrong number.
pub const O2_DBM_EXEC_TIME_S: &str = "o2_dbm_exec_time_s";

pub const O2_DBM_SHARED_BLKS_HIT: &str = "o2_dbm_shared_blks_hit";

pub const O2_DBM_SHARED_BLKS_READ: &str = "o2_dbm_shared_blks_read";

pub const O2_DBM_SHARED_BLKS_DIRTIED: &str = "o2_dbm_shared_blks_dirtied";

pub const O2_DBM_SHARED_BLKS_WRITTEN: &str = "o2_dbm_shared_blks_written";

pub const O2_DBM_TEMP_BLKS_READ: &str = "o2_dbm_temp_blks_read";

pub const O2_DBM_TEMP_BLKS_WRITTEN: &str = "o2_dbm_temp_blks_written";

/// Marks the counters on this row as PER-INTERVAL DELTAS, not cumulative.
///
/// Measured: the first emission per statement carries the whole
/// `pg_stat_statements` backlog (19687 calls), and every subsequent one is a
/// per-interval delta (2 calls). Summing them as cumulative double-counts the
/// backlog; treating the first as a delta renders a false spike at every
/// collector restart.
///
/// We cannot distinguish the two from a single record — the receiver ships no
/// flag and no reset counter — so the marker is UNCONDITIONAL. A marker present
/// on only some rows would be read as a claim that the others are cumulative.
pub const O2_DBM_METRICS_ARE_DELTA: &str = "o2_dbm_metrics_are_delta";

/// The emitting receiver's version, when the record carried one.
///
/// A unit test pins OUR PARSER, not the wire: when upstream fixes #50113 and
/// `total_exec_time` becomes milliseconds, that test stays green while stored
/// values silently become wrong by three orders of magnitude. This stamp is what
/// makes the change recoverable after the fact — `0.158.0` means seconds.
///
/// Free to collect: logs ingest already flattens the OTLP scope version
/// (`logs/otlp.rs:185`), and the emitting scope IS the receiver.
///
/// **The stamp is deliberately the WHOLE mitigation; the "drop values outside
/// plausible bounds" half of spec §6's risk row is declined, not overlooked.**
/// Measured across 9,028 captured records, legitimate `total_exec_time` spans
/// 2.9e-7 to 118,335 seconds — nine orders of magnitude, because the first
/// emission per statement carries the entire `pg_stat_statements` backlog while
/// later ones are per-interval deltas. No bound is simultaneously tight enough
/// to catch a 1000x unit flip and loose enough to admit a real cumulative
/// backlog, so any bound worth having would discard real data. Silently
/// dropping a measured number is the failure shape this feature's empty states
/// exist to prevent: the page would look healthy and be wrong. The stamp makes
/// a unit change detectable after the fact instead, which is recoverable.
pub const O2_DBM_RECEIVER_VERSION: &str = "o2_dbm_receiver_version";

/// WHO produced the plan on this row — the per-record honesty field (E-C).
///
/// Two producers write [`O2_DBM_PLAN`] now, and they support different claims:
/// the receiver's generic NULL-bound estimate was never executed, while an
/// auto_explain document is the plan Postgres actually ran. A response-level
/// constant cannot distinguish them inside one window, so provenance is stored
/// per record and read back per hit. Rows written before this column existed
/// are, with certainty, generic — nothing else could have written them — so
/// the reader treats absent ⇒ [`PLAN_SOURCE_GENERIC`], defaulting to the
/// WEAKER claim.
pub const O2_DBM_PLAN_SOURCE: &str = "o2_dbm_plan_source";

/// The executed wall-clock duration of THIS execution, in milliseconds — the
/// number in auto_explain's `duration: N.NNN ms  plan:` header.
///
/// Deliberately not [`O2_DBM_EXEC_TIME_S`] (top_query interval-aggregate
/// seconds) nor [`O2_DBM_EXEC_TIME_MS`] (query_sample state-dependent
/// milliseconds): a third meaning needs a third name, per the unit-in-the-name
/// discipline those two established.
pub const O2_DBM_PLAN_DURATION_MS: &str = "o2_dbm_plan_duration_ms";

/// Rows the plan's root node ACTUALLY returned (`Actual Rows`, present only
/// when `auto_explain.log_analyze = on`). [`O2_DBM_ROWS`] is the top_query
/// interval delta — a different measurement.
pub const O2_DBM_PLAN_ROWS_ACTUAL: &str = "o2_dbm_plan_rows_actual";

/// [`O2_DBM_PLAN_SOURCE`] value: the receiver's generic, NULL-bound,
/// never-executed EXPLAIN estimate (the W3 producer).
pub const PLAN_SOURCE_GENERIC: &str = "generic_null_bound";

/// [`O2_DBM_PLAN_SOURCE`] value: a real executed plan captured by
/// Postgres `auto_explain`.
pub const PLAN_SOURCE_AUTO_EXPLAIN: &str = "auto_explain";

/// Record kind: one aggregated statement, with its plan when one was captured.
///
/// **This feed is a most-FREQUENT top-N, not a most-EXPENSIVE one, and that
/// cannot be corrected downstream.** The receiver's `top_query` SQL orders by
/// `calls DESC` and sends only the top slice, so the expensive-but-infrequent
/// statement — the nightly report that runs four times and takes nine minutes,
/// which is exactly what a DBA opens this page to find — never arrives at all.
/// No read-side re-ranking can recover a row that was never sent.
///
/// Labelling is therefore the only honest option, and it is chosen deliberately
/// over re-ranking (spec §6.1, which requires W3.1 to state which). Anything
/// rendering these rows must say it is ranking by call count; a list titled
/// "Top queries" with no qualifier reads as "your slowest queries" and is
/// complete-looking enough that nobody checks.
pub const KIND_TOP_QUERY: &str = "top_query";

/// Plan-hashing algorithm version (`o2_dbm_plan_hash_version`).
///
/// Bump ONLY with a release note: like `FP_VERSION`, a bump is a discontinuity
/// for every stored hash, and every stored hash is a comparison key.
pub const PLAN_HASH_VERSION: u32 = 1;

/// Record kind: one real executed plan, captured by Postgres `auto_explain`.
pub const KIND_EXPLAIN: &str = "explain";

/// Record kind: one completed statement execution with its exact duration.
pub const KIND_STATEMENT: &str = "statement";

/// The completed execution's duration in MILLISECONDS — the number in the
/// `duration: N.NNN ms` header.
///
/// A FOURTH duration name, per the unit-in-the-name discipline the other three
/// established, because it is a fourth meaning: [`O2_DBM_EXEC_TIME_MS`] is a
/// query_sample's state-dependent elapsed/last-completed time,
/// [`O2_DBM_DURATION_MS`] is a still-running session's elapsed-so-far, and
/// [`O2_DBM_PLAN_DURATION_MS`] is an auto_explain execution. This one is the
/// engine's own completed-statement measurement — in-engine time from
/// statement start to completion, which no client necessarily experienced
/// (network and connection-pool wait are not in it).
pub const O2_DBM_STMT_DURATION_MS: &str = "o2_dbm_stmt_duration_ms";

/// Record kind: one RELATION's storage and maintenance state at one snapshot.
///
/// Deliberately NOT one of the four existing kinds — see the module note above.
pub const KIND_TABLE_STATS: &str = "table_stats";

/// The table name. Arrives in `body`, because the recipe declares `table_name`
/// as its `body_column` rather than an attribute.
pub const O2_DBM_RELATION: &str = "o2_dbm_relation";

/// The SCHEMA the relation lives in — NOT a database.
///
/// The recipe emits no `db.namespace`: `pg_class` and `pg_stat_user_tables` are
/// per-database catalogs, so the database is implicit in the collector's
/// connection and never appears on the row. `detect_database`'s alias list
/// already contains `schema_name`, so reusing it here would file every
/// `public.orders` under a DATABASE named `public` and grow the Databases page
/// a database that does not exist. The schema is stored under its own name and
/// the database is left ABSENT, which is the honest reading of a row that was
/// never told one.
pub const O2_DBM_SCHEMA: &str = "o2_dbm_schema";

/// `pg_total_relation_size` — heap + indexes + TOAST.
pub const O2_DBM_TOTAL_BYTES: &str = "o2_dbm_total_bytes";

/// `pg_relation_size` — the heap alone. Total minus heap is the index+TOAST
/// overhead, which is the number a "my indexes are bigger than my table"
/// reading needs.
pub const O2_DBM_HEAP_BYTES: &str = "o2_dbm_heap_bytes";

/// ESTIMATED live row count (`n_live_tup`). See [`O2_DBM_TUPLES_ARE_ESTIMATED`].
pub const O2_DBM_LIVE_TUPLES: &str = "o2_dbm_live_tuples";

/// ESTIMATED dead row count (`n_dead_tup`).
pub const O2_DBM_DEAD_TUPLES: &str = "o2_dbm_dead_tuples";

/// Dead tuples as a percentage of live+dead, computed by the recipe.
///
/// Fractional, and parsed as `f64` deliberately: the recipe rounds to two
/// decimals, so an integer parse turns every bloat figure under 1% into `0` and
/// erases exactly the low-but-rising range a bloat trend is read from.
pub const O2_DBM_DEAD_TUP_PCT: &str = "o2_dbm_dead_tup_pct";

/// Rows changed since the last ANALYZE — how stale the planner's statistics are.
pub const O2_DBM_MOD_SINCE_ANALYZE: &str = "o2_dbm_mod_since_analyze";

/// Sequential scans, LIFETIME. See [`O2_DBM_COUNTERS_ARE_CUMULATIVE`].
pub const O2_DBM_SEQ_SCAN_COUNT: &str = "o2_dbm_seq_scan_count";

/// Rows returned by those sequential scans, LIFETIME.
pub const O2_DBM_SEQ_TUP_READ: &str = "o2_dbm_seq_tup_read";

/// Index scans against this table, LIFETIME.
///
/// A live table with `idx_scan = 0` is the never-index-scanned signal W11 is
/// built on, so a measured zero is a FINDING and must survive canonicalization
/// rather than being dropped as falsy.
pub const O2_DBM_IDX_SCAN_COUNT: &str = "o2_dbm_idx_scan_count";

/// Autovacuums run against this table, LIFETIME.
pub const O2_DBM_AUTOVACUUM_COUNT: &str = "o2_dbm_autovacuum_count";

/// `age(relfrozenxid)` — transaction-ID age, the wraparound-risk measure.
pub const O2_DBM_FROZEN_XID_AGE: &str = "o2_dbm_frozen_xid_age";

/// Last MANUAL vacuum, absent when the table has never had one.
///
/// The recipe COALESCEs a null to `''`, and a table nobody has manually
/// vacuumed is the ordinary case. The empty string is therefore read as
/// "never" and the column is OMITTED, rather than stored as `""` which renders
/// as a blank cell indistinguishable from missing data.
pub const O2_DBM_LAST_VACUUM: &str = "o2_dbm_last_vacuum";

/// Last AUTOvacuum, absent when there has never been one.
pub const O2_DBM_LAST_AUTOVACUUM: &str = "o2_dbm_last_autovacuum";

/// Last ANALYZE, absent when there has never been one.
pub const O2_DBM_LAST_ANALYZE: &str = "o2_dbm_last_analyze";

/// Marks the scan and vacuum counters on this row as CUMULATIVE SINCE THE LAST
/// `pg_stat_reset()`, not per-window.
///
/// `seq_scan`, `seq_tup_read`, `idx_scan` and `autovacuum_count` all come from
/// `pg_stat_user_tables`, which counts from the last statistics reset — a point
/// in time this feed never observes. So "0 sequential scans" means zero SINCE
/// THE RESET, and rendering it under a window filter as "0 in the last hour" is
/// a strictly stronger claim than the data supports.
///
/// **We disclose rather than delta, deliberately.** A delta needs two snapshots
/// of the same relation and a guarantee no reset happened between them; the
/// hazard the codebase already documents for the top-query feed is the same one
/// here, where a reset (or a collector restart against a fresh replica) makes
/// the later value SMALLER and a naive subtraction renders a negative or a
/// wrapped-huge scan count. Labelling costs nothing and cannot be wrong.
///
/// UNCONDITIONAL, for the same reason `O2_DBM_METRICS_ARE_DELTA` is: a marker
/// present on only some rows would read as a claim that the others are
/// per-window.
pub const O2_DBM_COUNTERS_ARE_CUMULATIVE: &str = "o2_dbm_counters_are_cumulative";

/// Marks the tuple counts and the derived percentage on this row as PLANNER
/// ESTIMATES, not exact counts.
///
/// `n_live_tup`/`n_dead_tup` are maintained incrementally by the statistics
/// collector and reconciled against `reltuples` at each ANALYZE — they are not
/// a `COUNT(*)` and can be arbitrarily stale on a table that has not been
/// analyzed recently (which `o2_dbm_mod_since_analyze` on the same row
/// quantifies). `dead_tup_pct` inherits the estimate because it is computed
/// from them, and `total_bytes`/`heap_bytes` are exact by contrast — hence one
/// flag about TUPLES rather than a blanket one about the row.
pub const O2_DBM_TUPLES_ARE_ESTIMATED: &str = "o2_dbm_tuples_are_estimated";

/// Record kind: one INDEX's size and usage at one snapshot.
pub const KIND_INDEX_STATS: &str = "index_stats";

/// The index's own name — its identity. From the `index_name` attribute.
pub const O2_DBM_INDEX_NAME: &str = "o2_dbm_index_name";

/// `pg_relation_size` of the index. Exact, not an estimate.
///
/// This is the number that makes a never-scanned index worth reporting: an
/// unused 8 KB index costs nothing, an unused 2.8 MB index is real storage and
/// real write amplification.
pub const O2_DBM_INDEX_BYTES: &str = "o2_dbm_index_bytes";

/// Index entries returned by scans of this index, LIFETIME.
pub const O2_DBM_IDX_TUP_READ: &str = "o2_dbm_idx_tup_read";

/// Live table rows fetched by scans of this index, LIFETIME.
pub const O2_DBM_IDX_TUP_FETCH: &str = "o2_dbm_idx_tup_fetch";

/// Whether this index enforces a UNIQUE or PRIMARY KEY constraint.
///
/// Load-bearing for the never-scanned rule rather than decorative. Measured on
/// the live rig: three of the six largest indexes are `*_pkey`, and a zero scan
/// count on one of those means the planner has not chosen it for a LOOKUP — the
/// constraint is still enforced on every insert. Without this the rule cannot
/// separate a redundant index from a primary key.
pub const O2_DBM_INDEX_IS_UNIQUE: &str = "o2_dbm_index_is_unique";

/// Read the first present, non-empty value among `keys`, as a string.
pub fn first_str(rec: &Map<String, Value>, keys: &[&str]) -> Option<String> {
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
pub fn first_i64(rec: &Map<String, Value>, keys: &[&str]) -> Option<i64> {
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

pub fn first_f64(rec: &Map<String, Value>, keys: &[&str]) -> Option<f64> {
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
pub fn detect_engine(rec: &Map<String, Value>) -> Option<String> {
    if let Some(sys) = first_str(rec, &["db_system_name", "db_system"]) {
        return Some(canonical_system(&sys));
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
        // The table/index health recipes — the tag names the engine for the
        // same reason the blocking tags above do: a sqlquery row carries ONLY
        // the columns the recipe selects, and the three engines' recipes emit
        // the SAME column aliases by design, so the tag is the only
        // discriminator there is.
        Some("pg_table_stats") | Some("pg_index_stats") => {
            return Some("postgresql".to_string());
        }
        Some("mysql_table_stats") | Some("mysql_index_stats") => {
            return Some("mysql".to_string());
        }
        Some("mariadb_table_stats") | Some("mariadb_index_stats") => {
            return Some("mariadb".to_string());
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

pub fn detect_database(rec: &Map<String, Value>) -> Option<String> {
    first_str(
        rec,
        &[
            "pg_db",
            "datname",
            "db_namespace",
            "schema_name",
            "my_db",
            // The MSSQL deadlock shred emits the participant's database as
            // `mssql_db` (`@currentdbname` from the deadlock graph). It was
            // already in the raw-projection vocabulary and in
            // `canonicalize_mssql_deadlock`'s own local lookup, but NOT here --
            // so every other consumer of `detect_database` saw null on a row
            // that was carrying a perfectly good database all along. Measured on
            // the reference rig: 42/42 mssql_deadlock rows populated.
            "mssql_db",
            "database",
        ],
    )
}

pub fn detect_instance(rec: &Map<String, Value>) -> Option<String> {
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
    .map(|a| strip_port(&a))
}

pub fn detect_timestamp(rec: &Map<String, Value>) -> Option<i64> {
    // `_timestamp` is resolved by the ingest path before canonicalization runs, so it is
    // trustworthy; the canonical name is an output only.
    first_i64(rec, &["_timestamp"])
}

/// Numbers arrive as JSON numbers from our own canonicalizer but as STRINGS when a record was
/// canonicalized by a VRL pipeline (all `sqlqueryreceiver` columns are text).
pub fn as_i64_loose(v: &Value) -> Option<i64> {
    match v {
        Value::Number(n) => n.as_i64(),
        Value::String(s) => s.trim().parse().ok(),
        _ => None,
    }
}

pub fn insert_opt(out: &mut BTreeMap<String, Value>, key: &str, val: Option<String>) {
    if let Some(v) = val.filter(|s| !s.is_empty()) {
        out.insert(key.to_string(), json!(v));
    }
}

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
    match db_normalizer::normalize(trimmed, dialect) {
        Ok(ns) => {
            let norm = ns
                .query_norm
                .as_deref()
                .map(|s| db_normalizer::truncate_at_boundary(s, MAX_PARTICIPANT_QUERY).to_string());
            (norm, Some(ns.fingerprint))
        }
        Err(_) => (None, None),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    /// This vocabulary lives in `config` rather than in core for one reason:
    /// `o2_enterprise` cannot depend on `openobserve_core` (that is a Cargo
    /// cycle), but it CAN depend on `config`. If these items stop being
    /// reachable here, the enterprise half of DBM stops compiling.
    #[test]
    fn the_shared_dbm_vocabulary_is_reachable_from_config() {
        assert_eq!(ALL_DBM_FIELDS.len(), 83);
        assert_eq!(KIND_DEADLOCK, "deadlock");
        assert_eq!(KIND_BLOCKING, "blocking");
        assert_eq!(KIND_TABLE_STATS, "table_stats");
        assert_eq!(KIND_INDEX_STATS, "index_stats");

        let mut rec = serde_json::Map::new();
        rec.insert("db_system_name".into(), json!("postgresql"));
        assert_eq!(detect_engine(&rec).as_deref(), Some("postgresql"));
        assert_eq!(as_i64_loose(&json!("7")), Some(7));
    }

    // ── A1 · the raw deadlock read-time fallback vocabulary ─────────────────

    /// The raw list is a READ-side projection allowlist, and it must never
    /// overlap the canonical one.
    ///
    /// The two are concatenated into one `SELECT` by the deadlocks read
    /// (`api.rs` `build_dbm_events_sql`). An overlapping member would be named
    /// TWICE in the same projection, which is a duplicate-column SQL error and
    /// therefore a 400 on the whole page — the exact failure class this
    /// vocabulary exists to prevent.
    #[test]
    fn raw_deadlock_fields_never_overlap_the_canonical_ones() {
        use std::collections::HashSet;

        let canonical: HashSet<&str> = ALL_DBM_FIELDS.into_iter().collect();
        let overlap: Vec<&str> = RAW_DEADLOCK_FIELDS
            .into_iter()
            .filter(|f| canonical.contains(f))
            .collect();
        assert!(
            overlap.is_empty(),
            "a raw column that is also an ALL_DBM_FIELDS member would be projected twice \
             in one SELECT and 400 the whole page: {overlap:?}"
        );
    }

    /// The list must be free of duplicates for the same reason.
    #[test]
    fn raw_deadlock_fields_have_no_duplicates() {
        use std::collections::HashSet;

        let uniq: HashSet<&str> = RAW_DEADLOCK_FIELDS.into_iter().collect();
        assert_eq!(
            uniq.len(),
            RAW_DEADLOCK_FIELDS.len(),
            "a repeated member is projected twice in one SELECT"
        );
    }

    /// `_timestamp` must NOT be a member.
    ///
    /// The builder emits it unconditionally as the first projected column, so a
    /// member here duplicates it — and it is the ONE column DataFusion cannot
    /// null-fill (OpenObserve rewrites it to `nullable = false` before
    /// `with_schema`), so it is also the one column whose mishandling is a hard
    /// exec error rather than a null.
    #[test]
    fn raw_deadlock_fields_exclude_the_timestamp_column() {
        assert!(
            !RAW_DEADLOCK_FIELDS.contains(&"_timestamp"),
            "_timestamp is emitted by the builder itself and is non-nullable"
        );
    }

    /// The three filelog markers are what DETECTS an un-canonicalized row, and
    /// each is a real column the raw projection may name — so they are gated on
    /// schema presence like everything else, and must be part of the raw
    /// vocabulary.
    #[test]
    fn the_deadlock_marker_columns_are_part_of_the_raw_vocabulary() {
        for (col, _) in DEADLOCK_MARKERS {
            assert!(
                RAW_DEADLOCK_FIELDS.contains(&col),
                "marker column {col:?} is named in the widened WHERE, so it must also be \
                 schema-gated through RAW_DEADLOCK_FIELDS"
            );
        }
        let markers: Vec<&str> = DEADLOCK_MARKERS.iter().map(|(c, _)| *c).collect();
        assert_eq!(
            markers,
            vec!["o2_pg_event", "o2_my_event", "o2_maria_event", "o2_recipe"],
            "all four deadlock surfaces ship — the three filelog engines plus the \
             mssql sqlquery recipe"
        );
        // The three filelog markers compare against `deadlock`; mssql does NOT.
        // It is a RECIPE TAG, and its value is the recipe's own name — asserting
        // KIND_DEADLOCK across all four would be wrong, and writing
        // `o2_recipe = 'deadlock'` into the widened WHERE would match zero rows
        // while looking correct.
        for (col, val) in DEADLOCK_MARKERS {
            let expected = if col == "o2_recipe" {
                "mssql_deadlock"
            } else {
                KIND_DEADLOCK
            };
            assert_eq!(
                val, expected,
                "marker {col:?} compares against the wrong value"
            );
        }
    }

    /// MSSQL raw columns SHIP — this pins the arm that replaced phase 1's
    /// deliberate omission.
    ///
    /// This test used to be `phase_one_ships_no_mssql_raw_columns`, asserting the
    /// exact opposite: mssql was held back because its raw columns were absent
    /// from every stream that could be measured, so the arm would have shipped
    /// unexercised. That is no longer true. A collector DSN bug (the `#` in the
    /// SQL Server password made `sqlserver://…` truncate at a URL fragment) meant
    /// the two MSSQL recipes had never produced a row; with the DSN switched to
    /// key=value form the rig now carries real `mssql_deadlock` rows from real
    /// error-1205 deadlocks, and the arm has the fixture it was waiting for.
    ///
    /// The inverted assertion is the point: it pins the new state so a revert
    /// cannot silently drop the arm back out.
    #[test]
    fn the_mssql_arm_ships_its_raw_columns_and_marker() {
        let mssql: Vec<&str> = RAW_DEADLOCK_FIELDS
            .into_iter()
            .filter(|f| f.starts_with("mssql_"))
            .collect();
        assert_eq!(
            mssql,
            vec![
                "mssql_spid",
                "mssql_query",
                "mssql_is_victim",
                "mssql_app",
                "mssql_user",
                "mssql_lock_mode",
                "mssql_lock_target",
                "mssql_db",
            ],
            "the mssql raw vocabulary is exactly what `canonicalize_mssql_deadlock` \
             reads — the enterprise contract test pins the other direction"
        );
        assert!(
            DEADLOCK_MARKERS
                .iter()
                .any(|(c, v)| *c == "o2_recipe" && *v == "mssql_deadlock"),
            "mssql is detected by its RECIPE TAG, not an o2_*_event field — without \
             this marker in the widened WHERE not one mssql row is ever fetched"
        );
    }

    /// `mssql_dl_ts` must NOT be projected, even though the recipe emits it on
    /// every row.
    ///
    /// It is the shared graph timestamp the shred copies onto each participant,
    /// and it looks like an obvious thing to project — but no canonicalizer reads
    /// it: `canonicalize_mssql_deadlock` takes its timestamp from the shared
    /// `detect_timestamp`. Projecting it would be bytes fetched per row that
    /// nobody consumes, which is exactly what the enterprise contract test
    /// `every_raw_field_the_oss_read_projects_is_read_by_a_canonicalizer` fails
    /// on. Pinned separately here because the reasoning is non-obvious and a
    /// future reader "fixing an omission" would reintroduce it.
    #[test]
    fn the_mssql_graph_timestamp_is_not_projected() {
        assert!(
            !RAW_DEADLOCK_FIELDS.contains(&"mssql_dl_ts"),
            "mssql_dl_ts is read by no canonicalizer — detect_timestamp supplies \
             the event time"
        );
    }

    // ── A1 phase 2a · the raw BLOCKING vocabulary ───────────────────────────

    /// Same duplicate-projection hazard as the deadlock vocabulary.
    #[test]
    fn raw_blocking_fields_never_overlap_the_canonical_ones() {
        use std::collections::HashSet;

        let canonical: HashSet<&str> = ALL_DBM_FIELDS.into_iter().collect();
        let overlap: Vec<&str> = RAW_BLOCKING_FIELDS
            .into_iter()
            .filter(|f| canonical.contains(f))
            .collect();
        assert!(
            overlap.is_empty(),
            "a raw column that is also an ALL_DBM_FIELDS member would be projected twice \
             in one SELECT and 400 the whole page: {overlap:?}"
        );
    }

    #[test]
    fn raw_blocking_fields_have_no_duplicates() {
        use std::collections::HashSet;

        let uniq: HashSet<&str> = RAW_BLOCKING_FIELDS.into_iter().collect();
        assert_eq!(
            uniq.len(),
            RAW_BLOCKING_FIELDS.len(),
            "a repeated member is projected twice in one SELECT"
        );
    }

    #[test]
    fn raw_blocking_fields_exclude_the_timestamp_column() {
        assert!(
            !RAW_BLOCKING_FIELDS.contains(&"_timestamp"),
            "_timestamp is emitted by the builder itself and is non-nullable"
        );
    }

    /// Blocking is detected by ONE marker column, not four.
    ///
    /// Unlike deadlocks — where three filelog engines each tag their own
    /// `o2_*_event` field and only MSSQL keys on the recipe — every blocking
    /// recipe is a **sqlquery** recipe, so there is no log line to tag and all
    /// four engines are identified by `o2_recipe` alone. That collapses the
    /// four-column marker set to a single column with four accepted values,
    /// which is why this cannot reuse `DEADLOCK_MARKERS`' shape.
    #[test]
    fn the_blocking_markers_are_one_column_with_four_recipe_values() {
        let cols: std::collections::HashSet<&str> =
            BLOCKING_MARKERS.iter().map(|(c, _)| *c).collect();
        assert_eq!(
            cols.len(),
            1,
            "every blocking recipe is a sqlquery recipe keyed on o2_recipe; a second \
             marker column means an engine was given a filelog detection it does not have"
        );
        assert!(cols.contains("o2_recipe"));

        let values: Vec<&str> = BLOCKING_MARKERS.iter().map(|(_, v)| *v).collect();
        assert_eq!(
            values,
            vec![
                "pg_blocking_chain",
                "mysql_lock_waits",
                "mariadb_lock_waits",
                "mssql_blocking_chain",
            ],
            "all four blocking recipes must be detected, or that engine's OSS-ingested \
             history stays invisible"
        );
    }

    /// The marker column must itself be schema-gated through the vocabulary.
    #[test]
    fn the_blocking_marker_column_is_part_of_the_raw_vocabulary() {
        for (col, _) in BLOCKING_MARKERS {
            assert!(
                RAW_BLOCKING_FIELDS.contains(&col),
                "marker column {col:?} is named in the widened WHERE, so it must also be \
                 schema-gated through RAW_BLOCKING_FIELDS"
            );
        }
    }

    /// Every blocking marker value must be a RECOGNIZED recipe.
    ///
    /// The two lists are maintained independently but describe the same four
    /// recipes, and a typo in either is silent: a marker naming a recipe tag no
    /// collector emits matches zero rows, and the page stays empty exactly as it
    /// did before the fallback existed.
    #[test]
    fn every_blocking_marker_value_is_a_recognized_recipe() {
        for (_, tag) in BLOCKING_MARKERS {
            assert!(
                RECOGNIZED_RECIPES.contains(&tag),
                "blocking marker {tag:?} is not in RECOGNIZED_RECIPES — either it is a \
                 typo that will match zero rows, or a recipe was added without \
                 registering it"
            );
        }
    }
}
