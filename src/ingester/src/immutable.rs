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
use snafu::ResultExt;

use crate::{
    errors::{DeleteFileSnafu, RenameFileSnafu, Result, WriteDataSnafu},
    memtable::MemTable,
    rwmap::RwIndexMap,
    writer::WriterKey,
};

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
        let paths = self
            .memtable
            .persist(&self.key.org_id, &self.key.stream_type)
            .await?;
        println!("write par files done, you can try to crash it now, wait for 3 secs");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        // 2. create a lock file
        let done_path = wal_path.with_extension("lock");
        let lock_data = paths
            .iter()
            .map(|p| p.to_string_lossy())
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&done_path, lock_data.as_bytes()).context(WriteDataSnafu)?;
        println!("write lock file done, you can try to crash it now, wait for 3 secs");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        // 3. delete wal file
        std::fs::remove_file(wal_path).context(DeleteFileSnafu { path: wal_path })?;
        println!("remove wal file done, you can try to crash it now, wait for 3 secs");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        // 4. rename the tmp files to parquet files
        for path in paths {
            let parquet_path = path.with_extension("parquet");
            std::fs::rename(&path, &parquet_path).context(RenameFileSnafu { path: &path })?;
        }
        println!("rename par files done, you can try to crash it now, wait for 3 secs");
        tokio::time::sleep(std::time::Duration::from_secs(3)).await;
        // 5. delete the lock file
        std::fs::remove_file(&done_path).context(DeleteFileSnafu { path: &done_path })?;
        Ok(())
    }
}

pub(crate) async fn persist() -> Result<()> {
    let r = IMMUTABLES.read().await;
    let Some((path, immutable)) = r.first() else {
        return Ok(());
    };
    let path = path.clone();
    // persist entry to local disk
    immutable.persist(&path).await?;
    drop(r);

    println!("persisted entry: {:?}", path);
    // remove entry from IMMUTABLES
    IMMUTABLES.write().await.remove(&path);
    Ok(())
}
