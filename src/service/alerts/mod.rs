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
            AggFunction, AlertConditionParams, Condition, ConditionList, Operator, QueryCondition,
            QueryType, TriggerCondition, TriggerEvalResults,
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
    search::{self as SearchService, utils::is_permissable_function_error},
    self_reporting::http_report_metrics,
    setup_tracing_with_trace_id,
};

pub mod alert;
pub mod backfill;
#[cfg(feature = "enterprise")]
pub mod deduplication;
pub mod derived_streams;
pub mod destinations;
#[cfg(feature = "enterprise")]
pub mod grouping;
#[cfg(feature = "enterprise")]
pub mod incidents;
#[cfg(feature = "enterprise")]
pub mod org_config;
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
                    use_cache: None,
                    search_type: Some(SearchEventType::Alerts),
                    regions: vec![],
                    clusters: vec![],
                };
                // check super cluster
                #[cfg(not(feature = "enterprise"))]
                let is_super_cluster = false;
                #[cfg(feature = "enterprise")]
                let is_super_cluster = o2_enterprise::enterprise::common::config::get_config()
                    .super_cluster
                    .enabled;
                let resp =
                    match promql::search::search(&trace_id, org_id, &req, "", 0, is_super_cluster)
                        .await
                    {
                        Ok(v) => v,
                        Err(_) => {
                            return Ok(eval_results);
                        }
                    };
                let config::meta::promql::value::Value::Matrix(value) = resp else {
                    log::warn!(
                        "Alert evaluate: trace_id: {trace_id}, PromQL query {v} returned unexpected response: {resp:?}"
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
                                val.extend(v.labels.iter().map(|label| {
                                    (label.name.to_string(), label.value.to_string().into())
                                }));

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

        let stream_names = resolve_stream_names(&sql)
            .map_err(|e| anyhow::anyhow!("Error resolving stream names in SQL query: {e}"))?;

        // SQL may contain multiple stream names, check for each stream
        // if the query period is greater than the max query range
        for stream in stream_names.iter() {
            if infra::schema::get_stream_schema_from_cache(org_id, stream, stream_type)
                .await
                .is_none()
            {
                return Err(anyhow::anyhow!(
                    "Stream \"{stream}\" not found in schema, skipping alert evaluation"
                ));
            };

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
        let resp = if self
            .multi_time_range
            .as_ref()
            .is_some_and(|mtr| !mtr.is_empty())
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
                "evaluate_scheduled trace_id: {trace_id}, begin to call SearchService::search_multi, {req:?}"
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
                    sampling_config: None,
                    sampling_ratio: None,
                    streaming_output: false,
                    streaming_id: None,
                    histogram_interval: 0,
                },
                encoding: config::meta::search::RequestEncoding::Empty,
                regions: vec![],
                clusters: vec![],
                timeout: 0,
                search_type,
                search_event_context,
                use_cache: false,
                clear_cache: false,
                local_mode: None,
            };
            log::debug!(
                "evaluate_scheduled trace_id: {trace_id}, begin to call SearchService::search, {req:?}"
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
            Ok(mut v) => {
                // Check if function error is only query limit default error
                if is_permissable_function_error(&v.function_error) {
                    v.function_error.clear();
                    v.is_partial = false;
                }

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
                            return Err(anyhow::anyhow!("Column {} not found", &cond.column));
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
                        return Err(anyhow::anyhow!("Column {} not found", &node.column));
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
                let con_val = self.value.as_str().unwrap_or_default().trim_matches('"');
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
            Value::Null => {
                matches!(self.operator, Operator::EqualTo)
                    && matches!(&self.value, Value::String(v) if v == "null")
            }
            _ => false,
        }
    }
}

// Trait implementations for AlertConditionParams to support both v1 and v2
#[async_trait]
impl ConditionExt for AlertConditionParams {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            AlertConditionParams::V1(conditions) => conditions.evaluate(row).await,
            AlertConditionParams::V2(conditions) => conditions.evaluate(row).await,
        }
    }
}

#[async_trait]
impl ConditionListExt for AlertConditionParams {
    async fn len(&self) -> u32 {
        match self {
            AlertConditionParams::V1(conditions) => conditions.len().await,
            AlertConditionParams::V2(conditions) => conditions.conditions.len() as u32,
        }
    }

    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        match self {
            AlertConditionParams::V1(conditions) => conditions.to_sql(schema).await,
            AlertConditionParams::V2(conditions) => conditions.to_sql(schema).await,
        }
    }

    async fn is_empty(&self) -> bool {
        match self {
            AlertConditionParams::V1(conditions) => conditions.is_empty().await,
            AlertConditionParams::V2(conditions) => conditions.conditions.is_empty(),
        }
    }
}

// Trait and implementation for ConditionGroup (V2 format)
#[async_trait]
pub trait ConditionGroupExt: Sync + Send + 'static {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool;
    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error>;
}

#[async_trait]
impl ConditionGroupExt for config::meta::alerts::ConditionGroup {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        evaluate_condition_items(&self.conditions, row).await
    }

    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        if self.conditions.is_empty() {
            return Ok("".to_string());
        }

        // Convert items to SQL left-to-right with operators
        let mut sql_parts = Vec::new();
        for item in &self.conditions {
            sql_parts.push(condition_item_to_sql(item, schema).await?);
        }

        // Apply logical operators left-to-right
        // The logicalOperator on an item indicates the operator that comes BEFORE that item
        if sql_parts.len() == 1 {
            return Ok(format!("({})", sql_parts[0]));
        }

        let mut result = sql_parts[0].clone();
        for (item, item_sql) in self.conditions.iter().skip(1).zip(sql_parts.iter().skip(1)) {
            // Use the current item's logical operator (it indicates the operator before this item)
            // Concatenate with the operator, relying on SQL operator precedence
            match item.logical_operator() {
                config::meta::alerts::LogicalOperator::And => {
                    result = format!("{} AND {}", result, item_sql);
                }
                config::meta::alerts::LogicalOperator::Or => {
                    result = format!("{} OR {}", result, item_sql);
                }
            }
        }

        // Wrap the entire result in parentheses at the end
        Ok(format!("({})", result))
    }
}

// Trait implementation for ConditionItem
#[async_trait]
impl ConditionGroupExt for config::meta::alerts::ConditionItem {
    async fn evaluate(&self, row: &Map<String, Value>) -> bool {
        match self {
            config::meta::alerts::ConditionItem::Condition {
                column,
                operator,
                value,
                ignore_case,
                ..
            } => {
                evaluate_condition(row, column, operator, value, ignore_case.unwrap_or(false)).await
            }
            config::meta::alerts::ConditionItem::Group { conditions, .. } => {
                evaluate_condition_items(conditions, row).await
            }
        }
    }

    async fn to_sql(&self, schema: &Schema) -> Result<String, anyhow::Error> {
        condition_item_to_sql(self, schema).await
    }
}

/// Evaluates a list of condition items with left-to-right logical operator application
///
/// Algorithm:
/// 1. Start with the first item's evaluation result
/// 2. For each subsequent item:
///    - Evaluate the item
///    - Apply the previous item's logical_operator to combine results
/// 3. Continue left-to-right until all items processed
///
/// Example: [A AND, B OR, C AND]
/// - result = eval(A)
/// - result = result AND eval(B)  // Apply A's operator
/// - result = result OR eval(C)   // Apply B's operator
async fn evaluate_condition_items(
    items: &[config::meta::alerts::ConditionItem],
    row: &Map<String, Value>,
) -> bool {
    if items.is_empty() {
        return true;
    }

    // Evaluate with operator precedence: AND before OR (matching SQL semantics)
    // The logicalOperator on an item indicates the operator that comes BEFORE that item

    // First, evaluate all items
    let mut results = Vec::new();
    let mut operators = Vec::new();

    for (i, item) in items.iter().enumerate() {
        results.push(item.evaluate(row).await);
        if i > 0 {
            operators.push(item.logical_operator());
        }
    }

    // Phase 1: Process all AND operations first (higher precedence)
    let mut i = 0;
    while i < operators.len() {
        if matches!(operators[i], config::meta::alerts::LogicalOperator::And) {
            // Combine results[i] AND results[i+1]
            results[i] = results[i] && results[i + 1];
            results.remove(i + 1);
            operators.remove(i);
            // Don't increment i, check same position again
        } else {
            i += 1;
        }
    }

    // Phase 2: Process all OR operations (lower precedence)
    // After phase 1, only OR operators should remain
    let mut result = results[0];
    for res in results.iter().skip(1) {
        result = result || *res;
    }

    result
}

/// Evaluates a single condition against a record
async fn evaluate_condition(
    row: &Map<String, Value>,
    column: &str,
    operator: &Operator,
    condition_value: &Value,
    ignore_case: bool,
) -> bool {
    let val: &Value = match row.get(column) {
        Some(val) => val,
        None => {
            return false;
        }
    };

    match val {
        Value::String(v) => {
            let val = v.as_str();
            let con_val = condition_value.as_str().unwrap_or_default();

            // Handle case-insensitive comparison
            if ignore_case {
                let val_lower = val.to_lowercase();
                let con_val_lower = con_val.to_lowercase();
                match operator {
                    Operator::EqualTo => val_lower == con_val_lower,
                    Operator::NotEqualTo => val_lower != con_val_lower,
                    Operator::GreaterThan => val_lower > con_val_lower,
                    Operator::GreaterThanEquals => val_lower >= con_val_lower,
                    Operator::LessThan => val_lower < con_val_lower,
                    Operator::LessThanEquals => val_lower <= con_val_lower,
                    Operator::Contains => val_lower.contains(&con_val_lower),
                    Operator::NotContains => !val_lower.contains(&con_val_lower),
                }
            } else {
                match operator {
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
        }
        Value::Number(_) => {
            let val = val.as_f64().unwrap_or_default();
            let con_val = if condition_value.is_number() {
                condition_value.as_f64().unwrap_or_default()
            } else {
                condition_value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .unwrap_or_default()
            };
            match operator {
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
            let val = *v;
            let con_val = if condition_value.is_boolean() {
                condition_value.as_bool().unwrap_or_default()
            } else {
                condition_value
                    .as_str()
                    .unwrap_or_default()
                    .parse()
                    .unwrap_or_default()
            };
            match operator {
                Operator::EqualTo => val == con_val,
                Operator::NotEqualTo => val != con_val,
                _ => false,
            }
        }
        _ => false,
    }
}

// Helper function to convert a ConditionItem to SQL
async fn condition_item_to_sql(
    item: &config::meta::alerts::ConditionItem,
    schema: &Schema,
) -> Result<String, anyhow::Error> {
    match item {
        config::meta::alerts::ConditionItem::Condition {
            column,
            operator,
            value,
            ignore_case,
            ..
        } => {
            // Create a Condition struct to use with build_expr
            let condition = config::meta::alerts::Condition {
                column: column.clone(),
                operator: *operator,
                value: value.clone(),
                ignore_case: ignore_case.unwrap_or(false),
            };

            let data_type = match schema.field_with_name(&condition.column) {
                Ok(field) => field.data_type(),
                Err(_) => {
                    return Err(anyhow::anyhow!("Column {} not found", &condition.column));
                }
            };

            build_expr(&condition, "", data_type)
        }
        config::meta::alerts::ConditionItem::Group {
            conditions,
            logical_operator,
        } => {
            // Recursively handle nested group
            let nested_group = config::meta::alerts::ConditionGroup {
                filter_type: "group".to_string(),
                logical_operator: *logical_operator,
                conditions: conditions.clone(),
            };
            nested_group.to_sql(schema).await
        }
    }
}

pub async fn build_sql(
    org_id: &str,
    stream_name: &str,
    stream_type: StreamType,
    query_condition: &QueryCondition,
    conditions: &AlertConditionParams,
) -> Result<String, anyhow::Error> {
    let schema = infra::schema::get(org_id, stream_name, stream_type).await?;
    let where_sql = if conditions.len().await == 0 {
        "".to_string()
    } else {
        format!(
            " WHERE {}",
            conditions
                .to_sql(&schema)
                .await
                .map_err(|err| anyhow::anyhow!(
                    "Error building SQL on stream {stream_name}: {err}"
                ))?
        )
    };
    if query_condition.aggregation.is_none() {
        return Ok(format!("SELECT * FROM \"{stream_name}\" {where_sql}"));
    };

    // handle aggregation
    let mut sql = String::new();
    let agg = query_condition.aggregation.as_ref().unwrap();
    let having_expr = {
        let data_type = match schema.field_with_name(&agg.having.column) {
            Ok(field) => field.data_type(),
            Err(_) => {
                return Err(anyhow::anyhow!(
                    "Aggregation column {} not found on stream {stream_name}",
                    &agg.having.column,
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
        AggFunction::P50 => format!(
            "approx_percentile_cont(0.5) WITHIN GROUP (ORDER BY \"{}\")",
            agg.having.column
        ),
        AggFunction::P75 => format!(
            "approx_percentile_cont(0.75) WITHIN GROUP (ORDER BY \"{}\")",
            agg.having.column
        ),
        AggFunction::P90 => format!(
            "approx_percentile_cont(0.9) WITHIN GROUP (ORDER BY \"{}\")",
            agg.having.column
        ),
        AggFunction::P95 => format!(
            "approx_percentile_cont(0.95) WITHIN GROUP (ORDER BY \"{}\")",
            agg.having.column
        ),
        AggFunction::P99 => format!(
            "approx_percentile_cont(0.99) WITHIN GROUP (ORDER BY \"{}\")",
            agg.having.column
        ),
    };

    if let Some(group) = agg.group_by.as_ref()
        && !group.is_empty()
    {
        sql = format!(
            "SELECT {}, {func_expr} AS alert_agg_value, MIN({TIMESTAMP_COL_NAME}) as zo_sql_min_time, MAX({TIMESTAMP_COL_NAME}) AS zo_sql_max_time FROM \"{stream_name}\"{where_sql} GROUP BY {} HAVING {having_expr}",
            group.join(", "),
            group.join(", "),
        );
    }
    if sql.is_empty() {
        sql = format!(
            "SELECT {func_expr} AS alert_agg_value, MIN({TIMESTAMP_COL_NAME}) as zo_sql_min_time, MAX({TIMESTAMP_COL_NAME}) AS zo_sql_max_time FROM \"{stream_name}\"{where_sql} HAVING {having_expr}"
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
        DataType::Utf8 | DataType::LargeUtf8 => {
            let val = if cond.value.is_string() {
                cond.value.as_str().unwrap_or_default().to_string()
            } else {
                cond.value.to_string()
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = '{val}'"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != '{val}'"),
                Operator::GreaterThan => format!("\"{field_alias}\" > '{val}'"),
                Operator::GreaterThanEquals => {
                    format!("\"{field_alias}\" >= '{val}'")
                }
                Operator::LessThan => format!("\"{field_alias}\" < '{val}'"),
                Operator::LessThanEquals => format!("\"{field_alias}\" <= '{val}'"),
                Operator::Contains => format!("str_match(\"{field_alias}\", '{val}')"),
                Operator::NotContains => {
                    format!("\"{field_alias}\" NOT LIKE '%{val}%'")
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
                            "Column [{}] dataType is [{field_type}] but value is [{}], err: {e}",
                            cond.column,
                            cond.value,
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = {val}"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != {val}"),
                Operator::GreaterThan => format!("\"{field_alias}\" > {val}"),
                Operator::GreaterThanEquals => {
                    format!("\"{field_alias}\" >= {val}")
                }
                Operator::LessThan => format!("\"{field_alias}\" < {val}"),
                Operator::LessThanEquals => {
                    format!("\"{field_alias}\" <= {val}")
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{field_type}] and it does not supported operator [{:?}]",
                        cond.column,
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
                            "Column [{}] dataType is [{field_type}] but value is [{}], err: {e}",
                            cond.column,
                            cond.value,
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = {val}"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != {val}"),
                Operator::GreaterThan => format!("\"{field_alias}\" > {val}"),
                Operator::GreaterThanEquals => {
                    format!("\"{field_alias}\" >= {val}")
                }
                Operator::LessThan => format!("\"{field_alias}\" < {val}"),
                Operator::LessThanEquals => {
                    format!("\"{field_alias}\" <= {val}")
                }
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{field_type}] and it does not supported operator [{:?}]",
                        cond.column,
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
                            "Column [{}] dataType is [{field_type}] but value is [{}], err: {e}",
                            cond.column,
                            cond.value,
                        )
                    })?
            };
            match cond.operator {
                Operator::EqualTo => format!("\"{field_alias}\" = {val}"),
                Operator::NotEqualTo => format!("\"{field_alias}\" != {val}"),
                _ => {
                    return Err(anyhow::anyhow!(
                        "Column {} has data_type [{field_type}] and it does not supported operator [{:?}]",
                        cond.column,
                        cond.operator
                    ));
                }
            }
        }
        _ => {
            return Err(anyhow::anyhow!(
                "Column {} has data_type [{field_type}] and it does not supported by alert, if you think this is a bug please report it to us",
                cond.column,
            ));
        }
    };
    Ok(expr)
}

#[cfg(test)]
mod tests {
    use arrow_schema::{DataType, Field, Schema};
    use config::{
        meta::alerts::{ConditionGroup, ConditionItem, LogicalOperator, Operator},
        utils::json::Value,
    };

    use super::*;

    #[tokio::test]
    async fn test_condition_group_to_sql_simple() {
        // Create a simple schema
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("service", DataType::Utf8, false),
        ]);

        // Create a simple condition group: level = 'error' AND service = 'api'
        // Remember: the logicalOperator on an item comes BEFORE that item
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                },
                ConditionItem::Condition {
                    column: "service".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Should produce: ("level" = 'error' AND "service" = 'api')
        assert_eq!(sql, "(\"level\" = 'error' AND \"service\" = 'api')");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_with_or() {
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]);

        // Create condition group: level = 'error' OR status = 'critical'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                },
                ConditionItem::Condition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("critical".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR before this item
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Should produce: ("level" = 'error' OR "status" = 'critical')
        assert_eq!(sql, "(\"level\" = 'error' OR \"status\" = 'critical')");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_nested_groups() {
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("service", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
        ]);

        // Create nested condition group:
        // level = 'error' AND (service = 'api' OR service = 'web')
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                },
                ConditionItem::Group {
                    logical_operator: LogicalOperator::And, // AND before this group
                    conditions: vec![
                        ConditionItem::Condition {
                            column: "service".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("api".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, /* Not used (first item in
                                                                     * group) */
                        },
                        ConditionItem::Condition {
                            column: "service".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("web".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::Or, // OR before this item
                        },
                    ],
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Exact SQL match for nested group:
        // level = 'error' AND (service = 'api' OR service = 'web')
        assert_eq!(
            sql,
            "(\"level\" = 'error' AND (\"service\" = 'api' OR \"service\" = 'web'))"
        );
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_numeric_conditions() {
        let schema = Schema::new(vec![
            Field::new("count", DataType::Int64, false),
            Field::new("temperature", DataType::Float64, false),
        ]);

        // Create condition group: count > 100 AND temperature >= 50.5
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "count".to_string(),
                    operator: Operator::GreaterThan,
                    value: Value::Number(serde_json::Number::from(100)),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                },
                ConditionItem::Condition {
                    column: "temperature".to_string(),
                    operator: Operator::GreaterThanEquals,
                    value: Value::Number(serde_json::Number::from_f64(50.5).unwrap()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Should produce: ("count" > 100 AND "temperature" >= 50.5)
        assert_eq!(sql, "(\"count\" > 100 AND \"temperature\" >= 50.5)");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_contains_operator() {
        let schema = Schema::new(vec![Field::new("message", DataType::Utf8, false)]);

        // Create condition group with Contains operator
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![ConditionItem::Condition {
                column: "message".to_string(),
                operator: Operator::Contains,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            }],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Contains should generate str_match function
        assert_eq!(sql, "(str_match(\"message\", 'error'))");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_empty_conditions() {
        let schema = Schema::new(Vec::<Field>::new());

        // Empty condition group should return empty string
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();
        assert_eq!(sql, "");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_single_condition() {
        let schema = Schema::new(vec![Field::new("level", DataType::Utf8, false)]);

        // Single condition should be wrapped in parentheses
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![ConditionItem::Condition {
                column: "level".to_string(),
                operator: Operator::EqualTo,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            }],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        assert_eq!(sql, "(\"level\" = 'error')");
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_mixed_and_or_same_level() {
        let schema = Schema::new(vec![
            Field::new("level", DataType::Utf8, false),
            Field::new("status", DataType::Utf8, false),
            Field::new("service", DataType::Utf8, false),
        ]);

        // Create condition group with mixed operators at same level:
        // level = 'error' AND status = 'active' OR service = 'api'
        // This tests left-to-right evaluation: (level = 'error' AND status = 'active') OR service =
        // 'api'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                },
                ConditionItem::Condition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("active".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                },
                ConditionItem::Condition {
                    column: "service".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR before this item
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();

        // Verify evaluation with operator precedence (AND before OR)
        // level = 'error' AND status = 'active' OR service = 'api'
        // SQL operator precedence will parse this as: (level = 'error' AND status = 'active') OR
        // service = 'api'
        assert_eq!(
            sql,
            "(\"level\" = 'error' AND \"status\" = 'active' OR \"service\" = 'api')"
        );
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_missing_column() {
        let schema = Schema::new(vec![Field::new("level", DataType::Utf8, false)]);

        // Reference non-existent column
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![ConditionItem::Condition {
                column: "nonexistent".to_string(),
                operator: Operator::EqualTo,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            }],
        };

        let result = condition_group.to_sql(&schema).await;

        assert!(result.is_err());
        assert!(
            result
                .unwrap_err()
                .to_string()
                .contains("Column nonexistent not found")
        );
    }

    #[tokio::test]
    async fn test_condition_group_evaluate_complex() {
        use config::utils::json::json;

        use crate::service::alerts::ConditionGroupExt;

        // Test the condition: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test'
        // AND kubernetes_host = 'test2') With proper Group logic structure
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Ignored because next is Group
                },
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or, // OR before this group
                    conditions: vec![
                        ConditionItem::Condition {
                            column: "kubernetes_container_image".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        },
                        ConditionItem::Condition {
                            column: "kubernetes_host".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test2".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        },
                    ],
                },
            ],
        };

        // Test case 1: Data that should NOT pass (none of the conditions match)
        let test_data_fail = json!({
            "kubernetes_docker_id": "tes123t",
            "kubernetes_container_image": "test1234",
            "kubernetes_host": "test2",
            "log": "request id : camelcase"
        });
        let result = condition_group
            .evaluate(test_data_fail.as_object().unwrap())
            .await;
        assert!(
            !result,
            "Should NOT pass: kubernetes_docker_id doesn't match, and kubernetes_container_image doesn't match"
        );

        // Test case 2: Data that should pass (first condition matches)
        let test_data_pass1 = json!({
            "kubernetes_docker_id": "test",
            "kubernetes_container_image": "anything",
            "kubernetes_host": "anything"
        });
        let result = condition_group
            .evaluate(test_data_pass1.as_object().unwrap())
            .await;
        assert!(
            result,
            "Should pass: first condition matches (kubernetes_docker_id = 'test')"
        );

        // Test case 3: Data that should pass (nested group matches)
        let test_data_pass2 = json!({
            "kubernetes_docker_id": "something_else",
            "kubernetes_container_image": "test",
            "kubernetes_host": "test2"
        });
        let result = condition_group
            .evaluate(test_data_pass2.as_object().unwrap())
            .await;
        assert!(
            result,
            "Should pass: nested group matches (kubernetes_container_image = 'test' AND kubernetes_host = 'test2')"
        );

        // Test case 4: Data that should NOT pass (only one condition in nested group matches)
        let test_data_fail2 = json!({
            "kubernetes_docker_id": "something_else",
            "kubernetes_container_image": "test",
            "kubernetes_host": "wrong_host"
        });
        let result = condition_group
            .evaluate(test_data_fail2.as_object().unwrap())
            .await;
        assert!(
            !result,
            "Should NOT pass: only kubernetes_container_image matches, but kubernetes_host doesn't"
        );
    }

    #[tokio::test]
    async fn test_condition_group_evaluate_with_nested_group() {
        use config::utils::json::json;

        use crate::service::alerts::ConditionGroupExt;

        // Test evaluation with nested group: kubernetes_docker_id = 'test' OR
        // (kubernetes_container_image = 'test' AND kubernetes_host = 'test2') Structure:
        // - kubernetes_docker_id = 'test' [OR with next]
        // - A group containing: (kubernetes_container_image = 'test' AND kubernetes_host = 'test2')

        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR with next item
                },
                ConditionItem::Group {
                    logical_operator: LogicalOperator::And, // AND inside the group
                    conditions: vec![
                        ConditionItem::Condition {
                            column: "kubernetes_container_image".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // AND with next in group
                        },
                        ConditionItem::Condition {
                            column: "kubernetes_host".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test2".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        },
                    ],
                },
            ],
        };

        // Test with the data from the conversation
        let test_data = json!({
            "kubernetes_docker_id": "tes123t",
            "kubernetes_container_image": "test1234",
            "kubernetes_host": "test2"
        });

        let result = condition_group
            .evaluate(test_data.as_object().unwrap())
            .await;

        // Evaluation: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test' AND
        // kubernetes_host = 'test2') = FALSE OR (FALSE AND TRUE)
        // = FALSE OR FALSE
        // = FALSE
        assert!(
            !result,
            "Should NOT PASS: kubernetes_docker_id doesn't match, and in the group only kubernetes_host matches (need both)"
        );

        println!("Test data: {:?}", test_data);
        println!("Evaluation result: {} (should be false)", result);
    }

    #[tokio::test]
    async fn test_condition_group_to_sql_complex_with_nested_group() {
        use arrow_schema::{DataType, Field, Schema};

        use crate::service::alerts::ConditionGroupExt;

        let schema = Schema::new(vec![
            Field::new("kubernetes_docker_id", DataType::Utf8, false),
            Field::new("kubernetes_container_image", DataType::Utf8, false),
            Field::new("kubernetes_host", DataType::Utf8, false),
        ]);

        // Test SQL generation with nested group and mixed operators
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or,
                    conditions: vec![ConditionItem::Condition {
                        column: "kubernetes_container_image".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("test".to_string()),
                        ignore_case: None,
                        logical_operator: LogicalOperator::And,
                    }],
                },
                ConditionItem::Condition {
                    column: "kubernetes_host".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test2".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
            ],
        };

        let sql = condition_group.to_sql(&schema).await.unwrap();
        println!("Generated SQL: {}", sql);

        // Verify the generated SQL has correct operator placement
        assert!(sql.contains("OR") && sql.contains("AND"));
    }

    #[tokio::test]
    async fn test_condition_group_evaluate_operator_precedence() {
        use config::utils::json::json;

        use crate::service::alerts::ConditionGroupExt;

        // Test operator precedence: A OR (B) AND C should evaluate as A OR ((B) AND C)
        // Structure: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test') AND
        // kubernetes_host = 'test2'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or,
                    conditions: vec![ConditionItem::Condition {
                        column: "kubernetes_container_image".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("test".to_string()),
                        ignore_case: None,
                        logical_operator: LogicalOperator::And,
                    }],
                },
                ConditionItem::Condition {
                    column: "kubernetes_host".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test2".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                },
            ],
        };

        // Test with the data from the conversation - should NOT pass
        let test_data_fail = json!({
            "kubernetes_docker_id": "tes123t",
            "kubernetes_container_image": "test1234",
            "kubernetes_host": "test2"
        });

        let result = condition_group
            .evaluate(test_data_fail.as_object().unwrap())
            .await;

        // With the fix:
        // - Between Item0 and Group: use Group's operator = OR
        // - kubernetes_docker_id = 'test' -> false
        // - Group (kubernetes_container_image = 'test') -> false
        // - result = false OR false = false
        //
        // Wait, we still need to process Item2 (kubernetes_host)...
        // Let me trace through:
        // - i=0: result = kubernetes_docker_id = 'test' = false next = Group =
        //   kubernetes_container_image = 'test' = false operator = Group's OR result = false OR
        //   false = false
        // - i=1: result = false (from above) next = kubernetes_host = 'test2' = true operator =
        //   Group.conditions[0].logicalOperator = AND result = false AND true = false
        //
        // Hmm, this gives false, but we need to think about what the Group's internal condition's
        // operator means...

        println!("Test data: {:?}", test_data_fail);
        println!("Evaluation result: {} (should be false)", result);

        assert!(!result, "Should NOT PASS: neither condition matches");

        // Test case where kubernetes_docker_id matches (should PASS with OR precedence)
        let test_data_docker_id_matches = json!({
            "kubernetes_docker_id": "test",
            "kubernetes_container_image": "wrong",
            "kubernetes_host": "wrong"
        });

        let result2 = condition_group
            .evaluate(test_data_docker_id_matches.as_object().unwrap())
            .await;

        println!("\nTest with docker_id matching:");
        println!("Test data: {:?}", test_data_docker_id_matches);
        println!("Evaluation result: {} (should be true)", result2);

        // SQL: (kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test' AND
        // kubernetes_host = 'test2')) = (TRUE OR (FALSE AND FALSE)) = TRUE
        assert!(result2, "Should PASS when kubernetes_docker_id matches");
    }

    #[tokio::test]
    async fn test_deeply_nested_groups_with_precedence() {
        use config::utils::json::json;

        use crate::service::alerts::ConditionGroupExt;

        // Complex nested structure: A OR (B AND C OR (D AND E)) AND F
        // This tests: nested groups + operator precedence at multiple levels
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition {
                    column: "A".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("match".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first)
                },
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or, // OR before this group
                    conditions: vec![
                        ConditionItem::Condition {
                            column: "B".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("match".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // Not used (first in group)
                        },
                        ConditionItem::Condition {
                            column: "C".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("match".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // AND before this
                        },
                        ConditionItem::Group {
                            logical_operator: LogicalOperator::Or, // OR before this nested group
                            conditions: vec![
                                ConditionItem::Condition {
                                    column: "D".to_string(),
                                    operator: Operator::EqualTo,
                                    value: Value::String("match".to_string()),
                                    ignore_case: None,
                                    logical_operator: LogicalOperator::And,
                                },
                                ConditionItem::Condition {
                                    column: "E".to_string(),
                                    operator: Operator::EqualTo,
                                    value: Value::String("match".to_string()),
                                    ignore_case: None,
                                    logical_operator: LogicalOperator::And, // AND before this
                                },
                            ],
                        },
                    ],
                },
                ConditionItem::Condition {
                    column: "F".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("match".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this
                },
            ],
        };

        // Test case 1: Only A matches
        // A OR (B AND C OR (D AND E)) AND F
        // = TRUE OR (FALSE AND FALSE OR (FALSE AND FALSE)) AND FALSE
        // = TRUE OR (FALSE OR FALSE) AND FALSE
        // = TRUE OR FALSE AND FALSE
        // With precedence: TRUE OR (FALSE AND FALSE)
        // = TRUE OR FALSE = TRUE ✓
        let test1 = json!({"A": "match", "B": "no", "C": "no", "D": "no", "E": "no", "F": "no"});
        assert!(
            condition_group.evaluate(test1.as_object().unwrap()).await,
            "Should PASS: A matches, and there's OR before the group"
        );

        // Test case 2: D and E match (inner nested group), and F matches
        // A OR (B AND C OR (D AND E)) AND F
        // = FALSE OR (FALSE AND FALSE OR (TRUE AND TRUE)) AND TRUE
        // = FALSE OR (FALSE OR TRUE) AND TRUE
        // = FALSE OR TRUE AND TRUE
        // With precedence: FALSE OR (TRUE AND TRUE)
        // = FALSE OR TRUE = TRUE ✓
        let test2 =
            json!({"A": "no", "B": "no", "C": "no", "D": "match", "E": "match", "F": "match"});
        assert!(
            condition_group.evaluate(test2.as_object().unwrap()).await,
            "Should PASS: Inner nested group (D AND E) matches, plus F matches"
        );

        // Test case 3: B and C match, and F matches
        // A OR (B AND C OR (D AND E)) AND F
        // = FALSE OR (TRUE AND TRUE OR (FALSE AND FALSE)) AND TRUE
        // = FALSE OR (TRUE OR FALSE) AND TRUE
        // = FALSE OR TRUE AND TRUE
        // With precedence: FALSE OR (TRUE AND TRUE)
        // = FALSE OR TRUE = TRUE ✓
        let test3 =
            json!({"A": "no", "B": "match", "C": "match", "D": "no", "E": "no", "F": "match"});
        assert!(
            condition_group.evaluate(test3.as_object().unwrap()).await,
            "Should PASS: B AND C match, plus F matches"
        );

        // Test case 4: Only F matches (should fail)
        // A OR (B AND C OR (D AND E)) AND F
        // = FALSE OR (FALSE AND FALSE OR (FALSE AND FALSE)) AND TRUE
        // = FALSE OR (FALSE OR FALSE) AND TRUE
        // = FALSE OR FALSE AND TRUE
        // With precedence: FALSE OR (FALSE AND TRUE)
        // = FALSE OR FALSE = FALSE ✓
        let test4 = json!({"A": "no", "B": "no", "C": "no", "D": "no", "E": "no", "F": "match"});
        assert!(
            !condition_group.evaluate(test4.as_object().unwrap()).await,
            "Should FAIL: Only F matches, but the OR part fails"
        );

        println!("✓ All deeply nested group tests with operator precedence passed!");
    }
}
