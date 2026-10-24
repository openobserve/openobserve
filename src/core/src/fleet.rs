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

//! Fleet management reads that need the query engine, and the feature flag.

use std::collections::HashSet;

use config::{
    META_ORG_ID,
    meta::{
        fleet::{AuditList, AuditQuery, FlowWindow, PipelinesResponse},
        promql::value::{InstantValue, Value},
        search,
        stream::StreamType,
    },
    utils::time::now_micros,
};
use o2_enterprise::enterprise::common::auditor::AUDIT_STREAM;

/// The engine ignores `step` on an instant query; any positive value works.
const INSTANT_STEP_MICROS: i64 = 300_000_000;

/// `O2_FLEET_ENABLED`, read once at startup; off stops every fleet job and refuses writes.
pub fn enabled() -> bool {
    o2_enterprise::enterprise::common::config::get_config()
        .fleet
        .enabled
}

/// Region-local, because fleet state is region-local too; the queries run as the caller (N7).
pub async fn get_pipelines(
    org_id: &str,
    user_id: &str,
    window: FlowWindow,
    fleets: Option<&HashSet<String>>,
) -> Result<PipelinesResponse, anyhow::Error> {
    let now_us = now_micros();
    o2_enterprise::enterprise::fleet::pipelines::get_pipelines(
        org_id,
        window,
        now_us,
        fleets,
        |query, metrics| instant(org_id, user_id, query, metrics, now_us),
    )
    .await
}

/// The handler has already checked the caller's org-wide fleet access, so this runs as the server.
pub async fn list_audit(org_id: &str, query: AuditQuery) -> Result<AuditList, anyhow::Error> {
    o2_enterprise::enterprise::fleet::audit::list_audit(org_id, query, now_micros(), search_audit)
        .await
}

/// The check `/prometheus/api/v1/query` makes per metric stream; a refused query is `None`.
async fn instant(
    org_id: &str,
    user_id: &str,
    query: String,
    metrics: Vec<String>,
    at_us: i64,
) -> Result<Option<Vec<InstantValue>>, anyhow::Error> {
    for metric in &metrics {
        if !readable(org_id, user_id, metric).await {
            return Ok(None);
        }
    }
    let req = promql_service::MetricsQueryRequest {
        query: query.clone(),
        start: at_us,
        end: at_us,
        step: INSTANT_STEP_MICROS,
        query_exemplars: false,
        use_cache: None,
        search_type: None,
        search_event_context: None,
        regions: vec![],
        clusters: vec![],
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = promql_service::search::search(&trace_id, org_id, &req, user_id, 0, false)
        .await
        .map_err(|e| anyhow::anyhow!("fleet pipelines query failed: {e}: {query}"))?;
    match resp.value {
        Value::Vector(v) => Ok(Some(v)),
        Value::Instant(i) => Ok(Some(vec![i])),
        Value::None => Ok(Some(vec![])),
        other => anyhow::bail!(
            "fleet pipelines query returned {} instead of a vector: {query}",
            other.get_type()
        ),
    }
}

async fn readable(org_id: &str, user_id: &str, metric: &str) -> bool {
    crate::auth::check_permissions(
        &crate::auth::into_ofga_supported_format(metric),
        org_id,
        user_id,
        StreamType::Metrics.as_str(),
        "GET",
        None,
        false,
        false,
        true,
    )
    .await
}

async fn search_audit(
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> Result<Vec<serde_json::Value>, anyhow::Error> {
    // Until the first audit row is written the stream does not exist, and a search of it errors.
    let schema = infra::schema::get(META_ORG_ID, AUDIT_STREAM, StreamType::Logs).await?;
    if schema.fields().is_empty() {
        return Ok(vec![]);
    }
    let req = search::Request {
        query: search::Query {
            sql,
            from: 0,
            size,
            start_time,
            end_time,
            ..Default::default()
        },
        encoding: search::RequestEncoding::Empty,
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        search_type: None,
        search_event_context: None,
        use_cache: false,
        clear_cache: false,
        local_mode: None,
        agent_options: None,
    };
    let trace_id = config::ider::generate_trace_id();
    let resp = search_service::search(&trace_id, META_ORG_ID, StreamType::Logs, None, &req)
        .await
        .map_err(|e| anyhow::anyhow!("fleet audit search failed: {e}"))?;
    Ok(resp.hits)
}
