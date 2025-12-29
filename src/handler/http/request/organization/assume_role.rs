// Copyright 2025 OpenObserve Inc.
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

#[cfg(feature = "enterprise")]
use actix_web::{HttpResponse, post, web};
// Re-export shared types from config crate for OpenAPI
#[cfg(feature = "enterprise")]
pub use config::meta::session::{AssumeRoleRequest, AssumeRoleResponse};

#[cfg(feature = "enterprise")]
use crate::{
    common::{
        meta::http::HttpResponse as MetaHttpResponse,
        utils::auth::{AuthExtractor, UserEmail},
    },
    handler::http::extractors::Headers,
};

/// Assume a role in a target organization
///
/// This endpoint allows meta service accounts to obtain temporary session tokens
/// for accessing a target organization with a specific role. The session automatically
/// expires after the specified duration.
///
/// # Security
/// - Only meta service accounts can call this endpoint
/// - The service account must exist in both _meta and target organization
/// - The service account must have the requested role in the target organization
/// - Maximum session duration is capped at 24 hours
///
/// # Example
/// ```bash
/// curl -X POST http://localhost:5080/api/_meta/assume_role \
///   -H "Authorization: Bearer <meta_sa_token>" \
///   -H "Content-Type: application/json" \
///   -d '{
///     "org_id": "customer1",
///     "role_name": "tenant_admin",
///     "duration_seconds": 3600
///   }'
/// ```
#[cfg(feature = "enterprise")]
#[utoipa::path(
    context_path = "/api",
    tag = "Organizations",
    operation_id = "AssumeRole",
    security(
        ("Authorization" = [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name (must be _meta)"),
    ),
    request_body(
        content = AssumeRoleRequest,
        description = "Assume role request",
        content_type = "application/json"
    ),
    responses(
        (status = StatusCode::OK, description = "Session created successfully", body = AssumeRoleResponse),
        (status = StatusCode::FORBIDDEN, description = "Not authorized or role not assigned"),
        (status = StatusCode::BAD_REQUEST, description = "Invalid request"),
        (status = StatusCode::INTERNAL_SERVER_ERROR, description = "Internal server error"),
    ),
)]
#[cfg(feature = "enterprise")]
#[post("/{org_id}/organizations/assume_role")]
pub async fn assume_role(
    org_id: web::Path<String>,
    req: web::Json<AssumeRoleRequest>,
    _auth: AuthExtractor,
    Headers(user_email): Headers<UserEmail>,
) -> Result<HttpResponse, actix_web::Error> {
    let org_id = org_id.into_inner();
    let req = req.into_inner();
    let user_email = user_email.user_id;

    log::info!(
        "Assume role request: user='{}', target_org='{}', role='{}', duration={:?}",
        user_email,
        req.org_id,
        req.role_name,
        req.duration_seconds
    );

    // Step 1: Verify the request is for _meta org
    if org_id != config::META_ORG_ID {
        log::warn!(
            "Assume role rejected: API must be called on _meta org, got '{}'",
            org_id
        );
        return Ok(MetaHttpResponse::bad_request(
            "Assume role API must be called on _meta organization",
        ));
    }

    // Step 2: Call enterprise implementation
    use crate::service::{db, users};

    // Request is already in the correct format (config::meta::session::AssumeRoleRequest)
    let enterprise_req = req;

    let result = o2_enterprise::enterprise::assume_role::process_assume_role(
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
                log::debug!(
                    "Found org_user: is_meta_service_account={}",
                    record.is_meta_service_account
                );
                Ok(o2_enterprise::enterprise::assume_role::OrgUserInfo {
                    token: record.token,
                    is_meta_service_account: record.is_meta_service_account,
                })
            })
        },
        |session_id, token, expires_at| {
            let session_id = session_id.to_string();
            let email = user_email.to_string();
            // Create Basic auth token in format: Basic base64(email:token)
            let basic_auth = format!("{}:{}", email, token);
            let basic_auth_encoded = config::utils::base64::encode(&basic_auth);
            let auth_token = format!("Basic {}", basic_auth_encoded);
            Box::pin(async move {
                db::session::set_with_expiry(&session_id, &auth_token, expires_at).await
            })
        },
    )
    .await
    .map_err(|e| {
        log::error!("Assume role failed: {}", e);
        if let Some(msg) = e.strip_prefix("BADREQUEST:") {
            actix_web::error::ErrorBadRequest(msg.to_string())
        } else if let Some(msg) = e.strip_prefix("FORBIDDEN:") {
            actix_web::error::ErrorForbidden(msg.to_string())
        } else {
            actix_web::error::ErrorForbidden(e)
        }
    })?;

    Ok(HttpResponse::Ok().json(AssumeRoleResponse {
        session_id: result.session_id,
        org_id: result.org_id,
        role_name: result.role_name,
        expires_at: chrono::DateTime::from_timestamp(result.expires_at, 0)
            .unwrap()
            .to_rfc3339(),
        expires_in: result.duration,
    }))
}
