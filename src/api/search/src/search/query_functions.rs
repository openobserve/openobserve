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

//! The SQL function catalog served to the query editor.
//!
//! The frontend used to hand-maintain its list of callable functions, which had
//! no way of tracking the pinned DataFusion fork, build features, or an
//! organisation's own VRL transforms. This endpoint is derived from the live
//! registry instead.

use axum::{Json, extract::Path, response::Response};
use search::datafusion::exec::{CatalogFunction, catalog_functions};
use serde::Serialize;

#[derive(Debug, Serialize)]
pub struct QueryFunctionsResponse {
    pub list: Vec<CatalogFunction>,
}

/// GET /api/{org_id}/query_functions
///
/// Returns every function this organisation can call: the DataFusion registry
/// (including the JSON family), the O2 UDFs, the SQL-rewriter aliases, and the
/// org's own VRL transforms.
#[utoipa::path(
    get,
    path = "/{org_id}/query_functions",
    context_path = "/api",
    tag = "Search",
    operation_id = "QueryFunctions",
    security(("Authorization" = [])),
    params(("org_id" = String, Path, description = "Organization name")),
    responses(
        (status = 200, description = "Success", content_type = "application/json"),
    )
)]
pub async fn list(Path(org_id): Path<String>) -> Response {
    let list = catalog_functions(&org_id);
    axum::response::IntoResponse::into_response(Json(QueryFunctionsResponse { list }))
}
