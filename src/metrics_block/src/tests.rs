// Copyright 2026 OpenObserve Inc.
// SPDX-License-Identifier: AGPL-3.0-only
// The selection API takes a slice of row ranges, including a single range.
#![allow(clippy::single_range_in_vec_init)]
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

fn parent() -> ParentIdentity {
    ParentIdentity {
        object_key: "files/o/metrics/m/2026/09/18/07/indexed-v1-a.parquet".into(),
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
    assert!(!index.blocks[0].strictly_increasing);
    assert!(index.blocks[1].strictly_increasing);
    let mut actual = Vec::new();
    for (i, block) in index.blocks.iter().enumerate() {
        let range = block.payload_range();
        let decoded = decode_block(&blob[range.start as usize..range.end as usize], block).unwrap();
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
    assert!(index.estimated_heap_size() >= index.blocks.len() * std::mem::size_of::<BlockMeta>());
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
fn selection_is_whole_series_before_hash_or_time_pruning() {
    let blob = fixture();
    let index = index(&blob, &[]).unwrap();
    assert_eq!(index.labels.num_rows(), 4);
    assert_eq!(
        index.select_blocks(None, None, None).unwrap(),
        vec![0, 1, 2, 3]
    );
    assert_eq!(
        index.select_blocks(Some(&[0..4]), None, None).unwrap(),
        vec![0, 1]
    );
    assert_eq!(
        index
            .select_blocks(Some(&[0..1, 1..4]), None, None)
            .unwrap(),
        vec![0, 1]
    );
    assert!(index.select_blocks(Some(&[0..2]), None, None).is_err());
    assert!(
        index
            .select_blocks(Some(&[1..2]), Some((9, 10)), Some((999, 1000)))
            .is_err()
    );
    assert!(
        index
            .select_blocks(Some(&[0..4, 3..7]), None, None)
            .is_err()
    );
    assert!(index.select_blocks(Some(&[0..8]), None, None).is_err());
    assert_eq!(
        index
            .select_blocks(None, Some((u64::MAX, u64::MAX)), None)
            .unwrap(),
        vec![2, 3]
    );
    assert_eq!(
        index.select_blocks(None, Some((0, 0)), None).unwrap(),
        Vec::<usize>::new()
    );
    assert_eq!(
        index.select_blocks(None, None, Some((10, 10))).unwrap(),
        vec![0]
    );
    assert!(
        index
            .select_blocks(Some(&[]), None, None)
            .unwrap()
            .is_empty()
    );
}

#[test]
fn parent_version_checksums_bounds_and_decoder_claims_are_checked() {
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
    end[8..12].copy_from_slice(&(VERSION + 1).to_le_bytes());
    assert!(read_footer(&end, blob.len() as u64).is_err());
    end = blob[blob.len() - FOOTER_LEN..].to_vec();
    end[16..24].copy_from_slice(&u64::MAX.to_le_bytes());
    assert!(read_footer(&end, blob.len() as u64).is_err());
    assert!(read_footer(&end[..63], blob.len() as u64).is_err());
    let index = index(&blob, &[]).unwrap();
    let b = &index.blocks[0];
    let range = b.payload_range();
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

fn replace_column(blob: &[u8], column: usize, value: ArrayRef) -> Vec<u8> {
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let raw = &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize];
    let encoded = crate::compact::CompactMetadata::parse(raw).unwrap();
    let old = encoded
        .batch(&(0..encoded.schema().fields().len()).collect::<Vec<_>>())
        .unwrap();
    let mut columns = old.columns().to_vec();
    columns[column] = value;
    let batch = RecordBatch::try_new(old.schema(), columns).unwrap();
    let meta = crate::compact::encode(&batch).unwrap();
    let mut result = blob[..footer.metadata_range.start as usize].to_vec();
    result.extend_from_slice(&meta);
    let mut end = blob[blob.len() - FOOTER_LEN..].to_vec();
    end[24..32].copy_from_slice(&(meta.len() as u64).to_le_bytes());
    end[32..].copy_from_slice(&checksum(&meta));
    result.extend_from_slice(&end);
    result
}

#[test]
fn valid_checksum_does_not_hide_invalid_directory() {
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
    for key in [
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
        index.estimated_heap_size() < 32_000,
        "projected labels pin a large unrequested allocation"
    );
}

#[test]
fn binary_range_selection_handles_disjoint_endpoints_and_partial_series() {
    let blob = fixture();
    let index = index(&blob, &[]).unwrap();
    assert_eq!(
        index
            .select_blocks(Some(&[0..4, 4..7]), None, None)
            .unwrap(),
        vec![0, 1, 2, 3]
    );
    assert_eq!(
        index.select_blocks(Some(&[4..7]), None, None).unwrap(),
        vec![2, 3]
    );
    assert!(index.select_blocks(Some(&[2..4]), None, None).is_err());
    assert!(index.select_blocks(Some(&[4..6]), None, None).is_err());
    assert!(
        index
            .select_blocks(Some(&[0..4, 6..7]), None, None)
            .is_err()
    );
    assert!(
        index
            .select_blocks(Some(&[4..7, 0..4]), None, None)
            .is_err()
    );
    assert!(
        index
            .select_blocks(None, Some((2, 1)), None)
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        index
            .select_blocks(Some(&[0..4]), Some((u64::MAX, u64::MAX)), None)
            .unwrap(),
        Vec::<usize>::new()
    );
}

#[test]
fn excessive_compressed_length_and_capacity_classification() {
    let blob = fixture();
    let index = index(&blob, &[]).unwrap();
    let mut block = index.blocks[0].clone();
    let range = block.payload_range();
    block.payload_len =
        u32::try_from(max_compressed_block_len(block.row_count).unwrap() + 1).unwrap();
    let error = decode_block(&blob[range.start as usize..range.end as usize], &block).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("compressed block length exceeds")
    );
    let mut lengths: Vec<_> = index.blocks.iter().map(|b| b.payload_len).collect();
    let delta = block.payload_len - lengths[0];
    lengths[0] = block.payload_len;
    let changed = replace_column(&blob, 6, Arc::new(UInt32Array::from(lengths)));
    let offsets: Vec<_> = index
        .blocks
        .iter()
        .enumerate()
        .map(|(i, b)| b.payload_offset + if i == 0 { 0 } else { u64::from(delta) })
        .collect();
    let changed = replace_column(&changed, 5, Arc::new(UInt64Array::from(offsets)));
    let old_end = changed.len() - FOOTER_LEN;
    let mut padded = changed[..range.end as usize].to_vec();
    padded.extend(std::iter::repeat_n(0, delta as usize));
    padded.extend_from_slice(&changed[range.end as usize..old_end]);
    let mut footer = changed[old_end..].to_vec();
    let start = u64::from_le_bytes(footer[16..24].try_into().unwrap()) + u64::from(delta);
    footer[16..24].copy_from_slice(&start.to_le_bytes());
    padded.extend_from_slice(&footer);
    let error = crate::tests::index(&padded, &[]).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("compressed block length exceeds")
    );
    let limit = capacity(false, "MAX_BLOCKS").unwrap_err();
    assert!(is_format_limit_error(&limit));
    assert!(is_format_limit_error(&limit.context("builder")));
    let ordinary = anyhow!("checksum mismatch");
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
    assert_eq!(index.blocks[0].max_timestamp, index.blocks[1].min_timestamp);
    assert_eq!(index.blocks[0].hash, index.blocks[1].hash);
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
            let range = block.payload_range();
            let decoded =
                decode_block(&blob[range.start as usize..range.end as usize], block).unwrap();
            actual.extend(decoded.timestamps.into_iter().zip(decoded.value_bits));
        }
        assert_eq!(actual, timestamp.into_iter().zip(bits).collect::<Vec<_>>());
        let mut old_footer = blob[blob.len() - FOOTER_LEN..].to_vec();
        old_footer[..8].copy_from_slice(b"UNKNOWN!");
        old_footer[8..12].copy_from_slice(&1u32.to_le_bytes());
        assert!(read_footer(&old_footer, blob.len() as u64).is_err());
    }
}

fn linear_selection_reference(
    index: &Index,
    input: Option<&[std::ops::Range<usize>]>,
    hashes: Option<(u64, u64)>,
    time: Option<(i64, i64)>,
) -> Result<Vec<usize>> {
    let mut ranges: Vec<std::ops::Range<usize>> = Vec::new();
    match input {
        None => ranges.push(0..index.parent.rows as usize),
        Some(input) => {
            for range in input {
                ensure!(
                    range.start < range.end && range.end <= index.parent.rows as usize,
                    "bounds"
                );
                if let Some(last) = ranges.last_mut() {
                    ensure!(last.end <= range.start, "order");
                    if last.end == range.start {
                        last.end = range.end;
                        continue;
                    }
                }
                ranges.push(range.clone());
            }
        }
    }
    let mut boundaries: Vec<_> = index
        .blocks
        .iter()
        .enumerate()
        .filter(|(i, block)| *i == 0 || index.blocks[*i - 1].hash != block.hash)
        .map(|(_, block)| block.row_start as usize)
        .collect();
    boundaries.push(index.parent.rows as usize);
    for range in &ranges {
        ensure!(
            boundaries.contains(&range.start) && boundaries.contains(&range.end),
            "partial series"
        );
    }
    Ok(index
        .blocks
        .iter()
        .enumerate()
        .filter(|(_, block)| {
            ranges.iter().any(|range| {
                range.start as u64 <= block.row_start
                    && block.row_start + u64::from(block.row_count) <= range.end as u64
            }) && hashes.is_none_or(|(lo, hi)| lo <= block.hash && block.hash <= hi)
                && time.is_none_or(|(lo, hi)| {
                    lo <= hi && lo <= block.max_timestamp && block.min_timestamp <= hi
                })
        })
        .map(|(i, _)| i)
        .collect())
}

#[test]
fn dense_row_lookup_matches_independent_series_range_reference() {
    let index = index(&fixture(), &[]).unwrap();
    let mut selections = vec![None, Some(Vec::new())];
    for start in 0..=8 {
        for end in 0..=8 {
            selections.push(Some(vec![start..end]));
            selections.push(Some(vec![0..start, end..7]));
        }
    }
    for ranges in selections {
        for hashes in [
            None,
            Some((0, 0)),
            Some((1, 1)),
            Some((u64::MAX, u64::MAX)),
            Some((2, 1)),
        ] {
            for time in [
                None,
                Some((10, 10)),
                Some((i64::MIN, i64::MAX)),
                Some((26, 27)),
                Some((2, 1)),
            ] {
                let expected = linear_selection_reference(&index, ranges.as_deref(), hashes, time);
                let actual = index.select_blocks(ranges.as_deref(), hashes, time);
                assert_eq!(
                    actual.is_ok(),
                    expected.is_ok(),
                    "ranges={ranges:?}, hash={hashes:?}, time={time:?}"
                );
                if let Ok(expected) = expected {
                    assert_eq!(actual.unwrap(), expected);
                }
            }
        }
    }
}

#[test]
fn dense_row_lookup_is_owned_shared_by_arc_and_capacity_accounted() {
    let mut index = index(&fixture(), &[]).unwrap();
    assert_eq!(
        index.row_starts,
        index.blocks.iter().map(|b| b.row_start).collect::<Vec<_>>()
    );
    let before = index.estimated_heap_size();
    let old_capacity = index.row_starts.capacity();
    index.row_starts.reserve_exact(123);
    let added = (index.row_starts.capacity() - old_capacity) * std::mem::size_of::<u64>();
    assert!(added > 0);
    assert_eq!(index.estimated_heap_size() - before, added);
    let index = Arc::new(index);
    let other = Arc::clone(&index);
    assert!(Arc::ptr_eq(&index, &other));
    assert_eq!(index.row_starts.as_ptr(), other.row_starts.as_ptr());
    assert_eq!(
        other.select_blocks(Some(&[4..7]), None, None).unwrap(),
        vec![2, 3]
    );
}

#[test]
fn dense_row_lookup_rejects_descriptor_divergence_and_partial_series_before_pruning() {
    let blob = fixture();
    for endpoint in [0, 2] {
        let mut index = index(&blob, &[]).unwrap();
        index.blocks[endpoint].row_start += 1;
        let error = index.select_blocks(Some(&[0..4]), None, None).unwrap_err();
        assert!(error.to_string().contains("endpoint mismatch"));
    }
    let mut index = index(&blob, &[]).unwrap();
    index.blocks.pop();
    assert!(
        index
            .select_blocks(None, None, None)
            .unwrap_err()
            .to_string()
            .contains("count mismatch")
    );
    let index = crate::tests::index(&blob, &[]).unwrap();
    for ranges in [
        vec![1..4],
        vec![0..3],
        vec![2..4],
        vec![4..6],
        vec![0..4, 6..7],
    ] {
        assert!(
            index
                .select_blocks(Some(&ranges), Some((2, 1)), Some((2, 1)))
                .is_err()
        );
    }
    assert_eq!(
        index
            .select_blocks(Some(&[0..2, 2..4]), None, None)
            .unwrap(),
        vec![0, 1]
    );
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
            h["rows"] = (MAX_BLOCKS + 1).into();
        } else {
            h["sections"][0]["raw"] = (MAX_METADATA_BYTES + 1).into();
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
fn compact_encoder_classifies_capacity_for_optional_format_fallback() {
    let blob = fixture();
    let footer = read_footer(&blob[blob.len() - FOOTER_LEN..], blob.len() as u64).unwrap();
    let encoded = crate::compact::CompactMetadata::parse(
        &blob[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
    )
    .unwrap();
    let original = encoded
        .batch(&(0..encoded.schema().fields().len()).collect::<Vec<_>>())
        .unwrap();
    let mut metadata = original.schema().metadata().clone();
    metadata.insert("large".into(), "x".repeat(1024 * 1024));
    let schema = Arc::new(Schema::new_with_metadata(
        original.schema().fields().clone(),
        metadata,
    ));
    let oversized = RecordBatch::try_new(schema, original.columns().to_vec()).unwrap();
    let error = crate::compact::encode(&oversized).unwrap_err();
    assert!(is_format_limit_error(&error));
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
    let parent = ParentIdentity {
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
        let range = block.payload_range();
        let decoded =
            decode_block(&container[range.start as usize..range.end as usize], block).unwrap();
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
