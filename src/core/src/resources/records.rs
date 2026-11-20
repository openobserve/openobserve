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

use std::mem::size_of;

use config::meta::resources::ResourceSummary;
use hashbrown::HashMap;

use super::matching::IndexedRecord;

#[derive(Debug)]
pub(super) struct MissingFolder;

#[derive(Default)]
pub(super) struct Records {
    pub rows: Vec<IndexedRecord>,
    slots: HashMap<String, usize>,
    heap_bytes: usize,
}

impl Records {
    pub fn upsert(&mut self, summary: ResourceSummary) {
        let row = IndexedRecord::new(summary);
        if let Some(&slot) = self.slots.get(&row.summary.id) {
            self.heap_bytes -= self.rows[slot].allocated_bytes();
            self.heap_bytes += row.allocated_bytes();
            self.rows[slot] = row;
            return;
        }
        let id = row.summary.id.clone();
        self.heap_bytes += id.capacity() + row.allocated_bytes();
        self.slots.insert(id, self.rows.len());
        self.rows.push(row);
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
    }

    pub fn update_folders(
        &mut self,
        names: &HashMap<String, String>,
    ) -> Result<bool, MissingFolder> {
        if self.rows.iter().any(|row| {
            row.summary
                .folder_id
                .as_ref()
                .is_some_and(|id| !names.contains_key(id))
        }) {
            return Err(MissingFolder);
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
            self.heap_bytes -= row.summary.folder_name.as_ref().map_or(0, String::capacity);
            row.summary.folder_name = desired.cloned();
            self.heap_bytes += row.summary.folder_name.as_ref().map_or(0, String::capacity);
            changed = true;
        }
        Ok(changed)
    }

    pub fn allocated_bytes(&self) -> usize {
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
        let mut records = Records::default();
        records.upsert(row("a", "Old"));
        records.upsert(row("b", "Other"));
        records.upsert(row("a", "Renamed"));
        assert_eq!(records.rows.len(), 2);
        assert_eq!(records.rows[records.slots["a"]].summary.name, "Renamed");
        records.remove("a");
        assert_eq!(records.rows[records.slots["b"]].summary.name, "Other");
        let heap = records.rows[0].allocated_bytes() + "b".len();
        assert_eq!(records.heap_bytes, heap);
    }
}
