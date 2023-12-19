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

use arrow::{json::ReaderBuilder, record_batch::RecordBatch};
use arrow_schema::Schema;
use snafu::ResultExt;

use crate::{entry::Entry, errors::*, rwmap::RwMap};

pub(crate)  struct Partition {
    schema: Arc<Schema>,
    files: RwMap<Arc<str>, PartitionFile>, // key: hour, val: files
}

impl Partition {
    pub(crate)  fn new(schema: Arc<Schema>) -> Self {
        Self {
            schema,
            files: RwMap::default(),
        }
    }

    pub(crate)  fn write(&mut self, entry: Entry) -> Result<()> {
        let mut rw = self.files.write();
        let partition = rw
            .entry(entry.partition_key.clone())
            .or_insert_with(|| PartitionFile::new());
        partition.write(self.schema.clone(), entry)?;
        Ok(())
    }

    pub(crate) fn read(&self, time_range: Option<(i64, i64)>) -> Result<(Arc<Schema>, Vec<RecordBatch>)> {
        let r = self.files.read();
        let mut batches = Vec::with_capacity(r.len());
        for file in r.values() {
            batches.extend(file.read(time_range)?);
        }
        Ok((self.schema.clone(), batches))
    }
}

struct PartitionFile {
    data: Vec<RecordBatch>,
}

impl PartitionFile {
    fn new() -> Self {
        Self { data: Vec::new() }
    }

    fn write(&mut self, schema: Arc<Schema>, entry: Entry) -> Result<()> {
        let mut decoder = ReaderBuilder::new(schema)
            .with_batch_size(8192)
            .build_decoder()
            .context(CreateArrowJsonEncoderSnafu)?;
        let _ = decoder.serialize(&entry.data);
        let batch = decoder.flush().context(ArrowJsonEncodeSnafu)?;
        if let Some(batch) = batch {
            println!(
                "columns: {}, rows: {}",
                batch.num_columns(),
                batch.num_rows()
            );
            self.data.push(batch);
        }
        Ok(())
    }

    fn read(&self, _time_range: Option<(i64, i64)>) -> Result<Vec<RecordBatch>> {
        Ok(self.data.clone())
    }
}
