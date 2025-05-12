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

use alert::to_float;
use arrow_schema::{DataType, Schema};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use config::{
    TIMESTAMP_COL_NAME, ider,
    meta::{
        alerts::{
            AggFunction, Condition, ConditionList, Operator, QueryCondition, QueryType,
            TriggerCondition, TriggerEvalResults,
        },
        cluster::RoleGroup,
        search::{SearchEventContext, SearchEventType, SqlQuery},
        sql::resolve_stream_names,
        stream::StreamType,
    },
    utils::{
        base64,
        json::{Map, Value},
    },
};
use tracing::Instrument;

use super::promql;
use crate::service::{
    search as SearchService, self_reporting::http_report_metrics, setup_tracing_with_trace_id,
};

pub mod alert;
pub mod derived_streams;
pub mod destinations;
pub mod scheduler;
pub mod templates;

#[async_trait]
pub trait QueryConditionExt: Sync + Send + 'static {
    async fn evaluate_realtime(
        &self,
        row: Option<&Map<String, Value>>,
    ) -> Result<TriggerEvalResults, anyhow::Error>;

    #[allow(clippy::too_many_arguments)]
    async fn evaluate_scheduled(
        &self,
        org_id: &str,
        stream_name: Option<&str>,
        stream_type: StreamType,
        trigger_condition: &TriggerCondition,
        (start_time, end_time): (Option<i64>, i64),
        search_type: Option<SearchEventType>,
        search_event_context: Option<SearchEventContext>,
        trace_id: Option<String>,
    ) -> Result<TriggerEvalResults, anyhow::Error>;
}

#[async_trait]
impl QueryConditionExt for QueryCondition {
    async fn evaluate_realtime(
        &self,
        row: Option<&Map<String, Value>>,
    ) -> Result<TriggerEvalResults, anyhow::Error> {
        let now = Utc::now().timestamp_micros();
        let mut eval_results = TriggerEvalResults {
            end_time: now,
            ..Default::default()
        };
        let row = match row {
            Some(row) => row,
            None => {
                return Ok(eval_results);
            }
        };
        if self.conditions.is_none() {
            return Ok(eval_results);
        }
        let conditions = self.conditions.as_ref().unwrap();
        if !conditions.evaluate(row).await {
            return Ok(eval_results);
        }
        eval_results.data = Some(vec![row.to_owned()]);
        return Ok(eval_results);
    }

    async fn evaluate_scheduled(
        &self,
        org_id: &str,
        stream_name: Option<&str>,
        stream_type: StreamType,
        trigger_condition: &TriggerCondition,
        (start_time, end_time): (Option<i64>, i64),
        search_type: Option<SearchEventType>,
        search_event_context: Option<SearchEventContext>,
        trace_id: Option<String>,
    ) -> Result<TriggerEvalResults, anyhow::Error> {
        let trace_id = trace_id.unwrap_or_else(ider::generate_trace_id);
        // create context with trace_id
        let eval_span = setup_tracing_with_trace_id(
            &trace_id,
            tracing::info_span!("service:alerts:evaluate_scheduled"),
        )
        .await;

        let mut eval_results = TriggerEvalResults {
            end_time,
            ..Default::default()
        };
        let sql = match self.query_type {
            QueryType::Custom => {
                let (Some(stream_name), Some(v)) = (stream_name, self.conditions.as_ref()) else {
                    // CustomQuery type needs to provide source StreamName.
                    // CustomQuery is only used by Alerts' triggers.
                    return Ok(eval_results);
                };
                build_sql(org_id, stream_name, stream_type, self, v).await?
            }
            QueryType::SQL => {
                let Some(v) = self.sql.as_ref() else {
                    return Ok(eval_results);
                };
                if v.is_empty() {
                    return Ok(eval_results);
                } else {
                    v.to_string()
                }
            }
            QueryType::PromQL => {
                let Some(v) = self.promql.as_ref() else {
                    return Ok(eval_results);
                };
                if v.is_empty() {
                    return Ok(eval_results);
                }
                let start = if let Some(start_time) = start_time {
                    start_time
                } else {
                    end_time
                        - Duration::try_minutes(trigger_condition.period)
                            .unwrap()
                            .num_microseconds()
                            .unwrap()
                };
                let end = end_time;
                let condition = self.promql_condition.as_ref().unwrap();
                let req = promql::MetricsQueryRequest {
                    query: format!(
                        "({}) {} {}",
                        v,
                        match &condition.operator {
                            &Operator::EqualTo => "==".to_string(),
                            _ => condition.operator.to_string(),
                        },
                        to_float(&condition.value)
                    ),
                    start,
                    end,
                    step: std::cmp::max(
                        promql::micros(promql::MINIMAL_INTERVAL),
                        (end - start) / promql::MAX_DATA_POINTS,
                    ),
                    query_exemplars: false,
                    no_cache: None,
                };
                let resp = match promql::search::search(&trace_id, org_id, &req, "", 0).await {
                    Ok(v) => v,
                    Err(_) => {
                        return Ok(eval_results);
                    }
                };
                let promql::value::Value::Matrix(value) = resp else {
                    log::warn!(
                        "Alert evaluate: trace_id: {trace_id}, PromQL query {} returned unexpected response: {:?}",
                        v,
                        resp
                    );
                    return Ok(eval_results);
                };
                // TODO calculate the sample in a row, suddenly a sample can be ignored
                let value = value
                    .into_iter()
                    .filter(|f| f.samples.len() >= trigger_condition.threshold as usize)
                    .collect::<Vec<_>>();
                if !value.is_empty() {
                    eval_results.data = Some(
                        value
                            .iter()
                            .map(|v| {
                                let mut val = Map::with_capacity(v.labels.len() + 2);
                                for label in v.labels.iter() {
                                    val.insert(
                                        label.name.to_string(),
                                        label.value.to_string().into(),
                                    );
                                }
                                let last_sample = v.samples.last().unwrap();
                                val.insert("_timestamp".to_string(), last_sample.timestamp.into());
                                val.insert("value".to_string(), last_sample.value.into());
                                val
                            })
                            .collect(),
                    );
                }
                return Ok(eval_results);
            }
        };

        let stream_names = match resolve_stream_names(&sql) {
            Ok(stream_names) => stream_names,
            Err(e) => {
                return Err(anyhow::anyhow!(
                    "Error resolving stream names in SQL query: {e}"
                ));
            }
        };

        // SQL may contain multiple stream names, check for each stream
        // if the query period is greater than the max query range
        for stream in stream_names.iter() {
            if let Some(settings) = infra::schema::get_settings(org_id, stream, stream_type).await {
                let max_query_range = settings.max_query_range;
                if max_query_range > 0 && trigger_condition.period > max_query_range * 60 {
                    return Err(anyhow::anyhow!(
                        "Query period is greater than max query range of {max_query_range} hours for stream \"{stream}\""
                    ));
                }
            }
        }

        let mut time_diff = Duration::try_minutes(trigger_condition.period)
            .unwrap()
            .num_microseconds()
            .unwrap();
        let start_time = if let Some(start_time) = start_time {
            time_diff = end_time - start_time;
            Some(start_time)
        } else {
            Some(end_time - time_diff)
        };
        let size = if self.search_event_type.is_some() {
            -1
        } else {
            std::cmp::max(100, trigger_condition.threshold)
        };

        let req_start = std::time::Instant::now();
        let resp = if self.multi_time_range.is_some()
            && !self.multi_time_range.as_ref().unwrap().is_empty()
        {
            let req = config::meta::search::MultiStreamRequest {
                sql: {
                    let mut sqls =
                        Vec::with_capacity(self.multi_time_range.as_ref().unwrap().len() + 1);
                    sqls.push(SqlQuery {
                        sql: sql.clone(),
                        start_time,
                        end_time: Some(end_time),
                        query_fn: None,
                        is_old_format: false,
                    });
                    for timerange in self.multi_time_range.as_ref().unwrap() {
                        let (offset, unit) = timerange.offset.split_at(timerange.offset.len() - 1);
                        // Default is 1 if parsing fails
                        let offset = offset.parse::<i64>().unwrap_or(1);
                        let end_time = match unit {
                            "h" => {
                                end_time
                                    - Duration::try_hours(offset)
                                        .unwrap()
                                        .num_microseconds()
                                        .unwrap()
                            }
                            "d" => {
                                end_time
                                    - Duration::try_days(offset)
                                        .unwrap()
                                        .num_microseconds()
                                        .unwrap()
                            }
                            "w" => {
                                end_time
                                    - Duration::try_weeks(offset)
                                        .unwrap()
                                        .num_microseconds()
                                        .unwrap()
                            }
                            "M" => {
                                end_time
                                    - Duration::try_days(offset * 30)
                                        .unwrap()
                                        .num_microseconds()
                                        .unwrap()
                            }
                            // Default to minutes
                            _ => {
                                end_time
                                    - Duration::try_minutes(offset)
                                        .unwrap()
                                        .num_microseconds()
                                        .unwrap()
                            }
                        };
                        sqls.push(SqlQuery {
                            sql: sql.clone(),
                            start_time: Some(end_time - time_diff),
                            end_time: Some(end_time),
                            query_fn: None,
                            is_old_format: false,
                        });
                    }
                    sqls
                },
                encoding: config::meta::search::RequestEncoding::Empty,
                regions: vec![],
                clusters: vec![],
                timeout: 0,
                search_type,
                search_event_context,
                from: 0,
                size,
                start_time: 0, // ignored
                end_time: 0,   // ignored
                sort_by: None,
                quick_mode: false,
                track_total_hits: false,
                query_type: "".to_string(),
                uses_zo_fn: false,
                query_fn: self.vrl_function.clone(),
                skip_wal: false,
                index_type: "".to_string(),
                per_query_response: false, // Will return results in single array
            };
            log::debug!(
                "evaluate_scheduled trace_id: {trace_id}, begin to call SearchService::search_multi, {:?}",
                req
            );
            SearchService::grpc_search::grpc_search_multi(
                &trace_id,
                org_id,
                stream_type,
                None,
                &req,
                Some(RoleGroup::Background),
            )
            .instrument(eval_span)
            .await
            // SearchService::search_multi(&trace_id, org_id, stream_type, None, &req).await
        } else {
            // fire the query
            let req = config::meta::search::Request {
                query: config::meta::search::Query {
                    sql: sql.clone(),
                    from: 0,
                    size,
                    start_time: start_time.unwrap(),
                    end_time,
                    quick_mode: false,
                    query_type: "".to_string(),
                    track_total_hits: false,
                    action_id: None,
                    uses_zo_fn: false,
                    query_fn: if self.vrl_function.is_some() {
                        match base64::decode_url(self.vrl_function.as_ref().unwrap()) {
                            Ok(query_fn) => Some(query_fn),
                            Err(e) => {
                                return Err(anyhow::anyhow!(
                                    "Error decoding alert vrl query function: {e}" /* TODO: update
                                                                                    * error msg */
                                ));
                            }
                        }
                    } else {
                        None
                    },
                    skip_wal: false,
                    streaming_output: false,
                    streaming_id: None,
                },
                encoding: config::meta::search::RequestEncoding::Empty,
                regions: vec![],
                clusters: vec![],
                timeout: 0,
                search_type,
                search_event_context,
                use_cache: None,
                local_mode: None,
            };
            log::debug!(
                "evaluate_scheduled trace_id: {trace_id}, begin to call SearchService::search, {:?}",
                req
            );
            // SearchService::search(&trace_id, org_id, stream_type, None, &req).await
            SearchService::grpc_search::grpc_search(
                &trace_id,
                org_id,
                stream_type,
                None,
                &req,
                Some(RoleGroup::Background),
            )
            .instrument(eval_span)
            .await
        };

        // Resp hits can be of two types -
        // 1. Vec<Map<String, Value>> - for normal alert
        // 2. Vec<Vec<Map<String, Value>>> - for multi_time_range alert
        let resp = match resp {
            Ok(v) => {
                // the search request doesn't via cache layer, so need report usage separately
                http_report_metrics(
                    req_start,
                    org_id,
                    stream_type,
                    "200",
                    "_search",
                    &SearchEventType::Alerts.to_string(),
                    "",
                );
                if v.is_partial {
                    return Err(anyhow::anyhow!(
                        "Partial response: {}",
                        v.function_error.join(", ")
                    ));
                } else {
                    v
                }
            }
            Err(e) => {
                if let infra::errors::Error::ErrorCode(e) = e {
                    return Err(anyhow::anyhow!(
                        "{} {}",
                        e.get_message(),
                        e.get_inner_message()
                    ));
                } else {
                    return Err(anyhow::anyhow!("{}", e));
                }
            }
        };
        let mut records = vec![];
        resp.hits.iter().for_each(|hit| {
            match hit {
                Value::Object(hit) => records.push(hit.clone()),
                // For multi timerange alerts, the hits can be an array of hits
                Value::Array(hits) => hits.iter().for_each(|hit| {
                    if let Value::Object(hit) = hit {
                        records.push(hit.clone());
                    }
                }),
                _ => {}
            }
        });
        log::debug!(
            "alert trace_id: {trace_id}, resp hits len:{:#?}",
            records.len()
        );
        eval_results.query_took = Some(resp.took as i64);
        eval_results.data = if self.search_event_type.is_none() {
            let threshold = trigger_condition.threshold as usize;
            match trigger_condition.operator {
                Operator::EqualTo => (records.len() == threshold).then_some(records),
                Operator::NotEqualTo => (records.len() != threshold).then_some(records),
                Operator::GreaterThan => (records.len() > threshold).then_some(records),
                Operator::GreaterThanEquals => (records.len() >= threshold).then_some(records),
                Operator::LessThan => (records.len() < threshold).then_some(records),
                Operator::LessThanEquals => (records.len() <= threshold).then_some(records),
                _ => None,
            }
        } else {
            Some(records)
        };

        Ok(eval_results)
    }
}

#[async_trait]
pub trait ConditionListExt: Sync + Send + 'static {
    async fn len(&self) -> u32;
    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error>;
    async fn is_empty(&self) -> bool;
}

#[async_trait]
impl ConditionListExt for ConditionList {
    /// Returns end node count of a Condition list
    async fn len(&self) -> u32 {
        match self {
            ConditionList::OrNode { or: conditions }
            | ConditionList::AndNode { and: conditions } => {
                let mut count = 0;
                for condition in conditions.iter() {
                    count += condition.len().await
                }
                count
            }
            ConditionList::NotNode { not: inner } => inner.len().await,
            ConditionList::EndCondition(_) => 1,
            ConditionList::LegacyConditions(conditions) => conditions.len() as u32,
        }
    }

    /// Converts Condition list to SQL query as per schema
    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        match self {
            ConditionList::OrNode { or: conditions } => {
                let mut cond_sql_list = Vec::new();
                for condition in conditions.iter() {
                    cond_sql_list.push(condition.to_sql(schema).await?);
                }
                Ok(format!("({})", cond_sql_list.join(" OR ")))
            }
            ConditionList::LegacyConditions(conditions) => {
                let mut cond_sql_list = Vec::new();
                for cond in conditions {
                    let data_type = match schema.field_with_name(&cond.column) {
                        Ok(field) => field.data_type(),
                        Err(_) => {
                            return Err(anyhow::anyhow!("Column {} not found", &cond.column,));
                        }
                    };
                    cond_sql_list.push(build_expr(cond, "", data_type)?);
                }
                Ok(format!("({})", cond_sql_list.join(" AND ")))
            }
            ConditionList::AndNode { and: conditions } => {
                let mut cond_sql_list = Vec::new();
                for condition in conditions.iter() {
                    cond_sql_list.push(condition.to_sql(schema).await?);
                }
                Ok(format!("({})", cond_sql_list.join(" AND ")))
            }
            ConditionList::NotNode { not: inner } => {
                Ok(format!("NOT ({})", inner.to_sql(schema).await?))
            }
            ConditionList::EndCondition(node) => {
                let data_type = match schema.field_with_name(&node.column) {
                    Ok(field) => field.data_type(),
                    Err(_) => {
                        return Err(anyhow::anyhow!("Column {} not found", &node.column,));
                    }
                };
                build_expr(node, "", data_type)
            }
        }
    }

    async fn is_empty(&self) -> bool {
        match self {
            ConditionList::OrNode { or: conditions } => {
                for condition in conditions.iter() {
                    if condition.is_empty().await {
                        return true;
                    }
                }
                false
            }
            ConditionList::AndNode { and: conditions } => {
                for condition in conditions.iter() {
                    if !condition.is_empty().await {
                        return false;
                    }
                }
                true
            }
            ConditionList::NotNode { not: inner } => inner.is_empty().await,
            ConditionList::LegacyConditions(conditions) => conditions.is_empty(),
            ConditionList::EndCondition(_) => false,
        }
    }
}

#[async_trait]
pub trait ConditionExt: Sync + Send + 'static {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool;
}

#[async_trait]
impl ConditionExt for ConditionList {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            ConditionList::OrNode { or: conditions } => {
                let mut eval = false;
                for condition in conditions {
                    eval = eval || condition.evaluate(row).await
                }
                eval
            }
            ConditionList::LegacyConditions(conditions) => {
                let mut eval = true;
                for condition in conditions {
                    eval = eval && condition.evaluate(row).await
                }
                eval
            }
            ConditionList::AndNode { and: conditions } => {
                let mut eval = true;
                for condition in conditions {
                    eval = eval && condition.evaluate(row).await
                }
                eval
            }
            ConditionList::NotNode { not: conditions } => !conditions.evaluate(row).await,
            ConditionList::EndCondition(condition) => condition.evaluate(row).await,
        }
    }
}

#[async_trait]
impl ConditionExt for Condition {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        let val = match row.get(&self.column) {
            Some(val) => val,
            None => {
                return false;
            }
        };
        match val {
            Value::String(v) => {
                let val = v.as_str();
                let con_val = self.value.as_str().unwrap_or_default();
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    Operator::GreaterThan => val > con_val,
                    Operator::GreaterThanEquals => val >= con_val,
                    Operator::LessThan => val < con_val,
                    Operator::LessThanEquals => val <= con_val,
                    Operator::Contains => val.contains(con_val),
                    Operator::NotContains => !val.contains(con_val),
                }
            }
            Value::Number(_) => {
                let val = val.as_f64().unwrap_or_default();
                let con_val = if self.value.is_number() {
                    self.value.as_f64().unwrap_or_default()
                } else {
                    self.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .unwrap_or_default()
                };
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    Operator::GreaterThan => val > con_val,
                    Operator::GreaterThanEquals => val >= con_val,
                    Operator::LessThan => val < con_val,
                    Operator::LessThanEquals => val <= con_val,
                    _ => false,
                }
            }
            Value::Bool(v) => {
                let val = v.to_owned();
                let con_val = if self.value.is_boolean() {
                    self.value.as_bool().unwrap_or_default()
                } else {
                    self.value
                        .as_str()
                        .unwrap_or_default()
                        .parse()
                        .unwrap_or_default()
                };
                match self.operator {
                    Operator::EqualTo => val == con_val,
                    Operator::NotEqualTo => val != con_val,
                    _ => false,
                }
            }
            _ => false,
        }
    }
}

async fn build_sql(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    query_condition: &QueryCondition,
    conditions: &ConditionList,
) -> Result<String, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let where_sql = conditions
        .to_sql(&schema)
        .await
        .map_err(|err| anyhow::anyhow!("Error building SQL on stream {}: {}", &stream_name, err))?;
    if query_condition.aggregation.is_none() {
        return Ok(format!(
            "SELECT * FROM \"{}\" WHERE {}",
            stream_name, where_sql
        ));
    }

    // handle aggregation
    let mut sql = String::new();
    let agg = query_condition.aggregation.as_ref().unwrap();
    let having_expr = {
        let data_type = match schema.field_with_name(&agg.having.column) {
            Ok(field) => field.data_type(),
            Err(_) => {
                return Err(anyhow::anyhow!(
                    "Aggregation column {} not found on stream {}",
                    &agg.having.column,
                    &stream_name
                ));
            }
        };
        build_expr(&agg.having, "alert_agg_value", data_type)?
    };

    let func_expr = match agg.function {
        AggFunction::Avg => format!("AVG(\"{}\")", agg.having.column),
        AggFunction::Max => format!("MAX(\"{}\")", agg.having.column),
        AggFunction::Min => format!("MIN(\"{}\")", agg.having.column),
        AggFunction::Sum => format!("SUM(\"{}\")", agg.having.column),
        AggFunction::Count => format!("COUNT(\"{}\")", agg.having.column),
        AggFunction::Median => format!("MEDIAN(\"{}\")", agg.having.column),
        AggFunction::P50 => format!("approx_percentile_cont(\"{}\", 0.5)", agg.having.column),
        AggFunction::P75 => format!("approx_percentile_cont(\"{}\", 0.75)", agg.having.column),
        AggFunction::P90 => format!("approx_percentile_cont(\"{}\", 0.9)", agg.having.column),
        AggFunction::P95 => format!("approx_percentile_cont(\"{}\", 0.95)", agg.having.column),
        AggFunction::P99 => format!("approx_percentile_cont(\"{}\", 0.99)", agg.having.column),
    };

    if let Some(group) = agg.group_by.as_ref() {
        if !group.is_empty() {
            sql = format!(
                "SELECT {}, {} AS alert_agg_value, MIN({}) as zo_sql_min_time, MAX({}) AS zo_sql_max_time FROM \"{}\" {} GROUP BY {} HAVING {}",
                group.join(", "),
                func_expr,
                TIMESTAMP_COL_NAME,
                TIMESTAMP_COL_NAME,
                stream_name,
                where_sql,
                group.join(", "),
                having_expr
            );
        }
    }
    if sql.is_empty() {
        sql = format!(
            "SELECT {} AS alert_agg_value, MIN({}) as zo_sql_min_time, MAX({}) AS zo_sql_max_time FROM \"{}\" {} HAVING {}",
            func_expr, TIMESTAMP_COL_NAME, TIMESTAMP_COL_NAME, stream_name, where_sql, having_expr
        );
    }
    Ok(sql)
}

fn build_expr(
    cond: &Condition,
    field_alias: &str,
    field_type: &DataType,
) -> Result<String, anyhow::Error> {
    let field_alias = if !field_alias.is_empty() {
        field_alias
    } else {
        cond.column.as_str()
    };
    let expr = match field_type {
        DataType::Utf8 => {
            let val = if cond.value.is_string() {
                cond.value.as_str().unwrap_or_default().to_string()
            } else {
                cond.value.to_string()
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} '{}'", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} '{}'", field_alias, "!=", val),
                Operator::GreaterThan => format!("\"{}\" {} '{}'", field_alias, ">", val),
                Operator::GreaterThanEquals => {
                    format!("\"{}\" {} '{}'", field_alias, ">=", val)
                }
                Operator::LessThan => format!("\"{}\" {} '{}'", field_alias, "<", val),
                Operator::LessThanEquals => format!("\"{}\" {} '{}'", field_alias, "<=", val),
                Operator::Contains => format!("\"{}\" {} '%{}%'", field_alias, "LIKE", val),
                Operator::NotContains => {
                    format!("\"{}\" {} '%{}%'", field_alias, "NOT LIKE", val)
                }
            }
        }
        DataType::Int16 | DataType::Int32 | DataType::Int64 => {
            let val = if cond.value.is_number() {
                cond.value.as_i64().unwrap_or_default()
            } else {
                cond.value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "Column [{}] dataType is [{}] but value is [{}], err: {}",
                            cond.column,
                            field_type,
                            cond.value,
                            e
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} {}", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} {}", field_alias, "!=", val),
                Operator::GreaterThan => format!("\"{}\" {} {}", field_alias, ">", val),
                Operator::GreaterThanEquals => {
                    format!("\"{}\" {} {}", field_alias, ">=", val)
                }
                Operator::LessThan => format!("\"{}\" {} {}", field_alias, "<", val),
                Operator::LessThanEquals => {
                    format!("\"{}\" {} {}", field_alias, "<=", val)
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        field_type,
                        cond.operator
                    ));
                }
            }
        }
        DataType::Float32 | DataType::Float64 => {
            let val = if cond.value.is_number() {
                cond.value.as_f64().unwrap_or_default()
            } else {
                cond.value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "Column [{}] dataType is [{}] but value is [{}], err: {}",
                            cond.column,
                            field_type,
                            cond.value,
                            e
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} {}", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} {}", field_alias, "!=", val),
                Operator::GreaterThan => format!("\"{}\" {} {}", field_alias, ">", val),
                Operator::GreaterThanEquals => {
                    format!("\"{}\" {} {}", field_alias, ">=", val)
                }
                Operator::LessThan => format!("\"{}\" {} {}", field_alias, "<", val),
                Operator::LessThanEquals => {
                    format!("\"{}\" {} {}", field_alias, "<=", val)
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        field_type,
                        cond.operator
                    ));
                }
            }
        }
        DataType::Boolean => {
            let val = if cond.value.is_boolean() {
                cond.value.as_bool().unwrap_or_default()
            } else {
                cond.value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .map_err(|e| {
                        anyhow::anyhow!(
                            "Column [{}] dataType is [{}] but value is [{}], err: {}",
                            cond.column,
                            field_type,
                            cond.value,
                            e
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{}\" {} {}", field_alias, "=", val),
                Operator::NotEqualTo => format!("\"{}\" {} {}", field_alias, "!=", val),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{}] and it does not supported operator [{:?}]",
                        cond.column,
                        field_type,
                        cond.operator
                    ));
                }
            }
        }
        _ => {
            return Err(anyhow::anyhow!(
                "Column {} has data_type [{}] and it does not supported by alert, if you think this is a bug please report it to us",
                cond.column,
                field_type
            ));
        }
    };
    Ok(expr)
}
