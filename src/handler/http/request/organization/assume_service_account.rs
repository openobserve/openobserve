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
    http::StatusCode,
    response::{IntoResponse, Response},
};
// Re-export shared types from config crate for OpenAPI (unconditionally for OpenAPI
// generation)
pub use config::meta::session::{AssumeServiceAccountRequest, AssumeServiceAccountResponse};

#[cfg(feature = "enterprise")]
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::auth::{AuthExtractor, UserEmail},
    },
    handler::http::extractors::Headers,
};

/// Assume a service account in a target organization
///
/// This endpoint allows meta service accounts to obtain temporary session tokens
/// for accessing a target organization as a specific service account. The session
/// automatically expires after the specified duration.
///
/// # Security
/// - Only meta service accounts can call this endpoint
/// - The service account must exist in both _meta and target organization
/// - The service account must have the appropriate role in the target organization
/// - Maximum session duration is capped at 24 hours
///
/// # Example
/// ```bash
/// curl -X POST http://localhost:5080/api/_meta/assume_service_account \
///   -H "Authorization: Bearer <meta_sa_token>" \
///   -H "Content-Type: application/json" \
///   -d '{
///     "org_id": "customer1",
///     "service_account": "tenant_admin_sa",
///     "duration_seconds": 3600
///   }'
/// ```
#[utoipa::path(
    post,
    path = "/{org_id}/organizations/assume_service_account",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "AssumeServiceAccount",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name (must be _meta)"),
    ),
    request_body(
        content = AssumeServiceAccountRequest,
        description = "Assume service account request",
        content_type = "application/json"
    ),
    responses(
        (status = StatusCode::OK, description = "Session created successfully", body = AssumeServiceAccountResponse),
        (status = StatusCode::FORBIDDEN, description = "Not authorized or service account not assigned"),
        (status = StatusCode::BAD_REQUEST, description = "Invalid request"),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal server error"),
        (status = 501, description = "Not available in non-enterprise builds"),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Organizations", "operation": "assume"})),
        ("x-o2-mcp" = json!({"description": "Assume service account identity", "category": "users"}))
    )
)]
#[cfg(feature = "enterprise")]
pub async fn assume_service_account(
    Path(org_id): Path<String>,
    _auth: AuthExtractor,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<AssumeServiceAccountRequest>,
) -> Response {
    let mut req = req;
    let user_email = user_email.user_id;

    // Default service_account to caller's user_id if not specified
    let target_service_account = req
        .service_account
        .clone()
        .unwrap_or_else(|| user_email.clone());

    log::info!(
        "Assume service account request: user='{}', target_org='{}', service_account='{}', duration={:?}",
        user_email,
        req.org_id,
        target_service_account,
        req.duration_seconds
    );

    // Step 1: Verify the request is for _meta org
    if org_id != config::META_ORG_ID {
        log::warn!(
            "Assume service account rejected: API must be called on _meta org, got '{}'",
            org_id
        );
        return MetaHttpResponse::bad_request(
            "Assume service account API must be called on _meta organization",
        );
    }

    // Step 2: Call enterprise implementation
    use crate::service::{db, users};

    // Clone for use in the session creation closure
    let target_service_account_for_session = target_service_account.clone();

    // Set the service_account field to the resolved value
    req.service_account = Some(target_service_account);

    let enterprise_req = req;

    let result = o2_enterprise::enterprise::assume_service_account::process_assume_service_account(
        &user_email,
        enterprise_req,
        |org_id, email| {
            let org_id = org_id.to_string();
            let email = email.to_string();
            Box::pin(async move { users::get_user(Some(&org_id), &email).await })
        },
        |org_id, email| {
            let org_id = org_id.to_string();
            let email = email.to_string();
            Box::pin(async move {
                log::debug!(
                    "Attempting to get org_user for org_id='{}', email='{}'",
                    org_id,
                    email
                );
                let record = db::org_users::get(&org_id, &email).await.map_err(|e| {
                    log::error!(
                        "Failed to get org_user for org_id='{}', email='{}': {}",
                        org_id,
                        email,
                        e
                    );
                    e.to_string()
                })?;
                log::debug!("Found org_user: role={:?}", record.role);
                Ok(
                    o2_enterprise::enterprise::assume_service_account::OrgUserInfo {
                        token: record.token,
                        role: format!("{}", record.role),
                    },
                )
            })
        },
        |session_id, token, expires_at| {
            let session_id = session_id.to_string();
            // Use the target service account email, not the caller's email
            let email = target_service_account_for_session.to_string();
            // Create Basic auth token in format: Basic base64(email:token)
            let basic_auth = format!("{}:{}", email, token);
            let basic_auth_encoded = config::utils::base64::encode(&basic_auth);
            let auth_token = format!("Basic {}", basic_auth_encoded);
            Box::pin(async move {
                db::session::set_with_expiry(&session_id, &auth_token, expires_at).await
            })
        },
    )
    .await;

    let result = match result {
        Ok(r) => r,
        Err(e) => {
            log::error!("Assume service account failed: {}", e);
            if let Some(msg) = e.strip_prefix("BADREQUEST:") {
                return MetaHttpResponse::bad_request(msg);
            } else if let Some(msg) = e.strip_prefix("FORBIDDEN:") {
                return MetaHttpResponse::forbidden(msg);
            } else {
                return MetaHttpResponse::forbidden(e);
            }
        }
    };

    (
        StatusCode::OK,
        Json(AssumeServiceAccountResponse {
            session_id: result.session_id,
            org_id: result.org_id,
            role_name: result.role_name,
            expires_at: chrono::DateTime::from_timestamp(result.expires_at, 0)
                .unwrap()
                .to_rfc3339(),
            expires_in: result.duration,
        }),
    )
        .into_response()
}

#[cfg(not(feature = "enterprise"))]
#[utoipa::path(
    post,
    path = "/{org_id}/organizations/assume_service_account",
    context_path = "/api",
    tag = "Organizations",
    operation_id = "AssumeServiceAccount",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name (must be _meta)"),
    ),
    request_body(
        content = AssumeServiceAccountRequest,
        description = "Assume service account request",
        content_type = "application/json"
    ),
    responses(
        (status = StatusCode::OK, description = "Session created successfully", body = AssumeServiceAccountResponse),
        (status = StatusCode::FORBIDDEN, description = "Not authorized or service account not assigned"),
        (status = StatusCode::BAD_REQUEST, description = "Invalid request"),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal server error"),
        (status = 501, description = "Not available in non-enterprise builds"),
    ),
)]
pub async fn assume_service_account(
    Path(_org_id): Path<String>,
    Json(_req): Json<AssumeServiceAccountRequest>,
) -> Response {
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({
            "error": "This feature is only available in the enterprise version"
        })),
    )
        .into_response()
}
