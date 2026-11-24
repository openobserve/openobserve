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
    mem::size_of,
    sync::{Arc, Weak},
    time::{Duration, Instant},
};

use config::meta::resources::{ResourceKind, SourceReason, SummaryPage};
use db::resources::{PAGE_SIZE, ResourceChange, ResourceEvents};
use futures::future::BoxFuture;
use hashbrown::HashMap;
use parking_lot::Mutex;
use tokio::sync::{Notify, Semaphore};

use super::{SearchError, matching::IndexedRecord};

const COLD_WAIT: Duration = Duration::from_millis(300);
const BUILD_TIMEOUT: Duration = Duration::from_secs(30);
const IDLE: Duration = Duration::from_secs(15 * 60);
// Builds of one entry start at least this far apart, so a burst of events costs one rebuild.
const REBUILD_INTERVAL: Duration = Duration::from_secs(60);
// An entry that never loaded retries sooner, so one source error does not hide a kind for a minute.
const COLD_RETRY: Duration = Duration::from_secs(5);
// Bounds how stale an entry gets when an event is lost.
const MAX_AGE: Duration = Duration::from_secs(5 * 60);

pub(super) type Rows = Arc<Vec<IndexedRecord>>;
pub(super) type Snapshot = Result<Rows, SourceReason>;
pub(super) type PageReader = Arc<
    dyn Fn(
            String,
            ResourceKind,
            Option<String>,
            usize,
        ) -> BoxFuture<'static, anyhow::Result<SummaryPage>>
        + Send
        + Sync,
>;

pub(super) struct Limits {
    pub max_bytes: usize,
    pub max_pending: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_bytes: 512 * 1024 * 1024,
            max_pending: 32,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub(super) struct Key {
    pub org: String,
    pub kind: ResourceKind,
}

impl Key {
    pub fn new(org: &str, kind: ResourceKind) -> Self {
        Self {
            org: org.into(),
            kind,
        }
    }
}

/// Per-process snapshots of each (org, kind), rebuilt whole from the source when stale.
pub(super) struct Catalog {
    state: Mutex<State>,
    read_page: PageReader,
    max_bytes: usize,
    max_pending: usize,
    builds: Semaphore,
    pub scans: Arc<Semaphore>,
    built: Notify,
}

impl Catalog {
    pub fn new(read_page: PageReader, limits: Limits) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                entries: HashMap::new(),
                pending: 0,
            }),
            read_page,
            max_bytes: limits.max_bytes,
            max_pending: limits.max_pending,
            builds: Semaphore::new(2),
            scans: Arc::new(Semaphore::new(4)),
            built: Notify::new(),
        })
    }

    /// Starts the builds `kinds` are due for and waits briefly for the ones with no snapshot yet.
    pub async fn ensure(
        self: &Arc<Self>,
        org: &str,
        kinds: &[ResourceKind],
    ) -> Result<(), SearchError> {
        for key in self.start(org, kinds)? {
            tokio::spawn(self.clone().build(key));
        }
        let cold = || {
            let state = self.state.lock();
            kinds.iter().any(|&kind| {
                state
                    .entries
                    .get(&Key::new(org, kind))
                    .is_some_and(|entry| entry.building && entry.rows.is_none())
            })
        };
        let deadline = tokio::time::Instant::now() + COLD_WAIT;
        loop {
            let built = self.built.notified();
            tokio::pin!(built);
            built.as_mut().enable();
            if !cold() || tokio::time::timeout_at(deadline, built).await.is_err() {
                return Ok(());
            }
        }
    }

    pub fn read(&self, org: &str, kinds: &[ResourceKind]) -> Vec<(ResourceKind, Snapshot)> {
        let state = self.state.lock();
        kinds
            .iter()
            .map(|&kind| {
                let snapshot = match state.entries.get(&Key::new(org, kind)) {
                    Some(Entry {
                        rows: Some(rows), ..
                    }) => Ok(rows.clone()),
                    Some(Entry {
                        failure: Some(reason),
                        building: false,
                        ..
                    }) => Err(*reason),
                    _ => Err(SourceReason::Loading),
                };
                (kind, snapshot)
            })
            .collect()
    }

    pub fn change(&self, change: &ResourceChange) {
        for (key, entry) in &mut self.state.lock().entries {
            if change.covers(&key.org, key.kind) {
                entry.stale = true;
            }
        }
    }

    fn start(&self, org: &str, kinds: &[ResourceKind]) -> Result<Vec<Key>, SearchError> {
        let now = Instant::now();
        let mut state = self.state.lock();
        state
            .entries
            .retain(|_, entry| entry.building || now.duration_since(entry.last_used) < IDLE);
        for (key, entry) in &mut state.entries {
            if key.org == org {
                entry.last_used = now;
            }
        }
        let mut due = Vec::new();
        let mut cold = false;
        for &kind in kinds {
            let entry = state
                .entries
                .entry(Key::new(org, kind))
                .or_insert_with(|| Entry::new(now));
            if entry.due(now) {
                cold |= entry.rows.is_none();
                due.push(Key::new(org, kind));
            }
        }
        if state.pending + due.len() > self.max_pending {
            // A stale snapshot can still answer; only a missing one makes the search fail.
            return if cold {
                Err(SearchError::Overloaded)
            } else {
                Ok(Vec::new())
            };
        }
        for key in &due {
            if let Some(entry) = state.entries.get_mut(key) {
                entry.building = true;
                entry.stale = false;
                entry.started = Some(now);
            }
        }
        state.pending += due.len();
        Ok(due)
    }

    async fn build(self: Arc<Self>, key: Key) {
        let result = tokio::time::timeout(BUILD_TIMEOUT, self.load(&key))
            .await
            .unwrap_or(Err(SourceReason::SourceUnavailable));
        self.state.lock().finish(&key, result, self.max_bytes);
        self.built.notify_waiters();
    }

    async fn load(&self, key: &Key) -> Result<Vec<IndexedRecord>, SourceReason> {
        let _permit = self
            .builds
            .acquire()
            .await
            .map_err(|_| SourceReason::SourceUnavailable)?;
        let mut rows = Vec::new();
        let mut bytes = 0;
        let mut after = None;
        loop {
            let page = (self.read_page)(key.org.clone(), key.kind, after.clone(), PAGE_SIZE)
                .await
                .map_err(|_| SourceReason::SourceUnavailable)?;
            for summary in page.items {
                let row = IndexedRecord::new(summary);
                bytes += size_of::<IndexedRecord>() + row.allocated_bytes();
                rows.push(row);
            }
            if bytes > self.max_bytes {
                return Err(SourceReason::ResourceExhausted);
            }
            match page.next {
                None => break,
                Some(next) if after.as_ref() == Some(&next) => {
                    return Err(SourceReason::SourceUnavailable);
                }
                next => after = next,
            }
        }
        // Pages come in id order, so a source that repeats an id repeats it adjacently.
        rows.dedup_by(|a, b| a.summary.id == b.summary.id);
        rows.shrink_to_fit();
        Ok(rows)
    }

    #[cfg(test)]
    async fn wait_idle(&self) {
        loop {
            let built = self.built.notified();
            tokio::pin!(built);
            built.as_mut().enable();
            if self.state.lock().pending == 0 {
                return;
            }
            tokio::time::timeout(Duration::from_secs(3), built)
                .await
                .unwrap();
        }
    }
}

struct State {
    entries: HashMap<Key, Entry>,
    pending: usize,
}

impl State {
    fn finish(
        &mut self,
        key: &Key,
        result: Result<Vec<IndexedRecord>, SourceReason>,
        max_bytes: usize,
    ) {
        self.pending = self.pending.saturating_sub(1);
        let result = result.and_then(|rows| {
            let bytes = rows_bytes(&rows);
            if self.charge(key, bytes, max_bytes) {
                Ok((rows, bytes))
            } else {
                Err(SourceReason::ResourceExhausted)
            }
        });
        let Some(entry) = self.entries.get_mut(key) else {
            return;
        };
        entry.building = false;
        match result {
            Ok((rows, bytes)) => {
                entry.rows = Some(Arc::new(rows));
                entry.bytes = bytes;
                entry.failure = None;
            }
            Err(reason) if entry.rows.is_some() => {
                log::warn!(
                    "[RESOURCE SEARCH] keeping the previous {} snapshot of {}: {reason:?}",
                    key.kind,
                    key.org
                );
                entry.stale = true;
            }
            Err(reason) => entry.failure = Some(reason),
        }
    }

    /// Makes room for `bytes` in place of the entry's current charge, evicting least recently
    /// used other orgs while over budget.
    fn charge(&mut self, key: &Key, bytes: usize, max_bytes: usize) -> bool {
        loop {
            let current = self.entries.get(key).map_or(0, |entry| entry.bytes);
            let used: usize = self.entries.values().map(|entry| entry.bytes).sum();
            if used - current + bytes <= max_bytes {
                return true;
            }
            if !self.evict_oldest_other(&key.org) {
                return false;
            }
        }
    }

    fn evict_oldest_other(&mut self, current_org: &str) -> bool {
        let Some(oldest) = self
            .entries
            .iter()
            .filter(|(key, entry)| key.org != current_org && entry.bytes > 0)
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(key, _)| key.org.clone())
        else {
            return false;
        };
        self.entries
            .retain(|key, entry| key.org != oldest || entry.building);
        for (key, entry) in &mut self.entries {
            if key.org == oldest {
                entry.rows = None;
                entry.bytes = 0;
            }
        }
        true
    }
}

struct Entry {
    rows: Option<Rows>,
    failure: Option<SourceReason>,
    stale: bool,
    building: bool,
    started: Option<Instant>,
    last_used: Instant,
    bytes: usize,
}

impl Entry {
    fn new(now: Instant) -> Self {
        Self {
            rows: None,
            failure: None,
            stale: false,
            building: false,
            started: None,
            last_used: now,
            bytes: 0,
        }
    }

    fn due(&self, now: Instant) -> bool {
        let since = self.started.map(|started| now.duration_since(started));
        let interval = if self.rows.is_some() {
            REBUILD_INTERVAL
        } else {
            COLD_RETRY
        };
        !self.building
            && since.is_none_or(|since| since >= interval)
            && (self.rows.is_none() || self.stale || since.is_some_and(|since| since >= MAX_AGE))
    }
}

pub(super) fn production_reader() -> PageReader {
    Arc::new(|org, kind, after, limit| {
        Box::pin(async move { db::resources::load_page(&org, kind, after.as_deref(), limit).await })
    })
}

pub(super) async fn watch(owner: Weak<Catalog>, mut events: ResourceEvents) {
    while let Ok(change) = events.next().await {
        let Some(owner) = owner.upgrade() else { return };
        owner.change(&change);
    }
    log::error!("[RESOURCE SEARCH] resource subscription closed");
}

fn rows_bytes(rows: &Vec<IndexedRecord>) -> usize {
    rows.capacity() * size_of::<IndexedRecord>()
        + rows
            .iter()
            .map(IndexedRecord::allocated_bytes)
            .sum::<usize>()
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use config::meta::resources::{
        ResourceRoute, ResourceSummary, SearchQuery, SearchResponse, SourceStatus,
    };
    use tokio_util::sync::CancellationToken;

    use super::*;
    use crate::resources::{ResourceAccess, matching::PreparedQuery, scan};

    struct Fixture {
        catalog: Arc<Catalog>,
        rows: Arc<Mutex<Vec<ResourceSummary>>>,
        reads: Arc<AtomicUsize>,
        fail: Arc<AtomicBool>,
    }

    impl Fixture {
        fn reads(&self) -> usize {
            self.reads.load(Ordering::Relaxed)
        }

        /// Moves the last build start back by `by`, as if that much time had passed.
        fn age(&self, org: &str, by: Duration) {
            let mut state = self.catalog.state.lock();
            let entry = state
                .entries
                .get_mut(&Key::new(org, ResourceKind::Function))
                .unwrap();
            entry.started = entry.started.map(|started| started - by);
        }

        fn names(&self, org: &str) -> Vec<String> {
            let Some(Ok(rows)) = self
                .catalog
                .read(org, &[ResourceKind::Function])
                .pop()
                .map(|(_, snapshot)| snapshot)
            else {
                return Vec::new();
            };
            rows.iter().map(|row| row.summary.name.clone()).collect()
        }
    }

    fn fixture(rows: Vec<ResourceSummary>) -> Fixture {
        fixture_with(rows, Limits::default())
    }

    fn fixture_with(rows: Vec<ResourceSummary>, limits: Limits) -> Fixture {
        let rows = Arc::new(Mutex::new(rows));
        let reads = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicBool::new(false));
        let (source, count, failing) = (rows.clone(), reads.clone(), fail.clone());
        let reader: PageReader = Arc::new(move |_, kind, after, limit| {
            let (rows, reads, fail) = (source.clone(), count.clone(), failing.clone());
            Box::pin(async move {
                reads.fetch_add(1, Ordering::Relaxed);
                anyhow::ensure!(!fail.load(Ordering::Relaxed), "resource reader disabled");
                let mut items = rows
                    .lock()
                    .iter()
                    .filter(|r| r.kind == kind && after.as_ref().is_none_or(|a| r.id > *a))
                    .cloned()
                    .collect::<Vec<_>>();
                items.sort_by(|a, b| a.id.cmp(&b.id));
                let next = (items.len() > limit).then(|| items[limit - 1].id.clone());
                items.truncate(limit);
                Ok(SummaryPage { items, next })
            })
        });
        Fixture {
            catalog: Catalog::new(reader, limits),
            rows,
            reads,
            fail,
        }
    }

    fn row(id: &str, name: &str) -> ResourceSummary {
        ResourceSummary {
            kind: ResourceKind::Function,
            id: id.into(),
            name: name.into(),
            folder_id: None,
            folder_name: None,
            route_ref: ResourceRoute::Function {
                function_name: id.into(),
            },
            enabled: None,
            email: None,
            is_siem: false,
        }
    }

    fn changed(org: Option<&str>, kind: ResourceKind) -> ResourceChange {
        ResourceChange {
            org: org.map(String::from),
            kinds: vec![kind],
        }
    }

    fn work(catalog: &Catalog, q: &str, limit: usize, offset: usize) -> scan::SearchWork {
        let kind = ResourceKind::Function;
        scan::SearchWork {
            snapshots: catalog.read("org", &[kind]),
            query: SearchQuery {
                q: q.into(),
                types: vec![kind],
                limit,
                offset,
            },
            prepared: PreparedQuery::new(q).unwrap(),
            access: vec![ResourceAccess {
                kind,
                predicate: Arc::new(|_| true),
                partial: false,
                unavailable_reason: None,
            }],
            deadline: Instant::now() + scan::SCAN_BUDGET,
            cancelled: CancellationToken::new(),
        }
    }

    fn search(catalog: &Catalog, q: &str) -> SearchResponse {
        work(catalog, q, 20, 0).execute()
    }

    async fn ensure(catalog: &Arc<Catalog>, org: &str) {
        catalog
            .ensure(org, &[ResourceKind::Function])
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn stale_entries_serve_the_old_snapshot_while_one_rebuild_runs() {
        let x = fixture(vec![row("f1", "Old")]);
        ensure(&x.catalog, "org").await;
        ensure(&x.catalog, "org").await;
        assert_eq!(x.reads(), 1);

        x.rows.lock()[0].name = "New".into();
        for _ in 0..3 {
            x.catalog
                .change(&changed(Some("org"), ResourceKind::Function));
        }
        ensure(&x.catalog, "org").await;
        assert_eq!(x.reads(), 1, "rebuilds wait out the interval");

        x.age("org", REBUILD_INTERVAL);
        ensure(&x.catalog, "org").await;
        assert_eq!(x.names("org"), ["Old"]);
        x.catalog.wait_idle().await;
        assert_eq!(x.names("org"), ["New"]);
        assert_eq!(x.reads(), 2);
    }

    #[tokio::test]
    async fn entries_rebuild_after_max_age_without_events() {
        let x = fixture(vec![row("f1", "Old")]);
        ensure(&x.catalog, "org").await;
        x.rows.lock()[0].name = "New".into();
        x.age("org", MAX_AGE - REBUILD_INTERVAL);
        ensure(&x.catalog, "org").await;
        assert_eq!(x.reads(), 1);
        x.age("org", REBUILD_INTERVAL);
        ensure(&x.catalog, "org").await;
        x.catalog.wait_idle().await;
        assert_eq!(x.names("org"), ["New"]);
    }

    #[tokio::test]
    async fn changes_mark_only_the_entries_they_cover() {
        let x = fixture(vec![row("f1", "Old")]);
        for org in ["a", "b"] {
            ensure(&x.catalog, org).await;
            x.age(org, REBUILD_INTERVAL);
        }
        let stale = |org: &str| {
            x.catalog.state.lock().entries[&Key::new(org, ResourceKind::Function)].stale
        };
        x.catalog
            .change(&changed(Some("a"), ResourceKind::Dashboard));
        x.catalog
            .change(&changed(Some("b"), ResourceKind::Function));
        assert!(!stale("a") && stale("b"));
        x.catalog.change(&changed(None, ResourceKind::Function));
        assert!(stale("a"));
    }

    #[tokio::test]
    async fn failed_rebuild_keeps_the_snapshot_and_cold_failure_reports_it() {
        let x = fixture(vec![row("f1", "Old")]);
        ensure(&x.catalog, "org").await;
        x.fail.store(true, Ordering::Relaxed);
        x.catalog
            .change(&changed(Some("org"), ResourceKind::Function));
        x.age("org", REBUILD_INTERVAL);
        ensure(&x.catalog, "org").await;
        x.catalog.wait_idle().await;
        assert_eq!(x.names("org"), ["Old"]);
        assert!(x.catalog.state.lock().entries[&Key::new("org", ResourceKind::Function)].stale);

        ensure(&x.catalog, "cold").await;
        let result = x.catalog.read("cold", &[ResourceKind::Function]);
        assert!(matches!(result[0].1, Err(SourceReason::SourceUnavailable)));

        x.fail.store(false, Ordering::Relaxed);
        ensure(&x.catalog, "cold").await;
        assert!(x.names("cold").is_empty());
        x.age("cold", COLD_RETRY);
        ensure(&x.catalog, "cold").await;
        x.catalog.wait_idle().await;
        assert_eq!(x.names("cold"), ["Old"]);
    }

    #[tokio::test]
    async fn concurrent_cold_searches_share_one_build() {
        let x = fixture(vec![row("f1", "Old")]);
        let (a, b) = (x.catalog.clone(), x.catalog.clone());
        let (first, second) = tokio::join!(
            a.ensure("org", &[ResourceKind::Function]),
            b.ensure("org", &[ResourceKind::Function])
        );
        first.unwrap();
        second.unwrap();
        assert_eq!(x.reads(), 1);
        assert_eq!(x.names("org"), ["Old"]);
    }

    #[tokio::test]
    async fn scan_filters_before_top_k_and_pages_by_offset() {
        let x = fixture(vec![
            row("hidden", "Pay"),
            row("b", "Pay b"),
            row("c", "Pay c"),
        ]);
        ensure(&x.catalog, "org").await;
        let page = |offset| {
            let mut work = work(&x.catalog, "pay", 1, offset);
            work.access[0].predicate = Arc::new(|row| row.id != "hidden");
            work.execute()
        };
        let first = page(0);
        assert_eq!(first.hits[0].summary.id, "b");
        assert_eq!(first.sources[0].has_more, Some(true));
        let second = page(1);
        assert_eq!(second.hits[0].summary.id, "c");
        assert_eq!(second.sources[0].has_more, Some(false));
        assert!(page(2).hits.is_empty());
    }

    #[tokio::test]
    async fn capped_or_cancelled_scans_never_claim_complete() {
        let x = fixture(vec![row("f1", "Old"), row("f2", "Older")]);
        ensure(&x.catalog, "org").await;
        let mut capped = work(&x.catalog, "Old", 1, 0);
        capped.access[0].partial = true;
        let source = &capped.execute().sources[0];
        assert_eq!(source.status, SourceStatus::Partial);
        assert_eq!(source.has_more, Some(true));
        let cancelled = work(&x.catalog, "none", 20, 0);
        cancelled.cancelled.cancel();
        let source = &cancelled.execute().sources[0];
        assert_eq!(source.status, SourceStatus::Partial);
        assert_eq!(source.has_more, Some(false));
    }

    #[tokio::test]
    async fn budget_evicts_other_orgs_then_reports_exhaustion() {
        let probe = fixture(vec![row("f1", "Old")]);
        ensure(&probe.catalog, "one").await;
        let entry = probe
            .catalog
            .state
            .lock()
            .entries
            .values()
            .map(|e| e.bytes)
            .sum::<usize>();

        let limits = |max_bytes, max_pending| Limits {
            max_bytes,
            max_pending,
        };
        let x = fixture_with(vec![row("f1", "Old")], limits(entry * 3 / 2, 32));
        ensure(&x.catalog, "one").await;
        ensure(&x.catalog, "two").await;
        assert!(x.names("one").is_empty());
        assert_eq!(x.names("two"), ["Old"]);

        let tiny = fixture_with(vec![row("f1", "Old")], limits(1, 32));
        ensure(&tiny.catalog, "org").await;
        let result = search(&tiny.catalog, "Old");
        assert_eq!(
            result.sources[0].reason,
            Some(SourceReason::ResourceExhausted)
        );

        let full = fixture_with(Vec::new(), limits(entry, 0));
        assert!(matches!(
            full.catalog.ensure("org", &[ResourceKind::Function]).await,
            Err(SearchError::Overloaded)
        ));
    }
}
