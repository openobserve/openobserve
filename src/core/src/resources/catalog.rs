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
    sync::{
        Arc, Weak,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};

use config::meta::resources::{ResourceKind, ResourceSummary, SourceReason, SummaryPage};
use db::resources::{FolderPage, ResourceChange, ResourceEvents};
use futures::future::BoxFuture;
use hashbrown::{HashMap, HashSet};
use parking_lot::RwLock;
use svix_ksuid::KsuidLike;
use tokio::sync::{Notify, OwnedRwLockReadGuard, RwLock as AsyncRwLock, Semaphore};
use tokio_util::sync::CancellationToken;

use super::{
    SearchError,
    records::{MissingFolder, Records},
};

const MAX_DIRTY_KEYS: usize = 10_000;
const COLD_WAIT: Duration = Duration::from_millis(300);
const BUILD_TIMEOUT: Duration = Duration::from_secs(30);
const IDLE: Duration = Duration::from_secs(15 * 60);

type PageReader = Arc<
    dyn Fn(
            String,
            ResourceKind,
            Option<String>,
            usize,
        ) -> BoxFuture<'static, anyhow::Result<SummaryPage>>
        + Send
        + Sync,
>;
type RecordReader = Arc<
    dyn Fn(
            String,
            ResourceKind,
            Arc<[String]>,
        ) -> BoxFuture<'static, anyhow::Result<Vec<ResourceSummary>>>
        + Send
        + Sync,
>;
type FolderReader = Arc<
    dyn Fn(String, Option<String>, usize) -> BoxFuture<'static, anyhow::Result<FolderPage>>
        + Send
        + Sync,
>;

#[derive(Clone)]
pub(super) struct Readers {
    pub page: PageReader,
    pub refresh: RecordReader,
    pub folders: FolderReader,
}

impl Readers {
    pub fn production() -> Self {
        Self {
            page: Arc::new(|org, kind, after, limit| {
                Box::pin(async move {
                    db::resources::load_page(&org, kind, after.as_deref(), limit).await
                })
            }),
            refresh: Arc::new(|org, kind, ids| {
                Box::pin(async move { db::resources::refresh(&org, kind, &ids).await })
            }),
            folders: Arc::new(|org, after, limit| {
                Box::pin(
                    async move { db::resources::folder_page(&org, after.as_deref(), limit).await },
                )
            }),
        }
    }
}

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

pub(super) struct Catalog {
    pub state: RwLock<State>,
    readers: Readers,
    max_pending: usize,
    builds: Arc<Semaphore>,
    waiters: Arc<Semaphore>,
    pub scans: Arc<Semaphore>,
    changed: Arc<Notify>,
    work: Arc<Notify>,
    stopped: CancellationToken,
    serial: AtomicU64,
    instance: String,
}

impl Catalog {
    pub fn new(readers: Readers, limits: Limits) -> Arc<Self> {
        let catalog = Arc::new(Self {
            state: RwLock::new(State {
                entries: HashMap::new(),
                pending: 0,
                max_bytes: limits.max_bytes,
            }),
            readers,
            max_pending: limits.max_pending,
            builds: Arc::new(Semaphore::new(2)),
            waiters: Arc::new(Semaphore::new(32)),
            scans: Arc::new(Semaphore::new(4)),
            changed: Arc::new(Notify::new()),
            work: Arc::new(Notify::new()),
            stopped: CancellationToken::new(),
            serial: AtomicU64::new(0),
            instance: svix_ksuid::Ksuid::new(None, None).to_string(),
        });
        tokio::spawn(refresh_loop(
            Arc::downgrade(&catalog),
            catalog.work.clone(),
            catalog.stopped.clone(),
        ));
        catalog
    }

    pub fn generation(&self, version: u64) -> String {
        format!("{}:{version}", self.instance)
    }

    pub async fn ensure(
        self: &Arc<Self>,
        org: &str,
        kinds: &[ResourceKind],
    ) -> Result<(), SearchError> {
        let mut starts = Vec::new();
        {
            let mut state = self.state.write();
            state.evict_idle(IDLE);
            for (key, entry) in &mut state.entries {
                if key.org == org {
                    entry.last_used = Instant::now();
                }
            }
            let needed = kinds
                .iter()
                .filter(|&&kind| {
                    state
                        .entries
                        .get(&Key::new(org, kind))
                        .is_none_or(|entry| matches!(entry.status, EntryStatus::Invalid(_)))
                })
                .count();
            if state.pending + needed > self.max_pending {
                return Err(SearchError::Overloaded);
            }
            for &kind in kinds {
                let key = Key::new(org, kind);
                if state
                    .entries
                    .get(&key)
                    .is_some_and(|entry| !matches!(entry.status, EntryStatus::Invalid(_)))
                {
                    continue;
                }
                let token = self.version();
                state.entries.insert(key.clone(), Entry::loading(token));
                state.pending += 1;
                starts.push((key, token));
            }
        }
        for (key, token) in starts {
            let owner = self.clone();
            tokio::spawn(async move {
                owner.build(key, token).await;
            });
        }
        let loading = || {
            self.state.read().entries.iter().any(|(key, entry)| {
                key.org == org
                    && kinds.contains(&key.kind)
                    && matches!(entry.status, EntryStatus::Loading)
            })
        };
        if !loading() {
            return Ok(());
        }
        let _waiter = self
            .waiters
            .clone()
            .try_acquire_owned()
            .map_err(|_| SearchError::Overloaded)?;
        let deadline = tokio::time::Instant::now() + COLD_WAIT;
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if !loading() {
                return Ok(());
            }
            if tokio::time::timeout_at(deadline, changed).await.is_err() {
                return Ok(());
            }
        }
    }

    /// Read-locks the ready records of each kind, in kind order so overlapping scans and
    /// refreshes cannot wait on each other in a cycle.
    pub async fn read(
        &self,
        org: &str,
        kinds: &[ResourceKind],
        deadline: Instant,
    ) -> Vec<(ResourceKind, Snapshot)> {
        let mut kinds = kinds.to_vec();
        kinds.sort_unstable();
        let handles = {
            let state = self.state.read();
            kinds
                .into_iter()
                .map(|kind| {
                    let handle = match state.entries.get(&Key::new(org, kind)).map(|e| &e.status) {
                        None | Some(EntryStatus::Loading) => Err(SourceReason::Loading),
                        Some(EntryStatus::Invalid(reason)) => Err(*reason),
                        Some(EntryStatus::Ready(handle)) => Ok(handle.clone()),
                    };
                    (kind, handle)
                })
                .collect::<Vec<_>>()
        };
        let mut snapshots = Vec::with_capacity(handles.len());
        for (kind, handle) in handles {
            let snapshot = match handle {
                Err(reason) => Snapshot::Unavailable(reason),
                Ok(handle) => {
                    let read = handle.read_owned();
                    match tokio::time::timeout_at(deadline.into(), read).await {
                        Ok(data) => Snapshot::Ready(data),
                        Err(_) => Snapshot::Busy,
                    }
                }
            };
            snapshots.push((kind, snapshot));
        }
        snapshots
    }

    pub fn change(self: &Arc<Self>, change: ResourceChange) {
        let mut state = self.state.write();
        if let ResourceChange::Resource { org, kind, id } = &change {
            if let Some(entry) = state.entries.get_mut(&Key::new(org, *kind)) {
                entry.mark_dirty(id);
            }
        } else {
            for (key, entry) in &mut state.entries {
                match &change {
                    ResourceChange::GlobalResource { kind, id } if key.kind == *kind => {
                        entry.mark_dirty(id)
                    }
                    ResourceChange::Folder { org, kind }
                        if key.org == *org && key.kind == *kind =>
                    {
                        entry.folder_dirty = true
                    }
                    ResourceChange::Scope { kinds } if kinds.contains(&key.kind) => {
                        entry.invalidate(SourceReason::SourceUnavailable)
                    }
                    ResourceChange::InvalidateAll => {
                        entry.invalidate(SourceReason::SourceUnavailable)
                    }
                    _ => {}
                }
            }
        }
        drop(state);
        self.work.notify_one();
        self.changed.notify_waiters();
    }

    fn version(&self) -> u64 {
        self.serial.fetch_add(1, Ordering::Relaxed) + 1
    }

    async fn build(self: Arc<Self>, key: Key, token: u64) {
        let result = tokio::time::timeout(BUILD_TIMEOUT, self.build_inner(&key, token)).await;
        let mut state = self.state.write();
        state.pending = state.pending.saturating_sub(1);
        let Some(entry) = state
            .entries
            .get_mut(&key)
            .filter(|entry| entry.token == token)
        else {
            return;
        };
        if let Err(reason) = result.unwrap_or(Err(SourceReason::SourceUnavailable)) {
            entry.invalidate(reason);
        }
        drop(state);
        self.changed.notify_waiters();
    }

    async fn build_inner(&self, key: &Key, token: u64) -> Result<(), SourceReason> {
        let _permit = self
            .builds
            .acquire()
            .await
            .map_err(|_| SourceReason::SourceUnavailable)?;
        let mut records = Records::default();
        let limit = db::resources::PAGE_SIZE;
        let mut after = None;
        loop {
            let page = (self.readers.page)(key.org.clone(), key.kind, after.clone(), limit)
                .await
                .map_err(|_| SourceReason::SourceUnavailable)?;
            for row in page.items {
                if row.kind != key.kind {
                    return Err(SourceReason::SourceUnavailable);
                }
                records.upsert(row);
            }
            if !self.state.write().charge_loading(key, token, &records)? {
                return Ok(());
            }
            if page.next.is_none() {
                break;
            }
            if page.next == after {
                return Err(SourceReason::SourceUnavailable);
            }
            after = page.next;
        }
        loop {
            let dirty = {
                let mut state = self.state.write();
                if !state.charge_loading(key, token, &records)? {
                    return Ok(());
                }
                let Some(entry) = state.entries.get_mut(key) else {
                    return Ok(());
                };
                if entry.dirty.is_empty() && !entry.folder_dirty {
                    entry.status = EntryStatus::Ready(Arc::new(AsyncRwLock::new(Ready {
                        records,
                        version: self.version(),
                    })));
                    return Ok(());
                }
                entry.take_dirty()
            };
            self.fetch(key, dirty).await?.apply(key, &mut records)?;
        }
    }

    async fn fetch(&self, key: &Key, dirty: Dirty) -> Result<Fetched, SourceReason> {
        let folders = if dirty.folders {
            Some(self.folder_names(&key.org, key.kind).await?)
        } else {
            None
        };
        if dirty.ids.is_empty() {
            return Ok(Fetched {
                folders,
                rows: Vec::new(),
            });
        }
        let ids: Arc<[String]> = dirty.ids.into();
        let mut found = (self.readers.refresh)(key.org.clone(), key.kind, ids.clone())
            .await
            .map_err(|_| SourceReason::SourceUnavailable)?
            .into_iter()
            .map(|row| (row.id.clone(), row))
            .collect::<HashMap<_, _>>();
        let rows = ids
            .iter()
            .map(|id| match found.remove_entry(id) {
                Some((id, row)) => (id, Some(row)),
                None => (id.clone(), None),
            })
            .collect();
        // A row outside the requested ids means the source changed its identity mapping.
        if !found.is_empty() {
            return Err(SourceReason::SourceUnavailable);
        }
        Ok(Fetched { folders, rows })
    }

    async fn folder_names(
        &self,
        org: &str,
        kind: ResourceKind,
    ) -> Result<HashMap<String, String>, SourceReason> {
        let mut values = HashMap::new();
        let mut after = None;
        loop {
            let page = (self.readers.folders)(org.into(), after.clone(), db::resources::PAGE_SIZE)
                .await
                .map_err(|_| SourceReason::SourceUnavailable)?;
            values.extend(
                page.items
                    .into_iter()
                    .filter(|(source, ..)| *source == kind)
                    .map(|(_, id, name)| (id, name)),
            );
            if page.next.is_none() {
                break;
            }
            if page.next == after {
                return Err(SourceReason::SourceUnavailable);
            }
            after = page.next;
        }
        Ok(values)
    }

    fn refresh_job(&self) -> Option<(Key, u64, Dirty)> {
        let mut state = self.state.write();
        state.entries.iter_mut().find_map(|(key, entry)| {
            let pending = !entry.dirty.is_empty() || entry.folder_dirty;
            (matches!(entry.status, EntryStatus::Ready(_)) && pending).then(|| {
                entry.refreshing = true;
                (key.clone(), entry.token, entry.take_dirty())
            })
        })
    }

    async fn refresh_job_inner(
        &self,
        key: &Key,
        token: u64,
        dirty: Dirty,
    ) -> Result<(), SourceReason> {
        let Some(data) = self.state.read().ready_data(key, token) else {
            return Ok(());
        };
        let fetched = self.fetch(key, dirty).await?;
        let mut ready = data.write().await;
        if fetched.apply(key, &mut ready.records)? {
            ready.version = self.version();
        }
        let bytes = ready.records.allocated_bytes();
        if self.state.write().charge_ready(key, token, bytes) {
            Ok(())
        } else {
            Err(SourceReason::ResourceExhausted)
        }
    }

    #[cfg(test)]
    async fn wait_idle(&self) {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.state.read().entries.values().all(|e| {
                e.dirty.is_empty()
                    && !e.folder_dirty
                    && !e.refreshing
                    && !matches!(e.status, EntryStatus::Loading)
            }) {
                return;
            }
            tokio::time::timeout(Duration::from_secs(3), notified)
                .await
                .unwrap();
        }
    }
}

impl Drop for Catalog {
    fn drop(&mut self) {
        self.stopped.cancel();
    }
}

pub(super) struct State {
    pub entries: HashMap<Key, Entry>,
    pending: usize,
    max_bytes: usize,
}

impl State {
    fn evict_idle(&mut self, idle: Duration) {
        let now = Instant::now();
        self.entries.retain(|_, entry| {
            matches!(entry.status, EntryStatus::Loading)
                || now.duration_since(entry.last_used) < idle
        });
        self.entries.shrink_to_fit();
    }

    fn evict_oldest_other(&mut self, current_org: &str) -> bool {
        let Some(oldest) = self
            .entries
            .iter()
            .filter(|(key, entry)| {
                key.org != current_org && !matches!(entry.status, EntryStatus::Loading)
            })
            .min_by_key(|(_, entry)| entry.last_used)
            .map(|(key, _)| key.org.clone())
        else {
            return false;
        };
        self.entries
            .retain(|key, entry| key.org != oldest || matches!(entry.status, EntryStatus::Loading));
        true
    }

    fn used(&self) -> usize {
        self.entries.values().map(|entry| entry.bytes).sum()
    }

    /// Charges `bytes` to the entry, evicting least recently used other orgs while over budget.
    fn charge(&mut self, key: &Key, bytes: usize) -> bool {
        loop {
            let Some(current) = self.entries.get(key).map(|entry| entry.bytes) else {
                return true;
            };
            if self.used() - current + bytes <= self.max_bytes {
                if let Some(entry) = self.entries.get_mut(key) {
                    entry.bytes = bytes;
                }
                return true;
            }
            if !self.evict_oldest_other(&key.org) {
                return false;
            }
        }
    }

    fn charge_loading(
        &mut self,
        key: &Key,
        token: u64,
        records: &Records,
    ) -> Result<bool, SourceReason> {
        let building = self
            .entries
            .get(key)
            .is_some_and(|e| e.token == token && matches!(e.status, EntryStatus::Loading));
        if !building {
            return Ok(false);
        }
        if self.charge(key, records.allocated_bytes()) {
            Ok(true)
        } else {
            Err(SourceReason::ResourceExhausted)
        }
    }

    fn charge_ready(&mut self, key: &Key, token: u64, bytes: usize) -> bool {
        let current = self
            .entries
            .get(key)
            .is_some_and(|e| e.token == token && matches!(e.status, EntryStatus::Ready(_)));
        !current || self.charge(key, bytes)
    }

    fn ready_data(&self, key: &Key, token: u64) -> Option<Arc<AsyncRwLock<Ready>>> {
        match &self.entries.get(key).filter(|e| e.token == token)?.status {
            EntryStatus::Ready(data) => Some(data.clone()),
            _ => None,
        }
    }
}

pub(super) struct Entry {
    pub status: EntryStatus,
    token: u64,
    last_used: Instant,
    dirty: HashSet<String>,
    folder_dirty: bool,
    refreshing: bool,
    bytes: usize,
}

impl Entry {
    fn loading(token: u64) -> Self {
        Self {
            status: EntryStatus::Loading,
            token,
            last_used: Instant::now(),
            dirty: HashSet::new(),
            folder_dirty: false,
            refreshing: false,
            bytes: 0,
        }
    }

    fn mark_dirty(&mut self, id: &str) {
        if matches!(self.status, EntryStatus::Invalid(_)) || self.dirty.contains(id) {
            return;
        }
        if self.dirty.len() >= MAX_DIRTY_KEYS {
            self.invalidate(SourceReason::SourceUnavailable);
            return;
        }
        self.dirty.insert(id.into());
    }

    fn take_dirty(&mut self) -> Dirty {
        Dirty {
            ids: self.dirty.drain().collect(),
            folders: std::mem::take(&mut self.folder_dirty),
        }
    }

    fn invalidate(&mut self, reason: SourceReason) {
        self.status = EntryStatus::Invalid(reason);
        self.dirty.clear();
        self.dirty.shrink_to_fit();
        self.folder_dirty = false;
        self.refreshing = false;
        self.bytes = 0;
        self.token = self.token.wrapping_add(1);
    }
}

pub(super) enum EntryStatus {
    Loading,
    Ready(Arc<AsyncRwLock<Ready>>),
    Invalid(SourceReason),
}

pub(super) struct Ready {
    pub records: Records,
    pub version: u64,
}

pub(super) enum Snapshot {
    Ready(OwnedRwLockReadGuard<Ready>),
    Unavailable(SourceReason),
    Busy,
}

struct Dirty {
    ids: Vec<String>,
    folders: bool,
}

struct Fetched {
    folders: Option<HashMap<String, String>>,
    rows: Vec<(String, Option<ResourceSummary>)>,
}

impl Fetched {
    /// Applies re-read folders and rows; returns whether anything a search can see changed.
    fn apply(self, key: &Key, records: &mut Records) -> Result<bool, SourceReason> {
        let mut changed = !self.rows.is_empty();
        if let Some(names) = self.folders {
            changed |= records
                .update_folders(&names)
                .map_err(|MissingFolder| SourceReason::SourceUnavailable)?;
        }
        for (id, row) in self.rows {
            match row {
                Some(row) if row.kind == key.kind => records.upsert(row),
                None => records.remove(&id),
                Some(_) => return Err(SourceReason::SourceUnavailable),
            }
        }
        Ok(changed)
    }
}

async fn refresh_loop(owner: Weak<Catalog>, work: Arc<Notify>, stopped: CancellationToken) {
    loop {
        tokio::select! { _ = stopped.cancelled() => return, _ = work.notified() => {} }
        while let Some(owner) = owner.upgrade() {
            let Some((key, token, dirty)) = owner.refresh_job() else {
                break;
            };
            let result =
                tokio::time::timeout(BUILD_TIMEOUT, owner.refresh_job_inner(&key, token, dirty))
                    .await;
            let mut state = owner.state.write();
            if let Some(entry) = state.entries.get_mut(&key).filter(|e| e.token == token) {
                if let Err(reason) = result.unwrap_or(Err(SourceReason::SourceUnavailable)) {
                    entry.invalidate(reason);
                }
                entry.refreshing = false;
            }
            drop(state);
            owner.changed.notify_waiters();
        }
    }
}

pub(super) async fn watch(owner: Weak<Catalog>, mut events: ResourceEvents) {
    while let Ok(change) = events.next().await {
        let Some(owner) = owner.upgrade() else { return };
        owner.change(change);
    }
    log::error!("[RESOURCE SEARCH] resource subscription closed");
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize};

    use config::meta::resources::{ResourceRoute, SearchResponse, SourceStatus};
    use parking_lot::Mutex;

    use super::*;

    struct Fixture {
        catalog: Arc<Catalog>,
        rows: Arc<Mutex<Vec<ResourceSummary>>>,
        reads: Arc<AtomicUsize>,
        fail: Arc<AtomicBool>,
    }

    fn fixture(rows: Vec<ResourceSummary>) -> Fixture {
        fixture_with(rows, Limits::default(), |_| ()).0
    }

    fn fixture_with<T>(
        rows: Vec<ResourceSummary>,
        limits: Limits,
        wrap: impl FnOnce(&mut Readers) -> T,
    ) -> (Fixture, T) {
        let rows = Arc::new(Mutex::new(rows));
        let reads = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicBool::new(false));
        let mut source = readers(rows.clone(), reads.clone(), fail.clone());
        let extra = wrap(&mut source);
        let catalog = Catalog::new(source, limits);
        (
            Fixture {
                catalog,
                rows,
                reads,
                fail,
            },
            extra,
        )
    }

    fn readers(
        rows: Arc<Mutex<Vec<ResourceSummary>>>,
        reads: Arc<AtomicUsize>,
        fail: Arc<AtomicBool>,
    ) -> Readers {
        let (page_rows, page_reads, page_fail) = (rows.clone(), reads.clone(), fail.clone());
        Readers {
            page: Arc::new(move |_, kind, after, limit| {
                let (rows, reads, fail) =
                    (page_rows.clone(), page_reads.clone(), page_fail.clone());
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
            }),
            folders: Arc::new(|_, _, _| {
                Box::pin(async {
                    Ok(FolderPage {
                        items: Vec::new(),
                        next: None,
                    })
                })
            }),
            refresh: Arc::new(move |_, _, ids| {
                let (rows, reads, fail) = (rows.clone(), reads.clone(), fail.clone());
                Box::pin(async move {
                    reads.fetch_add(1, Ordering::Relaxed);
                    anyhow::ensure!(!fail.load(Ordering::Relaxed), "resource reader disabled");
                    Ok(rows
                        .lock()
                        .iter()
                        .filter(|r| ids.contains(&r.id))
                        .cloned()
                        .collect())
                })
            }),
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

    fn dashboard(folder: &str) -> ResourceSummary {
        ResourceSummary {
            kind: ResourceKind::Dashboard,
            folder_id: Some(folder.into()),
            folder_name: Some(folder.into()),
            route_ref: ResourceRoute::Dashboard {
                dashboard_id: "d1".into(),
                folder_id: folder.into(),
            },
            ..row("d1", "Payment")
        }
    }

    fn one_folder(source: &mut Readers, id: &'static str, name: &'static str) -> Arc<AtomicUsize> {
        let count = Arc::new(AtomicUsize::new(0));
        let reads = count.clone();
        source.folders = Arc::new(move |_, _, _| {
            reads.fetch_add(1, Ordering::Relaxed);
            Box::pin(async move {
                Ok(FolderPage {
                    items: vec![(ResourceKind::Dashboard, id.into(), name.into())],
                    next: None,
                })
            })
        });
        count
    }

    fn pause_first_page(source: &mut Readers) -> (Arc<Notify>, Arc<Notify>) {
        let (started, release) = (Arc::new(Notify::new()), Arc::new(Notify::new()));
        let (start, gate, base) = (started.clone(), release.clone(), source.page.clone());
        let first = Arc::new(AtomicBool::new(true));
        source.page = Arc::new(move |org, kind, after, limit| {
            let future = base(org, kind, after, limit);
            let (start, gate) = (start.clone(), gate.clone());
            let first = first.swap(false, Ordering::Relaxed);
            Box::pin(async move {
                let page = future.await?;
                if first {
                    start.notify_one();
                    gate.notified().await;
                }
                Ok(page)
            })
        });
        (started, release)
    }

    fn changed(org: &str, id: &str) -> ResourceChange {
        ResourceChange::Resource {
            org: org.into(),
            kind: ResourceKind::Function,
            id: id.into(),
        }
    }

    fn first_name(catalog: &Catalog, org: &str) -> Option<String> {
        let state = catalog.state.read();
        let entry = state.entries.get(&Key::new(org, ResourceKind::Function))?;
        let EntryStatus::Ready(data) = &entry.status else {
            return None;
        };
        let data = data.try_read().ok()?;
        data.records
            .rows
            .first()
            .map(|row| row.summary.name.clone())
    }

    fn is_unavailable(catalog: &Catalog) -> bool {
        matches!(
            catalog.state.read().entries[&Key::new("org", ResourceKind::Function)].status,
            EntryStatus::Invalid(SourceReason::SourceUnavailable)
        )
    }

    async fn query_work(
        catalog: Arc<Catalog>,
        q: &str,
        kind: ResourceKind,
        limit: usize,
    ) -> crate::resources::scan::SearchWork {
        let deadline = Instant::now() + crate::resources::scan::SCAN_BUDGET;
        let snapshots = catalog.read("org", &[kind], deadline).await;
        crate::resources::scan::SearchWork {
            catalog,
            org: "org".into(),
            subject: "reviewer".into(),
            prepared: crate::resources::matching::PreparedQuery::new(q).unwrap(),
            access: vec![crate::resources::ResourceAccess {
                kind,
                predicate: Arc::new(|_| true),
                partial: false,
                unavailable_reason: None,
            }],
            query: config::meta::resources::SearchQuery {
                q: q.into(),
                types: vec![kind],
                limit,
                cursor: None,
            },
            cursor: None,
            snapshots,
            deadline,
            cancelled: CancellationToken::new(),
        }
    }

    async fn search(catalog: &Arc<Catalog>, q: &str, kind: ResourceKind) -> SearchResponse {
        query_work(catalog.clone(), q, kind, 20)
            .await
            .execute()
            .unwrap()
    }

    async fn ensure(catalog: &Arc<Catalog>, org: &str, kind: ResourceKind) {
        catalog.ensure(org, &[kind]).await.unwrap();
    }

    #[tokio::test]
    async fn hot_reads_skip_the_source_and_events_refresh_rows() {
        let x = fixture(vec![row("f1", "Old")]);
        ensure(&x.catalog, "org", ResourceKind::Function).await;
        let reads = x.reads.load(Ordering::Relaxed);
        ensure(&x.catalog, "org", ResourceKind::Function).await;
        assert_eq!(x.reads.load(Ordering::Relaxed), reads);

        x.rows.lock()[0].name = "New".into();
        x.catalog.change(changed("org", "f1"));
        x.catalog.wait_idle().await;
        assert_eq!(first_name(&x.catalog, "org").as_deref(), Some("New"));

        x.rows.lock().clear();
        x.catalog.change(changed("org", "f1"));
        x.catalog.wait_idle().await;
        assert_eq!(first_name(&x.catalog, "org"), None);

        x.fail.store(true, Ordering::Relaxed);
        x.catalog.change(changed("org", "f2"));
        x.catalog.wait_idle().await;
        assert!(is_unavailable(&x.catalog));
    }

    #[tokio::test]
    async fn dirty_ids_are_reread_in_one_batch() {
        let x = fixture(vec![row("f1", "A"), row("f2", "B"), row("f3", "C")]);
        ensure(&x.catalog, "org", ResourceKind::Function).await;
        let reads = x.reads.load(Ordering::Relaxed);
        x.rows.lock().retain(|r| r.id != "f3");
        x.rows.lock()[0].name = "Renamed".into();
        for id in ["f1", "f2", "f3"] {
            x.catalog.change(changed("org", id));
        }
        x.catalog.wait_idle().await;
        assert_eq!(x.reads.load(Ordering::Relaxed), reads + 1);
        let state = x.catalog.state.read();
        let EntryStatus::Ready(handle) =
            &state.entries[&Key::new("org", ResourceKind::Function)].status
        else {
            panic!("function catalog is not ready");
        };
        let ready = handle.try_read().unwrap();
        let mut names = ready
            .records
            .rows
            .iter()
            .map(|r| r.summary.name.as_str())
            .collect::<Vec<_>>();
        names.sort_unstable();
        assert_eq!(names, ["B", "Renamed"]);
    }

    #[tokio::test]
    async fn cold_build_is_shared_and_absorbs_writes_made_during_it() {
        let (x, (started, release)) =
            fixture_with(vec![row("f1", "Old")], Limits::default(), pause_first_page);
        let (first, second) = (x.catalog.clone(), x.catalog.clone());
        let a = tokio::spawn(async move { first.ensure("org", &[ResourceKind::Function]).await });
        started.notified().await;
        let b = tokio::spawn(async move { second.ensure("org", &[ResourceKind::Function]).await });
        x.rows.lock()[0].name = "New".into();
        x.catalog.change(changed("org", "f1"));
        release.notify_one();
        a.await.unwrap().unwrap();
        b.await.unwrap().unwrap();
        // One page for the single shared build, one refresh for the write.
        assert_eq!(x.reads.load(Ordering::Relaxed), 2);
        assert_eq!(first_name(&x.catalog, "org").as_deref(), Some("New"));
    }

    #[tokio::test]
    async fn scan_filters_before_top_k_and_cursor_detects_changes() {
        let x = fixture(vec![
            row("hidden", "Pay"),
            row("b", "Pay b"),
            row("c", "Pay c"),
        ]);
        ensure(&x.catalog, "org", ResourceKind::Function).await;
        let page = |cursor: Option<&String>| {
            let catalog = x.catalog.clone();
            let cursor = cursor.cloned();
            async move {
                let mut work = query_work(catalog, "pay", ResourceKind::Function, 1).await;
                work.access[0].predicate = Arc::new(|row| row.id != "hidden");
                work.cursor = cursor.map(|value| {
                    let scope = crate::resources::cursor::CursorScope {
                        subject: "reviewer",
                        org: "org",
                        kind: ResourceKind::Function,
                        query: "pay",
                    };
                    crate::resources::cursor::decode(
                        &value,
                        &scope,
                        config::utils::time::now_micros(),
                    )
                    .unwrap()
                });
                work.execute()
            }
        };
        let first = page(None).await.unwrap();
        assert_eq!(first.hits[0].summary.id, "b");
        let cursor = first.sources[0].next_cursor.as_ref();
        let second = page(cursor).await.unwrap();
        assert_eq!(second.hits[0].summary.id, "c");
        assert_eq!(second.sources[0].has_more, Some(false));

        x.catalog.change(changed("org", "b"));
        x.catalog.wait_idle().await;
        assert!(matches!(
            page(cursor).await,
            Err(SearchError::SearchChanged)
        ));
    }

    #[tokio::test]
    async fn capped_or_cancelled_scans_never_claim_complete() {
        let x = fixture(vec![row("f1", "Old")]);
        ensure(&x.catalog, "org", ResourceKind::Function).await;
        let mut capped = query_work(x.catalog.clone(), "Old", ResourceKind::Function, 20).await;
        capped.access[0].partial = true;
        let cancelled = query_work(x.catalog.clone(), "none", ResourceKind::Function, 20).await;
        cancelled.cancelled.cancel();
        for work in [capped, cancelled] {
            let source = &work.execute().unwrap().sources[0];
            assert_eq!(source.status, SourceStatus::Partial);
            assert_eq!(source.has_more, None);
        }
    }

    #[tokio::test]
    async fn budget_evicts_other_orgs_then_reports_exhaustion() {
        let probe = fixture(vec![row("f1", "Old")]);
        ensure(&probe.catalog, "one", ResourceKind::Function).await;
        let entry = probe.catalog.state.read().used();

        let limits = |max_bytes, max_pending| Limits {
            max_bytes,
            max_pending,
        };
        let x = fixture_with(vec![row("f1", "Old")], limits(entry * 3 / 2, 32), |_| ()).0;
        ensure(&x.catalog, "one", ResourceKind::Function).await;
        ensure(&x.catalog, "two", ResourceKind::Function).await;
        assert_eq!(first_name(&x.catalog, "one"), None);
        assert_eq!(first_name(&x.catalog, "two").as_deref(), Some("Old"));

        let tiny = fixture_with(vec![row("f1", "Old")], limits(1, 32), |_| ()).0;
        ensure(&tiny.catalog, "org", ResourceKind::Function).await;
        let result = search(&tiny.catalog, "Old", ResourceKind::Function).await;
        assert_eq!(
            result.sources[0].reason,
            Some(SourceReason::ResourceExhausted)
        );

        let full = fixture_with(Vec::new(), limits(entry, 0), |_| ()).0;
        assert!(matches!(
            full.catalog.ensure("org", &[ResourceKind::Function]).await,
            Err(SearchError::Overloaded)
        ));
    }

    #[tokio::test]
    async fn searching_a_ready_org_near_the_budget_keeps_other_orgs() {
        let probe = fixture(vec![row("f1", "Old")]);
        ensure(&probe.catalog, "one", ResourceKind::Function).await;
        let entry = probe.catalog.state.read().used();

        let limits = Limits {
            max_bytes: entry * 21 / 10,
            max_pending: 32,
        };
        let x = fixture_with(vec![row("f1", "Old")], limits, |_| ()).0;
        ensure(&x.catalog, "one", ResourceKind::Function).await;
        ensure(&x.catalog, "two", ResourceKind::Function).await;
        let reads = x.reads.load(Ordering::Relaxed);
        for _ in 0..3 {
            ensure(&x.catalog, "two", ResourceKind::Function).await;
        }
        assert_eq!(first_name(&x.catalog, "one").as_deref(), Some("Old"));
        assert_eq!(x.reads.load(Ordering::Relaxed), reads);
    }

    #[tokio::test]
    async fn held_scan_blocks_only_its_own_entry_refresh() {
        let x = fixture(vec![row("f1", "Old")]);
        ensure(&x.catalog, "held", ResourceKind::Function).await;
        ensure(&x.catalog, "other", ResourceKind::Function).await;
        let deadline = Instant::now() + Duration::from_secs(1);
        let held = x
            .catalog
            .read("held", &[ResourceKind::Function], deadline)
            .await;
        x.rows.lock()[0].name = "New".into();
        x.catalog.change(changed("other", "f1"));
        x.catalog.wait_idle().await;
        assert_eq!(first_name(&x.catalog, "other").as_deref(), Some("New"));

        x.catalog.change(changed("held", "f1"));
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(
            x.catalog.state.read().entries[&Key::new("held", ResourceKind::Function)].refreshing
        );
        drop(held);
        x.catalog.wait_idle().await;
        assert_eq!(first_name(&x.catalog, "held").as_deref(), Some("New"));
    }

    #[tokio::test]
    async fn folder_rename_patches_rows_from_folder_pages_only() {
        let (x, folder_reads) = fixture_with(vec![dashboard("f")], Limits::default(), |source| {
            one_folder(source, "f", "Renamed")
        });
        ensure(&x.catalog, "org", ResourceKind::Dashboard).await;
        x.catalog.change(ResourceChange::Folder {
            org: "org".into(),
            kind: ResourceKind::Dashboard,
        });
        x.catalog.wait_idle().await;
        assert_eq!(x.reads.load(Ordering::Relaxed), 1);
        assert_eq!(folder_reads.load(Ordering::Relaxed), 1);
        let result = search(&x.catalog, "Payment", ResourceKind::Dashboard).await;
        assert_eq!(
            result.hits[0].summary.folder_name.as_deref(),
            Some("Renamed")
        );
    }

    #[tokio::test]
    async fn removed_folder_invalidates_until_rebuild_moves_rows() {
        let (x, _) = fixture_with(vec![dashboard("old")], Limits::default(), |source| {
            one_folder(source, "new", "new")
        });
        ensure(&x.catalog, "org", ResourceKind::Dashboard).await;
        x.rows.lock()[0] = dashboard("new");
        x.catalog.change(ResourceChange::Folder {
            org: "org".into(),
            kind: ResourceKind::Dashboard,
        });
        x.catalog.wait_idle().await;
        let stale = search(&x.catalog, "Payment", ResourceKind::Dashboard).await;
        assert!(stale.hits.is_empty());
        assert_eq!(
            stale.sources[0].reason,
            Some(SourceReason::SourceUnavailable)
        );

        ensure(&x.catalog, "org", ResourceKind::Dashboard).await;
        let rebuilt = search(&x.catalog, "Payment", ResourceKind::Dashboard).await;
        assert!(matches!(
            &rebuilt.hits[0].summary.route_ref,
            ResourceRoute::Dashboard { folder_id, .. } if folder_id == "new"
        ));
    }
}
