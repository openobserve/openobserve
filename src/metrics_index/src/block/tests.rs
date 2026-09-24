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

use super::*;

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
        let has_marker = state.bytes.ends_with(MIDX_MAGIC);
        state.flush_has_marker.push(has_marker);
        if state.flush_has_marker.len() == self.fail_flush {
            return Err(std::io::Error::other("injected flush failure"));
        }
        Ok(())
    }
}

fn build_from_parquet(
    bytes: bytes::Bytes,
    parent: super::ParentMetadata,
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
        super::BlockWriter::new_pending(Vec::new(), schema.clone(), super::MAX_BLOCK_ROWS)?;
    for batch in builder.with_batch_size(super::MAX_BLOCK_ROWS).build()? {
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

fn test_writer(max_rows: usize) -> BlockWriter<Vec<u8>> {
    BlockWriter::new(
        Vec::new(),
        schema(),
        vec!["label_a".into(), "label_b".into()],
        parent(),
        max_rows,
    )
    .unwrap()
}

fn header_data(blob: &[u8]) -> (super::header::HeaderData, usize) {
    let start = Header::trailer(blob, blob.len() as u64)
        .unwrap()
        .header_start(blob.len() as u64) as usize;
    let trailer = blob.len() - MIDX_TRAILER_LEN;
    (
        serde_json::from_slice(&blob[start..trailer]).unwrap(),
        start,
    )
}

fn trailer_of(blob: &[u8]) -> MidxTrailer {
    Header::trailer(blob, blob.len() as u64).unwrap()
}

/// Appends `data` and a trailer with the given region lengths.
fn append_header(
    out: &mut Vec<u8>,
    data: &super::header::HeaderData,
    label_len: u64,
    directory_len: u64,
) {
    let header = data.encode().unwrap();
    out.extend_from_slice(&header);
    let trailer = MidxTrailer {
        label_len,
        directory_len,
        header_len: header.len() as u32,
    };
    out.extend_from_slice(&trailer.encode());
}

fn decoded_rows(blob: &[u8], index: &Index) -> Vec<(u64, i64, u64)> {
    index
        .blocks
        .iter()
        .flat_map(|block| {
            let range = block.block_range();
            let samples =
                decode_block(&blob[range.start as usize..range.end as usize], &block).unwrap();
            samples
                .timestamps
                .into_iter()
                .zip(samples.value_bits)
                .map(move |(t, v)| (block.hash, t, v))
        })
        .collect()
}

fn parquet_bytes(input: &RecordBatch, row_group_size: usize) -> Bytes {
    use parquet::{arrow::ArrowWriter, file::properties::WriterProperties};
    let properties = WriterProperties::builder()
        .set_max_row_group_row_count(Some(row_group_size))
        .build();
    let mut writer = ArrowWriter::try_new(Vec::new(), input.schema(), Some(properties)).unwrap();
    writer.write(input).unwrap();
    Bytes::from(writer.into_inner().unwrap())
}

fn fixture() -> Vec<u8> {
    let rows = rows();
    let mut writer = test_writer(2);
    for range in [0..1, 1..5, 5..7] {
        writer.write(&batch(&rows[range])).unwrap();
    }
    writer.finish().unwrap()
}

fn index(blob: &[u8], labels: &[&str]) -> Result<Index> {
    decode_file(
        blob,
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
    assert_eq!(
        decoded_rows(&blob, &index),
        rows().iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
    );
    assert_eq!(index.label_value(0, "missing").unwrap(), None);
    let mut writer = test_writer(2);
    writer.write(&batch(&rows())).unwrap();
    assert_eq!(writer.finish().unwrap(), blob);
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
fn numeric_parent_and_projection_are_validated() {
    let blob = fixture();
    let mut wrong = parent();
    wrong.compressed_size += 1;
    assert!(decode_file(&blob, &wrong, &[]).is_err());
    wrong = parent();
    wrong.rows += 1;
    assert!(decode_file(&blob, &wrong, &[]).is_err());
    let mut modified = blob.clone();
    let (_, header_start) = header_data(&blob);
    modified[header_start] ^= 1;
    assert!(decode_file(&modified, &parent(), &[]).is_err());
    assert!(decode_file(&blob, &parent(), &["value".into()]).is_err());
}

fn replace_column(blob: &[u8], column: usize, value: ArrayRef) -> Vec<u8> {
    let (mut data, header_start) = header_data(blob);
    let trailer = trailer_of(blob);
    let mut offset = trailer.directory_start(blob.len() as u64) as usize;
    let mut result = blob[..offset].to_vec();
    for (i, section) in data.directory.iter_mut().enumerate() {
        let frame = &blob[offset..offset + section.compressed as usize];
        offset += section.compressed as usize;
        if i == column {
            let (replaced, frame) = super::compact::encode_frame(value.as_ref()).unwrap();
            *section = replaced;
            result.extend_from_slice(&frame);
        } else {
            result.extend_from_slice(frame);
        }
    }
    assert_eq!(offset, header_start);
    let directory_len = data
        .directory
        .iter()
        .map(|section| section.compressed)
        .sum();
    append_header(&mut result, &data, trailer.label_len, directory_len);
    result
}

#[test]
fn completed_header_does_not_hide_invalid_directory() {
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
fn changed_labels_order_schema_and_row_totals_fail_closed() {
    let mut input = rows();
    input[1].3 = Some("");
    let mut writer = test_writer(2);
    assert!(writer.write(&batch(&input)).is_err());
    assert!(writer.finish().is_err());
    let mut input = rows();
    input[2].1 = 9;
    let mut writer = test_writer(2);
    assert!(writer.write(&batch(&input)).is_err());
    let mut writer = test_writer(2);
    writer.write(&batch(&rows()[..3])).unwrap();
    assert!(writer.finish().is_err());
    let other = Arc::new(
        schema()
            .as_ref()
            .clone()
            .with_metadata(HashMap::from([("semantic".into(), "changed".into())])),
    );
    let changed = RecordBatch::try_new(other, batch(&rows()).columns().to_vec()).unwrap();
    let mut writer = test_writer(2);
    assert!(writer.write(&changed).is_err());
}

#[test]
fn supported_schema_excludes_per_point_columns() {
    assert_eq!(
        identity_label_columns(schema().as_ref()).unwrap(),
        vec!["label_a", "label_b"]
    );
    for name in ["start_time", "flag", "trace_id", "exemplars"] {
        let mut fields = schema().fields().to_vec();
        fields.push(Arc::new(Field::new(name, DataType::Utf8, true)));
        let schema = Schema::new(fields);
        assert!(is_supported_schema(&schema));
        assert_eq!(
            identity_label_columns(&schema).unwrap(),
            ["label_a", "label_b"]
        );
    }
}

#[test]
fn per_point_columns_do_not_block_index_or_change_series_labels() {
    let input = batch(&rows());
    let mut fields = input.schema().fields().to_vec();
    fields.push(Arc::new(Field::new("start_time", DataType::Int64, false)));
    fields.push(Arc::new(Field::new("flag", DataType::Utf8, true)));
    let schema = Arc::new(Schema::new(fields));
    let mut columns = input.columns().to_vec();
    columns.push(Arc::new(Int64Array::from_iter_values(
        0..input.num_rows() as i64,
    )));
    columns.push(Arc::new(StringArray::from_iter_values(
        (0..input.num_rows()).map(|i| if i % 2 == 0 { "a" } else { "b" }),
    )));
    let input = RecordBatch::try_new(Arc::clone(&schema), columns).unwrap();
    let mut writer = BlockWriter::new_pending(Vec::new(), Arc::clone(&schema), 2).unwrap();
    writer.write(&input).unwrap();
    let blob = writer.finish_for_vortex(parent(), schema).unwrap();
    let decoded = index(&blob, &["label_a", "label_b"]).unwrap();
    assert_eq!(decoded.labels.schema().fields().len(), 2);
    assert_eq!(decoded_rows(&blob, &decoded).len(), input.num_rows());
}

#[test]
fn projected_labels_do_not_retain_unrequested_large_buffers() {
    let values = rows();
    let input = batch(&values);
    let large = "x".repeat(100_000);
    let mut columns = input.columns().to_vec();
    columns[3] = Arc::new(StringArray::from(vec![Some(large.as_str()); values.len()]));
    let input = RecordBatch::try_new(schema(), columns).unwrap();
    let mut writer = test_writer(2);
    writer.write(&input).unwrap();
    let blob = writer.finish().unwrap();
    let metadata_bytes = blob.len() - trailer_of(&blob).payload_end(blob.len() as u64) as usize;
    let index = index(&blob, &["label_b"]).unwrap();
    assert!(metadata_bytes < 100_000);
    assert!(
        index.labels.get_array_memory_size() < 32_000,
        "projected labels pin a large unrequested allocation"
    );
}

#[test]
fn excessive_compressed_length_is_rejected() {
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
    let (data, header_start) = header_data(&changed);
    let trailer = trailer_of(&changed);
    let mut padded = changed[..range.end as usize].to_vec();
    padded.extend(std::iter::repeat_n(0, delta as usize));
    padded.extend_from_slice(&changed[range.end as usize..header_start]);
    append_header(&mut padded, &data, trailer.label_len, trailer.directory_len);
    let error = super::tests::index(&padded, &[]).unwrap_err();
    assert!(
        error
            .to_string()
            .contains("compressed block length exceeds")
    );
}

#[test]
fn duplicates_across_chunk_boundary_remain_exact_and_visible() {
    let input = batch(&rows());
    let mut writer = test_writer(1);
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
fn long_view_backing_buffers_and_labels_beyond_warning_threshold() {
    let input = batch(&rows());
    let mut columns = input.columns().to_vec();
    columns[4] = Arc::new(StringViewArray::from(vec![
        Some(
            "a long label requiring view backing buffers"
        );
        7
    ]));
    let input = RecordBatch::try_new(schema(), columns).unwrap();
    let mut writer = test_writer(2);
    writer.write(&input).unwrap();
    let blob = writer.finish().unwrap();
    let decoded = index(&blob, &["label_b"]).unwrap();
    assert_eq!(
        decoded.label_value(0, "label_b").unwrap(),
        Some("a long label requiring view backing buffers")
    );

    let mut fields = schema().fields().to_vec();
    let mut labels = vec!["label_a".to_owned(), "label_b".to_owned()];
    let mut columns = input.columns().to_vec();
    for i in 0..WARN_LABEL_COLUMNS {
        let name = format!("additional_{i}");
        fields.push(Arc::new(Field::new(&name, DataType::Utf8, true)));
        columns.push(Arc::new(StringArray::from(vec![Some(name.as_str()); 7])));
        labels.push(name);
    }
    let wide = Arc::new(Schema::new(fields));
    assert_eq!(identity_label_columns(wide.as_ref()).unwrap(), labels);
    let mut writer = BlockWriter::new(Vec::new(), Arc::clone(&wide), labels, parent(), 2).unwrap();
    writer
        .write(&RecordBatch::try_new(wide, columns).unwrap())
        .unwrap();
    let blob = writer.finish().unwrap();
    let last = format!("additional_{}", WARN_LABEL_COLUMNS - 1);
    let decoded = index(&blob, &[last.as_str()]).unwrap();
    let block = decoded.blocks.len() - 1;
    assert_eq!(
        decoded.label_value(block, &last).unwrap(),
        Some(last.as_str())
    );
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
        let index = decode_file(&blob, &identity, &[]).unwrap();
        assert_eq!(
            decoded_rows(&blob, &index),
            rows.iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
        );
    }
}

#[test]
fn header_rejects_truncation_corruption_and_excessive_claims() {
    let blob = fixture();
    for n in 0..blob.len() {
        assert!(decode_file(&blob[..n], &parent(), &["label_a".into()]).is_err());
    }
    let (header, header_start) = header_data(&blob);
    let trailer = trailer_of(&blob);
    let json = serde_json::to_value(&header).unwrap();
    for edit in [
        &(|h: &mut serde_json::Value| h["blocks"] = u64::MAX.into())
            as &dyn Fn(&mut serde_json::Value),
        &|h| h["blocks"] = 3.into(),
        &|h| {
            h["directory"][0]["compressed"] =
                (h["directory"][0]["compressed"].as_u64().unwrap() + 1).into()
        },
        &|h| {
            h["labels"][0]["compressed"] =
                (h["labels"][0]["compressed"].as_u64().unwrap() - 1).into()
        },
        &|h| h["directory"][0]["raw"] = u64::MAX.into(),
        &|h| h["directory"][7]["compressed"] = 0.into(),
        &|h| h["labels"][0]["compressed"] = u64::MAX.into(),
        &|h| h["labels"][1]["raw"] = 4.into(),
        &|h| h["labels"][1]["name"] = "label_a".into(),
        &|h| h["directory"].as_array_mut().unwrap().truncate(7),
        &|h| h["row_group_size"] = 0.into(),
    ] {
        let mut h = json.clone();
        edit(&mut h);
        let data: super::header::HeaderData = serde_json::from_value(h).unwrap();
        let mut bad = blob[..header_start].to_vec();
        append_header(&mut bad, &data, trailer.label_len, trailer.directory_len);
        assert!(decode_file(&bad, &parent(), &["label_a".into()]).is_err());
    }
    let mut unparsable = blob.clone();
    unparsable[header_start] = b'[';
    assert!(decode_file(&unparsable, &parent(), &[]).is_err());
}

#[test]
fn large_header_has_no_size_limit() {
    let metadata = HashMap::from([
        ("semantic".into(), "retained".into()),
        ("large".into(), "x".repeat(2 * 1024 * 1024)),
    ]);
    let large = Arc::new(schema().as_ref().clone().with_metadata(metadata));
    assert!(is_supported_schema(&large));
    let input =
        RecordBatch::try_new(Arc::clone(&large), batch(&rows()).columns().to_vec()).unwrap();
    let mut writer = BlockWriter::new_pending(Vec::new(), Arc::clone(&large), 2).unwrap();
    writer.write(&input).unwrap();
    let blob = writer.finish_for_vortex(parent(), large).unwrap();
    assert!(trailer_of(&blob).header_len > 2 * 1024 * 1024);
    let decoded = index(&blob, &["label_a", "label_b"]).unwrap();
    assert_eq!(decoded_rows(&blob, &decoded).len(), rows().len());
}

#[test]
fn parquet_build_roundtrip_preserves_sql_source_and_row_groups() {
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    let input = batch(&rows());
    let original = parquet_bytes(&input, 3);
    let parent = ParentMetadata {
        compressed_size: original.len() as u64,
        ..parent()
    };
    let container = build_from_parquet(original.clone(), parent.clone()).unwrap();
    let parsed = decode_file(&container, &parent, &["label_a".into()]).unwrap();
    assert_eq!(
        &container[container.len() - 12..container.len() - 8],
        &MIDX_VERSION.to_le_bytes()
    );
    assert_eq!(parsed.row_group_size, Some(3));
    assert_eq!(parsed.source_schema, input.schema());
    let actual = decoded_rows(&container, &parsed)
        .into_iter()
        .map(|(_, t, v)| (t, v))
        .collect::<Vec<_>>();
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
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    let input = batch(&rows());
    let bytes = parquet_bytes(&input, 3);
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
fn v3_tail_header_locates_labels_before_directory() {
    let blob = fixture();
    let size = blob.len() as u64;
    let trailer = &blob[blob.len() - MIDX_TRAILER_LEN..];
    assert_eq!(MIDX_TRAILER_LEN, 32);
    assert_eq!(&trailer[20..24], &3u32.to_le_bytes());
    assert_eq!(&trailer[24..], b"O2MIDX03");
    let (data, header_start) = header_data(&blob);
    let regions = trailer_of(&blob);
    assert_eq!(
        u32::from_le_bytes(trailer[16..20].try_into().unwrap()) as usize,
        blob.len() - MIDX_TRAILER_LEN - header_start
    );
    assert_eq!(
        regions.label_len,
        data.labels
            .iter()
            .map(|label| label.section.compressed)
            .sum::<u64>()
    );
    assert_eq!(
        regions.directory_len,
        data.directory
            .iter()
            .map(|section| section.compressed)
            .sum::<u64>()
    );
    let json = serde_json::to_value(&data).unwrap();
    assert_eq!(
        json["parent"],
        serde_json::json!({"rows": 7, "compressed_size": 123})
    );
    assert!(!json.to_string().contains("checksum"));
    assert_eq!(data.directory.len(), DIRECTORY_FIELDS);
    assert_eq!(
        data.labels
            .iter()
            .map(|label| label.name.as_str())
            .collect::<Vec<_>>(),
        ["label_a", "label_b"]
    );

    let tail = &blob[header_start..];
    assert_eq!(Header::trailer(trailer, size).unwrap(), regions);
    let header = Header::parse(tail, size, &parent()).unwrap();
    assert_eq!(
        header.directory_range().start,
        regions.directory_start(size)
    );
    assert_eq!(header.payload_end(), regions.payload_end(size));
    assert!(Header::parse(&tail[1..], blob.len() as u64, &parent()).is_err());
    let ranges = header
        .column_ranges(&["label_b".into(), "missing".into(), "label_b".into()])
        .unwrap();
    assert_eq!(ranges.len(), 2);
    assert_eq!(ranges[0].end, header_start as u64);
    assert!(ranges[1].end <= ranges[0].start);
    assert_eq!(
        header.column_ranges(&[]).unwrap(),
        vec![header.directory_range()]
    );
    let all = header
        .column_ranges(&["label_a".into(), "label_b".into()])
        .unwrap();
    assert_eq!(all[1].start, regions.payload_end(size));
    assert_eq!(all[1].end, all[2].start);
    assert_eq!(all[2].end, all[0].start);
    let columns = ranges
        .iter()
        .map(|range| Bytes::copy_from_slice(&blob[range.start as usize..range.end as usize]))
        .collect::<Vec<_>>();
    let labels = ["label_b".to_string(), "missing".to_string()];
    let decoded = decode_index(&header, &columns, &labels).unwrap();
    assert_eq!(decoded.labels.num_columns(), 1);
    assert_eq!(decoded.label_value(0, "label_b").unwrap(), Some(""));
    assert_eq!(decoded.label_value(0, "missing").unwrap(), None);
    assert!(decode_index(&header, &columns[..1], &labels).is_err());
    let mut short = columns.clone();
    short[1] = short[1].slice(1..);
    assert!(decode_index(&header, &short, &labels).is_err());
}

#[test]
fn trailer_and_header_reject_truncation_and_invalid_structure() {
    let blob = fixture();
    for length in 0..blob.len() {
        assert!(Header::parse(&blob[..length], length as u64, &parent()).is_err());
    }
    let regions = trailer_of(&blob);
    for (range, bytes) in [
        (0..8, (regions.label_len + 1).to_le_bytes().to_vec()),
        (0..8, (regions.label_len - 1).to_le_bytes().to_vec()),
        (8..16, 0u64.to_le_bytes().to_vec()),
        (8..16, (regions.directory_len + 1).to_le_bytes().to_vec()),
        (16..20, 0u32.to_le_bytes().to_vec()),
        (16..20, u32::MAX.to_le_bytes().to_vec()),
        (16..20, 1u32.to_le_bytes().to_vec()),
        (20..24, 2u32.to_le_bytes().to_vec()),
        (24..32, b"O2MIDX02".to_vec()),
    ] {
        let mut invalid = blob.clone();
        let start = blob.len() - MIDX_TRAILER_LEN;
        invalid[start + range.start..start + range.end].copy_from_slice(&bytes);
        assert!(Header::parse(&invalid, blob.len() as u64, &parent()).is_err());
    }
    assert!(Header::parse(&blob, blob.len() as u64 - 1, &parent()).is_err());
    let shifted = Header::parse(&blob, blob.len() as u64 + 1, &parent()).unwrap();
    let directory = shifted.directory_range();
    let bytes =
        Bytes::copy_from_slice(&blob[directory.start as usize - 1..directory.end as usize - 1]);
    assert!(decode_index(&shifted, &[bytes], &[]).is_err());
}

#[test]
fn completion_marker_is_last_and_write_or_flush_errors_propagate() {
    let complete = fixture();
    let payload_end = trailer_of(&complete).payload_end(complete.len() as u64) as usize;
    for (fail_after, fail_flush) in [
        (payload_end + 1, usize::MAX),
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
                assert!(!observed.bytes.ends_with(MIDX_MAGIC));
            }
        }
    }
}

#[test]
fn vortex_finalizer_preserves_schema_without_row_groups() {
    let input = batch(&rows());
    let mut writer = BlockWriter::new_pending(Vec::new(), input.schema(), 2).unwrap();
    writer.write(&input).unwrap();
    let encoded = writer.finish_for_vortex(parent(), input.schema()).unwrap();
    let decoded = index(&encoded, &["label_a", "label_b"]).unwrap();
    assert_eq!(decoded.parent, parent());
    assert_eq!(decoded.row_group_size, None);
    assert_eq!(decoded.source_schema, input.schema());
    assert_eq!(
        decoded_rows(&encoded, &decoded),
        rows().iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
    );
}

#[test]
fn renamed_parquet_and_sidecar_pair_uses_numeric_source_metadata() {
    use parquet::arrow::arrow_reader::ParquetRecordBatchReaderBuilder;
    let directory = tempfile::tempdir().unwrap();
    let data_path = directory.path().join("indexed-v1-before.parquet");
    let midx_path = directory.path().join("indexed-v1-before.midx");
    let input = batch(&rows());
    let original = parquet_bytes(&input, 3);
    std::fs::write(&data_path, &original).unwrap();
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
    let parsed = decode_file(&blob, &expected, &["label_a".into()]).unwrap();
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
fn vortex_finalizer_rejects_invalid_source_metadata() {
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
    assert!(pending().finish_for_vortex(parent(), changed).is_err());
    let zero = ParentMetadata {
        rows: 0,
        compressed_size: 123,
    };
    assert!(pending().finish_for_vortex(zero, input.schema()).is_err());
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
    let index = decode_file(&bytes, &parent, &[]).unwrap();
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
