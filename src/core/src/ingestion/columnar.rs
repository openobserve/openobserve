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

use std::{collections::HashMap, sync::Arc};

use arrow::{
    array::{
        Array, ArrayRef, BooleanBuilder, Float64Builder, Int64Builder, LargeStringBuilder,
        StringBuilder, UInt64Builder, new_null_array,
    },
    record_batch::RecordBatch,
};
use arrow_schema::{DataType, Schema};
use config::{
    meta::stream::{PartitionTimeLevel, StreamType},
    utils::{json, schema_ext::SchemaExt},
};
use infra::{
    errors::{Error, Result},
    schema::get_partition_time_level,
};

use super::{get_write_partition_key, partition_bucket_micros};

const BUILDER_START_ROWS: usize = 16;

/// A request's rows for one stream, built straight into Arrow columns and bucketed by partition.
pub struct ColumnarBuckets {
    schema: Arc<Schema>,
    schema_key: String,
    time_level: PartitionTimeLevel,
    /// A backfill can span any number of partitions, and foldhash keeps an i64 lookup cheap.
    buckets: hashbrown::HashMap<i64, ColumnarBucket>,
}

impl ColumnarBuckets {
    pub fn new(stream_type: StreamType, schema: &Schema) -> Self {
        let schema = Arc::new(schema.clone().with_metadata(HashMap::new()));
        Self {
            schema_key: schema.hash_key(),
            schema,
            time_level: get_partition_time_level(stream_type),
            buckets: hashbrown::HashMap::with_capacity(1),
        }
    }

    /// The stream schema without its metadata, which the entries are keyed on.
    pub fn schema(&self) -> &Arc<Schema> {
        &self.schema
    }

    pub fn schema_key(&self) -> &str {
        &self.schema_key
    }

    pub fn rows(&self) -> usize {
        self.buckets.values().map(|bucket| bucket.rows).sum()
    }

    /// The bucket of the write partition `timestamp` falls in.
    pub fn bucket(&mut self, timestamp: i64) -> &mut ColumnarBucket {
        let Self {
            schema,
            schema_key,
            time_level,
            buckets,
        } = self;
        buckets
            .entry(timestamp.div_euclid(partition_bucket_micros(*time_level)))
            .or_insert_with(|| ColumnarBucket::new(timestamp, *time_level, schema_key, schema))
    }

    /// Schema columns any row holds a value in, in schema order.
    pub fn filled_columns(&self) -> Vec<usize> {
        (0..self.schema.fields().len())
            .filter(|col| {
                self.buckets
                    .values()
                    .any(|bucket| bucket.builders[*col].is_some())
            })
            .collect()
    }

    /// One WAL entry per bucket, holding `columns` of the schema, or all of it when `None`.
    pub fn into_entries(
        self,
        org_id: &str,
        stream_name: &str,
        columns: Option<Vec<usize>>,
    ) -> Result<Vec<ingester::Entry>> {
        let (schema, columns) = match columns {
            Some(columns) => (
                Arc::new(
                    self.schema
                        .project(&columns)
                        .map_err(|e| Error::IngestionError(e.to_string()))?,
                ),
                columns,
            ),
            None => (
                self.schema.clone(),
                (0..self.schema.fields().len()).collect(),
            ),
        };
        let mut entries = Vec::with_capacity(self.buckets.len());
        for mut bucket in self.buckets.into_values() {
            let arrays: Vec<ArrayRef> = columns
                .iter()
                .enumerate()
                .map(|(field, col)| bucket.finish_column(*col, schema.field(field).data_type()))
                .collect();
            let batch = RecordBatch::try_new(schema.clone(), arrays)
                .map_err(|e| Error::IngestionError(e.to_string()))?;
            entries.push(ingester::Entry {
                org_id: Arc::from(org_id),
                stream: Arc::from(stream_name),
                schema: Some(schema.clone()),
                schema_key: Arc::from(self.schema_key.as_str()),
                partition_key: Arc::from(bucket.partition_key.as_str()),
                data: Vec::new(),
                data_size: bucket.json_size,
                batch: Some(batch),
            });
        }
        Ok(entries)
    }
}

/// The rows of one write partition.
pub struct ColumnarBucket {
    partition_key: String,
    /// Boxed: a block freed on the writing thread keeps mimalloc reusing pages the memtable frees.
    builders: Vec<Option<Box<ColumnBuilder>>>,
    /// Rows a column's builder already holds, values and nulls; the gap is padded lazily.
    filled: Vec<usize>,
    rows: usize,
    json_size: usize,
}

impl ColumnarBucket {
    /// The builder for `col` in the row being written, padded with nulls up to it.
    pub fn column(&mut self, col: usize, kind: ColumnKind) -> &mut ColumnBuilder {
        let rows = self.rows;
        let builder =
            self.builders[col].get_or_insert_with(|| Box::new(ColumnBuilder::new(kind, rows)));
        builder.append_nulls(rows - self.filled[col]);
        self.filled[col] = rows + 1;
        builder
    }

    /// Closes the row being written; a column it gave no value reads null.
    pub fn finish_row(&mut self, json_size: usize) {
        self.rows += 1;
        self.json_size += json_size;
    }

    fn new(
        timestamp: i64,
        time_level: PartitionTimeLevel,
        schema_key: &str,
        schema: &Schema,
    ) -> Self {
        let columns = schema.fields().len();
        Self {
            partition_key: get_write_partition_key(
                timestamp,
                &Vec::new(),
                time_level,
                &json::Map::new(),
                Some(schema_key),
            ),
            builders: (0..columns).map(|_| None).collect(),
            filled: vec![0; columns],
            rows: 0,
            json_size: 0,
        }
    }

    fn finish_column(&mut self, col: usize, data_type: &DataType) -> ArrayRef {
        match self.builders[col].take() {
            Some(mut builder) => {
                builder.append_nulls(self.rows - self.filled[col]);
                (*builder).finish()
            }
            None => new_null_array(data_type, self.rows),
        }
    }
}

/// A column type values can be appended to directly.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ColumnKind {
    Utf8,
    LargeUtf8,
    Boolean,
    Int64,
    UInt64,
    Float64,
}

impl ColumnKind {
    pub fn of(data_type: &DataType) -> Option<Self> {
        Some(match data_type {
            DataType::Utf8 => Self::Utf8,
            DataType::LargeUtf8 => Self::LargeUtf8,
            DataType::Boolean => Self::Boolean,
            DataType::Int64 => Self::Int64,
            DataType::UInt64 => Self::UInt64,
            DataType::Float64 => Self::Float64,
            _ => return None,
        })
    }
}

pub enum ColumnBuilder {
    Utf8(StringBuilder),
    LargeUtf8(LargeStringBuilder),
    Boolean(BooleanBuilder),
    Int64(Int64Builder),
    UInt64(UInt64Builder),
    Float64(Float64Builder),
}

impl ColumnBuilder {
    pub fn kind(&self) -> ColumnKind {
        match self {
            Self::Utf8(_) => ColumnKind::Utf8,
            Self::LargeUtf8(_) => ColumnKind::LargeUtf8,
            Self::Boolean(_) => ColumnKind::Boolean,
            Self::Int64(_) => ColumnKind::Int64,
            Self::UInt64(_) => ColumnKind::UInt64,
            Self::Float64(_) => ColumnKind::Float64,
        }
    }

    pub fn append_str(&mut self, value: &str) {
        match self {
            Self::Utf8(b) => b.append_value(value),
            Self::LargeUtf8(b) => b.append_value(value),
            _ => unreachable!("a string appended to a {:?} column", self.kind()),
        }
    }

    pub fn append_bool(&mut self, value: bool) {
        match self {
            Self::Boolean(b) => b.append_value(value),
            _ => unreachable!("a bool appended to a {:?} column", self.kind()),
        }
    }

    pub fn append_i64(&mut self, value: i64) {
        match self {
            Self::Int64(b) => b.append_value(value),
            _ => unreachable!("an i64 appended to a {:?} column", self.kind()),
        }
    }

    pub fn append_u64(&mut self, value: u64) {
        match self {
            Self::UInt64(b) => b.append_value(value),
            _ => unreachable!("a u64 appended to a {:?} column", self.kind()),
        }
    }

    pub fn append_f64(&mut self, value: f64) {
        match self {
            Self::Float64(b) => b.append_value(value),
            _ => unreachable!("an f64 appended to a {:?} column", self.kind()),
        }
    }

    fn new(kind: ColumnKind, rows: usize) -> Self {
        let rows = BUILDER_START_ROWS.max(rows);
        match kind {
            ColumnKind::Utf8 => Self::Utf8(StringBuilder::with_capacity(rows, rows * 16)),
            ColumnKind::LargeUtf8 => {
                Self::LargeUtf8(LargeStringBuilder::with_capacity(rows, rows * 16))
            }
            ColumnKind::Boolean => Self::Boolean(BooleanBuilder::with_capacity(rows)),
            ColumnKind::Int64 => Self::Int64(Int64Builder::with_capacity(rows)),
            ColumnKind::UInt64 => Self::UInt64(UInt64Builder::with_capacity(rows)),
            ColumnKind::Float64 => Self::Float64(Float64Builder::with_capacity(rows)),
        }
    }

    fn append_nulls(&mut self, n: usize) {
        // arrow materializes the validity bitmap even for zero nulls, taxing every later append
        if n == 0 {
            return;
        }
        match self {
            Self::Utf8(b) => b.append_nulls(n),
            Self::LargeUtf8(b) => b.append_nulls(n),
            Self::Boolean(b) => b.append_nulls(n),
            Self::Int64(b) => b.append_nulls(n),
            Self::UInt64(b) => b.append_nulls(n),
            Self::Float64(b) => b.append_nulls(n),
        }
    }

    fn finish(self) -> ArrayRef {
        // `finish` hands over the whole capacity, which the memtable then holds until flush
        match self {
            Self::Utf8(mut b) => shrunk(b.finish()),
            Self::LargeUtf8(mut b) => shrunk(b.finish()),
            Self::Boolean(mut b) => shrunk(b.finish()),
            Self::Int64(mut b) => shrunk(b.finish()),
            Self::UInt64(mut b) => shrunk(b.finish()),
            Self::Float64(mut b) => shrunk(b.finish()),
        }
    }
}

fn shrunk<A: Array + 'static>(mut array: A) -> ArrayRef {
    array.shrink_to_fit();
    Arc::new(array)
}

#[cfg(test)]
mod tests {
    use arrow::array::{AsArray, types::Int64Type};
    use arrow_schema::Field;

    use super::*;

    const HOUR: i64 = 3_600_000_000;

    fn schema() -> Schema {
        Schema::new(vec![
            Field::new("a", DataType::Utf8, true),
            Field::new("b", DataType::Int64, true),
            Field::new("c", DataType::Float64, true),
        ])
    }

    #[test]
    fn test_columns_a_row_skips_read_null() {
        let mut buckets = ColumnarBuckets::new(StreamType::Logs, &schema());
        let bucket = buckets.bucket(HOUR);
        bucket.column(0, ColumnKind::Utf8).append_str("x");
        bucket.finish_row(1);
        bucket.column(1, ColumnKind::Int64).append_i64(7);
        bucket.finish_row(1);
        bucket.finish_row(1);

        assert_eq!(buckets.rows(), 3);
        assert_eq!(buckets.filled_columns(), vec![0, 1]);
        let entries = buckets.into_entries("org", "logs", None).unwrap();
        let batch = entries[0].batch.as_ref().unwrap();
        assert_eq!(entries[0].data_size, 3);
        assert_eq!(batch.num_columns(), 3);
        assert_eq!(batch.column(0).null_count(), 2);
        let b = batch.column(1).as_primitive::<Int64Type>();
        assert!(b.is_null(0) && b.value(1) == 7 && b.is_null(2));
        assert_eq!(batch.column(2).null_count(), 3);
    }

    #[test]
    fn test_a_column_without_nulls_carries_no_validity_bitmap() {
        let mut buckets = ColumnarBuckets::new(StreamType::Logs, &schema());
        for i in 0..3 {
            let bucket = buckets.bucket(HOUR);
            bucket.column(1, ColumnKind::Int64).append_i64(i);
            bucket.finish_row(1);
        }
        let entries = buckets.into_entries("org", "logs", Some(vec![1])).unwrap();
        assert!(
            entries[0]
                .batch
                .as_ref()
                .unwrap()
                .column(0)
                .nulls()
                .is_none()
        );
    }

    #[test]
    fn test_projected_entries_keep_only_the_requested_columns() {
        let mut buckets = ColumnarBuckets::new(StreamType::Logs, &schema());
        buckets
            .bucket(HOUR)
            .column(2, ColumnKind::Float64)
            .append_f64(1.5);
        buckets.bucket(HOUR).finish_row(1);
        let entries = buckets
            .into_entries("org", "logs", Some(vec![2, 0]))
            .unwrap();
        let batch = entries[0].batch.as_ref().unwrap();
        let names: Vec<&str> = batch
            .schema_ref()
            .fields()
            .iter()
            .map(|f| f.name().as_str())
            .collect();
        assert_eq!(names, vec!["c", "a"]);
        assert_eq!(batch.column(1).null_count(), 1);
    }

    #[test]
    fn test_buckets_follow_the_partition_across_the_epoch() {
        let schema = schema();
        let mut buckets = ColumnarBuckets::new(StreamType::Metrics, &schema);
        let timestamps = [-HOUR - 1_000_000, -1_000_000, 1_000_000];
        for ts in timestamps {
            let bucket = buckets.bucket(ts);
            bucket.column(1, ColumnKind::Int64).append_i64(ts);
            bucket.finish_row(1);
        }
        let schema_key = buckets.schema_key().to_string();
        let entries = buckets.into_entries("org", "m", None).unwrap();
        assert_eq!(entries.len(), timestamps.len());
        for ts in timestamps {
            let expected = get_write_partition_key(
                ts,
                &Vec::new(),
                get_partition_time_level(StreamType::Metrics),
                &json::Map::new(),
                Some(&schema_key),
            );
            assert!(
                entries
                    .iter()
                    .any(|entry| entry.partition_key.as_ref() == expected),
                "{ts}"
            );
        }
    }
}
