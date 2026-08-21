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

use std::{io::Cursor, ops::Range, sync::Arc};

use arrow::{
    array::{Array, BooleanArray, RecordBatch, UInt32Array},
    datatypes::SchemaRef,
    ipc::reader::FileReaderBuilder as ArrowFileReaderBuilder,
};
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::PhysicalExpr,
};

use crate::layout::METRICS_INDEX_ROW_COUNT;

pub(super) struct MetricsIndexData {
    pub(super) schema: SchemaRef,
    pub(super) batches: Vec<RecordBatch>,
}

pub(super) async fn load_metrics_index_file(
    account: &str,
    path: &str,
    labels: Arc<Vec<String>>,
) -> Result<MetricsIndexData> {
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
    Ok(MetricsIndexData { schema, batches })
}

/// Evaluate `filter` over the run rows and collect the selected physical row
/// ranges. Runs tile the data file, so each run's start is the prefix sum of
/// the preceding counts.
pub(super) fn evaluate_metrics_index(
    data: &MetricsIndexData,
    filter: Option<&dyn PhysicalExpr>,
    expected_rows: usize,
) -> Result<Vec<Range<usize>>> {
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
