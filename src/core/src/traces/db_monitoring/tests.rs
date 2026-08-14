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

//! Golden-corpus table tests for the DBM normalizer/enrichment
//! (spec: `docs/___databsepages/plans-and-specs/2026-08-07-dbm-phase1-test-approach-design.md` §2).
//!
//! RED-phase rules encoded here:
//! - fingerprints are asserted via EQUALITY CLASSES (`fingerprint_class`), never literal hashes —
//!   the hash manifest joins only after first green, together with the `fp_version` meta-test;
//! - every other `expect` field is asserted literally against the full `o2_db_*` record;
//! - the NFR-2 blanket invariant: no declared literal from ANY case may appear as a substring of
//!   `query_norm` in ANY case — raw-text fallback can never make the suite green.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde_json::{Map, Value};

use super::*;

// ---------------------------------------------------------------------------
// Case schema (spec §2 "case file schema"; JSON because the workspace carries
// no YAML dependency — same shape, `.json` extension)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
pub(super) struct Case {
    pub(super) id: String,
    #[serde(default)]
    dialect: Option<String>,
    input: CaseInput,
    /// `null` = enrich must return `None` (negative stamping).
    #[serde(default)]
    pub(super) expect: Option<Expect>,
    #[serde(default)]
    pub(super) fingerprint_class: Option<String>,
    #[serde(default)]
    literals: Vec<String>,
    /// Never read — but REQUIRED (no `#[serde(default)]`) so every corpus case must declare
    /// its provenance or deserialization fails. Schema enforcement, not dead code.
    #[allow(dead_code)]
    source: String,
}

#[derive(Debug, serde::Deserialize)]
struct CaseInput {
    attrs: Map<String, Value>,
    span_kind: i32,
}

#[derive(Debug, serde::Deserialize)]
pub(super) struct Expect {
    #[serde(default)]
    query_norm: Option<String>,
    #[serde(default)]
    operation: Option<String>,
    #[serde(default)]
    stmt_class: Option<String>,
    #[serde(default)]
    system: Option<String>,
    #[serde(default)]
    namespace: Option<String>,
    #[serde(default)]
    instance: Option<String>,
    #[serde(default)]
    env: Option<String>,
    #[serde(default)]
    status_code: Option<String>,
    #[serde(default)]
    user: Option<String>,
    #[serde(default)]
    batch_multiplier: Option<i64>,
}

const CORPUS: &[(&str, &str)] = &[
    (
        "placeholders_case",
        include_str!("corpus/placeholders_case.json"),
    ),
    ("in_lists", include_str!("corpus/in_lists.json")),
    (
        "dialect_quoting",
        include_str!("corpus/dialect_quoting.json"),
    ),
    ("sqlcommenter", include_str!("corpus/sqlcommenter.json")),
    ("identifiers", include_str!("corpus/identifiers.json")),
    ("batches_tcl", include_str!("corpus/batches_tcl.json")),
    ("stmt_class", include_str!("corpus/stmt_class.json")),
    ("redis", include_str!("corpus/redis.json")),
    ("mongodb", include_str!("corpus/mongodb.json")),
    ("elasticsearch", include_str!("corpus/elasticsearch.json")),
    (
        "cassandra_clickhouse",
        include_str!("corpus/cassandra_clickhouse.json"),
    ),
    ("semconv", include_str!("corpus/semconv.json")),
    (
        "instance_status",
        include_str!("corpus/instance_status.json"),
    ),
    ("fallbacks", include_str!("corpus/fallbacks.json")),
    ("negative", include_str!("corpus/negative.json")),
    // Captured corpus: real scrubbed SDK fixtures (tests/dbm-capture/fixtures),
    // extracted by tests/dbm-capture/extract/extract.py.
    ("captured_sql", include_str!("corpus/captured_sql.json")),
    ("captured_redis", include_str!("corpus/captured_redis.json")),
    (
        "captured_mongodb",
        include_str!("corpus/captured_mongodb.json"),
    ),
    (
        "captured_degraded",
        include_str!("corpus/captured_degraded.json"),
    ),
];

/// The captured-corpus file names (the cross-SDK equivalence suite iterates these).
pub(super) const CAPTURED_FILES: &[&str] = &[
    "captured_sql",
    "captured_redis",
    "captured_mongodb",
    "captured_degraded",
];

pub(super) fn load(name: &str) -> Vec<Case> {
    let (_, raw) = CORPUS
        .iter()
        .find(|(n, _)| *n == name)
        .unwrap_or_else(|| panic!("unknown corpus file: {name}"));
    serde_json::from_str(raw).unwrap_or_else(|e| panic!("corpus {name} is malformed: {e}"))
}

fn load_all() -> Vec<Case> {
    CORPUS.iter().flat_map(|(name, _)| load(name)).collect()
}

fn dialect_from_str(s: &str) -> Dialect {
    match s {
        "postgresql" => Dialect::Postgresql,
        "mysql" => Dialect::Mysql,
        "mariadb" => Dialect::Mariadb,
        "mssql" => Dialect::Mssql,
        "oracle" => Dialect::Oracle,
        "cockroachdb" => Dialect::Cockroachdb,
        "cassandra" => Dialect::Cassandra,
        "clickhouse" => Dialect::Clickhouse,
        "redis" => Dialect::Redis,
        "mongodb" => Dialect::Mongodb,
        "elasticsearch" => Dialect::Elasticsearch,
        other => panic!("corpus dialect not in the routing table: {other}"),
    }
}

fn statement_text(case: &Case) -> Option<String> {
    // Same dual-semconv resolution order the enrichment uses.
    case.input
        .attrs
        .get("db.query.text")
        .or_else(|| case.input.attrs.get("db.statement"))
        .and_then(Value::as_str)
        .map(String::from)
}

pub(super) fn out_str(out: &BTreeMap<String, Value>, key: &str) -> Option<String> {
    out.get(key).and_then(Value::as_str).map(String::from)
}

fn assert_str_field(id: &str, out: &BTreeMap<String, Value>, key: &str, expect: &Option<String>) {
    assert_eq!(
        out_str(out, key).as_deref(),
        expect.as_deref(),
        "case {id}: field {key} mismatch (absent key <=> null expect; never a leaked raw value)"
    );
}

/// Run enrich for one case and assert the full `o2_db_*` record (everything except the
/// fingerprint value, which is only class-asserted in the red phase).
pub(super) fn check_case(case: &Case) -> Option<BTreeMap<String, Value>> {
    let out = enrich(&case.input.attrs, case.input.span_kind);
    match &case.expect {
        None => {
            assert!(
                out.is_none(),
                "case {}: negative-stamping violated — expected NO o2_db_* keys, got {:?}",
                case.id,
                out
            );
            None
        }
        Some(exp) => {
            let out = out.unwrap_or_else(|| {
                panic!(
                    "case {}: expected an o2_db_* record, enrich returned None",
                    case.id
                )
            });
            // Fingerprint: always present, 16 lowercase hex chars (design §3.1). The VALUE is
            // asserted only through equality classes — never a literal hash in the red phase.
            let fp = out_str(&out, O2_DB_FINGERPRINT)
                .unwrap_or_else(|| panic!("case {}: o2_db_fingerprint missing", case.id));
            assert!(
                fp.len() == 16 && fp.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
                "case {}: fingerprint must be 16-hex lowercase, got {fp:?}",
                case.id
            );
            assert_str_field(&case.id, &out, O2_DB_QUERY_NORM, &exp.query_norm);
            assert_str_field(&case.id, &out, O2_DB_OPERATION, &exp.operation);
            assert_str_field(&case.id, &out, O2_DB_STMT_CLASS, &exp.stmt_class);
            assert_str_field(&case.id, &out, O2_DB_SYSTEM, &exp.system);
            assert_str_field(&case.id, &out, O2_DB_NAMESPACE, &exp.namespace);
            assert_str_field(&case.id, &out, O2_DB_INSTANCE, &exp.instance);
            assert_str_field(&case.id, &out, O2_DB_ENV, &exp.env);
            assert_str_field(&case.id, &out, O2_DB_STATUS_CODE, &exp.status_code);
            assert_str_field(&case.id, &out, O2_DB_USER, &exp.user);
            match exp.batch_multiplier {
                None => assert!(
                    !out.contains_key(O2_DB_BATCH_MULTIPLIER),
                    "case {}: o2_db_batch_multiplier written without a batch collapse",
                    case.id
                ),
                Some(n) => assert_eq!(
                    out.get(O2_DB_BATCH_MULTIPLIER).and_then(Value::as_i64),
                    Some(n),
                    "case {}: o2_db_batch_multiplier must be Int64 {n}",
                    case.id
                ),
            }
            // No stray keys: the record is exactly a subset of the 11 reserved columns.
            for key in out.keys() {
                assert!(
                    ALL_DB_FIELDS.contains(&key.as_str()),
                    "case {}: enrich emitted unreserved key {key}",
                    case.id
                );
            }
            Some(out)
        }
    }
}

fn run_file(name: &str) {
    let cases = load(name);
    assert!(!cases.is_empty(), "corpus file {name} has no cases");
    for case in &cases {
        check_case(case);
    }
}

// -- the table test over every corpus file -----------------------------------
// (includes the captured corpus: real SDK fixtures from tests/dbm-capture)

/// One loop over all corpus files. Each file runs under `catch_unwind` so a failure in one
/// file never hides failures in another, and every reported failure carries the FILE name
/// (case ids are already in `check_case`'s assert messages).
#[test]
fn corpus_all_files() {
    let mut failures: Vec<String> = Vec::new();
    for (name, _) in CORPUS {
        if let Err(payload) = std::panic::catch_unwind(|| run_file(name)) {
            let msg = payload
                .downcast_ref::<String>()
                .map(String::as_str)
                .or_else(|| payload.downcast_ref::<&str>().copied())
                .unwrap_or("non-string panic payload");
            failures.push(format!("corpus file {name}: {msg}"));
        }
    }
    assert!(
        failures.is_empty(),
        "corpus failures in {} file(s):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

// -- cross-corpus invariants -------------------------------------------------

/// Red-phase fingerprint rule: cases sharing a `fingerprint_class` must produce ONE fingerprint;
/// cases in different classes must produce DIFFERENT fingerprints. Never literal hash values.
#[test]
fn fingerprint_equality_classes() {
    let mut classes: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for case in load_all() {
        let (Some(class), Some(_)) = (&case.fingerprint_class, &case.expect) else {
            continue;
        };
        let out = check_case(&case).expect("expect present implies a record");
        let fp = out_str(&out, O2_DB_FINGERPRINT).unwrap();
        classes.entry(class.clone()).or_default().insert(fp);
    }
    assert!(!classes.is_empty(), "no classed cases in the corpus");
    // Same class => same fingerprint.
    for (class, fps) in &classes {
        assert_eq!(
            fps.len(),
            1,
            "fingerprint_class {class} splintered into {fps:?}"
        );
    }
    // Different class => different fingerprint.
    let mut seen: HashMap<String, String> = HashMap::new();
    for (class, fps) in &classes {
        let fp = fps.iter().next().unwrap().clone();
        if let Some(other) = seen.insert(fp.clone(), class.clone()) {
            panic!("classes {other} and {class} collided on fingerprint {fp}");
        }
    }
}

/// NFR-2 blanket invariant: no declared literal value, from ANY case, may appear as a substring
/// of `o2_db_query_norm` in ANY case. This makes "green via raw-text fallback" impossible by
/// construction.
#[test]
fn nfr2_no_literal_leaks_into_any_query_norm() {
    let cases = load_all();
    let mut norms: Vec<(String, String)> = Vec::new();
    for case in &cases {
        if case.expect.is_none() {
            continue;
        }
        if let Some(out) = check_case(case)
            && let Some(norm) = out_str(&out, O2_DB_QUERY_NORM)
        {
            norms.push((case.id.clone(), norm));
        }
    }
    assert!(!norms.is_empty(), "no normalized texts produced");
    for case in &cases {
        for lit in &case.literals {
            assert!(!lit.is_empty(), "case {}: empty literal declared", case.id);
            for (norm_id, norm) in &norms {
                assert!(
                    !norm.contains(lit.as_str()),
                    "NFR-2 violation: literal {lit:?} (declared by case {}) leaked into \
                     query_norm of case {norm_id}: {norm:?}",
                    case.id
                );
            }
        }
    }
}

/// Direct `normalize()` contract for every case that carries statement text and a routed
/// dialect: literal expects must match, and lexer-failure inputs (expected `query_norm: null`
/// with text present) must return `Err` — never a raw-text result.
#[test]
fn normalize_direct_contract() {
    let mut exercised = 0usize;
    for case in load_all() {
        let Some(exp) = &case.expect else { continue };
        let Some(dialect) = case.dialect.as_deref().map(dialect_from_str) else {
            continue;
        };
        let Some(text) = statement_text(&case) else {
            continue;
        };
        exercised += 1;
        match &exp.query_norm {
            None => {
                // Failure rule (design §3.2): lexer error => no normalized text, ever.
                assert!(
                    normalize(&text, dialect).is_err(),
                    "case {}: lexer-failure input must return Err, not normalized text",
                    case.id
                );
            }
            Some(expected_norm) => {
                let ns = normalize(&text, dialect).unwrap_or_else(|e| {
                    panic!("case {}: normalize failed unexpectedly: {e}", case.id)
                });
                assert_eq!(
                    ns.query_norm.as_deref(),
                    Some(expected_norm.as_str()),
                    "case {}: query_norm",
                    case.id
                );
                assert_eq!(
                    ns.operation.as_deref(),
                    exp.operation.as_deref(),
                    "case {}: operation",
                    case.id
                );
                if let Some(class) = &exp.stmt_class {
                    assert_eq!(
                        ns.stmt_class.as_str(),
                        class.as_str(),
                        "case {}: stmt_class",
                        case.id
                    );
                }
                assert_eq!(
                    ns.batch_multiplier,
                    exp.batch_multiplier.unwrap_or(1),
                    "case {}: batch_multiplier",
                    case.id
                );
                assert!(
                    ns.fingerprint.len() == 16
                        && ns
                            .fingerprint
                            .bytes()
                            .all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')),
                    "case {}: fingerprint must be 16-hex lowercase",
                    case.id
                );
            }
        }
    }
    assert!(exercised > 0, "no case exercised normalize() directly");
}

// ---------------------------------------------------------------------------
// Enrichment options plumbing (config §8: STORE_NORM_TEXT, MAX_NORM_LEN,
// NORMALIZE_IDENTIFIERS) + the raw-text LRU (design §3.2 overhead guard)
// ---------------------------------------------------------------------------

fn sql_attrs(statement: &str) -> Map<String, Value> {
    let mut attrs = Map::new();
    attrs.insert("db.system".into(), Value::String("postgresql".into()));
    attrs.insert("db.statement".into(), Value::String(statement.into()));
    attrs.insert("db.name".into(), Value::String("shop".into()));
    attrs
}

#[test]
fn opts_normalize_identifiers_off_keeps_digit_suffixes() {
    let text = "SELECT * FROM events_20260807 WHERE id = 5";
    let on = normalizer::normalize_with_opts(text, Dialect::Postgresql, true).unwrap();
    assert_eq!(
        on.query_norm.as_deref(),
        Some("SELECT * FROM events_? WHERE id = ?")
    );
    let off = normalizer::normalize_with_opts(text, Dialect::Postgresql, false).unwrap();
    assert_eq!(
        off.query_norm.as_deref(),
        Some("SELECT * FROM events_20260807 WHERE id = ?"),
        "identifier folding off must keep the digit-suffixed table name (literals still fold)"
    );
    assert_ne!(on.fingerprint, off.fingerprint);
    // The two-arg normalize keeps its always-fold behavior (25-test suite contract).
    assert_eq!(normalize(text, Dialect::Postgresql).unwrap(), on);
}

#[test]
fn opts_elasticsearch_path_folding_respects_identifier_flag() {
    let text = "GET /logs-2026.08.07/_search";
    let on = normalizer::normalize_with_opts(text, Dialect::Elasticsearch, true).unwrap();
    assert_eq!(on.query_norm.as_deref(), Some("GET /logs-?/_search"));
    let off = normalizer::normalize_with_opts(text, Dialect::Elasticsearch, false).unwrap();
    assert_eq!(
        off.query_norm.as_deref(),
        Some("GET /logs-2026.08.07/_search")
    );
}

#[test]
fn opts_store_norm_text_false_drops_query_norm_only() {
    let attrs = sql_attrs("SELECT id FROM users WHERE id = 42");
    let opts = EnrichOptions {
        store_norm_text: false,
        ..EnrichOptions::default()
    };
    let out = enrich_with_opts(&attrs, 3, &opts).unwrap();
    assert!(
        !out.contains_key(O2_DB_QUERY_NORM),
        "query_norm must be dropped"
    );
    let with_text = enrich(&attrs, 3).unwrap();
    // Everything else — including the fingerprint — is unaffected.
    assert_eq!(out.get(O2_DB_FINGERPRINT), with_text.get(O2_DB_FINGERPRINT));
    assert_eq!(out.get(O2_DB_OPERATION), with_text.get(O2_DB_OPERATION));
    assert!(with_text.contains_key(O2_DB_QUERY_NORM));
}

#[test]
fn opts_store_norm_text_false_drops_degraded_fallback_text_too() {
    // No-text spans store "{operation} {collection}" as query_norm — the flag
    // must drop that too (it is still the o2_db_query_norm column).
    let mut attrs = Map::new();
    attrs.insert("db.system".into(), Value::String("postgresql".into()));
    attrs.insert("db.operation".into(), Value::String("SELECT".into()));
    attrs.insert("db.sql.table".into(), Value::String("users".into()));
    let opts = EnrichOptions {
        store_norm_text: false,
        ..EnrichOptions::default()
    };
    let out = enrich_with_opts(&attrs, 3, &opts).unwrap();
    assert!(!out.contains_key(O2_DB_QUERY_NORM));
    assert!(out.contains_key(O2_DB_FINGERPRINT));
}

#[test]
fn opts_max_norm_len_truncates_stored_text_at_char_boundary() {
    let attrs =
        sql_attrs("SELECT col_aaaaaaaaaa, col_bbbbbbbbbb, col_cccccccccc FROM t WHERE id = 7");
    let opts = EnrichOptions {
        max_norm_len: 20,
        ..EnrichOptions::default()
    };
    let out = enrich_with_opts(&attrs, 3, &opts).unwrap();
    let norm = out_str(&out, O2_DB_QUERY_NORM).unwrap();
    assert!(
        norm.len() <= 20,
        "stored norm must respect max_norm_len, got {}",
        norm.len()
    );
    // Fingerprint is computed over the FULL normalized text, not the truncation.
    let full = enrich(&attrs, 3).unwrap();
    assert_eq!(out.get(O2_DB_FINGERPRINT), full.get(O2_DB_FINGERPRINT));
}

#[test]
fn opts_normalize_identifiers_flag_flows_through_enrich() {
    let attrs = sql_attrs("SELECT * FROM events_20260807 WHERE id = 5");
    let opts = EnrichOptions {
        normalize_identifiers: false,
        ..EnrichOptions::default()
    };
    let out = enrich_with_opts(&attrs, 3, &opts).unwrap();
    assert_eq!(
        out_str(&out, O2_DB_QUERY_NORM).as_deref(),
        Some("SELECT * FROM events_20260807 WHERE id = ?")
    );
    let folded = enrich(&attrs, 3).unwrap();
    assert_ne!(out.get(O2_DB_FINGERPRINT), folded.get(O2_DB_FINGERPRINT));
}

#[test]
fn enrich_accepts_hashmap_attrs() {
    // The OTLP call site holds a HashMap<String, Value>, not a serde_json Map —
    // both must feed the same enrichment.
    let mut attrs: HashMap<String, Value> = HashMap::new();
    attrs.insert("db.system".into(), Value::String("postgresql".into()));
    attrs.insert(
        "db.statement".into(),
        Value::String("SELECT id FROM users WHERE id = 42".into()),
    );
    let out = enrich(&attrs, 3).unwrap();
    let map_out = enrich(&sql_attrs("SELECT id FROM users WHERE id = 42"), 3).unwrap();
    assert_eq!(out.get(O2_DB_FINGERPRINT), map_out.get(O2_DB_FINGERPRINT));
    assert_eq!(out.get(O2_DB_QUERY_NORM), map_out.get(O2_DB_QUERY_NORM));
}

#[test]
fn normalize_cached_hit_matches_direct_normalize_and_caches_failures() {
    let text = "SELECT a, b FROM cache_probe WHERE id = 99";
    let direct = normalize(text, Dialect::Postgresql).unwrap();
    // Miss then hit — both must equal the uncached result.
    let miss = normalize_cached(text, Dialect::Postgresql, true).unwrap();
    let hit = normalize_cached(text, Dialect::Postgresql, true).unwrap();
    assert_eq!(*miss, direct);
    assert_eq!(*hit, direct);
    // Fold flag is part of the key — a different flag is a different entry.
    let unfolded = normalize_cached(
        "SELECT * FROM events_20260807 WHERE id = 5",
        Dialect::Postgresql,
        false,
    )
    .unwrap();
    assert_eq!(
        unfolded.query_norm.as_deref(),
        Some("SELECT * FROM events_20260807 WHERE id = ?")
    );
    // Lexer failures cache as None and stay None on the hit path.
    let bad = "SELECT 'unterminated";
    assert!(normalize(bad, Dialect::Postgresql).is_err());
    assert!(normalize_cached(bad, Dialect::Postgresql, true).is_none());
    assert!(normalize_cached(bad, Dialect::Postgresql, true).is_none());
}

// ---------------------------------------------------------------------------
// o2_db_env comes from RESOURCE attributes (design §3.1 row `o2_db_env`:
// `deployment.environment.name` → `deployment.environment`, resource attrs).
// The OTLP call site keeps resource attrs in a separate `service_`-prefixed
// map; the JSON path's flat record carries them as `service_*` keys. Both
// shapes must resolve — found live: env was silently absent on every real
// OTLP ingest because enrich only saw span attrs.
// ---------------------------------------------------------------------------

#[test]
fn otlp_call_site_resolves_env_from_resource_map() {
    let mut span: HashMap<String, Value> = HashMap::new();
    span.insert("db.system".into(), Value::String("postgresql".into()));
    span.insert(
        "db.statement".into(),
        Value::String("SELECT id FROM users WHERE id = 42".into()),
    );
    // resource attrs exactly as handle_otlp_request stores them:
    // resource_attribute_key = "service_" + raw dotted key
    let mut resource: HashMap<String, Value> = HashMap::new();
    resource.insert(
        "service_deployment.environment.name".into(),
        Value::String("prod-eu".into()),
    );
    let merged = SpanWithResource {
        span: &span,
        resource: &resource,
    };
    let out = enrich(&merged, 3).unwrap();
    assert_eq!(out_str(&out, O2_DB_ENV).as_deref(), Some("prod-eu"));
    // identity fields unaffected by the overlay
    assert_eq!(out_str(&out, O2_DB_SYSTEM).as_deref(), Some("postgresql"));
}

#[test]
fn otlp_call_site_resolves_old_semconv_env_from_resource_map() {
    let mut span: HashMap<String, Value> = HashMap::new();
    span.insert("db.system".into(), Value::String("postgresql".into()));
    span.insert("db.statement".into(), Value::String("SELECT 1".into()));
    let mut resource: HashMap<String, Value> = HashMap::new();
    resource.insert(
        "service_deployment.environment".into(),
        Value::String("staging".into()),
    );
    let merged = SpanWithResource {
        span: &span,
        resource: &resource,
    };
    let out = enrich(&merged, 3).unwrap();
    assert_eq!(out_str(&out, O2_DB_ENV).as_deref(), Some("staging"));
}

#[test]
fn otlp_call_site_span_attr_wins_over_resource() {
    let mut span: HashMap<String, Value> = HashMap::new();
    span.insert("db.system".into(), Value::String("postgresql".into()));
    span.insert("db.statement".into(), Value::String("SELECT 1".into()));
    span.insert(
        "deployment.environment.name".into(),
        Value::String("span-level".into()),
    );
    let mut resource: HashMap<String, Value> = HashMap::new();
    resource.insert(
        "service_deployment.environment.name".into(),
        Value::String("resource-level".into()),
    );
    let merged = SpanWithResource {
        span: &span,
        resource: &resource,
    };
    let out = enrich(&merged, 3).unwrap();
    assert_eq!(out_str(&out, O2_DB_ENV).as_deref(), Some("span-level"));
}

#[test]
fn resource_only_db_attrs_do_not_qualify_span() {
    // Negative stamping must key off SPAN attrs: a resource-level db.* key on
    // a db-attr-free client span must not create an o2_db_* record.
    let span: HashMap<String, Value> = HashMap::new();
    let mut resource: HashMap<String, Value> = HashMap::new();
    resource.insert(
        "service_db.system".into(),
        Value::String("postgresql".into()),
    );
    let merged = SpanWithResource {
        span: &span,
        resource: &resource,
    };
    assert!(enrich(&merged, 3).is_none());
}

// ---------------------------------------------------------------------------
// UTF-8 pass-through in the Mongo command-doc folder (regression: bytes were
// pushed `as char`, so any byte >= 0x80 re-encoded as a Latin-1 codepoint —
// non-ASCII keys/collection names became mojibake in query_norm)
// ---------------------------------------------------------------------------

#[test]
fn mongodb_non_ascii_keys_survive_normalization_intact() {
    // Quoted non-ASCII keys (pymongo dict-repr shape): preserved verbatim, values fold.
    let ns = normalize("find {'名前': 'アリス', 'café': 3}", Dialect::Mongodb).unwrap();
    assert_eq!(
        ns.query_norm.as_deref(),
        Some("find {'名前': \"?\", 'café': \"?\"}")
    );
    assert_eq!(ns.operation.as_deref(), Some("find"));

    // Bare (unquoted) non-ASCII key with an array value: must survive BOTH the doc folder
    // and the array collapser, with the $in-style repeat collapse still applied.
    let ns = normalize("{café: [1, 2, 3]}", Dialect::Mongodb).unwrap();
    assert_eq!(ns.query_norm.as_deref(), Some("{café: [\"?\"]}"));
    assert_eq!(ns.operation.as_deref(), Some("café"));

    // Non-ASCII collection name as the command value is preserved — it is the identity.
    let ns = normalize(
        r#"{"find": "ユーザー", "filter": {"名前": "x"}}"#,
        Dialect::Mongodb,
    )
    .unwrap();
    assert_eq!(
        ns.query_norm.as_deref(),
        Some(r#"{"find": "ユーザー", "filter": {"名前": "?"}}"#)
    );
    assert_eq!(ns.operation.as_deref(), Some("find"));
}

#[test]
fn json_path_flat_record_resolves_env_from_service_prefixed_key() {
    // JSON-path records carry resource attrs flattened as
    // `service_deployment_environment_name` (underscores) at top level.
    let mut rec = sql_attrs("SELECT id FROM users WHERE id = 42");
    rec.insert(
        "service_deployment_environment_name".into(),
        Value::String("capture-env-a".into()),
    );
    let out = enrich(&rec, 3).unwrap();
    assert_eq!(out_str(&out, O2_DB_ENV).as_deref(), Some("capture-env-a"));
}
