// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only

mod compact;
mod reader;
mod writer;

use std::{
    collections::{HashMap, HashSet},
    ops::Range,
};

use anyhow::{Result, anyhow, ensure};
use arrow::{
    array::{Array, LargeStringArray, RecordBatch, StringArray, StringViewArray},
    datatypes::{DataType, Schema, SchemaRef},
};
pub use reader::{BlockDecoder, decode_block, decode_index, read_footer};
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

#[derive(Debug, Clone)]
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
pub struct Index {
    pub row_group_size: Option<u32>,
    pub parent: ParentIdentity,
    pub source_schema: SchemaRef,
    pub blocks: Vec<BlockMeta>,
    row_starts: Vec<u64>,
    /// One row per block, containing only requested label columns.
    pub labels: RecordBatch,
}

impl Index {
    pub fn estimated_heap_size(&self) -> usize {
        let schema_bytes =
            serde_json::to_vec(self.source_schema.as_ref()).map_or(MAX_METADATA_BYTES, |v| v.len());
        std::mem::size_of::<Self>()
            .saturating_add(
                self.blocks
                    .capacity()
                    .saturating_mul(std::mem::size_of::<BlockMeta>()),
            )
            .saturating_add(
                self.row_starts
                    .capacity()
                    .saturating_mul(std::mem::size_of::<u64>()),
            )
            .saturating_add(self.parent.object_key.capacity())
            .saturating_add(self.labels.get_array_memory_size())
            .saturating_add(schema_bytes.saturating_mul(2))
            .saturating_add(
                (self.source_schema.fields().len() + self.labels.num_columns()).saturating_mul(512),
            )
    }

    pub fn estimated_directory_size(&self) -> usize {
        self.blocks
            .capacity()
            .saturating_mul(std::mem::size_of::<BlockMeta>())
            .saturating_add(
                self.row_starts
                    .capacity()
                    .saturating_mul(std::mem::size_of::<u64>()),
            )
    }

    pub fn label_value(&self, block: usize, name: &str) -> Result<Option<&str>> {
        ensure!(block < self.blocks.len(), "block index out of bounds");
        let column = self
            .labels
            .column_by_name(name)
            .ok_or_else(|| anyhow!("label was not projected: {name}"))?;
        label_value(column.as_ref(), block)
    }

    pub fn label_values(&self, block: usize, names: &[String]) -> Result<Vec<Option<String>>> {
        ensure!(block < self.blocks.len(), "block index out of bounds");
        names
            .iter()
            .map(|name| {
                let column = self
                    .labels
                    .column_by_name(name)
                    .ok_or_else(|| anyhow!("label was not projected: {name}"))?;
                Ok(label_value(column.as_ref(), block)?.map(str::to_owned))
            })
            .collect()
    }

    pub fn select_blocks(
        &self,
        ranges: Option<&[Range<usize>]>,
        hash_interval: Option<(u64, u64)>,
        time_range: Option<(i64, i64)>,
    ) -> Result<Vec<usize>> {
        ensure!(
            self.row_starts.len() == self.blocks.len(),
            "row lookup/descriptor count mismatch"
        );
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
                .row_starts
                .binary_search(&range.start)
                .map_err(|_| anyhow!("selection starts inside a sample block"))?;
            let end = if range.end == self.parent.rows {
                self.blocks.len()
            } else {
                self.row_starts
                    .binary_search(&range.end)
                    .map_err(|_| anyhow!("selection ends inside a sample block"))?
            };
            ensure!(start < end, "empty block selection");
            ensure!(
                self.blocks[start].row_start == range.start
                    && (end == self.blocks.len() || self.blocks[end].row_start == range.end),
                "row lookup/descriptor endpoint mismatch"
            );
            ensure!(
                start == 0 || self.blocks[start - 1].hash != self.blocks[start].hash,
                "selection starts inside a source series"
            );
            ensure!(
                end == self.blocks.len() || self.blocks[end - 1].hash != self.blocks[end].hash,
                "selection ends inside a source series"
            );
            selected_spans.push(start..end);
        }
        let hash_span = match hash_interval {
            Some((lo, hi)) if lo <= hi => {
                self.blocks.partition_point(|b| b.hash < lo)
                    ..self.blocks.partition_point(|b| b.hash <= hi)
            }
            Some(_) => 0..0,
            None => 0..self.blocks.len(),
        };
        let mut result = Vec::new();
        for span in selected_spans {
            let start = span.start.max(hash_span.start);
            let end = span.end.min(hash_span.end);
            for (index, block) in self.blocks[start.min(end)..end].iter().enumerate() {
                if time_range.is_none_or(|(lo, hi)| {
                    lo <= hi && block.min_timestamp <= hi && block.max_timestamp >= lo
                }) {
                    result.push(start + index);
                }
            }
        }
        Ok(result)
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

/// Only immutable indexed Parquet metrics objects can own this container.
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
    let id = name.strip_prefix("indexed-v1-")?.strip_suffix(".parquet")?;
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
