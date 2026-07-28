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

//! Reader for the `_o2_service_graph` stream.
//!
//! Kept apart from [`crate::traces::service_graph`] because reading the stream only needs the
//! search service, while the rest of that module builds and writes the graph off the trace
//! ingestion path. Incident topology enrichment reads the graph and must not drag traces in with
//! it, so the query lives here.

/// Default window (in minutes) used when no explicit time range is provided.
/// The UI has its own time range picker, so this only applies as the server-side fallback.
pub const DEFAULT_QUERY_WINDOW_MINUTES: i64 = 60;

/// Build the SQL used to read edge records from the `_o2_service_graph` stream.
///
/// Pure helper (no DB access) so the query construction can be unit-tested.
///
/// `agent_pred` is an optional, caller-built predicate fragment (e.g.
/// `agent_env = 'prod'`) appended to the WHERE clause. When `None`, the emitted
/// SQL is byte-identical to the pre-B4 query so behavior is unchanged.
///
/// NOTE: This stream is version-agnostic — there is no `agent_version` column,
/// so predicates must never reference it.
#[cfg(feature = "enterprise")]
fn build_edges_sql(
    stream_name: &str,
    stream_filter: Option<&str>,
    start_time: i64,
    end_time: i64,
    org_id: &str,
    agent_pred: Option<&str>,
) -> String {
    let agent_clause = agent_pred
        .map(|p| format!("\n             AND {p}"))
        .unwrap_or_default();
    if let Some(stream) = stream_filter {
        format!(
            "SELECT * FROM \"{}\"
             WHERE _timestamp >= {} AND _timestamp < {}
             AND org_id = '{}'
             AND trace_stream_name = '{}'{}
             LIMIT 10000",
            stream_name, start_time, end_time, org_id, stream, agent_clause
        )
    } else {
        format!(
            "SELECT * FROM \"{}\"
             WHERE _timestamp >= {} AND _timestamp < {}
             AND org_id = '{}'{}
             LIMIT 10000",
            stream_name, start_time, end_time, org_id, agent_clause
        )
    }
}

#[cfg(feature = "enterprise")]
/// Query edge records from the _o2_service_graph stream
///
/// Internal version exposed for incident topology enrichment.
/// Supports optional custom time range via start_time/end_time parameters.
///
/// `agent_pred` is an optional predicate fragment (env-only, version-agnostic)
/// appended to the WHERE clause to scope edges to the selected agent env.
pub async fn query_edges_from_stream_internal(
    org_id: &str,
    stream_filter: Option<&str>,
    custom_start_time: Option<i64>,
    custom_end_time: Option<i64>,
    agent_pred: Option<&str>,
) -> Result<Vec<serde_json::Value>, infra::errors::Error> {
    use config::meta::stream::StreamType;

    let stream_name = "_o2_service_graph";

    // Use custom time range if provided, otherwise fall back to configured window
    let (start_time, end_time) =
        if let (Some(start), Some(end)) = (custom_start_time, custom_end_time) {
            (start, end)
        } else {
            let now = chrono::Utc::now().timestamp_micros();
            let window_micros = DEFAULT_QUERY_WINDOW_MINUTES * 60 * 1_000_000;
            (now - window_micros, now)
        };

    // Query pre-aggregated edge state (already summarized per minute)
    let sql = build_edges_sql(
        stream_name,
        stream_filter,
        start_time,
        end_time,
        org_id,
        agent_pred,
    );

    // Build search request
    let req = config::meta::search::Request {
        query: config::meta::search::Query {
            sql: sql.clone(),
            from: 0,
            size: 100000,
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

    // Check if stream exists (using Logs type since we write as logs stream)
    let schema = infra::schema::get(org_id, stream_name, StreamType::Logs).await;
    if schema.is_err() {
        log::debug!(
            "[ServiceGraph] Stream '{}' does not exist yet for org '{}'",
            stream_name,
            org_id
        );
        return Ok(Vec::new());
    }

    // Execute search
    let trace_id = config::ider::generate();
    let resp = crate::search::search(&trace_id, org_id, StreamType::Logs, None, &req)
        .await
        .map_err(|e| {
            log::error!("[ServiceGraph] Stream query failed: {}", e);
            infra::errors::Error::ErrorCode(infra::errors::ErrorCodes::SearchStreamNotFound(
                stream_name.to_string(),
            ))
        })?;

    log::debug!(
        "[ServiceGraph] Retrieved {} edge records from stream for org '{}'",
        resp.hits.len(),
        org_id
    );

    Ok(resp.hits)
}

#[cfg(all(test, feature = "enterprise"))]
mod tests {
    use super::*;

    #[test]
    fn test_build_edges_sql_none_pred_is_byte_identical_unfiltered() {
        // When agent_pred is None and no stream filter, the SQL must be
        // byte-identical to the pre-B4 baseline query.
        let expected = "SELECT * FROM \"_o2_service_graph\"
             WHERE _timestamp >= 100 AND _timestamp < 200
             AND org_id = 'org1'
             LIMIT 10000";
        let sql = build_edges_sql("_o2_service_graph", None, 100, 200, "org1", None);
        assert_eq!(sql, expected);
    }

    #[test]
    fn test_build_edges_sql_none_pred_is_byte_identical_stream_filtered() {
        // When agent_pred is None with a stream filter, the SQL must be
        // byte-identical to the pre-B4 stream-filtered query.
        let expected = "SELECT * FROM \"_o2_service_graph\"
             WHERE _timestamp >= 100 AND _timestamp < 200
             AND org_id = 'org1'
             AND trace_stream_name = 'my_stream'
             LIMIT 10000";
        let sql = build_edges_sql(
            "_o2_service_graph",
            Some("my_stream"),
            100,
            200,
            "org1",
            None,
        );
        assert_eq!(sql, expected);
    }

    #[test]
    fn test_build_edges_sql_with_pred_unfiltered() {
        let sql = build_edges_sql(
            "_o2_service_graph",
            None,
            100,
            200,
            "org1",
            Some("agent_env = 'prod'"),
        );
        assert!(sql.contains("agent_env = 'prod'"));
        assert!(sql.contains("AND agent_env = 'prod'"));
        assert!(sql.contains("LIMIT 10000"));
    }

    #[test]
    fn test_build_edges_sql_with_pred_stream_filtered() {
        let sql = build_edges_sql(
            "_o2_service_graph",
            Some("my_stream"),
            100,
            200,
            "org1",
            Some("agent_env = 'prod'"),
        );
        assert!(sql.contains("agent_env = 'prod'"));
        assert!(sql.contains("AND trace_stream_name = 'my_stream'"));
        assert!(sql.contains("AND agent_env = 'prod'"));
    }
}
