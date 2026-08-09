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

//! A/B ingest-overhead benchmark for the DBM enrichment step (design NFR-4:
//! enrichment ≤ 3% of per-span ingest cost, defended by the raw-text LRU
//! first and the single-pass lexer second).
//!
//! Same-run comparison over real captured statements
//! (`src/traces/db_monitoring/corpus/captured_sql.json`):
//! - `disabled`:      the `cfg.db_monitoring.enabled == false` path — the cost a non-DBM deployment
//!   pays per span (the branch only).
//! - `enabled_warm`:  enrichment with the raw-text LRU hitting — the steady state on real
//!   workloads, where a small set of raw texts repeats.
//! - `enabled_cold`:  every span carries a never-seen raw text (unique suffix literal), forcing a
//!   full lexer pass — the worst case the LRU amortizes.
//!
//! Run: `cargo bench -p openobserve-core --bench db_enrich`. Numbers are
//! recorded in the PR description; no CI wiring (yet — the NFR-4 CI gate is a
//! separate deliverable).

use criterion::{Criterion, black_box, criterion_group, criterion_main};
use openobserve_core::traces::db_monitoring::{self, EnrichOptions};
use serde_json::{Map, Value};

const CORPUS: &str = include_str!("../src/traces/db_monitoring/corpus/captured_sql.json");
const SPAN_KIND_CLIENT: i32 = 3;

/// Attr maps of every corpus case (all are CLIENT spans with db attributes).
fn corpus_attr_maps() -> Vec<Map<String, Value>> {
    let cases: Vec<Value> = serde_json::from_str(CORPUS).expect("corpus parses");
    cases
        .iter()
        .map(|case| {
            case.get("input")
                .and_then(|i| i.get("attrs"))
                .and_then(Value::as_object)
                .expect("case has input.attrs")
                .clone()
        })
        .collect()
}

/// Replace the statement text of `attrs` so the raw text is unique per call —
/// a guaranteed LRU miss (the cache key is the raw text).
fn with_unique_statement(attrs: &Map<String, Value>, n: u64) -> Map<String, Value> {
    let mut out = attrs.clone();
    for key in ["db.statement", "db.query.text"] {
        if let Some(Value::String(s)) = out.get(key) {
            let unique = format!("{s} /* nocache */ OR 1 = {n}");
            out.insert(key.to_string(), Value::String(unique));
        }
    }
    out
}

fn bench_db_enrich(c: &mut Criterion) {
    let attr_maps = corpus_attr_maps();
    assert!(!attr_maps.is_empty(), "corpus is empty");
    let opts = EnrichOptions::default();
    let spans = attr_maps.len() as u64;

    let mut group = c.benchmark_group("db_enrich");
    group.throughput(criterion::Throughput::Elements(spans));

    // The enabled==false branch: what every span pays with DBM off.
    group.bench_function("disabled", |b| {
        let enabled = black_box(false);
        b.iter(|| {
            let mut stamped = 0usize;
            for attrs in &attr_maps {
                if enabled
                    && let Some(fields) =
                        db_monitoring::enrich_with_opts(attrs, SPAN_KIND_CLIENT, &opts)
                {
                    stamped += fields.len();
                }
            }
            black_box(stamped)
        })
    });

    // Steady state: raw texts repeat, LRU hits.
    group.bench_function("enabled_warm", |b| {
        // Pre-warm the cache once.
        for attrs in &attr_maps {
            let _ = db_monitoring::enrich_with_opts(attrs, SPAN_KIND_CLIENT, &opts);
        }
        b.iter(|| {
            let mut stamped = 0usize;
            for attrs in &attr_maps {
                if let Some(fields) =
                    db_monitoring::enrich_with_opts(attrs, SPAN_KIND_CLIENT, &opts)
                {
                    stamped += fields.len();
                }
            }
            black_box(stamped)
        })
    });

    // Worst case: every raw text is new — full lexer pass per span. The
    // unique-text maps are built in (untimed) setup so only enrichment is
    // measured.
    group.bench_function("enabled_cold", |b| {
        let mut n = 0u64;
        b.iter_batched(
            || {
                attr_maps
                    .iter()
                    .map(|attrs| {
                        n += 1;
                        with_unique_statement(attrs, n)
                    })
                    .collect::<Vec<_>>()
            },
            |unique_maps| {
                let mut stamped = 0usize;
                for attrs in &unique_maps {
                    if let Some(fields) =
                        db_monitoring::enrich_with_opts(attrs, SPAN_KIND_CLIENT, &opts)
                    {
                        stamped += fields.len();
                    }
                }
                black_box(stamped)
            },
            criterion::BatchSize::SmallInput,
        )
    });

    group.finish();
}

criterion_group!(benches, bench_db_enrich);
criterion_main!(benches);
