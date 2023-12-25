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

use std::{
    io::{Cursor, Read},
    sync::Arc,
};

use arrow::{array::Int64Array, record_batch::RecordBatch};
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use config::CONFIG;
use snafu::ResultExt;

use crate::errors::*;

pub struct Entry {
    pub stream: Arc<str>,
    pub schema_key: Arc<str>,
    pub partition_key: Arc<str>, // 2023/12/18/00/country=US/state=CA
    pub data: Vec<Arc<serde_json::Value>>,
    pub data_size: usize,
}

impl Entry {
    pub fn into_bytes(&mut self) -> Result<Vec<u8>> {
        let mut buf = Vec::with_capacity(4096);
        let stream = self.stream.as_bytes();
        let schema_key = self.schema_key.as_bytes();
        let partition_key = self.partition_key.as_bytes();
        let data = serde_json::to_vec(&self.data).context(JSONSerializationSnafu)?;
        let data_size = data.len();
        self.data_size = data_size; // reset data size
        buf.write_u16::<BigEndian>(stream.len() as u16)
            .context(WriteDataSnafu)?;
        buf.extend_from_slice(stream);
        buf.write_u16::<BigEndian>(schema_key.len() as u16)
            .context(WriteDataSnafu)?;
        buf.extend_from_slice(schema_key);
        buf.write_u16::<BigEndian>(partition_key.len() as u16)
            .context(WriteDataSnafu)?;
        buf.extend_from_slice(partition_key);
        buf.write_u32::<BigEndian>(data_size as u32)
            .context(WriteDataSnafu)?;
        buf.extend_from_slice(&data);
        Ok(buf)
    }

    pub fn from_bytes(value: &[u8]) -> Result<Self> {
        let mut cursor = Cursor::new(value);
        let stream_len = cursor.read_u16::<BigEndian>().context(ReadDataSnafu)?;
        let mut stream = vec![0; stream_len as usize];
        cursor.read_exact(&mut stream).context(ReadDataSnafu)?;
        let stream = String::from_utf8(stream).context(FromUtf8Snafu)?;
        let schema_key_len = cursor.read_u16::<BigEndian>().context(ReadDataSnafu)?;
        let mut schema_key = vec![0; schema_key_len as usize];
        cursor.read_exact(&mut schema_key).context(ReadDataSnafu)?;
        let schema_key = String::from_utf8(schema_key).context(FromUtf8Snafu)?;
        let partition_key_len = cursor.read_u16::<BigEndian>().context(ReadDataSnafu)?;
        let mut partition_key = vec![0; partition_key_len as usize];
        cursor
            .read_exact(&mut partition_key)
            .context(ReadDataSnafu)?;
        let partition_key = String::from_utf8(partition_key).context(FromUtf8Snafu)?;
        let data_len = cursor.read_u32::<BigEndian>().context(ReadDataSnafu)?;
        let mut data = vec![0; data_len as usize];
        cursor.read_exact(&mut data).context(ReadDataSnafu)?;
        let data = serde_json::from_slice(&data).context(JSONSerializationSnafu)?;
        Ok(Self {
            stream: stream.into(),
            schema_key: schema_key.into(),
            partition_key: partition_key.into(),
            data,
            data_size: data_len as usize,
        })
    }
}

pub struct RecordBatchEntry {
    pub data: RecordBatch,
    pub data_size: usize,
    pub min_ts: i64,
    pub max_ts: i64,
}

impl RecordBatchEntry {
    pub fn new(data: RecordBatch, data_size: usize) -> Arc<RecordBatchEntry> {
        let (min_ts, max_ts) = match data.column_by_name(&CONFIG.common.column_timestamp) {
            None => (0, 0),
            Some(v) => {
                let v = v.as_any().downcast_ref::<Int64Array>().unwrap();
                let mut min_v = v.value(0);
                let mut max_v = v.value(0);
                for v in v.values() {
                    if &min_v > v {
                        min_v = *v;
                    }
                    if &max_v < v {
                        max_v = *v;
                    }
                }
                (min_v, max_v)
            }
        };
        Arc::new(Self {
            data,
            data_size,
            min_ts,
            max_ts,
        })
    }
}
