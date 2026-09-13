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

//! Consumers of a `SeriesStream`: the fused aggregate folds each series into per-group
//! accumulators as it arrives, `eval_range` keeps every series' range-function output whole.

mod aggregate;
mod eval_range;
mod range_expr;

use std::sync::Arc;

pub(crate) use aggregate::aggregate;
use datafusion::error::{DataFusionError, Result};
pub(crate) use eval_range::eval_range;
pub(crate) use range_expr::RangeExpr;
use tokio::task::JoinSet;

use crate::series_stream::SeriesStream;

/// Opens and evaluates sources inside their tasks, preserving partition order for the final fold.
async fn evaluate_partitions<SourceFuture, Stream, Output, EvalFuture>(
    sources: Vec<SourceFuture>,
    eval: &Arc<RangeExpr>,
    evaluate: impl Fn(Stream, Arc<RangeExpr>) -> EvalFuture + Copy + Send + 'static,
) -> Result<(impl ExactSizeIterator<Item = Output>, usize)>
where
    SourceFuture: Future<Output = Result<Stream>> + Send + 'static,
    Stream: SeriesStream + 'static,
    Output: Send + 'static,
    EvalFuture: Future<Output = Result<(Output, usize)>> + Send + 'static,
{
    let parts = sources.into_iter().map(|source| {
        let eval = Arc::clone(eval);
        async move {
            let source = source.await?;
            evaluate(source, eval).await
        }
    });
    let parts = collect_partitioned(parts).await?;
    let series_count = parts.iter().map(|(_, series)| series).sum();
    Ok((parts.into_iter().map(|(part, _)| part), series_count))
}

/// Collects every partition in order; the first failure fails the whole, and dropping the set
/// aborts the rest.
pub(super) async fn collect_partitioned<T, Fut>(
    parts: impl IntoIterator<Item = Fut>,
) -> Result<Vec<T>>
where
    T: Send + 'static,
    Fut: Future<Output = Result<T>> + Send + 'static,
{
    let parts = parts.into_iter();
    let mut results: Vec<Option<T>> = Vec::with_capacity(parts.size_hint().0);
    let mut tasks = JoinSet::new();
    for (index, part) in parts.enumerate() {
        results.push(None);
        tasks.spawn(async move { (index, part.await) });
    }
    // sources finish in any order; the merge needs them in source order
    while let Some(joined) = tasks.join_next().await {
        let (index, part) = joined.map_err(|e| DataFusionError::Execution(e.to_string()))?;
        results[index] = Some(part?);
    }
    Ok(results
        .into_iter()
        .map(|part| part.expect("every source joined"))
        .collect())
}

#[cfg(test)]
pub(crate) mod tests {
    use std::{future::ready, sync::Arc};

    use config::meta::promql::value::{EvalContext, Value};
    use promql_parser::parser::LabelModifier;

    use super::*;

    pub(crate) type CanonicalSeries = (Vec<(String, String)>, Vec<(i64, u64)>);

    pub(crate) const SECOND: i64 = 1_000_000;
    pub(crate) const BASE: i64 = 1_000 * SECOND;

    pub(crate) fn eval_ctx() -> EvalContext {
        EvalContext::new(
            BASE + 60 * SECOND,
            BASE + 180 * SECOND,
            60 * SECOND,
            "test".into(),
        )
    }

    pub(crate) fn canonical_matrix(value: Value) -> Vec<CanonicalSeries> {
        let matrix = match value {
            Value::Matrix(matrix) => matrix,
            Value::None => return vec![],
            value => panic!("expected matrix or none, got {}", value.get_type()),
        };
        let mut canonical = matrix
            .into_iter()
            .map(|series| {
                let mut labels = series
                    .labels
                    .iter()
                    .map(|label| (label.name.clone(), label.value.clone()))
                    .collect::<Vec<_>>();
                labels.sort();
                let samples = series
                    .samples
                    .iter()
                    .map(|sample| (sample.timestamp, sample.value.to_bits()))
                    .collect::<Vec<_>>();
                (labels, samples)
            })
            .collect::<Vec<_>>();
        canonical.sort_by(|a, b| a.0.cmp(&b.0));
        canonical
    }

    pub(crate) fn by(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    pub(crate) fn without(labels: &[&str]) -> Option<LabelModifier> {
        Some(LabelModifier::Exclude(promql_parser::label::Labels {
            labels: labels.iter().map(|label| label.to_string()).collect(),
        }))
    }

    /// Labels and timestamps must match exactly; values may drift in the last bits (fold order
    /// differs).
    pub(crate) fn assert_matrix_close(
        expected: Vec<CanonicalSeries>,
        actual: Vec<CanonicalSeries>,
        context: &str,
    ) {
        assert_eq!(expected.len(), actual.len(), "{context}: series count");
        for (expected, actual) in expected.iter().zip(&actual) {
            assert_eq!(expected.0, actual.0, "{context}: labels");
            assert_eq!(expected.1.len(), actual.1.len(), "{context}: sample count");
            for (&(expected_ts, expected_bits), &(actual_ts, actual_bits)) in
                expected.1.iter().zip(&actual.1)
            {
                assert_eq!(expected_ts, actual_ts, "{context}: timestamps");
                if expected_bits == actual_bits {
                    continue;
                }
                let expected_value = f64::from_bits(expected_bits);
                let actual_value = f64::from_bits(actual_bits);
                assert!(
                    expected_value.is_finite() && actual_value.is_finite(),
                    "{context}: non-finite values must match exactly"
                );
                let tolerance = expected_value.abs().max(actual_value.abs()) * 1e-12;
                assert!(
                    (expected_value - actual_value).abs() <= tolerance,
                    "{context}: {expected_value} vs {actual_value}"
                );
            }
        }
    }

    #[tokio::test]
    async fn test_evaluate_partitions_order_counts_and_source_errors() {
        use config::meta::promql::value::{RangeValue, Sample};

        use crate::series_stream::matrix::{
            MaterializedSource, MatrixSeriesStream, matrix_streams,
        };

        let eval = Arc::new(RangeExpr::new(
            crate::functions::instant_lookback_func(),
            std::time::Duration::from_secs(60),
            &eval_ctx(),
        ));
        let notify = Arc::new(tokio::sync::Notify::new());
        let sources = (0..3)
            .map(|index| {
                let notify = Arc::clone(&notify);
                async move {
                    if index == 0 {
                        notify.notified().await;
                    } else if index == 1 {
                        notify.notify_one();
                    }
                    let series = RangeValue::new(vec![], [Sample::new(0, index as f64)]);
                    Ok(matrix_streams(vec![series; index + 1], &None, 1)
                        .pop()
                        .unwrap())
                }
            })
            .collect();
        let (parts, count) = evaluate_partitions(sources, &eval, |mut stream, _| async move {
            let mut value = 0;
            let mut count = 0;
            while stream.advance().await?.is_some() {
                value = stream.consume().await?[0].value as usize;
                count += 1;
            }
            Ok((value, count))
        })
        .await
        .unwrap();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts.collect::<Vec<_>>(), vec![0, 1, 2]);
        assert_eq!(count, 6);

        let empty: Vec<MaterializedSource> = vec![];
        let (parts, count) = evaluate_partitions(empty, &eval, |_, _| ready(Ok(((), 1))))
            .await
            .unwrap();
        assert_eq!(parts.len(), 0);
        assert_eq!(parts.count(), 0);
        assert_eq!(count, 0);

        let sources = vec![ready(Err::<MatrixSeriesStream, _>(
            DataFusionError::Execution("open failed".into()),
        ))];
        let result = evaluate_partitions(
            sources,
            &eval,
            |_, _| -> std::future::Ready<Result<((), usize)>> {
                panic!("failed source must not be evaluated");
            },
        )
        .await;
        assert!(
            matches!(result, Err(DataFusionError::Execution(message)) if message == "open failed")
        );
    }

    #[tokio::test]
    async fn test_collect_partitioned_preserves_source_order() {
        let release_first = Arc::new(tokio::sync::Notify::new());
        let parts = (0..3).map(|index| {
            let release_first = release_first.clone();
            async move {
                if index == 0 {
                    release_first.notified().await;
                } else if index == 1 {
                    release_first.notify_one();
                }
                Ok(index)
            }
        });
        assert_eq!(collect_partitioned(parts).await.unwrap(), vec![0, 1, 2]);
    }

    #[tokio::test]
    async fn test_collect_partitioned_empty_and_error() {
        let empty = std::iter::empty::<std::future::Ready<Result<usize>>>();
        assert!(collect_partitioned(empty).await.unwrap().is_empty());
        let parts = std::iter::once(ready(Err::<usize, _>(DataFusionError::Execution(
            "partition error".into(),
        ))));
        assert!(
            matches!(collect_partitioned(parts).await, Err(DataFusionError::Execution(message)) if message == "partition error")
        );
    }
}
