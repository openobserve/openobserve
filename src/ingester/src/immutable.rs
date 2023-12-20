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

use std::{path::PathBuf, sync::Arc};

use arrow::record_batch::RecordBatch;
use arrow_schema::Schema;
use once_cell::sync::Lazy;

use crate::{errors::Result, memtable::MemTable, rwmap::RwIndexMap, writer::WriterKey};

pub(crate) static IMMUTABLES: Lazy<RwIndexMap<PathBuf, Immutable>> = Lazy::new(RwIndexMap::default);

#[warn(dead_code)]
pub(crate) struct Immutable {
    key: WriterKey,
    memtable: MemTable,
}

pub async fn read_from_immutable(
    org_id: &str,
    stream_type: &str,
    stream_name: &str,
    time_range: Option<(i64, i64)>,
) -> Result<Vec<(Arc<Schema>, Vec<RecordBatch>)>> {
    let r = IMMUTABLES.read().await;
    let mut batches = Vec::with_capacity(r.len());
    for (_, i) in r.iter() {
        if org_id == i.key.org_id.as_ref() && stream_type == i.key.stream_type.as_ref() {
            batches.extend(i.memtable.read(stream_name, time_range).await?);
        }
    }
    Ok(batches)
}

impl Immutable {
    pub(crate) fn new(key: WriterKey, memtable: MemTable) -> Self {
        Self { key, memtable }
    }

    pub(crate) async fn persist(&self, wal_path: &PathBuf) -> Result<()> {
        println!("persisting entry: {:?}, wal: {:?}", self.key, wal_path);
        // 1. dump memtable to disk
        self.memtable
            .persist(&self.key.org_id, &self.key.stream_type)
            .await?;
        // 2. create a done file
        // 2. delete wal file
        // 3. remove entry from IMMUTABLES
        Ok(())
    }
}

pub(crate) async fn persist() -> Result<()> {
    let r = IMMUTABLES.read().await;
    let Some((path, immutable)) = r.first() else {
        return Ok(());
    };
    let path = path.clone();
    immutable.persist(&path).await?;
    drop(r);

    println!("persisted entry: {:?}", path);
    IMMUTABLES.write().await.remove(&path);
    Ok(())
}
