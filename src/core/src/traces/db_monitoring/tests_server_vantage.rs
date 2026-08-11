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

//! Server-vantage canonicalization + chain-assembly tests.
//!
//! The deadlock/blocking fixtures are the REAL captured records from
//! `docs/___databsepages/dbm-server-vantage-proof.md` §2.1/§2.2 — field names, pids, and SQL
//! verbatim. If a collector release renames a field, these fail loudly rather than silently
//! returning empty events.

use serde_json::{Map, Value, json};

use super::{
    chains::assemble_chains,
    server_vantage,
    server_vantage::{
        BlockingSample, Participant, canonicalize_blocking, canonicalize_mariadb_deadlock,
        canonicalize_mssql_deadlock, canonicalize_mysql_deadlock, canonicalize_pg_deadlock,
        canonicalize_record, fingerprint_statement, merge_mysql_deadlocks,
    },
};

fn obj(v: Value) -> Map<String, Value> {
    v.as_object().unwrap().clone()
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

// ─── Deadlock canonicalization ───────────────────────────────────────────────

#[test]
fn pg_deadlock_assembles_both_participants_from_the_proof_record() {
    let ev = canonicalize_pg_deadlock(&pg_deadlock_record()).expect("deadlock canonicalized");

    assert_eq!(ev.engine.as_deref(), Some("postgresql"));
    assert_eq!(ev.database.as_deref(), Some("dbmlab"));
    assert_eq!(ev.victim_pid, Some(1071));
    assert_eq!(ev.participants.len(), 2, "both sides of the cycle");

    let victim = &ev.participants[0];
    assert_eq!(victim.pid, Some(1071));
    assert!(victim.victim, "pid 1071 is the engine-chosen victim");
    assert_eq!(victim.lock_mode.as_deref(), Some("ShareLock"));
    assert_eq!(victim.lock_target.as_deref(), Some("transaction 1430"));
    assert_eq!(victim.app.as_deref(), Some("dbm-sv-deadlock-a"));
    assert!(victim.fingerprint.is_some(), "victim SQL fingerprinted");

    let survivor = &ev.participants[1];
    assert_eq!(survivor.pid, Some(1072));
    assert!(!survivor.victim);
    assert_eq!(survivor.lock_target.as_deref(), Some("transaction 1429"));

    // The two statements touch the same table in opposite order — different
    // literals, so different fingerprints is CORRECT here (id = 2 vs id = 1 are
    // both `?` after normalization, so they actually converge).
    assert!(survivor.fingerprint.is_some());
}

/// The MULTI-LINE TRAP (proof §5.4). A pipeline matching only "deadlock detected"
/// captures a 119-byte banner with NO participants. That must NOT become an event —
/// otherwise the UI shows deadlocks with nothing actionable in them.
#[test]
fn pg_deadlock_banner_without_participants_is_not_an_event() {
    let banner = obj(json!({
        "_timestamp": 1_786_165_745_900_000i64,
        "o2_pg_event": "deadlock",
        "pg_pid": "1071",
        "pg_severity": "ERROR",
        "body": "deadlock detected",
    }));
    assert!(
        canonicalize_pg_deadlock(&banner).is_none(),
        "banner-only entry must be skipped, not stored as a participant-less deadlock"
    );
}

#[test]
fn pg_deadlock_participant_queries_are_normalized_not_raw() {
    let ev = canonicalize_pg_deadlock(&pg_deadlock_record()).unwrap();
    for p in &ev.participants {
        let norm = p.query_norm.as_deref().unwrap();
        // Literals must not survive into normalized text (NFR-2).
        assert!(
            !norm.contains("= 2") && !norm.contains("= 1"),
            "literal leaked into query_norm: {norm}"
        );
        // sqlcommenter-style comments are stripped by the normalizer.
        assert!(
            !norm.contains("deadlock-a-step2"),
            "comment leaked into query_norm: {norm}"
        );
    }
}

#[test]
fn mysql_deadlock_captures_one_side_per_entry() {
    // NOTE the absent `my_victim_side`. InnoDB logs `WE ROLL BACK TRANSACTION
    // (N)` as its OWN entry, so a side's record never carries the verdict —
    // verified against live collector output. The previous fixture put both
    // fields on one record, a shape the collector never emits, which is why
    // the "no MySQL participant is ever the victim" bug shipped green.
    let side1 = obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_my_event": "deadlock",
        "my_trx_side": "1",
        "my_trx_id": "4589",
        "my_trx_thread": "89",
        "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
    }));
    let ev = canonicalize_mysql_deadlock(&side1).expect("side 1 canonicalized");
    assert_eq!(ev.engine.as_deref(), Some("mysql"));
    assert_eq!(ev.participants.len(), 1);
    assert_eq!(ev.participants[0].pid, Some(89));
    assert_eq!(ev.participants[0].transaction_id.as_deref(), Some("4589"));
    assert_eq!(
        ev.participants[0].side,
        Some(1),
        "side retained for the join"
    );
    // Unresolved at this layer BY DESIGN — the verdict is a different record.
    assert!(!ev.participants[0].victim);
    assert_eq!(ev.victim_pid, None);
}

/// The rollback verdict is its own record, and it must SURVIVE canonicalization.
///
/// This is the record the old code dropped (`side.is_none() && query.is_none()`
/// → `None`), which is why no MySQL participant was ever flagged and the UI's
/// "cancelled by the database" panel rendered blank.
#[test]
fn mysql_rollback_verdict_record_is_kept_as_a_participantless_event() {
    let verdict = obj(json!({
        "_timestamp": 1_786_166_303_139_800i64,
        "o2_my_event": "deadlock",
        "my_victim_side": "2",
    }));
    let ev = canonicalize_mysql_deadlock(&verdict).expect("verdict must not be discarded");
    assert_eq!(ev.victim_side, Some(2));
    assert!(
        ev.participants.is_empty(),
        "a verdict is not a participant — it must not inflate participant_count"
    );
}

/// A banner with neither a side, a statement, nor a verdict is still noise.
#[test]
fn mysql_banner_without_a_verdict_is_still_skipped() {
    let banner = obj(json!({
        "o2_my_event": "deadlock",
        "my_code": "MY-012468",
    }));
    assert!(canonicalize_mysql_deadlock(&banner).is_none());
}

/// End to end: two sides plus a separately-logged verdict resolve to one event
/// with the correct victim — the shape the live collector actually emits.
#[test]
fn mysql_victim_resolves_from_the_separately_logged_verdict() {
    let mk_side = |ts: i64, side: &str, thread: &str, txid: &str| {
        canonicalize_mysql_deadlock(&obj(json!({
            "_timestamp": ts,
            "o2_my_event": "deadlock",
            "my_trx_side": side,
            "my_trx_id": txid,
            "my_trx_thread": thread,
            "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
        })))
        .expect("side canonicalized")
    };
    // Timestamps mirror the observed order: sides first, verdict LAST.
    let s1 = mk_side(1_786_166_303_139_234, "1", "15", "4589");
    let s2 = mk_side(1_786_166_303_139_397, "2", "14", "4590");
    let verdict = canonicalize_mysql_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_569i64,
        "o2_my_event": "deadlock",
        "my_victim_side": "2",
    })))
    .expect("verdict canonicalized");

    let merged = merge_mysql_deadlocks(vec![s1, s2, verdict], 2_000_000);
    assert_eq!(merged.len(), 1, "one deadlock, not three");

    let ev = &merged[0];
    assert_eq!(
        ev.participants.len(),
        2,
        "the verdict must not count as a participant"
    );
    assert_eq!(
        ev.victim_pid,
        Some(14),
        "side 2 -> thread 14 was rolled back"
    );

    let victim: Vec<_> = ev.participants.iter().filter(|p| p.victim).collect();
    assert_eq!(victim.len(), 1, "exactly one side is the victim");
    assert_eq!(victim[0].pid, Some(14));
    assert_eq!(
        ev.participants.iter().filter(|p| !p.victim).count(),
        1,
        "the other side survives"
    );
}

#[test]
fn mysql_deadlock_banner_is_not_an_event() {
    let banner = obj(json!({
        "o2_my_event": "deadlock",
        "my_code": "MY-012468",
        "my_message": "Deadlock found when trying to get lock",
    }));
    assert!(canonicalize_mysql_deadlock(&banner).is_none());
}

/// MySQL splits one deadlock across N entries; merging must reassemble exactly one
/// event with both sides (proof §2.1 MySQL block: two entries 145 µs apart).
#[test]
fn mysql_deadlock_sides_merge_into_one_event() {
    let s1 = canonicalize_mysql_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_my_event": "deadlock",
        "my_trx_side": "1", "my_trx_id": "4589", "my_trx_thread": "89",
        "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
    })))
    .unwrap();
    let s2 = canonicalize_mysql_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_928i64,
        "o2_my_event": "deadlock",
        "my_trx_side": "2", "my_trx_id": "4588", "my_trx_thread": "88",
        "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 12",
    })))
    .unwrap();

    let merged = merge_mysql_deadlocks(vec![s1, s2], 5_000_000);
    assert_eq!(merged.len(), 1, "the two sides are ONE deadlock");
    assert_eq!(merged[0].participants.len(), 2);
}

/// Two deadlocks far apart in time must NOT merge.
#[test]
fn mysql_distant_deadlocks_do_not_merge() {
    let a = canonicalize_mysql_deadlock(&obj(json!({
        "_timestamp": 1_000_000_000i64, "o2_my_event": "deadlock",
        "my_trx_side": "1", "my_trx_id": "1", "my_trx_thread": "10",
        "my_trx_query": "UPDATE t SET a = 1",
    })))
    .unwrap();
    let b = canonicalize_mysql_deadlock(&obj(json!({
        "_timestamp": 9_000_000_000i64, "o2_my_event": "deadlock",
        "my_trx_side": "1", "my_trx_id": "2", "my_trx_thread": "11",
        "my_trx_query": "UPDATE t SET a = 2",
    })))
    .unwrap();
    assert_eq!(merge_mysql_deadlocks(vec![a, b], 5_000_000).len(), 2);
}

// ─── MariaDB deadlocks ───────────────────────────────────────────────────────
//
// Every fixture below uses the values from a REAL captured deadlock —
// tests/dbm-server-vantage/captures/mariadb-deadlock.log — per the rule that
// burned the MySQL path: fixture-test against captured collector output, never
// hand-authored records. The capture's shape was:
//   entry 2 → SIDE 1, trx 48, MariaDB thread id 14
//   entry 5 → SIDE 2, trx 47, MariaDB thread id 15
//   entry 8 → *** WE ROLL BACK TRANSACTION (2)

#[test]
fn mariadb_deadlock_captures_one_side_per_entry() {
    let side1 = obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_maria_event": "deadlock",
        "maria_trx_side": "1",
        "maria_trx_id": "48",
        "maria_trx_thread": "14",
        "maria_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
    }));
    let ev = canonicalize_mariadb_deadlock(&side1).expect("side 1 canonicalized");
    assert_eq!(
        ev.engine.as_deref(),
        Some("mariadb"),
        "MUST NOT report mysql — the stitch groups on engine, so a mislabelled \
         MariaDB row could merge with a real MySQL deadlock"
    );
    assert_eq!(ev.participants.len(), 1);
    assert_eq!(ev.participants[0].pid, Some(14));
    assert_eq!(ev.participants[0].transaction_id.as_deref(), Some("48"));
    assert_eq!(ev.participants[0].side, Some(1));
    assert!(!ev.participants[0].victim);
    assert_eq!(ev.victim_pid, None);
}

/// MariaDB splits the verdict onto its own entry exactly as MySQL does, so the
/// participant-less event must survive here too.
#[test]
fn mariadb_rollback_verdict_record_is_kept_as_a_participantless_event() {
    let verdict = obj(json!({
        "_timestamp": 1_786_166_303_139_800i64,
        "o2_maria_event": "deadlock",
        "maria_victim_side": "2",
    }));
    let ev = canonicalize_mariadb_deadlock(&verdict).expect("verdict must not be discarded");
    assert_eq!(ev.engine.as_deref(), Some("mariadb"));
    assert_eq!(ev.victim_side, Some(2));
    assert!(ev.participants.is_empty());
}

/// The whole point of the split-entry finding: the two sides plus the verdict
/// stitch into ONE event with the right participant flagged.
#[test]
fn mariadb_sides_and_verdict_merge_into_one_event() {
    let s1 = canonicalize_mariadb_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_maria_event": "deadlock",
        "maria_trx_side": "1", "maria_trx_id": "48", "maria_trx_thread": "14",
        "maria_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
    })))
    .unwrap();
    let s2 = canonicalize_mariadb_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_928i64,
        "o2_maria_event": "deadlock",
        "maria_trx_side": "2", "maria_trx_id": "47", "maria_trx_thread": "15",
        "maria_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 12",
    })))
    .unwrap();
    let verdict = canonicalize_mariadb_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_950i64,
        "o2_maria_event": "deadlock",
        "maria_victim_side": "2",
    })))
    .unwrap();

    let merged = merge_mysql_deadlocks(vec![s1, s2, verdict], 5_000_000);
    assert_eq!(merged.len(), 1, "two sides + verdict are ONE deadlock");
    assert_eq!(
        merged[0].participants.len(),
        2,
        "the verdict is not a participant"
    );
    assert_eq!(merged[0].engine.as_deref(), Some("mariadb"));
    // Side 2 (thread 15) was rolled back, so it — and only it — is the victim.
    assert_eq!(merged[0].victim_pid, Some(15));
    let victims: Vec<_> = merged[0]
        .participants
        .iter()
        .filter(|p| p.victim)
        .map(|p| p.pid)
        .collect();
    assert_eq!(
        victims,
        vec![Some(15)],
        "exactly one victim, resolved side→pid"
    );
}

/// MariaDB and MySQL deadlocks in the same window MUST NOT stitch together.
///
/// This is the fabricated-cross-server-deadlock trap. Both engines default
/// instance/database to "", so if the engine did not distinguish them, two
/// unrelated servers' sides would merge into one bogus event.
#[test]
fn mariadb_and_mysql_deadlocks_never_merge() {
    let maria = canonicalize_mariadb_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_maria_event": "deadlock",
        "maria_trx_side": "1", "maria_trx_id": "48", "maria_trx_thread": "14",
        "maria_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
    })))
    .unwrap();
    let mysql = canonicalize_mysql_deadlock(&obj(json!({
        "_timestamp": 1_786_166_303_139_800i64,
        "o2_my_event": "deadlock",
        "my_trx_side": "2", "my_trx_id": "4588", "my_trx_thread": "88",
        "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 12",
    })))
    .unwrap();

    let merged = merge_mysql_deadlocks(vec![maria, mysql], 5_000_000);
    assert_eq!(
        merged.len(),
        2,
        "different engines are different servers — merging them fabricates a deadlock"
    );
}

/// The recipe tag is the only thing separating the two servers' blocking rows.
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

// ─── SQL Server deadlocks ────────────────────────────────────────────────────
//
// Fixtures use rows the SHIPPED shred actually returned against the rig — see
// tests/dbm-server-vantage/captures/mssql-deadlock.xml. Real output was:
//   spid 93, mssql_is_victim=1, "UPDATE accounts SET balance = balance - 1 WHERE id = 31"
//   spid 92, mssql_is_victim=0, "UPDATE accounts SET balance = balance - 1 WHERE id = 32"

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

/// The collector puts the statement in the RECORD BODY, not in an attribute.
///
/// `mssql_query` is the recipe's `body_column` (see `MSSQL_DEADLOG_RECEIVER` in
/// `web/src/components/ingestion/setupCard/content/dbmShared.ts`), so it is
/// NEVER one of the `attribute_columns` and the key `mssql_query` does not
/// exist on the flattened record — the text arrives under `body`.
///
/// Measured against the live rig at contrib v0.158.0: `mssql_query` absent on
/// 22/22 rows, `body` populated on 40/40
/// (`tests/dbm-server-vantage/captures/`). Every SQL Server deadlock therefore
/// canonicalized with `query: None` and rendered with no SQL at all.
///
/// The sibling `canonicalize_blocking` already reads `["…", "body"]`, and this
/// same function reads `raw: first_str(rec, &["body"])`, so `body` was provably
/// reachable the whole time. The pre-existing tests missed it because their
/// fixture synthesized `mssql_query` as an attribute — a shape the collector
/// never emits. This fixture is the real one.
fn mssql_deadlock_row_as_collector_emits_it(
    spid: &str,
    victim: &str,
    query: &str,
) -> Map<String, Value> {
    let mut row = mssql_deadlock_row(spid, victim, query);
    // What the body_column declaration actually produces.
    row.remove("mssql_query");
    row.insert("body".into(), json!(query));
    row
}

#[test]
fn mssql_deadlock_reads_the_statement_from_the_body() {
    let sql = "UPDATE accounts SET balance = balance - 1 WHERE id = 31";
    let ev = canonicalize_mssql_deadlock(&mssql_deadlock_row_as_collector_emits_it("93", "1", sql))
        .expect("row canonicalized");
    let victim = ev
        .participants
        .iter()
        .find(|p| p.victim)
        .expect("victim participant");
    assert!(
        victim.query.is_some(),
        "the statement is in the body, so a deadlock must not render with no SQL"
    );
    assert!(
        victim.query.as_deref().unwrap().contains("accounts"),
        "expected the real statement, got {:?}",
        victim.query
    );
}

/// `body` must not DISPLACE the column — order matters, both paths must work.
///
/// Reading `body` alone passes the test above, so without this a future edit
/// could drop the `mssql_query` key entirely and nothing would notice. Any
/// recipe that projects the statement as a real column must still win over the
/// body, which for a deadlock row holds the same text today but is the generic
/// catch-all and carries no such guarantee.
#[test]
fn mssql_deadlock_prefers_the_column_over_the_body() {
    let mut row = mssql_deadlock_row("93", "1", "SELECT 'from-the-column'");
    row.insert("body".into(), json!("SELECT 'from-the-body'"));
    let ev = canonicalize_mssql_deadlock(&row).expect("row canonicalized");
    let victim = ev
        .participants
        .iter()
        .find(|p| p.victim)
        .expect("victim participant");
    assert!(
        victim.query.as_deref().unwrap().contains("from-the-column"),
        "the projected column must win over the body, got {:?}",
        victim.query
    );
}

/// The victim is resolved INSIDE the row — no stitch, unlike MySQL/MariaDB.
#[test]
fn mssql_deadlock_victim_is_resolved_without_stitching() {
    let ev = canonicalize_mssql_deadlock(&mssql_deadlock_row(
        "93",
        "1",
        "UPDATE accounts SET balance = balance - 1 WHERE id = 31",
    ))
    .expect("victim row canonicalized");

    assert_eq!(ev.engine.as_deref(), Some("mssql"));
    assert_eq!(ev.participants.len(), 1);
    assert_eq!(ev.participants[0].pid, Some(93));
    assert!(
        ev.participants[0].victim,
        "the graph named this spid inline"
    );
    assert_eq!(
        ev.victim_pid,
        Some(93),
        "victim_pid must be set at canonicalization — there is no later pass to fill it"
    );
    assert_eq!(
        ev.victim_side, None,
        "MSSQL has no side/verdict indirection"
    );
    assert_eq!(ev.participants[0].lock_mode.as_deref(), Some("X"));
    assert_eq!(
        ev.participants[0].lock_target.as_deref(),
        Some("dbmlab.dbo.accounts")
    );
    assert_eq!(ev.database.as_deref(), Some("dbmlab"));
}

#[test]
fn mssql_deadlock_survivor_is_not_flagged() {
    let ev = canonicalize_mssql_deadlock(&mssql_deadlock_row(
        "92",
        "0",
        "UPDATE accounts SET balance = balance - 1 WHERE id = 32",
    ))
    .expect("survivor row canonicalized");
    assert!(!ev.participants[0].victim);
    assert_eq!(
        ev.victim_pid, None,
        "a survivor row must not claim to be the victim"
    );
}

/// Guard against the worst failure mode: a recipe change that stops emitting
/// "1"/"0" must NOT silently flag every participant as the victim.
#[test]
fn mssql_unexpected_victim_flag_does_not_flag_everyone() {
    for weird in ["true", "yes", "", "2"] {
        let ev =
            canonicalize_mssql_deadlock(&mssql_deadlock_row("93", weird, "UPDATE t SET a = 1"))
                .expect("row canonicalized");
        assert!(
            !ev.participants[0].victim,
            "victim flag must be exactly \"1\"; {weird:?} must not qualify"
        );
    }
}

/// The full ingest entry point must route the recipe tag to the deadlock path,
/// NOT to `canonicalize_blocking` (which would silently produce a blocking row).
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

// ─── Blocking canonicalization ───────────────────────────────────────────────

#[test]
fn blocking_sample_canonicalizes_from_the_proof_record() {
    let s = canonicalize_blocking(&pg_blocking_record()).expect("blocking canonicalized");
    assert_eq!(s.blocked_pid, Some(1070));
    assert_eq!(s.blocking_pid, Some(1069));
    assert_eq!(s.blocked_app.as_deref(), Some("dbm-sv-lock-waiter"));
    assert_eq!(s.blocking_app.as_deref(), Some("dbm-sv-lock-holder"));
    assert_eq!(s.wait_event_type.as_deref(), Some("Lock"));
    assert_eq!(s.wait_event.as_deref(), Some("transactionid"));
    assert_eq!(s.wait_seconds, Some(4.818));
    assert!(
        s.blocking_fingerprint.is_some(),
        "root blocker SQL must be fingerprinted — that is the pivot to the query view"
    );
}

/// A row missing one end of the edge is not a blocking relationship.
#[test]
fn blocking_half_row_is_rejected() {
    let half = obj(json!({
        "o2_recipe": "pg_blocking_chain",
        "blocked_pid": "1070",
    }));
    assert!(canonicalize_blocking(&half).is_none());
}

/// The receiver ships every `sqlqueryreceiver` column as TEXT; the canonicalizer
/// must parse those into real numbers or every downstream comparison breaks.
#[test]
fn numeric_columns_parse_from_receiver_strings() {
    let s = canonicalize_blocking(&pg_blocking_record()).unwrap();
    assert_eq!(s.blocked_pid, Some(1070), "string pid parsed to i64");
    assert_eq!(s.wait_seconds, Some(4.818), "string wait parsed to f64");
}

/// A client-supplied `o2_dbm_*` key must never survive into the canonical columns —
/// the logs ingest path flattens user keys directly, so without the strip in
/// `finalize_and_buffer_record` a caller could POST a fabricated deadlock. This test
/// pins the contract that canonicalization OVERWRITES rather than merges.
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

// ─── Dispatch ────────────────────────────────────────────────────────────────

#[test]
fn canonicalize_record_dispatches_on_recipe_tags() {
    let dl = canonicalize_record(&pg_deadlock_record()).expect("pg deadlock dispatched");
    assert_eq!(dl.get("o2_dbm_kind").unwrap(), &json!("deadlock"));
    assert_eq!(dl.get("o2_dbm_participant_count").unwrap(), &json!(2));

    let bl = canonicalize_record(&pg_blocking_record()).expect("blocking dispatched");
    assert_eq!(bl.get("o2_dbm_kind").unwrap(), &json!("blocking"));

    // Unrelated server-vantage records are left alone.
    let other = obj(json!({"o2_recipe": "pg_table_stats", "body": "orders"}));
    assert!(canonicalize_record(&other).is_none());
}

/// The query shape must be victim-order independent: the proof's Demo 2 shows the
/// victim ALTERNATING between firings of the same lock-ordering bug. If the shape
/// key depended on victim order, one bug would split into two half-as-bad rows.
#[test]
fn deadlock_query_shape_is_victim_order_independent() {
    let mut rec_a = pg_deadlock_record();
    let mut rec_b = pg_deadlock_record();
    // Firing B: victim and survivor swap sides.
    rec_b.insert("deadlock_victim_pid".into(), json!("1072"));
    rec_b.insert("dl_query_1".into(), rec_a["dl_query_2"].clone());
    rec_b.insert("dl_query_2".into(), rec_a["dl_query_1"].clone());
    rec_a.insert("o2_pg_event".into(), json!("deadlock"));

    let a = canonicalize_pg_deadlock(&rec_a).unwrap();
    let b = canonicalize_pg_deadlock(&rec_b).unwrap();
    assert_eq!(
        a.query_shape(),
        b.query_shape(),
        "the same lock-ordering bug must group under one shape when the victim alternates"
    );
}

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

// ─── Chain assembly ──────────────────────────────────────────────────────────

fn sample(blocked: i64, blocking: i64, wait: f64) -> BlockingSample {
    BlockingSample {
        engine: Some("postgresql".into()),
        instance: Some("db1".into()),
        database: Some("dbmlab".into()),
        timestamp: Some(1_000),
        blocked_pid: Some(blocked),
        blocked_app: Some(format!("app-{blocked}")),
        blocked_query: Some(format!("SELECT {blocked}")),
        blocked_fingerprint: Some(format!("fp{blocked}")),
        blocking_pid: Some(blocking),
        blocking_app: Some(format!("app-{blocking}")),
        blocking_query: Some(format!("UPDATE {blocking}")),
        blocking_fingerprint: Some(format!("fp{blocking}")),
        wait_event_type: Some("Lock".into()),
        wait_event: Some("transactionid".into()),
        wait_seconds: Some(wait),
        raw: None,
    }
}

#[test]
fn chain_single_edge_roots_at_the_blocker() {
    let chains = assemble_chains(&[sample(1070, 1069, 4.8)]);
    assert_eq!(chains.len(), 1);
    let c = &chains[0];
    assert_eq!(c.root.pid, 1069, "the holder is the root blocker");
    assert_eq!(c.blocked_count, 1);
    assert_eq!(c.depth, 1);
    assert!(!c.cyclic);
    assert_eq!(c.max_wait_seconds, 4.8);
    assert_eq!(c.root.children.len(), 1);
    assert_eq!(c.root.children[0].pid, 1070);
}

/// The case the proof explicitly leaves to us: `A→B→C` is ONE chain rooted at C,
/// not three unrelated pairs. This is what makes "kill the root blocker" possible.
#[test]
fn chain_multi_level_forms_one_tree_with_the_true_root() {
    // 3 waits on 2, 2 waits on 1, 1 blocks but waits for nobody.
    let chains = assemble_chains(&[sample(3, 2, 5.0), sample(2, 1, 9.0)]);
    assert_eq!(chains.len(), 1, "one tree, not two pairs");
    let c = &chains[0];
    assert_eq!(c.root.pid, 1, "root blocker is the session nobody blocks");
    assert_eq!(c.blocked_count, 2, "both 2 and 3 are blocked by the root");
    assert_eq!(c.depth, 2);
    assert_eq!(c.max_wait_seconds, 9.0);

    let mid = &c.root.children[0];
    assert_eq!(mid.pid, 2);
    assert_eq!(mid.depth, 1);
    assert_eq!(mid.children[0].pid, 3);
    assert_eq!(mid.children[0].depth, 2);
}

#[test]
fn chain_deep_five_level_keeps_a_single_root() {
    let chains = assemble_chains(&[
        sample(5, 4, 1.0),
        sample(4, 3, 2.0),
        sample(3, 2, 3.0),
        sample(2, 1, 4.0),
    ]);
    assert_eq!(chains.len(), 1);
    assert_eq!(chains[0].root.pid, 1);
    assert_eq!(chains[0].depth, 4);
    assert_eq!(chains[0].blocked_count, 4);
}

/// A cycle (a deadlock sampled BEFORE the engine aborted a victim) has no root.
/// A naive walk loops forever; assembly must terminate, flag it, and pick a
/// deterministic root.
#[test]
fn chain_cycle_terminates_and_is_flagged() {
    let chains = assemble_chains(&[sample(1, 2, 3.0), sample(2, 1, 4.0)]);
    assert_eq!(chains.len(), 1);
    let c = &chains[0];
    assert!(c.cyclic, "A→B→A must be reported as cyclic");
    assert_eq!(
        c.root.pid, 1,
        "cycle roots at the LOWEST pid, deterministically"
    );
    assert_eq!(c.blocked_count, 1);
}

#[test]
fn chain_three_way_cycle_terminates() {
    // The 3-way cycle the proof observed during rig calibration (181→179→180→181).
    let chains = assemble_chains(&[
        sample(181, 179, 1.0),
        sample(179, 180, 2.0),
        sample(180, 181, 3.0),
    ]);
    assert_eq!(chains.len(), 1);
    assert!(chains[0].cyclic);
    assert_eq!(chains[0].root.pid, 179, "lowest pid in the cycle");
    // Every member appears exactly once.
    assert_eq!(chains[0].blocked_count, 2);
}

/// `pg_blocking_pids()` can return a self-block in lock-type corner cases. It
/// carries no information and would form a degenerate 1-cycle.
#[test]
fn chain_self_block_is_dropped() {
    assert!(assemble_chains(&[sample(7, 7, 1.0)]).is_empty());
}

#[test]
fn chain_self_block_does_not_corrupt_a_real_chain() {
    let chains = assemble_chains(&[sample(7, 7, 1.0), sample(2, 1, 3.0)]);
    assert_eq!(chains.len(), 1);
    assert_eq!(chains[0].root.pid, 1);
    assert_eq!(chains[0].blocked_count, 1);
}

/// The blocker is usually NOT itself a blocked row — it is just holding a lock and
/// running fine, so it has no sample of its own. It must still appear as the root.
#[test]
fn chain_orphan_blocker_still_becomes_a_root() {
    let chains = assemble_chains(&[sample(100, 999, 2.0)]);
    assert_eq!(chains.len(), 1);
    assert_eq!(chains[0].root.pid, 999);
    // The root waits for nobody.
    assert_eq!(chains[0].root.wait_seconds, None);
    assert_eq!(
        chains[0].root.app.as_deref(),
        Some("app-999"),
        "root identity comes from the blocking_* side of the edge"
    );
}

/// One blocker, many victims — one tree with many children, deterministically
/// ordered (longest wait first) so the API response is stable across calls.
#[test]
fn chain_fanout_orders_children_by_wait_desc() {
    let chains = assemble_chains(&[sample(10, 1, 1.0), sample(11, 1, 9.0), sample(12, 1, 5.0)]);
    assert_eq!(chains.len(), 1);
    let kids: Vec<i64> = chains[0].root.children.iter().map(|c| c.pid).collect();
    assert_eq!(kids, vec![11, 12, 10], "longest wait first");
    assert_eq!(chains[0].blocked_count, 3);
    assert_eq!(chains[0].depth, 1);
}

/// Equal waits must still order deterministically (by pid) — otherwise the UI
/// reshuffles rows between identical requests.
#[test]
fn chain_ties_break_by_pid_deterministically() {
    let chains = assemble_chains(&[sample(30, 1, 2.0), sample(20, 1, 2.0), sample(25, 1, 2.0)]);
    let kids: Vec<i64> = chains[0].root.children.iter().map(|c| c.pid).collect();
    assert_eq!(kids, vec![20, 25, 30]);
}

/// A session reported with several direct blockers must land in exactly ONE tree
/// (the longest-waiting edge wins) — otherwise totals double-count it.
#[test]
fn chain_multiple_direct_blockers_pick_the_longest_wait() {
    let chains = assemble_chains(&[sample(5, 1, 2.0), sample(5, 2, 8.0)]);
    // Two roots (1 and 2), but 5 hangs off only the 8.0-second edge.
    let with_child: Vec<&_> = chains.iter().filter(|c| c.blocked_count > 0).collect();
    assert_eq!(with_child.len(), 1, "pid 5 belongs to exactly one tree");
    assert_eq!(with_child[0].root.pid, 2);
    assert_eq!(with_child[0].max_wait_seconds, 8.0);
}

/// Pids are only comparable within one server. Mixing instances would fabricate
/// chains between unrelated databases.
#[test]
fn chain_does_not_span_instances() {
    let mut a = sample(2, 1, 5.0);
    a.instance = Some("db-a".into());
    let mut b = sample(3, 2, 5.0);
    b.instance = Some("db-b".into());

    let chains = assemble_chains(&[a, b]);
    assert_eq!(chains.len(), 2, "one chain per instance, never joined");
    for c in &chains {
        assert_eq!(c.depth, 1, "no cross-instance transitive link");
    }
}

#[test]
fn chain_empty_input_yields_no_chains() {
    assert!(assemble_chains(&[]).is_empty());
}

/// Two independent trees rank worst-wait-first so the UI's top row is the worst
/// incident.
#[test]
fn chains_sort_by_severity() {
    let chains = assemble_chains(&[sample(2, 1, 1.0), sample(20, 10, 30.0)]);
    assert_eq!(chains.len(), 2);
    assert_eq!(chains[0].root.pid, 10, "worst wait first");
    assert_eq!(chains[0].max_wait_seconds, 30.0);
}

/// Round-trip: canonical record → stored JSON → sample → chain. This is exactly
/// the path the read endpoint takes, so a serialization mismatch surfaces here.
#[test]
fn blocking_record_round_trips_into_chain_assembly() {
    let s = canonicalize_blocking(&pg_blocking_record()).unwrap();
    let stored = Value::Object(s.to_record().into_iter().collect());
    let back = BlockingSample::from_record(&stored).expect("round-tripped");

    assert_eq!(back.blocked_pid, Some(1070));
    assert_eq!(back.blocking_pid, Some(1069));
    assert_eq!(back.wait_seconds, Some(4.818));

    let chains = assemble_chains(&[back]);
    assert_eq!(chains.len(), 1);
    assert_eq!(chains[0].root.pid, 1069);
}

#[test]
fn participant_round_trips_through_json() {
    let p = Participant {
        pid: Some(1071),
        app: Some("dbm-sv-deadlock-a".into()),
        user: Some("dbm".into()),
        query: Some("UPDATE accounts SET balance = balance - 1 WHERE id = 2".into()),
        query_norm: Some("UPDATE accounts SET balance = balance - ? WHERE id = ?".into()),
        fingerprint: Some("6d5a42124a5b5bc8".into()),
        lock_mode: Some("ShareLock".into()),
        lock_target: Some("transaction 1430".into()),
        transaction_id: Some("1429".into()),
        victim: true,
        // Postgres names its victim inline — no side correlation needed.
        side: None,
    };
    let back = Participant::from_json(
        &serde_json::to_value(json!({
            "pid": 1071,
            "app": "dbm-sv-deadlock-a",
            "user": "dbm",
            "query": "UPDATE accounts SET balance = balance - 1 WHERE id = 2",
            "query_norm": "UPDATE accounts SET balance = balance - ? WHERE id = ?",
            "fingerprint": "6d5a42124a5b5bc8",
            "lock_mode": "ShareLock",
            "lock_target": "transaction 1430",
            "transaction_id": "1429",
            "victim": true,
        }))
        .unwrap(),
    );
    assert_eq!(p, back);
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

/// A blocking sample must know its engine.
///
/// `sqlqueryreceiver` rows contain ONLY the columns the recipe selects — no `pg_*`/`my_*` field
/// and no `db_system` — so engine detection has to fall back to the recipe tag. Observed live:
/// every blocking row landed with `o2_dbm_engine = null`, which silently made the `?system=`
/// filter on `/blocking` match nothing.
#[test]
fn blocking_engine_is_derived_from_the_recipe_tag() {
    let pg = canonicalize_blocking(&pg_blocking_record()).expect("pg blocking");
    assert_eq!(
        pg.engine.as_deref(),
        Some("postgresql"),
        "pg_blocking_chain rows must resolve to postgresql"
    );

    let mut my = pg_blocking_record();
    my.insert("o2_recipe".into(), json!("mysql_lock_waits"));
    let my = canonicalize_blocking(&my).expect("mysql blocking");
    assert_eq!(my.engine.as_deref(), Some("mysql"));

    let mut ms = pg_blocking_record();
    ms.insert("o2_recipe".into(), json!("mssql_blocking_chain"));
    let ms = canonicalize_blocking(&ms).expect("mssql blocking");
    assert_eq!(ms.engine.as_deref(), Some("mssql"));
}

/// SQL Server blocking must survive the full ingest entry point, not just the
/// blocking canonicalizer.
///
/// `canonicalize_record` dispatches on the recipe tag, so an engine can pass
/// `canonicalize_blocking` in isolation and still be dropped at ingest if its
/// tag is missing from that match arm — which is exactly the shape of bug this
/// asserts against. Note this covers BLOCKING only: SQL Server deadlocks arrive
/// as an XML deadlock graph and have no parser yet.
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
    // `canonicalize_record` also compares o2_*_event fields to "deadlock"; that
    // is an event value, not a recipe tag, and is pinned separately below.
    out.remove("deadlock");
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

/// The const must name the flattened key exactly. Every other test would still
/// pass if the const and the producer loop agreed on a WRONG name, so the wire
/// contract is pinned literally, once.
#[test]
fn o2_event_name_const_is_the_wire_key() {
    assert_eq!(
        server_vantage::O2_EVENT_NAME,
        "o2_event_name",
        "the flattened key is part of the ingest wire contract"
    );
}

// ─── D-I · reservation against spoofing ──────────────────────────────────────

/// D-I: `o2_event_name` must be in `ALL_DBM_FIELDS` so `apply_to_record`'s strip
/// loop removes caller-supplied values.
///
/// Spec X7: Revision 1 claimed the canonicalizer would remove it instead, but
/// `canonicalize_record` takes `&Map` (immutable, `server_vantage.rs:981`) and
/// cannot remove anything. Reservation is the only mechanism that works.
#[test]
fn o2_event_name_is_a_reserved_field() {
    assert!(
        server_vantage::ALL_DBM_FIELDS.contains(&server_vantage::O2_EVENT_NAME),
        "o2_event_name must be reserved, or a caller can POST one to /_json and \
         forge an engine-derived record (spec D-I)"
    );
}

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

/// Reservation must not damage the pre-existing strip list. `ALL_DBM_FIELDS` does
/// triple duty — write-side strip, read-side projection allowlist
/// (`api.rs:1806-1810`), and schema gate (spec §5.1) — so a bump that dropped an
/// entry would silently break DBM reads.
#[test]
fn reserving_event_name_keeps_every_pre_existing_reserved_field() {
    for pre_existing in [
        "o2_dbm_kind",
        "o2_dbm_engine",
        "o2_dbm_database",
        "o2_dbm_instance",
        "o2_dbm_timestamp",
        "o2_dbm_raw",
        "o2_dbm_victim_pid",
        "o2_dbm_participants",
        "o2_dbm_participant_count",
        "o2_dbm_victim_side",
        "o2_dbm_blocked_pid",
        "o2_dbm_blocked_app",
        "o2_dbm_blocked_query",
        "o2_dbm_blocked_fingerprint",
        "o2_dbm_blocking_pid",
        "o2_dbm_blocking_app",
        "o2_dbm_blocking_query",
        "o2_dbm_blocking_fingerprint",
        "o2_dbm_wait_event_type",
        "o2_dbm_wait_event",
        "o2_dbm_wait_seconds",
        "o2_dbm_query_shape",
    ] {
        assert!(
            server_vantage::ALL_DBM_FIELDS.contains(&pre_existing),
            "{pre_existing} must stay reserved — ALL_DBM_FIELDS is also the read-side \
             projection allowlist, so dropping an entry breaks reads"
        );
    }
    assert_eq!(
        server_vantage::ALL_DBM_FIELDS.len(),
        23,
        "22 pre-existing fields + o2_event_name; bump this deliberately"
    );
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

/// The no-regression guarantee must hold for the DBM records that DO canonicalize
/// today: the deadlock path must not gain an `o2_event_name` column just because
/// W1 exists.
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

/// The producer loop must RE-INSERT the trusted event name after the strip.
///
/// Spec D-I: "The OTLP producer loop re-inserts the trusted value **after** the
/// strip." This is the other half of
/// `apply_to_record_strips_the_event_name_it_cannot_authenticate` — the strip is
/// unconditional because provenance is invisible inside `apply_to_record`, so the
/// only place the trusted value can be restored is where `log_record` is still in
/// scope. Without this the field is plumbed to nowhere and W1 delivers nothing.
///
/// Why this is safe from spoofing on the OTLP path: the producer loop writes the
/// value AFTER `log_record.attributes` are copied onto `rec` (verified: attributes
/// are copied at ~byte 7812, trace_id/span_id are written at ~8033 for exactly this
/// reason), so an attacker-supplied attribute named `o2_event_name` is overwritten
/// by the receiver's own value rather than trusted.
#[test]
fn otlp_reinserts_the_trusted_event_name_after_canonicalization() {
    let src = include_str!("../../logs/otlp.rs");
    let apply_at = src
        .find("server_vantage::apply_to_record")
        .expect("otlp.rs must call apply_to_record");

    // A write of the reserved key must exist AFTER the first apply_to_record call,
    // or the strip leaves nothing behind.
    let after = &src[apply_at..];
    assert!(
        after.contains("O2_EVENT_NAME"),
        "the producer loop must re-insert the trusted event name AFTER \
         apply_to_record strips it (spec D-I); otherwise the reservation deletes \
         the very value W1 exists to deliver"
    );

    // And that re-insertion must still be guarded on non-empty, so an ordinary log
    // line does not acquire the column.
    let reinsert_rel = after.find("O2_EVENT_NAME").expect("checked above");
    let head = &after[..reinsert_rel];
    assert!(
        head.contains("event_name.is_empty()") || head.contains("event_name_value"),
        "the re-insertion must be guarded on a non-empty event name so records \
         without one stay byte-identical"
    );
}

/// EVERY `apply_to_record` call site in `otlp.rs` must restore the event name across
/// the strip. All three can.
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

/// The event name must be written AFTER the `_original` snapshot.
///
/// `_original` is a verbatim copy of what the customer sent, replayed on recovery.
/// Writing a synthesized field into it makes the copy non-verbatim. Nothing forces
/// the write to precede the snapshot — the anti-spoof property only requires it to
/// follow the attribute copy — so this ordering is free.
#[test]
fn the_event_name_is_written_after_the_original_snapshot() {
    let src = include_str!("../../logs/otlp.rs");
    let insert_at = event_name_insertion_offset(src);
    let snapshot_at = src
        .find("let original_data = if rec.is_object()")
        .expect("the producer loop must still snapshot original_data");
    assert!(
        insert_at > snapshot_at,
        "the event name must be written AFTER the _original snapshot, so _original \
         stays a verbatim copy of the customer's payload"
    );
}

/// Writing the column must be gated on `db_monitoring.enabled`, matching
/// `apply_to_record`'s own early return.
///
/// Without the gate an operator who set `ZO_DB_MONITORING_ENABLED=false` still gets a
/// DBM column written onto every receiver record, for a feature they turned off.
#[test]
fn writing_the_event_name_is_gated_on_db_monitoring_enabled() {
    let src = include_str!("../../logs/otlp.rs");
    for w in event_name_write_offsets(src) {
        // The enclosing guard for a producer-loop write must also test the config.
        // (The replay site restores a value already on the record and is reached
        // only when the producer wrote it, so it inherits the gate.)
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

/// The OTLP producer loop must surface `event_name` onto the record.
///
/// `handle_request` is async and writes through infra, so like the pre-existing
/// `every_logs_ingest_path_applies_canonicalization` guard above, the wiring is
/// asserted on the source. The behavior it guards is measured: with the field
/// unplumbed, a LogRecord carrying `EventName = "db.server.top_query"` reaches
/// `apply_to_record` as `{_timestamp, body, dropped_attributes_count,
/// postgresql_calls, severity}` — no event name anywhere.
///
/// Spec D-A correction 1: the insertion MUST be in the producer loop, where
/// `log_record` is in scope, NOT at the three `apply_to_record` call sites — site
/// `:382` iterates pipeline results where `log_record` does not exist. One
/// insertion there covers both the pipeline and non-pipeline branches.
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
}

/// The FIRST write must precede attribute-independent tampering, and must come
/// before flattening — i.e. it lives in the producer loop, not after.
///
/// NOT "before apply_to_record so the canonicalizer can see it": that rationale is
/// false, because the reservation strip removes the field before any canonicalizer
/// arm could read it. The real reason the early write exists is ANTI-SPOOF — it is
/// written after `log_record.attributes` are copied onto `rec`, so a receiver
/// attribute literally named `o2_event_name` is overwritten by the trusted value
/// rather than winning. That is the same slot and the same reason `trace_id` and
/// `span_id` are written where they are.
#[test]
fn the_first_event_name_write_overwrites_any_caller_attribute() {
    let src = include_str!("../../logs/otlp.rs");
    let insert_at = event_name_insertion_offset(src);

    let attrs_copied = src
        .find("log_record.attributes.iter().for_each")
        .expect("the producer loop must still copy log_record attributes onto rec");
    assert!(
        insert_at > attrs_copied,
        "the event name must be written AFTER log_record.attributes are copied, so a \
         receiver attribute named o2_event_name cannot beat the trusted value \
         (same protection trace_id/span_id get)"
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

/// Both writes must be GUARDED on a non-empty event name.
///
/// Checked by BRACE BALANCE, not byte distance. A fixed-size window is bypassable:
/// an unguarded insert placed just after an unrelated CLOSED
/// `if !log_record.event_name.is_empty() { ... }` block sits a few bytes from a
/// matching `rfind` and passes, while adding an empty column to every log line in
/// the product — the exact whole-product regression W1 must avoid.
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
        // Walk backwards from the write, tracking brace depth, to find the
        // innermost `if` block that still encloses it.
        let head = &src[..w];
        let mut depth = 0i32;
        let mut enclosing = None;
        for (i, ch) in head.char_indices().rev() {
            match ch {
                '}' => depth += 1,
                '{' => {
                    if depth == 0 {
                        // An unclosed `{` — this block encloses the write.
                        let line_start = head[..i].rfind('\n').map(|n| n + 1).unwrap_or(0);
                        enclosing = Some(&head[line_start..i]);
                        break;
                    }
                    depth -= 1;
                }
                _ => {}
            }
        }
        let enclosing = enclosing.expect("a write must sit inside some block");
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
    }
}
