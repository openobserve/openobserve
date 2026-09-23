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

use std::{collections::HashSet, sync::Arc};

use anyhow::{Context, Result, ensure};
use arrow::{
    array::{
        Array, ArrayRef, BooleanArray, Int64Array, RecordBatch, RecordBatchOptions, UInt32Array,
        UInt64Array,
    },
    datatypes::{DataType, Schema},
};
use bytes::Bytes;

use super::*;

pub struct BlockDecoder {
    decoder: zstd::bulk::Decompressor<'static>,
    raw: Box<[u8]>,
    timestamps: Vec<i64>,
    value_bits: Vec<u64>,
}

impl BlockDecoder {
    pub fn new() -> Result<Self> {
        Self::with_capacity(MAX_BLOCK_ROWS)
    }

    pub fn decode<'a>(
        &'a mut self,
        payload: &[u8],
        block: &BlockMeta,
    ) -> Result<DecodedBlockRef<'a>> {
        self.timestamps.clear();
        self.value_bits.clear();
        if let Err(error) = self.decode_inner(payload, block) {
            self.timestamps.clear();
            self.value_bits.clear();
            return Err(error);
        }
        Ok(DecodedBlockRef {
            timestamps: &self.timestamps,
            value_bits: &self.value_bits,
        })
    }

    fn with_capacity(rows: usize) -> Result<Self> {
        ensure!(
            rows > 0 && rows <= MAX_BLOCK_ROWS,
            "invalid decoder capacity"
        );
        let mut decoder = zstd::bulk::Decompressor::new()?;
        decoder.set_parameter(zstd::zstd_safe::DParameter::WindowLogMax(18))?;
        Ok(Self {
            decoder,
            raw: vec![0; rows * 16].into_boxed_slice(),
            timestamps: Vec::with_capacity(rows),
            value_bits: Vec::with_capacity(rows),
        })
    }

    fn decode_inner(&mut self, payload: &[u8], block: &BlockMeta) -> Result<()> {
        ensure!(
            block.row_count > 0 && block.row_count as usize <= MAX_BLOCK_ROWS,
            "invalid decoded row count"
        );
        ensure!(
            block.block_length as usize <= max_compressed_block_len(block.row_count)?,
            "compressed block length exceeds format bound"
        );
        ensure!(
            payload.len() == block.block_length as usize,
            "payload length mismatch"
        );
        ensure!(
            zstd::zstd_safe::find_frame_compressed_size(payload)
                .map_err(|error| anyhow!("invalid sample frame: {error:?}"))?
                == payload.len(),
            "extra sample frame bytes"
        );
        let count = block.row_count as usize;
        let size = count.checked_mul(16).context("decoded size overflow")?;
        ensure!(
            size <= self.raw.len(),
            "decoded block exceeds scratch capacity"
        );
        let raw = &mut self.raw[..size];
        ensure!(
            self.decoder.decompress_to_buffer(payload, raw)? == size,
            "decoded size mismatch"
        );
        let (timestamp_bytes, value_bytes) = raw.split_at(count * 8);
        let planes: [&[u8]; 8] =
            std::array::from_fn(|byte| &value_bytes[byte * count..(byte + 1) * count]);
        let mut previous: Option<i64> = None;
        let mut strictly_increasing = true;
        for (i, bytes) in timestamp_bytes.chunks_exact(8).enumerate() {
            // chunks_exact guarantees the width; no unchecked reads or casts.
            let encoded = i64::from_le_bytes(bytes.try_into().expect("8-byte timestamp chunk"));
            let timestamp = previous.map_or(encoded, |last| last.wrapping_add(encoded));
            if let Some(last) = previous {
                ensure!(timestamp >= last, "decoded timestamps decreased");
                strictly_increasing &= timestamp > last;
            }
            previous = Some(timestamp);
            self.timestamps.push(timestamp);
            self.value_bits.push(u64::from_le_bytes([
                planes[0][i],
                planes[1][i],
                planes[2][i],
                planes[3][i],
                planes[4][i],
                planes[5][i],
                planes[6][i],
                planes[7][i],
            ]));
        }
        ensure!(
            self.timestamps[0] == block.min_timestamp
                && self.timestamps[count - 1] == block.max_timestamp,
            "decoded timestamp bounds mismatch"
        );
        ensure!(
            strictly_increasing == block.strictly_increasing,
            "decoded strictness mismatch"
        );
        Ok(())
    }
}

pub fn read_footer(bytes: &[u8], file_size: u64) -> Result<Footer> {
    config::meta::promql::blocks::read_midx_footer(bytes, file_size)
}

pub fn decode_index(
    metadata: Bytes,
    footer: &Footer,
    expected: &ParentMetadata,
    requested_labels: &[String],
) -> Result<Index> {
    decode_index_inner(metadata, footer, expected, requested_labels, None)
}

pub fn decode_additional_labels(
    metadata: Bytes,
    footer: &Footer,
    existing: &Index,
    requested_labels: &[String],
) -> Result<Index> {
    decode_index_inner(
        metadata,
        footer,
        &existing.parent,
        requested_labels,
        Some(&existing.base),
    )
}

pub fn decode_block(payload: &[u8], block: &BlockMeta) -> Result<DecodedBlock> {
    let mut decoder = BlockDecoder::with_capacity(block.row_count as usize)?;
    decoder.decode(payload, block)?;
    Ok(DecodedBlock {
        timestamps: decoder.timestamps,
        value_bits: decoder.value_bits,
    })
}

fn decode_index_inner(
    metadata: Bytes,
    footer: &Footer,
    expected: &ParentMetadata,
    requested_labels: &[String],
    existing: Option<&Arc<IndexBase>>,
) -> Result<Index> {
    ensure!(
        u64::try_from(metadata.len())?
            == footer
                .metadata_range
                .end
                .checked_sub(footer.metadata_range.start)
                .context("reversed metadata range")?,
        "metadata byte length mismatch"
    );
    ensure!(
        footer.version == VERSION && footer.metadata_range.start == footer.payload_end,
        "invalid metadata footer"
    );
    let compact = super::compact::CompactMetadata::parse(&metadata)?;
    let schema = compact.schema();
    ensure!(
        schema.fields().len() <= DIRECTORY_FIELDS + MAX_LABEL_COLUMNS,
        "too many index fields"
    );
    let properties = schema.metadata();
    ensure!(
        properties
            .get(VERSION_KEY)
            .is_some_and(|v| v == &VERSION.to_string()),
        "metadata version mismatch"
    );
    let parent: ParentMetadata = serde_json::from_str(
        properties
            .get(PARENT_KEY)
            .context("missing parent metadata")?,
    )?;
    ensure!(
        &parent == expected && parent.rows > 0 && parent.compressed_size > 0,
        "parent metadata mismatch"
    );
    ensure!(
        u64::try_from(compact.rows())? <= expected.rows,
        "block count limit"
    );
    let source_schema: Schema = serde_json::from_str(
        properties
            .get(SCHEMA_KEY)
            .context("missing source schema")?,
    )?;
    ensure!(
        source_schema.fields().len() <= MAX_LABEL_COLUMNS + METRICS_HASH_EXCLUDED_LABELS.len(),
        "source schema too large"
    );
    let label_names: Vec<String> =
        serde_json::from_str(properties.get(LABELS_KEY).context("missing labels")?)?;
    ensure!(
        label_names.len() <= MAX_LABEL_COLUMNS
            && schema.fields().len() == DIRECTORY_FIELDS + label_names.len(),
        "label directory mismatch"
    );
    let source_labels = identity_label_columns(&source_schema)?;
    ensure!(
        source_labels.len() == label_names.len()
            && source_labels
                .iter()
                .all(|label| label_names.contains(label)),
        "incomplete source identity labels"
    );
    let expected_fields = [
        ("__oo_midx_hash", DataType::UInt64),
        ("__oo_midx_row_start", DataType::UInt64),
        ("__oo_midx_row_count", DataType::UInt32),
        ("__oo_midx_min_ts", DataType::Int64),
        ("__oo_midx_max_ts", DataType::Int64),
        ("__oo_midx_offset", DataType::UInt64),
        ("__oo_midx_length", DataType::UInt32),
        ("__oo_midx_strict", DataType::Boolean),
    ];
    for (index, (name, kind)) in expected_fields.iter().enumerate() {
        let field = schema.field(index);
        ensure!(
            field.name().as_str() == *name && field.data_type() == kind && !field.is_nullable(),
            "invalid directory field"
        );
    }
    let mut known = HashSet::new();
    for (index, name) in label_names.iter().enumerate() {
        ensure!(known.insert(name), "duplicate label name");
        let field = schema.field(DIRECTORY_FIELDS + index);
        ensure!(
            field.name() == name && is_label_type(field.data_type()),
            "invalid label field"
        );
        ensure!(
            source_schema.field_with_name(name)? == field,
            "source label schema mismatch"
        );
    }
    ensure!(
        requested_labels.len() <= MAX_LABEL_COLUMNS,
        "too many requested labels"
    );
    let mut projection: Vec<_> = if existing.is_some() {
        Vec::new()
    } else {
        (0..DIRECTORY_FIELDS).collect()
    };
    let mut requested = Vec::new();
    for name in requested_labels {
        if requested.contains(name) {
            continue;
        }
        if let Some(index) = label_names.iter().position(|v| v == name) {
            projection.push(DIRECTORY_FIELDS + index);
        } else {
            ensure!(
                source_schema.field_with_name(name).is_err(),
                "requested source field lacks identity label metadata"
            );
        }
        requested.push(name.clone());
    }
    projection.sort_unstable();
    let batch = compact.compact_batch(&projection)?;
    let count = batch.num_rows();
    ensure!(
        count > 0 && count as u64 <= expected.rows,
        "block count limit"
    );
    let row_group_size = properties
        .get(ROW_GROUP_SIZE_KEY)
        .map(|value| value.parse::<u32>())
        .transpose()?;
    ensure!(row_group_size != Some(0), "invalid parent row group size");
    let base = if let Some(base) = existing {
        ensure!(
            base.footer == *footer
                && base.parent == parent
                && base.source_schema.as_ref() == &source_schema
                && base.row_group_size == row_group_size
                && base.blocks.len() == count,
            "additional labels have a different metadata binding"
        );
        Arc::clone(base)
    } else {
        Arc::new(IndexBase {
            row_group_size,
            parent,
            source_schema: Arc::new(source_schema),
            blocks: decode_directory(&batch, expected, footer)?,
            footer: footer.clone(),
        })
    };
    let mut missing = Vec::new();
    let mut fields = Vec::new();
    let mut columns: Vec<ArrayRef> = Vec::new();
    for name in requested {
        if let Some(column) = batch.column_by_name(&name) {
            fields.push(Arc::new(batch.schema().field_with_name(&name)?.clone()));
            columns.push(Arc::clone(column));
        } else {
            missing.push(name);
        }
    }
    let labels = RecordBatch::try_new_with_options(
        Arc::new(Schema::new(fields)),
        columns,
        &RecordBatchOptions::new().with_row_count(Some(count)),
    )?;
    for i in 1..count {
        if base.blocks.block(i).hash == base.blocks.block(i - 1).hash {
            for column in labels.columns() {
                ensure!(
                    label_value(column.as_ref(), i)? == label_value(column.as_ref(), i - 1)?,
                    "label metadata changes within one series"
                );
            }
        }
    }
    Ok(Index {
        base,
        labels,
        missing,
    })
}

fn decode_directory(
    batch: &RecordBatch,
    parent: &ParentMetadata,
    footer: &Footer,
) -> Result<BlockDirectory> {
    let count = batch.num_rows();
    ensure!(
        count > 0 && count as u64 <= parent.rows,
        "block count limit"
    );
    for i in 0..DIRECTORY_FIELDS {
        ensure!(batch.column(i).null_count() == 0, "null block descriptor");
    }
    let hashes = batch
        .column(0)
        .as_any()
        .downcast_ref::<UInt64Array>()
        .context("hash type")?;
    let row_starts = batch
        .column(1)
        .as_any()
        .downcast_ref::<UInt64Array>()
        .context("row offset type")?;
    let counts = batch
        .column(2)
        .as_any()
        .downcast_ref::<UInt32Array>()
        .context("count type")?;
    let min_times = batch
        .column(3)
        .as_any()
        .downcast_ref::<Int64Array>()
        .context("min time type")?;
    let max_times = batch
        .column(4)
        .as_any()
        .downcast_ref::<Int64Array>()
        .context("max time type")?;
    let offsets = batch
        .column(5)
        .as_any()
        .downcast_ref::<UInt64Array>()
        .context("offset type")?;
    let lengths = batch
        .column(6)
        .as_any()
        .downcast_ref::<UInt32Array>()
        .context("length type")?;
    let strict = batch
        .column(7)
        .as_any()
        .downcast_ref::<BooleanArray>()
        .context("strict type")?;
    let mut blocks =
        super::directory::DirectoryBuilder::new(count, parent.rows, footer.payload_end);
    let mut next_row = 0u64;
    let mut next_offset = 0u64;
    let mut previous: Option<(u64, i64)> = None;
    for i in 0..count {
        let block = BlockMeta {
            hash: hashes.value(i),
            row_start: row_starts.value(i),
            row_count: counts.value(i),
            min_timestamp: min_times.value(i),
            max_timestamp: max_times.value(i),
            block_offset: offsets.value(i),
            block_length: lengths.value(i),
            strictly_increasing: strict.value(i),
        };
        ensure!(
            block.row_count > 0 && block.row_count as usize <= MAX_BLOCK_ROWS,
            "invalid block row count"
        );
        ensure!(
            block.block_length as usize <= max_compressed_block_len(block.row_count)?,
            "compressed block length exceeds format bound"
        );
        ensure!(
            block.row_start == next_row && block.block_length > 0,
            "noncontiguous row or payload directory"
        );
        ensure!(
            block.min_timestamp <= block.max_timestamp,
            "invalid time bounds"
        );
        ensure!(
            previous.is_none_or(|p| p <= (block.hash, block.min_timestamp)),
            "series block ordering decreased"
        );
        if block.row_count == 1 {
            ensure!(
                block.min_timestamp == block.max_timestamp && block.strictly_increasing,
                "invalid single-sample descriptor"
            );
        } else if block.strictly_increasing {
            ensure!(
                block.min_timestamp < block.max_timestamp,
                "invalid strict time bounds"
            );
        }
        next_row = next_row
            .checked_add(u64::from(block.row_count))
            .context("row end overflow")?;
        ensure!(
            block.block_offset == next_offset,
            "noncontiguous payload directory"
        );
        next_offset = next_offset
            .checked_add(u64::from(block.block_length))
            .context("payload end overflow")?;
        ensure!(
            next_row <= parent.rows && next_offset <= footer.payload_end,
            "block outside parent bounds"
        );
        previous = Some((block.hash, block.max_timestamp));
        blocks.push(block);
    }
    ensure!(
        next_row == parent.rows && next_offset == footer.payload_end,
        "directory does not tile source rows and payload"
    );
    Ok(blocks.finish())
}

#[cfg(test)]
mod decoder_tests {
    use super::*;

    fn fixture(samples: &[(i64, u64)]) -> (Vec<u8>, BlockMeta) {
        let mut raw = Vec::with_capacity(samples.len() * 16);
        raw.extend_from_slice(&samples[0].0.to_le_bytes());
        for pair in samples.windows(2) {
            raw.extend_from_slice(&pair[1].0.wrapping_sub(pair[0].0).to_le_bytes());
        }
        for byte in 0..8 {
            for sample in samples {
                raw.push((sample.1 >> (byte * 8)) as u8);
            }
        }
        let payload = zstd::bulk::compress(&raw, 1).unwrap();
        let block = BlockMeta {
            hash: 7,
            row_start: 0,
            row_count: samples.len() as u32,
            min_timestamp: samples[0].0,
            max_timestamp: samples.last().unwrap().0,
            block_offset: 0,
            block_length: payload.len() as u32,
            strictly_increasing: samples.windows(2).all(|w| w[0].0 < w[1].0),
        };
        (payload, block)
    }

    #[test]
    fn reusable_decoder_keeps_bounded_allocations_across_block_sizes() {
        let mut decoder = BlockDecoder::new().unwrap();
        let pointers = (
            decoder.raw.as_ptr(),
            decoder.timestamps.as_ptr(),
            decoder.value_bits.as_ptr(),
        );
        let capacities = (
            decoder.raw.len(),
            decoder.timestamps.capacity(),
            decoder.value_bits.capacity(),
        );
        assert_eq!(
            capacities,
            (MAX_BLOCK_ROWS * 16, MAX_BLOCK_ROWS, MAX_BLOCK_ROWS)
        );
        for count in [1, 64, MAX_BLOCK_ROWS, 3, MAX_BLOCK_ROWS, 1] {
            let samples: Vec<_> = (0..count)
                .map(|i| (i as i64 * 15_000_000, (i as u64).rotate_left(31)))
                .collect();
            let (payload, block) = fixture(&samples);
            let decoded = decoder.decode(&payload, &block).unwrap();
            assert_eq!(
                decoded
                    .timestamps
                    .iter()
                    .copied()
                    .zip(decoded.value_bits.iter().copied())
                    .collect::<Vec<_>>(),
                samples
            );
            assert_eq!(
                (
                    decoder.raw.as_ptr(),
                    decoder.timestamps.as_ptr(),
                    decoder.value_bits.as_ptr()
                ),
                pointers
            );
            assert_eq!(
                (
                    decoder.raw.len(),
                    decoder.timestamps.capacity(),
                    decoder.value_bits.capacity()
                ),
                capacities
            );
        }
    }

    #[test]
    fn reusable_decoder_recovers_after_integrity_and_native_errors() {
        let samples = [(0, 0), (15_000_000, 1f64.to_bits())];
        let (payload, block) = fixture(&samples);
        let mut decoder = BlockDecoder::new().unwrap();
        decoder.decode(&payload, &block).unwrap();
        let mut corrupt = payload.clone();
        corrupt[0] ^= 1;
        let bad_zstd = [1, 2, 3, 4];
        let mut bad_frame = block.clone();
        bad_frame.block_length = bad_zstd.len() as u32;
        let mut bad_endpoint = block.clone();
        bad_endpoint.max_timestamp += 1;
        let mut bad_strict = block.clone();
        bad_strict.strictly_increasing = false;
        let mut too_many = block.clone();
        too_many.row_count = MAX_BLOCK_ROWS as u32 + 1;
        for (bytes, metadata) in [
            (&corrupt[..], &block),
            (&bad_zstd[..], &bad_frame),
            (&payload[..], &bad_endpoint),
            (&payload[..], &bad_strict),
            (&payload[..], &too_many),
        ] {
            assert!(decoder.decode(bytes, metadata).is_err());
            assert!(decoder.timestamps.is_empty());
            assert!(decoder.value_bits.is_empty());
            let actual = decoder.decode(&payload, &block).unwrap();
            assert_eq!(actual.timestamps, &[0, 15_000_000]);
            assert_eq!(actual.value_bits, &[0, 1f64.to_bits()]);
        }
    }

    #[test]
    fn reusable_decoder_rejects_bad_order_and_exact_decoded_lengths() {
        let mut decoder = BlockDecoder::new().unwrap();
        let (decreased, metadata) = fixture(&[(100, 0), (99, 1)]);
        assert!(
            decoder
                .decode(&decreased, &metadata)
                .unwrap_err()
                .to_string()
                .contains("timestamps decreased")
        );
        assert!(decoder.timestamps.is_empty());
        for length in [15, 17] {
            let bytes = zstd::bulk::compress(&vec![0; length], 1).unwrap();
            let (_, mut metadata) = fixture(&[(0, 0)]);
            metadata.block_length = bytes.len() as u32;
            assert!(decoder.decode(&bytes, &metadata).is_err());
            assert!(decoder.timestamps.is_empty());
            assert!(decoder.value_bits.is_empty());
        }
        let (valid, metadata) = fixture(&[(0, 0)]);
        assert_eq!(decoder.decode(&valid, &metadata).unwrap().timestamps, &[0]);
    }

    #[test]
    fn borrowed_and_owned_decoders_preserve_extremes_and_are_independent() {
        fn assert_send<T: Send>() {}
        assert_send::<BlockDecoder>();
        let samples = [
            (i64::MIN, (-0f64).to_bits()),
            (i64::MIN + 1, 0),
            (-1, 0x7ff8_0000_0000_0001),
            (0, 0x7ff8_0000_0000_0012),
            (0, f64::NEG_INFINITY.to_bits()),
            (15_000_001, 100f64.to_bits()),
            (i64::MAX, 1f64.to_bits()),
        ];
        let (payload, metadata) = fixture(&samples);
        let owned = decode_block(&payload, &metadata).unwrap();
        let mut first = BlockDecoder::new().unwrap();
        let mut second = BlockDecoder::new().unwrap();
        let borrowed = first.decode(&payload, &metadata).unwrap();
        let (other_payload, other_metadata) = fixture(&[(77, f64::INFINITY.to_bits())]);
        second.decode(&other_payload, &other_metadata).unwrap();
        assert_eq!(borrowed.timestamps, owned.timestamps);
        assert_eq!(borrowed.value_bits, owned.value_bits);
        assert_eq!(
            borrowed
                .timestamps
                .iter()
                .copied()
                .zip(borrowed.value_bits.iter().copied())
                .collect::<Vec<_>>(),
            samples
        );
    }
}
