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

use std::sync::Arc;

use arrow_schema::Schema;
use parquet::arrow::ProjectionMask;

/// Compute the parquet `ProjectionMask` for a given projection column list.
/// Shared between the sync and async parquet paths.
pub(super) fn parquet_projection(
    full_schema: &Arc<Schema>,
    metadata: &parquet::file::metadata::ParquetMetaData,
    projection: Option<&[String]>,
) -> Result<ProjectionMask, anyhow::Error> {
    // Keep only requested columns that exist; an empty intersection means
    // "read everything" so we don't emit a 0-column batch.
    let projected_indices: Vec<usize> = match projection {
        Some(cols) => {
            let kept: Vec<usize> = full_schema
                .fields()
                .iter()
                .enumerate()
                .filter_map(|(i, f)| cols.iter().any(|c| c == f.name()).then_some(i))
                .collect();
            if kept.is_empty() {
                (0..full_schema.fields().len()).collect()
            } else {
                kept
            }
        }
        None => (0..full_schema.fields().len()).collect(),
    };

    Ok(ProjectionMask::roots(
        metadata.file_metadata().schema_descr(),
        projected_indices.iter().copied(),
    ))
}
