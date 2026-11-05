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
use infra::table::org_ingestion_tokens::is_writer_token_name;
use openobserve_api_common::extractors::Headers;
use openobserve_core::{
    auth::UserEmail,
    ingestion::feature_writer::{RESERVED_NAME, SPLUNK_FOR_WRITER},
    ingestion_tokens,
};
use serde_json::json;

use crate::common::meta::{
    http::HttpResponse as MetaHttpResponse,
    organization::{
        CreateOrgIngestionTokenRequest, OrgIngestionTokenEnableRequest,
        OrgIngestionTokenListResponse, OrgIngestionTokenResponse, SplunkTokenAction,
    },
};

/// List all org-level ingestion tokens.
///
/// GET /{org_id}/ingestion-tokens
#[utoipa::path(
    get,
    path = "/{org_id}/ingestion-tokens",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "ListOrgIngestionTokens",
    summary = "List org-level ingestion tokens",
    description = "Returns all org-level ingestion tokens for the organization. Requires Admin or Root role.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(OrgIngestionTokenListResponse)),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ingestion Token", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn list_ingestion_tokens(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
) -> Response {
    if let Err(resp) = super::require_credential_access(
        &org_id,
        user_email.user_id.as_str(),
        "list ingestion tokens",
    )
    .await
    {
        return resp;
    }

    match ingestion_tokens::list_tokens(&org_id).await {
        Ok(tokens) => MetaHttpResponse::json(OrgIngestionTokenListResponse { data: tokens }),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// Create a new named org-level ingestion token.
///
/// POST /{org_id}/ingestion-tokens
#[utoipa::path(
    post,
    path = "/{org_id}/ingestion-tokens",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "CreateOrgIngestionToken",
    summary = "Create a new org-level ingestion token",
    description = "Creates a new named ingestion token at the org level. Requires Admin or Root role. The full token value is returned once.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
    ),
    request_body(content = inline(CreateOrgIngestionTokenRequest)),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(OrgIngestionTokenResponse)),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ingestion Token", "operation": "create"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn create_ingestion_token(
    Headers(user_email): Headers<UserEmail>,
    Path(org_id): Path<String>,
    Json(body): Json<CreateOrgIngestionTokenRequest>,
) -> Response {
    let user_id = user_email.user_id.as_str();

    if let Err(resp) =
        super::require_credential_access(&org_id, user_id, "create ingestion tokens").await
    {
        return resp;
    }

    // A writer token reaches the internal ingest RPC, so only the system may hold such a name.
    if is_writer_token_name(body.name.trim()) {
        return MetaHttpResponse::bad_request(RESERVED_NAME);
    }

    let description = body.description.unwrap_or_default();
    match ingestion_tokens::create_token(
        &org_id,
        &body.name,
        &description,
        user_id,
        body.splunk_token,
    )
    .await
    {
        Ok(token) => MetaHttpResponse::json(OrgIngestionTokenResponse { data: token }),
        Err(e) => MetaHttpResponse::bad_request(e),
    }
}

/// Enable or disable an org-level ingestion token.
///
/// PATCH /{org_id}/ingestion-tokens/{name}
#[utoipa::path(
    patch,
    path = "/{org_id}/ingestion-tokens/{name}",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "EnableDisableOrgIngestionToken",
    summary = "Enable or disable an org-level ingestion token",
    description = "Enables or disables the specified named ingestion token. Disabled tokens cannot be used for ingestion. Requires Admin or Root role.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization identifier"),
        ("name" = String, Path, description = "Token name"),
    ),
    request_body(content = inline(OrgIngestionTokenEnableRequest)),
    responses(
        (status = 200, description = "Success; `message` holds the JSON-encoded {message, splunk_token}", content_type = "application/json", body = MetaHttpResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ingestion Token", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn enable_disable_ingestion_token(
    Headers(user_email): Headers<UserEmail>,
    Path((org_id, name)): Path<(String, String)>,
    Json(body): Json<OrgIngestionTokenEnableRequest>,
) -> Response {
    let user_id = user_email.user_id.as_str();

    if let Err(resp) =
        super::require_credential_access(&org_id, user_id, "manage ingestion tokens").await
    {
        return resp;
    }

    if body.enabled.is_none() && body.splunk_token.is_none() {
        return MetaHttpResponse::bad_request(
            "At least one of 'enabled' or 'splunk_token' is required",
        );
    }

    // A GUID would open Splunk HEC ingest to a token kept for one stream.
    if body.splunk_token == Some(SplunkTokenAction::Generate) && is_writer_token_name(&name) {
        return MetaHttpResponse::bad_request(SPLUNK_FOR_WRITER);
    }

    let mut messages: Vec<String> = Vec::new();
    let mut splunk_token: Option<String> = None;

    if let Some(enabled) = body.enabled {
        if let Err(e) = ingestion_tokens::set_enabled_token(&org_id, &name, enabled).await {
            return token_patch_error(e);
        }
        let state = if enabled { "enabled" } else { "disabled" };
        messages.push(format!("Token {state} successfully"));
    }

    if let Some(action) = body.splunk_token {
        let generate = action == SplunkTokenAction::Generate;
        match ingestion_tokens::set_splunk_token(&org_id, &name, generate).await {
            Ok(value) => {
                splunk_token = value;
                let state = if generate { "generated" } else { "revoked" };
                messages.push(format!("Splunk token {state} successfully"));
            }
            Err(e) => return token_patch_error(e),
        }
    }

    MetaHttpResponse::ok(json!({
        "message": messages.join("; "),
        "splunk_token": splunk_token,
    }))
}

/// A missing token is a 404; everything else on this route is a bad request.
fn token_patch_error(e: anyhow::Error) -> Response {
    if e.to_string().contains("not found") {
        MetaHttpResponse::not_found(e)
    } else {
        MetaHttpResponse::bad_request(e)
    }
}

#[cfg(test)]
mod tests {
    use axum::{body::to_bytes, http::StatusCode};
    use common::infra::config::ORG_USERS;
    use config::meta::user::UserRole;
    use infra::table::org_users::OrgUserRecord;

    use super::*;

    const ROOT: &str = "tokens-root@example.com";

    async fn create(org: &str, name: &str) -> (StatusCode, String) {
        ORG_USERS.insert(
            format!("{}/{ROOT}", config::DEFAULT_ORG),
            OrgUserRecord {
                email: ROOT.to_string(),
                org_id: config::DEFAULT_ORG.to_string(),
                role: UserRole::Root,
                token: String::new(),
                rum_token: None,
                created_at: 0,
                allow_static_token: true,
            },
        );
        let body = CreateOrgIngestionTokenRequest {
            name: name.to_string(),
            description: None,
            splunk_token: false,
        };
        let user = UserEmail {
            user_id: ROOT.to_string(),
        };
        let resp = create_ingestion_token(Headers(user), Path(org.to_string()), Json(body)).await;
        let status = resp.status();
        let bytes = to_bytes(resp.into_body(), usize::MAX).await.unwrap();
        (status, String::from_utf8_lossy(&bytes).to_string())
    }

    #[tokio::test]
    async fn a_user_cannot_create_an_o2_token_name() {
        std::fs::create_dir_all(&config::get_config().common.data_db_dir).unwrap();
        infra::db_init().await.unwrap();
        infra::table::migrate().await.unwrap();
        let org = format!("demo-org-reserved-{}", config::utils::time::now_micros());
        for name in ["_o2_x", "_o2_alert_calibration", " _o2_autoobserve"] {
            let (status, body) = create(&org, name).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "{name}: {body}");
            assert!(body.contains(RESERVED_NAME), "{name}: {body}");
        }
        let (status, body) = create(&org, "ci-collector").await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
}
