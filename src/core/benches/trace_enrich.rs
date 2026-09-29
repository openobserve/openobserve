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

//! Per-span derived-column cost on trace ingest, through the helpers both handlers call.

use std::{
    collections::HashMap,
    sync::{Arc, Barrier, mpsc},
    thread::JoinHandle,
    time::{Duration, Instant},
};

use criterion::{BatchSize, Criterion, Throughput, black_box, criterion_group, criterion_main};
use openobserve_core::{
    db_monitoring::EnrichOptions,
    traces::{enrich_json_record, enrich_otlp_span},
};
use serde_json::{Map, Value, json};

const DB_CORPUS: [&str; 3] = [
    include_str!("../src/db_monitoring/corpus/captured_sql.json"),
    include_str!("../src/db_monitoring/corpus/captured_mongodb.json"),
    include_str!("../src/db_monitoring/corpus/captured_redis.json"),
];
const SPANS_PER_BATCH: usize = 1000;
// more hot statements than a small per-thread cache holds, but within the shared LRU
const DISTINCT_STATEMENTS: usize = 1000;

struct OtlpSpan {
    kind: i32,
    span: HashMap<String, Value>,
    resource: HashMap<String, Value>,
}

fn resource_attrs() -> HashMap<String, Value> {
    [
        ("service.name", json!("checkout")),
        ("service_service.version", json!("1.42.0")),
        ("service_deployment.environment.name", json!("prod")),
        ("service_host.name", json!("ip-10-0-3-17")),
        ("service_k8s.pod.ip", json!("10.42.0.7")),
        ("service_k8s.pod.name", json!("checkout-7f9c6d-x2k4q")),
        ("service_k8s.namespace.name", json!("shop")),
        ("service_telemetry.sdk.language", json!("java")),
    ]
    .into_iter()
    .map(|(k, v)| (k.to_string(), v))
    .collect()
}

fn db_span_attrs() -> Vec<Map<String, Value>> {
    DB_CORPUS
        .iter()
        .flat_map(|text| serde_json::from_str::<Vec<Value>>(text).expect("corpus parses"))
        .map(|case| {
            let mut attrs = case["input"]["attrs"].as_object().cloned().unwrap();
            attrs.insert("thread.name".to_string(), json!("http-nio-8080-exec-3"));
            attrs.insert("code.function".to_string(), json!("findItems"));
            attrs
        })
        .collect()
}

fn ordinary_span(i: usize) -> (i32, Map<String, Value>) {
    let attrs = match i % 3 {
        0 => json!({
            "http.request.method": "GET",
            "url.path": format!("/api/items/{i}"),
            "http.route": "/api/items/{id}",
            "http.response.status_code": 200,
            "server.address": "checkout.shop.svc",
            "server.port": 8080,
            "network.peer.address": "10.42.1.9",
            "user_agent.original": "okhttp/4.12.0",
        }),
        1 => json!({
            "http.request.method": "POST",
            "url.full": "https://payments.shop.svc:8443/v1/charge",
            "http.response.status_code": 201,
            "server.address": "payments.shop.svc",
            "server.port": 8443,
            "network.protocol.version": "1.1",
        }),
        _ => json!({
            "code.function": "applyDiscounts",
            "code.namespace": "com.shop.cart",
            "thread.name": "worker-4",
        }),
    };
    let kind = [2, 3, 1][i % 3];
    (kind, attrs.as_object().cloned().unwrap())
}

fn batch(db_share_pct: usize) -> Vec<(i32, Map<String, Value>)> {
    let db = db_span_attrs();
    (0..SPANS_PER_BATCH)
        .map(|i| {
            if i % 100 < db_share_pct {
                (3, db[i % db.len()].clone())
            } else {
                ordinary_span(i)
            }
        })
        .collect()
}

fn distinct_db_batch() -> Vec<(i32, Map<String, Value>)> {
    (0..SPANS_PER_BATCH)
        .map(|i| {
            let n = i % DISTINCT_STATEMENTS;
            let attrs = json!({
                "db.system.name": "postgresql",
                "db.namespace": "shop",
                "db.query.text": format!(
                    "SELECT id, sku, qty FROM stock_{n} WHERE warehouse_id = $1 AND qty > {i}"
                ),
                "server.address": "pg-primary.shop.svc",
                "server.port": 5432,
                "thread.name": "http-nio-8080-exec-3",
            });
            (3, attrs.as_object().cloned().unwrap())
        })
        .collect()
}

fn otlp_batch(spans: &[(i32, Map<String, Value>)]) -> Vec<OtlpSpan> {
    spans
        .iter()
        .map(|(kind, attrs)| OtlpSpan {
            kind: *kind,
            span: attrs.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            resource: resource_attrs(),
        })
        .collect()
}

/// The JSON handler's record shape after `flatten::flatten`.
fn json_batch(spans: &[(i32, Map<String, Value>)]) -> Vec<Map<String, Value>> {
    spans
        .iter()
        .enumerate()
        .map(|(i, (kind, attrs))| {
            let mut rec: Map<String, Value> = attrs
                .iter()
                .map(|(k, v)| (k.replace('.', "_"), v.clone()))
                .collect();
            for (k, v) in resource_attrs() {
                let k = k.strip_prefix("service_").unwrap_or(&k).replace('.', "_");
                rec.insert(format!("service_{k}"), v);
            }
            rec.insert("trace_id".to_string(), json!(format!("{i:032x}")));
            rec.insert("span_id".to_string(), json!(format!("{i:016x}")));
            rec.insert("span_kind".to_string(), json!(kind.to_string()));
            rec.insert("operation_name".to_string(), json!("op"));
            rec.insert(
                "start_time".to_string(),
                json!(1_700_000_000_000_000_000u64),
            );
            rec.insert("end_time".to_string(), json!(1_700_000_000_001_000_000u64));
            rec.insert("service_name".to_string(), json!("checkout"));
            rec
        })
        .collect()
}

fn run_otlp(spans: &mut [OtlpSpan], opts: &EnrichOptions) -> usize {
    let mut stamped = 0;
    for s in spans.iter_mut() {
        stamped += usize::from(enrich_otlp_span(
            s.kind,
            &mut s.span,
            &s.resource,
            true,
            opts,
        ));
    }
    stamped
}

fn run_json(records: &mut [Map<String, Value>], opts: &EnrichOptions) -> usize {
    let mut stamped = 0;
    for r in records.iter_mut() {
        stamped += usize::from(enrich_json_record(r, true, opts));
    }
    stamped
}

fn bench_trace_enrich(c: &mut Criterion) {
    let opts = EnrichOptions::default();
    let db_heavy = batch(90);
    let ordinary = batch(0);
    let distinct = distinct_db_batch();

    let mut group = c.benchmark_group("trace_enrich");
    group.throughput(Throughput::Elements(SPANS_PER_BATCH as u64));

    for (name, spans) in [
        ("db_heavy", &db_heavy),
        ("ordinary", &ordinary),
        ("db_distinct1000", &distinct),
    ] {
        let otlp = otlp_batch(spans);
        let _ = run_otlp(&mut otlp_batch(spans), &opts);
        group.bench_function(format!("{name}_otlp"), |b| {
            b.iter_batched_ref(
                || otlp.iter().map(clone_span).collect::<Vec<_>>(),
                |s| black_box(run_otlp(s, &opts)),
                BatchSize::LargeInput,
            )
        });
        let records = json_batch(spans);
        group.bench_function(format!("{name}_json"), |b| {
            b.iter_batched_ref(
                || records.clone(),
                |r| black_box(run_json(r, &opts)),
                BatchSize::LargeInput,
            )
        });
    }

    let threads = std::thread::available_parallelism().map_or(4, |n| n.get());
    let otlp = otlp_batch(&db_heavy);
    let pool = Pool::new(threads, opts.clone());
    group.throughput(Throughput::Elements((SPANS_PER_BATCH * threads) as u64));
    group.bench_function(format!("db_heavy_otlp_threads{threads}"), |b| {
        b.iter_custom(|iters| {
            (0..iters)
                .map(|_| pool.run(|| otlp.iter().map(clone_span).collect()))
                .sum()
        })
    });
    group.finish();
}

fn clone_span(s: &OtlpSpan) -> OtlpSpan {
    OtlpSpan {
        kind: s.kind,
        span: s.span.clone(),
        resource: s.resource.clone(),
    }
}

/// Long-lived workers, so a timed round never pays for thread spawn or a cold thread-local.
struct Pool {
    work: Vec<mpsc::Sender<Vec<OtlpSpan>>>,
    start: Arc<Barrier>,
    done: Arc<Barrier>,
    handles: Vec<JoinHandle<()>>,
}

impl Pool {
    fn new(threads: usize, opts: EnrichOptions) -> Self {
        let start = Arc::new(Barrier::new(threads + 1));
        let done = Arc::new(Barrier::new(threads + 1));
        let mut work = Vec::with_capacity(threads);
        let mut handles = Vec::with_capacity(threads);
        for _ in 0..threads {
            let (tx, rx) = mpsc::channel::<Vec<OtlpSpan>>();
            let (start, done, opts) = (start.clone(), done.clone(), opts.clone());
            work.push(tx);
            handles.push(std::thread::spawn(move || {
                while let Ok(mut spans) = rx.recv() {
                    start.wait();
                    black_box(run_otlp(&mut spans, &opts));
                    done.wait();
                    // spans drop here, outside the timed window
                }
            }));
        }
        Pool {
            work,
            start,
            done,
            handles,
        }
    }

    fn run(&self, batch: impl Fn() -> Vec<OtlpSpan>) -> Duration {
        for tx in &self.work {
            tx.send(batch()).unwrap();
        }
        self.start.wait();
        let t = Instant::now();
        self.done.wait();
        t.elapsed()
    }
}

impl Drop for Pool {
    fn drop(&mut self) {
        self.work.clear();
        for h in self.handles.drain(..) {
            let _ = h.join();
        }
    }
}

criterion_group!(benches, bench_trace_enrich);
criterion_main!(benches);
