// Copyright 2025 OpenObserve Inc.
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
use promql_parser::parser::EvalStmt;
use tokio::sync::{RwLock, Semaphore};

use super::Engine;
use crate::service::promql::{
    DEFAULT_LOOKBACK, TableProvider, micros, micros_since_epoch,
    selector_visitor::MetricSelectorVisitor,
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
        let expr = Arc::new(stmt.expr);
        let is_instant = self.start == self.end;

        // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
        let eval_ctx = EvalContext::new(self.start, self.end, self.interval, trace_id.to_string());
        let mut engine = Engine::new_with_context(trace_id, ctx.clone(), eval_ctx.clone());

        let (value, result_type_exec) = engine.exec(&expr).await?;

        // Convert result format based on query type (instant vs range) only at the end
        let (final_value, final_result_type) = if is_instant {
            // For instant queries, convert Matrix to Vector format
            match value {
                Value::Matrix(matrix) => {
                    // Convert each RangeValue to InstantValue (take first sample)
                    let vector: Vec<InstantValue> = matrix
                        .into_iter()
                        .filter_map(|range_val| {
                            range_val.samples.first().map(|sample| InstantValue {
                                labels: range_val.labels.clone(),
                                sample: *sample,
                            })
                        })
                        .collect();
                    (Value::Vector(vector), Some("vector".to_string()))
                }
                Value::Float(val) => {
                    // Convert scalar to Sample for instant queries
                    (
                        Value::Sample(Sample::new(self.end, val)),
                        Some("scalar".to_string()),
                    )
                }
                Value::None => (Value::None, Some("vector".to_string())),
                other => (other, result_type_exec),
            }
        } else {
            // For range queries, ensure result is in matrix format
            match value {
                Value::Float(scalar_val) => {
                    // Generate samples for each time point
                    let timestamps = eval_ctx.timestamps();
                    let samples: Vec<Sample> = timestamps
                        .into_iter()
                        .map(|ts| Sample::new(ts, scalar_val))
                        .collect();

                    // Create a matrix with a single series containing all time points
                    let range_value = RangeValue {
                        labels: Labels::default(),
                        samples,
                        exemplars: None,
                        time_window: None,
                    };

                    (Value::Matrix(vec![range_value]), Some("matrix".to_string()))
                }
                Value::None => (Value::None, Some("matrix".to_string())),
                other @ Value::Matrix(_) => (other, Some("matrix".to_string())),
                other => (other, result_type_exec),
            }
        };

        let mut sorted_value = final_value;
        sorted_value.sort();
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
        promql_parser::util::walk_expr(&mut visitor, &stmt.expr).unwrap();
        let _selectors = visitor.exprs_to_string();

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
            tasks.push((time, task));
        }

        for (_time, ret) in tasks {
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
        let mut merged_metrics = HashMap::new();
        for value in instant_vectors {
            merged_data
                .entry(signature(&value.labels))
                .or_insert_with(Vec::new)
                .extend(value.exemplars.unwrap_or_default());
            merged_metrics.insert(signature(&value.labels), value.labels);
        }
        let merged_data = merged_data
            .into_iter()
            .map(|(sig, exemplars)| {
                RangeValue::new_with_exemplars(
                    merged_metrics.get(&sig).unwrap().to_owned(),
                    exemplars,
                )
            })
            .collect::<Vec<_>>();

        // sort data
        let mut value = Value::Matrix(merged_data);
        value.sort();
        Ok((value, result_type, *self.scan_stats.read().await))
    }
}
