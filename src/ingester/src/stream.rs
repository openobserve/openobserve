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
    collections::{BTreeMap, btree_map},
    path::PathBuf,
    sync::Arc,
};

use arrow_schema::Schema;
use config::{stats::MemorySize, utils::schema_ext::SchemaExt};

use crate::{
    ReadRecordBatchEntry,
    entry::{Entry, PersistStat, RecordBatchEntry},
    errors::*,
    pack::PackWriter,
    partition::Partition,
};

pub(crate) struct Stream {
    partitions: BTreeMap<Arc<str>, Partition>, // key: schema hash, val: partitions
    min_ts: i64,                               // 0 until a batch with a timestamp is written
    max_ts: i64,
}

impl Stream {
    pub(crate) fn new() -> Self {
        Self {
            partitions: BTreeMap::default(),
            min_ts: 0,
            max_ts: 0,
        }
    }

    /// Time range of all written batches, `None` when nothing with a timestamp was written.
    pub(crate) fn time_range(&self) -> Option<(i64, i64)> {
        (self.min_ts > 0).then_some((self.min_ts, self.max_ts))
    }

    pub(crate) fn write(
        &mut self,
        schema: Arc<Schema>,
        entry: Entry,
        batch: Arc<RecordBatchEntry>,
    ) -> Result<usize> {
        let mut arrow_size = 0;
        let partition = match self.partitions.entry(entry.schema_key.clone()) {
            btree_map::Entry::Occupied(v) => v.into_mut(),
            btree_map::Entry::Vacant(v) => {
                arrow_size += schema.size();
                v.insert(Partition::new())
            }
        };
        let (min_ts, max_ts) = (batch.min_ts, batch.max_ts);
        arrow_size += partition.write(entry, batch)?;
        // pop_time_range reports (0, 0) for a batch without timestamps
        if min_ts > 0 && (self.min_ts == 0 || min_ts < self.min_ts) {
            self.min_ts = min_ts;
        }
        self.max_ts = self.max_ts.max(max_ts);
        Ok(arrow_size)
    }

    pub(crate) fn read(
        &self,
        time_range: Option<(i64, i64)>,
        partition_filters: &[(String, Vec<String>)],
    ) -> Result<Vec<ReadRecordBatchEntry>> {
        let mut batches = Vec::with_capacity(self.partitions.len());
        for partition in self.partitions.values() {
            batches.push(partition.read(time_range, partition_filters)?);
        }
        Ok(batches)
    }

    pub(crate) async fn persist(
        &self,
        id: u64,
        idx: usize,
        org_id: &str,
        stream_type: &str,
        stream_name: &str,
        mut pack: Option<&mut PackWriter>,
    ) -> Result<(usize, Vec<(PathBuf, PersistStat)>)> {
        let mut schema_size = 0;
        let mut paths = Vec::new();
        for partition in self.partitions.values() {
            let (part_schema_size, partitions) = partition
                .persist(
                    id,
                    idx,
                    org_id,
                    stream_type,
                    stream_name,
                    pack.as_deref_mut(),
                )
                .await?;
            schema_size += part_schema_size;
            paths.extend(partitions);
        }
        Ok((schema_size, paths))
    }
}

impl MemorySize for Stream {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<Stream>() + self.partitions.mem_size()
    }
}

#[cfg(test)]
mod tests {
    use arrow::{array::Int64Array, record_batch::RecordBatch};
    use arrow_schema::{DataType, Field};
    use config::utils::record_batch_ext::RecordBatchExt;

    use super::*;

    fn write_entry(s: &mut Stream, schema: &Arc<Schema>, schema_key: &str) -> usize {
        write_ts(s, schema, schema_key, vec![1, 2, 3])
    }

    fn write_ts(s: &mut Stream, schema: &Arc<Schema>, schema_key: &str, ts: Vec<i64>) -> usize {
        let batch =
            RecordBatch::try_new(schema.clone(), vec![Arc::new(Int64Array::from(ts))]).unwrap();
        let arrow_size = batch.size();
        let batch = RecordBatchEntry::new("logs".into(), batch, 10, arrow_size);
        let entry = Entry {
            stream: "default".into(),
            schema_key: schema_key.into(),
            partition_key: "2026/10/15/00".into(),
            ..Entry::new()
        };
        s.write(schema.clone(), entry, batch).unwrap() - arrow_size
    }

    #[test]
    fn test_stream_new_has_empty_partitions() {
        let s = Stream::new();
        assert!(s.partitions.is_empty());
    }

    #[test]
    fn test_stream_mem_size_empty() {
        let s = Stream::new();
        assert!(s.mem_size() >= std::mem::size_of::<Stream>());
    }

    #[test]
    fn test_stream_write_counts_schema_size_once_per_partition() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "_timestamp",
            DataType::Int64,
            false,
        )]));
        let mut s = Stream::new();
        assert_eq!(write_entry(&mut s, &schema, "hash_a"), schema.size());
        assert_eq!(write_entry(&mut s, &schema, "hash_a"), 0);
        assert_eq!(write_entry(&mut s, &schema, "hash_b"), schema.size());
        assert_eq!(s.partitions.len(), 2);
    }

    #[test]
    fn test_stream_time_range_tracks_out_of_order_batches() {
        let schema = Arc::new(Schema::new(vec![Field::new(
            "_timestamp",
            DataType::Int64,
            false,
        )]));
        let mut s = Stream::new();
        assert_eq!(s.time_range(), None);
        write_ts(&mut s, &schema, "hash_a", vec![500, 600]);
        assert_eq!(s.time_range(), Some((500, 600)));
        write_ts(&mut s, &schema, "hash_b", vec![900, 100]);
        assert_eq!(s.time_range(), Some((100, 900)));
        write_ts(&mut s, &schema, "hash_a", vec![300, 700]);
        assert_eq!(s.time_range(), Some((100, 900)));
    }
}
