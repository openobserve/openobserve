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
    response::Response,
};
use config::meta::user::UserRole;
use serde_json::json;

use crate::{
    common::{
        meta::{
            http::HttpResponse as MetaHttpResponse,
            organization::{
                CreateOrgIngestionTokenRequest, OrgIngestionTokenEnableRequest,
                OrgIngestionTokenListResponse, OrgIngestionTokenResponse,
            },
        },
        utils::auth::{UserEmail, is_root_user},
    },
    handler::http::extractors::Headers,
    service::{ingestion_tokens, users},
};

/// List all org-level ingestion tokens (masked).
///
/// GET /{org_id}/ingestion-tokens
#[utoipa::path(
    get,
    path = "/{org_id}/ingestion-tokens",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "ListOrgIngestionTokens",
    summary = "List org-level ingestion tokens",
    description = "Returns all org-level ingestion tokens for the organization. Token values are masked. Any authenticated user in the organization can access this.",
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
    Path(org_id): Path<String>,
) -> Response {
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

    if !is_root_user(user_id) {
        match users::get_user(Some(&org_id), user_id).await {
            Some(initiator)
                if initiator.role == UserRole::Admin || initiator.role == UserRole::Root => {}
            _ => {
                return MetaHttpResponse::forbidden(
                    "Admin or Root role required to create ingestion tokens",
                );
            }
        }
    }

    let description = body.description.unwrap_or_default();
    match ingestion_tokens::create_token(&org_id, &body.name, &description, user_id).await {
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
        (status = 200, description = "Success", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Ingestion Token", "operation": "toggle"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn enable_disable_ingestion_token(
    Headers(user_email): Headers<UserEmail>,
    Path((org_id, name)): Path<(String, String)>,
    Json(body): Json<OrgIngestionTokenEnableRequest>,
) -> Response {
    let user_id = user_email.user_id.as_str();

    if !is_root_user(user_id) {
        match users::get_user(Some(&org_id), user_id).await {
            Some(initiator)
                if initiator.role == UserRole::Admin || initiator.role == UserRole::Root => {}
            _ => {
                return MetaHttpResponse::forbidden(
                    "Admin or Root role required to manage ingestion tokens",
                );
            }
        }
    }

    match ingestion_tokens::set_enabled_token(&org_id, &name, body.enabled).await {
        Ok(()) => {
            let state = if body.enabled { "enabled" } else { "disabled" };
            MetaHttpResponse::ok(json!({"message": format!("Token {state} successfully")}))
        }
        Err(e) => {
            let err_msg = e.to_string();
            if err_msg.contains("not found") {
                MetaHttpResponse::not_found(e)
            } else {
                MetaHttpResponse::bad_request(e)
            }
        }
    }
}
