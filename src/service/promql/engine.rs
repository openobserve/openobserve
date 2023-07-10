// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use ahash::AHashMap as HashMap;
use async_recursion::async_recursion;

use datafusion::{
    arrow::{
        array::{Float64Array, Int64Array, StringArray},
        datatypes::Schema,
    },
    error::{DataFusionError, Result},
    prelude::{col, lit, SessionContext},
};
use futures::future::try_join_all;
use promql_parser::{
    label::MatchOp,
    parser::{
        token, AggregateExpr, Call, Expr as PromExpr, Function, FunctionArgs, LabelModifier,
        MatrixSelector, NumberLiteral, ParenExpr, StringLiteral, TokenType, UnaryExpr,
        VectorSelector,
    },
};
use std::{collections::HashSet, str::FromStr, sync::Arc, time::Duration};

use crate::common::infra::config::CONFIG;
use crate::common::meta::prom::{HASH_LABEL, VALUE_LABEL};
use crate::service::promql::{aggregations, binaries, functions, micros, value::*};

pub struct Engine {
    ctx: Arc<super::exec::Query>,
    /// The time boundaries for the evaluation.
    time: i64,
    result_type: Option<String>,
}

impl Engine {
    pub fn new(ctx: Arc<super::exec::Query>, time: i64) -> Self {
        Self {
            ctx,
            time,
            result_type: None,
        }
    }

    pub async fn exec(&mut self, prom_expr: &PromExpr) -> Result<(Value, Option<String>)> {
        let value = self.exec_expr(prom_expr).await?;
        Ok((value, self.result_type.clone()))
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
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Unary: {:?}",
                    expr
                )));
            }
            PromExpr::Binary(expr) => {
                let lhs = self.exec_expr(&expr.lhs).await?;
                let rhs = self.exec_expr(&expr.rhs).await?;
                let token = expr.op.id();

                match (lhs.clone(), rhs.clone()) {
                    (Value::Float(left), Value::Float(right)) => {
                        let value = binaries::scalar_binary_operations(token, left, right)?;
                        Value::Float(value)
                    }
                    (Value::Vector(left), Value::Vector(right)) => {
                        binaries::vector_bin_op(expr, &left, &right)?
                    }
                    (Value::Vector(left), Value::Float(right)) => {
                        binaries::vector_scalar_bin_op(expr, &left, right).await?
                    }
                    (Value::Float(left), Value::Vector(right)) => {
                        binaries::vector_scalar_bin_op(expr, &right, left).await?
                    }
                    (Value::None, _) | (_, Value::None) => {
                        return Err(DataFusionError::NotImplemented(format!(
                            "No data found for the operation lhs: {:?} rhs: {:?}",
                            &lhs, &rhs
                        )))
                    }
                    _ => {
                        return Err(DataFusionError::NotImplemented(format!(
                            "Unsupported binary operation between two operands. {:?} {:?}",
                            &lhs, &rhs
                        )))
                    }
                }
            }
            PromExpr::Paren(ParenExpr { expr }) => self.exec_expr(expr).await?,
            PromExpr::Subquery(expr) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Subquery: {:?}",
                    expr
                )));
            }
            PromExpr::NumberLiteral(NumberLiteral { val }) => Value::Float(*val),
            PromExpr::StringLiteral(StringLiteral { val }) => Value::String(val.clone()),
            PromExpr::VectorSelector(v) => {
                let data = self.eval_vector_selector(v).await?;
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Vector(data)
                }
            }
            PromExpr::MatrixSelector(MatrixSelector {
                vector_selector,
                range,
            }) => {
                let data = self.eval_matrix_selector(vector_selector, *range).await?;
                if data.is_empty() {
                    Value::None
                } else {
                    Value::Matrix(data)
                }
            }
            PromExpr::Call(Call { func, args }) => self.call_expr(func, args).await?,
            PromExpr::Extension(expr) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Extension: {:?}",
                    expr
                )));
            }
        })
    }

    /// Instant vector selector --- select a single sample at each evaluation timestamp.
    ///
    /// See <https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#confusion-alert-instantrange-selectors-vs-instantrange-queries>
    async fn eval_vector_selector(
        &mut self,
        selector: &VectorSelector,
    ) -> Result<Vec<InstantValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("vector".to_string());
        }
        let metrics_name = selector.name.as_ref().expect("Missing selector name");
        let cache_exists = { self.ctx.data_cache.read().await.contains_key(metrics_name) };
        if !cache_exists {
            self.selector_load_data(selector, None).await?;
        }
        let metrics_cache = self.ctx.data_cache.read().await;
        let metrics_cache = match metrics_cache.get(metrics_name) {
            Some(v) => match v.get_ref_matrix_values() {
                Some(v) => v,
                None => return Ok(vec![]),
            },
            None => return Ok(vec![]),
        };

        // Evaluation timestamp.
        let eval_ts = self.time;
        let start = eval_ts - self.ctx.lookback_delta;

        let mut values = vec![];
        for metric in metrics_cache {
            if let Some(last_value) = metric
                .samples
                .iter()
                .filter_map(|s| (start < s.timestamp && s.timestamp <= eval_ts).then_some(s.value))
                .last()
            {
                values.push(
                    // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#instant-queries
                    InstantValue {
                        labels: metric.labels.clone(),
                        sample: Sample::new(eval_ts, last_value),
                    },
                );
            }
        }
        Ok(values)
    }

    /// Range vector selector --- select a whole time range at each evaluation timestamp.
    ///
    /// See <https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#confusion-alert-instantrange-selectors-vs-instantrange-queries>
    ///
    /// MatrixSelector is a special case of VectorSelector that returns a matrix of samples.
    async fn eval_matrix_selector(
        &mut self,
        selector: &VectorSelector,
        range: Duration,
    ) -> Result<Vec<RangeValue>> {
        if self.result_type.is_none() {
            self.result_type = Some("matrix".to_string());
        }
        let metrics_name = selector.name.as_ref().unwrap();
        let cache_exists = { self.ctx.data_cache.read().await.contains_key(metrics_name) };
        if !cache_exists {
            self.selector_load_data(selector, None).await?;
        }
        let metrics_cache = self.ctx.data_cache.read().await;
        let metrics_cache = match metrics_cache.get(metrics_name) {
            Some(v) => match v.get_ref_matrix_values() {
                Some(v) => v,
                None => return Ok(vec![]),
            },
            None => return Ok(vec![]),
        };

        // Evaluation timestamp --- end of the time window.
        let eval_ts = self.time;
        // Start of the time window.
        let start = eval_ts - micros(range); // e.g. [5m]

        let mut values = Vec::with_capacity(metrics_cache.len());
        for metric in metrics_cache {
            let samples = metric
                .samples
                .iter()
                .filter(|v| start < v.timestamp && v.timestamp <= eval_ts)
                .cloned()
                .collect();
            values.push(RangeValue {
                labels: metric.labels.clone(),
                samples,
                time_window: Some(TimeWindow::new(eval_ts, range)),
            });
        }

        Ok(values)
    }

    #[tracing::instrument(name = "promql:engine:load_data", skip_all)]
    async fn selector_load_data(
        &mut self,
        selector: &VectorSelector,
        range: Option<Duration>,
    ) -> Result<()> {
        // https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#lookback-delta
        let start = self.ctx.start - range.map_or(self.ctx.lookback_delta, micros);
        let end = self.ctx.end; // 30 minutes + 5m = 35m

        // 1. Group by metrics (sets of label name-value pairs)
        let table_name = selector.name.as_ref().unwrap();
        let filters: Vec<(&str, &str)> = selector
            .matchers
            .matchers
            .iter()
            .filter(|mat| mat.op == MatchOp::Equal)
            .map(|mat| (mat.name.as_str(), mat.value.as_str()))
            .collect();
        let ctxs = self
            .ctx
            .table_provider
            .create_context(&self.ctx.org_id, table_name, (start, end), &filters)
            .await?;

        let mut tasks = Vec::new();
        for (ctx, schema, scan_stats) in ctxs {
            let selector = selector.clone();
            let task = tokio::task::spawn(async move {
                selector_load_data_from_datafusion(ctx, schema, selector, start, end).await
            });
            tasks.push(task);
            // update stats
            let mut ctx_scan_stats = self.ctx.scan_stats.write().await;
            ctx_scan_stats.add(&scan_stats);
        }
        let task_results = try_join_all(tasks)
            .await
            .map_err(|e| DataFusionError::Plan(format!("task error: {:?}", e)))?;

        let mut metrics: HashMap<String, RangeValue> = HashMap::default();
        let task_results_len = task_results.len();
        for task_result in task_results {
            if task_results_len == 1 {
                // only one ctx, no need to merge, just set it to metrics
                metrics = task_result?;
                break;
            }
            for (key, value) in task_result? {
                let metric = metrics
                    .entry(key)
                    .or_insert_with(|| RangeValue::new(value.labels, Vec::with_capacity(20)));
                metric.samples.extend(value.samples);
            }
        }

        // no data, return immediately
        if metrics.is_empty() {
            self.ctx
                .data_cache
                .write()
                .await
                .insert(table_name.to_string(), Value::None);
            return Ok(());
        }

        // cache data
        let mut metric_values = metrics.into_values().collect::<Vec<_>>();
        for metric in metric_values.iter_mut() {
            metric.samples.sort_by(|a, b| a.timestamp.cmp(&b.timestamp));
        }
        let values = if metric_values.is_empty() {
            Value::None
        } else {
            Value::Matrix(metric_values)
        };
        self.ctx
            .data_cache
            .write()
            .await
            .insert(table_name.to_string(), values);
        Ok(())
    }

    async fn aggregate_exprs(
        &mut self,
        op: &TokenType,
        expr: &PromExpr,
        param: &Option<Box<PromExpr>>,
        modifier: &Option<LabelModifier>,
    ) -> Result<Value> {
        let sample_time = self.time;
        let input = self.exec_expr(expr).await?;

        Ok(match op.id() {
            token::T_SUM => aggregations::sum(sample_time, modifier, &input)?,
            token::T_AVG => aggregations::avg(sample_time, modifier, &input)?,
            token::T_COUNT => aggregations::count(sample_time, modifier, &input)?,
            token::T_MIN => aggregations::min(sample_time, modifier, &input)?,
            token::T_MAX => aggregations::max(sample_time, modifier, &input)?,
            token::T_GROUP => Value::None,
            token::T_STDDEV => Value::None,
            token::T_STDVAR => Value::None,
            token::T_TOPK => aggregations::topk(self, param.clone().unwrap(), &input).await?,
            token::T_BOTTOMK => aggregations::bottomk(self, param.clone().unwrap(), &input).await?,
            token::T_COUNT_VALUES => Value::None,
            token::T_QUANTILE => Value::None,
            _ => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Aggregate: {:?}",
                    op
                )));
            }
        })
    }

    async fn call_expr_first_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(0).unwrap()).await
    }

    async fn call_expr_second_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(1).unwrap()).await
    }

    async fn call_expr_third_arg(&mut self, args: &FunctionArgs) -> Result<Value> {
        self.exec_expr(args.args.get(2).unwrap()).await
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

    async fn call_expr(&mut self, func: &Function, args: &FunctionArgs) -> Result<Value> {
        use crate::service::promql::functions::Func;

        let func_name = Func::from_str(func.name).map_err(|_| {
            DataFusionError::NotImplemented(format!("Unsupported function: {}", func.name))
        })?;

        // There are a few functions which need no arguments for e.g. time()
        let functions_without_args: HashSet<String> = HashSet::from_iter(vec!["time".into()]);
        let input = match functions_without_args.contains(func.name) {
            true => Value::None,
            false => {
                let last_arg = args
                    .last()
                    .expect("BUG: promql-parser should have validated function arguments");
                self.exec_expr(&last_arg).await?
            }
        };

        Ok(match func_name {
            Func::Abs => functions::abs(&input)?,
            Func::Absent => functions::absent(&input, self.time)?,
            Func::AbsentOverTime => functions::absent_over_time(&input)?,
            Func::AvgOverTime => functions::avg_over_time(&input)?,
            Func::Ceil => functions::ceil(&input)?,
            Func::Changes => functions::changes(&input)?,
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
                            return Ok(Value::Vector(vec![]));
                        }
                        (min, max)
                    }
                    _ => {
                        return Err(DataFusionError::NotImplemented(err.into()));
                    }
                };
                functions::clamp(&input, min_f, max_f)?
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
                functions::clamp(&input, f64::MIN, max_f)?
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
                functions::clamp(&input, min_f, f64::MAX)?
            }
            Func::CountOverTime => functions::count_over_time(&input)?,
            Func::DayOfMonth => functions::day_of_month(&input)?,
            Func::DayOfWeek => functions::day_of_week(&input)?,
            Func::DayOfYear => functions::day_of_year(&input)?,
            Func::DaysInMonth => functions::days_in_month(&input)?,
            Func::Delta => functions::delta(&input)?,
            Func::Deriv => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Exp => functions::exp(&input)?,
            Func::Floor => functions::floor(&input)?,
            Func::HistogramCount => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::HistogramFraction => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
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
                            )))
                        }
                    }
                };
                let sample_time = self.time;
                functions::histogram_quantile(sample_time, phi, input)?
            }
            Func::HistogramSum => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::HoltWinters => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Hour => functions::hour(&input)?,
            Func::Idelta => functions::idelta(&input)?,
            Func::Increase => functions::increase(&input)?,
            Func::Irate => functions::irate(&input)?,
            Func::LabelJoin => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::LabelReplace => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::LastOverTime => functions::last_over_time(&input)?,
            Func::Ln => functions::ln(&input)?,
            Func::Log10 => functions::log10(&input)?,
            Func::Log2 => functions::log2(&input)?,
            Func::MaxOverTime => functions::max_over_time(&input)?,
            Func::MinOverTime => functions::min_over_time(&input)?,
            Func::Minute => functions::minute(&input)?,
            Func::Month => functions::month(&input)?,
            Func::PredictLinear => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::QuantileOverTime => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Rate => functions::rate(&input)?,
            Func::Resets => functions::resets(&input)?,
            Func::Round => functions::round(&input)?,
            Func::Scalar => match input {
                Value::Float(_) => input,
                _ => {
                    return Err(DataFusionError::NotImplemented(format!(
                        "Invalid scalar value: {:?}",
                        input
                    )));
                }
            },
            Func::Sgn => functions::sgn(&input)?,
            Func::Sort => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::SortDesc => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Sqrt => functions::sqrt(&input)?,
            Func::StddevOverTime => functions::stddev_over_time(&input)?,
            Func::StdvarOverTime => functions::stdvar_over_time(&input)?,
            Func::SumOverTime => functions::sum_over_time(&input)?,
            Func::Time => Value::Float(chrono::Utc::now().timestamp() as f64),
            Func::Timestamp => match &input {
                Value::Vector(instant_value) => {
                    let out: Vec<InstantValue> = instant_value
                        .iter()
                        .map(|instant| InstantValue {
                            labels: instant.labels.without_metric_name(),
                            sample: Sample {
                                timestamp: instant.sample.timestamp,
                                value: (instant.sample.timestamp / 1000 / 1000) as f64,
                            },
                        })
                        .collect();
                    Value::Vector(out)
                }
                _ => {
                    return Err(DataFusionError::NotImplemented(format!(
                        "Unexpected input to timestamp function: {:?}",
                        &input
                    )))
                }
            },
            Func::Vector => functions::vector(&input, self.time)?,
            Func::Year => functions::year(&input)?,
        })
    }
}

async fn selector_load_data_from_datafusion(
    ctx: SessionContext,
    schema: Arc<Schema>,
    selector: VectorSelector,
    start: i64,
    end: i64,
) -> Result<HashMap<String, RangeValue>> {
    let table_name = selector.name.as_ref().unwrap();
    let table = match ctx.table(table_name).await {
        Ok(v) => v,
        Err(_) => {
            return Ok(HashMap::default());
        }
    };

    let mut df_group = table.clone().filter(
        col(&CONFIG.common.column_timestamp)
            .gt(lit(start))
            .and(col(&CONFIG.common.column_timestamp).lt_eq(lit(end))),
    )?;
    for mat in selector.matchers.matchers.iter() {
        if mat.name == CONFIG.common.column_timestamp
            || mat.name == VALUE_LABEL
            || schema.field_with_name(&mat.name).is_err()
        {
            continue;
        }
        match &mat.op {
            MatchOp::Equal => {
                df_group = df_group.filter(col(mat.name.clone()).eq(lit(mat.value.clone())))?
            }
            MatchOp::NotEqual => {
                df_group = df_group.filter(col(mat.name.clone()).not_eq(lit(mat.value.clone())))?
            }
            MatchOp::Re(_re) => {
                let regexp_match_udf =
                    crate::service::search::datafusion::regexp_udf::REGEX_MATCH_UDF.clone();
                df_group = df_group.filter(
                    regexp_match_udf.call(vec![col(mat.name.clone()), lit(mat.value.clone())]),
                )?
            }
            MatchOp::NotRe(_re) => {
                let regexp_not_match_udf =
                    crate::service::search::datafusion::regexp_udf::REGEX_NOT_MATCH_UDF.clone();
                df_group = df_group.filter(
                    regexp_not_match_udf.call(vec![col(mat.name.clone()), lit(mat.value.clone())]),
                )?
            }
        }
    }
    let batches = df_group
        .sort(vec![col(&CONFIG.common.column_timestamp).sort(true, true)])?
        .collect()
        .await?;

    let mut metrics: HashMap<String, RangeValue> = HashMap::default();
    for batch in &batches {
        let hash_values = batch
            .column_by_name(HASH_LABEL)
            .unwrap()
            .as_any()
            .downcast_ref::<StringArray>()
            .unwrap();
        let time_values = batch
            .column_by_name(&CONFIG.common.column_timestamp)
            .unwrap()
            .as_any()
            .downcast_ref::<Int64Array>()
            .unwrap();
        let value_values = batch
            .column_by_name(VALUE_LABEL)
            .unwrap()
            .as_any()
            .downcast_ref::<Float64Array>()
            .unwrap();
        for i in 0..batch.num_rows() {
            let hash = hash_values.value(i).to_string();
            let entry = metrics.entry(hash).or_insert_with(|| {
                let mut labels = Vec::with_capacity(batch.num_columns());
                for (k, v) in batch.schema().fields().iter().zip(batch.columns()) {
                    let name = k.name();
                    if name == &CONFIG.common.column_timestamp
                        || name == HASH_LABEL
                        || name == VALUE_LABEL
                    {
                        continue;
                    }
                    let value = v.as_any().downcast_ref::<StringArray>().unwrap();
                    labels.push(Arc::new(Label {
                        name: name.to_string(),
                        value: value.value(i).to_string(),
                    }));
                }
                labels.sort_by(|a, b| a.name.cmp(&b.name));
                RangeValue::new(labels, Vec::with_capacity(20))
            });
            entry
                .samples
                .push(Sample::new(time_values.value(i), value_values.value(i)));
        }
    }
    Ok(metrics)
}
