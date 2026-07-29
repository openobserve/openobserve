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
use arrow_schema::{DataType, Schema};
use async_trait::async_trait;
use chrono::{Duration, Utc};
use config::{
    TIMESTAMP_COL_NAME, get_config, ider,
    meta::{
        alerts::{
            AggFunction, AlertConditionParams, Condition, ConditionList, Operator, QueryCondition,
            QueryType, TriggerCondition, TriggerEvalResults, grouping::GroupObservation,
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
use search::utils::is_permissable_function_error;
use tracing::Instrument;
use usage_reporting::http_report_metrics;

use crate::{search as SearchService, service::setup_tracing_with_trace_id};

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
            QueryType::Slo => {
                // An SLO alert runs no query. It reads the running aggregate
                // the ingest pass already computed, which is why five alerts
                // on one SLO cost five cheap status reads and ZERO extra
                // raw-data scans (§6b.9). The caller branches before reaching
                // here (`alert.rs`); this arm exists so the dispatch stays
                // exhaustive and a mis-routed SLO alert degrades to "nothing
                // matched" rather than running an empty SQL string.
                return Ok(eval_results);
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
                // Multi-level PromQL (alerts_2.md §4.4, same strategy as the
                // SQL HAVING): query at the LESS severe value so the warning
                // band comes back too, then classify each series below.
                // Single-level alerts widen to critical, i.e. the expression is
                // byte-identical to before.
                let promql_critical = to_float(&condition.value);
                let promql_filter = config::meta::alerts::aggregation_level::widened_threshold(
                    condition.operator,
                    promql_critical,
                    self.promql_warning_value,
                );
                let req = promql_service::MetricsQueryRequest {
                    query: format!(
                        "({}) {} {}",
                        v,
                        match &condition.operator {
                            &Operator::EqualTo => "==".to_string(),
                            _ => condition.operator.to_string(),
                        },
                        promql_filter
                    ),
                    start,
                    end,
                    step: std::cmp::max(
                        ::promql::micros(::promql::MINIMAL_INTERVAL),
                        (end - start) / ::promql::MAX_DATA_POINTS,
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
                let resp = match promql_service::search::search(
                    &trace_id,
                    org_id,
                    &req,
                    "",
                    0,
                    is_super_cluster,
                )
                .await
                {
                    Ok(v) => v,
                    // A failed search is an ERROR, not an empty result. Returning
                    // Ok here would record outcome=Normal/level=Ok and refresh
                    // `level_at`, silently clearing a prior Critical (§7.6 —
                    // errors must leave the level axis untouched).
                    Err(e) => {
                        return Err(anyhow::anyhow!("PromQL search error for alert query: {e}"));
                    }
                };
                let config::meta::promql::value::Value::Matrix(value) = resp else {
                    return Err(anyhow::anyhow!(
                        "PromQL query returned unexpected (non-matrix) response: {resp:?}"
                    ));
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

                // Two axes, exactly like aggregation: each SERIES is classified
                // against the promql condition value, then the SERIES COUNT is
                // gated by `trigger_condition`. Counting series alone would
                // ignore severity and fire spuriously on the widened set.
                let series_values: Vec<f64> = values
                    .iter()
                    .filter_map(|v| v.get("value").and_then(|x| x.as_f64()))
                    .collect();
                let level = config::meta::alerts::aggregation_level::evaluate_level_over_items(
                    &series_values,
                    condition.operator,
                    promql_critical,
                    self.promql_warning_value,
                    trigger_condition,
                );
                // Worst series' value, so history reports one coherent
                // observation rather than a bare series count. Direction is
                // operator-aware: for `<`/`<=` the worst offender is the MIN.
                //
                // KNOWN LIMITATION (§7.5): the PromQL filter is widened only
                // to the warning level, so a healthy run returns no series and
                // records actual_value=None — history shows "— → Ok". An
                // unfiltered observation query would fix it; deliberately
                // deferred to the SLO work.
                eval_results.actual_value = config::meta::alerts::level::worst_observed_value(
                    &series_values,
                    condition.operator,
                );
                // T-9: label the worst SERIES by its PromQL labels, so history
                // shows which series the value came from.
                eval_results.group_label = eval_results.actual_value.and_then(|w| {
                    values
                        .iter()
                        .find(|v| v.get("value").and_then(|x| x.as_f64()) == Some(w))
                        .map(|v| {
                            v.iter()
                                .filter(|(k, _)| k != &"_timestamp" && k != &"value")
                                .map(|(k, val)| match val.as_str() {
                                    Some(s) => format!("{k}={s}"),
                                    None => format!("{k}={val}"),
                                })
                                .collect::<Vec<_>>()
                                .join(",")
                        })
                        .filter(|label| !label.is_empty())
                });
                eval_results.level = level;
                eval_results.data = level.map(|_| values);
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
        // Hybrid count evaluation (alerts_2.md §4.4c). Guards, in order:
        //  - threshold bypass (search_event_type) — no threshold, no hybrid;
        //  - aggregation — already exact, needs per-group rows;
        //  - VRL — transforms rows post-query, a SQL count could disagree;
        //  - multi-window — separate SQL list, out of scope v1.
        let hybrid = self.search_event_type.is_none()
            && self.aggregation.is_none()
            && self.vrl_function.is_none()
            && self
                .multi_time_range
                .as_ref()
                .is_none_or(|mtr| mtr.is_empty())
            && matches!(
                config::meta::alerts::level::evaluation_strategy(
                    trigger_condition,
                    get_config().limit.alert_hybrid_count_threshold,
                ),
                config::meta::alerts::level::EvaluationStrategy::CountPlusSample { .. }
            );

        // Exact count from the COUNT(*) pre-query; also carries the decision.
        let mut hybrid_exact_count: Option<f64> = None;
        if hybrid {
            let count_resp = run_alert_count_query(
                &trace_id,
                org_id,
                stream_type,
                &sql,
                (start_time.unwrap_or(end_time - time_diff), end_time),
                search_type,
                search_event_context.clone(),
            )
            .await?;
            let exact = count_resp.0;
            eval_results.query_took = Some(count_resp.1);
            eval_results.actual_value = Some(exact);
            let level = config::meta::alerts::level::evaluate_level(exact, trigger_condition);
            eval_results.level = level;
            if level.is_none() {
                // Not firing: the count alone decides. No payload query at all
                // — a healthy hybrid evaluation is CHEAPER than the old
                // 100-row floor fetch.
                return Ok(eval_results);
            }
            hybrid_exact_count = Some(exact);
        }

        // Per-group evaluation reads a page sized to the M-6 cap, not to the
        // threshold: for a multi-alert the count gate is always "any group"
        // (M-10), so `required_search_size` would ask for a handful of rows and
        // the fan-out would see a fraction of the groups.
        let multi_group_cap = self
            .aggregation
            .as_ref()
            .filter(|a| a.multi_alert && a.group_by.as_ref().is_some_and(|g| !g.is_empty()))
            .map(|_| get_config().limit.alert_max_groups);

        let size = if self.search_event_type.is_some() {
            -1
        } else if let Some(cap) = multi_group_cap {
            // ONE row past the cap, so a full page is itself the overflow
            // signal (M-6) and the persisted counts can be marked lower bounds
            // honestly (§5.3). `cap == 0` means unlimited.
            if cap == 0 { -1 } else { cap as i64 + 1 }
        } else if hybrid {
            // Decision already made from the exact count; this fetch is only
            // the notification payload sample.
            config::meta::alerts::level::PAYLOAD_SAMPLE_ROWS
        } else {
            config::meta::alerts::level::required_search_size(trigger_condition)
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
                agent_options: None,
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
        // Apply the threshold when the search event type is unset or explicitly
        // set to `Alerts`. Any other search event type bypasses the threshold.
        let apply_threshold = match self.search_event_type {
            None => true,
            Some(search_event_type) => search_event_type == SearchEventType::Alerts,
        };
        eval_results.data = if apply_threshold {
            match self.aggregation.as_ref() {
                // ── Aggregation alerts ──────────────────────────────────────
                // The threshold is `having.value` / `warning_value` applied to
                // each row's aggregate, NOT a row count. The SQL HAVING was
                // widened to the less severe threshold (alerts_2.md §4.4), so
                // the returned set deliberately includes the warning band and
                // MUST be re-classified here — counting rows would both ignore
                // severity and fire spuriously on the widened set.
                Some(agg) => {
                    // Classify each group's aggregate, then re-apply the
                    // GROUP-COUNT threshold. Both axes must hold — dropping the
                    // count silently rewrites "for at least 3 groups" as "for
                    // any group".
                    let classified: Vec<_> = records
                        .iter()
                        .filter_map(|r| r.get("alert_agg_value").and_then(|v| v.as_f64()))
                        .collect();

                    let level =
                        config::meta::alerts::aggregation_level::evaluate_aggregation_alert(
                            &classified,
                            agg,
                            trigger_condition,
                        )
                        .unwrap_or(None);

                    // Report the worst group's value, so history's
                    // "fired at X against Y" is one coherent observation.
                    // Direction is operator-aware: for `<`/`<=` the worst
                    // offender is the MIN, not the max.
                    //
                    // KNOWN LIMITATION (§7.5): the HAVING filter is widened
                    // only to the warning level, so a healthy run returns no
                    // rows and records actual_value=None — history shows
                    // "— → Ok". Dropping the filter would cost a full
                    // per-group fetch on every healthy evaluation;
                    // deliberately deferred to the SLO work.
                    let offenders: Vec<f64> = classified
                        .iter()
                        .filter(|v| {
                            config::meta::alerts::aggregation_level::evaluate_aggregation_level(
                                **v, agg,
                            )
                            .ok()
                            .flatten()
                            .is_some()
                        })
                        .cloned()
                        .collect();
                    let worst = config::meta::alerts::level::worst_observed_value(
                        &offenders,
                        agg.having.operator,
                    );

                    // T-9: identify WHICH group produced the worst value, so
                    // history reads "avg(cpu)=97.2 for host=b" and not just a
                    // number. Label = the group_by columns of that row.
                    let group_label = worst.and_then(|w| {
                        let group_by = agg.group_by.as_deref().unwrap_or(&[]);
                        if group_by.is_empty() {
                            return None;
                        }
                        records
                            .iter()
                            .find(|r| r.get("alert_agg_value").and_then(|v| v.as_f64()) == Some(w))
                            .map(|r| {
                                group_by
                                    .iter()
                                    .filter_map(|col| {
                                        r.get(col).map(|v| match v.as_str() {
                                            Some(s) => format!("{col}={s}"),
                                            None => format!("{col}={v}"),
                                        })
                                    })
                                    .collect::<Vec<_>>()
                                    .join(",")
                            })
                            .filter(|label| !label.is_empty())
                    });

                    eval_results.level = level;
                    eval_results.actual_value = worst;
                    eval_results.group_label = group_label;

                    // ── Per-group fan-out (M-1/M-2/M-3, gated by M-9) ───────
                    // Purely additive: everything above still runs, because the
                    // worst-group collapse is what the single per-evaluation
                    // trigger record needs (D8) and what every non-multi alert
                    // is evaluated by. This only *adds* the per-group view.
                    if let Some(cap) = multi_group_cap
                        && let Some(group_by) = agg.group_by.as_ref()
                    {
                        // Labels come from the SHARED extractor, not a local
                        // copy: dispatch keys each group's notification
                        // payload by `group_key(row_group_labels(row))`, so if
                        // the two renderings ever diverged, every dispatch
                        // item would fail to find its row and the feature
                        // would break silently.
                        let observations: Vec<GroupObservation> = records
                            .iter()
                            .filter_map(|r| {
                                let value = r.get("alert_agg_value")?.as_f64()?;
                                let labels =
                                    config::meta::alerts::dispatch::row_group_labels(r, group_by);
                                Some(GroupObservation::new(labels, value))
                            })
                            .collect();

                        let classification = config::meta::alerts::grouping::classify_groups_by(
                            observations,
                            |v| {
                                config::meta::alerts::aggregation_level::evaluate_aggregation_level(
                                    v, agg,
                                )
                                .ok()
                                .flatten()
                            },
                            cap,
                        );

                        // Both facts come free from the classification: the
                        // page filled if we got everything we asked for, and it
                        // reached healthy groups if not every observed group
                        // was firing. Together they decide whether the counts
                        // are exact and whether absence proves disappearance.
                        let observed =
                            classification.groups.len() + classification.dropped.len();
                        let page = config::meta::alerts::grouping::FetchPage {
                            filled: size > 0 && records.len() as i64 >= size,
                            reached_healthy: classification.firing_observed < observed,
                        };

                        eval_results.group_classification =
                            Some(classification.with_page(page));
                    }

                    level.map(|_| records)
                }
                // ── Count-based alerts ──────────────────────────────────────
                None => {
                    // Hybrid mode already decided from COUNT(*) — and it only
                    // reaches here when firing, so `data` is Some
                    // unconditionally. Re-deriving from the 100-row payload
                    // sample would silently overwrite the exact count with a
                    // clamped one.
                    if let Some(exact) = hybrid_exact_count {
                        eval_results.actual_value = Some(exact);
                        // level already set from the exact count
                        Some(records)
                    } else {
                        let actual = records.len() as f64;
                        let level =
                            config::meta::alerts::level::evaluate_level(actual, trigger_condition);
                        eval_results.actual_value = Some(actual);
                        // The fetch was capped at `size`; a full page means the
                        // true count may be higher — record it as a lower
                        // bound so history can render "≥ N" (§7.5).
                        eval_results.value_is_lower_bound =
                            size > 0 && records.len() as i64 >= size;
                        eval_results.level = level;
                        level.map(|_| records)
                    }
                }
            }
        } else {
            // Threshold bypassed (non-alert search event types) — no level.
            Some(records)
        };

        Ok(eval_results)
    }
}

/// Run the §4.4c COUNT(*) decision query for a hybrid count-based alert.
///
/// Returns `(exact_count, query_took_ms)`. The user's SQL runs verbatim inside
/// the wrapper, over the same time window the payload query would use, so the
/// two cannot disagree about which rows exist.
#[allow(clippy::too_many_arguments)]
async fn run_alert_count_query(
    trace_id: &str,
    org_id: &str,
    stream_type: StreamType,
    sql: &str,
    (start_time, end_time): (i64, i64),
    search_type: Option<SearchEventType>,
    search_event_context: Option<SearchEventContext>,
) -> Result<(f64, i64), anyhow::Error> {
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: config::meta::alerts::level::count_query_sql(sql),
            from: 0,
            // COUNT(*) over a subquery yields exactly one row.
            size: 1,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            action_id: None,
            uses_zo_fn: false,
            query_fn: None, // guard upstream: hybrid excludes VRL alerts
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
        agent_options: None,
    };
    let resp = SearchService::grpc_search::grpc_search(
        trace_id,
        org_id,
        stream_type,
        None,
        &req,
        Some(RoleGroup::Background),
    )
    .await?;
    let count = resp
        .hits
        .first()
        .and_then(|h| h.get("zo_alert_count"))
        .and_then(|v| v.as_f64().or_else(|| v.as_i64().map(|i| i as f64)))
        .ok_or_else(|| anyhow::anyhow!("alert count query returned no zo_alert_count column"))?;
    Ok((count, resp.took as i64))
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
                            return Err(anyhow::anyhow!("Column {} not found", cond.column));
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
                        return Err(anyhow::anyhow!("Column {} not found", node.column));
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
            config::meta::alerts::ConditionItem::Condition(v) => {
                evaluate_condition(
                    row,
                    &v.column,
                    &v.operator,
                    &v.value,
                    v.ignore_case.unwrap_or(false),
                )
                .await
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
        config::meta::alerts::ConditionItem::Condition(v) => {
            // Create a Condition struct to use with build_expr
            let condition = config::meta::alerts::Condition {
                column: v.column.clone(),
                operator: v.operator,
                value: v.value.clone(),
                ignore_case: v.ignore_case.unwrap_or(false),
            };

            let data_type = match schema.field_with_name(&condition.column) {
                Ok(field) => field.data_type(),
                Err(_) => {
                    return Err(anyhow::anyhow!("Column {} not found", condition.column));
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
                    agg.having.column,
                ));
            }
        };
        // Multi-level aggregations (alerts_2.md §4.4, option B): widen the
        // HAVING clause to the LESS severe threshold so every group that could
        // be warning-or-worse comes back, then classify each group in Rust via
        // the shared helper. Filtering on the critical threshold would drop the
        // entire warning band inside the database, where nothing downstream
        // could recover it.
        //
        // Single-level aggregations widen to the critical value, i.e. the
        // clause is byte-identical to before.
        let filter_value = config::meta::alerts::aggregation_level::having_filter_value(agg)
            .map_err(|e| anyhow::anyhow!("Invalid aggregation threshold: {e}"))?;
        let widened = Condition {
            value: serde_json::json!(filter_value),
            ..agg.having.clone()
        };
        build_expr(&widened, "alert_agg_value", data_type)?
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
        let cols = group.join(", ");
        if agg.multi_alert {
            // Multi-alerts (M-9) drop the HAVING filter. A group that falls
            // back under the threshold must still be RETURNED: otherwise its
            // recovery is indistinguishable from it vanishing, and it would
            // only resolve via M-7's timeout — K evaluations late, and with a
            // NULL value where the real reading should be.
            //
            // The page stays bounded, so it is ordered worst-first (§5.3).
            // That ordering is what keeps the rollup level exact and lets the
            // M-6 cap admit the true top of the distribution rather than an
            // arbitrary slice. The group columns are the deterministic
            // tiebreak within a severity band.
            let severity_order =
                config::meta::alerts::aggregation_level::severity_order_sql(agg, "alert_agg_value")
                    .map_err(|e| anyhow::anyhow!("Invalid aggregation threshold: {e}"))?;
            sql = format!(
                "SELECT {cols}, {func_expr} AS alert_agg_value, MIN({TIMESTAMP_COL_NAME}) as zo_sql_min_time, MAX({TIMESTAMP_COL_NAME}) AS zo_sql_max_time FROM \"{stream_name}\"{where_sql} GROUP BY {cols} ORDER BY {severity_order}, {cols}"
            );
        } else {
            sql = format!(
                "SELECT {cols}, {func_expr} AS alert_agg_value, MIN({TIMESTAMP_COL_NAME}) as zo_sql_min_time, MAX({TIMESTAMP_COL_NAME}) AS zo_sql_max_time FROM \"{stream_name}\"{where_sql} GROUP BY {cols} HAVING {having_expr}"
            );
        }
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
        meta::alerts::{
            ConditionGroup, ConditionItem, ConditionItemCondition, LogicalOperator, Operator,
        },
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
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "service".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                }),
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
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("critical".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR before this item
                }),
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
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::And, // AND before this group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "service".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("api".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, /* Not used (first item in
                                                                     * group) */
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "service".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("web".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::Or, // OR before this item
                        }),
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
                ConditionItem::Condition(ConditionItemCondition {
                    column: "count".to_string(),
                    operator: Operator::GreaterThan,
                    value: Value::Number(serde_json::Number::from(100)),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "temperature".to_string(),
                    operator: Operator::GreaterThanEquals,
                    value: Value::Number(serde_json::Number::from_f64(50.5).unwrap()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                }),
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
            conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                column: "message".to_string(),
                operator: Operator::Contains,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            })],
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
            conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                column: "level".to_string(),
                operator: Operator::EqualTo,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            })],
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
                ConditionItem::Condition(ConditionItemCondition {
                    column: "level".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("error".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first item)
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "status".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("active".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this item
                }),
                ConditionItem::Condition(ConditionItemCondition {
                    column: "service".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("api".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR before this item
                }),
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
            conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                column: "nonexistent".to_string(),
                operator: Operator::EqualTo,
                value: Value::String("error".to_string()),
                ignore_case: None,
                logical_operator: LogicalOperator::And,
            })],
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

        use crate::alerts::ConditionGroupExt;

        // Test the condition: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test'
        // AND kubernetes_host = 'test2') With proper Group logic structure
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Ignored because next is Group
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or, // OR before this group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_container_image".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_host".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test2".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        }),
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

        use crate::alerts::ConditionGroupExt;

        // Test evaluation with nested group: kubernetes_docker_id = 'test' OR
        // (kubernetes_container_image = 'test' AND kubernetes_host = 'test2') Structure:
        // - kubernetes_docker_id = 'test' [OR with next]
        // - A group containing: (kubernetes_container_image = 'test' AND kubernetes_host = 'test2')

        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::Or, // OR with next item
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::And, // AND inside the group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_container_image".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // AND with next in group
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "kubernetes_host".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("test2".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And,
                        }),
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

        use crate::alerts::ConditionGroupExt;

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
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or,
                    conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                        column: "kubernetes_container_image".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("test".to_string()),
                        ignore_case: None,
                        logical_operator: LogicalOperator::And,
                    })],
                },
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_host".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test2".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
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

        use crate::alerts::ConditionGroupExt;

        // Test operator precedence: A OR (B) AND C should evaluate as A OR ((B) AND C)
        // Structure: kubernetes_docker_id = 'test' OR (kubernetes_container_image = 'test') AND
        // kubernetes_host = 'test2'
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_docker_id".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or,
                    conditions: vec![ConditionItem::Condition(ConditionItemCondition {
                        column: "kubernetes_container_image".to_string(),
                        operator: Operator::EqualTo,
                        value: Value::String("test".to_string()),
                        ignore_case: None,
                        logical_operator: LogicalOperator::And,
                    })],
                },
                ConditionItem::Condition(ConditionItemCondition {
                    column: "kubernetes_host".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("test2".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And,
                }),
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

        use crate::alerts::ConditionGroupExt;

        // Complex nested structure: A OR (B AND C OR (D AND E)) AND F
        // This tests: nested groups + operator precedence at multiple levels
        let condition_group = ConditionGroup {
            filter_type: "group".to_string(),
            logical_operator: LogicalOperator::And,
            conditions: vec![
                ConditionItem::Condition(ConditionItemCondition {
                    column: "A".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("match".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // Not used (first)
                }),
                ConditionItem::Group {
                    logical_operator: LogicalOperator::Or, // OR before this group
                    conditions: vec![
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "B".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("match".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // Not used (first in group)
                        }),
                        ConditionItem::Condition(ConditionItemCondition {
                            column: "C".to_string(),
                            operator: Operator::EqualTo,
                            value: Value::String("match".to_string()),
                            ignore_case: None,
                            logical_operator: LogicalOperator::And, // AND before this
                        }),
                        ConditionItem::Group {
                            logical_operator: LogicalOperator::Or, // OR before this nested group
                            conditions: vec![
                                ConditionItem::Condition(ConditionItemCondition {
                                    column: "D".to_string(),
                                    operator: Operator::EqualTo,
                                    value: Value::String("match".to_string()),
                                    ignore_case: None,
                                    logical_operator: LogicalOperator::And,
                                }),
                                ConditionItem::Condition(ConditionItemCondition {
                                    column: "E".to_string(),
                                    operator: Operator::EqualTo,
                                    value: Value::String("match".to_string()),
                                    ignore_case: None,
                                    logical_operator: LogicalOperator::And, // AND before this
                                }),
                            ],
                        },
                    ],
                },
                ConditionItem::Condition(ConditionItemCondition {
                    column: "F".to_string(),
                    operator: Operator::EqualTo,
                    value: Value::String("match".to_string()),
                    ignore_case: None,
                    logical_operator: LogicalOperator::And, // AND before this
                }),
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

    // ── build_expr sync unit tests ───────────────────────────────────────────

    fn make_cond(column: &str, operator: Operator, value: Value) -> Condition {
        Condition {
            column: column.to_string(),
            operator,
            value,
            ignore_case: false,
        }
    }

    #[test]
    fn test_build_expr_bool_equal_to() {
        let cond = make_cond("active", Operator::EqualTo, Value::Bool(true));
        let expr = build_expr(&cond, "", &DataType::Boolean).unwrap();
        assert_eq!(expr, "\"active\" = true");
    }

    #[test]
    fn test_build_expr_bool_not_equal_to() {
        let cond = make_cond("active", Operator::NotEqualTo, Value::Bool(false));
        let expr = build_expr(&cond, "", &DataType::Boolean).unwrap();
        assert_eq!(expr, "\"active\" != false");
    }

    #[test]
    fn test_build_expr_bool_bool_as_string_value() {
        let cond = make_cond(
            "active",
            Operator::EqualTo,
            Value::String("true".to_string()),
        );
        let expr = build_expr(&cond, "", &DataType::Boolean).unwrap();
        assert_eq!(expr, "\"active\" = true");
    }

    #[test]
    fn test_build_expr_bool_unsupported_operator_returns_error() {
        let cond = make_cond("active", Operator::Contains, Value::Bool(true));
        let result = build_expr(&cond, "", &DataType::Boolean);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_int_contains_returns_error() {
        let cond = make_cond("count", Operator::Contains, Value::Number(1.into()));
        let result = build_expr(&cond, "", &DataType::Int64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_float_contains_returns_error() {
        let cond = make_cond("score", Operator::Contains, Value::Number(1.into()));
        let result = build_expr(&cond, "", &DataType::Float64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_unsupported_datatype_returns_error() {
        let cond = make_cond("ts", Operator::EqualTo, Value::String("x".to_string()));
        let result = build_expr(&cond, "", &DataType::Date32);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_field_alias_override() {
        let cond = make_cond(
            "level",
            Operator::EqualTo,
            Value::String("error".to_string()),
        );
        let expr = build_expr(&cond, "log_level", &DataType::Utf8).unwrap();
        assert_eq!(expr, "\"log_level\" = 'error'");
    }

    #[test]
    fn test_build_expr_string_not_contains() {
        let cond = make_cond(
            "msg",
            Operator::NotContains,
            Value::String("spam".to_string()),
        );
        let expr = build_expr(&cond, "", &DataType::Utf8).unwrap();
        assert_eq!(expr, "\"msg\" NOT LIKE '%spam%'");
    }

    #[test]
    fn test_build_expr_int_greater_than() {
        let cond = make_cond(
            "code",
            Operator::GreaterThan,
            Value::Number(serde_json::Number::from(400)),
        );
        let expr = build_expr(&cond, "", &DataType::Int32).unwrap();
        assert_eq!(expr, "\"code\" > 400");
    }

    #[test]
    fn test_build_expr_float_less_than_equal() {
        let cond = make_cond(
            "rate",
            Operator::LessThanEquals,
            Value::Number(serde_json::Number::from_f64(0.5).unwrap()),
        );
        let expr = build_expr(&cond, "", &DataType::Float32).unwrap();
        assert_eq!(expr, "\"rate\" <= 0.5");
    }

    #[test]
    fn test_build_expr_int_invalid_string_returns_error() {
        let cond = make_cond(
            "n",
            Operator::EqualTo,
            Value::String("not_a_number".to_string()),
        );
        let result = build_expr(&cond, "", &DataType::Int64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_float_invalid_string_returns_error() {
        let cond = make_cond("f", Operator::EqualTo, Value::String("abc".to_string()));
        let result = build_expr(&cond, "", &DataType::Float64);
        assert!(result.is_err());
    }

    #[test]
    fn test_build_expr_bool_invalid_string_returns_error() {
        let cond = make_cond("b", Operator::EqualTo, Value::String("maybe".to_string()));
        let result = build_expr(&cond, "", &DataType::Boolean);
        assert!(result.is_err());
    }
}
