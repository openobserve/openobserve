// Copyright 2023 Zinc Labs Inc.
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

use std::sync::Arc;

use super::{entry::IngestEntry, task_queue::RwMap};

/// Two options for persisting pending ingestion tasks
/// 1. Each spawned up worker has its own WAL file
/// 2. All workers asscoaited with each stream_name share one WAL file
/// - Each WAL file
///
/// TBD
///
/// After implementing store, needs 2 more functions during init
/// scane and replay previous uncompleted requests saved in the WAL files

pub struct QueueStore {
    reqs: RwMap<Arc<str>, IngestEntry>,
}

impl QueueStore {
    pub fn new() -> Self {
        Self {
            reqs: RwMap::default(),
        }
    }

    pub async fn add_task(
        &mut self,
        key: Arc<str>,
        entry: IngestEntry,
    ) -> Result<(), anyhow::Error> {
        let mut rw = self.reqs.write().await;
        rw.insert(key, entry);
        Ok(())
    }

    pub async fn remove_task(&mut self, key: Arc<str>) -> Result<(), anyhow::Error> {
        let mut rw = self.reqs.write().await;
        rw.remove(&key);
        Ok(())
    }

    pub async fn persist(&self) -> Result<(), anyhow::Error> {
        Ok(())
    }
}
