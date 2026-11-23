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

use std::{
    hint::black_box,
    sync::{Arc, Barrier},
    time::{Duration, Instant},
};

use bytes::Bytes;
use criterion::{BenchmarkId, Criterion, Throughput, criterion_group, criterion_main};
use infra::cache::bytes_cache::BytesCache;

const KEYS: usize = 10_000;

fn key(i: usize) -> String {
    format!("files/default/logs/default/2026/11/23/10/7300000000000{i:06}.ttv")
}

fn filled_cache() -> Arc<BytesCache> {
    let cache = BytesCache::new(usize::MAX / 2, "bench".to_string());
    for i in 0..KEYS {
        cache.put(key(i), Bytes::from(vec![0u8; 256]));
    }
    Arc::new(cache)
}

/// Runs `iters` hits split across `threads` threads; returns wall time for all of them.
fn concurrent_hits(
    cache: &Arc<BytesCache>,
    keys: &Arc<Vec<String>>,
    threads: usize,
    iters: u64,
) -> Duration {
    let per_thread = iters.div_ceil(threads as u64);
    let barrier = Arc::new(Barrier::new(threads + 1));
    let handles: Vec<_> = (0..threads)
        .map(|t| {
            let (cache, keys, barrier) = (cache.clone(), keys.clone(), barrier.clone());
            std::thread::spawn(move || {
                barrier.wait();
                for i in 0..per_thread as usize {
                    black_box(cache.get(&keys[(i * 7 + t * 131) % KEYS]));
                }
            })
        })
        .collect();
    barrier.wait();
    let start = Instant::now();
    for handle in handles {
        handle.join().unwrap();
    }
    start.elapsed()
}

pub fn read_hits(c: &mut Criterion) {
    let cache = filled_cache();
    let keys = Arc::new((0..KEYS).map(key).collect::<Vec<_>>());
    let mut group = c.benchmark_group("bytes_cache/get_hit");
    group.throughput(Throughput::Elements(1));
    for threads in [1, 4, 16] {
        group.bench_with_input(
            BenchmarkId::from_parameter(threads),
            &threads,
            |b, &threads| {
                b.iter_custom(|iters| concurrent_hits(&cache, &keys, threads, iters));
            },
        );
    }
    group.finish();
}

criterion_group!(benches, read_hits);
criterion_main!(benches);
