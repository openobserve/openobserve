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

//! Server-vantage canonicalization tests.
//!
//! The deadlock/blocking fixtures are the REAL captured records from
//! `docs/___databsepages/dbm-server-vantage-proof.md` §2.1/§2.2 — field names, pids, and SQL
//! verbatim. If a collector release renames a field, these fail loudly rather than silently
//! returning empty events.
//!
//! DEADLOCK / BLOCKING / CHAIN-ASSEMBLY UNIT TESTS MOVED TO ENTERPRISE. Their
//! subjects (`canonicalize_pg_deadlock`, `canonicalize_blocking`,
//! `assemble_chains`, …) now live in `o2_enterprise::enterprise::db_monitoring`
//! and their tests moved with them, verbatim, to that crate's
//! `db_monitoring/tests.rs`. What stays here is the handful that call the OSS
//! DISPATCHER, [`canonicalize_record`] — the property they pin is which arm
//! claims a record, which is only observable from this side of the boundary.
//! Those run on the enterprise build and are gated accordingly.

use std::collections::BTreeMap;

use serde_json::{Map, Value, json};

use super::{
    server_vantage,
    server_vantage::{canonicalize_record, fingerprint_statement},
};

fn obj(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
}

// ─── Env-knob scaffolding (shared by every gated-ingest test) ────────────────

/// ONE shared mutex serves every knob: env vars are process-global, so two
/// knobs flipped concurrently by parallel tests would still race each other's
/// `refresh_config` — serializing them all is the only safe ordering.
static KNOB_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Set env knobs for the duration of `f`, restoring the prior values (and
/// refreshing config) afterwards.
fn with_knobs<T>(knobs: &[(&str, &str)], f: impl FnOnce() -> T) -> T {
    let _guard = KNOB_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let prev: Vec<Option<String>> = knobs.iter().map(|(k, _)| std::env::var(k).ok()).collect();
    for (k, v) in knobs {
        unsafe { std::env::set_var(k, v) };
    }
    config::refresh_config().expect("config refresh");
    let out = f();
    for ((k, _), prev) in knobs.iter().zip(prev) {
        match prev {
            Some(v) => unsafe { std::env::set_var(k, v) },
            None => unsafe { std::env::remove_var(k) },
        }
    }
    config::refresh_config().expect("config refresh");
    out
}

/// Force one boolean ingest knob ON for the duration of `f`.
fn with_knob<T>(env_var: &str, f: impl FnOnce() -> T) -> T {
    with_knobs(&[(env_var, "true")], f)
}

// ─── Fixtures: the verbatim proof records ────────────────────────────────────

/// Proof §2.1 — the captured Postgres deadlock DETAIL record.
fn pg_deadlock_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_745_930_000i64,
        "o2_pg_event": "deadlock",
        "o2_capability": "deadlock_event",
        "deadlock_victim_pid": "1071",
        "dl_waiter_pid": "1071",
        "dl_blocker_pid": "1072",
        "dl_waiter2_pid": "1072",
        "dl_blocker2_pid": "1071",
        "dl_lock_mode": "ShareLock",
        "dl_lock_target": "transaction 1430",
        "dl_lock_mode2": "ShareLock",
        "dl_lock_target2": "transaction 1429",
        "dl_query_1": "UPDATE accounts SET balance = balance - 1 WHERE id = 2 /* deadlock-a-step2 */",
        "dl_query_2": "UPDATE accounts SET balance = balance - 1 WHERE id = 1 /* deadlock-b-step2 */",
        "pg_app": "dbm-sv-deadlock-a",
        "pg_user": "dbm",
        "pg_db": "dbmlab",
        "pg_pid": "1071",
        "pg_txid": "1429",
        "o2_deadlock_raw": "Process 1071 waits for ShareLock on transaction 1430; blocked by process 1072.",
    }))
}

/// Proof §2.2 — the captured `pg_blocking_chain` record.
fn pg_blocking_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_700_000_000i64,
        "o2_recipe": "pg_blocking_chain",
        "blocked_pid": "1070",
        "blocking_pid": "1069",
        "blocked_app": "dbm-sv-lock-waiter",
        "blocking_app": "dbm-sv-lock-holder",
        "wait_event_type": "Lock",
        "wait_event": "transactionid",
        "blocked_wait_s": "4.818",
        "blocking_query": "UPDATE inventory SET qty = qty - 1, updated_at = now() WHERE id = 7",
        "pg_db": "dbmlab",
    }))
}

/// Proof — a row the SHIPPED SQL Server deadlock shred actually returned against
/// the rig (`tests/dbm-server-vantage/captures/mssql-deadlock.xml`). Kept here
/// because the W8 recipe-classification tests below feed one realistic row per
/// shipped recipe tag, `mssql_deadlock` included; the deadlock CANONICALIZER's
/// own tests moved to enterprise along with their copy of this fixture.
fn mssql_deadlock_row(spid: &str, victim: &str, query: &str) -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_recipe": "mssql_deadlock",
        "mssql_dl_ts": "2026-08-10T09:21:10.8600000",
        "mssql_spid": spid,
        "mssql_is_victim": victim,
        "mssql_lock_mode": "X",
        "mssql_app": "pymssql=2.3.2",
        "mssql_user": "sa",
        "mssql_db": "dbmlab",
        "mssql_lock_target": "dbmlab.dbo.accounts",
        "mssql_query": query,
    }))
}

// ─── Dispatch: which arm claims which record ─────────────────────────────────
//
// These call the OSS DISPATCHER, so they stay here even though their subjects
// moved. On an enterprise build the two hooks canonicalize and the assertions
// are the ones that shipped; on OSS the same records are enterprise-owned and
// must yield NOTHING rather than leaking into a neighbouring arm — asserted by
// `enterprise_owned_records_do_not_canonicalize_on_oss` below.

#[cfg(feature = "enterprise")]
#[test]
fn mariadb_blocking_rows_are_not_labelled_mysql() {
    let row = obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_recipe": "mariadb_lock_waits",
        "waiting_thread": "14",
        "blocking_thread": "15",
        "waiting_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
        "blocking_query": "UPDATE accounts SET balance = balance + 1 WHERE id = 11",
        "wait_secs": "3",
    }));
    let rec = canonicalize_record(&row).expect("mariadb blocking row canonicalizes");
    assert_eq!(
        rec.get("o2_dbm_engine").and_then(|v| v.as_str()),
        Some("mariadb"),
        "mariadb_lock_waits must resolve to mariadb, not mysql"
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn mssql_deadlock_rows_route_to_the_deadlock_path() {
    let rec = canonicalize_record(&mssql_deadlock_row(
        "93",
        "1",
        "UPDATE accounts SET balance = balance - 1 WHERE id = 31",
    ))
    .expect("mssql deadlock row canonicalizes");
    assert_eq!(
        rec.get("o2_dbm_engine").and_then(|v| v.as_str()),
        Some("mssql")
    );
    assert_eq!(
        rec.get("o2_dbm_victim_pid").and_then(|v| v.as_i64()),
        Some(93),
        "must land on the deadlock shape, not the blocking one"
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn client_supplied_canonical_fields_are_overwritten_by_canonicalization() {
    let mut spoofed = pg_deadlock_record();
    spoofed.insert("o2_dbm_victim_pid".into(), json!(999_999));
    spoofed.insert("o2_dbm_kind".into(), json!("not-a-deadlock"));

    let canon = canonicalize_record(&spoofed).expect("canonicalized");
    assert_eq!(
        canon.get("o2_dbm_kind").unwrap(),
        &json!("deadlock"),
        "derived kind must win over a client-supplied value"
    );
    assert_eq!(
        canon.get("o2_dbm_victim_pid").unwrap(),
        &json!(1071),
        "victim pid comes from the engine's own log line, not the caller"
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn canonicalize_record_dispatches_on_recipe_tags() {
    let dl = canonicalize_record(&pg_deadlock_record()).expect("pg deadlock dispatched");
    assert_eq!(dl.get("o2_dbm_kind").unwrap(), &json!("deadlock"));
    assert_eq!(dl.get("o2_dbm_participant_count").unwrap(), &json!(2));

    let bl = canonicalize_record(&pg_blocking_record()).expect("blocking dispatched");
    assert_eq!(bl.get("o2_dbm_kind").unwrap(), &json!("blocking"));

    // Unrelated server-vantage records are left alone. `pg_table_stats` used to
    // be the example here; W10 consumes it now, so the placeholder is a recipe
    // that genuinely has no consumer.
    let other = obj(json!({"o2_recipe": "pg_unconsumed_recipe", "body": "orders"}));
    assert!(canonicalize_record(&other).is_none());
}

/// The OSS counterpart of the four dispatch tests above.
///
/// The failure this guards is not "OSS lacks the feature" — that is the point of
/// the split — but the record LEAKING into a neighbouring arm. Every deadlock
/// marker (`o2_pg_event = "deadlock"`) is also the key the `explain` and
/// `statement_duration` arms read, and every enterprise recipe tag is read by
/// the `table_stats` / `index_stats` arms below. If the enterprise-owned records
/// merely fell through instead of ending dispatch, a deadlock would be
/// canonicalized as some other kind and stored under a wrong `o2_dbm_kind`.
/// `None` is the only correct answer, and it is the same answer the enterprise
/// build's `Claim::ClaimedButUnparsed` produces.
#[cfg(not(feature = "enterprise"))]
#[test]
fn enterprise_owned_records_do_not_canonicalize_on_oss() {
    let mssql = mssql_deadlock_row("93", "1", "UPDATE accounts SET balance = 1 WHERE id = 31");
    let mut mysql_deadlock = obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_my_event": "deadlock",
        "my_trx_side": "1", "my_trx_id": "4589", "my_trx_thread": "89",
        "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
    }));
    let maria_blocking = obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_recipe": "mariadb_lock_waits",
        "waiting_thread": "14",
        "blocking_thread": "15",
        "waiting_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
        "blocking_query": "UPDATE accounts SET balance = balance + 1 WHERE id = 11",
        "wait_secs": "3",
    }));
    for (name, rec) in [
        ("pg deadlock", pg_deadlock_record()),
        ("mysql deadlock", mysql_deadlock.clone()),
        ("mssql deadlock", mssql),
        ("pg blocking", pg_blocking_record()),
        ("mariadb blocking", maria_blocking),
    ] {
        assert!(
            canonicalize_record(&rec).is_none(),
            "{name} is an Enterprise capability: OSS must canonicalize nothing \
             rather than let the record fall through to a neighbouring arm"
        );
    }

    // The strip still runs, so a caller cannot smuggle canonical columns in on
    // an enterprise-owned record either.
    mysql_deadlock.insert("o2_dbm_kind".into(), json!("deadlock"));
    mysql_deadlock.insert("o2_dbm_victim_pid".into(), json!(999_999));
    server_vantage::apply_to_record(&mut mysql_deadlock);
    assert!(
        !mysql_deadlock.contains_key("o2_dbm_kind")
            && !mysql_deadlock.contains_key("o2_dbm_victim_pid"),
        "client-supplied canonical columns must be stripped on OSS too — otherwise \
         the OSS build is the spoofing hole the strip exists to close"
    );
}

/// The query shape must be victim-order independent: the proof's Demo 2 shows the
/// victim ALTERNATING between firings of the same lock-ordering bug. If the shape
/// key depended on victim order, one bug would split into two half-as-bad rows.
// ─── Deliverable D: cross-path fingerprint equality ─────────────────────────

/// THE correlation guarantee: a statement fingerprinted from a SERVER log record
/// must equal the fingerprint the CLIENT span enrichment computes for the same
/// statement. Proof §2.6 observed byte-identical normalized text across vantages;
/// this pins it as a contract so a normalizer change can never silently break the
/// join that makes deadlocks clickable.
#[test]
fn server_vantage_fingerprint_matches_span_path_fingerprint() {
    let statement = "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'ACME-42'";

    // Server path: the deadlock/blocking canonicalizer.
    let (server_norm, server_fp) = fingerprint_statement(statement, Some("postgresql"));

    // Client path: exactly what `enrich` runs for a CLIENT span.
    let ns = super::normalizer::normalize(statement, super::Dialect::Postgresql).unwrap();

    assert_eq!(
        server_fp.as_deref(),
        Some(ns.fingerprint.as_str()),
        "server-vantage and span-path fingerprints MUST be identical — this is the join key"
    );
    assert_eq!(
        server_norm.as_deref(),
        ns.query_norm.as_deref(),
        "normalized text must also match byte-for-byte (proof §2.6)"
    );
    assert!(
        !server_norm.as_deref().unwrap().contains("ACME-42"),
        "literal leaked across the correlation path"
    );
}

/// Same statement, different literals → same fingerprint on the server path too
/// (otherwise every deadlock firing would be its own unjoinable query).
#[test]
fn server_vantage_fingerprint_is_literal_independent() {
    let (_, a) = fingerprint_statement(
        "UPDATE accounts SET balance = balance - 1 WHERE id = 1",
        Some("postgresql"),
    );
    let (_, b) = fingerprint_statement(
        "UPDATE accounts SET balance = balance - 1 WHERE id = 2",
        Some("postgresql"),
    );
    assert_eq!(a, b);
    assert!(a.is_some());
}

/// An unparseable statement yields NO fingerprint — a fabricated one would JOIN
/// the deadlock to the wrong query row (design §3.2 failure rule).
#[test]
fn unparseable_statement_yields_no_fingerprint() {
    let (norm, fp) = fingerprint_statement("SELECT 'unterminated", Some("postgresql"));
    assert!(norm.is_none() && fp.is_none());
}

#[test]
fn empty_statement_yields_no_fingerprint() {
    assert_eq!(
        fingerprint_statement("   ", Some("postgresql")),
        (None, None)
    );
}

// ─── Ingest wiring (regression: the OTLP path was never canonicalized) ────────

/// EVERY logs ingest path must call [`server_vantage::apply_to_record`].
///
/// Regression guard for a live end-to-end failure: canonicalization was inlined in
/// `logs/ingest.rs` (the JSON `/_json` + `/_bulk` path) ONLY, while every shipped collector
/// recipe exports over OTLP to `/v1/logs`, which is handled by `logs/otlp.rs`. Real captured
/// deadlocks therefore landed with their raw `dl_*` fields and ZERO `o2_dbm_*` columns, and
/// `GET /traces/db_monitoring/deadlocks` returned nothing — with no error anywhere.
///
/// A behavioral unit test cannot catch a MISSING call site, so this asserts on the source: any
/// new logs ingest path must either call the helper or consciously update this list.
#[test]
fn every_logs_ingest_path_applies_canonicalization() {
    // (file, number of record-assembly sites that must canonicalize)
    let paths = [
        (include_str!("../../logs/ingest.rs"), 1usize),
        (include_str!("../../logs/otlp.rs"), 3usize),
    ];
    for (src, expected) in paths {
        let found = src.matches("server_vantage::apply_to_record").count();
        assert_eq!(
            found, expected,
            "logs ingest path must call server_vantage::apply_to_record at every \
             record-assembly site (expected {expected}, found {found}); a path that \
             assembles records without it silently drops all o2_dbm_* columns"
        );
    }
}

// ─── Storage shape (regression: nested values kill the whole ingest batch) ────

/// Every canonical value must be a SCALAR.
///
/// Regression guard for a live end-to-end failure. `config::utils::schema` infers the logs
/// schema from the record and hard-errors with "Cannot infer schema from non-basic type value"
/// on any array/object — and that error rejects the ENTIRE ingest batch, so one deadlock record
/// silently discarded every log shipped alongside it. Canonicalization runs AFTER flattening (it
/// must — it reads the flattened receiver fields), so nothing downstream will flatten a nested
/// value we emit here. `o2_dbm_participants` is therefore a JSON string.
///
/// Both fixtures are enterprise-owned, so this runs on the enterprise build.
/// The scalar invariant itself is `config`-wide; the enterprise suite carries
/// its own writers' half.
#[cfg(feature = "enterprise")]
#[test]
fn canonical_record_contains_only_scalars() {
    for rec in [
        canonicalize_record(&pg_deadlock_record()).expect("deadlock"),
        canonicalize_record(&pg_blocking_record()).expect("blocking"),
    ] {
        for (k, v) in &rec {
            assert!(
                v.is_string() || v.is_number() || v.is_boolean() || v.is_null(),
                "canonical field {k} must be a scalar (the logs schema inferrer rejects \
                 nested values and fails the whole batch), got: {v}"
            );
        }
    }
}

/// The JSON-string storage form must round-trip back to real participants, and a legacy row
/// carrying a genuine array must still parse.
#[cfg(feature = "enterprise")]
#[test]
fn participants_round_trip_from_both_storage_forms() {
    let rec = canonicalize_record(&pg_deadlock_record()).expect("deadlock");
    let stored: serde_json::Value = rec.into_iter().collect::<serde_json::Map<_, _>>().into();

    let from_string = server_vantage::participants_of(&stored);
    assert_eq!(from_string.len(), 2, "JSON-string form parses back");
    assert!(
        from_string.iter().any(|p| p.victim),
        "victim flag survives the round trip"
    );
    assert!(
        from_string.iter().all(|p| p.fingerprint.is_some()),
        "fingerprints survive the round trip"
    );

    // Legacy/VRL-produced rows may hold a real array.
    let legacy = json!({ "o2_dbm_participants": [{"pid": 1, "fingerprint": "abc"}] });
    let from_array = server_vantage::participants_of(&legacy);
    assert_eq!(from_array.len(), 1, "array form still parses");
    assert_eq!(from_array[0].fingerprint.as_deref(), Some("abc"));
}

/// SQL Server blocking must survive the full ingest entry point, not just the
/// blocking canonicalizer.
///
/// `canonicalize_record` dispatches on the recipe tag, so an engine can pass
/// `canonicalize_blocking` in isolation and still be dropped at ingest if its
/// tag is missing from the hook's match arm — which is exactly the shape of bug
/// this asserts against, and the shape the repo split makes MORE likely, not
/// less: the tag list and the dispatcher now live in different crates.
#[cfg(feature = "enterprise")]
#[test]
fn mssql_blocking_survives_the_ingest_entry_point() {
    let mut ms = pg_blocking_record();
    ms.insert("o2_recipe".into(), json!("mssql_blocking_chain"));

    let out = canonicalize_record(&ms).expect("mssql blocking must canonicalize at ingest");
    assert_eq!(
        out.get(server_vantage::O2_DBM_ENGINE)
            .and_then(|v| v.as_str()),
        Some("mssql")
    );
    assert_eq!(
        out.get(server_vantage::O2_DBM_KIND)
            .and_then(|v| v.as_str()),
        Some("blocking")
    );
}

// ─── The three-way tag contract ──────────────────────────────────────────────
//
// WHY A SOURCE-SCRAPING TEST. The `o2_recipe` / `o2_*_event` tags are a contract
// between three files in three languages that no compiler connects:
//
//   1. web/.../dbmShared.ts        — the recipes we SHIP; they stamp the tags.
//   2. server_vantage.rs           — the dispatcher; it matches on the tags.
//   3. tests/dbm-server-vantage/   — the capture rig; it must EXERCISE them.
//
// Rename a tag on any one side and the other two keep compiling, keep passing
// their own unit tests, and the product silently stops canonicalizing: records
// land in `dbm_server` with raw collector fields and zero `o2_dbm_*` columns, so
// the Deadlocks / Blocked-queries pages read "collecting, but nothing here".
// That is the worst failure shape this feature has, and it has already happened
// twice (see `every_logs_ingest_path_applies_canonicalization` above).
//
// EVERYTHING IS DISCOVERED, NOTHING IS HARDCODED. A hardcoded expected-tag list
// is a fourth copy of the contract: it passes forever while a NEW recipe is
// added on one side only, which is precisely the drift that let three recipes
// ship without the rig ever running them. The sets below are extracted from each
// file's own text and compared to each other, so adding a recipe to dbmShared.ts
// fails this test until the backend and the rig both catch up.
//
// `include_str!` is compile-time on purpose: if a file is moved or renamed, this
// fails to BUILD rather than failing at runtime with a confusing missing-path
// error, and the person doing the move is told immediately.

const SHIPPED_RECIPES_TS: &str =
    include_str!("../../../../../web/src/components/ingestion/setupCard/content/dbmShared.ts");
const RIG_COLLECTOR_YAML: &str =
    include_str!("../../../../../tests/dbm-server-vantage/collector/config.yaml");

/// Every `'<tag>' AS o2_recipe` literal in a collector config (or in the
/// TypeScript that generates one). Both the shipped recipes and the rig write
/// the tag as a SQL alias, so one extractor serves both.
fn recipe_tags_in_sql(src: &str) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    for (i, _) in src.match_indices("AS o2_recipe") {
        // Walk left off the alias to the quoted literal that precedes it.
        let head = &src[..i];
        let Some(close) = head.rfind('\'') else {
            continue;
        };
        let Some(open) = head[..close].rfind('\'') else {
            continue;
        };
        let tag = &head[open + 1..close];
        // A tag is a bare identifier; anything else means the SELECT built the
        // value dynamically and this extractor should not guess.
        if !tag.is_empty() && tag.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            out.insert(tag.to_string());
        }
    }
    out
}

/// Every `o2_recipe` value the ingest dispatcher actually branches on, read out
/// of `canonicalize_record`'s own body — not a list maintained beside it.
fn recipe_tags_dispatched_by_backend() -> std::collections::BTreeSet<String> {
    let src = include_str!("server_vantage.rs");
    let start = src
        .find("pub fn canonicalize_record(")
        .expect("canonicalize_record must exist — it is the ingest entry point");
    // A top-level item ends at the first column-0 closing brace (same body
    // boundary `test_no_caller_swallows_a_schema_read_error` in api.rs uses).
    let body = src[start..]
        .split("\n}\n")
        .next()
        .expect("canonicalize_record must have a body");

    let mut out = std::collections::BTreeSet::new();
    // Both dispatch shapes in the body: the `== Some("tag")` equality used for
    // the mssql deadlock branch, and the `recipe == "tag"` chain used for
    // blocking. Extract any string literal on either side of a comparison.
    for frag in ["Some(\"", "== \""] {
        for (i, _) in body.match_indices(frag) {
            let rest = &body[i + frag.len()..];
            let Some(end) = rest.find('"') else { continue };
            let tag = &rest[..end];
            // Skip the o2_*_event VALUES ("deadlock") and the key names; recipe
            // tags are what the o2_recipe lookups compare against.
            if tag.is_empty() || tag.starts_with("o2_") {
                continue;
            }
            out.insert(tag.to_string());
        }
    }
    // `canonicalize_record` also compares o2_*_event fields to "deadlock",
    // "explain" and "statement_duration"; those are event VALUES, not recipe
    // tags, and are pinned separately below (and by the W-E3 / W-S1 dispatch
    // tests).
    out.remove("deadlock");
    out.remove("explain");
    out.remove("statement_duration");
    out
}

/// Every `o2_<engine>_event` attribute key a shipped filelog recipe stamps.
fn filelog_event_keys(src: &str) -> std::collections::BTreeSet<String> {
    let mut out = std::collections::BTreeSet::new();
    for (i, _) in src.match_indices("attributes.o2_") {
        let rest = &src[i + "attributes.".len()..];
        let key: String = rest
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        if key.ends_with("_event") {
            out.insert(key);
        }
    }
    out
}

/// Every `o2_<engine>_event` key the ingest dispatcher reads.
fn filelog_event_keys_read_by_backend() -> std::collections::BTreeSet<String> {
    let src = include_str!("server_vantage.rs");
    let start = src.find("pub fn canonicalize_record(").unwrap();
    let body = src[start..].split("\n}\n").next().unwrap();
    let mut out = std::collections::BTreeSet::new();
    for (i, _) in body.match_indices("get(\"o2_") {
        let rest = &body[i + "get(\"".len()..];
        let Some(end) = rest.find('"') else { continue };
        let key = &rest[..end];
        if key.ends_with("_event") {
            out.insert(key.to_string());
        }
    }
    out
}

/// EDGE 1 — the shipped recipes and the backend dispatcher must agree, exactly.
///
/// This is the edge the product's correctness rests on. A tag the recipes emit
/// but the backend does not dispatch is a recipe that collects into a black
/// hole; a tag the backend dispatches but nothing emits is dead code that
/// suggests a recipe exists when it does not.
#[test]
fn shipped_recipe_tags_and_backend_dispatch_agree() {
    let shipped = recipe_tags_in_sql(SHIPPED_RECIPES_TS);
    let dispatched = recipe_tags_dispatched_by_backend();

    // Guard the extractors themselves: an extractor that silently matches
    // nothing would make every assertion below vacuously true.
    assert!(
        shipped.len() >= 4,
        "expected to discover the shipped o2_recipe tags in dbmShared.ts, found {shipped:?} \
         — the extractor is broken, not the contract"
    );
    assert!(
        dispatched.len() >= 4,
        "expected to discover the o2_recipe tags canonicalize_record dispatches on, \
         found {dispatched:?} — the extractor is broken, not the contract"
    );

    // ...and prove they are DISCOVERED, not hardcoded.
    //
    // A cardinality guard alone is satisfied by a literal list, which is a fourth
    // copy of the contract: it reports green while the real files drift apart —
    // exactly the bug this whole test exists to prevent. An adversarial stub that
    // replaced both extractors with a hardcoded table passed the assertions above
    // against genuinely drifted sources, so each tag must be traceable to text in
    // the file it supposedly came from.
    for tag in &shipped {
        assert!(
            SHIPPED_RECIPES_TS.contains(&format!("'{tag}'")),
            "tag {tag:?} is not a literal in dbmShared.ts — recipe_tags_in_sql is \
             returning hardcoded values instead of reading the file"
        );
    }
    for tag in &dispatched {
        assert!(
            include_str!("server_vantage.rs").contains(&format!("\"{tag}\"")),
            "tag {tag:?} is not a literal in server_vantage.rs — \
             recipe_tags_dispatched_by_backend is hardcoded instead of reading the file"
        );
    }

    assert_eq!(
        shipped,
        dispatched,
        "the shipped collector recipes (dbmShared.ts) and the ingest dispatcher \
         (server_vantage.rs canonicalize_record) must tag and match the SAME set of \
         o2_recipe values.\n  shipped but not dispatched (collects into a black hole): {:?}\
         \n  dispatched but not shipped (dead branch): {:?}",
        shipped.difference(&dispatched).collect::<Vec<_>>(),
        dispatched.difference(&shipped).collect::<Vec<_>>(),
    );
}

/// EDGE 2 — the filelog event keys are part of the same vocabulary.
///
/// `o2_maria_event` is deliberately a SEPARATE key from `o2_my_event` (reusing
/// MySQL's would make `detect_engine` report "mysql" and let two servers' sides
/// fuse into one fabricated deadlock — see MARIADB_DEADLOG_RECEIVER). That
/// design only holds while both sides spell it the same way.
#[test]
fn shipped_filelog_event_keys_and_backend_dispatch_agree() {
    let shipped = filelog_event_keys(SHIPPED_RECIPES_TS);
    let read = filelog_event_keys_read_by_backend();

    assert!(
        shipped.len() >= 3,
        "expected to discover the shipped o2_*_event keys in dbmShared.ts, found {shipped:?}"
    );
    assert_eq!(
        shipped,
        read,
        "the filelog recipes' o2_*_event keys (dbmShared.ts) and the keys \
         canonicalize_record reads must match.\n  stamped but never read: {:?}\
         \n  read but never stamped: {:?}",
        shipped.difference(&read).collect::<Vec<_>>(),
        read.difference(&shipped).collect::<Vec<_>>(),
    );
}

/// EDGE 3 — the capture rig must exercise every recipe we ship.
///
/// THE GAP THIS TEST WAS WRITTEN FOR. The rig is the only place these recipes
/// ever run against a real server, and it was missing `mariadb_lock_waits`,
/// `mssql_blocking_chain` and `mssql_deadlock` — so three shipped recipes had
/// never been executed, while the rig's README implied full coverage. The rig
/// may legitimately carry EXTRA exploratory recipes (pg_activity, mysql_digest,
/// …) that we do not ship, so this is a subset check, not equality.
#[test]
fn capture_rig_exercises_every_shipped_recipe() {
    let shipped = recipe_tags_in_sql(SHIPPED_RECIPES_TS);
    let in_rig = recipe_tags_in_sql(RIG_COLLECTOR_YAML);

    assert!(
        in_rig.len() >= 4,
        "expected to discover the rig's o2_recipe tags, found {in_rig:?}"
    );
    // Discovered, not hardcoded — see the note in EDGE 1. A literal list here
    // would report the rig as complete no matter what the rig actually runs,
    // which is the very gap this test was written to close.
    for tag in &in_rig {
        assert!(
            RIG_COLLECTOR_YAML.contains(&format!("'{tag}'")),
            "tag {tag:?} is not a literal in the rig config — the extractor is \
             hardcoded instead of reading the file"
        );
    }
    let missing: Vec<_> = shipped.difference(&in_rig).collect();
    assert!(
        missing.is_empty(),
        "tests/dbm-server-vantage/collector/config.yaml must run every recipe we ship, \
         so a recipe cannot reach users unverified against a real server. Missing: {missing:?}"
    );
}

/// EDGE 3b — the rig's logs pipeline must match the SHIPPED pipeline's shape.
///
/// The shipped config drops every untagged record with `filter/dbm` before
/// export. On a real deployment the tagged events were 787 rows against 4.8
/// MILLION untagged ones in the same hour, and the Deadlocks page slowed to
/// 8-18s. A rig without that processor is not exercising the pipeline we ship —
/// it would never reproduce a filter that wrongly drops a new recipe's records,
/// which is the one failure the filter itself can cause.
#[test]
fn capture_rig_runs_the_shipped_dbm_filter() {
    assert!(
        SHIPPED_RECIPES_TS.contains("filter/dbm"),
        "the shipped config must define filter/dbm — if it was renamed, rename it here too"
    );
    assert!(
        RIG_COLLECTOR_YAML.contains("filter/dbm:"),
        "the rig must define the shipped filter/dbm processor"
    );

    // Defining it is not enough — an unreferenced processor is inert. Scope to
    // the `pipelines:` section: `logs:` also names a key inside the filter
    // processor's own config, and matching that instead finds no processors line
    // and reports a missing pipeline that is actually present.
    let pipelines = RIG_COLLECTOR_YAML
        .split("\n  pipelines:\n")
        .nth(1)
        .expect("the rig must have a service.pipelines section");

    // The pipeline that carries the RECIPES is the one that must filter. Find it
    // by what it READS rather than by name, so renaming the pipeline cannot
    // quietly opt it out.
    //
    // A pipeline entry is a key at exactly 4-space indent; everything more
    // deeply indented belongs to it. Splitting on the bare "\n    " substring
    // instead also cuts at the 10-space-indented receiver-list items, which
    // truncates the block before its `processors:` line.
    let mut blocks: Vec<String> = Vec::new();
    for line in pipelines.lines() {
        let is_entry = line.starts_with("    ")
            && !line.starts_with("     ")
            && line.trim_end().ends_with(':');
        if is_entry {
            blocks.push(String::new());
        }
        if let Some(cur) = blocks.last_mut() {
            cur.push_str(line);
            cur.push('\n');
        }
    }
    let recipe_pipeline = blocks
        .iter()
        .find(|block| block.contains("sqlquery/pg_blocking"))
        .expect("the rig must have a logs pipeline running the recipe receivers");
    let processors = recipe_pipeline
        .lines()
        .find(|l| l.trim_start().starts_with("processors:"))
        .expect("the rig's recipe pipeline must list processors");
    assert!(
        processors.contains("filter/dbm"),
        "the rig's recipe logs pipeline must RUN filter/dbm, not merely define it; got: {}",
        processors.trim()
    );

    // Every key the shipped filter tests must be tested by the rig's copy, or
    // the rig drops records the shipped pipeline keeps (or vice versa).
    for key in filelog_event_keys(SHIPPED_RECIPES_TS) {
        assert!(
            RIG_COLLECTOR_YAML.contains(&format!("attributes[\"{key}\"]")),
            "the rig's filter/dbm must name {key}, or every {key} record is dropped \
             while the pipeline still reports healthy"
        );
    }
}

// ─── W1 · `event_name` plumbing (spec §3 W1, D-A, D-I) ───────────────────────
//
// The OTel `postgresqlreceiver`/`mysqlreceiver` emit `db.server.query_sample` and
// `db.server.top_query` whose ONLY discriminator is the OTLP LogRecord `EventName`
// field — not an attribute, and the Body is unset (spec X3, verified against
// contrib v0.158.0 `generated_logs.go`). OpenObserve's logs ingest dropped it, so
// `canonicalize_record` could not tell the two events apart.
//
// W1 surfaces it as `o2_event_name` and reserves the key against spoofing (D-I).

/// A record shaped like a receiver `top_query` event AFTER OTLP flattening.
/// Attribute dots become underscores on the flattened map (measured: a
/// `postgresql.calls` attribute arrives at `apply_to_record` as `postgresql_calls`).
fn top_query_flattened_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_745_930_000i64,
        "postgresql_queryid": "-4166159451966930000",
        "postgresql_calls": 42,
        "db_query_text": "SELECT * FROM accounts WHERE id = $1",
        "db_namespace": "dbmlab",
    }))
}

/// A record shaped like a receiver `query_sample` event AFTER OTLP flattening.
fn query_sample_flattened_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_745_930_000i64,
        "postgresql_query_id": "-4166159451966930000",
        "postgresql_state": "active",
        "postgresql_pid": 82334,
        "db_query_text": "SELECT * FROM accounts WHERE id = 7",
    }))
}

// ─── event_name_of: the reader W2/W3 dispatch on ─────────────────────────────

/// The two receiver events differ ONLY by this value — the helper must not
/// collapse them. A reader that returned a constant, or matched a prefix, would
/// make `query_sample` and `top_query` indistinguishable, which is the exact
/// failure W1 exists to prevent.
#[test]
fn event_name_of_distinguishes_the_two_receiver_events() {
    let mut sample = query_sample_flattened_record();
    sample.insert(
        server_vantage::O2_EVENT_NAME.to_string(),
        json!("db.server.query_sample"),
    );
    let mut top = top_query_flattened_record();
    top.insert(
        server_vantage::O2_EVENT_NAME.to_string(),
        json!("db.server.top_query"),
    );

    assert_eq!(
        server_vantage::event_name_of(&sample),
        Some("db.server.query_sample")
    );
    assert_eq!(
        server_vantage::event_name_of(&top),
        Some("db.server.top_query")
    );
}

/// No event name means no event name. Returning `Some("")` would make every
/// ordinary log line look like a (nameless) receiver event to a `match`.
#[test]
fn event_name_of_is_none_when_absent() {
    let rec = top_query_flattened_record();
    assert_eq!(
        server_vantage::event_name_of(&rec),
        None,
        "a record with no event name must yield None, not Some(\"\")"
    );
}

/// An EMPTY event name is not an event name.
///
/// The producer loop only inserts when non-empty, so the OTLP path cannot produce
/// this. It is pinned because `event_name_of` is a PUBLIC reader that W2/W3 will
/// dispatch on, and `Some("")` would make a nameless record match a `_ =>` arm as
/// though it were a receiver event. (Note a VRL pipeline could NOT smuggle one in:
/// `o2_event_name` is reserved, so the pipeline-results call site strips it too.)
#[test]
fn event_name_of_is_none_for_an_empty_string() {
    let mut rec = top_query_flattened_record();
    rec.insert(server_vantage::O2_EVENT_NAME.to_string(), json!(""));
    assert_eq!(
        server_vantage::event_name_of(&rec),
        None,
        "an empty o2_event_name must read as absent, not as Some(\"\")"
    );
}

/// An empty event name must not suppress the shape-sniff fallback either —
/// otherwise a record that reaches the JSON path with an empty key becomes
/// permanently unclassifiable.
#[test]
fn resolution_falls_back_to_the_sniff_when_the_event_name_is_empty() {
    let mut rec = top_query_flattened_record();
    rec.insert(server_vantage::O2_EVENT_NAME.to_string(), json!(""));
    assert_eq!(
        server_vantage::resolve_event_name(&rec),
        Some("db.server.top_query"),
        "an empty event name is absent, so resolution must fall through to the sniff"
    );
}

/// A non-string value is not an event name. `serde_json`'s `as_str` returns None
/// for numbers, so this pins that the helper does not stringify.
#[test]
fn event_name_of_is_none_for_a_non_string_value() {
    let mut rec = top_query_flattened_record();
    rec.insert(server_vantage::O2_EVENT_NAME.to_string(), json!(12345));
    assert_eq!(
        server_vantage::event_name_of(&rec),
        None,
        "a numeric o2_event_name is not a receiver event name"
    );
}

// ─── D-I · reservation against spoofing ──────────────────────────────────────

/// `apply_to_record` CANNOT distinguish a trusted value from a spoofed one, and
/// must therefore strip unconditionally.
///
/// This is the subtle heart of D-I, and getting it backwards produces a security
/// hole. `apply_to_record` receives only a `&mut Map` — a trusted OTLP-derived
/// `o2_event_name` and a caller-forged one are byte-identical at that boundary.
/// Any rule that preserved "the trusted one" could only be guessing from the
/// record's SHAPE, which is exactly what a spoofer controls: a caller POSTing
/// `{"postgresql_calls":42,"o2_event_name":"db.server.top_query"}` to `/_json`
/// would corroborate its own forgery and be believed.
///
/// So the strip is unconditional, and re-insertion of the trusted value is the
/// PRODUCER LOOP's job, after the strip (spec D-I). This test pins the strip half;
/// `otlp_reinserts_the_trusted_event_name_after_canonicalization` pins the other.
#[test]
fn apply_to_record_strips_the_event_name_it_cannot_authenticate() {
    let mut rec = top_query_flattened_record();
    // A value identical to what the producer loop would write — and identical to
    // what a spoofer would POST. Indistinguishable here, so it must not survive.
    // Keyed by the LITERAL wire name (not the const) so this asserts the real
    // ingest contract rather than whatever the const happens to hold.
    rec.insert("o2_event_name".to_string(), json!("db.server.top_query"));

    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get("o2_event_name"),
        None,
        "apply_to_record must strip unconditionally: it cannot tell provenance, so \
         preserving a 'trusted-looking' value would let a caller forge one by \
         matching the record shape"
    );
}

/// The strip must not be selective about the value. A guard that only removed
/// values it recognised would let an unknown-but-forged name through.
#[test]
fn caller_supplied_event_name_is_stripped_whatever_its_value() {
    for forged in [
        "db.server.top_query",
        "db.server.query_sample",
        "totally.made.up",
        "",
    ] {
        let mut spoofed = query_sample_flattened_record();
        spoofed.insert("o2_event_name".to_string(), json!(forged));
        server_vantage::apply_to_record(&mut spoofed);
        assert_eq!(
            spoofed.get("o2_event_name"),
            None,
            "caller-supplied o2_event_name={forged:?} must be stripped regardless of value"
        );
    }
}

// ─── No-regression: the hot path shared by ALL logs ──────────────────────────

/// A record with NO event name must come out byte-identical.
///
/// This is the whole-product risk in W1: `apply_to_record` runs on every log line
/// every customer ships. An unconditional insert would add a column to all of them.
#[test]
fn record_without_event_name_is_unchanged() {
    let mut rec = obj(json!({
        "_timestamp": 1_786_165_745_930_000i64,
        "level": "info",
        "message": "an ordinary application log line",
        "service_name": "checkout",
    }));
    let before = rec.clone();

    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec, before,
        "an ordinary log record must be byte-identical after canonicalization — \
         W1 must not add a column to every log line in the product"
    );
}

/// **The strip pre-scan must COVER every reserved field.**
///
/// `apply_to_record` gates the 83-key reservation strip on
/// `has_reserved_dbm_key`, one O(record keys) scan — because it runs on every
/// log record every customer ships and ~100% of them carry no DBM key at all.
/// That makes the pre-scan's prefix set load-bearing: a reserved field the
/// scan did not cover would dodge the strip entirely and become forgeable. So
/// every `ALL_DBM_FIELDS` member must trip the predicate on its own, and a
/// plain record must not (the byte-identical pass-through itself is pinned by
/// `record_without_event_name_is_unchanged`; that a covered record still gets
/// stripped exactly as before is pinned by the strip tests, e.g.
/// `caller_supplied_table_columns_are_stripped`).
#[test]
fn the_strip_prescan_covers_every_reserved_field() {
    for f in server_vantage::ALL_DBM_FIELDS {
        let rec = obj(json!({ f: "forged" }));
        assert!(
            server_vantage::has_reserved_dbm_key(&rec),
            "`{f}` is reserved but the strip pre-scan does not see it — a caller \
             could forge it and skip the strip"
        );
    }
    let plain = obj(json!({
        "_timestamp": 1_786_165_745_930_000i64,
        "level": "info",
        "message": "an ordinary application log line",
        "service_name": "checkout",
    }));
    assert!(
        !server_vantage::has_reserved_dbm_key(&plain),
        "a plain record must take the fast path — that skip is the entire point"
    );
}

/// The no-regression guarantee must hold for the DBM records that DO canonicalize
/// today: the deadlock path must not gain an `o2_event_name` column just because
/// W1 exists. Enterprise-only, since deadlocks canonicalize only there now.
#[cfg(feature = "enterprise")]
#[test]
fn existing_deadlock_canonicalization_gains_no_event_name_column() {
    let mut rec = pg_deadlock_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get("o2_dbm_kind"),
        Some(&json!("deadlock")),
        "the pre-existing deadlock path must still canonicalize"
    );
    assert_eq!(
        rec.get("o2_event_name"),
        None,
        "a filelog deadlock record has no OTLP event name and must not acquire one"
    );
}

// ─── A2 · shape-sniff fallback (spec D-A option A2) ──────────────────────────
//
// `apply_to_record` is called from `ingest.rs:726` (the JSON `/_json` path), which
// has NO OTLP envelope and therefore never carries an event name. Shape-sniffing
// is the ONLY mechanism by which that path can ever reach the W2/W3 arms, so it is
// load-bearing rather than a nicety (spec D-A correction 2).

/// `postgresql.calls` is the top_query-only counter (query_sample has no call
/// count), so its presence identifies the event on an envelope-less record.
#[test]
fn shape_sniff_identifies_top_query_without_an_event_name() {
    let rec = top_query_flattened_record();
    assert_eq!(
        server_vantage::sniff_event_name(&rec),
        Some("db.server.top_query"),
        "the JSON ingest path has no OTLP envelope; shape is the only discriminator"
    );
}

/// `postgresql.state` is the per-session field only `query_sample` carries.
#[test]
fn shape_sniff_identifies_query_sample_without_an_event_name() {
    let rec = query_sample_flattened_record();
    assert_eq!(
        server_vantage::sniff_event_name(&rec),
        Some("db.server.query_sample"),
        "query_sample is identified by its session-state attribute"
    );
}

/// The sniff must stay silent on everything else. A fallback that guessed on
/// ordinary logs would route arbitrary customer records into DBM canonicalization.
#[test]
fn shape_sniff_is_silent_on_records_that_are_not_receiver_events() {
    for (label, rec) in [
        (
            "ordinary app log",
            obj(json!({"level": "info", "message": "hello"})),
        ),
        ("empty", obj(json!({}))),
        (
            "a deadlock filelog record",
            json!(pg_deadlock_record()).as_object().unwrap().clone(),
        ),
        (
            "a blocking-chain record",
            obj(json!({"o2_recipe": "pg_blocking_chain", "blocked_pid": "1070"})),
        ),
        (
            "unrelated postgresql attributes only",
            obj(json!({"postgresql_database": "dbmlab", "level": "warn"})),
        ),
        // `db.query.text` is carried by BOTH receiver events and by ordinary
        // database logs, so it is NOT a discriminator. A sniff keyed on it (or on
        // "has query text but no state") would misclassify every record below —
        // verified to pass the rest of this suite, hence these cases.
        (
            "query text alone",
            obj(json!({"db_query_text": "SELECT 1"})),
        ),
        (
            "query text with a namespace but no discriminating attribute",
            obj(json!({"db_query_text": "SELECT 1", "db_namespace": "dbmlab"})),
        ),
        (
            "a postgresql record with neither calls nor state",
            obj(json!({
                "postgresql_queryid": "-4166159451966930000",
                "db_query_text": "SELECT 1",
            })),
        ),
    ] {
        assert_eq!(
            server_vantage::sniff_event_name(&rec),
            None,
            "shape sniff must not claim {label} is a receiver event"
        );
    }
}

/// The sniff must key on the SANCTIONED discriminators, each of which must work
/// ALONE.
///
/// The fixtures above bundle several attributes together, so a sniff keyed on an
/// unsanctioned bystander passes them by accident — verified: keying query_sample
/// detection solely on `postgresql_pid` (which only the query_sample fixture
/// happens to carry) satisfies every other test in this file. These minimal
/// records force the documented attributes to be the actual discriminators.
#[test]
fn each_sanctioned_discriminator_identifies_its_event_on_its_own() {
    // `postgresql.calls` alone => top_query. Nothing else present.
    assert_eq!(
        server_vantage::sniff_event_name(&obj(json!({"postgresql_calls": 42}))),
        Some("db.server.top_query"),
        "postgresql.calls is the top_query discriminator and must work alone"
    );

    // `postgresql.state` alone => query_sample.
    assert_eq!(
        server_vantage::sniff_event_name(&obj(json!({"postgresql_state": "active"}))),
        Some("db.server.query_sample"),
        "postgresql.state is a query_sample discriminator and must work alone"
    );

    // `postgresql.query_id` alone => query_sample. Note the underscore spelling:
    // query_sample uses `query_id` while top_query uses `queryid` (spec X4), so a
    // sniff that confuses the two mislabels every record.
    assert_eq!(
        server_vantage::sniff_event_name(&obj(json!({"postgresql_query_id": "-42"}))),
        Some("db.server.query_sample"),
        "postgresql.query_id (underscored — the query_sample spelling, X4) must \
         identify query_sample on its own"
    );
}

/// `postgresql.queryid` (top_query's spelling, X4) must NOT be read as
/// query_sample's `postgresql.query_id`. The two differ by one underscore and
/// name different events.
#[test]
fn the_two_queryid_spellings_are_not_confused() {
    // `postgresql.queryid` is an IDENTIFIER, not a discriminator: it says which
    // query, not which event. Only `postgresql.calls` marks a top_query. So the
    // correct answer is None — asserted exactly, because `assert_ne!` against
    // query_sample would also accept a wrong `top_query` verdict.
    assert_eq!(
        server_vantage::sniff_event_name(&obj(json!({"postgresql_queryid": "-42"}))),
        None,
        "postgresql.queryid identifies the query, not the event; treating it as a \
         discriminator would misclassify records carrying only an id (spec X4)"
    );
}

/// Precedence must be defined when a record carries BOTH discriminators.
///
/// No other fixture carries both, so without this the ordering of the sniff's
/// branches is arbitrary — and upstream attribute churn (X8: names moved twice in
/// 14 releases) makes a mixed record plausible rather than theoretical.
/// `postgresql.calls` is the stronger signal: it is top_query-ONLY, whereas a
/// session row can legitimately carry many fields.
#[test]
fn shape_sniff_precedence_is_defined_when_both_discriminators_are_present() {
    let mixed = obj(json!({
        "postgresql_calls": 42,
        "postgresql_state": "active",
        "db_query_text": "SELECT 1",
    }));
    assert_eq!(
        server_vantage::sniff_event_name(&mixed),
        Some("db.server.top_query"),
        "postgresql.calls is top_query-exclusive and must take precedence, so a \
         mixed record classifies deterministically rather than by branch order"
    );
}

/// A MySQL `top_query` record carries NO `postgresql.*` attributes (spec E7: MySQL
/// gained top_query at v0.158.0 but with only 8 attributes), so the Postgres shape
/// sniff must return `None` for it rather than guessing.
///
/// This pins the fallback's BOUNDARY. `None` here is correct for W1 — the JSON path
/// reaches MySQL events via the OTLP event name, and W2/W3 own any MySQL-specific
/// sniffing. What must never happen is a MySQL record being mislabelled as a
/// Postgres event, which would send it down the wrong canonicalizer arm.
#[test]
fn shape_sniff_does_not_guess_at_a_mysql_record() {
    let mysql_top_query = obj(json!({
        "_timestamp": 1_786_165_745_930_000i64,
        "mysql_digest": "8f3a2b1c9d4e5f60718293a4b5c6d7e8",
        "db_query_text": "SELECT * FROM accounts WHERE id = ?",
        "mysql_total_exec_time": 2.0035,
    }));
    assert_eq!(
        server_vantage::sniff_event_name(&mysql_top_query),
        None,
        "the Postgres shape sniff must not claim a MySQL record; mislabelling it \
         would route it to the wrong canonicalizer"
    );
}

/// **The sniff must never override a present `o2_event_name`.** The OTLP value is
/// the receiver's own discriminator; the sniff is a heuristic. If a record carries
/// a trusted event name, that wins — otherwise upstream attribute churn (X8: names
/// moved twice in 14 releases) could silently reclassify a correctly-labelled event.
#[test]
fn a_present_event_name_wins_over_the_shape_sniff() {
    // A record whose SHAPE says top_query but whose OTLP event name says
    // query_sample: the trusted envelope value must win.
    let mut rec = top_query_flattened_record();
    rec.insert(
        server_vantage::O2_EVENT_NAME.to_string(),
        json!("db.server.query_sample"),
    );

    assert_eq!(
        server_vantage::resolve_event_name(&rec),
        Some("db.server.query_sample"),
        "the OTLP-derived event name is authoritative; the sniff must not override it"
    );
}

/// With no event name present, resolution falls back to the sniff — the JSON path.
#[test]
fn resolution_falls_back_to_the_sniff_when_no_event_name_is_present() {
    assert_eq!(
        server_vantage::resolve_event_name(&top_query_flattened_record()),
        Some("db.server.top_query"),
        "the envelope-less JSON path reaches the new arms only via the sniff"
    );
}

/// Neither source ⇒ nothing. Pins that resolution does not invent an event.
#[test]
fn resolution_is_none_when_neither_source_identifies_an_event() {
    let rec = obj(json!({"level": "info", "message": "hello"}));
    assert_eq!(
        server_vantage::resolve_event_name(&rec),
        None,
        "an ordinary log is not a receiver event by either route"
    );
}

// ─── Producer-loop wiring (the insertion point itself) ───────────────────────
//
// SOURCE-SCRAPING guards over `logs/otlp.rs`: `handle_request` is async and
// writes through infra, so the wiring is asserted on the source (the
// `every_logs_ingest_path_applies_canonicalization` precedent). The three
// tests share the offset/landmark helpers below; every distinct property each
// asserts guarded a real shipped bug.

/// EVERY `apply_to_record` call site in `otlp.rs` must restore the trusted
/// event name across the strip — spec D-I: "The OTLP producer loop re-inserts
/// the trusted value **after** the strip". The strip is unconditional because
/// provenance is invisible inside `apply_to_record` (see
/// `apply_to_record_strips_the_event_name_it_cannot_authenticate`), so the only
/// place the value can be restored is where it is still recoverable. Without
/// the restore the field is plumbed to nowhere and W1 delivers nothing.
///
/// Regression guard for two real misses found in review. The first version of W1
/// restored only at the non-pipeline site; the second added the evaluation-only
/// replay but still skipped the USER-pipeline results loop, on the incorrect belief
/// that the value was unrecoverable there. It is not: that loop's `idx` indexes
/// `pipeline_inputs` (the same way it indexes `original_options` to recover
/// `_original`), and those buffered records still carry the producer-loop value.
///
/// Why it matters: without the restore, attaching ANY user pipeline to a DBM stream
/// — even a no-op VRL — silently strips the discriminator and makes
/// `db.server.query_sample` and `db.server.top_query` indistinguishable again, which
/// is precisely the bug W1 exists to fix.
#[test]
fn every_apply_site_restores_the_event_name() {
    let src = include_str!("../../logs/otlp.rs");

    let sites: Vec<usize> = src
        .match_indices("server_vantage::apply_to_record")
        .map(|(i, _)| i)
        .collect();
    assert_eq!(
        sites.len(),
        3,
        "otlp.rs is expected to canonicalize at 3 sites; if that changed, re-check \
         which of them can carry an event name across the strip"
    );

    // At the FIRST site the re-insertion must be guarded on non-empty, so an
    // ordinary log line does not acquire the column (the brace-balance check in
    // `every_event_name_write_is_guarded_on_non_empty` pins the same property
    // structurally for every write).
    let after = &src[sites[0]..];
    let reinsert_rel = after
        .find("O2_EVENT_NAME")
        .expect("the first apply site must be followed by a restore");
    let head = &after[..reinsert_rel];
    assert!(
        head.contains("event_name.is_empty()") || head.contains("event_name_value"),
        "the re-insertion must be guarded on a non-empty event name so records \
         without one stay byte-identical"
    );

    for (nth, site) in sites.iter().copied().enumerate() {
        // The restore must come before this record is handed onward — bounded by the
        // next `refactor_map` call, which is the first thing that consumes `local_val`
        // after canonicalization at every one of the three sites.
        //
        // NOT a window stretching to the next `apply_to_record`: that swallows the
        // NEXT site's restore and reports every site as covered (verified — with the
        // user-pipeline restore deleted, such a window still passed by reaching the
        // following site's code ~5 KB later). NOT a fixed byte count either: the
        // sites' comments differ in length, so the real restores sit +966, +237 and
        // +150 bytes out, and any constant that admits the first would be slack
        // enough to be meaningless for the others.
        let end = src[site..]
            .find("refactor_map")
            .map(|o| site + o)
            .unwrap_or(src.len());
        let window = &src[site..end];
        assert!(
            window.contains("O2_EVENT_NAME"),
            "apply_to_record call site #{nth} strips o2_event_name and does not restore \
             it immediately after; every site can recover the value (the pipeline sites \
             via `pipeline_inputs[idx]`), so the event name is lost for no reason"
        );
    }
}

/// Byte offsets of every place `otlp.rs` WRITES the event name, excluding imports
/// and comments.
///
/// Deliberately not a plain `find("O2_EVENT_NAME")`: the first occurrence is the
/// `use` statement, and every ordering assertion would then pass vacuously
/// (verified — with a top-of-file import the first hit lands ~byte 1654, before
/// every landmark in the function).
///
/// Imports are excluded by SKIPPING PAST THE IMPORT REGION rather than by testing
/// whether a line starts with `use `. `cargo fmt` merges a new import into the
/// existing `use crate::{ ... };` block, putting the const on a continuation line
/// that starts with neither `use` nor `//` — a line-prefix filter silently treats
/// that import as the insertion. (Observed: fmt did exactly this and broke three
/// tests with a misleading "must be inside the producer loop" message.)
fn event_name_write_offsets(src: &str) -> Vec<usize> {
    // The first function definition marks the end of the import region.
    let code_starts = src
        .find("pub async fn handle_request")
        .expect("otlp.rs must still define handle_request");

    src.match_indices("O2_EVENT_NAME")
        .map(|(i, _)| i)
        .filter(|&i| i > code_starts)
        .filter(|&i| {
            let line_start = src[..i].rfind('\n').map(|n| n + 1).unwrap_or(0);
            let line_end = src[i..].find('\n').map(|n| i + n).unwrap_or(src.len());
            let line = &src[line_start..line_end];
            // Skip comments, and skip READS (`local_val.get(O2_EVENT_NAME)`) — only a
            // write can add the column to a record, and only writes need a guard.
            !line.trim_start().starts_with("//") && !line.contains(".get(O2_EVENT_NAME)")
        })
        .collect()
}

/// The FIRST write of the event name in `otlp.rs`.
fn event_name_insertion_offset(src: &str) -> usize {
    *event_name_write_offsets(src).first().expect(
        "logs/otlp.rs must WRITE the event name under O2_EVENT_NAME (an import alone \
         is not an insertion)",
    )
}

/// The OTLP producer loop must surface `event_name` onto the record — in the
/// right SLOT: inside the producer loop, after the attribute copy and the
/// `_original` snapshot, before the pipeline push and flattening.
///
/// The behavior the surfacing half guards is measured: with the field
/// unplumbed, a LogRecord carrying `EventName = "db.server.top_query"` reaches
/// `apply_to_record` as `{_timestamp, body, dropped_attributes_count,
/// postgresql_calls, severity}` — no event name anywhere.
///
/// Spec D-A correction 1: the insertion MUST be in the producer loop, where
/// `log_record` is in scope, NOT at the three `apply_to_record` call sites — site
/// `:382` iterates pipeline results where `log_record` does not exist. One
/// insertion there covers both the pipeline and non-pipeline branches.
///
/// The ordering half is ANTI-SPOOF, not "so the canonicalizer can see it" (the
/// reservation strip removes the field before any canonicalizer arm could read
/// it): written after `log_record.attributes` are copied onto `rec`, a receiver
/// attribute literally named `o2_event_name` is overwritten by the trusted
/// value rather than winning — the same slot and the same reason `trace_id`
/// and `span_id` are written where they are. And it must follow the
/// `_original` snapshot: `_original` is a verbatim copy of what the customer
/// sent, replayed on recovery, and writing a synthesized field into it makes
/// the copy non-verbatim.
#[test]
fn otlp_producer_loop_surfaces_the_event_name() {
    let src = include_str!("../../logs/otlp.rs");

    assert!(
        src.contains("log_record.event_name"),
        "logs/otlp.rs must read the OTLP LogRecord event_name — without it the two \
         receiver events are indistinguishable (spec X3)"
    );

    let insert_at = event_name_insertion_offset(src);

    // The ordering assertions below compare byte offsets, which is only sound if
    // each landmark is UNIQUE in the file — otherwise `find` could pair the
    // insertion against an unrelated occurrence and assert nothing.
    for landmark in [
        "pipeline_inputs.push(rec)",
        "let mut rec = json::json!({});",
    ] {
        assert_eq!(
            src.matches(landmark).count(),
            1,
            "{landmark} must be unique in otlp.rs for the ordering assertions below \
             to be meaningful; if the file grew a second one, re-anchor this test"
        );
    }

    // The insertion must sit in the PRODUCER loop: before the pipeline branch
    // pushes `rec`, so that ONE insertion feeds both branches.
    let pipeline_push = src
        .find("pipeline_inputs.push(rec)")
        .expect("otlp.rs must still buffer records for the pipeline branch");
    assert!(
        insert_at < pipeline_push,
        "the event name must be set in the producer loop BEFORE pipeline_inputs.push(rec), \
         so pipeline-routed records carry it too (spec D-A correction 1)"
    );

    // Being before `pipeline_inputs.push(rec)` (asserted above) already places the
    // write outside the pipeline/non-pipeline conditional, since that push is the
    // first statement of the pipeline arm — so ONE write serves both branches.
    //
    // Deliberately NOT also anchored on `if !executable_pipelines.is_empty()`: that
    // string appears FIVE times in this file (setup, guards, both loops) and an
    // earlier version of this test matched an occurrence ~170 lines above the
    // producer loop, failing a correct implementation.

    // It must be written where `log_record` is still in scope — i.e. after `rec`
    // is created in the producer loop. This is what makes it the PRODUCER loop
    // rather than one of the three apply_to_record call sites.
    let rec_created = src
        .find("let mut rec = json::json!({});")
        .expect("the producer loop must still build `rec`");
    assert!(
        insert_at > rec_created,
        "the event name must be written onto `rec` inside the producer loop, where \
         log_record is in scope"
    );

    // The anti-spoof slot: AFTER the attribute copy, so a receiver attribute
    // literally named o2_event_name cannot beat the trusted value.
    let attrs_copied = src
        .find("log_record.attributes.iter().for_each")
        .expect("the producer loop must still copy log_record attributes onto rec");
    assert!(
        insert_at > attrs_copied,
        "the event name must be written AFTER log_record.attributes are copied, so a \
         receiver attribute named o2_event_name cannot beat the trusted value \
         (same protection trace_id/span_id get)"
    );

    // After the `_original` snapshot, so _original stays a verbatim copy of the
    // customer's payload.
    let snapshot_at = src
        .find("let original_data = if rec.is_object()")
        .expect("the producer loop must still snapshot original_data");
    assert!(
        insert_at > snapshot_at,
        "the event name must be written AFTER the _original snapshot, so _original \
         stays a verbatim copy of the customer's payload"
    );

    // And before flattening, so it is a first-class key on the flattened record
    // rather than a nested one.
    let flatten_at = src
        .find("flatten::flatten_with_level")
        .expect("the non-pipeline branch must still flatten");
    assert!(
        insert_at < flatten_at,
        "the event name must be written before flattening"
    );
}

/// The innermost block header still unclosed at byte `at` — walking backwards
/// tracking brace depth. This is what makes the guard checks below BRACE
/// BALANCE, not byte distance: a fixed-size window is bypassable by an
/// unguarded insert placed just after an unrelated CLOSED
/// `if !log_record.event_name.is_empty() { ... }` block, which sits a few bytes
/// from a matching `rfind` and passes.
fn enclosing_block_header(src: &str, at: usize) -> &str {
    let head = &src[..at];
    let mut depth = 0i32;
    for (i, ch) in head.char_indices().rev() {
        match ch {
            '}' => depth += 1,
            '{' => {
                if depth == 0 {
                    // An unclosed `{` — this block encloses the offset.
                    let line_start = head[..i].rfind('\n').map(|n| n + 1).unwrap_or(0);
                    return &head[line_start..i];
                }
                depth -= 1;
            }
            _ => {}
        }
    }
    panic!("a write must sit inside some block");
}

/// Every write must be GUARDED — on a non-empty event name (or an ordinary log
/// line acquires an empty column, the exact whole-product regression W1 must
/// avoid), and, for the producer-loop writes, on `db_monitoring.enabled`
/// (matching `apply_to_record`'s early return: without it an operator who set
/// `ZO_DB_MONITORING_ENABLED=false` still gets a DBM column written onto every
/// receiver record, for a feature they turned off).
#[test]
fn every_event_name_write_is_guarded_on_non_empty() {
    let src = include_str!("../../logs/otlp.rs");

    // Every place that WRITES the reserved key (imports/comments excluded).
    let write_offsets = event_name_write_offsets(src);

    assert!(
        !write_offsets.is_empty(),
        "otlp.rs must write the event name under O2_EVENT_NAME"
    );

    for w in write_offsets {
        let enclosing = enclosing_block_header(src, w);
        // Two guard shapes are acceptable, and both mean "only when there is one":
        //   * `if !log_record.event_name.is_empty()` — the producer-loop writes, which read the
        //     value straight off the proto.
        //   * `if let Some(..) = trusted_event_name` — the replay-site restore, whose Option is
        //     `Some` only when the producer already wrote the field, so it cannot manufacture a
        //     value for a record that never had one.
        let guarded_on_proto = enclosing.contains("event_name") && enclosing.contains("is_empty");
        let guarded_on_carried_value =
            enclosing.contains("if let Some(") && enclosing.contains("event_name");
        assert!(
            guarded_on_proto || guarded_on_carried_value,
            "each O2_EVENT_NAME write must be directly enclosed by a guard that fires \
             only when an event name exists, so a record without one is untouched; \
             innermost enclosing block header was: {}",
            enclosing.trim()
        );

        // The enclosing guard for a producer-loop write must ALSO test the
        // config. (The replay site restores a value already on the record and
        // is reached only when the producer wrote it, so it inherits the gate.)
        let head = &src[..w];
        let guard = head
            .rfind("if !log_record.event_name.is_empty()")
            .map(|g| &src[g..w]);
        if let Some(guard) = guard
            && guard.len() < 300
        {
            assert!(
                guard.contains("db_monitoring.enabled"),
                "a producer-loop write of o2_event_name must be gated on \
                 db_monitoring.enabled, matching apply_to_record's early return"
            );
        }
    }
}

// ─── W2 · Active sessions (`db.server.query_sample`) ─────────────────────────
//
// Spec §3 W2.1/W2.2. Every fixture below is a REAL captured record from
// `tests/dbm-server-vantage/captures/*.jsonl` (collector-contrib v0.158.0 against
// live Postgres 16 / MySQL 8.4), flattened the way logs ingest flattens it:
// attribute dots become underscores, `intValue` arrives as a JSON number.
//
// Hand-authoring these would defeat the point. The deleted ENGINE_SUPPORT.md
// records why: a hand-authored MySQL fixture once hid the deadlock
// victim-detection bug, because a fixture shaped like the PARSER instead of the
// PRODUCER agrees with whatever the parser does.

/// `pg-query-sample.jsonl` line 1, verbatim — an UNBLOCKED idle session.
///
/// The whole `postgresql_blocking_*` family is present with empty/zero sentinels
/// (measured 58/58 records, spec E3), so presence proves nothing; `pids != '{}'`
/// is the only blocked-ness predicate.
fn pg_query_sample_unblocked() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_519_730_706i64,
        "db_system_name": "postgresql",
        "db_namespace": "dbmlab",
        "db_query_text": "COMMIT",
        "user_name": "dbm",
        "postgresql_state": "idle",
        "postgresql_pid": 81491,
        "postgresql_application_name": "dbm-sv-oltp",
        "network_peer_address": "172.21.0.6/32",
        "network_peer_port": 38138,
        "postgresql_client_hostname": "",
        "postgresql_query_start": "2026-08-11 02:31:59.48498+00",
        "postgresql_wait_event": "ClientRead",
        "postgresql_wait_event_type": "Client",
        "postgresql_query_id": "2064869707185898531",
        "postgresql_total_exec_time": 0.021,
        "postgresql_blocking_pids": "{}",
        "postgresql_blocking_start_time": "",
        "postgresql_blocking_wait_duration": 0,
        "postgresql_blocking_lock_mode": "",
        "postgresql_blocking_lock_type": "",
        "postgresql_blocking_lock_relation": "",
        "postgresql_blocking_transaction_start_time": "",
        "o2_vantage": "server",
    }))
}

/// `pg-query-sample-blocked.jsonl` line 1, verbatim — a session blocked by ONE
/// other backend, captured during real lock contention.
fn pg_query_sample_blocked() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_609_732_198i64,
        "db_system_name": "postgresql",
        "db_namespace": "dbmlab",
        "db_query_text": "UPDATE accounts SET balance = balance ? WHERE id = ?",
        "user_name": "dbm",
        "postgresql_state": "active",
        "postgresql_pid": 82363,
        "postgresql_application_name": "psql",
        "network_peer_address": "",
        "network_peer_port": -1,
        "postgresql_client_hostname": "",
        "postgresql_query_start": "2026-08-11 02:33:28.874029+00",
        "postgresql_wait_event": "transactionid",
        "postgresql_wait_event_type": "Lock",
        "postgresql_query_id": "4863467322651468673",
        "postgresql_total_exec_time": 859.2,
        "postgresql_blocking_pids": "{82334}",
        "postgresql_blocking_start_time": "2026-08-11T02:33:28Z",
        "postgresql_blocking_wait_duration": 1,
        "postgresql_blocking_lock_mode": "ShareLock",
        "postgresql_blocking_lock_type": "transactionid",
        "postgresql_blocking_lock_relation": "",
        "postgresql_blocking_transaction_start_time": "2026-08-11T02:33:28Z",
        "o2_vantage": "server",
    }))
}

/// The MULTI-BLOCKER record from `raw/receiver-events.jsonl`, VERBATIM — a
/// tuple-lock queue with two blockers, which is normal on a lock queue (E2).
/// `{82363,81491}` is comma-separated with NO space.
///
/// This is the ONLY captured record that carries populated
/// `blocking.start_time` and `blocking.transaction.start_time`, so it is the
/// only fixture that can exercise `wait_start`/`xact_start` in their non-empty
/// form. An earlier revision of this fixture was hand-edited and blanked both,
/// which left the DBA review's "single most important column" (transaction age)
/// tested only in its empty-sentinel form — a fixture shaped like the parser
/// instead of the producer.
fn pg_query_sample_multi_blocked() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_629_732_000i64,
        "db_system_name": "postgresql",
        "db_namespace": "dbmlab",
        "db_query_text": "UPDATE accounts SET balance = balance + ? WHERE id = ?",
        "user_name": "dbm",
        "postgresql_state": "active",
        "postgresql_pid": 81517,
        "postgresql_application_name": "dbm-sv-deadlock-a",
        "network_peer_address": "172.21.0.6/32",
        "network_peer_port": 38168,
        "postgresql_client_hostname": "",
        "postgresql_query_start": "2026-08-11 02:33:43.484605+00",
        "postgresql_wait_event": "tuple",
        "postgresql_wait_event_type": "Lock",
        "postgresql_query_id": "4273073958841395500",
        "postgresql_total_exec_time": 6248.585,
        "postgresql_blocking_pids": "{82363,81491}",
        "postgresql_blocking_start_time": "2026-08-11T02:33:43Z",
        "postgresql_blocking_wait_duration": 6,
        "postgresql_blocking_lock_mode": "ExclusiveLock",
        "postgresql_blocking_lock_type": "tuple",
        "postgresql_blocking_lock_relation": "",
        "postgresql_blocking_transaction_start_time": "2026-08-11T02:33:43Z",
        "o2_vantage": "server",
    }))
}

/// A captured ON-CPU Postgres session: `wait_event`/`wait_event_type` arrive as
/// the EMPTY STRING, not null (measured 294 records in
/// `raw/receiver-events.jsonl`).
///
/// This is the same empty-string-sentinel trap E3 documents for the blocking
/// family, on the columns the wait-event breakdown groups by. Storing `""`
/// verbatim produces a SECOND empty bucket beside the null one, splitting
/// on-CPU sessions in two and skewing every `share`.
fn pg_query_sample_on_cpu() -> Map<String, Value> {
    let mut rec = pg_query_sample_unblocked();
    rec.insert("postgresql_wait_event".into(), json!(""));
    rec.insert("postgresql_wait_event_type".into(), json!(""));
    rec.insert("postgresql_state".into(), json!("active"));
    rec
}

/// `mysql-query-sample.jsonl` line 1, verbatim. MySQL carries NO blocking/lock
/// attributes at all — the lock columns must stay null rather than defaulting.
fn mysql_query_sample() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_529_744_171i64,
        "db_system_name": "mysql",
        // BOTH resource attributes, exactly as the real record carries them. The
        // ordering matters: `service.instance.id` on MySQL is an opaque server
        // UUID, while `mysql.instance.endpoint` is the addressable host:port the
        // `?instance=` filter is expressed in. An alias list that reaches the
        // UUID first labels every MySQL instance
        // `c5b91d95-178f-5a7c-93fc-0e68d122bbdd` and the filter matches nothing.
        "mysql_instance_endpoint": "mysql:3306",
        "service_instance_id": "c5b91d95-178f-5a7c-93fc-0e68d122bbdd",
        "mysql_threads_thread_id": 64671,
        "user_name": "root",
        "db_namespace": "dbmlab",
        "mysql_threads_processlist_command": "Query",
        "mysql_threads_processlist_state": "executing",
        "db_query_text": "SELECT customer_ref, SUM ( amount ) t FROM orders GROUP BY customer_ref ORDER BY t DESC LIMIT ?",
        "mysql_events_statements_current_digest": "5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3",
        "mysql_query_plan_hash": "5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3",
        "mysql_event_id": 74506,
        "mysql_wait_type": "wait/io/table/sql/handler",
        "mysql_session_status": "waiting",
        "mysql_session_id": 64631,
        "mysql_events_statements_current_timer_wait": 0.05781,
        "mysql_events_waits_current_timer_wait": 0.058730150628,
        "client_address": "172.21.0.6",
        "client_port": 35430,
        "network_peer_address": "172.21.0.6",
        "network_peer_port": 35430,
        "o2_vantage": "server",
    }))
}

/// Canonicalize through the ingest entry point, tolerating the D-G default.
///
/// `canonicalize_record`'s activity arm is gated on
/// `db_monitoring.activity_enabled`, which defaults OFF — and `get_config()` is a
/// process-wide cached singleton, so a unit test cannot flip it. These tests are
/// about DISPATCH (does a query_sample reach the activity arm, and does anything
/// else reach it by mistake), not about the gate, which
/// `the_activity_dispatch_arm_consults_the_config_knob` covers separately.
///
/// So: when the knob is on, assert on the real dispatcher. When it is off, drive
/// the same arm directly. Both paths assert the SAME thing, and neither is
/// skipped — a test that silently no-ops under the shipped default would be a
/// test that never runs in CI.
fn dispatch_activity(rec: &Map<String, Value>) -> Option<BTreeMap<String, Value>> {
    if config::get_config().db_monitoring.activity_enabled {
        return canonicalize_record(rec);
    }
    // The gate is the ONLY difference; everything below it must still hold.
    if server_vantage::resolve_event_name(rec) == Some(server_vantage::EVENT_QUERY_SAMPLE) {
        return server_vantage::canonicalize_query_sample(rec).map(|s| s.to_record());
    }
    canonicalize_record(rec)
}

/// The same record as it arrives over OTLP, i.e. carrying the event name.
fn with_event_name(mut rec: Map<String, Value>) -> Map<String, Value> {
    rec.insert(
        server_vantage::O2_EVENT_NAME.to_string(),
        json!(server_vantage::EVENT_QUERY_SAMPLE),
    );
    rec
}

// ─── W2.1 · identity and the five invariants ─────────────────────────────────

/// The happy path: a real Postgres sample canonicalizes with its session identity,
/// wait event and statement resolved into canonical columns.
#[test]
fn pg_query_sample_canonicalizes_the_session() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("a real captured query_sample must canonicalize");

    assert_eq!(s.engine.as_deref(), Some("postgresql"));
    assert_eq!(s.database.as_deref(), Some("dbmlab"));
    assert_eq!(s.session_pid, Some(81491));
    assert_eq!(s.session_user.as_deref(), Some("dbm"));
    assert_eq!(s.session_app.as_deref(), Some("dbm-sv-oltp"));
    assert_eq!(s.state.as_deref(), Some("idle"));
    assert_eq!(s.wait_event.as_deref(), Some("ClientRead"));
    assert_eq!(s.wait_event_type.as_deref(), Some("Client"));
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("2064869707185898531"),
        "the server-side id is the join key to top_query (D-C) and is stored VERBATIM"
    );
    assert_eq!(s.timestamp, Some(1_786_415_519_730_706i64));
}

/// Invariant: no session identity ⇒ no record. A row without a pid is not a
/// session, and inventing one would fabricate an entry in the Activity table.
#[test]
fn query_sample_without_a_session_identity_is_rejected() {
    let mut rec = pg_query_sample_unblocked();
    rec.remove("postgresql_pid");
    assert!(
        server_vantage::canonicalize_query_sample(&rec).is_none(),
        "a sample with no session pid has no identity and must not become a record"
    );

    let mut my = mysql_query_sample();
    my.remove("mysql_session_id");
    my.remove("mysql_threads_thread_id");
    assert!(
        server_vantage::canonicalize_query_sample(&my).is_none(),
        "MySQL identity comes from the session/thread id; without it there is no session"
    );
}

/// Invariant: statement text runs through the SAME normalizer the span path uses,
/// so an Activity row JOINs to the query rows the UI already shows (D-C).
#[test]
fn query_sample_fingerprint_matches_the_span_path() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked())
        .expect("blocked sample");
    let (_, expected) = fingerprint_statement(
        "UPDATE accounts SET balance = balance ? WHERE id = ?",
        Some("postgresql"),
    );
    assert!(expected.is_some(), "the fixture statement must fingerprint");
    assert_eq!(
        s.fingerprint, expected,
        "the activity fingerprint must be byte-identical to the span path's, or the \
         Activity row cannot join to the query it belongs to"
    );
}

/// Invariant: normalized text is preferred over raw. The receiver already
/// obfuscates, but the normalizer is what makes the text comparable across
/// vantages.
#[test]
fn query_sample_stores_normalized_statement_text() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked())
        .expect("blocked sample");
    let (norm, _) = fingerprint_statement(
        "UPDATE accounts SET balance = balance ? WHERE id = ?",
        Some("postgresql"),
    );
    assert_eq!(
        s.query.as_deref(),
        norm.as_deref(),
        "normalized text is preferred over raw, matching canonicalize_blocking"
    );
}

// ─── E2/E3 · the blocking-pids sentinel trap ─────────────────────────────────

/// **The decisive trap.** `postgresql.blocking.pids` is a STRING holding a PG
/// array literal, and the unblocked sentinel is exactly `{}` — NOT `""`.
///
/// Measured: 5495/5783 unblocked records carry `'{}'`, and all seven
/// `postgresql.blocking.*` attributes are present on every record (E3). A rule
/// that tested for `""` would see a non-empty string and mark EVERY sampled
/// session blocked, which is the phantom-blocked-sessions failure this pins.
#[test]
fn empty_pg_array_literal_is_not_blocked() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("unblocked sample");
    assert!(
        s.blocking_pids.is_empty(),
        "'{{}}' is the UNBLOCKED sentinel; testing for \"\" marks every session blocked"
    );
    assert!(
        !s.is_blocked(),
        "a session with no blockers must not report as blocked"
    );
}

/// Presence of the blocking family is NOT a blocked-signal (E3): every sentinel
/// is populated on an unblocked row, so the lock columns must stay empty too.
#[test]
fn unblocked_sentinels_do_not_populate_lock_columns() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("unblocked sample");
    assert_eq!(
        s.lock_mode, None,
        "empty-string sentinel is not a lock mode"
    );
    assert_eq!(s.lock_type, None);
    assert_eq!(s.lock_relation, None);
    assert_eq!(
        s.wait_start, None,
        "an empty blocking.start_time is a sentinel, not a wait start"
    );
    assert_eq!(
        s.xact_start, None,
        "an empty blocking.transaction.start_time is a sentinel"
    );
}

/// A single blocker parses out of the array literal.
#[test]
fn single_blocker_parses_from_the_array_literal() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked()).expect("blocked");
    assert_eq!(s.blocking_pids, vec![82334]);
    assert!(s.is_blocked());
    assert_eq!(s.lock_mode.as_deref(), Some("ShareLock"));
    assert_eq!(s.lock_type.as_deref(), Some("transactionid"));
    assert_eq!(s.wait_seconds, Some(1.0));
}

/// Multiple blockers are NORMAL (a lock queue), and every one must survive —
/// rendering `[0]` or only the first would misidentify who to kill.
#[test]
fn multiple_blockers_all_parse() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_multi_blocked())
        .expect("multi-blocked");
    assert_eq!(
        s.blocking_pids,
        vec![82363, 81491],
        "a comma-separated PG array literal yields N blockers, in order"
    );
    assert!(s.is_blocked());
}

/// Braces are stripped BEFORE emptiness is tested — the ordering the spec makes
/// binding. Whitespace variants must not resurrect a phantom blocker.
#[test]
fn blocking_pids_parses_by_stripping_braces_first() {
    for (literal, expected) in [
        ("{}", vec![]),
        ("", vec![]),
        ("{ }", vec![]),
        ("{82334}", vec![82334]),
        ("{82363,81491}", vec![82363, 81491]),
        ("{82363, 81491}", vec![82363, 81491]),
    ] {
        let mut rec = pg_query_sample_unblocked();
        rec.insert("postgresql_blocking_pids".into(), json!(literal));
        let s = server_vantage::canonicalize_query_sample(&rec)
            .unwrap_or_else(|| panic!("{literal:?} must still canonicalize"));
        assert_eq!(
            s.blocking_pids, expected,
            "blocking_pids={literal:?} must parse to {expected:?}"
        );
    }
}

/// An unparseable element is DROPPED, never fatal: a receiver change that adds a
/// non-numeric element must not delete the whole session row from the view.
#[test]
fn unparseable_blocker_elements_are_dropped_not_fatal() {
    let mut rec = pg_query_sample_unblocked();
    rec.insert(
        "postgresql_blocking_pids".into(),
        json!("{82334,bogus,81491}"),
    );
    let s = server_vantage::canonicalize_query_sample(&rec)
        .expect("an unparseable element must not fail the record");
    assert_eq!(
        s.blocking_pids,
        vec![82334, 81491],
        "drop the element we cannot read, keep the ones we can"
    );
}

/// Blocked-ness is decided by `pids` ALONE. `bl` comes from a LEFT JOIN LATERAL
/// on `pg_locks WHERE NOT granted`, so a session can hold an ungranted lock row
/// while `pg_blocking_pids()` is empty (a tuple-lock queue). One field, one
/// meaning — inferring from wait_duration or lock.mode reintroduces phantoms.
#[test]
fn blocked_ness_is_not_inferred_from_wait_duration_or_lock_mode() {
    let mut rec = pg_query_sample_unblocked();
    rec.insert("postgresql_blocking_pids".into(), json!("{}"));
    rec.insert("postgresql_blocking_wait_duration".into(), json!(42));
    rec.insert("postgresql_blocking_lock_mode".into(), json!("ShareLock"));
    let s = server_vantage::canonicalize_query_sample(&rec).expect("sample");
    assert!(
        !s.is_blocked(),
        "an ungranted lock row with no blocking pid is NOT blocked; only pids != '{{}}' decides"
    );
}

// ─── E4 · the units trap ─────────────────────────────────────────────────────

/// `total_exec_time` is SECONDS on `top_query` but genuine MILLISECONDS on
/// `query_sample` — the same attribute name, two units, measured against
/// `pg_stat_statements` ground truth at a uniform ~1000.3 ratio (E4).
///
/// The column therefore carries its unit in its NAME so the ambiguity cannot
/// propagate, and the value is stored unscaled.
#[test]
fn query_sample_exec_time_is_milliseconds_and_named_so() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked()).expect("blocked");
    assert_eq!(
        s.exec_time_ms,
        Some(859.2),
        "query_sample total_exec_time is already ms and must be stored unscaled"
    );
    assert!(
        server_vantage::O2_DBM_EXEC_TIME_MS.ends_with("_ms"),
        "the column name must state its unit, or the seconds/ms ambiguity propagates"
    );
    let rec = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked())
        .expect("blocked")
        .to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_EXEC_TIME_MS),
        Some(&json!(859.2)),
        "the stored column must be the millisecond value"
    );
    assert!(
        !rec.contains_key("o2_dbm_exec_time_s"),
        "a seconds-named column on query_sample would encode the wrong unit"
    );
}

// ─── State-dependent duration (spec W2.1 [R2]) ───────────────────────────────

/// `duration_ms` means live-elapsed for `active` but last-completed for `idle*`.
/// Rendering both in one column puts "running 40s and still going" next to "last
/// query took 40s, now idle" — opposite responses. The record must preserve
/// enough for the UI to tell them apart, so `state` is carried alongside and the
/// distinction is exposed rather than collapsed.
#[test]
fn duration_is_qualified_by_session_state() {
    let active =
        server_vantage::canonicalize_query_sample(&pg_query_sample_blocked()).expect("active");
    assert_eq!(active.state.as_deref(), Some("active"));
    assert!(
        active.duration_is_live(),
        "for an active session the duration is elapsed-so-far and still running"
    );

    let idle =
        server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked()).expect("idle");
    assert_eq!(idle.state.as_deref(), Some("idle"));
    assert!(
        !idle.duration_is_live(),
        "for an idle session the duration belongs to the LAST completed query"
    );

    let mut iit = pg_query_sample_unblocked();
    iit.insert("postgresql_state".into(), json!("idle in transaction"));
    let iit = server_vantage::canonicalize_query_sample(&iit).expect("idle in transaction");
    assert!(
        !iit.duration_is_live(),
        "every idle* state reports a COMPLETED duration"
    );

    // The distinction must survive storage, or the UI cannot make it.
    let rec = active.to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SESSION_STATE),
        Some(&json!("active")),
        "state must be stored — it is what qualifies the duration"
    );
}

// ─── MySQL ───────────────────────────────────────────────────────────────────

/// MySQL maps onto the SAME canonical columns via its own attribute names.
#[test]
fn mysql_query_sample_canonicalizes() {
    let s = server_vantage::canonicalize_query_sample(&mysql_query_sample())
        .expect("a real captured MySQL query_sample must canonicalize");
    assert_eq!(s.engine.as_deref(), Some("mysql"));
    assert_eq!(s.database.as_deref(), Some("dbmlab"));
    assert_eq!(
        s.session_pid,
        Some(64631),
        "mysql.session.id is the session"
    );
    assert_eq!(s.session_user.as_deref(), Some("root"));
    assert_eq!(s.state.as_deref(), Some("waiting"));
    assert_eq!(
        s.wait_event.as_deref(),
        Some("wait/io/table/sql/handler"),
        "mysql.wait_type maps onto the SHARED wait_event column (D-D)"
    );
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3"),
        "the MySQL digest is the server-side join key (D-C)"
    );
}

/// MySQL query_sample carries NO blocking/lock fields at all. Those columns must
/// stay NULL rather than defaulting, so the UI can degrade instead of rendering
/// an empty lock section that looks like "not blocked" when it means "unknown".
#[test]
fn mysql_lock_columns_stay_null() {
    let s = server_vantage::canonicalize_query_sample(&mysql_query_sample()).expect("mysql");
    assert!(s.blocking_pids.is_empty());
    assert_eq!(s.lock_mode, None);
    assert_eq!(s.lock_type, None);
    assert_eq!(s.lock_relation, None);
    assert_eq!(s.wait_start, None);
    assert_eq!(s.xact_start, None);

    let rec = s.to_record();
    for absent in [
        server_vantage::O2_DBM_LOCK_MODE,
        server_vantage::O2_DBM_LOCK_TYPE,
        server_vantage::O2_DBM_LOCK_RELATION,
        server_vantage::O2_DBM_BLOCKING_PIDS,
    ] {
        assert!(
            !rec.contains_key(absent),
            "{absent} must be ABSENT on MySQL, not an empty default"
        );
    }
}

// ─── W2.2 · dispatch ─────────────────────────────────────────────────────────

/// The OTLP event name routes the record to the activity arm.
#[test]
fn canonicalize_record_dispatches_query_sample_on_the_event_name() {
    let out = dispatch_activity(&with_event_name(pg_query_sample_unblocked()))
        .expect("a query_sample event must canonicalize at the ingest entry point");
    assert_eq!(
        out.get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_ACTIVITY))
    );
    assert_eq!(
        out.get(server_vantage::O2_DBM_SESSION_PID),
        Some(&json!(81491))
    );
}

/// MySQL dispatches on the event name too — it carries no `postgresql_*`
/// attribute, so the OTLP name is its only route in.
#[test]
fn canonicalize_record_dispatches_mysql_query_sample() {
    let out = dispatch_activity(&with_event_name(mysql_query_sample()))
        .expect("MySQL query_sample must canonicalize");
    assert_eq!(
        out.get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_ACTIVITY))
    );
    assert_eq!(
        out.get(server_vantage::O2_DBM_ENGINE),
        Some(&json!("mysql"))
    );
}

/// The A2 shape-sniff fallback is the ONLY route for the JSON `/_json` path,
/// which has no OTLP envelope and therefore never carries an event name.
#[test]
fn query_sample_reaches_the_activity_arm_by_shape_sniff() {
    let rec = pg_query_sample_unblocked();
    assert!(
        !rec.contains_key(server_vantage::O2_EVENT_NAME),
        "the fixture must have no event name, or this tests the wrong path"
    );
    let out = dispatch_activity(&rec)
        .expect("the JSON path must reach the activity arm by shape (spec D-A A2)");
    assert_eq!(
        out.get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_ACTIVITY))
    );
}

/// A `top_query` event must NOT land in the activity arm. The two events share
/// most of their attributes, so a dispatch keyed on anything weaker than the
/// event name would silently file statement aggregates as live sessions.
#[test]
fn top_query_does_not_become_an_activity_record() {
    let mut rec = top_query_flattened_record();
    rec.insert(
        server_vantage::O2_EVENT_NAME.to_string(),
        json!(server_vantage::EVENT_TOP_QUERY),
    );
    let out = canonicalize_record(&rec);
    assert!(
        out.as_ref()
            .and_then(|o| o.get(server_vantage::O2_DBM_KIND))
            != Some(&json!(server_vantage::KIND_ACTIVITY)),
        "top_query is a statement aggregate, not a live session (W3 owns it)"
    );
    // DISCRIMINATION, not vacuity: an implementation that simply never produces
    // activity records would satisfy the assertion above. Pin that the SAME
    // dispatcher does classify a query_sample, so this can only pass when the
    // arm exists and tells the two events apart.
    assert_eq!(
        dispatch_activity(&with_event_name(pg_query_sample_unblocked()))
            .expect("query_sample must canonicalize")
            .get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_ACTIVITY)),
        "the dispatcher must route query_sample to activity while excluding top_query"
    );
}

/// The pre-existing kinds must keep their own arms — a new dispatch arm that
/// shadowed the deadlock/blocking tags would silently break shipped pages.
#[test]
fn activity_dispatch_does_not_capture_the_existing_kinds() {
    // Deadlocks and blocking are enterprise-owned. On OSS the property still
    // holds in its meaningful form — the activity arm must not CLAIM those
    // records — but the correct outcome there is `None`, not a deadlock row.
    #[cfg(feature = "enterprise")]
    {
        assert_eq!(
            canonicalize_record(&pg_deadlock_record())
                .expect("deadlock")
                .get(server_vantage::O2_DBM_KIND),
            Some(&json!("deadlock"))
        );
        assert_eq!(
            canonicalize_record(&pg_blocking_record())
                .expect("blocking")
                .get(server_vantage::O2_DBM_KIND),
            Some(&json!("blocking"))
        );
    }
    #[cfg(not(feature = "enterprise"))]
    {
        assert!(
            canonicalize_record(&pg_deadlock_record()).is_none(),
            "an enterprise-owned deadlock must not be swept up by the activity arm"
        );
        assert!(
            canonicalize_record(&pg_blocking_record()).is_none(),
            "an enterprise-owned blocking row must not be swept up by the activity arm"
        );
    }
    // Without this the test passes while the activity arm does not exist at all.
    assert_eq!(
        dispatch_activity(&with_event_name(pg_query_sample_unblocked()))
            .expect("query_sample")
            .get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_ACTIVITY)),
        "the three kinds must coexist — each record type keeps its own arm"
    );
}

/// An ordinary log line that happens to carry an event name is not an activity
/// record: without a session identity there is nothing to canonicalize.
#[test]
fn a_nameless_shapeless_record_is_still_not_activity() {
    let mut rec = obj(json!({
        "_timestamp": 1_786_415_519_730_706i64,
        "level": "info",
        "message": "an ordinary application log line",
    }));
    rec.insert(
        server_vantage::O2_EVENT_NAME.to_string(),
        json!(server_vantage::EVENT_QUERY_SAMPLE),
    );
    assert!(
        canonicalize_record(&rec).is_none(),
        "an event name without a session identity must not fabricate a session"
    );
    // Discrimination: the identical event name WITH a session identity must
    // canonicalize, or this test passes against an arm that never fires.
    assert!(
        dispatch_activity(&with_event_name(pg_query_sample_unblocked())).is_some(),
        "the same event name with a real session must produce a record"
    );
}

// ─── W2.2 · reserved fields and the X5 batch-safety guard ────────────────────

/// W2 reuses the EXISTING wait columns rather than defining parallel ones (D-D),
/// so one wait-event view reads across activity and blocking alike.
#[test]
fn activity_reuses_the_existing_wait_columns() {
    let rec = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("sample")
        .to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_WAIT_EVENT),
        Some(&json!("ClientRead")),
        "activity must write the SHARED o2_dbm_wait_event column (D-D)"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_WAIT_EVENT_TYPE),
        Some(&json!("Client"))
    );
}

/// **X5 regression.** A nested JSON value rejects the ENTIRE ingest batch, not
/// just the record — documented at `server_vantage.rs` on the deadlock path,
/// where it already bit once. `blocking_pids` is the live risk here: it is a
/// LIST, and the obvious implementation stores it as a JSON array.
#[test]
fn activity_record_contains_only_scalars() {
    for fixture in [
        pg_query_sample_unblocked(),
        pg_query_sample_blocked(),
        pg_query_sample_multi_blocked(),
        mysql_query_sample(),
    ] {
        let rec = server_vantage::canonicalize_query_sample(&fixture)
            .expect("fixture must canonicalize")
            .to_record();
        for (k, v) in &rec {
            assert!(
                v.is_string() || v.is_number() || v.is_boolean() || v.is_null(),
                "canonical field {k} must be a SCALAR — the logs schema inferrer rejects \
                 nested values and fails the WHOLE batch — got: {v}"
            );
        }
    }
}

/// The multi-blocker list must survive storage as a scalar AND read back as real
/// numbers, mirroring the `participants_of` precedent.
#[test]
fn blocking_pids_round_trip_through_scalar_storage() {
    let rec = server_vantage::canonicalize_query_sample(&pg_query_sample_multi_blocked())
        .expect("multi-blocked")
        .to_record();
    let stored = rec
        .get(server_vantage::O2_DBM_BLOCKING_PIDS)
        .expect("blocked rows must store their blockers");
    assert!(
        stored.is_string() || stored.is_number(),
        "the blocker list must be stored as a scalar, got {stored}"
    );
    let row: Value = rec
        .clone()
        .into_iter()
        .collect::<serde_json::Map<_, _>>()
        .into();
    assert_eq!(
        server_vantage::blocking_pids_of(&row),
        vec![82363, 81491],
        "the stored form must read back as the original blocker pids"
    );
}

/// A row with no blockers reads back as an empty list, never `[0]`.
#[test]
fn unblocked_row_reads_back_as_no_blockers() {
    let rec = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("unblocked")
        .to_record();
    let row: Value = rec.into_iter().collect::<serde_json::Map<_, _>>().into();
    assert!(
        server_vantage::blocking_pids_of(&row).is_empty(),
        "an unblocked session must read back with NO blockers — never [0]"
    );
}

/// Anti-spoof: a caller POSTing canonical activity columns to `/_json` must not
/// have them stored as engine-derived truth (D1 condition 1).
#[test]
fn client_supplied_activity_columns_are_stripped() {
    let mut rec = pg_query_sample_unblocked();
    rec.insert(server_vantage::O2_DBM_SESSION_PID.into(), json!(999_999));
    rec.insert(
        server_vantage::O2_DBM_BLOCKING_PIDS.into(),
        json!("{1,2,3}"),
    );
    rec.insert(server_vantage::O2_DBM_KIND.into(), json!("activity"));

    server_vantage::apply_to_record(&mut rec);

    // The STRIP is unconditional — it runs before dispatch and is not gated on
    // the activity knob, which is the point: a forged column must never survive
    // regardless of whether the feature that would legitimately write it is on.
    assert!(
        rec.get(server_vantage::O2_DBM_BLOCKING_PIDS).is_none(),
        "a forged blocker list on an unblocked session must not survive"
    );
    assert_ne!(
        rec.get(server_vantage::O2_DBM_SESSION_PID),
        Some(&json!(999_999)),
        "the caller-supplied pid must never survive as engine-derived truth"
    );
    // NOTE the kind is deliberately NOT asserted absent: with activity ingest
    // on, this record genuinely IS an activity event, so the derived kind is
    // "activity" — the same string the caller forged. Equality there proves
    // nothing either way, which is exactly why the discriminating assertions
    // are on the pid (a value the caller cannot guess) rather than on the kind.

    // With the feature ON the derived value replaces the forgery; with the
    // feature OFF (the D-G default) the column is simply absent. Both are
    // correct; a surviving 999_999 is not.
    if config::get_config().db_monitoring.activity_enabled {
        assert_eq!(
            rec.get(server_vantage::O2_DBM_SESSION_PID),
            Some(&json!(81491)),
            "the derived pid must win over the caller-supplied one"
        );
    } else {
        assert!(
            rec.get(server_vantage::O2_DBM_SESSION_PID).is_none(),
            "with activity ingest off, no session column is written at all"
        );
    }
}

// ─── Findings from the cold test review (all reproduced before acting) ───────

/// **E5 — the server-side id can be NEGATIVE, and that is the majority case.**
///
/// Postgres's `query_id` is a SIGNED 64-bit hash. Measured in
/// `raw/receiver-events.jsonl`: 6094 of 14804 ids are negative — 41%. It is
/// stored VERBATIM because it is the sole join key between `query_sample` and
/// `top_query` (D-C/X4), so an implementation that parses it into a `u64`,
/// strips the sign, or reformats it breaks the join for 41% of queries while the
/// Activity table still renders. Silent, and invisible until someone asks why a
/// session will not link to its statement.
#[test]
fn negative_server_query_ids_survive_verbatim() {
    let mut rec = pg_query_sample_unblocked();
    rec.insert("postgresql_query_id".into(), json!("-4166159451966930000"));
    let s = server_vantage::canonicalize_query_sample(&rec).expect("sample");
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("-4166159451966930000"),
        "a negative query_id must survive byte-for-byte — 41% of real ids are negative \
         and this is the only join key to top_query"
    );
    let rec = s.to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SERVER_QUERY_ID),
        Some(&json!("-4166159451966930000")),
        "and it must reach storage unmangled"
    );
}

/// **The on-CPU sentinel.** A Postgres backend running on CPU reports an EMPTY
/// wait event, not a null one (measured: 294 records). Because `by_wait_event`
/// GROUPs BY these columns, storing `""` verbatim yields a second empty bucket
/// beside the null bucket — the same population split in two, and every `share`
/// skewed. The empty string is a sentinel, exactly as it is for the lock family.
#[test]
fn empty_wait_event_is_a_sentinel_not_a_bucket() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_on_cpu())
        .expect("an on-CPU session is still a session");
    assert_eq!(
        s.wait_event, None,
        "an empty wait_event means ON CPU — storing \"\" splits the on-CPU bucket in two"
    );
    assert_eq!(s.wait_event_type, None);

    let rec = s.to_record();
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_WAIT_EVENT),
        "the column must be ABSENT rather than an empty string, so GROUP BY sees one bucket"
    );
    assert!(!rec.contains_key(server_vantage::O2_DBM_WAIT_EVENT_TYPE));
}

/// The client address columns must be populated from the attributes the
/// receivers ACTUALLY emit.
///
/// The spec's DBA table names `client_addr`/`client_port`, but no such attribute
/// exists at v0.158.0: across all 6028 captured `query_sample` records Postgres
/// emits `network.peer.address`/`network.peer.port` plus
/// `postgresql.client_hostname`, and MySQL emits `client.address`/`client.port`.
/// Mapping the documented-but-absent names would leave "which host to go kill"
/// permanently null — a column that looks implemented and never fills.
#[test]
fn client_address_maps_from_the_attributes_the_receivers_emit() {
    let pg = server_vantage::canonicalize_query_sample(&pg_query_sample_multi_blocked())
        .expect("pg sample");
    assert_eq!(
        pg.client_addr.as_deref(),
        Some("172.21.0.6"),
        "Postgres ships the peer address as network.peer.address (normalized: the
         wire form is the CIDR 172.21.0.6/32 — see
         client_addresses_are_normalized_across_engines)"
    );
    assert_eq!(pg.client_port, Some(38168));

    let my = server_vantage::canonicalize_query_sample(&mysql_query_sample()).expect("mysql");
    assert_eq!(
        my.client_addr.as_deref(),
        Some("172.21.0.6"),
        "MySQL ships it as client.address"
    );
    assert_eq!(my.client_port, Some(35430));

    // An empty client_hostname is a sentinel, not a hostname.
    assert_eq!(
        pg.client_host, None,
        "an empty postgresql.client_hostname is a sentinel"
    );
}

/// A port sentinel is not a port.
///
/// Postgres spells "not a TCP connection" TWO ways, and both occur in the
/// captures: `-1` (10 records) and `0` (203 records), each paired with an empty
/// peer address. Port 0 is not assignable, so rendering either in a "which host
/// to go kill" column invents an endpoint that does not exist.
///
/// The `0` case was found by a surviving `>= 0` → `> 0` mutation: the boundary
/// was untested, and the implementation was in fact wrong on the more common of
/// the two spellings.
#[test]
fn sentinel_client_port_is_not_a_port() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked())
        .expect("blocked sample");
    assert_eq!(
        s.client_port, None,
        "port -1 on a socket connection is a sentinel, not a port"
    );
    assert_eq!(
        s.client_addr, None,
        "and its empty peer address is a sentinel too"
    );

    // The port-0 spelling, verbatim from a captured `dbm-sv-slow` record.
    let mut zero = pg_query_sample_unblocked();
    zero.insert("network_peer_address".into(), json!(""));
    zero.insert("network_peer_port".into(), json!(0));
    let s = server_vantage::canonicalize_query_sample(&zero).expect("port-0 sample");
    assert_eq!(
        s.client_port, None,
        "port 0 is not assignable — it is the same local-connection sentinel as -1"
    );

    // And a REAL port must still survive, or the filter is just deleting data.
    let mut real = pg_query_sample_unblocked();
    real.insert("network_peer_port".into(), json!(38138));
    let s = server_vantage::canonicalize_query_sample(&real).expect("real port sample");
    assert_eq!(
        s.client_port,
        Some(38138),
        "a genuine ephemeral port must reach the wire"
    );
}

/// `wait_start` and `xact_start` must POPULATE when the receiver sends them.
///
/// The DBA review calls transaction age "the single most important column" — it
/// is what separates `idle in transaction` for 5ms (normal) from 20 minutes (an
/// incident holding back the xmin horizon). Only the real multi-blocker capture
/// carries both non-empty, so this is the one fixture that can prove the columns
/// are wired rather than hardcoded to `None`.
#[test]
fn wait_start_and_xact_start_populate_from_a_real_blocked_record() {
    let s = server_vantage::canonicalize_query_sample(&pg_query_sample_multi_blocked())
        .expect("multi-blocked");
    assert_eq!(
        s.xact_start.as_deref(),
        Some("2026-08-11T02:33:43Z"),
        "transaction start must be carried — it is what ages a session"
    );
    assert_eq!(
        s.wait_start.as_deref(),
        Some("2026-08-11T02:33:43Z"),
        "the lock-wait start must be carried"
    );
    assert_eq!(
        s.query_start.as_deref(),
        Some("2026-08-11 02:33:43.484605+00"),
        "query start is a distinct clock from transaction start"
    );

    let rec = s.to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_XACT_START),
        Some(&json!("2026-08-11T02:33:43Z")),
        "and transaction age must survive storage, or the UI cannot compute it"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_WAIT_START),
        Some(&json!("2026-08-11T02:33:43Z"))
    );
}

/// **The duration column must carry a VALUE, not just a state flag.**
///
/// The state-dependent trap is about a number whose MEANING changes; a test that
/// only checks `duration_is_live()` restates the fixture's `state` string and
/// proves nothing about any duration. At v0.158.0 the receiver ships no
/// `duration_ms` attribute at all (measured: absent from all 6028 records), so
/// the duration the UI can actually show is derived from the exec time — and it
/// must be present alongside the state that qualifies it.
#[test]
fn a_live_session_carries_a_duration_value_beside_its_state() {
    let active = server_vantage::canonicalize_query_sample(&pg_query_sample_blocked())
        .expect("active session");
    let rec = active.to_record();

    let duration = rec
        .get(server_vantage::O2_DBM_DURATION_MS)
        .and_then(|v| v.as_f64())
        .expect("an active session must store a duration the UI can render");
    assert!(
        duration > 0.0,
        "a running query has a positive elapsed time, got {duration}"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SESSION_STATE),
        Some(&json!("active")),
        "and the state that QUALIFIES that duration must sit beside it — a duration \
         without its state puts 'running 40s' next to 'last query took 40s'"
    );
    assert!(
        active.duration_is_live(),
        "for an active session that duration is still accruing"
    );

    // The idle case carries the SAME column with the opposite meaning, and the
    // pair (value, state) is what lets the UI tell them apart.
    let idle = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("idle session");
    assert!(!idle.duration_is_live());
    assert_eq!(
        idle.to_record().get(server_vantage::O2_DBM_SESSION_STATE),
        Some(&json!("idle"))
    );
}

/// **The write side and the reservation list must name the SAME columns — for
/// EVERY writer.**
///
/// `ALL_DBM_FIELDS` is the strip list, the read-side projection allowlist and the
/// schema gate. A column `to_record()` writes but the array does not name is
/// spoofable (never stripped from caller input) AND unreadable (never projected)
/// — and no membership test catches it, because membership tests only walk the
/// array. This walks the OTHER direction, over every canonicalizer's output.
/// Together with the no-duplicates + length pin in
/// `the_reserved_field_list_has_no_duplicates`, it subsumes the per-kind
/// explicit membership lists this file used to carry.
#[test]
fn every_column_any_writer_emits_is_reserved() {
    let mut records: Vec<(&str, BTreeMap<String, Value>)> = Vec::new();
    for fixture in [
        pg_query_sample_unblocked(),
        pg_query_sample_blocked(),
        pg_query_sample_multi_blocked(),
        pg_query_sample_on_cpu(),
        mysql_query_sample(),
    ] {
        records.push((
            "activity",
            server_vantage::canonicalize_query_sample(&fixture)
                .expect("activity fixture must canonicalize")
                .to_record(),
        ));
    }
    for fixture in [pg_top_query(), mysql_top_query()] {
        records.push((
            "top_query",
            server_vantage::canonicalize_top_query(&fixture)
                .expect("top_query fixture must canonicalize")
                .to_record(),
        ));
    }
    // The deadlock, blocking, table-stats and index-stats writers moved to
    // `o2_enterprise`; their half of this walk moved with them
    // (`all_enterprise_columns_are_reserved`). `ALL_DBM_FIELDS` lives in
    // `config` and stays ONE array covering both — the reservation is shared,
    // only the writers split.
    records.push((
        "explain",
        server_vantage::canonicalize_pg_auto_explain(&pg_auto_explain_flattened())
            .expect("explain fixture must canonicalize")
            .to_record(),
    ));
    records.push((
        "statement",
        server_vantage::canonicalize_pg_statement_duration(&pg_statement_duration_flattened())
            .expect("statement-duration fixture must canonicalize")
            .to_record(),
    ));

    // Iterating "whatever the writers emit" is satisfied by a walk that emits
    // NOTHING, so the population is pinned. 5 activity + 2 top_query + explain
    // + statement = 9. The deadlock, blocking, table-stats and index-stats
    // fixtures left for `o2_enterprise`. If this fails LOW, a fixture was
    // dropped — restore it rather than lowering the number.
    assert_eq!(
        records.len(),
        9,
        "OSS must walk exactly its own 9 writers' fixtures; the 10 enterprise \
         fixtures (deadlock, blocking, 4 table_stats, 4 index_stats) are \
         covered by `all_enterprise_columns_are_reserved` in the o2-enterprise \
         suite. A silently shrinking walk would still go green."
    );

    for (kind, rec) in &records {
        for key in rec.keys() {
            assert!(
                server_vantage::ALL_DBM_FIELDS.contains(&key.as_str()),
                "the {kind} writer emits `{key}` but ALL_DBM_FIELDS does not reserve it — \
                 that column is both spoofable and unreadable"
            );
        }
    }

    // Iterating whatever the writers emit is satisfied by writers that emit
    // nothing, so the columns W3.1 promises are named explicitly: each must be
    // WRITTEN by the Postgres top_query record (reservation follows from the
    // ⊆ walk above).
    let (_, top) = records
        .iter()
        .find(|(kind, _)| *kind == "top_query")
        .expect("a top_query record was just pushed");
    for col in [
        server_vantage::O2_DBM_PLAN,
        server_vantage::O2_DBM_PLAN_HASH,
        server_vantage::O2_DBM_PLAN_HASH_VERSION,
        server_vantage::O2_DBM_CALLS,
        server_vantage::O2_DBM_ROWS,
        server_vantage::O2_DBM_EXEC_TIME_S,
        server_vantage::O2_DBM_SHARED_BLKS_HIT,
        server_vantage::O2_DBM_SHARED_BLKS_READ,
        server_vantage::O2_DBM_SHARED_BLKS_DIRTIED,
        server_vantage::O2_DBM_SHARED_BLKS_WRITTEN,
        server_vantage::O2_DBM_TEMP_BLKS_READ,
        server_vantage::O2_DBM_TEMP_BLKS_WRITTEN,
        server_vantage::O2_DBM_SERVER_QUERY_ID,
        server_vantage::O2_DBM_FINGERPRINT,
        server_vantage::O2_DBM_METRICS_ARE_DELTA,
    ] {
        assert!(
            top.contains_key(col),
            "the Postgres top_query record must write `{col}`"
        );
    }
}

/// **The config knob must GATE something.**
///
/// D-G exists to stop an upgrade silently acquiring new ingest cost, and activity
/// is the highest-volume signal DBM has (~200 rows/sec per 200-session instance).
/// A flag that defaults false but is read by nobody delivers exactly the cost it
/// was added to prevent, while `test_db_monitoring_config_defaults` stays green.
///
/// A SOURCE-SCRAPING test, matching the precedent set by
/// `writing_the_event_name_is_gated_on_db_monitoring_enabled` above:
/// `get_config()` is a process-wide cached singleton, so a unit test cannot flip
/// the knob and observe the behavior change. What CAN be asserted is that the
/// dispatch arm consults it — and that the gate is scoped to the activity arm
/// rather than smothering the shipped deadlock/blocking paths.
#[test]
fn the_activity_dispatch_arm_consults_the_config_knob() {
    let src = include_str!("server_vantage.rs");
    let start = src
        .find("pub fn canonicalize_record(")
        .expect("canonicalize_record must exist — it is the ingest entry point");
    let body = src[start..]
        .split("\n}\n")
        .next()
        .expect("canonicalize_record must have a body");

    assert!(
        body.contains("activity_enabled"),
        "the query_sample dispatch arm must consult \
         `db_monitoring.activity_enabled`; a default-off knob that gates nothing \
         still ingests ~200 rows/sec/instance for a feature the operator turned off"
    );

    // The gate must be SCOPED to activity. An early return at the top of the
    // function would disable deadlock and blocking ingest too — a silent
    // regression of two shipped pages behind a knob about a third.
    let gate = body
        .find("activity_enabled")
        .expect("checked immediately above");
    // The deadlock and blocking canonicalizers moved to `o2_enterprise`, so the
    // anchor is now the HOOK that replaced them at the identical position. The
    // property is unchanged: the activity gate must sit BELOW the arms that
    // already shipped, or turning activity off silently disables them too.
    let deadlock = body
        .find("claim_deadlock_markers")
        .expect("the enterprise deadlock hook must still sit in the dispatcher");
    assert!(
        gate > deadlock,
        "the activity gate must come AFTER the deadlock/blocking arms, or turning \
         activity off silently disables the two pages that already shipped"
    );

    // And behaviourally, under the shipped default (activity OFF), the two
    // pre-existing kinds must still canonicalize. Enterprise-only: on OSS those
    // two kinds are not canonicalized at all, which the OSS-side
    // `enterprise_owned_records_do_not_canonicalize_on_oss` pins instead.
    #[cfg(feature = "enterprise")]
    {
        assert!(
            canonicalize_record(&pg_deadlock_record()).is_some(),
            "deadlock ingest must be unaffected by the activity knob"
        );
        assert!(
            canonicalize_record(&pg_blocking_record()).is_some(),
            "blocking ingest must be unaffected by the activity knob"
        );
    }
}

/// **The instance must resolve, or `?instance=` filters nothing.**
///
/// `detect_instance` was written for the sqlquery-recipe rows, which carry
/// `server_address`. The OTLP receiver path is a genuinely different shape: in
/// all 1124 captured batches the instance identity lives in the RESOURCE
/// attributes — `service.instance.id = "postgres:5432"` (Postgres) and
/// `mysql.instance.endpoint = "mysql:3306"` (MySQL) — which flatten to
/// `service_instance_id` / `mysql_instance_endpoint`. Neither is in
/// `detect_instance`'s alias list.
///
/// The trap this also pins: the sample's own `network_peer_address` is the
/// CLIENT's address (`172.21.0.6/32`), so reaching for a peer-ish field labels
/// every session with the client IP — wrong, and it would still satisfy any test
/// that merely asserted "instance is populated".
#[test]
fn activity_resolves_the_server_instance_not_the_client_address() {
    let mut pg = pg_query_sample_unblocked();
    pg.insert("service_instance_id".into(), json!("postgres:5432"));
    let s = server_vantage::canonicalize_query_sample(&pg).expect("pg sample");
    assert_eq!(
        s.instance.as_deref(),
        Some("postgres"),
        "the instance is the SERVER (port-stripped, matching detect_instance's \
         contract), never the client peer address 172.21.0.6/32"
    );

    // The MySQL fixture carries BOTH resource attributes, as the producer does,
    // so this pins the alias ORDERING and not merely "something populated".
    let s = server_vantage::canonicalize_query_sample(&mysql_query_sample()).expect("mysql sample");
    assert_eq!(
        s.instance.as_deref(),
        Some("mysql"),
        "the addressable endpoint must win over the opaque service.instance.id \
         UUID — resolving the UUID makes ?instance= match zero MySQL rows"
    );
    assert_ne!(
        s.instance.as_deref(),
        Some("c5b91d95-178f-5a7c-93fc-0e68d122bbdd"),
        "the server UUID is not an addressable instance identity"
    );

    // And it must survive storage, because `dbm_event_preds` filters on it.
    let mut pg = pg_query_sample_unblocked();
    pg.insert("service_instance_id".into(), json!("postgres:5432"));
    let rec = server_vantage::canonicalize_query_sample(&pg)
        .expect("pg sample")
        .to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_INSTANCE),
        Some(&json!("postgres")),
        "without this column the ?instance= filter matches zero activity rows"
    );
}

/// **`duration_is_live` must be engine-aware.**
///
/// The captured MySQL session states are `waiting` (152), `running` (92) and
/// `other` (1) — there is no `active`. A predicate written as
/// `state == "active"` therefore reports EVERY live MySQL session as "last query
/// took N ms", which is the exact inversion the state-dependent duration trap
/// exists to prevent, in the engine that has no `active` state at all.
#[test]
fn mysql_running_sessions_report_a_live_duration() {
    for state in ["running", "waiting"] {
        let mut rec = mysql_query_sample();
        rec.insert("mysql_session_status".into(), json!(state));
        let s = server_vantage::canonicalize_query_sample(&rec)
            .unwrap_or_else(|| panic!("mysql {state} sample"));
        assert_eq!(s.state.as_deref(), Some(state));
        assert!(
            s.duration_is_live(),
            "MySQL `{state}` is a LIVE session — MySQL has no `active` state, so a \
             predicate of state == \"active\" mislabels every running MySQL query"
        );
    }
}

/// **The duration must not silently alias the last-completed exec time.**
///
/// The receiver emits no `duration_ms` at v0.158.0 (0/6028 records), so the
/// duration we can show is derived. For a LIVE session that derivation from the
/// elapsed exec time is right. For an `idle`/`idle in transaction` session the
/// same number means the LAST COMPLETED query — so publishing it as the session's
/// duration renders "running 859ms" beside a session that has in fact been idle
/// in transaction for twenty minutes, which is the actual alerting condition.
#[test]
fn an_idle_session_does_not_publish_a_live_duration() {
    let idle = server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked())
        .expect("idle session");
    assert!(!idle.duration_is_live());
    let rec = idle.to_record();
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_DURATION_MS),
        "an idle session has no LIVE duration; the last-completed time is already \
         carried by {} and must not be republished as a running duration",
        server_vantage::O2_DBM_EXEC_TIME_MS
    );
    // The completed time is still available, under its own honest name.
    assert_eq!(
        rec.get(server_vantage::O2_DBM_EXEC_TIME_MS),
        Some(&json!(0.021)),
        "the last-completed exec time stays, under the column whose name says ms"
    );
}

/// **Transaction age must populate on UNBLOCKED sessions — that is where the
/// incident lives.**
///
/// `postgresql.blocking.transaction.start_time` is namespaced under
/// `blocking.*`, which makes it natural to read it inside an `if is_blocked()`
/// branch alongside the six genuinely blocked-only attributes. Measured, that
/// grouping is wrong: of 1072 records with a non-empty transaction start, only
/// 288 are blocked. **784 are unblocked** — 523 `active` and, decisively, all
/// **261 `idle in transaction`** sessions.
///
/// `idle in transaction` with no blocker is exactly the bloat/xmin-horizon
/// condition the DBA review called the single most important column, and it is
/// never blocked by definition. Reading the field only when blocked nulls
/// transaction age on 100% of them.
#[test]
fn xact_start_populates_on_an_unblocked_idle_in_transaction_session() {
    let mut rec = pg_query_sample_unblocked();
    rec.insert("postgresql_state".into(), json!("idle in transaction"));
    rec.insert(
        "postgresql_blocking_transaction_start_time".into(),
        json!("2026-08-11T02:20:11Z"),
    );
    // Unblocked: the decisive sentinel, and every other blocking field empty.
    rec.insert("postgresql_blocking_pids".into(), json!("{}"));
    rec.insert("postgresql_blocking_start_time".into(), json!(""));

    let s = server_vantage::canonicalize_query_sample(&rec).expect("sample");
    assert!(!s.is_blocked(), "precondition: this session has no blocker");
    assert_eq!(
        s.xact_start.as_deref(),
        Some("2026-08-11T02:20:11Z"),
        "transaction age must be read INDEPENDENTLY of blocked-ness — an \
         `idle in transaction` session holding back the xmin horizon is never \
         blocked, and it is the alerting condition this column exists for"
    );
    // The lock-wait clock is a different thing and stays empty here.
    assert_eq!(
        s.wait_start, None,
        "no lock wait is in progress, so there is no wait start"
    );
    assert_eq!(
        s.to_record().get(server_vantage::O2_DBM_XACT_START),
        Some(&json!("2026-08-11T02:20:11Z")),
        "and it must survive storage, or the UI cannot age the transaction"
    );
}

/// **MySQL carries no `total_exec_time`, so its duration must come from the
/// attributes it does send — or be honestly absent, never a 1000x error.**
///
/// Measured: MySQL `query_sample` has no `postgresql.total_exec_time` and no
/// `duration_ms`. Its only timings are
/// `mysql.events_statements_current.timer_wait` (0.05781 on the captured record)
/// and `mysql.events_waits_current.timer_wait`. Writing a seconds-scaled value
/// into a column whose name ends `_ms` is exactly the unit error E4 exists to
/// prevent, in the engine E4 did not measure.
#[test]
fn mysql_exec_time_is_not_silently_mis_scaled() {
    let s = server_vantage::canonicalize_query_sample(&mysql_query_sample()).expect("mysql");
    match s.exec_time_ms {
        None => {} // Honestly absent is acceptable: MySQL ships no exec time.
        Some(ms) => {
            // 0.05781 is the raw statement timer. Storing it unconverted into an
            // `_ms` column understates by 1000x; the honest ms value is 57.81.
            assert!(
                (ms - 57.81).abs() < 0.01,
                "a MySQL exec time in an `_ms` column must BE milliseconds: the \
                 receiver's timer_wait is 0.05781 seconds, so the only correct \
                 stored values are 57.81 (converted) or absent — got {ms}"
            );
        }
    }
}

/// **A zero wait is the sentinel, not a measurement.**
///
/// `postgresql.blocking.wait_duration` is `COALESCE`d to `0` and is therefore
/// present on all 5495 unblocked records — the numeric twin of the `{}` trap.
/// Storing it pollutes every aggregate over `o2_dbm_wait_seconds` with thousands
/// of sessions that waited for nothing, so a real 5-second lock wait averages
/// toward zero and the wait-time chart reads flat during an incident. The
/// `/blocking` endpoint's `min_wait_seconds` filter admits them all too.
#[test]
fn a_zero_wait_duration_is_a_sentinel_not_a_measurement() {
    let unblocked =
        server_vantage::canonicalize_query_sample(&pg_query_sample_unblocked()).expect("unblocked");
    assert_eq!(
        unblocked.wait_seconds, None,
        "wait_duration=0 on an unblocked session is the COALESCE sentinel"
    );
    assert!(
        !unblocked
            .to_record()
            .contains_key(server_vantage::O2_DBM_WAIT_SECONDS),
        "the column must be absent, or every aggregate over it is diluted"
    );

    // A real wait still lands.
    let blocked =
        server_vantage::canonicalize_query_sample(&pg_query_sample_blocked()).expect("blocked");
    assert_eq!(
        blocked.wait_seconds,
        Some(1.0),
        "a genuine lock wait must be stored"
    );
}

/// **One host must render one way across engines.**
///
/// Postgres ships the peer address as a CIDR (`172.21.0.6/32`, 5570 records)
/// because `pg_stat_activity.client_addr` is an `inet`; MySQL ships the bare
/// address (245 records). Left unnormalized the same host appears twice in one
/// table and cannot be grouped or matched — which defeats the column whose
/// stated job is telling an operator which host to go kill.
#[test]
fn client_addresses_are_normalized_across_engines() {
    let pg = server_vantage::canonicalize_query_sample(&pg_query_sample_multi_blocked())
        .expect("pg sample");
    let my = server_vantage::canonicalize_query_sample(&mysql_query_sample()).expect("mysql");
    assert_eq!(
        pg.client_addr.as_deref(),
        Some("172.21.0.6"),
        "the /32 CIDR suffix must be stripped so PG matches MySQL's spelling"
    );
    assert_eq!(my.client_addr.as_deref(), Some("172.21.0.6"));
    assert_eq!(
        pg.client_addr, my.client_addr,
        "the same host must be the same string whichever engine reported it"
    );
}

// ─── W3 · Top queries + plan visibility (`db.server.top_query`) ──────────────
//
// Fixtures below are the REAL captured records from
// `tests/dbm-server-vantage/captures/pg-top-query.jsonl` and
// `mysql-top-query.jsonl` (collector-contrib v0.158.0 against live Postgres 16 /
// MySQL 8.4), flattened the way logs ingest flattens them: attribute dots become
// underscores, `intValue` arrives as a JSON number, `doubleValue` as a float.
//
// Hand-authoring a top_query fixture would be the same mistake the deleted
// ENGINE_SUPPORT.md records: a fixture shaped like the PARSER agrees with
// whatever the parser does. The MySQL attribute names in particular are nothing
// like the short forms an implementer would invent — they are the full
// `mysql.events_statements_summary_by_digest.*` path.

/// `pg-top-query.jsonl` line 1, verbatim — the UPDATE with a populated plan.
///
/// `postgresql.total_exec_time` here is **SECONDS** (E4/#50113), despite being
/// spelled identically to `query_sample`'s genuine milliseconds.
fn pg_top_query() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_519_760_246i64,
        "db_system_name": "postgresql",
        "db_namespace": "dbmlab",
        "db_query_text": "UPDATE inventory SET qty = qty + ? updated_at = now ( ) WHERE id = ?",
        "postgresql_calls": 19687,
        "postgresql_rows": 19687,
        "postgresql_shared_blks_dirtied": 399,
        "postgresql_shared_blks_hit": 196880,
        "postgresql_shared_blks_read": 0,
        "postgresql_shared_blks_written": 0,
        "postgresql_temp_blks_read": 0,
        "postgresql_temp_blks_written": 0,
        "postgresql_queryid": "8802886719592092940",
        "postgresql_rolname": "dbm",
        "postgresql_total_exec_time": 118_335.099_645_809_72f64,
        "postgresql_total_plan_time": 0.0,
        "postgresql_query_plan": "[{\"Plan\":{\"Node Type\":\"ModifyTable\",\"Operation\":\"?\",\"Parallel Aware\":false,\"Async Capable\":false,\"Relation Name\":\"inventory\",\"Alias\":\"inventory\",\"Startup Cost\":0.27,\"Total Cost\":8.30,\"Plan Rows\":0,\"Plan Width\":0,\"Plans\":[{\"Node Type\":\"Index Scan\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":false,\"Async Capable\":false,\"Scan Direction\":\"Forward\",\"Index Name\":\"inventory_pkey\",\"Relation Name\":\"inventory\",\"Alias\":\"inventory\",\"Startup Cost\":0.27,\"Total Cost\":8.30,\"Plan Rows\":1,\"Plan Width\":18,\"Index Cond\":\"( id = ? )\"}]}}]",
        "service_instance_id": "postgres:5432",
        "o2_vantage": "server",
    }))
}

/// A captured Postgres `top_query` whose `postgresql.query_plan` is the EMPTY
/// STRING — measured 159/275 in the capture (E6), never absent.
///
/// From `raw/receiver-events.jsonl`: the queryid is NEGATIVE, which is normal
/// (PG's signed 64-bit hash), and the exec time is a small per-interval delta
/// rather than the first emission's cumulative backlog.
fn pg_top_query_empty_plan() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_519_760_246i64,
        "db_system_name": "postgresql",
        "db_namespace": "dbmlab",
        "db_query_text": "SELECT pid :: text AS pid, coalesce ( usename, ? ) AS usename FROM pg_stat_activity WHERE datname = ?",
        "postgresql_calls": 19702,
        "postgresql_rows": 321_529,
        "postgresql_shared_blks_dirtied": 0,
        "postgresql_shared_blks_hit": 662_754,
        "postgresql_shared_blks_read": 0,
        "postgresql_shared_blks_written": 0,
        "postgresql_temp_blks_read": 0,
        "postgresql_temp_blks_written": 0,
        "postgresql_queryid": "-6900941797155884785",
        "postgresql_rolname": "dbm",
        "postgresql_total_exec_time": 6.520_328_165_999_992f64,
        "postgresql_total_plan_time": 0.0,
        "postgresql_query_plan": "",
        "service_instance_id": "postgres:5432",
        "o2_vantage": "server",
    }))
}

/// `mysql-top-query.jsonl` line 1, verbatim — all EIGHT attributes MySQL emits.
///
/// Note what is ABSENT and cannot be invented: no `db.namespace` (a MySQL top
/// query cannot be attributed to a database), no rows, no block counters, no
/// user. And note the attribute SPELLING: the full
/// `mysql.events_statements_summary_by_digest.*` path, not a short form.
fn mysql_top_query() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_415_539_744_012i64,
        "db_system_name": "mysql",
        "db_query_text": "SELECT customer_ref, SUM ( amount ) t FROM orders GROUP BY customer_ref ORDER BY t DESC LIMIT ?",
        "mysql_query_plan": "{\"query_block\":{\"select_id\":1,\"cost_info\":{\"query_cost\":\"33432.95\"},\"ordering_operation\":{\"using_filesort\":true,\"grouping_operation\":{\"using_temporary_table\":true,\"using_filesort\":false,\"table\":{\"table_name\":\"orders\",\"access_type\":\"ALL\",\"rows_examined_per_scan\":328637,\"rows_produced_per_join\":328637,\"filtered\":\"100.00\",\"cost_info\":{\"read_cost\":\"569.25\",\"eval_cost\":\"32863.70\",\"prefix_cost\":\"33432.95\",\"data_read_per_join\":\"92M\"},\"used_columns\":[\"id\",\"customer_ref\",\"amount\"]}}}}}",
        "mysql_query_plan_hash": "5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3",
        "mysql_events_statements_summary_by_digest_digest": "5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3",
        "mysql_events_statements_summary_by_digest_count_star": 0,
        "mysql_events_statements_summary_by_digest_sum_timer_wait": 1.909_831_54f64,
        "mysql_instance_endpoint": "mysql:3306",
        "service_instance_id": "c5b91d95-178f-5a7c-93fc-0e68d122bbdd",
        "o2_vantage": "server",
    }))
}

/// Force the top_query ingest knob on for the duration of a test.
///
/// The knob defaults OFF (D-G), so the dispatch arm is unreachable without it —
/// which is itself pinned by `top_query_dispatch_is_gated_off_by_default`.
fn with_top_query_enabled<T>(f: impl FnOnce() -> T) -> T {
    with_knob("ZO_DB_MONITORING_TOP_QUERY_ENABLED", f)
}

// ── W3.1 · Canonicalization ─────────────────────────────────────────────────

/// The Postgres happy path, over the real record.
#[test]
fn pg_top_query_canonicalizes() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query())
        .expect("a real captured Postgres top_query must canonicalize");

    assert_eq!(s.engine.as_deref(), Some("postgresql"));
    assert_eq!(s.database.as_deref(), Some("dbmlab"));
    assert_eq!(
        s.instance.as_deref(),
        Some("postgres"),
        "the instance is the port-stripped server address, as on every other kind"
    );
    assert_eq!(s.calls, Some(19687));
    assert_eq!(s.rows, Some(19687));
    assert_eq!(s.shared_blks_hit, Some(196_880));
    assert_eq!(s.shared_blks_read, Some(0));
    assert_eq!(s.shared_blks_dirtied, Some(399));
    assert_eq!(s.shared_blks_written, Some(0));
    assert_eq!(s.temp_blks_read, Some(0));
    assert_eq!(s.temp_blks_written, Some(0));
    assert!(s.plan.is_some(), "this record carries a populated plan");
}

/// **The two events disagree about the unit of the SAME attribute name (E4).**
///
/// `postgresql.total_exec_time` is SECONDS on `top_query` (upstream #50113:
/// `convertMillisecondToSecond` divides by 1000) and genuine MILLISECONDS on
/// `query_sample`. Measured at a uniform ~1000.3 ratio against
/// `pg_stat_statements` ground truth across six queries spanning four orders of
/// magnitude.
///
/// Both directions are pinned in ONE test on purpose: the failure this guards is
/// an implementer reading one event's handling and copying it to the other, and
/// two separate tests let that pass review.
#[test]
fn exec_time_units_differ_between_the_two_events() {
    let top = server_vantage::canonicalize_top_query(&pg_top_query()).expect("top_query");
    assert_eq!(
        top.exec_time_s,
        Some(118_335.099_645_809_72),
        "top_query ships SECONDS and must be stored in a column named `_s`"
    );

    let sample =
        server_vantage::canonicalize_query_sample(&pg_query_sample_blocked()).expect("sample");
    assert_eq!(
        sample.exec_time_ms,
        Some(859.2),
        "query_sample ships genuine MILLISECONDS — the same attribute name, the other unit"
    );

    // And the stored COLUMNS must carry their units, so the ambiguity cannot
    // propagate into a page that renders one as the other.
    let rec = top.to_record();
    assert!(
        rec.contains_key(server_vantage::O2_DBM_EXEC_TIME_S),
        "top_query's exec time must be stored under the SECONDS column"
    );
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_EXEC_TIME_MS),
        "storing top_query seconds in the `_ms` column is the 1000x bug this naming prevents"
    );
}

/// **The receiver version is stamped on the record (spec §6, risk row 2).**
///
/// The unit test above pins OUR PARSER, not the wire. When upstream fixes
/// #50113 and `total_exec_time` becomes milliseconds, that test stays green
/// while stored values silently become wrong by three orders of magnitude.
///
/// The stamp is what makes that recoverable: `0.158.0` means seconds, and a
/// later version means the value must be re-read. It is available for free —
/// logs ingest already flattens the OTLP scope version onto every record
/// (`logs/otlp.rs:185`), and it is the receiver's own version because the
/// emitting scope IS the receiver.
///
/// Deliberately a STAMP rather than the "drop values outside plausible bounds"
/// the risk row also floats: measured legitimate values span 2.9e-7 to 118,335
/// seconds — nine orders of magnitude, because the first emission carries a
/// cumulative backlog — so any bound tight enough to catch a 1000x flip also
/// discards real data, and silently dropping a number is the failure shape this
/// feature's empty states exist to avoid.
#[test]
fn the_receiver_version_is_stamped_on_every_top_query_record() {
    let mut rec = pg_top_query();
    rec.insert("instrumentation_library_version".into(), json!("0.158.0"));
    rec.insert(
        "instrumentation_library_name".into(),
        json!(
            "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/postgresqlreceiver"
        ),
    );
    let s = server_vantage::canonicalize_top_query(&rec).expect("top_query");
    assert_eq!(
        s.to_record()
            .get(server_vantage::O2_DBM_RECEIVER_VERSION)
            .and_then(Value::as_str),
        Some("0.158.0"),
        "the version that produced these units must travel with the value it produced"
    );

    // Absent on a record that carries no scope version, rather than defaulted to
    // a version we did not observe — a wrong version stamp is worse than none,
    // because it would be trusted.
    let bare = server_vantage::canonicalize_top_query(&pg_top_query()).expect("top_query");
    assert!(
        !bare
            .to_record()
            .contains_key(server_vantage::O2_DBM_RECEIVER_VERSION),
        "never invent a version we did not observe"
    );
}

/// **`postgresql.queryid` — no underscore (X4/E5) — and it can be NEGATIVE.**
///
/// `query_sample` spells the same identifier `postgresql.query_id`. Reading the
/// underscored form here yields no server id at all, silently breaking the join
/// between the two server-vantage events; "normalising" the two spellings to one
/// would misclassify every record in the shape sniff.
#[test]
fn top_query_reads_the_no_underscore_queryid_and_keeps_it_signed() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("top_query");
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("8802886719592092940"),
        "top_query spells it `postgresql.queryid`, without the underscore"
    );

    let neg = server_vantage::canonicalize_top_query(&pg_top_query_empty_plan()).expect("negative");
    assert_eq!(
        neg.server_query_id.as_deref(),
        Some("-6900941797155884785"),
        "PG's query id is a SIGNED 64-bit hash; storing it verbatim keeps the sign"
    );
}

/// **Two join keys, two purposes (D-C).**
///
/// The server-side id joins server-vantage events to each other; the fingerprint
/// joins them to CLIENT SPANS, and is the same gxhash the span path writes. They
/// are different identifier spaces and conflating them breaks one join or the
/// other. Never join on query text — upstream #47469: MySQL's `db.query.text`
/// differs between the two events in case and dot-spacing.
#[test]
fn top_query_populates_both_join_keys() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("top_query");
    let (_, expected) = fingerprint_statement(
        "UPDATE inventory SET qty = qty + ? updated_at = now ( ) WHERE id = ?",
        Some("postgresql"),
    );
    assert!(expected.is_some(), "the fixture text must fingerprint");
    assert_eq!(
        s.fingerprint, expected,
        "the client-span join key is our own fingerprint over the statement text"
    );
    assert_ne!(
        s.fingerprint.as_deref(),
        s.server_query_id.as_deref(),
        "the two join keys are different identifier spaces and must not be conflated"
    );
}

/// **E6: the plan is ALWAYS present as a key and is often the empty string.**
///
/// Measured 159/275 empty. An implementer testing for ABSENCE gets a plan column
/// containing `""`, which then hashes to a stable garbage value and reports a
/// plan where none exists.
#[test]
fn an_empty_plan_string_yields_no_plan_and_no_hash() {
    let s =
        server_vantage::canonicalize_top_query(&pg_top_query_empty_plan()).expect("empty-plan rec");
    assert_eq!(
        s.plan, None,
        "an empty plan string means `no plan this interval`, not a plan"
    );
    assert_eq!(s.plan_hash, None, "no plan means no hash to compute");

    let rec = s.to_record();
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_PLAN),
        "the plan column must be ABSENT, not an empty string"
    );
    assert!(!rec.contains_key(server_vantage::O2_DBM_PLAN_HASH));
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_PLAN_HASH_VERSION),
        "a hash version without a hash describes nothing"
    );

    // The rest of the record still lands — an unexplained statement is still a
    // top query, and dropping it would hide the most-called statements.
    assert_eq!(s.calls, Some(19702));
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("-6900941797155884785"),
        "a plan-less record is still a record"
    );
}

/// **The SAME statement alternates between planned and plan-less intervals.**
///
/// README §5: "the same queryid alternates between populated and empty across
/// intervals" — the budget (`max_explain_each_interval`) and the receiver's
/// EXTRACT bug both cause it. So `''` means "no plan THIS interval", never "no
/// plan exists".
///
/// Both records must survive independently. A canonicalizer that dropped the
/// plan-less one would delete the most-called statements from the top-query
/// list; one that let it overwrite the planned one would erase the only plan we
/// have.
#[test]
fn a_plan_less_interval_does_not_erase_a_planned_one() {
    let planned = server_vantage::canonicalize_top_query(&pg_top_query()).expect("planned");

    // The same statement and the same server id, a later interval with no plan.
    let mut later = pg_top_query();
    later.insert("postgresql_query_plan".into(), json!(""));
    later.insert("postgresql_calls".into(), json!(2));
    let bare = server_vantage::canonicalize_top_query(&later).expect("plan-less interval");

    assert_eq!(
        bare.server_query_id, planned.server_query_id,
        "the two intervals describe the SAME statement"
    );
    assert!(
        planned.plan.is_some(),
        "the planned interval keeps its plan"
    );
    assert_eq!(
        bare.plan, None,
        "the plan-less interval reports no plan, rather than an empty-string plan"
    );
    assert!(
        bare.plan_hash.is_none() && planned.plan_hash.is_some(),
        "and no hash is invented for the interval that had no plan to hash"
    );
}

/// **MariaDB ships the MySQL shape with NO plan and NO hash — measured 204/204.**
///
/// The spec says MariaDB and MySQL 5.x get no plan whatsoever. The record is
/// otherwise a normal MySQL top_query, so it must still canonicalize: the
/// statement, its digest and its call count are the whole value of the page for
/// those engines, and dropping the record because it has no plan would empty
/// Top Queries for every MariaDB user.
#[test]
fn a_mariadb_top_query_canonicalizes_without_a_plan() {
    let mut rec = mysql_top_query();
    rec.insert("mysql_query_plan".into(), json!(""));
    rec.insert("mysql_query_plan_hash".into(), json!(""));

    let s = server_vantage::canonicalize_top_query(&rec)
        .expect("a plan-less MariaDB record is still a top query");
    assert_eq!(s.plan, None);
    assert_eq!(s.plan_hash, None);
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3"),
        "the digest is what makes the record useful without a plan"
    );
    assert!(s.query.is_some(), "and the statement text still lands");
}

/// **X5: a plan is a TREE, and a nested value rejects the ENTIRE ingest batch.**
///
/// The logs schema inferrer hard-errors with "Cannot infer schema from non-basic
/// type value", and that error kills every record in the batch — not just this
/// one. This already bit the deadlock path once, which is why
/// `O2_DBM_PARTICIPANTS` is a string. The plan must follow that precedent.
#[test]
fn every_stored_top_query_value_is_a_scalar() {
    for (name, rec) in [
        ("with a plan", pg_top_query()),
        ("empty plan", pg_top_query_empty_plan()),
        ("mysql", mysql_top_query()),
    ] {
        let s = server_vantage::canonicalize_top_query(&rec)
            .unwrap_or_else(|| panic!("{name} must canonicalize"));
        for (k, v) in s.to_record() {
            assert!(
                !v.is_object() && !v.is_array(),
                "{name}: `{k}` is a nested value — that rejects the WHOLE ingest batch, not \
                 just this record (X5)"
            );
        }
    }

    // And specifically: the plan is stored as a STRING that parses back to the
    // original document, not as a parsed object.
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("plan rec");
    let stored = s.to_record();
    let plan = stored
        .get(server_vantage::O2_DBM_PLAN)
        .expect("a populated plan must be stored");
    let text = plan.as_str().expect("the plan is stored as a JSON STRING");
    serde_json::from_str::<Value>(text).expect("the stored string must still be valid plan JSON");

    // Swept again over the map the SCHEMA INFERRER actually sees. X5's failure
    // is in the record that reaches ingest, which is `apply_to_record`'s mutated
    // map — not this canonicalizer's return value. A merge step that unpacked
    // the plan would be invisible to the sweep above and would still kill every
    // batch.
    with_top_query_enabled(|| {
        for (name, mut rec) in [
            ("with a plan", pg_top_query()),
            ("empty plan", pg_top_query_empty_plan()),
            ("mysql", mysql_top_query_with_event_name()),
        ] {
            server_vantage::apply_to_record(&mut rec);
            for (k, v) in &rec {
                assert!(
                    !v.is_object() && !v.is_array(),
                    "{name}: `{k}` reaches the schema inferrer as a nested value — that rejects \
                     the WHOLE ingest batch (X5)"
                );
            }
        }
    });
}

/// The tolerant reader, mirroring `participants_of` (D-B).
///
/// A malformed plan must return `None` rather than propagating an error: a bad
/// plan must never fail a read that would otherwise succeed.
#[test]
fn plan_of_reads_the_stored_string_and_tolerates_garbage() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("plan rec");
    let row = Value::Object(s.to_record().into_iter().collect::<Map<_, _>>());
    let plan = server_vantage::plan_of(&row).expect("a stored plan must read back");
    assert_eq!(
        plan[0]["Plan"]["Node Type"], "ModifyTable",
        "the reader must yield the parsed document"
    );

    for bad in [
        json!({ server_vantage::O2_DBM_PLAN: "{not json" }),
        json!({ server_vantage::O2_DBM_PLAN: "" }),
        json!({ server_vantage::O2_DBM_PLAN: 7 }),
        json!({}),
    ] {
        assert_eq!(
            server_vantage::plan_of(&bad),
            None,
            "a malformed plan reads as absent, never as an error that fails the whole read"
        );
    }
}

/// **The MySQL record is materially thinner, and the UI must not pretend
/// otherwise.**
///
/// Eight attributes against Postgres's seventeen. Critically there is NO
/// `db.namespace`, so a MySQL top query cannot be attributed to a database —
/// inventing one (say, from the instance) would attribute rows to a database
/// that was never named.
#[test]
fn mysql_top_query_canonicalizes_and_leaves_the_missing_columns_null() {
    let s = server_vantage::canonicalize_top_query(&mysql_top_query())
        .expect("a real captured MySQL top_query must canonicalize");

    assert_eq!(s.engine.as_deref(), Some("mysql"));
    assert_eq!(
        s.server_query_id.as_deref(),
        Some("5d0b04ed237e02873f379a1413326eb4cbd0c7fff58f66474be2dcca86a7f6c3"),
        "MySQL's join key is the statement digest, under the FULL \
         events_statements_summary_by_digest path"
    );
    assert_eq!(
        s.calls,
        Some(0),
        "count_star is 0 on the first emission — a real measured value, not absence"
    );
    assert!(s.plan.is_some(), "MySQL 8.4 does ship a plan");

    // D-C's SECOND join key, which matters more on MySQL than on Postgres:
    // upstream #47469 is specifically a MySQL bug where `db.query.text` differs
    // between the two events in case and dot-spacing. The fingerprint is the
    // only link from a MySQL top query to a client span, and if it is null that
    // link is silently absent for the whole engine.
    let (_, expected) = fingerprint_statement(
        "SELECT customer_ref, SUM ( amount ) t FROM orders GROUP BY customer_ref ORDER BY t DESC LIMIT ?",
        Some("mysql"),
    );
    assert!(expected.is_some(), "the fixture text must fingerprint");
    assert_eq!(
        s.fingerprint, expected,
        "MySQL must populate the client-span join key too"
    );
    assert_ne!(
        s.fingerprint.as_deref(),
        s.server_query_id.as_deref(),
        "the digest and the fingerprint are different identifier spaces"
    );

    assert_eq!(
        s.database, None,
        "MySQL top_query carries no db.namespace at all; inventing one attributes rows to a \
         database the record never named"
    );
    assert_eq!(s.rows, None, "no row counter on MySQL");
    assert_eq!(s.shared_blks_hit, None, "no block counters on MySQL");
    assert_eq!(s.temp_blks_read, None);

    let rec = s.to_record();
    for absent in [
        server_vantage::O2_DBM_DATABASE,
        server_vantage::O2_DBM_ROWS,
        server_vantage::O2_DBM_SHARED_BLKS_HIT,
    ] {
        assert!(
            !rec.contains_key(absent),
            "`{absent}` must be absent on MySQL, not defaulted to zero — a zero reads as \
             `measured and none`, which is a different claim"
        );
    }
}

/// **E8: `mysql.query_plan.hash` is NOT a plan hash — it is the statement
/// digest.**
///
/// Verified on the capture: the two attributes are byte-identical. Using it for
/// drift detection means the hash changes exactly when the STATEMENT changes,
/// which is never, since the statement is the grouping key. Every plan change
/// would be invisible while the feature reported it was watching.
#[test]
fn the_mysql_plan_hash_attribute_is_never_used_as_a_plan_hash() {
    let rec = mysql_top_query();
    let receiver_hash = rec["mysql_query_plan_hash"].as_str().unwrap();
    let digest = rec["mysql_events_statements_summary_by_digest_digest"]
        .as_str()
        .unwrap();
    assert_eq!(
        receiver_hash, digest,
        "the capture shows these are the same value — that is the whole finding"
    );

    let s = server_vantage::canonicalize_top_query(&rec).expect("mysql");
    let ours = s.plan_hash.clone().expect("MySQL must get a plan hash");
    assert_ne!(
        ours.as_str(),
        receiver_hash,
        "the receiver's `query_plan.hash` must never be adopted as our plan hash"
    );
    assert_eq!(
        ours.len(),
        16,
        "our hash is our own 16-hex rendering, not the receiver's 64-char digest"
    );

    // The decisive property, and the one an equality against `plan_hash(..)`
    // cannot express: OUR hash tracks the PLAN, while the receiver's tracks the
    // STATEMENT. Same statement, different plan — the receiver's attribute is
    // unmoved by construction, and ours must move. This is the whole reason E8
    // disqualifies it for drift detection.
    let mut replanned = mysql_top_query();
    replanned.insert(
        "mysql_query_plan".into(),
        json!(
            rec["mysql_query_plan"]
                .as_str()
                .unwrap()
                .replace(r#""access_type":"ALL""#, r#""access_type":"ref""#)
        ),
    );
    let after = server_vantage::canonicalize_top_query(&replanned).expect("mysql replanned");
    assert_eq!(
        replanned["mysql_query_plan_hash"], rec["mysql_query_plan_hash"],
        "the receiver's attribute is unchanged — it follows the statement, not the plan"
    );
    assert_ne!(
        after.plan_hash, s.plan_hash,
        "ours must move when the PLAN moves; adopting the receiver's would make every plan \
         change invisible while the feature reported it was watching"
    );
}

/// **top_query is a DELTA feed, not a cumulative one.**
///
/// Measured: the first emission per statement carries the whole
/// `pg_stat_statements` backlog (19687 calls / 118335s), and every subsequent
/// one is a per-interval delta (2 calls / 12s). Summing them as cumulative
/// double-counts the backlog; treating the first as a delta renders a false
/// spike at every collector restart.
///
/// We cannot tell the two apart from a single record — the receiver ships no
/// flag and no reset counter — so the honest handling is to record what the
/// interval actually reported and to NOT store a derived cumulative total that
/// would be wrong either way.
#[test]
fn delta_semantics_are_recorded_not_accumulated() {
    let first = server_vantage::canonicalize_top_query(&pg_top_query()).expect("first emission");
    assert_eq!(
        first.calls,
        Some(19687),
        "the value is stored verbatim as the interval reported it"
    );

    // The same statement, a later interval: a small delta rather than a
    // cumulative total that grew.
    let mut later = pg_top_query();
    later.insert("postgresql_calls".into(), json!(2));
    later.insert("postgresql_total_exec_time".into(), json!(12.005_250_671));
    let second = server_vantage::canonicalize_top_query(&later).expect("delta emission");
    assert_eq!(
        second.calls,
        Some(2),
        "a later interval reports its OWN delta, not a grown cumulative total — a \
         canonicalizer assuming monotonic counters reads this as a counter reset"
    );

    // The interval-ness must be discoverable by a reader, so nothing downstream
    // can sum these as if they were cumulative gauges.
    //
    // Asserted on BOTH emissions: we cannot distinguish the first (which carries
    // the whole pg_stat_statements backlog) from a subsequent delta — the
    // receiver ships no flag and no reset counter — so the marker must be
    // unconditional. A marker present only on some records is worse than none,
    // because a reader would take its absence as a claim of cumulativeness.
    for (which, s) in [("first emission", &first), ("delta emission", &second)] {
        assert_eq!(
            s.to_record()
                .get(server_vantage::O2_DBM_METRICS_ARE_DELTA)
                .and_then(Value::as_bool),
            Some(true),
            "{which}: the record must declare its counters are per-interval deltas — summing \
             a delta feed as cumulative double-counts the backlog"
        );
    }
}

/// **Both OTLP ingest paths must yield the same canonical record.**
///
/// The two paths disagree about the JSON type of every number, and the
/// disagreement is in the product, not in the fixture:
///
/// * gRPC/protobuf — `get_val_with_type_retained` (`ingestion/grpc.rs:130-135`) emits
///   `IntValue`/`DoubleValue` as JSON **numbers**.
/// * HTTP/JSON — `get_val_for_attr` (`ingestion/mod.rs:386-389`) emits both as `.to_string()`, i.e.
///   JSON **strings**.
///
/// So a collector pointed at the HTTP endpoint delivers `"19687"` where the gRPC
/// one delivers `19687`. A canonicalizer reading `as_i64()` directly parses the
/// first and silently drops the second — every counter null, on one transport
/// only, with nothing logged.
#[test]
fn numeric_attributes_parse_from_both_the_grpc_and_json_wire_shapes() {
    let numeric = server_vantage::canonicalize_top_query(&pg_top_query()).expect("grpc shape");

    // The HTTP/JSON shape: every number stringified, exactly as
    // `get_val_for_attr` renders it.
    let mut stringly = pg_top_query();
    for key in [
        "postgresql_calls",
        "postgresql_rows",
        "postgresql_shared_blks_hit",
        "postgresql_shared_blks_read",
        "postgresql_shared_blks_dirtied",
        "postgresql_shared_blks_written",
        "postgresql_temp_blks_read",
        "postgresql_temp_blks_written",
        "postgresql_total_exec_time",
    ] {
        let as_text = match stringly.get(key).expect("fixture key") {
            Value::Number(n) => n.to_string(),
            other => other.as_str().unwrap_or_default().to_string(),
        };
        stringly.insert(key.into(), json!(as_text));
    }
    let parsed = server_vantage::canonicalize_top_query(&stringly).expect("json shape");

    assert_eq!(
        parsed.calls, numeric.calls,
        "a stringified counter must parse — the HTTP ingest path sends every int as a string"
    );
    assert_eq!(parsed.rows, numeric.rows);
    assert_eq!(parsed.shared_blks_hit, numeric.shared_blks_hit);
    assert_eq!(parsed.temp_blks_written, numeric.temp_blks_written);
    assert_eq!(
        parsed.exec_time_s, numeric.exec_time_s,
        "doubles are stringified too, and a dropped exec time empties the latency column"
    );
    assert_eq!(
        parsed.calls,
        Some(19687),
        "and the parsed value is the real one, not a zero default"
    );
}

/// The record must carry its event time.
///
/// A top_query whose timestamp is missing or invented lands outside the window
/// the user selected, which renders as "no plans" on a stream that is ingesting
/// normally — a failure with no error attached to it.
///
/// This pins the VALUE, not the mechanism: it cannot distinguish `detect_timestamp`
/// from a direct `_timestamp` read, and both are correct here. The mechanism is
/// pinned instead by the shared-detector reuse the other kinds already assert.
#[test]
fn top_query_carries_the_record_timestamp() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("top_query");
    assert_eq!(
        s.timestamp,
        Some(1_786_415_519_760_246),
        "the event time is the record's own `_timestamp`, in microseconds"
    );
    assert_eq!(
        s.to_record()
            .get(server_vantage::O2_DBM_TIMESTAMP)
            .and_then(Value::as_i64),
        Some(1_786_415_519_760_246),
    );
}

/// No statement identity ⇒ no record.
///
/// A top query with neither a server-side id nor a statement text is not
/// attributable to anything; inventing a row for it puts an unnamed statement on
/// a page whose entire purpose is naming statements.
#[test]
fn top_query_without_an_identity_is_dropped() {
    let mut rec = pg_top_query();
    rec.remove("postgresql_queryid");
    rec.remove("db_query_text");
    assert_eq!(
        server_vantage::canonicalize_top_query(&rec),
        None,
        "no server id and no statement text is not a top query"
    );

    // Either one alone is enough — a plan-bearing record with only text is still
    // the most useful thing this feature ships.
    let mut text_only = pg_top_query();
    text_only.remove("postgresql_queryid");
    assert!(
        server_vantage::canonicalize_top_query(&text_only).is_some(),
        "statement text alone still identifies a statement"
    );
}

// ── W3.2 · Plan hashing ─────────────────────────────────────────────────────

/// **Costs and row estimates drift every collection without the plan changing.**
///
/// This is the single property that makes the hash usable: Postgres re-estimates
/// on every ANALYZE, so a hash including `Total Cost` would report a plan change
/// on essentially every interval and the signal would be pure noise.
#[test]
fn plan_hash_ignores_costs_and_row_estimates() {
    let cheap = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"orders","Startup Cost":0.00,"Total Cost":13254.77,"Plan Rows":221078,"Plan Width":99}}]"#;
    let dear = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"orders","Startup Cost":9.99,"Total Cost":999999.00,"Plan Rows":7,"Plan Width":4}}]"#;
    assert_eq!(
        server_vantage::plan_hash(cheap),
        server_vantage::plan_hash(dear),
        "identical structure with different costs is the SAME plan"
    );
    assert!(server_vantage::plan_hash(cheap).is_some());

    // Pair the "ignores" assertion with a responsiveness one: a hash that
    // ignores everything satisfies the equality above while detecting nothing.
    let rescanned = cheap.replace(r#""Node Type":"Seq Scan""#, r#""Node Type":"Index Scan""#);
    assert_ne!(
        server_vantage::plan_hash(&rescanned),
        server_vantage::plan_hash(cheap),
        "the hash must still respond to structure, or ignoring costs is meaningless"
    );
}

/// Runtime-only fields must not move the hash either.
///
/// `Workers Launched` is what the executor actually got, which varies with
/// server load; `actual_*` fields appear under EXPLAIN ANALYZE. Neither is a
/// property of the plan.
#[test]
fn plan_hash_ignores_runtime_fields() {
    let planned = r#"[{"Plan":{"Node Type":"Gather","Workers Planned":2,"Workers Launched":2,"Actual Rows":900,"Actual Total Time":12.5}}]"#;
    let starved = r#"[{"Plan":{"Node Type":"Gather","Workers Planned":2,"Workers Launched":0,"Actual Rows":3,"Actual Total Time":0.1}}]"#;
    assert_eq!(
        server_vantage::plan_hash(planned),
        server_vantage::plan_hash(starved),
        "`Workers Launched` and `actual_*` are runtime outcomes, not plan structure"
    );

    // An "ignores X" assertion is satisfied by a hash that ignores EVERYTHING,
    // so it only means something paired with proof the hash still responds. The
    // planned worker count IS structure and must move it.
    let replanned = planned.replace(r#""Workers Planned":2"#, r#""Workers Planned":8"#);
    assert_ne!(
        server_vantage::plan_hash(&replanned),
        server_vantage::plan_hash(planned),
        "`Workers Planned` is a plan-time decision and must still move the hash"
    );
}

/// **An index flip on the same scan node is THE canonical plan regression.**
///
/// Same node type, same relation, different index — if `Index Name` is excluded
/// from the hash this reads as no change at all, and the one structural
/// regression this feature can honestly detect becomes invisible.
#[test]
fn plan_hash_changes_when_the_index_changes() {
    let pkey = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"inventory","Index Name":"inventory_pkey","Scan Direction":"Forward"}}]"#;
    let other = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"inventory","Index Name":"inventory_sku_idx","Scan Direction":"Forward"}}]"#;
    assert_ne!(
        server_vantage::plan_hash(pkey),
        server_vantage::plan_hash(other),
        "an index flip on the same scan node must hash differently — it is the canonical \
         regression this feature exists to catch"
    );
}

/// Every structural field the spec names must move the hash.
///
/// Table-driven because the failure mode is an implementer hashing only
/// `Node Type` and passing the join-order test by accident.
#[test]
fn every_structural_field_moves_the_hash() {
    let base = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"orders","Index Name":"orders_pkey","Join Type":"Inner","Scan Direction":"Forward","Parallel Aware":false,"Workers Planned":2,"Strategy":"Sorted","Partial Mode":"Finalize"}}]"#;
    let baseline = server_vantage::plan_hash(base).expect("the baseline plan must hash");

    for (field, changed) in [
        (
            "Node Type",
            base.replace(r#""Node Type":"Index Scan""#, r#""Node Type":"Seq Scan""#),
        ),
        (
            "Relation Name",
            base.replace(
                r#""Relation Name":"orders""#,
                r#""Relation Name":"archive""#,
            ),
        ),
        (
            "Index Name",
            base.replace(
                r#""Index Name":"orders_pkey""#,
                r#""Index Name":"orders_ts_idx""#,
            ),
        ),
        (
            "Join Type",
            base.replace(r#""Join Type":"Inner""#, r#""Join Type":"Left""#),
        ),
        (
            "Scan Direction",
            base.replace(
                r#""Scan Direction":"Forward""#,
                r#""Scan Direction":"Backward""#,
            ),
        ),
        (
            "Parallel Aware",
            base.replace(r#""Parallel Aware":false"#, r#""Parallel Aware":true"#),
        ),
        (
            "Workers Planned",
            base.replace(r#""Workers Planned":2"#, r#""Workers Planned":4"#),
        ),
        // Both survive the receiver's obfuscation (spec W3.2 [R2]) and both
        // appear in the real captured plan. `Strategy` flipping Sorted→Hashed is
        // a genuine aggregate-method change; `Partial Mode` distinguishes a
        // parallel partial aggregate from its finalizing parent.
        (
            "Strategy",
            base.replace(r#""Strategy":"Sorted""#, r#""Strategy":"Hashed""#),
        ),
        (
            "Partial Mode",
            base.replace(
                r#""Partial Mode":"Finalize""#,
                r#""Partial Mode":"Partial""#,
            ),
        ),
    ] {
        assert_ne!(
            server_vantage::plan_hash(&changed),
            Some(baseline.clone()),
            "changing `{field}` must change the plan hash"
        );
    }
}

/// A different join ORDER is a different plan, even with identical node types.
///
/// This is the case a hash over a sorted SET of node types passes by accident,
/// so it is asserted over two real-shaped nested trees rather than a flat list.
#[test]
fn plan_hash_changes_when_the_join_order_changes() {
    let a = r#"[{"Plan":{"Node Type":"Hash Join","Join Type":"Inner","Plans":[{"Node Type":"Seq Scan","Relation Name":"orders"},{"Node Type":"Hash","Plans":[{"Node Type":"Seq Scan","Relation Name":"order_lines"}]}]}}]"#;
    let b = r#"[{"Plan":{"Node Type":"Hash Join","Join Type":"Inner","Plans":[{"Node Type":"Seq Scan","Relation Name":"order_lines"},{"Node Type":"Hash","Plans":[{"Node Type":"Seq Scan","Relation Name":"orders"}]}]}}]"#;
    assert_ne!(
        server_vantage::plan_hash(a),
        server_vantage::plan_hash(b),
        "swapping which relation is scanned on which side of the join is a DIFFERENT plan"
    );

    // Paired with an invariance assertion, because `assert_ne!` alone is passed
    // by a hash over the RAW STRING, which distinguishes these two while
    // detecting no structure at all. Reformatting the same tree must not move
    // the hash.
    let a_spaced = a.replace(",\"", ", \"").replace("{\"", "{ \"");
    assert_eq!(
        server_vantage::plan_hash(&a_spaced),
        server_vantage::plan_hash(a),
        "whitespace is not structure; a hash over the raw text is not a plan hash"
    );
}

/// Depth is structure: the same nodes nested differently must not collide.
#[test]
fn plan_hash_is_sensitive_to_tree_shape() {
    let nested = r#"[{"Plan":{"Node Type":"Limit","Plans":[{"Node Type":"Sort","Plans":[{"Node Type":"Seq Scan","Relation Name":"orders"}]}]}}]"#;
    let flat = r#"[{"Plan":{"Node Type":"Limit","Plans":[{"Node Type":"Sort"},{"Node Type":"Seq Scan","Relation Name":"orders"}]}}]"#;
    assert_ne!(
        server_vantage::plan_hash(nested),
        server_vantage::plan_hash(flat),
        "a child and a sibling are different plans; a hash that flattens the tree conflates them"
    );

    // Same pairing as above: prove the difference comes from SHAPE and not from
    // the bytes, by re-costing the nested tree and requiring the hash to hold.
    let recosted = nested.replace(
        r#""Node Type":"Sort""#,
        r#""Node Type":"Sort","Total Cost":98765.43"#,
    );
    assert_eq!(
        server_vantage::plan_hash(&recosted),
        server_vantage::plan_hash(nested),
        "adding a cost to a node must not change its shape"
    );
}

/// The hash is a pure function of structure — stable across calls and processes.
///
/// Instability would make every read report a plan change, which under D-H is
/// the one thing the feature claims to detect.
#[test]
fn plan_hash_is_stable_and_16_hex_chars() {
    let plan = pg_top_query()["postgresql_query_plan"]
        .as_str()
        .unwrap()
        .to_string();
    let a = server_vantage::plan_hash(&plan).expect("the real captured plan must hash");
    let b = server_vantage::plan_hash(&plan).expect("hash");
    assert_eq!(a, b, "the hash must be deterministic");
    assert_eq!(
        a.len(),
        16,
        "16 lowercase hex chars, matching `fingerprint_hex` (normalizer.rs:126-131)"
    );
    assert!(
        a.chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()),
        "rendering must match the fingerprint convention exactly: got {a}"
    );
}

/// **Malformed JSON returns `None`, never a panic.**
///
/// This runs on the ingest hot path; a panic there takes down a batch. The empty
/// string is called out separately because E6 makes it the COMMON case, not an
/// edge case.
#[test]
fn plan_hash_returns_none_on_anything_unparseable() {
    for bad in [
        "",
        "   ",
        "not json at all",
        "[{\"Plan\":",
        "null",
        "[]",
        "{}",
        "[{\"NotAPlan\":1}]",
        "\"a bare string\"",
        "42",
    ] {
        assert_eq!(
            server_vantage::plan_hash(bad),
            None,
            "unparseable or plan-less input must yield None, never a panic: {bad:?}"
        );
    }
}

/// MySQL's plan is a completely different document shape — `query_block` /
/// `table_name` / `access_type`, with no `Plan` key and no `Node Type` anywhere.
///
/// A hasher written against Postgres's shape returns `None` here, which would
/// silently mean "MySQL never gets drift detection" while the code looks correct.
#[test]
fn plan_hash_handles_the_mysql_document_shape() {
    let plan = mysql_top_query()["mysql_query_plan"]
        .as_str()
        .unwrap()
        .to_string();
    let hashed = server_vantage::plan_hash(&plan)
        .expect("MySQL's query_block document must hash, not fall through the PG-shaped parser");
    assert_eq!(hashed.len(), 16);

    // Cost drift must be ignored on this shape too — MySQL puts costs in
    // `cost_info` as STRINGS, which a numeric-only cost filter walks straight past.
    let cheaper = plan.replace("33432.95", "11.11").replace("569.25", "1.10");
    assert_eq!(
        server_vantage::plan_hash(&cheaper),
        Some(hashed.clone()),
        "MySQL cost_info values are strings; they are still costs and must not move the hash"
    );

    // But the access path is structure.
    let indexed = plan.replace(r#""access_type":"ALL""#, r#""access_type":"ref""#);
    assert_ne!(
        server_vantage::plan_hash(&indexed),
        Some(hashed),
        "a full table scan becoming an index lookup is exactly the drift we claim to detect"
    );
}

/// **The hash version is stored as a COLUMN, not only kept in code.**
///
/// Mirrors `FP_VERSION` → `o2_db_fp_version`. Without a stored column a scheme
/// change silently compares incomparable hashes — the exact failure versioning
/// exists to prevent.
#[test]
fn the_plan_hash_version_is_stored_beside_the_hash() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("plan rec");
    let rec = s.to_record();
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_HASH_VERSION)
            .and_then(Value::as_u64),
        Some(u64::from(server_vantage::PLAN_HASH_VERSION)),
        "the version that produced this hash must travel with it"
    );
    assert!(
        rec.contains_key(server_vantage::O2_DBM_PLAN_HASH),
        "a version column without a hash beside it describes nothing"
    );
}

// ── W3.1 · Dispatch, reservation, config ────────────────────────────────────

/// The dispatch arm, on the trusted OTLP event name.
#[test]
fn canonicalize_record_dispatches_top_query_on_the_event_name() {
    with_top_query_enabled(|| {
        let mut rec = pg_top_query();
        rec.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_TOP_QUERY),
        );
        let out = canonicalize_record(&rec).expect("a top_query event must reach its arm");
        assert_eq!(
            out.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
        );
        assert!(out.contains_key(server_vantage::O2_DBM_PLAN_HASH));
    });
}

/// MySQL has no `postgresql.*` attribute to sniff, so the OTLP event name is the
/// ONLY thing that can route it. Without this the entire MySQL top_query feed is
/// silently dropped.
#[test]
fn canonicalize_record_dispatches_mysql_top_query() {
    with_top_query_enabled(|| {
        let mut rec = mysql_top_query();
        rec.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_TOP_QUERY),
        );
        let out = canonicalize_record(&rec).expect("MySQL top_query must reach its arm");
        assert_eq!(
            out.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
        );
    });
}

/// The A2 shape-sniff fallback: `postgresql.calls` is top_query-exclusive, and
/// is the only route for a record arriving on the JSON ingest path, which never
/// has an OTLP envelope.
#[test]
fn top_query_reaches_its_arm_by_shape_sniff() {
    with_top_query_enabled(|| {
        let rec = pg_top_query();
        assert!(
            !rec.contains_key(server_vantage::O2_EVENT_NAME),
            "the fixture must have no event name, or this proves nothing"
        );
        let out = canonicalize_record(&rec).expect("the shape sniff must route a JSON-path record");
        assert_eq!(
            out.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
        );
    });
}

/// **D-G: the knob defaults OFF, so nothing is ingested on upgrade.**
///
/// Asserted through the DISPATCH rather than the config struct, because a knob
/// that exists and defaults false while the arm ignores it is the bug.
#[test]
fn top_query_dispatch_is_gated_off_by_default() {
    let _guard = KNOB_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    unsafe { std::env::remove_var("ZO_DB_MONITORING_TOP_QUERY_ENABLED") };
    config::refresh_config().expect("config refresh");
    assert!(
        !config::get_config().db_monitoring.top_query_enabled,
        "ZO_DB_MONITORING_TOP_QUERY_ENABLED must default OFF (D-G)"
    );

    let mut rec = pg_top_query();
    rec.insert(
        server_vantage::O2_EVENT_NAME.into(),
        json!(server_vantage::EVENT_TOP_QUERY),
    );
    assert_eq!(
        canonicalize_record(&rec),
        None,
        "with the knob off, a top_query record must produce no DBM columns at all"
    );
}

/// **The three kinds must not capture each other.**
///
/// Asserted as a full round-trip over every kind rather than only the two that
/// predate W3, because "the new arm does not steal old records" is satisfied by
/// an arm that never fires at all — which is also how the feature ships broken.
#[test]
fn each_record_kind_reaches_its_own_arm() {
    with_top_query_enabled(|| {
        // The two enterprise kinds are in the table only on an enterprise build;
        // on OSS they canonicalize to nothing at all, which
        // `enterprise_owned_records_do_not_canonicalize_on_oss` pins.
        #[cfg(feature = "enterprise")]
        let enterprise_kinds = [
            (
                "pg deadlock",
                pg_deadlock_record(),
                server_vantage::KIND_DEADLOCK,
            ),
            (
                "pg blocking",
                pg_blocking_record(),
                server_vantage::KIND_BLOCKING,
            ),
        ];
        #[cfg(not(feature = "enterprise"))]
        let enterprise_kinds: [(&str, Map<String, Value>, &str); 0] = [];

        for (name, rec, expected) in enterprise_kinds.into_iter().chain([
            (
                "pg top_query",
                pg_top_query(),
                server_vantage::KIND_TOP_QUERY,
            ),
            (
                "mysql top_query",
                mysql_top_query_with_event_name(),
                server_vantage::KIND_TOP_QUERY,
            ),
        ]) {
            let out =
                canonicalize_record(&rec).unwrap_or_else(|| panic!("{name} must canonicalize"));
            assert_eq!(
                out.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
                Some(expected),
                "{name} must reach its own arm and keep its own kind"
            );
        }
    });
}

/// **The parent DBM knob still wins over the child.**
///
/// `apply_to_record` early-returns when `db_monitoring.enabled` is off, BEFORE
/// the reservation strip. So with the parent off nothing is canonicalized —
/// which also means a caller's forged `o2_dbm_*` values are not stripped, and a
/// reader must not mistake them for ingest-derived ones. The combination
/// (parent off, child on) is what a user who disabled DBM wholesale then
/// upgraded actually runs.
#[test]
fn the_parent_knob_disables_top_query_ingest_entirely() {
    with_knobs(
        &[
            ("ZO_DB_MONITORING_TOP_QUERY_ENABLED", "true"),
            ("ZO_DB_MONITORING_ENABLED", "false"),
        ],
        || {
            let mut rec = pg_top_query();
            rec.insert(
                server_vantage::O2_EVENT_NAME.into(),
                json!(server_vantage::EVENT_TOP_QUERY),
            );
            server_vantage::apply_to_record(&mut rec);
            assert!(
                !rec.contains_key(server_vantage::O2_DBM_KIND),
                "with DB monitoring off wholesale, top_query ingest must write nothing — the \
                 child knob cannot re-enable a disabled feature"
            );
            assert!(!rec.contains_key(server_vantage::O2_DBM_PLAN));
        },
    );
}

/// The MySQL fixture with its OTLP event name attached — MySQL carries no
/// `postgresql.*` attribute, so the event name is its only route.
fn mysql_top_query_with_event_name() -> Map<String, Value> {
    let mut rec = mysql_top_query();
    rec.insert(
        server_vantage::O2_EVENT_NAME.into(),
        json!(server_vantage::EVENT_TOP_QUERY),
    );
    rec
}

/// A caller cannot POST a fabricated plan.
///
/// `apply_to_record`'s strip loop removes every `ALL_DBM_FIELDS` entry from
/// caller input before canonicalization; the canonicalizer reads only receiver
/// vendor names. A forged plan on a query-detail page is a lie about what the
/// database did.
#[test]
fn a_caller_cannot_supply_a_plan_or_its_hash() {
    with_top_query_enabled(|| {
        let mut rec = pg_top_query();
        rec.insert(
            server_vantage::O2_DBM_PLAN.into(),
            json!("[{\"Plan\":{\"Node Type\":\"Forged\"}}]"),
        );
        rec.insert(
            server_vantage::O2_DBM_PLAN_HASH.into(),
            json!("deadbeefdeadbeef"),
        );
        rec.insert(server_vantage::O2_DBM_CALLS.into(), json!(999_999));

        server_vantage::apply_to_record(&mut rec);

        // Asserted POSITIVELY: `assert_ne!` against the forged value is also
        // satisfied by a canonicalizer that strips everything and writes nothing
        // back, which is a broken feature passing a security test.
        let expected =
            server_vantage::canonicalize_top_query(&pg_top_query()).expect("the receiver's record");
        assert_eq!(
            rec.get(server_vantage::O2_DBM_PLAN_HASH)
                .and_then(Value::as_str),
            expected.plan_hash.as_deref(),
            "the surviving hash must be the one WE computed from the receiver's plan"
        );
        assert_eq!(
            rec.get(server_vantage::O2_DBM_CALLS)
                .and_then(Value::as_i64),
            Some(19687),
            "the surviving call count must be the receiver's measured value"
        );
        let plan = rec
            .get(server_vantage::O2_DBM_PLAN)
            .and_then(Value::as_str)
            .expect("the receiver's plan must be stored");
        assert!(
            plan.contains("ModifyTable"),
            "the stored plan must be the receiver's"
        );
        assert!(
            !plan.contains("Forged"),
            "the stored plan must never be the caller's"
        );
    });
}

/// The real captured plan: 19 levels deep, 2385 bytes, from `pg-top-query.jsonl`.
///
/// Every other hash fixture in this file is a hand-authored one- to three-node
/// toy, and a hasher that stops descending after a couple of levels passes all
/// of them. This is the record that catches it — the Hash Join and both Seq
/// Scans that a real regression would move sit near the BOTTOM of this tree.
fn pg_deep_plan() -> &'static str {
    "[{\"Plan\":{\"Node Type\":\"Limit\",\"Parallel Aware\":false,\"Async Capable\":false,\"Startup Cost\":281384.24,\"Total Cost\":281397.50,\"Plan Rows\":5306,\"Plan Width\":99,\"Plans\":[{\"Node Type\":\"Sort\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":false,\"Async Capable\":false,\"Startup Cost\":281384.24,\"Total Cost\":281516.89,\"Plan Rows\":53059,\"Plan Width\":99,\"Sort Key\":[\"(count(l.id)) DESC\"],\"Plans\":[{\"Node Type\":\"Aggregate\",\"Strategy\":\"Sorted\",\"Partial Mode\":\"Finalize\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":false,\"Async Capable\":false,\"Startup Cost\":248087.92,\"Total Cost\":268505.35,\"Plan Rows\":53059,\"Plan Width\":99,\"Group Key\":[\"o.customer_ref\",\"o.note\"],\"Plans\":[{\"Node Type\":\"Gather Merge\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":false,\"Async Capable\":false,\"Startup Cost\":248087.92,\"Total Cost\":267178.88,\"Plan Rows\":106118,\"Plan Width\":99,\"Workers Planned\":2,\"Plans\":[{\"Node Type\":\"Aggregate\",\"Strategy\":\"Sorted\",\"Partial Mode\":\"Partial\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":false,\"Async Capable\":false,\"Startup Cost\":247087.89,\"Total Cost\":253930.20,\"Plan Rows\":53059,\"Plan Width\":99,\"Group Key\":[\"o.customer_ref\",\"o.note\"],\"Plans\":[{\"Node Type\":\"Sort\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":false,\"Async Capable\":false,\"Startup Cost\":247087.89,\"Total Cost\":248665.82,\"Plan Rows\":631172,\"Plan Width\":99,\"Sort Key\":[\"o.customer_ref\",\"o.note\"],\"Plans\":[{\"Node Type\":\"Hash Join\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":true,\"Async Capable\":false,\"Join Type\":\"Inner\",\"Startup Cost\":19473.25,\"Total Cost\":48199.81,\"Plan Rows\":631172,\"Plan Width\":99,\"Inner Unique\":\"?\",\"Hash Cond\":\"( l.order_id = o.id )\",\"Plans\":[{\"Node Type\":\"Seq Scan\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":true,\"Async Capable\":false,\"Relation Name\":\"order_lines\",\"Alias\":\"l\",\"Startup Cost\":0.00,\"Total Cost\":17450.72,\"Plan Rows\":631172,\"Plan Width\":16},{\"Node Type\":\"Hash\",\"Parent Relationship\":\"Inner\",\"Parallel Aware\":true,\"Async Capable\":false,\"Startup Cost\":13254.77,\"Total Cost\":13254.77,\"Plan Rows\":221078,\"Plan Width\":99,\"Plans\":[{\"Node Type\":\"Seq Scan\",\"Parent Relationship\":\"Outer\",\"Parallel Aware\":true,\"Async Capable\":false,\"Relation Name\":\"orders\",\"Alias\":\"o\",\"Startup Cost\":0.00,\"Total Cost\":13254.77,\"Plan Rows\":221078,\"Plan Width\":99}]}]}]}]}]}]}]}]},\"JIT\":{\"Functions\":\"?\",\"Options\":{\"Inlining\":false,\"Optimization\":false,\"Expressions\":true,\"Deforming\":true}}}]"
}

/// **A change at the DEEPEST node must move the hash.**
///
/// The captured plan nests 19 levels: Limit → Sort → Aggregate(Finalize) →
/// Gather Merge → Aggregate(Partial) → Sort → Hash Join → {Seq Scan, Hash → Seq
/// Scan}. A hasher that walks only `plan[0]["Plan"]` and its direct children
/// passes every toy-fixture test in this file while being blind to exactly the
/// regressions users care about, because on a real query the join and the scans
/// are never at the top.
#[test]
fn plan_hash_descends_to_the_deepest_node_of_a_real_plan() {
    let base = server_vantage::plan_hash(pg_deep_plan()).expect("the real plan must hash");

    // The join method, deep in the tree — the classic regression.
    let flipped =
        pg_deep_plan().replace(r#""Node Type":"Hash Join""#, r#""Node Type":"Nested Loop""#);
    assert_ne!(
        server_vantage::plan_hash(&flipped),
        Some(base.clone()),
        "a Hash Join becoming a Nested Loop at depth must change the hash"
    );

    // The innermost relation.
    let rerelated = pg_deep_plan().replace(
        r#""Relation Name":"order_lines""#,
        r#""Relation Name":"order_lines_archive""#,
    );
    assert_ne!(
        server_vantage::plan_hash(&rerelated),
        Some(base.clone()),
        "scanning a different relation at the deepest level is a different plan"
    );

    // And the invariance half, on the same real document: re-costing a deep node
    // must NOT move it.
    let recosted = pg_deep_plan()
        .replace("13254.77", "999999.99")
        .replace("17450.72", "1.23");
    assert_eq!(
        server_vantage::plan_hash(&recosted),
        Some(base),
        "costs drift every ANALYZE; on a real plan that must still be invisible"
    );
}

/// **Non-structural STRING fields must not move the hash.**
///
/// Every "moves the hash" case in this file changes a string, and every
/// "ignores" case changes a NUMBER. So the whole suite is passed by a hasher
/// that hashes all strings in the document and drops all numbers. These fields
/// are all present in the real captured plan and are all string-valued, and none
/// of them is structure:
///
/// * `Parent Relationship` — which side of the parent a node feeds; derivable from position, and it
///   flips with cosmetic replanning.
/// * `Alias` — the query's alias for a relation, i.e. text from the statement.
/// * `Index Cond` / `Hash Cond` / `Sort Key` / `Group Key` — predicates, which D-B places outside
///   "node types + relation names + join order".
/// * `Async Capable`, `Inner Unique`, `Operation` — obfuscated or capability flags rather than plan
///   shape.
#[test]
fn non_structural_string_fields_do_not_move_the_hash() {
    let base = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"orders","Index Name":"orders_pkey","Alias":"o","Parent Relationship":"Outer","Async Capable":false,"Operation":"?","Inner Unique":"?","Index Cond":"( id = ? )","Sort Key":["a DESC"],"Group Key":["a"]}}]"#;
    let baseline = server_vantage::plan_hash(base).expect("baseline");

    for (field, changed) in [
        (
            "Parent Relationship",
            base.replace(
                r#""Parent Relationship":"Outer""#,
                r#""Parent Relationship":"Inner""#,
            ),
        ),
        (
            "Alias",
            base.replace(r#""Alias":"o""#, r#""Alias":"orders_1""#),
        ),
        (
            "Index Cond",
            base.replace(
                r#""Index Cond":"( id = ? )""#,
                r#""Index Cond":"( sku = ? )""#,
            ),
        ),
        (
            "Sort Key",
            base.replace(r#""Sort Key":["a DESC"]"#, r#""Sort Key":["b ASC"]"#),
        ),
        (
            "Group Key",
            base.replace(r#""Group Key":["a"]"#, r#""Group Key":["b"]"#),
        ),
        (
            "Operation",
            base.replace(r#""Operation":"?""#, r#""Operation":"Insert""#),
        ),
    ] {
        assert_eq!(
            server_vantage::plan_hash(&changed),
            Some(baseline.clone()),
            "`{field}` is not plan structure and must not move the hash — a hasher over every \
             string in the document passes the rest of this file and fails here"
        );
    }
}

/// **A delimiter inside an identifier must not forge a field boundary.**
///
/// Postgres identifiers are freely unicode and may contain any punctuation the
/// hasher uses to separate fields. The obvious implementation — joining fields
/// with a separator — collides `Relation Name: "a;Index Name=b"` with the
/// genuine pair `Relation Name: "a"`, `Index Name: "b"`, so two structurally
/// different plans report as unchanged.
#[test]
fn identifier_punctuation_cannot_forge_a_field_boundary() {
    let sneaky = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"a;Index Name=b"}}]"#;
    let genuine = r#"[{"Plan":{"Node Type":"Index Scan","Relation Name":"a","Index Name":"b"}}]"#;
    assert_ne!(
        server_vantage::plan_hash(sneaky),
        server_vantage::plan_hash(genuine),
        "an identifier containing the field delimiter must not collide with two real fields"
    );

    // Unicode identifiers hash stably and distinctly.
    let ascii = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"ordenes"}}]"#;
    let accented = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"órdenes"}}]"#;
    assert_ne!(
        server_vantage::plan_hash(ascii),
        server_vantage::plan_hash(accented),
        "two different relations must not collide because one is unicode"
    );
    assert_eq!(
        server_vantage::plan_hash(accented),
        server_vantage::plan_hash(accented),
        "and a unicode identifier hashes deterministically"
    );
}

/// **A pathological plan must not take the process down.**
///
/// This runs on the ingest hot path, where a stack overflow ABORTS — it is not a
/// catchable panic. Plan depth arrives from outside our control, and the
/// captured real plans already reach 19 levels.
///
/// The walk itself carries no depth cap, deliberately: `serde_json` enforces a
/// 128-level recursion limit during PARSING and returns
/// `Err("recursion limit exceeded")`, which `plan_hash` maps to `None` — verified
/// directly, a 5,000-level document is rejected at column 2277 and the walker
/// never sees it. A cap in the walker would be unreachable code pretending to be
/// a safety property. This test is what holds that reasoning to account: if a
/// future change parses with `serde_json`'s recursion limit disabled, it fails
/// here rather than in production.
#[test]
fn a_pathologically_deep_plan_does_not_blow_the_stack() {
    let mut plan = String::from(r#"{"Node Type":"Seq Scan","Relation Name":"deep"}"#);
    for _ in 0..5_000 {
        plan = format!(r#"{{"Node Type":"Nested Loop","Plans":[{plan}]}}"#);
    }
    let doc = format!("[{{\"Plan\":{plan}}}]");
    // Any answer is acceptable; aborting the process is not.
    let _ = server_vantage::plan_hash(&doc);

    // And a very wide one, which recurses shallowly but allocates heavily.
    let wide: Vec<String> = (0..5_000)
        .map(|i| format!(r#"{{"Node Type":"Seq Scan","Relation Name":"t{i}"}}"#))
        .collect();
    let wide_doc = format!(
        r#"[{{"Plan":{{"Node Type":"Append","Plans":[{}]}}}}]"#,
        wide.join(",")
    );
    assert!(
        server_vantage::plan_hash(&wide_doc).is_some(),
        "a wide plan is a normal partitioned scan and must still hash"
    );
}

/// **A multi-statement plan document has more than one top-level element.**
///
/// `EXPLAIN (FORMAT JSON)` returns one array element per rewritten statement. A
/// hasher that reads only `arr[0]` collides two documents that differ solely in
/// their second statement — a real plan change reporting "no change", which is
/// exactly the false negative D-H forbids us from widening.
#[test]
fn plan_hash_covers_every_top_level_plan_in_the_document() {
    let ab = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"a"}},{"Plan":{"Node Type":"Seq Scan","Relation Name":"b"}}]"#;
    let ac = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"a"}},{"Plan":{"Node Type":"Seq Scan","Relation Name":"c"}}]"#;
    assert_ne!(
        server_vantage::plan_hash(ab),
        server_vantage::plan_hash(ac),
        "a change in the SECOND statement must move the hash"
    );

    // Order is structure too: the same two statements swapped is a different
    // document, and a hasher folding into an order-insensitive set collides them.
    let ba = r#"[{"Plan":{"Node Type":"Seq Scan","Relation Name":"b"}},{"Plan":{"Node Type":"Seq Scan","Relation Name":"a"}}]"#;
    assert_ne!(
        server_vantage::plan_hash(ab),
        server_vantage::plan_hash(ba),
        "statement order is part of the document"
    );
}

/// **The MySQL hash must be over structure, not over the raw bytes.**
///
/// The PG shape has this pairing; MySQL did not, so a hash of the whole plan
/// string with numbers stripped passed every MySQL assertion. Reformatting and
/// reordering keys changes the bytes and not the plan.
#[test]
fn the_mysql_plan_hash_is_insensitive_to_formatting() {
    let plan = mysql_top_query()["mysql_query_plan"]
        .as_str()
        .unwrap()
        .to_string();
    let base = server_vantage::plan_hash(&plan).expect("mysql plan");

    // Round-trip through serde: same document, re-serialized, keys reordered by
    // the map implementation and whitespace normalized.
    let parsed: Value = serde_json::from_str(&plan).expect("valid json");
    let reserialized = serde_json::to_string_pretty(&parsed).expect("reserialize");
    assert_ne!(
        reserialized, plan,
        "the bytes must actually differ, or this proves nothing"
    );
    assert_eq!(
        server_vantage::plan_hash(&reserialized),
        Some(base.clone()),
        "reformatting is not replanning; a raw-string hasher fails here"
    );

    // `used_columns` is a real field in the captured MySQL plan and is not
    // structure.
    let recolumned = plan.replace(r#"["id","customer_ref","amount"]"#, r#"["amount","id"]"#);
    assert_ne!(recolumned, plan, "the mutation must apply");
    assert_eq!(
        server_vantage::plan_hash(&recolumned),
        Some(base),
        "the projected column list is not the access path"
    );
}

/// **The selection bias of the top_query feed is recorded in the code.**
///
/// Spec §6.1 makes this a W3.1 obligation: *"'Top queries' means most FREQUENT,
/// not most EXPENSIVE. The receiver's top_query SQL orders by `calls DESC`. A
/// DBA reading a page titled 'Top queries' will assume total time. Either
/// re-rank on our side or label the column honestly — W3.1 must state which."*
///
/// We cannot re-rank: the bias is in which rows the receiver SENDS, so the
/// expensive-but-infrequent statement never arrives and no read-side ordering
/// recovers it. That makes labelling the only honest option, and the label has
/// to start from a statement in the code that a UI author will actually find.
///
/// Asserted as a source-scrape because a comment has no runtime behaviour —
/// and the alternative is that the obligation is discharged by nothing at all.
#[test]
fn the_top_query_selection_bias_is_documented() {
    // `KIND_TOP_QUERY` and its doc comment moved into the shared `config`
    // vocabulary so `o2_enterprise` can reach them; the scrape follows the
    // const to its new home. What is asserted is unchanged: the selection bias
    // must be stated where the kind is DEFINED, not somewhere a UI author has
    // to already know to look.
    let src = include_str!("../../../../config/src/meta/db_monitoring.rs");
    let anchor = src
        .find("pub const KIND_TOP_QUERY")
        .expect("the top_query kind must exist");
    let doc = &src[anchor.saturating_sub(1600)..anchor];
    assert!(
        doc.contains("calls DESC"),
        "the receiver's ordering must be named where the kind is defined — the feed is a \
         most-FREQUENT top-N, and a reader who assumes most-EXPENSIVE draws the wrong \
         conclusion from a complete-looking list"
    );
    assert!(
        doc.contains("frequent"),
        "and the consequence must be stated in words, not left to be inferred from `calls DESC`"
    );
}

/// **No duplicate entries in `ALL_DBM_FIELDS`, and the length is pinned.**
///
/// The two assertions work together: the length pin is the compile-time forcing
/// function for a deliberate bump, and the duplicate check catches what the
/// length cannot see — a repeated entry satisfies the expected total while a
/// real column is silently missing, dropping it from both the strip list and
/// the read projection. (Which columns the array must contain is covered from
/// the other direction by `every_column_any_writer_emits_is_reserved`.)
#[test]
fn the_reserved_field_list_has_no_duplicates() {
    let mut seen = std::collections::HashSet::new();
    for f in server_vantage::ALL_DBM_FIELDS {
        assert!(
            seen.insert(f),
            "`{f}` appears twice in ALL_DBM_FIELDS — the duplicate hides a missing column \
             behind a correct-looking length"
        );
    }
    // D-I: `o2_event_name` is reserved even though no writer emits it, so the
    // ⊆ walk cannot cover it — a caller must not be able to POST one to /_json
    // and forge an engine-derived discriminator.
    assert!(
        seen.contains(&server_vantage::O2_EVENT_NAME),
        "o2_event_name must be reserved (spec D-I)"
    );
    assert_eq!(
        server_vantage::ALL_DBM_FIELDS.len(),
        83,
        "23 pre-existing (22 + o2_event_name from W1) + 19 activity columns (W2) \
         + 14 top-query columns (W3) + 3 executed-plan columns (W-E3: plan_source, \
         plan_duration_ms, plan_rows_actual) + 18 table-health columns (W10) + 5 index-health \
         columns (W11: index_name, index_bytes, idx_tup_read, idx_tup_fetch, \
         index_is_unique — relation, schema and idx_scan_count are SHARED with W10) \
         + 1 statement-duration column (W-S1: stmt_duration_ms — pid/user/app/query/fingerprint \
         are SHARED with W2); bump this deliberately — the length is the compile-time forcing \
         function"
    );
}

/// **The strip must remove a forged column the receiver does NOT write.**
///
/// Forging only columns the canonicalizer overwrites proves nothing: the
/// canonicalizer's own writes clobber them, so the test passes even with no
/// reservation strip at all. These are columns the genuine record leaves empty,
/// so only the strip can remove them.
#[test]
fn the_strip_removes_forged_columns_the_receiver_never_writes() {
    with_top_query_enabled(|| {
        // A Postgres record, so the shape sniff routes it: `o2_event_name` is
        // itself a reserved field, and `apply_to_record`'s strip removes it
        // before dispatch — the OTLP producer loop re-inserts the trusted value
        // afterwards (`logs/otlp.rs:548-554`), which is the D-I design, but a
        // direct call here has no producer loop to do that. MySQL cannot be
        // sniffed, so a MySQL record reaching this function directly is
        // unroutable by construction.
        //
        // The plan is blanked so nothing legitimate overwrites the forged plan
        // columns; the counters forged below are MySQL-only absences on a PG
        // record — either way, only the strip can remove them.
        let mut rec = pg_top_query();
        rec.insert("postgresql_query_plan".into(), json!(""));
        rec.remove("postgresql_rows");
        rec.remove("postgresql_shared_blks_hit");
        rec.insert(server_vantage::O2_DBM_ROWS.into(), json!(4_242_424));
        rec.insert(server_vantage::O2_DBM_SHARED_BLKS_HIT.into(), json!(777));
        rec.insert(server_vantage::O2_DBM_PLAN_HASH_VERSION.into(), json!(999));
        rec.insert(
            server_vantage::O2_DBM_PLAN.into(),
            json!("[{\"Plan\":{\"Node Type\":\"Forged\"}}]"),
        );

        server_vantage::apply_to_record(&mut rec);

        for forged in [
            server_vantage::O2_DBM_ROWS,
            server_vantage::O2_DBM_SHARED_BLKS_HIT,
            server_vantage::O2_DBM_PLAN_HASH_VERSION,
            server_vantage::O2_DBM_PLAN,
        ] {
            assert!(
                !rec.contains_key(forged),
                "`{forged}` is not written for this record, so a surviving value can only be \
                 the caller's — the reservation strip must have removed it"
            );
        }
        // The record still canonicalized; the strip did not eat the real data.
        assert_eq!(
            rec.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
        );
    });
}

/// **A query_sample record must never land as a top query.**
///
/// The two events share `db.query.text` and a near-identical attribute surface;
/// the sniff separates them on `postgresql.calls` vs `postgresql.state`. A sniff
/// ordered wrongly reclassifies the entire high-volume activity feed as top
/// queries — and the trusted event name must beat the sniff when they disagree.
#[test]
fn a_query_sample_never_lands_as_a_top_query() {
    with_top_query_enabled(|| {
        let out = canonicalize_record(&pg_query_sample_blocked());
        assert_ne!(
            out.as_ref()
                .and_then(|o| o.get(server_vantage::O2_DBM_KIND))
                .and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
            "an activity sample is not a top query"
        );

        // Shape says top_query, the trusted OTLP name says query_sample. The
        // name must win — it is the receiver's own discriminator, while the
        // shape is a fallback for records that never had one.
        let mut conflicted = pg_top_query();
        conflicted.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_QUERY_SAMPLE),
        );
        assert_ne!(
            canonicalize_record(&conflicted)
                .as_ref()
                .and_then(|o| o.get(server_vantage::O2_DBM_KIND))
                .and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
            "a present event name must beat the shape sniff"
        );
    });
}

/// **A whitespace-only or literal-null plan is no plan.**
///
/// E6's empty string is the measured case, but a VRL pipeline or a transformed
/// record can deliver `" "` or `"null"`. Storing either yields a row with a plan
/// column and no hash — a blank plan tree in the UI beside a query that looks
/// like it was explained.
#[test]
fn a_blank_or_null_plan_is_treated_as_no_plan() {
    for blank in ["", "   ", "null"] {
        let mut rec = pg_top_query();
        rec.insert("postgresql_query_plan".into(), json!(blank));
        let s = server_vantage::canonicalize_top_query(&rec).expect("still a top query");
        assert_eq!(s.plan_hash, None, "{blank:?} must not produce a hash");
        let stored = s.to_record();
        assert!(
            !stored.contains_key(server_vantage::O2_DBM_PLAN),
            "{blank:?} must not be stored as a plan"
        );
        assert!(
            !stored.contains_key(server_vantage::O2_DBM_PLAN_HASH_VERSION),
            "{blank:?}: a hash version with no hash describes nothing"
        );
    }
}

/// **Every stored column round-trips with the right JSON TYPE.**
///
/// Spec §4 requires the round-trip and the block had none. Types matter as much
/// as values here: a negative PG queryid coerced to a number re-renders
/// differently and breaks the server-vantage join, and an exec time stored as a
/// string cannot be aggregated at all.
#[test]
fn the_top_query_record_round_trips_with_correct_types() {
    let s = server_vantage::canonicalize_top_query(&pg_top_query()).expect("top_query");
    let rec = s.to_record();

    assert_eq!(
        rec[server_vantage::O2_DBM_SERVER_QUERY_ID].as_str(),
        Some("8802886719592092940"),
        "the server id stays a STRING — it is a signed 64-bit hash, often negative"
    );
    assert_eq!(
        rec[server_vantage::O2_DBM_EXEC_TIME_S].as_f64(),
        Some(118_335.099_645_809_72),
        "exec time is a NUMBER in seconds, or nothing can aggregate it"
    );
    assert_eq!(rec[server_vantage::O2_DBM_CALLS].as_i64(), Some(19687));
    assert_eq!(
        rec[server_vantage::O2_DBM_FINGERPRINT].as_str(),
        s.fingerprint.as_deref(),
        "the fingerprint COLUMN must carry the fingerprint, not just the struct field"
    );
    assert!(
        rec[server_vantage::O2_DBM_ACTIVITY_QUERY]
            .as_str()
            .is_some_and(|q| q.contains("inventory")),
        "the statement text must reach the record"
    );
    assert_eq!(
        rec[server_vantage::O2_DBM_PLAN_HASH].as_str(),
        s.plan_hash.as_deref()
    );
    assert!(
        rec[server_vantage::O2_DBM_PLAN]
            .as_str()
            .is_some_and(|p| p.starts_with('[')),
        "the plan is the JSON document as a string"
    );
}

/// **B19 — the trusted event name must survive the strip.**
///
/// `apply_to_record` strips every `ALL_DBM_FIELDS` member before dispatching, and
/// `O2_EVENT_NAME` is one of them. Canonicalization then falls back to
/// `sniff_event_name`, which is Postgres-only by construction — MySQL records carry
/// no `postgresql.*` attribute to sniff on. So in production every MySQL receiver
/// event was silently dropped: measured 0 of 170 `top_query` and 0 of 11
/// `query_sample` canonicalized in one 150s window, against 373/373 and 242/242 for
/// Postgres on the same binary.
///
/// Every pre-existing MySQL test called `canonicalize_record` DIRECTLY, skipping the
/// strip, so none reproduced the production sequence. This one goes through
/// `apply_to_record` — the entry point the OTLP and JSON ingest paths actually call.
#[test]
fn apply_to_record_canonicalizes_mysql_receiver_events() {
    with_top_query_enabled(|| {
        let mut rec = mysql_top_query();
        rec.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_TOP_QUERY),
        );
        server_vantage::apply_to_record(&mut rec);
        assert_eq!(
            rec.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
            "a MySQL top_query must canonicalize through the real ingest entry point; \
             it is discriminated by the OTLP event name and has no Postgres-shaped \
             attribute to fall back on"
        );
    });
}

/// The Postgres path must keep working through the same entry point — it survives
/// today only because `sniff_event_name` matches on `postgresql_calls`, and the fix
/// must not regress the case that already works.
#[test]
fn apply_to_record_still_canonicalizes_postgres_receiver_events() {
    with_top_query_enabled(|| {
        let mut rec = pg_top_query();
        rec.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_TOP_QUERY),
        );
        server_vantage::apply_to_record(&mut rec);
        assert_eq!(
            rec.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_TOP_QUERY),
        );
    });
}

/// The OTHER half of B19: `query_sample` is discriminated the same way, so a
/// non-Postgres activity row was dropped for the same reason. Measured alongside
/// the top_query figures: 0 of 11 MySQL `query_sample` canonicalized against
/// 242/242 for Postgres.
#[test]
fn apply_to_record_canonicalizes_mysql_query_sample() {
    // The real knob, not `dispatch_activity`: that helper BYPASSES the gate rather
    // than enabling it, so it cannot exercise the ingest entry point this pins.
    with_knob("ZO_DB_MONITORING_ACTIVITY_ENABLED", || {
        let mut rec = mysql_query_sample();
        rec.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_QUERY_SAMPLE),
        );
        server_vantage::apply_to_record(&mut rec);
        assert_eq!(
            rec.get(server_vantage::O2_DBM_KIND).and_then(Value::as_str),
            Some(server_vantage::KIND_ACTIVITY),
            "a MySQL query_sample must canonicalize through the real ingest entry point"
        );
    });
}

/// **The strip must not become a back door.**
///
/// Carrying the event name across the strip is what fixes B19, so the obvious way
/// to get it wrong is to let a CALLER-SUPPLIED name reach the stored record. The
/// JSON ingest path has no OTLP envelope, so a name on that record came from the
/// request body. Dispatch may honour it — that is what `sniff_event_name`'s
/// fallback already does for Postgres by shape — but the field itself must still
/// be stripped, exactly as `apply_to_record_strips_the_event_name_it_cannot_
/// authenticate` requires. Pinned here for the MySQL path specifically, because
/// that is the path the fix newly enables.
#[test]
fn the_carried_event_name_is_not_stored_on_the_record() {
    with_top_query_enabled(|| {
        let mut rec = mysql_top_query();
        rec.insert(
            server_vantage::O2_EVENT_NAME.into(),
            json!(server_vantage::EVENT_TOP_QUERY),
        );
        server_vantage::apply_to_record(&mut rec);
        assert!(
            !rec.contains_key(server_vantage::O2_EVENT_NAME),
            "the name carried across the strip is a dispatch input, not a stored \
             field — the ingest paths re-insert the value taken from the OTLP \
             envelope, and that is what makes the stored field trusted"
        );
    });
}

// ─── W10 · Table health (`pg_table_stats`) ───────────────────────────────────
//
// Every fixture below is the VERBATIM wire shape measured off the live rig
// (`o2-dbm-capture/collector/server.yaml` R3a, flattened as logs ingest stores
// it). The recipe declares `table_name` as the recipe's `body_column`, so the
// table name arrives as `body` and NOT as a `table_name` attribute — the exact
// producer/parser mismatch that shipped two DBM bugs green through 205 tests.

#[cfg(feature = "enterprise")]
/// Table-driven canonicalization check: run `rec` through `apply_to_record`
/// (the production entry point — the B19 discipline: tests that call
/// `canonicalize_record` directly skip the strip and repeat the hole that
/// shipped two DBM bugs green) and assert each `(column, expected)` pair.
/// `None` pins a DELIBERATE absence — an absent column and a fabricated zero
/// are different claims.
#[track_caller]
fn assert_canonicalizes(
    name: &str,
    mut rec: Map<String, Value>,
    expected: &[(&str, Option<Value>)],
) {
    server_vantage::apply_to_record(&mut rec);
    for (col, want) in expected {
        assert_eq!(rec.get(*col), want.as_ref(), "{name}: `{col}`: {rec:?}");
    }
}

/// One real `pg_table_stats` record, post-ingest flattening.
fn pg_table_stats_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_000_000_000i64,
        "o2_recipe": "pg_table_stats",
        "o2_vantage": "server",
        "o2_rig": "o2-dbm-capture",
        // The TABLE NAME, in `body` — it is the recipe's body_column.
        "body": "audit_log",
        "schema_name": "public",
        "heap_bytes": "10510336",
        "total_bytes": "13639680",
        "n_live_tup": "137268",
        "n_dead_tup": "0",
        "dead_tup_pct": "0.00",
        "n_mod_since_analyze": "5547",
        "seq_scan": "0",
        "seq_tup_read": "0",
        "idx_scan": "0",
        "autovacuum_count": "8",
        "frozen_xid_age": "335437",
        "last_autovacuum": "2026-08-11 23:39:57.939725+00",
        // A table never manually vacuumed/analyzed — the ORDINARY case, and it
        // arrives as an empty string, not null.
        "last_vacuum": "",
        "last_analyze": "",
        "deployment_environment_name": "dbm-demo",
        "server_address": "pg-primary:5432",
    }))
}

#[cfg(feature = "enterprise")]
/// **Through `apply_to_record`, the production entry point — never
/// `canonicalize_record` directly.**
///
/// B19 shipped broken for weeks because every test called the internal function
/// while the ingest paths called the outer one, and the strip loop between them
/// removed the field dispatch depended on. A table-stats test that skips the
/// strip would repeat that exact hole.
#[test]
fn table_stats_canonicalizes_through_the_ingest_entry_point() {
    let mut rec = pg_table_stats_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_TABLE_STATS)),
        "a pg_table_stats record must canonicalize through the real ingest path: {rec:?}"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_RELATION),
        Some(&json!("audit_log")),
        "the table name arrives in `body`, and must land as the relation"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SCHEMA),
        Some(&json!("public"))
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_ENGINE),
        Some(&json!("postgresql")),
        "the pg_ tag names Postgres, and the row must say so — a fleet view \
         cannot otherwise tell which engines it is missing"
    );
}

#[cfg(feature = "enterprise")]
/// The measurement columns must SURVIVE canonicalization, and arrive as numbers.
///
/// `sqlqueryreceiver` casts every column to text (`::text` in the recipe), so a
/// reader that did not parse them would sort "9" after "137268" — a size ranking
/// that puts the smallest table first and looks like a working answer.
#[test]
fn table_stats_parses_the_text_columns_into_numbers() {
    assert_canonicalizes(
        "pg_table_stats (audit_log)",
        pg_table_stats_record(),
        &[
            (
                server_vantage::O2_DBM_TOTAL_BYTES,
                Some(json!(13_639_680i64)),
            ),
            (
                server_vantage::O2_DBM_HEAP_BYTES,
                Some(json!(10_510_336i64)),
            ),
            (server_vantage::O2_DBM_LIVE_TUPLES, Some(json!(137_268i64))),
            (server_vantage::O2_DBM_DEAD_TUPLES, Some(json!(0))),
            // A percentage is fractional and must not be truncated to an
            // integer.
            (server_vantage::O2_DBM_DEAD_TUP_PCT, Some(json!(0.0))),
            (
                server_vantage::O2_DBM_MOD_SINCE_ANALYZE,
                Some(json!(5547i64)),
            ),
            (
                server_vantage::O2_DBM_FROZEN_XID_AGE,
                Some(json!(335_437i64)),
            ),
            // W11 wants this one specifically: idx_scan = 0 on a live table is
            // the unused-index signal. A measured zero is a finding, not an
            // absence — dropped as falsy, it hides the never-scanned table W11
            // exists to surface.
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, Some(json!(0))),
            (server_vantage::O2_DBM_SEQ_SCAN_COUNT, Some(json!(0))),
            (server_vantage::O2_DBM_AUTOVACUUM_COUNT, Some(json!(8))),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **The cumulative counters must be MARKED as cumulative, unconditionally.**
///
/// `seq_scan`, `idx_scan` and `autovacuum_count` come from `pg_stat_user_tables`
/// and are lifetime totals since the last `pg_stat_reset()`, not per-window
/// counts. A reader shown "0 seq scans" with no qualifier reads it as "no seq
/// scans in the last hour", which is a different and much stronger claim.
///
/// The marker is unconditional for the same reason `o2_dbm_metrics_are_delta`
/// is: present on only some rows, its absence would be read as a claim that
/// those rows are per-window.
#[test]
fn table_stats_marks_its_counters_as_lifetime_totals() {
    let mut rec = pg_table_stats_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_COUNTERS_ARE_CUMULATIVE),
        Some(&json!(true)),
        "these counters are lifetime-since-stats-reset; unmarked, every reader \
         downstream is free to label them 'in this window' and be wrong"
    );
}

#[cfg(feature = "enterprise")]
/// **The size and dead-tuple figures are PLANNER ESTIMATES and must say so.**
///
/// `n_live_tup`/`n_dead_tup` come from `pg_stat_user_tables`' estimated counters
/// (fed by `reltuples`), not from `COUNT(*)`. Presenting "137,268 rows" as exact
/// is the estimate-as-exact trap, and the number can be arbitrarily stale on a
/// table that has not been analyzed.
#[test]
fn table_stats_declares_its_tuple_counts_estimated() {
    let mut rec = pg_table_stats_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_TUPLES_ARE_ESTIMATED),
        Some(&json!(true)),
        "reltuples-derived counts are estimates; unmarked they render as an \
         exact row count nobody re-checks"
    );
}

#[cfg(feature = "enterprise")]
/// An empty vacuum timestamp means NEVER VACUUMED, which is the ordinary case
/// and an actual finding — it must not be confused with a parse failure, and it
/// must not be stored as an empty string that renders as a blank cell.
#[test]
fn table_stats_reads_an_empty_vacuum_timestamp_as_never() {
    let mut rec = pg_table_stats_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_LAST_AUTOVACUUM),
        Some(&json!("2026-08-11 23:39:57.939725+00")),
        "a real autovacuum time survives verbatim"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_LAST_VACUUM),
        None,
        "`\"\"` is 'never manually vacuumed' — storing the empty string would \
         render a blank cell that reads as missing data"
    );
    assert_eq!(rec.get(server_vantage::O2_DBM_LAST_ANALYZE), None);
}

#[cfg(feature = "enterprise")]
/// **A table row is scoped by SCHEMA, and must never claim a DATABASE it was
/// never told.**
///
/// The recipe emits no `db.namespace`: `pg_class`/`pg_stat_user_tables` are
/// per-database catalogs, so the database is implicit in the connection and
/// never appears on the row. The trap is `detect_database`, whose alias list
/// already contains `schema_name` — reusing it here would silently file every
/// `public.orders` under a DATABASE named `public`, and the Databases page would
/// grow a database that does not exist.
#[test]
fn table_stats_never_reports_the_schema_as_a_database() {
    let mut rec = pg_table_stats_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_DATABASE),
        None,
        "the recipe never names a database, and `schema_name` is not one — \
         filing `public.orders` under database `public` invents a database"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SCHEMA),
        Some(&json!("public")),
        "the schema IS known and is what scopes the relation"
    );
}

#[cfg(feature = "enterprise")]
/// The instance must land, because it is the only thing separating a `users`
/// table on one server from a `users` table on another.
#[test]
fn table_stats_carries_the_instance() {
    let mut rec = pg_table_stats_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_INSTANCE),
        Some(&json!("pg-primary")),
        "port-stripped, exactly as every other server-vantage kind stores it"
    );
}

/// A row with no relation name carries nothing to show, and inventing one would
/// fabricate a table in the health list.
#[test]
fn table_stats_without_a_relation_is_dropped() {
    let mut rec = pg_table_stats_record();
    rec.remove("body");
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND),
        None,
        "no relation name means no table row"
    );
}

/// **D-I: the canonical columns are OUTPUTS, never inputs.**
///
/// A caller POSTing `o2_dbm_relation` to `/_json` must not have it stored as
/// engine-derived truth — the same reservation every other DBM kind relies on.
#[test]
fn caller_supplied_table_columns_are_stripped() {
    let mut rec = obj(json!({
        "_timestamp": 1_786_500_000_000_000i64,
        // No recipe tag: nothing here is a table-stats record.
        "o2_dbm_relation": "forged_table",
        "o2_dbm_total_bytes": 99_999_999i64,
        "o2_dbm_kind": "table_stats",
    }));
    server_vantage::apply_to_record(&mut rec);

    for forged in [
        server_vantage::O2_DBM_RELATION,
        server_vantage::O2_DBM_TOTAL_BYTES,
        server_vantage::O2_DBM_KIND,
    ] {
        assert_eq!(
            rec.get(forged),
            None,
            "`{forged}` is an OUTPUT of canonicalization; a caller-supplied \
             value must not survive"
        );
    }
}

/// **The other kinds must not regress.** A new dispatch arm keyed on `o2_recipe`
/// sits beside four existing ones, and the cheapest way to break them is to
/// return early on a tag that overlaps.
#[test]
fn adding_table_stats_leaves_the_other_recipes_dispatching() {
    // Deadlocks and blocking are enterprise-owned; on OSS the coexistence
    // property is that they stay OUT of the arms under test, which is `None`.
    #[cfg(feature = "enterprise")]
    {
        let dl = canonicalize_record(&pg_deadlock_record()).expect("pg deadlock still dispatches");
        assert_eq!(dl.get("o2_dbm_kind").unwrap(), &json!("deadlock"));

        let bl = canonicalize_record(&pg_blocking_record()).expect("blocking still dispatches");
        assert_eq!(bl.get("o2_dbm_kind").unwrap(), &json!("blocking"));
    }
    #[cfg(not(feature = "enterprise"))]
    {
        assert!(canonicalize_record(&pg_deadlock_record()).is_none());
        assert!(canonicalize_record(&pg_blocking_record()).is_none());
    }

    // A recipe we still do not consume stays unconsumed rather than falling into
    // the table arm.
    let unknown = obj(json!({"o2_recipe": "pg_something_new", "body": "orders"}));
    assert!(canonicalize_record(&unknown).is_none());
}

#[cfg(feature = "enterprise")]
/// **A SECOND, materially different relation — the discriminator.**
///
/// Every other test in this group uses one fixture, and a hard-coded lookup
/// table keyed on that fixture passed all ten of them (measured: rung-1 stub
/// attack, 10/10 survived). A parser and a lookup only diverge on a record with
/// different values, so this fixture inverts every one that matters: a bloated
/// table in a non-`public` schema, heavily seq-scanned, never autovacuumed,
/// with a manual vacuum instead — the shape a DBA actually opens this page to
/// find.
fn pg_table_stats_bloated_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_600_000_000_000i64,
        "o2_recipe": "pg_table_stats",
        "body": "sessions",
        "schema_name": "app",
        "heap_bytes": "884736",
        "total_bytes": "1245184",
        "n_live_tup": "412",
        "n_dead_tup": "9130",
        "dead_tup_pct": "95.68",
        "n_mod_since_analyze": "12",
        "seq_scan": "88214",
        "seq_tup_read": "3120044",
        "idx_scan": "17",
        // Never autovacuumed, but manually vacuumed once — the inverse of the
        // primary fixture, so a lookup keyed on it cannot satisfy both.
        "autovacuum_count": "0",
        "frozen_xid_age": "51",
        "last_autovacuum": "",
        "last_vacuum": "2026-08-10 04:00:01.113402+00",
        "last_analyze": "2026-08-10 04:00:02.881190+00",
        "server_address": "pg-replica-2:5432",
    }))
}

#[cfg(feature = "enterprise")]
#[test]
fn table_stats_reads_each_relation_from_its_own_record() {
    assert_canonicalizes(
        "pg_table_stats (bloated sessions)",
        pg_table_stats_bloated_record(),
        &[
            (server_vantage::O2_DBM_RELATION, Some(json!("sessions"))),
            (server_vantage::O2_DBM_SCHEMA, Some(json!("app"))),
            (server_vantage::O2_DBM_INSTANCE, Some(json!("pg-replica-2"))),
            (
                server_vantage::O2_DBM_TOTAL_BYTES,
                Some(json!(1_245_184i64)),
            ),
            (server_vantage::O2_DBM_HEAP_BYTES, Some(json!(884_736i64))),
            (server_vantage::O2_DBM_LIVE_TUPLES, Some(json!(412i64))),
            (server_vantage::O2_DBM_DEAD_TUPLES, Some(json!(9130i64))),
            // The bloat figure must survive as a FRACTION. An integer parse of
            // "95.68" fails outright and the column vanishes; a truncating one
            // reports 95.
            (server_vantage::O2_DBM_DEAD_TUP_PCT, Some(json!(95.68))),
            (
                server_vantage::O2_DBM_SEQ_SCAN_COUNT,
                Some(json!(88_214i64)),
            ),
            (
                server_vantage::O2_DBM_SEQ_TUP_READ,
                Some(json!(3_120_044i64)),
            ),
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, Some(json!(17i64))),
            (server_vantage::O2_DBM_MOD_SINCE_ANALYZE, Some(json!(12i64))),
            (server_vantage::O2_DBM_FROZEN_XID_AGE, Some(json!(51i64))),
            // Never autovacuumed (zero autovacuums is the finding, not an
            // absence); manually vacuumed. The exact inverse of the primary
            // fixture, which is what makes the pair discriminating.
            (server_vantage::O2_DBM_AUTOVACUUM_COUNT, Some(json!(0))),
            (server_vantage::O2_DBM_LAST_AUTOVACUUM, None),
            (
                server_vantage::O2_DBM_LAST_VACUUM,
                Some(json!("2026-08-10 04:00:01.113402+00")),
            ),
            (
                server_vantage::O2_DBM_LAST_ANALYZE,
                Some(json!("2026-08-10 04:00:02.881190+00")),
            ),
            // The snapshot time comes from the record, not a constant.
            (
                server_vantage::O2_DBM_TIMESTAMP,
                Some(json!(1_786_600_000_000_000i64)),
            ),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **A record pulled off the LIVE rig, verbatim** — the negative control the
/// TDD skill requires for anything crossing a wire.
///
/// Two DBM bugs shipped green through 205 test functions because the fixtures
/// were shaped like the parser instead of like the collector. This one was
/// SELECTed out of the `dbm_server` stream while the recipe was running, so its
/// key set is the producer's, not ours.
///
/// It differs from the hand-built fixtures in a way that matters: the rig emits
/// NO `server_address`, so the instance is genuinely unknown. That must read as
/// absent rather than being invented from another field — a table attributed to
/// the wrong server is worse than one attributed to none.
fn pg_table_stats_live_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_504_457_051_326i64,
        "o2_recipe": "pg_table_stats",
        "o2_rig": "o2-dbm-capture",
        "o2_vantage": "server",
        "body": "demo_inventory",
        "schema_name": "public",
        "autovacuum_count": "0",
        "dead_tup_pct": "3.66",
        "deployment_environment_name": "dbm-demo",
        "dropped_attributes_count": 0,
        "frozen_xid_age": "346733",
        "heap_bytes": "32768",
        "idx_scan": "130769",
        "instrumentation_library_name":
            "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/sqlqueryreceiver",
        "n_dead_tup": "19",
        "n_live_tup": "500",
        "n_mod_since_analyze": "0",
        "seq_scan": "0",
        "seq_tup_read": "0",
        "severity": "0",
        "total_bytes": "98304",
    }))
}

#[cfg(feature = "enterprise")]
#[test]
fn live_captured_table_stats_record_canonicalizes() {
    assert_canonicalizes(
        // "The record the collector is emitting RIGHT NOW must canonicalize."
        "pg_table_stats (live rig, demo_inventory)",
        pg_table_stats_live_record(),
        &[
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_TABLE_STATS)),
            ),
            (
                server_vantage::O2_DBM_RELATION,
                Some(json!("demo_inventory")),
            ),
            (server_vantage::O2_DBM_SCHEMA, Some(json!("public"))),
            (server_vantage::O2_DBM_TOTAL_BYTES, Some(json!(98_304i64))),
            (
                server_vantage::O2_DBM_IDX_SCAN_COUNT,
                Some(json!(130_769i64)),
            ),
            // The live bloat figure is fractional.
            (server_vantage::O2_DBM_DEAD_TUP_PCT, Some(json!(3.66))),
            (server_vantage::O2_DBM_DEAD_TUPLES, Some(json!(19i64))),
            // The rig emits no server_address on this recipe, so the instance
            // is genuinely unknown and must stay that way rather than be
            // invented — attributing this table to a guessed server is worse
            // than attributing it to none.
            (server_vantage::O2_DBM_INSTANCE, None),
            // Never vacuumed, never analyzed — the recipe sent no such column
            // at all here, which reads the same as the empty string: absent.
            (server_vantage::O2_DBM_LAST_VACUUM, None),
            (server_vantage::O2_DBM_LAST_AUTOVACUUM, None),
            // And the disclosures ride on the row regardless of which columns
            // arrived.
            (
                server_vantage::O2_DBM_COUNTERS_ARE_CUMULATIVE,
                Some(json!(true)),
            ),
            (
                server_vantage::O2_DBM_TUPLES_ARE_ESTIMATED,
                Some(json!(true)),
            ),
        ],
    );
}

/// **The negative control: db_monitoring OFF must yield NOTHING.**
///
/// A silent-empty result is indistinguishable from an idle collector, so the
/// disabled path is pinned rather than assumed.
///
/// Asserted STRUCTURALLY rather than by toggling the knob. `ZO_DB_MONITORING_
/// ENABLED` is the master switch every other test in this file reads, and
/// flipping a process-global while the suite runs in parallel made nine
/// unrelated tests fail intermittently (measured — they passed only under
/// `--test-threads=1`). A test that is green only when run alone is not a
/// test. The per-knob mutexes above do not help: they serialize their own
/// knob against itself, not the master switch against everything.
///
/// So the guarantee is pinned where it is actually decided — `apply_to_record`
/// returns before any dispatch when the feature is off, which is the single
/// gate the table-stats arm inherits along with every other kind.
#[test]
fn table_stats_inherits_the_master_off_switch() {
    let src = include_str!("server_vantage.rs");
    let start = src
        .find("pub fn apply_to_record(")
        .expect("the ingest entry point must exist");
    let body = src[start..].split("\n}\n").next().expect("body");

    let guard = body
        .find("if !config::get_config().db_monitoring.enabled {")
        .expect("apply_to_record must gate on the master switch");
    let dispatch = body
        .find("canonicalize_record(")
        .expect("apply_to_record must dispatch");
    assert!(
        guard < dispatch,
        "the off-switch must return BEFORE dispatch, or a disabled deployment \
         still writes canonical columns"
    );
    assert!(
        body[guard..dispatch].contains("return;"),
        "the gate must return, not merely branch"
    );
}

// ─── W11 · Index health (`pg_index_stats`) ───────────────────────────────────
//
// Every fixture below is the VERBATIM wire shape measured off the live rig,
// flattened as logs ingest stores it. Two things differ from `pg_table_stats`
// and both are load-bearing:
//
//   • `index_name` and `table_name` are real ATTRIBUTES here, so the identity
//     is read from them directly rather than from `body`.
//   • `body` carries the index DEFINITION (`CREATE INDEX ...`), not a name.
//     Reading `body` as the identity — the table-stats convention — would file
//     every index under a DDL statement.
//
// Two fixtures, materially inverted in every numeric field: a never-scanned
// index and a heavily-used one. A single fixture would let a hard-coded lookup
// masquerade as a parser, which is how two stub attacks survived in W10.

/// A real never-scanned index — `idx_scan = 0` over 2.8 MB.
fn pg_index_stats_unused_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_505_777_063_921i64,
        "o2_recipe": "pg_index_stats",
        "o2_vantage": "server",
        "o2_rig": "o2-dbm-capture",
        // The DEFINITION, not the name — the identity lives in `index_name`.
        "body": "CREATE INDEX idx_orders_note_unused ON public.orders USING btree (\"left\"(note, 8))",
        "index_name": "idx_orders_note_unused",
        "table_name": "orders",
        "schema_name": "public",
        "idx_scan": "0",
        "idx_tup_read": "0",
        "idx_tup_fetch": "0",
        "index_bytes": "2859008",
        // Postgres renders a boolean ::text as "false"/"true".
        "is_unique": "false",
        "deployment_environment_name": "dbm-demo",
        "server_address": "pg-primary:5432",
    }))
}

#[cfg(feature = "enterprise")]
/// A real heavily-used index. Every numeric differs from the fixture above.
fn pg_index_stats_used_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_505_777_063_921i64,
        "o2_recipe": "pg_index_stats",
        "o2_vantage": "server",
        "o2_rig": "o2-dbm-capture",
        "body": "CREATE INDEX demo_orders_status_idx ON public.demo_orders USING btree (status)",
        "index_name": "demo_orders_status_idx",
        "table_name": "demo_orders",
        "schema_name": "public",
        "idx_scan": "44916",
        "idx_tup_read": "2937877460",
        "idx_tup_fetch": "2222646612",
        "index_bytes": "2301952",
        "is_unique": "false",
        "deployment_environment_name": "dbm-demo",
        "server_address": "pg-primary:5432",
    }))
}

#[cfg(feature = "enterprise")]
/// **Through `apply_to_record`, the production entry point.** B19 shipped
/// broken for weeks because tests called the internal function instead.
#[test]
fn index_stats_canonicalizes_through_the_ingest_entry_point() {
    let mut rec = pg_index_stats_unused_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND),
        Some(&json!(server_vantage::KIND_INDEX_STATS)),
        "a pg_index_stats record must canonicalize through the real ingest path: {rec:?}"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_INDEX_NAME),
        Some(&json!("idx_orders_note_unused")),
        "the index identity comes from `index_name`, never from the DDL in `body`"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_RELATION),
        Some(&json!("orders")),
        "the index must carry the table it belongs to"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SCHEMA),
        Some(&json!("public"))
    );
}

#[cfg(feature = "enterprise")]
/// The text columns parse into numbers, and a measured ZERO survives.
///
/// `idx_scan = 0` is the entire never-scanned signal. Dropped as falsy, the
/// W11 rule can never fire.
#[test]
fn index_stats_parses_text_columns_and_keeps_a_measured_zero() {
    let mut rec = pg_index_stats_unused_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_IDX_SCAN_COUNT),
        Some(&json!(0)),
        "a measured zero is the FINDING and must survive canonicalization"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_INDEX_BYTES),
        Some(&json!(2_859_008)),
        "sizes arrive as ::text and must parse to numbers"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_IDX_TUP_READ),
        Some(&json!(0))
    );
}

#[cfg(feature = "enterprise")]
/// The second fixture, inverted: a parser must track the record, not a lookup.
#[test]
fn index_stats_reads_a_used_index_from_its_own_row() {
    let mut rec = pg_index_stats_used_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_INDEX_NAME),
        Some(&json!("demo_orders_status_idx"))
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_RELATION),
        Some(&json!("demo_orders"))
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_IDX_SCAN_COUNT),
        Some(&json!(44916)),
        "a used index reports its own scan count"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_IDX_TUP_READ),
        Some(&json!(2_937_877_460i64)),
        "counters exceed i32 on real data and must not be truncated"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_INDEX_BYTES),
        Some(&json!(2_301_952))
    );
}

#[cfg(feature = "enterprise")]
/// A CONSTRAINT index must be marked as one.
///
/// Verified against the live rig: three of the six largest indexes there are
/// `*_pkey`, and `idx_scan = 0` on a primary key means only that the planner
/// has not chosen it for a LOOKUP — the constraint is still enforced on every
/// insert. Without this flag the unused-index rule cannot tell a redundant
/// index from a primary key, and recommends reviewing the latter.
#[test]
fn index_stats_marks_a_constraint_index_as_unique() {
    let mut unique = pg_index_stats_unused_record();
    unique.insert("index_name".into(), json!("order_lines_pkey"));
    unique.insert("is_unique".into(), json!("true"));
    server_vantage::apply_to_record(&mut unique);
    assert_eq!(
        unique.get(server_vantage::O2_DBM_INDEX_IS_UNIQUE),
        Some(&json!(true)),
        "a primary-key index must reach the wire flagged as a constraint: {unique:?}"
    );

    // ...and an ordinary index must NOT be flagged, or the rule excludes
    // everything and silently reports nothing.
    let mut ordinary = pg_index_stats_unused_record();
    server_vantage::apply_to_record(&mut ordinary);
    assert_eq!(
        ordinary.get(server_vantage::O2_DBM_INDEX_IS_UNIQUE),
        Some(&json!(false)),
        "an ordinary index must be flagged false, not left absent"
    );
}

#[cfg(feature = "enterprise")]
/// The counters are LIFETIME totals, and the row says so itself.
///
/// Without the disclosure the read surface cannot phrase "never scanned"
/// honestly — it would imply "never scanned in this window", which is a
/// strictly stronger claim than a cumulative counter supports.
#[test]
fn index_stats_marks_its_counters_as_lifetime_totals() {
    let mut rec = pg_index_stats_used_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_COUNTERS_ARE_CUMULATIVE),
        Some(&json!(true)),
        "index scan counters come from pg_stat_user_indexes and are cumulative \
         since the last stats reset; the row must disclose it"
    );
}

#[cfg(feature = "enterprise")]
/// The engine is stated by the RECIPE. `pg_index_stats` reads
/// `pg_stat_user_indexes`, which exists only on Postgres.
#[test]
fn index_stats_states_postgres_as_its_engine() {
    let mut rec = pg_index_stats_unused_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_ENGINE),
        Some(&json!("postgresql"))
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_DATABASE),
        None,
        "the recipe never names a database, and `schema_name` is NOT one"
    );
}

/// No index identity, no row. Inventing one fabricates an entry in the list.
#[test]
fn index_stats_without_an_index_name_is_dropped() {
    let mut rec = pg_index_stats_unused_record();
    rec.remove("index_name");
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND),
        None,
        "a row with no index name must not canonicalize: {rec:?}"
    );
}

// ─── WP2 · MySQL / MariaDB table & index health twins ────────────────────────
//
// The MySQL and MariaDB recipes emit the SAME aliased columns as Postgres's
// (the `mariadb_lock_waits` precedent: no engine-conditional canonicalizer
// branch — the recipe TAG is what names the engine, via `detect_engine`). What
// differs per engine is which columns EXIST at all: MySQL/MariaDB have no
// dead-tuple, vacuum or xid state, and MariaDB ships with performance_schema
// OFF so its index rows carry no `idx_scan`. Absent must STAY absent — a
// fabricated zero would read as a finding (a never-scanned index, a
// never-vacuumed table) that was never measured.
//
// Every fixture below is the VERBATIM wire shape captured off the live
// dbm-server-vantage rig on 2026-08-13 (MySQL 8.4 / MariaDB 11.8, contrib
// 0.158.0) — `tests/dbm-server-vantage/captures/{mysql,mariadb}-{table,index}-
// stats.jsonl`, flattened as logs ingest stores it. That rig pass was the
// release gate the plan flags for these recipes; the previously recipe-shaped
// fixtures here are replaced by the measured rows. Note `server_address`
// carries NO port: the shipped recipes stamp the bare `{host}`.

/// One real `mysql_table_stats` row (`orders`, mysql-table-stats.jsonl).
fn mysql_table_stats_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_000_000_000i64,
        "o2_recipe": "mysql_table_stats",
        "o2_vantage": "server",
        "o2_rig": "dbm-server-vantage",
        "deployment_environment_name": "dbm-sv",
        // The TABLE NAME, in `body` — it is the recipe's body_column.
        "body": "orders",
        "schema_name": "dbmlab",
        "total_bytes": "12107776",
        "heap_bytes": "8929280",
        "n_live_tup": "39546",
        "last_analyze": "2026-08-13 02:24:46",
        "server_address": "mysql",
    }))
}

/// The MariaDB twin — same aliases, its own tag. This is the rig's
/// `STATS_PERSISTENT=0` table (mariadb-table-stats.jsonl): no
/// `innodb_table_stats` row exists, so `last_analyze` arrives as the empty
/// string and `n_live_tup` is the `TABLE_ROWS` fallback.
fn mariadb_table_stats_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_060_000_000i64,
        "o2_recipe": "mariadb_table_stats",
        "o2_vantage": "server",
        "o2_rig": "dbm-server-vantage",
        "deployment_environment_name": "dbm-sv",
        "body": "session_scratch",
        "schema_name": "dbmlab",
        "total_bytes": "16384",
        "heap_bytes": "16384",
        "n_live_tup": "3",
        // Stats never recalculated — arrives as the empty string, reads as
        // absent, exactly like a never-analyzed Postgres table.
        "last_analyze": "",
        "server_address": "mariadb",
    }))
}

/// One real `mysql_index_stats` row: a scanned secondary index
/// (mysql-index-stats.jsonl). `body` carries the GROUP_CONCAT-built DDL,
/// `index_name` the identity — the same split the PG recipe established.
fn mysql_index_stats_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_000_000_000i64,
        "o2_recipe": "mysql_index_stats",
        "o2_vantage": "server",
        "o2_rig": "dbm-server-vantage",
        "deployment_environment_name": "dbm-sv",
        "body": "INDEX idx_orders_acct_sku ON dbmlab.orders (account_id, sku)",
        "index_name": "idx_orders_acct_sku",
        "table_name": "orders",
        "schema_name": "dbmlab",
        "idx_scan": "800",
        "index_bytes": "1589248",
        "is_unique": "false",
        "server_address": "mysql",
    }))
}

#[cfg(feature = "enterprise")]
/// A never-scanned MySQL index — the rig's `orders` PRIMARY KEY, verbatim.
/// `idx_scan: "0"` here is a MEASURED zero from performance_schema.
fn mysql_index_stats_unused_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_000_000_000i64,
        "o2_recipe": "mysql_index_stats",
        "o2_vantage": "server",
        "o2_rig": "dbm-server-vantage",
        "deployment_environment_name": "dbm-sv",
        "body": "INDEX PRIMARY ON dbmlab.orders (id)",
        "index_name": "PRIMARY",
        "table_name": "orders",
        "schema_name": "dbmlab",
        "idx_scan": "0",
        "index_bytes": "8929280",
        "is_unique": "true",
        "server_address": "mysql",
    }))
}

#[cfg(feature = "enterprise")]
/// A FUNCTIONAL index (`(LOWER(customer_ref))`), verbatim from the rig — the
/// row that exposed the recipe bug: an expression key part has NULL
/// `COLUMN_NAME`, which nulled GROUP_CONCAT and then the whole `index_def`
/// (the body_column). The shipped fix COALESCEs to `(EXPRESSION)`, and this
/// is what the fixed recipe emits.
fn mysql_index_stats_functional_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_000_000_000i64,
        "o2_recipe": "mysql_index_stats",
        "o2_vantage": "server",
        "o2_rig": "dbm-server-vantage",
        "deployment_environment_name": "dbm-sv",
        "body": "INDEX idx_orders_lower_ref ON dbmlab.orders ((lower(`customer_ref`)))",
        "index_name": "idx_orders_lower_ref",
        "table_name": "orders",
        "schema_name": "dbmlab",
        "idx_scan": "41",
        "index_bytes": "1589248",
        "is_unique": "false",
        "server_address": "mysql",
    }))
}

/// The MariaDB index twin (mariadb-index-stats.jsonl). NO `idx_scan` key at
/// all: MariaDB ships with performance_schema OFF, so the recipe deliberately
/// omits the usage join rather than selecting a zero it never measured.
fn mariadb_index_stats_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_500_060_000_000i64,
        "o2_recipe": "mariadb_index_stats",
        "o2_vantage": "server",
        "o2_rig": "dbm-server-vantage",
        "deployment_environment_name": "dbm-sv",
        "body": "INDEX PRIMARY ON dbmlab.accounts (id)",
        "index_name": "PRIMARY",
        "table_name": "accounts",
        "schema_name": "dbmlab",
        "index_bytes": "16384",
        "is_unique": "true",
        "server_address": "mariadb",
    }))
}

#[cfg(feature = "enterprise")]
/// **Through `apply_to_record`, the production entry point** — the same B19
/// discipline every fixture in this file follows.
#[test]
fn mysql_table_stats_canonicalizes_as_mysql() {
    assert_canonicalizes(
        "mysql_table_stats (orders)",
        mysql_table_stats_record(),
        &[
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_TABLE_STATS)),
            ),
            // The table name arrives in `body`, exactly as the PG recipe's
            // does.
            (server_vantage::O2_DBM_RELATION, Some(json!("orders"))),
            (server_vantage::O2_DBM_SCHEMA, Some(json!("dbmlab"))),
            // The tag names the engine — stamped postgresql, every MySQL table
            // would file under the wrong engine on the fleet view.
            (server_vantage::O2_DBM_ENGINE, Some(json!("mysql"))),
            // The shipped recipe stamps the bare {host} — nothing to
            // port-strip, and the value must survive unmangled.
            (server_vantage::O2_DBM_INSTANCE, Some(json!("mysql"))),
            (
                server_vantage::O2_DBM_TOTAL_BYTES,
                Some(json!(12_107_776i64)),
            ),
            (server_vantage::O2_DBM_HEAP_BYTES, Some(json!(8_929_280i64))),
            (server_vantage::O2_DBM_LIVE_TUPLES, Some(json!(39_546i64))),
            // innodb_table_stats.last_update rides the last_analyze alias.
            (
                server_vantage::O2_DBM_LAST_ANALYZE,
                Some(json!("2026-08-13 02:24:46")),
            ),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **The Postgres-only columns are ABSENT, never zero.** MySQL reports no
/// dead-tuple, vacuum or xid state; a zero would claim "0% bloat, wraparound
/// age 0" about measurements that never happened.
#[test]
fn mysql_table_stats_leaves_postgres_only_columns_absent() {
    assert_canonicalizes(
        "mysql_table_stats (pg-only columns have no MySQL source and must stay absent, not zero)",
        mysql_table_stats_record(),
        &[
            (server_vantage::O2_DBM_DEAD_TUPLES, None),
            (server_vantage::O2_DBM_DEAD_TUP_PCT, None),
            (server_vantage::O2_DBM_MOD_SINCE_ANALYZE, None),
            (server_vantage::O2_DBM_SEQ_SCAN_COUNT, None),
            (server_vantage::O2_DBM_SEQ_TUP_READ, None),
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, None),
            (server_vantage::O2_DBM_AUTOVACUUM_COUNT, None),
            (server_vantage::O2_DBM_FROZEN_XID_AGE, None),
            (server_vantage::O2_DBM_LAST_VACUUM, None),
            (server_vantage::O2_DBM_LAST_AUTOVACUUM, None),
            // The honesty disclosures still ride on every row: MySQL's
            // TABLE_ROWS / innodb_table_stats.n_rows are estimates too, and
            // its counters (where an engine has any) are lifetime totals.
            (
                server_vantage::O2_DBM_COUNTERS_ARE_CUMULATIVE,
                Some(json!(true)),
            ),
            (
                server_vantage::O2_DBM_TUPLES_ARE_ESTIMATED,
                Some(json!(true)),
            ),
        ],
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn mariadb_table_stats_canonicalizes_as_mariadb() {
    assert_canonicalizes(
        "mariadb_table_stats (session_scratch)",
        mariadb_table_stats_record(),
        &[
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_TABLE_STATS)),
            ),
            // The mariadb_ tag must not file under mysql — the ?system= filter
            // and the fleet view both key on the engine.
            (server_vantage::O2_DBM_ENGINE, Some(json!("mariadb"))),
            (
                server_vantage::O2_DBM_RELATION,
                Some(json!("session_scratch")),
            ),
            (server_vantage::O2_DBM_SCHEMA, Some(json!("dbmlab"))),
            (server_vantage::O2_DBM_INSTANCE, Some(json!("mariadb"))),
            // A STATS_PERSISTENT=0 table has no innodb_table_stats row — `""`
            // is 'never', exactly as the PG recipe's empty timestamp reads.
            (server_vantage::O2_DBM_LAST_ANALYZE, None),
            // With no persistent stats, n_live_tup is the TABLE_ROWS fallback
            // — measured live on the rig.
            (server_vantage::O2_DBM_LIVE_TUPLES, Some(json!(3i64))),
        ],
    );
}

#[cfg(feature = "enterprise")]
#[test]
fn mysql_index_stats_canonicalizes_as_mysql() {
    assert_canonicalizes(
        "mysql_index_stats (idx_orders_acct_sku)",
        mysql_index_stats_record(),
        &[
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_INDEX_STATS)),
            ),
            (server_vantage::O2_DBM_ENGINE, Some(json!("mysql"))),
            // The identity comes from `index_name`, never from the DDL in
            // `body`.
            (
                server_vantage::O2_DBM_INDEX_NAME,
                Some(json!("idx_orders_acct_sku")),
            ),
            (server_vantage::O2_DBM_RELATION, Some(json!("orders"))),
            // performance_schema COUNT_READ rides the idx_scan alias — 800
            // measured reads through the index on the rig.
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, Some(json!(800))),
            (
                server_vantage::O2_DBM_INDEX_BYTES,
                Some(json!(1_589_248i64)),
            ),
            // The recipe renders MIN(NON_UNIQUE)=0 as 'true'/'false' strings,
            // and the string parse must land as a boolean.
            (server_vantage::O2_DBM_INDEX_IS_UNIQUE, Some(json!(false))),
            // table_io_waits counters are lifetime totals, same disclosure as
            // PG.
            (
                server_vantage::O2_DBM_COUNTERS_ARE_CUMULATIVE,
                Some(json!(true)),
            ),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **A measured zero survives as the never-scanned FINDING.** The rig's
/// `orders` PRIMARY KEY, verbatim: performance_schema reported COUNT_READ=0,
/// which is a measurement, not an absence.
#[test]
fn mysql_index_stats_keeps_a_measured_zero_idx_scan() {
    assert_canonicalizes(
        "mysql_index_stats (unused PRIMARY)",
        mysql_index_stats_unused_record(),
        &[
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_INDEX_STATS)),
            ),
            // A measured zero from performance_schema is the never-scanned
            // FINDING and must survive.
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, Some(json!(0))),
            // A PRIMARY KEY reaches the wire flagged as a constraint.
            (server_vantage::O2_DBM_INDEX_IS_UNIQUE, Some(json!(true))),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **The functional-index row canonicalizes with its definition intact** —
/// the regression the rig pass caught: an expression key part has NULL
/// `COLUMN_NAME` in `information_schema.STATISTICS`, which nulled
/// GROUP_CONCAT and then the entire `index_def` (the recipe's body_column).
/// The shipped COALESCE-to-`(EXPRESSION)` fix makes this row possible; this
/// fixture is the fixed recipe's verbatim output.
#[test]
fn mysql_index_stats_functional_index_keeps_its_identity_and_definition() {
    let raw = mysql_index_stats_functional_record();
    assert!(
        raw.get("body")
            .and_then(Value::as_str)
            .is_some_and(|b| b.contains("(lower(`customer_ref`))")),
        "the capture must carry the expression where columns would be — an \
         empty body here means the recipe regressed to the NULL index_def bug"
    );

    assert_canonicalizes(
        "mysql_index_stats (functional idx_orders_lower_ref)",
        raw,
        &[
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_INDEX_STATS)),
            ),
            // The identity is the index name, not the expression DDL in body.
            (
                server_vantage::O2_DBM_INDEX_NAME,
                Some(json!("idx_orders_lower_ref")),
            ),
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, Some(json!(41))),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **The MariaDB shape's missing `idx_scan` stays missing.** performance_schema
/// is OFF by default on MariaDB, so the recipe omits the usage join entirely —
/// and a zero invented here would BE the never-scanned finding, fabricated for
/// every index on every MariaDB server.
#[test]
fn mariadb_index_stats_leaves_absent_idx_scan_absent() {
    assert_canonicalizes(
        "mariadb_index_stats (accounts PRIMARY)",
        mariadb_index_stats_record(),
        &[
            // The row must still canonicalize — size and definition are worth
            // collecting without the usage counter.
            (
                server_vantage::O2_DBM_KIND,
                Some(json!(server_vantage::KIND_INDEX_STATS)),
            ),
            (server_vantage::O2_DBM_ENGINE, Some(json!("mariadb"))),
            // No idx_scan was measured; absent is honestly unknown, zero is
            // the never-scanned finding fabricated.
            (server_vantage::O2_DBM_IDX_SCAN_COUNT, None),
            (server_vantage::O2_DBM_INDEX_BYTES, Some(json!(16_384i64))),
            // A PRIMARY KEY must reach the wire flagged as a constraint, or
            // the unused-index rule recommends reviewing it.
            (server_vantage::O2_DBM_INDEX_IS_UNIQUE, Some(json!(true))),
        ],
    );
}

#[cfg(feature = "enterprise")]
/// **The other kinds must not regress** — the widened `||` chains sit beside
/// five existing dispatch arms, and the cheapest way to break them is a tag
/// that overlaps. Same pattern as `adding_table_stats_leaves_the_other_
/// recipes_dispatching`.
#[test]
fn adding_the_engine_twins_leaves_the_others_dispatching() {
    // Deadlocks and blocking are enterprise-owned; on OSS the coexistence
    // property is that they stay OUT of the arms under test, which is `None`.
    #[cfg(feature = "enterprise")]
    {
        let dl = canonicalize_record(&pg_deadlock_record()).expect("pg deadlock still dispatches");
        assert_eq!(dl.get("o2_dbm_kind").unwrap(), &json!("deadlock"));

        let bl = canonicalize_record(&pg_blocking_record()).expect("blocking still dispatches");
        assert_eq!(bl.get("o2_dbm_kind").unwrap(), &json!("blocking"));
    }
    #[cfg(not(feature = "enterprise"))]
    {
        assert!(canonicalize_record(&pg_deadlock_record()).is_none());
        assert!(canonicalize_record(&pg_blocking_record()).is_none());
    }

    let pg_tbl =
        canonicalize_record(&pg_table_stats_record()).expect("pg table stats still dispatches");
    assert_eq!(pg_tbl.get("o2_dbm_kind").unwrap(), &json!("table_stats"));
    assert_eq!(pg_tbl.get("o2_dbm_engine").unwrap(), &json!("postgresql"));

    let pg_idx = canonicalize_record(&pg_index_stats_unused_record())
        .expect("pg index stats still dispatches");
    assert_eq!(pg_idx.get("o2_dbm_kind").unwrap(), &json!("index_stats"));
    assert_eq!(pg_idx.get("o2_dbm_engine").unwrap(), &json!("postgresql"));

    // An engine still without a recipe stays unconsumed rather than falling
    // into a widened arm.
    let unknown = obj(json!({"o2_recipe": "oracle_table_stats", "body": "orders"}));
    assert!(canonicalize_record(&unknown).is_none());
}

// ─── W8 · An unrecognized recipe must not vanish without trace ───────────────
//
// The defect: a user writes a custom `sqlquery` recipe, tags it
// `o2_recipe: "my_custom_thing"`, and ships it. `apply_to_record` strips every
// `ALL_DBM_FIELDS` member (correctly — see
// `apply_to_record_strips_the_event_name_it_cannot_authenticate`), then
// `canonicalize_record` finds no arm for the tag and returns `None`. The row
// lands in `dbm_server` carrying its raw recipe columns and NO `o2_dbm_*`, so
// every read endpoint — which projects `ALL_DBM_FIELDS` and gates on
// `present_dbm_columns` — cannot see it. Nothing logged, nothing counted.
//
// Worse than silence: the liveness probe counts a row with no `o2_dbm_kind` as
// `non_event_records`, which the UI renders as "the tail is running, it parsed
// N lines, none was a deadlock". The read path gives an affirmative WRONG
// answer, so the author's recipe reads as a healthy quiet database.
//
// These tests pin the write-side signal that turns that silence into a report.
// They all go through `apply_to_record`, the production entry point — a test
// calling `canonicalize_record` directly would pass against the broken
// behaviour, which is exactly the gap that hid B19 for weeks.

/// A custom `sqlquery` recipe, shaped like a real one a user would write:
/// engine-agnostic aliased columns, a `server_address`, and a tag we do not
/// know. Materially different from the three fixtures below.
fn custom_recipe_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_800_000_000i64,
        "o2_recipe": "my_custom_thing",
        "replica_lag_s": "12.4",
        "replica_name": "reader-3",
        "server_address": "10.0.0.9:5432",
    }))
}

/// A DIFFERENT custom recipe: different tag, different columns, different
/// engine flavour. Three materially different fixtures, so a hard-coded lookup
/// on any one tag is distinguishable from a real classifier.
fn custom_vacuum_recipe_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_801_000_000i64,
        "o2_recipe": "acme_vacuum_watch",
        "relname": "orders",
        "n_dead_tup": "4001",
    }))
}

/// A third, tagged for an engine DBM has no recipes for at all.
fn custom_oracle_recipe_record() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_165_802_000_000i64,
        "o2_recipe": "oracle_sessions",
        "sid": "882",
        "ora_user": "APPS",
        "event": "db file sequential read",
    }))
}

/// The heart of W8: an unrecognized tag must be REPORTED, not swallowed.
#[test]
fn w8_reports_an_unrecognized_recipe_tag() {
    let mut rec = custom_recipe_record();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        server_vantage::take_unrecognized_recipe(&rec),
        Some("my_custom_thing".to_string()),
        "a recipe tag matching no dispatch arm must be reported, not silently \
         dropped; the author's only other signal is an empty page: {rec:?}"
    );
}

/// Three materially different tags, so the reporter is a classifier and not a
/// hard-coded lookup for one fixture's tag.
#[test]
fn w8_reports_every_unrecognized_tag_by_its_own_name() {
    for (mut rec, expected) in [
        (custom_recipe_record(), "my_custom_thing"),
        (custom_vacuum_recipe_record(), "acme_vacuum_watch"),
        (custom_oracle_recipe_record(), "oracle_sessions"),
    ] {
        server_vantage::apply_to_record(&mut rec);
        assert_eq!(
            server_vantage::take_unrecognized_recipe(&rec),
            Some(expected.to_string()),
            "the report must name the tag that was not recognized"
        );
    }
}

/// A record with NO recipe tag at all — the overwhelmingly common case, since
/// `apply_to_record` runs on every log record in every stream. Reporting these
/// would drown the signal in the entire product's log volume.
#[test]
fn w8_never_reports_a_record_with_no_recipe_tag() {
    for mut rec in [
        obj(json!({ "_timestamp": 1_786_165_803_000_000i64, "message": "ordinary app log" })),
        // A filelog deadlock record: canonicalizes fine, and via `o2_pg_event`
        // rather than a recipe tag.
        pg_deadlock_record(),
    ] {
        server_vantage::apply_to_record(&mut rec);
        assert_eq!(
            server_vantage::take_unrecognized_recipe(&rec),
            None,
            "a record carrying no o2_recipe must produce no report: {rec:?}"
        );
    }
}

/// An empty tag is not a tag. `o2_recipe: ""` is what a broken recipe template
/// renders, and naming the empty string in a warning helps nobody.
#[test]
fn w8_never_reports_an_empty_recipe_tag() {
    let mut rec = custom_recipe_record();
    rec.insert("o2_recipe".to_string(), json!(""));
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        server_vantage::take_unrecognized_recipe(&rec),
        None,
        "an empty recipe tag names nothing and must not be reported"
    );
}

/// A recognized tag whose ROW is unusable is NOT an unrecognized recipe. The
/// tag dispatched correctly and the parser rejected the row on its merits —
/// reporting it as "I could not read your recipe" would send the author to fix
/// a recipe that is in fact correctly tagged.
#[test]
fn w8_never_reports_a_recognized_tag_that_failed_to_parse() {
    let mut rec = pg_blocking_record();
    // The recipe is right; this particular row has no blocked pid, so
    // `canonicalize_blocking` returns None.
    rec.remove("blocked_pid");
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND),
        None,
        "precondition: this row must fail to canonicalize"
    );
    assert_eq!(
        server_vantage::take_unrecognized_recipe(&rec),
        None,
        "the tag WAS recognized; the row failed on its own merits, and \
         conflating the two misdirects the author"
    );
}

/// `RECOGNIZED_RECIPES` and the dispatch arms must name the SAME tags.
///
/// They are two lists of strings that must agree, which is the classic drift
/// shape. A recipe added to dispatch but not to the array would be reported to
/// its author as unrecognized while working perfectly — a worse lie than the
/// silence W8 fixes. This asserts against the SOURCE of `canonicalize_record`,
/// so adding an arm without the array fails here.
#[test]
fn w8_recognized_recipes_match_the_dispatch_arms() {
    let src = include_str!("server_vantage.rs");
    let body = {
        let start = src
            .find("pub fn canonicalize_record")
            .expect("canonicalize_record must exist");
        let end = src[start..]
            .find("\n// ─── W3")
            .expect("canonicalize_record must be followed by the W3 section");
        &src[start..start + end]
    };

    // Every tag the dispatch body compares against must be in the array.
    for tag in server_vantage::RECOGNIZED_RECIPES {
        assert!(
            body.contains(&format!("\"{tag}\"")),
            "RECOGNIZED_RECIPES names {tag:?} but no dispatch arm matches it, \
             so a record carrying that tag is silently dropped while the \
             classifier calls it recognized"
        );
    }

    // And every quoted recipe-looking literal the body dispatches on must be in
    // the array. Collected from the source rather than restated, so a NEW arm
    // that nobody added to the array fails this.
    for line in body.lines() {
        let Some(rest) = line.split_once("recipe ==").map(|(_, r)| r) else {
            continue;
        };
        let tag = rest
            .trim()
            .trim_start_matches('"')
            .split('"')
            .next()
            .unwrap_or("");
        assert!(
            server_vantage::RECOGNIZED_RECIPES.contains(&tag),
            "canonicalize_record dispatches on recipe {tag:?} but \
             RECOGNIZED_RECIPES omits it, so its author would be warned that a \
             working recipe is unrecognized"
        );
    }
}

/// The reporter must be a CLASSIFIER, not a list of tags we thought of.
///
/// A hard-coded lookup of the fixture tags above passes every other W8 test —
/// measured: the rung-1 stub attack survived 7/7. The whole point of W8 is the
/// tag nobody enumerated, so this generates tags no implementation could have
/// baked in, and asserts each is reported BY NAME.
#[test]
fn w8_reports_a_tag_no_implementation_could_have_enumerated() {
    // Derived at runtime, so they cannot appear as literals in the source.
    for n in 0..16 {
        let tag = format!("recipe_{}_{}", n * 7919, "zx".repeat(n % 3 + 1));
        assert!(
            !server_vantage::RECOGNIZED_RECIPES.contains(&tag.as_str()),
            "precondition: {tag} must not be a shipped recipe"
        );

        let mut rec = custom_recipe_record();
        rec.insert("o2_recipe".to_string(), json!(tag.clone()));
        server_vantage::apply_to_record(&mut rec);

        assert_eq!(
            server_vantage::take_unrecognized_recipe(&rec),
            Some(tag.clone()),
            "an arbitrary unrecognized tag must be reported by its own name; a \
             lookup table of tags we happened to think of leaves every real \
             custom recipe silent, which IS the W8 defect"
        );
    }
}

/// The complement: recognition must be driven by `RECOGNIZED_RECIPES`, so every
/// member is silent — including ones added after this test was written — and
/// every shipped recipe's REALISTIC row is silent too. A signal that fires on
/// the recipes we do handle is noise, and would fire on every row of the
/// reference rig.
#[test]
fn w8_every_member_of_the_recognized_array_is_silent() {
    // Array-driven, so a recipe added later is covered automatically.
    for tag in server_vantage::RECOGNIZED_RECIPES {
        let mut rec = custom_recipe_record();
        rec.insert("o2_recipe".to_string(), json!(tag));
        server_vantage::apply_to_record(&mut rec);

        assert_eq!(
            server_vantage::take_unrecognized_recipe(&rec),
            None,
            "{tag} is a shipped recipe and must never be reported as unrecognized"
        );
    }

    // And over each shipped recipe's realistic fixture. The four blocking
    // recipes share the aliased-column shape by construction, so the tag is
    // the only thing that varies — which is precisely the input this
    // classifier reads.
    let tagged_blocking = |tag: &str| {
        let mut r = pg_blocking_record();
        r.insert("o2_recipe".into(), json!(tag));
        r
    };
    for (name, mut rec) in [
        ("pg_blocking_chain", pg_blocking_record()),
        ("mysql_lock_waits", tagged_blocking("mysql_lock_waits")),
        ("mariadb_lock_waits", tagged_blocking("mariadb_lock_waits")),
        (
            "mssql_blocking_chain",
            tagged_blocking("mssql_blocking_chain"),
        ),
        (
            "mssql_deadlock",
            mssql_deadlock_row("93", "1", "UPDATE accounts SET balance = 1 WHERE id = 31"),
        ),
        ("pg_table_stats", pg_table_stats_record()),
        ("pg_index_stats", pg_index_stats_unused_record()),
        ("mysql_table_stats", mysql_table_stats_record()),
        ("mysql_index_stats", mysql_index_stats_record()),
        ("mariadb_table_stats", mariadb_table_stats_record()),
        ("mariadb_index_stats", mariadb_index_stats_record()),
    ] {
        server_vantage::apply_to_record(&mut rec);
        assert_eq!(
            server_vantage::take_unrecognized_recipe(&rec),
            None,
            "shipped recipe {name} is recognized and must not be reported"
        );
    }
}

// ─── W8 · the cardinality bound ──────────────────────────────────────────────
//
// `o2_recipe` is author-controlled and unbounded, and the warn-once set is
// reachable from anyone who can POST a log record. The bound is what stops that
// being a memory-growth vector, so it is pinned here rather than trusted.

use super::server_vantage::{WarnDecision, decide_warn};

fn seen_set(tags: &[&str]) -> std::collections::HashSet<String> {
    tags.iter().map(|s| s.to_string()).collect()
}

/// A tag never seen before, with budget to spare, is named.
#[test]
fn w8_a_fresh_tag_is_named() {
    assert_eq!(
        decide_warn(&seen_set(&[]), "my_custom_thing"),
        WarnDecision::NameIt
    );
}

/// The SAME tag twice warns once. A recipe polling at 200 rows/second must not
/// log 200 times a second.
#[test]
fn w8_a_tag_already_warned_about_stays_silent() {
    assert_eq!(
        decide_warn(&seen_set(&["my_custom_thing"]), "my_custom_thing"),
        WarnDecision::Silent
    );
}

/// THE BOUND. Once the budget is spent, a brand-new tag must NOT be named —
/// naming it is what would grow the set without limit.
#[test]
fn w8_the_warned_set_never_grows_past_its_budget() {
    let full: Vec<String> = (0..32).map(|i| format!("tag_{i}")).collect();
    let seen: std::collections::HashSet<String> = full.into_iter().collect();
    assert_eq!(seen.len(), 32, "precondition: the budget is exactly spent");

    assert_eq!(
        decide_warn(&seen, "attacker_chosen_tag_33"),
        WarnDecision::GenericOnce,
        "past the budget a novel tag must degrade to the generic warning, or \
         an unbounded caller-chosen key set grows without limit"
    );
}

/// And the generic warning itself fires ONCE, not once per subsequent tag.
#[test]
fn w8_the_generic_budget_warning_fires_only_once() {
    let mut seen: std::collections::HashSet<String> = (0..32).map(|i| format!("tag_{i}")).collect();
    // First over-budget tag takes the generic branch and records the sentinel.
    assert_eq!(decide_warn(&seen, "novel_a"), WarnDecision::GenericOnce);
    seen.insert(String::new());

    for tag in ["novel_b", "novel_c", "novel_d"] {
        assert_eq!(
            decide_warn(&seen, tag),
            WarnDecision::Silent,
            "the generic budget warning must not repeat per tag"
        );
    }
    assert_eq!(
        seen.len(),
        33,
        "the set must hold the 32 named tags plus one sentinel, and never grow again"
    );
}

/// Just UNDER the budget is still named — the bound must not be off by one and
/// silence a deployment with a legitimate handful of custom recipes.
#[test]
fn w8_a_tag_just_under_the_budget_is_still_named() {
    let seen: std::collections::HashSet<String> = (0..31).map(|i| format!("tag_{i}")).collect();
    assert_eq!(
        decide_warn(&seen, "the_thirty_second"),
        WarnDecision::NameIt,
        "the budget is 32 distinct tags; the 32nd must still be named"
    );
}

// ═══ W-E1/W-E3 · auto_explain — real executed plans ══════════════════════════
//
// Every string below is VERBATIM rig capture (`corpus/auto_explain_rig.json`,
// captured 2026-08-13: postgres:16.14, contrib collector v0.158.0, auto_explain
// lab profile). The T1 tests pin the two load-bearing measurements the whole
// package stands on — wrapper-hash behavior and the fingerprint join — so a
// normalizer or walker change that silently breaks either fails HERE, loudly,
// against real data.

fn ae_fixture() -> Value {
    serde_json::from_str(include_str!("corpus/auto_explain_rig.json"))
        .expect("corpus/auto_explain_rig.json parses")
}

fn ae_str<'a>(fx: &'a Value, path: &[&str]) -> &'a str {
    let mut v = fx;
    for p in path {
        v = &v[*p];
    }
    v.as_str()
        .unwrap_or_else(|| panic!("fixture path {path:?} is a string"))
}

fn pg_fp(text: &str) -> Option<String> {
    fingerprint_statement(text, Some("postgresql")).1
}

/// **T1 measurement (a), first half: the wrapper IS part of the hash.**
///
/// The design doc hoped `walk_plan_structure` would hash auto_explain's
/// object-wrapped `{"Query Text":…, "Plan":{…}}` identically to the receiver's
/// array-wrapped `[{"Plan":{…}}]` and demanded proof. Measured: it does NOT —
/// the walker emits `[`/`]` delimiters, so the two wrappers of the SAME
/// Seq Scan structure hash differently. This test pins the measured divergence
/// so nobody "simplifies" `canonicalize_pg_auto_explain` back to hashing the
/// raw document — that would silently split every logical plan into two hashes.
#[test]
fn t1_wrapper_shape_is_part_of_plan_hash() {
    let fx = ae_fixture();
    let ae_doc = ae_str(&fx, &["auto_explain", "literal", "doc"]);
    let rx_plan = ae_str(&fx, &["receiver_top_query", "literal", "plan"]);

    let h_ae = server_vantage::plan_hash(ae_doc).expect("the auto_explain document hashes");
    let h_rx = server_vantage::plan_hash(rx_plan).expect("the receiver plan hashes");
    assert_ne!(
        h_ae, h_rx,
        "measured divergence: if these ever hash equal, the walker's shape \
         semantics changed and the rewrap below may be redundant — re-run T1"
    );
}

/// **T1 measurement (a), second half: the contingency closes the gap.**
///
/// Rewrapping the auto_explain `Plan` subtree into the receiver's array shape
/// reproduces the receiver's hash EXACTLY — for the flat Seq Scan pair (both
/// sides verbatim rig captures of the same statement) and for a 17-node nested
/// tree. This is the property `canonicalize_pg_auto_explain` builds on: one
/// wrapper shape on disk, hashes comparable across producers by construction.
#[test]
fn t1_rewrapped_auto_explain_doc_hashes_identically_to_the_receiver_plan() {
    let fx = ae_fixture();
    let ae_doc: Value =
        serde_json::from_str(ae_str(&fx, &["auto_explain", "literal", "doc"])).unwrap();
    let rx_plan = ae_str(&fx, &["receiver_top_query", "literal", "plan"]);

    let rewrapped = server_vantage::rewrap_auto_explain_plan(&ae_doc)
        .expect("a real auto_explain document rewraps");
    assert_eq!(
        server_vantage::plan_hash(&rewrapped),
        server_vantage::plan_hash(rx_plan),
        "the rewrapped executed plan must hash identically to the receiver's \
         generic plan of the same structure — this equality is the entire \
         plan-comparison story"
    );

    // The nested case: a deep tree must survive the rewrap with its structure
    // (and its hash-relevant fields) intact.
    let nested: Value = serde_json::from_str(ae_str(&fx, &["auto_explain_nested", "doc"])).unwrap();
    let nested_rw = server_vantage::rewrap_auto_explain_plan(&nested)
        .expect("the 17-node nested document rewraps");
    let h1 = server_vantage::plan_hash(&nested_rw).expect("nested rewrapped doc hashes");
    let h2 = server_vantage::plan_hash(&nested_rw).unwrap();
    assert_eq!(h1, h2, "the hash is stable");

    // Documents with no Plan subtree must refuse rather than mint a hash.
    assert_eq!(
        server_vantage::rewrap_auto_explain_plan(&json!({"Query Text": "SELECT 1"})),
        None,
        "no Plan subtree ⇒ no rewrap, never a fabricated document"
    );
}

/// **T1 measurement (b): the fingerprint join holds, proven on captured text.**
///
/// The same logical statement seen four ways — auto_explain's raw literal text
/// (simple protocol, trailing `;`), auto_explain's `$1` text (extended
/// protocol, trailing space), `pg_stat_statements`' jumbled `$1` text, and the
/// receiver's re-spaced obfuscated `?` text — lands on ONE fingerprint. This
/// is the join that puts an executed plan on the right query detail page.
#[test]
fn t1_auto_explain_raw_text_and_pgss_text_share_one_fingerprint() {
    let fx = ae_fixture();
    let literal = pg_fp(ae_str(&fx, &["auto_explain", "literal", "query_text"]));
    assert!(literal.is_some(), "the captured literal text fingerprints");
    for (side, path) in [
        (
            "auto_explain $1 bind",
            ["auto_explain", "bind", "query_text"],
        ),
        (
            "pg_stat_statements",
            ["pg_stat_statements", "literal_and_bind", ""],
        ),
        (
            "receiver obfuscated",
            ["receiver_top_query", "literal", "db_query_text"],
        ),
    ] {
        let p: Vec<&str> = path.iter().copied().filter(|s| !s.is_empty()).collect();
        assert_eq!(
            pg_fp(ae_str(&fx, &p)),
            literal,
            "{side} must fingerprint identically to the raw literal text"
        );
    }
}

/// **T1 measurement (b), IN-lists: arity and style collapse to one group.**
///
/// `IN (1,2,3,4,5)`, `IN ($1..$5)`, the receiver's `IN ( ? )` and a 700-literal
/// list against pgss's `IN ($1..$700)` all fold to one `(?)` group and ONE
/// fingerprint. Without this collapse every arity would be its own fingerprint
/// and the join would silently fail for the most common query shape there is.
#[test]
fn t1_in_list_arity_and_style_collapse_to_one_fingerprint() {
    let fx = ae_fixture();
    let base = pg_fp(ae_str(&fx, &["auto_explain", "in_literals", "query_text"]));
    assert!(base.is_some());
    for (side, text) in [
        (
            "auto_explain $n binds",
            ae_str(&fx, &["auto_explain", "in_binds", "query_text"]),
        ),
        ("pgss arity 5", ae_str(&fx, &["pg_stat_statements", "in_5"])),
        (
            "receiver collapsed",
            ae_str(&fx, &["receiver_top_query", "in", "db_query_text"]),
        ),
        (
            "auto_explain 700 literals (5.6 KB)",
            ae_str(&fx, &["auto_explain", "in_5kb", "query_text"]),
        ),
        (
            "pgss arity 700 (4.1 KB)",
            ae_str(&fx, &["pg_stat_statements", "in_700"]),
        ),
    ] {
        assert_eq!(
            pg_fp(text),
            base,
            "{side} must join the arity-5 literal fingerprint"
        );
    }
}

/// **T1 measurement (b), the documented divergence: `= ANY($1)` is NOT an
/// IN-list.** A driver that rewrites `IN (…)` to `= ANY($1)` produces a
/// different token stream before our lexer ever sees it, so the two forms MUST
/// NOT converge — and the cast variant `ANY($1::int[])` is a third stream.
/// Each form still self-joins across producers (auto_explain ↔ pgss ↔
/// receiver), so the failure is bounded: a mixed-driver fleet splits one
/// logical query into two rows rather than losing the plan. The `%Q` queryid
/// join key exists because of exactly this case.
#[test]
fn t1_any_array_predicate_diverges_from_in_lists_by_construction() {
    let fx = ae_fixture();
    let in_form = pg_fp(ae_str(&fx, &["auto_explain", "in_literals", "query_text"]));
    let any_form = pg_fp(ae_str(&fx, &["auto_explain", "any_bind", "query_text"]));
    let any_cast = pg_fp(ae_str(
        &fx,
        &["auto_explain", "any_literal_array", "query_text"],
    ));
    assert_ne!(
        in_form, any_form,
        "measured: IN-lists and = ANY($1) are different token streams; if they \
         ever converge the normalizer gained a rewrite and this doc is stale"
    );
    assert_ne!(any_form, any_cast, "the ::int[] cast is part of the stream");

    // Bounded failure: each form joins ITSELF across all three producers.
    assert_eq!(
        any_form,
        pg_fp(ae_str(&fx, &["pg_stat_statements", "any"])),
        "= ANY($1) self-joins pgss"
    );
    assert_eq!(
        any_form,
        pg_fp(ae_str(&fx, &["receiver_top_query", "any", "db_query_text"])),
        "= ANY($1) self-joins the receiver text"
    );
    assert_eq!(
        any_cast,
        pg_fp(ae_str(&fx, &["pg_stat_statements", "any_cast"])),
        "= ANY($1::int[]) self-joins pgss"
    );
}

/// **T1 measurement (b), the truncation divergence: statements past
/// `MAX_NORM_INPUT` (16 KB) orphan the join.** The 20.8 KB literal IN-list and
/// its 17.1 KB pgss `$n` twin are BOTH cut at 16 KB — at different content, so
/// the unterminated IN-groups cannot collapse and the fingerprints diverge.
/// The record still ingests (orphaned, invisible on the detail page), and the
/// `%Q` queryid key is the mitigation. Pinned so the boundary is documented
/// truth, not folklore.
#[test]
fn t1_statements_over_max_norm_input_orphan_the_fingerprint_join() {
    let fx = ae_fixture();
    let big_ae = ae_str(&fx, &["auto_explain", "big_in_20kb", "query_text"]);
    let big_pgss = ae_str(&fx, &["pg_stat_statements", "big_in_2600"]);
    assert!(big_ae.len() > super::MAX_NORM_INPUT);
    assert!(big_pgss.len() > super::MAX_NORM_INPUT);
    let fp_ae = pg_fp(big_ae);
    let fp_pgss = pg_fp(big_pgss);
    assert!(
        fp_ae.is_some() && fp_pgss.is_some(),
        "truncated statements still fingerprint — they are orphaned, not dropped"
    );
    assert_ne!(
        fp_ae, fp_pgss,
        "measured: both sides truncate at 16 KB over DIFFERENT content, so the \
         join breaks for >16 KB statements; if this ever passes as equal, the \
         input cap moved and the boundary doc below is stale"
    );
    // The small-side control: 5.6 KB (over the 4 KB DISPLAY cap, under the
    // 16 KB INPUT cap) still joins — display truncation never affects the
    // fingerprint, which is computed before it.
    assert_eq!(
        pg_fp(ae_str(&fx, &["auto_explain", "in_5kb", "query_text"])),
        pg_fp(ae_str(&fx, &["pg_stat_statements", "in_700"])),
        "under the input cap the join must hold regardless of the display cap"
    );
}

/// A prepared statement's auto_explain `Query Text` is the PREPARE source, not
/// the underlying SELECT — it joins the pgss `PREPARE …` row, not the bare
/// statement's row. Consistent on both sides, so nothing is lost; pinned so
/// the behavior is documented rather than rediscovered.
#[test]
fn t1_prepared_statement_text_fingerprints_as_the_prepare_row() {
    let fx = ae_fixture();
    let prep = pg_fp(ae_str(&fx, &["auto_explain", "prepared", "query_text"]));
    assert!(prep.is_some());
    assert_ne!(
        prep,
        pg_fp("SELECT owner FROM accounts WHERE id = $1"),
        "the PREPARE wrapper is part of the fingerprint on BOTH producers"
    );
}

// ── W-E3 · canonicalization, through `apply_to_record` ──────────────────────

/// Force the explain ingest knob on for the duration of a test.
fn with_explain_enabled<T>(f: impl FnOnce() -> T) -> T {
    with_knob("ZO_DB_MONITORING_EXPLAIN_ENABLED", f)
}

/// A flattened auto_explain filelog record, exactly as the T2 recipe produces
/// it: the prefix fields from `pg_prefix`, the tag from `mark_explain`, and the
/// two guarded extractions — `ae_duration_ms` as a STRING (regex captures are
/// strings) and `ae_plan_json` as the whole document STRING (X5: never an
/// object). Values verbatim from the captured entry.
fn pg_auto_explain_flattened() -> Map<String, Value> {
    let fx = ae_fixture();
    obj(json!({
        "_timestamp": 1_786_935_573_262_000i64,
        "o2_pg_event": "explain",
        "pg_pid": "497",
        "pg_user": "dbm",
        "pg_db": "dbmlab",
        "pg_app": "t1probe",
        "pg_severity": "LOG",
        "ae_duration_ms": "0.009",
        "ae_plan_json": ae_str(&fx, &["auto_explain", "literal", "doc"]),
        "o2_capability": "explain_event",
    }))
}

/// D-G: the knob defaults OFF, and the dispatch arm must be unreachable
/// without it — an upgrade must not silently acquire auto_explain ingest.
#[test]
fn explain_dispatch_is_gated_off_by_default() {
    if config::get_config().db_monitoring.explain_enabled {
        return; // an env override is present; the default-off pin lives in config tests
    }
    let mut rec = pg_auto_explain_flattened();
    server_vantage::apply_to_record(&mut rec);
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_KIND),
        "with ZO_DB_MONITORING_EXPLAIN_ENABLED unset an explain record must \
         pass through un-canonicalized"
    );
}

/// The happy path over the real captured entry, THROUGH `apply_to_record`.
///
/// The flagship assertions are the two cross-producer joins: the stored
/// `plan_hash` equals the hash of the receiver's generic plan for the same
/// statement, and the stored fingerprint equals the receiver text's
/// fingerprint. Together they are T1's two measurements, restated as the
/// shipped behavior of the shipped entry point.
#[test]
fn pg_auto_explain_canonicalizes_through_apply_to_record() {
    let fx = ae_fixture();
    let mut rec = pg_auto_explain_flattened();
    with_explain_enabled(|| server_vantage::apply_to_record(&mut rec));

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND)
            .and_then(|v| v.as_str()),
        Some(server_vantage::KIND_EXPLAIN)
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_ENGINE)
            .and_then(|v| v.as_str()),
        Some("postgresql")
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_DATABASE)
            .and_then(|v| v.as_str()),
        Some("dbmlab")
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_SOURCE)
            .and_then(|v| v.as_str()),
        Some(server_vantage::PLAN_SOURCE_AUTO_EXPLAIN),
        "the executed producer stamps its provenance per record (E-C)"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_DURATION_MS)
            .and_then(|v| v.as_f64()),
        Some(0.009),
        "the header duration is the executed wall clock of THIS execution"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_ROWS_ACTUAL)
            .and_then(|v| v.as_i64()),
        Some(1),
        "root-node Actual Rows under log_analyze = on"
    );

    // The stored plan is the REWRAPPED receiver-shaped string…
    let plan_str = rec
        .get(server_vantage::O2_DBM_PLAN)
        .and_then(|v| v.as_str())
        .expect("the plan is stored as a string (D-B)");
    assert!(
        plan_str.starts_with("[{\"Plan\""),
        "one wrapper shape on disk: the receiver's array form"
    );
    // …so the cross-producer hash equality holds ON THE STORED RECORD.
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_HASH)
            .and_then(|v| v.as_str()),
        server_vantage::plan_hash(ae_str(&fx, &["receiver_top_query", "literal", "plan"]))
            .as_deref(),
        "the stored hash must equal the generic producer's hash for the same \
         plan structure — the whole comparison story"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_FINGERPRINT)
            .and_then(|v| v.as_str()),
        pg_fp(ae_str(
            &fx,
            &["receiver_top_query", "literal", "db_query_text"]
        ))
        .as_deref(),
        "the stored fingerprint must join the top_query row for the same statement"
    );
    // Simple protocol has no %Q here, and 'absent' must stay absent.
    assert!(!rec.contains_key(server_vantage::O2_DBM_SERVER_QUERY_ID));
}

/// `log_analyze = off` is a legitimate, recommended configuration: the plan is
/// still the real executed plan (real binds, real plan_cache_mode decision) but
/// carries NO actuals. The columns must be ABSENT, not zero — a fabricated 0
/// reads as "instant" and "returned nothing". Entry verbatim from the rig with
/// `SET auto_explain.log_analyze = off`.
#[test]
fn pg_auto_explain_without_analyze_omits_duration_columns_it_cannot_support() {
    let fx = ae_fixture();
    let mut rec = pg_auto_explain_flattened();
    rec.insert(
        "ae_plan_json".into(),
        json!(ae_str(&fx, &["auto_explain", "analyze_off", "doc"])),
    );
    // The header duration still exists (it is measured by auto_explain, not by
    // the executor instrumentation) — but the ROWS actual cannot.
    with_explain_enabled(|| server_vantage::apply_to_record(&mut rec));
    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND)
            .and_then(|v| v.as_str()),
        Some(server_vantage::KIND_EXPLAIN)
    );
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_PLAN_ROWS_ACTUAL),
        "no Actual Rows in the document ⇒ the column is ABSENT, never 0"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_SOURCE)
            .and_then(|v| v.as_str()),
        Some(server_vantage::PLAN_SOURCE_AUTO_EXPLAIN),
        "provenance does not imply timings: plan_source cannot be a boolean"
    );
}

/// A record whose plan extraction failed upstream (`on_error: send` leaves
/// `ae_plan_json` absent) is nothing — an auto_explain record with no plan
/// must not canonicalize into a plan-less explain row.
#[test]
fn pg_auto_explain_without_a_plan_document_is_skipped() {
    let mut rec = pg_auto_explain_flattened();
    rec.remove("ae_plan_json");
    with_explain_enabled(|| server_vantage::apply_to_record(&mut rec));
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_KIND),
        "no document ⇒ no record; a truncated capture must fail silently and locally"
    );
}

/// `%Q` (T6): a `pg_query_id` from the log prefix becomes the SECOND join key,
/// in the same identifier space as top_query's `postgresql.queryid` — and the
/// `0` sentinel ("queryid not computed") must read as absent, or every
/// unfingerprintable statement would join every other one.
#[test]
fn pg_auto_explain_query_id_joins_and_zero_reads_as_absent() {
    let mut rec = pg_auto_explain_flattened();
    rec.insert("pg_query_id".into(), json!("-679379679796231264"));
    with_explain_enabled(|| server_vantage::apply_to_record(&mut rec));
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SERVER_QUERY_ID)
            .and_then(|v| v.as_str()),
        Some("-679379679796231264"),
        "the %Q queryid is stored verbatim in the shared identifier column"
    );

    let mut zero = pg_auto_explain_flattened();
    zero.insert("pg_query_id".into(), json!("0"));
    with_explain_enabled(|| server_vantage::apply_to_record(&mut zero));
    assert!(
        !zero.contains_key(server_vantage::O2_DBM_SERVER_QUERY_ID),
        "%Q prints 0 for uncomputed queryids; a literal '0' key would glue \
         every such statement together"
    );
}

/// D-I for the new columns: a caller POSTing canonical `o2_dbm_plan_*` names
/// must have them stripped — provenance is an OUTPUT. A forged
/// `plan_source = auto_explain` is a worse lie than a forged generic one,
/// because §4.3 grants executed plans stronger claims.
#[test]
fn spoofed_plan_source_and_duration_are_stripped() {
    let mut rec = obj(json!({
        "some_unrelated": "record",
        "o2_dbm_plan_source": "auto_explain",
        "o2_dbm_plan_duration_ms": 0.001,
        "o2_dbm_plan_rows_actual": 1,
    }));
    server_vantage::apply_to_record(&mut rec);
    for k in [
        server_vantage::O2_DBM_PLAN_SOURCE,
        server_vantage::O2_DBM_PLAN_DURATION_MS,
        server_vantage::O2_DBM_PLAN_ROWS_ACTUAL,
    ] {
        assert!(
            !rec.contains_key(k),
            "{k} is an ALL_DBM_FIELDS member and must be stripped from caller input"
        );
    }
}

/// E-C on the EXISTING producer: `canonicalize_top_query` now stamps its
/// provenance whenever it stores a plan — and never on plan-less rows, where a
/// provenance claim about a plan that does not exist would be noise.
#[test]
fn top_query_rows_stamp_generic_plan_source_alongside_the_plan() {
    let with_plan = server_vantage::canonicalize_top_query(&pg_top_query())
        .expect("top_query")
        .to_record();
    assert_eq!(
        with_plan
            .get(server_vantage::O2_DBM_PLAN_SOURCE)
            .and_then(|v| v.as_str()),
        Some(server_vantage::PLAN_SOURCE_GENERIC),
        "the generic producer names its plans generic, per record"
    );

    let mut record = pg_top_query();
    record.insert("postgresql_query_plan".into(), json!(""));
    let no_plan = server_vantage::canonicalize_top_query(&record)
        .expect("top_query without a plan still canonicalizes")
        .to_record();
    assert!(
        !no_plan.contains_key(server_vantage::O2_DBM_PLAN_SOURCE),
        "no plan ⇒ no provenance claim; plan, hash, version and source travel together"
    );
}

/// **The end-to-end proof, on a record the COLLECTOR actually emitted.**
///
/// `corpus/auto_explain_rig.json` `collector_flattened` is a real record from
/// the rig's post-`filter/dbm` raw sink (`file/raw_recipes`) — so its very
/// existence proves an explain row SURVIVES the shipped filter — captured
/// under the auto_explain step's `%Q` prefix via the extended protocol, attrs
/// flattened the way logs ingest flattens them. This pins the whole chain:
/// collector route → filter survival → flattening → dispatch → canonical
/// record, including the `%Q` queryid equalling the live `pg_stat_statements`
/// queryid for the same statement (verified against the pgss dump at capture
/// time), which is the exact join the fingerprint cannot make for
/// `= ANY($1)` rewrites and >16 KB statements.
#[test]
fn a_real_collector_emitted_explain_record_canonicalizes_end_to_end() {
    let fx = ae_fixture();
    let mut rec = obj(fx["collector_flattened"]["record"].clone());
    with_explain_enabled(|| server_vantage::apply_to_record(&mut rec));

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND)
            .and_then(|v| v.as_str()),
        Some(server_vantage::KIND_EXPLAIN),
        "the collector-emitted record must reach the explain arm"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_PLAN_SOURCE)
            .and_then(|v| v.as_str()),
        Some(server_vantage::PLAN_SOURCE_AUTO_EXPLAIN)
    );
    // %Q → the engine's own statement id, same identifier space as top_query's
    // postgresql.queryid.
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SERVER_QUERY_ID)
            .and_then(|v| v.as_str()),
        fx["collector_flattened"]["pgss_queryid"].as_str(),
        "the %Q queryid must equal the pg_stat_statements queryid measured live"
    );
    // The extended-protocol Query Text ("… id = $1") must land on the SAME
    // fingerprint as the pgss text — the row joins its query detail page.
    assert_eq!(
        rec.get(server_vantage::O2_DBM_FINGERPRINT)
            .and_then(|v| v.as_str()),
        pg_fp(ae_str(&fx, &["pg_stat_statements", "literal_and_bind"])).as_deref()
    );
    // Stored plan is the rewrapped receiver shape, and the extended-protocol
    // extras ("Query Parameters" — real bind values) do NOT survive into it:
    // parameters are data, and the stored plan is structure + measurements.
    let plan = rec
        .get(server_vantage::O2_DBM_PLAN)
        .and_then(|v| v.as_str())
        .expect("plan stored as a string");
    assert!(plan.starts_with("[{\"Plan\""));
    assert!(
        !plan.contains("Query Parameters"),
        "bind values must not ride into the stored plan document"
    );
}

// ── W-S1 · Completed-statement durations (log_min_duration_statement) ────────
//
// Fixtures are REAL rows copied from the live `dbm_server_logs` stream
// (org dbm_notraces, 2026-08-13): the demo tailer's `mark_duration` operator
// stamped `o2_pg_event = statement_duration` and pre-parsed
// `stmt_duration_ms` / `stmt_kind` / `stmt_text`; the pg_prefix parser
// supplied the `user@db app=…` fields. If the tailer's regex changes shape,
// these fail loudly.

/// The captured slow-aggregate line, verbatim from the live stream.
fn pg_statement_duration_flattened() -> Map<String, Value> {
    obj(json!({
        "_timestamp": 1_786_612_398_267_000i64,
        "body": "2026-08-13 09:13:18.267 UTC [129] dbm@dbmlab app=dbm-sv-oltp vxid=16/131209 txid=0 line=2011855 qid=3703636288641591934 LOG:  duration: 63.149 ms  statement: SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
        "log_file_name": "postgresql.log",
        "o2_pg_event": "statement_duration",
        "pg_app": "dbm-sv-oltp",
        "pg_db": "dbmlab",
        "pg_line": "2011855",
        "pg_message": "duration: 63.149 ms  statement: SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
        "pg_pid": "129",
        "pg_query_id": "3703636288641591934",
        "pg_severity": "LOG",
        "pg_txid": "0",
        "pg_user": "dbm",
        "pg_vxid": "16/131209",
        "server_address": "postgres",
        "severity": "LOG",
        "stmt_duration_ms": "63.149",
        "stmt_kind": "statement",
        "stmt_text": "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
        "ts": "2026-08-13 09:13:18.267 UTC"
    }))
}

// ── the message parser ──

/// The simple-protocol form, from the live line above.
#[test]
fn ws1_parser_reads_a_statement_line() {
    let (dur, text) = server_vantage::parse_statement_duration_message(
        "duration: 63.149 ms  statement: SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
    )
    .expect("a completed-statement line must parse");
    assert_eq!(dur, 63.149);
    assert_eq!(
        text,
        "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'"
    );
}

/// The extended-protocol EXECUTE form — Postgres logs the prepared statement's
/// name between `execute` and the colon.
#[test]
fn ws1_parser_reads_an_execute_line() {
    let (dur, text) = server_vantage::parse_statement_duration_message(
        "duration: 1.234 ms  execute s_1: SELECT owner FROM accounts WHERE id = $1",
    )
    .expect("an execute line is a completed execution");
    assert_eq!(dur, 1.234);
    assert_eq!(text, "SELECT owner FROM accounts WHERE id = $1");
}

/// `parse`/`bind` lines are protocol PHASES, not executions: under the
/// extended protocol one logical query can log up to three duration lines,
/// and admitting the other two would count one call three times.
#[test]
fn ws1_parser_rejects_phase_lines() {
    for line in [
        "duration: 0.021 ms  parse s_1: SELECT owner FROM accounts WHERE id = $1",
        "duration: 0.011 ms  bind s_1: SELECT owner FROM accounts WHERE id = $1",
    ] {
        assert_eq!(
            server_vantage::parse_statement_duration_message(line),
            None,
            "phase line must be rejected: {line}"
        );
    }
}

/// An auto_explain entry ALSO begins `duration: N.NNN ms` — but its kind is
/// `plan`, which is not an execution record for THIS path (the explain arm
/// owns it, with the plan attached).
#[test]
fn ws1_parser_rejects_auto_explain_headers() {
    assert_eq!(
        server_vantage::parse_statement_duration_message(
            "duration: 0.009 ms  plan: {\"Query Text\": \"SELECT 1\"}"
        ),
        None
    );
}

// ── canonicalization, through `apply_to_record` ──

/// The happy path over the real captured row, THROUGH `apply_to_record` — the
/// knob defaults ON, so no env juggling. Every canonical column is asserted
/// against the live values.
#[test]
fn ws1_statement_duration_canonicalizes_through_apply_to_record() {
    if !config::get_config().db_monitoring.statement_enabled {
        return; // an env override is present; the default-on pin lives in config tests
    }
    let mut rec = pg_statement_duration_flattened();
    server_vantage::apply_to_record(&mut rec);

    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND)
            .and_then(|v| v.as_str()),
        Some(server_vantage::KIND_STATEMENT)
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_STMT_DURATION_MS)
            .and_then(|v| v.as_f64()),
        Some(63.149),
        "the engine's own completed-statement duration, milliseconds"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_ENGINE)
            .and_then(|v| v.as_str()),
        Some("postgresql")
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_DATABASE)
            .and_then(|v| v.as_str()),
        Some("dbmlab"),
        "db from the user@db prefix segment (pg_db)"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_INSTANCE)
            .and_then(|v| v.as_str()),
        Some("postgres"),
        "instance from server_address, the identity tag every filelog recipe stamps"
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SESSION_USER)
            .and_then(|v| v.as_str()),
        Some("dbm")
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SESSION_APP)
            .and_then(|v| v.as_str()),
        Some("dbm-sv-oltp")
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SESSION_PID)
            .and_then(|v| v.as_i64()),
        Some(129)
    );
    // %Q queryid — the exact join key to top_query rows.
    assert_eq!(
        rec.get(server_vantage::O2_DBM_SERVER_QUERY_ID)
            .and_then(|v| v.as_str()),
        Some("3703636288641591934")
    );
    // The statement runs through the SAME normalizer as every other path, so
    // this row JOINs the client spans and the top_query rows for the same
    // statement.
    let (expected_norm, expected_fp) = fingerprint_statement(
        "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
        Some("postgresql"),
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_FINGERPRINT)
            .and_then(|v| v.as_str()),
        expected_fp.as_deref()
    );
    let stored_query = rec
        .get(server_vantage::O2_DBM_ACTIVITY_QUERY)
        .and_then(|v| v.as_str())
        .expect("normalized text stored");
    assert_eq!(Some(stored_query.to_string()), expected_norm);
    assert!(
        !stored_query.contains("CUST-00879"),
        "the literal must not survive into the canonical text"
    );
    // NO raw copy: the record's own body/pg_message already hold the evidence,
    // and o2_dbm_raw on the highest-volume feed would double the stored text
    // while putting raw literals under a canonical column.
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_RAW),
        "statement rows must not copy the raw line into o2_dbm_raw"
    );
}

/// The privacy rule, STRICTER than the receiver-event canonicalizers: the
/// logged text carries raw literals, so a lexer failure yields NO normalized
/// text and NO fingerprint — and the raw text is NEVER stored as fallback in
/// any canonical column. The duration row itself survives: "a call took this
/// long" is honest without its statement.
#[test]
fn ws1_lexer_failure_stores_no_raw_text_in_canonical_fields() {
    if !config::get_config().db_monitoring.statement_enabled {
        return;
    }
    let mut rec = pg_statement_duration_flattened();
    rec.insert("stmt_text".into(), json!("SELECT 'unterminated"));
    rec.insert(
        "pg_message".into(),
        json!("duration: 63.149 ms  statement: SELECT 'unterminated"),
    );
    rec.insert(
        "body".into(),
        json!("2026-08-13 09:13:18.267 UTC [129] dbm@dbmlab LOG:  duration: 63.149 ms  statement: SELECT 'unterminated"),
    );
    server_vantage::apply_to_record(&mut rec);
    assert_eq!(
        rec.get(server_vantage::O2_DBM_KIND)
            .and_then(|v| v.as_str()),
        Some(server_vantage::KIND_STATEMENT),
        "the measured duration is still a fact"
    );
    assert!(rec.get(server_vantage::O2_DBM_ACTIVITY_QUERY).is_none());
    assert!(rec.get(server_vantage::O2_DBM_FINGERPRINT).is_none());
    for field in server_vantage::ALL_DBM_FIELDS {
        if let Some(v) = rec.get(field).and_then(|v| v.as_str()) {
            assert!(
                !v.contains("unterminated"),
                "raw text leaked into canonical field {field}: {v}"
            );
        }
    }
}

/// A tailer that classified the line but did not parse it (regex `on_error:
/// send` drops captures silently) degrades to the same row: the message is
/// the fallback source.
#[test]
fn ws1_message_fallback_parses_without_stmt_attributes() {
    if !config::get_config().db_monitoring.statement_enabled {
        return;
    }
    let mut rec = pg_statement_duration_flattened();
    rec.remove("stmt_duration_ms");
    rec.remove("stmt_kind");
    rec.remove("stmt_text");
    server_vantage::apply_to_record(&mut rec);
    assert_eq!(
        rec.get(server_vantage::O2_DBM_STMT_DURATION_MS)
            .and_then(|v| v.as_f64()),
        Some(63.149)
    );
    let (expected_norm, _) = fingerprint_statement(
        "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = 'CUST-00879'",
        Some("postgresql"),
    );
    assert_eq!(
        rec.get(server_vantage::O2_DBM_ACTIVITY_QUERY)
            .and_then(|v| v.as_str())
            .map(str::to_string),
        expected_norm
    );
}

/// The pre-parsed route must apply the SAME phase filter as the message
/// parser: the tailer's regex also captures `parse`/`bind` lines.
#[test]
fn ws1_pre_parsed_phase_lines_are_rejected() {
    if !config::get_config().db_monitoring.statement_enabled {
        return;
    }
    let mut rec = pg_statement_duration_flattened();
    rec.insert("stmt_kind".into(), json!("parse s_1"));
    server_vantage::apply_to_record(&mut rec);
    assert!(
        !rec.contains_key(server_vantage::O2_DBM_KIND),
        "a parse-phase line is not an execution"
    );
}

/// D1 condition 1: a `/_json` caller cannot hand us a fabricated duration —
/// canonical names are outputs, and the strip removes caller-supplied values
/// on records the dispatch does not claim.
#[test]
fn ws1_caller_supplied_duration_is_stripped() {
    let mut rec = obj(json!({
        "_timestamp": 1_786_612_398_267_000i64,
        "log": "an ordinary application log line",
        "o2_dbm_stmt_duration_ms": 99999.0,
        "o2_dbm_kind": "statement",
    }));
    server_vantage::apply_to_record(&mut rec);
    assert!(!rec.contains_key(server_vantage::O2_DBM_STMT_DURATION_MS));
    assert!(!rec.contains_key(server_vantage::O2_DBM_KIND));
}

/// The `%Q` zero sentinel: qid=0 means "queryid not computed", and a literal
/// "0" join key would glue every such statement together — same filter as the
/// auto_explain path.
#[test]
fn ws1_zero_query_id_is_not_a_join_key() {
    if !config::get_config().db_monitoring.statement_enabled {
        return;
    }
    let mut rec = pg_statement_duration_flattened();
    rec.insert("pg_query_id".into(), json!("0"));
    server_vantage::apply_to_record(&mut rec);
    assert!(rec.get(server_vantage::O2_DBM_SERVER_QUERY_ID).is_none());
}
