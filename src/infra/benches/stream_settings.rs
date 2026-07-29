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

//! Benchmarks for the stream settings cache.
//!
//! Guards the scaling behavior fixed in #13465: bulk loading must stay
//! approximately linear in the number of streams, and a point mutation against
//! a 100k-entry cache must republish the snapshot via a shallow clone rather
//! than deep-copying every `StreamSettings`.

use std::sync::Arc;

use config::meta::stream::{StreamPartition, StreamSettings};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};

fn settings_template() -> StreamSettings {
    StreamSettings {
        partition_keys: vec![
            StreamPartition::new("service"),
            StreamPartition::new("level"),
        ],
        defined_schema_fields: (0..10).map(|i| format!("field_{i}")).collect(),
        bloom_filter_fields: vec!["trace_id".to_string()],
        ..Default::default()
    }
}

fn make_items(n: usize) -> Vec<(String, Arc<StreamSettings>)> {
    let template = Arc::new(settings_template());
    (0..n)
        .map(|i| (format!("bench_org/logs/stream_{i}"), template.clone()))
        .collect()
}

fn bench_stream_settings(c: &mut Criterion) {
    let rt = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    let mut group = c.benchmark_group("stream_settings");
    group.sample_size(10);

    // bulk load: must scale approximately linearly with stream count
    for &n in &[10_000usize, 50_000, 100_000] {
        group.bench_with_input(BenchmarkId::new("batch_load", n), &n, |b, &n| {
            b.iter(|| {
                let items = make_items(n);
                rt.block_on(infra::schema::put_stream_settings_batch(items));
            })
        });
    }

    // point mutation and read against a cache holding 100k streams
    rt.block_on(infra::schema::put_stream_settings_batch(make_items(
        100_000,
    )));
    group.bench_function("point_put_100k", |b| {
        b.iter(|| {
            rt.block_on(infra::schema::put_stream_settings(
                "bench_org/logs/stream_0".to_string(),
                Arc::new(settings_template()),
            ))
        })
    });
    group.bench_function("point_remove_put_100k", |b| {
        b.iter(|| {
            rt.block_on(async {
                infra::schema::remove_stream_settings("bench_org/logs/stream_0").await;
                infra::schema::put_stream_settings(
                    "bench_org/logs/stream_0".to_string(),
                    Arc::new(settings_template()),
                )
                .await;
            })
        })
    });
    group.bench_function("point_read_100k", |b| {
        b.iter(|| infra::schema::get_stream_settings_atomic("bench_org/logs/stream_0"))
    });
    group.finish();
}

criterion_group!(benches, bench_stream_settings);
criterion_main!(benches);
