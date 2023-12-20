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

use crate::{entry::Entry, errors::Result, rwmap::RwMap, stream::Stream};

pub(crate) struct MemTable {
    streams: RwMap<Arc<str>, Stream>, // key: schema name, val: stream
}

impl MemTable {
    pub(crate) fn new() -> Self {
        Self {
            streams: RwMap::default(),
        }
    }

    pub(crate) async fn write(&mut self, schema: Arc<Schema>, entry: Entry) -> Result<()> {
        let mut rw = self.streams.write().await;
        let partition = rw
            .entry(entry.stream.clone())
            .or_insert_with(|| Stream::new());
        partition.write(schema, entry).await
    }

    pub(crate) async fn read(
        &self,
        stream_name: &str,
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<(Arc<Schema>, Vec<RecordBatch>)>> {
        let r = self.streams.read().await;
        let Some(stream) = r.get(stream_name) else {
            return Ok(vec![]);
        };
        stream.read(time_range).await
    }

    pub(crate) async fn persist(&self, org_id: &str, stream_type: &str) -> Result<bool> {
        let r = self.streams.read().await;
        for (stream_name, stream) in r.iter() {
            stream.persist(org_id, stream_type, &stream_name).await?;
        }
        Ok(true)
    }
}
