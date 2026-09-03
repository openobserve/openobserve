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

//! The matrix producer: an already-materialized matrix served through the
//! series-source contract, so layouts that cannot stream still share the
//! streaming consumers.

use std::sync::Arc;

use config::meta::promql::value::{Labels, RangeValue, Sample};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;

use super::SeriesSource;
use crate::aggregations::{group_series_by_labels, projected_labels};

/// Series per partition; matches the fused fold's historical chunk size.
pub(crate) const MATRIX_PARTITION_CHUNK: usize = 1024;

/// One partition of a materialized matrix, iterated group-contiguously.
pub(crate) struct MatrixSource {
    matrix: Arc<Vec<RangeValue>>,
    modifier: Option<LabelModifier>,
    /// `(group signature, matrix index)` of this partition's series.
    order: Vec<(u64, u32)>,
    pos: usize,
}

impl SeriesSource for MatrixSource {
    async fn advance(&mut self) -> Result<Option<u64>> {
        Ok(self.order.get(self.pos).map(|&(sig, _)| sig))
    }

    fn labels(&self) -> Labels {
        let (_, index) = self.order[self.pos];
        projected_labels(&self.modifier, &self.matrix[index as usize].labels)
    }

    async fn consume(&mut self) -> Result<&[Sample]> {
        let (_, index) = self.order[self.pos];
        self.pos += 1;
        Ok(&self.matrix[index as usize].samples)
    }
}

/// Splits a matrix into group-contiguous partitions behind shared ownership;
/// partition boundaries depend only on the series count, so folds merge
/// deterministically.
pub(crate) fn matrix_sources(
    matrix: Vec<RangeValue>,
    modifier: &Option<LabelModifier>,
    max_partitions: usize,
) -> (Arc<Vec<RangeValue>>, Vec<MatrixSource>) {
    let mut groups: Vec<(u64, Vec<usize>)> = group_series_by_labels(&matrix, modifier)
        .into_iter()
        .collect();
    groups.sort_unstable_by_key(|(sig, _)| *sig);
    let order: Vec<(u64, u32)> = groups
        .into_iter()
        .flat_map(|(sig, indices)| indices.into_iter().map(move |index| (sig, index as u32)))
        .collect();

    // small folds stay sequential, keeping them bit-identical to the generic path
    let partitions = if order.len() < 2 * MATRIX_PARTITION_CHUNK {
        1
    } else {
        max_partitions
            .max(1)
            .min(order.len().div_ceil(MATRIX_PARTITION_CHUNK))
    };
    let chunk = order.len().div_ceil(partitions).max(1);

    let matrix = Arc::new(matrix);
    let sources = order
        .chunks(chunk)
        .map(|chunk| MatrixSource {
            matrix: matrix.clone(),
            modifier: modifier.clone(),
            order: chunk.to_vec(),
            pos: 0,
        })
        .collect();
    (matrix, sources)
}
