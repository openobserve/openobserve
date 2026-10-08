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

use axum::{extract::Path, response::Response};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/background_objects/stream_access_audit",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "StreamAccessAudit",
    summary = "Audit background objects whose owner cannot read their streams",
    description = "Lists every alert, composite alert, SLO, anomaly config, report, pipeline, backfill and eval job in the organization whose owner cannot read a stream it queries, with the path that disables each one. Pipelines, backfills and eval jobs store no owner and are listed separately with the streams they read. Org admins only; enterprise only.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Failure", content_type = "application/json", body = ()),
    ),
)]
pub async fn stream_access_audit(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    use openobserve_core::background_access::{audit::audit_org, is_org_admin};

    if !is_org_admin(&org_id, &user_email.user_id).await {
        return MetaHttpResponse::forbidden("Unauthorized Access");
    }
    match audit_org(&org_id).await {
        Ok(audit) => MetaHttpResponse::json(audit),
        Err(e) => MetaHttpResponse::internal_error(e.to_string()),
    }
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    get,
    path = "/v2/{org_id}/background_objects/stream_access_audit",
    context_path = "/api",
    tag = "Alerts",
    operation_id = "StreamAccessAudit",
    summary = "Audit background objects whose owner cannot read their streams",
    description = "Enterprise only; this build answers 403.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    responses(
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
)]
pub async fn stream_access_audit(
    Path(_org_id): Path<String>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    MetaHttpResponse::forbidden("Not Supported")
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode};

    use super::*;

    async fn answer(user_id: &str) -> (StatusCode, String) {
        let resp = stream_access_audit(
            Path("saa_org".to_string()),
            Headers(UserEmail {
                user_id: user_id.to_string(),
            }),
        )
        .await;
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        let body: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
        (
            status,
            body["message"].as_str().unwrap_or_default().to_string(),
        )
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn default_build_answers_not_supported() {
        assert_eq!(
            answer("anyone@example.com").await,
            (StatusCode::FORBIDDEN, "Not Supported".to_string())
        );
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn non_admin_is_refused_before_any_scan() {
        let checker = openobserve_core::authz::fake_checker();
        checker.grant_admin("saa_other_org", "saa_user@example.com");
        assert_eq!(
            answer("saa_user@example.com").await,
            (StatusCode::FORBIDDEN, "Unauthorized Access".to_string())
        );
    }
}
