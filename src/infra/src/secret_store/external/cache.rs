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
    sync::{Arc, LazyLock, OnceLock},
    time::{Duration, Instant},
};

use config::meta::secret_store::{
    SecretErrorCode, SecretValue,
    external::{ExternalSecretBackend, FetchError, Pointer, ResolvedIdentity},
};
use hashlink::{LinkedHashMap, LinkedHashSet};
use parking_lot::Mutex;
use sea_orm::ConnectionTrait;
use tokio::sync::OnceCell;

use super::{
    limits, lookup_backend,
    readiness::{self, ReadyBackend},
};
use crate::{
    db::Event,
    secret_store::cache::{
        MAX_CACHED_VALUE_BYTES, SWEEP_INTERVAL, ValueKey, half_budgets, value_cache,
    },
};

const REFRESH_PREFIX: &str = "/secret_store/refresh/";
// Longer than the 15 s total fetch deadline; a fill whose generation was pruned still cannot
// install.
const EVICTION_MEMORY: Duration = Duration::from_secs(60);
const AUTH_REFETCH_COOLDOWN: Duration = Duration::from_secs(60);
const FILL_ROUNDS: usize = 2;

static FETCH_OBSERVER: OnceLock<fn(&FetchEvent<'_>)> = OnceLock::new();

static CACHE: LazyLock<ExternalCache> = LazyLock::new(|| {
    tokio::spawn(async {
        let mut timer = tokio::time::interval(SWEEP_INTERVAL);
        loop {
            timer.tick().await;
            CACHE.entries.lock().sweep(Instant::now());
        }
    });
    let (node, org) = half_budgets();
    ExternalCache::new(node, org)
});

type Outcome = Result<Arc<SecretValue>, SecretErrorCode>;
type Flights = HashMap<(Key, u64), Arc<OnceCell<Outcome>>>;

#[derive(Clone, Hash, PartialEq, Eq)]
struct Key {
    value: ValueKey,
    backend_id: String,
    backend_rev: String,
    identity_rev: String,
}

impl Key {
    fn weight(&self, value: &SecretValue) -> usize {
        let k = &self.value;
        size_of::<Self>()
            + size_of::<Entry>()
            + 4 * size_of::<Arc<Self>>()
            + k.org_id.len()
            + k.secret_id.len()
            + k.effective_env_id.len()
            + k.env_incarnation.len()
            + k.value_rev.len()
            + k.policy_rev.len()
            + self.backend_id.len()
            + self.backend_rev.len()
            + self.identity_rev.len()
            + value.len()
    }
}

/// One provider fill attempt; carries no value, length or provider text.
pub struct FetchEvent<'a> {
    pub org_id: &'a str,
    pub secret_id: &'a str,
    pub backend_id: &'a str,
    pub backend_rev: &'a str,
    pub identity_rev: &'a str,
    pub value_rev: &'a str,
    pub locator: &'a str,
    pub outcome: &'static str,
    pub code: &'static str,
    pub cache: &'static str,
    /// `auth_refetch` for the first fill after a downstream 401/403 evicted the secret, else
    /// `send`.
    pub trigger: &'static str,
    pub duration: Duration,
}

struct Entry {
    value: Arc<SecretValue>,
    fresh_until: Instant,
    stale_until: Instant,
    removal: Instant,
    seq: u64,
    weight: usize,
}

struct ExternalCache {
    entries: Mutex<Entries>,
    flights: Mutex<Flights>,
    auth_refetches: Mutex<HashMap<(String, String), Instant>>,
}

impl ExternalCache {
    fn new(node_budget: usize, org_budget: usize) -> Self {
        Self {
            entries: Mutex::new(Entries {
                values: LinkedHashMap::new(),
                org_keys: HashMap::new(),
                secret_keys: HashMap::new(),
                expiries: BTreeMap::new(),
                last_seq: 0,
                org_bytes: HashMap::new(),
                bytes: 0,
                node_budget,
                org_budget,
                generations: HashMap::new(),
                last_generation: 0,
                auth_refetched: HashMap::new(),
                #[cfg(test)]
                visited: 0,
            }),
            flights: Mutex::new(HashMap::new()),
            auth_refetches: Mutex::new(HashMap::new()),
        }
    }

    fn take_auth_refetch(&self, org_id: &str, secret_id: &str, now: Instant) -> bool {
        let mut refetches = self.auth_refetches.lock();
        refetches.retain(|_, at| now.saturating_duration_since(*at) < AUTH_REFETCH_COOLDOWN);
        let key = (org_id.to_string(), secret_id.to_string());
        if refetches.contains_key(&key) {
            return false;
        }
        refetches.insert(key, now);
        true
    }

    /// `auth` marks the next fill under the new generation as the refetch after an auth failure.
    fn evict_secret(&self, org_id: &str, secret_id: &str, now: Instant, auth: bool) {
        let mut entries = self.entries.lock();
        entries
            .generations
            .retain(|_, (_, at)| now.saturating_duration_since(*at) < EVICTION_MEMORY);
        entries.last_generation += 1;
        let generation = entries.last_generation;
        let secret = (org_id.to_string(), secret_id.to_string());
        if auth {
            entries.auth_refetched.insert(secret.clone(), generation);
        }
        entries.generations.insert(secret, (generation, now));
        let Entries {
            generations,
            auth_refetched,
            ..
        } = &mut *entries;
        auth_refetched.retain(|secret, generation| {
            generations
                .get(secret)
                .is_some_and(|(g, _)| g == generation)
        });
        for key in entries.secret_keys_of(org_id, secret_id) {
            entries.remove(&key);
        }
    }

    /// One fill per auth eviction is the refetch; a later fill under the same generation is not.
    fn take_trigger(&self, key: &Key, generation: u64) -> &'static str {
        let mut entries = self.entries.lock();
        let secret = (key.value.org_id.clone(), key.value.secret_id.clone());
        if entries.auth_refetched.get(&secret) == Some(&generation) {
            entries.auth_refetched.remove(&secret);
            "auth_refetch"
        } else {
            "send"
        }
    }

    /// Only a fill that reaches the provider consumes the auth refetch trigger; one refused a
    /// queue slot, a permit or by the circuit leaves it for the fill that does.
    async fn fetch_through(
        &self,
        (key, generation): (&Key, u64),
        limits: &limits::Limits,
        provider: &dyn ExternalSecretBackend,
        pointer: &Pointer,
        identity: &ResolvedIdentity,
    ) -> (Result<SecretValue, FetchError>, &'static str) {
        let _capacity = match limits.enter() {
            Ok(permit) => permit,
            Err(err) => return (Err(err), self.peek_trigger(key, generation)),
        };
        let mut trigger = None;
        let result = limits
            .fetch(provider, pointer, identity, || {
                trigger.get_or_insert_with(|| self.take_trigger(key, generation));
            })
            .await;
        let trigger = trigger.unwrap_or_else(|| self.peek_trigger(key, generation));
        (result, trigger)
    }

    fn peek_trigger(&self, key: &Key, generation: u64) -> &'static str {
        let entries = self.entries.lock();
        let secret = (key.value.org_id.clone(), key.value.secret_id.clone());
        if entries.auth_refetched.get(&secret) == Some(&generation) {
            "auth_refetch"
        } else {
            "send"
        }
    }

    fn generation(&self, key: &Key) -> u64 {
        self.entries.lock().generation(key)
    }

    /// Installs a fill only when no refresh of its secret happened since `generation` was read.
    fn install(
        &self,
        key: &Key,
        generation: u64,
        value: Arc<SecretValue>,
        fresh_until: Instant,
        stale_until: Instant,
    ) -> bool {
        let mut entries = self.entries.lock();
        if entries.generation(key) != generation {
            return false;
        }
        entries.insert(key, value, fresh_until, stale_until);
        true
    }

    /// A flight that overlapped a refresh holds a pre-refresh outcome, so its callers get one
    /// fill under the new generation; a refresh during that fill too fails closed.
    async fn fill_current<F, Fut>(&self, key: &Key, mut fill: F) -> Outcome
    where
        F: FnMut(u64) -> Fut,
        Fut: Future<Output = Outcome>,
    {
        let mut generation = self.generation(key);
        for _ in 0..FILL_ROUNDS {
            let outcome = fill(generation).await;
            let current = self.generation(key);
            if current == generation {
                return outcome;
            }
            generation = current;
        }
        Err(SecretErrorCode::SecretUnavailable)
    }

    fn fresh(&self, key: &Key, now: Instant) -> Option<Arc<SecretValue>> {
        let mut entries = self.entries.lock();
        let entry = entries.values.to_back(key)?;
        if now >= entry.fresh_until && now >= entry.stale_until {
            entries.remove(key);
            return None;
        }
        let value = (now < entry.fresh_until).then(|| entry.value.clone());
        entries.touch(key);
        value
    }

    fn failure(&self, key: &Key, generation: u64, err: &FetchError, now: Instant) -> Outcome {
        let mut entries = self.entries.lock();
        if err.is_transient()
            && let Some(entry) = entries.values.get(key)
            && (now < entry.fresh_until || now < entry.stale_until)
        {
            return Ok(entry.value.clone());
        }
        // A fill that started before a refresh must not evict the value a newer fill installed.
        if entries.generation(key) == generation {
            entries.remove(key);
        }
        Err(SecretErrorCode::SecretUnavailable)
    }

    fn flight(&self, key: &Key, generation: u64) -> Flight<'_> {
        let flight_key = (key.clone(), generation);
        let mut flights = self.flights.lock();
        let cell = flights.entry(flight_key.clone()).or_default();
        // Completed flights can still have waking waiters. New requests must check freshness again.
        if cell.initialized() {
            *cell = Arc::default();
        }
        let cell = cell.clone();
        Flight {
            cell,
            _registration: Registration {
                cache: self,
                key: flight_key,
            },
        }
    }
}

struct Flight<'a> {
    // Fields drop in order. Release the caller's reference before checking for the last waiter.
    cell: Arc<OnceCell<Outcome>>,
    _registration: Registration<'a>,
}

struct Registration<'a> {
    cache: &'a ExternalCache,
    key: (Key, u64),
}

impl Drop for Registration<'_> {
    fn drop(&mut self) {
        let mut flights = self.cache.flights.lock();
        if flights
            .get(&self.key)
            .is_some_and(|cell| Arc::strong_count(cell) == 1)
        {
            flights.remove(&self.key);
        }
    }
}

struct Entries {
    values: LinkedHashMap<Arc<Key>, Entry>,
    org_keys: HashMap<String, LinkedHashSet<Arc<Key>>>,
    secret_keys: HashMap<(String, String), HashSet<Arc<Key>>>,
    expiries: BTreeMap<(Instant, u64), Arc<Key>>,
    last_seq: u64,
    org_bytes: HashMap<String, usize>,
    bytes: usize,
    node_budget: usize,
    org_budget: usize,
    generations: HashMap<(String, String), (u64, Instant)>,
    last_generation: u64,
    auth_refetched: HashMap<(String, String), u64>,
    #[cfg(test)]
    visited: usize,
}

impl Entries {
    fn generation(&self, key: &Key) -> u64 {
        self.generations
            .get(&(key.value.org_id.clone(), key.value.secret_id.clone()))
            .map_or(0, |(generation, _)| *generation)
    }

    fn sweep(&mut self, now: Instant) {
        while let Some((&(removal, _), key)) = self.expiries.first_key_value()
            && removal <= now
        {
            let key = key.clone();
            self.remove(&key);
        }
    }

    fn secret_keys_of(&self, org_id: &str, secret_id: &str) -> Vec<Arc<Key>> {
        self.secret_keys
            .get(&(org_id.to_string(), secret_id.to_string()))
            .map(|keys| keys.iter().cloned().collect())
            .unwrap_or_default()
    }

    fn insert(
        &mut self,
        key: &Key,
        value: Arc<SecretValue>,
        fresh_until: Instant,
        stale_until: Instant,
    ) {
        let weight = key.weight(&value);
        self.remove(key);
        if value.len() > MAX_CACHED_VALUE_BYTES
            || weight > self.org_budget
            || weight > self.node_budget
        {
            return;
        }
        let org = &key.value.org_id;
        while self.org_bytes.get(org).copied().unwrap_or(0) > self.org_budget - weight {
            let oldest = self
                .org_keys
                .get(org)
                .and_then(|keys| keys.front())
                .cloned();
            let Some(oldest) = oldest else {
                return;
            };
            self.remove(&oldest);
        }
        while self.bytes > self.node_budget - weight {
            let Some((oldest, _)) = self.values.front() else {
                return;
            };
            self.remove(&oldest.clone());
        }
        let key = Arc::new(key.clone());
        self.last_seq += 1;
        let removal = fresh_until.max(stale_until);
        self.expiries.insert((removal, self.last_seq), key.clone());
        self.org_keys
            .entry(org.clone())
            .or_default()
            .insert(key.clone());
        self.secret_keys
            .entry((org.clone(), key.value.secret_id.clone()))
            .or_default()
            .insert(key.clone());
        self.bytes += weight;
        *self.org_bytes.entry(org.clone()).or_default() += weight;
        self.values.insert(
            key,
            Entry {
                value,
                fresh_until,
                stale_until,
                removal,
                seq: self.last_seq,
                weight,
            },
        );
    }

    fn touch(&mut self, key: &Key) {
        if let Some(keys) = self.org_keys.get_mut(&key.value.org_id) {
            keys.to_back(key);
        }
    }

    fn remove(&mut self, key: &Key) {
        if let Some(entry) = self.values.remove(key) {
            #[cfg(test)]
            {
                self.visited += 1;
            }
            self.expiries.remove(&(entry.removal, entry.seq));
            let org_id = &key.value.org_id;
            if let Some(keys) = self.org_keys.get_mut(org_id) {
                keys.remove(key);
                if keys.is_empty() {
                    self.org_keys.remove(org_id);
                }
            }
            let secret = (org_id.clone(), key.value.secret_id.clone());
            if let Some(keys) = self.secret_keys.get_mut(&secret) {
                keys.remove(key);
                if keys.is_empty() {
                    self.secret_keys.remove(&secret);
                }
            }
            self.bytes -= entry.weight;
            let bytes = self
                .org_bytes
                .get_mut(&key.value.org_id)
                .expect("resident org");
            *bytes -= entry.weight;
            if *bytes == 0 {
                self.org_bytes.remove(&key.value.org_id);
            }
        }
    }
}

pub(crate) async fn fetch_in<C: ConnectionTrait>(
    conn: &C,
    key: ValueKey,
    ready: &ReadyBackend,
    pointer: &Pointer,
) -> Outcome {
    let key = Key {
        value: key,
        backend_id: pointer.backend_id.clone(),
        backend_rev: ready.backend.backend_rev.clone(),
        identity_rev: ready.identity.identity_rev(),
    };
    if let Some(value) = CACHE.fresh(&key, Instant::now()) {
        return Ok(value);
    }
    let limits = limits::for_backend(&key.value.org_id, &pointer.backend_id);
    CACHE
        .fill_current(&key, |generation| {
            fill(conn, &key, ready, pointer, &limits, generation)
        })
        .await
}

/// The audit layer registers once per process; fills before registration are not audited.
pub fn set_fetch_observer(observer: fn(&FetchEvent<'_>)) {
    let _ = FETCH_OBSERVER.set(observer);
}

async fn fill<C: ConnectionTrait>(
    conn: &C,
    key: &Key,
    ready: &ReadyBackend,
    pointer: &Pointer,
    limits: &limits::Limits,
    generation: u64,
) -> Outcome {
    let flight = CACHE.flight(key, generation);
    flight
        .cell
        .get_or_init(|| async {
            if let Some(value) = CACHE.fresh(key, Instant::now()) {
                return Ok(value);
            }
            let started = Instant::now();
            let provider = lookup_backend(ready.kind);
            let (result, trigger) = CACHE
                .fetch_through(
                    (key, generation),
                    limits,
                    provider.as_ref(),
                    pointer,
                    &ready.identity,
                )
                .await;
            let value = match result {
                Ok(value) => Arc::new(value),
                Err(err) => return failed(key, (generation, trigger), pointer, &err, started),
            };
            observe(key, pointer, ("ok", "ok"), ("fill", trigger), started);
            let now = Instant::now();
            let current = readiness::ready_in(conn, &key.value.org_id, &key.backend_id).await?;
            if current.backend.backend_rev != key.backend_rev || current.identity != ready.identity
            {
                return Err(SecretErrorCode::SecretUnavailable);
            }
            let sample = config::utils::rand::get_rand_num_within(0, 256) as u8;
            let ttl = jittered_ttl(ready.backend.ttl_secs, sample);
            let stale_max = Duration::from_secs(ready.backend.stale_max_secs.clamp(0, 3600) as u64);
            CACHE.install(key, generation, value.clone(), now + ttl, now + stale_max);
            Ok(value)
        })
        .await
        .clone()
}

fn failed(
    key: &Key,
    (generation, trigger): (u64, &'static str),
    pointer: &Pointer,
    err: &FetchError,
    started: Instant,
) -> Outcome {
    let outcome = CACHE.failure(key, generation, err, Instant::now());
    let class = err.class();
    let cache = if outcome.is_ok() {
        "stale_serve"
    } else {
        "fill"
    };
    observe(
        key,
        pointer,
        (class, err.reason()),
        (cache, trigger),
        started,
    );
    outcome
}

fn observe(
    key: &Key,
    pointer: &Pointer,
    (outcome, code): (&'static str, &'static str),
    (cache, trigger): (&'static str, &'static str),
    started: Instant,
) {
    if let Some(observer) = FETCH_OBSERVER.get() {
        observer(&FetchEvent {
            org_id: &key.value.org_id,
            secret_id: &key.value.secret_id,
            backend_id: &key.backend_id,
            backend_rev: &key.backend_rev,
            identity_rev: &key.identity_rev,
            value_rev: &key.value.value_rev,
            locator: &pointer.locator,
            outcome,
            code,
            cache,
            trigger,
            duration: started.elapsed(),
        });
    }
}

/// Evicts one secret's external and local cache entries on this node and announces it to the
/// others.
pub async fn refresh_secret(org_id: &str, secret_id: &str) -> Result<(), crate::errors::Error> {
    evict_local(org_id, secret_id);
    crate::coordinator::emit_put(&refresh_key(org_id, secret_id)).await
}

/// After a downstream 401/403, drops this node's cached provider value so the next resolve
/// refetches; false (nothing evicted) within 60 s of the last refetch for the same secret.
pub fn refetch_on_auth_failure(org_id: &str, secret_id: &str) -> bool {
    let now = Instant::now();
    if !CACHE.take_auth_refetch(org_id, secret_id, now) {
        return false;
    }
    CACHE.evict_secret(org_id, secret_id, now, true);
    true
}

/// Runs on every node for the life of the process and applies refreshes announced by other nodes.
pub async fn watch_refresh() -> Result<(), anyhow::Error> {
    let coordinator = crate::coordinator::get_coordinator().await;
    let mut events = coordinator.watch(REFRESH_PREFIX).await?;
    let events = Arc::get_mut(&mut events).expect("watch receiver has one owner");
    while let Some(event) = events.recv().await {
        let Event::Put(event) = event else {
            continue;
        };
        match parse_refresh_key(&event.key) {
            Some((org_id, secret_id)) => evict_local(org_id, secret_id),
            None => log::warn!("secret refresh: malformed key {}", event.key),
        }
    }
    log::error!("secret refresh: event channel closed");
    Ok(())
}

fn evict_local(org_id: &str, secret_id: &str) {
    CACHE.evict_secret(org_id, secret_id, Instant::now(), false);
    value_cache().invalidate_secret(org_id, secret_id);
}

fn refresh_key(org_id: &str, secret_id: &str) -> String {
    format!("{REFRESH_PREFIX}{org_id}/{secret_id}")
}

fn parse_refresh_key(key: &str) -> Option<(&str, &str)> {
    let (org_id, secret_id) = key.strip_prefix(REFRESH_PREFIX)?.split_once('/')?;
    (!org_id.is_empty() && !secret_id.is_empty() && !secret_id.contains('/'))
        .then_some((org_id, secret_id))
}

fn jittered_ttl(seconds: i32, sample: u8) -> Duration {
    let factor = 0.9 + 0.2 * f64::from(sample) / 255.0;
    Duration::from_secs_f64((f64::from(seconds.max(0)) * factor).min(3600.0))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key() -> Key {
        Key {
            value: ValueKey {
                org_id: "org".into(),
                secret_id: "s".into(),
                effective_env_id: "_org".into(),
                env_incarnation: String::new(),
                value_rev: "v".into(),
                policy_rev: "p".into(),
            },
            backend_id: "b".into(),
            backend_rev: "r".into(),
            identity_rev: "i".into(),
        }
    }

    #[test]
    fn completed_and_cancelled_flights_release_their_registration() {
        let cache = ExternalCache::new(1024, 1024);
        let key = key();
        let first = cache.flight(&key, 0);
        let waiter = cache.flight(&key, 0);
        assert!(Arc::ptr_eq(&first.cell, &waiter.cell));
        first
            .cell
            .set(Err(SecretErrorCode::SecretUnavailable))
            .unwrap();
        let retry = cache.flight(&key, 0);
        assert!(!Arc::ptr_eq(&first.cell, &retry.cell));
        drop((first, waiter));
        assert_eq!(cache.flights.lock().len(), 1);
        drop(retry);
        assert!(cache.flights.lock().is_empty());
    }

    #[test]
    fn refresh_evicts_one_secret_and_blocks_older_fills() {
        let cache = ExternalCache::new(10_000, 10_000);
        let now = Instant::now();
        let target = key();
        let mut other = key();
        other.value.secret_id = "t".into();
        let later = now + Duration::from_secs(60);
        for k in [&target, &other] {
            let value = Arc::new(SecretValue::new("value".into()));
            cache.entries.lock().insert(k, value, later, later);
        }
        let before = cache.generation(&target);
        let in_flight = cache.flight(&target, before);
        cache.evict_secret("org", "s", now + Duration::from_millis(1), false);
        assert!(cache.fresh(&target, now).is_none());
        assert!(cache.fresh(&other, now).is_some());
        let value = || Arc::new(SecretValue::new("old".into()));
        assert!(!cache.install(&target, before, value(), later, later));
        assert!(cache.fresh(&target, now).is_none());
        let after = cache.generation(&target);
        assert_ne!(before, after);
        assert!(!Arc::ptr_eq(
            &in_flight.cell,
            &cache.flight(&target, after).cell
        ));
        assert!(cache.install(&target, after, value(), later, later));
        assert!(cache.install(&other, cache.generation(&other), value(), later, later));
        let denied = FetchError::Denied { reason: "auth" };
        assert!(cache.failure(&target, before, &denied, now).is_err());
        assert!(
            cache.fresh(&target, now).is_some(),
            "a pre-refresh failure evicted the newer fill"
        );
        assert!(cache.failure(&target, after, &denied, now).is_err());
        assert!(cache.fresh(&target, now).is_none());
    }

    #[tokio::test]
    async fn a_flight_that_overlaps_a_refresh_returns_a_post_refresh_fill() {
        let cache = ExternalCache::new(10_000, 10_000);
        let key = key();
        let mut generations = Vec::new();
        let outcome = cache
            .fill_current(&key, |generation| {
                generations.push(generation);
                let first = generations.len() == 1;
                if first {
                    cache.evict_secret("org", "s", Instant::now(), false);
                }
                let value = if first { "old" } else { "new" };
                async move { Ok(Arc::new(SecretValue::new(value.into()))) }
            })
            .await;
        assert_eq!(
            outcome.unwrap().as_str(),
            "new",
            "a pre-refresh fill was returned"
        );
        assert_eq!(generations.len(), 2);
        assert_ne!(generations[0], generations[1]);
        let outcome = cache
            .fill_current(&key, |_| async {
                Ok(Arc::new(SecretValue::new("x".into())))
            })
            .await;
        assert_eq!(outcome.unwrap().as_str(), "x");
    }

    #[tokio::test]
    async fn a_refresh_during_the_refill_fails_closed() {
        let cache = ExternalCache::new(10_000, 10_000);
        let key = key();
        let mut fills = 0;
        let outcome = cache
            .fill_current(&key, |_| {
                fills += 1;
                cache.evict_secret("org", "s", Instant::now(), false);
                let value = if fills == 1 { "old" } else { "older" };
                async move { Ok(Arc::new(SecretValue::new(value.into()))) }
            })
            .await;
        assert!(
            outcome.is_err(),
            "a fill that overlapped a second refresh released its value"
        );
        assert_eq!(fills, FILL_ROUNDS);
    }

    #[tokio::test]
    async fn failures_report_their_class_and_stale_serves() {
        type Seen = (
            String,
            &'static str,
            &'static str,
            &'static str,
            &'static str,
        );
        static SEEN: Mutex<Vec<Seen>> = Mutex::new(Vec::new());
        fn record(event: &FetchEvent<'_>) {
            SEEN.lock().push((
                event.secret_id.to_string(),
                event.outcome,
                event.code,
                event.cache,
                event.trigger,
            ));
        }
        set_fetch_observer(record);
        let mut key = key();
        key.value.secret_id = config::ider::ksuid();
        let pointer = Pointer {
            backend_id: "b".into(),
            locator: "loc".into(),
            version_selector: config::meta::secret_store::external::VersionSelector::Latest,
            json_key: None,
        };
        let now = Instant::now();
        let later = now + Duration::from_secs(60);
        CACHE
            .entries
            .lock()
            .insert(&key, Arc::new(SecretValue::new("value".into())), now, later);
        let transient = FetchError::Transient { reason: "timeout" };
        assert!(failed(&key, (0, "send"), &pointer, &transient, now).is_ok());
        let denied = FetchError::Denied { reason: "auth" };
        assert!(failed(&key, (0, "auth_refetch"), &pointer, &denied, now).is_err());
        let seen: Vec<_> = SEEN
            .lock()
            .iter()
            .filter(|e| e.0 == key.value.secret_id)
            .map(|e| (e.1, e.2, e.3, e.4))
            .collect();
        assert_eq!(
            seen,
            vec![
                ("transient", "timeout", "stale_serve", "send"),
                ("denied", "auth", "fill", "auth_refetch")
            ]
        );
    }

    #[test]
    fn only_the_first_fill_after_an_auth_eviction_is_an_auth_refetch() {
        let cache = ExternalCache::new(10_000, 10_000);
        let now = Instant::now();
        let target = key();
        let mut other = key();
        other.value.secret_id = "t".into();
        assert_eq!(
            cache.take_trigger(&target, cache.generation(&target)),
            "send"
        );

        cache.evict_secret("org", "s", now, true);
        let after = cache.generation(&target);
        assert_eq!(cache.take_trigger(&target, after - 1), "send");
        assert_eq!(cache.take_trigger(&other, cache.generation(&other)), "send");
        assert_eq!(cache.take_trigger(&target, after), "auth_refetch");
        assert_eq!(cache.take_trigger(&target, after), "send");

        cache.evict_secret("org", "s", now, true);
        cache.evict_secret("org", "s", now, false);
        assert_eq!(
            cache.take_trigger(&target, cache.generation(&target)),
            "send",
            "a refresh after the auth eviction is not a refetch"
        );
        assert!(cache.entries.lock().auth_refetched.is_empty());
    }

    #[tokio::test]
    async fn a_fill_refused_locally_keeps_the_auth_refetch_trigger() {
        use std::sync::atomic::{AtomicUsize, Ordering};

        use config::meta::secret_store::external::{BackendKind, FetchBudget, VersionSelector};

        struct Counting(AtomicUsize);
        #[async_trait::async_trait]
        impl ExternalSecretBackend for Counting {
            fn kind(&self) -> BackendKind {
                BackendKind::AwsSm
            }
            async fn fetch(
                &self,
                _: &Pointer,
                _: &ResolvedIdentity,
                _: &FetchBudget,
            ) -> Result<SecretValue, FetchError> {
                self.0.fetch_add(1, Ordering::SeqCst);
                Ok(SecretValue::new("v".into()))
            }
        }

        let cache = ExternalCache::new(10_000, 10_000);
        let target = key();
        cache.evict_secret("org", "s", Instant::now(), true);
        let generation = cache.generation(&target);
        let provider = Counting(AtomicUsize::new(0));
        let pointer = Pointer {
            backend_id: "b".into(),
            locator: "l".into(),
            version_selector: VersionSelector::Latest,
            json_key: None,
        };
        let identity = ResolvedIdentity::Static {
            credential_rev: "rev".into(),
        };
        macro_rules! through {
            ($limits:expr) => {
                cache
                    .fetch_through(
                        (&target, generation),
                        $limits,
                        &provider,
                        &pointer,
                        &identity,
                    )
                    .await
            };
        }

        let queued = limits::Limits::new(Instant::now());
        let _full = queued.fill_queue();
        let (result, trigger) = through!(&queued);
        assert!(result.is_err());
        assert_eq!(trigger, "auth_refetch");

        let open = limits::Limits::new(Instant::now());
        open.open_circuit();
        let (result, trigger) = through!(&open);
        assert!(result.is_err());
        assert_eq!(trigger, "auth_refetch");
        assert_eq!(provider.0.load(Ordering::SeqCst), 0);

        let limits = limits::Limits::new(Instant::now());
        let (result, trigger) = through!(&limits);
        assert!(result.is_ok());
        assert_eq!(
            trigger, "auth_refetch",
            "a locally refused fill consumed the trigger"
        );
        assert_eq!(through!(&limits).1, "send");
        assert_eq!(provider.0.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn auth_refetch_evicts_once_per_secret_per_cooldown() {
        let cache = ExternalCache::new(10_000, 10_000);
        let now = Instant::now();
        let key = key();
        let later = now + Duration::from_secs(600);
        assert!(cache.take_auth_refetch("org", "s", now));
        assert!(!cache.take_auth_refetch("org", "s", now + Duration::from_secs(59)));
        assert!(cache.take_auth_refetch("org", "t", now));
        assert!(cache.take_auth_refetch("org", "s", now + AUTH_REFETCH_COOLDOWN));

        let secret = config::ider::ksuid();
        let mut global = key.clone();
        global.value.secret_id.clone_from(&secret);
        CACHE.entries.lock().insert(
            &global,
            Arc::new(SecretValue::new("value".into())),
            later,
            later,
        );
        assert!(refetch_on_auth_failure("org", &secret));
        assert!(CACHE.fresh(&global, now).is_none());
        CACHE.entries.lock().insert(
            &global,
            Arc::new(SecretValue::new("value".into())),
            later,
            later,
        );
        assert!(!refetch_on_auth_failure("org", &secret));
        assert!(CACHE.fresh(&global, now).is_some());
    }

    #[test]
    fn refresh_keys_round_trip_and_refuse_malformed_keys() {
        let key = refresh_key("org", "s1");
        assert_eq!(parse_refresh_key(&key), Some(("org", "s1")));
        assert_eq!(parse_refresh_key("/secret_store/refresh/org"), None);
        assert_eq!(parse_refresh_key("/secret_store/refresh/org/a/b"), None);
        assert_eq!(parse_refresh_key("/other/org/s1"), None);
    }

    #[test]
    fn ttl_clamps_after_jitter() {
        assert_eq!(jittered_ttl(100, 0), Duration::from_secs(90));
        assert_eq!(jittered_ttl(100, 255), Duration::from_secs(110));
        assert_eq!(jittered_ttl(3600, 255), Duration::from_secs(3600));
    }

    #[test]
    fn stale_deadline_never_moves_and_definitive_failure_evicts() {
        let cache = ExternalCache::new(10_000, 10_000);
        let now = Instant::now();
        let key = key();
        let end = now + Duration::from_secs(3);
        let transient = FetchError::Transient { reason: "timeout" };
        for failure in [
            FetchError::Denied { reason: "auth" },
            FetchError::Missing { reason: "missing" },
            FetchError::Invalid { reason: "invalid" },
        ] {
            let value = Arc::new(SecretValue::new("value".into()));
            cache.entries.lock().insert(&key, value.clone(), now, end);
            assert!(cache.fresh(&key, now).is_none());
            assert!(Arc::ptr_eq(
                &cache.failure(&key, 0, &transient, now).unwrap(),
                &value
            ));
            assert!(cache.failure(&key, 0, &failure, now).is_err());
            assert!(cache.failure(&key, 0, &transient, now).is_err());
        }
        cache
            .entries
            .lock()
            .insert(&key, Arc::new(SecretValue::new("value".into())), now, end);
        assert!(
            cache
                .failure(&key, 0, &transient, end - Duration::from_millis(1))
                .is_ok()
        );
        assert!(cache.failure(&key, 0, &transient, end).is_err());
    }

    #[test]
    fn eviction_sweep_and_refresh_visit_only_their_own_entries() {
        let cache = ExternalCache::new(1 << 30, 64 * 1024);
        let now = Instant::now();
        let later = now + Duration::from_secs(600);
        let value = |text: &str| Arc::new(SecretValue::new(text.into()));
        for i in 0..2_000 {
            let mut other = key();
            other.value.org_id = "other".into();
            other.value.secret_id = i.to_string();
            cache
                .entries
                .lock()
                .insert(&other, value("v"), later, later);
        }
        let mut due = key();
        due.value.secret_id = "due".into();
        cache.entries.lock().insert(&due, value("v"), now, now);
        let visited = || std::mem::take(&mut cache.entries.lock().visited);
        visited();

        cache.entries.lock().sweep(now + Duration::from_millis(1));
        assert!(visited() <= 2, "sweep reads only due entries");
        let target = key();
        cache
            .entries
            .lock()
            .insert(&target, value("v"), later, later);
        cache.evict_secret("org", "s", now, false);
        assert!(visited() <= 2);
        assert!(cache.fresh(&target, now).is_none());

        for i in 0..64 {
            let mut fill = key();
            fill.value.secret_id = format!("fill{i}");
            cache
                .entries
                .lock()
                .insert(&fill, value(&"x".repeat(1024)), later, later);
        }
        let org_visits = visited();
        assert!(org_visits <= 2 * 64, "org eviction visited {org_visits}");
        assert!(cache.entries.lock().org_bytes["org"] <= 64 * 1024);

        let mut large = key();
        large.value.secret_id = "large".into();
        let big = value(&"x".repeat(MAX_CACHED_VALUE_BYTES + 1));
        let roomy = ExternalCache::new(1 << 30, 1 << 30);
        roomy.entries.lock().insert(&large, big, later, later);
        assert!(
            roomy.fresh(&large, now).is_none(),
            "values over 64 KiB are not cached"
        );
    }
}
