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

use std::{
    sync::Arc,
    time::{Duration, SystemTime},
};

use config::meta::{promql::value::*, search::ScanStats};
use datafusion::error::{DataFusionError, Result};
use hashbrown::HashMap;
use promql_parser::parser::{EvalStmt, Expr as PromExpr, value::ValueType};
use tokio::sync::{RwLock, Semaphore};

use super::engine::Engine;
use crate::{
    DEFAULT_LOOKBACK, TableProvider,
    ast::{
        result_order::top_level_sort_descending, selector_visitor::MetricSelectorVisitor,
        visitor::walk_expr,
    },
    micros, micros_since_epoch,
};

#[derive(Clone)]
pub struct PromqlContext {
    pub query_ctx: Arc<QueryContext>,
    pub table_provider: Arc<Box<dyn TableProvider>>,
    pub label_selector: Vec<String>,
    /// The time boundaries for the evaluation. If start equals end an instant
    /// is evaluated.
    pub start: i64,
    pub end: i64,
    /// Time between two evaluated instants for the range [start:end].
    pub interval: i64,
    /// Default look back from sample search.
    pub lookback_delta: i64,
    pub scan_stats: Arc<RwLock<ScanStats>>,
}

impl PromqlContext {
    pub fn new<P>(query_ctx: Arc<QueryContext>, provider: P, label_selector: Vec<String>) -> Self
    where
        P: TableProvider,
    {
        let now = micros_since_epoch(SystemTime::now());
        let five_min = micros(DEFAULT_LOOKBACK);
        Self {
            query_ctx,
            table_provider: Arc::new(Box::new(provider)),
            label_selector,
            start: now,
            end: now,
            interval: five_min,
            lookback_delta: five_min,
            scan_stats: Arc::new(RwLock::new(ScanStats::default())),
        }
    }

    pub fn lookback(&self) -> Duration {
        Duration::from_micros(self.lookback_delta as u64)
    }

    #[tracing::instrument(name = "promql:engine:exec", skip_all)]
    pub async fn exec(
        &mut self,
        trace_id: &str,
        stmt: EvalStmt,
    ) -> Result<(Value, Option<String>, ScanStats)> {
        self.start = micros_since_epoch(stmt.start);
        self.end = micros_since_epoch(stmt.end);
        if stmt.interval > Duration::ZERO {
            self.interval = micros(stmt.interval);
        }
        if stmt.lookback_delta > Duration::ZERO {
            self.lookback_delta = micros(stmt.lookback_delta);
        }

        let ctx = Arc::new(self.clone());
        let sort_descending = top_level_sort_descending(&stmt.expr);
        let expr = Arc::new(stmt.expr);
        let is_instant = self.start == self.end;

        // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
        let eval_ctx = EvalContext::new(self.start, self.end, self.interval, trace_id.to_string());
        let mut engine = Engine::new(trace_id, ctx.clone(), eval_ctx.clone());

        let (value, result_type_exec) = engine.exec(&expr).await?;

        // Convert result format based on query type (instant vs range) only at the end
        let (final_value, final_result_type) = if is_instant {
            shape_instant_result(value, &expr, self.end, result_type_exec)
        } else {
            // For range queries, ensure result is in matrix format
            match value {
                Value::Float(scalar_val) => {
                    // Generate samples for each time point
                    // Create a matrix with a single series containing all time points
                    (
                        crate::functions::vector(Value::Float(scalar_val), &eval_ctx)?,
                        Some("matrix".to_string()),
                    )
                }
                Value::None => (Value::None, Some("matrix".to_string())),
                other @ Value::Matrix(_) => (other, Some("matrix".to_string())),
                other => (other, result_type_exec),
            }
        };

        let mut sorted_value = final_value;
        match sort_descending {
            Some(descending) if is_instant => sorted_value.sort_by_value(descending),
            _ => sorted_value.sort(),
        }
        Ok((
            sorted_value,
            final_result_type,
            *self.scan_stats.read().await,
        ))
    }

    /// Query exemplars
    /// need rewrite the query to only have selectors
    /// and no need query lookback
    /// and need merge exemplars to a single array
    #[tracing::instrument(name = "promql:engine:query_exemplars", skip_all)]
    pub async fn query_exemplars(
        &mut self,
        trace_id: &str,
        stmt: EvalStmt,
    ) -> Result<(Value, Option<String>, ScanStats)> {
        let cfg = config::get_config();
        self.start = micros_since_epoch(stmt.start);
        self.end = micros_since_epoch(stmt.end);

        // pick all selectors from stmt
        let mut visitor = MetricSelectorVisitor::default();
        walk_expr(&mut visitor, &stmt.expr).unwrap();

        let ctx = Arc::new(self.clone());

        // always be exemplars result type.
        let result_type = Some("exemplars".to_string());

        let mut instant_vectors = Vec::new();
        let mut tasks = Vec::new();
        let semaphore = std::sync::Arc::new(Semaphore::new(cfg.limit.cpu_num));
        for expr in visitor.exprs {
            let time = self.start;
            let expr = Arc::new(expr);
            let permit = semaphore.clone().acquire_owned().await.unwrap();
            // Use EvalContext::new for instant query (start == end)
            let eval_ctx = EvalContext::new(time, time, 0, trace_id.to_string());
            let mut engine = Engine::new(trace_id, ctx.clone(), eval_ctx);
            let task: tokio::task::JoinHandle<Result<(Value, Option<String>)>> =
                tokio::task::spawn(async move {
                    let ret = engine.exec(&expr).await;
                    drop(permit);
                    ret
                });
            tasks.push(task);
        }

        for ret in tasks {
            let (result, _result_type_exec) = match ret.await {
                Ok(Ok((value, result_type))) => (value, result_type),
                Ok(Err(e)) => {
                    log::error!("Error executing query engine: {e}");
                    return Err(e);
                }
                Err(e) => {
                    log::error!("Error executing query task: {e}");
                    return Err(DataFusionError::Execution(e.to_string()));
                }
            };

            match result {
                Value::Matrix(vs) => instant_vectors.extend(vs),
                _ => continue,
            };
        }

        // empty result quick return
        if instant_vectors.is_empty() {
            return Ok((Value::None, result_type, *self.scan_stats.read().await));
        }

        // merge data
        let mut merged_data = HashMap::new();
        for value in instant_vectors {
            let (labels, exemplars) = merged_data
                .entry(signature(&value.labels))
                .or_insert_with(|| (Labels::default(), Vec::new()));
            *labels = value.labels;
            exemplars.extend(value.exemplars.unwrap_or_default());
        }
        let merged_data = merged_data
            .into_values()
            .map(|(labels, exemplars)| RangeValue::new_with_exemplars(labels, exemplars))
            .collect::<Vec<_>>();

        // sort data
        let mut value = Value::Matrix(merged_data);
        value.sort();
        Ok((value, result_type, *self.scan_stats.read().await))
    }
}

/// The shape an instant query answers with, given what evaluation produced.
fn shape_instant_result(
    value: Value,
    expr: &PromExpr,
    eval_ts: i64,
    result_type_exec: Option<String>,
) -> (Value, Option<String>) {
    // A range-vector-typed expression - a range selector or a subquery - asked for the samples
    // in its window, so the matrix evaluation produced is already the answer. Collapsing it
    // would keep an arbitrary one of those samples and drop the rest.
    if expr.value_type() == ValueType::Matrix {
        return (value, Some("matrix".to_string()));
    }

    match value {
        // Every other expression leaves one sample per series at the evaluation timestamp.
        Value::Matrix(matrix) => {
            let vector: Vec<InstantValue> = matrix
                .into_iter()
                .filter_map(|range_val| {
                    range_val.samples.first().map(|sample| InstantValue {
                        labels: range_val.labels,
                        sample: *sample,
                    })
                })
                .collect();
            (Value::Vector(vector), Some("vector".to_string()))
        }
        Value::Float(val) => (
            Value::Sample(Sample::new(eval_ts, val)),
            Some("scalar".to_string()),
        ),
        Value::None => (Value::None, Some("vector".to_string())),
        other => (other, result_type_exec),
    }
}

#[cfg(test)]
mod tests {
    use promql_parser::parser;

    use super::*;

    fn shaped(query: &str, value: Value) -> (Value, Option<String>) {
        let expr = parser::parse(query).unwrap();
        shape_instant_result(value, &expr, 3000, None)
    }

    fn window_of_two() -> Value {
        Value::Matrix(vec![RangeValue::new(
            Labels::default(),
            vec![Sample::new(1000, 14.0), Sample::new(3000, 45.0)],
        )])
    }

    fn one_sample() -> Value {
        Value::Matrix(vec![RangeValue::new(
            Labels::default(),
            vec![Sample::new(3000, 45.0)],
        )])
    }

    fn samples(value: &Value) -> Vec<(i64, f64)> {
        match value {
            Value::Matrix(matrix) => matrix
                .iter()
                .flat_map(|series| series.samples.iter())
                .map(|sample| (sample.timestamp, sample.value))
                .collect(),
            Value::Vector(vector) => vector
                .iter()
                .map(|instant| (instant.sample.timestamp, instant.sample.value))
                .collect(),
            other => panic!("unexpected result: {other:?}"),
        }
    }

    #[test]
    fn test_instant_range_selector_keeps_the_whole_window() {
        let (value, result_type) = shaped("m[5m]", window_of_two());

        assert_eq!(result_type.as_deref(), Some("matrix"));
        assert_eq!(samples(&value), vec![(1000, 14.0), (3000, 45.0)]);
    }

    #[test]
    fn test_instant_subquery_keeps_the_whole_window() {
        let (value, result_type) = shaped("m[5m:1m]", window_of_two());

        assert_eq!(result_type.as_deref(), Some("matrix"));
        assert_eq!(samples(&value), vec![(1000, 14.0), (3000, 45.0)]);
    }

    #[test]
    fn test_instant_range_selector_with_no_data_is_still_a_matrix() {
        let (value, result_type) = shaped("m[5m]", Value::None);

        assert_eq!(result_type.as_deref(), Some("matrix"));
        assert!(matches!(value, Value::None));
    }

    #[test]
    fn test_instant_selector_still_reads_back_as_a_vector() {
        let (value, result_type) = shaped("m", one_sample());

        assert_eq!(result_type.as_deref(), Some("vector"));
        assert!(matches!(value, Value::Vector(_)));
        assert_eq!(samples(&value), vec![(3000, 45.0)]);
    }

    #[test]
    fn test_a_function_over_a_range_still_reads_back_as_a_vector() {
        // rate() takes a range but returns an instant vector, so its window is a step toward
        // the answer rather than the answer.
        let (value, result_type) = shaped("rate(m[5m])", one_sample());

        assert_eq!(result_type.as_deref(), Some("vector"));
        assert!(matches!(value, Value::Vector(_)));
    }

    #[test]
    fn test_instant_scalar_expression_is_still_a_scalar() {
        let (value, result_type) = shaped("1 + 1", Value::Float(2.0));

        assert_eq!(result_type.as_deref(), Some("scalar"));
        match value {
            Value::Sample(sample) => assert_eq!((sample.timestamp, sample.value), (3000, 2.0)),
            other => panic!("unexpected result: {other:?}"),
        }
    }
}
