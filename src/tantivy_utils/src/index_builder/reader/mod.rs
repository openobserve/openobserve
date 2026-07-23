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

//! Record readers used by the Tantivy index builder.

mod parquet;
#[cfg(all(feature = "vortex", feature = "enterprise"))]
mod vortex;

#[cfg(all(feature = "vortex", feature = "enterprise"))]
use std::ops::Range;

use arrow::{error::ArrowError, record_batch::RecordBatch};
use bytes::Bytes;
use config::{FileFormat, utils::parquet::RecordBatchStream};

pub(super) type RecordBatchIter = Box<dyn Iterator<Item = Result<RecordBatch, ArrowError>>>;

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
        FileFormat::Parquet => parquet::scan_parquet_async(data, projection).await,
        #[cfg(all(feature = "vortex", feature = "enterprise"))]
        FileFormat::Vortex => vortex::scan_vortex_async(data, projection).await,
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
) -> Result<RecordBatchIter, anyhow::Error> {
    match selector {
        ChunkSelector::Parquet(row_group_id) => {
            parquet::scan_parquet_row_group(data, projection, row_group_id)
        }
        #[cfg(all(feature = "vortex", feature = "enterprise"))]
        ChunkSelector::Vortex(row_range) => {
            vortex::scan_vortex_row_range(data, projection, row_range)
        }
    }
}
