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

use arrow::record_batch::RecordBatch;
use arrow_schema::Schema;

use crate::{entry::Entry, errors::*, partition::Partition, rwmap::RwMap};

pub(crate) struct Stream {
    partitions: RwMap<Arc<str>, Partition>, // key: schema version hash, val: partitions
}

impl Stream {
    pub(crate) fn new() -> Self {
        Self {
            partitions: RwMap::default(),
        }
    }

    pub(crate) fn write(&mut self, schema: Arc<Schema>, entry: Entry) -> Result<()> {
        let mut rw = self.partitions.write();
        let partition = rw
            .entry(entry.schema_key.clone())
            .or_insert_with(|| Partition::new(schema));
        partition.write(entry)?;
        Ok(())
    }

    pub(crate) fn read(
        &self,
        time_range:Option<(i64, i64)>,
    ) -> Result<Vec<(Arc<Schema>, Vec<RecordBatch>)>> {
        let r = self.partitions.read();
        let mut batches = Vec::with_capacity(r.len());
        for partition in r.values() {
            batches.push(partition.read(time_range)?);
        }
        Ok(batches)
    }
}
