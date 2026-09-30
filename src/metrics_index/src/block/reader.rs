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
    array::{Array, ArrayRef, RecordBatch, RecordBatchOptions},
    datatypes::Schema,
};
use bytes::Bytes;

use super::{
    compact::{decode_frame, decode_label_column, frame_decoder, get_varint, unzigzag},
    samples::SampleDecoder,
    *,
};

pub struct BlockDecoder {
    samples: SampleDecoder,
    timestamps: Vec<i64>,
    value_bits: Vec<u64>,
}

impl BlockDecoder {
    pub fn decode<'a>(
        &'a mut self,
        block_bytes: &[u8],
        block: &BlockMeta,
    ) -> Result<DecodedBlockRef<'a>> {
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

    fn with_capacity(rows: usize) -> Self {
        Self {
            samples: SampleDecoder::with_capacity(rows),
            timestamps: Vec::with_capacity(rows),
            value_bits: Vec::with_capacity(rows),
        }
    }

    fn decode_inner(&mut self, block_bytes: &[u8], block: &BlockMeta) -> Result<()> {
        ensure!(
            block_bytes.len() == block.block_length as usize,
            "block length mismatch"
        );
        self.samples.decode(
            block_bytes,
            block,
            &mut self.timestamps,
            &mut self.value_bits,
        )
    }
}

impl Default for BlockDecoder {
    fn default() -> Self {
        Self::with_capacity(MAX_BLOCK_ROWS)
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
    let mut decoder = frame_decoder()?;
    let mut raw = Vec::with_capacity(DIRECTORY_FIELDS);
    for column in &header.directory {
        let start = usize::try_from(column.range.start - directory.start)?;
        let end = usize::try_from(column.range.end - directory.start)?;
        raw.push(decode_frame(
            &mut decoder,
            &columns[0][start..end],
            column.raw,
        )?);
    }
    let blocks = decode_directory(&raw, rows, &header.parent, header.blocks_end)?;
    let labels = decode_labels(header, &columns[1..], &projection, &mut decoder)?;
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
    let mut decoder = frame_decoder()?;
    let labels = decode_labels(header, columns, &projection, &mut decoder)?;
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
        let column = decode_label_column(
            &decode_frame(decoder, bytes, label.column.raw)?,
            field.data_type(),
            rows,
        )?;
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
    let mut decoder = BlockDecoder::with_capacity(block.row_count as usize);
    decoder.decode(block_bytes, block)?;
    Ok(DecodedBlock {
        timestamps: decoder.timestamps,
        value_bits: decoder.value_bits,
    })
}

/// Rebuilds row starts and block offsets as prefix sums of the stored counts and lengths.
fn decode_directory(
    columns: &[Vec<u8>],
    count: usize,
    parent: &ParentMetadata,
    blocks_end: u64,
) -> Result<BlockDirectory> {
    ensure!(
        columns.len() == DIRECTORY_FIELDS,
        "invalid directory column count"
    );
    let mut positions = [0usize; DIRECTORY_FIELDS];
    let mut next = |field: usize| get_varint(&columns[field], &mut positions[field]);
    let mut blocks = super::directory::DirectoryBuilder::new(count, parent.rows, blocks_end);
    let (mut hash, mut min_timestamp) = (0u64, 0i64);
    let mut next_row = 0u64;
    let mut next_offset = 0u64;
    for _ in 0..count {
        hash = hash.wrapping_add(next(0)?);
        let row_count = u32::try_from(next(1)?).context("invalid block row count")?;
        min_timestamp = min_timestamp.wrapping_add(unzigzag(next(2)?));
        let max_timestamp = min_timestamp.wrapping_add(next(3)? as i64);
        let block_length = u32::try_from(next(4)?).context("block length exceeds format bound")?;
        let block = BlockMeta {
            hash,
            row_start: next_row,
            row_count,
            min_timestamp,
            max_timestamp,
            block_offset: next_offset,
            block_length,
        };
        ensure!(
            block.row_count > 0 && block.row_count as usize <= MAX_BLOCK_ROWS,
            "invalid block row count"
        );
        ensure!(
            block.block_length as usize <= max_block_len(block.row_count),
            "block length exceeds format bound"
        );
        ensure!(block.block_length > 0, "empty sample block");
        next_row = next_row
            .checked_add(u64::from(block.row_count))
            .context("row end overflow")?;
        next_offset = next_offset
            .checked_add(u64::from(block.block_length))
            .context("blocks end overflow")?;
        ensure!(
            next_row <= parent.rows && next_offset <= blocks_end,
            "block outside parent bounds"
        );
        blocks.push(block);
    }
    ensure!(
        positions
            .iter()
            .zip(columns)
            .all(|(position, column)| *position == column.len()),
        "directory column has unused bytes"
    );
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
        let timestamps: Vec<_> = samples.iter().map(|s| s.0).collect();
        let bits: Vec<_> = samples.iter().map(|s| s.1).collect();
        let mut block_bytes = Vec::new();
        super::super::samples::SampleEncoder::default()
            .encode_block(&timestamps, &bits, &mut block_bytes)
            .unwrap();
        let block = BlockMeta {
            hash: 7,
            row_start: 0,
            row_count: samples.len() as u32,
            min_timestamp: samples[0].0,
            max_timestamp: samples.last().unwrap().0,
            block_offset: 0,
            block_length: block_bytes.len() as u32,
        };
        (block_bytes, block)
    }

    #[test]
    fn reusable_decoder_keeps_bounded_allocations_across_block_sizes() {
        let mut decoder = BlockDecoder::default();
        let pointers = (decoder.timestamps.as_ptr(), decoder.value_bits.as_ptr());
        let capacities = (decoder.timestamps.capacity(), decoder.value_bits.capacity());
        assert_eq!(capacities, (MAX_BLOCK_ROWS, MAX_BLOCK_ROWS));
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
                (decoder.timestamps.as_ptr(), decoder.value_bits.as_ptr()),
                pointers
            );
            assert_eq!(
                (decoder.timestamps.capacity(), decoder.value_bits.capacity()),
                capacities
            );
        }
    }

    #[test]
    fn reusable_decoder_recovers_after_integrity_and_native_errors() {
        let samples = [(0, 0), (15_000_000, 1f64.to_bits()), (45_000_000, 0)];
        let (block_bytes, block) = fixture(&samples);
        let mut decoder = BlockDecoder::default();
        decoder.decode(&block_bytes, &block).unwrap();
        let mut corrupt = block_bytes.clone();
        corrupt[0] |= 0x80;
        let mut too_many = block.clone();
        too_many.row_count = MAX_BLOCK_ROWS as u32 + 1;
        let mut too_long = block.clone();
        too_long.block_length = max_block_len(3) as u32 + 1;
        for (bytes, metadata) in [
            (&corrupt[..], &block),
            (&block_bytes[..block_bytes.len() - 1], &block),
            (&block_bytes[..], &too_many),
            (&block_bytes[..], &too_long),
        ] {
            assert!(decoder.decode(bytes, metadata).is_err());
            assert!(decoder.timestamps.is_empty());
            assert!(decoder.value_bits.is_empty());
            let actual = decoder.decode(&block_bytes, &block).unwrap();
            assert_eq!(actual.timestamps, &[0, 15_000_000, 45_000_000]);
            assert_eq!(actual.value_bits, &[0, 1f64.to_bits(), 0]);
        }
    }

    #[test]
    fn reusable_decoder_rejects_inexact_decoded_lengths() {
        let mut decoder = BlockDecoder::default();
        let (valid, metadata) = fixture(&[(0, 0)]);
        for bytes in [&valid[..0], &[valid.as_slice(), &[0]].concat()] {
            let mut metadata = metadata.clone();
            metadata.block_length = bytes.len() as u32;
            assert!(decoder.decode(bytes, &metadata).is_err());
            assert!(decoder.timestamps.is_empty());
            assert!(decoder.value_bits.is_empty());
        }
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
        let mut first = BlockDecoder::default();
        let mut second = BlockDecoder::default();
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
