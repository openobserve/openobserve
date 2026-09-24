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

use std::{collections::HashSet, io::Write, sync::Arc};

use anyhow::{Context, Result, anyhow, ensure};
use arrow::{
    array::{
        Array, ArrayRef, BooleanArray, Float64Array, Int64Array, LargeStringArray, RecordBatch,
        StringArray, StringViewArray, UInt32Array, UInt64Array,
    },
    datatypes::{DataType, SchemaRef},
};
use parquet::{
    arrow::arrow_reader::{ArrowReaderMetadata, ArrowReaderOptions},
    file::metadata::ParquetMetaData,
};

use super::{
    header::{HeaderData, LabelSection},
    *,
};

pub struct BlockWriter<W: Write> {
    output: W,
    schema: SchemaRef,
    parent: Option<ParentMetadata>,
    row_group_size: Option<u32>,
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

    /// The caller must verify the completed Vortex file before finalizing its index.
    pub fn finish_for_vortex(self, parent: ParentMetadata, schema: SchemaRef) -> Result<W> {
        self.finish_for_source(parent, schema, None)
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
        let parent = self
            .parent
            .clone()
            .context("parent metadata is not bound")?;
        ensure!(self.rows == parent.rows, "source/parent row count mismatch");
        self.flush_block()?;
        self.current_labels.clear();
        ensure!(!self.blocks.is_empty(), "MIDX without sample blocks");
        let mut header = HeaderData {
            parent,
            row_group_size: self.row_group_size,
            source_schema: self.schema.as_ref().clone(),
            blocks: u64::try_from(self.blocks.len())?,
            labels: Vec::with_capacity(self.label_indices.len()),
            directory: Vec::with_capacity(DIRECTORY_FIELDS),
        };
        for (name, column) in self.label_columns()? {
            let (section, frame) = super::compact::encode_frame(column.as_ref())?;
            self.output.write_all(&frame)?;
            header.labels.push(LabelSection { name, section });
        }
        for column in self.directory_columns() {
            let (section, frame) = super::compact::encode_frame(column.as_ref())?;
            self.output.write_all(&frame)?;
            header.directory.push(section);
        }
        let encoded = header.encode()?;
        if encoded.len() as u64 > HEADER_PROBE_BYTES {
            log::warn!(
                "MIDX header is {} bytes, larger than the {HEADER_PROBE_BYTES}-byte read probe; cold loads need one more request",
                encoded.len()
            );
        }
        let trailer = MidxTrailer {
            label_len: header
                .labels
                .iter()
                .map(|label| label.section.compressed)
                .sum(),
            directory_len: header
                .directory
                .iter()
                .map(|section| section.compressed)
                .sum(),
            header_len: u32::try_from(encoded.len())?,
        }
        .encode();
        self.output.write_all(&encoded)?;
        self.output.write_all(&trailer[..24])?;
        self.output.flush()?;
        self.output.write_all(&trailer[24..])?;
        self.output.flush()?;
        Ok(self.output)
    }

    /// The container adapter must verify the completed file before supplying its source facts.
    fn finish_for_source(
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
        self.schema = stored_schema;
        self.row_group_size = row_group_size;
        self.parent = Some(parent);
        self.finish()
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
        ensure!(
            max_block_rows > 0 && max_block_rows <= MAX_BLOCK_ROWS,
            "invalid max block rows"
        );
        if label_columns.len() > WARN_LABEL_COLUMNS {
            log::warn!(
                "metrics schema has {} identity labels, more than {WARN_LABEL_COLUMNS}; building its MIDX may use a lot of memory",
                label_columns.len()
            );
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
            row_group_size: None,
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
                self.current_labels = borrowed.into_iter().map(|v| v.map(str::to_owned)).collect();
                self.current_hash = Some(hash);
            } else {
                for (index, expected) in self.label_indices.iter().zip(&self.current_labels) {
                    ensure!(
                        label_value(batch.column(*index).as_ref(), row)? == expected.as_deref(),
                        "identity label changes within one series hash"
                    );
                }
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

    fn flush_block(&mut self) -> Result<()> {
        if self.timestamps.is_empty() {
            return Ok(());
        }
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
        let block_length = u32::try_from(payload.len())?;
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
            block_offset: self.offset,
            block_length,
            strictly_increasing: self.timestamps.windows(2).all(|w| w[0] < w[1]),
        };
        self.offset = self
            .offset
            .checked_add(u64::from(block_length))
            .context("payload offset overflow")?;
        self.output.write_all(&payload)?;
        self.blocks.push(meta);
        self.labels.push(self.current_labels.clone());
        self.timestamps.clear();
        self.values.clear();
        Ok(())
    }

    fn directory_columns(&self) -> Vec<ArrayRef> {
        vec![
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
                self.blocks.iter().map(|b| b.block_offset),
            )),
            Arc::new(UInt32Array::from_iter_values(
                self.blocks.iter().map(|b| b.block_length),
            )),
            Arc::new(BooleanArray::from(
                self.blocks
                    .iter()
                    .map(|b| b.strictly_increasing)
                    .collect::<Vec<_>>(),
            )),
        ]
    }

    fn label_columns(&self) -> Result<Vec<(String, ArrayRef)>> {
        let mut columns = Vec::with_capacity(self.label_indices.len());
        for (j, index) in self.label_indices.iter().enumerate() {
            let field = self.schema.field(*index);
            let values = self.labels.iter().map(|row| row[j].as_deref());
            let column: ArrayRef = match field.data_type() {
                DataType::Utf8 => Arc::new(StringArray::from_iter(values)),
                DataType::LargeUtf8 => Arc::new(LargeStringArray::from_iter(values)),
                DataType::Utf8View => Arc::new(StringViewArray::from_iter(values)),
                _ => return Err(anyhow!("unsupported label type")),
            };
            columns.push((field.name().clone(), column));
        }
        Ok(columns)
    }
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
