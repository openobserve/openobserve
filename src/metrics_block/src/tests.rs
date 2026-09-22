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

use std::{collections::HashMap, sync::Arc};

use arrow::{
    array::{
        ArrayRef, Float64Array, Int64Array, RecordBatch, StringArray, StringViewArray, UInt32Array,
        UInt64Array,
    },
    datatypes::{DataType, Field, Schema},
};
use bytes::Bytes;

use crate::*;

type Row = (u64, i64, u64, Option<&'static str>, Option<&'static str>);

#[derive(Default)]
struct WriteState {
    bytes: Vec<u8>,
    flush_has_marker: Vec<bool>,
}

struct FailureWriter {
    state: Arc<std::sync::Mutex<WriteState>>,
    fail_after: usize,
    fail_flush: usize,
}

impl std::io::Write for FailureWriter {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        let mut state = self.state.lock().unwrap();
        if state.bytes.len() >= self.fail_after {
            return Err(std::io::Error::other("injected write failure"));
        }
        let size = bytes.len().min(self.fail_after - state.bytes.len());
        state.bytes.extend_from_slice(&bytes[..size]);
        Ok(size)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        let mut state = self.state.lock().unwrap();
        let has_marker = state.bytes.ends_with(MAGIC);
        state.flush_has_marker.push(has_marker);
        if state.flush_has_marker.len() == self.fail_flush {
            return Err(std::io::Error::other("injected flush failure"));
        }
        Ok(())
    }
}

fn build_from_parquet(
    bytes: bytes::Bytes,
    parent: crate::ParentMetadata,
) -> anyhow::Result<Vec<u8>> {
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    anyhow::ensure!(
        bytes.len() as u64 == parent.compressed_size,
        "source size mismatch"
    );
    let builder = ParquetRecordBatchReaderBuilder::try_new(bytes)?;
    let schema = builder.schema().clone();
    let metadata = builder.metadata().as_ref().clone();
    let mut writer =
        crate::BlockWriter::new_pending(Vec::new(), schema.clone(), crate::MAX_BLOCK_ROWS)?;
    for batch in builder.with_batch_size(crate::MAX_BLOCK_ROWS).build()? {
        let batch = batch?;
        let batch = RecordBatch::try_new(schema.clone(), batch.columns().to_vec())?;
        writer.write(&batch)?;
    }
    writer.finish_for_parquet(parent, metadata)
}

fn schema() -> SchemaRef {
    Arc::new(Schema::new_with_metadata(
        vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("label_a", DataType::Utf8, true),
            Field::new("label_b", DataType::Utf8View, true),
        ],
        HashMap::from([("semantic".into(), "retained".into())]),
    ))
}

fn rows() -> Vec<Row> {
    vec![
        (1, 10, 1f64.to_bits(), None, Some("")),
        (1, 10, (-0f64).to_bits(), None, Some("")),
        (1, 21, 0x7ff8_0000_0000_0021, None, Some("")),
        (1, 25, f64::INFINITY.to_bits(), None, Some("")),
        (
            u64::MAX,
            i64::MIN,
            f64::NEG_INFINITY.to_bits(),
            Some(""),
            None,
        ),
        (u64::MAX, -1, 3.5f64.to_bits(), Some(""), None),
        (u64::MAX, i64::MAX, 0x7ff8_0000_0000_0042, Some(""), None),
    ]
}

fn batch(rows: &[Row]) -> RecordBatch {
    RecordBatch::try_new(
        schema(),
        vec![
            Arc::new(UInt64Array::from_iter_values(rows.iter().map(|r| r.0))),
            Arc::new(Int64Array::from_iter_values(rows.iter().map(|r| r.1))),
            Arc::new(Float64Array::from_iter_values(
                rows.iter().map(|r| f64::from_bits(r.2)),
            )),
            Arc::new(StringArray::from_iter(rows.iter().map(|r| r.3))),
            Arc::new(StringViewArray::from_iter(rows.iter().map(|r| r.4))),
        ],
    )
    .unwrap()
}

fn parent() -> ParentMetadata {
    ParentMetadata {
        rows: 7,
        compressed_size: 123,
    }
}

fn fixture() -> Vec<u8> {
    let rows = rows();
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    for range in [0..1, 1..5, 5..7] {
        writer.write(&batch(&rows[range])).unwrap();
    }
    writer.finish().unwrap()
}

fn index(blob: &[u8], labels: &[&str]) -> Result<Index> {
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64)?;
    decode_index(
        Bytes::copy_from_slice(
            &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
        ),
        &footer,
        &parent(),
        &labels.iter().map(|s| s.to_string()).collect::<Vec<_>>(),
    )
}

#[test]
fn roundtrip_preserves_bits_duplicates_null_empty_and_batch_boundaries() {
    let blob = fixture();
    let index = index(&blob, &["label_b", "label_a", "missing"]).unwrap();
    assert_eq!(index.blocks.len(), 4);
    assert!(!index.blocks.block(0).strictly_increasing);
    assert!(index.blocks.block(1).strictly_increasing);
    let mut actual = Vec::new();
    for (i, block) in index.blocks.iter().enumerate() {
        let range = block.block_range();
        let decoded =
            decode_block(&blob[range.start as usize..range.end as usize], &block).unwrap();
        for (time, value) in decoded.timestamps.iter().zip(&decoded.value_bits) {
            actual.push((block.hash, *time, *value));
        }
        assert_eq!(index.label_value(i, "missing").unwrap(), None);
    }
    assert_eq!(
        actual,
        rows().iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
    );
    assert_eq!(
        index
            .label_values(0, &["label_a".into(), "label_b".into()])
            .unwrap(),
        vec![None, Some("".into())]
    );
    assert_eq!(
        index
            .label_values(2, &["label_a".into(), "label_b".into()])
            .unwrap(),
        vec![Some("".into()), None]
    );
    assert!(index.label_value(0, "not_projected").is_err());
}

#[test]
fn deterministic_independent_of_input_batch_boundaries() {
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    writer.write(&batch(&rows())).unwrap();
    assert_eq!(writer.finish().unwrap(), fixture());
}

#[test]
fn numeric_parent_version_bounds_and_decoder_claims_are_checked() {
    let blob = fixture();
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let bytes = Bytes::copy_from_slice(
        &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
    );
    let mut wrong = parent();
    wrong.compressed_size += 1;
    assert!(decode_index(bytes.clone(), &footer, &wrong, &[]).is_err());
    wrong = parent();
    wrong.rows += 1;
    assert!(decode_index(bytes.clone(), &footer, &wrong, &[]).is_err());
    let mut modified = bytes.to_vec();
    modified[10] ^= 1;
    assert!(decode_index(Bytes::from(modified), &footer, &parent(), &[]).is_err());
    assert!(decode_index(bytes.clone(), &footer, &parent(), &["value".into()]).is_err());
    let mut end = blob[blob.len() - FOOTER_LEN..].to_vec();
    end[..4].copy_from_slice(&(VERSION + 1).to_le_bytes());
    assert!(read_footer(&end, blob.len() as u64).is_err());
    end = blob[blob.len() - FOOTER_LEN..].to_vec();
    end[8..16].copy_from_slice(&u64::MAX.to_le_bytes());
    assert!(read_footer(&end, blob.len() as u64).is_err());
    assert!(read_footer(&end[..FOOTER_LEN - 1], blob.len() as u64).is_err());
    let index = index(&blob, &[]).unwrap();
    let b = &index.blocks.block(0);
    let range = b.block_range();
    let payload = &blob[range.start as usize..range.end as usize];
    let mut corrupt = payload.to_vec();
    corrupt[0] ^= 1;
    assert!(decode_block(&corrupt, b).is_err());
    assert!(decode_block(&payload[..payload.len() - 1], b).is_err());
    let mut claim = b.clone();
    claim.max_timestamp += 1;
    assert!(decode_block(payload, &claim).is_err());
    claim = b.clone();
    claim.strictly_increasing = true;
    assert!(decode_block(payload, &claim).is_err());
    claim = b.clone();
    claim.row_count = (MAX_BLOCK_ROWS + 1) as u32;
    assert!(decode_block(payload, &claim).is_err());
}

fn expanded_metadata_batch(encoded: &crate::compact::CompactMetadata<'_>) -> Result<RecordBatch> {
    let schema = encoded.schema();
    let batch = encoded.compact_batch(&(0..schema.fields().len()).collect::<Vec<_>>())?;
    let columns = batch
        .columns()
        .iter()
        .zip(schema.fields())
        .map(|(column, field)| arrow::compute::cast(column, field.data_type()))
        .collect::<std::result::Result<Vec<_>, _>>()?;
    Ok(RecordBatch::try_new(schema, columns)?)
}

fn replace_column(blob: &[u8], column: usize, value: ArrayRef) -> Vec<u8> {
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let raw = &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize];
    let encoded = crate::compact::CompactMetadata::parse(raw).unwrap();
    let old = expanded_metadata_batch(&encoded).unwrap();
    let mut columns = old.columns().to_vec();
    columns[column] = value;
    let batch = RecordBatch::try_new(old.schema(), columns).unwrap();
    let meta = crate::compact::encode(&batch).unwrap();
    let mut result = blob[..footer.metadata_range.start as usize].to_vec();
    result.extend_from_slice(&meta);
    let mut end = blob[blob.len() - FOOTER_LEN..].to_vec();
    end[16..24].copy_from_slice(&(meta.len() as u64).to_le_bytes());
    result.extend_from_slice(&end);
    result
}

#[test]
fn completed_footer_does_not_hide_invalid_directory() {
    let blob = fixture();
    let corrupt = replace_column(&blob, 2, Arc::new(UInt32Array::from(vec![0, 2, 2, 1])));
    assert!(index(&corrupt, &[]).is_err());
    let corrupt = replace_column(
        &blob,
        1,
        Arc::new(UInt64Array::from(vec![u64::MAX, 2, 4, 6])),
    );
    assert!(index(&corrupt, &[]).is_err());
    let corrupt = replace_column(
        &blob,
        6,
        Arc::new(UInt32Array::from(vec![u32::MAX, 1, 1, 1])),
    );
    assert!(index(&corrupt, &[]).is_err());
}

#[test]
fn changed_labels_order_schema_and_row_totals_fail_closed() {
    let mut input = rows();
    input[1].3 = Some("");
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    assert!(writer.write(&batch(&input)).is_err());
    assert!(writer.finish().is_err());
    let mut input = rows();
    input[2].1 = 9;
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    assert!(writer.write(&batch(&input)).is_err());
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    writer.write(&batch(&rows()[..3])).unwrap();
    assert!(writer.finish().is_err());
    let other = Arc::new(
        schema()
            .as_ref()
            .clone()
            .with_metadata(HashMap::from([("semantic".into(), "changed".into())])),
    );
    let changed = RecordBatch::try_new(other, batch(&rows()).columns().to_vec()).unwrap();
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    assert!(writer.write(&changed).is_err());
}

#[test]
fn paths_and_supported_schema_are_generic_but_strict() {
    assert_eq!(
        sidecar_path("files/o/metrics/m/2026/09/18/07/custom=x/indexed-v1-a.parquet").as_deref(),
        Some("files/o/midx/m/2026/09/18/07/custom=x/indexed-v1-a.midx")
    );
    assert_eq!(
        sidecar_path("files/o/metrics/m/2026/09/18/07/custom=x/indexed-v1-a.vortex").as_deref(),
        Some("files/o/midx/m/2026/09/18/07/custom=x/indexed-v1-a.midx")
    );
    for key in [
        "files/o/metrics/m/2026/09/18/07/indexed-v1-a.unknown",
        "files/o/logs/m/2026/09/18/07/indexed-v1-a.parquet",
        "files/o/metrics/m/2026/09/18/07/hash-sorted-v1-a.parquet",
        "files/o/metrics/m/2026/09/18/../indexed-v1-a.parquet",
    ] {
        assert!(sidecar_path(key).is_none());
    }
    assert_eq!(
        identity_label_columns(schema().as_ref()).unwrap(),
        vec!["label_a", "label_b"]
    );
    for name in ["start_time", "flag", "trace_id", "exemplars"] {
        let mut fields = schema().fields().to_vec();
        fields.push(Arc::new(Field::new(name, DataType::Utf8, true)));
        assert!(!is_supported_schema(&Schema::new(fields)));
    }
}

#[test]
fn projected_labels_do_not_retain_unrequested_large_buffers() {
    let values = rows();
    let input = batch(&values);
    let large = "x".repeat(100_000);
    let mut columns = input.columns().to_vec();
    columns[3] = Arc::new(StringArray::from(vec![Some(large.as_str()); values.len()]));
    let input = RecordBatch::try_new(schema(), columns).unwrap();
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    writer.write(&input).unwrap();
    let blob = writer.finish().unwrap();
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let metadata_bytes = (footer.metadata_range.end - footer.metadata_range.start) as usize;
    let index = index(&blob, &["label_b"]).unwrap();
    assert!(metadata_bytes < 100_000);
    assert!(
        index.labels.get_array_memory_size() < 32_000,
        "projected labels pin a large unrequested allocation"
    );
}

#[test]
fn excessive_compressed_length_and_capacity_classification() {
    let blob = fixture();
    let index = index(&blob, &[]).unwrap();
    let mut block = index.blocks.block(0).clone();
    let range = block.block_range();
    block.block_length =
        u32::try_from(max_compressed_block_len(block.row_count).unwrap() + 1).unwrap();
    let error = decode_block(&blob[range.start as usize..range.end as usize], &block).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("compressed block length exceeds")
    );
    let mut lengths: Vec<_> = index.blocks.iter().map(|b| b.block_length).collect();
    let delta = block.block_length - lengths[0];
    lengths[0] = block.block_length;
    let changed = replace_column(&blob, 6, Arc::new(UInt32Array::from(lengths)));
    let offsets: Vec<_> = index
        .blocks
        .iter()
        .enumerate()
        .map(|(i, b)| b.block_offset + if i == 0 { 0 } else { u64::from(delta) })
        .collect();
    let changed = replace_column(&changed, 5, Arc::new(UInt64Array::from(offsets)));
    let old_end = changed.len() - FOOTER_LEN;
    let mut padded = changed[..range.end as usize].to_vec();
    padded.extend(std::iter::repeat_n(0, delta as usize));
    padded.extend_from_slice(&changed[range.end as usize..old_end]);
    let mut footer = changed[old_end..].to_vec();
    let start = u64::from_le_bytes(footer[8..16].try_into().unwrap()) + u64::from(delta);
    footer[8..16].copy_from_slice(&start.to_le_bytes());
    padded.extend_from_slice(&footer);
    let error = crate::tests::index(&padded, &[]).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("compressed block length exceeds")
    );
    let limit = capacity(false, "MAX_LABEL_COLUMNS").unwrap_err();
    assert!(is_format_limit_error(&limit));
    assert!(is_format_limit_error(&limit.context("builder")));
    let ordinary = anyhow!("invalid sample frame");
    assert!(!is_format_limit_error(&ordinary));
}

#[test]
fn duplicates_across_chunk_boundary_remain_exact_and_visible() {
    let input = batch(&rows());
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        1,
    )
    .unwrap();
    writer.write(&input).unwrap();
    let blob = writer.finish().unwrap();
    let index = index(&blob, &[]).unwrap();
    assert!(index.blocks.iter().all(|block| block.strictly_increasing));
    assert_eq!(
        index.blocks.block(0).max_timestamp,
        index.blocks.block(1).min_timestamp
    );
    assert_eq!(index.blocks.block(0).hash, index.blocks.block(1).hash);
}

#[test]
fn long_view_backing_buffers_and_real_writer_capacity_limit() {
    let input = batch(&rows());
    let mut columns = input.columns().to_vec();
    columns[4] = Arc::new(StringViewArray::from(vec![
        Some(
            "a long label requiring view backing buffers"
        );
        7
    ]));
    let input = RecordBatch::try_new(schema(), columns).unwrap();
    let mut writer = BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        2,
    )
    .unwrap();
    writer.write(&input).unwrap();
    let blob = writer.finish().unwrap();
    let decoded = index(&blob, &["label_b"]).unwrap();
    assert_eq!(
        decoded.label_value(0, "label_b").unwrap(),
        Some("a long label requiring view backing buffers")
    );

    let mut fields = schema().fields().to_vec();
    let mut labels = vec!["label_a".to_owned(), "label_b".to_owned()];
    for i in 0..MAX_LABEL_COLUMNS {
        let name = format!("additional_{i}");
        fields.push(Arc::new(Field::new(&name, DataType::Utf8, true)));
        labels.push(name);
    }
    let too_wide = Arc::new(Schema::new(fields));
    assert!(is_format_limit_error(
        &identity_label_columns(too_wide.as_ref()).unwrap_err()
    ));
    let error = BlockWriter::new(Vec::new(), too_wide, labels, parent(), 2)
        .err()
        .unwrap();
    assert!(is_format_limit_error(&error));
}

#[test]
fn lossless_transform_preserves_extreme_timestamps_resets_and_all_float_bits() {
    let timestamp = [
        i64::MIN,
        i64::MIN + 1,
        -1,
        0,
        0,
        15_000_000,
        31_000_007,
        i64::MAX - 1,
        i64::MAX,
    ];
    let bits = [
        0,
        (-0f64).to_bits(),
        0x7ff0_0000_0000_0001,
        0x7ff8_0000_0000_0042,
        0xfff8_0000_0000_0042,
        f64::INFINITY.to_bits(),
        f64::NEG_INFINITY.to_bits(),
        100f64.to_bits(),
        1f64.to_bits(),
    ];
    let rows: Vec<_> = timestamp
        .into_iter()
        .zip(bits)
        .map(|(t, v)| (1, t, v, None, None))
        .collect();
    let mut identity = parent();
    identity.rows = rows.len() as u64;
    for max_rows in [1, 4, 9] {
        let mut writer = BlockWriter::new(
            Vec::new(),
            schema(),
            vec!["label_a".into(), "label_b".into()],
            identity.clone(),
            max_rows,
        )
        .unwrap();
        writer.write(&batch(&rows)).unwrap();
        let blob = writer.finish().unwrap();
        let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
        let index = decode_index(
            Bytes::copy_from_slice(
                &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
            ),
            &footer,
            &identity,
            &[],
        )
        .unwrap();
        let mut actual = Vec::new();
        for block in &index.blocks {
            let range = block.block_range();
            let decoded =
                decode_block(&blob[range.start as usize..range.end as usize], &block).unwrap();
            actual.extend(decoded.timestamps.into_iter().zip(decoded.value_bits));
        }
        assert_eq!(actual, timestamp.into_iter().zip(bits).collect::<Vec<_>>());
        let mut old_footer = blob[blob.len() - FOOTER_LEN..].to_vec();
        old_footer[24..].copy_from_slice(b"UNKNOWN!");
        old_footer[..4].copy_from_slice(&1u32.to_le_bytes());
        assert!(read_footer(&old_footer, blob.len() as u64).is_err());
    }
}

#[test]
fn compact_metadata_rejects_truncation_corruption_and_excessive_claims() {
    let compact = fixture();
    let footer = read_footer(&compact[compact.len() - FOOTER_LEN..], compact.len() as u64).unwrap();
    let metadata =
        &compact[footer.metadata_range.start as usize..footer.metadata_range.end as usize];
    for n in 0..metadata.len() {
        assert!(crate::compact::CompactMetadata::parse(&metadata[..n]).is_err());
    }
    let mut corrupt = compact.clone();
    corrupt[footer.metadata_range.start as usize + 8] ^= 1;
    assert!(index(&corrupt, &["label_a"]).is_err());
    let header_len = u32::from_le_bytes(metadata[8..12].try_into().unwrap()) as usize;
    let header: serde_json::Value = serde_json::from_slice(&metadata[12..12 + header_len]).unwrap();
    for target in ["rows", "section"] {
        let mut h = header.clone();
        if target == "rows" {
            h["rows"] = usize::MAX.into();
        } else {
            h["sections"][0]["raw"] = usize::MAX.into();
        }
        let encoded = serde_json::to_vec(&h).unwrap();
        let mut bad = b"O2META01".to_vec();
        bad.extend_from_slice(&(encoded.len() as u32).to_le_bytes());
        bad.extend_from_slice(&encoded);
        bad.extend_from_slice(&metadata[12 + header_len..]);
        assert!(crate::compact::CompactMetadata::parse(&bad).is_err());
    }
}

#[test]
fn compact_encoder_accepts_large_metadata_header() {
    let blob = fixture();
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let encoded = crate::compact::CompactMetadata::parse(
        &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
    )
    .unwrap();
    let original = expanded_metadata_batch(&encoded).unwrap();
    let mut metadata = original.schema().metadata().clone();
    metadata.insert("large".into(), "x".repeat(1024 * 1024));
    let schema = Arc::new(Schema::new_with_metadata(
        original.schema().fields().clone(),
        metadata,
    ));
    let oversized = RecordBatch::try_new(schema, original.columns().to_vec()).unwrap();
    let bytes = crate::compact::encode(&oversized).unwrap();
    assert!(crate::compact::CompactMetadata::parse(&bytes).is_ok());
}

#[test]
fn parquet_build_roundtrip_preserves_sql_source_and_row_groups() {
    use parquet::{
        arrow::{ArrowWriter, arrow_reader::ParquetRecordBatchReaderBuilder},
        file::properties::WriterProperties,
    };
    let input = batch(&rows());
    let mut parquet = Vec::new();
    let props = WriterProperties::builder()
        .set_max_row_group_row_count(Some(3))
        .build();
    let mut writer = ArrowWriter::try_new(&mut parquet, input.schema(), Some(props)).unwrap();
    writer.write(&input).unwrap();
    writer.close().unwrap();
    let original = Bytes::from(parquet);
    let parent = ParentMetadata {
        compressed_size: original.len() as u64,
        ..parent()
    };
    let container = build_from_parquet(original.clone(), parent.clone()).unwrap();
    let footer = read_footer(
        &container[container.len() - FOOTER_LEN..],
        container.len() as u64,
    )
    .unwrap();
    let parsed = decode_index(
        Bytes::copy_from_slice(
            &container[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
        ),
        &footer,
        &parent,
        &["label_a".into()],
    )
    .unwrap();
    assert_eq!(footer.version, VERSION);
    assert_eq!(parsed.row_group_size, Some(3));
    assert_eq!(parsed.source_schema, input.schema());
    let mut actual = Vec::new();
    for block in &parsed.blocks {
        let range = block.block_range();
        let decoded =
            decode_block(&container[range.start as usize..range.end as usize], &block).unwrap();
        actual.extend(decoded.timestamps.into_iter().zip(decoded.value_bits));
    }
    assert_eq!(
        actual,
        rows().iter().map(|r| (r.1, r.2)).collect::<Vec<_>>()
    );
    let sql_batches = ParquetRecordBatchReaderBuilder::try_new(original)
        .unwrap()
        .build()
        .unwrap()
        .collect::<std::result::Result<Vec<_>, _>>()
        .unwrap();
    let sql = arrow::compute::concat_batches(&input.schema(), &sql_batches).unwrap();
    assert_eq!(sql.num_rows(), input.num_rows());
    for (row, expected) in actual.iter().enumerate() {
        let times = sql.column(1).as_any().downcast_ref::<Int64Array>().unwrap();
        let values = sql
            .column(2)
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        assert_eq!((times.value(row), values.value(row).to_bits()), *expected);
    }
}

#[test]
fn pending_writer_requires_source_metadata_and_verifies_final_parquet_rows() {
    use parquet::arrow::{ArrowWriter, arrow_reader::ParquetRecordBatchReaderBuilder};
    let input = batch(&rows());
    let mut data = Vec::new();
    let mut parquet = ArrowWriter::try_new(&mut data, input.schema(), None).unwrap();
    parquet.write(&input).unwrap();
    parquet.close().unwrap();
    let bytes = Bytes::from(data);
    let reader = ParquetRecordBatchReaderBuilder::try_new(bytes.clone()).unwrap();
    let metadata = reader.metadata().as_ref().clone();
    let parent = ParentMetadata {
        compressed_size: bytes.len() as u64,
        ..parent()
    };
    let pending = || {
        let mut writer =
            BlockWriter::new_pending(Vec::new(), input.schema(), MAX_BLOCK_ROWS).unwrap();
        writer.write(&input).unwrap();
        writer
    };
    assert!(pending().finish().is_err());
    let mut wrong = parent.clone();
    wrong.rows += 1;
    assert!(
        pending()
            .finish_for_parquet(wrong, metadata.clone())
            .is_err()
    );
    let mut wrong = parent.clone();
    wrong.compressed_size = 0;
    assert!(
        pending()
            .finish_for_parquet(wrong, metadata.clone())
            .is_err()
    );
    let encoded = pending()
        .finish_for_parquet(parent.clone(), metadata)
        .unwrap();
    assert_eq!(encoded, build_from_parquet(bytes, parent).unwrap());
}

#[test]
fn v2_footer_and_numeric_parent_have_no_key_or_checksum_columns() {
    let blob = fixture();
    let end = &blob[blob.len() - FOOTER_LEN..];
    assert_eq!(FOOTER_LEN, 32);
    assert_eq!(&end[..4], &2u32.to_le_bytes());
    assert_eq!(&end[4..8], &[0; 4]);
    assert_eq!(&end[24..], b"O2MIDX02");
    let footer = read_footer(end, blob.len() as u64).unwrap();
    assert_eq!(
        u64::from_le_bytes(end[8..16].try_into().unwrap()),
        footer.payload_end
    );
    assert_eq!(
        u64::from_le_bytes(end[16..24].try_into().unwrap()),
        footer.metadata_range.end - footer.metadata_range.start
    );
    let metadata = crate::compact::CompactMetadata::parse(
        &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
    )
    .unwrap();
    let schema = metadata.schema();
    assert_eq!(schema.fields().len(), 8 + 2);
    assert!(
        schema
            .fields()
            .iter()
            .all(|field| !field.name().contains("checksum"))
    );
    let parent: serde_json::Value = serde_json::from_str(&schema.metadata()[PARENT_KEY]).unwrap();
    assert_eq!(
        parent,
        serde_json::json!({"rows": 7, "compressed_size": 123})
    );
}

#[test]
fn terminal_footer_rejects_previous_format_truncation_and_invalid_structure() {
    let blob = fixture();
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let mut previous = [0u8; 64];
    previous[..8].copy_from_slice(b"O2MIDX01");
    previous[8..12].copy_from_slice(&1u32.to_le_bytes());
    previous[16..24].copy_from_slice(&footer.metadata_range.start.to_le_bytes());
    previous[24..32]
        .copy_from_slice(&(footer.metadata_range.end - footer.metadata_range.start).to_le_bytes());
    let previous_size = footer.metadata_range.end + previous.len() as u64;
    assert!(read_footer(&previous, previous_size).is_err());
    assert!(read_footer(&previous[previous.len() - FOOTER_LEN..], previous_size).is_err());
    for length in 0..blob.len() {
        let truncated = &blob[..length];
        let suffix = &truncated[length.saturating_sub(FOOTER_LEN)..];
        assert!(read_footer(suffix, length as u64).is_err());
    }
    for (range, bytes) in [
        (0..4, 1u32.to_le_bytes().to_vec()),
        (4..8, 1u32.to_le_bytes().to_vec()),
        (8..16, u64::MAX.to_le_bytes().to_vec()),
        (16..24, 0u64.to_le_bytes().to_vec()),
        (16..24, u64::MAX.to_le_bytes().to_vec()),
        (24..32, b"INCOMPLT".to_vec()),
    ] {
        let mut invalid = blob[blob.len() - FOOTER_LEN..].to_vec();
        invalid[range].copy_from_slice(&bytes);
        assert!(read_footer(&invalid, blob.len() as u64).is_err());
    }
    assert!(read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64 + 1).is_err());
    let bad_rows = replace_column(&blob, 2, Arc::new(UInt32Array::from(vec![2, 2, 2, 2])));
    assert!(index(&bad_rows, &[]).is_err());
    let parsed = index(&blob, &[]).unwrap();
    let mut offsets: Vec<_> = parsed
        .blocks
        .iter()
        .map(|block| block.block_offset)
        .collect();
    offsets[1] += 1;
    assert!(
        index(
            &replace_column(&blob, 5, Arc::new(UInt64Array::from(offsets))),
            &[]
        )
        .is_err()
    );
}

#[test]
fn completion_marker_is_last_and_write_or_flush_errors_propagate() {
    let complete = fixture();
    let footer = read_footer(
        &complete[complete.len() - FOOTER_LEN..],
        complete.len() as u64,
    )
    .unwrap();
    for (fail_after, fail_flush) in [
        (footer.metadata_range.start as usize + 1, usize::MAX),
        (complete.len() - 9, usize::MAX),
        (complete.len() - 4, usize::MAX),
        (usize::MAX, 1),
        (usize::MAX, 2),
        (usize::MAX, usize::MAX),
    ] {
        let state = Arc::new(std::sync::Mutex::new(WriteState::default()));
        let output = FailureWriter {
            state: Arc::clone(&state),
            fail_after,
            fail_flush,
        };
        let mut writer = BlockWriter::new(
            output,
            schema(),
            vec!["label_a".into(), "label_b".into()],
            parent(),
            2,
        )
        .unwrap();
        writer.write(&batch(&rows())).unwrap();
        let result = writer.finish();
        let observed = state.lock().unwrap();
        if fail_after == usize::MAX && fail_flush == usize::MAX {
            assert!(result.is_ok());
            assert_eq!(observed.bytes, complete);
            assert_eq!(observed.flush_has_marker, [false, true]);
        } else {
            assert!(result.is_err());
            if fail_flush != 2 {
                assert!(!observed.bytes.ends_with(MAGIC));
            }
        }
    }
}

#[test]
fn generic_source_finalizer_preserves_schema_without_row_groups() {
    let input = batch(&rows());
    let mut writer = BlockWriter::new_pending(Vec::new(), input.schema(), 2).unwrap();
    writer.write(&input).unwrap();
    let encoded = writer
        .finish_for_source(parent(), input.schema(), None)
        .unwrap();
    let decoded = index(&encoded, &["label_a", "label_b"]).unwrap();
    assert_eq!(decoded.parent, parent());
    assert_eq!(decoded.row_group_size, None);
    assert_eq!(decoded.source_schema, input.schema());
    let mut actual = Vec::new();
    for block in &decoded.blocks {
        let span = block.block_range();
        let values =
            decode_block(&encoded[span.start as usize..span.end as usize], &block).unwrap();
        actual.extend(values.timestamps.into_iter().zip(values.value_bits));
    }
    assert_eq!(
        actual,
        rows().iter().map(|row| (row.1, row.2)).collect::<Vec<_>>()
    );
}

#[test]
fn renamed_parquet_and_sidecar_pair_uses_numeric_source_metadata() {
    use parquet::arrow::{ArrowWriter, arrow_reader::ParquetRecordBatchReaderBuilder};
    let directory = tempfile::tempdir().unwrap();
    let data_path = directory.path().join("indexed-v1-before.parquet");
    let midx_path = directory.path().join("indexed-v1-before.midx");
    let input = batch(&rows());
    let mut writer = ArrowWriter::try_new(
        std::fs::File::create(&data_path).unwrap(),
        input.schema(),
        None,
    )
    .unwrap();
    writer.write(&input).unwrap();
    writer.close().unwrap();
    let original = Bytes::from(std::fs::read(&data_path).unwrap());
    let source = ParentMetadata {
        rows: input.num_rows() as u64,
        compressed_size: original.len() as u64,
    };
    std::fs::write(&midx_path, build_from_parquet(original, source).unwrap()).unwrap();
    let moved = directory.path().join("moved");
    std::fs::create_dir(&moved).unwrap();
    let moved_data = moved.join("indexed-v1-after.parquet");
    let moved_index = moved.join("indexed-v1-after.midx");
    std::fs::rename(data_path, &moved_data).unwrap();
    std::fs::rename(midx_path, &moved_index).unwrap();
    let source =
        ParquetRecordBatchReaderBuilder::try_new(Bytes::from(std::fs::read(&moved_data).unwrap()))
            .unwrap();
    let expected = ParentMetadata {
        rows: source.metadata().file_metadata().num_rows() as u64,
        compressed_size: std::fs::metadata(moved_data).unwrap().len(),
    };
    let blob = std::fs::read(moved_index).unwrap();
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let parsed = decode_index(
        Bytes::copy_from_slice(
            &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
        ),
        &footer,
        &expected,
        &["label_a".into()],
    )
    .unwrap();
    assert_eq!(parsed.parent, expected);
    assert_eq!(parsed.source_schema, input.schema());
    assert_eq!(
        parsed
            .blocks
            .iter()
            .map(|block| u64::from(block.row_count))
            .sum::<u64>(),
        input.num_rows() as u64
    );
}

#[test]
fn source_finalizer_still_rejects_schema_and_zero_row_group_claims() {
    let input = batch(&rows());
    let pending = || {
        let mut writer = BlockWriter::new_pending(Vec::new(), input.schema(), 2).unwrap();
        writer.write(&input).unwrap();
        writer
    };
    let changed = Arc::new(
        input
            .schema()
            .as_ref()
            .clone()
            .with_metadata(HashMap::from([(
                "semantic".to_owned(),
                "changed".to_owned(),
            )])),
    );
    assert!(
        pending()
            .finish_for_source(parent(), changed, None)
            .is_err()
    );
    assert!(
        pending()
            .finish_for_source(parent(), input.schema(), Some(0))
            .is_err()
    );
    let zero = ParentMetadata {
        rows: 0,
        compressed_size: 123,
    };
    assert!(
        pending()
            .finish_for_source(zero, input.schema(), None)
            .is_err()
    );
}

#[test]
fn sample_payload_requires_one_complete_frame() {
    let blob = fixture();
    let parsed = index(&blob, &[]).unwrap();
    let mut block = parsed.blocks.block(0);
    let range = block.block_range();
    let original = &blob[range.start as usize..range.end as usize];
    let mut trailing = original.to_vec();
    trailing.push(0);
    block.block_length = trailing.len() as u32;
    assert!(decode_block(&trailing, &block).is_err());
    block.block_length = (original.len() - 1) as u32;
    assert!(decode_block(&original[..original.len() - 1], &block).is_err());
}

#[test]
#[ignore = "Exercises a directory with over one million blocks"]
fn more_than_one_million_blocks_roundtrip() {
    let rows = 1_000_001usize;
    let schema = Arc::new(Schema::new(vec![
        Field::new("__hash__", DataType::UInt64, false),
        Field::new("_timestamp", DataType::Int64, false),
        Field::new("value", DataType::Float64, false),
    ]));
    let batch = RecordBatch::try_new(
        schema.clone(),
        vec![
            Arc::new(UInt64Array::from(vec![7; rows])),
            Arc::new(Int64Array::from_iter_values(0..rows as i64)),
            Arc::new(Float64Array::from(vec![1.; rows])),
        ],
    )
    .unwrap();
    let parent = ParentMetadata {
        rows: rows as u64,
        compressed_size: 100,
    };
    let mut writer = BlockWriter::new(Vec::new(), schema, vec![], parent.clone(), 1).unwrap();
    writer.write(&batch).unwrap();
    let bytes = writer.finish().unwrap();
    let footer = read_footer(&bytes[bytes.len() - FOOTER_LEN..], bytes.len() as u64).unwrap();
    let metadata = Bytes::copy_from_slice(
        &bytes[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
    );
    let index = decode_index(metadata, &footer, &parent, &[]).unwrap();
    assert_eq!(index.blocks.len(), rows);
    for (i, block) in index.blocks.iter().enumerate() {
        assert_eq!(block.hash, 7);
        let range = block.block_range();
        let decoded =
            decode_block(&bytes[range.start as usize..range.end as usize], &block).unwrap();
        assert_eq!(decoded.timestamps, vec![i as i64]);
        assert_eq!(decoded.value_bits, vec![1f64.to_bits()]);
    }
    eprintln!("one series, {} blocks, {} MIDX bytes", rows, bytes.len());
}
