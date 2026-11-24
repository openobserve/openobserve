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
    collections::{BTreeMap, HashMap, HashSet},
    hash::{DefaultHasher, Hash, Hasher},
    sync::{
        Arc, LazyLock,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use config::meta::secret_store::SecretValue;
use hashlink::{LinkedHashMap, LinkedHashSet};
use parking_lot::Mutex;
use tokio::sync::{Mutex as AsyncMutex, Semaphore};
use zeroize::Zeroizing;

pub const MAX_CACHED_VALUE_BYTES: usize = 64 * 1024;
pub const MAX_FILLS_IN_FLIGHT: usize = 64;
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(10);
const MAX_ALLOWLIST_ENTRIES: usize = 10_000;
const MAX_ALLOWLIST_BYTES: usize = 16 << 20;
const MAX_ALLOWLIST_ENTRY_BYTES: usize = 1 << 20;

static TTL_COUNTER: AtomicU64 = AtomicU64::new(0);
static VALUE_CACHE: LazyLock<ValueCache> = LazyLock::new(|| {
    let (node, org) = half_budgets();
    ValueCache::new(node, org)
});
static ALLOWLIST_CACHE: LazyLock<AllowlistCache> = LazyLock::new(AllowlistCache::default);

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ValueKey {
    pub org_id: String,
    pub secret_id: String,
    pub effective_env_id: String,
    pub env_incarnation: String,
    pub value_rev: String,
    pub policy_rev: String,
}

impl ValueKey {
    fn bytes(&self) -> usize {
        self.org_id.len()
            + self.secret_id.len()
            + self.effective_env_id.len()
            + self.env_incarnation.len()
            + self.value_rev.len()
            + self.policy_rev.len()
    }
}

pub struct ValueCache {
    state: Mutex<ValueState>,
    fills: LockMap<ValueKey>,
    dek_loads: LockMap<String>,
    permits: Semaphore,
}

impl ValueCache {
    pub fn new(node_budget_bytes: usize, org_budget_bytes: usize) -> Self {
        Self {
            state: Mutex::new(ValueState {
                node_budget_bytes,
                org_budget_bytes,
                ..Default::default()
            }),
            fills: Default::default(),
            dek_loads: Default::default(),
            permits: Semaphore::new(MAX_FILLS_IN_FLIGHT),
        }
    }

    pub async fn get_or_fill<F, Fut, E>(
        &self,
        key: &ValueKey,
        fill: F,
    ) -> Result<Arc<SecretValue>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<SecretValue, E>>,
    {
        if let Some(value) = self.get(key) {
            return Ok(value);
        }
        let registration = LockRegistration {
            map: &self.fills,
            key,
        };
        let (gate, generation) = registration.gate();
        let _guard = gate.mutex.lock().await;
        if let Some(value) = self.get(key) {
            return Ok(value);
        }
        // Only this cache owns the semaphore and it never closes it.
        let _permit = self
            .permits
            .acquire()
            .await
            .expect("fill semaphore is open");
        let value = Arc::new(fill().await?);
        let mut state = self.state.lock();
        if gate.generation.load(Ordering::Relaxed) == generation {
            state.insert(key, value.clone(), entry_ttl());
        }
        Ok(value)
    }

    pub async fn load_dek_coalesced<F, Fut, E>(
        &self,
        org_id: &str,
        load: F,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, E>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<Option<Zeroizing<Vec<u8>>>, E>>,
    {
        let org_id = org_id.to_owned();
        let registration = LockRegistration {
            map: &self.dek_loads,
            key: &org_id,
        };
        let (gate, _) = registration.gate();
        let _guard = gate.mutex.lock().await;
        load().await
    }

    pub fn get(&self, key: &ValueKey) -> Option<Arc<SecretValue>> {
        self.state.lock().get(key)
    }

    pub fn invalidate_secret(&self, org_id: &str, secret_id: &str) {
        self.invalidate(
            |key| key.org_id == org_id && key.secret_id == secret_id,
            |state| state.secret_keys(org_id, secret_id),
        );
    }

    pub fn invalidate_org(&self, org_id: &str) {
        self.invalidate(|key| key.org_id == org_id, |state| state.org_keys(org_id));
    }

    pub fn sweep(&self) {
        self.state.lock().sweep(Instant::now());
    }

    pub fn len(&self) -> usize {
        self.state.lock().entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn node_bytes(&self) -> usize {
        self.state.lock().bytes
    }

    pub fn org_bytes(&self, org_id: &str) -> usize {
        self.state
            .lock()
            .orgs
            .get(org_id)
            .map_or(0, |org| org.bytes)
    }

    fn invalidate(
        &self,
        matches: impl Fn(&ValueKey) -> bool,
        resident: impl FnOnce(&ValueState) -> Vec<Arc<ValueKey>>,
    ) {
        let mut state = self.state.lock();
        // An overlapping fill may return to its caller, but must not restore the evicted plaintext.
        for (key, gate) in self.fills.lock().iter() {
            if matches(key) {
                gate.generation.fetch_add(1, Ordering::Relaxed);
            }
        }
        for key in resident(&state) {
            state.remove(&key);
        }
    }

    #[cfg(test)]
    fn insert_with_ttl(&self, key: &ValueKey, value: Arc<SecretValue>, ttl: Duration) {
        self.state.lock().insert(key, value, ttl);
    }
}

#[derive(Default)]
struct ValueState {
    entries: LinkedHashMap<Arc<ValueKey>, ValueEntry>,
    orgs: HashMap<String, OrgUsage>,
    expiries: BTreeMap<(Instant, u64), Arc<ValueKey>>,
    last_seq: u64,
    bytes: usize,
    node_budget_bytes: usize,
    org_budget_bytes: usize,
    #[cfg(test)]
    visited: usize,
}

impl ValueState {
    fn get(&mut self, key: &ValueKey) -> Option<Arc<SecretValue>> {
        let entry = self.entries.to_back(key)?;
        if entry.expires <= Instant::now() {
            self.remove(key);
            return None;
        }
        let value = entry.value.clone();
        // Both eviction indexes contain every resident key.
        self.orgs
            .get_mut(&key.org_id)
            .expect("resident org")
            .keys
            .to_back(key);
        Some(value)
    }

    fn insert(&mut self, key: &ValueKey, value: Arc<SecretValue>, ttl: Duration) {
        let weight = key.bytes() + value.len();
        if value.len() > MAX_CACHED_VALUE_BYTES
            || weight > self.org_budget_bytes
            || weight > self.node_budget_bytes
        {
            return;
        }
        self.remove(key);
        self.make_room(&key.org_id, weight);
        let key = Arc::new(key.clone());
        let org = self.orgs.entry(key.org_id.clone()).or_default();
        org.keys.insert(key.clone());
        org.secrets
            .entry(key.secret_id.clone())
            .or_default()
            .insert(key.clone());
        org.bytes += weight;
        self.bytes += weight;
        self.last_seq += 1;
        let expires = Instant::now() + ttl;
        self.expiries.insert((expires, self.last_seq), key.clone());
        self.entries.insert(
            key,
            ValueEntry {
                value,
                weight,
                expires,
                seq: self.last_seq,
            },
        );
    }

    fn sweep(&mut self, now: Instant) {
        while let Some((&(expires, _), key)) = self.expiries.first_key_value()
            && expires <= now
        {
            #[cfg(test)]
            {
                self.visited += 1;
            }
            let key = key.clone();
            self.remove(&key);
        }
    }

    fn org_keys(&self, org_id: &str) -> Vec<Arc<ValueKey>> {
        self.orgs
            .get(org_id)
            .map(|org| org.keys.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn secret_keys(&self, org_id: &str, secret_id: &str) -> Vec<Arc<ValueKey>> {
        self.orgs
            .get(org_id)
            .and_then(|org| org.secrets.get(secret_id))
            .map(|keys| keys.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn make_room(&mut self, org_id: &str, weight: usize) {
        while let Some(org) = self.orgs.get(org_id) {
            if org.bytes <= self.org_budget_bytes - weight {
                break;
            }
            // An org over budget has at least one resident entry.
            let oldest = org.keys.front().expect("org has resident entries").clone();
            self.remove(&oldest);
        }
        while self.bytes > self.node_budget_bytes - weight {
            let (oldest, _) = self.entries.front().expect("node has resident entries");
            self.remove(&oldest.clone());
        }
    }

    fn remove(&mut self, key: &ValueKey) {
        let Some(entry) = self.entries.remove(key) else {
            return;
        };
        #[cfg(test)]
        {
            self.visited += 1;
        }
        self.bytes -= entry.weight;
        self.expiries.remove(&(entry.expires, entry.seq));
        // The org index is updated under the same mutex as the node index.
        let org = self.orgs.get_mut(&key.org_id).expect("resident org");
        org.keys.remove(key);
        if let Some(keys) = org.secrets.get_mut(&key.secret_id) {
            keys.remove(key);
            if keys.is_empty() {
                org.secrets.remove(&key.secret_id);
            }
        }
        org.bytes -= entry.weight;
        if org.keys.is_empty() {
            self.orgs.remove(&key.org_id);
        }
    }
}

struct ValueEntry {
    value: Arc<SecretValue>,
    expires: Instant,
    seq: u64,
    weight: usize,
}

#[derive(Default)]
struct OrgUsage {
    keys: LinkedHashSet<Arc<ValueKey>>,
    secrets: HashMap<String, HashSet<Arc<ValueKey>>>,
    bytes: usize,
}

type LockMap<K> = Mutex<HashMap<K, Arc<Gate>>>;

#[derive(Default)]
struct Gate {
    mutex: AsyncMutex<()>,
    generation: AtomicU64,
}

struct LockRegistration<'a, K: Eq + Hash> {
    map: &'a LockMap<K>,
    key: &'a K,
}

impl<K: Clone + Eq + Hash> LockRegistration<'_, K> {
    fn gate(&self) -> (Arc<Gate>, u64) {
        let mut map = self.map.lock();
        let gate = map.entry(self.key.clone()).or_default();
        (gate.clone(), gate.generation.load(Ordering::Relaxed))
    }
}

impl<K: Eq + Hash> Drop for LockRegistration<'_, K> {
    fn drop(&mut self) {
        let mut map = self.map.lock();
        // Callers release their gate before this registration, including on cancellation.
        if map
            .get(self.key)
            .is_some_and(|gate| Arc::strong_count(gate) == 1)
        {
            map.remove(self.key);
        }
    }
}

pub type Allowlist = HashSet<(String, String)>;
type AllowlistKey = (String, String, String);

#[derive(Default)]
pub struct AllowlistCache {
    entries: Mutex<AllowlistEntries>,
}

impl AllowlistCache {
    pub fn get(&self, org: &str, secret_id: &str, policy_rev: &str) -> Option<Arc<Allowlist>> {
        let key = (org.to_owned(), secret_id.to_owned(), policy_rev.to_owned());
        let mut entries = self.entries.lock();
        let entry = entries.get(&key)?;
        if entry.expires > Instant::now() {
            return Some(entry.set.clone());
        }
        entries.remove(&key);
        None
    }

    /// Sets over the per-entry cap are not cached; callers read them from the store each time.
    pub fn insert(&self, org: &str, secret_id: &str, policy_rev: &str, set: Arc<Allowlist>) {
        let key = (org.to_owned(), secret_id.to_owned(), policy_rev.to_owned());
        let weight = allowlist_weight(&key, &set);
        let mut entries = self.entries.lock();
        entries.remove(&key);
        if weight > MAX_ALLOWLIST_ENTRY_BYTES {
            return;
        }
        while entries.map.len() >= MAX_ALLOWLIST_ENTRIES
            || entries.bytes + weight > MAX_ALLOWLIST_BYTES
        {
            let Some((_, oldest)) = entries.map.pop_front() else {
                break;
            };
            entries.bytes -= oldest.weight;
        }
        entries.bytes += weight;
        entries.map.insert(
            key,
            AllowlistEntry {
                set,
                expires: Instant::now() + entry_ttl(),
                weight,
            },
        );
    }
}

#[derive(Default)]
struct AllowlistEntries {
    map: LinkedHashMap<AllowlistKey, AllowlistEntry>,
    bytes: usize,
}

impl AllowlistEntries {
    fn get(&self, key: &AllowlistKey) -> Option<&AllowlistEntry> {
        self.map.get(key)
    }

    fn remove(&mut self, key: &AllowlistKey) {
        if let Some(entry) = self.map.remove(key) {
            self.bytes -= entry.weight;
        }
    }
}

struct AllowlistEntry {
    set: Arc<Allowlist>,
    expires: Instant,
    weight: usize,
}

pub fn value_cache() -> &'static ValueCache {
    &VALUE_CACHE
}

pub fn allowlist_cache() -> &'static AllowlistCache {
    &ALLOWLIST_CACHE
}

pub fn allows(set: &Allowlist, consumer_type: &str, consumer_id: &str) -> bool {
    let mut consumer = (consumer_type.to_owned(), consumer_id.to_owned());
    if set.contains(&consumer) {
        return true;
    }
    consumer.1.clear();
    consumer.1.push('*');
    set.contains(&consumer)
}

/// Byte budgets for each of the local and external value caches: half of the configured node and
/// org budgets each, so the two together stay within `O2_SECRET_CACHE_NODE_MB` / `_ORG_MB`.
pub(crate) fn half_budgets() -> (usize, usize) {
    let cfg = config::get_config();
    split_budgets(
        cfg.common.secret_cache_node_mb,
        cfg.common.secret_cache_org_mb,
    )
}

pub fn spawn_sweeper() {
    tokio::spawn(async {
        let mut interval = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            interval.tick().await;
            value_cache().sweep();
        }
    });
}

fn split_budgets(node_mb: usize, org_mb: usize) -> (usize, usize) {
    (
        node_mb.saturating_mul(1 << 20) / 2,
        org_mb.saturating_mul(1 << 20) / 2,
    )
}

fn allowlist_weight(key: &AllowlistKey, set: &Allowlist) -> usize {
    let pair = size_of::<(String, String)>();
    size_of::<AllowlistKey>()
        + size_of::<AllowlistEntry>()
        + key.0.len()
        + key.1.len()
        + key.2.len()
        + set
            .iter()
            .map(|(kind, id)| pair + kind.len() + id.len())
            .sum::<usize>()
}

fn entry_ttl() -> Duration {
    loop {
        let mut hash = DefaultHasher::new();
        (Instant::now(), TTL_COUNTER.fetch_add(1, Ordering::Relaxed)).hash(&mut hash);
        let sample = hash.finish();
        // Reject the incomplete bucket so all seven lifetimes are equally likely.
        if sample < u64::MAX - u64::MAX % 7 {
            return Duration::from_secs(54 + sample % 7);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

    use tokio::{sync::Barrier, task::JoinSet, time::sleep};

    use super::*;

    fn key(org: &str, secret: &str) -> ValueKey {
        ValueKey {
            org_id: org.into(),
            secret_id: secret.into(),
            effective_env_id: "e".into(),
            env_incarnation: "i".into(),
            value_rev: "v".into(),
            policy_rev: "p".into(),
        }
    }

    #[test]
    fn local_and_external_caches_share_one_configured_budget() {
        let (node, org) = split_budgets(256, 32);
        assert_eq!(2 * node, 256 << 20);
        assert_eq!(2 * org, 32 << 20);
        assert!(org >= MAX_CACHED_VALUE_BYTES);
    }

    async fn fill(cache: &ValueCache, key: &ValueKey) -> Arc<SecretValue> {
        cache
            .get_or_fill(key, || async {
                Ok::<_, ()>(SecretValue::new(key.secret_id.clone()))
            })
            .await
            .unwrap()
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn thousand_callers_share_three_cold_fills() {
        let cache = Arc::new(ValueCache::new(4096, 4096));
        let fills = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(1000));
        let mut tasks = JoinSet::new();
        for i in 0..1000 {
            let (cache, fills, start) = (cache.clone(), fills.clone(), start.clone());
            tasks.spawn(async move {
                let key = key("org", &(i % 3).to_string());
                start.wait().await;
                let result = cache
                    .get_or_fill(&key, || async {
                        fills.fetch_add(1, SeqCst);
                        sleep(Duration::from_millis(20)).await;
                        Ok::<_, ()>(SecretValue::new(key.secret_id.clone()))
                    })
                    .await
                    .unwrap();
                assert!(result.as_str() == key.secret_id);
            });
        }
        while let Some(task) = tasks.join_next().await {
            task.unwrap();
        }
        assert_eq!(fills.load(SeqCst), 3);
    }

    #[tokio::test]
    async fn org_budget_releases_oldest_buffer_and_preserves_other_org() {
        let cache = ValueCache::new(100, 14);
        let (first, second, third, other) =
            (key("a", "1"), key("a", "2"), key("a", "3"), key("b", "1"));
        let weak = Arc::downgrade(&fill(&cache, &first).await);
        fill(&cache, &other).await;
        fill(&cache, &second).await;
        assert!(weak.upgrade().is_some());
        fill(&cache, &third).await;
        assert!(weak.upgrade().is_none());
        assert!(cache.get(&first).is_none());
        assert!(cache.get(&other).is_some());
        assert_eq!(cache.org_bytes("a"), 14);
        assert_eq!(cache.org_bytes("b"), 7);
        assert_eq!(cache.node_bytes(), 21);
    }

    #[tokio::test]
    async fn node_budget_evicts_across_orgs() {
        let cache = ValueCache::new(14, 14);
        let (first, second, third) = (key("a", "1"), key("b", "2"), key("b", "3"));
        fill(&cache, &first).await;
        fill(&cache, &second).await;
        fill(&cache, &third).await;
        assert!(cache.get(&first).is_none());
        assert!(cache.get(&second).is_some());
        assert!(cache.get(&third).is_some());
        assert_eq!(cache.org_bytes("a"), 0);
        assert_eq!(cache.node_bytes(), 14);
    }

    #[tokio::test]
    async fn oversized_values_are_returned_and_refilled() {
        let cache = ValueCache::new(1024 * 1024, 1024 * 1024);
        let key = key("org", "large");
        let fills = AtomicUsize::new(0);
        for _ in 0..2 {
            let result = cache
                .get_or_fill(&key, || async {
                    fills.fetch_add(1, SeqCst);
                    Ok::<_, ()>(SecretValue::new("x".repeat(65 * 1024)))
                })
                .await
                .unwrap();
            assert_eq!(result.len(), 65 * 1024);
            assert!(cache.is_empty());
            assert_eq!(cache.node_bytes(), 0);
        }
        assert_eq!(fills.load(SeqCst), 2);
    }

    #[tokio::test]
    async fn expiration_prevents_hits_and_sweep_releases_unread_entries() {
        let cache = ValueCache::new(4096, 4096);
        let expired = key("org", "expired");
        let unread = key("org", "unread");
        let fresh = key("org", "fresh");
        for key in [&expired, &unread] {
            cache.insert_with_ttl(key, Arc::new(SecretValue::new("x".into())), Duration::ZERO);
        }
        fill(&cache, &fresh).await;
        assert!(cache.get(&expired).is_none());
        cache.sweep();
        assert_eq!(cache.len(), 1);
        assert!(cache.get(&fresh).is_some());
    }

    #[tokio::test]
    async fn failed_and_cancelled_fills_allow_retry() {
        let cache = Arc::new(ValueCache::new(4096, 4096));
        let key = key("org", "retry");
        let result = cache
            .get_or_fill(&key, || async { Err("unavailable") })
            .await;
        assert!(matches!(result, Err("unavailable")));
        assert!(cache.is_empty());
        let (started, ready) = tokio::sync::oneshot::channel();
        let task = {
            let cache = cache.clone();
            let key = key.clone();
            tokio::spawn(async move {
                cache
                    .get_or_fill(&key, || async {
                        started.send(()).unwrap();
                        std::future::pending::<Result<SecretValue, ()>>().await
                    })
                    .await
            })
        };
        ready.await.unwrap();
        task.abort();
        assert!(matches!(task.await, Err(e) if e.is_cancelled()));
        tokio::time::timeout(Duration::from_secs(5), fill(&cache, &key))
            .await
            .unwrap();
        assert_eq!(cache.len(), 1);
    }

    #[tokio::test]
    async fn invalidation_prevents_queued_fills_from_restoring_entries() {
        let cache = ValueCache::new(4096, 4096);
        let key = key("org", "queued");
        let (release, paused) = tokio::sync::oneshot::channel::<()>();
        let first = cache.get_or_fill(&key, || async {
            paused.await.unwrap();
            Ok::<_, ()>(SecretValue::new("first".into()))
        });
        tokio::pin!(first);
        assert!(futures::poll!(&mut first).is_pending());
        let waiter = cache.get_or_fill(&key, || async {
            Ok::<_, ()>(SecretValue::new("waiter".into()))
        });
        tokio::pin!(waiter);
        assert!(futures::poll!(&mut waiter).is_pending());

        cache.invalidate_secret(&key.org_id, &key.secret_id);
        release.send(()).unwrap();
        assert!(first.await.unwrap().as_str() == "first");
        assert!(waiter.await.unwrap().as_str() == "waiter");
        assert!(cache.is_empty());
        fill(&cache, &key).await;
        assert!(cache.get(&key).is_some());
    }

    #[tokio::test]
    async fn revisions_environments_and_orgs_are_distinct_and_invalidated_by_scope() {
        let cache = ValueCache::new(4096, 4096);
        let base = key("a", "1");
        let keys = [
            base.clone(),
            ValueKey {
                value_rev: "2".into(),
                ..base.clone()
            },
            ValueKey {
                policy_rev: "2".into(),
                ..base.clone()
            },
            ValueKey {
                effective_env_id: "2".into(),
                ..base.clone()
            },
            ValueKey {
                env_incarnation: "2".into(),
                ..base.clone()
            },
            key("b", "1"),
            key("a", "2"),
        ];
        for (i, key) in keys.iter().enumerate() {
            cache
                .get_or_fill(key, || async {
                    Ok::<_, ()>(SecretValue::new(i.to_string()))
                })
                .await
                .unwrap();
        }
        for (i, key) in keys.iter().enumerate() {
            assert!(cache.get(key).unwrap().as_str() == i.to_string());
        }
        cache.invalidate_secret("a", "1");
        assert_eq!(cache.len(), 2);
        assert!(cache.get(&key("a", "2")).is_some());
        cache.invalidate_org("a");
        assert_eq!(cache.len(), 1);
        assert!(cache.get(&key("b", "1")).is_some());
        assert_eq!(cache.org_bytes("a"), 0);
    }

    #[test]
    fn allowlist_requires_matching_org_secret_and_policy_revision() {
        let cache = AllowlistCache::default();
        let set = Arc::new(HashSet::from([
            ("check".into(), "1".into()),
            ("job".into(), "*".into()),
        ]));
        cache.insert("a", "s", "p", set.clone());
        let hit = cache.get("a", "s", "p").unwrap();
        assert!(Arc::ptr_eq(&hit, &set));
        assert!(allows(&hit, "check", "1"));
        assert!(!allows(&hit, "check", "2"));
        assert!(allows(&hit, "job", "2"));
        assert!(!allows(&hit, "other", "1"));
        for (org, secret, rev) in [("b", "s", "p"), ("a", "t", "p"), ("a", "s", "q")] {
            assert!(cache.get(org, secret, rev).is_none());
        }
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn distinct_keys_respect_node_fill_limit() {
        let cache = Arc::new(ValueCache::new(4096, 4096));
        let active = Arc::new(AtomicUsize::new(0));
        let start = Arc::new(Barrier::new(MAX_FILLS_IN_FLIGHT * 2));
        let mut tasks = JoinSet::new();
        for i in 0..MAX_FILLS_IN_FLIGHT * 2 {
            let (cache, active, start) = (cache.clone(), active.clone(), start.clone());
            tasks.spawn(async move {
                start.wait().await;
                fill_counted(&cache, &key("org", &i.to_string()), &active).await;
            });
        }
        while let Some(task) = tasks.join_next().await {
            task.unwrap();
        }
    }

    async fn fill_counted(cache: &ValueCache, key: &ValueKey, active: &AtomicUsize) {
        cache
            .get_or_fill(key, || async {
                let count = active.fetch_add(1, SeqCst) + 1;
                assert!(count <= MAX_FILLS_IN_FLIGHT);
                sleep(Duration::from_millis(20)).await;
                active.fetch_sub(1, SeqCst);
                Ok::<_, ()>(SecretValue::new(String::new()))
            })
            .await
            .unwrap();
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 4)]
    async fn dek_loads_serialize_per_org_and_overlap_across_orgs() {
        let cache = Arc::new(ValueCache::new(4096, 4096));
        let active = Arc::new([AtomicUsize::new(0), AtomicUsize::new(0)]);
        let loads = Arc::new([AtomicUsize::new(0), AtomicUsize::new(0)]);
        let first_loads = Arc::new(Barrier::new(2));
        let start = Arc::new(Barrier::new(50));
        let mut tasks = JoinSet::new();
        for i in 0..50 {
            let org = i % 2;
            let (cache, active, loads, first_loads, start) = (
                cache.clone(),
                active.clone(),
                loads.clone(),
                first_loads.clone(),
                start.clone(),
            );
            tasks.spawn(async move {
                start.wait().await;
                let value = cache
                    .load_dek_coalesced(["a", "b"][org], || async {
                        assert_eq!(active[org].fetch_add(1, SeqCst), 0);
                        if loads[org].fetch_add(1, SeqCst) == 0 {
                            tokio::time::timeout(Duration::from_secs(5), first_loads.wait())
                                .await
                                .unwrap();
                        }
                        tokio::task::yield_now().await;
                        active[org].fetch_sub(1, SeqCst);
                        Ok::<_, ()>(Some(Zeroizing::new(vec![org as u8])))
                    })
                    .await
                    .unwrap()
                    .unwrap();
                assert!(value.as_slice() == [org as u8]);
            });
        }
        while let Some(task) = tasks.join_next().await {
            task.unwrap();
        }
    }

    #[tokio::test]
    async fn invalidation_and_sweep_visit_only_their_own_entries() {
        let cache = ValueCache::new(1 << 30, 1 << 30);
        for i in 0..2_000 {
            fill(&cache, &key("other", &i.to_string())).await;
        }
        let (one, two) = (key("a", "1"), key("a", "2"));
        fill(&cache, &one).await;
        fill(&cache, &two).await;
        let expired = key("a", "expired");
        cache.insert_with_ttl(
            &expired,
            Arc::new(SecretValue::new("x".into())),
            Duration::ZERO,
        );
        let visited = |cache: &ValueCache| std::mem::take(&mut cache.state.lock().visited);
        visited(&cache);

        cache.sweep();
        assert!(visited(&cache) <= 2, "sweep reads only due entries");
        assert!(cache.get(&expired).is_none());
        cache.invalidate_secret("a", "1");
        assert!(visited(&cache) <= 1);
        assert!(cache.get(&one).is_none() && cache.get(&two).is_some());
        cache.invalidate_org("a");
        assert!(visited(&cache) <= 1);
        assert!(cache.get(&two).is_none());
        assert_eq!(cache.len(), 2_000);
        assert_eq!(cache.org_bytes("a"), 0);
    }

    #[test]
    fn allowlist_cache_is_bounded_in_bytes() {
        fn weight(set: &Allowlist) -> usize {
            set.iter().map(|(a, b)| a.len() + b.len()).sum()
        }
        let cache = AllowlistCache::default();
        let big: Allowlist = (0..4_000)
            .map(|i| ("synthetics_check".to_string(), format!("{i:0>48}")))
            .collect();
        for i in 0..200 {
            cache.insert("org", &i.to_string(), "p", Arc::new(big.clone()));
        }
        let resident: usize = cache
            .entries
            .lock()
            .map
            .values()
            .map(|e| weight(&e.set))
            .sum();
        assert!(
            resident <= 16 << 20,
            "resident allowlists hold {resident} bytes"
        );

        let huge: Allowlist = (0..40_000)
            .map(|i| ("synthetics_check".to_string(), format!("{i:0>48}")))
            .collect();
        cache.insert("org", "huge", "p", Arc::new(huge));
        assert!(cache.get("org", "huge", "p").is_none());
        assert!(cache.get("org", "199", "p").is_some());
    }
}
