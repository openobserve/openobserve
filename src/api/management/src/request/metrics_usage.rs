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
    extract::Path,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, metrics::usage};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// GetMetricUsage
#[utoipa::path(
    get,
    path = "/{org_id}/metrics/{metric_name}/usage",
    context_path = "/api",
    tag = "Metrics",
    operation_id = "GetMetricUsage",
    summary = "Where a metric is used",
    description = "Lists the dashboards, alerts, SLOs and scheduled pipelines the caller can read whose queries reference the metric",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("metric_name" = String, Path, description = "Metric name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = usage::MetricUsage),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = MetaHttpResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Metrics", "operation": "get"}))
    ),
)]
pub async fn get_metric_usage(
    Path((org_id, metric_name)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    match usage::metric_usage(&org_id, &user_email.user_id, &metric_name).await {
        Ok(found) => MetaHttpResponse::json(found),
        Err(e) => {
            tracing::error!("[metric usage] scan failed for {org_id}/{metric_name}: {e}");
            MetaHttpResponse::error(StatusCode::INTERNAL_SERVER_ERROR.as_u16(), e.to_string())
                .into_response()
        }
    }
}
