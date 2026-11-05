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

use crate::{
    common::meta::http::HttpResponse as MetaHttpResponse,
    service::sample_data::{self, PutSampleDataRequest, SampleDataError, SampleDataState},
};

#[utoipa::path(
    get,
    path = "/{org_id}/sample_data",
    context_path = "/api",
    tag = "Sample Data",
    operation_id = "GetSampleData",
    summary = "Get the sample data window",
    description = "Returns the time window the organization's sample data was loaded into, in microseconds since the epoch. An organization without sample data gets `{\"status\":\"none\"}`.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SampleDataState),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "get"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get(Path(org_id): Path<String>) -> Response {
    match sample_data::get(&org_id).await {
        Ok(state) => MetaHttpResponse::json(state),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[utoipa::path(
    put,
    path = "/{org_id}/sample_data",
    context_path = "/api",
    tag = "Sample Data",
    operation_id = "PutSampleData",
    summary = "Save the sample data window",
    description = "Records the time window the organization's sample data was loaded into. `start_time` must be lower than `end_time`, both in microseconds since the epoch. A saved window always reads back as `loaded`.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = PutSampleDataRequest, description = "Sample data window", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SampleDataState),
        (status = 400, description = "start_time is not lower than end_time", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn put(Path(org_id): Path<String>, Json(req): Json<PutSampleDataRequest>) -> Response {
    match sample_data::put(&org_id, req).await {
        Ok(state) => MetaHttpResponse::json(state),
        Err(e @ SampleDataError::Invalid(_)) => MetaHttpResponse::bad_request(e),
        Err(SampleDataError::Store(e)) => MetaHttpResponse::internal_error(e),
    }
}

#[utoipa::path(
    delete,
    path = "/{org_id}/sample_data",
    context_path = "/api",
    tag = "Sample Data",
    operation_id = "DeleteSampleData",
    summary = "Clear the sample data window",
    description = "Clears the organization's sample data window, so the state reads `{\"status\":\"none\"}`. Clearing a missing state also succeeds.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = SampleDataState),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Dashboards", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete(Path(org_id): Path<String>) -> Response {
    match sample_data::delete(&org_id).await {
        Ok(()) => MetaHttpResponse::json(SampleDataState::default()),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(test)]
mod tests {
    use axum::http::StatusCode;

    use super::*;

    #[tokio::test]
    async fn put_with_a_window_that_does_not_move_forward_is_400() {
        for (start_time, end_time) in [(200, 100), (100, 100)] {
            let req = PutSampleDataRequest {
                start_time,
                end_time,
            };
            let resp = put(Path("default".to_string()), Json(req)).await;
            assert_eq!(
                resp.status(),
                StatusCode::BAD_REQUEST,
                "{start_time}..{end_time}"
            );
        }
    }
}
