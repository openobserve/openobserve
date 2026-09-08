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

//! The digest timeline, the single-digest read, and the manual run request.

use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use common::meta::http::HttpResponse as MetaHttpResponse;
use o2_enterprise::enterprise::raman_service::{self, DigestQuery};

use super::{deployment_disabled, error_response};

#[utoipa::path(
    get,
    path = "/v2/{org_id}/raman/digests",
    context_path = "/api",
    tag = "Raman",
    operation_id = "ListRamanDigests",
    summary = "List alert hygiene (Raman) digests",
    description = "One page of digest summaries, newest first, with `total` counting every digest the filter matches rather than the page. Summaries omit the findings blob.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("limit" = Option<u64>, Query, description = "Page size (default 50, max 1000)"),
        ("offset" = Option<u64>, Query, description = "Rows to skip"),
        ("from" = Option<i64>, Query, description = "Inclusive lower bound on window_end (microseconds)"),
        ("to" = Option<i64>, Query, description = "Exclusive upper bound on window_end (microseconds)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 400, description = "A page limit outside its bounds, or a range whose start is after its end", content_type = "application/json", body = Object),
        (status = 404, description = "Raman is disabled deployment-wide (ZO_RAMAN_ENABLED=false)", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn list_raman_digests(
    Path(org_id): Path<String>,
    Query(query): Query<DigestQuery>,
) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match raman_service::list_digests(&org_id, query).await {
        Ok(list) => MetaHttpResponse::json(list),
        Err(error) => error_response(&error),
    }
}

#[utoipa::path(
    get,
    path = "/v2/{org_id}/raman/digests/{digest_id}",
    context_path = "/api",
    tag = "Raman",
    operation_id = "GetRamanDigest",
    summary = "Get one alert hygiene (Raman) digest",
    description = "The single-digest read, which unlike the listing carries the findings payload.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("digest_id" = String, Path, description = "Digest identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "Raman is disabled deployment-wide (ZO_RAMAN_ENABLED=false), or no such digest in this org", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn get_raman_digest(Path((org_id, digest_id)): Path<(String, String)>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match raman_service::get_digest(&org_id, &digest_id).await {
        Ok(digest) => MetaHttpResponse::json(digest),
        Err(error) => error_response(&error),
    }
}

/// Answers 202, not 200: the run is only enqueued here, and the scheduler produces the digest.
#[utoipa::path(
    post,
    path = "/v2/{org_id}/raman/digests/run",
    context_path = "/api",
    tag = "Raman",
    operation_id = "RunRamanDigest",
    summary = "Request a manual alert hygiene (Raman) run",
    description = "Enqueues a run and returns the time the scheduler will pick it up. An org has at most one raman job, so a second request while one is due or in flight is accepted without enqueuing another.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 202, description = "Run accepted", content_type = "application/json", body = Object),
        (status = 400, description = "The org's raman config is disabled, so a run would produce no digest", content_type = "application/json", body = Object),
        (status = 404, description = "Raman is disabled deployment-wide (ZO_RAMAN_ENABLED=false), or the org has no config", content_type = "application/json", body = Object),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = Object),
    )
)]
pub async fn run_raman_digest(Path(org_id): Path<String>) -> Response {
    if let Some(disabled) = deployment_disabled() {
        return disabled;
    }
    match raman_service::request_run(&org_id).await {
        Ok(accepted) => (StatusCode::ACCEPTED, Json(accepted)).into_response(),
        Err(error) => error_response(&error),
    }
}
