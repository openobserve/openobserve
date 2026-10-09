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

//! Rejected ingest requests of orgs with no data, one coordinator key per org.

use std::{
    num::NonZeroUsize,
    sync::{Arc, LazyLock as Lazy},
};

use bytes::Bytes;
pub use common::meta::ingest_rejections::{
    IngestRejection, MAX_FIELD_LEN, MAX_ORG_KEY_LEN, RecentRejections, RejectionReason,
    rejection_reason, should_record,
};
use config::utils::time::now_micros;
use dashmap::DashSet;
pub use infra::coordinator::ingest_rejection::RejectionKv;
use infra::{coordinator::ingest_rejection::LiveKv, db::nats::INGEST_REJECTION_MAX_AGE_SECS};
use lru::LruCache;
use parking_lot::Mutex;
use tokio::task::JoinHandle;

/// Both backends treat an older entry as absent, since sqlite has no max_age.
pub const MAX_AGE_US: i64 = INGEST_REJECTION_MAX_AGE_SECS as i64 * 1_000_000;
pub const MEMO_CAPACITY: usize = 100_000;
/// Each cached answer holds up to four entries, so it is kept smaller than the memos.
pub const READ_CACHE_CAPACITY: usize = 10_000;
pub const NO_DATA_TTL_US: i64 = 60 * 1_000_000;
pub const READ_TTL_US: i64 = 5 * 1_000_000;
/// A failed read or a second compare-and-swap conflict keeps the in-flight mark this long.
pub const RETRY_HOLD_US: i64 = 30 * 1_000_000;
// Bounds an in-flight mark whose task never settles, so a hung KV call cannot silence a reason.
const IN_FLIGHT_US: i64 = 60 * 1_000_000;
const REASONS: usize = 4;

static LIVE: Lazy<Arc<Recorder<LiveKv>>> = Lazy::new(|| {
    Arc::new(Recorder::new(
        Arc::new(LiveKv),
        infra::schema::org_has_user_stream,
        MEMO_CAPACITY,
    ))
});

/// Response extension naming the org of a request whose path does not carry it (HEC).
#[derive(Clone, Debug)]
pub struct RejectionOrg(pub String);

/// Response extension naming the org ingestion token the request authenticated with.
#[derive(Clone, Debug)]
pub struct RejectionTokenName(pub String);

/// The node's gates and caches in front of the org's rejection key.
pub struct Recorder<K: RejectionKv> {
    kv: Arc<K>,
    has_user_stream: fn(&str) -> bool,
    /// Org to the time its no-data answer expires; only a no is cached.
    no_data: Mutex<LruCache<String, i64>>,
    /// Org to, per reason, the time its in-flight or present mark expires.
    present: Mutex<LruCache<String, [i64; REASONS]>>,
    read_cache: Mutex<LruCache<String, (i64, RecentRejections)>>,
    cleared: DashSet<String>,
}

impl<K: RejectionKv> Recorder<K> {
    pub fn new(kv: Arc<K>, has_user_stream: fn(&str) -> bool, capacity: usize) -> Self {
        let capacity = NonZeroUsize::new(capacity).unwrap_or(NonZeroUsize::MIN);
        let reads =
            NonZeroUsize::new(READ_CACHE_CAPACITY.min(capacity.get())).unwrap_or(NonZeroUsize::MIN);
        Self {
            kv,
            has_user_stream,
            no_data: Mutex::new(LruCache::new(capacity)),
            present: Mutex::new(LruCache::new(capacity)),
            read_cache: Mutex::new(LruCache::new(reads)),
            cleared: DashSet::new(),
        }
    }

    /// Gates 2 to 4 for a rejection `should_record` let through; any KV call runs on the task.
    pub fn record(
        self: &Arc<Self>,
        org_id: &str,
        rejection: IngestRejection,
        now_us: i64,
    ) -> Option<JoinHandle<()>> {
        if self.has_user_data(org_id, now_us) || !self.claim(org_id, rejection.reason, now_us) {
            return None;
        }
        let recorder = self.clone();
        let org_id = org_id.to_string();
        Some(tokio::spawn(async move {
            let reason = rejection.reason;
            let until_us = write_reason(recorder.kv.as_ref(), &org_id, rejection).await;
            recorder.hold(&org_id, reason, until_us);
        }))
    }

    pub fn has_user_data(&self, org_id: &str, now_us: i64) -> bool {
        if self
            .no_data
            .lock()
            .get(org_id)
            .is_some_and(|until| *until > now_us)
        {
            return false;
        }
        if (self.has_user_stream)(org_id) {
            return true;
        }
        self.no_data
            .lock()
            .put(org_id.to_string(), now_us + NO_DATA_TTL_US);
        false
    }

    /// The org's live causes, newest first, behind a per-org cache; the second value is a clear.
    pub async fn read(
        self: &Arc<Self>,
        org_id: &str,
        now_us: i64,
    ) -> (RecentRejections, Option<JoinHandle<()>>) {
        if let Some((until, answer)) = self.read_cache.lock().get(org_id)
            && *until > now_us
        {
            return (answer.clone(), None);
        }
        if self.has_user_data(org_id, now_us) {
            let answer = RecentRejections::default();
            self.cache_read(org_id, &answer, now_us);
            return (answer, Some(self.spawn_clear(org_id)));
        }
        match self.kv.get(org_id).await {
            Ok(value) => {
                let mut list = value
                    .map(|(bytes, _)| live_entries(&bytes, now_us))
                    .unwrap_or_default();
                list.sort_by_key(|entry| std::cmp::Reverse(entry.first_seen));
                let answer = RecentRejections {
                    tracked: true,
                    list,
                };
                self.cache_read(org_id, &answer, now_us);
                (answer, None)
            }
            Err(e) => {
                log::warn!("[INGEST_REJECTIONS] read {org_id}: {e}");
                (RecentRejections::default(), None)
            }
        }
    }

    /// The org's first user stream on this node: forget its no-data answer and clear its key once.
    pub fn on_user_stream_created(self: &Arc<Self>, org_id: &str) -> Option<JoinHandle<()>> {
        self.no_data.lock().pop(org_id);
        self.read_cache.lock().pop(org_id);
        if self.cleared.contains(org_id) || !self.cleared.insert(org_id.to_string()) {
            return None;
        }
        Some(self.spawn_clear(org_id))
    }

    pub async fn clear(&self, org_id: &str) {
        self.read_cache.lock().pop(org_id);
        self.clear_key(org_id).await;
    }

    /// Reads the key and deletes it only when it holds entries, so busy orgs write no tombstones.
    async fn clear_key(&self, org_id: &str) {
        match self.kv.get(org_id).await {
            Ok(Some((value, _))) if !value.is_empty() => {
                if let Err(e) = self.kv.delete(org_id).await {
                    log::warn!("[INGEST_REJECTIONS] clear {org_id}: {e}");
                }
            }
            Ok(_) => {}
            Err(e) => log::warn!("[INGEST_REJECTIONS] clear {org_id}: {e}"),
        }
    }

    fn spawn_clear(self: &Arc<Self>, org_id: &str) -> JoinHandle<()> {
        let recorder = self.clone();
        let org_id = org_id.to_string();
        // Leaves the read cache alone, so a read's fresh untracked answer keeps serving for 5 s.
        tokio::spawn(async move { recorder.clear_key(&org_id).await })
    }

    /// Marks the reason in flight unless a live mark exists; false means stop here.
    fn claim(&self, org_id: &str, reason: RejectionReason, now_us: i64) -> bool {
        let slot = reason_slot(reason);
        let mut present = self.present.lock();
        if let Some(slots) = present.get_mut(org_id) {
            if slots[slot] > now_us {
                return false;
            }
            slots[slot] = now_us + IN_FLIGHT_US;
            return true;
        }
        let mut slots = [0; REASONS];
        slots[slot] = now_us + IN_FLIGHT_US;
        present.put(org_id.to_string(), slots);
        true
    }

    fn hold(&self, org_id: &str, reason: RejectionReason, until_us: i64) {
        let slot = reason_slot(reason);
        let mut present = self.present.lock();
        if let Some(slots) = present.get_mut(org_id) {
            slots[slot] = until_us;
            return;
        }
        let mut slots = [0; REASONS];
        slots[slot] = until_us;
        present.put(org_id.to_string(), slots);
    }

    fn cache_read(&self, org_id: &str, answer: &RecentRejections, now_us: i64) {
        self.read_cache
            .lock()
            .put(org_id.to_string(), (now_us + READ_TTL_US, answer.clone()));
    }
}

/// Records a rejection `should_record` let through; returns at once.
pub fn record_rejection(org_id: &str, rejection: IngestRejection) {
    LIVE.record(org_id, rejection, now_micros());
}

pub fn org_has_user_data(org_id: &str) -> bool {
    LIVE.has_user_data(org_id, now_micros())
}

pub async fn read_rejections(org_id: &str) -> RecentRejections {
    LIVE.read(org_id, now_micros()).await.0
}

pub async fn clear_rejections(org_id: &str) {
    LIVE.clear(org_id).await;
}

/// Called for each new user-data stream; never waits on the coordinator.
pub fn on_user_stream_created(org_id: &str) {
    LIVE.on_user_stream_created(org_id);
}

/// Writes the reason when the key lacks it; returns when this node may check it again.
async fn write_reason<K: RejectionKv>(kv: &K, org_id: &str, rejection: IngestRejection) -> i64 {
    for _ in 0..2 {
        let now_us = now_micros();
        let (mut entries, revision) = match kv.get(org_id).await {
            Ok(Some((value, revision))) => (live_entries(&value, now_us), Some(revision)),
            Ok(None) => (Vec::new(), None),
            Err(e) => {
                log::warn!("[INGEST_REJECTIONS] read {org_id}: {e}");
                return now_us + RETRY_HOLD_US;
            }
        };
        if let Some(live) = entries.iter().find(|e| e.reason == rejection.reason) {
            return (live.first_seen + MAX_AGE_US).min(now_us + MAX_AGE_US);
        }
        let first_seen = rejection.first_seen;
        entries.push(rejection.clone());
        let value = match serde_json::to_vec(&entries) {
            Ok(value) => Bytes::from(value),
            Err(e) => {
                log::warn!("[INGEST_REJECTIONS] encode {org_id}: {e}");
                return now_us + RETRY_HOLD_US;
            }
        };
        match kv.put_if_revision(org_id, value, revision).await {
            Ok(true) => return first_seen.max(now_us - MAX_AGE_US) + MAX_AGE_US,
            Ok(false) => continue,
            Err(e) => {
                log::warn!("[INGEST_REJECTIONS] write {org_id}: {e}");
                return now_us + RETRY_HOLD_US;
            }
        }
    }
    now_micros() + RETRY_HOLD_US
}

/// Entries younger than the max age; an unreadable or deleted key holds none.
fn live_entries(value: &[u8], now_us: i64) -> Vec<IngestRejection> {
    if value.is_empty() {
        return Vec::new();
    }
    let entries: Vec<IngestRejection> = serde_json::from_slice(value).unwrap_or_else(|e| {
        log::warn!("[INGEST_REJECTIONS] unreadable key: {e}");
        Vec::new()
    });
    entries
        .into_iter()
        .filter(|entry| entry.first_seen > now_us - MAX_AGE_US)
        .collect()
}

fn reason_slot(reason: RejectionReason) -> usize {
    match reason {
        RejectionReason::InvalidCredentials => 0,
        RejectionReason::MalformedBody => 1,
        RejectionReason::BatchTooLarge => 2,
        RejectionReason::RateOrQuota => 3,
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::atomic::{AtomicBool, AtomicUsize, Ordering},
        time::Duration,
    };

    use async_trait::async_trait;
    use infra::errors::{Error, Result};
    use tokio::sync::Notify;

    use super::*;

    const ORG: &str = "rejections_test_org";

    /// An in-memory key per org that counts every call and can conflict, fail or stall.
    #[derive(Default)]
    struct CountingKv {
        keys: Mutex<HashMap<String, (Bytes, u64)>>,
        gets: AtomicUsize,
        puts: AtomicUsize,
        deletes: AtomicUsize,
        conflicts: AtomicUsize,
        fail: AtomicBool,
        stall: Option<Arc<Notify>>,
    }

    impl CountingKv {
        fn stalled(gate: Arc<Notify>) -> Self {
            Self {
                stall: Some(gate),
                ..Default::default()
            }
        }

        fn seed(&self, org_id: &str, entries: &[IngestRejection]) {
            let value = Bytes::from(serde_json::to_vec(entries).unwrap());
            self.keys.lock().insert(org_id.to_string(), (value, 1));
        }

        fn entries(&self, org_id: &str) -> Vec<IngestRejection> {
            self.keys
                .lock()
                .get(org_id)
                .map(|(value, _)| serde_json::from_slice(value).unwrap())
                .unwrap_or_default()
        }

        fn calls(&self) -> (usize, usize, usize) {
            (
                self.gets.load(Ordering::SeqCst),
                self.puts.load(Ordering::SeqCst),
                self.deletes.load(Ordering::SeqCst),
            )
        }
    }

    #[async_trait]
    impl RejectionKv for CountingKv {
        async fn get(&self, org_id: &str) -> Result<Option<(Bytes, u64)>> {
            self.gets.fetch_add(1, Ordering::SeqCst);
            if let Some(gate) = &self.stall {
                gate.notified().await;
            }
            if self.fail.load(Ordering::SeqCst) {
                return Err(Error::Message("kv down".to_string()));
            }
            Ok(self.keys.lock().get(org_id).cloned())
        }

        async fn put_if_revision(
            &self,
            org_id: &str,
            value: Bytes,
            revision: Option<u64>,
        ) -> Result<bool> {
            self.puts.fetch_add(1, Ordering::SeqCst);
            if self
                .conflicts
                .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |n| n.checked_sub(1))
                .is_ok()
            {
                return Ok(false);
            }
            let mut keys = self.keys.lock();
            let current = keys.get(org_id).map(|(_, revision)| *revision);
            if current != revision {
                return Ok(false);
            }
            keys.insert(org_id.to_string(), (value, current.unwrap_or(0) + 1));
            Ok(true)
        }

        async fn delete(&self, org_id: &str) -> Result<()> {
            self.deletes.fetch_add(1, Ordering::SeqCst);
            self.keys.lock().remove(org_id);
            Ok(())
        }
    }

    fn no_streams(_: &str) -> bool {
        false
    }

    fn has_streams(_: &str) -> bool {
        true
    }

    fn recorder(kv: CountingKv, has_user_stream: fn(&str) -> bool) -> Arc<Recorder<CountingKv>> {
        Arc::new(Recorder::new(Arc::new(kv), has_user_stream, MEMO_CAPACITY))
    }

    fn rejection(reason: RejectionReason, first_seen: i64) -> IngestRejection {
        let status = match reason {
            RejectionReason::InvalidCredentials => 401,
            RejectionReason::MalformedBody => 400,
            RejectionReason::BatchTooLarge => 413,
            RejectionReason::RateOrQuota => 429,
        };
        IngestRejection::new(first_seen, status, reason, "/api/org/s/_json", None)
    }

    fn present_until(recorder: &Recorder<CountingKv>, reason: RejectionReason) -> i64 {
        recorder.present.lock().peek(ORG).unwrap()[reason_slot(reason)]
    }

    #[tokio::test]
    async fn test_gate_order_stops_before_any_kv_call() {
        let now = now_micros();
        assert_eq!(rejection_reason("unknown", 401, |_| false), None);

        let with_data = recorder(CountingKv::default(), has_streams);
        let skipped = with_data.record(
            ORG,
            rejection(RejectionReason::InvalidCredentials, now),
            now,
        );
        assert!(skipped.is_none());
        assert_eq!(with_data.kv.calls(), (0, 0, 0));

        let no_data = recorder(CountingKv::default(), no_streams);
        no_data
            .record(
                ORG,
                rejection(RejectionReason::InvalidCredentials, now),
                now,
            )
            .unwrap()
            .await
            .unwrap();
        assert_eq!(no_data.kv.calls(), (1, 1, 0));
        let memo_hit = no_data.record(
            ORG,
            rejection(RejectionReason::InvalidCredentials, now + 1),
            now + 1,
        );
        assert!(memo_hit.is_none(), "present memo stops the second send");
        assert_eq!(no_data.kv.calls(), (1, 1, 0));
    }

    #[tokio::test]
    async fn test_no_data_answer_is_memoised_sixty_seconds_and_dropped_by_the_hook() {
        static CHECKS: AtomicUsize = AtomicUsize::new(0);
        fn counted(_: &str) -> bool {
            CHECKS.fetch_add(1, Ordering::SeqCst);
            false
        }
        let recorder = recorder(CountingKv::default(), counted);
        let now = 1_000_000_000;
        assert!(!recorder.has_user_data(ORG, now));
        assert!(!recorder.has_user_data(ORG, now + NO_DATA_TTL_US - 1));
        assert_eq!(CHECKS.load(Ordering::SeqCst), 1);
        assert!(!recorder.has_user_data(ORG, now + NO_DATA_TTL_US));
        assert_eq!(CHECKS.load(Ordering::SeqCst), 2);
        recorder.on_user_stream_created(ORG).unwrap().await.unwrap();
        assert!(!recorder.has_user_data(ORG, now + NO_DATA_TTL_US + 1));
        assert_eq!(CHECKS.load(Ordering::SeqCst), 3, "the hook drops the memo");
    }

    #[test]
    fn test_memo_is_an_lru_that_evicts_exactly_the_least_recently_used() {
        let recorder = Recorder::new(Arc::new(CountingKv::default()), no_streams, 3);
        let now = 1_000;
        for org in ["a", "b", "c"] {
            assert!(recorder.claim(org, RejectionReason::MalformedBody, now));
        }
        assert!(!recorder.claim("a", RejectionReason::MalformedBody, now));
        assert!(recorder.claim("d", RejectionReason::MalformedBody, now));
        let present = recorder.present.lock();
        assert_eq!(present.len(), 3);
        assert!(present.peek("b").is_none(), "b was least recently used");
        assert!(present.peek("a").is_some() && present.peek("c").is_some());
        assert_eq!(present.cap().get(), 3);
    }

    #[tokio::test]
    async fn test_in_flight_mark_turns_a_thousand_misses_into_one_read() {
        let gate = Arc::new(Notify::new());
        let recorder = recorder(CountingKv::stalled(gate.clone()), no_streams);
        let now = now_micros();
        let handles = (0..1_000)
            .filter_map(|i| {
                recorder.record(
                    ORG,
                    rejection(RejectionReason::InvalidCredentials, now + i),
                    now + i,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(handles.len(), 1);
        tokio::task::yield_now().await;
        gate.notify_one();
        for handle in handles {
            handle.await.unwrap();
        }
        assert_eq!(recorder.kv.calls(), (1, 1, 0));
    }

    #[tokio::test]
    async fn test_a_live_reason_is_never_rewritten_and_is_held_until_it_expires() {
        let kv = CountingKv::default();
        let first_seen = now_micros() - 10 * 60 * 1_000_000;
        kv.seed(
            ORG,
            &[rejection(RejectionReason::InvalidCredentials, first_seen)],
        );
        let recorder = recorder(kv, no_streams);
        let now = now_micros();
        recorder
            .record(
                ORG,
                rejection(RejectionReason::InvalidCredentials, now),
                now,
            )
            .unwrap()
            .await
            .unwrap();
        assert_eq!(recorder.kv.calls(), (1, 0, 0));
        assert_eq!(recorder.kv.entries(ORG)[0].first_seen, first_seen);
        let until = present_until(&recorder, RejectionReason::InvalidCredentials);
        assert_eq!(until, first_seen + MAX_AGE_US);
        assert!(!recorder.claim(ORG, RejectionReason::InvalidCredentials, until - 1));
        assert!(recorder.claim(ORG, RejectionReason::InvalidCredentials, until));
    }

    #[tokio::test]
    async fn test_a_new_reason_joins_the_key_and_is_held_for_the_max_age() {
        let kv = CountingKv::default();
        let earlier = now_micros() - 1_000_000;
        kv.seed(ORG, &[rejection(RejectionReason::MalformedBody, earlier)]);
        let recorder = recorder(kv, no_streams);
        let now = now_micros();
        recorder
            .record(ORG, rejection(RejectionReason::BatchTooLarge, now), now)
            .unwrap()
            .await
            .unwrap();
        let reasons = recorder
            .kv
            .entries(ORG)
            .iter()
            .map(|e| e.reason)
            .collect::<Vec<_>>();
        assert_eq!(
            reasons,
            [
                RejectionReason::MalformedBody,
                RejectionReason::BatchTooLarge
            ]
        );
        assert_eq!(
            present_until(&recorder, RejectionReason::BatchTooLarge),
            now + MAX_AGE_US
        );
    }

    #[tokio::test]
    async fn test_cas_conflict_is_retried_once() {
        let kv = CountingKv::default();
        kv.conflicts.store(1, Ordering::SeqCst);
        let recorder = recorder(kv, no_streams);
        let now = now_micros();
        recorder
            .record(ORG, rejection(RejectionReason::RateOrQuota, now), now)
            .unwrap()
            .await
            .unwrap();
        assert_eq!(recorder.kv.calls(), (2, 2, 0));
        assert_eq!(recorder.kv.entries(ORG).len(), 1);
    }

    #[tokio::test]
    async fn test_a_second_conflict_gives_up_and_holds_thirty_seconds() {
        let kv = CountingKv::default();
        kv.conflicts.store(2, Ordering::SeqCst);
        let recorder = recorder(kv, no_streams);
        let before = now_micros();
        recorder
            .record(ORG, rejection(RejectionReason::RateOrQuota, before), before)
            .unwrap()
            .await
            .unwrap();
        let after = now_micros();
        assert_eq!(recorder.kv.calls(), (2, 2, 0));
        assert!(recorder.kv.entries(ORG).is_empty());
        let until = present_until(&recorder, RejectionReason::RateOrQuota);
        assert!((before + RETRY_HOLD_US..=after + RETRY_HOLD_US).contains(&until));
        assert!(!recorder.claim(ORG, RejectionReason::RateOrQuota, until - 1));
    }

    #[tokio::test]
    async fn test_a_kv_error_holds_the_in_flight_mark_thirty_seconds() {
        let failing = CountingKv::default();
        failing.fail.store(true, Ordering::SeqCst);
        let recorder = recorder(failing, no_streams);
        let now = now_micros();
        recorder
            .record(ORG, rejection(RejectionReason::RateOrQuota, now), now)
            .unwrap()
            .await
            .unwrap();
        assert_eq!(recorder.kv.calls(), (1, 0, 0));
        let until = present_until(&recorder, RejectionReason::RateOrQuota);
        assert!(until >= now + RETRY_HOLD_US && until < now + MAX_AGE_US);
    }

    #[tokio::test]
    async fn test_an_entry_older_than_the_max_age_is_absent_on_read_and_replaced_on_write() {
        let kv = CountingKv::default();
        let now = now_micros();
        let stale = now - MAX_AGE_US - 1;
        kv.seed(
            ORG,
            &[
                rejection(RejectionReason::InvalidCredentials, stale),
                rejection(RejectionReason::MalformedBody, now - 5),
            ],
        );
        let recorder = recorder(kv, no_streams);
        let (answer, clear) = recorder.read(ORG, now).await;
        assert!(clear.is_none());
        assert!(answer.tracked);
        assert_eq!(answer.list.len(), 1);
        assert_eq!(answer.list[0].reason, RejectionReason::MalformedBody);

        recorder
            .record(
                ORG,
                rejection(RejectionReason::InvalidCredentials, now),
                now,
            )
            .unwrap()
            .await
            .unwrap();
        let entries = recorder.kv.entries(ORG);
        assert_eq!(entries.len(), 2, "the stale entry is dropped on write");
        let fresh = entries
            .iter()
            .find(|e| e.reason == RejectionReason::InvalidCredentials)
            .unwrap();
        assert_eq!(fresh.first_seen, now);
    }

    #[tokio::test]
    async fn test_read_is_newest_first_and_cached_five_seconds_without_any_rpc() {
        let kv = CountingKv::default();
        let now = now_micros();
        kv.seed(
            ORG,
            &[
                rejection(RejectionReason::InvalidCredentials, now - 30),
                rejection(RejectionReason::BatchTooLarge, now - 10),
                rejection(RejectionReason::MalformedBody, now - 20),
            ],
        );
        let recorder = recorder(kv, no_streams);
        let (answer, _) = recorder.read(ORG, now).await;
        let order = answer.list.iter().map(|e| e.reason).collect::<Vec<_>>();
        assert_eq!(
            order,
            [
                RejectionReason::BatchTooLarge,
                RejectionReason::MalformedBody,
                RejectionReason::InvalidCredentials
            ]
        );
        recorder.read(ORG, now + READ_TTL_US - 1).await;
        assert_eq!(recorder.kv.calls(), (1, 0, 0));
        recorder.read(ORG, now + READ_TTL_US).await;
        assert_eq!(recorder.kv.calls(), (2, 0, 0));
    }

    #[tokio::test]
    async fn test_an_org_with_data_reads_untracked_and_clears_after_answering() {
        let gate = Arc::new(Notify::new());
        let kv = CountingKv::stalled(gate.clone());
        let now = now_micros();
        kv.seed(ORG, &[rejection(RejectionReason::MalformedBody, now)]);
        let recorder = recorder(kv, has_streams);
        let (answer, clear) = tokio::time::timeout(Duration::from_secs(1), recorder.read(ORG, now))
            .await
            .expect("the GET never waits on the clear");
        assert_eq!(answer, RecentRejections::default());
        assert!(!answer.tracked && answer.list.is_empty());
        gate.notify_one();
        clear.unwrap().await.unwrap();
        assert_eq!(recorder.kv.calls(), (1, 0, 1));
        assert!(recorder.kv.entries(ORG).is_empty());
    }

    #[tokio::test]
    async fn test_a_burst_of_reads_for_an_org_with_data_clears_once_per_read_ttl() {
        let kv = CountingKv::default();
        let now = now_micros();
        kv.seed(ORG, &[rejection(RejectionReason::MalformedBody, now)]);
        let recorder = recorder(kv, has_streams);
        let mut clears = 0;
        for i in 0..100 {
            let (answer, clear) = recorder.read(ORG, now + i * 1_000).await;
            assert_eq!(answer, RecentRejections::default());
            if let Some(clear) = clear {
                clears += 1;
                clear.await.unwrap();
            }
        }
        assert_eq!(clears, 1, "one clear per org per read TTL");
        assert_eq!(recorder.kv.calls(), (1, 0, 1));

        let (_, clear) = recorder.read(ORG, now + READ_TTL_US).await;
        clear.unwrap().await.unwrap();
        assert_eq!(recorder.kv.calls(), (2, 0, 1), "no delete for an empty key");
    }

    #[tokio::test]
    async fn test_hook_clears_once_per_org_and_writes_no_tombstone_for_a_missing_key() {
        let kv = CountingKv::default();
        kv.seed(
            ORG,
            &[rejection(RejectionReason::MalformedBody, now_micros())],
        );
        let recorder = recorder(kv, no_streams);
        recorder.on_user_stream_created(ORG).unwrap().await.unwrap();
        assert!(recorder.on_user_stream_created(ORG).is_none());
        assert_eq!(recorder.kv.calls(), (1, 0, 1));

        recorder
            .on_user_stream_created("org_without_key")
            .unwrap()
            .await
            .unwrap();
        assert_eq!(
            recorder.kv.calls(),
            (2, 0, 1),
            "no delete for a missing key"
        );
    }

    #[tokio::test]
    async fn test_hook_drops_a_cached_tracked_answer() {
        let kv = CountingKv::default();
        let now = now_micros();
        kv.seed(ORG, &[rejection(RejectionReason::MalformedBody, now)]);
        let recorder = recorder(kv, no_streams);
        assert_eq!(recorder.read(ORG, now).await.0.list.len(), 1);
        recorder.on_user_stream_created(ORG).unwrap().await.unwrap();
        let (answer, _) = recorder.read(ORG, now + 1).await;
        assert!(answer.tracked && answer.list.is_empty());
        assert_eq!(recorder.kv.calls(), (3, 0, 1));
    }

    #[tokio::test]
    async fn test_a_failed_read_answers_untracked_and_is_not_cached() {
        let kv = CountingKv::default();
        kv.fail.store(true, Ordering::SeqCst);
        let recorder = recorder(kv, no_streams);
        let now = now_micros();
        assert_eq!(recorder.read(ORG, now).await.0, RecentRejections::default());
        recorder.kv.fail.store(false, Ordering::SeqCst);
        assert!(recorder.read(ORG, now + 1).await.0.tracked);
        assert_eq!(recorder.kv.calls(), (2, 0, 0));
    }

    #[tokio::test]
    #[cfg_attr(
        feature = "cloud",
        ignore = "remove_org reads the cloud config, which needs billing keys"
    )]
    async fn test_live_sqlite_key_is_read_then_removed_with_the_org() {
        infra::db::create_table().await.unwrap();
        infra::table::create_user_tables().await.unwrap();
        let org = "rejections_live_sqlite_org";
        let coordinator = infra::coordinator::ingest_rejection::get;
        infra::coordinator::ingest_rejection::delete(org)
            .await
            .unwrap();
        let now = now_micros();
        let value = Bytes::from(
            serde_json::to_vec(&[rejection(RejectionReason::InvalidCredentials, now)]).unwrap(),
        );
        assert!(
            infra::coordinator::ingest_rejection::put_if_revision(org, value, None)
                .await
                .unwrap()
        );
        let answer = read_rejections(org).await;
        assert!(answer.tracked);
        assert_eq!(answer.list.len(), 1);

        crate::organization::remove_org(org).await.unwrap();
        assert!(coordinator(org).await.unwrap().is_none());
        assert_eq!(
            read_rejections(org).await,
            RecentRejections {
                tracked: true,
                list: Vec::new()
            },
            "the clear also drops the cached answer"
        );
    }

    #[test]
    fn test_key_size_bound_at_the_field_caps() {
        let long = "x".repeat(500);
        let entries = [
            RejectionReason::InvalidCredentials,
            RejectionReason::MalformedBody,
            RejectionReason::BatchTooLarge,
            RejectionReason::RateOrQuota,
        ]
        .map(|reason| IngestRejection::new(i64::MAX, 401, reason, &long, Some(&long)));
        let one = serde_json::to_vec(&entries[0]).unwrap().len();
        let key = serde_json::to_vec(&entries).unwrap().len();
        println!("ingest rejection entry {one} bytes, full key {key} bytes");
        assert!(one < 256, "entry is {one} bytes");
        assert!(key < 1_024, "key is {key} bytes");
        assert_eq!(entries[0].path.chars().count(), MAX_FIELD_LEN);
    }
}
