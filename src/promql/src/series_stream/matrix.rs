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

//! The matrix stream: an already-materialized matrix served through the
//! series-stream contract, so layouts that cannot stream still share the
//! streaming consumers.

use std::time::Duration;

use config::meta::promql::{
    NAME_LABEL,
    value::{Labels, RangeValue, Sample, Value},
};
use datafusion::error::{DataFusionError, Result};
use promql_parser::parser::LabelModifier;
use rayon::prelude::*;

use super::SeriesStream;
use crate::{
    aggregations::{group_series_by_labels, projected_labels},
    functions::KEEP_METRIC_NAME_FUNC,
};

/// Series per partition; matches the fused fold's historical chunk size.
pub(crate) const MATRIX_PARTITION_CHUNK: usize = 1024;

/// A partition of the matrix, already open.
pub(crate) type MaterializedSource = std::future::Ready<Result<MatrixSeriesStream>>;

/// One partition of a materialized matrix, owning its series in group order.
pub(crate) struct MatrixSeriesStream {
    series: std::vec::IntoIter<(u64, RangeValue)>,
    current: Option<RangeValue>,
    modifier: Option<LabelModifier>,
}

impl SeriesStream for MatrixSeriesStream {
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
pub(crate) fn matrix_streams(
    matrix: Vec<RangeValue>,
    modifier: &Option<LabelModifier>,
    max_partitions: usize,
) -> Vec<MatrixSeriesStream> {
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
        .map(|part| MatrixSeriesStream {
            series: part.into_iter(),
            current: None,
            modifier: modifier.clone(),
        })
        .collect()
}

/// The matrix as group-ordered sources for the aggregate and the window the load applied to
/// it; `None` for no input.
pub(crate) fn group_sources(
    data: Value,
    modifier: &Option<LabelModifier>,
    func_name: &str,
) -> Result<Option<(Vec<MaterializedSource>, Duration)>> {
    let mut matrix = match data {
        Value::Matrix(matrix) if matrix.is_empty() => return Ok(None),
        Value::Matrix(matrix) => matrix,
        Value::None => return Ok(None),
        value => {
            return Err(DataFusionError::Plan(format!(
                "{func_name}: matrix argument expected but got {}",
                value.get_type()
            )));
        }
    };
    // the load applied one window to every series, so the first speaks for all
    let range = matrix[0]
        .time_window
        .as_ref()
        .expect("range function input must have a time window")
        .range;
    // strip the metric name as the range function would have; visible to `sum by(__name__)`
    if func_name != KEEP_METRIC_NAME_FUNC {
        matrix.par_iter_mut().for_each(|series| {
            series.labels.retain(|label| label.name != NAME_LABEL);
        });
    }
    let sources = matrix_streams(matrix, modifier, config::get_config().limit.cpu_num)
        .into_iter()
        .map(|stream| std::future::ready(Ok(stream)))
        .collect();
    Ok(Some((sources, range)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_group_sources_none_and_invalid_input() {
        assert!(group_sources(Value::None, &None, "rate").unwrap().is_none());
        assert!(group_sources(Value::Float(1.0), &None, "rate").is_err());
        assert!(
            group_sources(Value::Matrix(vec![]), &None, "rate")
                .unwrap()
                .is_none()
        );
    }
}
