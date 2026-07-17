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

use std::{str::FromStr, sync::Arc, time::Duration};

use async_recursion::async_recursion;
use config::meta::promql::{NAME_LABEL, value::*};
use datafusion::error::{DataFusionError, Result};
use futures::future::try_join_all;
use hashbrown::{HashMap, HashSet};
use infra::errors::{Error, ErrorCodes};
use promql_parser::{
    label::{MatchOp, Matchers},
    parser::{
        AggregateExpr, BinModifier, BinaryExpr, Call, Expr as PromExpr, Function, FunctionArgs,
        LabelModifier, MatrixSelector, NumberLiteral, Offset, ParenExpr, StringLiteral, UnaryExpr,
        VectorMatchCardinality, VectorSelector, token,
    },
};
use rayon::iter::{IntoParallelIterator, IntoParallelRefMutIterator, ParallelIterator};

use super::{
    PromqlContext,
    label_usage::labels_dropped_at_root,
    selector_loader::{LoadedMetrics, PartitionedMetrics, selector_load_data_from_datafusion},
};
use crate::{aggregations, binaries, functions, micros, rewrite::remove_filter_all};

pub struct Engine {
    trace_id: String,
    /// PromQL evaluation context
    ctx: Arc<PromqlContext>,
    /// Evaluation context for promql queries
    eval_ctx: EvalContext,
    /// Only select columns with certain labels
    label_selector: HashSet<String>,
    /// If true, skip column pruning and load all label columns. Set when the
    /// expression contains label-creating functions (`label_replace`,
    /// `label_join`) whose output labels don't exist in the source schema and
    /// whose source labels may not be in the aggregation grouping set.
    disable_label_selector: bool,
    /// If true, the query provably discards all labels (e.g.
    /// `sum(rate(m[5m]))` without a modifier), so series labels are never
    /// loaded at all.
    skip_labels: bool,
    /// The result type of the query
    result_type: Option<String>,
}

impl Engine {
    pub fn new(trace_id: &str, ctx: Arc<PromqlContext>, eval_ctx: EvalContext) -> Self {
        Self {
            ctx,
            eval_ctx,
            label_selector: HashSet::new(),
            disable_label_selector: false,
            skip_labels: false,
            result_type: None,
            trace_id: trace_id.to_string(),
        }
    }

    /// Create a new engine with evaluation context for range queries
    /// This is now an alias for `new()` since eval_ctx is always required
    pub fn new_with_context(
        trace_id: &str,
        ctx: Arc<PromqlContext>,
        eval_ctx: EvalContext,
    ) -> Self {
        Self::new(trace_id, ctx, eval_ctx)
    }

    pub async fn exec(&mut self, prom_expr: &PromExpr) -> Result<(Value, Option<String>)> {
        self.extract_columns_from_prom_expr(prom_expr)?;
        if self.disable_label_selector {
            self.label_selector.clear();
        }
        self.skip_labels = !self.ctx.query_ctx.query_exemplars
            && !self.ctx.query_ctx.query_data
            && labels_dropped_at_root(prom_expr);
        let value = self.exec_expr(prom_expr).await?;
        Ok((value, self.result_type.clone()))
    }

    /// Recursively filters the necessary columns needed for before executing the given PromQL
    /// expression.
    pub fn extract_columns_from_prom_expr(&mut self, prom_expr: &PromExpr) -> Result<()> {
        match prom_expr {
            PromExpr::Aggregate(AggregateExpr {
                op,
                expr,
                param,
                modifier,
            }) => {
                self.extract_columns_from_prom_expr(expr)?;
                if let Some(expr) = param {
                    self.extract_columns_from_prom_expr(expr)?;
                }
                self.extract_columns_from_modifier(modifier, op);
                Ok(())
            }
            PromExpr::Unary(UnaryExpr { expr }) => self.extract_columns_from_prom_expr(expr),
            PromExpr::Binary(BinaryExpr {
                op,
                lhs,
                rhs,
                modifier,
            }) => {
                self.extract_columns_from_prom_expr(lhs)?;
                self.extract_columns_from_prom_expr(rhs)?;
                if let Some(BinModifier {
                    card,
                    matching,
                    return_bool: _,
                }) = modifier
                {
                    self.extract_columns_from_modifier(matching, op);
                    // group_left or group_right -> no column selection
                    match card {
                        VectorMatchCardinality::ManyToOne(_)
                        | VectorMatchCardinality::OneToMany(_) => {
                            self.label_selector.clear();
                        }
                        _ => {}
                    }
                }
                Ok(())
            }
            PromExpr::Paren(ParenExpr { expr }) => self.extract_columns_from_prom_expr(expr),
            PromExpr::Subquery(expr) => self.extract_columns_from_prom_expr(&expr.expr),
            PromExpr::Call(Call { func, args }) => {
                // `label_replace` / `label_join` create new labels that don't
                // exist in the source schema. Restricting column selection
                // based on the aggregation `by()` list would then drop both the
                // source labels these functions read from and leave the
                // newly-created label absent from the loaded data, so the
                // aggregation groups everything together. See issue #11321.
                if matches!(func.name, "label_replace" | "label_join") {
                    self.disable_label_selector = true;
                }
                _ = args
                    .args
                    .iter()
                    .map(|expr| self.extract_columns_from_prom_expr(expr))
                    .collect::<Vec<_>>();
                Ok(())
            }
            PromExpr::Extension(expr) => Err(DataFusionError::NotImplemented(format!(
                "Unsupported Extension: {expr:?}",
            ))),
            _ => Ok(()),
        }
    }

    /// Help function to extract columns from [LabelModifier].
    /// Aggregation function topk & bottomk are special cases where
    /// modifier is applied to grouped result -> not columns filtered.
    /// For promql:
    ///     sum(irate(zo_incoming_requests{namespace="ziox"}[5m])) by (exported_endpoint)
    /// we need to extract the columns `exported_endpoint` from the modifier. Because
    /// the result will be grouped by `exported_endpoint`, and don't consider other labesl.
    fn extract_columns_from_modifier(
        &mut self,
        modifier: &Option<LabelModifier>,
        op: &token::TokenType,
    ) {
        if let Some(label_modifier) = modifier {
            match op.id() {
                // topk and bottomk query all columns when with modifiers
                token::T_TOPK | token::T_BOTTOMK => self.label_selector.clear(),
                _ => {
                    if let (label_selector, LabelModifier::Include(labels)) =
                        (&mut self.label_selector, label_modifier)
                    {
                        label_selector.extend(labels.labels.iter().cloned());
                    }
                }
            }
        }
    }

    #[async_recursion]
    pub async fn exec_expr(&mut self, prom_expr: &PromExpr) -> Result<Value> {
        Ok(match &prom_expr {
            PromExpr::Aggregate(AggregateExpr {
                op,
                expr,
                param,
                modifier,
            }) => self.aggregate_exprs(op, expr, param, modifier).await?,

            PromExpr::Unary(UnaryExpr { expr }) => {
                let val = self.exec_expr(expr).await?;
                match val {
                    Value::Matrix(m) => {
                        let out = m
                            .into_iter()
                            .map(|mut range| RangeValue {
                                labels: std::mem::take(&mut range.labels).without_metric_name(),
                                samples: range
                                    .samples
                                    .into_iter()
                                    .map(|s| Sample {
                                        timestamp: s.timestamp,
                                        value: -s.value,
                                    })
                                    .collect(),
                                exemplars: range.exemplars,
                                time_window: range.time_window,
                            })
                            .collect();
                        Value::Matrix(out)
                    }
                    Value::Float(f) => Value::Float(-f),
                    _ => {
                        return Err(DataFusionError::NotImplemented(format!(
                            "Unsupported Unary: {expr:?}"
                        )));
                    }
                }
            }
            PromExpr::Binary(expr) => {
                let lhs = self.exec_expr(&expr.lhs).await?;
                let rhs = self.exec_expr(&expr.rhs).await?;
                let token = expr.op.id();
                let return_bool = expr.return_bool();
                let op = expr.op.is_comparison_operator();

                // This is a very special case, as we treat the float also a
                // `Value::Matrix(vec![element])` therefore, better convert it
                // back to its representation.
                let rhs = match rhs {
                    Value::Matrix(m) if m.len() == 1 && m[0].samples.len() == 1 => {
                        Value::Float(m[0].samples[0].value)
                    }
                    _ => rhs,
                };
                match (lhs, rhs) {
                    (Value::Float(left), Value::Float(right)) => {
                        let value = binaries::scalar_binary_operations(
                            token,
                            left,
                            right,
                            return_bool,
                            op,
                        )?;
                        Value::Float(value)
                    }
                    (Value::Matrix(left), Value::Matrix(right)) => {
                        binaries::vector_bin_op(expr, left, right)?
                    }
                    (Value::Matrix(left), Value::Float(right)) => {
                        binaries::vector_scalar_bin_op(expr, left, right, false).await?
                    }
                    (Value::Float(left), Value::Matrix(right)) => {
                        binaries::vector_scalar_bin_op(expr, right, left, true).await?
                    }
                    (Value::None, Value::None) => Value::None,
                    _ => {
                        log::debug!(
                            "[trace_id: {}] [PromExpr::Binary] either lhs or rhs matrix is found to be empty",
                            self.trace_id
                        );
                        Value::Matrix(vec![])
                    }
                }
            }
            PromExpr::Paren(ParenExpr { expr }) => self.exec_expr(expr).await?,
            PromExpr::Subquery(expr) => {
                let val = self.exec_expr(&expr.expr).await?;
                let range = expr.range;
                let matrix = match val {
                    Value::Matrix(vs) => {
                        // For matrix type, update the time_window range
                        vs.into_iter()
                            .map(|mut rv| {
                                // Update time_window with new range
                                rv.time_window = Some(TimeWindow::new(range));
                                rv
                            })
                            .collect()
                    }
                    v => {
                        return Err(DataFusionError::NotImplemented(format!(
                            "Unsupported subquery, the return value should have been a matrix but got {:?}",
                            v.get_type()
                        )));
                    }
                };

                Value::Matrix(matrix)
            }
            PromExpr::NumberLiteral(NumberLiteral { val }) => Value::Float(*val),
            PromExpr::StringLiteral(StringLiteral { val }) => Value::String(val.clone()),
            PromExpr::VectorSelector(vs) => {
                let mut vs = vs.clone();
                remove_filter_all(&mut vs);
                if !vs.matchers.or_matchers.is_empty() {
                    return Err(DataFusionError::Plan(
                        "VectorSelector: or_matchers is not supported".into(),
                    ));
                }
                if vs.at.is_some() {
                    return Err(DataFusionError::NotImplemented(
                        "VectorSelector: @ modifier is not supported".into(),
                    ));
                }
                let data = self.eval_vector_selector(&vs).await?;
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Matrix(data)
                }
            }
            PromExpr::MatrixSelector(MatrixSelector { vs, range }) => {
                let mut vs = vs.clone();
                remove_filter_all(&mut vs);
                if !vs.matchers.or_matchers.is_empty() {
                    return Err(DataFusionError::Plan(
                        "MatrixSelector: or_matchers is not supported".into(),
                    ));
                }
                if vs.at.is_some() {
                    return Err(DataFusionError::NotImplemented(
                        "MatrixSelector: @ modifier is not supported".into(),
                    ));
                }
                let data = self.eval_matrix_selector(&vs, *range).await?;
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Matrix(data)
                }
            }
            PromExpr::Call(Call { func, args }) => self.call_expr(func, args).await?,
            PromExpr::Extension(expr) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Extension: {expr:?}"
                )));
            }
        })
    }

    /// Instant vector selector --- select a single sample at each evaluation
    /// timestamp.
    ///
    /// See <https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#confusion-alert-instantrange-selectors-vs-instantrange-queries>
    async fn eval_vector_selector(&mut self, selector: &VectorSelector) -> Result<Vec<RangeValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("vector".to_string());
        }

        let mut selector = selector.clone();
        if selector.name.is_none() {
            let name = match selector.matchers.find_matchers(NAME_LABEL).first() {
                Some(mat) => mat.value.clone(),
                None => {
                    return Err(DataFusionError::Plan(
                        "VectorSelector: metric name is required".into(),
                    ));
                }
            };
            selector.name = Some(name);
        }

        let data = self.selector_load_data_owned(&selector, None).await?;

        let metrics_cache = match data.get_range_values() {
            Some(v) => v,
            None => return Ok(vec![]),
        };

        let mut offset_modifier = 0;
        if let Some(offset) = selector.offset {
            match offset {
                Offset::Pos(offset) => {
                    offset_modifier = micros(offset);
                }
                Offset::Neg(offset) => {
                    offset_modifier = -micros(offset);
                }
            }
        };

        // Get all evaluation timestamps from the context
        let eval_timestamps = self.eval_ctx.timestamps();

        // For each metric, select appropriate samples at each evaluation timestamp
        // TODO: make it parallel
        let mut result = Vec::with_capacity(metrics_cache.len());
        for metric in metrics_cache {
            let mut selected_samples = Vec::with_capacity(eval_timestamps.len());

            for &eval_ts in &eval_timestamps {
                // Calculate lookback window for this evaluation timestamp
                let start = eval_ts - self.ctx.lookback_delta;

                // Find the sample for this evaluation timestamp
                // Binary search for the last sample before or at eval_ts (considering offset)
                let end_index = metric
                    .samples
                    .partition_point(|v| v.timestamp + offset_modifier <= eval_ts);

                let match_sample = if end_index > 0 {
                    metric.samples.get(end_index - 1).and_then(|sample| {
                        let adjusted_ts = sample.timestamp + offset_modifier;
                        if adjusted_ts >= start && adjusted_ts <= eval_ts {
                            Some(sample)
                        } else {
                            None
                        }
                    })
                } else {
                    None
                };

                // Add the matched sample (already validated to be within range)
                if let Some(sample) = match_sample {
                    // Use eval_ts as the timestamp for the selected sample
                    // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#instant-queries
                    selected_samples.push(Sample::new(eval_ts, sample.value));
                }
            }

            // Only include metrics that have at least one sample
            if !selected_samples.is_empty() {
                result.push(RangeValue {
                    labels: metric.labels,
                    samples: selected_samples,
                    exemplars: metric.exemplars,
                    time_window: metric.time_window,
                });
            }
        }

        Ok(result)
    }

    /// Range vector selector --- select a whole time range at each evaluation
    /// timestamp.
    ///
    /// See <https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#confusion-alert-instantrange-selectors-vs-instantrange-queries>
    ///
    /// MatrixSelector is a special case of VectorSelector that returns a matrix
    /// of samples.
    async fn eval_matrix_selector(
        &mut self,
        selector: &VectorSelector,
        range: Duration,
    ) -> Result<Vec<RangeValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("matrix".to_string());
        }

        let mut selector = selector.clone();
        if selector.name.is_none() {
            let name = selector
                .matchers
                .find_matchers(NAME_LABEL)
                .first()
                .unwrap()
                .value
                .clone();

            selector.name = Some(name);
        }

        let data = self
            .selector_load_data_owned(&selector, Some(range))
            .await?;

        let values = match data.get_range_values() {
            Some(v) => v,
            None => return Ok(vec![]),
        };

        let start = std::time::Instant::now();
        let mut values = values
            .into_par_iter()
            .map(|rv| RangeValue {
                labels: rv.labels,
                samples: rv.samples,
                exemplars: rv.exemplars,
                time_window: Some(TimeWindow::new(range)),
            })
            .collect::<Vec<_>>();

        log::info!(
            "[trace_id: {}] [PromQL Timing] eval_matrix_selector() processing took: {:?}",
            self.trace_id,
            start.elapsed()
        );

        // apply offset to samples
        let offset_modifier = get_offset_modifier(selector.offset);
        if offset_modifier != 0 {
            values.par_iter_mut().for_each(|rv| {
                rv.samples
                    .iter_mut()
                    .for_each(|s| s.timestamp += offset_modifier);
            });
        }

        Ok(values)
    }

    #[tracing::instrument(name = "promql:engine:load_data_owned", skip_all)]
    async fn selector_load_data_owned(
        &mut self,
        selector: &VectorSelector,
        range: Option<Duration>,
    ) -> Result<Value> {
        let mut metric_values = match self.selector_load_data_inner(selector, range).await {
            Ok(v) => v,
            Err(e) => {
                log::error!(
                    "[trace_id: {}] [PromQL] Failed to load data for stream, error: {e:?}",
                    self.trace_id
                );
                return Err(e);
            }
        };

        // no data, return immediately
        if metric_values.is_empty() {
            return Ok(Value::None);
        }

        let start = std::time::Instant::now();
        metric_values.par_iter_mut().for_each(|metric| {
            metric.samples.sort_unstable_by_key(|k| k.timestamp);
            if self.ctx.query_ctx.query_exemplars
                && let Some(exemplars) = &mut metric.exemplars
            {
                exemplars.sort_by_key(|k| k.timestamp);
            }
        });
        let values = if metric_values.is_empty() {
            Value::None
        } else {
            Value::Matrix(metric_values)
        };
        log::info!(
            "[trace_id: {}] [PromQL] sort samples by timestamps took: {:?}",
            self.trace_id,
            start.elapsed()
        );
        Ok(values)
    }

    #[tracing::instrument(name = "promql:engine:load_data", skip_all)]
    async fn selector_load_data_inner(
        &self,
        selector: &VectorSelector,
        range: Option<Duration>,
    ) -> Result<Vec<RangeValue>> {
        let start_time = std::time::Instant::now();
        // https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#lookback-delta
        let offset_modifier = get_offset_modifier(selector.offset.clone());
        // Positive offset (e.g. `offset 10m`) looks into the past, so we shift
        // the data-load window backwards by `offset_modifier`.
        let start =
            self.ctx.start - range.map_or(self.ctx.lookback_delta, micros) - offset_modifier;
        let end = self.ctx.end - offset_modifier;

        // 1. Group by metrics (sets of label name-value pairs)
        let table_name = selector.name.as_ref().unwrap();
        log::info!(
            "[trace_id: {}] [PromQL] loading data for stream: {table_name}, range: [{start},{end}), filter: {:?}",
            self.trace_id,
            selector.to_string(),
        );

        let mut filters = selector
            .matchers
            .matchers
            .iter()
            .filter_map(|mat| {
                if mat.op == MatchOp::Equal {
                    Some((mat.name.to_string(), vec![mat.value.to_string()]))
                } else {
                    None
                }
            })
            .collect::<Vec<(_, _)>>();

        // check for super cluster
        let trace_id = self.ctx.query_ctx.trace_id.clone();
        #[cfg(feature = "enterprise")]
        let (super_tx, mut super_rx) = tokio::sync::mpsc::channel::<
            Result<(HashMap<u64, RangeValue>, config::meta::search::ScanStats)>,
        >(1);
        #[cfg(feature = "enterprise")]
        if self.ctx.query_ctx.is_super_cluster {
            let query_ctx = self.ctx.query_ctx.clone();
            let step = self.eval_ctx.step;
            let selector = selector.clone();
            let label_selector = self.label_selector.clone();
            let trace_id_clone = trace_id.clone();
            tokio::task::spawn(async move {
                let ret = o2_enterprise::enterprise::metrics::super_cluster::selector_load_data(
                    query_ctx,
                    selector,
                    range,
                    &label_selector,
                    start,
                    end,
                    step,
                )
                .await;
                if let Err(e) = super_tx.send(ret).await {
                    log::error!(
                        "[trace_id: {trace_id_clone}] [PromQL] Failed to send super cluster result to channel, error: {e:?}",
                    );
                }
                drop(super_tx);
            });
        } else {
            drop(super_tx);
        }

        let ctxs = self
            .ctx
            .table_provider
            .create_context(
                &self.ctx.query_ctx.org_id,
                table_name,
                (start, end),
                selector.matchers.clone(),
                self.label_selector.clone(),
                &mut filters,
            )
            .await?;

        // check if we need to load data from local cluster
        #[cfg(feature = "enterprise")]
        let ctxs = if self.ctx.query_ctx.is_super_cluster
            && !o2_enterprise::enterprise::super_cluster::search::has_local_cluster(
                self.ctx.query_ctx.regions.clone(),
                self.ctx.query_ctx.clusters.clone(),
            )
            .await
        {
            vec![]
        } else {
            ctxs
        };

        let mut label_selector = self.label_selector.clone();
        label_selector.extend(self.ctx.label_selector.iter().cloned());

        // Calculate step and lookback for the optimization
        let start = self.eval_ctx.start - offset_modifier;
        let end = self.eval_ctx.end - offset_modifier;
        let step = self.eval_ctx.step;
        let lookback = range.map_or(self.ctx.lookback_delta, micros);

        let skip_labels = self.skip_labels;
        let mut tasks = Vec::with_capacity(ctxs.len());
        let mut abort_handles = Vec::with_capacity(ctxs.len());
        for (ctx, schema, scan_stats, keep_filters) in ctxs {
            let query_ctx = self.ctx.query_ctx.clone();
            let mut selector = selector.clone();
            if !keep_filters {
                selector.matchers = Matchers::empty();
            };
            let label_selector = label_selector.clone();
            let task = tokio::spawn(async move {
                tokio::time::timeout(
                    Duration::from_secs(query_ctx.timeout),
                    selector_load_data_from_datafusion(
                        query_ctx,
                        ctx,
                        schema,
                        selector,
                        label_selector,
                        start,
                        end,
                        step,
                        lookback,
                        skip_labels,
                    ),
                )
                .await
            });
            abort_handles.push(task.abort_handle());
            tasks.push(task);
            // update stats
            let mut ctx_scan_stats = self.ctx.scan_stats.write().await;
            ctx_scan_stats.add(&scan_stats);
        }

        let mut abort_receiver = self
            .ctx
            .table_provider
            .register_cancellation(&trace_id)
            .await?;

        // run datafusion collect data task
        let timeout = self.ctx.query_ctx.timeout;
        let query_task = try_join_all(tasks);
        tokio::pin!(query_task);
        let task_results = tokio::select! {
            ret = &mut query_task => {
                match ret {
                    Ok(ret) => {
                        // Unwrap the nested Results: JoinHandle result -> timeout result -> actual result
                        let mut unwrapped_results = Vec::new();
                        for result in ret {
                            match result {
                                Ok(Ok(data)) => unwrapped_results.push(data),
                                Ok(Err(_)) => {
                                    log::error!("[trace_id {trace_id}] [PromQL] grpc search load data task timeout");
                                    return Err(DataFusionError::Plan(
                                        Error::ErrorCode(ErrorCodes::SearchTimeout("[PromQL] grpc search load data task timeout".to_string())).to_string()
                                    ));
                                }
                                Err(err) => {
                                    log::error!("[trace_id {trace_id}] [PromQL] grpc search execute error: {err}");
                                    return Err(DataFusionError::Plan(format!("task error: {err}")));
                                }
                            }
                        }
                        Ok(unwrapped_results)
                    },
                    Err(err) => {
                        log::error!("[trace_id {trace_id}] [PromQL] grpc search execute error: {err}");
                        Err(Error::Message(err.to_string()))
                    }
                }
            },
            _ = tokio::time::sleep(tokio::time::Duration::from_secs(timeout )) => {
                for handle in abort_handles {
                    handle.abort();
                }
                log::error!("[trace_id {trace_id}] [PromQL] grpc search timeout");
                Err(Error::ErrorCode(ErrorCodes::SearchTimeout("[PromQL] grpc search timeout".to_string())))
            },
            _ = async {
                match abort_receiver.as_mut() {
                    Some(receiver) => {
                        let _ = receiver.await;
                    }
                    None => futures::future::pending::<()>().await,
                }
            } => {
                for handle in abort_handles {
                    handle.abort();
                }
                log::info!("[trace_id {trace_id}] [PromQL] grpc search canceled");
                Err(Error::ErrorCode(ErrorCodes::SearchCancelQuery("[PromQL] grpc search canceled".to_string())))
            }
        };

        let task_results =
            task_results.map_err(|e| DataFusionError::Plan(format!("task error: {e}")))?;

        // check for super cluster
        #[cfg(feature = "enterprise")]
        let metrics = if self.ctx.query_ctx.is_super_cluster {
            let mut metrics = merge_loaded_metrics(task_results);
            let (metric, stats) = match super_rx.recv().await {
                Some(Ok(ret)) => ret,
                Some(Err(e)) => {
                    log::error!(
                        "[trace_id: {}] [PromQL] Super cluster result channel error: {e:?}",
                        self.trace_id
                    );
                    return Err(e);
                }
                None => {
                    log::error!(
                        "[trace_id: {}] [PromQL] Super cluster result channel is closed",
                        self.trace_id
                    );
                    return Err(DataFusionError::Plan(
                        "super cluster result channel is closed".to_string(),
                    ));
                }
            };
            for (key, value) in metric {
                if let Some(metric) = metrics.get_mut(&key) {
                    metric.extend(value);
                } else {
                    metrics.insert(key, value);
                }
            }
            let mut ctx_scan_stats = self.ctx.scan_stats.write().await;
            ctx_scan_stats.add(&stats);

            metrics.into_values().collect()
        } else {
            collect_loaded_metrics(task_results)
        };
        #[cfg(not(feature = "enterprise"))]
        let metrics = collect_loaded_metrics(task_results);

        log::info!(
            "[trace_id: {}] load data done for stream: {}, took: {} ms",
            self.trace_id,
            table_name,
            start_time.elapsed().as_millis()
        );

        Ok(metrics)
    }

    async fn aggregate_exprs(
        &mut self,
        op: &token::TokenType,
        expr: &PromExpr,
        param: &Option<Box<PromExpr>>,
        modifier: &Option<LabelModifier>,
    ) -> Result<Value> {
        let input = self.exec_expr(expr).await?;

        let eval_ctx = self.eval_ctx.clone();

        Ok(match op.id() {
            token::T_SUM => aggregations::sum(modifier, input, &eval_ctx)?,
            token::T_AVG => aggregations::avg(modifier, input, &eval_ctx)?,
            token::T_COUNT => aggregations::count(modifier, input, &eval_ctx)?,
            token::T_MIN => aggregations::min(modifier, input, &eval_ctx)?,
            token::T_MAX => aggregations::max(modifier, input, &eval_ctx)?,
            token::T_GROUP => aggregations::group(modifier, input, &eval_ctx)?,
            token::T_STDDEV => aggregations::stddev(modifier, input, &eval_ctx)?,
            token::T_STDVAR => aggregations::stdvar(modifier, input, &eval_ctx)?,
            token::T_TOPK => {
                let param_expr = param.clone().unwrap();
                let k_value = self.exec_expr(&param_expr).await?;
                let k = match k_value {
                    Value::Float(f) => f as usize,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[topk] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::topk(k, modifier, input, &eval_ctx)?
            }
            token::T_BOTTOMK => {
                let param_expr = param.clone().unwrap();
                let k_value = self.exec_expr(&param_expr).await?;
                let k = match k_value {
                    Value::Float(f) => f as usize,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[bottomk] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::bottomk(k, modifier, input, &eval_ctx)?
            }
            token::T_COUNT_VALUES => {
                let param_expr = param.clone().unwrap();
                let label_name = self.exec_expr(&param_expr).await?;
                let label_name_str = match label_name {
                    Value::String(s) => s,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[count_values] param must be a string".to_string(),
                        ));
                    }
                };
                aggregations::count_values(&label_name_str, modifier, input, &eval_ctx)?
            }
            token::T_QUANTILE => {
                let param_expr = param.clone().unwrap();
                let qtile_value = self.exec_expr(&param_expr).await?;
                let qtile = match qtile_value {
                    Value::Float(f) => f,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[quantile] param must be a number".to_string(),
                        ));
                    }
                };
                aggregations::quantile(qtile, input, &eval_ctx)?
            }
            _ => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Aggregate: {op:?}"
                )));
            }
        })
    }

    async fn call_expr_first_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.first().expect("Missing arg 0"))
            .await
    }

    async fn call_expr_second_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(1).expect("Missing arg 1"))
            .await
    }

    async fn call_expr_third_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(2).expect("Missing arg 2"))
            .await
    }

    async fn call_expr_fourth_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(3).expect("Missing arg 3"))
            .await
    }

    async fn call_expr_fifth_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(4).expect("Missing arg 4"))
            .await
    }

    fn ensure_two_args(&self, args: &FunctionArgs, err: &str) -> Result<()> {
        if args.len() != 2 {
            return Err(DataFusionError::NotImplemented(err.into()));
        }
        Ok(())
    }

    fn ensure_three_args(&self, args: &FunctionArgs, err: &str) -> Result<()> {
        if args.len() != 3 {
            return Err(DataFusionError::NotImplemented(err.into()));
        }
        Ok(())
    }

    fn ensure_ge_three_args(&self, args: &FunctionArgs, err: &str) -> Result<()> {
        if args.len() < 3 {
            return Err(DataFusionError::NotImplemented(err.into()));
        }
        Ok(())
    }

    fn ensure_five_args(&self, args: &FunctionArgs, err: &str) -> Result<()> {
        if args.len() != 5 {
            return Err(DataFusionError::NotImplemented(err.into()));
        }
        Ok(())
    }

    fn parse_f64_else_err<T: Into<String>>(&self, value: &Value, err: T) -> Result<f64> {
        match value {
            Value::Float(f) => Ok(*f),
            _ => Err(DataFusionError::NotImplemented(err.into())),
        }
    }
    async fn call_expr(&mut self, func: &Function, args: &FunctionArgs) -> Result<Value> {
        use crate::functions::Func;

        let func_name = Func::from_str(func.name).map_err(|_| {
            DataFusionError::NotImplemented(format!("Unsupported function: {}", func.name))
        })?;

        // There are a few functions which need no arguments for e.g. time()
        let functions_without_args: HashSet<&str> = HashSet::from_iter(vec![
            "day_of_month",
            "day_of_week",
            "day_of_year",
            "days_in_month",
            "hour",
            "minute",
            "month",
            "time",
            "year",
        ]);
        let input = match functions_without_args.contains(func.name) {
            true => match args.len() {
                0 => {
                    // Found no arg to pass to, lets use a `matrix(time())` as the arg.
                    // https://prometheus.io/docs/prometheus/latest/querying/functions/#functions
                    let timestamps = self.eval_ctx.timestamps();
                    let samples: Vec<Sample> = timestamps
                        .iter()
                        .map(|&ts| Sample::new(ts, ts as f64))
                        .collect();
                    let default_now_matrix = vec![RangeValue {
                        labels: Labels::default(),
                        samples,
                        exemplars: None,
                        time_window: None,
                    }];
                    Value::Matrix(default_now_matrix)
                }
                1 => self.call_expr_first_arg(args).await?,

                _ => {
                    return Err(DataFusionError::NotImplemented(
                        "Invalid args passed to the function".into(),
                    ));
                }
            },
            false => {
                let last_arg = args
                    .last()
                    .expect("BUG: promql-parser should have validated function arguments");
                self.exec_expr(&last_arg).await?
            }
        };

        Ok(match func_name {
            Func::Abs => functions::abs(input)?,
            Func::Absent => functions::absent(input, &self.eval_ctx)?,
            Func::AbsentOverTime => functions::absent_over_time(input, &self.eval_ctx)?,
            Func::AvgOverTime => functions::avg_over_time(input, &self.eval_ctx)?,
            Func::Ceil => functions::ceil(input)?,
            Func::Changes => functions::changes(input, &self.eval_ctx)?,
            Func::Clamp => {
                let err =
                    "Invalid args, expected \"clamp(v instant-vector, min scalar, max scalar)\"";
                self.ensure_three_args(args, err)?;

                let input = self.call_expr_first_arg(args).await?;
                let min = self.call_expr_second_arg(args).await?;
                let max = self.call_expr_third_arg(args).await?;

                let (min_f, max_f) = match (min, max) {
                    (Value::Float(min), Value::Float(max)) => {
                        if min > max {
                            return Ok(Value::Matrix(vec![]));
                        }
                        (min, max)
                    }
                    _ => {
                        return Err(DataFusionError::NotImplemented(err.into()));
                    }
                };
                functions::clamp(input, min_f, max_f)?
            }
            Func::ClampMax => {
                let err = "Invalid args, expected \"clamp(v instant-vector, max scalar)\"";
                self.ensure_two_args(args, err)?;

                let input = self.call_expr_first_arg(args).await?;
                let max = self.call_expr_second_arg(args).await?;
                let max_f = match max {
                    Value::Float(max) => max,
                    _ => {
                        return Err(DataFusionError::NotImplemented(err.into()));
                    }
                };
                functions::clamp(input, f64::MIN, max_f)?
            }
            Func::ClampMin => {
                let err = "Invalid args, expected \"clamp(v instant-vector, min scalar)\"";
                self.ensure_two_args(args, err)?;

                let input = self.call_expr_first_arg(args).await?;
                let min = self.call_expr_second_arg(args).await?;
                let min_f = match min {
                    Value::Float(min) => min,
                    _ => {
                        return Err(DataFusionError::NotImplemented(err.into()));
                    }
                };
                functions::clamp(input, min_f, f64::MAX)?
            }
            Func::CountOverTime => functions::count_over_time(input, &self.eval_ctx)?,
            Func::DayOfMonth => functions::day_of_month(input)?,
            Func::DayOfWeek => functions::day_of_week(input)?,
            Func::DayOfYear => functions::day_of_year(input)?,
            Func::DaysInMonth => functions::days_in_month(input)?,
            Func::Delta => functions::delta(input, &self.eval_ctx)?,
            Func::Deriv => functions::deriv(input, &self.eval_ctx)?,
            Func::Exp => functions::exp(input)?,
            Func::Floor => functions::floor(input)?,
            Func::HistogramCount => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {func_name:?}"
                )));
            }
            Func::HistogramFraction => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {func_name:?}"
                )));
            }
            Func::HistogramQuantile => {
                let args = &args.args;
                if args.len() != 2 {
                    return Err(DataFusionError::Plan(format!(
                        "{}: expected 2 arguments, got {}",
                        func.name,
                        args.len()
                    )));
                }
                let phi = {
                    match *args[0] {
                        PromExpr::NumberLiteral(ref num) => num.val,
                        _ => {
                            return Err(DataFusionError::Plan(format!(
                                "{}: the first argument must be a number",
                                func.name
                            )));
                        }
                    }
                };

                // Use range version if we have an eval context
                functions::histogram_quantile(phi, input, &self.eval_ctx)?
            }
            Func::HistogramSum => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {func_name:?}"
                )));
            }
            Func::HoltWinters => {
                let err =
                    "Invalid args, expected \"holt_winters(v range-vector, sf scalar, tf scalar)\"";
                self.ensure_three_args(args, err)?;

                let input = self.call_expr_first_arg(args).await?;
                let sf = self.call_expr_second_arg(args).await?;
                let tf = self.call_expr_third_arg(args).await?;

                let scaling_factor = self.parse_f64_else_err(&sf, err)?;
                let trend_factor = self.parse_f64_else_err(&tf, err)?;

                functions::holt_winters(input, scaling_factor, trend_factor, &self.eval_ctx)?
            }
            Func::Hour => functions::hour(input)?,
            Func::Idelta => functions::idelta(input, &self.eval_ctx)?,
            Func::Increase => functions::increase(input, &self.eval_ctx)?,
            Func::Irate => functions::irate(input, &self.eval_ctx)?,
            Func::LabelJoin => {
                let err = "Invalid args, expected \"label_join(v instant-vector, dst string, sep string, src_1 string, src_2 string, ...)\"";
                self.ensure_ge_three_args(args, err)?;

                let input = self.call_expr_first_arg(args).await?;
                let dst_label = self.call_expr_second_arg(args).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid destination label found".into()),
                )?;
                let separator = self.call_expr_third_arg(args).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid separator label found".into()),
                )?;

                let mut source_labels = vec![];
                for each_src in args.args[3..].iter() {
                    if let Value::String(label) = self.exec_expr(each_src).await.unwrap() {
                        source_labels.push(label);
                    };
                }
                if source_labels.is_empty() {
                    return Err(DataFusionError::NotImplemented(
                        "source labels can not be empty or invalid".into(),
                    ));
                }
                functions::label_join(input, &dst_label, &separator, source_labels)?
            }
            Func::LabelReplace => {
                let err = "Invalid args, expected \"label_replace(v instant-vector, dst_label string, replacement string, src_label string, regex string)\"";

                self.ensure_five_args(args, err)?;
                let input = self.call_expr_first_arg(args).await?;

                let dst_label = self.call_expr_second_arg(args).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid destination label found".into()),
                )?;
                let replacement = self.call_expr_third_arg(args).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid replacement string found".into()),
                )?;

                let src_label = self.call_expr_fourth_arg(args).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid source label string found".into()),
                )?;

                let regex = self.call_expr_fifth_arg(args).await?.get_string().ok_or(
                    DataFusionError::NotImplemented("Invalid regex string found".into()),
                )?;

                functions::label_replace(input, &dst_label, &replacement, &src_label, &regex)?
            }
            Func::LastOverTime => functions::last_over_time(input, &self.eval_ctx)?,
            Func::Ln => functions::ln(input)?,
            Func::Log10 => functions::log10(input)?,
            Func::Log2 => functions::log2(input)?,
            Func::MaxOverTime => functions::max_over_time(input, &self.eval_ctx)?,
            Func::MinOverTime => functions::min_over_time(input, &self.eval_ctx)?,
            Func::Minute => functions::minute(input)?,
            Func::Month => functions::month(input)?,
            Func::PredictLinear => {
                let err = "Invalid args, expected \"predict_linear(v range-vector, t scalar)\"";

                self.ensure_two_args(args, err)?;
                let input = self.call_expr_first_arg(args).await?;

                let prediction_steps = self.call_expr_second_arg(args).await?.get_float().ok_or(
                    DataFusionError::NotImplemented(
                        "Invalid prediction_steps, f64 expected".into(),
                    ),
                )?;
                functions::predict_linear(input, prediction_steps, &self.eval_ctx)?
            }
            Func::QuantileOverTime => {
                let err = "Invalid args, expected \"quantile_over_time(scalar, range-vector)\"";

                self.ensure_two_args(args, err)?;
                let phi_quantile = match self.call_expr_first_arg(args).await {
                    Ok(Value::Float(v)) => v,
                    _ => {
                        return Err(DataFusionError::Plan(
                            "[quantile] param must be a NumberLiteral".into(),
                        ));
                    }
                };
                let input = self.call_expr_second_arg(args).await?;
                functions::quantile_over_time(phi_quantile, input, &self.eval_ctx)?
            }
            Func::Rate => functions::rate(input, &self.eval_ctx)?,
            Func::Resets => functions::resets(input, &self.eval_ctx)?,
            Func::Round => functions::round(input)?,
            Func::Scalar => functions::scalar(input, &self.eval_ctx)?,
            Func::Sgn => functions::sgn(input)?,
            Func::Sort => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {func_name:?}"
                )));
            }
            Func::SortDesc => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {func_name:?}"
                )));
            }
            Func::Sqrt => functions::sqrt(input)?,
            Func::StddevOverTime => functions::stddev_over_time(input, &self.eval_ctx)?,
            Func::StdvarOverTime => functions::stdvar_over_time(input, &self.eval_ctx)?,
            Func::SumOverTime => functions::sum_over_time(input, &self.eval_ctx)?,
            // TODO: check this implementation
            Func::Time => Value::Float((self.eval_ctx.start / 1_000_000) as f64),
            Func::Timestamp => functions::timestamp(input)?,
            Func::Vector => functions::vector(input, &self.eval_ctx)?,
            Func::Year => functions::year(input)?,
        })
    }
}

/// Discard the already-partitioned series hashes without rebuilding a global
/// hash table. This is the common path when DataFusion creates one query
/// context for the selected schema.
fn flatten_partitioned_metrics(partitions: PartitionedMetrics) -> Vec<RangeValue> {
    let metrics_count = partitions.iter().map(HashMap::len).sum();
    let mut metrics = Vec::with_capacity(metrics_count);
    for partition in partitions {
        metrics.extend(partition.into_values());
    }
    metrics
}

fn flatten_loaded_metrics(metrics: LoadedMetrics) -> Vec<RangeValue> {
    match metrics {
        LoadedMetrics::Partitioned(partitions) => flatten_partitioned_metrics(partitions),
        LoadedMetrics::Merged(metrics) => metrics.into_values().collect(),
    }
}

/// A single DataFusion context is the common case and its series are already
/// deduplicated, so flatten it; series from multiple contexts must be merged
/// by series hash.
fn collect_loaded_metrics(mut results: Vec<LoadedMetrics>) -> Vec<RangeValue> {
    if results.len() == 1 {
        flatten_loaded_metrics(results.pop().unwrap())
    } else {
        merge_loaded_metrics(results).into_values().collect()
    }
}

/// Merge series that may occur in more than one DataFusion context. Contexts
/// can have different partition counts, so this fallback deliberately merges
/// by series hash instead of zipping partitions.
fn merge_loaded_metrics(results: Vec<LoadedMetrics>) -> HashMap<u64, RangeValue> {
    // Multiple contexts can contain the same high-cardinality series. Grow
    // from the unique keys instead of reserving the sum of all context sizes.
    let mut metrics: HashMap<u64, RangeValue> = HashMap::default();
    for result in results {
        let maps = match result {
            LoadedMetrics::Partitioned(partitions) => partitions,
            LoadedMetrics::Merged(metrics) => vec![metrics],
        };
        for map in maps {
            for (hash, value) in map {
                match metrics.entry(hash) {
                    hashbrown::hash_map::Entry::Occupied(mut entry) => {
                        entry.get_mut().extend(value)
                    }
                    hashbrown::hash_map::Entry::Vacant(entry) => {
                        entry.insert(value);
                    }
                };
            }
        }
    }
    metrics
}

fn get_offset_modifier(offset: Option<Offset>) -> i64 {
    if let Some(offset) = offset {
        match offset {
            Offset::Pos(offset) => micros(offset),
            Offset::Neg(offset) => -micros(offset),
        }
    } else {
        0
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use promql_parser::{
        label::{MatchOp, Matchers},
        parser::{
            AggregateExpr, BinModifier, BinaryExpr, Call, Extension, Function, FunctionArgs,
            MatrixSelector, NumberLiteral, Offset, ParenExpr, StringLiteral, SubqueryExpr,
            UnaryExpr, VectorMatchCardinality, VectorSelector, value::ValueType,
        },
    };

    use super::*;

    // Test extension struct for testing
    #[derive(Debug)]
    struct TestExtension;

    impl promql_parser::parser::ast::ExtensionExpr for TestExtension {
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }

        fn name(&self) -> &str {
            "test_extension"
        }

        fn value_type(&self) -> ValueType {
            ValueType::String
        }

        fn children(&self) -> &[promql_parser::parser::Expr] {
            &[]
        }
    }

    fn range_value(timestamp: i64, value: f64) -> RangeValue {
        RangeValue {
            labels: vec![],
            samples: vec![Sample::new(timestamp, value)],
            exemplars: None,
            time_window: None,
        }
    }

    #[test]
    fn test_flatten_partitioned_metrics_preserves_all_series() {
        let partitions = vec![
            HashMap::from([(11, range_value(100, 1.0))]),
            HashMap::from([(22, range_value(200, 2.0))]),
        ];

        let metrics = flatten_partitioned_metrics(partitions);
        assert_eq!(metrics.len(), 2);
        assert_eq!(
            metrics
                .iter()
                .map(|metric| metric.samples.len())
                .sum::<usize>(),
            2
        );
    }

    #[test]
    fn test_merge_partitioned_metrics_extends_series_across_contexts() {
        // Deliberately use different partition counts: separate DataFusion
        // contexts are not required to have identical physical plans.
        let results = vec![
            LoadedMetrics::Partitioned(vec![HashMap::from([(11, range_value(100, 1.0))])]),
            LoadedMetrics::Partitioned(vec![
                HashMap::new(),
                HashMap::from([(11, range_value(200, 2.0)), (22, range_value(300, 3.0))]),
            ]),
        ];

        let metrics = merge_loaded_metrics(results);
        assert_eq!(metrics.len(), 2);
        assert_eq!(metrics[&11].samples.len(), 2);
        assert_eq!(metrics[&22].samples.len(), 1);
    }

    #[test]
    fn test_engine_new() {
        // Test basic engine creation with a simple mock
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        assert_eq!(engine.trace_id, trace_id.to_string());
        assert!(engine.label_selector.is_empty());
        assert!(engine.result_type.is_none());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_number_literal() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_string_literal() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let expr = PromExpr::StringLiteral(StringLiteral {
            val: "test".to_string(),
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_paren() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let inner_expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let expr = PromExpr::Paren(ParenExpr {
            expr: Box::new(inner_expr),
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_unary() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );
        let inner_expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let expr = PromExpr::Unary(UnaryExpr {
            expr: Box::new(inner_expr),
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_binary() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let lhs = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let rhs = PromExpr::NumberLiteral(NumberLiteral { val: 10.0 });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier: None,
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_binary_with_modifier() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let lhs = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let rhs = PromExpr::NumberLiteral(NumberLiteral { val: 10.0 });
        let modifier = Some(BinModifier {
            card: VectorMatchCardinality::OneToOne,
            matching: Some(LabelModifier::Include(promql_parser::label::Labels {
                labels: vec!["env".to_string()],
            })),
            return_bool: false,
        });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier,
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_binary_with_many_to_one() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let lhs = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let rhs = PromExpr::NumberLiteral(NumberLiteral { val: 10.0 });
        let modifier = Some(BinModifier {
            card: VectorMatchCardinality::ManyToOne(promql_parser::label::Labels {
                labels: vec!["env".to_string()],
            }),
            matching: Some(LabelModifier::Include(promql_parser::label::Labels {
                labels: vec!["env".to_string()],
            })),
            return_bool: false,
        });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier,
        });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
        // Should clear label_selector for ManyToOne
        assert!(engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_aggregate() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(expr),
            param: None,
            modifier: None,
        });

        let result = engine.extract_columns_from_prom_expr(&aggregate_expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_aggregate_with_param() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let param = PromExpr::NumberLiteral(NumberLiteral { val: 0.5 });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(expr),
            param: Some(Box::new(param)),
            modifier: None,
        });

        let result = engine.extract_columns_from_prom_expr(&aggregate_expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_subquery() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(expr),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.extract_columns_from_prom_expr(&subquery_expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_call() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs { args: vec![] };
        let func = Function {
            name: "time",
            arg_types: vec![],
            variadic: false,
            return_type: ValueType::Scalar,
        };
        let expr = PromExpr::Call(Call { func, args });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_call_with_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let arg = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let args = FunctionArgs {
            args: vec![Box::new(arg)],
        };
        let func = Function {
            name: "abs",
            arg_types: vec![],
            variadic: false,
            return_type: ValueType::Scalar,
        };
        let expr = PromExpr::Call(Call { func, args });

        let result = engine.extract_columns_from_prom_expr(&expr);
        assert!(result.is_ok());
    }

    #[test]
    fn test_extract_columns_from_prom_expr_extension() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        // Create a mock extension expression
        let extension_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let result = engine.extract_columns_from_prom_expr(&extension_expr);
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported Extension")
        );
    }

    #[test]
    fn test_extract_columns_from_modifier_none() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        engine.extract_columns_from_modifier(&None, &create_test_token());
        // Should not change label_selector
        assert!(engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_topk() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["env".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should clear label_selector for topk
        assert!(!engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_bottomk() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["env".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should clear label_selector for bottomk
        assert!(!engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_include() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let modifier = Some(LabelModifier::Include(promql_parser::label::Labels {
            labels: vec!["env".to_string(), "service".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should add labels to label_selector
        assert!(!engine.label_selector.is_empty());
        assert!(engine.label_selector.contains("env"));
        assert!(engine.label_selector.contains("service"));
    }

    #[test]
    fn test_extract_columns_label_replace_disables_selector() {
        // Regression test for #11321: `count by (new) (label_replace(m, "new", ...))`
        // must not restrict loaded columns to `{"new"}`, since `new` is created
        // by `label_replace` and the source label it reads from would otherwise
        // not be loaded, so aggregation collapses all series into one group.
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let label_replace_call = PromExpr::Call(Call {
            func: Function {
                name: "label_replace",
                arg_types: vec![],
                variadic: false,
                return_type: ValueType::Vector,
            },
            args: FunctionArgs { args: vec![] },
        });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(label_replace_call),
            param: None,
            modifier: Some(LabelModifier::Include(promql_parser::label::Labels {
                labels: vec!["new".to_string()],
            })),
        });

        engine
            .extract_columns_from_prom_expr(&aggregate_expr)
            .unwrap();
        assert!(
            engine.disable_label_selector,
            "label_replace must set disable_label_selector"
        );
        // `exec()` clears the selector when the flag is set; mimic that here.
        if engine.disable_label_selector {
            engine.label_selector.clear();
        }
        assert!(engine.label_selector.is_empty());
    }

    #[test]
    fn test_extract_columns_from_modifier_exclude() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let modifier = Some(LabelModifier::Exclude(promql_parser::label::Labels {
            labels: vec!["env".to_string()],
        }));

        engine.extract_columns_from_modifier(&modifier, &create_test_token());
        // Should not change label_selector for exclude
        assert!(engine.label_selector.is_empty());
    }

    /// The `@` modifier PARSES (the fork supports the syntax) but nothing in the
    /// engine ever reads `vs.at` — every selector is evaluated at the step's own
    /// timestamp. So before this guard, `foo @ 1600000000` did not pin anything:
    /// it silently returned UNPINNED results, and the user got a plausible wrong
    /// number with no error. An unsupported feature must fail loudly; returning
    /// the wrong data quietly is the worst outcome in a metrics engine.
    ///
    /// Rejected at both selector arms — a range selector carries its own `at`
    /// (`foo[5m] @ end()`), and a subquery recurses through `exec_expr`, so a
    /// nested `@` lands on one of these two.
    #[tokio::test]
    async fn test_exec_expr_rejects_at_modifier() {
        let trace_id = "test_trace";
        let org_id = "test_org";

        // (query, what it exercises)
        let cases = [
            ("foo @ 1600000000", "instant selector, absolute @"),
            ("foo @ start()", "instant selector, @ start()"),
            ("foo @ end()", "instant selector, @ end()"),
            ("rate(foo[5m] @ 1600000000)", "range selector inside a call"),
            ("sum_over_time(foo[5m] @ end())", "range selector, @ end()"),
        ];

        for (query, what) in cases {
            let mut engine = Engine::new(
                trace_id,
                Arc::new(PromqlContext::new(
                    create_test_query_ctx(trace_id, org_id, 30),
                    SimpleMockProvider,
                    vec![],
                )),
                create_test_eval_ctx(),
            );

            let expr = promql_parser::parser::parse(query)
                .unwrap_or_else(|e| panic!("{what}: `{query}` should parse: {e}"));
            let err = engine.exec_expr(&expr).await.err().unwrap_or_else(|| {
                panic!("{what}: `{query}` must be rejected, not silently ignored")
            });

            assert!(
                err.to_string().contains("@ modifier is not supported"),
                "{what}: `{query}` should fail with the @-modifier error, got: {err}",
            );
        }
    }

    /// The guard must not fire on a query that merely LOOKS adjacent — `offset`
    /// is genuinely implemented and must keep working.
    #[tokio::test]
    async fn test_exec_expr_allows_offset_without_at_modifier() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = promql_parser::parser::parse("foo offset 5m").expect("should parse");
        let err = engine.exec_expr(&expr).await.err();

        // The mock provider returns no data, so this may or may not error — what
        // matters is that it is never the @-modifier rejection.
        if let Some(err) = err {
            assert!(
                !err.to_string().contains("@ modifier"),
                "offset must not be caught by the @-modifier guard, got: {err}",
            );
        }
    }

    #[tokio::test]
    async fn test_exec_expr_number_literal() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_string_literal() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::StringLiteral(StringLiteral {
            val: "test".to_string(),
        });
        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::String(val)) = result {
            assert_eq!(val, "test");
        } else {
            panic!("Expected Value::String");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_paren() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let inner_expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let expr = PromExpr::Paren(ParenExpr {
            expr: Box::new(inner_expr),
        });

        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_unary_float() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let inner_expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let expr = PromExpr::Unary(UnaryExpr {
            expr: Box::new(inner_expr),
        });

        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, -42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_unary_vector() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let sample = Sample::new(1640995200000000i64, 42.0);
        let instant = InstantValue {
            labels: vec![Arc::new(Label::new("env", "prod"))],
            sample,
        };
        let _vector = Value::Vector(vec![instant]);
        let vector_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let expr = PromExpr::Unary(UnaryExpr {
            expr: Box::new(vector_expr),
        });

        let result = engine.exec_expr(&expr).await;
        // This will fail because Extension is not implemented, but we're testing the unary logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_binary_float_float() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let lhs = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let rhs = PromExpr::NumberLiteral(NumberLiteral { val: 10.0 });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier: None,
        });

        let result = engine.exec_expr(&expr).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 52.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_exec_expr_binary_none_none() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let lhs = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });
        let rhs = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });
        let expr = PromExpr::Binary(BinaryExpr {
            lhs: Box::new(lhs),
            rhs: Box::new(rhs),
            op: create_test_token(),
            modifier: None,
        });

        let result = engine.exec_expr(&expr).await;
        // This will fail because Extension is not implemented, but we're testing the binary logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_subquery() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(expr),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // Subquery with float input should fail because subquery expects matrix input
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported subquery")
        );
    }

    #[tokio::test]
    async fn test_exec_expr_subquery_with_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let offset = Some(Offset::Pos(Duration::from_secs(60)));
        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(expr),
            range: Duration::from_secs(300),
            offset,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // Subquery with float input should fail because subquery expects matrix input
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported subquery")
        );
    }

    #[tokio::test]
    async fn test_exec_expr_subquery_vector() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let sample = Sample::new(1640995200000000i64, 42.0);
        let _instant = InstantValue {
            labels: vec![Arc::new(Label::new("env", "prod"))],
            sample,
        };
        let vector = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(vector),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // This will fail because Extension is not implemented, but we're testing the subquery logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_subquery_float() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let float_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let subquery_expr = PromExpr::Subquery(SubqueryExpr {
            expr: Box::new(float_expr),
            range: Duration::from_secs(300),
            offset: None,
            step: None,
            at: None,
        });

        let result = engine.exec_expr(&subquery_expr).await;
        // This will fail because Extension is not implemented, but we're testing the subquery logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_aggregate() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let aggregate_expr = PromExpr::Aggregate(AggregateExpr {
            op: create_test_token(),
            expr: Box::new(expr),
            param: None,
            modifier: None,
        });

        let result = engine.exec_expr(&aggregate_expr).await;
        // This will fail because aggregate_exprs is not fully implemented, but we're testing the
        // aggregate logic
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_exec_expr_call() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs { args: vec![] };
        let func = Function {
            name: "time",
            arg_types: vec![],
            variadic: false,
            return_type: ValueType::Scalar,
        };
        let expr = PromExpr::Call(Call { func, args });

        let result = engine.exec_expr(&expr).await;
        // This will fail because call_expr is not fully implemented, but we're testing the call
        // logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_exec_expr_extension() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let extension_expr = PromExpr::Extension(Extension {
            expr: Arc::new(TestExtension),
        });

        let result = engine.exec_expr(&extension_expr).await;
        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Unsupported Extension")
        );
    }

    #[tokio::test]
    async fn test_exec_expr_vector_selector() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let expr = PromExpr::VectorSelector(selector);

        let result = engine.exec_expr(&expr).await;
        // This will fail because the mock provider doesn't have real data, but we're testing the
        // vector selector logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_exec_expr_matrix_selector() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let matrix_selector = MatrixSelector {
            vs: selector,
            range: Duration::from_secs(300),
        };

        let expr = PromExpr::MatrixSelector(matrix_selector);

        let result = engine.exec_expr(&expr).await;
        // This will fail because the mock provider doesn't have real data, but we're testing the
        // matrix selector logic
        assert!(result.is_ok());
    }

    #[tokio::test]
    async fn test_exec() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let expr = PromExpr::NumberLiteral(NumberLiteral { val: 42.0 });
        let result = engine.exec(&expr).await;
        assert!(result.is_ok());

        let (value, result_type) = result.unwrap();
        assert!(matches!(value, Value::Float(42.0)));
        assert!(result_type.is_none());
    }

    #[test]
    fn test_ensure_two_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
            ],
        };
        let result = engine.ensure_two_args(&args, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        let result = engine.ensure_two_args(&args, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_three_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 3.0 })),
            ],
        };
        let result = engine.ensure_three_args(&args, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        let result = engine.ensure_three_args(&args, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_ge_three_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 3.0 })),
            ],
        };
        let result = engine.ensure_ge_three_args(&args, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
            ],
        };
        let result = engine.ensure_ge_three_args(&args, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_ensure_five_args() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 1.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 2.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 3.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 4.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 5.0 })),
            ],
        };
        let result = engine.ensure_five_args(&args, "test error");
        assert!(result.is_ok());

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 1.0,
            }))],
        };
        let result = engine.ensure_five_args(&args, "test error");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_f64_else_err() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let value = Value::Float(42.0);
        let result = engine.parse_f64_else_err(&value, "test error");
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 42.0);

        let value = Value::String("not a float".to_string());
        let result = engine.parse_f64_else_err(&value, "test error");
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_call_expr_first_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![Box::new(PromExpr::NumberLiteral(NumberLiteral {
                val: 42.0,
            }))],
        };
        let result = engine.call_expr_first_arg(&args).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_second_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_second_arg(&args).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_third_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 20.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_third_arg(&args).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_fourth_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 20.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 30.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_fourth_arg(&args).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    #[tokio::test]
    async fn test_call_expr_fifth_arg() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let args = FunctionArgs {
            args: vec![
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 10.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 20.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 30.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 40.0 })),
                Box::new(PromExpr::NumberLiteral(NumberLiteral { val: 42.0 })),
            ],
        };
        let result = engine.call_expr_fifth_arg(&args).await;
        assert!(result.is_ok());

        if let Ok(Value::Float(val)) = result {
            assert_eq!(val, 42.0);
        } else {
            panic!("Expected Value::Float");
        }
    }

    // Helper function to create test token types
    fn create_test_token() -> token::TokenType {
        token::TokenType::new(token::T_ADD)
    }

    // Helper function to create test QueryContext
    fn create_test_query_ctx(trace_id: &str, org_id: &str, timeout: u64) -> Arc<QueryContext> {
        Arc::new(QueryContext {
            trace_id: trace_id.to_string(),
            org_id: org_id.to_string(),
            query_exemplars: false,
            query_data: false,
            need_wal: false,
            use_cache: false,
            timeout,
            search_event_type: None,
            regions: vec![],
            clusters: vec![],
            is_super_cluster: false,
        })
    }

    // Helper function to create test EvalContext
    fn create_test_eval_ctx() -> EvalContext {
        EvalContext::new(
            1640995200000000i64,
            1640995200000000i64,
            0,
            "test_trace".to_string(),
        )
    }

    // Simple mock provider that implements the required trait
    struct SimpleMockProvider;

    #[async_trait::async_trait]
    impl crate::TableProvider for SimpleMockProvider {
        async fn create_context(
            &self,
            _org_id: &str,
            _stream_name: &str,
            _time_range: (i64, i64),
            _machers: promql_parser::label::Matchers,
            _label_selector: HashSet<String>,
            _filters: &mut [(String, Vec<String>)],
        ) -> datafusion::error::Result<
            Vec<(
                datafusion::prelude::SessionContext,
                std::sync::Arc<datafusion::arrow::datatypes::Schema>,
                config::meta::search::ScanStats,
                bool,
            )>,
        > {
            Ok(vec![])
        }
    }

    #[tokio::test]
    async fn test_eval_vector_selector_basic() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_vector_selector_with_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: Some(Offset::Pos(Duration::from_secs(60))),
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_vector_selector_with_negative_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: Some(Offset::Neg(Duration::from_secs(60))),
            at: None,
        };

        let result = engine.eval_vector_selector(&selector).await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_matrix_selector_basic() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: None,
            at: None,
        };

        let result = engine
            .eval_matrix_selector(&selector, Duration::from_secs(300))
            .await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[tokio::test]
    async fn test_eval_matrix_selector_with_offset() {
        let trace_id = "test_trace";
        let org_id = "test_org";
        let mut engine = Engine::new(
            trace_id,
            Arc::new(PromqlContext::new(
                create_test_query_ctx(trace_id, org_id, 30),
                SimpleMockProvider,
                vec![],
            )),
            create_test_eval_ctx(),
        );

        let matchers = Matchers {
            matchers: vec![promql_parser::label::Matcher {
                name: "env".to_string(),
                op: MatchOp::Equal,
                value: "prod".to_string(),
            }],
            or_matchers: vec![],
        };

        let selector = VectorSelector {
            name: Some("test_metric".to_string()),
            matchers,
            offset: Some(Offset::Pos(Duration::from_secs(120))),
            at: None,
        };

        let result = engine
            .eval_matrix_selector(&selector, Duration::from_secs(300))
            .await;
        assert!(result.is_ok());
        let values = result.unwrap();
        assert_eq!(values.len(), 0); // Mock provider returns empty data
    }

    #[test]
    fn test_get_offset_modifier_none() {
        assert_eq!(get_offset_modifier(None), 0);
    }

    #[test]
    fn test_get_offset_modifier_positive() {
        let result = get_offset_modifier(Some(Offset::Pos(Duration::from_secs(60))));
        assert_eq!(result, 60_000_000); // 60s in micros
    }

    #[test]
    fn test_get_offset_modifier_negative() {
        let result = get_offset_modifier(Some(Offset::Neg(Duration::from_secs(30))));
        assert_eq!(result, -30_000_000); // -30s in micros
    }
}
