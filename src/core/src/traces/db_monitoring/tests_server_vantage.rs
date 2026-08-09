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
        BlockingSample, Participant, canonicalize_blocking, canonicalize_mysql_deadlock,
        canonicalize_pg_deadlock, canonicalize_record, fingerprint_statement,
        merge_mysql_deadlocks,
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
    let side1 = obj(json!({
        "_timestamp": 1_786_166_303_139_783i64,
        "o2_my_event": "deadlock",
        "my_trx_side": "1",
        "my_trx_id": "4589",
        "my_trx_thread": "89",
        "my_trx_query": "UPDATE accounts SET balance = balance - 1 WHERE id = 11",
        "my_victim_side": "1",
    }));
    let ev = canonicalize_mysql_deadlock(&side1).expect("side 1 canonicalized");
    assert_eq!(ev.engine.as_deref(), Some("mysql"));
    assert_eq!(ev.participants.len(), 1);
    assert_eq!(ev.participants[0].pid, Some(89));
    assert_eq!(ev.participants[0].transaction_id.as_deref(), Some("4589"));
    assert!(ev.participants[0].victim, "side 1 was rolled back");
    assert_eq!(ev.victim_pid, Some(89));
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
