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
use tokio::sync::{Notify, Semaphore};
use tokio_util::sync::CancellationToken;

use super::{
    SearchError,
    records::{Budget, FolderUpdateError, Lease, Records, summary_heap},
};

const PAGE_SIZE: usize = 512;
const MAX_DIRTY_KEYS: usize = 10_000;

type PageReader = Arc<
    dyn Fn(
            String,
            ResourceKind,
            Option<String>,
            usize,
            usize,
        ) -> BoxFuture<'static, anyhow::Result<SummaryPage>>
        + Send
        + Sync,
>;
type PageCost = Arc<
    dyn Fn(String, ResourceKind, Option<String>, usize) -> BoxFuture<'static, anyhow::Result<usize>>
        + Send
        + Sync,
>;
type RecordReader = Arc<
    dyn Fn(
            String,
            ResourceKind,
            String,
            usize,
        ) -> BoxFuture<'static, anyhow::Result<Option<ResourceSummary>>>
        + Send
        + Sync,
>;
type RecordCost = Arc<
    dyn Fn(String, ResourceKind, String) -> BoxFuture<'static, anyhow::Result<usize>> + Send + Sync,
>;
type FolderReader = Arc<
    dyn Fn(String, Option<String>, usize, usize) -> BoxFuture<'static, anyhow::Result<FolderPage>>
        + Send
        + Sync,
>;
type FolderCost = Arc<
    dyn Fn(String, Option<String>, usize) -> BoxFuture<'static, anyhow::Result<usize>>
        + Send
        + Sync,
>;

#[derive(Clone)]
pub(super) struct Readers {
    pub page: PageReader,
    pub page_cost: PageCost,
    pub refresh: RecordReader,
    pub refresh_cost: RecordCost,
    pub folders: FolderReader,
    pub folder_cost: FolderCost,
    pub health: Arc<dyn Fn() -> (bool, u64) + Send + Sync>,
}

impl Readers {
    pub fn production() -> Self {
        Self {
            health: Arc::new(infra::coordinator::resources::continuity_snapshot),
            page_cost: Arc::new(|org, kind, after, limit| {
                Box::pin(async move {
                    db::resources::page_scratch_bytes(&org, kind, after.as_deref(), limit).await
                })
            }),
            refresh_cost: Arc::new(|org, kind, id| {
                Box::pin(async move { db::resources::refresh_scratch_bytes(&org, kind, &id).await })
            }),
            folder_cost: Arc::new(|org, after, limit| {
                Box::pin(async move {
                    db::resources::folder_scratch_bytes(&org, after.as_deref(), limit).await
                })
            }),
            page: Arc::new(|org, kind, after, limit, max_bytes| {
                Box::pin(async move {
                    db::resources::load_page(&org, kind, after.as_deref(), limit, max_bytes).await
                })
            }),
            refresh: Arc::new(|org, kind, id, max_bytes| {
                Box::pin(async move { db::resources::refresh(&org, kind, &id, max_bytes).await })
            }),
            folders: Arc::new(|org, after, limit, max_bytes| {
                Box::pin(async move {
                    db::resources::folder_page(&org, after.as_deref(), limit, max_bytes).await
                })
            }),
        }
    }
}

pub(super) struct Limits {
    pub max_bytes: usize,
    pub cold_wait: Duration,
    pub build_timeout: Duration,
    pub idle: Duration,
    pub max_pending: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self {
            max_bytes: 512 * 1024 * 1024,
            cold_wait: Duration::from_millis(300),
            build_timeout: Duration::from_secs(30),
            idle: Duration::from_secs(15 * 60),
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
    pub budget: Arc<Budget>,
    limits: Limits,
    builds: Arc<Semaphore>,
    waiters: Arc<Semaphore>,
    pub scans: Arc<Semaphore>,
    changed: Arc<Notify>,
    work: Arc<Notify>,
    stopped: CancellationToken,
    serial: AtomicU64,
    instance: String,
    watch_state: AtomicU64,
}

impl Catalog {
    pub fn new(readers: Readers, limits: Limits) -> Arc<Self> {
        let catalog = Arc::new(Self {
            state: RwLock::new(State {
                entries: HashMap::new(),
                pending: 0,
            }),
            readers,
            budget: Budget::new(limits.max_bytes),
            limits,
            builds: Arc::new(Semaphore::new(2)),
            waiters: Arc::new(Semaphore::new(32)),
            scans: Arc::new(Semaphore::new(4)),
            changed: Arc::new(Notify::new()),
            work: Arc::new(Notify::new()),
            stopped: CancellationToken::new(),
            serial: AtomicU64::new(0),
            instance: svix_ksuid::Ksuid::new(None, None).to_string(),
            watch_state: AtomicU64::new(1),
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

    pub fn health(&self) -> (bool, u128) {
        let watch = self.watch_state.load(Ordering::Acquire);
        let (healthy, epoch) = (self.readers.health)();
        (
            healthy && watch & 1 == 1,
            (u128::from(epoch) << 64) | u128::from(watch >> 1),
        )
    }

    pub async fn ensure(
        self: &Arc<Self>,
        org: &str,
        kinds: &[ResourceKind],
    ) -> Result<Vec<ResourceKind>, SearchError> {
        let mut exhausted = Vec::new();
        let health = self.health();
        let mut starts = Vec::new();
        {
            let mut state = self.state.write();
            if !health.0 {
                for (key, entry) in &mut state.entries {
                    if key.org == org && kinds.contains(&key.kind) {
                        entry.invalidate(SourceReason::SourceUnavailable);
                    }
                }
                return Ok(exhausted);
            }
            for (key, entry) in &mut state.entries {
                if key.org == org
                    && kinds.contains(&key.kind)
                    && entry.ready().is_some_and(|ready| ready.epoch != health.1)
                {
                    entry.invalidate(SourceReason::SourceUnavailable);
                }
            }
            state.evict(
                org,
                self.limits.idle,
                self.budget.used.load(Ordering::Relaxed)
                    > self.limits.max_bytes.saturating_mul(9) / 10,
            );
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
            if state.pending + needed > self.limits.max_pending {
                return Err(SearchError::Overloaded);
            }
            for &kind in kinds {
                let key = Key::new(org, kind);
                if let Some(entry) = state.entries.get_mut(&key) {
                    entry.last_used = Instant::now();
                    if !matches!(entry.status, EntryStatus::Invalid(_)) {
                        continue;
                    }
                }
                let token = self.version();
                let metadata = self
                    .budget
                    .reserve(size_of::<(Key, Entry)>() * 4 + key.org.capacity() + 1024);
                let Ok(metadata) = metadata else {
                    if let Some(entry) = state.entries.get_mut(&key) {
                        entry.invalidate(SourceReason::ResourceExhausted);
                    }
                    exhausted.push(kind);
                    continue;
                };
                state
                    .entries
                    .insert(key.clone(), Entry::loading(token, metadata));
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
            self.state.write().entries.iter().any(|(key, entry)| {
                key.org == org
                    && kinds.contains(&key.kind)
                    && matches!(entry.status, EntryStatus::Loading)
            })
        };
        if !loading() {
            return Ok(exhausted);
        }
        let _waiter = self
            .waiters
            .clone()
            .try_acquire_owned()
            .map_err(|_| SearchError::Overloaded)?;
        let deadline = tokio::time::Instant::now() + self.limits.cold_wait;
        loop {
            let changed = self.changed.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            if !loading() {
                return Ok(exhausted);
            }
            if tokio::time::timeout_at(deadline, changed).await.is_err() {
                return Ok(exhausted);
            }
        }
    }

    pub fn change(self: &Arc<Self>, change: ResourceChange) {
        let mut state = self.state.write();
        for (key, entry) in &mut state.entries {
            match &change {
                ResourceChange::Resource { org, kind, id }
                    if key.org == *org && key.kind == *kind =>
                {
                    entry.mark_dirty(id, &self.budget)
                }
                ResourceChange::GlobalResource { kind, id } if key.kind == *kind => {
                    entry.mark_dirty(id, &self.budget)
                }
                ResourceChange::Folder { org }
                    if key.org == *org
                        && matches!(
                            key.kind,
                            ResourceKind::Dashboard | ResourceKind::Alert | ResourceKind::Synthetic
                        ) =>
                {
                    entry.folder_dirty = true
                }
                ResourceChange::Scope { org, kinds }
                    if org.as_ref().is_none_or(|org| key.org == *org)
                        && kinds.contains(&key.kind) =>
                {
                    entry.invalidate(SourceReason::SourceUnavailable)
                }
                ResourceChange::InvalidateAll => entry.invalidate(SourceReason::SourceUnavailable),
                _ => {}
            }
        }
        drop(state);
        self.work.notify_one();
        self.changed.notify_waiters();
    }

    fn watch_health(&self, healthy: bool) {
        let mut value = self.watch_state.load(Ordering::Acquire);
        loop {
            let next = (value.wrapping_add(2) & !1) | u64::from(healthy);
            match self.watch_state.compare_exchange_weak(
                value,
                next,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return,
                Err(current) => value = current,
            }
        }
    }

    fn version(&self) -> u64 {
        self.serial.fetch_add(1, Ordering::Relaxed) + 1
    }

    async fn build(self: Arc<Self>, key: Key, token: u64) {
        let result =
            tokio::time::timeout(self.limits.build_timeout, self.build_inner(&key, token)).await;
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
        let health = self.health();
        if !health.0 {
            return Err(SourceReason::SourceUnavailable);
        }
        let mut records = Records::new(self.budget.clone());
        let mut after = None;
        loop {
            let (page_limit, mut page_budget) = self.source_page_reservation(key, &after).await?;
            let scratch = page_budget.bytes;
            let page = (self.readers.page)(
                key.org.clone(),
                key.kind,
                after.clone(),
                page_limit,
                scratch,
            )
            .await
            .map_err(source_error)?;
            page_budget
                .resize(
                    page.items.capacity() * size_of::<ResourceSummary>()
                        + page.items.iter().map(summary_heap).sum::<usize>(),
                )
                .map_err(|_| SourceReason::ResourceExhausted)?;
            for row in page.items {
                if row.kind != key.kind {
                    return Err(SourceReason::SourceUnavailable);
                }
                records
                    .upsert(row)
                    .map_err(|_| SourceReason::ResourceExhausted)?;
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
                let Some(entry) = state
                    .entries
                    .get_mut(key)
                    .filter(|e| e.token == token && matches!(e.status, EntryStatus::Loading))
                else {
                    return Ok(());
                };
                if self.health() != health {
                    return Err(SourceReason::SourceUnavailable);
                }
                if entry.dirty.is_empty() && !entry.folder_dirty {
                    entry.status = EntryStatus::Ready(Ready {
                        records,
                        version: self.version(),
                        epoch: health.1,
                    });
                    return Ok(());
                }
                entry.take_dirty()?
            };
            self.refresh_records(key, &mut records, dirty).await?;
        }
    }

    async fn refresh_records(
        &self,
        key: &Key,
        records: &mut Records,
        dirty: Dirty,
    ) -> Result<(), SourceReason> {
        if dirty.folders {
            let names = self.folder_names(&key.org, key.kind).await?;
            records.update_folders(&names.0).map_err(folder_error)?;
        }
        for id in dirty.ids {
            let (row, _scratch) = self.fetch_record(key, &id).await?;
            match row {
                Some(row) if row.kind == key.kind && row.id == id => records
                    .upsert(row)
                    .map_err(|_| SourceReason::ResourceExhausted)?,
                None => records.remove(&id),
                Some(_) => return Err(SourceReason::SourceUnavailable),
            }
        }
        Ok(())
    }

    async fn folder_names(
        &self,
        org: &str,
        kind: ResourceKind,
    ) -> Result<(HashMap<String, String>, Lease), SourceReason> {
        let mut values = HashMap::new();
        let mut lease = Lease::empty(self.budget.clone());
        let mut after = None;
        loop {
            let (page_limit, mut page_budget) = self.folder_page_reservation(org, &after).await?;
            let scratch = page_budget.bytes;
            let page = (self.readers.folders)(org.into(), after.clone(), page_limit, scratch)
                .await
                .map_err(source_error)?;
            page_budget
                .resize(
                    page.items.capacity() * size_of::<(ResourceKind, String, String)>()
                        + page
                            .items
                            .iter()
                            .map(|(_, id, name)| id.capacity() + name.capacity())
                            .sum::<usize>(),
                )
                .map_err(|_| SourceReason::ResourceExhausted)?;
            let incoming = page
                .items
                .iter()
                .filter(|(source, ..)| *source == kind)
                .map(|(_, id, name)| id.capacity() + name.capacity())
                .sum::<usize>();
            let growth = if values.capacity() - values.len() < page.items.len() {
                values.allocation_size() * 2
                    + page.items.len() * size_of::<(String, String)>() * 4
                    + 128
            } else {
                0
            };
            let extra = self
                .budget
                .reserve(growth)
                .map_err(|_| SourceReason::ResourceExhausted)?;
            lease.absorb(extra);
            values
                .try_reserve(page.items.len())
                .map_err(|_| SourceReason::ResourceExhausted)?;
            lease.absorb(page_budget.split(incoming));
            for (source, id, name) in page.items {
                if source == kind {
                    values.insert(id, name);
                }
            }
            lease
                .resize(
                    values.allocation_size()
                        + values
                            .iter()
                            .map(|(id, name)| id.capacity() + name.capacity())
                            .sum::<usize>(),
                )
                .map_err(|_| SourceReason::ResourceExhausted)?;
            if page.next.is_none() {
                break;
            }
            if page.next == after {
                return Err(SourceReason::SourceUnavailable);
            }
            after = page.next;
        }
        Ok((values, lease))
    }

    async fn source_page_reservation(
        &self,
        key: &Key,
        after: &Option<String>,
    ) -> Result<(usize, Lease), SourceReason> {
        let mut limit = PAGE_SIZE;
        loop {
            let bytes = (self.readers.page_cost)(key.org.clone(), key.kind, after.clone(), limit)
                .await
                .map_err(source_error)?;
            match self.budget.reserve(bytes) {
                Ok(held) => return Ok((limit, held)),
                Err(_) if limit > 1 => limit /= 2,
                Err(_) => return Err(SourceReason::ResourceExhausted),
            }
        }
    }

    async fn folder_page_reservation(
        &self,
        org: &str,
        after: &Option<String>,
    ) -> Result<(usize, Lease), SourceReason> {
        let mut limit = PAGE_SIZE;
        loop {
            let bytes = (self.readers.folder_cost)(org.into(), after.clone(), limit)
                .await
                .map_err(source_error)?;
            match self.budget.reserve(bytes) {
                Ok(held) => return Ok((limit, held)),
                Err(_) if limit > 1 => limit /= 2,
                Err(_) => return Err(SourceReason::ResourceExhausted),
            }
        }
    }

    async fn fetch_record(
        &self,
        key: &Key,
        id: &str,
    ) -> Result<(Option<ResourceSummary>, Lease), SourceReason> {
        let scratch = (self.readers.refresh_cost)(key.org.clone(), key.kind, id.into())
            .await
            .map_err(source_error)?;
        let mut held = self
            .budget
            .reserve(scratch)
            .map_err(|_| SourceReason::ResourceExhausted)?;
        let value = (self.readers.refresh)(key.org.clone(), key.kind, id.into(), scratch)
            .await
            .map_err(source_error)?;
        held.resize(
            value
                .as_ref()
                .map_or(0, |row| size_of::<ResourceSummary>() + summary_heap(row)),
        )
        .map_err(|_| SourceReason::ResourceExhausted)?;
        Ok((value, held))
    }

    fn refresh_job(&self) -> Option<(Key, u64, Dirty)> {
        let mut state = self.state.write();
        state.entries.iter_mut().find_map(|(key, entry)| {
            if matches!(entry.status, EntryStatus::Ready(_))
                && (!entry.dirty.is_empty() || entry.folder_dirty)
            {
                entry.refreshing = true;
                match entry.take_dirty() {
                    Ok(dirty) => Some((key.clone(), entry.token, dirty)),
                    Err(reason) => {
                        entry.invalidate(reason);
                        None
                    }
                }
            } else {
                None
            }
        })
    }

    async fn refresh_job_inner(
        &self,
        key: &Key,
        token: u64,
        dirty: Dirty,
    ) -> Result<(), SourceReason> {
        let folder_names = if dirty.folders {
            Some(self.folder_names(&key.org, key.kind).await?)
        } else {
            None
        };
        if let Some((names, _lease)) = folder_names {
            let mut state = self.state.write();
            if let Some(entry) = state.entries.get_mut(key).filter(|e| e.token == token)
                && let EntryStatus::Ready(ready) = &mut entry.status
                && ready.records.update_folders(&names).map_err(folder_error)?
            {
                ready.version = self.version();
            }
        }
        for id in dirty.ids {
            let (row, _scratch) = self.fetch_record(key, &id).await?;
            let mut state = self.state.write();
            let Some(entry) = state
                .entries
                .get_mut(key)
                .filter(|entry| entry.token == token)
            else {
                return Ok(());
            };
            let EntryStatus::Ready(ready) = &mut entry.status else {
                return Ok(());
            };
            if let Some(row) = row {
                if row.kind != key.kind || row.id != id {
                    return Err(SourceReason::SourceUnavailable);
                }
                ready
                    .records
                    .upsert(row)
                    .map_err(|_| SourceReason::ResourceExhausted)?;
            } else {
                ready.records.remove(&id);
            }
            ready.version = self.version();
        }
        Ok(())
    }

    #[cfg(test)]
    async fn wait_idle(&self) {
        loop {
            let notified = self.changed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            if self.state.write().entries.values().all(|e| {
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
}

impl State {
    fn evict(&mut self, current_org: &str, idle: Duration, pressure: bool) {
        let now = Instant::now();
        let mut oldest: Option<(String, Instant)> = None;
        self.entries.retain(|key, entry| {
            if matches!(entry.status, EntryStatus::Loading) {
                return true;
            }
            if now.duration_since(entry.last_used) >= idle {
                return false;
            }
            if key.org == current_org {
                return true;
            }
            if oldest.as_ref().is_none_or(|(_, at)| entry.last_used < *at) {
                oldest = Some((key.org.clone(), entry.last_used));
            }
            true
        });
        if pressure && let Some((org, _)) = oldest {
            self.entries.retain(|key, entry| {
                key.org != org || matches!(entry.status, EntryStatus::Loading)
            });
        }
        self.entries.shrink_to_fit();
    }
}

pub(super) struct Entry {
    pub status: EntryStatus,
    token: u64,
    last_used: Instant,
    dirty: HashSet<String>,
    folder_dirty: bool,
    refreshing: bool,
    metadata: Lease,
    base_bytes: usize,
}

impl Entry {
    fn loading(token: u64, metadata: Lease) -> Self {
        Self {
            status: EntryStatus::Loading,
            token,
            last_used: Instant::now(),
            dirty: HashSet::new(),
            folder_dirty: false,
            refreshing: false,
            base_bytes: metadata.bytes,
            metadata,
        }
    }

    fn ready(&self) -> Option<&Ready> {
        if let EntryStatus::Ready(ready) = &self.status {
            Some(ready)
        } else {
            None
        }
    }

    fn mark_dirty(&mut self, id: &str, budget: &Arc<Budget>) {
        if matches!(self.status, EntryStatus::Invalid(_)) {
            return;
        }
        if self.dirty.contains(id) {
            return;
        }
        if self.dirty.len() >= MAX_DIRTY_KEYS {
            self.invalidate(SourceReason::SourceUnavailable);
            return;
        }
        let extra = budget.reserve(id.len() + self.dirty.allocation_size() * 2 + 1024);
        let Ok(extra) = extra else {
            self.invalidate(SourceReason::ResourceExhausted);
            return;
        };
        self.metadata.absorb(extra);
        self.dirty.insert(id.into());
        self.metadata.shrink(
            self.base_bytes
                + self.dirty.allocation_size()
                + self.dirty.iter().map(String::capacity).sum::<usize>(),
        );
    }

    fn take_dirty(&mut self) -> Result<Dirty, SourceReason> {
        let extra = self
            .metadata
            .budget
            .reserve(self.dirty.len() * size_of::<String>())
            .map_err(|_| SourceReason::ResourceExhausted)?;
        self.metadata.absorb(extra);
        let mut ids = Vec::with_capacity(self.dirty.len());
        ids.extend(self.dirty.drain());
        let bytes =
            ids.capacity() * size_of::<String>() + ids.iter().map(String::capacity).sum::<usize>();
        let held = self.metadata.split(bytes);
        Ok(Dirty {
            ids,
            folders: std::mem::take(&mut self.folder_dirty),
            _held: held,
        })
    }

    fn invalidate(&mut self, reason: SourceReason) {
        self.status = EntryStatus::Invalid(reason);
        self.dirty.clear();
        self.dirty.shrink_to_fit();
        self.folder_dirty = false;
        self.refreshing = false;
        self.metadata.shrink(self.base_bytes);
        self.token = self.token.wrapping_add(1);
    }
}

pub(super) enum EntryStatus {
    Loading,
    Ready(Ready),
    Invalid(SourceReason),
}

pub(super) struct Ready {
    pub records: Records,
    pub version: u64,
    pub epoch: u128,
}

struct Dirty {
    ids: Vec<String>,
    folders: bool,
    _held: Lease,
}

fn folder_error(error: FolderUpdateError) -> SourceReason {
    match error {
        FolderUpdateError::MissingFolder => SourceReason::SourceUnavailable,
        FolderUpdateError::Exhausted => SourceReason::ResourceExhausted,
    }
}

fn source_error(error: anyhow::Error) -> SourceReason {
    if error.is::<db::resources::ResourceExhausted>() {
        SourceReason::ResourceExhausted
    } else {
        SourceReason::SourceUnavailable
    }
}

async fn refresh_loop(owner: Weak<Catalog>, work: Arc<Notify>, stopped: CancellationToken) {
    loop {
        tokio::select! { _ = stopped.cancelled() => return, _ = work.notified() => {} }
        while let Some(owner) = owner.upgrade() {
            let Some((key, token, dirty)) = owner.refresh_job() else {
                break;
            };
            let result = tokio::time::timeout(
                owner.limits.build_timeout,
                owner.refresh_job_inner(&key, token, dirty),
            )
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
    loop {
        match events.next().await {
            Ok(change) => {
                let Some(owner) = owner.upgrade() else { return };
                owner.change(change);
            }
            Err(error) => {
                let Some(catalog) = owner.upgrade() else {
                    return;
                };
                log::warn!("[RESOURCE SEARCH] resource subscription unavailable: {error}");
                catalog.watch_health(false);
                catalog.change(ResourceChange::InvalidateAll);
                drop(catalog);
                loop {
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    match db::resources::subscribe().await {
                        Ok(next) => {
                            events = next;
                            if let Some(catalog) = owner.upgrade() {
                                catalog.watch_health(true);
                                catalog.change(ResourceChange::InvalidateAll);
                            }
                            break;
                        }
                        Err(_) => {
                            if owner.strong_count() == 0 {
                                return;
                            }
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize};

    use config::meta::resources::ResourceRoute;
    use parking_lot::Mutex;

    use super::*;

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

    fn readers(
        rows: Arc<Mutex<Vec<ResourceSummary>>>,
        reads: Arc<AtomicUsize>,
        fail: Arc<AtomicBool>,
    ) -> Readers {
        let page_rows = rows.clone();
        let page_reads = reads.clone();
        let page_fail = fail.clone();
        let page_cost_fail = fail.clone();
        let record_cost_fail = fail.clone();
        let folder_cost_fail = fail.clone();
        Readers {
            health: Arc::new(|| (true, 0)),
            page_cost: Arc::new(move |_, _, _, _| {
                let fail = page_cost_fail.clone();
                Box::pin(async move {
                    anyhow::ensure!(!fail.load(Ordering::Relaxed), "resource preflight disabled");
                    Ok(64 * 1024)
                })
            }),
            refresh_cost: Arc::new(move |_, _, _| {
                let fail = record_cost_fail.clone();
                Box::pin(async move {
                    anyhow::ensure!(!fail.load(Ordering::Relaxed), "resource preflight disabled");
                    Ok(64 * 1024)
                })
            }),
            folder_cost: Arc::new(move |_, _, _| {
                let fail = folder_cost_fail.clone();
                Box::pin(async move {
                    anyhow::ensure!(!fail.load(Ordering::Relaxed), "folder preflight disabled");
                    Ok(64 * 1024)
                })
            }),
            page: Arc::new(move |_, kind, after, limit, _| {
                let rows = page_rows.clone();
                let reads = page_reads.clone();
                let fail = page_fail.clone();
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
                    let next = if items.len() > limit {
                        Some(items[limit - 1].id.clone())
                    } else {
                        None
                    };
                    items.truncate(limit);
                    Ok(SummaryPage { items, next })
                })
            }),
            folders: Arc::new(|_, _, _, _| {
                Box::pin(async {
                    Ok(FolderPage {
                        items: Vec::new(),
                        next: None,
                    })
                })
            }),
            refresh: Arc::new(move |_, _, id, _| {
                let rows = rows.clone();
                let reads = reads.clone();
                let fail = fail.clone();
                Box::pin(async move {
                    reads.fetch_add(1, Ordering::Relaxed);
                    anyhow::ensure!(!fail.load(Ordering::Relaxed), "resource reader disabled");
                    Ok(rows.lock().iter().find(|r| r.id == id).cloned())
                })
            }),
        }
    }

    #[tokio::test]
    async fn catalog_hot_ready_reads_do_not_invoke_disabled_metadata_readers() {
        let reads = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicBool::new(false));
        let rows = Arc::new(Mutex::new(vec![row("f1", "Payment")]));
        let catalog = Catalog::new(
            readers(rows, reads.clone(), fail.clone()),
            Limits::default(),
        );
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        assert!(matches!(
            catalog.state.write().entries[&Key::new("org", ResourceKind::Function)].status,
            EntryStatus::Ready(_)
        ));
        let before = reads.load(Ordering::Relaxed);
        fail.store(true, Ordering::Relaxed);
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        assert_eq!(reads.load(Ordering::Relaxed), before);
        let result = query_work(catalog, "Payment", vec![ResourceKind::Function], 20)
            .execute()
            .unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(
            result.sources[0].status,
            config::meta::resources::SourceStatus::Complete
        );
    }

    #[tokio::test]
    async fn catalog_events_refresh_rename_delete_and_failed_refresh_invalidates() {
        let reads = Arc::new(AtomicUsize::new(0));
        let fail = Arc::new(AtomicBool::new(false));
        let rows = Arc::new(Mutex::new(vec![row("f1", "Old")]));
        let catalog = Catalog::new(
            readers(rows.clone(), reads, fail.clone()),
            Limits::default(),
        );
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        rows.lock()[0].name = "Renamed".into();
        catalog.change(ResourceChange::Resource {
            org: "org".into(),
            kind: ResourceKind::Function,
            id: "f1".into(),
        });
        catalog.wait_idle().await;
        assert_eq!(
            catalog.state.write().entries[&Key::new("org", ResourceKind::Function)]
                .ready()
                .unwrap()
                .records
                .rows[0]
                .summary
                .name,
            "Renamed"
        );
        rows.lock().clear();
        catalog.change(ResourceChange::Resource {
            org: "org".into(),
            kind: ResourceKind::Function,
            id: "f1".into(),
        });
        catalog.wait_idle().await;
        assert!(
            catalog.state.write().entries[&Key::new("org", ResourceKind::Function)]
                .ready()
                .unwrap()
                .records
                .rows
                .is_empty()
        );
        fail.store(true, Ordering::Relaxed);
        catalog.change(ResourceChange::Resource {
            org: "org".into(),
            kind: ResourceKind::Function,
            id: "new".into(),
        });
        catalog.wait_idle().await;
        assert!(matches!(
            catalog.state.write().entries[&Key::new("org", ResourceKind::Function)].status,
            EntryStatus::Invalid(SourceReason::SourceUnavailable)
        ));
    }

    #[tokio::test]
    async fn catalog_shares_cold_build_and_settles_writes_before_ready() {
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let reads = Arc::new(AtomicUsize::new(0));
        let data = Arc::new(Mutex::new(vec![row("f1", "Old")]));
        let mut source = readers(
            data.clone(),
            reads.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        let base = source.page.clone();
        let start = started.clone();
        let gate = release.clone();
        source.page = Arc::new(move |org, kind, after, limit, max_bytes| {
            let future = base(org, kind, after, limit, max_bytes);
            let start = start.clone();
            let gate = gate.clone();
            Box::pin(async move {
                let page = future.await?;
                start.notify_one();
                gate.notified().await;
                Ok(page)
            })
        });
        let catalog = Catalog::new(source, Limits::default());
        let first = catalog.clone();
        let a = tokio::spawn(async move { first.ensure("org", &[ResourceKind::Function]).await });
        started.notified().await;
        let second = catalog.clone();
        let b = tokio::spawn(async move { second.ensure("org", &[ResourceKind::Function]).await });
        data.lock()[0].name = "Changed during build".into();
        catalog.change(ResourceChange::Resource {
            org: "org".into(),
            kind: ResourceKind::Function,
            id: "f1".into(),
        });
        release.notify_one();
        a.await.unwrap().unwrap();
        b.await.unwrap().unwrap();
        assert_eq!(reads.load(Ordering::Relaxed), 2);
        assert_eq!(
            catalog.state.write().entries[&Key::new("org", ResourceKind::Function)]
                .ready()
                .unwrap()
                .records
                .rows[0]
                .summary
                .name,
            "Changed during build"
        );
    }

    fn query_work(
        catalog: Arc<Catalog>,
        q: &str,
        kinds: Vec<ResourceKind>,
        limit: usize,
    ) -> crate::resources::scan::SearchWork {
        crate::resources::scan::SearchWork {
            catalog,
            org: "org".into(),
            subject: "reviewer".into(),
            prepared: crate::resources::matching::PreparedQuery::new(q).unwrap(),
            access: kinds
                .iter()
                .map(|&kind| crate::resources::ResourceAccess {
                    kind,
                    predicate: Arc::new(|_| true),
                    partial: false,
                    unavailable_reason: None,
                })
                .collect(),
            query: config::meta::resources::SearchQuery {
                q: q.into(),
                types: kinds,
                limit,
                cursor: None,
            },
            cursor: None,
            exhausted: Vec::new(),
            cancelled: CancellationToken::new(),
        }
    }

    #[tokio::test]
    async fn catalog_continuity_loss_during_build_prevents_ready_until_fresh_recovery_build() {
        let data = Arc::new(Mutex::new(vec![row("f1", "Before gap")]));
        let reads = Arc::new(AtomicUsize::new(0));
        let mut source = readers(
            data.clone(),
            reads.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        let health = Arc::new(AtomicU64::new(1));
        let health_read = health.clone();
        source.health = Arc::new(move || {
            let value = health_read.load(Ordering::Acquire);
            (value & 1 == 1, value >> 1)
        });
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let start = started.clone();
        let gate = release.clone();
        let base = source.page.clone();
        let once = Arc::new(AtomicBool::new(true));
        source.page = Arc::new(move |org, kind, after, limit, max_bytes| {
            let future = base(org, kind, after, limit, max_bytes);
            let start = start.clone();
            let gate = gate.clone();
            let first = once.swap(false, Ordering::Relaxed);
            Box::pin(async move {
                let page = future.await?;
                if first {
                    start.notify_one();
                    gate.notified().await;
                }
                Ok(page)
            })
        });
        let catalog = Catalog::new(source, Limits::default());
        let build = catalog.clone();
        let join =
            tokio::spawn(async move { build.ensure("org", &[ResourceKind::Function]).await });
        started.notified().await;
        health.store(2, Ordering::Release);
        data.lock()[0].name = "Changed in gap".into();
        release.notify_one();
        join.await.unwrap().unwrap();
        assert!(matches!(
            catalog.state.read().entries[&Key::new("org", ResourceKind::Function)].status,
            EntryStatus::Invalid(SourceReason::SourceUnavailable)
        ));
        let before = reads.load(Ordering::Relaxed);
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        assert_eq!(reads.load(Ordering::Relaxed), before);
        health.store(5, Ordering::Release);
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        let result = query_work(catalog, "Changed", vec![ResourceKind::Function], 20)
            .execute()
            .unwrap();
        assert_eq!(result.hits[0].summary.name, "Changed in gap");
    }

    #[tokio::test]
    async fn catalog_hot_scan_stops_serving_after_unobserved_health_epoch_change() {
        let mut source = readers(
            Arc::new(Mutex::new(vec![row("f1", "Payment")])),
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicBool::new(false)),
        );
        let health = Arc::new(AtomicU64::new(1));
        let state = health.clone();
        source.health = Arc::new(move || {
            let value = state.load(Ordering::Acquire);
            (value & 1 == 1, value >> 1)
        });
        let catalog = Catalog::new(source, Limits::default());
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        health.store(5, Ordering::Release);
        let result = query_work(catalog, "Payment", vec![ResourceKind::Function], 20)
            .execute()
            .unwrap();
        assert!(result.hits.is_empty());
        assert_eq!(
            result.sources[0].reason,
            Some(SourceReason::SourceUnavailable)
        );
    }

    #[tokio::test]
    async fn scan_applies_permissions_before_top_k_and_cursor_generation_is_bound() {
        let rows = Arc::new(Mutex::new(vec![
            row("exact", "Payment"),
            row("prefix", "Payment logs"),
            row("substring", "Repayment"),
        ]));
        let catalog = Catalog::new(
            readers(
                rows.clone(),
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicBool::new(false)),
            ),
            Limits::default(),
        );
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        let mut work = query_work(catalog.clone(), "payment", vec![ResourceKind::Function], 1);
        work.access[0].predicate = Arc::new(|row| row.id != "exact");
        let first = work.execute().unwrap();
        assert_eq!(first.hits[0].summary.id, "prefix");
        assert_eq!(first.sources[0].has_more, Some(true));
        let scope = crate::resources::cursor::CursorScope {
            subject: "reviewer",
            org: "org",
            kind: ResourceKind::Function,
            query: "payment",
        };
        let value = first.sources[0].next_cursor.as_ref().unwrap();
        let mut next = query_work(catalog.clone(), "payment", vec![ResourceKind::Function], 1);
        next.cursor = Some(
            crate::resources::cursor::decode(value, &scope, config::utils::time::now_micros())
                .unwrap(),
        );
        next.access[0].predicate = Arc::new(|row| row.id != "exact");
        let second = next.execute().unwrap();
        assert_eq!(second.hits[0].summary.id, "substring");
        assert_eq!(second.sources[0].has_more, Some(false));
        rows.lock()[1].name = "Payment renamed".into();
        catalog.change(ResourceChange::Resource {
            org: "org".into(),
            kind: ResourceKind::Function,
            id: "prefix".into(),
        });
        catalog.wait_idle().await;
        let mut stale = query_work(catalog, "payment", vec![ResourceKind::Function], 1);
        stale.cursor = Some(
            crate::resources::cursor::decode(value, &scope, config::utils::time::now_micros())
                .unwrap(),
        );
        assert!(matches!(stale.execute(), Err(SearchError::SearchChanged)));
    }

    #[tokio::test]
    async fn scan_per_type_limits_empty_name_order_and_cap_partial_are_independent() {
        let mut alert = row("a1", "Alpha");
        alert.kind = ResourceKind::Alert;
        let rows = Arc::new(Mutex::new(vec![row("z", "Zulu"), row("a", "Alpha"), alert]));
        let catalog = Catalog::new(
            readers(
                rows,
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicBool::new(false)),
            ),
            Limits::default(),
        );
        let kinds = vec![ResourceKind::Function, ResourceKind::Alert];
        catalog.ensure("org", &kinds).await.unwrap();
        let mut work = query_work(catalog, "", kinds, 1);
        work.access[0].partial = true;
        let result = work.execute().unwrap();
        assert_eq!(result.hits.len(), 2);
        assert_eq!(result.hits[0].summary.id, "a");
        assert!(result.hits.iter().all(|hit| hit.match_tier.is_none()));
        assert_eq!(
            result.sources[0].status,
            config::meta::resources::SourceStatus::Partial
        );
        assert_eq!(result.sources[0].has_more, None);
        assert_eq!(
            result.sources[1].status,
            config::meta::resources::SourceStatus::Complete
        );
    }

    #[tokio::test]
    async fn scan_cancellation_never_claims_complete_no_match() {
        let catalog = Catalog::new(
            readers(
                Arc::new(Mutex::new(vec![row("a", "Alpha")])),
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicBool::new(false)),
            ),
            Limits::default(),
        );
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        let work = query_work(catalog, "missing", vec![ResourceKind::Function], 20);
        work.cancelled.cancel();
        let result = work.execute().unwrap();
        assert!(result.hits.is_empty());
        assert_eq!(result.sources[0].has_more, None);
        assert_eq!(
            result.sources[0].status,
            config::meta::resources::SourceStatus::Partial
        );
    }

    #[tokio::test]
    async fn catalog_budget_and_pending_build_limits_are_explicit() {
        let source = readers(
            Arc::new(Mutex::new(vec![row("a", "Alpha")])),
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicBool::new(false)),
        );
        let catalog = Catalog::new(
            source.clone(),
            Limits {
                max_bytes: 1,
                ..Limits::default()
            },
        );
        let exhausted = catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        assert_eq!(exhausted, vec![ResourceKind::Function]);
        let mut work = query_work(catalog, "a", vec![ResourceKind::Function], 20);
        work.exhausted = exhausted;
        assert_eq!(
            work.execute().unwrap().sources[0].reason,
            Some(SourceReason::ResourceExhausted)
        );
        let full = Catalog::new(
            source,
            Limits {
                max_pending: 0,
                ..Limits::default()
            },
        );
        assert!(matches!(
            full.ensure("org", &[ResourceKind::Function]).await,
            Err(SearchError::Overloaded)
        ));
    }

    #[tokio::test]
    async fn source_scratch_is_reserved_before_body_io_and_oversize_is_unavailable() {
        let reads = Arc::new(AtomicUsize::new(0));
        let mut source = readers(
            Arc::new(Mutex::new(vec![row("a", "Alpha")])),
            reads.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        source.page_cost = Arc::new(|_, _, _, _| Box::pin(async { Ok(512 * 1024 * 1024 + 1) }));
        let catalog = Catalog::new(source, Limits::default());
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        assert_eq!(reads.load(Ordering::Relaxed), 0);
        let result = query_work(catalog, "Alpha", vec![ResourceKind::Function], 20)
            .execute()
            .unwrap();
        assert_eq!(
            result.sources[0].reason,
            Some(SourceReason::ResourceExhausted)
        );
        assert!(result.hits.is_empty());
    }

    #[tokio::test]
    async fn concurrent_source_buffers_share_the_process_budget() {
        let reads = Arc::new(AtomicUsize::new(0));
        let mut source = readers(
            Arc::new(Mutex::new(vec![row("a", "Alpha")])),
            reads.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        source.page_cost = Arc::new(|_, _, _, _| Box::pin(async { Ok(65 * 1024 * 1024) }));
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let base = source.page.clone();
        let gate = release.clone();
        let start = started.clone();
        source.page = Arc::new(move |org, kind, after, limit, max_bytes| {
            let future = base(org, kind, after, limit, max_bytes);
            let start = start.clone();
            let gate = gate.clone();
            Box::pin(async move {
                start.notify_one();
                gate.notified().await;
                future.await
            })
        });
        let catalog = Catalog::new(
            source,
            Limits {
                max_bytes: 100 * 1024 * 1024,
                ..Limits::default()
            },
        );
        let owner = catalog.clone();
        let build = tokio::spawn(async move {
            owner
                .ensure("org", &[ResourceKind::Function, ResourceKind::Alert])
                .await
        });
        started.notified().await;
        assert!(catalog.budget.used.load(Ordering::Acquire) >= 65 * 1024 * 1024);
        assert!(catalog.budget.used.load(Ordering::Acquire) <= 100 * 1024 * 1024);
        release.notify_one();
        build.await.unwrap().unwrap();
        let state = catalog.state.read();
        assert_eq!(
            state
                .entries
                .values()
                .filter(|entry| matches!(
                    entry.status,
                    EntryStatus::Invalid(SourceReason::ResourceExhausted)
                ))
                .count(),
            1
        );
        assert_eq!(reads.load(Ordering::Relaxed), 1);
    }

    #[tokio::test]
    async fn folder_renames_use_folder_pages_without_per_resource_refresh() {
        let reads = Arc::new(AtomicUsize::new(0));
        let folder_reads = Arc::new(AtomicUsize::new(0));
        let mut dashboard = row("d1", "Payment");
        dashboard.kind = ResourceKind::Dashboard;
        dashboard.folder_id = Some("folder1".into());
        dashboard.folder_name = Some("Old".into());
        dashboard.route_ref = ResourceRoute::Dashboard {
            dashboard_id: "d1".into(),
            folder_id: "folder1".into(),
        };
        let mut source = readers(
            Arc::new(Mutex::new(vec![dashboard])),
            reads.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        let count = folder_reads.clone();
        source.folders = Arc::new(move |_, _, _, _| {
            let count = count.clone();
            Box::pin(async move {
                count.fetch_add(1, Ordering::Relaxed);
                Ok(FolderPage {
                    items: vec![(ResourceKind::Dashboard, "folder1".into(), "Renamed".into())],
                    next: None,
                })
            })
        });
        let catalog = Catalog::new(source, Limits::default());
        catalog
            .ensure("org", &[ResourceKind::Dashboard])
            .await
            .unwrap();
        catalog.change(ResourceChange::Folder { org: "org".into() });
        catalog.wait_idle().await;
        assert_eq!(reads.load(Ordering::Relaxed), 1);
        assert_eq!(folder_reads.load(Ordering::Relaxed), 1);
        let result = query_work(catalog, "Payment", vec![ResourceKind::Dashboard], 20)
            .execute()
            .unwrap();
        assert_eq!(
            result.hits[0].summary.folder_name.as_deref(),
            Some("Renamed")
        );
        assert_eq!(result.hits[0].summary.folder_id.as_deref(), Some("folder1"));
    }

    #[tokio::test]
    async fn source_batches_shrink_to_fit_without_omitting_rows() {
        let reads = Arc::new(AtomicUsize::new(0));
        let mut source = readers(
            Arc::new(Mutex::new(vec![
                row("a", "Alpha"),
                row("b", "Beta"),
                row("c", "Gamma"),
            ])),
            reads.clone(),
            Arc::new(AtomicBool::new(false)),
        );
        source.page_cost =
            Arc::new(|_, _, _, limit| Box::pin(async move { Ok(limit * 40 * 1024 * 1024) }));
        let catalog = Catalog::new(
            source,
            Limits {
                max_bytes: 100 * 1024 * 1024,
                ..Limits::default()
            },
        );
        catalog
            .ensure("org", &[ResourceKind::Function])
            .await
            .unwrap();
        let result = query_work(catalog, "", vec![ResourceKind::Function], 20)
            .execute()
            .unwrap();
        assert_eq!(
            result
                .hits
                .iter()
                .map(|hit| hit.summary.id.as_str())
                .collect::<Vec<_>>(),
            vec!["a", "b", "c"]
        );
        assert_eq!(reads.load(Ordering::Relaxed), 2);
        assert_eq!(
            result.sources[0].status,
            config::meta::resources::SourceStatus::Complete
        );
    }

    #[tokio::test]
    async fn folder_removal_invalidates_before_rebuilding_migrated_or_deleted_resources() {
        for migrated in [false, true] {
            let mut dashboard = row("d1", "Payment");
            dashboard.kind = ResourceKind::Dashboard;
            dashboard.folder_id = Some("old".into());
            dashboard.folder_name = Some("Old".into());
            dashboard.route_ref = ResourceRoute::Dashboard {
                dashboard_id: "d1".into(),
                folder_id: "old".into(),
            };
            let data = Arc::new(Mutex::new(vec![dashboard]));
            let mut source = readers(
                data.clone(),
                Arc::new(AtomicUsize::new(0)),
                Arc::new(AtomicBool::new(false)),
            );
            source.folders = Arc::new(|_, _, _, _| {
                Box::pin(async {
                    Ok(FolderPage {
                        items: vec![(ResourceKind::Dashboard, "new".into(), "New".into())],
                        next: None,
                    })
                })
            });
            let catalog = Catalog::new(source, Limits::default());
            catalog
                .ensure("org", &[ResourceKind::Dashboard])
                .await
                .unwrap();
            if migrated {
                let mut rows = data.lock();
                rows[0].folder_id = Some("new".into());
                rows[0].folder_name = Some("New".into());
                rows[0].route_ref = ResourceRoute::Dashboard {
                    dashboard_id: "d1".into(),
                    folder_id: "new".into(),
                };
            } else {
                data.lock().clear();
            }
            catalog.change(ResourceChange::Folder { org: "org".into() });
            catalog.wait_idle().await;
            let invalid = query_work(
                catalog.clone(),
                "Payment",
                vec![ResourceKind::Dashboard],
                20,
            )
            .execute()
            .unwrap();
            assert!(invalid.hits.is_empty());
            assert_eq!(
                invalid.sources[0].reason,
                Some(SourceReason::SourceUnavailable)
            );
            catalog
                .ensure("org", &[ResourceKind::Dashboard])
                .await
                .unwrap();
            let rebuilt = query_work(catalog, "Payment", vec![ResourceKind::Dashboard], 20)
                .execute()
                .unwrap();
            assert_eq!(
                rebuilt.sources[0].status,
                config::meta::resources::SourceStatus::Complete
            );
            if migrated {
                assert_eq!(rebuilt.hits[0].summary.folder_id.as_deref(), Some("new"));
                assert!(
                    matches!(&rebuilt.hits[0].summary.route_ref,ResourceRoute::Dashboard { folder_id,.. } if folder_id == "new")
                );
            } else {
                assert!(rebuilt.hits.is_empty());
            }
        }
    }
}
