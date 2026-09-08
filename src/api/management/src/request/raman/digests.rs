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

use super::error_response;

pub async fn list_raman_digests(
    Path(org_id): Path<String>,
    Query(query): Query<DigestQuery>,
) -> Response {
    match raman_service::list_digests(&org_id, query).await {
        Ok(list) => MetaHttpResponse::json(list),
        Err(error) => error_response(&error),
    }
}

pub async fn get_raman_digest(Path((org_id, digest_id)): Path<(String, String)>) -> Response {
    match raman_service::get_digest(&org_id, &digest_id).await {
        Ok(digest) => MetaHttpResponse::json(digest),
        Err(error) => error_response(&error),
    }
}

/// Answers 202: the run is only enqueued here, and the scheduler produces the digest.
pub async fn run_raman_digest(Path(org_id): Path<String>) -> Response {
    match raman_service::request_run(&org_id).await {
        Ok(accepted) => (StatusCode::ACCEPTED, Json(accepted)).into_response(),
        Err(error) => error_response(&error),
    }
}
