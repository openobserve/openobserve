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
    extract::{Path, Query},
    response::Response,
};
use hashbrown::HashMap;
use o2_enterprise::enterprise::cloud::billings;

use super::IntoHttpResponse;
use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    handler::http::models::billings::GetOrgUsageResponseBody, service::org_usage,
};

/// GetUsageData
#[utoipa::path(
    get,
    path = "/{org_id}/billings/data_usage/{usage_date}",
    context_path = "/api",
    tag = "Billings",
    operation_id = "GetUsageData",
    summary = "Get organization usage data",
    description = "Retrieves detailed usage metrics and statistics for the specified organization",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("usage_date" = String, Path, description = "Organization usage query range"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(GetOrgUsageResponseBody)),
        (status = 404, description = "Organization usage not found", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
)]
pub async fn get_org_usage(
    Path((org_id, query_range)): Path<(String, String)>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let usage_range = match query_range.parse::<billings::org_usage::UsageRange>() {
        Ok(usage_range) => usage_range,
        Err(e) => return e.into_http_response(),
    };
    let unit = query.get("data_type").map(|h| h.as_str()).unwrap_or("mb");

    match org_usage::get_org_usage(&org_id, &usage_range).await {
        Err(e) => e.into_http_response(),
        Ok(org_usage) => {
            let mut body = GetOrgUsageResponseBody {
                data: org_usage.into_iter().map(From::from).collect(),
                range: usage_range.to_string(),
            };
            body.convert_to_unit(unit);
            MetaHttpResponse::json(body)
        }
    }
}
