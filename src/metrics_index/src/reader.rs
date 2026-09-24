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
use bytes::Bytes;
use datafusion::{
    common::{DataFusionError, Result},
    physical_plan::PhysicalExpr,
};

use crate::layout::METRICS_INDEX_ROW_COUNT;

/// Label plus directory regions up to this size are read whole, like object_store coalescing.
pub(super) const SMALL_METADATA_BYTES: u64 = 1024 * 1024;

pub(super) struct MetricsIndexData {
    pub(super) schema: SchemaRef,
    pub(super) batches: Vec<RecordBatch>,
    pub(super) parent_records: usize,
    /// Vortex does not use Parquet row groups.
    pub(super) row_group_size: Option<u32>,
}

pub(super) struct IndexLabels {
    pub requested: Arc<Vec<String>>,
    pub flat: Arc<Vec<String>>,
}

/// Trailing bytes of a MIDX file already fetched while reading its header.
struct Tail {
    start: u64,
    bytes: Bytes,
}

impl Tail {
    fn slice(&self, range: Range<u64>) -> Result<Bytes> {
        let start = usize::try_from(range.start - self.start)
            .map_err(|error| DataFusionError::External(error.into()))?;
        let end = usize::try_from(range.end - self.start)
            .map_err(|error| DataFusionError::External(error.into()))?;
        if start > end || end > self.bytes.len() {
            return Err(DataFusionError::Execution(
                "MIDX column outside tail".into(),
            ));
        }
        Ok(self.bytes.slice(start..end))
    }
}

pub(super) async fn load_metrics_index_file(
    account: &str,
    path: &str,
    format: config::FileFormat,
    parent_rows: usize,
    parent_size: i64,
    index_size: i64,
    labels: IndexLabels,
) -> Result<MetricsIndexData> {
    let parent = crate::block::ParentMetadata {
        rows: u64::try_from(parent_rows)
            .map_err(|error| DataFusionError::External(error.into()))?,
        compressed_size: u64::try_from(parent_size)
            .map_err(|error| DataFusionError::External(error.into()))?,
    };
    load_block_metadata(account, path, parent, index_size, format, labels).await
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
    parent: crate::block::ParentMetadata,
    index_size: i64,
    format: config::FileFormat,
    labels: IndexLabels,
) -> Result<MetricsIndexData> {
    let known_size = u64::try_from(index_size).ok().filter(|size| *size > 0);
    let size = if let Some(size) = known_size {
        size
    } else {
        head_size(account, path).await?
    };
    let (header, tail) = match read_header(account, path, size, &parent).await {
        Ok(read) => read,
        Err(error) if known_size.is_some() => {
            let actual_size = head_size(account, path).await?;
            if actual_size == size {
                return Err(error);
            }
            read_header(account, path, actual_size, &parent).await?
        }
        Err(error) => return Err(error),
    };
    let ranges = header
        .column_ranges(&labels.requested)
        .map_err(|error| DataFusionError::External(error.into()))?;
    let columns = read_columns(account, path, &ranges, &tail).await?;
    tokio::task::spawn_blocking(move || {
        let index = crate::block::decode_index(&header, &columns, &labels.requested)
            .map_err(|error| DataFusionError::External(error.into()))?;
        metrics_block_index_data(&index, format, &labels.flat)
    })
    .await
    .map_err(|error| DataFusionError::External(Box::new(error)))?
}

async fn head_size(account: &str, path: &str) -> Result<u64> {
    Ok(infra::cache::storage::head(account, &path.into())
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?
        .size)
}

async fn get_range(account: &str, path: &str, range: Range<u64>) -> Result<Bytes> {
    let bytes = infra::cache::storage::get_range(account, &path.into(), range.clone())
        .await
        .map_err(|error| DataFusionError::External(Box::new(error)))?;
    if bytes.len() as u64 != range.end - range.start {
        return Err(DataFusionError::Execution("Truncated MIDX range".into()));
    }
    Ok(bytes)
}

fn concat(prefix: &[u8], suffix: &[u8]) -> Bytes {
    Bytes::from([prefix, suffix].concat())
}

/// Reads the probe, then in one more request whatever the trailer shows is needed before columns.
async fn read_header(
    account: &str,
    path: &str,
    size: u64,
    parent: &crate::block::ParentMetadata,
) -> Result<(crate::block::Header, Tail)> {
    let external = |error: anyhow::Error| DataFusionError::External(error.into());
    let mut start = size.saturating_sub(crate::block::HEADER_PROBE_BYTES);
    let mut bytes = get_range(account, path, start..size).await?;
    let trailer = crate::block::Header::trailer(&bytes, size).map_err(external)?;
    let needed = if trailer.label_len + trailer.directory_len <= SMALL_METADATA_BYTES {
        trailer.payload_end(size)
    } else if trailer.header_start(size) < start {
        trailer.directory_start(size)
    } else {
        start
    };
    if needed < start {
        let prefix = get_range(account, path, needed..start).await?;
        start = needed;
        bytes = concat(&prefix, &bytes);
    }
    let header = crate::block::Header::parse(&bytes, size, parent).map_err(external)?;
    Ok((header, Tail { start, bytes }))
}

/// Fetches `ranges` in one batched call, serving the parts already held in `tail` locally.
async fn read_columns(
    account: &str,
    path: &str,
    ranges: &[Range<u64>],
    tail: &Tail,
) -> Result<Vec<Bytes>> {
    let remote = ranges
        .iter()
        .filter(|range| range.start < tail.start)
        .map(|range| range.start..range.end.min(tail.start))
        .collect::<Vec<_>>();
    let mut fetched = if remote.is_empty() {
        Vec::new()
    } else {
        infra::cache::storage::get_ranges(account, &path.into(), &remote)
            .await
            .map_err(|error| DataFusionError::External(Box::new(error)))?
    }
    .into_iter()
    .zip(remote);
    let mut columns = Vec::with_capacity(ranges.len());
    for range in ranges {
        let local = tail.slice(range.start.max(tail.start)..range.end.max(tail.start))?;
        if range.start >= tail.start {
            columns.push(local);
            continue;
        }
        let (prefix, expected) = fetched
            .next()
            .ok_or_else(|| DataFusionError::Execution("Missing MIDX column range".into()))?;
        if prefix.len() as u64 != expected.end - expected.start {
            return Err(DataFusionError::Execution("Truncated MIDX column".into()));
        }
        columns.push(if local.is_empty() {
            prefix
        } else {
            concat(&prefix, &local)
        });
    }
    Ok(columns)
}

fn metrics_block_index_data(
    index: &crate::block::Index,
    format: config::FileFormat,
    flat_labels: &[String],
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
        if index.source_schema.field_with_name(field.name()).is_ok() {
            if flat_labels.contains(field.name()) {
                let source_field = index.source_schema.field_with_name(field.name())?;
                fields.push(source_field.clone());
                columns.push(arrow::compute::cast(
                    index.labels.column(i),
                    source_field.data_type(),
                )?);
            } else {
                fields.push(field.as_ref().clone());
                columns.push(Arc::clone(index.labels.column(i)));
            }
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
