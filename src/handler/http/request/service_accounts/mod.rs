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
use config::{meta::user::UserRole, utils::rand::generate_random_string};
use hashbrown::HashMap;

#[cfg(feature = "enterprise")]
use crate::common::utils::auth::check_permissions;
use crate::{
    common::{
        meta::{
            self,
            http::HttpResponse as MetaHttpResponse,
            service_account::{APIToken, ServiceAccountRequest, UpdateServiceAccountRequest},
            user::{UpdateUser, UserRequest, UserUpdateMode},
        },
        utils::auth::UserEmail,
    },
    handler::http::{
        extractors::Headers,
        request::{BulkDeleteRequest, BulkDeleteResponse},
    },
    service::users,
};

/// ListServiceAccounts

#[utoipa::path(
    get,
    path = "/{org_id}/service_accounts",
    context_path = "/api",
    tag = "ServiceAccounts",
    operation_id = "ServiceAccountsList",
    summary = "List service accounts",
    description = "Retrieves a list of all service accounts in the organization. Service accounts are special user accounts \
                   designed for automated systems and applications to authenticate and access resources without human \
                   intervention. Each service account has an associated API token for programmatic access.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "list"})),
        ("x-o2-mcp" = json!({"description": "List service accounts", "category": "users"}))
    )
)]
pub async fn list(Path(org_id): Path<String>, Headers(user_email): Headers<UserEmail>) -> Response {
    let config = config::get_config();
    if !config.auth.service_account_enabled {
        return MetaHttpResponse::forbidden("Service Accounts Not Enabled");
    }

    let user_id = &user_email.user_id;
    let mut _user_list_from_rbac = None;
    // Get List of allowed objects
    #[cfg(feature = "enterprise")]
    {
        match crate::handler::http::auth::validator::list_objects_for_user(
            &org_id,
            user_id,
            "GET",
            "service_accounts",
        )
        .await
        {
            Ok(user_list) => {
                _user_list_from_rbac = user_list;
            }
            Err(e) => {
                return crate::common::meta::http::HttpResponse::forbidden(e.to_string());
            }
        }
        // Get List of allowed objects ends
    }
    match users::list_users(
        user_id,
        &org_id,
        Some(UserRole::ServiceAccount),
        _user_list_from_rbac,
        false,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// CreateServiceAccount

#[utoipa::path(
    post,
    path = "/{org_id}/service_accounts",
    context_path = "/api",
    tag = "ServiceAccounts",
    operation_id = "ServiceAccountSave",
    summary = "Create service account",
    description = "Creates a new service account for automated systems and applications. Service accounts provide a secure way \
                   for non-human users to authenticate and access resources programmatically. Each service account is \
                   automatically assigned an API token that can be used for authentication in automated workflows and \
                   integrations.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(ServiceAccountRequest), description = "ServiceAccount data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create service account", "category": "users"}))
    )
)]
pub async fn save(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(service_account): Json<ServiceAccountRequest>,
) -> Response {
    let config = config::get_config();
    if !config.auth.service_account_enabled {
        return MetaHttpResponse::forbidden("Service Accounts Not Enabled");
    }

    let initiator_id = user_email.user_id;
    let user = UserRequest {
        email: service_account.email.trim().to_string(),
        first_name: service_account.first_name.trim().to_string(),
        last_name: service_account.last_name.trim().to_string(),
        password: generate_random_string(16),
        role: meta::user::UserOrgRole {
            base_role: UserRole::ServiceAccount,
            custom_role: None,
        },
        is_external: false,
        token: None,
    };

    match users::post_user(&org_id, user, &initiator_id).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// UpdateServiceAccount

#[utoipa::path(
    put,
    path = "/{org_id}/service_accounts/{email_id}",
    context_path = "/api",
    tag = "ServiceAccounts",
    operation_id = "ServiceAccountUpdate",
    summary = "Update service account",
    description = "Updates an existing service account's information such as first name and last name. You can also rotate the \
                   API token by adding the 'rotateToken=true' query parameter, which generates a new authentication token \
                   while invalidating the old one. This is useful for security maintenance and credential rotation policies.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "Service Account email id"),
    ),
    request_body(content = inline(UpdateServiceAccountRequest), description = "Service Account data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update service account", "category": "users"}))
    )
)]
pub async fn update(
    Path((org_id, email_id)): Path<(String, String)>,
    axum::extract::Query(query): axum::extract::Query<HashMap<String, String>>,
    Headers(user_email): Headers<UserEmail>,
    Json(service_account): Json<UpdateServiceAccountRequest>,
) -> Response {
    let config = config::get_config();
    if !config.auth.service_account_enabled {
        return MetaHttpResponse::forbidden("Service Accounts Not Enabled");
    }

    let email_id = email_id.trim().to_lowercase();

    let rotate_token = match query.get("rotateToken") {
        Some(s) => match s.to_lowercase().as_str() {
            "true" => true,
            "false" => false,
            _ => {
                return MetaHttpResponse::bad_request(
                    " 'rotateToken' query param with value 'true' or 'false' allowed",
                );
            }
        },
        None => false,
    };

    if rotate_token {
        return match crate::service::organization::update_passcode(Some(&org_id), &email_id).await {
            Ok(passcode) => (
                StatusCode::OK,
                Json(APIToken {
                    token: passcode.passcode,
                    user: passcode.user,
                }),
            )
                .into_response(),
            Err(e) => (
                StatusCode::NOT_FOUND,
                Json(MetaHttpResponse::error(StatusCode::NOT_FOUND, e)),
            )
                .into_response(),
        };
    };

    let user = UpdateUser {
        change_password: false,
        first_name: Some(service_account.first_name.trim().to_string()),
        last_name: Some(service_account.last_name.trim().to_string()),
        old_password: None,
        new_password: None,
        role: None,
        token: None,
    };
    let initiator_id = &user_email.user_id;

    match users::update_user(
        &org_id,
        &email_id,
        UserUpdateMode::OtherUpdate,
        initiator_id,
        user,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// RemoveServiceAccount

#[utoipa::path(
    delete,
    path = "/{org_id}/service_accounts/{email_id}",
    context_path = "/api",
    tag = "ServiceAccounts",
    operation_id = "RemoveServiceAccount",
    summary = "Delete service account",
    description = "Permanently removes a service account from the organization. This action immediately invalidates the associated API token and revokes all access permissions for the service account. Use this when decommissioning automated systems or cleaning up unused accounts. This operation cannot be undone.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "Service Account email id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Delete service account", "category": "users"}))
    )
)]
pub async fn delete(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let config = config::get_config();
    if !config.auth.service_account_enabled {
        return MetaHttpResponse::forbidden("Service Accounts Not Enabled");
    }

    let initiator_id = user_email.user_id;
    match users::remove_user_from_org(&org_id, &email_id, &initiator_id).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// RemoveServiceAccountBulk
#[utoipa::path(
    delete,
    path = "/{org_id}/service_accounts/bulk",
    context_path = "/api",
    tag = "ServiceAccounts",
    operation_id = "RemoveServiceAccountBulk",
    summary = "Delete nultiple service account",
    description = "Permanently removes multiple service accounts from the organization. This action immediately invalidates the associated API token and revokes all access permissions for the service account. Use this when decommissioning automated systems or cleaning up unused accounts. This operation cannot be undone.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = BulkDeleteRequest, description = "emails of accounts to be deleted", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = BulkDeleteResponse),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Json(req): Json<BulkDeleteRequest>,
) -> Response {
    let config = config::get_config();
    if !config.auth.service_account_enabled {
        return MetaHttpResponse::forbidden("Service Accounts Not Enabled");
    }

    let initiator_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for email in &req.ids {
        if !check_permissions(
            email,
            &org_id,
            &initiator_id,
            "service_accounts",
            "DELETE",
            None,
        )
        .await
        {
            return MetaHttpResponse::forbidden("Unauthorized Access");
        }
    }

    let mut successful = Vec::with_capacity(req.ids.len());
    let mut unsuccessful = Vec::with_capacity(req.ids.len());
    let mut err = None;

    for email in req.ids {
        match users::remove_user_from_org(&org_id, &email, &initiator_id).await {
            Ok(v) => {
                if v.status().is_success() {
                    successful.push(email);
                } else {
                    log::error!(
                        "error in deleting service account {org_id}/{email} : {:?}",
                        v.status().canonical_reason()
                    );
                    unsuccessful.push(email);
                    err = v.status().canonical_reason().map(|v| v.to_string());
                }
            }
            Err(e) => {
                log::error!("error in deleting service account {org_id}/{email} : {e}");
                unsuccessful.push(email);
                err = Some(e.to_string());
            }
        }
    }

    MetaHttpResponse::json(BulkDeleteResponse {
        successful,
        unsuccessful,
        err,
    })
}

/// GetAPIToken

#[utoipa::path(
    get,
    path = "/{org_id}/service_accounts/{email_id}",
    context_path = "/api",
     tag = "ServiceAccounts",
    operation_id = "GetServiceAccountToken",
    summary = "Get service account API token",
    description = "Retrieves the current API token for a specific service account. The API token is used for authenticating automated systems and applications when making API requests. \
                   \
                   **Security Note:** Service accounts with `allow_static_token=false` will return a masked token (***MASKED***) instead of the actual token. These accounts must use the `assume_service_account` API to obtain temporary session tokens. \
                   \
                   Keep tokens secure and rotate them regularly for security best practices. If the token is compromised, use the update endpoint with rotateToken=true to generate a new one.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "Service Account email id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get service account token", "category": "users"}))
    )
)]
pub async fn get_api_token(
    Path((org, user_id)): Path<(String, String)>,
    Headers(_user_email): Headers<UserEmail>,
) -> Response {
    let config = config::get_config();
    if !config.auth.service_account_enabled {
        return MetaHttpResponse::forbidden("Service Accounts Not Enabled");
    }

    // Always return single token for the requested org
    let org_id = Some(org.as_str());
    match crate::service::organization::get_passcode(org_id, &user_id).await {
        Ok(passcode) => (
            StatusCode::OK,
            Json(APIToken {
                token: passcode.passcode,
                user: passcode.user,
            }),
        )
            .into_response(),
        Err(e) => (
            StatusCode::NOT_FOUND,
            Json(MetaHttpResponse::error(StatusCode::NOT_FOUND, e)),
        )
            .into_response(),
    }
}
