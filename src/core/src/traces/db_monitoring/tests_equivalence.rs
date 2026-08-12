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

//! Cross-SDK fingerprint-equivalence suite over the CAPTURED corpus
//! (`corpus/captured_*.json`, extracted from real scrubbed SDK fixtures by
//! `tests/dbm-capture/extract/extract.py`; provenance in `tests/dbm-capture/MANIFEST.md`).
//!
//! The captured `fingerprint_class` values encode expected fingerprint equality per
//! (engine, workload step) as scoped by the MANIFEST equivalence classes:
//! text cells share one class; degraded shapes (`-opcoll` pymongo command-name-only,
//! `-unknown` go otelsql DisableQuery, `-argshidden` node redis serializer,
//! `-masked` Connector/J) and per-driver serializations (`-py` / `-node` mongo docs)
//! carry suffixed classes that must NOT collide with the text class.
//!
//! Flagship: the MANIFEST appendix S01 anchors — one logical statement captured with
//! four placeholder styles (java `?`, Npgsql `@p1`, psycopg2 `%s`, node `$1`) — MUST
//! all land on ONE fingerprint.

use std::collections::BTreeMap;

use super::{
    O2_DB_FINGERPRINT,
    tests::{CAPTURED_FILES, Case, check_case, load, out_str},
};

fn captured_cases() -> Vec<Case> {
    CAPTURED_FILES.iter().flat_map(|f| load(f)).collect()
}

/// Fingerprint of one captured case, via the full `enrich` path (asserts the whole
/// record on the way, same as the table tests).
fn fingerprint_of(case: &Case) -> String {
    let out = check_case(case)
        .unwrap_or_else(|| panic!("captured case {} must produce a record", case.id));
    out_str(&out, O2_DB_FINGERPRINT).expect("fingerprint always present")
}

fn fingerprint_by_id(cases: &[Case], id: &str) -> String {
    let case = cases
        .iter()
        .find(|c| c.id == id)
        .unwrap_or_else(|| panic!("captured corpus is missing case {id}"));
    fingerprint_of(case)
}

fn class_groups(cases: &[Case]) -> BTreeMap<String, Vec<(String, String)>> {
    let mut groups: BTreeMap<String, Vec<(String, String)>> = BTreeMap::new();
    for case in cases {
        let (Some(class), Some(_)) = (&case.fingerprint_class, &case.expect) else {
            continue;
        };
        let fp = fingerprint_of(case);
        groups
            .entry(class.clone())
            .or_default()
            .push((case.id.clone(), fp));
    }
    groups
}

/// Every captured equivalence group with >= 2 members (an engine x step captured from
/// two or more SDKs/modes) must converge on exactly ONE fingerprint.
#[test]
fn captured_cross_sdk_groups_converge() {
    let cases = captured_cases();
    let groups = class_groups(&cases);
    let mut multi = 0usize;
    for (class, members) in &groups {
        let fps: std::collections::BTreeSet<&str> =
            members.iter().map(|(_, fp)| fp.as_str()).collect();
        assert_eq!(
            fps.len(),
            1,
            "captured class {class} splintered across SDKs: {members:?}"
        );
        if members.len() >= 2 {
            multi += 1;
        }
    }
    // The suite must actually exercise cross-SDK convergence, not vacuously pass.
    assert!(
        multi >= 15,
        "expected >= 15 multi-member cross-SDK groups, found {multi} ({:?})",
        groups
            .iter()
            .map(|(c, m)| (c.as_str(), m.len()))
            .collect::<Vec<_>>()
    );
}

/// MANIFEST appendix anchors: `SELECT id, name, price FROM dbm_items WHERE id = <ph>`
/// as captured with all four placeholder styles binds to ONE fingerprint.
#[test]
fn flagship_s01_placeholder_styles_bind_to_one_fingerprint() {
    let cases = captured_cases();
    let anchors = [
        ("java `?`", "cap-s01-java-legacy-jdbc-qmark"),
        ("npgsql `@p1`", "cap-s01-dotnet-pg9-npgsql-at-p1"),
        ("psycopg2 `%s`", "cap-s01-python-pg-legacy-pct-s"),
        ("node `$1`", "cap-s01-node-pg-era-legacy-dollar"),
    ];
    let fps: Vec<(&str, String)> = anchors
        .iter()
        .map(|(style, id)| (*style, fingerprint_by_id(&cases, id)))
        .collect();
    let first = &fps[0].1;
    for (style, fp) in &fps {
        assert_eq!(
            fp, first,
            "S01 anchor {style} splintered from the shared fingerprint: {fps:?}"
        );
    }
    // The dual-semconv proof rides the same class: new-vocabulary captures of the
    // same statement (db.query.text / db.system.name) resolve identically.
    for id in [
        "cap-s01-node-pg-cur-new-vocab",
        "cap-s01-dotnet-pg10-new-vocab",
        "cap-s01-python-pg-new-vocab",
    ] {
        assert_eq!(
            &fingerprint_by_id(&cases, id),
            first,
            "new-semconv S01 capture {id} split from the anchor fingerprint"
        );
    }
}

/// Degraded equivalence classes (operation-collection, unknown-bucket, arg-hidden,
/// driver-masked) must NOT collide with their step's text-class fingerprint, and the
/// two mongo text serializations (pymongo dict-repr vs node masked JSON) are distinct
/// shapes by design.
#[test]
fn degraded_classes_differ_from_text_classes() {
    let cases = captured_cases();
    let fp = |id: &str| fingerprint_by_id(&cases, id);

    // pymongo capture_statement=False (operation-collection cell) vs both text shapes.
    let opcoll = fp("cap-mongo-s01-opcoll-legacy");
    let py_text = fp("cap-mongo-s01-py-stmt-legacy");
    let node_text = fp("cap-mongo-s01-node-cur");
    assert_ne!(
        opcoll, py_text,
        "opcoll degraded S01 collided with pymongo text class"
    );
    assert_ne!(
        opcoll, node_text,
        "opcoll degraded S01 collided with node text class"
    );
    assert_ne!(
        py_text, node_text,
        "distinct mongo serializations must not collide"
    );

    // go otelsql DisableQuery (unknown bucket) vs the SQL S01 text class.
    let unknown = fp("cap-go-pg-disablequery-unknown-bucket");
    let sql_s01 = fp("cap-s01-python-pg-legacy-pct-s");
    assert_ne!(
        unknown, sql_s01,
        "unknown-bucket collided with the S01 text class"
    );

    // node redis serializer hides every MGET key ("[N other arguments]") vs jedis text.
    let args_hidden = fp("cap-redis-s03-node-cur-argshidden");
    let mget_text = fp("cap-redis-s03-java-legacy-arity3");
    assert_ne!(
        args_hidden, mget_text,
        "arg-hidden node MGET collided with the keyed MGET text class"
    );

    // Connector/J native driver-masked statement vs the real S01 text class.
    let masked = fp("cap-connectorj-masked-select");
    assert_ne!(
        masked, sql_s01,
        "Connector/J masked text collided with the S01 text class"
    );
}

// ─── Cross-vantage convergence: pg_stat_statements re-spacing (W3 plan join) ──
//
// The CLIENT vantage sees driver text (`count(*)`, `(a, b, c)`); the SERVER
// vantage sees text Postgres's own jumbler already rewrote, which pads every
// parenthesis and comma with spaces (`count ( * )`, `( a, b, c )`). Both texts
// name ONE statement, so both MUST hash to one fingerprint — otherwise the
// stored plan is invisible under the client's fingerprint and the UI says "No
// plan for this query" while the plan sits in `dbm_server`.
//
// Every SERVER string below is verbatim `o2_dbm_activity_query` captured off the
// live rig (`dbm_server`, `o2_dbm_kind='top_query'`), and every CLIENT string is
// the paired `query_norm` from `/traces/db_monitoring/queries` — producer output,
// not hand-written approximations.

/// Pair a CLIENT statement text with the SERVER text of the SAME statement and
/// assert one fingerprint. Both go through the public normalizer, so this is a
/// real two-vantage assertion, not a canonicalizer reproducing its own output.
fn assert_vantages_converge(label: &str, client: &str, server: &str) {
    use super::normalizer::{Dialect, normalize};
    let c = normalize(client, Dialect::Postgresql)
        .unwrap_or_else(|e| panic!("{label}: client text failed to normalize: {e}"));
    let s = normalize(server, Dialect::Postgresql)
        .unwrap_or_else(|e| panic!("{label}: server text failed to normalize: {e}"));
    assert_eq!(
        c.fingerprint, s.fingerprint,
        "{label}: vantages split.\n  CLIENT {} <- {client}\n  SERVER {} <- {server}",
        c.fingerprint, s.fingerprint
    );
}

/// The reported defect: every INSERT missed its plan because pg pads the column
/// list. 29k-calls-a-day statement, measured invisible in the UI.
#[test]
fn insert_column_list_respacing_converges_across_vantages() {
    assert_vantages_converge(
        "order_lines insert",
        "INSERT INTO order_lines (order_id, sku, qty) VALUES (%s, %s, %s)",
        "INSERT INTO order_lines ( order_id, sku, qty ) VALUES (?)",
    );
    assert_vantages_converge(
        "audit_log insert",
        "INSERT INTO audit_log (actor, action) VALUES ($1, $2)",
        "INSERT INTO audit_log ( actor, action ) VALUES (?)",
    );
    // RETURNING rides along — it is not itself a divergence source.
    assert_vantages_converge(
        "orders insert returning",
        "INSERT INTO orders (customer_ref, account_id, sku, amount, note) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        "INSERT INTO orders ( customer_ref, account_id, sku, amount, note ) VALUES (?) RETURNING id",
    );
}

/// Function-call re-spacing (`count(*)` → `count ( * )`) — the other half of the
/// measured misses, and the reason aggregate SELECTs missed too.
#[test]
fn function_call_respacing_converges_across_vantages() {
    assert_vantages_converge(
        "count star",
        "SELECT status, count(*) FROM demo_orders WHERE status = $1 GROUP BY status",
        "SELECT status, count ( * ) FROM demo_orders WHERE status = ? GROUP BY status",
    );
    assert_vantages_converge(
        "two aggregates",
        "SELECT count(*), sum(amount) FROM orders WHERE customer_ref = $1",
        "SELECT count ( * ), sum ( amount ) FROM orders WHERE customer_ref = ?",
    );
    assert_vantages_converge(
        "qualified arg",
        "SELECT o.customer_ref, count(l.id) FROM orders o JOIN order_lines l ON l.order_id = o.id GROUP BY o.customer_ref",
        "SELECT o.customer_ref, count ( l.id ) FROM orders o JOIN order_lines l ON l.order_id = o.id GROUP BY o.customer_ref",
    );
}

/// Keyword case is already folded for hashing; re-spacing must not depend on it.
/// (`SELECT COUNT(*)` client vs `SELECT count ( * )` server — both seen live.)
#[test]
fn respacing_converges_independently_of_keyword_case() {
    assert_vantages_converge(
        "upper client, lower server",
        "SELECT COUNT(*), SUM(amount) FROM orders WHERE customer_ref = $1",
        "SELECT count ( * ), sum ( amount ) FROM orders WHERE customer_ref = ?",
    );
}

/// Whitespace-insensitivity must NOT dissolve real distinctions. Statements that
/// differ in TOKENS stay apart — otherwise the fix trades a miss for a wrong plan,
/// which is worse: a wrong plan looks authoritative.
#[test]
fn respacing_tolerance_does_not_merge_distinct_statements() {
    use super::normalizer::{Dialect, normalize};
    let fp = |t: &str| normalize(t, Dialect::Postgresql).unwrap().fingerprint;

    // Different table.
    assert_ne!(
        fp("INSERT INTO orders ( a, b ) VALUES (?)"),
        fp("INSERT INTO order_lines ( a, b ) VALUES (?)"),
        "different tables collapsed together"
    );
    // Different column arity in the column LIST (not the placeholder list).
    assert_ne!(
        fp("INSERT INTO t (a, b) VALUES (?)"),
        fp("INSERT INTO t (a, b, c) VALUES (?)"),
        "different column lists collapsed together"
    );
    // RETURNING is a real difference between two statements.
    assert_ne!(
        fp("INSERT INTO t (a) VALUES (?)"),
        fp("INSERT INTO t (a) VALUES (?) RETURNING id"),
        "RETURNING clause was dissolved"
    );
    // Different aggregate function.
    assert_ne!(
        fp("SELECT count ( * ) FROM t"),
        fp("SELECT sum ( * ) FROM t"),
        "different functions collapsed together"
    );
    // A space is not a token boundary eraser: `a b` (alias) != `ab`.
    assert_ne!(
        fp("SELECT a b FROM t"),
        fp("SELECT ab FROM t"),
        "whitespace between two words was erased, merging an alias into one identifier"
    );
    // Words following a placeholder keep their own separation. (Note: `? marker`
    // and `?marker` DO hash alike, and correctly so — no word can begin with `?`,
    // so the lexer yields the same two tokens either way. What must survive is the
    // boundary between the WORDS that follow.) Shape taken from the live workload:
    // `SELECT pg_sleep(?), ? AS marker`.
    assert_ne!(
        fp("SELECT ? AS marker FROM t"),
        fp("SELECT ? marker FROM t"),
        "an aliased placeholder collapsed into a bare one"
    );
    assert_ne!(
        fp("SELECT ? marker FROM t"),
        fp("SELECT ? mark er FROM t"),
        "separator after a placeholder failed to keep following words apart"
    );
    // Two adjacent QUOTED identifiers are two tokens; `"a""b"` is ONE identifier
    // carrying an escaped quote. Dropping the separator between quoted tokens
    // would merge a two-column select into a one-column one.
    assert_ne!(
        fp(r#"SELECT "a" "b" FROM t"#),
        fp(r#"SELECT "a""b" FROM t"#),
        "separator between two quoted identifiers was dropped, fusing them into one"
    );
    // Operators keep their operands apart.
    assert_ne!(
        fp("SELECT a - b FROM t"),
        fp("SELECT a, b FROM t"),
        "operator and comma were conflated"
    );
}

/// Whitespace tolerance is a property of the hash, not of the DISPLAY text: the
/// stored `query_norm` still shows the author's spacing, because it is what the
/// user reads on the page.
#[test]
fn respacing_tolerance_does_not_rewrite_display_text() {
    use super::normalizer::{Dialect, normalize};
    let n = normalize(
        "INSERT INTO order_lines ( order_id, sku, qty ) VALUES (?)",
        Dialect::Postgresql,
    )
    .unwrap();
    assert_eq!(
        n.query_norm.as_deref(),
        Some("INSERT INTO order_lines ( order_id, sku, qty ) VALUES (?)"),
        "display text must preserve the source spacing"
    );
}

/// Convergence must hold through the SERVER-VANTAGE entry point too, not just the
/// bare normalizer: `fingerprint_statement` is what `canonicalize_top_query` calls,
/// and it is the function whose output lands in `o2_dbm_fingerprint`.
#[test]
fn server_vantage_entry_point_converges_with_client_span() {
    use super::{
        normalizer::{Dialect, normalize},
        server_vantage::fingerprint_statement,
    };
    let client = normalize(
        "INSERT INTO order_lines (order_id, sku, qty) VALUES (%s, %s, %s)",
        Dialect::Postgresql,
    )
    .unwrap()
    .fingerprint;
    let (_norm, server) = fingerprint_statement(
        "INSERT INTO order_lines ( order_id, sku, qty ) VALUES (?)",
        Some("postgresql"),
    );
    assert_eq!(
        Some(client),
        server,
        "server-vantage fingerprint_statement did not converge with the client span fingerprint"
    );
}

/// MySQL/performance_schema re-spaces the same way (`ifnull ( x, ? )`), so the
/// tolerance must not be Postgres-only — the MySQL top_query feed joins on the
/// same key.
#[test]
fn mysql_vantage_respacing_converges() {
    use super::normalizer::{Dialect, normalize};
    let c = normalize(
        "SELECT sku, sum(amount_cents) FROM demo_orders WHERE sku = ? GROUP BY sku",
        Dialect::Mysql,
    )
    .unwrap();
    let s = normalize(
        "SELECT sku, sum ( amount_cents ) FROM demo_orders WHERE sku = ? GROUP BY sku",
        Dialect::Mysql,
    )
    .unwrap();
    assert_eq!(
        c.fingerprint, s.fingerprint,
        "mysql vantages split on re-spacing"
    );
}
