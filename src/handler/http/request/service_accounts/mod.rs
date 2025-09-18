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

use std::io::{Error, ErrorKind};

use actix_web::{
    HttpRequest, HttpResponse, delete, get,
    http::{self},
    post, put, web,
};
use config::{meta::user::UserRole, utils::rand::generate_random_string};
use hashbrown::HashMap;

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
    service::users,
};

/// ListServiceAccounts

#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "list"}))
    )
)]
#[get("/{org_id}/service_accounts")]
pub async fn list(org_id: web::Path<String>, req: HttpRequest) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let user_id = req.headers().get("user_id").unwrap().to_str().unwrap();
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
                return Ok(crate::common::meta::http::HttpResponse::forbidden(
                    e.to_string(),
                ));
            }
        }
        // Get List of allowed objects ends
    }
    users::list_users(
        user_id,
        &org_id,
        Some(UserRole::ServiceAccount),
        _user_list_from_rbac,
        false,
    )
    .await
}

/// CreateServiceAccount

#[utoipa::path(
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
    request_body(content = ServiceAccountRequest, description = "ServiceAccount data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "create"}))
    )
)]
#[post("/{org_id}/service_accounts")]
pub async fn save(
    org_id: web::Path<String>,
    service_account: web::Json<ServiceAccountRequest>,
    user_email: UserEmail,
) -> Result<HttpResponse, Error> {
    let org_id = org_id.into_inner();
    let initiator_id = user_email.user_id;
    let service_account = service_account.into_inner();
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

    users::post_user(&org_id, user, &initiator_id).await
}

/// UpdateServiceAccount

#[utoipa::path(
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
    request_body(content = UpdateServiceAccountRequest, description = "Service Account data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "update"}))
    )
)]
#[put("/{org_id}/service_accounts/{email_id}")]
pub async fn update(
    params: web::Path<(String, String)>,
    service_account: web::Json<UpdateServiceAccountRequest>,
    user_email: UserEmail,
    req: HttpRequest,
) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = params.into_inner();
    let email_id = email_id.trim().to_lowercase();
    let query = match web::Query::<HashMap<String, String>>::from_query(req.query_string()) {
        Ok(query) => query,
        Err(e) => {
            return Err(Error::new(
                ErrorKind::InvalidInput,
                format!("Invalid query string: {e}"),
            ));
        }
    };

    let rotate_token = match query.get("rotateToken") {
        Some(s) => match s.to_lowercase().as_str() {
            "true" => true,
            "false" => false,
            _ => {
                return Err(Error::other(
                    " 'rotateToken' query param with value 'true' or 'false' allowed",
                ));
            }
        },
        None => false,
    };

    if rotate_token {
        return match crate::service::organization::update_passcode(Some(&org_id), &email_id).await {
            Ok(passcode) => Ok(HttpResponse::Ok().json(APIToken {
                token: passcode.passcode,
                user: passcode.user,
            })),
            Err(e) => Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e))),
        };
    };
    let service_account = service_account.into_inner();

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

    users::update_user(
        &org_id,
        &email_id,
        UserUpdateMode::OtherUpdate,
        initiator_id,
        user,
    )
    .await
}

/// RemoveServiceAccount

#[utoipa::path(
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
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "delete"}))
    )
)]
#[delete("/{org_id}/service_accounts/{email_id}")]
pub async fn delete(
    path: web::Path<(String, String)>,
    user_email: UserEmail,
) -> Result<HttpResponse, Error> {
    let (org_id, email_id) = path.into_inner();
    let initiator_id = user_email.user_id;
    users::remove_user_from_org(&org_id, &email_id, &initiator_id).await
}

/// GetAPIToken

#[utoipa::path(
    context_path = "/api",
     tag = "ServiceAccounts",
    operation_id = "GetServiceAccountToken",
    summary = "Get service account API token",
    description = "Retrieves the current API token for a specific service account. The API token is used for authenticating automated systems and applications when making API requests. Keep tokens secure and rotate them regularly for security best practices. If the token is compromised, use the update endpoint with rotateToken=true to generate a new one.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "Service Account email id"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = APIToken),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Service Accounts", "operation": "get"}))
    )
)]
#[get("/{org_id}/service_accounts/{email_id}")]
pub async fn get_api_token(path: web::Path<(String, String)>) -> Result<HttpResponse, Error> {
    let (org, user_id) = path.into_inner();
    let org_id = Some(org.as_str());
    match crate::service::organization::get_passcode(org_id, &user_id).await {
        Ok(passcode) => Ok(HttpResponse::Ok().json(APIToken {
            token: passcode.passcode,
            user: passcode.user,
        })),
        Err(e) => {
            Ok(HttpResponse::NotFound()
                .json(MetaHttpResponse::error(http::StatusCode::NOT_FOUND, e)))
        }
    }
}
