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

mod parquet;
#[cfg(all(feature = "vortex", feature = "enterprise"))]
mod vortex;

use std::io::Cursor;
#[cfg(all(feature = "vortex", feature = "enterprise"))]
use std::ops::Range;

use ::parquet::arrow::{
    ParquetRecordBatchStreamBuilder,
    arrow_reader::{ParquetRecordBatchReader, ParquetRecordBatchReaderBuilder},
};
use arrow::{error::ArrowError, record_batch::RecordBatch};
use bytes::Bytes;
use config::{FileFormat, get_batch_size, utils::parquet::RecordBatchStream};
use futures::TryStreamExt;
use parquet::parquet_projection;

pub(super) enum ChunkSelector {
    Parquet(usize), // row_group id
    #[cfg(all(feature = "vortex", feature = "enterprise"))]
    Vortex(Range<u64>), // row range
}

/// Read a whole file as a record batch stream restricted to `projection`
/// columns. `None` reads every column.
pub(super) async fn file_stream(
    file_format: FileFormat,
    data: Bytes,
    projection: Option<&[String]>,
) -> Result<RecordBatchStream, anyhow::Error> {
    match file_format {
        FileFormat::Parquet => {
            let builder = ParquetRecordBatchStreamBuilder::new(Cursor::new(data)).await?;
            let mut builder = builder.with_batch_size(get_batch_size());
            if let Some(mask) =
                parquet_projection(builder.schema(), builder.metadata(), projection)?
            {
                builder = builder.with_projection(mask);
            }
            let reader = builder.build()?;
            let stream: RecordBatchStream = Box::pin(reader.map_err(ArrowError::from));
            Ok(stream)
        }
        #[cfg(all(feature = "vortex", feature = "enterprise"))]
        FileFormat::Vortex => vortex::read_vortex_with_projection(data, projection).await,
        #[cfg(not(all(feature = "vortex", feature = "enterprise")))]
        FileFormat::Vortex => Err(anyhow::anyhow!(
            "Vortex file format requires the vortex feature"
        )),
    }
}

/// Sync chunk reader. Returns a sync `Iterator`.
pub(super) fn chunk_iter(
    selector: ChunkSelector,
    data: Bytes,
    projection: Option<&[String]>,
) -> Result<ChunkBatchIter, anyhow::Error> {
    match selector {
        ChunkSelector::Parquet(row_group_id) => {
            let builder = ParquetRecordBatchReaderBuilder::try_new(data)?;
            let mut builder = builder.with_batch_size(get_batch_size());
            if let Some(mask) =
                parquet_projection(builder.schema(), builder.metadata(), projection)?
            {
                builder = builder.with_projection(mask);
            }
            let reader = builder.with_row_groups(vec![row_group_id]).build()?;
            Ok(ChunkBatchIter::Parquet(reader))
        }
        #[cfg(all(feature = "vortex", feature = "enterprise"))]
        ChunkSelector::Vortex(row_range) => {
            let iter = vortex::build_vortex_sync_iter(data, projection, row_range)?;
            Ok(ChunkBatchIter::Vortex(iter))
        }
    }
}

/// Unified sync iterator over parquet or vortex record batches, returned by [`chunk_iter`].
pub(super) enum ChunkBatchIter {
    Parquet(ParquetRecordBatchReader),
    #[cfg(all(feature = "vortex", feature = "enterprise"))]
    Vortex(vortex::VortexRowRangeIter),
}

impl Iterator for ChunkBatchIter {
    type Item = Result<RecordBatch, ArrowError>;

    fn next(&mut self) -> Option<Self::Item> {
        match self {
            Self::Parquet(r) => r.next(),
            #[cfg(all(feature = "vortex", feature = "enterprise"))]
            Self::Vortex(v) => v.next(),
        }
    }
}
