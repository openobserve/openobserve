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
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};

use config::meta::resources::ResourceSummary;
use hashbrown::HashMap;

use super::matching::IndexedRecord;
pub(super) use super::matching::summary_heap;

pub(super) struct Budget {
    pub used: AtomicUsize,
    max: usize,
}

impl Budget {
    pub fn new(max: usize) -> Arc<Self> {
        Arc::new(Self {
            used: AtomicUsize::new(0),
            max,
        })
    }

    pub fn reserve(self: &Arc<Self>, bytes: usize) -> Result<Lease, Exhausted> {
        let mut used = self.used.load(Ordering::Acquire);
        loop {
            let next = used
                .checked_add(bytes)
                .filter(|next| *next <= self.max)
                .ok_or(Exhausted)?;
            match self
                .used
                .compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Acquire)
            {
                Ok(_) => break,
                Err(current) => used = current,
            }
        }
        Ok(Lease {
            budget: self.clone(),
            bytes,
        })
    }
}

#[derive(Debug)]
pub(super) struct Exhausted;

pub(super) struct Lease {
    pub budget: Arc<Budget>,
    pub bytes: usize,
}

impl Lease {
    pub fn empty(budget: Arc<Budget>) -> Self {
        Self { budget, bytes: 0 }
    }

    pub fn resize(&mut self, bytes: usize) -> Result<(), Exhausted> {
        if bytes > self.bytes {
            let extra = self.budget.reserve(bytes - self.bytes)?;
            self.absorb(extra);
        } else {
            self.shrink(bytes);
        }
        Ok(())
    }

    pub fn split(&mut self, bytes: usize) -> Self {
        self.bytes -= bytes;
        Self {
            budget: self.budget.clone(),
            bytes,
        }
    }

    pub fn absorb(&mut self, mut other: Self) {
        self.bytes += other.bytes;
        other.bytes = 0;
    }

    pub fn shrink(&mut self, bytes: usize) {
        self.budget
            .used
            .fetch_sub(self.bytes - bytes, Ordering::AcqRel);
        self.bytes = bytes;
    }
}

impl Drop for Lease {
    fn drop(&mut self) {
        self.budget.used.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}

pub(super) enum FolderUpdateError {
    MissingFolder,
    Exhausted,
}

pub(super) struct Records {
    pub rows: Vec<IndexedRecord>,
    slots: HashMap<String, usize>,
    heap_bytes: usize,
    lease: Lease,
}

impl Records {
    pub fn new(budget: Arc<Budget>) -> Self {
        Self {
            rows: Vec::new(),
            slots: HashMap::new(),
            heap_bytes: 0,
            lease: Lease { budget, bytes: 0 },
        }
    }

    pub fn upsert(&mut self, summary: ResourceSummary) -> Result<(), Exhausted> {
        let extra = self
            .lease
            .budget
            .reserve(self.growth_reservation(&summary))?;
        let row = IndexedRecord::new(summary);
        self.lease.absorb(extra);
        if let Some(&slot) = self.slots.get(&row.summary.id) {
            self.heap_bytes -= self.rows[slot].allocated_bytes();
            self.heap_bytes += row.allocated_bytes();
            self.rows[slot] = row;
        } else {
            if self.rows.try_reserve(1).is_err() || self.slots.try_reserve(1).is_err() {
                return Err(Exhausted);
            }
            let id = row.summary.id.clone();
            self.heap_bytes += id.capacity() + row.allocated_bytes();
            self.slots.insert(id, self.rows.len());
            self.rows.push(row);
        }
        let actual = self.allocated_bytes();
        if actual > self.lease.bytes {
            return Err(Exhausted);
        }
        self.lease.shrink(actual);
        Ok(())
    }

    pub fn remove(&mut self, id: &str) {
        let Some((key, slot)) = self.slots.remove_entry(id) else {
            return;
        };
        let removed = self.rows.swap_remove(slot);
        self.heap_bytes -= key.capacity() + removed.allocated_bytes();
        if let Some(moved) = self.rows.get(slot)
            && let Some(index) = self.slots.get_mut(&moved.summary.id)
        {
            *index = slot;
        }
        self.lease.shrink(self.allocated_bytes());
    }

    pub fn update_folders(
        &mut self,
        names: &HashMap<String, String>,
    ) -> Result<bool, FolderUpdateError> {
        if self.rows.iter().any(|row| {
            row.summary
                .folder_id
                .as_ref()
                .is_some_and(|id| !names.contains_key(id))
        }) {
            return Err(FolderUpdateError::MissingFolder);
        }
        let mut changed = false;
        for row in &mut self.rows {
            let Some(folder) = row.summary.folder_id.as_ref() else {
                continue;
            };
            let desired = names.get(folder);
            if row.summary.folder_name.as_ref() == desired {
                continue;
            }
            let size = desired.map_or(0, String::len);
            let extra = self
                .lease
                .budget
                .reserve(size.saturating_mul(2).saturating_add(32))
                .map_err(|_| FolderUpdateError::Exhausted)?;
            self.lease.absorb(extra);
            self.heap_bytes -= row.summary.folder_name.as_ref().map_or(0, String::capacity);
            row.summary.folder_name = desired.cloned();
            self.heap_bytes += row.summary.folder_name.as_ref().map_or(0, String::capacity);
            changed = true;
        }
        self.lease.shrink(self.allocated_bytes());
        Ok(changed)
    }

    fn growth_reservation(&self, summary: &ResourceSummary) -> usize {
        let mut extra = summary_heap(summary)
            .saturating_mul(32)
            .saturating_add(1024);
        if !self.slots.contains_key(&summary.id) {
            if self.rows.len() == self.rows.capacity() {
                extra = extra.saturating_add(
                    (self.rows.capacity() + 4)
                        .saturating_mul(size_of::<IndexedRecord>())
                        .saturating_mul(2),
                );
            }
            if self.slots.len() == self.slots.capacity() {
                extra =
                    extra.saturating_add((self.slots.allocation_size() + 1024).saturating_mul(4));
            }
        }
        extra
    }

    fn allocated_bytes(&self) -> usize {
        self.rows.capacity() * size_of::<IndexedRecord>()
            + self.slots.allocation_size()
            + self.heap_bytes
    }
}

#[cfg(test)]
mod tests {
    use config::meta::resources::{ResourceKind, ResourceRoute};

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

    #[test]
    fn records_replace_duplicate_stable_keys_and_keep_swap_delete_index_valid() {
        let budget = Budget::new(1_000_000);
        let mut records = Records::new(budget.clone());
        records.upsert(row("a", "Old")).unwrap();
        records.upsert(row("b", "Other")).unwrap();
        records.upsert(row("a", "Renamed")).unwrap();
        assert_eq!(records.rows.len(), 2);
        assert_eq!(records.rows[records.slots["a"]].summary.name, "Renamed");
        records.remove("a");
        assert_eq!(records.rows[records.slots["b"]].summary.name, "Other");
        assert_eq!(budget.used.load(Ordering::Relaxed), records.lease.bytes);
        drop(records);
        assert_eq!(budget.used.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn records_exhaustion_is_explicit_and_releases_build_allocations() {
        let budget = Budget::new(1000);
        let mut records = Records::new(budget.clone());
        assert!(records.upsert(row("a", &"long".repeat(2000))).is_err());
        drop(records);
        assert_eq!(budget.used.load(Ordering::Relaxed), 0);
    }
}
