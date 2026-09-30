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

mod codec;
mod compact;
mod directory;
mod header;
mod reader;
mod samples;
mod writer;

use std::{
    collections::{HashMap, HashSet},
    ops::{Deref, Range},
    sync::Arc,
};

use anyhow::{Result, anyhow, ensure};
use arrow::{
    array::{Array, DictionaryArray, LargeStringArray, RecordBatch, StringArray, StringViewArray},
    datatypes::{DataType, Schema, SchemaRef, UInt8Type, UInt16Type, UInt32Type},
};
pub use config::meta::promql::index::{MIDX_MAGIC, MIDX_TRAILER_LEN, MIDX_VERSION, MidxTrailer};
pub use directory::{BlockDirectory, BlockIter};
pub use header::Header;
pub use reader::{BlockDecoder, decode_additional_labels, decode_block, decode_file, decode_index};
pub use samples::max_block_len;
use serde::{Deserialize, Serialize};
pub use writer::BlockWriter;

/// Tail bytes a reader fetches first; a header larger than this costs cold reads one more request.
pub const HEADER_PROBE_BYTES: u64 = 64 * 1024;
pub const MAX_BLOCK_ROWS: usize = 8192;
/// Label count above which building a MIDX warns: the writer holds every label of every block.
pub const WARN_LABEL_COLUMNS: usize = 128;
const DIRECTORY_FIELDS: usize = 5;
const NON_IDENTITY: &[&str] = &[
    "exemplars",
    "is_monotonic",
    "trace_id",
    "span_id",
    "_all",
    "start_time",
    "flag",
];

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct ParentMetadata {
    pub rows: u64,
    pub compressed_size: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockMeta {
    pub hash: u64,
    pub row_start: u64,
    pub row_count: u32,
    pub min_timestamp: i64,
    pub max_timestamp: i64,
    pub block_offset: u64,
    pub block_length: u32,
}

impl BlockMeta {
    /// Metadata validation establishes that this addition cannot overflow.
    pub fn block_range(&self) -> Range<u64> {
        self.block_offset
            ..self
                .block_offset
                .saturating_add(u64::from(self.block_length))
    }
}

#[derive(Debug)]
pub struct DecodedBlock {
    pub timestamps: Vec<i64>,
    pub value_bits: Vec<u64>,
}

#[derive(Debug)]
pub struct DecodedBlockRef<'a> {
    pub timestamps: &'a [i64],
    pub value_bits: &'a [u64],
}

#[derive(Debug)]
pub struct IndexBase {
    pub row_group_size: Option<u32>,
    pub parent: ParentMetadata,
    pub source_schema: SchemaRef,
    pub blocks: BlockDirectory,
    pub header: Header,
}

#[derive(Debug)]
pub struct Index {
    pub base: Arc<IndexBase>,
    pub labels: RecordBatch,
    missing: Vec<String>,
}

impl Deref for Index {
    type Target = IndexBase;

    fn deref(&self) -> &Self::Target {
        &self.base
    }
}

impl Index {
    pub fn estimated_directory_size(&self) -> usize {
        self.blocks.allocated_bytes()
    }

    pub fn estimated_heap_size(&self) -> usize {
        let schema_bytes =
            serde_json::to_vec(self.source_schema.as_ref()).map_or(0, |bytes| bytes.len());
        std::mem::size_of::<Self>()
            .saturating_add(std::mem::size_of::<IndexBase>())
            .saturating_add(self.estimated_directory_size())
            .saturating_add(self.labels.get_array_memory_size())
            .saturating_add(self.missing.capacity() * std::mem::size_of::<String>())
            .saturating_add(self.missing.iter().map(String::capacity).sum::<usize>())
            .saturating_add(schema_bytes.saturating_mul(2))
            .saturating_add(
                (self.source_schema.fields().len() + self.labels.num_columns()).saturating_mul(512),
            )
    }

    pub fn missing_labels(&self, names: &[String]) -> Result<Vec<String>> {
        let mut missing = Vec::new();
        for name in names {
            let Ok(field) = self.source_schema.field_with_name(name) else {
                continue;
            };
            ensure!(
                is_label_type(field.data_type()),
                "requested source field lacks identity label metadata"
            );
            if self.labels.column_by_name(name).is_none() && !missing.contains(name) {
                missing.push(name.clone());
            }
        }
        Ok(missing)
    }

    pub fn project(&self, names: &[String]) -> Result<Self> {
        ensure!(
            self.missing_labels(names)?.is_empty(),
            "requested label column not loaded"
        );
        let schema = self.labels.schema();
        let mut fields = Vec::new();
        let mut columns = Vec::new();
        for name in names {
            if fields
                .iter()
                .any(|field: &Arc<arrow::datatypes::Field>| field.name() == name)
            {
                continue;
            }
            if let Ok(index) = schema.index_of(name) {
                fields.push(Arc::clone(&schema.fields()[index]));
                columns.push(Arc::clone(self.labels.column(index)));
            }
        }
        Ok(Self {
            base: Arc::clone(&self.base),
            missing: names
                .iter()
                .filter(|name| self.source_schema.field_with_name(name).is_err())
                .cloned()
                .collect(),
            labels: RecordBatch::try_new_with_options(
                Arc::new(Schema::new(fields)),
                columns,
                &arrow::array::RecordBatchOptions::new().with_row_count(Some(self.blocks.len())),
            )?,
        })
    }

    pub fn merge_columns(&self, other: &Self) -> Result<Self> {
        debug_assert!(
            Arc::ptr_eq(&self.base, &other.base)
                || (self.base.header.blocks_end == other.base.header.blocks_end
                    && self.parent == other.parent
                    && self.source_schema == other.source_schema
                    && self.row_group_size == other.row_group_size),
            "cannot mix metadata bindings"
        );
        let mut fields = self.labels.schema().fields().to_vec();
        let mut columns = self.labels.columns().to_vec();
        for (field, column) in other
            .labels
            .schema()
            .fields()
            .iter()
            .zip(other.labels.columns())
        {
            if self.labels.column_by_name(field.name()).is_none() {
                fields.push(Arc::clone(field));
                columns.push(Arc::clone(column));
            }
        }
        Ok(Self {
            base: Arc::clone(&self.base),
            missing: Vec::new(),
            labels: RecordBatch::try_new_with_options(
                Arc::new(Schema::new(fields)),
                columns,
                &arrow::array::RecordBatchOptions::new().with_row_count(Some(self.blocks.len())),
            )?,
        })
    }

    pub fn for_cache(mut self) -> Self {
        self.missing.clear();
        self
    }

    #[inline]
    pub fn label_value(&self, block: usize, name: &str) -> Result<Option<&str>> {
        let Some(column) = self.labels.column_by_name(name) else {
            ensure!(
                self.missing.iter().any(|missing| missing == name),
                "label was not projected: {name}"
            );
            return Ok(None);
        };
        label_value(column.as_ref(), block)
    }
}

pub fn identity_label_columns(schema: &Schema) -> Result<Vec<String>> {
    let mut names = HashSet::new();
    ensure!(
        schema
            .fields()
            .iter()
            .all(|field| names.insert(field.name())),
        "duplicate source field names"
    );
    for (name, expected) in [
        ("__hash__", DataType::UInt64),
        ("_timestamp", DataType::Int64),
        ("value", DataType::Float64),
    ] {
        ensure!(
            schema.field_with_name(name)?.data_type() == &expected,
            "unsupported sample column {name}"
        );
    }
    let mut labels = Vec::new();
    for field in schema.fields() {
        let name = field.name().as_str();
        if ["__hash__", "_timestamp", "value"].contains(&name) {
            continue;
        }
        ensure!(
            !name.starts_with("__oo_midx_"),
            "reserved metadata label name"
        );
        if NON_IDENTITY.contains(&name) {
            continue;
        }
        ensure!(
            is_label_type(field.data_type()),
            "unsupported label type for {name}"
        );
        labels.push(name.to_owned());
    }
    Ok(labels)
}

pub fn is_supported_schema(schema: &Schema) -> bool {
    identity_label_columns(schema).is_ok()
}

fn is_label_type(data_type: &DataType) -> bool {
    matches!(
        data_type,
        DataType::Utf8 | DataType::LargeUtf8 | DataType::Utf8View
    )
}

fn label_value(array: &dyn Array, row: usize) -> Result<Option<&str>> {
    ensure!(row < array.len(), "label row out of bounds");
    if array.is_null(row) {
        return Ok(None);
    }
    if let Some(a) = array.as_any().downcast_ref::<StringArray>() {
        return Ok(Some(a.value(row)));
    }
    if let Some(a) = array.as_any().downcast_ref::<LargeStringArray>() {
        return Ok(Some(a.value(row)));
    }
    if let Some(a) = array.as_any().downcast_ref::<StringViewArray>() {
        return Ok(Some(a.value(row)));
    }
    if let Some(array) = array.as_any().downcast_ref::<DictionaryArray<UInt8Type>>() {
        return label_value(
            array.values().as_ref(),
            usize::from(array.keys().value(row)),
        );
    }
    if let Some(array) = array.as_any().downcast_ref::<DictionaryArray<UInt16Type>>() {
        return label_value(
            array.values().as_ref(),
            usize::from(array.keys().value(row)),
        );
    }
    if let Some(array) = array.as_any().downcast_ref::<DictionaryArray<UInt32Type>>() {
        return label_value(array.values().as_ref(), array.keys().value(row) as usize);
    }
    Err(anyhow!("unsupported identity label array"))
}

fn semantic_metadata(schema: &Schema) -> HashMap<String, String> {
    schema
        .metadata()
        .iter()
        .filter(|(key, _)| {
            !["min_ts", "max_ts", "records", "original_size"].contains(&key.as_str())
        })
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect()
}

fn schema_matches(a: &Schema, b: &Schema) -> bool {
    a.fields() == b.fields() && semantic_metadata(a) == semantic_metadata(b)
}

#[cfg(test)]
mod tests {
    use std::{collections::HashMap, sync::Arc};

    use arrow::{
        array::{Float64Array, Int64Array, RecordBatch, StringArray, StringViewArray, UInt64Array},
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
            super::BlockWriter::new(Vec::new(), schema.clone(), super::MAX_BLOCK_ROWS)?;
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
        BlockWriter::new(Vec::new(), schema(), max_rows).unwrap()
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
        let mut writer =
            ArrowWriter::try_new(Vec::new(), input.schema(), Some(properties)).unwrap();
        writer.write(input).unwrap();
        Bytes::from(writer.into_inner().unwrap())
    }

    fn fixture() -> Vec<u8> {
        let rows = rows();
        let mut writer = test_writer(2);
        for range in [0..1, 1..5, 5..7] {
            writer.write(&batch(&rows[range])).unwrap();
        }
        writer.finish_for_vortex(parent(), schema()).unwrap()
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
        assert_eq!(
            decoded_rows(&blob, &index),
            rows().iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
        );
        assert_eq!(index.label_value(0, "missing").unwrap(), None);
        let mut writer = test_writer(2);
        writer.write(&batch(&rows())).unwrap();
        assert_eq!(writer.finish_for_vortex(parent(), schema()).unwrap(), blob);
        assert_eq!(index.label_value(0, "label_a").unwrap(), None);
        assert_eq!(index.label_value(0, "label_b").unwrap(), Some(""));
        assert_eq!(index.label_value(2, "label_a").unwrap(), Some(""));
        assert_eq!(index.label_value(2, "label_b").unwrap(), None);
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

    fn varints(values: &[u64]) -> Vec<u8> {
        let mut out = Vec::new();
        for value in values {
            super::compact::put_varint(&mut out, *value);
        }
        out
    }

    /// Raw varint bytes of each directory column.
    fn directory_columns(blob: &[u8]) -> Vec<Vec<u8>> {
        let (data, _) = header_data(blob);
        let mut offset = trailer_of(blob).directory_start(blob.len() as u64) as usize;
        let mut decoder = super::compact::frame_decoder().unwrap();
        data.directory
            .iter()
            .map(|section| {
                let frame = &blob[offset..offset + section.compressed as usize];
                offset += section.compressed as usize;
                super::compact::decode_frame(&mut decoder, frame, section.raw as usize).unwrap()
            })
            .collect()
    }

    fn directory_values(blob: &[u8], column: usize) -> Vec<u64> {
        let raw = &directory_columns(blob)[column];
        let mut pos = 0;
        let mut values = Vec::new();
        while pos < raw.len() {
            values.push(super::compact::get_varint(raw, &mut pos).unwrap());
        }
        values
    }

    /// Rewrites directory column `column` as `raw`, inserting `padding` zero bytes after block 0.
    fn rebuild(blob: &[u8], column: usize, raw: &[u8], padding: usize) -> Vec<u8> {
        let (mut data, _) = header_data(blob);
        let trailer = trailer_of(blob);
        let first_block_end = index(blob, &[]).unwrap().blocks.block(0).block_range().end as usize;
        let directory_start = trailer.directory_start(blob.len() as u64) as usize;
        let mut result = blob[..first_block_end].to_vec();
        result.extend(std::iter::repeat_n(0, padding));
        result.extend_from_slice(&blob[first_block_end..directory_start]);
        for (i, (section, mut bytes)) in data
            .directory
            .iter_mut()
            .zip(directory_columns(blob))
            .enumerate()
        {
            if i == column {
                bytes = raw.to_vec();
            }
            let (replaced, frame) = super::compact::encode_frame(&bytes).unwrap();
            *section = replaced;
            result.extend_from_slice(&frame);
        }
        let directory_len = data
            .directory
            .iter()
            .map(|section| section.compressed)
            .sum();
        append_header(&mut result, &data, trailer.label_len, directory_len);
        result
    }

    fn replace_column(blob: &[u8], column: usize, values: &[u64]) -> Vec<u8> {
        rebuild(blob, column, &varints(values), 0)
    }

    #[test]
    fn completed_header_does_not_hide_invalid_directory() {
        let blob = fixture();
        assert_eq!(directory_values(&blob, 1), [2, 2, 2, 1]);
        assert!(index(&replace_column(&blob, 1, &[2, 2, 2, 1]), &[]).is_ok());
        for (column, values) in [
            (1, vec![0, 2, 2, 1]),
            (1, vec![2, 2, 2, 2]),
            (1, vec![2, 2, 2]),
            (1, vec![2, 2, 2, 1, 1]),
            (1, vec![u64::from(u32::MAX) + 2, 2, 2, 1]),
            (0, vec![1, 0, u64::MAX - 1, u64::MAX]),
            (3, vec![0, 0, 0, 1]),
            (3, vec![u64::MAX, 0, 0, 0]),
        ] {
            assert!(
                index(&replace_column(&blob, column, &values), &[]).is_err(),
                "{column} {values:?}"
            );
        }
        let mut lengths = directory_values(&blob, 4);
        lengths[1] += 1;
        assert!(index(&replace_column(&blob, 4, &lengths), &[]).is_err());
        lengths[1] = u64::MAX;
        assert!(index(&replace_column(&blob, 4, &lengths), &[]).is_err());
        let mut unused = directory_columns(&blob)[2].clone();
        unused.push(0x80);
        assert!(index(&rebuild(&blob, 2, &unused, 0), &[]).is_err());
    }

    #[test]
    fn changed_labels_order_schema_and_row_totals_fail_closed() {
        let mut input = rows();
        input[1].3 = Some("");
        let mut writer = test_writer(2);
        assert!(writer.write(&batch(&input)).is_err());
        assert!(writer.finish_for_vortex(parent(), schema()).is_err());
        let mut input = rows();
        input[2].1 = 9;
        let mut writer = test_writer(2);
        assert!(writer.write(&batch(&input)).is_err());
        let mut writer = test_writer(2);
        writer.write(&batch(&rows()[..3])).unwrap();
        assert!(writer.finish_for_vortex(parent(), schema()).is_err());
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
        let mut writer = BlockWriter::new(Vec::new(), Arc::clone(&schema), 2).unwrap();
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
        let blob = writer.finish_for_vortex(parent(), schema()).unwrap();
        let metadata_bytes = blob.len() - trailer_of(&blob).blocks_end(blob.len() as u64) as usize;
        let index = index(&blob, &["label_b"]).unwrap();
        assert!(metadata_bytes < 100_000);
        assert!(
            index.labels.get_array_memory_size() < 32_000,
            "projected labels pin a large unrequested allocation"
        );
    }

    #[test]
    fn excessive_block_length_is_rejected() {
        let blob = fixture();
        let index = index(&blob, &[]).unwrap();
        let mut block = index.blocks.block(0).clone();
        block.block_length = u32::try_from(max_block_len(block.row_count) + 1).unwrap();
        let mut lengths = directory_values(&blob, 4);
        let delta = u64::from(block.block_length) - lengths[0];
        lengths[0] = u64::from(block.block_length);
        let padded = rebuild(&blob, 4, &varints(&lengths), delta as usize);
        let error = super::tests::index(&padded, &[]).unwrap_err();
        assert!(
            error
                .to_string()
                .contains("block length exceeds format bound")
        );
    }

    #[test]
    fn duplicates_across_chunk_boundary_remain_exact_and_visible() {
        let input = batch(&rows());
        let mut writer = test_writer(1);
        writer.write(&input).unwrap();
        let blob = writer.finish_for_vortex(parent(), schema()).unwrap();
        let index = index(&blob, &[]).unwrap();
        assert!(index.blocks.iter().all(|block| block.row_count == 1));
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
        let blob = writer.finish_for_vortex(parent(), schema()).unwrap();
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
        let mut writer = BlockWriter::new(Vec::new(), Arc::clone(&wide), 2).unwrap();
        writer
            .write(&RecordBatch::try_new(Arc::clone(&wide), columns).unwrap())
            .unwrap();
        let blob = writer.finish_for_vortex(parent(), wide).unwrap();
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
            let mut writer = BlockWriter::new(Vec::new(), schema(), max_rows).unwrap();
            writer.write(&batch(&rows)).unwrap();
            let blob = writer
                .finish_for_vortex(identity.clone(), schema())
                .unwrap();
            let index = decode_file(&blob, &identity, &[]).unwrap();
            assert_eq!(
                decoded_rows(&blob, &index),
                rows.iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
            );
        }
    }

    #[test]
    fn writer_roundtrips_every_block_size_and_splits_long_series() {
        let mut rows: Vec<Row> = Vec::new();
        for (series, count) in [1usize, 2, 3, 64, 65, 8192, 8193, 20_000]
            .into_iter()
            .enumerate()
        {
            for i in 0..count {
                let value = match series % 4 {
                    0 => (i as f64).to_bits(),
                    1 => ((i % 7) as f64 / 10.0).to_bits(),
                    2 => (i as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15),
                    _ if i % 11 == 0 => 0x7ff0_0000_0000_0002,
                    _ => 1.5f64.to_bits(),
                };
                rows.push((
                    series as u64,
                    1_000 + i as i64 * 15_000,
                    value,
                    None,
                    Some(""),
                ));
            }
        }
        let parent = ParentMetadata {
            rows: rows.len() as u64,
            compressed_size: 123,
        };
        let mut writer = BlockWriter::new(Vec::new(), schema(), MAX_BLOCK_ROWS).unwrap();
        writer.write(&batch(&rows)).unwrap();
        let blob = writer.finish_for_vortex(parent.clone(), schema()).unwrap();
        let index = decode_file(&blob, &parent, &[]).unwrap();
        assert_eq!(
            index.blocks.row_counts().collect::<Vec<_>>(),
            [1, 2, 3, 64, 65, 8192, 8192, 1, 8192, 8192, 3616]
        );
        assert_eq!(
            decoded_rows(&blob, &index),
            rows.iter().map(|r| (r.0, r.1, r.2)).collect::<Vec<_>>()
        );
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
            &|h| h["directory"][4]["compressed"] = 0.into(),
            &|h| h["labels"][0]["compressed"] = u64::MAX.into(),
            &|h| h["labels"][1]["raw"] = 4.into(),
            &|h| h["labels"][1]["name"] = "label_a".into(),
            &|h| h["directory"].as_array_mut().unwrap().truncate(4),
            &|h| {
                let extra = h["directory"][4].clone();
                h["directory"].as_array_mut().unwrap().push(extra);
            },
            &|h| {
                let extra = h["directory"][4].clone();
                let directory = h["directory"].as_array_mut().unwrap();
                directory.push(extra.clone());
                directory.push(extra);
            },
            &|h| h["directory"][1]["raw"] = 3.into(),
            &|h| h["directory"][1]["raw"] = 41.into(),
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
    fn header_rejects_legacy_directory_and_column_sizes_outside_varint_bounds() {
        let blob = fixture();
        let (header, header_start) = header_data(&blob);
        let trailer = trailer_of(&blob);
        let json = serde_json::to_value(&header).unwrap();
        let blocks = json["blocks"].as_u64().unwrap();
        for (edit, message) in [
            (
                &(|h: &mut serde_json::Value| {
                    let extra = h["directory"][4].clone();
                    let directory = h["directory"].as_array_mut().unwrap();
                    directory.push(extra.clone());
                    directory.push(extra);
                }) as &dyn Fn(&mut serde_json::Value),
                "invalid directory column count",
            ),
            (
                &|h| h["directory"][2]["raw"] = (blocks - 1).into(),
                "directory column size",
            ),
            (
                &|h| h["directory"][2]["raw"] = (blocks * 10 + 1).into(),
                "directory column size",
            ),
            (
                &|h| h["labels"][0]["raw"] = (blocks + 3).into(),
                "MIDX label shorter than its rows",
            ),
        ] {
            let mut h = json.clone();
            edit(&mut h);
            let data: super::header::HeaderData = serde_json::from_value(h).unwrap();
            let mut bad = blob[..header_start].to_vec();
            append_header(&mut bad, &data, trailer.label_len, trailer.directory_len);
            let error = Header::parse(&bad, bad.len() as u64, &parent()).unwrap_err();
            assert!(error.to_string().contains(message), "{error}");
        }
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
        let mut writer = BlockWriter::new(Vec::new(), Arc::clone(&large), 2).unwrap();
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
            let mut writer = BlockWriter::new(Vec::new(), input.schema(), MAX_BLOCK_ROWS).unwrap();
            writer.write(&input).unwrap();
            writer
        };
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
    fn v1_tail_header_locates_labels_before_directory() {
        let blob = fixture();
        let size = blob.len() as u64;
        let trailer = &blob[blob.len() - MIDX_TRAILER_LEN..];
        assert_eq!(MIDX_TRAILER_LEN, 32);
        assert_eq!(&trailer[20..24], &1u32.to_le_bytes());
        assert_eq!(&trailer[24..], b"O2MIDX01");
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
        assert_eq!(header.blocks_end(), regions.blocks_end(size));
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
        assert_eq!(all[1].start, regions.blocks_end(size));
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
        let blocks_end = trailer_of(&complete).blocks_end(complete.len() as u64) as usize;
        for (fail_after, fail_flush) in [
            (blocks_end + 1, usize::MAX),
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
            let mut writer = BlockWriter::new(output, schema(), 2).unwrap();
            writer.write(&batch(&rows())).unwrap();
            let result = writer.finish_for_vortex(parent(), schema());
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
        let mut writer = BlockWriter::new(Vec::new(), input.schema(), 2).unwrap();
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
        let source = ParquetRecordBatchReaderBuilder::try_new(Bytes::from(
            std::fs::read(&moved_data).unwrap(),
        ))
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
            let mut writer = BlockWriter::new(Vec::new(), input.schema(), 2).unwrap();
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
    fn sample_block_rejects_trailing_and_truncated_bytes() {
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
}
