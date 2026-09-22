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
    collections::{HashMap, HashSet},
    io::Write,
    sync::Arc,
};

use anyhow::{Context, Result, anyhow, ensure};
use arrow::{
    array::{
        Array, ArrayRef, BooleanArray, Float64Array, Int64Array, LargeStringArray, RecordBatch,
        RecordBatchOptions, StringArray, StringViewArray, UInt32Array, UInt64Array,
    },
    datatypes::{DataType, Field, Schema, SchemaRef},
};
use parquet::{
    arrow::arrow_reader::{ArrowReaderMetadata, ArrowReaderOptions},
    file::metadata::ParquetMetaData,
};

use crate::*;

pub struct BlockWriter<W: Write> {
    output: W,
    schema: SchemaRef,
    parent: Option<ParentMetadata>,
    label_indices: Vec<usize>,
    hash_index: usize,
    time_index: usize,
    value_index: usize,
    max_block_rows: usize,
    previous: Option<(u64, i64)>,
    current_hash: Option<u64>,
    current_labels: Vec<Option<String>>,
    timestamps: Vec<i64>,
    values: Vec<u64>,
    rows: u64,
    offset: u64,
    blocks: Vec<BlockMeta>,
    labels: Vec<Vec<Option<String>>>,
    writer_metadata_estimate: usize,
    static_metadata_estimate: usize,
    metadata_properties: HashMap<String, String>,
    current_block_charge: usize,
    failed: bool,
}

impl<W: Write> BlockWriter<W> {
    pub fn new(
        output: W,
        schema: SchemaRef,
        label_columns: Vec<String>,
        parent: ParentMetadata,
        max_block_rows: usize,
    ) -> Result<Self> {
        Self::new_inner(output, schema, label_columns, Some(parent), max_block_rows)
    }

    /// Parent metadata is required before metadata or a footer can be emitted.
    pub fn new_pending(output: W, schema: SchemaRef, max_block_rows: usize) -> Result<Self> {
        let labels = identity_label_columns(&schema)?;
        Self::new_inner(output, schema, labels, None, max_block_rows)
    }

    pub fn finish_for_parquet(
        self,
        parent: ParentMetadata,
        metadata: ParquetMetaData,
    ) -> Result<W> {
        ensure!(
            u64::try_from(metadata.file_metadata().num_rows())? == parent.rows,
            "Parquet parent row count mismatch"
        );
        let row_group_size =
            verified_row_group_size(&metadata)?.context("unsupported Parquet row-group layout")?;
        let stored =
            ArrowReaderMetadata::try_new(Arc::new(metadata), ArrowReaderOptions::default())?;
        self.finish_for_source(parent, Arc::clone(stored.schema()), Some(row_group_size))
    }

    /// The container adapter must verify the completed file before supplying its source facts.
    pub fn finish_for_source(
        mut self,
        parent: ParentMetadata,
        stored_schema: SchemaRef,
        row_group_size: Option<u32>,
    ) -> Result<W> {
        validate_parent(&parent)?;
        ensure!(
            self.parent.as_ref().is_none_or(|known| known == &parent),
            "parent metadata changed"
        );
        ensure!(self.rows == parent.rows, "source/parent row count mismatch");
        ensure!(row_group_size != Some(0), "invalid parent row group size");
        ensure!(
            schema_matches(&self.schema, &stored_schema),
            "stored source schema changed"
        );
        let labels = self
            .label_indices
            .iter()
            .map(|i| self.schema.field(*i).name().clone())
            .collect::<Vec<_>>();
        let charge =
            static_metadata_charge(&stored_schema, Some(&parent), &labels, MAX_METADATA_BYTES)?;
        let estimate = self
            .writer_metadata_estimate
            .checked_sub(self.static_metadata_estimate)
            .and_then(|size| size.checked_add(charge))
            .context("metadata accounting overflow")?;
        capacity(
            estimate <= MAX_WRITER_METADATA_BYTES,
            "MAX_WRITER_METADATA_BYTES",
        )?;
        self.writer_metadata_estimate = estimate;
        self.static_metadata_estimate = charge;
        self.schema = stored_schema;
        self.metadata_properties
            .insert(PARENT_KEY.to_owned(), serde_json::to_string(&parent)?);
        self.metadata_properties
            .insert(SCHEMA_KEY.to_owned(), canonical_schema_json(&self.schema)?);
        if let Some(size) = row_group_size {
            self.metadata_properties
                .insert(ROW_GROUP_SIZE_KEY.to_owned(), size.to_string());
        } else {
            self.metadata_properties.remove(ROW_GROUP_SIZE_KEY);
        }
        self.parent = Some(parent);
        self.finish()
    }

    pub fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        ensure!(!self.failed, "writer is poisoned by an earlier failure");
        let result = self.write_inner(batch);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    pub fn finish(mut self) -> Result<W> {
        ensure!(!self.failed, "writer is poisoned");
        ensure!(
            self.rows
                == self
                    .parent
                    .as_ref()
                    .context("parent metadata is not bound")?
                    .rows,
            "source/parent row count mismatch"
        );
        self.flush_block()?;
        self.current_labels.clear();
        let batch = self.metadata_batch()?;
        let metadata = crate::compact::encode(&batch)?;
        capacity(metadata.len() <= MAX_METADATA_BYTES, "MAX_METADATA_BYTES")?;
        let metadata_len = u64::try_from(metadata.len())?;
        let mut footer = [0u8; FOOTER_LEN];
        footer[..4].copy_from_slice(&VERSION.to_le_bytes());
        footer[8..16].copy_from_slice(&self.offset.to_le_bytes());
        footer[16..24].copy_from_slice(&metadata_len.to_le_bytes());
        footer[24..].copy_from_slice(MAGIC);
        self.output.write_all(&metadata)?;
        self.output.write_all(&footer[..24])?;
        self.output.flush()?;
        self.output.write_all(&footer[24..])?;
        self.output.flush()?;
        Ok(self.output)
    }

    fn new_inner(
        output: W,
        schema: SchemaRef,
        label_columns: Vec<String>,
        parent: Option<ParentMetadata>,
        max_block_rows: usize,
    ) -> Result<Self> {
        if let Some(parent) = &parent {
            validate_parent(parent)?;
        }
        capacity(
            schema.fields().len() <= MAX_LABEL_COLUMNS + 3 + NON_IDENTITY.len(),
            "MAX_LABEL_COLUMNS",
        )?;
        ensure!(
            max_block_rows > 0 && max_block_rows <= MAX_BLOCK_ROWS,
            "invalid max block rows"
        );
        capacity(
            label_columns.len() <= MAX_LABEL_COLUMNS,
            "MAX_LABEL_COLUMNS",
        )?;
        let writer_metadata_estimate =
            static_metadata_charge(&schema, parent.as_ref(), &label_columns, MAX_METADATA_BYTES)?;
        capacity(
            writer_metadata_estimate <= MAX_WRITER_METADATA_BYTES,
            "MAX_WRITER_METADATA_BYTES",
        )?;
        let mut metadata_properties: HashMap<String, String> = [
            (VERSION_KEY.to_owned(), VERSION.to_string()),
            (
                SCHEMA_KEY.to_owned(),
                canonical_schema_json(schema.as_ref())?,
            ),
            (
                LABELS_KEY.to_owned(),
                serde_json::to_string(&label_columns)?,
            ),
        ]
        .into_iter()
        .collect();
        if let Some(parent) = &parent {
            metadata_properties.insert(PARENT_KEY.to_owned(), serde_json::to_string(parent)?);
        }
        let source_labels = identity_label_columns(&schema)?;
        ensure!(
            source_labels.len() == label_columns.len()
                && source_labels
                    .iter()
                    .all(|label| label_columns.contains(label)),
            "incomplete source identity labels"
        );
        let mut seen = HashSet::new();
        let mut label_indices = Vec::new();
        for label in &label_columns {
            ensure!(seen.insert(label.clone()), "duplicate label column");
            ensure!(
                !["__hash__", "_timestamp", "value"].contains(&label.as_str()),
                "sample column cannot be an identity label"
            );
            let index = schema.index_of(label)?;
            ensure!(
                is_label_type(schema.field(index).data_type()),
                "unsupported label type"
            );
            ensure!(
                !label.starts_with("__oo_midx_"),
                "reserved metadata label name"
            );
            label_indices.push(index);
        }
        let hash_index = schema.index_of("__hash__")?;
        let time_index = schema.index_of("_timestamp")?;
        let value_index = schema.index_of("value")?;
        ensure!(
            schema.field(hash_index).data_type() == &DataType::UInt64,
            "hash type"
        );
        ensure!(
            schema.field(time_index).data_type() == &DataType::Int64,
            "timestamp type"
        );
        ensure!(
            schema.field(value_index).data_type() == &DataType::Float64,
            "value type"
        );
        Ok(Self {
            output,
            schema,
            parent,
            label_indices,
            hash_index,
            time_index,
            value_index,
            max_block_rows,
            previous: None,
            current_hash: None,
            current_labels: Vec::new(),
            timestamps: Vec::with_capacity(max_block_rows),
            values: Vec::with_capacity(max_block_rows),
            rows: 0,
            offset: 0,
            blocks: Vec::new(),
            labels: Vec::new(),
            writer_metadata_estimate,
            static_metadata_estimate: writer_metadata_estimate,
            metadata_properties,
            current_block_charge: 0,
            failed: false,
        })
    }

    fn write_inner(&mut self, batch: &RecordBatch) -> Result<()> {
        ensure!(
            schema_matches(self.schema.as_ref(), batch.schema().as_ref()),
            "source schema changed"
        );
        let hashes = batch
            .column(self.hash_index)
            .as_any()
            .downcast_ref::<UInt64Array>()
            .context("hash array type")?;
        let times = batch
            .column(self.time_index)
            .as_any()
            .downcast_ref::<Int64Array>()
            .context("timestamp array type")?;
        let values = batch
            .column(self.value_index)
            .as_any()
            .downcast_ref::<Float64Array>()
            .context("value array type")?;
        ensure!(
            hashes.null_count() == 0 && times.null_count() == 0 && values.null_count() == 0,
            "nullable samples unsupported"
        );
        for row in 0..batch.num_rows() {
            let hash = hashes.value(row);
            let timestamp = times.value(row);
            ensure!(
                self.previous
                    .is_none_or(|previous| previous <= (hash, timestamp)),
                "source hash/timestamp order decreased"
            );
            if self.current_hash != Some(hash) {
                self.flush_block()?;
                let borrowed = self
                    .label_indices
                    .iter()
                    .map(|index| label_value(batch.column(*index).as_ref(), row))
                    .collect::<Result<Vec<_>>>()?;
                let charge = block_metadata_charge(borrowed.iter().copied())?;
                self.admit_block(charge)?;
                // Admission happens while values are still borrowed from the input batch.
                self.current_labels = borrowed.into_iter().map(|v| v.map(str::to_owned)).collect();
                self.current_block_charge = charge;
                self.current_hash = Some(hash);
            } else {
                for (index, expected) in self.label_indices.iter().zip(&self.current_labels) {
                    ensure!(
                        label_value(batch.column(*index).as_ref(), row)? == expected.as_deref(),
                        "identity label changes within one series hash"
                    );
                }
            }
            if self.timestamps.is_empty() {
                self.admit_block(self.current_block_charge)?;
            }
            ensure!(
                self.parent
                    .as_ref()
                    .is_none_or(|parent| self.rows < parent.rows),
                "source exceeds parent row count"
            );
            self.timestamps.push(timestamp);
            self.values.push(values.value(row).to_bits());
            self.rows = self.rows.checked_add(1).context("row count overflow")?;
            self.previous = Some((hash, timestamp));
            if self.timestamps.len() == self.max_block_rows {
                self.flush_block()?;
            }
        }
        Ok(())
    }

    fn admit_block(&self, charge: usize) -> Result<()> {
        capacity(self.blocks.len() < MAX_BLOCKS, "MAX_BLOCKS")?;
        capacity(
            self.writer_metadata_estimate
                .checked_add(charge)
                .is_some_and(|n| n <= MAX_WRITER_METADATA_BYTES),
            "MAX_WRITER_METADATA_BYTES",
        )
    }

    fn flush_block(&mut self) -> Result<()> {
        if self.timestamps.is_empty() {
            return Ok(());
        }
        self.admit_block(self.current_block_charge)?;
        self.writer_metadata_estimate = self
            .writer_metadata_estimate
            .checked_add(self.current_block_charge)
            .context("metadata accounting overflow")?;
        let count = self.timestamps.len();
        let raw_size = count.checked_mul(16).context("sample bytes overflow")?;
        let mut raw = Vec::with_capacity(raw_size);
        raw.extend_from_slice(&self.timestamps[0].to_le_bytes());
        for pair in self.timestamps.windows(2) {
            raw.extend_from_slice(&pair[1].wrapping_sub(pair[0]).to_le_bytes());
        }
        for byte in 0..8 {
            for value in &self.values {
                raw.push((value >> (byte * 8)) as u8);
            }
        }
        let payload = zstd::bulk::compress(&raw, 1)?;
        let payload_len = u32::try_from(payload.len())?;
        ensure!(
            payload.len() <= max_compressed_block_len(u32::try_from(count)?)?,
            "compressed block exceeds format bound"
        );
        let meta = BlockMeta {
            hash: self.current_hash.context("missing series hash")?,
            row_start: self
                .rows
                .checked_sub(u64::try_from(count)?)
                .context("row start underflow")?,
            row_count: u32::try_from(count)?,
            min_timestamp: self.timestamps[0],
            max_timestamp: self.timestamps[count - 1],
            payload_offset: self.offset,
            payload_len,
            strictly_increasing: self.timestamps.windows(2).all(|w| w[0] < w[1]),
        };
        self.offset = self
            .offset
            .checked_add(u64::from(payload_len))
            .context("payload offset overflow")?;
        self.output.write_all(&payload)?;
        self.blocks.push(meta);
        self.labels.push(self.current_labels.clone());
        self.timestamps.clear();
        self.values.clear();
        Ok(())
    }

    fn metadata_batch(&self) -> Result<RecordBatch> {
        let fields = vec![
            Field::new("__oo_midx_hash", DataType::UInt64, false),
            Field::new("__oo_midx_row_start", DataType::UInt64, false),
            Field::new("__oo_midx_row_count", DataType::UInt32, false),
            Field::new("__oo_midx_min_ts", DataType::Int64, false),
            Field::new("__oo_midx_max_ts", DataType::Int64, false),
            Field::new("__oo_midx_offset", DataType::UInt64, false),
            Field::new("__oo_midx_length", DataType::UInt32, false),
            Field::new("__oo_midx_strict", DataType::Boolean, false),
        ];
        let mut fields: Vec<_> = fields.into_iter().map(Arc::new).collect();
        let mut columns: Vec<ArrayRef> = vec![
            Arc::new(UInt64Array::from_iter_values(
                self.blocks.iter().map(|b| b.hash),
            )),
            Arc::new(UInt64Array::from_iter_values(
                self.blocks.iter().map(|b| b.row_start),
            )),
            Arc::new(UInt32Array::from_iter_values(
                self.blocks.iter().map(|b| b.row_count),
            )),
            Arc::new(Int64Array::from_iter_values(
                self.blocks.iter().map(|b| b.min_timestamp),
            )),
            Arc::new(Int64Array::from_iter_values(
                self.blocks.iter().map(|b| b.max_timestamp),
            )),
            Arc::new(UInt64Array::from_iter_values(
                self.blocks.iter().map(|b| b.payload_offset),
            )),
            Arc::new(UInt32Array::from_iter_values(
                self.blocks.iter().map(|b| b.payload_len),
            )),
            Arc::new(BooleanArray::from(
                self.blocks
                    .iter()
                    .map(|b| b.strictly_increasing)
                    .collect::<Vec<_>>(),
            )),
        ];
        for (j, index) in self.label_indices.iter().enumerate() {
            let field = self.schema.field(*index);
            fields.push(Arc::new(field.clone()));
            let values = self.labels.iter().map(|row| row[j].as_deref());
            let column: ArrayRef = match field.data_type() {
                DataType::Utf8 => Arc::new(StringArray::from_iter(values)),
                DataType::LargeUtf8 => Arc::new(LargeStringArray::from_iter(values)),
                DataType::Utf8View => Arc::new(StringViewArray::from_iter(values)),
                _ => return Err(anyhow!("unsupported label type")),
            };
            columns.push(column);
        }
        let metadata = self.metadata_properties.clone();
        let schema = Arc::new(Schema::new_with_metadata(fields, metadata));
        Ok(RecordBatch::try_new_with_options(
            schema,
            columns,
            &RecordBatchOptions::new().with_row_count(Some(self.blocks.len())),
        )?)
    }
}

struct CountingMetadata {
    bytes: usize,
    limit: usize,
    exceeded: bool,
}
impl Write for CountingMetadata {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let next = self.bytes.checked_add(bytes.len());
        if !next.is_some_and(|n| n <= self.limit) {
            self.exceeded = true;
            return Err(std::io::Error::other(FormatLimit {
                message: "MAX_METADATA_BYTES",
            }));
        }
        self.bytes = next.unwrap();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(super) fn encoded_size(value: &impl serde::Serialize, limit: usize) -> Result<usize> {
    let mut counter = CountingMetadata {
        bytes: 0,
        limit,
        exceeded: false,
    };
    let result = serde_json::to_writer(&mut counter, value);
    capacity(!counter.exceeded, "MAX_METADATA_BYTES")?;
    result?;
    Ok(counter.bytes)
}

fn validate_parent(parent: &ParentMetadata) -> Result<()> {
    ensure!(
        parent.rows > 0 && parent.compressed_size > 0,
        "empty parent unsupported"
    );
    Ok(())
}

fn verified_row_group_size(metadata: &ParquetMetaData) -> Result<Option<u32>> {
    let groups = metadata.row_groups();
    let Some(first) = groups.first() else {
        return Ok(None);
    };
    let size = u32::try_from(first.num_rows())?;
    let rows = groups.iter().try_fold(0i64, |sum, group| {
        sum.checked_add(group.num_rows())
            .context("Parquet row-group count overflow")
    })?;
    ensure!(
        rows == metadata.file_metadata().num_rows(),
        "Parquet row groups do not cover parent rows"
    );
    Ok((size > 0
        && groups.iter().enumerate().all(|(i, group)| {
            if i + 1 == groups.len() {
                group.num_rows() > 0 && group.num_rows() <= i64::from(size)
            } else {
                group.num_rows() == i64::from(size)
            }
        }))
    .then_some(size))
}

fn canonical_schema_json(schema: &Schema) -> Result<String> {
    let mut value = serde_json::to_value(schema)?;
    value.sort_all_objects();
    Ok(serde_json::to_string(&value)?)
}

fn block_metadata_charge<'a>(labels: impl Iterator<Item = Option<&'a str>>) -> Result<usize> {
    let mut total = 512usize;
    for label in labels {
        let bytes = label.map_or(0, str::len);
        let charge = bytes
            .checked_mul(2)
            .and_then(|n| n.checked_add(2 * std::mem::size_of::<Option<String>>() + 32));
        total = total
            .checked_add(charge.ok_or(FormatLimit {
                message: "MAX_WRITER_METADATA_BYTES",
            })?)
            .ok_or(FormatLimit {
                message: "MAX_WRITER_METADATA_BYTES",
            })?;
    }
    Ok(total)
}

fn static_metadata_charge(
    schema: &Schema,
    parent: Option<&ParentMetadata>,
    labels: &[String],
    limit: usize,
) -> Result<usize> {
    let source = encoded_size(schema, limit)?;
    let parent = parent.map_or(Ok(0), |parent| encoded_size(parent, limit))?;
    let labels = encoded_size(&labels, limit)?;
    let total = source
        .checked_add(parent)
        .and_then(|n| n.checked_add(labels))
        .and_then(|n| n.checked_mul(4))
        .and_then(|n| n.checked_add(16 * 1024 + schema.fields().len() * 256));
    capacity(total.is_some_and(|n| n <= limit), "MAX_METADATA_BYTES")?;
    Ok(total.unwrap())
}
#[cfg(test)]
mod bounds_tests {
    use super::*;

    #[test]
    fn encoded_size_budget_counts_serialized_bytes() {
        let value = "unicode-你好".repeat(32);
        let size = serde_json::to_vec(&value).unwrap().len();
        assert_eq!(encoded_size(&value, size).unwrap(), size);
        assert!(is_format_limit_error(
            &encoded_size(&value, size - 1).unwrap_err()
        ));
    }

    #[test]
    fn block_metadata_charge_accounts_for_nulls_and_borrowed_labels() {
        let count = MAX_LABEL_COLUMNS;
        let nulls = block_metadata_charge(std::iter::repeat_n(None, count)).unwrap();
        assert_eq!(
            nulls,
            512 + count * (2 * std::mem::size_of::<Option<String>>() + 32)
        );
        let label = "你好";
        let values = block_metadata_charge(std::iter::repeat_n(Some(label), count)).unwrap();
        assert_eq!(values, nulls + count * label.len() * 2);
    }

    #[test]
    fn constructor_rejects_schema_above_real_metadata_budget() {
        let fields = vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("label", DataType::Utf8, true),
        ];
        for field_metadata in [false, true] {
            let metadata =
                HashMap::from([("semantic".into(), "x".repeat(MAX_METADATA_BYTES / 4 + 1))]);
            let schema = if field_metadata {
                let mut fields = fields.clone();
                fields[3] = fields[3].clone().with_metadata(metadata);
                Schema::new(fields)
            } else {
                Schema::new_with_metadata(fields.clone(), metadata)
            };
            let error = BlockWriter::new(
                Vec::new(),
                Arc::new(schema),
                vec!["label".into()],
                ParentMetadata {
                    rows: 1,
                    compressed_size: 1,
                },
                1,
            )
            .err()
            .unwrap();
            assert!(is_format_limit_error(&error));
        }
    }
}
