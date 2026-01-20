// Copyright 2025 OpenObserve Inc.
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
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
};

use arrow_schema::Schema;
use config::{metrics, utils::time::now_micros};
use hashbrown::HashMap;
use once_cell::sync::Lazy;

use crate::{
    ReadRecordBatchEntry,
    entry::{Entry, PersistStat, RecordBatchEntry},
    errors::Result,
    stream::Stream,
};

// a global counter for memtable id start by timestamp micros
static MEMTABLE_ID_COUNTER: Lazy<AtomicU64> = Lazy::new(|| AtomicU64::new(now_micros() as u64));

pub(crate) struct MemTable {
    id: u64,
    streams: HashMap<Arc<str>, Stream>, // key: orgId/schemaName, val: stream
    json_bytes_written: AtomicU64,
    arrow_bytes_written: AtomicU64,
}

impl MemTable {
    pub(crate) fn new() -> Self {
        metrics::INGEST_MEMTABLE_FILES
            .with_label_values::<&str>(&[])
            .inc();
        Self {
            id: MEMTABLE_ID_COUNTER.fetch_add(1, Ordering::SeqCst),
            streams: HashMap::default(),
            json_bytes_written: AtomicU64::new(0),
            arrow_bytes_written: AtomicU64::new(0),
        }
    }

    pub(crate) fn id(&self) -> u64 {
        self.id
    }

    pub(crate) fn write(
        &mut self,
        schema: Arc<Schema>,
        entry: Entry,
        batch: Arc<RecordBatchEntry>,
    ) -> Result<()> {
        let key = Arc::from(format!("{}/{}", entry.org_id, entry.stream));
        let partitions = match self.streams.get_mut(&key) {
            Some(v) => v,
            None => self.streams.entry(key.clone()).or_insert_with(Stream::new),
        };
        let json_size = entry.data_size;
        let arrow_size = partitions.write(schema, entry, batch)?;
        self.json_bytes_written
            .fetch_add(json_size as u64, Ordering::SeqCst);
        self.arrow_bytes_written
            .fetch_add(arrow_size as u64, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn read(
        &self,
        org_id: &str,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
        partition_filters: &[(String, Vec<String>)],
    ) -> Result<(u64, Vec<ReadRecordBatchEntry>)> {
        let key = Arc::from(format!("{org_id}/{stream_name}"));
        let Some(stream) = self.streams.get(&key) else {
            return Ok((self.id, vec![]));
        };
        let batches = stream.read(time_range, partition_filters)?;
        Ok((self.id, batches))
    }

    pub(crate) async fn persist(
        &self,
        idx: usize,
        org_id: &str,
        stream_type: &str,
    ) -> Result<(usize, Vec<(PathBuf, PersistStat)>)> {
        let mut schema_size = 0;
        let mut paths = Vec::with_capacity(self.streams.len());
        for (stream_name, stream) in self.streams.iter() {
            let key_parts: Vec<&str> = stream_name.splitn(2, '/').collect();
            let (org_id, stream_name) = if key_parts.len() == 2 {
                (key_parts[0], key_parts[1])
            } else {
                (org_id, stream_name.as_ref())
            };
            let (part_schema_size, partitions) = stream
                .persist(idx, org_id, stream_type, stream_name)
                .await?;
            schema_size += part_schema_size;
            paths.extend(partitions);
        }
        Ok((schema_size, paths))
    }

    // Return the number of bytes written (json format size, arrow format size)
    pub(crate) fn size(&self) -> (usize, usize) {
        (
            self.json_bytes_written.load(Ordering::SeqCst) as usize,
            self.arrow_bytes_written.load(Ordering::SeqCst) as usize,
        )
    }
}
