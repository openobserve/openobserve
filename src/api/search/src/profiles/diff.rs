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

use axum::{
    Json,
    extract::{Path, rejection::JsonRejection},
    http::HeaderMap,
    response::{IntoResponse, Response},
};
use config::meta::traces::session::quote_identifier;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    profiles::query::{DiffResult, build_diff_result, resolve_max_nodes},
};
use serde::{Deserialize, Serialize};
use tracing::Span;
use utoipa::ToSchema;

use super::{
    ProfilesQueryBody, ProfilesSqlParams, build_where_clause, check_stream_permission,
    merge::{load_stacks, snapshot_instance_key},
    parse_required_time_range, require_profile_type_and_unit, resolve_timeout,
};
use crate::common::{
    meta::http::HttpResponse as MetaHttpResponse, utils::http::get_or_create_trace_id,
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct ProfilesDiffBody {
    /// The "before" query; same fields as a merge request.
    pub baseline: ProfilesQueryBody,
    /// The "after" query; `profile_type` and `profile_unit` must match the baseline.
    pub comparison: ProfilesQueryBody,
    #[serde(default)]
    pub max_nodes: Option<usize>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct ProfilesDiffResponse {
    pub unit: String,
    pub profile_type: String,
    /// Baseline sample weight folded into `root` (`root.before_total`).
    pub baseline_total: i64,
    /// Comparison sample weight folded into `root` (`root.total`).
    pub comparison_total: i64,
    /// True when either side exceeded the unique-stack limit.
    pub truncated: bool,
    /// True when the call tree was cut to `max_nodes` and light nodes folded into `other`.
    pub tree_truncated: bool,
    /// Call tree: `total` / `self` are the comparison side, `before_*` the baseline.
    #[schema(value_type = Object)]
    pub root: openobserve_core::profiles::query::DiffNode,
    /// One row per function from both sides, largest share change first (pre-truncation).
    #[schema(value_type = Vec<Object>)]
    pub top: Vec<openobserve_core::profiles::query::DiffTopFunction>,
    pub took: u64,
}

/// Validated time range, filter and timeout of one diff side.
struct DiffSide {
    start_time: i64,
    end_time: i64,
    where_clause: String,
    timeout: i64,
}

impl DiffSide {
    fn from_body(body: &ProfilesQueryBody) -> Result<Self, Response> {
        let (start_time, end_time) = parse_required_time_range(body.start_time, body.end_time)?;
        Ok(Self {
            start_time,
            end_time,
            where_clause: build_where_clause(body)?,
            timeout: resolve_timeout(body.timeout)?,
        })
    }
}

/// ProfilesDiff
///
/// #{"ratelimit_module":"Profiles", "ratelimit_module_operation":"list"}#
#[utoipa::path(
    post,
    path = "/{org_id}/{stream_name}/profiles/diff",
    context_path = "/api",
    tag = "Profiles",
    operation_id = "ProfilesDiff",
    summary = "Compare two profile queries as one call tree",
    description = "Merges the baseline and comparison queries and folds both into one call tree where each node carries both sides' values, for a differential Flame Graph and a Top Table of changes. Both sides need the same `profile_type` and `profile_unit`.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("stream_name" = String, Path, description = "Profiles stream name"),
    ),
    request_body(content = ProfilesDiffBody, description = "Diff query", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", body = ProfilesDiffResponse),
        (status = 400, description = "Invalid request"),
        (status = 403, description = "Forbidden"),
        (status = 500, description = "Failure")
    )
)]
pub async fn diff_profiles(
    Path((org_id, stream_name)): Path<(String, String)>,
    headers: HeaderMap,
    Headers(user_email): Headers<UserEmail>,
    body: Result<Json<ProfilesDiffBody>, JsonRejection>,
) -> Response {
    if let Err(response) = check_stream_permission(&org_id, &stream_name, &user_email.user_id).await
    {
        return response;
    }
    let body = match body {
        Ok(Json(body)) => body,
        Err(rejection) => return MetaHttpResponse::bad_request(rejection.body_text()),
    };
    let (profile_type, unit) = match require_profile_type_and_unit(&body.comparison) {
        Ok(v) => v,
        Err(response) => return response,
    };
    match require_profile_type_and_unit(&body.baseline) {
        Ok((baseline_type, baseline_unit))
            if baseline_type == profile_type && baseline_unit == unit => {}
        Ok(_) => {
            return MetaHttpResponse::bad_request(
                "baseline and comparison must use the same profile_type and profile_unit",
            );
        }
        Err(response) => return response,
    }
    let (baseline, comparison) = match (
        DiffSide::from_body(&body.baseline),
        DiffSide::from_body(&body.comparison),
    ) {
        (Ok(b), Ok(c)) => (b, c),
        (Err(response), _) | (_, Err(response)) => return response,
    };
    let max_nodes = resolve_max_nodes(body.max_nodes);

    let http_span = Span::none();
    let request_trace_id = get_or_create_trace_id(&headers, &http_span);
    let started = std::time::Instant::now();
    let stream = quote_identifier(&stream_name);
    // Concurrent searches need their own ids: the query manager keys running searches by trace_id.
    let baseline_trace_id = format!("{request_trace_id}-baseline");
    let comparison_trace_id = format!("{request_trace_id}-comparison");
    let params_for = |trace_id, side: &DiffSide| ProfilesSqlParams {
        request_trace_id: trace_id,
        org_id: &org_id,
        user_id: &user_email.user_id,
        start_time: side.start_time,
        end_time: side.end_time,
        timeout: side.timeout,
    };
    let baseline_params = params_for(&baseline_trace_id, &baseline);
    let comparison_params = params_for(&comparison_trace_id, &comparison);
    let snapshot_key = snapshot_instance_key(&org_id, &stream_name, &profile_type).await;
    let (baseline_res, comparison_res) = tokio::join!(
        load_stacks(
            &baseline_params,
            &stream,
            &baseline.where_clause,
            snapshot_key.as_deref(),
            http_span.clone()
        ),
        load_stacks(
            &comparison_params,
            &stream,
            &comparison.where_clause,
            snapshot_key.as_deref(),
            http_span
        ),
    );
    let (baseline_set, comparison_set) = match (baseline_res, comparison_res) {
        (Ok(b), Ok(c)) => (b, c),
        (Err(response), _) | (_, Err(response)) => return response,
    };

    let DiffResult {
        baseline_total,
        comparison_total,
        root,
        top,
        tree_truncated,
    } = build_diff_result(&baseline_set.stacks, &comparison_set.stacks, max_nodes);

    Json(ProfilesDiffResponse {
        unit,
        profile_type,
        baseline_total,
        comparison_total,
        truncated: baseline_set.truncated || comparison_set.truncated,
        tree_truncated,
        root,
        top,
        took: started.elapsed().as_millis() as u64,
    })
    .into_response()
}
