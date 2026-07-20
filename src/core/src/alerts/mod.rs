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

use alert::to_float;
use async_trait::async_trait;
use chrono::{Duration, Utc};
use common::utils::conditions::{ConditionExt, ConditionListExt, build_expr};
use config::{
    TIMESTAMP_COL_NAME, ider,
    meta::{
        alerts::{
            AggFunction, AlertConditionParams, Operator, QueryCondition, QueryType,
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
use crate::{
    search::{self as SearchService, utils::is_permissable_function_error},
    self_reporting::http_report_metrics,
    service::setup_tracing_with_trace_id,
};

pub mod alert;
#[cfg(feature = "enterprise")]
pub mod deduplication {
    pub use openobserve_alerts::service::deduplication::*;
}
pub mod derived_streams;
pub mod destinations {
    use async_trait::async_trait;
    use config::meta::destinations::{Destination, Email};
    pub use openobserve_alerts::service::destinations::*;

    struct CoreDestinationReferences;

    #[async_trait]
    impl openobserve_alerts::service::destinations::DestinationReferences
        for CoreDestinationReferences
    {
        async fn user_exists(&self, org_id: &str, email: &str) -> bool {
            crate::db::user::get(Some(org_id), email)
                .await
                .is_ok_and(|user| user.is_some())
        }

        async fn pipeline_using_destination(&self, org_id: &str, name: &str) -> Option<String> {
            crate::db::pipeline::list_by_org(org_id)
                .await
                .ok()?
                .into_iter()
                .find(|pipeline| pipeline.contains_remote_destination(name))
                .map(|pipeline| pipeline.name)
        }

        async fn send_test_email(
            &self,
            subject: &str,
            email: &Email,
            body: String,
        ) -> Result<String, String> {
            super::alert::send_email_notification(subject, email, body)
                .await
                .map_err(|error| error.to_string())
        }
    }

    pub async fn save(
        name: &str,
        destination: Destination,
        create: bool,
    ) -> Result<Destination, openobserve_alerts::repository::destinations::DestinationError> {
        openobserve_alerts::service::destinations::save_with_references(
            name,
            destination,
            create,
            &CoreDestinationReferences,
        )
        .await
    }

    pub async fn test_email(
        org_id: &str,
        recipients: &[String],
        body: Option<&str>,
    ) -> Result<String, openobserve_alerts::repository::destinations::DestinationError> {
        openobserve_alerts::service::destinations::test_email_with_references(
            org_id,
            recipients,
            body,
            &CoreDestinationReferences,
        )
        .await
    }

    pub async fn delete(
        org_id: &str,
        name: &str,
    ) -> Result<(), openobserve_alerts::repository::destinations::DestinationError> {
        openobserve_alerts::service::destinations::delete_with_references(
            org_id,
            name,
            &CoreDestinationReferences,
        )
        .await
    }
}
#[cfg(feature = "enterprise")]
pub mod grouping {
    use async_trait::async_trait;
    use config::{meta::alerts::alert::Alert, utils::json};
    use openobserve_alerts::grouping::{NotificationSender, PendingBatch};

    use super::alert::AlertExt;

    struct CoreNotificationSender;

    #[async_trait]
    impl NotificationSender for CoreNotificationSender {
        async fn send_notification(
            &self,
            alert: &Alert,
            rows: &[json::Map<String, json::Value>],
            rows_end_time: i64,
            start_time: Option<i64>,
            evaluation_timestamp: i64,
        ) -> Result<(String, String), anyhow::Error> {
            Ok(alert
                .send_notification(rows, rows_end_time, start_time, evaluation_timestamp)
                .await?)
        }
    }

    pub async fn send_grouped_notification(batch: PendingBatch) -> Result<(), anyhow::Error> {
        openobserve_alerts::grouping::send_grouped_notification(batch, &CoreNotificationSender)
            .await
    }
}
#[cfg(feature = "enterprise")]
pub mod incidents;
#[cfg(feature = "enterprise")]
pub mod org_config {
    pub use openobserve_alerts::service::org_config::*;
}
pub mod scheduler;
pub mod templates {
    pub use openobserve_alerts::service::templates::*;
}

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
                let values: Vec<_> =
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
                        .collect();

                let threshold = trigger_condition.threshold as usize;
                eval_results.data = match trigger_condition.operator {
                    Operator::EqualTo => (values.len() == threshold).then_some(values),
                    Operator::NotEqualTo => (values.len() != threshold).then_some(values),
                    Operator::GreaterThan => (values.len() > threshold).then_some(values),
                    Operator::GreaterThanEquals => (values.len() >= threshold).then_some(values),
                    Operator::LessThan => (values.len() < threshold).then_some(values),
                    Operator::LessThanEquals => (values.len() <= threshold).then_some(values),
                    _ => None,
                };
                log::info!(
                    "Alert evaluate: trace_id: {trace_id}, PromQL query {v} returned response after filtering: {eval_results:?}"
                );
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
            let encode_query_fn = if let Some(v) = &self.vrl_function {
                match base64::decode_url(v) {
                    Ok(v) => Some(v),
                    Err(e) => {
                        return Err(anyhow::anyhow!(
                            "Error decoding alert vrl query function: {e}"
                        ));
                    }
                }
            } else {
                None
            };
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
                    query_fn: encode_query_fn,
                    skip_wal: false,
                    sampling_config: None,
                    sampling_ratio: None,
                    streaming_output: false,
                    streaming_id: None,
                    histogram_interval: 0,
                    timezone: None,
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
                    agg.having.column,
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
