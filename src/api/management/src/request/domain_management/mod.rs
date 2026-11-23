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
use common::meta::http::HttpResponse as MetaHttpResponse;
use config::META_ORG_ID;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::domain_management::{self, meta::DomainManagementRequest};
use openobserve_api_common::extractors::Headers;
use openobserve_core::{auth::UserEmail, users::is_org_admin};

/// Helper function to validate that only meta org can access domain management APIs
fn validate_meta_org_access(org_id: &str) -> Result<(), infra::errors::Error> {
    if org_id != META_ORG_ID {
        return Err(infra::errors::Error::Message(format!(
            "Domain management APIs are only available for meta organization. Provided org_id: {org_id}, expected: {META_ORG_ID}"
        )));
    }
    Ok(())
}

/// The OpenFGA row for these routes bypasses the check, so the `_meta` admin gate lives here.
async fn authorize(org_id: &str, user_id: &str) -> Result<(), Response> {
    if let Err(e) = validate_meta_org_access(org_id) {
        return Err(MetaHttpResponse::forbidden(e));
    }
    if !is_org_admin(META_ORG_ID, user_id).await {
        return Err(MetaHttpResponse::forbidden(format!(
            "Domain management requires the root user or an administrator of the {META_ORG_ID} \
             organization"
        )));
    }
    Ok(())
}

/// Get domain management configuration
#[utoipa::path(
    get,
    path = "/{org_id}/domain_management",
    context_path = "/api",
    tag = "Domain Management",
    operation_id = "GetDomainManagementConfig",
    summary = "Get domain management configuration",
    description = "Retrieves the current domain management configuration for custom domain settings and SSL certificate \
                   management. Only accessible to the root user or an administrator of the meta organization. Returns \
                   domain configuration including DNS settings, certificate status, and routing configurations for \
                   enterprise domain management.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = o2_enterprise::enterprise::domain_management::meta::DomainManagementResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "list"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn get_domain_management_config(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    if let Err(resp) = authorize(&org_id, &user_email.user_id).await {
        return resp;
    }

    #[cfg(feature = "enterprise")]
    match domain_management::get_domain_management_config().await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => {
            log::error!("Error getting domain management config: {e}");
            match e {
                infra::errors::Error::Message(ref msg) if msg.contains("not found") => {
                    MetaHttpResponse::not_found(e)
                }
                _ => MetaHttpResponse::internal_error(e),
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Domain management is not available")
}

/// Set domain management configuration
#[utoipa::path(
    put,
    path = "/{org_id}/domain_management",
    context_path = "/api",
    tag = "Domain Management",
    operation_id = "SetDomainManagementConfig",
    summary = "Configure domain management settings",
    description = "Updates the domain management configuration for custom domain settings, SSL certificates, and DNS \
                   routing. Only accessible to the root user or an administrator of the meta organization. Allows \
                   configuration of custom domains, certificate management, and traffic routing for enterprise \
                   deployments with custom branding and domain requirements.",
    security(("Authorization" = [])),
    params(
        ("org_id" = String, Path, description = "Organization name (must be meta org)"),
    ),
    request_body(content = inline(DomainManagementRequest), description = "Domain management configuration", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = o2_enterprise::enterprise::domain_management::meta::DomainOperationResponse),
        (status = 400, description = "Bad Request", content_type = "application/json", body = ()),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 500, description = "Internal Server Error", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Settings", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn set_domain_management_config(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    #[cfg(feature = "enterprise")] axum::Json(body): axum::Json<DomainManagementRequest>,
) -> Response {
    if let Err(resp) = authorize(&org_id, &user_email.user_id).await {
        return resp;
    }

    #[cfg(feature = "enterprise")]
    match domain_management::set_domain_management_config(body).await {
        Ok(response) => MetaHttpResponse::json(response),
        Err(e) => {
            log::error!("Error setting domain management config: {e}");
            match e {
                infra::errors::Error::Message(_) => MetaHttpResponse::bad_request(e),
                _ => MetaHttpResponse::internal_error(e),
            }
        }
    }

    #[cfg(not(feature = "enterprise"))]
    MetaHttpResponse::forbidden("Domain management is not available")
}

#[cfg(test)]
mod tests {
    use config::meta::user::{UserRole, UserType};

    use super::*;

    fn join(org_id: &str, email: &str, role: UserRole) {
        common::infra::config::USERS.insert(
            email.to_string(),
            infra::table::users::UserRecord {
                email: email.to_string(),
                first_name: "F".to_string(),
                last_name: "L".to_string(),
                password: "hash".to_string(),
                salt: "salt".to_string(),
                is_root: role == UserRole::Root,
                password_ext: None,
                user_type: UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        common::infra::config::ORG_USERS.insert(
            format!("{org_id}/{email}"),
            infra::table::org_users::OrgUserRecord {
                role,
                token: "token".to_string(),
                rum_token: None,
                org_id: org_id.to_string(),
                email: email.to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );
    }

    #[tokio::test]
    async fn only_root_or_a_meta_admin_passes_the_domain_management_gate() {
        let root = "root@domain-gate.test";
        let meta_admin = "admin@domain-gate.test";
        let other_admin = "other-admin@domain-gate.test";
        join(config::DEFAULT_ORG, root, UserRole::Root);
        join(META_ORG_ID, meta_admin, UserRole::Admin);
        join("domain-gate-acme", other_admin, UserRole::Admin);
        let mut refused = vec![
            (root, "domain-gate-acme"),
            (meta_admin, "domain-gate-acme"),
            (other_admin, "domain-gate-acme"),
        ];
        for (email, role) in [
            ("editor@domain-gate.test", UserRole::Editor),
            ("viewer@domain-gate.test", UserRole::Viewer),
            ("user@domain-gate.test", UserRole::User),
            ("sa@domain-gate.test", UserRole::ServiceAccount),
            ("sre@domain-gate.test", UserRole::SreAgent),
        ] {
            join(META_ORG_ID, email, role);
            refused.push((email, META_ORG_ID));
        }

        for caller in [root, meta_admin] {
            assert!(authorize(META_ORG_ID, caller).await.is_ok(), "{caller}");
        }
        for (caller, org_id) in refused {
            let resp = authorize(org_id, caller).await.expect_err(caller);
            assert_eq!(
                resp.status(),
                axum::http::StatusCode::FORBIDDEN,
                "{caller} {org_id}"
            );
        }
    }
}
