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

//! The fused projection: a bare range function whose output is the result, so every series
//! maps to its own values and nothing folds.

use std::sync::Arc;

use config::meta::promql::value::{RangeValue, Sample, TimeWindow};
use datafusion::error::Result;

use super::{collect_partitioned, range_expr::RangeExpr};
use crate::series_stream::SeriesStream;

/// Projects every partition's series through the function and returns them whole, in partition
/// order; dropping the future aborts the partitions.
pub(crate) async fn project<F, S>(
    sources: Vec<F>,
    eval: Arc<RangeExpr>,
) -> Result<(Vec<RangeValue>, usize)>
where
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    let start_time = std::time::Instant::now();
    let func_name = eval.func.name();
    let trace_id = eval.eval_ctx.trace_id.clone();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming {func_name}() started with {} partitions",
        sources.len(),
    );
    let parts = sources
        .into_iter()
        .map(|source| {
            let eval = eval.clone();
            async move { project_partition(source.await?, eval).await }
        })
        .collect();
    let parts = collect_partitioned(parts).await?;
    let series_count: usize = parts.iter().map(|(_, series)| series).sum();
    let series: Vec<RangeValue> = parts.into_iter().flat_map(|(series, _)| series).collect();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming {func_name}() execution took: {:?}, mapped {} of {series_count} series",
        start_time.elapsed(),
        series.len(),
    );
    Ok((series, series_count))
}

/// Projects one partition's series; like the generic evaluator, a series with no value is
/// dropped.
async fn project_partition<S: SeriesStream>(
    mut source: S,
    eval: Arc<RangeExpr>,
) -> Result<(Vec<RangeValue>, usize)> {
    let mut series = Vec::new();
    let mut series_count = 0;
    while source.advance().await?.is_some() {
        let labels = source.labels();
        let samples = source.consume().await?;
        let mut values = Vec::with_capacity(eval.timestamps.len());
        eval.evaluate(samples, |slot, value| {
            values.push(Sample::new(eval.timestamps[slot], value));
        });
        if !values.is_empty() {
            series.push(RangeValue {
                labels,
                samples: values,
                exemplars: None,
                time_window: Some(TimeWindow::new(eval.range)),
            });
        }
        series_count += 1;
        tokio::task::consume_budget().await;
    }
    Ok((series, series_count))
}
