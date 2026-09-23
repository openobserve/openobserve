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
    ops::Range,
};

use anyhow::{Result, anyhow, ensure};
use arrow::{
    array::{Array, DictionaryArray, LargeStringArray, RecordBatch, StringArray, StringViewArray},
    datatypes::{DataType, Schema, SchemaRef, UInt8Type, UInt16Type, UInt32Type},
};
pub use directory::{BlockDirectory, BlockIter};
pub use reader::{BlockDecoder, decode_block, decode_index, read_footer};
use serde::{Deserialize, Serialize};
pub use writer::BlockWriter;

pub const VERSION: u32 = 2;
pub const FOOTER_LEN: usize = 32;
pub const MAX_BLOCK_ROWS: usize = 8192;
pub const MAX_LABEL_COLUMNS: usize = 128;
const MAGIC: &[u8; 8] = b"O2MIDX02";
const DIRECTORY_FIELDS: usize = 8;
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

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ParentMetadata {
    pub rows: u64,
    pub compressed_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Footer {
    pub version: u32,
    pub metadata_range: Range<u64>,
    pub payload_end: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockMeta {
    pub hash: u64,
    pub row_start: u64,
    pub row_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
    pub block_offset: u64,
    pub block_length: u32,
    pub strictly_increasing: bool,
}

impl BlockMeta {
    /// Metadata validation establishes that this addition cannot overflow.
    pub fn block_range(&self) -> Range<u64> {
        self.block_offset
            ..self
                .block_offset
                .saturating_add(u64::from(self.block_length))
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
    pub parent: ParentMetadata,
    pub source_schema: SchemaRef,
    pub blocks: BlockDirectory,
    pub labels: RecordBatch,
    missing: Vec<String>,
}

impl Index {
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
}

/// Bounds scratch space before allocating or decoding one sample block.
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
    ensure!(condition, "metrics block capacity limit: {message}");
    Ok(())
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
