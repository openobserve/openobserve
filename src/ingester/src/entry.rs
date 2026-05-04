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
    io::{Cursor, Read},
    sync::Arc,
};

use arrow::{array::Int64Array, record_batch::RecordBatch};
use arrow_schema::Schema;
use byteorder::{BigEndian, ReadBytesExt, WriteBytesExt};
use config::{
    stats::MemorySize,
    utils::record_batch_ext::{RecordBatchExt, convert_json_to_record_batch},
};
use serde::{Deserialize, Serialize};
use snafu::ResultExt;

use crate::errors::*;
#[derive(Clone, Serialize, Deserialize)]
pub struct Entry {
    pub org_id: Arc<str>,
    pub stream: Arc<str>,
    pub schema: Option<Arc<Schema>>,
    pub schema_key: Arc<str>,
    pub partition_key: Arc<str>, // 2023/12/18/00/country=US/state=CA
    pub data: Vec<Arc<serde_json::Value>>,
    pub data_size: usize,
}

impl Entry {
    pub fn new() -> Self {
        Self {
            org_id: "".into(),
            stream: "".into(),
            schema: None,
            schema_key: "".into(),
            partition_key: "".into(),
            data: Vec::new(),
            data_size: 0,
        }
    }
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

        // add org_id, we need to write to the end for backward compatibility
        buf.write_u16::<BigEndian>(self.org_id.len() as u16)
            .context(WriteDataSnafu)?;
        buf.extend_from_slice(self.org_id.as_bytes());

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

        // read org_id if available
        let org_id = if (cursor.position() as usize) < value.len() {
            let org_id_len = cursor.read_u16::<BigEndian>().context(ReadDataSnafu)?;
            let mut org_id_buf = vec![0; org_id_len as usize];
            cursor.read_exact(&mut org_id_buf).context(ReadDataSnafu)?;
            String::from_utf8(org_id_buf).context(FromUtf8Snafu)?
        } else {
            "".to_string()
        };

        Ok(Self {
            org_id: org_id.into(),
            stream: stream.into(),
            schema: None,
            schema_key: schema_key.into(),
            partition_key: partition_key.into(),
            data,
            data_size: data_len as usize,
        })
    }

    pub fn into_batch(
        &self,
        stream_type: Arc<str>,
        schema: Arc<Schema>,
    ) -> Result<Arc<RecordBatchEntry>> {
        let batch =
            convert_json_to_record_batch(&schema, &self.data).context(ArrowJsonEncodeSnafu)?;

        let arrow_size = batch.size();
        Ok(RecordBatchEntry::new(
            stream_type,
            batch,
            self.data_size,
            arrow_size,
        ))
    }
}

impl Default for Entry {
    fn default() -> Self {
        Self::new()
    }
}

pub struct RecordBatchEntry {
    pub data: RecordBatch,
    pub data_json_size: usize,
    pub data_arrow_size: usize,
    pub min_ts: i64,
    pub max_ts: i64,
}

impl RecordBatchEntry {
    pub fn new(
        stream_type: Arc<str>,
        data: RecordBatch,
        data_json_size: usize,
        data_arrow_size: usize,
    ) -> Arc<RecordBatchEntry> {
        let (min_ts, max_ts) = if stream_type == Arc::from("index") {
            pop_time_range(&data, Some("min_ts"), Some("max_ts"))
        } else {
            pop_time_range(&data, None, None)
        };
        Arc::new(Self {
            data,
            data_json_size,
            data_arrow_size,
            min_ts,
            max_ts,
        })
    }
}

impl MemorySize for RecordBatchEntry {
    fn mem_size(&self) -> usize {
        std::mem::size_of::<RecordBatchEntry>() + self.data.size()
    }
}

fn pop_time_range(
    batch: &RecordBatch,
    min_field: Option<&str>,
    max_field: Option<&str>,
) -> (i64, i64) {
    let mut min_ts = 0;
    let mut max_ts = 0;
    let time_field = config::TIMESTAMP_COL_NAME.to_string();
    let min_field = min_field.unwrap_or(time_field.as_str());
    let max_field = max_field.unwrap_or(time_field.as_str());
    if min_field == max_field {
        let Some(col) = batch.column_by_name(min_field) else {
            return (0, 0);
        };
        let Some(col) = col.as_any().downcast_ref::<Int64Array>() else {
            return (0, 0);
        };
        for v in col.values() {
            if min_ts == 0 || min_ts > *v {
                min_ts = *v;
            }
            if max_ts < *v {
                max_ts = *v;
            }
        }
        return (min_ts, max_ts);
    }

    // min_ts
    let Some(col) = batch.column_by_name(min_field) else {
        return (0, 0);
    };
    let Some(col) = col.as_any().downcast_ref::<Int64Array>() else {
        return (0, 0);
    };
    for v in col.values() {
        if min_ts == 0 || min_ts > *v {
            min_ts = *v;
        }
    }

    // max_ts
    let Some(col) = batch.column_by_name(max_field) else {
        return (0, 0);
    };
    let Some(col) = col.as_any().downcast_ref::<Int64Array>() else {
        return (0, 0);
    };
    for v in col.values() {
        if max_ts < *v {
            max_ts = *v;
        }
    }

    (min_ts, max_ts)
}

#[derive(Default)]
pub struct PersistStat {
    pub json_size: i64,
    pub arrow_size: usize,
    pub file_num: usize,
    pub batch_num: usize,
    pub records: usize,
}

impl std::ops::Add for PersistStat {
    type Output = PersistStat;

    fn add(self, other: PersistStat) -> PersistStat {
        PersistStat {
            json_size: self.json_size + other.json_size,
            arrow_size: self.arrow_size + other.arrow_size,
            file_num: self.file_num + other.file_num,
            batch_num: self.batch_num + other.batch_num,
            records: self.records + other.records,
        }
    }
}

impl std::ops::AddAssign for PersistStat {
    fn add_assign(&mut self, other: PersistStat) {
        self.json_size += other.json_size;
        self.arrow_size += other.arrow_size;
        self.file_num += other.file_num;
        self.batch_num += other.batch_num;
        self.records += other.records;
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use super::*;

    fn make_entry(org: &str, stream: &str, schema_key: &str, partition_key: &str) -> Entry {
        Entry {
            org_id: Arc::from(org),
            stream: Arc::from(stream),
            schema: None,
            schema_key: Arc::from(schema_key),
            partition_key: Arc::from(partition_key),
            data: vec![Arc::new(serde_json::json!({"key": "value"}))],
            data_size: 0,
        }
    }

    #[test]
    fn test_entry_roundtrip_with_org_id() {
        let mut entry = make_entry("myorg", "mystream", "schema_v1", "2024/01/01/00");
        let bytes = entry.into_bytes().expect("serialize");
        let decoded = Entry::from_bytes(&bytes).expect("deserialize");
        assert_eq!(decoded.org_id.as_ref(), "myorg");
        assert_eq!(decoded.stream.as_ref(), "mystream");
        assert_eq!(decoded.schema_key.as_ref(), "schema_v1");
        assert_eq!(decoded.partition_key.as_ref(), "2024/01/01/00");
        assert_eq!(decoded.data.len(), 1);
    }

    #[test]
    fn test_entry_roundtrip_empty_data() {
        let mut entry = Entry {
            org_id: Arc::from("org"),
            stream: Arc::from("stream"),
            schema: None,
            schema_key: Arc::from("key"),
            partition_key: Arc::from("part"),
            data: vec![],
            data_size: 0,
        };
        let bytes = entry.into_bytes().expect("serialize");
        let decoded = Entry::from_bytes(&bytes).expect("deserialize");
        assert_eq!(decoded.data.len(), 0);
    }

    #[test]
    fn test_entry_into_bytes_updates_data_size() {
        let mut entry = make_entry("org", "stream", "key", "part");
        assert_eq!(entry.data_size, 0);
        entry.into_bytes().expect("serialize");
        assert!(entry.data_size > 0);
    }

    #[test]
    fn test_persist_stat_add() {
        let a = PersistStat {
            json_size: 100,
            arrow_size: 200,
            file_num: 1,
            batch_num: 2,
            records: 10,
        };
        let b = PersistStat {
            json_size: 50,
            arrow_size: 100,
            file_num: 1,
            batch_num: 3,
            records: 5,
        };
        let c = a + b;
        assert_eq!(c.json_size, 150);
        assert_eq!(c.arrow_size, 300);
        assert_eq!(c.file_num, 2);
        assert_eq!(c.batch_num, 5);
        assert_eq!(c.records, 15);
    }

    #[test]
    fn test_persist_stat_add_assign() {
        let mut a = PersistStat {
            json_size: 10,
            arrow_size: 20,
            file_num: 1,
            batch_num: 1,
            records: 5,
        };
        let b = PersistStat {
            json_size: 5,
            arrow_size: 10,
            file_num: 2,
            batch_num: 0,
            records: 3,
        };
        a += b;
        assert_eq!(a.json_size, 15);
        assert_eq!(a.arrow_size, 30);
        assert_eq!(a.file_num, 3);
        assert_eq!(a.batch_num, 1);
        assert_eq!(a.records, 8);
    }

    #[test]
    fn test_persist_stat_default_is_zeroed() {
        let s = PersistStat::default();
        assert_eq!(s.json_size, 0);
        assert_eq!(s.arrow_size, 0);
        assert_eq!(s.file_num, 0);
        assert_eq!(s.batch_num, 0);
        assert_eq!(s.records, 0);
    }

    fn make_ts_batch(values: Vec<i64>) -> RecordBatch {
        use arrow::array::Int64Array;
        use arrow_schema::{DataType, Field};
        let schema = Arc::new(arrow_schema::Schema::new(vec![Field::new(
            config::TIMESTAMP_COL_NAME,
            DataType::Int64,
            false,
        )]));
        let col = Arc::new(Int64Array::from(values));
        RecordBatch::try_new(schema, vec![col]).unwrap()
    }

    #[test]
    fn test_pop_time_range_basic() {
        let batch = make_ts_batch(vec![100i64, 50i64, 200i64]);
        let (min_ts, max_ts) = pop_time_range(&batch, None, None);
        assert_eq!(min_ts, 50);
        assert_eq!(max_ts, 200);
    }

    #[test]
    fn test_pop_time_range_single_value() {
        let batch = make_ts_batch(vec![42i64]);
        let (min_ts, max_ts) = pop_time_range(&batch, None, None);
        assert_eq!(min_ts, 42);
        assert_eq!(max_ts, 42);
    }

    #[test]
    fn test_pop_time_range_column_not_found() {
        use arrow::array::Int64Array;
        use arrow_schema::{DataType, Field};
        let schema = Arc::new(arrow_schema::Schema::new(vec![Field::new(
            "other_col",
            DataType::Int64,
            false,
        )]));
        let col = Arc::new(Int64Array::from(vec![100i64]));
        let batch = RecordBatch::try_new(schema, vec![col]).unwrap();
        let (min_ts, max_ts) = pop_time_range(&batch, None, None);
        assert_eq!(min_ts, 0);
        assert_eq!(max_ts, 0);
    }

    #[test]
    fn test_pop_time_range_wrong_column_type() {
        use arrow::array::StringArray;
        use arrow_schema::{DataType, Field};
        let schema = Arc::new(arrow_schema::Schema::new(vec![Field::new(
            config::TIMESTAMP_COL_NAME,
            DataType::Utf8,
            false,
        )]));
        let col = Arc::new(StringArray::from(vec!["abc"]));
        let batch = RecordBatch::try_new(schema, vec![col]).unwrap();
        let (min_ts, max_ts) = pop_time_range(&batch, None, None);
        assert_eq!(min_ts, 0);
        assert_eq!(max_ts, 0);
    }

    #[test]
    fn test_pop_time_range_separate_min_max_columns() {
        use arrow::array::Int64Array;
        use arrow_schema::{DataType, Field};
        let schema = Arc::new(arrow_schema::Schema::new(vec![
            Field::new("ts_min", DataType::Int64, false),
            Field::new("ts_max", DataType::Int64, false),
        ]));
        let min_col = Arc::new(Int64Array::from(vec![10i64, 5i64]));
        let max_col = Arc::new(Int64Array::from(vec![100i64, 200i64]));
        let batch = RecordBatch::try_new(schema, vec![min_col, max_col]).unwrap();
        let (min_ts, max_ts) = pop_time_range(&batch, Some("ts_min"), Some("ts_max"));
        assert_eq!(min_ts, 5);
        assert_eq!(max_ts, 200);
    }

    #[test]
    fn test_pop_time_range_separate_missing_min_col() {
        use arrow::array::Int64Array;
        use arrow_schema::{DataType, Field};
        let schema = Arc::new(arrow_schema::Schema::new(vec![Field::new(
            "ts_max",
            DataType::Int64,
            false,
        )]));
        let max_col = Arc::new(Int64Array::from(vec![100i64]));
        let batch = RecordBatch::try_new(schema, vec![max_col]).unwrap();
        // ts_min column missing → (0, 0)
        let (min_ts, max_ts) = pop_time_range(&batch, Some("ts_min"), Some("ts_max"));
        assert_eq!(min_ts, 0);
        assert_eq!(max_ts, 0);
    }
}
