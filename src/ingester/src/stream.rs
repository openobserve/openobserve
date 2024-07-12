// Copyright 2024 Zinc Labs Inc.
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

use std::{collections::BTreeMap, path::PathBuf, sync::Arc};

use arrow_schema::Schema;
use config::utils::schema_ext::SchemaExt;

use crate::{
    entry::{Entry, PersistStat, RecordBatchEntry},
    errors::*,
    partition::Partition,
    ReadRecordBatchEntry,
};

pub(crate) struct Stream {
    partitions: BTreeMap<Arc<str>, Partition>, // key: schema hash, val: partitions
}

impl Stream {
    pub(crate) fn new() -> Self {
        Self {
            partitions: BTreeMap::default(),
        }
    }

    pub(crate) fn write(
        &mut self,
        schema: Arc<Schema>,
        entry: Entry,
        batch: Arc<RecordBatchEntry>,
    ) -> Result<usize> {
        let mut arrow_size = 0;
        let partition = match self.partitions.get_mut(&entry.stream) {
            Some(v) => v,
            None => {
                arrow_size += schema.size();
                self.partitions
                    .entry(entry.schema_key.clone())
                    .or_insert_with(Partition::new)
            }
        };
        arrow_size += partition.write(entry, batch)?;
        Ok(arrow_size)
    }

    pub(crate) fn read(&self, time_range: Option<(i64, i64)>) -> Result<Vec<ReadRecordBatchEntry>> {
        let mut batches = Vec::with_capacity(self.partitions.len());
        for partition in self.partitions.values() {
            batches.push(partition.read(time_range)?);
        }
        Ok(batches)
    }

    pub(crate) async fn persist(
        &self,
        idx: usize,
        org_id: &str,
        stream_type: &str,
        stream_name: &str,
    ) -> Result<(usize, Vec<(PathBuf, PersistStat)>)> {
        let mut schema_size = 0;
        let mut paths = Vec::new();
        for (_, partition) in self.partitions.iter() {
            let (part_schema_size, partitions) = partition
                .persist(idx, org_id, stream_type, stream_name)
                .await?;
            schema_size += part_schema_size;
            paths.extend(partitions);
        }
        Ok((schema_size, paths))
    }
}
