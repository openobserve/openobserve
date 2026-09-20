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

mod compact;
mod directory;
mod reader;
mod writer;

use std::{
    collections::{HashMap, HashSet},
    ops::{Deref, Range},
    sync::Arc,
};

use anyhow::{Result, anyhow, ensure};
use arrow::{
    array::{
        Array, DictionaryArray, LargeStringArray, RecordBatch, RecordBatchOptions, StringArray,
        StringViewArray,
    },
    datatypes::{DataType, Schema, SchemaRef, UInt8Type, UInt16Type, UInt32Type},
};
pub use directory::{BlockDirectory, BlockIter};
pub use reader::{BlockDecoder, decode_additional_labels, decode_block, decode_index, read_footer};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
pub use writer::{BlockWriter, build_from_parquet};

pub const VERSION: u32 = 1;
pub const FOOTER_LEN: usize = 64;
pub const MAX_BLOCK_ROWS: usize = 8192;
pub const MAX_METADATA_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_WRITER_METADATA_BYTES: usize = 256 * 1024 * 1024;
pub const MAX_BLOCKS: usize = 1_000_000;
pub const MAX_LABEL_COLUMNS: usize = 128;
const MAGIC: &[u8; 8] = b"O2MIDX01";
const DIRECTORY_FIELDS: usize = 9;
const PARENT_KEY: &str = "o2:midx_parent";
const SCHEMA_KEY: &str = "o2:midx_source_schema";
const LABELS_KEY: &str = "o2:midx_labels";
pub const ROW_GROUP_SIZE_KEY: &str = "o2:midx_row_group_size";
const VERSION_KEY: &str = "o2:midx_version";
const NON_IDENTITY: &[&str] = &[
    "exemplars",
    "is_monotonic",
    "trace_id",
    "span_id",
    "_all",
    "start_time",
    "flag",
];

/// A declared format capacity was exceeded by otherwise eligible input.
#[derive(Debug)]
pub struct FormatLimit {
    message: &'static str,
}
impl std::fmt::Display for FormatLimit {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "metrics block capacity limit: {}", self.message)
    }
}
impl std::error::Error for FormatLimit {}

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ParentIdentity {
    pub object_key: String,
    pub rows: u64,
    pub compressed_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Footer {
    pub version: u32,
    pub metadata_range: Range<u64>,
    metadata_checksum: [u8; 32],
    pub payload_end: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockMeta {
    pub hash: u64,
    pub row_start: u64,
    pub row_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
    pub payload_offset: u64,
    pub payload_len: u32,
    pub strictly_increasing: bool,
    pub checksum: [u8; 32],
}

impl BlockMeta {
    /// Metadata validation establishes that this addition cannot overflow.
    pub fn payload_range(&self) -> Range<u64> {
        self.payload_offset
            ..self
                .payload_offset
                .saturating_add(u64::from(self.payload_len))
    }
}

#[derive(Debug)]
pub struct DecodedBlock {
    pub timestamps: Vec<i64>,
    pub value_bits: Vec<u64>,
}

#[derive(Debug)]
pub struct DecodedBlockRef<'a> {
    pub timestamps: &'a [i64],
    pub value_bits: &'a [u64],
}

#[derive(Debug)]
pub struct IndexBase {
    pub row_group_size: Option<u32>,
    pub parent: ParentIdentity,
    pub source_schema: SchemaRef,
    pub blocks: BlockDirectory,
    footer: Footer,
}

#[derive(Debug)]
pub struct Index {
    pub base: Arc<IndexBase>,
    pub labels: RecordBatch,
    missing: Vec<String>,
}

impl Index {
    pub fn estimated_heap_size(&self) -> usize {
        let schema_bytes =
            serde_json::to_vec(self.source_schema.as_ref()).map_or(MAX_METADATA_BYTES, |v| v.len());
        std::mem::size_of::<Self>()
            .saturating_add(std::mem::size_of::<IndexBase>())
            .saturating_add(32)
            .saturating_add(self.blocks.allocated_bytes())
            .saturating_add(self.parent.object_key.capacity())
            .saturating_add(self.labels.get_array_memory_size())
            .saturating_add(self.missing.capacity() * std::mem::size_of::<String>())
            .saturating_add(self.missing.iter().map(String::capacity).sum::<usize>())
            .saturating_add(schema_bytes.saturating_mul(2))
            .saturating_add(
                (self.source_schema.fields().len() + self.labels.num_columns()).saturating_mul(512),
            )
    }

    pub fn estimated_directory_size(&self) -> usize {
        self.blocks.allocated_bytes()
    }

    pub fn missing_labels(&self, names: &[String]) -> Result<Vec<String>> {
        ensure!(
            names.len() <= MAX_LABEL_COLUMNS,
            "too many requested labels"
        );
        let mut missing = Vec::new();
        for name in names {
            let Ok(field) = self.source_schema.field_with_name(name) else {
                continue;
            };
            ensure!(
                is_label_type(field.data_type()),
                "requested source field lacks identity label metadata"
            );
            if self.labels.column_by_name(name).is_none() && !missing.contains(name) {
                missing.push(name.clone());
            }
        }
        Ok(missing)
    }

    pub fn project(&self, names: &[String]) -> Result<Self> {
        ensure!(
            self.missing_labels(names)?.is_empty(),
            "requested label column not loaded"
        );
        let schema = self.labels.schema();
        let mut fields = Vec::new();
        let mut columns = Vec::new();
        for name in names {
            if fields
                .iter()
                .any(|field: &Arc<arrow::datatypes::Field>| field.name() == name)
            {
                continue;
            }
            if let Ok(index) = schema.index_of(name) {
                fields.push(Arc::clone(&schema.fields()[index]));
                columns.push(Arc::clone(self.labels.column(index)));
            }
        }
        Ok(Self {
            base: Arc::clone(&self.base),
            missing: names
                .iter()
                .filter(|name| self.source_schema.field_with_name(name).is_err())
                .cloned()
                .collect(),
            labels: RecordBatch::try_new_with_options(
                Arc::new(Schema::new(fields)),
                columns,
                &RecordBatchOptions::new().with_row_count(Some(self.blocks.len())),
            )?,
        })
    }

    pub fn merge_columns(&self, other: &Self) -> Result<Self> {
        ensure!(
            Arc::ptr_eq(&self.base, &other.base)
                || (self.base.footer == other.base.footer
                    && self.parent == other.parent
                    && self.source_schema == other.source_schema
                    && self.row_group_size == other.row_group_size),
            "cannot mix metadata bindings"
        );
        let mut fields = self.labels.schema().fields().to_vec();
        let mut columns = self.labels.columns().to_vec();
        for (field, column) in other
            .labels
            .schema()
            .fields()
            .iter()
            .zip(other.labels.columns())
        {
            if self.labels.column_by_name(field.name()).is_none() {
                fields.push(Arc::clone(field));
                columns.push(Arc::clone(column));
            }
        }
        Ok(Self {
            base: Arc::clone(&self.base),
            missing: Vec::new(),
            labels: RecordBatch::try_new_with_options(
                Arc::new(Schema::new(fields)),
                columns,
                &RecordBatchOptions::new().with_row_count(Some(self.blocks.len())),
            )?,
        })
    }

    pub fn for_cache(mut self) -> Self {
        self.missing = Vec::new();
        self
    }

    #[inline]
    pub fn label_value(&self, block: usize, name: &str) -> Result<Option<&str>> {
        ensure!(block < self.blocks.len(), "block index out of bounds");
        let Some(column) = self.labels.column_by_name(name) else {
            ensure!(
                self.missing.iter().any(|missing| missing == name),
                "label was not projected: {name}"
            );
            return Ok(None);
        };
        label_value(column.as_ref(), block)
    }

    pub fn label_values(&self, block: usize, names: &[String]) -> Result<Vec<Option<String>>> {
        names
            .iter()
            .map(|name| {
                self.label_value(block, name)
                    .map(|value| value.map(str::to_owned))
            })
            .collect()
    }

    pub fn select_blocks(
        &self,
        ranges: Option<&[Range<usize>]>,
        hash_interval: Option<(u64, u64)>,
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<usize>> {
        let mut normalized: Vec<Range<u64>> = Vec::new();
        if let Some(ranges) = ranges {
            ensure!(ranges.len() <= MAX_BLOCKS, "too many selection ranges");
            for range in ranges {
                let start = u64::try_from(range.start)?;
                let end = u64::try_from(range.end)?;
                ensure!(
                    start < end && end <= self.parent.rows,
                    "selection range out of bounds"
                );
                if let Some(last) = normalized.last_mut() {
                    ensure!(
                        last.end <= start,
                        "selection ranges overlap or are unsorted"
                    );
                    if last.end == start {
                        last.end = end;
                        continue;
                    }
                }
                normalized.push(start..end);
            }
        } else if self.parent.rows > 0 {
            normalized.push(0..self.parent.rows);
        }
        let mut selected_spans = Vec::with_capacity(normalized.len());
        for range in normalized {
            let start = self
                .blocks
                .row_boundary(range.start)
                .map_err(|_| anyhow!("selection starts inside a sample block"))?;
            let end = if range.end == self.parent.rows {
                self.blocks.len()
            } else {
                self.blocks
                    .row_boundary(range.end)
                    .map_err(|_| anyhow!("selection ends inside a sample block"))?
            };
            ensure!(start < end, "empty block selection");
            ensure!(
                self.blocks.row_start(start) == range.start
                    && (end == self.blocks.len() || self.blocks.row_start(end) == range.end),
                "row lookup/descriptor endpoint mismatch"
            );
            ensure!(
                start == 0 || self.blocks.hash(start - 1) != self.blocks.hash(start),
                "selection starts inside a source series"
            );
            ensure!(
                end == self.blocks.len() || self.blocks.hash(end - 1) != self.blocks.hash(end),
                "selection ends inside a source series"
            );
            selected_spans.push(start..end);
        }
        let hash_span = match hash_interval {
            Some((lo, hi)) if lo <= hi => {
                self.blocks.hash_partition_point(|hash| hash < lo)
                    ..self.blocks.hash_partition_point(|hash| hash <= hi)
            }
            Some(_) => 0..0,
            None => 0..self.blocks.len(),
        };
        let mut result = Vec::new();
        for span in selected_spans {
            let start = span.start.max(hash_span.start);
            let end = span.end.min(hash_span.end);
            for index in start..end {
                if time_range.is_none_or(|(lo, hi)| self.blocks.overlaps_time(index, lo, hi)) {
                    result.push(index);
                }
            }
        }
        Ok(result)
    }
}

impl Deref for Index {
    type Target = IndexBase;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

pub fn is_format_limit_error(error: &anyhow::Error) -> bool {
    error.is::<FormatLimit>()
}

/// Upper bound for a single v1 independently compressed sample payload.
pub fn max_compressed_block_len(row_count: u32) -> Result<usize> {
    ensure!(
        row_count > 0 && row_count as usize <= MAX_BLOCK_ROWS,
        "invalid block row count"
    );
    let raw = usize::try_from(row_count)?
        .checked_mul(16)
        .ok_or_else(|| anyhow!("block size overflow"))?;
    Ok(zstd::zstd_safe::compress_bound(raw))
}

/// Only immutable indexed metrics objects with a supported source format can own this container.
pub fn sidecar_path(parent_key: &str) -> Option<String> {
    let mut parts: Vec<_> = parent_key.split('/').map(str::to_owned).collect();
    if parts.len() < 9
        || parts[0] != "files"
        || parts[2] != "metrics"
        || parts
            .iter()
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return None;
    }
    let name = parts.last()?;
    let name = name.strip_prefix("indexed-v1-")?;
    let id = name
        .strip_suffix(".parquet")
        .or_else(|| name.strip_suffix(".vortex"))?;
    if id.is_empty() {
        return None;
    }
    let result_name = format!("indexed-v1-{id}.midx");
    parts[2] = "midx".to_owned();
    *parts.last_mut()? = result_name;
    Some(parts.join("/"))
}

pub fn identity_label_columns(schema: &Schema) -> Result<Vec<String>> {
    capacity(
        schema.fields().len() <= MAX_LABEL_COLUMNS + 3,
        "MAX_LABEL_COLUMNS",
    )?;
    // Check static metadata/name size before cloning any field names below.
    writer::encoded_size(schema, MAX_METADATA_BYTES / 4)?;
    let mut names = HashSet::new();
    ensure!(
        schema
            .fields()
            .iter()
            .all(|field| names.insert(field.name())),
        "duplicate source field names"
    );
    for (name, expected) in [
        ("__hash__", DataType::UInt64),
        ("_timestamp", DataType::Int64),
        ("value", DataType::Float64),
    ] {
        ensure!(
            schema.field_with_name(name)?.data_type() == &expected,
            "unsupported sample column {name}"
        );
    }
    let mut labels = Vec::new();
    for field in schema.fields() {
        let name = field.name().as_str();
        if ["__hash__", "_timestamp", "value"].contains(&name) {
            continue;
        }
        ensure!(
            !name.starts_with("__oo_midx_"),
            "reserved metadata label name"
        );
        ensure!(
            !NON_IDENTITY.contains(&name),
            "unsupported per-point column {name}"
        );
        ensure!(
            is_label_type(field.data_type()),
            "unsupported label type for {name}"
        );
        labels.push(name.to_owned());
    }
    capacity(labels.len() <= MAX_LABEL_COLUMNS, "MAX_LABEL_COLUMNS")?;
    Ok(labels)
}

pub fn is_supported_schema(schema: &Schema) -> bool {
    identity_label_columns(schema).is_ok()
}

fn capacity(condition: bool, message: &'static str) -> Result<()> {
    if condition {
        Ok(())
    } else {
        Err(FormatLimit { message }.into())
    }
}

fn is_label_type(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View
    )
}

fn label_value(array: &dyn Array, row: usize) -> Result<Option<&str>> {
    ensure!(row < array.len(), "label row out of bounds");
    if array.is_null(row) {
        return Ok(None);
    }
    if let Some(a) = array.as_any().downcast_ref::<StringArray>() {
        return Ok(Some(a.value(row)));
    }
    if let Some(a) = array.as_any().downcast_ref::<LargeStringArray>() {
        return Ok(Some(a.value(row)));
    }
    if let Some(a) = array.as_any().downcast_ref::<StringViewArray>() {
        return Ok(Some(a.value(row)));
    }
    if let Some(array) = array.as_any().downcast_ref::<DictionaryArray<UInt8Type>>() {
        return label_value(
            array.values().as_ref(),
            usize::from(array.keys().value(row)),
        );
    }
    if let Some(array) = array.as_any().downcast_ref::<DictionaryArray<UInt16Type>>() {
        return label_value(
            array.values().as_ref(),
            usize::from(array.keys().value(row)),
        );
    }
    if let Some(array) = array.as_any().downcast_ref::<DictionaryArray<UInt32Type>>() {
        return label_value(array.values().as_ref(), array.keys().value(row) as usize);
    }
    Err(anyhow!("unsupported identity label array"))
}

fn checksum(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

fn semantic_metadata(schema: &Schema) -> HashMap<String, String> {
    schema
        .metadata()
        .iter()
        .filter(|(key, _)| {
            !["min_ts", "max_ts", "records", "original_size"].contains(&key.as_str())
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn schema_matches(a: &Schema, b: &Schema) -> bool {
    a.fields() == b.fields() && semantic_metadata(a) == semantic_metadata(b)
}

#[cfg(test)]
mod tests;
