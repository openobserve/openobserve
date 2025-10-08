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
use config::{
    META_ORG_ID,
    cluster::LOCAL_NODE,
    get_config,
    meta::{
        search::{Query, Request},
        stream::StreamType,
    },
    spawn_pausable_job,
    utils::json,
};
use futures::FutureExt;
use hashbrown::HashMap;
use o2_enterprise::enterprise::{
    common::sql_filter_util::{QueryInfo, analyze_queries},
    recommendations::{
        meta::{OptimiserRecommendation, StreamOccurrences},
        utils::clean_sql_query,
    },
};

use crate::{
    common::meta::stream::Stream,
    service::{organization::list_all_orgs, search::search, stream::get_streams},
};

pub async fn run() -> Result<(), anyhow::Error> {
    // Only run on alert_manager or querier nodes
    if !LOCAL_NODE.is_alert_manager() && !LOCAL_NODE.is_querier() {
        return Ok(());
    }

    let cfg = get_config();

    // Spawn the job with configurable interval
    spawn_pausable_job!(
        "query_recommendation_analysis",
        cfg.limit.query_recommendation_analysis_interval,
        {
            log::debug!("[QUERY_RECOMMENDATIONS] Starting analysis job");

            {
                if let Err(e) = run_analysis(9000).await {
                    log::error!("[QUERY_RECOMMENDATIONS] Analysis job failed: {e}");
                } else {
                    log::debug!("[QUERY_RECOMMENDATIONS] Analysis job completed successfully");
                }
            }

            #[cfg(not(feature = "enterprise"))]
            {
                log::debug!(
                    "[QUERY_RECOMMENDATIONS] Enterprise feature not enabled, skipping analysis"
                );
            }
        }
    );

    Ok(())
}

pub async fn run_analysis(top_x: usize) -> Result<(), anyhow::Error> {
    log::info!("[QUERY_RECOMMENDATIONS] Stage 1: Getting query data from usage");
    let hits = get_usage_data().await?;
    let all_sql_queries: Vec<QueryInfo> = hits
        .into_iter()
        .filter_map(|hit| {
            let sql = hit
                .get("request_body")
                .and_then(json::Value::as_str)
                .map(clean_sql_query)
                .filter(String::is_empty);
            let r_count = hit
                .get("r_count")
                .and_then(json::Value::as_u64)
                .map(|rc| rc as usize)
                .or(Some(1));

            sql.zip(r_count)
        })
        .map(|(query, count)| QueryInfo { query, count })
        .collect();

    if all_sql_queries.is_empty() {
        return Ok(());
    }
    log::info!(
        "[QUERY_RECOMMENDATIONS] Total queries analyzed: {:?}",
        all_sql_queries.len()
    );

    log::info!("[QUERY_RECOMMENDATIONS] Stage 2: Analyzing queries");
    let table_columns = analyze_queries(&all_sql_queries).inspect_err(|e| {
        log::info!("Failed to analyze WHERE clauses by table: {e}");
    })?;

    log::info!("[QUERY_RECOMMENDATIONS] Stage 3: Getting stream settings");
    let all_futures = list_all_orgs(None).await?.into_iter().map(|org| {
        let org_id = org.identifier.clone();

        async move {
            get_streams(&org.identifier, None, true, None)
                .await
                .into_iter()
                .map(|s| (s.name.clone(), (org_id.clone(), s)))
                .collect::<HashMap<String, (String, Stream)>>()
        }
    });

    let stream_map: std::collections::HashMap<String, (String, Stream)> =
        futures::future::join_all(all_futures)
            .await
            .into_iter()
            .map(|item| item.into_iter())
            .collect();

    let stream_partition_map: HashMap<String, Vec<String>> = stream_map
        .values()
        .map(|(_, stream)| {
            (
                stream.name.clone(),
                stream
                    .settings
                    .partition_keys
                    .iter()
                    .map(|p| p.field.clone())
                    .collect::<Vec<String>>(),
            )
        })
        .collect();

    log::info!("[QUERY_RECOMMENDATIONS] Stage 4: Coming up with recommendations for streams");

    ///////
    let mut recos: HashMap<String, Vec<OptimiserRecommendation>> = Default::default();
    let mut sec_index_recos: HashMap<String, Vec<OptimiserRecommendation>> = Default::default();
    let mut stream_occurrences: Vec<StreamOccurrences> = Default::default();
    let mut stream_distinct_values: HashMap<String, usize> = Default::default();

    table_columns
        .into_iter()
        .for_each(|(table_name, columns)|{
        let mut occurrences = 0;
        if let Some((org_id, stream_settings)) = stream_map.get(&table_name.to_string()) {
            log::info!("--------------------------------------------------------");
            log::info!("********** {table_name} **********");
            let stream_settings = stream_settings.settings.clone();
            for col in columns {
                occurrences += col.occurrences;
                let partition_keys = stream_partition_map.get(table_name).unwrap();
                if partition_keys.contains(&col.column_name) {
                    log::info!(
                        "col {} is partition key &  uses {:?}",
                        col.column_name,
                        col.operators
                    );
                    continue;
                }

                if stream_settings.index_fields.contains(&col.column_name)
                    && !col.operators.contains(&O2Operators::Eq.to_string())
                    && !col.operators.contains(&O2Operators::StrMatch.to_string())
                    && !col.operators.contains(&O2Operators::In.to_string())
                {
                    log::info!(
                        "col {} , is secondary index hence use str_match",
                        col.column_name
                    );
                    let rec = OptimiserRecommendation {
                        stream_name: table_name.clone(),
                        column_name: col.column_name.clone(),
                        recommendation: "Use str_match".to_string(),
                        reason: format!(
                            "Column is a secondary index and not using str_match   - {}: used operators {:?}, occurrences {}",
                            col.column_name, col.operators, col.occurrences
                        ),
                        r_type: OptimiserRecommendationType::QueryOptimisation,
                        all_operators: col.operators.clone(),
                        total_occurrences: col.occurrences,
                        operator: col.operators.clone(),
                        occurrences: col.occurrences,
                        num_distinct_values: 0,
                        queries: Some(col.queries.clone()),
                        duration_hrs: duration,
                    };
                    recos
                        .entry(table_name.clone())
                        .or_insert(Vec::new())
                        .push(rec);
                    log::info!(
                        "  - {}: used operators={:?}, occurrences={}",
                        col.column_name,
                        col.operators,
                        col.occurrences
                    );
                } else if stream_settings
                    .full_text_search_keys
                    .contains(&col.column_name)
                    && !col.operators.contains(&O2Operators::MatchAll.to_string())
                {
                    log::info!(
                        "col {} , is full text search key hence use match_all",
                        col.column_name
                    );
                    log::info!(
                        "  - {}: operators={:?}, occurrences={}",
                        col.column_name,
                        col.operators,
                        col.occurrences
                    );
                    recos.entry(table_name.clone()).or_insert(Vec::new()).push(OptimiserRecommendation {
                        stream_name: table_name.clone(),
                        column_name: col.column_name.clone(),
                        recommendation: "Use match_all".to_string(),
                        reason: format!("Column is a full text search key and not using match_all   - {}: used operators {:?}, occurrences {}", col.column_name, col.operators, col.occurrences),
                        r_type: OptimiserRecommendationType::QueryOptimisation,
                        all_operators: col.operators.clone(),
                        total_occurrences: col.occurrences,
                        operator: col.operators.clone(),
                        occurrences: col.occurrences,
                        num_distinct_values: 0,
                        queries: Some(col.queries.clone()),
                        duration_hrs: duration,
                    });
                } else {
                    for (operator, occurrences) in &col.operator_occurrences {
                        if *operator == O2Operators::Eq.to_string()
                            || *operator == O2Operators::In.to_string()
                            || *operator == O2Operators::StrMatch.to_string()
                        {
                            log::info!(
                                "Enable secondary index for col {} , occurrences {} of total {} , operators={:?}",
                                col.column_name,
                                occurrences,
                                col.occurrences,
                                col.operators
                            );
                            let rec= OptimiserRecommendation {
                                stream_name: table_name.clone(),
                                column_name: col.column_name.clone(),
                                recommendation: format!("Enable secondary index for col {}", col.column_name),
                                reason: format!("{}: used operators {:?} , occurrences {} of total {}", col.column_name, operator, occurrences, col.occurrences),
                                r_type: OptimiserRecommendationType::SecondaryIndexStreamSettings,
                                all_operators: col.operators.clone(),
                                total_occurrences: col.occurrences,                                                operator: vec![operator.clone()],
                                occurrences: *occurrences,
                                num_distinct_values: 0,
                                queries:None,
                                duration_hrs: duration,
                            };
                            sec_index_recos
                                .entry(table_name.clone())
                                .or_insert(Vec::new())
                                .push(rec.clone());
                            recos
                                .entry(table_name.clone())
                                .or_insert(Vec::new())
                                .push(rec);
                        } else if *operator == O2Operators::Like.to_string()
                            || *operator == O2Operators::RegexMatch.to_string()
                        {
                            log::info!(
                                "Enable full text search for col {} , occurrences {} of total {}",
                                col.column_name,
                                occurrences,
                                col.occurrences
                            );
                            recos.entry(table_name.clone()).or_insert(Vec::new()).push(OptimiserRecommendation {
                                stream_name: table_name.clone(),
                                column_name: col.column_name.clone(),
                                recommendation: "Use full text search".to_string(),
                                reason: format!("{}: used operators {:?}, occurrences {} of total {}", col.column_name, operator, occurrences, col.occurrences),
                                r_type: OptimiserRecommendationType::FTSStreamSettings,
                                all_operators: col.operators.clone(),
                                total_occurrences: col.occurrences,
                                operator: vec![operator.clone()],
                                occurrences: *occurrences,
                                num_distinct_values: 0,
                                queries:None,
                                duration_hrs: duration,
                            });
                        }
                    }
                }
            }
            stream_occurrences.push(StreamOccurrences {
                stream_name: table_name.clone(),
                column_name: None,
                occurrences,
            });
        }
    });

    stream_occurrences.sort_by(|a, b| b.occurrences.cmp(&a.occurrences));

    let top_x_streams: Vec<String> = stream_occurrences
        .iter()
        .take(top_x)
        .map(|stream| stream.stream_name.clone())
        .collect();

    for (stream_name, recommendations) in sec_index_recos {
        if top_x_streams.contains(&stream_name) {
            let mut column_names = recommendations
                .iter()
                .map(|recommendation| recommendation.column_name.as_str())
                .collect::<Vec<&str>>();
            column_names.dedup();
            let distinct_values =
                get_distinct_values(url, token, org_id, duration, &column_names, &stream_name)
                    .await?;
            stream_distinct_values.extend(distinct_values);
        }
    }

    log::info!("[QUERY_RECOMMENDATIONS] Stage 5: Ingesting recommendations (TODO)");

    Ok(())
}

async fn get_usage_data() -> infra::errors::Result<Vec<json::Value>> {
    // Need to pass this
    let lookback_hours = get_config().limit.query_recommendation_lookback_minutes;

    // Calculate time range
    let end_time = chrono::Utc::now();
    let start_time = end_time - chrono::Duration::minutes(lookback_hours);

    // Build SQL query to aggregate queries by request_body
    // This groups queries and finds the maximum response time for each unique query
    let sql = format!(
        r#"SELECT
            request_body,
            COUNT(request_body) as r_count,
            MAX(response_time) as m_rs
        FROM "usage"
        WHERE _timestamp >= {}
          AND _timestamp < {}
          AND event = 'Search'
          AND search_type != 'ui'
        GROUP BY request_body
        ORDER BY m_rs DESC"#,
        start_time.timestamp_micros(),
        end_time.timestamp_micros()
    );

    log::debug!(
        "[QUERY_RECOMMENDATIONS] Executing query on usage stream: {}",
        sql
    );

    // Create search request using internal API
    let search_request = Request {
        query: Query {
            sql: sql.clone(),
            start_time: start_time.timestamp_micros(),
            end_time: end_time.timestamp_micros(),
            size: 0, // Get all results
            track_total_hits: false,
            ..Default::default()
        },
        ..Default::default()
    };

    // Execute search using internal service (no tokens needed)
    // This will automatically query across all nodes
    //
    // Expose this
    let response = search(
        "", // empty trace_id, will be generated
        META_ORG_ID,
        StreamType::Logs,
        None, // no user_id needed for internal operations
        &search_request,
    )
    .await?;

    Ok(response.hits)
}

pub(crate) async fn get_stream_settings(
    url: &str,
    token: &str,
    org_id: &str,
) -> Result<Vec<json::Value>, anyhow::Error> {
    unimplemented!("LOL")
}
