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
//! fetch. The caller checks the whole-file memory and disk caches first, so this cache sits
//! directly in front of object storage. A cold multi-block range costs one fetch, because the
//! first missing block pulls the whole remaining span and stores the siblings. Each request reads
//! live settings, so reloads change behavior.

use std::{
    future::Future,
    ops::Range,
    sync::Arc,
    time::{Duration, Instant},
};

use bytes::Bytes;
use config::metrics::{
    QUERY_BLOCK_CACHE_BLOCKS_FETCHED, QUERY_BLOCK_CACHE_BLOCKS_REQUESTED,
    QUERY_BLOCK_CACHE_RANGE_REQUESTS, QUERY_BLOCK_CACHE_REQUESTS_BYPASSED,
    QUERY_BLOCK_CACHE_USED_BYTES,
};
use hashbrown::HashMap;
use hashlink::lru_cache::LruCache;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use tokio::sync::watch;

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

/// Result of one fetch, which the leader publishes to every waiter of the same key.
type Fetched<E> = Option<Result<Bytes, Arc<E>>>;

struct Block {
    bytes: Bytes,
    expires_at: Instant,
}

struct State<E> {
    blocks: LruCache<BlockKey, Block>,
    /// Keys with a fetch in flight.
    fetches: HashMap<BlockKey, watch::Sender<Fetched<E>>>,
    size: u64,
}

/// LRU of blocks, bounded by total bytes, with one fetch in flight per key. `E` is the fetch
/// error type.
struct BlockCache<E> {
    state: Mutex<State<E>>,
    max_size: u64,
}

/// Clears the in-flight record, also if the leader stops before it publishes. Waiters then see a
/// closed channel and retry.
struct Lease<'a, E> {
    cache: &'a BlockCache<E>,
    key: BlockKey,
}

impl<E> Drop for Lease<'_, E> {
    fn drop(&mut self) {
        self.cache.state.lock().fetches.remove(&self.key);
    }
}

impl<E> BlockCache<E> {
    fn new(max_size: u64) -> Self {
        Self {
            state: Mutex::new(State {
                blocks: LruCache::new_unbounded(),
                fetches: HashMap::new(),
                size: 0,
            }),
            max_size,
        }
    }

    /// Bytes of the stored blocks. An expired block counts until a read or an eviction drops it.
    fn size(&self) -> u64 {
        self.state.lock().size
    }

    fn get(&self, key: &BlockKey) -> Option<Bytes> {
        let mut state = self.state.lock();
        let block = state.blocks.get(key)?;
        if block.expires_at > Instant::now() {
            return Some(block.bytes.clone());
        }
        let size = block.bytes.len() as u64;
        state.blocks.remove(key);
        state.size -= size;
        None
    }

    fn insert(&self, key: BlockKey, bytes: Bytes) {
        let size = bytes.len() as u64;
        let expires_at = Instant::now() + retention(config::get_config().block_cache.retention);
        let mut state = self.state.lock();
        state.size += size;
        if let Some(old) = state.blocks.insert(key, Block { bytes, expires_at }) {
            state.size -= old.bytes.len() as u64;
        }
        while state.size > self.max_size {
            let Some((_, evicted)) = state.blocks.remove_lru() else {
                break;
            };
            state.size -= evicted.bytes.len() as u64;
        }
    }

    /// Returns the stored block, or awaits `init` and stores the result. Concurrent callers of one
    /// key share the result of a single `init`. Errors are not stored.
    async fn get_or_fetch<Fut>(&self, key: BlockKey, init: Fut) -> Result<Bytes, Arc<E>>
    where
        Fut: Future<Output = Result<Bytes, E>>,
    {
        let sender = loop {
            if let Some(bytes) = self.get(&key) {
                return Ok(bytes);
            }
            let mut receiver = {
                let mut state = self.state.lock();
                match state.fetches.get(&key) {
                    Some(sender) => sender.subscribe(),
                    None => {
                        let (sender, _) = watch::channel(None);
                        state.fetches.insert(key.clone(), sender.clone());
                        break sender;
                    }
                }
            };
            loop {
                if let Some(result) = (*receiver.borrow_and_update()).clone() {
                    return result;
                }
                if receiver.changed().await.is_err() {
                    break;
                }
            }
        };

        let _lease = Lease {
            cache: self,
            key: key.clone(),
        };
        let result = init.await.map_err(Arc::new);
        if let Ok(bytes) = &result {
            self.insert(key, bytes.clone());
        }
        sender.send_replace(Some(result.clone()));
        result
    }
}

static BLOCKS: Lazy<BlockCache<object_store::Error>> =
    Lazy::new(|| BlockCache::new(config::get_config().block_cache.max_size as u64));

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
    cache: &BlockCache<E>,
    account: &str,
    file: &str,
    range: Range<u64>,
    settings: Settings,
    fetch: F,
) -> Result<Bytes, Arc<E>>
where
    F: Fn(Range<u64>) -> Fut,
    Fut: Future<Output = Result<Bytes, E>>,
    E: Send + Sync + 'static,
{
    if !settings.enabled || range.is_empty() {
        return fetch(range).await.map_err(Arc::new);
    }

    let range_len = range.end - range.start;
    if range_len > settings.bypass_threshold {
        QUERY_BLOCK_CACHE_REQUESTS_BYPASSED
            .with_label_values(&[] as &[&str])
            .inc();
        return fetch(range).await.map_err(Arc::new);
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
            .get_or_fetch(key_of(block_index), async {
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
                    cache.insert(key_of(sibling), span.slice(offset..end));
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

    // An expired block stays in the total until a read or an eviction drops it, so this gauge can
    // overstate the live bytes.
    QUERY_BLOCK_CACHE_USED_BYTES
        .with_label_values(&[] as &[&str])
        .set(cache.size() as i64);

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

    fn cache() -> Arc<BlockCache<&'static str>> {
        Arc::new(BlockCache::new(1024 * 1024))
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

    /// A leader that stops before it publishes must not block the waiters.
    #[tokio::test]
    async fn block_cache_recovers_from_a_cancelled_fetch() {
        let cache = cache();
        let key = BlockKey {
            account: "default".to_owned(),
            file: "file".to_owned(),
            block_size: 4,
            block_index: 0,
        };
        let mut leader = Box::pin(cache.get_or_fetch(key.clone(), std::future::pending()));
        assert!(futures::poll!(&mut leader).is_pending(), "leader must lead");

        let waiter = tokio::spawn({
            let cache = cache.clone();
            let key = key.clone();
            async move {
                cache
                    .get_or_fetch(key, async { Ok(Bytes::from_static(b"ok")) })
                    .await
            }
        });
        while cache.state.lock().fetches[&key].receiver_count() == 0 {
            tokio::task::yield_now().await;
        }
        drop(leader);

        assert_eq!(waiter.await.unwrap().unwrap(), Bytes::from_static(b"ok"));
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
        assert_eq!(
            fetches.load(Ordering::SeqCst),
            1,
            "cold read spans one fetch"
        );

        assert_eq!(read().await.unwrap(), expected);
        assert_eq!(
            fetches.load(Ordering::SeqCst),
            1,
            "warm read fetches nothing"
        );
    }

    /// The gauge is fed from `size`, so this covers both the reported value and the capacity
    /// bound. The gauge itself is a process-wide static that every other test in this module also
    /// writes, so asserting on it here would be racy.
    #[tokio::test]
    async fn block_cache_stays_within_capacity() {
        let cache: BlockCache<&'static str> = BlockCache::new(8);

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

        assert!(cache.size() > 0);
        assert!(cache.size() <= 8);
    }

    #[test]
    fn block_cache_zero_retention_uses_the_default() {
        assert_eq!(retention(0), DEFAULT_RETENTION);
    }
}
