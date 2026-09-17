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

use std::{borrow::Cow, collections::HashMap, fmt, hash::BuildHasher, sync::Arc};

use arrow::array::{
    Array, ArrayRef, BooleanBuilder, Float64Builder, Int64Builder, LargeStringBuilder,
    StringBuilder, UInt64Builder, new_null_array,
};
use arrow_schema::{DataType, FieldRef, Schema};
use config::{
    TIMESTAMP_COL_NAME, get_config,
    meta::{
        promql::HASH_LABEL,
        stream::{PartitionTimeLevel, StreamParams, StreamType},
    },
    utils::{
        flatten::{TOKEN_NUMBER, push_formatted_key},
        json::{
            self, JsonBytesExt, estimate_json_bytes, estimate_json_entry_bytes,
            is_size_excluded_column,
        },
        schema_ext::SchemaExt,
        time::{
            parse_timestamp_micro_from_integer, parse_timestamp_micro_from_str,
            parse_timestamp_micro_from_value,
        },
    },
};
use infra::{
    errors::{Error, Result},
    schema::{get_partition_time_level, unwrap_stream_settings},
};
use serde::de::{self, DeserializeSeed, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde_json::value::RawValue;

use crate::{
    db_monitoring::server_vantage::may_canonicalize_key,
    ingestion::{column_accepts, get_write_partition_key, partition_bucket_micros},
};

const BUILDER_START_ROWS: usize = 16;

/// Builds a `_json` request's records straight into Arrow columns of the stream's current schema.
pub struct JsonColumnar {
    stream_name: String,
    schema: Arc<Schema>,
    schema_key: String,
    col_index: hashbrown::HashMap<String, usize>,
    columns: Vec<ColumnMeta>,
    ts_col: usize,
    flatten_level: u32,
    time_range: (i64, i64),
    dbm_enabled: bool,
    time_level: PartitionTimeLevel,
    buckets: hashbrown::HashMap<i64, Bucket>,
    input_bytes: usize,
}

impl JsonColumnar {
    /// `None` unless the stream needs nothing a record's JSON form would carry downstream.
    pub async fn plan(
        org_id: &str,
        stream_name: &str,
        flatten_level: u32,
        time_range: (i64, i64),
    ) -> Option<Self> {
        // pattern associations rewrite the JSON records after they are prepared
        if cfg!(feature = "vectorscan") {
            return None;
        }
        let schema = infra::schema::get_cache(org_id, stream_name, StreamType::Logs)
            .await
            .ok()?
            .schema()
            .clone();
        let settings = unwrap_stream_settings(&schema).unwrap_or_default();
        if settings.partition_keys.iter().any(|key| !key.disabled) {
            return None;
        }
        let mut alerts = HashMap::new();
        crate::ingestion::get_stream_alerts(
            &[StreamParams::new(org_id, stream_name, StreamType::Logs)],
            &mut alerts,
        )
        .await;
        if alerts.values().any(|alerts| !alerts.is_empty()) {
            return None;
        }
        Self::for_schema(
            stream_name,
            &schema,
            flatten_level,
            time_range,
            get_config().db_monitoring.enabled,
        )
    }

    pub fn stream_name(&self) -> &str {
        &self.stream_name
    }

    pub fn rows(&self) -> usize {
        self.buckets.values().map(|bucket| bucket.rows).sum()
    }

    /// What `estimate_json_bytes` counts over the accepted records as the client sent them.
    pub fn input_bytes(&self) -> usize {
        self.input_bytes
    }

    /// The records the columns could not take, as JSON; `None` means the body needs the JSON path.
    pub fn parse(&mut self, body: &[u8]) -> Option<Vec<json::Value>> {
        let first = *body.iter().find(|b| !b.is_ascii_whitespace())?;
        let mut fallback = Vec::new();
        let mut de = serde_json::Deserializer::from_slice(body);
        {
            let mut state = RecordState::new(self);
            let parsed = match first {
                b'[' => de::Deserializer::deserialize_seq(
                    &mut de,
                    Records {
                        state: &mut state,
                        fallback: &mut fallback,
                    },
                ),
                b'{' => Record(&mut state).deserialize(&mut de).map(|input_bytes| {
                    if !state.finish(input_bytes) {
                        fallback.push(0);
                    }
                }),
                _ => return None,
            };
            parsed.and_then(|()| de.end()).ok()?;
        }
        if fallback.is_empty() {
            return Some(Vec::new());
        }
        if first == b'{' {
            return json::from_slice(body).ok().map(|record| vec![record]);
        }
        let raw: Vec<&RawValue> = json::from_slice(body).ok()?;
        fallback
            .into_iter()
            .map(|idx| json::from_str(raw[idx].get()).ok())
            .collect()
    }

    pub fn into_entries(self, org_id: &str) -> Result<Vec<ingester::Entry>> {
        let mut cols: Vec<usize> = (0..self.columns.len())
            .filter(|col| {
                self.buckets
                    .values()
                    .any(|bucket| bucket.builders[*col].is_some())
            })
            .collect();
        cols.sort_by(|a, b| {
            self.schema
                .field(*a)
                .name()
                .cmp(self.schema.field(*b).name())
        });
        let schema = Arc::new(
            self.schema
                .project(&cols)
                .map_err(|e| Error::IngestionError(e.to_string()))?,
        );
        let mut entries = Vec::with_capacity(self.buckets.len());
        for mut bucket in self.buckets.into_values() {
            let arrays: Vec<ArrayRef> = cols
                .iter()
                .map(|col| bucket.finish_column(*col, &self.columns[*col].data_type))
                .collect();
            let batch = arrow::record_batch::RecordBatch::try_new(schema.clone(), arrays)
                .map_err(|e| Error::IngestionError(e.to_string()))?;
            entries.push(ingester::Entry {
                org_id: Arc::from(org_id),
                stream: Arc::from(self.stream_name.as_str()),
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

    fn for_schema(
        stream_name: &str,
        schema: &Schema,
        flatten_level: u32,
        time_range: (i64, i64),
        dbm_enabled: bool,
    ) -> Option<Self> {
        let fields = schema.fields();
        // within the limit every record fits, so the per-request column check cannot fail here
        if fields.is_empty() || fields.len() > get_config().limit.req_cols_per_record_limit {
            return None;
        }
        let ts_col = fields
            .iter()
            .position(|f| f.name() == TIMESTAMP_COL_NAME && f.data_type() == &DataType::Int64)?;
        let schema = Arc::new(schema.clone().with_metadata(HashMap::new()));
        let col_index = schema
            .fields()
            .iter()
            .enumerate()
            .map(|(idx, f)| (f.name().clone(), idx))
            .collect();
        Some(Self {
            stream_name: stream_name.to_string(),
            schema_key: schema.hash_key(),
            columns: schema.fields().iter().map(ColumnMeta::new).collect(),
            schema,
            col_index,
            ts_col,
            flatten_level,
            time_range,
            dbm_enabled,
            time_level: get_partition_time_level(StreamType::Logs),
            buckets: hashbrown::HashMap::new(),
            input_bytes: 0,
        })
    }

    fn append(&mut self, timestamp: i64, leaves: &[(usize, Leaf<'_>, usize)], json_size: usize) {
        let Self {
            schema_key,
            columns,
            buckets,
            ts_col,
            time_level,
            ..
        } = self;
        let bucket = buckets
            .entry(timestamp.div_euclid(partition_bucket_micros(*time_level)))
            .or_insert_with(|| Bucket::new(timestamp, *time_level, schema_key, columns.len()));
        for (col, leaf, _) in leaves {
            bucket.column(*col, columns[*col].kind).append(leaf);
        }
        bucket
            .column(*ts_col, Some(ColumnKind::Int64))
            .append(&Leaf::Num(Num::I64(timestamp)));
        bucket.rows += 1;
        bucket.json_size += json_size;
    }
}

struct ColumnMeta {
    kind: Option<ColumnKind>,
    data_type: DataType,
    /// `"name":` plus separators, `None` for a column `estimate_json_bytes` leaves out.
    entry_bytes: Option<usize>,
    dbm_key: bool,
}

impl ColumnMeta {
    fn new(field: &FieldRef) -> Self {
        let name = field.name().as_str();
        Self {
            kind: ColumnKind::of(field.data_type()),
            data_type: field.data_type().clone(),
            entry_bytes: (!is_size_excluded_column(name))
                .then(|| estimate_json_entry_bytes(name, 0)),
            dbm_key: may_canonicalize_key(name),
        }
    }
}

#[derive(Clone, Copy)]
enum ColumnKind {
    Utf8,
    LargeUtf8,
    Boolean,
    Int64,
    UInt64,
    Float64,
}

impl ColumnKind {
    fn of(data_type: &DataType) -> Option<Self> {
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

enum ColumnBuilder {
    Utf8(StringBuilder),
    LargeUtf8(LargeStringBuilder),
    Boolean(BooleanBuilder),
    Int64(Int64Builder),
    UInt64(UInt64Builder),
    Float64(Float64Builder),
}

impl ColumnBuilder {
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
        match self {
            Self::Utf8(b) => b.append_nulls(n),
            Self::LargeUtf8(b) => b.append_nulls(n),
            Self::Boolean(b) => b.append_nulls(n),
            Self::Int64(b) => b.append_nulls(n),
            Self::UInt64(b) => b.append_nulls(n),
            Self::Float64(b) => b.append_nulls(n),
        }
    }

    /// Converts as `convert_json_to_record_batch` does; `column_accepts` has vetted the pairing.
    fn append(&mut self, leaf: &Leaf<'_>) {
        match (self, leaf) {
            (Self::Utf8(b), Leaf::Str(s)) => b.append_value(s),
            (Self::LargeUtf8(b), Leaf::Str(s)) => b.append_value(s),
            (Self::Boolean(b), Leaf::Bool(v)) => b.append_value(*v),
            (Self::Int64(b), Leaf::Num(n)) => b.append_value(
                n.as_i64()
                    .or_else(|| n.as_u64().map(|u| u as i64))
                    .unwrap_or_else(|| n.as_f64().unwrap_or(0.0) as i64),
            ),
            (Self::UInt64(b), Leaf::Num(n)) => b.append_value(
                n.as_u64()
                    .or_else(|| n.as_i64().map(|i| i as u64))
                    .unwrap_or_else(|| n.as_f64().unwrap_or(0.0) as u64),
            ),
            (Self::Float64(b), Leaf::Num(n)) => b.append_value(n.as_f64().unwrap_or(0.0)),
            _ => unreachable!("column_accepts admitted a leaf its column cannot hold"),
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

struct Bucket {
    partition_key: String,
    builders: Vec<Option<ColumnBuilder>>,
    /// Rows a column's builder already holds, values and nulls; the gap is padded lazily.
    filled: Vec<usize>,
    rows: usize,
    json_size: usize,
}

impl Bucket {
    fn new(
        timestamp: i64,
        time_level: PartitionTimeLevel,
        schema_key: &str,
        columns: usize,
    ) -> Self {
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

    /// The builder for `col`, padded with nulls up to the current row.
    fn column(&mut self, col: usize, kind: Option<ColumnKind>) -> &mut ColumnBuilder {
        let rows = self.rows;
        let builder = self.builders[col].get_or_insert_with(|| {
            ColumnBuilder::new(kind.expect("an accepted leaf has a column kind"), rows)
        });
        builder.append_nulls(rows - self.filled[col]);
        self.filled[col] = rows + 1;
        builder
    }

    fn finish_column(&mut self, col: usize, data_type: &DataType) -> ArrayRef {
        match self.builders[col].take() {
            Some(mut builder) => {
                builder.append_nulls(self.rows - self.filled[col]);
                builder.finish()
            }
            None => new_null_array(data_type, self.rows),
        }
    }
}

enum Leaf<'de> {
    Str(Cow<'de, str>),
    Bool(bool),
    Num(Num<'de>),
}

impl Leaf<'_> {
    fn inferred_type(&self, key: &str) -> Option<DataType> {
        Some(match self {
            Self::Str(_) => DataType::Utf8,
            Self::Bool(_) => DataType::Boolean,
            Self::Num(_) if key == HASH_LABEL => DataType::UInt64,
            Self::Num(n) if n.as_i64().is_some() => DataType::Int64,
            Self::Num(n) if n.as_u64().is_some() => DataType::UInt64,
            Self::Num(n) if n.is_f64() => DataType::Float64,
            // the JSON path writes such a number into a string column as ""
            Self::Num(_) => return None,
        })
    }

    fn json_bytes(&self) -> usize {
        match self {
            // an unescaped input string holds no quote or backslash to escape again
            Self::Str(Cow::Borrowed(s)) => s.len() + 2,
            Self::Str(Cow::Owned(s)) => s.json_bytes(),
            Self::Bool(b) => b.json_bytes(),
            Self::Num(n) => n.json_bytes(),
        }
    }

    /// `parse_timestamp_micro_from_value` over the leaf, without building the value for numbers.
    fn timestamp(&self) -> anyhow::Result<(i64, bool)> {
        match self {
            Self::Str(s) => parse_timestamp_micro_from_str(s),
            Self::Num(Num::I64(i)) => Ok(parse_timestamp_micro_from_integer(*i)),
            Self::Num(Num::U64(u)) => Ok(parse_timestamp_micro_from_integer(*u as i64)),
            Self::Num(Num::Text(s)) => {
                parse_timestamp_micro_from_value(&json::Value::Number(s.parse()?))
            }
            Self::Bool(_) => Err(anyhow::anyhow!("Invalid time format [type]")),
        }
    }
}

/// A JSON number as `arbitrary_precision` keeps it, answering as `serde_json::Number` would.
enum Num<'de> {
    U64(u64),
    I64(i64),
    Text(Cow<'de, str>),
}

impl Num<'_> {
    fn as_i64(&self) -> Option<i64> {
        match self {
            Self::U64(u) => i64::try_from(*u).ok(),
            Self::I64(i) => Some(*i),
            Self::Text(s) => s.parse().ok(),
        }
    }

    fn as_u64(&self) -> Option<u64> {
        match self {
            Self::U64(u) => Some(*u),
            Self::I64(i) => u64::try_from(*i).ok(),
            Self::Text(s) => s.parse().ok(),
        }
    }

    fn as_f64(&self) -> Option<f64> {
        match self {
            Self::U64(u) => Some(*u as f64),
            Self::I64(i) => Some(*i as f64),
            Self::Text(s) => s.parse::<f64>().ok().filter(|f| f.is_finite()),
        }
    }

    fn is_f64(&self) -> bool {
        match self {
            Self::U64(_) | Self::I64(_) => false,
            Self::Text(s) => s.contains(['.', 'e', 'E']) && self.as_f64().is_some(),
        }
    }

    fn json_bytes(&self) -> usize {
        if let Some(i) = self.as_i64() {
            i.json_bytes()
        } else if let Some(u) = self.as_u64() {
            u.json_bytes()
        } else {
            self.as_f64().map_or(4, |f| f.json_bytes())
        }
    }
}

/// Per-record scratch, reused across a request's records.
struct RecordState<'c, 'de> {
    columnar: &'c mut JsonColumnar,
    path: String,
    /// Column, value, and the value's `estimate_json_bytes` size.
    leaves: Vec<(usize, Leaf<'de>, usize)>,
    timestamp: Option<Leaf<'de>>,
    null_cols: Vec<usize>,
    /// Path hashes of nulls under names the schema lacks; a hash collision only costs a fallback.
    null_names: Vec<u64>,
    null_names_dbm: bool,
    null_bytes: usize,
    /// Objects and empty arrays a key maps to, which a repeated key would replace wholesale.
    containers: Vec<(u64, Option<usize>)>,
    hasher: hashbrown::DefaultHashBuilder,
    /// `serial` marks a column that already holds a value in the current record.
    marks: Vec<u32>,
    null_marks: Vec<u32>,
    serial: u32,
    nested_top: bool,
    fallback: bool,
}

impl<'c, 'de> RecordState<'c, 'de> {
    fn new(columnar: &'c mut JsonColumnar) -> Self {
        let columns = columnar.columns.len();
        Self {
            columnar,
            path: String::new(),
            leaves: Vec::new(),
            timestamp: None,
            null_cols: Vec::new(),
            null_names: Vec::new(),
            null_names_dbm: false,
            null_bytes: 0,
            containers: Vec::new(),
            hasher: hashbrown::DefaultHashBuilder::default(),
            marks: vec![0; columns],
            null_marks: vec![0; columns],
            serial: 0,
            nested_top: false,
            fallback: false,
        }
    }

    fn begin(&mut self) {
        if self.serial == u32::MAX {
            self.marks.fill(0);
            self.null_marks.fill(0);
            self.serial = 0;
        }
        self.serial += 1;
        self.path.clear();
        self.leaves.clear();
        self.timestamp = None;
        self.null_cols.clear();
        self.null_names.clear();
        self.null_names_dbm = false;
        self.null_bytes = 0;
        self.containers.clear();
        self.nested_top = false;
        self.fallback = false;
    }

    /// Takes a flattened value at the current path, returning its `estimate_json_bytes` size.
    fn push_leaf(&mut self, leaf: Leaf<'de>) -> usize {
        if self.fallback {
            return 0;
        }
        let bytes = leaf.json_bytes();
        let Some(&col) = self.columnar.col_index.get(self.path.as_str()) else {
            self.fallback = true;
            return bytes;
        };
        if self.marks[col] == self.serial {
            self.fallback = true;
            return bytes;
        }
        self.marks[col] = self.serial;
        if col == self.columnar.ts_col {
            self.timestamp = Some(leaf);
            return bytes;
        }
        let meta = &self.columnar.columns[col];
        let accepted = meta.kind.is_some()
            && leaf
                .inferred_type(&self.path)
                .is_some_and(|inferred| column_accepts(&meta.data_type, &inferred));
        if accepted {
            self.leaves.push((col, leaf, bytes));
        } else {
            self.fallback = true;
        }
        bytes
    }

    /// Takes a non-empty array or a too-deep object as the string flattening turns it into.
    fn push_stringified(&mut self, value: json::Value) -> usize {
        let bytes = estimate_json_bytes(&value);
        self.push_leaf(Leaf::Str(Cow::Owned(value.to_string())));
        bytes
    }

    /// A null survives flattening only in a record without nested values, so it is settled last.
    fn push_null(&mut self) {
        if self.fallback {
            return;
        }
        match self.columnar.col_index.get(self.path.as_str()) {
            Some(&col) => {
                if self.null_marks[col] == self.serial {
                    self.fallback = true;
                    return;
                }
                self.null_marks[col] = self.serial;
                self.null_cols.push(col);
            }
            None => {
                let hash = self.hasher.hash_one(self.path.as_str());
                if self.null_names.contains(&hash) {
                    self.fallback = true;
                    return;
                }
                self.null_names.push(hash);
                self.null_names_dbm |= may_canonicalize_key(&self.path);
            }
        }
        if self.path != TIMESTAMP_COL_NAME && !is_size_excluded_column(&self.path) {
            self.null_bytes += estimate_json_entry_bytes(&self.path, 4);
        }
    }

    fn push_container(&mut self) {
        let col = self.columnar.col_index.get(self.path.as_str()).copied();
        self.containers
            .push((self.hasher.hash_one(self.path.as_str()), col));
    }

    /// Whether a key repeats in a way the JSON map would resolve differently than the leaves did.
    fn has_repeated_key(&self) -> bool {
        // a null sharing a name with a value resolves by key position and value order in the map
        if self
            .null_cols
            .iter()
            .any(|col| self.marks[*col] == self.serial)
        {
            return true;
        }
        self.containers.iter().enumerate().any(|(i, (hash, col))| {
            col.is_some_and(|col| {
                self.marks[col] == self.serial || self.null_marks[col] == self.serial
            }) || self.containers[..i].iter().any(|(other, _)| other == hash)
                || self.null_names.contains(hash)
        })
    }

    /// Whether the DBM canonicalizer could rewrite this record once it is flattened.
    fn touches_dbm(&self, keeps_nulls: bool) -> bool {
        let columns = &self.columnar.columns;
        self.leaves.iter().any(|(col, ..)| columns[*col].dbm_key)
            || keeps_nulls
                && (self.null_names_dbm || self.null_cols.iter().any(|col| columns[*col].dbm_key))
    }

    /// Writes the record into the columns, or reports that it needs the JSON path.
    fn finish(&mut self, input_bytes: usize) -> bool {
        if self.fallback || self.has_repeated_key() {
            return false;
        }
        let keeps_nulls = !self.nested_top;
        if self.columnar.dbm_enabled && self.touches_dbm(keeps_nulls) {
            return false;
        }
        let (min_ts, max_ts) = self.columnar.time_range;
        let parsed = self.timestamp.as_ref().map(Leaf::timestamp);
        let Ok((timestamp, _)) = super::resolve_timestamp(parsed, min_ts, max_ts) else {
            return false;
        };
        let mut json_size =
            2 + estimate_json_entry_bytes(TIMESTAMP_COL_NAME, timestamp.json_bytes());
        for (col, _, bytes) in &self.leaves {
            if let Some(entry) = self.columnar.columns[*col].entry_bytes {
                json_size += entry + bytes;
            }
        }
        if keeps_nulls {
            json_size += self.null_bytes;
        }
        // the entry rule counts a ',' after the last entry too
        json_size -= 1;
        self.columnar.append(timestamp, &self.leaves, json_size);
        self.columnar.input_bytes += input_bytes;
        true
    }

    /// Flattens an object at `depth` into leaves, returning its `estimate_json_bytes` size.
    fn read_object<A: MapAccess<'de>>(
        &mut self,
        mut map: A,
        depth: u32,
    ) -> std::result::Result<usize, A::Error> {
        let first = map.next_key_seed(CowStr)?;
        if first.as_deref() == Some(TOKEN_NUMBER) {
            let text = map.next_value_seed(CowStr)?;
            if depth == 0 || !is_json_number(&text) {
                self.fallback = true;
                return Ok(0);
            }
            return Ok(self.push_leaf(Leaf::Num(Num::Text(text))));
        }
        self.nested_top |= depth == 1;
        let Some(first) = first else {
            if depth > 0 {
                self.push_container();
            }
            return Ok(2);
        };
        if self.fallback {
            return skip_entries(map).map(|()| 0);
        }
        if self.columnar.flatten_level > 0 && depth >= self.columnar.flatten_level {
            let mut object = json::Map::new();
            object.insert(first.into_owned(), map.next_value()?);
            while let Some((key, value)) = map.next_entry::<String, json::Value>()? {
                object.insert(key, value);
            }
            return Ok(self.push_stringified(json::Value::Object(object)));
        }
        if depth > 0 {
            self.push_container();
        }
        let mut bytes = 2;
        let mut key = Some(first);
        while let Some(name) = key {
            if self.fallback {
                return skip_entries(map).map(|()| 0);
            }
            let parent = self.path.len();
            if depth > 0 {
                self.path.push('_');
            }
            push_formatted_key(&mut self.path, &name);
            let value_bytes = map.next_value_seed(FieldSeed {
                state: self,
                depth: depth + 1,
            })?;
            self.path.truncate(parent);
            if !is_size_excluded_column(&name) {
                bytes += estimate_json_entry_bytes(&name, value_bytes);
            }
            key = map.next_key_seed(CowStr)?;
        }
        Ok(bytes - 1)
    }
}

struct Records<'s, 'c, 'de> {
    state: &'s mut RecordState<'c, 'de>,
    fallback: &'s mut Vec<usize>,
}

impl<'de> Visitor<'de> for Records<'_, '_, 'de> {
    type Value = ();

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of log records")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<(), A::Error> {
        let mut idx = 0;
        while let Some(input_bytes) = seq.next_element_seed(Record(&mut *self.state))? {
            if !self.state.finish(input_bytes) {
                self.fallback.push(idx);
            }
            idx += 1;
        }
        Ok(())
    }
}

struct Record<'s, 'c, 'de>(&'s mut RecordState<'c, 'de>);

impl Record<'_, '_, '_> {
    fn not_an_object<E>(self) -> std::result::Result<usize, E> {
        self.0.fallback = true;
        Ok(0)
    }
}

impl<'de> DeserializeSeed<'de> for Record<'_, '_, 'de> {
    type Value = usize;

    fn deserialize<D: de::Deserializer<'de>>(self, de: D) -> std::result::Result<usize, D::Error> {
        self.0.begin();
        de.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for Record<'_, '_, 'de> {
    type Value = usize;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a log record")
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> std::result::Result<usize, A::Error> {
        self.0.read_object(map, 0)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<usize, A::Error> {
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        self.not_an_object()
    }

    fn visit_bool<E>(self, _: bool) -> std::result::Result<usize, E> {
        self.not_an_object()
    }

    fn visit_i64<E>(self, _: i64) -> std::result::Result<usize, E> {
        self.not_an_object()
    }

    fn visit_u64<E>(self, _: u64) -> std::result::Result<usize, E> {
        self.not_an_object()
    }

    fn visit_f64<E>(self, _: f64) -> std::result::Result<usize, E> {
        self.not_an_object()
    }

    fn visit_str<E>(self, _: &str) -> std::result::Result<usize, E> {
        self.not_an_object()
    }

    fn visit_unit<E>(self) -> std::result::Result<usize, E> {
        self.not_an_object()
    }
}

struct FieldSeed<'s, 'c, 'de> {
    state: &'s mut RecordState<'c, 'de>,
    depth: u32,
}

impl<'de> DeserializeSeed<'de> for FieldSeed<'_, '_, 'de> {
    type Value = usize;

    fn deserialize<D: de::Deserializer<'de>>(self, de: D) -> std::result::Result<usize, D::Error> {
        de.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for FieldSeed<'_, '_, 'de> {
    type Value = usize;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a JSON value")
    }

    fn visit_bool<E>(self, v: bool) -> std::result::Result<usize, E> {
        Ok(self.state.push_leaf(Leaf::Bool(v)))
    }

    fn visit_i64<E>(self, v: i64) -> std::result::Result<usize, E> {
        Ok(self.state.push_leaf(Leaf::Num(Num::I64(v))))
    }

    fn visit_u64<E>(self, v: u64) -> std::result::Result<usize, E> {
        Ok(self.state.push_leaf(Leaf::Num(Num::U64(v))))
    }

    fn visit_f64<E>(self, _: f64) -> std::result::Result<usize, E> {
        // serde_json with arbitrary_precision hands floats over as text, never here
        self.state.fallback = true;
        Ok(0)
    }

    fn visit_borrowed_str<E>(self, v: &'de str) -> std::result::Result<usize, E> {
        Ok(self.state.push_leaf(Leaf::Str(Cow::Borrowed(v))))
    }

    fn visit_str<E>(self, v: &str) -> std::result::Result<usize, E> {
        Ok(self.state.push_leaf(Leaf::Str(Cow::Owned(v.to_string()))))
    }

    fn visit_unit<E>(self) -> std::result::Result<usize, E> {
        self.state.push_null();
        Ok(4)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> std::result::Result<usize, A::Error> {
        if self.state.fallback {
            while seq.next_element::<IgnoredAny>()?.is_some() {}
            return Ok(0);
        }
        let mut items = Vec::new();
        while let Some(item) = seq.next_element::<json::Value>()? {
            items.push(item);
        }
        self.state.nested_top |= self.depth == 1;
        if items.is_empty() {
            self.state.push_container();
            return Ok(2);
        }
        Ok(self.state.push_stringified(json::Value::Array(items)))
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> std::result::Result<usize, A::Error> {
        self.state.read_object(map, self.depth)
    }
}

struct CowStr;

impl<'de> DeserializeSeed<'de> for CowStr {
    type Value = Cow<'de, str>;

    fn deserialize<D: de::Deserializer<'de>>(
        self,
        de: D,
    ) -> std::result::Result<Cow<'de, str>, D::Error> {
        de.deserialize_str(self)
    }
}

impl<'de> Visitor<'de> for CowStr {
    type Value = Cow<'de, str>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a string")
    }

    fn visit_borrowed_str<E>(self, v: &'de str) -> std::result::Result<Cow<'de, str>, E> {
        Ok(Cow::Borrowed(v))
    }

    fn visit_str<E>(self, v: &str) -> std::result::Result<Cow<'de, str>, E> {
        Ok(Cow::Owned(v.to_string()))
    }

    fn visit_string<E>(self, v: String) -> std::result::Result<Cow<'de, str>, E> {
        Ok(Cow::Owned(v))
    }
}

/// Consumes the value of the key just read and every entry after it.
fn skip_entries<'de, A: MapAccess<'de>>(mut map: A) -> std::result::Result<(), A::Error> {
    map.next_value::<IgnoredAny>()?;
    while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
    Ok(())
}

fn shrunk<A: Array + 'static>(mut array: A) -> ArrayRef {
    array.shrink_to_fit();
    Arc::new(array)
}

/// JSON number grammar, so a literal `TOKEN_NUMBER` key cannot pass off text as a number.
fn is_json_number(s: &str) -> bool {
    let b = s.as_bytes();
    let mut i = usize::from(b.first() == Some(&b'-'));
    let digits = |i: &mut usize| {
        let start = *i;
        while b.get(*i).is_some_and(u8::is_ascii_digit) {
            *i += 1;
        }
        *i > start
    };
    match b.get(i) {
        Some(b'0') => i += 1,
        Some(b'1'..=b'9') => {
            digits(&mut i);
        }
        _ => return false,
    }
    if b.get(i) == Some(&b'.') {
        i += 1;
        if !digits(&mut i) {
            return false;
        }
    }
    if matches!(b.get(i), Some(b'e' | b'E')) {
        i += 1;
        if matches!(b.get(i), Some(b'+' | b'-')) {
            i += 1;
        }
        if !digits(&mut i) {
            return false;
        }
    }
    i == b.len()
}

#[cfg(test)]
mod tests {
    use arrow::record_batch::RecordBatch;
    use arrow_schema::Field;
    use config::utils::record_batch_ext::convert_json_to_record_batch;

    use super::*;

    const TS: i64 = 1_757_980_800_000_000;
    const RANGE: (i64, i64) = (TS - 3_600_000_000, TS + 3_600_000_000);

    fn schema(fields: &[(&str, DataType)]) -> Schema {
        let mut fields: Vec<Field> = fields
            .iter()
            .map(|(name, data_type)| Field::new(*name, data_type.clone(), true))
            .collect();
        fields.push(Field::new(TIMESTAMP_COL_NAME, DataType::Int64, false));
        Schema::new(fields)
    }

    /// What the JSON path writes for `body`: one batch, its json size, and the input size.
    fn json_path(schema: &Schema, body: &str, flatten_level: u32) -> (RecordBatch, usize, usize) {
        let records: Vec<json::Value> =
            json::from_str(body).unwrap_or_else(|_| vec![json::from_str(body).unwrap()]);
        let (mut rows, mut json_size, mut input_bytes) = (Vec::new(), 0, 0);
        let mut seen = std::collections::HashSet::new();
        for record in records {
            input_bytes += estimate_json_bytes(&record);
            let (value, _) =
                crate::logs::ingest::prepare_record(record, flatten_level, RANGE.0, RANGE.1)
                    .unwrap_or_else(|_| panic!("the JSON path rejects a record of {body}"));
            json_size += estimate_json_bytes(&value);
            for (key, v) in value.as_object().unwrap() {
                if crate::ingestion::inferred_column_type(key, v).is_some() {
                    seen.insert(key.clone());
                }
            }
            rows.push(Arc::new(value));
        }
        let mut fields: Vec<FieldRef> = schema
            .fields()
            .iter()
            .filter(|f| seen.contains(f.name()))
            .cloned()
            .collect();
        fields.sort_by(|a, b| a.name().cmp(b.name()));
        let batch = convert_json_to_record_batch(&Arc::new(Schema::new(fields)), &rows).unwrap();
        (batch, json_size, input_bytes)
    }

    fn columnar_path(
        schema: &Schema,
        body: &str,
        flatten_level: u32,
    ) -> (Vec<json::Value>, JsonColumnar) {
        let mut columnar =
            JsonColumnar::for_schema("logs", schema, flatten_level, RANGE, true).unwrap();
        let unaccepted = columnar.parse(body.as_bytes()).unwrap();
        (unaccepted, columnar)
    }

    fn assert_same_as_json_path(schema: &Schema, body: &str, flatten_level: u32) {
        let (expected, json_size, input_bytes) = json_path(schema, body, flatten_level);
        let (unaccepted, columnar) = columnar_path(schema, body, flatten_level);
        assert!(unaccepted.is_empty(), "{body} fell back: {unaccepted:?}");
        assert_eq!(columnar.input_bytes(), input_bytes, "input bytes of {body}");
        let entries = columnar.into_entries("org").unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].data_size, json_size, "json size of {body}");
        assert_eq!(entries[0].batch.as_ref().unwrap(), &expected, "{body}");
    }

    fn assert_falls_back(schema: &Schema, body: &str) {
        let (unaccepted, columnar) = columnar_path(schema, body, 3);
        assert_eq!(columnar.rows(), 0, "{body}");
        assert_eq!(unaccepted.len(), 1, "{body}");
        assert_eq!(unaccepted[0], json::from_str::<json::Value>(body).unwrap());
    }

    fn logs_schema() -> Schema {
        schema(&[
            ("level", DataType::Utf8),
            ("message", DataType::Utf8),
            ("status", DataType::Int64),
            ("bytes", DataType::UInt64),
            ("ratio", DataType::Float64),
            ("ok", DataType::Boolean),
            ("big", DataType::LargeUtf8),
            ("k8s_pod_name", DataType::Utf8),
            ("k8s_labels_app", DataType::Utf8),
            ("k8s_labels", DataType::Utf8),
            ("tags", DataType::Utf8),
            ("naïve", DataType::Utf8),
            ("_original", DataType::Utf8),
            ("absent", DataType::Utf8),
        ])
    }

    #[test]
    fn test_columnar_path_matches_the_json_path() {
        let schema = logs_schema();
        let bodies = [
            format!(r#"[{{"_timestamp":{TS},"level":"info","message":"a \"quoted\" \\ line"}}]"#),
            format!(r#"{{"_timestamp":{TS},"Level":"warn","status":-3,"bytes":42}}"#),
            format!(
                r#"[{{"_timestamp":{TS},"k8s":{{"pod.name":"p-1","labels":{{"app":"api"}}}},"status":200}},
                   {{"_timestamp":"{TS}","ratio":0.25,"ok":true,"message":null,"absent":null}}]"#
            ),
            format!(r#"[{{"_timestamp":{TS},"ratio":7,"bytes":18446744073709551615,"big":"x"}}]"#),
            format!(r#"[{{"_timestamp":{TS},"tags":["a",1,{{"b":null}}],"empty":[],"obj":{{}}}}]"#),
            format!(r#"[{{"_timestamp":{TS},"message":null,"obj":{{}},"level":"debug"}}]"#),
            format!(r#"[{{"_timestamp":{TS},"NAÏVE":"u","_original":"skip me","ok":false}}]"#),
            format!(r#"[{{"_timestamp":{},"ratio":1e3}}]"#, TS / 1_000_000),
        ];
        for body in &bodies {
            assert_same_as_json_path(&schema, body, 3);
        }
        // at level 2 the labels object is kept whole as a string
        let body = format!(
            r#"[{{"_timestamp":{TS},"k8s":{{"labels":{{"app":"api","v":[1,2]}},"pod_name":"p"}}}}]"#
        );
        assert_same_as_json_path(&schema, &body, 2);
    }

    #[test]
    fn test_columnar_path_hands_back_what_the_json_path_must_decide() {
        let schema = logs_schema();
        let bodies = [
            // a column the schema does not have yet
            format!(r#"{{"_timestamp":{TS},"new_field":"x"}}"#),
            // a value the column would have to be cast or evolved for
            format!(r#"{{"_timestamp":{TS},"status":"200"}}"#),
            format!(r#"{{"_timestamp":{TS},"status":1.5}}"#),
            // keys the flattened map resolves by position and replacement
            format!(r#"{{"_timestamp":{TS},"level":"a","Level":"b"}}"#),
            format!(r#"{{"_timestamp":{TS},"level":"a","level":null,"obj":{{}}}}"#),
            format!(r#"{{"_timestamp":{TS},"k8s":{{"labels":{{"app":"a"}}}},"k8s":{{}}}}"#),
            format!(r#"{{"_timestamp":{TS},"tags":"a","tags":[]}}"#),
            // a DBM record the canonicalizer rewrites
            format!(r#"{{"_timestamp":{TS},"o2_recipe":"pg_blocking_chain"}}"#),
            // a timestamp the window or the parser rejects
            format!(r#"{{"_timestamp":{},"level":"a"}}"#, TS - 7_200_000_000),
            r#"{"_timestamp":true,"level":"a"}"#.to_string(),
            // a record that is not an object
            "[1]".to_string(),
        ];
        for body in &bodies {
            let body = if body.starts_with('[') {
                body.clone()
            } else {
                format!("[{body}]")
            };
            let (unaccepted, columnar) = columnar_path(&schema, &body, 3);
            assert_eq!(columnar.rows(), 0, "{body}");
            let expected: Vec<json::Value> = json::from_str(&body).unwrap();
            assert_eq!(unaccepted, expected, "{body}");
        }
        assert_falls_back(
            &schema,
            &format!(r#"{{"_timestamp":{TS},"o2_dbm_kind":"x"}}"#),
        );
    }

    #[test]
    fn test_columnar_path_keeps_accepted_records_beside_unaccepted_ones() {
        let schema = logs_schema();
        let body = format!(
            r#"[{{"_timestamp":{TS},"level":"a"}},{{"_timestamp":{TS},"nope":1}},{{"_timestamp":{TS},"level":"b"}}]"#
        );
        let (unaccepted, columnar) = columnar_path(&schema, &body, 3);
        assert_eq!(columnar.rows(), 2);
        assert_eq!(unaccepted, vec![json::json!({"_timestamp": TS, "nope": 1})]);
    }

    #[test]
    fn test_columnar_path_declines_a_malformed_body() {
        let schema = logs_schema();
        for body in ["", "[", "[{}", "{} x", "\"text\""] {
            let mut columnar = JsonColumnar::for_schema("logs", &schema, 3, RANGE, true).unwrap();
            assert!(columnar.parse(body.as_bytes()).is_none(), "{body}");
        }
    }

    #[test]
    fn test_columnar_buckets_follow_the_partition_hour() {
        let schema = logs_schema();
        let hour = 3_600_000_000;
        let body = format!(
            r#"[{{"_timestamp":{TS},"level":"a"}},{{"_timestamp":{},"message":"b"}}]"#,
            TS - hour
        );
        let (_, columnar) = columnar_path(&schema, &body, 3);
        let entries = columnar.into_entries("org").unwrap();
        assert_eq!(entries.len(), 2);
        for entry in &entries {
            let batch = entry.batch.as_ref().unwrap();
            assert_eq!(batch.num_rows(), 1);
            // both columns are in the request's batch schema, null where a bucket lacks them
            assert_eq!(batch.num_columns(), 3);
        }
    }

    #[test]
    fn test_num_answers_as_serde_json_number() {
        for text in [
            "0",
            "-0",
            "7",
            "-7",
            "9223372036854775807",
            "9223372036854775808",
            "18446744073709551615",
            "18446744073709551616",
            "-9223372036854775809",
            "1.5",
            "-2.5e-3",
            "1E400",
            "12e2",
        ] {
            let expected: json::Number = text.parse().unwrap();
            let value: json::Value = json::from_str(text).unwrap();
            let json::Value::Number(parsed) = value else {
                panic!("{text}");
            };
            let num = match (parsed.as_u64(), parsed.as_i64()) {
                _ if text.contains(['.', 'e', 'E']) => Num::Text(Cow::Borrowed(text)),
                (Some(u), _) if !text.starts_with('-') => Num::U64(u),
                (_, Some(i)) => Num::I64(i),
                _ => Num::Text(Cow::Borrowed(text)),
            };
            assert_eq!(num.as_i64(), expected.as_i64(), "{text}");
            assert_eq!(num.as_u64(), expected.as_u64(), "{text}");
            assert_eq!(num.as_f64(), expected.as_f64(), "{text}");
            assert_eq!(num.is_f64(), expected.is_f64(), "{text}");
        }
    }

    #[test]
    fn test_is_json_number() {
        for ok in ["0", "-0", "12", "1.25", "-1e5", "3E+2", "0.0e-1"] {
            assert!(is_json_number(ok), "{ok}");
        }
        for bad in ["", "-", "01", "1.", ".5", "1e", "1e+", "abc", "1 "] {
            assert!(!is_json_number(bad), "{bad}");
        }
    }
}
