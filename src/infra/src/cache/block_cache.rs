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

//! Caches range reads in fixed-size blocks, so concurrent requests for the same block share one
//! Moka initializer. The caller checks the whole-file memory and disk caches first, so this cache
//! sits directly in front of object storage. A cold multi-block range costs one fetch, because the
//! first missing block pulls the whole remaining span and stores the siblings. Each request reads
//! live settings, so reloads change behavior.

use std::{
    future::Future,
    ops::Range,
    time::{Duration, Instant},
};

use bytes::Bytes;
use config::metrics::{
    QUERY_BLOCK_CACHE_BLOCKS_FETCHED, QUERY_BLOCK_CACHE_BLOCKS_REQUESTED,
    QUERY_BLOCK_CACHE_RANGE_REQUESTS, QUERY_BLOCK_CACHE_REQUESTS_BYPASSED,
    QUERY_BLOCK_CACHE_USED_BYTES,
};
use moka::{future::Cache, policy::Expiry};
use once_cell::sync::Lazy;

const DEFAULT_BLOCK_SIZE: u64 = 1024 * 1024;
const DEFAULT_RETENTION: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct BlockKey {
    account: String,
    file: String,
    block_size: u64,
    block_index: u64,
}

#[derive(Clone, Copy)]
pub(crate) struct Settings {
    pub enabled: bool,
    pub block_size: u64,
    pub bypass_threshold: u64,
}

impl Settings {
    pub(crate) fn current() -> Self {
        let block_cache = &config::get_config().block_cache;
        Self {
            enabled: block_cache.enabled,
            block_size: block_cache.block_size as u64,
            bypass_threshold: block_cache.bypass_threshold as u64,
        }
    }
}

struct BlockExpiry;

impl Expiry<BlockKey, Bytes> for BlockExpiry {
    fn expire_after_create(
        &self,
        _key: &BlockKey,
        _value: &Bytes,
        _created_at: Instant,
    ) -> Option<Duration> {
        Some(retention(config::get_config().block_cache.retention))
    }
}

static BLOCKS: Lazy<Cache<BlockKey, Bytes>> = Lazy::new(|| {
    let max_size = config::get_config().block_cache.max_size as u64;
    Cache::builder()
        .max_capacity(max_size)
        .weigher(|_, bytes: &Bytes| u32::try_from(bytes.len()).unwrap_or(u32::MAX))
        .expire_after(BlockExpiry)
        .build()
});

fn retention(seconds: u64) -> Duration {
    if seconds == 0 {
        DEFAULT_RETENTION
    } else {
        Duration::from_secs(seconds)
    }
}

pub(crate) async fn get_range<F, Fut>(
    account: &str,
    file: &str,
    range: Range<u64>,
    fetch: F,
) -> object_store::Result<Bytes>
where
    F: Fn(Range<u64>) -> Fut,
    Fut: Future<Output = object_store::Result<Bytes>>,
{
    get_range_with_cache(&BLOCKS, account, file, range, Settings::current(), fetch)
        .await
        .map_err(|source| object_store::Error::Generic {
            store: "block cache",
            source: Box::new(source),
        })
}

async fn get_range_with_cache<F, Fut, E>(
    cache: &Cache<BlockKey, Bytes>,
    account: &str,
    file: &str,
    range: Range<u64>,
    settings: Settings,
    fetch: F,
) -> Result<Bytes, std::sync::Arc<E>>
where
    F: Fn(Range<u64>) -> Fut,
    Fut: Future<Output = Result<Bytes, E>>,
    E: Send + Sync + 'static,
{
    if !settings.enabled || range.is_empty() {
        return fetch(range).await.map_err(std::sync::Arc::new);
    }

    let range_len = range.end - range.start;
    if range_len > settings.bypass_threshold {
        QUERY_BLOCK_CACHE_REQUESTS_BYPASSED
            .with_label_values(&[] as &[&str])
            .inc();
        return fetch(range).await.map_err(std::sync::Arc::new);
    }

    // Counted after the bypass check, so this is the denominator for the blob-call reduction:
    // without the block cache each of these ranges would cost one remote call.
    QUERY_BLOCK_CACHE_RANGE_REQUESTS
        .with_label_values(&[] as &[&str])
        .inc();

    let block_size = if settings.block_size == 0 {
        DEFAULT_BLOCK_SIZE
    } else {
        settings.block_size
    };
    let first_block = range.start / block_size;
    let last_block = (range.end - 1) / block_size;
    let span_end = last_block.saturating_add(1).saturating_mul(block_size);
    let mut result = Vec::with_capacity(range_len as usize);
    let key_of = |block_index: u64| BlockKey {
        account: account.to_owned(),
        file: file.to_owned(),
        block_size,
        block_index,
    };

    for block_index in first_block..=last_block {
        QUERY_BLOCK_CACHE_BLOCKS_REQUESTED
            .with_label_values(&[] as &[&str])
            .inc();
        let block_start = block_index * block_size;
        let block_end = block_start.saturating_add(block_size);
        let block = cache
            .try_get_with(key_of(block_index), async {
                QUERY_BLOCK_CACHE_BLOCKS_FETCHED
                    .with_label_values(&[] as &[&str])
                    .inc();
                // One fetch covers every block left in the range, so a cold multi-block read
                // costs a single remote call. The loop then hits the siblings stored below.
                let span = fetch(block_start..span_end).await?;
                for sibling in block_index.saturating_add(1)..=last_block {
                    let offset = ((sibling - block_index) * block_size) as usize;
                    if offset >= span.len() {
                        break;
                    }
                    let end = offset.saturating_add(block_size as usize).min(span.len());
                    cache.insert(key_of(sibling), span.slice(offset..end)).await;
                }
                Ok(span.slice(0..(block_size as usize).min(span.len())))
            })
            .await?;
        let start = (range.start.max(block_start) - block_start) as usize;
        let end = ((range.end.min(block_end) - block_start) as usize).min(block.len());
        if start < end {
            result.extend_from_slice(&block[start..end]);
        }
    }

    // moka updates weighted_size during housekeeping, so this gauge lags a write by up to one
    // maintenance cycle.
    QUERY_BLOCK_CACHE_USED_BYTES
        .with_label_values(&[] as &[&str])
        .set(cache.weighted_size() as i64);

    Ok(Bytes::from(result))
}

#[cfg(test)]
mod tests {
    use std::sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    };

    use super::*;

    fn settings(enabled: bool, block_size: u64, bypass_threshold: u64) -> Settings {
        Settings {
            enabled,
            block_size,
            bypass_threshold,
        }
    }

    fn cache() -> Cache<BlockKey, Bytes> {
        Cache::new(1024 * 1024)
    }

    #[tokio::test]
    async fn block_cache_collapses_concurrent_reads() {
        let cache = cache();
        let bytes = Bytes::from_static(b"0123456789abcdef");
        let fetches = Arc::new(AtomicUsize::new(0));
        let starts = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(tokio::sync::Barrier::new(32));
        let (ready, fetch_ready) = tokio::sync::watch::channel(false);
        let mut reads = Vec::new();

        for _ in 0..32 {
            let cache = cache.clone();
            let bytes = bytes.clone();
            let fetches = fetches.clone();
            let starts = starts.clone();
            let barrier = barrier.clone();
            let ready = ready.clone();
            let fetch_ready = fetch_ready.clone();
            reads.push(tokio::spawn(async move {
                barrier.wait().await;
                if starts.fetch_add(1, Ordering::SeqCst) == 31 {
                    ready.send_replace(true);
                }
                get_range_with_cache(
                    &cache,
                    "default",
                    "file",
                    2..3,
                    settings(true, 4, 1024),
                    move |block| {
                        let bytes = bytes.clone();
                        let fetches = fetches.clone();
                        let mut fetch_ready = fetch_ready.clone();
                        async move {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            if !*fetch_ready.borrow_and_update() {
                                assert!(fetch_ready.changed().await.is_ok());
                            }
                            Ok::<_, &'static str>(
                                bytes.slice(block.start as usize..block.end as usize),
                            )
                        }
                    },
                )
                .await
            }));
        }

        for read in reads {
            assert_eq!(read.await.unwrap().unwrap(), Bytes::from_static(b"2"));
        }
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn block_cache_returns_unaligned_multi_block_ranges() {
        let cache = cache();
        let bytes = Bytes::from((0..16).collect::<Vec<u8>>());
        let result = get_range_with_cache(
            &cache,
            "default",
            "file",
            3..14,
            settings(true, 4, 1024),
            move |block| {
                let bytes = bytes.clone();
                async move {
                    Ok::<_, &'static str>(bytes.slice(block.start as usize..block.end as usize))
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(result, Bytes::from((3..14).collect::<Vec<u8>>()));
    }

    #[tokio::test]
    async fn block_cache_handles_a_short_final_block() {
        let cache = cache();
        let bytes = Bytes::from_static(b"abcdefghij");
        let result =
            get_range_with_cache(
                &cache,
                "default",
                "file",
                9..10,
                settings(true, 4, 1024),
                move |block| {
                    let bytes = bytes.clone();
                    async move {
                        Ok::<_, &'static str>(bytes.slice(
                            block.start as usize..block.end.min(bytes.len() as u64) as usize,
                        ))
                    }
                },
            )
            .await
            .unwrap();

        assert_eq!(result, Bytes::from_static(b"j"));
    }

    #[tokio::test]
    async fn block_cache_disabled_uses_the_fetcher() {
        let cache = cache();
        let fetches = Arc::new(AtomicUsize::new(0));
        let result = get_range_with_cache(
            &cache,
            "default",
            "file",
            0..2,
            settings(false, 4, 1024),
            |range| {
                let fetches = fetches.clone();
                async move {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, &'static str>(Bytes::from(vec![range.start as u8, range.end as u8]))
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(result, Bytes::from_static(&[0, 2]));
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn block_cache_bypasses_oversized_requests() {
        let cache = cache();
        let fetches = Arc::new(AtomicUsize::new(0));
        let before = QUERY_BLOCK_CACHE_REQUESTS_BYPASSED
            .with_label_values(&[] as &[&str])
            .get();
        let result = get_range_with_cache(
            &cache,
            "default",
            "file",
            0..9,
            settings(true, 4, 8),
            |_| {
                let fetches = fetches.clone();
                async move {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, &'static str>(Bytes::from_static(b"oversized"))
                }
            },
        )
        .await
        .unwrap();

        assert_eq!(result, Bytes::from_static(b"oversized"));
        assert_eq!(fetches.load(Ordering::SeqCst), 1);
        assert_eq!(
            QUERY_BLOCK_CACHE_REQUESTS_BYPASSED
                .with_label_values(&[] as &[&str])
                .get(),
            before + 1
        );
    }

    #[tokio::test]
    async fn block_cache_separates_accounts() {
        let cache = cache();
        let fetches = AtomicUsize::new(0);
        for account in ["one", "two"] {
            get_range_with_cache(
                &cache,
                account,
                "file",
                0..2,
                settings(true, 4, 1024),
                |_| async {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    Ok::<_, &'static str>(Bytes::from_static(b"ok"))
                },
            )
            .await
            .unwrap();
        }

        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn block_cache_does_not_cache_initializer_errors() {
        let cache = cache();
        let fetches = AtomicUsize::new(0);
        for _ in 0..2 {
            let error = get_range_with_cache(
                &cache,
                "default",
                "file",
                0..2,
                settings(true, 4, 1024),
                |_| async {
                    fetches.fetch_add(1, Ordering::SeqCst);
                    Err::<Bytes, _>("fetch failed")
                },
            )
            .await
            .unwrap_err();
            assert_eq!(*error, "fetch failed");
        }

        assert_eq!(fetches.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn block_cache_fetches_a_cold_multi_block_range_once() {
        let cache = cache();
        let bytes = Bytes::from((0..16).collect::<Vec<u8>>());
        let fetches = Arc::new(AtomicUsize::new(0));
        let read = || {
            let bytes = bytes.clone();
            let fetches = fetches.clone();
            let cache = cache.clone();
            async move {
                get_range_with_cache(
                    &cache,
                    "default",
                    "file",
                    1..14,
                    settings(true, 4, 1024),
                    move |block| {
                        let bytes = bytes.clone();
                        let fetches = fetches.clone();
                        async move {
                            fetches.fetch_add(1, Ordering::SeqCst);
                            Ok::<_, &'static str>(
                                bytes.slice(block.start as usize..block.end as usize),
                            )
                        }
                    },
                )
                .await
            }
        };

        let expected = Bytes::from((1..14).collect::<Vec<u8>>());
        assert_eq!(read().await.unwrap(), expected);
        assert_eq!(fetches.load(Ordering::SeqCst), 1, "cold read spans one fetch");

        assert_eq!(read().await.unwrap(), expected);
        assert_eq!(fetches.load(Ordering::SeqCst), 1, "warm read fetches nothing");
    }

    /// The gauge is fed from `weighted_size`, so this covers both the reported value and the
    /// capacity bound. The gauge itself is a process-wide static that every other test in this
    /// module also writes, so asserting on it here would be racy.
    #[tokio::test]
    async fn block_cache_stays_within_capacity() {
        let cache: Cache<BlockKey, Bytes> = Cache::builder()
            .max_capacity(8)
            .weigher(|_, bytes: &Bytes| u32::try_from(bytes.len()).unwrap_or(u32::MAX))
            .build();

        for file in 0..8 {
            get_range_with_cache(
                &cache,
                "default",
                &format!("file{file}"),
                0..4,
                settings(true, 4, 1024),
                |_| async { Ok::<_, &'static str>(Bytes::from_static(b"abcd")) },
            )
            .await
            .unwrap();
        }
        cache.run_pending_tasks().await;

        assert!(cache.weighted_size() > 0);
        assert!(cache.weighted_size() <= 8);
    }

    #[test]
    fn block_cache_zero_retention_uses_the_default() {
        assert_eq!(retention(0), DEFAULT_RETENTION);
    }
}
