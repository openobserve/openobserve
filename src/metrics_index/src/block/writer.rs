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

use std::{io::Write, sync::Arc};

use anyhow::{Context, Result, anyhow, ensure};
use arrow::{
    array::{
        Array, ArrayRef, Float64Array, Int64Array, LargeStringArray, RecordBatch, StringArray,
        StringViewArray, UInt64Array,
    },
    datatypes::{DataType, SchemaRef},
};
use parquet::{
    arrow::arrow_reader::{ArrowReaderMetadata, ArrowReaderOptions},
    file::metadata::ParquetMetaData,
};

use super::{
    compact::{encode_frame, encode_label_column, put_varint, zigzag},
    header::{HeaderData, LabelSection},
    samples::SampleEncoder,
    *,
};

pub struct BlockWriter<W: Write> {
    output: W,
    schema: SchemaRef,
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
    encoder: SampleEncoder,
    block_bytes: Vec<u8>,
    rows: u64,
    offset: u64,
    blocks: Vec<BlockMeta>,
    labels: Vec<Vec<Option<String>>>,
    failed: bool,
}

impl<W: Write> BlockWriter<W> {
    /// Indexes the identity labels of `schema`; the parent is bound when the writer finishes.
    pub fn new(output: W, schema: SchemaRef, max_block_rows: usize) -> Result<Self> {
        ensure!(
            max_block_rows > 0 && max_block_rows <= MAX_BLOCK_ROWS,
            "invalid max block rows"
        );
        let labels = identity_label_columns(&schema)?;
        if labels.len() > WARN_LABEL_COLUMNS {
            log::warn!(
                "metrics schema has {} identity labels, more than {WARN_LABEL_COLUMNS}; building its MIDX may use a lot of memory",
                labels.len()
            );
        }
        let label_indices = labels
            .iter()
            .map(|label| schema.index_of(label))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(Self {
            hash_index: schema.index_of("__hash__")?,
            time_index: schema.index_of("_timestamp")?,
            value_index: schema.index_of("value")?,
            output,
            schema,
            label_indices,
            max_block_rows,
            previous: None,
            current_hash: None,
            current_labels: Vec::new(),
            timestamps: Vec::with_capacity(max_block_rows),
            values: Vec::with_capacity(max_block_rows),
            encoder: SampleEncoder::default(),
            block_bytes: Vec::new(),
            rows: 0,
            offset: 0,
            blocks: Vec::new(),
            labels: Vec::new(),
            failed: false,
        })
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
        self.finish(parent, Arc::clone(stored.schema()), Some(row_group_size))
    }

    /// The caller must verify the completed Vortex file before finalizing its index.
    pub fn finish_for_vortex(self, parent: ParentMetadata, schema: SchemaRef) -> Result<W> {
        self.finish(parent, schema, None)
    }

    pub fn write(&mut self, batch: &RecordBatch) -> Result<()> {
        ensure!(!self.failed, "writer is poisoned by an earlier failure");
        let result = self.write_inner(batch);
        if result.is_err() {
            self.failed = true;
        }
        result
    }

    /// The container adapter must verify the completed file before supplying its source facts.
    fn finish(
        mut self,
        parent: ParentMetadata,
        stored_schema: SchemaRef,
        row_group_size: Option<u32>,
    ) -> Result<W> {
        ensure!(!self.failed, "writer is poisoned");
        ensure!(
            parent.rows > 0 && parent.compressed_size > 0,
            "empty parent unsupported"
        );
        ensure!(self.rows == parent.rows, "source/parent row count mismatch");
        ensure!(row_group_size != Some(0), "invalid parent row group size");
        ensure!(
            schema_matches(&self.schema, &stored_schema),
            "stored source schema changed"
        );
        self.flush_block()?;
        self.current_labels.clear();
        ensure!(!self.blocks.is_empty(), "MIDX without sample blocks");
        let mut header = HeaderData {
            parent,
            row_group_size,
            source_schema: stored_schema.as_ref().clone(),
            blocks: u64::try_from(self.blocks.len())?,
            labels: Vec::with_capacity(self.label_indices.len()),
            directory: Vec::with_capacity(DIRECTORY_FIELDS),
        };
        for (name, column) in self.label_columns()? {
            let (section, frame) = encode_frame(&encode_label_column(column.as_ref())?)?;
            self.output.write_all(&frame)?;
            header.labels.push(LabelSection { name, section });
        }
        for column in self.directory_columns() {
            let (section, frame) = encode_frame(&column)?;
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
        self.block_bytes.clear();
        self.encoder
            .encode_block(&self.timestamps, &self.values, &mut self.block_bytes)?;
        let block_length = u32::try_from(self.block_bytes.len())?;
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
        };
        self.offset = self
            .offset
            .checked_add(u64::from(block_length))
            .context("block offset overflow")?;
        self.output.write_all(&self.block_bytes)?;
        self.blocks.push(meta);
        self.labels.push(self.current_labels.clone());
        self.timestamps.clear();
        self.values.clear();
        Ok(())
    }

    /// Varint columns: hash delta, row count, zigzag min-time delta, time span, block length.
    fn directory_columns(&self) -> [Vec<u8>; DIRECTORY_FIELDS] {
        let mut columns: [Vec<u8>; DIRECTORY_FIELDS] = Default::default();
        let (mut hash, mut min) = (0u64, 0i64);
        for block in &self.blocks {
            put_varint(&mut columns[0], block.hash.wrapping_sub(hash));
            put_varint(&mut columns[1], u64::from(block.row_count));
            put_varint(
                &mut columns[2],
                zigzag(block.min_timestamp.wrapping_sub(min)),
            );
            put_varint(
                &mut columns[3],
                (block.max_timestamp as u64).wrapping_sub(block.min_timestamp as u64),
            );
            put_varint(&mut columns[4], u64::from(block.block_length));
            (hash, min) = (block.hash, block.min_timestamp);
        }
        columns
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
