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

use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use arrow_schema::Schema;
use config::metrics;
use hashbrown::HashMap;

use crate::{
    entry::{Entry, PersistStat},
    errors::Result,
    stream::Stream,
    ReadRecordBatchEntry,
};

pub(crate) struct MemTable {
    streams: HashMap<Arc<str>, Stream>, // key: schema name, val: stream
    json_bytes_written: AtomicU64,
    arrow_bytes_written: AtomicU64,
}

impl MemTable {
    pub(crate) fn new() -> Self {
        metrics::INGEST_MEMTABLE_FILES.with_label_values(&[]).inc();
        Self {
            streams: HashMap::default(),
            json_bytes_written: AtomicU64::new(0),
            arrow_bytes_written: AtomicU64::new(0),
        }
    }

    pub(crate) fn write(&mut self, schema: Arc<Schema>, entry: Entry) -> Result<()> {
        let partitions = match self.streams.get_mut(&entry.stream) {
            Some(v) => v,
            None => self
                .streams
                .entry(entry.stream.clone())
                .or_insert_with(Stream::new),
        };
        let json_size = entry.data_size;
        let arrow_size = partitions.write(schema, entry)?;
        self.json_bytes_written
            .fetch_add(json_size as u64, Ordering::SeqCst);
        self.arrow_bytes_written
            .fetch_add(arrow_size as u64, Ordering::SeqCst);
        Ok(())
    }

    pub(crate) fn read(
        &self,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<ReadRecordBatchEntry>> {
        let Some(stream) = self.streams.get(stream_name) else {
            return Ok(vec![]);
        };
        stream.read(time_range)
    }

    pub(crate) async fn persist(
        &self,
        thread_id: usize,
        org_id: &str,
        stream_type: &str,
    ) -> Result<(usize, Vec<(PathBuf, PersistStat)>)> {
        let mut schema_size = 0;
        let mut paths = Vec::with_capacity(self.streams.len());
        for (stream_name, stream) in self.streams.iter() {
            let (part_schema_size, partitions) = stream
                .persist(thread_id, org_id, stream_type, stream_name)
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
