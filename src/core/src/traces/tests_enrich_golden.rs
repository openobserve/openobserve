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

//! Pins derived-column output to pre-#14910 code; regenerate with O2_ENRICH_GOLDEN_WRITE=1.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use config::utils::json::{self, Map, Value, json};

use crate::db_monitoring::{ALL_DB_FIELDS, EnrichOptions};

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/src/traces/fixtures/enrich_golden.json"
);

const CORPUS: [(&str, &str); 19] = [
    (
        "batches_tcl",
        include_str!("../db_monitoring/corpus/batches_tcl.json"),
    ),
    (
        "captured_degraded",
        include_str!("../db_monitoring/corpus/captured_degraded.json"),
    ),
    (
        "captured_mongodb",
        include_str!("../db_monitoring/corpus/captured_mongodb.json"),
    ),
    (
        "captured_redis",
        include_str!("../db_monitoring/corpus/captured_redis.json"),
    ),
    (
        "captured_sql",
        include_str!("../db_monitoring/corpus/captured_sql.json"),
    ),
    (
        "cassandra_clickhouse",
        include_str!("../db_monitoring/corpus/cassandra_clickhouse.json"),
    ),
    (
        "dialect_quoting",
        include_str!("../db_monitoring/corpus/dialect_quoting.json"),
    ),
    (
        "elasticsearch",
        include_str!("../db_monitoring/corpus/elasticsearch.json"),
    ),
    (
        "fallbacks",
        include_str!("../db_monitoring/corpus/fallbacks.json"),
    ),
    (
        "identifiers",
        include_str!("../db_monitoring/corpus/identifiers.json"),
    ),
    (
        "in_lists",
        include_str!("../db_monitoring/corpus/in_lists.json"),
    ),
    (
        "instance_status",
        include_str!("../db_monitoring/corpus/instance_status.json"),
    ),
    (
        "mongodb",
        include_str!("../db_monitoring/corpus/mongodb.json"),
    ),
    (
        "negative",
        include_str!("../db_monitoring/corpus/negative.json"),
    ),
    (
        "placeholders_case",
        include_str!("../db_monitoring/corpus/placeholders_case.json"),
    ),
    ("redis", include_str!("../db_monitoring/corpus/redis.json")),
    (
        "semconv",
        include_str!("../db_monitoring/corpus/semconv.json"),
    ),
    (
        "sqlcommenter",
        include_str!("../db_monitoring/corpus/sqlcommenter.json"),
    ),
    (
        "stmt_class",
        include_str!("../db_monitoring/corpus/stmt_class.json"),
    ),
];

/// Resource-level by semconv; the "resource" layouts move these off the span.
const RESOURCE_PREFIXES: [&str; 4] = ["deployment.", "k8s.", "host.", "net.host."];

/// Service-graph and inferred-service shapes the DBM corpus does not reach.
fn graph_cases() -> Vec<(&'static str, Map<String, Value>)> {
    let cases = [
        (
            "http-url-full-port",
            json!({"url.full": "https://api.stripe.com:8443/v1/charges?x=1", "http.request.method": "GET"}),
        ),
        (
            "http-url-ip-host",
            json!({"http.url": "http://10.1.2.3/x", "net.peer.ip": "10.1.2.3", "http.method": "POST"}),
        ),
        (
            "http-default-port-authority",
            json!({"url.full": "http://user@shop.example.com:80/cart", "server.port": 80}),
        ),
        (
            "messaging-kafka",
            json!({"messaging.system": "kafka", "messaging.destination.name": "orders", "server.address": "kafka-0.kafka:9092"}),
        ),
        (
            "messaging-legacy-destination",
            json!({"messaging.system": "rabbitmq", "messaging.destination": "jobs", "net.peer.name": "rabbit"}),
        ),
        (
            "rpc-grpc-fqdn-root-dot",
            json!({"rpc.system": "grpc", "rpc.service": "Cart", "net.peer.name": "cart.svc.cluster.local.", "net.peer.port": "50051"}),
        ),
        (
            "peer-service-override",
            json!({"peer.service": "billing", "db.system": "postgresql", "server.address": "pg-0:5432"}),
        ),
        (
            "server-self-keys",
            json!({"server.address": "orders.prod:8080", "net.host.port": 8080, "k8s.pod.ip": "10.42.0.7", "net.host.ip": "10.42.0.8", "net.host.name": "orders-7f9"}),
        ),
        (
            "blank-then-real-host",
            json!({"server.address": "  ", "net.peer.name": "real-host", "http.host": "ignored:81"}),
        ),
        (
            "bool-dotted-string-flat",
            json!({"server.address": true, "server_address": "flat-host", "net.peer.port": 5432}),
        ),
        (
            "bool-flat-only",
            json!({"server_address": false, "net.peer.name": "fallback-host"}),
        ),
        (
            "invalid-explicit-port",
            json!({"server.address": "cache:6380", "server.port": "abc", "db.system": "redis"}),
        ),
        (
            "ipv6-peers",
            json!({"network.peer.address": "[::1]:6379", "net.sock.peer.addr": "fe80::1", "db.system": "redis", "db.statement": "GET k"}),
        ),
        (
            "db-system-only-ip-peer",
            json!({"db.system": "mysql", "net.peer.name": "192.168.1.9", "db.operation": "PING"}),
        ),
        (
            "db-number-values",
            json!({"db.system.name": "postgresql", "db.query.text": "SELECT 1", "db.response.status_code": 42, "server.port": 5432}),
        ),
        (
            "db-bool-dotted-statement",
            json!({"db.system": "postgresql", "db.statement": false, "db_statement": "SELECT flat FROM t", "db.operation.name": "SELECT"}),
        ),
        (
            "db-empty-dotted-name",
            json!({"db.system": "mysql", "db.namespace": "", "db.name": "shop", "db.user": "", "db_user": "flat_user"}),
        ),
        (
            "elasticsearch-url",
            json!({"db.system": "elasticsearch", "url.full": "https://es:9200/idx/_search?q=1", "http.request.method": "POST", "db.statement": "{\"query\":{}}"}),
        ),
        (
            "gen-ai-client",
            json!({"gen_ai.system": "openai", "gen_ai.request.model": "gpt-4o", "server.address": "api.openai.com", "server.port": 443}),
        ),
        ("no-attributes", json!({})),
    ];
    cases
        .into_iter()
        .map(|(id, attrs)| (id, attrs.as_object().cloned().unwrap()))
        .collect()
}

fn corpus_cases() -> Vec<(String, Map<String, Value>, i32)> {
    let mut out = Vec::new();
    for (file, text) in CORPUS {
        let cases: Vec<Value> = json::from_str(text).expect("corpus parses");
        for case in cases {
            let id = case["id"].as_str().expect("case id");
            let attrs = case["input"]["attrs"]
                .as_object()
                .cloned()
                .expect("case has input.attrs");
            let kind = case["input"]["span_kind"].as_i64().expect("span_kind") as i32;
            out.push((format!("{file}/{id}"), attrs, kind));
        }
    }
    out
}

fn is_resource_key(key: &str) -> bool {
    RESOURCE_PREFIXES.iter().any(|p| key.starts_with(p))
}

fn flat(key: &str) -> String {
    key.replace('.', "_")
}

fn to_hash(map: &Map<String, Value>) -> HashMap<String, Value> {
    map.iter().map(|(k, v)| (k.clone(), v.clone())).collect()
}

type OtlpLayout = (&'static str, HashMap<String, Value>, HashMap<String, Value>);

/// Resource keys carry `service_` as `resource_attribute_key` writes them.
fn otlp_layouts(attrs: &Map<String, Value>) -> Vec<OtlpLayout> {
    let base_resource: HashMap<String, Value> =
        HashMap::from([("service.name".to_string(), json!("golden-svc"))]);

    let span_only = (to_hash(attrs), base_resource.clone());

    let mut split_span = HashMap::new();
    let mut split_res = base_resource.clone();
    for (k, v) in attrs {
        if is_resource_key(k) {
            split_res.insert(format!("service_{k}"), v.clone());
        } else {
            split_span.insert(k.clone(), v.clone());
        }
    }

    // conflicting resource copies under every spelling the probes try
    let mut conflict_res = base_resource.clone();
    for (k, v) in attrs {
        let shadow = match v {
            Value::String(s) => json!(format!("res-{s}")),
            other => other.clone(),
        };
        conflict_res.insert(k.clone(), shadow.clone());
        conflict_res.insert(format!("service_{}", flat(k)), shadow);
    }
    let conflict = (to_hash(attrs), conflict_res.clone());

    // span spells flat, resource spells dotted: exposes probe order across maps
    let flat_span: HashMap<String, Value> =
        attrs.iter().map(|(k, v)| (flat(k), v.clone())).collect();
    let flat_vs_dotted = (flat_span, conflict_res);

    vec![
        ("otlp-span", span_only.0, span_only.1),
        ("otlp-resource", split_span, split_res),
        ("otlp-conflict", conflict.0, conflict.1),
        ("otlp-flat-span", flat_vs_dotted.0, flat_vs_dotted.1),
    ]
}

fn spoofed_fields() -> Vec<(&'static str, Value)> {
    ALL_DB_FIELDS
        .iter()
        .chain(super::inferred::ALL_INFER_FIELDS.iter())
        .enumerate()
        .map(|(i, f)| {
            let v = if i % 3 == 0 {
                json!(999)
            } else {
                json!(format!("spoof-{f}"))
            };
            (*f, v)
        })
        .collect()
}

/// JSON-path layouts: flattened (as `flatten::flatten` emits), raw dotted, and spoofed.
fn json_layouts(attrs: &Map<String, Value>, kind: i32) -> Vec<(&'static str, Map<String, Value>)> {
    let mut flat_rec = Map::new();
    for (k, v) in attrs {
        let key = if is_resource_key(k) {
            format!("service_{}", flat(k))
        } else {
            flat(k)
        };
        flat_rec.insert(key, v.clone());
    }
    flat_rec.insert("span_kind".to_string(), json!(kind.to_string()));
    flat_rec.insert("service_name".to_string(), json!("golden-svc"));

    let mut dotted = attrs.clone();
    dotted.insert("span_kind".to_string(), json!(kind));

    let mut spoofed = flat_rec.clone();
    for (f, v) in spoofed_fields() {
        spoofed.insert(f.to_string(), v);
    }

    // one derived key of a single family each, so neither family's strip rides on the other
    let mut db_spoof = flat_rec.clone();
    db_spoof.insert("o2_db_env".to_string(), json!("spoof-env"));
    let mut infer_spoof = flat_rec.clone();
    infer_spoof.insert("infer_self_ip".to_string(), json!("10.9.9.9"));

    vec![
        ("json-flat", flat_rec),
        ("json-dotted", dotted),
        ("json-spoofed", spoofed),
        ("json-db-spoof", db_spoof),
        ("json-infer-spoof", infer_spoof),
    ]
}

fn delta<'a>(
    before: impl Iterator<Item = (&'a String, &'a Value)>,
    after: &BTreeMap<String, Value>,
    dbm: bool,
) -> Value {
    let before: BTreeMap<&String, &Value> = before.collect();
    let set: BTreeMap<&String, &Value> = after
        .iter()
        .filter(|(k, v)| before.get(k) != Some(v))
        .collect();
    let removed: Vec<&String> = before
        .keys()
        .filter(|k| !after.contains_key(k.as_str()))
        .copied()
        .collect();
    json!({"dbm": dbm, "set": set, "removed": removed})
}

/// Every (case, layout, kind) → the change the enrichment made to its record.
fn compute_all() -> BTreeMap<String, Value> {
    let opts = EnrichOptions::default();
    let mut inputs: Vec<(String, Map<String, Value>, Vec<i32>)> = corpus_cases()
        .into_iter()
        .map(|(id, attrs, kind)| {
            let kinds = if kind == 2 { vec![2, 3] } else { vec![kind, 2] };
            (id, attrs, kinds)
        })
        .collect();
    inputs.extend(
        graph_cases()
            .into_iter()
            .map(|(id, attrs)| (format!("graph/{id}"), attrs, vec![0, 1, 2, 3, 4, 5])),
    );

    let mut out = BTreeMap::new();
    for (id, attrs, kinds) in &inputs {
        for &kind in kinds {
            for (layout, span, resource) in otlp_layouts(attrs) {
                let mut after = span.clone();
                let dbm = super::enrich_otlp_span(kind, &mut after, &resource, true, &opts);
                let after: BTreeMap<String, Value> = after.into_iter().collect();
                out.insert(
                    format!("{id}|{layout}|k{kind}"),
                    delta(span.iter(), &after, dbm),
                );
            }
            for (layout, record) in json_layouts(attrs, kind) {
                let mut after = record.clone();
                let dbm = super::enrich_json_record(&mut after, true, &opts);
                let after: BTreeMap<String, Value> = after.into_iter().collect();
                out.insert(
                    format!("{id}|{layout}|k{kind}"),
                    delta(record.iter(), &after, dbm),
                );
            }
        }
    }
    out
}

/// Provenance, not text, so a shape tells span, resource-copy and spoof values apart.
fn value_token(v: &Value) -> &'static str {
    match v {
        Value::String(s) if s.starts_with("res-") => "res",
        Value::String(s) if s.starts_with("spoof-") => "spoof",
        Value::String(_) => "str",
        Value::Number(_) => "num",
        Value::Bool(_) => "bool",
        _ => "other",
    }
}

/// The output shape of one call: its layout plus which columns it set (by provenance) or removed.
fn shape(key: &str, delta: &Value) -> String {
    let layout = key.split('|').nth(1).expect("key has a layout");
    let set: Vec<String> = delta["set"]
        .as_object()
        .expect("delta.set")
        .iter()
        .map(|(k, v)| format!("{k}={}", value_token(v)))
        .collect();
    format!(
        "{layout}|{}|{}|{}",
        delta["dbm"],
        set.join(","),
        delta["removed"]
    )
}

/// One call per output shape, plus firsts per (layout, kind), graph case and corpus file ± DBM.
fn select(all: &BTreeMap<String, Value>) -> BTreeMap<String, Value> {
    let mut seen = BTreeSet::new();
    let mut out = BTreeMap::new();
    for (key, delta) in all {
        let mut parts = key.split('|');
        let (case, layout, kind) = (
            parts.next().unwrap(),
            parts.next().unwrap(),
            parts.next().unwrap(),
        );
        let family = case.split('/').next().unwrap();
        let input = if family == "graph" {
            format!("case|{case}")
        } else {
            format!("file|{family}|{}", delta["dbm"])
        };
        let classes = [
            format!("shape|{}", shape(key, delta)),
            format!("layout-kind|{layout}|{kind}"),
            input,
        ];
        // every class must be marked, so no short-circuit
        let fresh = classes
            .into_iter()
            .fold(false, |fresh, c| seen.insert(c) | fresh);
        if fresh {
            out.insert(key.clone(), delta.clone());
        }
    }
    out
}

/// One entry per line, so a drift shows up as a readable line diff.
fn render(golden: &BTreeMap<String, Value>) -> String {
    let mut s = String::from("{\n");
    let last = golden.len().saturating_sub(1);
    for (i, (k, v)) in golden.iter().enumerate() {
        s.push_str(&format!(
            "{}: {}{}\n",
            json::to_string(k).unwrap(),
            json::to_string(v).unwrap(),
            if i == last { "" } else { "," }
        ));
    }
    s.push_str("}\n");
    s
}

#[test]
fn enrich_golden_output_is_unchanged() {
    let all = compute_all();
    if std::env::var("O2_ENRICH_GOLDEN_WRITE").is_ok() {
        std::fs::write(FIXTURE, render(&select(&all))).expect("write golden fixture");
        return;
    }
    let expected = std::fs::read_to_string(FIXTURE).expect("golden fixture present");
    let expected: BTreeMap<String, Value> = json::from_str(&expected).expect("fixture parses");
    let mut mismatches = Vec::new();
    for (k, want) in &expected {
        match all.get(k) {
            Some(got) if got == want => {}
            got => mismatches.push(format!("{k}\n  want {want}\n  got  {got:?}")),
        }
    }
    let shapes: BTreeSet<String> = expected.iter().map(|(k, v)| shape(k, v)).collect();
    let unseen: Vec<String> = all
        .iter()
        .filter(|(k, v)| !shapes.contains(&shape(k, v)))
        .map(|(k, v)| format!("{k}\n  new shape {v}"))
        .collect();
    assert!(
        mismatches.is_empty() && unseen.is_empty(),
        "{} of {} stored enrichment outputs drifted, {} of {} calls left the stored shapes:\n{}",
        mismatches.len(),
        expected.len(),
        unseen.len(),
        all.len(),
        mismatches
            .iter()
            .chain(&unseen)
            .take(20)
            .cloned()
            .collect::<Vec<_>>()
            .join("\n")
    );
}

#[test]
fn enrich_golden_corpus_is_not_vacuous() {
    let all = compute_all();
    assert!(all.len() > 3000, "the input cross-product collapsed");
    let golden = select(&all);
    let count = |pred: &dyn Fn(&Value) -> bool| golden.values().filter(|v| pred(v)).count();
    let sets = |v: &Value, field: &str| v["set"].get(field).is_some();
    let distinct = |i: usize| {
        golden
            .keys()
            .map(|k| k.split('|').nth(i).unwrap())
            .collect::<BTreeSet<_>>()
            .len()
    };
    assert_eq!(distinct(1), 9, "every layout");
    assert_eq!(distinct(2), 6, "every span kind");
    let inputs: BTreeSet<&str> = golden
        .keys()
        .map(|k| {
            let case = k.split('|').next().unwrap();
            if case.starts_with("graph/") {
                case
            } else {
                case.split('/').next().unwrap()
            }
        })
        .collect();
    assert_eq!(
        inputs.len(),
        CORPUS.len() + graph_cases().len(),
        "every corpus file and graph case"
    );
    assert!(count(&|v| v["dbm"] == json!(true)) > 100);
    assert!(count(&|v| sets(v, "o2_db_query_norm")) > 80);
    assert!(count(&|v| sets(v, "o2_db_env")) > 50);
    assert!(count(&|v| sets(v, "o2_db_batch_multiplier")) > 5);
    assert!(count(&|v| sets(v, "infer_service_name")) > 140);
    assert!(count(&|v| sets(v, "infer_peer_key")) > 100);
    assert!(count(&|v| sets(v, "infer_peer_port")) > 50);
    assert!(count(&|v| sets(v, "infer_peer_ip")) > 20);
    assert!(count(&|v| sets(v, "infer_self_key")) > 20);
    assert!(count(&|v| sets(v, "infer_self_ip")) > 4);
    assert!(count(&|v| !v["removed"].as_array().unwrap().is_empty()) > 70);
    assert!(count(&|v| v["dbm"] == json!(false) && v["set"].as_object().unwrap().is_empty()) > 25);
}
