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

use std::{io::Cursor, sync::Arc};

use arrow::error::ArrowError;
use arrow_schema::Schema;
use bytes::Bytes;
use config::{get_batch_size, utils::parquet::RecordBatchStream};
use futures::TryStreamExt;
use parquet::arrow::{
    ParquetRecordBatchStreamBuilder, ProjectionMask, arrow_reader::ParquetRecordBatchReaderBuilder,
};

use super::RecordBatchIter;

/// Open a parquet file and return an async record batch stream over all rows.
pub(super) async fn scan_parquet_async(
    data: Bytes,
    projection: Option<&[String]>,
) -> Result<RecordBatchStream, anyhow::Error> {
    let builder = ParquetRecordBatchStreamBuilder::new(Cursor::new(data)).await?;
    let mut builder = builder.with_batch_size(get_batch_size());
    if let Some(mask) = parquet_projection(builder.schema(), builder.metadata(), projection)? {
        builder = builder.with_projection(mask);
    }
    let reader = builder.build()?;
    let stream: RecordBatchStream = Box::pin(reader.map_err(ArrowError::from));
    Ok(stream)
}

/// Build a sync iterator over one parquet row group.
pub(super) fn scan_parquet_row_group(
    data: Bytes,
    projection: Option<&[String]>,
    row_group_id: usize,
) -> Result<RecordBatchIter, anyhow::Error> {
    let builder = ParquetRecordBatchReaderBuilder::try_new(data)?;
    let mut builder = builder.with_batch_size(get_batch_size());
    if let Some(mask) = parquet_projection(builder.schema(), builder.metadata(), projection)? {
        builder = builder.with_projection(mask);
    }
    let reader = builder.with_row_groups(vec![row_group_id]).build()?;
    Ok(Box::new(reader))
}

/// Compute the parquet `ProjectionMask` for a given projection column list.
/// Returns `None` when all columns should be read.
pub(super) fn parquet_projection(
    full_schema: &Arc<Schema>,
    metadata: &parquet::file::metadata::ParquetMetaData,
    projection: Option<&[String]>,
) -> Result<Option<ProjectionMask>, anyhow::Error> {
    let Some(cols) = projection else {
        return Ok(None);
    };

    let kept: Vec<usize> = full_schema
        .fields()
        .iter()
        .enumerate()
        .filter_map(|(i, f)| cols.iter().any(|c| c == f.name()).then_some(i))
        .collect();

    if kept.is_empty() {
        return Ok(None);
    }

    Ok(Some(ProjectionMask::roots(
        metadata.file_metadata().schema_descr(),
        kept,
    )))
}
