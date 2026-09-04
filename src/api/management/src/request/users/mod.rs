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

use std::{collections::HashMap, sync::Arc};

use axum::{
    body::Body,
    extract::{Path, Query},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use axum_extra::extract::cookie::{Cookie, SameSite};
#[cfg(feature = "cloud")]
use common::meta::user::UserList;
use config::{
    Config, get_config,
    meta::user::UserRole,
    utils::{base64, json, password::validate_password_strength_with_policy},
};
use openobserve_api_common::{auth::validator::AuthError, extractors::Headers};
use openobserve_core::{
    auth::{UserEmail, generate_presigned_url, is_valid_email},
    users,
};
use serde::Serialize;
#[cfg(feature = "enterprise")]
use utoipa::ToSchema;
#[cfg(feature = "enterprise")]
use {
    audit::audit,
    config::utils::time::now_micros,
    o2_dex::config::get_config as get_dex_config,
    o2_enterprise::enterprise::common::auditor::{AuditMessage, Protocol, ResponseMeta},
    o2_enterprise::enterprise::password_policy::lockout::{self, LockoutState},
    o2_openfga::config::get_config as get_openfga_config,
    openobserve_core::auth::check_permissions,
};

#[cfg(feature = "enterprise")]
use crate::common::meta::user::UserResponse;
#[cfg(feature = "enterprise")]
use crate::request::password_policy::password_rotation;
use crate::{
    common::meta::{
        self,
        http::HttpResponse as MetaHttpResponse,
        user::{
            AuthTokens, PostUserRequest, RolesResponse, SignInResponse, SignInUser, UpdateUser,
            UserOrgRole, UserRequest, UserRoleRequest, UserUpdateMode, get_roles,
        },
    },
    request::{BulkDeleteRequest, BulkDeleteResponse},
};

pub mod service_accounts;

/// One organization member, as the list endpoint reports them, plus their lockout state.
///
/// The counters are an administrator's view and must not be handed to the user they describe:
/// someone who can read the escalation level and the remaining seconds can derive the thresholds
/// behind them and pace attempts to stay underneath.
#[cfg(feature = "enterprise")]
#[derive(Serialize, ToSchema)]
pub struct UserDetailsResponse {
    #[serde(flatten)]
    pub user: UserResponse,
    pub lockout: LockoutState,
}

/// ListUsers
#[utoipa::path(
    get,
    path = "/{org_id}/users",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserList",
    summary = "List organization users",
    description = "Retrieves a list of all users within the specified organization, including their roles, status, and basic \
                   profile information. Optionally filter to list users across all organizations if the requesting user \
                   has sufficient permissions. Returns user metadata such as email addresses, assigned roles, last login \
                   times, and account status.",
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
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "list"})),
        ("x-o2-mcp" = json!({
            "description": "List all users",
            "category": "users",
            "summary_fields": ["email", "role", "first_name", "last_name"]
        }))
    )
)]
pub async fn list(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    let list_all = match query.get("list_all") {
        Some(v) => v.parse::<bool>().unwrap_or(false),
        None => false,
    };

    let mut _user_list_from_rbac = None;

    #[cfg(feature = "enterprise")]
    // Check if user has access to get users
    if get_openfga_config().enabled
        && check_permissions(
            &org_id,
            &org_id,
            &user_email.user_id,
            "users",
            "GET",
            None,
            true,
            false,
            false,
        )
        .await
    {
        _user_list_from_rbac = Some(vec![]);
    }

    match users::list_users(
        &user_email.user_id,
        &org_id,
        None,
        _user_list_from_rbac,
        list_all,
    )
    .await
    {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// GetUser
#[cfg(feature = "enterprise")]
#[utoipa::path(
    get,
    path = "/{org_id}/users/{email_id}",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserGet",
    summary = "Get a single organization user",
    description = "Returns one member of the organization — the same record the list endpoint \
                   reports — together with their failed-login lockout state: whether they are \
                   currently locked out of password authentication, how long is left on the lock, \
                   and the failure counters behind it. Requires Root or Admin on the named \
                   organization, and the user must belong to it. A user who has never failed a \
                   login is reported as unlocked with zeroed counters rather than as missing.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User's email id"),
    ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = UserDetailsResponse),
        (status = 403, description = "Forbidden", content_type = "application/json", body = ()),
        (status = 404, description = "Not Found", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "get"})),
        ("x-o2-mcp" = json!({"description": "Get a user's details and lockout state", "category": "users"}))
    )
)]
pub async fn get(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let email_id = email_id.trim().to_lowercase();
    if let Err(e) = validate_user_admin(&org_id, &user_email.user_id).await {
        return MetaHttpResponse::forbidden(e);
    }

    let Some(user) = users::get_user_details(&org_id, &email_id).await else {
        return MetaHttpResponse::not_found("User not found");
    };

    match lockout::lockout_state(&email_id).await {
        Ok(lockout) => MetaHttpResponse::json(UserDetailsResponse { user, lockout }),
        Err(e) => {
            log::error!("{e}");
            MetaHttpResponse::internal_error("Failed to read the lockout state")
        }
    }
}

/// Who may read another member's record, and the counters that come with it.
///
/// The same rule `update_user` applies before it will reset a password or clear a lockout: root
/// administers the instance, everyone else must administer the organization named in the path.
/// Whether the *target* belongs to that organization is not decided here — the record lookup is
/// org-scoped, so a user outside it is simply not found.
#[cfg(feature = "enterprise")]
async fn validate_user_admin(org_id: &str, initiator_id: &str) -> Result<(), String> {
    if db::user::is_root_user(initiator_id) {
        return Ok(());
    }

    match users::get_user(Some(org_id), initiator_id).await {
        Some(user) if matches!(user.role, UserRole::Root | UserRole::Admin) => Ok(()),
        _ => Err(format!(
            "Reading a user's details requires Root or Admin on {org_id}"
        )),
    }
}

/// Rejects an `org_id` path segment that is empty or whitespace-only.
///
/// The `/{org_id}/users` route parameter can arrive as `""` (via a
/// URL-encoded empty segment) or `" "` (via `%20`), which previously slipped
/// through and let user records be created against a meaningless organization.
fn validate_org_id(org_id: &str) -> Option<&'static str> {
    if org_id.trim().is_empty() {
        Some("Organization name is required")
    } else {
        None
    }
}

/// CreateUser
#[utoipa::path(
    post,
    path = "/{org_id}/users",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserSave",
    summary = "Create new user",
    description = "Creates a new user account within the organization with specified role and authentication credentials. \
                   The password must be at least 8 characters long and the email address must be valid. Users are \
                   automatically assigned to the organization with the specified role and can begin accessing resources \
                   immediately upon creation.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
    ),
    request_body(content = inline(PostUserRequest), description = "User data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Create a new user", "category": "users"}))
    )
)]
pub async fn save(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(user): axum::Json<PostUserRequest>,
) -> Response {
    let initiator_id = user_email.user_id;
    let mut user = UserRequest::from(&user);
    user.email = user.email.trim().to_lowercase();

    let policy = db::password_policy::get_effective_policy().await;
    let bad_req_msg = if let Some(msg) = validate_org_id(&org_id) {
        Some(msg.to_string())
    } else if let Err(msg) = validate_password_strength_with_policy(&user.password, &policy) {
        Some(msg)
    } else if user.role.base_role == UserRole::Root {
        Some("Not allowed".to_string())
    } else if user.role.base_role == UserRole::SreAgent {
        Some("SRE Agent role cannot be assigned via API".to_string())
    } else if !is_valid_email(user.email.as_str()) {
        Some("Invalid Email address".to_string())
    } else {
        None
    };

    if let Some(msg) = bad_req_msg {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&meta::http::HttpResponse::error(
                    axum::http::StatusCode::BAD_REQUEST,
                    msg.to_string(),
                ))
                .unwrap(),
            ))
            .unwrap();
    }

    #[cfg(not(feature = "enterprise"))]
    {
        user.role.base_role = UserRole::Admin;
    }
    match users::post_user(&org_id, user, &initiator_id).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// UpdateUser
#[utoipa::path(
    put,
    path = "/{org_id}/users/{email_id}",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserUpdate",
    summary = "Update user account",
    description = "Updates user account information including role assignments, password changes, or other profile details. \
                   Users can modify their own account settings, while administrators have broader permissions to update \
                   any user account. Password changes require the new password to be at least 8 characters long for \
                   security compliance. Setting remove_lockout releases an active failed-login lockout and resets the \
                   counters; it answers to the same gate as an administrative password reset, so Root or Admin on the \
                   organization, and never the locked-out user themselves.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User's email id"),
    ),
    request_body(content = inline(UpdateUser), description = "User data", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "update"})),
        ("x-o2-mcp" = json!({"description": "Update user details", "category": "users"}))
    )
)]
pub async fn update(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(user): axum::Json<UpdateUser>,
) -> Response {
    let email_id = email_id.trim().to_string();
    #[cfg(not(feature = "enterprise"))]
    let mut user = user;
    if user.eq(&UpdateUser::default()) {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&meta::http::HttpResponse::error(
                    axum::http::StatusCode::BAD_REQUEST,
                    "Please specify appropriate fields to update user",
                ))
                .unwrap(),
            ))
            .unwrap();
    }
    if user.change_password
        && let Some(new_pw) = user.new_password.as_deref()
        && let Err(msg) = validate_password_strength_with_policy(
            new_pw,
            &db::password_policy::get_effective_policy().await,
        )
    {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&meta::http::HttpResponse::error(
                    axum::http::StatusCode::BAD_REQUEST,
                    msg.to_string(),
                ))
                .unwrap(),
            ))
            .unwrap();
    }

    // Prevent assignment of SreAgent role via API
    if let Some(ref role_request) = user.role
        && let Ok(parsed_role) = role_request.role.parse::<UserRole>()
        && parsed_role == UserRole::SreAgent
    {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&meta::http::HttpResponse::error(
                    axum::http::StatusCode::BAD_REQUEST,
                    "SRE Agent role cannot be assigned via API".to_string(),
                ))
                .unwrap(),
            ))
            .unwrap();
    }

    #[cfg(not(feature = "enterprise"))]
    {
        user.role = Some(UserRoleRequest {
            role: UserRole::Admin.to_string(),
            custom: None,
        });
    }
    let initiator_id = &user_email.user_id;
    let update_mode = if user_email.user_id.eq(&email_id) {
        UserUpdateMode::SelfUpdate
    } else {
        UserUpdateMode::OtherUpdate
    };
    match users::update_user(&org_id, &email_id, update_mode, initiator_id, user).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// AddUserToOrganization
#[utoipa::path(
    post,
    path = "/{org_id}/users/{email_id}",
    context_path = "/api",
    tag = "Users",
    operation_id = "AddUserToOrg",
    summary = "Add user to organization",
    description = "Adds an existing user account to the organization with the specified role assignment. The user must \
                   already exist in the system with valid authentication credentials. This operation grants the user \
                   access to organization resources and data according to their assigned role permissions.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User's email id"),
    ),
    request_body(content = inline(UserRoleRequest), description = "User role", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "create"})),
        ("x-o2-mcp" = json!({"description": "Add user to organization", "category": "users"}))
    )
)]
pub async fn add_user_to_org(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(role): axum::Json<UserRoleRequest>,
) -> Response {
    let initiator_id = user_email.user_id;
    let role = UserOrgRole::from(&role);

    // Prevent assignment of SreAgent role via API
    if role.base_role == UserRole::SreAgent {
        return Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&meta::http::HttpResponse::error(
                    axum::http::StatusCode::BAD_REQUEST,
                    "SRE Agent role cannot be assigned via API".to_string(),
                ))
                .unwrap(),
            ))
            .unwrap();
    }

    match users::add_user_to_org(&org_id, &email_id, role, &initiator_id).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

fn _prepare_cookie<'a, T: Serialize + ?Sized, E: Into<time::OffsetDateTime>>(
    conf: &Arc<Config>,
    cookie_name: &'a str,
    token_struct: &T,
    cookie_expiry: E,
) -> Cookie<'a> {
    let tokens = json::to_string(token_struct).unwrap();
    let tokens = base64::encode(&tokens);
    let mut auth_cookie = Cookie::new(cookie_name, tokens);
    auth_cookie.set_expires(cookie_expiry.into());
    auth_cookie.set_http_only(true);
    auth_cookie.set_secure(conf.auth.cookie_secure_only);
    auth_cookie.set_path("/");
    if conf.auth.cookie_same_site_lax {
        auth_cookie.set_same_site(SameSite::Lax);
    } else {
        auth_cookie.set_same_site(SameSite::None);
    }
    auth_cookie
}

/// RemoveUserFromOrganization
#[utoipa::path(
    delete,
    path = "/{org_id}/users/{email_id}",
    context_path = "/api",
    tag = "Users",
    operation_id = "RemoveUserFromOrg",
    summary = "Remove user from organization",
    description = "Removes a user from the organization, immediately revoking their access to all organization resources, \
                   data, and services. The user account itself remains active and can be added back to organizations \
                   later. This action is permanent and cannot be undone without re-adding the user explicitly.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "delete"})),
        ("x-o2-mcp" = json!({"description": "Remove user from organization", "category": "users", "requires_confirmation": true}))
    )
)]
pub async fn delete(
    Path((org_id, email_id)): Path<(String, String)>,
    Headers(user_email): Headers<UserEmail>,
) -> Response {
    let initiator_id = user_email.user_id;
    match users::remove_user_from_org(&org_id, &email_id, &initiator_id).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

/// BulkRemoveUserFromOrganization
#[utoipa::path(
    delete,
    path = "/{org_id}/users/bulk",
    context_path = "/api",
    tag = "Users",
    operation_id = "BulkRemoveUserFromOrg",
    summary = "Remove multiple users from organization",
    description = "Removes multiple users from the organization, immediately revoking their access to all organization resources, \
                   data, and services. The user account itself remains active and can be added back to organizations \
                   later. This action is permanent and cannot be undone without re-adding the user explicitly.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
        ("email_id" = String, Path, description = "User name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
        (status = 404, description = "NotFound", content_type = "application/json", body = ()),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "delete"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn delete_bulk(
    Path(org_id): Path<String>,
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<BulkDeleteRequest>,
) -> Response {
    let initiator_id = user_email.user_id;

    #[cfg(feature = "enterprise")]
    for email in &req.ids {
        if !check_permissions(
            email,
            &org_id,
            &initiator_id,
            "users",
            "DELETE",
            None,
            false,
            false,
            true,
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
                // Check if response is successful by examining the status code
                let (parts, _body) = v.into_parts();
                if parts.status.is_success() {
                    successful.push(email);
                } else {
                    log::error!(
                        "error in deleting service account {org_id}/{email} : {:?}",
                        parts.status.canonical_reason()
                    );
                    unsuccessful.push(email);
                    err = parts.status.canonical_reason().map(|v| v.to_string());
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

/// AuthenticateUser
#[utoipa::path(
post,
path = "/login",
context_path = "/auth",
    tag = "Auth",
    operation_id = "UserLoginCheck",
    summary = "Authenticate user",
    description = "Authenticates user credentials and returns authentication tokens stored in secure HTTP-only cookies. \
                   Supports both JSON request body authentication and Authorization header-based authentication. \
                   Successful authentication establishes a session that allows access to protected resources and APIs \
                   throughout the platform.",
    request_body(content = inline(SignInUser), description = "User login", content_type = "application/json"),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(SignInResponse)),
    ),
    extensions(
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "update"})),
        ("x-o2-mcp" = json!({"enabled": false}))
    )
)]
pub async fn authentication(
    #[cfg(feature = "enterprise")] headers: HeaderMap,
    #[cfg(feature = "enterprise")] Query(query): Query<HashMap<String, String>>,
    auth: Option<axum::Json<SignInUser>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    let native_login_enabled = get_dex_config().native_login_enabled;
    #[cfg(not(feature = "enterprise"))]
    let native_login_enabled = true;

    if !native_login_enabled {
        return Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("\"Not Supported\""))
            .unwrap();
    }

    #[cfg(feature = "enterprise")]
    let query_string = query
        .iter()
        .map(|(k, v)| format!("{}={}", k, v))
        .collect::<Vec<_>>()
        .join("&");

    // Until decoding the token or body, we can not know the the user_email
    #[cfg(feature = "enterprise")]
    let mut audit_message = AuditMessage {
        user_email: "".to_string(),
        org_id: "".to_string(),
        _timestamp: now_micros(),
        protocol: Protocol::Http,
        response_meta: ResponseMeta {
            http_method: "POST".to_string(),
            http_path: "/auth/login".to_string(),
            http_body: "".to_string(),
            http_query_params: query_string,
            http_response_code: 200,
            error_msg: None,
            trace_id: None,
        },
    };

    let mut resp = SignInResponse::default();
    let auth = match auth {
        Some(auth) => auth.0,
        None => {
            // get Authorization header from request
            #[cfg(feature = "enterprise")]
            {
                let auth_header = headers.get(header::AUTHORIZATION);
                if let Some(auth_header) = auth_header {
                    if let Some((name, password)) =
                        o2_dex::service::auth::get_user_from_token(auth_header.to_str().unwrap())
                    {
                        SignInUser { name, password }
                    } else {
                        audit_unauthorized_error(audit_message).await;
                        return unauthorized_error(resp);
                    }
                } else {
                    audit_unauthorized_error(audit_message).await;
                    return unauthorized_error(resp);
                }
            }
            #[cfg(not(feature = "enterprise"))]
            {
                return unauthorized_error(resp);
            }
        }
    };

    #[cfg(feature = "enterprise")]
    {
        audit_message.user_email = auth.name.clone();
    }

    #[cfg(feature = "enterprise")]
    {
        if get_dex_config().root_only_login && !db::user::is_root_user(&auth.name) {
            audit_unauthorized_error(audit_message).await;
            return unauthorized_error(resp);
        }
    }
    match openobserve_api_common::auth::validator::validate_user(&auth.name, &auth.password).await {
        Ok(v) => {
            if v.is_valid {
                resp.status = true;
            } else {
                #[cfg(feature = "enterprise")]
                audit_unauthorized_error(audit_message).await;
                return unauthorized_error(resp);
            }
        }
        Err(AuthError::Locked { retry_after_secs }) => {
            #[cfg(feature = "enterprise")]
            audit_locked_error(audit_message).await;
            return locked_error(resp, retry_after_secs);
        }
        Err(_e) => {
            #[cfg(feature = "enterprise")]
            audit_unauthorized_error(audit_message).await;
            return unauthorized_error(resp);
        }
    };
    if resp.status {
        let cfg = get_config();

        #[cfg(feature = "enterprise")]
        {
            resp.password_rotation_warning = password_rotation::warning_days(&auth.name).await;
        }

        let access_token = format!(
            "Basic {}",
            base64::encode(&format!("{}:{}", auth.name, auth.password))
        );
        let tokens = json::to_string(&AuthTokens {
            access_token,
            refresh_token: "".to_string(),
        })
        .unwrap();

        let tokens = base64::encode(&tokens);
        let mut auth_cookie = Cookie::new("auth_tokens", tokens);
        auth_cookie.set_expires(
            time::OffsetDateTime::now_utc()
                + time::Duration::seconds(db::password_policy::cookie_max_age_secs().await),
        );
        auth_cookie.set_http_only(true);
        auth_cookie.set_secure(cfg.auth.cookie_secure_only);
        auth_cookie.set_path("/");
        if cfg.auth.cookie_same_site_lax {
            auth_cookie.set_same_site(SameSite::Lax);
        } else {
            auth_cookie.set_same_site(SameSite::None);
        }
        // audit the successful login
        #[cfg(feature = "enterprise")]
        audit(audit_message).await;
        (
            StatusCode::OK,
            [(header::SET_COOKIE, auth_cookie.to_string())],
            axum::Json(resp),
        )
            .into_response()
    } else {
        #[cfg(feature = "enterprise")]
        audit_unauthorized_error(audit_message).await;
        unauthorized_error(resp)
    }
}

#[derive(serde::Deserialize)]
pub struct PresignedURLGenerator {
    #[serde(default = "default_exp_in")]
    exp_in: u32,
}

#[derive(serde::Deserialize, serde::Serialize)]
struct PresignedURLGeneratorResponse {
    url: String,
}

const fn default_exp_in() -> u32 {
    600
}

pub async fn get_presigned_url(
    Query(_query): Query<HashMap<String, String>>,
    headers: HeaderMap,
    Query(params): Query<PresignedURLGenerator>,
) -> Response {
    // Extract basic auth from Authorization header
    let auth_header = match headers.get(header::AUTHORIZATION) {
        Some(h) => h.to_str().unwrap_or(""),
        None => {
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(Body::from("Missing Authorization header"))
                .unwrap();
        }
    };

    // Parse Basic auth
    let (user_id, password) = if let Some(encoded) = auth_header.strip_prefix("Basic ") {
        let decoded = config::utils::base64::decode(encoded).unwrap_or_default();
        let parts: Vec<&str> = decoded.splitn(2, ':').collect();
        if parts.len() != 2 {
            return Response::builder()
                .status(StatusCode::UNAUTHORIZED)
                .body(Body::from("Invalid Authorization header"))
                .unwrap();
        }
        (parts[0].to_string(), parts[1].to_string())
    } else {
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .body(Body::from("Invalid Authorization header"))
            .unwrap();
    };

    let cfg = get_config();
    let time = chrono::Utc::now().timestamp();
    let password_ext_salt = cfg.auth.ext_auth_salt.as_str();

    let base_url = format!("{}{}", cfg.common.web_url, cfg.common.base_uri);
    let url = generate_presigned_url(
        &user_id,
        &password,
        password_ext_salt,
        &base_url,
        params.exp_in as i64,
        time,
    );

    let payload = PresignedURLGeneratorResponse { url };
    #[cfg(feature = "enterprise")]
    {
        let query_string = _query
            .iter()
            .map(|(k, v)| format!("{}={}", k, v))
            .collect::<Vec<_>>()
            .join("&");
        let audit_message = AuditMessage {
            user_email: user_id,
            org_id: "".to_string(),
            _timestamp: now_micros(),
            protocol: Protocol::Http,
            response_meta: ResponseMeta {
                http_method: "GET".to_string(),
                http_path: "/auth/presigned-url".to_string(),
                http_body: "".to_string(),
                http_query_params: query_string,
                http_response_code: 200,
                error_msg: None,
                trace_id: None,
            },
        };
        audit(audit_message).await;
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_string(&payload).unwrap()))
        .unwrap()
}

pub async fn get_auth(
    headers: http::HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> Response {
    #[cfg(feature = "enterprise")]
    {
        use openobserve_api_common::auth::validator::ID_TOKEN_HEADER;

        use crate::common::meta::user::AuthTokensExt;

        let mut resp = SignInResponse::default();

        let mut request_time = None;
        let mut expires_in = 300;
        let mut req_ts = 0;

        let mut audit_message = AuditMessage {
            user_email: "".to_string(),
            org_id: "".to_string(),
            _timestamp: now_micros(),
            protocol: Protocol::Http,
            response_meta: ResponseMeta {
                http_method: "GET".to_string(),
                http_path: "/auth/login".to_string(),
                http_body: "".to_string(),
                // Don't include query string as it may contain the auth token
                http_query_params: "".to_string(),
                http_response_code: 302,
                error_msg: None,
                trace_id: None,
            },
        };

        let (name, password) = {
            let auth_header = if let Some(s) = query.get("auth") {
                match query.get("request_time") {
                    Some(req_time_str) => {
                        if let Ok(ts) = config::utils::time::parse_str_to_time(req_time_str) {
                            req_ts = ts.timestamp();
                        } else {
                            audit_unauthorized_error(audit_message).await;
                            return unauthorized_error(resp);
                        }
                        request_time = Some(req_time_str);
                    }
                    None => {
                        audit_unauthorized_error(audit_message).await;
                        return unauthorized_error(resp);
                    }
                };

                match query.get("exp_in") {
                    Some(exp_in_str) => {
                        expires_in = exp_in_str.parse::<i64>().unwrap();
                    }
                    None => {
                        audit_unauthorized_error(audit_message).await;
                        return unauthorized_error(resp);
                    }
                };
                if chrono::Utc::now().timestamp() - req_ts > expires_in {
                    audit_unauthorized_error(audit_message).await;
                    return unauthorized_error(resp);
                }
                format!("q_auth {s}")
            } else if let Some(auth_header) = headers.get(header::AUTHORIZATION) {
                match auth_header.to_str() {
                    Ok(auth_header_str) => auth_header_str.to_string(),
                    Err(_) => {
                        audit_unauthorized_error(audit_message).await;
                        return unauthorized_error(resp);
                    }
                }
            } else {
                audit_unauthorized_error(audit_message).await;
                return unauthorized_error(resp);
            };

            use o2_dex::service::auth::get_user_from_token;
            use openobserve_api_common::auth::validator::{
                validate_user, validate_user_for_query_params,
            };

            let (name, password) = if let Some((name, password)) = get_user_from_token(&auth_header)
            {
                let token_validation_response = match request_time {
                    Some(req_ts) => {
                        log::debug!("Validating user for query params");
                        validate_user_for_query_params(&name, &password, Some(req_ts), expires_in)
                            .await
                    }
                    None => {
                        log::debug!("Validating user for basic auth header");
                        validate_user(&name, &password).await
                    }
                };

                audit_message.user_email = name.clone();
                match token_validation_response {
                    Ok(v) => {
                        if v.is_valid {
                            resp.status = true;
                            (name, password)
                        } else {
                            audit_unauthorized_error(audit_message).await;
                            return unauthorized_error(resp);
                        }
                    }
                    Err(_) => {
                        audit_unauthorized_error(audit_message).await;
                        return unauthorized_error(resp);
                    }
                }
            } else {
                audit_unauthorized_error(audit_message).await;
                return unauthorized_error(resp);
            };
            (name, password)
        };

        if resp.status {
            let cfg = get_config();
            let id_token = config::utils::json::json!({
                "email": name,
                "name": name,
            });
            let cookie_name = "auth_tokens";
            let auth_cookie = if req_ts == 0 {
                let access_token =
                    format!("Basic {}", base64::encode(&format!("{name}:{password}")));
                let tokens = AuthTokens {
                    access_token,
                    refresh_token: "".to_string(),
                };

                log::debug!("Setting cookie for user: {name} - {cookie_name}");
                let expiry = time::OffsetDateTime::now_utc() + time::Duration::seconds(expires_in);
                _prepare_cookie(&cfg, cookie_name, &tokens, expiry)
            } else {
                let cookie_name = "auth_ext";
                let auth_ext = format!(
                    "{} {}",
                    cookie_name,
                    base64::encode(&format!("{name}:{password}"))
                );

                let tokens = AuthTokensExt {
                    auth_ext,
                    refresh_token: "".to_string(),
                    request_time: req_ts,
                    expires_in,
                };

                log::debug!("Setting cookie for user: {name} - {cookie_name}");
                let expiry = time::OffsetDateTime::now_utc() + time::Duration::seconds(expires_in);
                _prepare_cookie(&cfg, cookie_name, &tokens, expiry)
            };

            let url = format!(
                "{}{}/web/cb#id_token={}.{}",
                cfg.common.web_url,
                cfg.common.base_uri,
                ID_TOKEN_HEADER,
                base64::encode(&id_token.to_string())
            );
            audit_message._timestamp = chrono::Utc::now().timestamp_micros();
            audit(audit_message).await;
            Response::builder()
                .status(StatusCode::FOUND)
                .header(header::LOCATION, url)
                .header(header::SET_COOKIE, auth_cookie.to_string())
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(serde_json::to_string(&resp).unwrap()))
                .unwrap()
        } else {
            audit_unauthorized_error(audit_message).await;
            unauthorized_error(resp)
        }
    }

    #[cfg(not(feature = "enterprise"))]
    {
        drop(headers);
        drop(query);
        Response::builder()
            .status(StatusCode::FORBIDDEN)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from("\"Not Supported\""))
            .unwrap()
    }
}

/// ListUserRoles
#[utoipa::path(
    get,
    path = "/{org_id}/users/roles",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserRoles",
    summary = "List available user roles",
    description = "Retrieves a comprehensive list of all available user roles that can be assigned to users within the \
                   organization. Includes role names, descriptions, and permission levels to help administrators \
                   understand access control options when creating or updating user accounts. Role availability may \
                   vary based on enterprise features and organizational settings.",
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
        ("x-o2-ratelimit" = json!({"module": "Users", "operation": "list"}))
    )
)]
pub async fn list_roles(Path(_org_id): Path<String>) -> impl IntoResponse {
    let roles = get_roles()
        .iter()
        .filter_map(check_role_available)
        .collect::<Vec<RolesResponse>>();

    axum::Json(roles)
}

fn check_role_available(role: &UserRole) -> Option<RolesResponse> {
    if role.eq(&UserRole::Root)
        || role.eq(&UserRole::ServiceAccount)
        || role.eq(&UserRole::SreAgent)
    {
        None
    } else {
        #[cfg(feature = "enterprise")]
        if !get_openfga_config().enabled && role.ne(&UserRole::Admin) {
            return None;
        }
        Some(RolesResponse {
            label: role.get_label(),
            value: role.to_string(),
        })
    }
}

fn unauthorized_error(mut resp: SignInResponse) -> Response {
    resp.status = false;
    resp.message = "Invalid credentials".to_string();
    Response::builder()
        .status(StatusCode::UNAUTHORIZED)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(serde_json::to_string(&resp).unwrap()))
        .unwrap()
}

/// The lockout refusal, which unlike [`unauthorized_error`] has something to tell the caller: how
/// long to wait. 429 with `Retry-After` matches what the API path returns for the same state.
fn locked_error(mut resp: SignInResponse, retry_after_secs: i64) -> Response {
    resp.status = false;
    resp.message = openobserve_api_common::auth::validator::lockout_message(retry_after_secs);
    resp.lockout_retry_after_secs = Some(retry_after_secs);
    Response::builder()
        .status(StatusCode::TOO_MANY_REQUESTS)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::RETRY_AFTER, retry_after_secs)
        .body(Body::from(serde_json::to_string(&resp).unwrap()))
        .unwrap()
}

#[cfg(feature = "enterprise")]
async fn audit_unauthorized_error(audit_message: AuditMessage) {
    audit_login_failure(audit_message, 401).await;
}

/// A lockout is audited under its own status code: an audit trail that reported every refused login
/// as a 401 would hide the difference between a wrong password and an account under attack.
#[cfg(feature = "enterprise")]
async fn audit_locked_error(audit_message: AuditMessage) {
    audit_login_failure(audit_message, 429).await;
}

#[cfg(feature = "enterprise")]
async fn audit_login_failure(mut audit_message: AuditMessage, http_response_code: u16) {
    use chrono::Utc;

    audit_message._timestamp = Utc::now().timestamp_micros();
    audit_message.response_meta.http_response_code = http_response_code;
    // Even if the user_email of audit_message is not set, still the event should be audited
    audit(audit_message).await;
}

/// ListUserInvitations
#[cfg(feature = "cloud")]
#[utoipa::path(
    get,
    path = "/invites",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserInvitations",
    summary = "List user invitations",
    description = "Retrieves a list of pending organization invitations for the authenticated user across different \
                   organizations. Shows invitation details including organization names, invited roles, expiration \
                   dates, and invitation status. Users can review and accept invitations to join new organizations \
                   with appropriate access permissions.",
    security(
        ("Authorization"= [])
    ),
    params(
        ("org_id" = String, Path, description = "Organization name"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = Object),
    )
)]
pub async fn list_invitations(Headers(user_email): Headers<UserEmail>) -> Response {
    let user_id = user_email.user_id.to_lowercase();
    match users::list_user_invites(&user_id, true).await {
        Ok(resp) => resp,
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(feature = "cloud")]
#[utoipa::path(
    post,
    path = "/auth/invites/{token}",
    context_path = "/api",
    tag = "Users",
    operation_id = "UserInvitations",
    security(
        ("Authorization"= [])
    ),
    params(
        ("token" = String, Path, description = "invitation token"),
      ),
    responses(
        (status = 200, description = "Success", content_type = "application/json", body = inline(UserList)),
    )
)]
pub async fn decline_invitation(
    Headers(user_email): Headers<UserEmail>,
    Path(token): Path<String>,
) -> Response {
    use db;
    use openobserve_api_common::auth::jwt;
    use openobserve_core::organization;

    let user_id = user_email.user_id.as_str();

    match organization::decline_invitation(user_id, &token).await {
        Ok(remaining) => {
            if remaining.is_empty() {
                // if there are no remaining invitations, create a new org for the user
                let db_user = match db::user::get_db_user(user_id).await {
                    Ok(v) => v,
                    Err(e) => {
                        log::error!("error getting db user for {user_id} : {e}");
                        return Response::builder()
                            .status(StatusCode::OK)
                            .header(header::CONTENT_TYPE, "application/json")
                            .body(Body::from(
                                serde_json::to_string(&serde_json::json!({
                                    "message":"Invitation declined successfully",
                                    "remaining": remaining.len()
                                }))
                                .unwrap(),
                            ))
                            .unwrap();
                    }
                };
                let _ = jwt::check_and_add_to_org(
                    user_id,
                    &format!("{} {}", db_user.first_name, db_user.last_name),
                )
                .await;
            }
            Response::builder()
                .status(StatusCode::OK)
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(
                    serde_json::to_string(&serde_json::json!({
                        "message":"Invitation declined successfully",
                        "remaining": remaining.len()
                    }))
                    .unwrap(),
                ))
                .unwrap()
        }

        Err(err) => Response::builder()
            .status(StatusCode::BAD_REQUEST)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                serde_json::to_string(&serde_json::json!({"message": err.to_string()})).unwrap(),
            ))
            .unwrap(),
    }
}

#[cfg(not(feature = "cloud"))]
pub async fn decline_invitation(
    Headers(_): Headers<UserEmail>,
    Path(_token): Path<String>,
) -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("\"Not Supported\""))
        .unwrap()
}

#[cfg(not(feature = "cloud"))]
pub async fn list_invitations(Headers(_): Headers<UserEmail>) -> Response {
    Response::builder()
        .status(StatusCode::FORBIDDEN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from("\"Not Supported\""))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_presigned_url_generator_default() {
        let generator = PresignedURLGenerator {
            exp_in: default_exp_in(),
        };
        assert_eq!(generator.exp_in, 600);
    }

    #[test]
    fn test_presigned_url_generator_response_serialization() {
        let response = PresignedURLGeneratorResponse {
            url: "https://example.com/presigned".to_string(),
        };
        let json = serde_json::to_string(&response).unwrap();
        assert!(json.contains("https://example.com/presigned"));
    }

    #[test]
    fn test_check_role_available_filters_root() {
        let result = check_role_available(&UserRole::Root);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_role_available_filters_service_account() {
        let result = check_role_available(&UserRole::ServiceAccount);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_role_available_filters_sre_agent() {
        let result = check_role_available(&UserRole::SreAgent);
        assert!(result.is_none());
    }

    #[test]
    fn test_check_role_available_allows_admin() {
        let result = check_role_available(&UserRole::Admin);
        assert!(result.is_some());
        let role_response = result.unwrap();
        assert_eq!(role_response.value, "admin");
    }

    #[test]
    fn test_validate_org_id_rejects_empty() {
        assert_eq!(validate_org_id(""), Some("Organization name is required"));
    }

    #[test]
    fn test_validate_org_id_rejects_whitespace() {
        assert_eq!(validate_org_id(" "), Some("Organization name is required"));
        assert_eq!(
            validate_org_id("   \t\n"),
            Some("Organization name is required"),
        );
    }

    #[test]
    fn test_validate_org_id_accepts_valid() {
        assert!(validate_org_id("default").is_none());
        assert!(validate_org_id("my-org").is_none());
        assert!(validate_org_id(" default ").is_none());
    }

    /// Seeds the caches a running node fills from the coordinator watcher. Nothing watches under
    /// test, and every allow path below is answered from these two alone — a miss would reach for
    /// the database.
    #[cfg(feature = "enterprise")]
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
                user_type: config::meta::user::UserType::Internal,
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

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn an_org_admin_reads_its_own_org() {
        let org = "user-get-acme";
        let admin = "admin@user-get-acme.test";
        join(org, admin, UserRole::Admin);

        assert!(validate_user_admin(org, admin).await.is_ok());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn a_non_admin_is_refused_its_own_org() {
        let org = "user-get-viewer";
        let viewer = "viewer@user-get-viewer.test";
        join(org, viewer, UserRole::Viewer);

        assert!(validate_user_admin(org, viewer).await.is_err());
    }

    /// The org boundary is the whole point: administering one tenant must not reach into another.
    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn administering_one_org_does_not_reach_another() {
        let (mine, theirs) = ("user-get-mine", "user-get-theirs");
        let admin = "admin@user-get-mine.test";
        join(mine, admin, UserRole::Admin);

        assert!(validate_user_admin(theirs, admin).await.is_err());
    }

    #[cfg(feature = "enterprise")]
    #[tokio::test]
    async fn root_reads_any_org() {
        let root = "root@user-get-root.test";
        join(config::DEFAULT_ORG, root, UserRole::Root);

        assert!(validate_user_admin("user-get-any", root).await.is_ok());
    }
}
