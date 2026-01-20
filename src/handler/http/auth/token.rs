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

#[cfg(feature = "enterprise")]
use o2_dex::{config::get_config as get_dex_config, service::auth::get_dex_jwks};

use super::validator::{AuthError, AuthValidationResult, RequestData};
use crate::common::utils::auth::AuthExtractor;
#[cfg(feature = "enterprise")]
use crate::common::utils::jwt;
#[cfg(feature = "enterprise")]
use crate::service::{db, users};

#[cfg(feature = "enterprise")]
pub async fn token_validator(
    req_data: &RequestData,
    auth_info: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    use super::validator::check_permissions;
    use crate::common::utils::auth::V2_API_PREFIX;

    let user;
    let keys = get_dex_jwks().await;
    let path = match req_data
        .uri
        .path()
        .strip_prefix(format!("{}/api/", config::get_config().common.base_uri).as_str())
    {
        Some(path) => path,
        None => req_data.uri.path(),
    };
    let path = path.strip_prefix("/").unwrap_or(path);
    let path_columns = path.split('/').collect::<Vec<&str>>();

    // Check if this is an MCP endpoint request or has the MCP header
    let is_mcp_endpoint = path_columns.get(1).map(|s| *s == "mcp").unwrap_or(false);
    let has_mcp_header = req_data
        .headers
        .get("x-o2-mcp")
        .and_then(|v| v.to_str().ok())
        .map(|v| v == "true")
        .unwrap_or_default();
    let is_mcp_request = is_mcp_endpoint || has_mcp_header;

    // For MCP requests with dynamic clients, skip audience validation
    let login_flow = !is_mcp_request;

    match jwt::verify_decode_token(
        auth_info.auth.strip_prefix("Bearer").unwrap().trim(),
        &keys,
        &get_dex_config().client_id,
        false,
        login_flow,
    ) {
        Ok(res) => {
            let user_id = &res.0.user_email;
            if res.0.is_valid {
                // for member sub i.e. invitation, we must check user directly from db, because
                // the else-arm here will check if user is present in given org. However before
                // accepting the invitation, user will not be added to the org,
                // hence getting unauthorized error. Thus we add a check that for
                // member_subscription, check the user directly from db users,
                // not particularly associated with any org
                let is_member_subscription = path_columns
                    .get(1)
                    .is_some_and(|p| p.eq(&"member_subscription"));
                // this is for /invites call, which is only based on user, similar to
                // member subscription. Furthermore, because we are listing the invites of
                // that particular user only, we can skip other checks, and allow listing
                let is_list_invite_call = path_columns.len() <= 2
                    && path_columns.first().is_some_and(|p| p.eq(&"invites"))
                    && (auth_info.method.eq("GET") || auth_info.method.eq("DELETE"));

                // For MCP endpoints, allow any authenticated user from Dex
                let allow_nonexistent_user = is_mcp_request;
                let path_suffix = path_columns.last().unwrap_or(&"");
                if path_suffix.eq(&"organizations")
                    || path_suffix.eq(&"clusters")
                    || is_member_subscription
                    || is_list_invite_call
                {
                    let db_user = db::user::get_db_user(user_id).await;
                    user = match db_user {
                        Ok(user) => {
                            let all_users = user.get_all_users();
                            if all_users.is_empty() {
                                None
                            } else {
                                // For organizations/clusters endpoints, prioritize _meta org
                                all_users
                                    .iter()
                                    .find(|u| u.org == config::META_ORG_ID)
                                    .cloned()
                                    .or_else(|| all_users.first().cloned())
                            }
                        }
                        Err(e) => {
                            log::error!("Error getting user in token validator: {e}");
                            None
                        }
                    }
                } else {
                    user = match path.find('/') {
                        Some(index) => {
                            let org_id =
                                if path_columns.len() > 1 && path_columns[0].eq(V2_API_PREFIX) {
                                    path_columns[1]
                                } else {
                                    &path[0..index]
                                };
                            users::get_user(Some(org_id), user_id).await
                        }
                        None => {
                            if path_columns.len() == 1 && path_columns[0] == "license" {
                                // for get license, as long as user is part of o2, it is fine
                                if &req_data.method.to_string() == "GET" {
                                    if let Ok(v) = db::user::get_user_record(user_id).await {
                                        Some(config::meta::user::User {
                                            email: v.email,
                                            first_name: v.first_name,
                                            last_name: v.last_name,
                                            password: v.password,
                                            salt: v.salt,
                                            token: "".into(),
                                            rum_token: None,
                                            role: config::meta::user::UserRole::User,
                                            org: "".into(),
                                            is_external: v.user_type
                                                == config::meta::user::UserType::External,
                                            password_ext: v.password_ext,
                                        })
                                    } else {
                                        None
                                    }
                                } else {
                                    // for anything else, which will mostly be PUT/POST calls,
                                    // the user must be in _meta org
                                    users::get_user(Some("_meta"), user_id).await
                                }
                            } else {
                                users::get_user(None, user_id).await
                            }
                        }
                    }
                };
                match user {
                    // specifically for list invite call, even if the user is not present
                    // in db, which can be the case when a new user is joining o2 cloud for first
                    // time we can get None. if the API call is specifically
                    // /invite, then it should be ok to allow, because we list
                    // invite based on the user email got from sso provider, and
                    // nothing else. Similarly for accepting invite, we will not have the
                    // user in db anymore, and the fn checks based on email and token, so ok to
                    // bypass
                    None if (is_list_invite_call
                        || is_member_subscription
                        || allow_nonexistent_user) =>
                    {
                        // Allow these special cases without requiring user in DB
                        Ok(AuthValidationResult {
                            user_email: res.0.user_email.clone(),
                            user_role: None,
                            is_internal_user: false,
                        })
                    }
                    Some(user) => {
                        // Check permissions for the user
                        let user_role = user.role;
                        let is_external = user.is_external;
                        if auth_info.bypass_check
                            || check_permissions(
                                user_id,
                                auth_info.clone(),
                                user_role.clone(),
                                is_external,
                            )
                            .await
                        {
                            Ok(AuthValidationResult {
                                user_email: res.0.user_email.clone(),
                                user_role: Some(user_role),
                                is_internal_user: !is_external,
                            })
                        } else {
                            Err(AuthError::Forbidden("Forbidden".to_string()))
                        }
                    }
                    _ => Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
                }
            } else {
                Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
            }
        }
        Err(err) => Err(AuthError::Unauthorized(err.to_string())),
    }
}

#[cfg(feature = "enterprise")]
pub async fn get_user_name_from_token(auth_str: &str) -> Option<String> {
    let keys = get_dex_jwks().await;
    match jwt::verify_decode_token(
        auth_str.strip_prefix("Bearer").unwrap().trim(),
        &keys,
        &get_dex_config().client_id,
        false,
        true,
    ) {
        Ok(res) => {
            if res.0.is_valid {
                Some(res.0.user_email)
            } else {
                None
            }
        }
        Err(_) => None,
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn token_validator(
    _req_data: &RequestData,
    _token: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    Err(AuthError::Unauthorized("Not Supported".to_string()))
}
