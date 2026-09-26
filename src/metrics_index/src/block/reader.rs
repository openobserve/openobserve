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

use std::sync::Arc;

use anyhow::{Context, Result, ensure};
use arrow::{
    array::{
        Array, ArrayRef, BooleanArray, Int64Array, RecordBatch, RecordBatchOptions, UInt32Array,
        UInt64Array,
    },
    datatypes::Schema,
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
        block_bytes: &[u8],
        block: &BlockMeta,
    ) -> Result<DecodedBlockRef<'a>> {
        self.timestamps.clear();
        self.value_bits.clear();
        if let Err(error) = self.decode_inner(block_bytes, block) {
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

    fn decode_inner(&mut self, block_bytes: &[u8], block: &BlockMeta) -> Result<()> {
        ensure!(
            block.row_count > 0 && block.row_count as usize <= MAX_BLOCK_ROWS,
            "invalid decoded row count"
        );
        ensure!(
            block.block_length as usize <= max_compressed_block_len(block.row_count)?,
            "compressed block length exceeds format bound"
        );
        ensure!(
            block_bytes.len() == block.block_length as usize,
            "block length mismatch"
        );
        ensure!(
            zstd::zstd_safe::find_frame_compressed_size(block_bytes)
                .map_err(|error| anyhow!("invalid sample frame: {error:?}"))?
                == block_bytes.len(),
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
            self.decoder.decompress_to_buffer(block_bytes, raw)? == size,
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

/// Decodes the directory and requested labels from the bytes of `header.column_ranges(labels)`.
pub fn decode_index(header: &Header, columns: &[Bytes], labels: &[String]) -> Result<Index> {
    let (projection, missing) = header.projection(labels)?;
    ensure!(
        columns.len() == projection.len() + 1,
        "MIDX column count mismatch"
    );
    let directory = header.directory_range();
    ensure!(
        columns[0].len() as u64 == directory.end - directory.start,
        "MIDX directory byte length mismatch"
    );
    let rows = header.blocks;
    let mut decoder = super::compact::frame_decoder()?;
    let mut arrays = Vec::with_capacity(DIRECTORY_FIELDS);
    for (column, kind) in header.directory.iter().zip(DIRECTORY_TYPES) {
        let start = usize::try_from(column.range.start - directory.start)?;
        let end = usize::try_from(column.range.end - directory.start)?;
        arrays.push(super::compact::decode_frame(
            &mut decoder,
            &columns[0][start..end],
            column.raw,
            &kind,
            rows,
        )?);
    }
    let blocks = decode_directory(&arrays, &header.parent, header.blocks_end)?;
    let labels = decode_labels(header, &columns[1..], &projection, &mut decoder)?;
    for i in 1..rows {
        if blocks.block(i).hash == blocks.block(i - 1).hash {
            for column in labels.columns() {
                ensure!(
                    label_value(column.as_ref(), i)? == label_value(column.as_ref(), i - 1)?,
                    "label metadata changes within one series"
                );
            }
        }
    }
    Ok(Index {
        base: Arc::new(IndexBase {
            row_group_size: header.row_group_size,
            parent: header.parent.clone(),
            source_schema: Arc::clone(&header.source_schema),
            blocks,
            header: header.clone(),
        }),
        labels,
        missing,
    })
}

pub fn decode_additional_labels(
    prior: &Index,
    columns: &[Bytes],
    names: &[String],
) -> Result<Index> {
    let header = &prior.base.header;
    let (projection, missing) = header.projection(names)?;
    ensure!(
        columns.len() == projection.len(),
        "MIDX label count mismatch"
    );
    let mut decoder = super::compact::frame_decoder()?;
    let labels = decode_labels(header, columns, &projection, &mut decoder)?;
    for i in 1..header.blocks {
        if prior.blocks.block(i).hash == prior.blocks.block(i - 1).hash {
            for column in labels.columns() {
                ensure!(
                    label_value(column.as_ref(), i)? == label_value(column.as_ref(), i - 1)?,
                    "label metadata changes within one series"
                );
            }
        }
    }
    Ok(Index {
        base: Arc::clone(&prior.base),
        labels,
        missing,
    })
}

fn decode_labels(
    header: &Header,
    columns: &[Bytes],
    projection: &[usize],
    decoder: &mut zstd::bulk::Decompressor<'static>,
) -> Result<RecordBatch> {
    let rows = header.blocks;
    let mut fields = Vec::with_capacity(projection.len());
    let mut label_columns: Vec<ArrayRef> = Vec::with_capacity(projection.len());
    for (bytes, index) in columns.iter().zip(projection) {
        let label = &header.labels[*index];
        ensure!(
            bytes.len() as u64 == label.column.range.end - label.column.range.start,
            "MIDX label byte length mismatch"
        );
        let field = header.source_schema.field_with_name(&label.name)?;
        let column = super::compact::decode_frame(
            decoder,
            bytes,
            label.column.raw,
            field.data_type(),
            rows,
        )?;
        ensure!(
            field.is_nullable() || column.null_count() == 0,
            "null in non-nullable MIDX label"
        );
        fields.push(Arc::new(
            field.clone().with_data_type(column.data_type().clone()),
        ));
        label_columns.push(column);
    }
    Ok(RecordBatch::try_new_with_options(
        Arc::new(Schema::new(fields)),
        label_columns,
        &RecordBatchOptions::new().with_row_count(Some(rows)),
    )?)
}

/// Decodes an index from the complete bytes of one MIDX file.
pub fn decode_file(file: &[u8], expected: &ParentMetadata, labels: &[String]) -> Result<Index> {
    let header = Header::parse(file, file.len() as u64, expected)?;
    let columns = header
        .column_ranges(labels)?
        .into_iter()
        .map(|range| {
            file.get(usize::try_from(range.start)?..usize::try_from(range.end)?)
                .map(Bytes::copy_from_slice)
                .context("MIDX column outside file")
        })
        .collect::<Result<Vec<_>>>()?;
    decode_index(&header, &columns, labels)
}

pub fn decode_block(block_bytes: &[u8], block: &BlockMeta) -> Result<DecodedBlock> {
    let mut decoder = BlockDecoder::with_capacity(block.row_count as usize)?;
    decoder.decode(block_bytes, block)?;
    Ok(DecodedBlock {
        timestamps: decoder.timestamps,
        value_bits: decoder.value_bits,
    })
}

fn decode_directory(
    columns: &[ArrayRef],
    parent: &ParentMetadata,
    blocks_end: u64,
) -> Result<BlockDirectory> {
    let count = columns[0].len();
    let hashes = columns[0]
        .as_any()
        .downcast_ref::<UInt64Array>()
        .context("hash type")?;
    let row_starts = columns[1]
        .as_any()
        .downcast_ref::<UInt64Array>()
        .context("row offset type")?;
    let counts = columns[2]
        .as_any()
        .downcast_ref::<UInt32Array>()
        .context("count type")?;
    let min_times = columns[3]
        .as_any()
        .downcast_ref::<Int64Array>()
        .context("min time type")?;
    let max_times = columns[4]
        .as_any()
        .downcast_ref::<Int64Array>()
        .context("max time type")?;
    let offsets = columns[5]
        .as_any()
        .downcast_ref::<UInt64Array>()
        .context("offset type")?;
    let lengths = columns[6]
        .as_any()
        .downcast_ref::<UInt32Array>()
        .context("length type")?;
    let strict = columns[7]
        .as_any()
        .downcast_ref::<BooleanArray>()
        .context("strict type")?;
    let mut blocks = super::directory::DirectoryBuilder::new(count, parent.rows, blocks_end);
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
            "noncontiguous row or block directory"
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
            "noncontiguous block directory"
        );
        next_offset = next_offset
            .checked_add(u64::from(block.block_length))
            .context("blocks end overflow")?;
        ensure!(
            next_row <= parent.rows && next_offset <= blocks_end,
            "block outside parent bounds"
        );
        previous = Some((block.hash, block.max_timestamp));
        blocks.push(block);
    }
    ensure!(
        next_row == parent.rows && next_offset == blocks_end,
        "directory does not tile source rows and blocks"
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
        let block_bytes = zstd::bulk::compress(&raw, 1).unwrap();
        let block = BlockMeta {
            hash: 7,
            row_start: 0,
            row_count: samples.len() as u32,
            min_timestamp: samples[0].0,
            max_timestamp: samples.last().unwrap().0,
            block_offset: 0,
            block_length: block_bytes.len() as u32,
            strictly_increasing: samples.windows(2).all(|w| w[0].0 < w[1].0),
        };
        (block_bytes, block)
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
            let (block_bytes, block) = fixture(&samples);
            let decoded = decoder.decode(&block_bytes, &block).unwrap();
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
        let (block_bytes, block) = fixture(&samples);
        let mut decoder = BlockDecoder::new().unwrap();
        decoder.decode(&block_bytes, &block).unwrap();
        let mut corrupt = block_bytes.clone();
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
            (&block_bytes[..], &bad_endpoint),
            (&block_bytes[..], &bad_strict),
            (&block_bytes[..], &too_many),
        ] {
            assert!(decoder.decode(bytes, metadata).is_err());
            assert!(decoder.timestamps.is_empty());
            assert!(decoder.value_bits.is_empty());
            let actual = decoder.decode(&block_bytes, &block).unwrap();
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
        let (block_bytes, metadata) = fixture(&samples);
        let owned = decode_block(&block_bytes, &metadata).unwrap();
        let mut first = BlockDecoder::new().unwrap();
        let mut second = BlockDecoder::new().unwrap();
        let borrowed = first.decode(&block_bytes, &metadata).unwrap();
        let (other_block_bytes, other_metadata) = fixture(&[(77, f64::INFINITY.to_bits())]);
        second.decode(&other_block_bytes, &other_metadata).unwrap();
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
