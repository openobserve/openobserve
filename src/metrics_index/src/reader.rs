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

use std::{collections::HashMap, io::Cursor, ops::Range, sync::Arc};

use arrow::{
    array::{Array, BooleanArray, RecordBatch, UInt32Array},
    datatypes::SchemaRef,
    ipc::reader::FileReaderBuilder as ArrowFileReaderBuilder,
};
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::PhysicalExpr,
};

use crate::layout::{
    METRICS_INDEX_PARENT_RECORDS_KEY, METRICS_INDEX_ROW_COUNT, METRICS_INDEX_ROW_GROUP_SIZE_KEY,
    METRICS_INDEX_VERSION, METRICS_INDEX_VERSION_KEY,
};

pub(super) struct MetricsIndexData {
    pub(super) schema: SchemaRef,
    pub(super) batches: Vec<RecordBatch>,
    /// Rows of the data file this index was written for, absent in v1 files without metadata.
    pub(super) parent_records: Option<usize>,
    /// Parquet row-group size of the data file, absent for Vortex and older indexes.
    pub(super) row_group_size: Option<u32>,
}

pub(super) async fn load_metrics_index_file(
    account: &str,
    path: &str,
    format: config::FileFormat,
    parent_rows: usize,
    parent_size: i64,
    labels: Arc<Vec<String>>,
) -> Result<MetricsIndexData> {
    let location = path.into();
    let header = infra::cache::storage::get_range(account, &location, 0..6)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    if header.as_ref() != b"ARROW1" {
        let parent = metrics_block::ParentMetadata {
            rows: parent_rows as u64,
            compressed_size: u64::try_from(parent_size)
                .map_err(|error| DataFusionError::External(Box::new(error)))?,
        };
        return load_block_metadata(account, path, parent, format, labels).await;
    }
    let bytes = infra::cache::file_data::get(account, path, None)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    let path = path.to_string();
    tokio::task::spawn_blocking(move || decode_metrics_index(&path, bytes, &labels))
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?
}

/// Read the row-range columns plus the requested labels from a sidecar.
///
/// The projection is resolved by name against the sidecar's own schema: the
/// label set and column order of a sidecar depend on the schema at compaction
/// time and differ between files. A requested label that the sidecar does not
/// have is skipped, which over-selects that file; the final PromQL filter keeps
/// the query result exact.
pub(super) fn decode_metrics_index(
    path: &str,
    bytes: bytes::Bytes,
    labels: &[String],
) -> Result<MetricsIndexData> {
    let file_schema = ArrowFileReaderBuilder::new()
        .build(Cursor::new(bytes.clone()))?
        .schema();
    let metadata = file_schema.metadata();
    if let Some(version) = parse_metadata::<u32>(metadata, METRICS_INDEX_VERSION_KEY, path)?
        && version > METRICS_INDEX_VERSION
    {
        return Err(DataFusionError::Execution(format!(
            "metrics index {path} has version {version}, this build reads up to {METRICS_INDEX_VERSION}"
        )));
    }
    let parent_records = parse_metadata(metadata, METRICS_INDEX_PARENT_RECORDS_KEY, path)?;
    let row_group_size = parse_metadata(metadata, METRICS_INDEX_ROW_GROUP_SIZE_KEY, path)?;
    // the access plan divides by it; a corrupt 0 must fail here, not panic there
    if row_group_size == Some(0) {
        return Err(DataFusionError::Execution(format!(
            "metrics index {path} has a row group size of 0"
        )));
    }
    let mut projection = vec![file_schema.index_of(METRICS_INDEX_ROW_COUNT)?];
    for label in labels {
        match file_schema.index_of(label) {
            Ok(index) => projection.push(index),
            Err(_) => log::debug!(
                "metrics index {path} has no label {label}, evaluating the remaining matchers only"
            ),
        }
    }
    let reader = ArrowFileReaderBuilder::new()
        .with_projection(projection)
        .build(Cursor::new(bytes))?;
    let reader_schema = reader.schema();
    let batches = reader.collect::<std::result::Result<Vec<_>, _>>()?;
    let schema = batches
        .first()
        .map(RecordBatch::schema)
        .unwrap_or(reader_schema);
    Ok(MetricsIndexData {
        schema,
        batches,
        parent_records,
        row_group_size,
    })
}

/// Evaluate `filter` over the run rows and collect the selected physical row
/// ranges. Runs tile the data file, so each run's start is the prefix sum of
/// the preceding counts.
pub(super) fn evaluate_metrics_index(
    data: &MetricsIndexData,
    filter: Option<&dyn PhysicalExpr>,
    expected_rows: usize,
) -> Result<Vec<Range<usize>>> {
    if let Some(parent_records) = data.parent_records
        && parent_records != expected_rows
    {
        return Err(DataFusionError::Execution(format!(
            "metrics-index was written for {parent_records} rows, but the parent file contains {expected_rows} records"
        )));
    }
    let count_index = data.schema.index_of(METRICS_INDEX_ROW_COUNT)?;
    let mut ranges: Vec<Range<usize>> = Vec::new();
    let mut next_row: usize = 0;

    for batch in &data.batches {
        let mask = match filter {
            Some(filter) => {
                let mask = filter.evaluate(batch)?.into_array(batch.num_rows())?;
                mask.as_any()
                    .downcast_ref::<BooleanArray>()
                    .ok_or_else(|| {
                        DataFusionError::Execution(
                            "metrics-index filter did not produce a boolean array".to_string(),
                        )
                    })?
                    .clone()
            }
            None => BooleanArray::from(vec![true; batch.num_rows()]),
        };
        let mask = &mask;
        let counts = batch
            .column(count_index)
            .as_any()
            .downcast_ref::<UInt32Array>()
            .ok_or_else(|| {
                DataFusionError::Execution("metrics-index row count is not UInt32".to_string())
            })?;

        for row in 0..batch.num_rows() {
            let count = counts.value(row) as usize;
            if count == 0 {
                return Err(DataFusionError::Execution(
                    "metrics-index contains an empty row range".to_string(),
                ));
            }
            let start = next_row;
            let end = start.checked_add(count).ok_or_else(|| {
                DataFusionError::Execution("metrics-index row range overflow".to_string())
            })?;
            if end > expected_rows {
                return Err(DataFusionError::Execution(format!(
                    "metrics-index row range ends at {end}, beyond the parent file's {expected_rows} records"
                )));
            }
            next_row = end;
            if mask.is_null(row) || !mask.value(row) {
                continue;
            }
            if let Some(previous) = ranges.last_mut()
                && start == previous.end
            {
                previous.end = end;
            } else {
                ranges.push(start..end);
            }
        }
    }
    if next_row != expected_rows {
        return Err(DataFusionError::Execution(format!(
            "metrics-index covers {next_row} rows, but the parent file contains {expected_rows} records"
        )));
    }
    Ok(ranges)
}

async fn load_block_metadata(
    account: &str,
    path: &str,
    parent: metrics_block::ParentMetadata,
    format: config::FileFormat,
    labels: Arc<Vec<String>>,
) -> Result<MetricsIndexData> {
    let location = path.into();
    let size = infra::cache::storage::head(account, &location)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?
        .size;
    let start = size
        .checked_sub(metrics_block::FOOTER_LEN as u64)
        .ok_or_else(|| DataFusionError::Execution("Truncated MIDX footer".into()))?;
    let bytes = infra::cache::storage::get_range(account, &location, start..size)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    let footer = metrics_block::read_footer(&bytes, size)
        .map_err(|error| DataFusionError::External(error.into()))?;
    let metadata =
        infra::cache::storage::get_range(account, &location, footer.metadata_range.clone())
            .await
            .map_err(|error| DataFusionError::External(Box::new(error)))?;
    tokio::task::spawn_blocking(move || {
        let index = metrics_block::decode_index(metadata, &footer, &parent, &labels)
            .map_err(|error| DataFusionError::External(error.into()))?;
        metrics_block_index_data(&index, format)
    })
    .await
    .map_err(|error| DataFusionError::External(Box::new(error)))?
}

fn metrics_block_index_data(
    index: &metrics_block::Index,
    format: config::FileFormat,
) -> Result<MetricsIndexData> {
    let row_group_size = match format {
        config::FileFormat::Parquet => Some(index.row_group_size.ok_or_else(|| {
            DataFusionError::Execution("Parquet block index lacks parent row group size".into())
        })?),
        config::FileFormat::Vortex if index.row_group_size.is_none() => None,
        _ => {
            return Err(DataFusionError::Execution(
                "Invalid block parent format/row-group binding".into(),
            ));
        }
    };
    let mut fields = vec![arrow::datatypes::Field::new(
        METRICS_INDEX_ROW_COUNT,
        arrow::datatypes::DataType::UInt32,
        false,
    )];
    let mut columns: Vec<arrow::array::ArrayRef> = vec![Arc::new(UInt32Array::from_iter_values(
        index.blocks.row_counts(),
    ))];
    for (i, field) in index.labels.schema().fields().iter().enumerate() {
        if let Ok(source_field) = index.source_schema.field_with_name(field.name()) {
            fields.push(source_field.clone());
            columns.push(arrow::compute::cast(
                index.labels.column(i),
                source_field.data_type(),
            )?);
        }
    }
    let schema = Arc::new(arrow::datatypes::Schema::new(fields));
    let batch = RecordBatch::try_new(Arc::clone(&schema), columns)?;
    Ok(MetricsIndexData {
        schema,
        batches: vec![batch],
        parent_records: Some(
            usize::try_from(index.parent.rows).map_err(|e| DataFusionError::External(e.into()))?,
        ),
        row_group_size,
    })
}

fn parse_metadata<T: std::str::FromStr>(
    metadata: &HashMap<String, String>,
    key: &str,
    path: &str,
) -> Result<Option<T>> {
    metadata
        .get(key)
        .map(|value| {
            value.parse::<T>().map_err(|_| {
                DataFusionError::Execution(format!(
                    "metrics index {path} has an invalid {key}: {value}"
                ))
            })
        })
        .transpose()
}

#[cfg(test)]
mod tests {
    use arrow::{
        array::{Float64Array, Int64Array, StringArray, UInt64Array},
        datatypes::{DataType, Field, Schema},
    };
    use config::meta::stream::{FileKey, FileMeta, FileSelection};
    use object_store::{ObjectStore, PutOptions};
    use promql_parser::label::{MatchOp, Matcher, Matchers};

    use super::*;
    use crate::{MetricsFileLayout, legacy_fixture::MetricsIndexWriter};

    fn fixture(
        format: config::FileFormat,
    ) -> (
        RecordBatch,
        String,
        metrics_block::ParentMetadata,
        Vec<u8>,
        Vec<u8>,
    ) {
        let schema = Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("path", DataType::Utf8, true),
        ]));
        let batch = RecordBatch::try_new(
            schema.clone(),
            vec![
                Arc::new(UInt64Array::from(vec![1, 1, 1, 2, 2, 3])),
                Arc::new(Int64Array::from(vec![10, 20, 30, 10, 20, 10])),
                Arc::new(Float64Array::from(vec![1., 2., 3., 4., 5., 6.])),
                Arc::new(StringArray::from(vec![
                    Some("a"),
                    Some("a"),
                    Some("a"),
                    None,
                    None,
                    Some(""),
                ])),
            ],
        )
        .unwrap();
        let key = format!(
            "files/test/metrics/m/2026/09/20/00/indexed-v1-{}{}",
            config::ider::uuid(),
            format.extension()
        );
        let parent = metrics_block::ParentMetadata {
            rows: 6,
            compressed_size: 123,
        };
        let row_group_size = (format == config::FileFormat::Parquet).then_some(100);
        let mut legacy = MetricsIndexWriter::try_new(&schema).unwrap();
        legacy.write(&batch).unwrap();
        let legacy = legacy.finish(6, row_group_size).unwrap();
        let mut writer =
            metrics_block::BlockWriter::new_pending(Vec::new(), schema.clone(), 2).unwrap();
        writer.write(&batch).unwrap();
        let blocks = writer
            .finish_for_source(parent.clone(), schema, row_group_size.map(|v| v as u32))
            .unwrap();
        (batch, key, parent, legacy, blocks)
    }

    #[tokio::test]
    async fn block_metadata_matches_legacy_pruning_for_both_parent_formats() {
        for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
            let (batch, key, _parent, legacy, blocks) = fixture(format);
            assert!(
                decode_metrics_index(
                    "legacy-only-parser",
                    bytes::Bytes::from(blocks.clone()),
                    &["path".into()]
                )
                .is_err()
            );
            let id = config::ider::uuid();
            let account = format!("{id}:default");
            let store = object_store::memory::InMemory::new();
            let path = MetricsFileLayout::metrics_index_path(&key).unwrap();
            store
                .put_opts(
                    &path.clone().into(),
                    bytes::Bytes::from(blocks.clone()).into(),
                    PutOptions::default(),
                )
                .await
                .unwrap();
            let moved_key = format!(
                "files/moved/metrics/renamed/2030/01/01/00/indexed-v1-{}{}",
                config::ider::uuid(),
                format.extension()
            );
            let moved_path = MetricsFileLayout::metrics_index_path(&moved_key).unwrap();
            store
                .put_opts(
                    &moved_path.clone().into(),
                    bytes::Bytes::from(blocks).into(),
                    PutOptions::default(),
                )
                .await
                .unwrap();
            infra::storage::add_account(&id, Box::new(store)).await;
            let labels = Arc::new(vec!["path".into()]);
            let old = decode_metrics_index("legacy", legacy.into(), &labels).unwrap();
            let new = load_metrics_index_file(&account, &path, format, 6, 123, labels.clone())
                .await
                .unwrap();
            let moved =
                load_metrics_index_file(&account, &moved_path, format, 6, 123, labels.clone())
                    .await
                    .unwrap();
            assert_eq!(moved.schema, new.schema);
            assert_eq!(moved.batches, new.batches);
            assert_eq!(
                new.schema
                    .fields()
                    .iter()
                    .map(|f| f.name())
                    .collect::<Vec<_>>(),
                old.schema
                    .fields()
                    .iter()
                    .map(|f| f.name())
                    .collect::<Vec<_>>()
            );
            assert_eq!(new.parent_records, old.parent_records);
            assert_eq!(new.row_group_size, old.row_group_size);
            for (op, value) in [
                (MatchOp::Equal, "a"),
                (MatchOp::Equal, ""),
                (MatchOp::NotEqual, "a"),
                (MatchOp::Re(".*".parse().unwrap()), ".*"),
            ] {
                let matchers = Matchers::new(vec![Matcher::new(op, "path", value)]);
                let filter = crate::pruner::create_physical_filter(&new.schema, &matchers).unwrap();
                let legacy_filter =
                    crate::pruner::create_physical_filter(&old.schema, &matchers).unwrap();
                let expected = evaluate_metrics_index(&old, legacy_filter.as_deref(), 6).unwrap();
                assert_eq!(
                    evaluate_metrics_index(&new, filter.as_deref(), 6).unwrap(),
                    expected
                );
                let mut files = vec![FileKey::new(
                    0,
                    account.clone(),
                    key.clone(),
                    FileMeta {
                        records: 6,
                        compressed_size: 123,
                        ..Default::default()
                    },
                    false,
                )];
                assert!(
                    crate::search(
                        "compatibility",
                        &mut files,
                        batch.schema().as_ref(),
                        &matchers,
                        1
                    )
                    .await
                    .unwrap()
                    .unwrap()
                    .1
                );
                if expected.is_empty() {
                    assert!(files.is_empty());
                } else {
                    assert_eq!(files.len(), 1);
                    assert!(
                        matches!(&files[0].selection, Some(FileSelection::RowRanges(ranges)) if ranges.as_ref() == &expected)
                    );
                }
            }
            assert!(
                load_metrics_index_file(&account, &path, format, 6, 124, labels)
                    .await
                    .is_err()
            );
        }
    }

    #[tokio::test]
    async fn malformed_and_missing_indexes_leave_files_unpruned() {
        for kind in [
            "missing",
            "truncated",
            "missing_marker",
            "previous_format",
            "legacy",
        ] {
            let (batch, key, _parent, legacy, mut blocks) = fixture(config::FileFormat::Parquet);
            let id = config::ider::uuid();
            let account = format!("{id}:default");
            let store = object_store::memory::InMemory::new();
            let path = MetricsFileLayout::metrics_index_path(&key).unwrap();
            if kind != "missing" {
                let bytes = match kind {
                    "truncated" => vec![0; 7],
                    "missing_marker" => {
                        let len = blocks.len();
                        blocks[len - 1] ^= 1;
                        blocks
                    }
                    "previous_format" => {
                        let mut old = vec![0u8; 128];
                        old[64..72].copy_from_slice(b"O2MIDX01");
                        old[72..76].copy_from_slice(&1u32.to_le_bytes());
                        old[88..96].copy_from_slice(&64u64.to_le_bytes());
                        old
                    }
                    _ => legacy,
                };
                store
                    .put_opts(
                        &path.into(),
                        bytes::Bytes::from(bytes).into(),
                        PutOptions::default(),
                    )
                    .await
                    .unwrap();
            }
            infra::storage::add_account(&id, Box::new(store)).await;
            let mut files = vec![FileKey::new(
                0,
                account,
                key,
                FileMeta {
                    records: 6,
                    compressed_size: 123,
                    ..Default::default()
                },
                false,
            )];
            let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "a")]);
            let exact = crate::search(
                "fallback",
                &mut files,
                batch.schema().as_ref(),
                &matchers,
                1,
            )
            .await
            .unwrap()
            .unwrap()
            .1;
            assert_eq!(exact, kind == "legacy");
            assert_eq!(files.len(), 1);
            assert_eq!(files[0].selection.is_some(), kind == "legacy");
        }
    }
}
