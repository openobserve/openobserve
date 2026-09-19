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
    labels: Arc<Vec<String>>,
) -> Result<MetricsIndexData> {
    let header = infra::cache::storage::get_range(account, &path.into(), 0..6)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    if header.as_ref() != b"ARROW1" {
        return Err(DataFusionError::Execution(
            "Metrics index is not legacy Arrow metadata".into(),
        ));
    }
    let bytes = infra::cache::file_data::get(account, path, None)
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    let path = path.to_string();
    tokio::task::spawn_blocking(move || decode_metrics_index(&path, bytes, &labels))
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?
}

pub(super) async fn load_metrics_index_blocks(
    file: &config::meta::stream::FileKey,
    labels: Arc<Vec<String>>,
) -> Result<MetricsIndexData> {
    let index = promql::load_metrics_block_index(file, &labels)
        .await
        .map_err(|e| DataFusionError::External(e.into()))?;
    metrics_block_index_data(&index)
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

fn metrics_block_index_data(index: &metrics_block::Index) -> Result<MetricsIndexData> {
    let row_group_size = index.row_group_size.ok_or_else(|| {
        DataFusionError::Execution("Block index lacks parent row group size".into())
    })?;
    let mut fields = vec![arrow::datatypes::Field::new(
        METRICS_INDEX_ROW_COUNT,
        arrow::datatypes::DataType::UInt32,
        false,
    )];
    let mut columns: Vec<arrow::array::ArrayRef> = vec![Arc::new(UInt32Array::from_iter_values(
        index.blocks.iter().map(|b| b.row_count),
    ))];
    for (i, field) in index.labels.schema().fields().iter().enumerate() {
        if index.source_schema.field_with_name(field.name()).is_ok() {
            fields.push(field.as_ref().clone());
            columns.push(Arc::clone(index.labels.column(i)));
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
        row_group_size: Some(row_group_size),
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
        array::{ArrayRef, Float64Array, Int64Array, StringArray, UInt64Array},
        datatypes::{DataType, Field, Schema},
        ipc::writer::FileWriter,
    };
    use bytes::Bytes;
    use parquet::arrow::ArrowWriter;
    use promql_parser::label::{MatchOp, Matcher, Matchers};

    use super::*;

    #[test]
    fn legacy_and_block_metadata_preserve_null_empty_negative_and_regex_pruning() {
        let labels = vec!["tag".to_owned(), "missing".to_owned()];
        let schema = Arc::new(Schema::new(vec![
            Field::new("__hash__", DataType::UInt64, false),
            Field::new("_timestamp", DataType::Int64, false),
            Field::new("value", DataType::Float64, false),
            Field::new("tag", DataType::Utf8, true),
        ]));
        let tags: ArrayRef = Arc::new(StringArray::from(vec![
            None,
            Some(""),
            Some("a"),
            Some("b"),
        ]));
        let source = RecordBatch::try_new(
            Arc::clone(&schema),
            vec![
                Arc::new(UInt64Array::from(vec![1, 2, 3, 4])),
                Arc::new(Int64Array::from(vec![10; 4])),
                Arc::new(Float64Array::from(vec![1.; 4])),
                Arc::clone(&tags),
            ],
        )
        .unwrap();
        let mut parquet = Vec::new();
        let mut writer = ArrowWriter::try_new(&mut parquet, schema, None).unwrap();
        writer.write(&source).unwrap();
        writer.close().unwrap();
        let parent = metrics_block::ParentIdentity {
            object_key: "files/o/metrics/m/2026/09/18/06/indexed-v1-fixture.parquet".into(),
            rows: 4,
            compressed_size: parquet.len() as u64,
        };
        let bytes =
            metrics_block::build_from_parquet(Bytes::from(parquet), parent.clone()).unwrap();
        let footer = metrics_block::read_footer(
            &bytes[bytes.len() - metrics_block::FOOTER_LEN..],
            bytes.len() as u64,
        )
        .unwrap();
        let parsed = metrics_block::decode_index(
            Bytes::copy_from_slice(
                &bytes[footer.metadata_range.start as usize..footer.metadata_range.end as usize],
            ),
            &footer,
            &parent,
            &labels,
        )
        .unwrap();
        let blocks = metrics_block_index_data(&parsed).unwrap();
        let legacy_schema = Arc::new(Schema::new(vec![
            Field::new(METRICS_INDEX_ROW_COUNT, DataType::UInt32, false),
            Field::new("tag", DataType::Utf8, true),
        ]));
        let legacy_batch = RecordBatch::try_new(
            Arc::clone(&legacy_schema),
            vec![Arc::new(UInt32Array::from(vec![1; 4])), tags],
        )
        .unwrap();
        let mut legacy = Vec::new();
        let mut writer = FileWriter::try_new(&mut legacy, &legacy_schema).unwrap();
        writer.write(&legacy_batch).unwrap();
        writer.finish().unwrap();
        let old = decode_metrics_index("old.midx", Bytes::from(legacy), &labels).unwrap();
        for matcher in [
            Matcher::new(MatchOp::Equal, "tag", ""),
            Matcher::new(MatchOp::NotEqual, "tag", "a"),
            Matcher::new(MatchOp::Re("a|b".parse().unwrap()), "tag", "a|b"),
            Matcher::new(MatchOp::NotRe("a".parse().unwrap()), "tag", "a"),
            Matcher::new(MatchOp::Equal, "missing", ""),
        ] {
            let matchers = Matchers::new(vec![matcher]);
            let selected = [&old, &blocks].map(|data| {
                let filter =
                    crate::pruner::create_physical_filter(&data.schema, &matchers).unwrap();
                evaluate_metrics_index(data, filter.as_deref(), 4).unwrap()
            });
            assert_eq!(selected[0], selected[1], "{matchers:?}");
        }
    }
}
