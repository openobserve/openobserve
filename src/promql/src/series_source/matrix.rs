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

use config::meta::promql::value::{Labels, RangeValue, Sample};
use datafusion::error::Result;
use promql_parser::parser::LabelModifier;

use super::SeriesSource;
use crate::aggregations::{group_series_by_labels, projected_labels};

/// Series per partition; matches the fused fold's historical chunk size.
pub(crate) const MATRIX_PARTITION_CHUNK: usize = 1024;

/// One partition of a materialized matrix, owning its series in group order.
pub(crate) struct MatrixSource {
    series: std::vec::IntoIter<(u64, RangeValue)>,
    current: Option<RangeValue>,
    modifier: Option<LabelModifier>,
}

impl SeriesSource for MatrixSource {
    async fn advance(&mut self) -> Result<Option<u64>> {
        let Some((sig, series)) = self.series.next() else {
            self.current = None;
            return Ok(None);
        };
        self.current = Some(series);
        Ok(Some(sig))
    }

    fn labels(&mut self) -> Labels {
        let series = self.current.as_ref().expect("advance yielded a series");
        projected_labels(&self.modifier, &series.labels)
    }

    async fn consume(&mut self) -> Result<&[Sample]> {
        let series = self.current.as_ref().expect("advance yielded a series");
        Ok(&series.samples)
    }
}

/// Splits a matrix into group-contiguous partitions; boundaries depend only on the series count.
pub(crate) fn matrix_sources(
    matrix: Vec<RangeValue>,
    modifier: &Option<LabelModifier>,
    max_partitions: usize,
) -> Vec<MatrixSource> {
    let mut groups: Vec<(u64, Vec<usize>)> = group_series_by_labels(&matrix, modifier)
        .into_iter()
        .collect();
    groups.sort_unstable_by_key(|(sig, _)| *sig);

    let total: usize = groups.iter().map(|(_, indices)| indices.len()).sum();
    // small folds stay sequential, keeping them bit-identical to the generic path
    let partitions = if total < 2 * MATRIX_PARTITION_CHUNK {
        1
    } else {
        max_partitions
            .max(1)
            .min(total.div_ceil(MATRIX_PARTITION_CHUNK))
    };
    let chunk = total.div_ceil(partitions).max(1);

    // every index appears exactly once, so each series moves straight into its partition
    let mut slots: Vec<Option<RangeValue>> = matrix.into_iter().map(Some).collect();
    let mut parts: Vec<Vec<(u64, RangeValue)>> =
        (0..partitions).map(|_| Vec::with_capacity(chunk)).collect();
    let mut position = 0;
    for (sig, indices) in groups {
        for index in indices {
            let series = slots[index].take().expect("series moved once");
            parts[position / chunk].push((sig, series));
            position += 1;
        }
    }

    parts
        .into_iter()
        .map(|part| MatrixSource {
            series: part.into_iter(),
            current: None,
            modifier: modifier.clone(),
        })
        .collect()
}
