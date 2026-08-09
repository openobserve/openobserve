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
