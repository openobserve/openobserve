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

//! Loads the samples (or exemplars) of a vector selector from DataFusion and
//! attaches the series labels.

use std::sync::Arc;

use config::{
    TIMESTAMP_COL_NAME,
    meta::promql::{
        EXEMPLARS_LABEL, HASH_LABEL, VALUE_LABEL,
        value::{Exemplar, QueryContext, RangeValue, Sample, Samples},
    },
    utils::{
        hash::{Sum64, gxhash},
        json,
    },
};
use datafusion::{
    arrow::{
        array::{Float64Array, Int64Array, StringArray, UInt64Array},
        datatypes::{DataType, Schema},
    },
    error::{DataFusionError, Result},
    logical_expr::utils::disjunction,
    physical_plan::{
        Partitioning, execute_stream_partitioned, expressions::Column, repartition::RepartitionExec,
    },
    prelude::{DataFrame, Expr, SessionContext, col, lit},
};
use futures::TryStreamExt;
use hashbrown::{HashMap, HashSet};
use promql_parser::parser::VectorSelector;

use super::{
    series_labels::attach_series_labels,
    utils::{apply_label_selector, apply_matchers},
};

type TokioResult = tokio::task::JoinHandle<Result<HashMap<u64, Samples>>>;
type TokioExemplarsResult = tokio::task::JoinHandle<Result<HashMap<u64, Vec<Arc<Exemplar>>>>>;

// Constants for optimization thresholds
const OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER: i64 = 5;
const OPTIMIZATION_MAX_STEPS: i64 = 30;

#[allow(clippy::too_many_arguments)]
pub async fn selector_load_data_from_datafusion(
    query_ctx: Arc<QueryContext>,
    ctx: SessionContext,
    schema: Arc<Schema>,
    selector: VectorSelector,
    label_selector: HashSet<String>,
    start: i64,
    end: i64,
    step: i64,
    lookback: i64,
    skip_labels: bool,
) -> Result<HashMap<u64, RangeValue>> {
    let start_time = std::time::Instant::now();
    let table_name = selector.name.as_ref().unwrap();

    let mut df_group = match ctx.table(table_name).await {
        Ok(v) => {
            // Optimization: When step > lookback, we don't need to load all data in
            // [start-lookback, end] Instead, we only need to load data windows around
            // each evaluation point
            let use_optimization = start != end
                && step > 0
                && step >= lookback * OPTIMIZATION_STEP_LOOKBACK_MULTIPLIER
                && (((end - start) / step) + 1) < OPTIMIZATION_MAX_STEPS;
            if use_optimization {
                let num_steps = ((end - start) / step) + 1;
                let eval_timestamps: Vec<i64> =
                    (0..num_steps).map(|i| start + (step * i)).collect();

                let mut conditions: Vec<Expr> = Vec::new();
                for &eval_ts in &eval_timestamps {
                    let window_start = eval_ts - lookback;
                    let window_end = eval_ts;

                    conditions.push(
                        col(TIMESTAMP_COL_NAME)
                            .gt_eq(lit(window_start))
                            .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(window_end))),
                    );
                }

                let filters = disjunction(conditions).unwrap();
                v.filter(filters)?
            } else {
                // Need to include lookback window before start for the first evaluation point
                let query_start = start - lookback;
                v.filter(
                    col(TIMESTAMP_COL_NAME)
                        .gt_eq(lit(query_start))
                        .and(col(TIMESTAMP_COL_NAME).lt_eq(lit(end))),
                )?
            }
        }
        Err(_) => {
            return Ok(HashMap::default());
        }
    };

    df_group = apply_matchers(df_group, &schema, &selector.matchers)?;

    match apply_label_selector(df_group, &schema, &label_selector) {
        Some(dataframe) => df_group = dataframe,
        None => return Ok(HashMap::default()),
    }

    // check if exemplars field is exists
    if query_ctx.query_exemplars {
        let schema = df_group.schema().as_arrow();
        if schema.field_with_name(EXEMPLARS_LABEL).is_err() {
            return Ok(HashMap::default());
        }
    }

    // get label columns
    let mut label_col_names = df_group
        .schema()
        .fields()
        .iter()
        .filter_map(|field| {
            let name = field.name();
            if name == TIMESTAMP_COL_NAME || name == VALUE_LABEL || name == EXEMPLARS_LABEL {
                None
            } else {
                Some(name.to_string())
            }
        })
        .collect::<Vec<_>>();
    // sort labels to have a consistent order
    label_col_names.sort();

    // get hash & timestamp
    let start1 = std::time::Instant::now();
    let hash_field_type = schema.field_with_name(HASH_LABEL)?.data_type();
    let mut metrics = if query_ctx.query_exemplars {
        load_exemplars_from_datafusion(&query_ctx.trace_id, hash_field_type, df_group.clone())
            .await?
    } else {
        load_samples_from_datafusion(&query_ctx.trace_id, hash_field_type, df_group.clone()).await?
    };

    log::info!(
        "[trace_id: {}] load hashing and sample took: {:?}, metrics count: {}",
        query_ctx.trace_id,
        start1.elapsed(),
        metrics.len(),
    );

    // The query provably discards all labels (e.g. `sum(rate(m[5m]))`), so
    // the label scan / cache phase can be skipped entirely.
    if skip_labels {
        log::info!(
            "[trace_id: {}] skip loading labels: query drops all labels",
            query_ctx.trace_id,
        );
        return Ok(metrics);
    }

    attach_series_labels(
        &query_ctx,
        table_name,
        df_group,
        hash_field_type,
        &label_col_names,
        &mut metrics,
    )
    .await?;

    log::info!(
        "[trace_id: {}] load data from datafusion took: {:?}",
        query_ctx.trace_id,
        start_time.elapsed(),
    );

    Ok(metrics)
}

async fn load_samples_from_datafusion(
    trace_id: &str,
    hash_field_type: &DataType,
    df: DataFrame,
) -> Result<HashMap<u64, RangeValue>> {
    let ctx = Arc::new(df.task_ctx());
    let target_partitions = ctx.session_config().target_partitions();
    let plan = df
        .select_columns(&[TIMESTAMP_COL_NAME, HASH_LABEL, VALUE_LABEL])?
        .create_physical_plan()
        .await?;
    let schema = plan.schema();
    let plan = Arc::new(RepartitionExec::try_new(
        plan,
        Partitioning::Hash(
            vec![Arc::new(Column::new_with_schema(HASH_LABEL, &schema)?)],
            target_partitions,
        ),
    )?);

    if config::get_config().common.print_key_sql {
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(trace_id, plan.as_ref())
        );
    }

    let streams = execute_stream_partitioned(plan, ctx)?;
    let mut tasks = Vec::new();
    for mut stream in streams {
        let hash_field_type = hash_field_type.clone();
        let mut series: HashMap<u64, Samples> = HashMap::new();
        let task: TokioResult = tokio::task::spawn(async move {
            loop {
                match stream.try_next().await {
                    Ok(Some(batch)) => {
                        let time_values = batch
                            .column_by_name(TIMESTAMP_COL_NAME)
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

                        if hash_field_type == DataType::UInt64 {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<UInt64Array>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let timestamp = time_values.value(i);
                                let hash: u64 = hash_values.value(i);
                                let entry = series.entry(hash).or_default();
                                entry.push(Sample::new(timestamp, value_values.value(i)));
                            }
                        } else {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<StringArray>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let timestamp = time_values.value(i);
                                let hash: u64 = gxhash::new().sum64(hash_values.value(i));
                                let entry = series.entry(hash).or_default();
                                entry.push(Sample::new(timestamp, value_values.value(i)));
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        log::error!("load samples from datafusion execute stream Error: {e}");
                        return Err(e);
                    }
                }
            }
            Ok(series)
        });
        tasks.push(task);
    }

    // collect results
    let mut metrics: HashMap<u64, RangeValue> = HashMap::new();
    for task in tasks {
        let m = task
            .await
            .map_err(|e| DataFusionError::Execution(e.to_string()))??;
        for (hash, samples) in m {
            metrics.insert(
                hash,
                RangeValue {
                    labels: vec![],
                    samples,
                    exemplars: None,
                    time_window: None,
                },
            );
        }
    }

    Ok(metrics)
}

async fn load_exemplars_from_datafusion(
    trace_id: &str,
    hash_field_type: &DataType,
    df: DataFrame,
) -> Result<HashMap<u64, RangeValue>> {
    let ctx = Arc::new(df.task_ctx());
    let target_partitions = ctx.session_config().target_partitions();
    let plan = df
        .filter(col(EXEMPLARS_LABEL).is_not_null())?
        .select_columns(&[HASH_LABEL, EXEMPLARS_LABEL])?
        .create_physical_plan()
        .await?;
    let schema = plan.schema();
    let plan = Arc::new(RepartitionExec::try_new(
        plan,
        Partitioning::Hash(
            vec![Arc::new(Column::new_with_schema(HASH_LABEL, &schema)?)],
            target_partitions,
        ),
    )?);

    if config::get_config().common.print_key_sql {
        log::info!(
            "{}",
            config::meta::plan::generate_plan_string(trace_id, plan.as_ref())
        );
    }

    let streams = execute_stream_partitioned(plan, ctx)?;
    let mut tasks = Vec::new();
    for mut stream in streams {
        let hash_field_type = hash_field_type.clone();
        let mut series: HashMap<u64, Vec<Arc<Exemplar>>> = HashMap::new();
        let task: TokioExemplarsResult = tokio::task::spawn(async move {
            loop {
                match stream.try_next().await {
                    Ok(Some(batch)) => {
                        let exemplars_values = batch
                            .column_by_name(EXEMPLARS_LABEL)
                            .unwrap()
                            .as_any()
                            .downcast_ref::<StringArray>()
                            .unwrap();
                        if hash_field_type == DataType::UInt64 {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<UInt64Array>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let hash: u64 = hash_values.value(i);
                                let exemplar = exemplars_values.value(i);
                                if let Ok(exemplars) = json::from_str::<Vec<json::Value>>(exemplar)
                                {
                                    let entry = series.entry(hash).or_default();
                                    for exemplar in exemplars {
                                        if let Some(exemplar) = exemplar.as_object() {
                                            entry.push(Arc::new(Exemplar::from(exemplar)));
                                        }
                                    }
                                }
                            }
                        } else {
                            let hash_values = batch
                                .column_by_name(HASH_LABEL)
                                .unwrap()
                                .as_any()
                                .downcast_ref::<StringArray>()
                                .unwrap();
                            for i in 0..batch.num_rows() {
                                let hash: u64 = gxhash::new().sum64(hash_values.value(i));
                                let exemplar = exemplars_values.value(i);
                                if let Ok(exemplars) = json::from_str::<Vec<json::Value>>(exemplar)
                                {
                                    let entry = series.entry(hash).or_default();
                                    for exemplar in exemplars {
                                        if let Some(exemplar) = exemplar.as_object() {
                                            entry.push(Arc::new(Exemplar::from(exemplar)));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Ok(None) => break,
                    Err(e) => {
                        log::error!("load exemplars from datafusion execute stream Error: {e}");
                        return Err(e);
                    }
                }
            }
            Ok(series)
        });
        tasks.push(task);
    }

    // collect results
    let mut metrics: HashMap<u64, RangeValue> = HashMap::new();
    for task in tasks {
        let m = task
            .await
            .map_err(|e| DataFusionError::Execution(e.to_string()))??;
        for (hash, exemplars) in m {
            metrics.insert(
                hash,
                RangeValue {
                    labels: vec![],
                    samples: Samples::default(),
                    exemplars: Some(exemplars),
                    time_window: None,
                },
            );
        }
    }

    Ok(metrics)
}
