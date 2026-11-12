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

use axum::{Json, extract::Path, response::Response};
use config::meta::{
    search::{Query as SearchQuery, Request as SearchRequest, Response as SearchResponse},
    stream::StreamType,
};
use futures::{StreamExt, stream};
use o2_enterprise::enterprise::security::{
    intel::{
        self, ValidateRequest, ValidateResponse,
        plan::{
            MAX_SIGHTING_SERIES, MAX_SWEEP_INDICATORS, MAX_SWEEP_STREAMS, SWEEP_CONCURRENCY,
            SightingSeries, SightingsRequest, SightingsResponse, SweepRequest, SweepResponse,
            SweepSummary, TaskOutcome, capped, mapped_columns, outcome_of, plan_sweep, summarize,
        },
        sweep::{
            SweepRows, fold_matches, is_valid_interval, sightings_sql, sweep_columns,
            sweep_row_limit, sweep_sql, sweep_values,
        },
    },
    streams::is_security_source,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use super::security_allowed;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    request::alerts::history::validate_history_range,
};

const READ_REFUSED: &str = "Threat intel needs the Security permission";

/// SweepSecurityIntel
#[utoipa::path(
    post,
    path = "/{org_id}/security/intel/sweep",
    context_path = "/api",
    tag = "Security",
    operation_id = "SweepSecurityIntel",
    summary = "Sweep Security sources for threat-intel indicators",
    description = "Searches the given Security source streams for the indicators, with the caller's own search permissions, and returns sightings per indicator plus how many indicators were fully checked",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(SweepRequest), description = "Indicators, Security source streams and time window", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(SweepResponse)),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn sweep(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<SweepRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "GET").await {
        return MetaHttpResponse::forbidden(READ_REFUSED);
    }
    if let Err(msg) = validate_history_range(req.start_time, req.end_time) {
        return MetaHttpResponse::bad_request(msg);
    }
    if req.indicators.len() > MAX_SWEEP_INDICATORS || req.streams.len() > MAX_SWEEP_STREAMS {
        return MetaHttpResponse::bad_request("Too many indicators or streams in one sweep");
    }
    if let Err(e) = search_service::check_org_search_allowed(&org_id) {
        return MetaHttpResponse::too_many_requests(e.to_string());
    }

    let mut streams = vec![];
    let mut unread_streams = vec![];
    let mut fields_of = vec![];
    for target in &req.streams {
        let Some((searchable, source_type)) =
            security_source_access(&org_id, &user_id, &target.name).await
        else {
            continue;
        };
        match infra::schema::get(&org_id, &target.name, StreamType::Logs).await {
            Ok(schema) if searchable && !schema.fields().is_empty() => {
                let fields: Vec<String> = schema
                    .fields()
                    .iter()
                    .map(|f| f.name().to_string())
                    .collect();
                let mut target = target.clone();
                if target.mapped.is_empty() {
                    target.mapped = mapped_columns(&source_type, &fields);
                }
                fields_of.push((target, fields));
            }
            _ => unread_streams.push(target.name.clone()),
        }
        streams.push(target.name.clone());
    }

    let values = sweep_values(&req.indicators);
    let names: Vec<String> = fields_of.iter().map(|(t, _)| t.name.clone()).collect();
    let tasks = plan_sweep(
        &names,
        |s, kind| {
            let (target, fields) = &fields_of[s];
            let mapped = target.mapped.get(&kind).map_or(&[][..], Vec::as_slice);
            sweep_columns(kind, fields, mapped)
        },
        &values,
    );
    let queue = capped(&tasks);
    // One more than the most groups the query can form, so a capped answer shows.
    let jobs: Vec<(String, i64)> = queue
        .iter()
        .map(|task| {
            let size = sweep_row_limit(&task.parts) + 1;
            (sweep_sql(&task.stream, &task.parts), size as i64)
        })
        .collect();
    let (start_time, end_time) = (req.start_time, req.end_time);
    let answers: Vec<Result<SearchResponse, ()>> = stream::iter(jobs)
        .map(|(sql, size)| {
            let (org_id, user_id) = (org_id.clone(), user_id.clone());
            async move { run_search(&org_id, &user_id, sql, start_time, end_time, size).await }
        })
        .buffered(SWEEP_CONCURRENCY)
        .collect()
        .await;

    let mut outcomes = Vec::with_capacity(answers.len());
    let mut results = vec![];
    for (task, answer) in queue.iter().zip(answers) {
        match answer {
            Ok(res) => {
                let size = sweep_row_limit(&task.parts) + 1;
                outcomes.push(outcome_of(
                    res.hits.len(),
                    size,
                    res.is_partial,
                    !res.function_error.is_empty(),
                ));
                results.push(SweepRows {
                    stream: task.stream.clone(),
                    rows: res.hits,
                });
            }
            Err(()) => outcomes.push(TaskOutcome::Failed),
        }
    }
    let summary: SweepSummary = summarize(&values, &tasks, &outcomes);
    MetaHttpResponse::json(SweepResponse {
        matches: fold_matches(&req.indicators, &results),
        streams,
        unread_streams,
        summary,
    })
}

/// SecurityIntelSightings
#[utoipa::path(
    post,
    path = "/{org_id}/security/intel/sightings",
    context_path = "/api",
    tag = "Security",
    operation_id = "SecurityIntelSightings",
    summary = "One indicator's sightings over time",
    description = "Histogram of an indicator's sightings per Security source stream and column, counted the way the sweep matched them",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(SightingsRequest), description = "Indicator, sightings and time window", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(SightingsResponse)),
        (status = 400, description = "Bad Request", content_type = "application/json"),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn sightings(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<SightingsRequest>,
) -> Response {
    let user_id = user_email.user_id;
    if !security_allowed(&org_id, &user_id, "GET").await {
        return MetaHttpResponse::forbidden(READ_REFUSED);
    }
    if let Err(msg) = validate_history_range(req.start_time, req.end_time) {
        return MetaHttpResponse::bad_request(msg);
    }
    if !is_valid_interval(&req.interval) {
        return MetaHttpResponse::bad_request("interval must look like `5 minute`");
    }
    if req.sightings.len() > MAX_SIGHTING_SERIES {
        return MetaHttpResponse::bad_request(format!(
            "At most {MAX_SIGHTING_SERIES} sightings per request"
        ));
    }
    if let Err(e) = search_service::check_org_search_allowed(&org_id) {
        return MetaHttpResponse::too_many_requests(e.to_string());
    }
    let mut series = Vec::with_capacity(req.sightings.len());
    for target in &req.sightings {
        let access = security_source_access(&org_id, &user_id, &target.stream).await;
        let answer = if access.is_some_and(|(searchable, _)| searchable) {
            let sql = sightings_sql(
                &target.stream,
                &target.column,
                req.kind,
                &req.indicator,
                &req.interval,
                target.mode,
            );
            run_search(&org_id, &user_id, sql, req.start_time, req.end_time, -1).await
        } else {
            Err(())
        };
        series.push(SightingSeries {
            stream: target.stream.clone(),
            column: target.column.clone(),
            mode: target.mode,
            failed: answer.is_err(),
            hits: answer.map(|r| r.hits).unwrap_or_default(),
        });
    }
    MetaHttpResponse::json(SightingsResponse { series })
}

/// ValidateSecurityIntel
#[utoipa::path(
    post,
    path = "/{org_id}/security/intel/validate",
    context_path = "/api",
    tag = "Security",
    operation_id = "ValidateSecurityIntel",
    summary = "Check a pasted or imported indicator list",
    description = "Detects each indicator's type, canonicalises it, names the values that are not indicators, counts duplicates and reports the room left under the list cap",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(ValidateRequest), description = "Pasted text and/or cells to classify", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(ValidateResponse)),
        (status = 403, description = "Forbidden", content_type = "application/json"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Security", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    ),
)]
pub async fn validate(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<ValidateRequest>,
) -> Response {
    if !security_allowed(&org_id, &user_email.user_id, "GET").await {
        return MetaHttpResponse::forbidden(READ_REFUSED);
    }
    MetaHttpResponse::json(intel::validate(&req))
}

/// A threat-intel list write or delete also needs that Security grant, not just enrichment's.
pub async fn guard_intel_list(
    org_id: &str,
    user_id: &str,
    table: &str,
    method: &str,
) -> Result<(), Response> {
    if openobserve_core::security::intel_list_write_allowed(org_id, user_id, table, method).await {
        Ok(())
    } else {
        Err(MetaHttpResponse::forbidden(
            openobserve_core::security::INTEL_LIST_REFUSED,
        ))
    }
}

/// `None` for a non-Security stream, else whether the caller may search it and its source type.
async fn security_source_access(
    org_id: &str,
    user_id: &str,
    stream: &str,
) -> Option<(bool, String)> {
    let settings = infra::schema::get_settings(org_id, stream, StreamType::Logs).await;
    let security = settings.and_then(|s| s.security.clone())?;
    if !is_security_source(Some(&security)) {
        return None;
    }
    let denied = openobserve_core::authz::check_stream_permissions(
        stream,
        org_id,
        user_id,
        &StreamType::Logs,
        openobserve_core::authz::StreamPermissionResourceType::Search,
    )
    .await;
    Some((denied.is_none(), security.source_type))
}

async fn run_search(
    org_id: &str,
    user_id: &str,
    sql: String,
    start_time: i64,
    end_time: i64,
    size: i64,
) -> Result<SearchResponse, ()> {
    let req = SearchRequest {
        query: SearchQuery {
            sql,
            start_time,
            end_time,
            from: 0,
            size,
            track_total_hits: false,
            ..Default::default()
        },
        regions: vec![],
        clusters: vec![],
        timeout: 0,
        ..Default::default()
    };
    let trace_id = config::ider::generate_trace_id();
    search_service::search(
        &trace_id,
        org_id,
        StreamType::Logs,
        Some(user_id.to_string()),
        &req,
    )
    .await
    .map_err(|e| log::warn!("Threat-intel sweep query failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_non_intel_tables_pass_without_a_security_grant() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        assert!(
            guard_intel_list("org", &stranger, "geoip", "POST")
                .await
                .is_ok()
        );
        assert!(
            guard_intel_list("org", &stranger, "geoip", "DELETE")
                .await
                .is_ok()
        );
    }

    #[tokio::test]
    async fn test_intel_lists_are_checked_against_the_security_grant() {
        let stranger = format!("{}@example.com", config::ider::uuid());
        for (table, method) in [("ioc_feed", "POST"), ("threat_intel_x", "DELETE")] {
            let allowed = security_allowed("org", &stranger, method).await;
            let res = guard_intel_list("org", &stranger, table, method).await;
            assert_eq!(res.is_ok(), allowed, "{table} {method}");
            if let Err(refused) = res {
                assert_eq!(refused.status(), axum::http::StatusCode::FORBIDDEN);
            }
        }
    }
}
