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

//! The streaming `eval_range`: the range function over every series, its output kept whole
//! because it is the result.

use std::sync::Arc;

use config::meta::promql::value::{RangeValue, Sample, TimeWindow};
use datafusion::error::Result;

use super::{evaluate_partitions, range_expr::RangeExpr};
use crate::series_stream::SeriesStream;

/// Evaluates the range function over every partition's series and returns them whole, in
/// partition order; dropping the future aborts the partitions.
pub(crate) async fn eval_range<F, S>(
    sources: Vec<F>,
    eval: Arc<RangeExpr>,
) -> Result<(Vec<RangeValue>, usize)>
where
    F: Future<Output = Result<S>> + Send + 'static,
    S: SeriesStream + 'static,
{
    let start_time = std::time::Instant::now();
    let func_name = eval.func.name();
    let trace_id = &eval.eval_ctx.trace_id;
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming {func_name}() started with {} partitions",
        sources.len(),
    );
    let (parts, series_count) = evaluate_partitions(sources, &eval, eval_range_partition).await?;
    let series: Vec<RangeValue> = parts.flatten().collect();
    log::info!(
        "[trace_id: {trace_id}] [PromQL Timing] streaming {func_name}() execution took: {:?}, evaluated {} of {series_count} series",
        start_time.elapsed(),
        series.len(),
    );
    Ok((series, series_count))
}

/// Evaluates one partition's series; like the generic evaluator, a series with no value is
/// dropped.
async fn eval_range_partition<S: SeriesStream>(
    mut source: S,
    eval: Arc<RangeExpr>,
) -> Result<(Vec<RangeValue>, usize)> {
    let mut series = Vec::new();
    let mut series_count = 0;
    let mut samples = Vec::new();
    while source.advance().await?.is_some() {
        let labels = source.labels();
        source.consume(&mut samples).await?;
        let values: Vec<Sample> = eval
            .values(&samples)
            .map(|(slot, value)| Sample::new(eval.timestamps[slot], value))
            .collect();
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
