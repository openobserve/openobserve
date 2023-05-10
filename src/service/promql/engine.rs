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

use async_recursion::async_recursion;
use async_trait::async_trait;
use datafusion::{
    arrow::array::{Float64Array, Int64Array, StringArray},
    error::{DataFusionError, Result},
    prelude::{col, lit, SessionContext},
};
use promql_parser::{
    label::MatchOp,
    parser::{
        token, AggregateExpr, Call, EvalStmt, Expr as PromExpr, Function, FunctionArgs,
        LabelModifier, MatrixSelector, NumberLiteral, ParenExpr, TokenType, UnaryExpr,
        VectorSelector,
    },
};
use rustc_hash::FxHashMap;
use std::{
    str::FromStr,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use super::{aggregations, functions, value::*};

#[async_trait]
pub trait TableProvider: Sync + Send + 'static {
    async fn create_context(
        &self,
        stream_name: &str,
        time_range: (i64, i64),
        filters: &[(String, String)],
    ) -> Result<SessionContext>;
}

pub struct QueryEngine {
    table_provider: Box<dyn TableProvider>,
    /// The time boundaries for the evaluation. If start equals end an instant
    /// is evaluated.
    start: i64,
    end: i64,
    /// Time between two evaluated instants for the range [start:end].
    interval: i64,
    /// Default look back from sample search.
    lookback_delta: i64,
    /// The index of the current time window. Used when evaluating a [range query].
    ///
    /// [range query]: https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
    time_window_idx: i64,
    /// key — metric name; value — time series data
    metrics_cache: FxHashMap<String, Value>,
}

impl QueryEngine {
    pub fn new<P>(provider: P) -> Self
    where
        P: TableProvider,
    {
        let now = micros_since_epoch(SystemTime::now());
        let five_min = micros(Duration::from_secs(300));
        Self {
            table_provider: Box::new(provider),
            start: now,
            end: now,
            interval: five_min,
            lookback_delta: five_min,
            time_window_idx: 0,
            metrics_cache: FxHashMap::default(),
        }
    }

    pub async fn exec(&mut self, stmt: EvalStmt) -> Result<Value> {
        self.start = micros_since_epoch(stmt.start);
        self.end = micros_since_epoch(stmt.end);
        if stmt.interval > Duration::ZERO {
            self.interval = micros(stmt.interval);
        }
        if stmt.lookback_delta > Duration::ZERO {
            self.lookback_delta = micros(stmt.lookback_delta);
        }

        if self.start == self.end {
            // Instant query
            let mut value = self.exec_expr(&stmt.expr).await?;
            if let Value::Float(v) = value {
                value = Value::Sample(Sample {
                    timestamp: self.end,
                    value: v,
                });
            }
            value.sort();
            return Ok(value);
        }

        // Range query
        // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#range-queries
        let mut instant_vectors = Vec::new();
        let nr_steps = ((self.end - self.start) / self.interval) + 1;
        for i in 0..nr_steps {
            self.time_window_idx = i;
            match self.exec_expr(&stmt.expr).await? {
                Value::Instant(v) => instant_vectors.push(RangeValue {
                    labels: v.labels.to_owned(),
                    time_range: None,
                    values: vec![v.value],
                }),
                Value::Vector(vs) => instant_vectors.extend(vs.into_iter().map(|v| RangeValue {
                    labels: v.labels.to_owned(),
                    time_range: None,
                    values: vec![v.value],
                })),
                Value::Range(v) => instant_vectors.push(v),
                Value::Matrix(v) => instant_vectors.extend(v),
                Value::Sample(v) => instant_vectors.push(RangeValue {
                    labels: Labels::default(),
                    time_range: None,
                    values: vec![v],
                }),
                Value::Float(v) => instant_vectors.push(RangeValue {
                    labels: Labels::default(),
                    time_range: None,
                    values: vec![Sample {
                        timestamp: self.start + (self.interval * self.time_window_idx),
                        value: v,
                    }],
                }),
                Value::None => continue,
            };
        }

        // empty result quick return
        if instant_vectors.is_empty() {
            return Ok(Value::None);
        }

        // merge data
        let mut merged_data = FxHashMap::default();
        let mut merged_metrics = FxHashMap::default();
        for value in instant_vectors {
            merged_data
                .entry(signature(&value.labels))
                .or_insert_with(Vec::new)
                .extend(value.values);
            merged_metrics.insert(signature(&value.labels), value.labels);
        }
        let merged_data = merged_data
            .into_iter()
            .map(|(sig, values)| RangeValue {
                labels: merged_metrics.get(&sig).unwrap().to_owned(),
                time_range: None,
                values,
            })
            .collect::<Vec<_>>();

        // sort data
        let mut value = Value::Matrix(merged_data);
        value.sort();
        Ok(value)
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
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Paren: {:?}",
                    expr
                )));
            }
            PromExpr::Paren(ParenExpr { expr }) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Paren: {:?}",
                    expr
                )));
            }
            PromExpr::Subquery(expr) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Subquery: {:?}",
                    expr
                )));
            }
            PromExpr::NumberLiteral(NumberLiteral { val }) => Value::Float(*val),
            PromExpr::StringLiteral(expr) => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported StringLiteral: {:?}",
                    expr
                )));
            }
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

    /// MatrixSelector is a special case of VectorSelector that returns a matrix of samples.
    async fn eval_vector_selector(
        &mut self,
        selector: &VectorSelector,
    ) -> Result<Vec<InstantValue>> {
        let metrics_name = selector.name.as_ref().unwrap();
        if !self.metrics_cache.contains_key(metrics_name) {
            self.selector_load_data(selector, None).await?;
        }
        let metrics_cache = match self.metrics_cache.get(metrics_name) {
            Some(v) => match v.get_ref_matrix_values() {
                Some(v) => v,
                None => return Ok(vec![]),
            },
            None => return Ok(vec![]),
        };

        let mut values = vec![];
        for metric in metrics_cache {
            let mut value = match metric.values.last() {
                Some(v) => *v,
                None => continue, // have no sample
            };
            if value.timestamp != self.end && metric.values.len() > 1 {
                let mut metric = metric.clone();
                metric.time_range = Some((metric.values.first().unwrap().timestamp, self.end));
                if let Some(extra) = metric.extrapolate() {
                    value = extra.1;
                }
            }
            values.push(
                // See https://promlabs.com/blog/2020/06/18/the-anatomy-of-a-promql-query/#instant-queries
                InstantValue {
                    labels: metric.labels.clone(),
                    value,
                },
            );
        }
        Ok(values)
    }

    /// MatrixSelector is a special case of VectorSelector that returns a matrix of samples.
    async fn eval_matrix_selector(
        &mut self,
        selector: &VectorSelector,
        range: Duration,
    ) -> Result<Vec<RangeValue>> {
        let metrics_name = selector.name.as_ref().unwrap();
        if !self.metrics_cache.contains_key(metrics_name) {
            self.selector_load_data(selector, Some(range)).await?;
        }
        let metrics_cache = match self.metrics_cache.get(metrics_name) {
            Some(v) => match v.get_ref_matrix_values() {
                Some(v) => v,
                None => return Ok(vec![]),
            },
            None => return Ok(vec![]),
        };

        let end = self.start + (self.interval * self.time_window_idx); // 15s
        let start = end - micros(range); // 5m

        let mut values = Vec::with_capacity(metrics_cache.len());
        for metric in metrics_cache {
            let metric_data = metric
                .values
                .iter()
                .filter(|v| v.timestamp > start && v.timestamp <= end)
                .cloned()
                .collect::<Vec<_>>();
            values.push(RangeValue {
                labels: metric.labels.clone(),
                time_range: Some((start, end)),
                values: metric_data,
            });
        }
        Ok(values)
    }

    async fn selector_load_data(
        &mut self,
        selector: &VectorSelector,
        range: Option<Duration>,
    ) -> Result<()> {
        let start = {
            // https://promlabs.com/blog/2020/07/02/selecting-data-in-promql/#lookback-delta
            let lookback_delta = range.map_or(self.lookback_delta, micros);
            self.start + (self.interval * self.time_window_idx) - lookback_delta
        };
        let end = self.end; // 30 minutes + 5m = 35m

        // 1. Group by metrics (sets of label name-value pairs)
        let table_name = selector.name.as_ref().unwrap();
        let filters: Vec<(String, String)> = selector
            .matchers
            .matchers
            .iter()
            .filter(|mat| mat.op == MatchOp::Equal)
            .map(|mat| (mat.name.clone(), mat.value.clone()))
            .collect();
        let ctx = self
            .table_provider
            .create_context(table_name, (start, end), &filters)
            .await?;
        let table = match ctx.table(table_name).await {
            Ok(v) => v,
            Err(_) => {
                self.metrics_cache
                    .insert(table_name.to_string(), Value::None);
                return Ok(()); // table not found
            }
        };

        let mut df_group = table.clone().filter(
            col(FIELD_TIME)
                .gt(lit(start))
                .and(col(FIELD_TIME).lt_eq(lit(end))),
        )?;
        let regexp_match_udf =
            crate::service::search::datafusion::regexp_udf::REGEX_MATCH_UDF.clone();
        let regexp_not_match_udf =
            crate::service::search::datafusion::regexp_udf::REGEX_NOT_MATCH_UDF.clone();
        for mat in selector.matchers.matchers.iter() {
            match &mat.op {
                MatchOp::Equal => {
                    df_group = df_group.filter(col(mat.name.clone()).eq(lit(mat.value.clone())))?
                }
                MatchOp::NotEqual => {
                    df_group =
                        df_group.filter(col(mat.name.clone()).not_eq(lit(mat.value.clone())))?
                }
                MatchOp::Re(_re) => {
                    df_group = df_group.filter(
                        regexp_match_udf.call(vec![col(mat.name.clone()), lit(mat.value.clone())]),
                    )?
                }
                MatchOp::NotRe(_re) => {
                    df_group = df_group.filter(
                        regexp_not_match_udf
                            .call(vec![col(mat.name.clone()), lit(mat.value.clone())]),
                    )?
                }
            }
        }
        let batches = df_group
            .sort(vec![col(FIELD_TIME).sort(true, true)])?
            .collect()
            .await?;

        let mut metrics: FxHashMap<String, RangeValue> = FxHashMap::default();
        for batch in &batches {
            let hash_values = batch
                .column_by_name(FIELD_HASH)
                .unwrap()
                .as_any()
                .downcast_ref::<StringArray>()
                .unwrap();
            let time_values = batch
                .column_by_name(FIELD_TIME)
                .unwrap()
                .as_any()
                .downcast_ref::<Int64Array>()
                .unwrap();
            let value_values = batch
                .column_by_name(FIELD_VALUE)
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
                        if name == FIELD_HASH || name == FIELD_TIME || name == FIELD_VALUE {
                            continue;
                        }
                        let value = v.as_any().downcast_ref::<StringArray>().unwrap();
                        labels.push(Arc::new(Label {
                            name: name.to_string(),
                            value: value.value(i).to_string(),
                        }));
                    }
                    labels.sort_by(|a, b| a.name.cmp(&b.name));
                    RangeValue {
                        labels,
                        time_range: None,
                        values: Vec::with_capacity(20),
                    }
                });
                entry.values.push(Sample {
                    timestamp: time_values.value(i),
                    value: value_values.value(i),
                });
            }
        }

        // We don't need the primary key (FIELD_HASH) any more
        let mut metric_values = metrics.into_values().collect::<Vec<_>>();

        // TODO fix Extrapolation, it needs reduce by distance
        // https://ihac.xyz/2018/12/11/Prometheus-Extrapolation%E5%8E%9F%E7%90%86%E8%A7%A3%E6%9E%90/

        // Fix data about app restart
        for series in metric_values.iter_mut() {
            if let Some(metric_type) = labels_value(&series.labels, FIELD_TYPE) {
                if metric_type != TYPE_COUNTER {
                    continue;
                }
            }
            let mut delta: f64 = 0.0;
            let mut last_value = 0.0;
            for sample in series.values.iter_mut() {
                if last_value > sample.value {
                    delta += last_value;
                }
                last_value = sample.value;
                if delta > 0.0 {
                    sample.value += delta;
                }
            }
        }

        // cache data
        let values = if metric_values.is_empty() {
            Value::None
        } else {
            Value::Matrix(metric_values)
        };
        self.metrics_cache.insert(table_name.to_string(), values);
        Ok(())
    }

    async fn aggregate_exprs(
        &mut self,
        op: &TokenType,
        expr: &PromExpr,
        param: &Option<Box<PromExpr>>,
        modifier: &Option<LabelModifier>,
    ) -> Result<Value> {
        let sample_time = self.start + (self.interval * self.time_window_idx);
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

    async fn call_expr(&mut self, func: &Function, args: &FunctionArgs) -> Result<Value> {
        use crate::service::promql::functions::Func;

        let func_name = Func::from_str(func.name).map_err(|_| {
            DataFusionError::NotImplemented(format!("Unsupported function: {}", func.name))
        })?;

        let last_arg = args
            .last()
            .expect("BUG: promql-parser should have validated function arguments");
        let input = self.exec_expr(&last_arg).await?;

        Ok(match func_name {
            Func::Abs => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Absent => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::AbsentOverTime => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::AvgOverTime => functions::avg_over_time(&input)?,
            Func::Ceil => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Changes => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Clamp => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::ClampMax => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::ClampMin => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::CountOverTime => functions::count_over_time(&input)?,
            Func::DayOfMonth => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::DayOfWeek => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::DayOfYear => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::DaysInMonth => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Delta => functions::delta(&input)?,
            Func::Deriv => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Exp => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Floor => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
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
                let sample_time = self.start + (self.interval * self.time_window_idx);
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
            Func::Hour => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
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
            Func::Ln => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Log10 => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Log2 => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::MaxOverTime => functions::max_over_time(&input)?,
            Func::MinOverTime => functions::min_over_time(&input)?,
            Func::Minute => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Month => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
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
            Func::Resets => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Round => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Scalar => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Sgn => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
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
            Func::SumOverTime => functions::sum_over_time(&input)?,
            Func::Time => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Timestamp => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Vector => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
            Func::Year => {
                return Err(DataFusionError::NotImplemented(format!(
                    "Unsupported Function: {:?}",
                    func_name
                )));
            }
        })
    }
}

/// Converts `t` to the number of microseconds elapsed since the beginning of the Unix epoch.
fn micros_since_epoch(t: SystemTime) -> i64 {
    micros(
        t.duration_since(UNIX_EPOCH)
            .expect("BUG: {t} is earlier than Unix epoch"),
    )
}

fn micros(t: Duration) -> i64 {
    t.as_micros()
        .try_into()
        .expect("BUG: time value is too large to fit in i64")
}
