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

use std::{ops::Range, sync::Arc};

use arrow::{
    array::{Array, BooleanArray, RecordBatch, UInt32Array},
    datatypes::SchemaRef,
};
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::PhysicalExpr,
};

use crate::layout::METRICS_INDEX_ROW_COUNT;

pub(super) struct MetricsIndexData {
    pub(super) schema: SchemaRef,
    pub(super) batches: Vec<RecordBatch>,
    pub(super) parent_records: usize,
    /// Vortex does not use Parquet row groups.
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
    let parent = metrics_block::ParentMetadata {
        rows: u64::try_from(parent_rows)
            .map_err(|error| DataFusionError::External(error.into()))?,
        compressed_size: u64::try_from(parent_size)
            .map_err(|error| DataFusionError::External(error.into()))?,
    };
    load_block_metadata(account, path, parent, format, labels).await
}

/// Evaluate `filter` over the run rows and collect the selected physical row
/// ranges. Runs tile the data file, so each run's start is the prefix sum of
/// the preceding counts.
pub(super) fn evaluate_metrics_index(
    data: &MetricsIndexData,
    filter: Option<&dyn PhysicalExpr>,
    expected_rows: usize,
) -> Result<Vec<Range<usize>>> {
    let parent_records = data.parent_records;
    if parent_records != expected_rows {
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
        parent_records: usize::try_from(index.parent.rows)
            .map_err(|e| DataFusionError::External(e.into()))?,
        row_group_size,
    })
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
    use crate::MetricsFileLayout;

    async fn fixture(format: config::FileFormat) -> (RecordBatch, FileKey, Vec<u8>) {
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
        let id = config::ider::uuid();
        let mut file = FileKey::new(
            0,
            format!("{id}:default"),
            format!(
                "files/test/metrics/m/2026/09/20/00/indexed-v1-{id}{}",
                format.extension()
            ),
            FileMeta {
                records: 6,
                compressed_size: 123,
                ..Default::default()
            },
            false,
        );
        let mut writer =
            metrics_block::BlockWriter::new_pending(Vec::new(), schema.clone(), 2).unwrap();
        writer.write(&batch).unwrap();
        let bytes = match format {
            config::FileFormat::Parquet => {
                let mut parquet = config::utils::parquet::new_parquet_writer(
                    Vec::new(),
                    &schema,
                    &[],
                    &file.meta,
                    false,
                    None,
                );
                parquet.write(&batch).await.unwrap();
                let metadata = parquet.finish().await.unwrap();
                file.meta.compressed_size = i64::try_from(parquet.bytes_written()).unwrap();
                writer.finish_for_parquet(
                    metrics_block::ParentMetadata {
                        rows: 6,
                        compressed_size: file.meta.compressed_size as u64,
                    },
                    metadata,
                )
            }
            config::FileFormat::Vortex => writer.finish_for_vortex(
                metrics_block::ParentMetadata {
                    rows: 6,
                    compressed_size: 123,
                },
                schema,
            ),
        }
        .unwrap();
        (batch, file, bytes)
    }

    async fn store(file: &FileKey, bytes: Option<Vec<u8>>) {
        let store = object_store::memory::InMemory::new();
        if let Some(bytes) = bytes {
            let path = MetricsFileLayout::metrics_index_path(&file.key).unwrap();
            store
                .put_opts(
                    &path.into(),
                    bytes::Bytes::from(bytes).into(),
                    PutOptions::default(),
                )
                .await
                .unwrap();
        }
        let id = file.account.strip_suffix(":default").unwrap();
        infra::storage::add_account(id, Box::new(store)).await;
    }

    #[tokio::test]
    async fn current_metadata_prunes_both_parent_formats() {
        for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
            let (batch, file, bytes) = fixture(format).await;
            store(&file, Some(bytes)).await;
            for (op, value, expected) in [
                (MatchOp::Equal, "a", vec![Range { start: 0, end: 3 }]),
                (MatchOp::Equal, "", vec![Range { start: 5, end: 6 }]),
                (MatchOp::NotEqual, "a", vec![Range { start: 5, end: 6 }]),
                (MatchOp::Re(".*".parse().unwrap()), ".*", vec![0..3, 5..6]),
                (MatchOp::Equal, "unmatched", vec![]),
            ] {
                let mut files = vec![file.clone()];
                let matchers = Matchers::new(vec![Matcher::new(op, "path", value)]);
                let (_, exact) =
                    crate::search("prune", &mut files, batch.schema().as_ref(), &matchers, 1)
                        .await
                        .unwrap()
                        .unwrap();
                assert!(exact);
                if expected.is_empty() {
                    assert!(files.is_empty());
                } else {
                    assert_eq!(files.len(), 1);
                    assert!(
                        matches!(&files[0].selection, Some(FileSelection::RowRanges(ranges)) if ranges.as_ref() == &expected)
                    );
                    assert_eq!(
                        files[0].row_group_size.is_some(),
                        format == config::FileFormat::Parquet
                    );
                }
            }
        }
    }

    #[tokio::test]
    async fn unusable_index_preserves_source_scan() {
        for format in [config::FileFormat::Parquet, config::FileFormat::Vortex] {
            for present in [false, true] {
                let (batch, file, _) = fixture(format).await;
                store(&file, present.then(|| vec![0; 128])).await;
                let mut files = vec![file];
                let matchers = Matchers::new(vec![Matcher::new(MatchOp::Equal, "path", "a")]);
                let (_, exact) = crate::search(
                    "fallback",
                    &mut files,
                    batch.schema().as_ref(),
                    &matchers,
                    1,
                )
                .await
                .unwrap()
                .unwrap();
                assert!(!exact);
                assert_eq!(files.len(), 1);
                assert!(files[0].selection.is_none());
            }
        }
    }
}
