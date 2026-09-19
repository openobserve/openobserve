// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only
use std::{
    collections::{HashMap, HashSet},
    io::Write,
    sync::Arc,
};

use anyhow::{Context, Result, anyhow, ensure};
use arrow::{
    array::{
        Array, ArrayRef, BooleanArray, FixedSizeBinaryArray, Float64Array, Int64Array,
        LargeStringArray, RecordBatch, RecordBatchOptions, StringArray, StringViewArray,
        UInt32Array, UInt64Array,
    },
    datatypes::{DataType, Field, Schema, SchemaRef},
};
use parquet::{arrow::arrow_reader::ParquetRecordBatchReaderBuilder, file::reader::ChunkReader};

use crate::*;

pub struct BlockWriter<W: Write> {
    output: W,
    schema: SchemaRef,
    parent: ParentIdentity,
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
    metadata_limit: usize,
    writer_metadata_limit: usize,
    metadata_properties: HashMap<String, String>,
    current_block_charge: usize,
    failed: bool,
}

impl<W: Write> BlockWriter<W> {
    pub fn new(
        output: W,
        schema: SchemaRef,
        label_columns: Vec<String>,
        parent: ParentIdentity,
        max_block_rows: usize,
    ) -> Result<Self> {
        Self::new_with_metadata_limits(
            output,
            schema,
            label_columns,
            parent,
            max_block_rows,
            MAX_METADATA_BYTES,
            MAX_WRITER_METADATA_BYTES,
        )
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
            self.rows == self.parent.rows,
            "source/parent row count mismatch"
        );
        self.flush_block()?;
        self.current_labels.clear();
        let batch = self.metadata_batch()?;
        let metadata = crate::compact::encode(&batch)?;
        capacity(metadata.len() <= self.metadata_limit, "MAX_METADATA_BYTES")?;
        let metadata_len = u64::try_from(metadata.len())?;
        let mut footer = [0u8; FOOTER_LEN];
        footer[..8].copy_from_slice(MAGIC);
        footer[8..12].copy_from_slice(&VERSION.to_le_bytes());
        footer[12..16].copy_from_slice(&0u32.to_le_bytes());
        footer[16..24].copy_from_slice(&self.offset.to_le_bytes());
        footer[24..32].copy_from_slice(&metadata_len.to_le_bytes());
        footer[32..].copy_from_slice(&checksum(&metadata));
        self.output.write_all(&metadata)?;
        self.output.write_all(&footer)?;
        Ok(self.output)
    }

    fn new_with_metadata_limits(
        output: W,
        schema: SchemaRef,
        label_columns: Vec<String>,
        parent: ParentIdentity,
        max_block_rows: usize,
        metadata_limit: usize,
        writer_metadata_limit: usize,
    ) -> Result<Self> {
        ensure!(
            sidecar_path(&parent.object_key).is_some(),
            "unsupported parent object key"
        );
        ensure!(
            parent.rows > 0 && parent.compressed_size > 0,
            "empty parent unsupported"
        );
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
            static_metadata_charge(&schema, &parent, &label_columns, metadata_limit)?;
        capacity(
            writer_metadata_estimate <= writer_metadata_limit,
            "MAX_WRITER_METADATA_BYTES",
        )?;
        let metadata_properties = [
            (VERSION_KEY.to_owned(), VERSION.to_string()),
            (PARENT_KEY.to_owned(), serde_json::to_string(&parent)?),
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
            metadata_limit,
            writer_metadata_limit,
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
                self.rows < self.parent.rows,
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
                .is_some_and(|n| n <= self.writer_metadata_limit),
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
            "compressed block exceeds v1 bound"
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
            checksum: checksum(&payload),
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
            Field::new("__oo_midx_checksum", DataType::FixedSizeBinary(32), false),
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
            Arc::new(FixedSizeBinaryArray::try_from_iter(
                self.blocks.iter().map(|b| b.checksum.as_slice()),
            )?),
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
pub fn build_from_parquet<T: ChunkReader + 'static>(
    reader: T,
    parent: ParentIdentity,
) -> Result<Vec<u8>> {
    ensure!(
        reader.len() == parent.compressed_size,
        "Parquet parent size mismatch"
    );
    let builder = ParquetRecordBatchReaderBuilder::try_new(reader)?;
    let labels = identity_label_columns(builder.schema().as_ref())?;
    build_from_builder(builder, parent, labels)
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

fn build_from_builder<T: ChunkReader + 'static>(
    builder: ParquetRecordBatchReaderBuilder<T>,
    parent: ParentIdentity,
    labels: Vec<String>,
) -> Result<Vec<u8>> {
    ensure!(
        u64::try_from(builder.metadata().file_metadata().num_rows())? == parent.rows,
        "Parquet parent rows mismatch"
    );
    let mut writer = BlockWriter::new(
        Vec::new(),
        builder.schema().clone(),
        labels,
        parent,
        MAX_BLOCK_ROWS,
    )?;
    let groups = builder.metadata().row_groups();
    if let Some(first) = groups.first() {
        let size = u32::try_from(first.num_rows())?;
        if size > 0
            && groups.iter().enumerate().all(|(i, g)| {
                if i + 1 == groups.len() {
                    g.num_rows() > 0 && g.num_rows() <= i64::from(size)
                } else {
                    g.num_rows() == i64::from(size)
                }
            })
        {
            writer
                .metadata_properties
                .insert(ROW_GROUP_SIZE_KEY.to_owned(), size.to_string());
        }
    }
    for batch in builder.with_batch_size(MAX_BLOCK_ROWS).build()? {
        let batch = batch?;
        ensure!(
            writer.schema.fields() == batch.schema().fields(),
            "Parquet batch fields changed"
        );
        // Parquet's builder preserves file metadata, but its record batches omit that metadata.
        let batch = RecordBatch::try_new(Arc::clone(&writer.schema), batch.columns().to_vec())?;
        writer.write(&batch)?;
    }
    writer.finish()
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
    parent: &ParentIdentity,
    labels: &[String],
    limit: usize,
) -> Result<usize> {
    let source = encoded_size(schema, limit)?;
    let parent = encoded_size(parent, limit)?;
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

    fn input(
        labels: usize,
        rows: usize,
        text: Option<&str>,
    ) -> (SchemaRef, Vec<String>, RecordBatch, ParentIdentity) {
        let mut fields = vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
        ];
        let names: Vec<_> = (0..labels).map(|i| format!("label_{i}")).collect();
        fields.extend(names.iter().map(|n| Field::new(n, DataType::Utf8, true)));
        let schema = Arc::new(Schema::new(fields));
        let mut columns: Vec<ArrayRef> = vec![
            Arc::new(UInt64Array::from_iter_values(0..rows as u64)),
            Arc::new(Int64Array::from(vec![10; rows])),
            Arc::new(Float64Array::from(vec![1.; rows])),
        ];
        columns
            .extend((0..labels).map(|_| Arc::new(StringArray::from(vec![text; rows])) as ArrayRef));
        let batch = RecordBatch::try_new(schema.clone(), columns).unwrap();
        let parent = ParentIdentity {
            object_key: "files/o/metrics/m/2026/09/18/07/indexed-v1-a.parquet".into(),
            rows: rows as u64,
            compressed_size: 10,
        };
        (schema, names, batch, parent)
    }

    #[test]
    fn borrowed_label_is_admitted_before_owning_it() {
        let text = "x".repeat(1024);
        let (schema, names, batch, parent) = input(1, 1, Some(&text));
        let base = static_metadata_charge(&schema, &parent, &names, MAX_METADATA_BYTES).unwrap();
        let limit = base + block_metadata_charge([None].into_iter()).unwrap() + 100;
        let mut writer = BlockWriter::new_with_metadata_limits(
            Vec::new(),
            schema,
            names,
            parent,
            1,
            MAX_METADATA_BYTES,
            limit,
        )
        .unwrap();
        assert!(is_format_limit_error(&writer.write(&batch).unwrap_err()));
        assert!(writer.current_labels.is_empty());
        assert!(writer.labels.is_empty());
        assert_eq!(writer.rows, 0);
        assert!(writer.output.is_empty());
    }

    #[test]
    fn null_labels_charge_owned_slots_and_stop_before_growth() {
        let (schema, names, batch, parent) = input(MAX_LABEL_COLUMNS, 3, None);
        let base = static_metadata_charge(&schema, &parent, &names, MAX_METADATA_BYTES).unwrap();
        let charge = block_metadata_charge(std::iter::repeat_n(None, MAX_LABEL_COLUMNS)).unwrap();
        assert!(charge >= MAX_LABEL_COLUMNS * std::mem::size_of::<Option<String>>());
        let limit = base + charge * 2;
        let mut writer = BlockWriter::new_with_metadata_limits(
            Vec::new(),
            schema,
            names,
            parent,
            1,
            MAX_METADATA_BYTES,
            limit,
        )
        .unwrap();
        assert!(is_format_limit_error(&writer.write(&batch).unwrap_err()));
        assert_eq!(writer.blocks.len(), 2);
        assert_eq!(writer.labels.len(), 2);
        assert_eq!(writer.writer_metadata_estimate, limit);
    }

    #[test]
    fn serialized_cap_remains_independent_of_writer_heap_budget() {
        let value = "x".repeat(64);
        let (schema, names, batch, parent) = input(1, 400, Some(&value));
        let mut writer = BlockWriter::new_with_metadata_limits(
            Vec::new(),
            schema,
            names,
            parent,
            1,
            32 * 1024,
            1024 * 1024,
        )
        .unwrap();
        writer.write(&batch).unwrap();
        assert!(writer.writer_metadata_estimate > writer.metadata_limit);
        assert!(writer.writer_metadata_estimate < writer.writer_metadata_limit);
        writer.metadata_limit = 1;
        let error = writer.finish().unwrap_err();
        assert!(is_format_limit_error(&error));
    }

    #[test]
    fn static_schema_field_metadata_and_encoded_output_are_bounded() {
        let (schema, names, _, parent) = input(1, 1, None);
        let base = static_metadata_charge(&schema, &parent, &names, MAX_METADATA_BYTES).unwrap();
        for field_metadata in [false, true] {
            let metadata = HashMap::from([("semantic".into(), "x".repeat(8192))]);
            let changed = if field_metadata {
                let mut fields = schema.fields().to_vec();
                fields[3] = Arc::new(fields[3].as_ref().clone().with_metadata(metadata));
                Schema::new(fields)
            } else {
                schema.as_ref().clone().with_metadata(metadata)
            };
            let error = BlockWriter::new_with_metadata_limits(
                Vec::new(),
                Arc::new(changed),
                names.clone(),
                parent.clone(),
                1,
                base + 1024,
                MAX_WRITER_METADATA_BYTES,
            )
            .err()
            .unwrap();
            assert!(is_format_limit_error(&error));
        }
        assert!(is_format_limit_error(
            &encoded_size(&"x".repeat(100), 10).unwrap_err()
        ));
    }
}
