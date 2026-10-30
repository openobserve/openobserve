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
    extract::Path,
    response::{IntoResponse, Response},
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    ingestion::rejections::{RecentRejections, read_rejections},
};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

/// GetRecentIngestRejections
#[utoipa::path(
    get,
    path = "/{org_id}/ingest/recent_rejections",
    context_path = "/api",
    tag = "Ingestion",
    operation_id = "GetRecentIngestRejections",
    summary = "Recent rejected ingest requests",
    description = "One entry per rejection reason seen in the last hour, newest first; tracked is false once the org has data",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = RecentRejections),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn recent_rejections(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if !may_read(&org_id, &user_email.user_id) {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    Json(read_rejections(&org_id).await).into_response()
}

/// Root has no org_users row in non-default orgs, so it is admitted on its own.
fn may_read(org_id: &str, user_id: &str) -> bool {
    db::user::is_root_user(user_id) || db::org_users::get_cached_user_org(org_id, user_id).is_some()
}
