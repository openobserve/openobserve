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

//! Agent Signals read API.
//!
//! Reads the pre-computed `_agent_signals` derived stream (produced by the
//! rollup) and returns the signals for a window. This is a small, bounded
//! read — it never touches raw trace content. HTTP handler stays in OSS with a
//! dual `#[cfg]` impl (enterprise reads the stream; OSS returns 403), mirroring
//! `service_graph::api::get_current_topology`.

use axum::response::Response as HttpResponse;
use serde::Deserialize;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// Query params for the agent-signals read endpoint.
#[derive(Debug, Deserialize)]
pub struct AgentSignalsQuery {
    pub start_time: Option<i64>,
    pub end_time: Option<i64>,
    /// Optional filter: "failure" | "loop" | "cost".
    pub signal_type: Option<String>,
    /// Optional filter by source trace stream.
    pub source_stream: Option<String>,
}

#[cfg(feature = "enterprise")]
pub async fn get_agent_signals(
    axum::extract::Path(org_id): axum::extract::Path<String>,
    axum::extract::Query(query): axum::extract::Query<AgentSignalsQuery>,
) -> HttpResponse {
    use config::meta::stream::StreamType;

    let stream_name = "_agent_signals";

    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (query.start_time, query.end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            let window_micros =
                super::super::service_graph::DEFAULT_QUERY_WINDOW_MINUTES * 60 * 1_000_000;
            (now - window_micros, now)
        };

    // Build a bounded read over the tiny derived stream.
    let mut filters = format!("org_id = '{org_id}'");
    if let Some(st) = query.signal_type.as_deref() {
        // signal_type is a fixed small enum; guard against quote-breaking just in case.
        let st = st.replace('\'', "");
        filters.push_str(&format!(" AND signal_type = '{st}'"));
    }
    if let Some(src) = query.source_stream.as_deref() {
        let src = src.replace('\'', "");
        filters.push_str(&format!(" AND source_stream = '{src}'"));
    }
    let sql = format!(
        "SELECT * FROM \"{stream_name}\" \
         WHERE _timestamp >= {start_time} AND _timestamp < {end_time} AND {filters} \
         ORDER BY _timestamp DESC LIMIT 10000"
    );

    // If the stream doesn't exist yet (feature never ran), return an empty list.
    let schema = infra::schema::get(&org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        return MetaHttpResponse::json(serde_json::json!({ "signals": [] }));
    }

    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql,
            from: 0,
            size: 10000,
            start_time,
            end_time,
            quick_mode: false,
            query_type: "".to_string(),
            track_total_hits: false,
            uses_zo_fn: false,
            query_fn: None,
            skip_wal: false,
            action_id: None,
            histogram_interval: 0,
            streaming_id: None,
            streaming_output: false,
            sampling_config: None,
            sampling_ratio: None,
            timezone: None,
        },
        encoding: config::meta::search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 30,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: Some(false),
        agent_options: None,
    };

    let trace_id = config::ider::generate();
    match crate::service::search::search(&trace_id, &org_id, StreamType::Logs, None, &req).await {
        Ok(resp) => MetaHttpResponse::json(serde_json::json!({ "signals": resp.hits })),
        Err(e) => {
            log::error!("[AgentSignals] read query failed for org '{org_id}': {e}");
            MetaHttpResponse::json(serde_json::json!({ "signals": [] }))
        }
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn get_agent_signals(
    axum::extract::Path(_org_id): axum::extract::Path<String>,
    axum::extract::Query(_query): axum::extract::Query<AgentSignalsQuery>,
) -> HttpResponse {
    MetaHttpResponse::forbidden("Not Supported")
}
