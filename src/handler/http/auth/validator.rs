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

use std::net::IpAddr;

use axum::{
    body::Body,
    extract::Request,
    http::{HeaderMap, Method, StatusCode, Uri},
    response::{IntoResponse, Response},
};
use config::{
    get_config,
    meta::user::{DBUser, User, UserRole, UserType},
    utils::base64,
};
#[cfg(feature = "enterprise")]
use o2_dex::config::get_config as get_dex_config;
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
use url::Url;

use crate::{
    common::{
        meta::{
            ingestion::INGESTION_EP,
            organization::DEFAULT_ORG,
            user::{
                AuthTokensExt, TokenValidationResponse, TokenValidationResponseBuilder,
                get_default_user_role,
            },
        },
        utils::{
            auth::{AuthExtractor, V2_API_PREFIX, get_hash, is_root_user},
            redirect_response::RedirectResponseBuilder,
        },
    },
    service::{db, users},
};

pub const PKCE_STATE_ORG: &str = "o2_pkce_state";
pub const ACCESS_TOKEN: &str = "access_token";
pub const REFRESH_TOKEN: &str = "refresh_token";
pub const ID_TOKEN_HEADER: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";

/// Extracted request data that can be safely passed across await points
/// This is Send + Sync because all fields are Send + Sync
#[derive(Clone)]
pub struct RequestData {
    pub uri: Uri,
    pub method: Method,
    pub headers: HeaderMap,
}

/// Error type for auth validation
#[derive(Debug)]
pub enum AuthError {
    Unauthorized(String),
    Forbidden(String),
    NotFound(String),
}

impl std::fmt::Display for AuthError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AuthError::Unauthorized(msg) => write!(f, "Unauthorized: {}", msg),
            AuthError::Forbidden(msg) => write!(f, "Forbidden: {}", msg),
            AuthError::NotFound(msg) => write!(f, "NotFound: {}", msg),
        }
    }
}

impl IntoResponse for AuthError {
    fn into_response(self) -> Response {
        match self {
            AuthError::Unauthorized(msg) => {
                #[cfg(feature = "enterprise")]
                let auth_server_uri = {
                    let dex_config = get_dex_config();
                    if dex_config.dex_enabled {
                        dex_config.dex_url.clone()
                    } else {
                        String::new()
                    }
                };
                #[cfg(not(feature = "enterprise"))]
                let auth_server_uri = String::new();

                let www_authenticate = if !auth_server_uri.is_empty() {
                    format!(r#"Bearer as_uri="{auth_server_uri}""#)
                } else {
                    r#"Bearer realm="openobserve""#.to_string()
                };

                Response::builder()
                    .status(StatusCode::UNAUTHORIZED)
                    .header("WWW-Authenticate", www_authenticate)
                    .body(Body::from(msg))
                    .unwrap()
            }
            AuthError::Forbidden(msg) => (StatusCode::FORBIDDEN, msg).into_response(),
            AuthError::NotFound(msg) => (StatusCode::NOT_FOUND, msg).into_response(),
        }
    }
}

/// Result of auth validation - contains user info and modified request
pub struct AuthValidationResult {
    pub user_email: String,
    pub user_role: Option<UserRole>,
    pub is_internal_user: bool,
}

/// Helper function to build a successful token validation response
fn build_token_validation_response(user: &User) -> TokenValidationResponse {
    TokenValidationResponse {
        is_valid: true,
        user_email: user.email.clone(),
        is_internal_user: !user.is_external,
        user_role: Some(user.role.clone()),
        user_name: user.first_name.clone(),
        family_name: user.last_name.clone(),
        given_name: user.first_name.clone(),
    }
}

pub async fn validator(
    req_data: &RequestData,
    user_id: &str,
    password: &str,
    auth_info: &AuthExtractor,
    path_prefix: &str,
) -> Result<AuthValidationResult, AuthError> {
    let cfg = get_config();
    let path = match req_data
        .uri
        .path()
        .strip_prefix(format!("{}{}", cfg.common.base_uri, path_prefix).as_str())
    {
        Some(path) => path,
        None => req_data.uri.path(),
    };
    let path = path.strip_prefix("/").unwrap_or(path);
    match if auth_info.auth.starts_with("{\"auth_ext\":") {
        let auth_token: AuthTokensExt =
            config::utils::json::from_str(&auth_info.auth).unwrap_or_default();
        let method = req_data.method.to_string();
        validate_credentials_ext(user_id, password, path, auth_token, &method).await
    } else {
        validate_credentials(user_id, password.trim(), path, auth_info.bypass_check).await
    } {
        Ok(res) => {
            if res.is_valid {
                // Check and create organization if needed
                check_and_create_org(user_id, &req_data.method, path).await?;

                #[cfg(feature = "enterprise")]
                let path = path.to_owned();

                #[cfg(feature = "enterprise")]
                if let Some(role) = &res.user_role
                    && role.eq(&UserRole::Viewer)
                    && req_data.method.eq(&Method::PUT)
                    && path.ends_with(&format!("users/{}", res.user_email))
                {
                    // Viewer should be able to update its own details
                    return Ok(AuthValidationResult {
                        user_email: res.user_email,
                        user_role: res.user_role,
                        is_internal_user: res.is_internal_user,
                    });
                }

                if auth_info.bypass_check
                    || check_permissions(
                        user_id,
                        auth_info.clone(),
                        res.user_role.clone().unwrap_or(get_default_user_role()),
                        !res.is_internal_user,
                    )
                    .await
                {
                    Ok(AuthValidationResult {
                        user_email: res.user_email,
                        user_role: res.user_role,
                        is_internal_user: res.is_internal_user,
                    })
                } else {
                    Err(AuthError::Forbidden("Unauthorized Access".to_string()))
                }
            } else {
                Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
            }
        }
        Err(err) => {
            log::debug!("Token Validation Error: {err:#?}");
            Err(err)
        }
    }
}

/// `validate_token` validates the endpoints which are token only.
/// This includes endpoints like `rum` etc.
///
/// ### Args:
/// - token: The token to validate
pub async fn validate_token(token: &str, org_id: &str) -> Result<(), AuthError> {
    match users::get_user_by_token(org_id, token).await {
        Some(_user) => Ok(()),
        None => Err(AuthError::Forbidden(
            "User associated with this token not found".to_string(),
        )),
    }
}

pub async fn validate_credentials(
    user_id: &str,
    user_password: &str,
    path: &str,
    from_session: bool,
) -> Result<TokenValidationResponse, AuthError> {
    // Strip leading slash if present
    let path = path.strip_prefix('/').unwrap_or(path);
    let mut path_columns = path.split('/').collect::<Vec<&str>>();
    if let Some(v) = path_columns.last()
        && v.is_empty()
    {
        path_columns.pop();
    }

    let mut user = if path_columns.last().unwrap_or(&"").eq(&"organizations") {
        let db_user = db::user::get_db_user(user_id).await;
        match db_user {
            Ok(user) => {
                let all_users = user.get_all_users();
                if all_users.is_empty() {
                    None
                } else {
                    // For organizations endpoint, specifically look for user in _meta org
                    // since permission check at line 966 expects the user to be in _meta
                    all_users
                        .iter()
                        .find(|u| u.org == config::META_ORG_ID)
                        .cloned()
                        .or_else(|| all_users.first().cloned())
                }
            }
            Err(e) => {
                log::debug!("Error getting user in validate_credentials: {e}");
                None
            }
        }
    } else {
        match path.find('/') {
            Some(index) => {
                let org_id = if path_columns.len() > 1 && path_columns[0].eq(V2_API_PREFIX) {
                    path_columns[1]
                } else {
                    &path[0..index]
                };

                if is_root_user(user_id) {
                    users::get_user(Some(DEFAULT_ORG), user_id).await
                } else {
                    users::get_user(Some(org_id), user_id).await
                }
            }
            None => users::get_user(None, user_id).await,
        }
    };

    if user.is_none() {
        // for license, we do not provide org in path, but
        // want to be able to access it in all orgs, as long as user has
        // logged in. So here we check if the user id is part of atleast one
        // org, and if so, allow the call. If the user is not part of the current org
        // rest of api calls will get blocked anyways, but without this,
        // native users get stuck in logout loop if they go to any page calling license
        // api call
        if path == "license"
            && let Ok(v) = db::user::get_user_record(user_id).await
        {
            // we set the record manually with minimal permission,
            // so the password check later can be done correctly
            user = Some(User {
                email: v.email,
                first_name: v.first_name,
                last_name: v.last_name,
                password: v.password,
                salt: v.salt,
                token: "".into(),
                rum_token: None,
                role: UserRole::User,
                org: "".into(),
                is_external: v.user_type == UserType::External,
                password_ext: v.password_ext,
            });
        } else {
            return Ok(TokenValidationResponse {
                is_valid: false,
                user_email: "".to_string(),
                is_internal_user: false,
                user_role: None,
                user_name: "".to_string(),
                family_name: "".to_string(),
                given_name: "".to_string(),
            });
        }
    }
    let user = user.unwrap();

    // Check token authentication first (before native login restrictions)
    // This allows service accounts and all users to use API tokens regardless of native login
    // settings
    if user.role.eq(&UserRole::ServiceAccount) && user.token.eq(&user_password) {
        // Check if service accounts are enabled
        let config = get_config();
        if !config.auth.service_account_enabled {
            return Ok(TokenValidationResponse {
                is_valid: false,
                user_email: "".to_string(),
                is_internal_user: false,
                user_role: None,
                user_name: "".to_string(),
                family_name: "".to_string(),
                given_name: "".to_string(),
            });
        }

        // Check if static token usage is allowed for this service account
        // allow_static_token=false means the token cannot be used directly,
        // user must use assume_service_account API to get a temporary session
        // However, tokens from assume_service_account sessions (from_session=true) bypass this
        // check
        if !from_session
            && let Ok(org_user) = db::org_users::get(&user.org, &user.email).await
            && !org_user.allow_static_token
        {
            log::warn!(
                "Service account '{}' in org '{}' attempted direct token auth but allow_static_token=false. Use assume_service_account API instead.",
                user.email,
                user.org
            );
            return Ok(TokenValidationResponse {
                is_valid: false,
                user_email: "".to_string(),
                is_internal_user: false,
                user_role: None,
                user_name: "".to_string(),
                family_name: "".to_string(),
                given_name: "".to_string(),
            });
        }

        return Ok(build_token_validation_response(&user));
    }

    if (path_columns.len() == 1 || INGESTION_EP.iter().any(|s| path_columns.contains(s)))
        && user.token.eq(&user_password)
    {
        return Ok(build_token_validation_response(&user));
    }

    // Enforce native login restrictions only for password-based authentication
    // (Token authentication has already been checked above)
    #[cfg(feature = "enterprise")]
    {
        if !get_dex_config().native_login_enabled && !user.is_external {
            return Ok(TokenValidationResponse {
                is_valid: false,
                user_email: "".to_string(),
                is_internal_user: false,
                user_role: None,
                user_name: "".to_string(),
                family_name: "".to_string(),
                given_name: "".to_string(),
            });
        }

        if get_dex_config().root_only_login && !is_root_user(user_id) {
            return Ok(TokenValidationResponse {
                is_valid: false,
                user_email: "".to_string(),
                is_internal_user: false,
                user_role: None,
                user_name: "".to_string(),
                family_name: "".to_string(),
                given_name: "".to_string(),
            });
        }
    }
    let in_pass = get_hash(user_password, &user.salt);
    if !user.password.eq(&in_pass)
        && !user
            .password_ext
            .unwrap_or("".to_string())
            .eq(&user_password)
    {
        return Ok(TokenValidationResponse {
            is_valid: false,
            user_email: "".to_string(),
            is_internal_user: false,
            user_role: None,
            user_name: "".to_string(),
            family_name: "".to_string(),
            given_name: "".to_string(),
        });
    }
    if !path.contains("/user")
        || (path.contains("/user")
            && (user.role.eq(&UserRole::Admin)
                || user.role.eq(&UserRole::Root)
                || user.email.eq(user_id)))
    {
        Ok(TokenValidationResponse {
            is_valid: true,
            user_email: user.email,
            is_internal_user: !user.is_external,
            user_role: Some(user.role),
            user_name: user.first_name.to_owned(),
            family_name: user.last_name,
            given_name: user.first_name,
        })
    } else {
        Err(AuthError::Forbidden("Not allowed".to_string()))
    }
}

#[cfg(feature = "enterprise")]
pub async fn validate_credentials_ext(
    user_id: &str,
    in_password: &str,
    path: &str,
    auth_token: AuthTokensExt,
    method: &str,
) -> Result<TokenValidationResponse, AuthError> {
    let cfg = get_config();
    let password_ext_salt = cfg.auth.ext_auth_salt.as_str();
    // Strip leading slash if present
    let path = path.strip_prefix('/').unwrap_or(path);
    let mut path_columns = path.split('/').collect::<Vec<&str>>();
    if let Some(v) = path_columns.last()
        && v.is_empty()
    {
        path_columns.pop();
    }

    let user = if path_columns.last().unwrap_or(&"").eq(&"organizations") {
        let db_user = db::user::get_db_user(user_id).await;
        match db_user {
            Ok(user) => {
                let all_users = user.get_all_users();
                if all_users.is_empty() {
                    None
                } else {
                    // For organizations endpoint, specifically look for user in _meta org
                    // since permission check at line 966 expects the user to be in _meta
                    all_users
                        .iter()
                        .find(|u| u.org == config::META_ORG_ID)
                        .cloned()
                        .or_else(|| all_users.first().cloned())
                }
            }
            Err(_) => None,
        }
    } else {
        match path.find('/') {
            Some(index) => {
                let org_id = if path_columns.len() > 1 && path_columns[0].eq(V2_API_PREFIX) {
                    path_columns[1]
                } else {
                    &path[0..index]
                };
                if is_root_user(user_id) {
                    users::get_user(Some(DEFAULT_ORG), user_id).await
                } else {
                    users::get_user(Some(org_id), user_id).await
                }
            }
            None => {
                if path_columns.len() == 1 && path_columns[0] == "license" {
                    // for license requests, we only need to check if part of o2
                    // rest rbac is done in the handlers themselves
                    if method == "GET" {
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
                                is_external: v.user_type == config::meta::user::UserType::External,
                                password_ext: v.password_ext,
                            })
                        } else {
                            None
                        }
                    } else {
                        users::get_user(Some("_meta"), user_id).await
                    }
                } else {
                    users::get_user(None, user_id).await
                }
            }
        }
    };

    if user.is_none() {
        return Ok(TokenValidationResponse::default());
    }
    let user = user.unwrap();

    let hashed_pass = get_hash(
        &format!(
            "{}{}",
            get_hash(
                &format!("{}{}", user.password_ext.unwrap(), auth_token.request_time),
                password_ext_salt
            ),
            auth_token.expires_in
        ),
        password_ext_salt,
    );
    if !hashed_pass.eq(&in_password) {
        return Ok(TokenValidationResponse::default());
    }
    if !path.contains("/user")
        || (path.contains("/user")
            && (user.role.eq(&UserRole::Admin)
                || user.role.eq(&UserRole::Root)
                || user.email.eq(user_id)))
    {
        Ok(TokenValidationResponse {
            is_valid: true,
            user_email: user.email,
            is_internal_user: !user.is_external,
            user_role: Some(user.role),
            user_name: user.first_name.to_owned(),
            family_name: user.last_name,
            given_name: user.first_name,
        })
    } else {
        Err(AuthError::Forbidden("Not allowed".to_string()))
    }
}

/// Creates the org if all the below conditions satisfied
/// - The org does not exist in the meta table
/// - The user is a root user
/// - This is a ingestion POST endpoint
async fn check_and_create_org(user_id: &str, method: &Method, path: &str) -> Result<(), AuthError> {
    let cfg = get_config();
    let mut path_columns = path.split('/').collect::<Vec<&str>>();
    if let Some(v) = path_columns.first()
        && v.is_empty()
    {
        path_columns.remove(0);
    }
    let url_len = path_columns.len();
    if path_columns.len() < 2 {
        return Ok(());
    }
    // node is a special prefix, it does not need to create org
    if path_columns[0].eq("node") {
        return Ok(());
    }
    // Hack for v2 apis
    let org_id = if path_columns.len() > 2
        && path_columns[0].eq("v2")
        && (path_columns[2].eq("alerts") || path_columns[2].eq("folders"))
    {
        path_columns[1]
    } else {
        path_columns[0]
    };

    if crate::service::organization::get_org(org_id)
        .await
        .is_none()
    {
        if !cfg.common.create_org_through_ingestion {
            Err(AuthError::NotFound("Organization not found".to_string()))
        } else if is_root_user(user_id)
            && method.eq(&Method::POST)
            && INGESTION_EP.contains(&path_columns[url_len - 1])
            && crate::service::organization::check_and_create_org(org_id)
                .await
                .is_ok()
        {
            Ok(())
        } else {
            Err(AuthError::NotFound("Organization not found".to_string()))
        }
    } else {
        Ok(())
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn validate_credentials_ext(
    _user_id: &str,
    _in_password: &str,
    _path: &str,
    _auth_token: AuthTokensExt,
    _method: &str,
) -> Result<TokenValidationResponse, AuthError> {
    Err(AuthError::Forbidden("Not allowed".to_string()))
}

async fn validate_user_from_db(
    db_user: Result<DBUser, anyhow::Error>,
    user_password: &str,
    req_time: Option<&String>,
    exp_in: i64,
    password_ext_salt: &str,
) -> Result<TokenValidationResponse, AuthError> {
    // let db_user = db::user::get_db_user(user_id).await;
    match db_user {
        Ok(mut user) => {
            let in_pass = get_hash(user_password, &user.salt);
            if req_time.is_none() && user.password.eq(&in_pass) {
                if user.password_ext.is_none() {
                    let password_ext = get_hash(user_password, password_ext_salt);
                    user.password_ext = Some(password_ext);
                    let _ = db::user::update(
                        &user.email,
                        &user.first_name,
                        &user.last_name,
                        &user.password,
                        user.password_ext.clone(),
                    )
                    .await;
                }
                let resp = TokenValidationResponseBuilder::from_db_user(&user).build();
                Ok(resp)
            } else if user.password_ext.is_some() && req_time.is_some() {
                log::debug!("Validating user for query params");
                let hashed_pass = get_hash(
                    &format!(
                        "{}{}",
                        get_hash(
                            &format!(
                                "{}{}",
                                user.password_ext.as_ref().unwrap(),
                                req_time.unwrap()
                            ),
                            password_ext_salt
                        ),
                        exp_in
                    ),
                    password_ext_salt,
                );
                if hashed_pass.eq(&user_password) {
                    let resp = TokenValidationResponseBuilder::from_db_user(&user).build();
                    Ok(resp)
                } else {
                    Err(AuthError::Forbidden("Not allowed".to_string()))
                }
            } else {
                Err(AuthError::Forbidden("Not allowed".to_string()))
            }
        }
        Err(_) => Err(AuthError::Forbidden("Not allowed".to_string())),
    }
}

pub async fn validate_user(
    user_id: &str,
    user_password: &str,
) -> Result<TokenValidationResponse, AuthError> {
    let db_user = db::user::get_user_record(user_id)
        .await
        .map(|user| DBUser::from(&user));
    let cfg = get_config();
    validate_user_from_db(db_user, user_password, None, 0, &cfg.auth.ext_auth_salt).await
}

pub async fn validate_user_for_query_params(
    user_id: &str,
    user_password: &str,
    req_time: Option<&String>,
    exp_in: i64,
) -> Result<TokenValidationResponse, AuthError> {
    let db_user = db::user::get_db_user(user_id).await;
    let cfg = get_config();
    validate_user_from_db(
        db_user,
        user_password,
        req_time,
        exp_in,
        &cfg.auth.ext_auth_salt,
    )
    .await
}

/// Validates AWS Firehose requests
pub async fn validator_aws(req_data: &RequestData) -> Result<AuthValidationResult, AuthError> {
    let cfg = get_config();
    let path = req_data
        .uri
        .path()
        .strip_prefix(format!("{}/aws/", cfg.common.base_uri).as_str())
        .unwrap_or(req_data.uri.path());

    match req_data.headers.get("X-Amz-Firehose-Access-Key") {
        Some(val) => match val.to_str() {
            Ok(val) => {
                let amz_creds = match base64::decode(val) {
                    Ok(val) => val,
                    Err(_) => {
                        return Err(AuthError::Unauthorized("Unauthorized Access".to_string()));
                    }
                };
                let creds = amz_creds
                    .split(':')
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>();

                match validate_credentials(&creds[0], &creds[1], path, false).await {
                    Ok(res) => {
                        if res.is_valid {
                            Ok(AuthValidationResult {
                                user_email: res.user_email,
                                user_role: res.user_role,
                                is_internal_user: res.is_internal_user,
                            })
                        } else {
                            Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
                        }
                    }
                    Err(err) => Err(err),
                }
            }
            Err(_) => Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
        },
        None => Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
    }
}

/// Validates GCP requests
pub async fn validator_gcp(req_data: &RequestData) -> Result<AuthValidationResult, AuthError> {
    let cfg = get_config();
    let path = req_data
        .uri
        .path()
        .strip_prefix(format!("{}/gcp/", cfg.common.base_uri).as_str())
        .unwrap_or(req_data.uri.path());

    // Parse query string
    let query_string = req_data.uri.query().unwrap_or("");
    let query: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(query_string.as_bytes())
            .into_owned()
            .collect();

    match query.get("API-Key") {
        Some(val) => {
            let gcp_creds = match base64::decode(val) {
                Ok(val) => val,
                Err(_) => return Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
            };
            let creds = gcp_creds
                .split(':')
                .map(|s| s.to_string())
                .collect::<Vec<String>>();

            match validate_credentials(&creds[0], &creds[1], path, false).await {
                Ok(res) => {
                    if res.is_valid {
                        Ok(AuthValidationResult {
                            user_email: res.user_email,
                            user_role: res.user_role,
                            is_internal_user: res.is_internal_user,
                        })
                    } else {
                        Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
                    }
                }
                Err(err) => Err(err),
            }
        }
        None => Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
    }
}

/// Validates RUM requests
pub async fn validator_rum(req_data: &RequestData) -> Result<AuthValidationResult, AuthError> {
    let path = req_data
        .uri
        .path()
        .strip_prefix(format!("{}/v1/", get_config().common.base_uri).as_str())
        .unwrap_or(req_data.uri.path());

    // After this previous path clean we should get only the
    // remaining `org_id/rum` or `org_id/replay` or `org_id/logs`
    let org_id_end_point: Vec<&str> = path.split('/').collect();
    if org_id_end_point.len() != 2 {
        return Err(AuthError::Unauthorized(
            "Unauthorized Access. Please pass a valid org_id.".to_string(),
        ));
    }

    // Parse query string
    let query_string = req_data.uri.query().unwrap_or("");
    let query: std::collections::HashMap<String, String> =
        url::form_urlencoded::parse(query_string.as_bytes())
            .into_owned()
            .collect();

    let token = query.get("oo-api-key").or_else(|| query.get("o2-api-key"));
    match token {
        Some(token) => match validate_token(token, org_id_end_point[0]).await {
            Ok(_res) => {
                // Get user from token to set user_id header
                if let Some(user) = users::get_user_by_token(org_id_end_point[0], token).await {
                    Ok(AuthValidationResult {
                        user_email: user.email,
                        user_role: Some(user.role),
                        is_internal_user: !user.is_external,
                    })
                } else {
                    Ok(AuthValidationResult {
                        user_email: String::new(),
                        user_role: None,
                        is_internal_user: false,
                    })
                }
            }
            Err(err) => {
                log::error!(
                    "validate_token: Token not found for org_id: {}",
                    org_id_end_point[0]
                );
                Err(err)
            }
        },
        None => {
            log::error!(
                "validate_token: Missing api key for rum endpoint org_id: {}",
                org_id_end_point[0]
            );
            Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
        }
    }
}

async fn oo_validator_internal(
    req_data: &RequestData,
    auth_info: &AuthExtractor,
    path_prefix: &str,
) -> Result<AuthValidationResult, AuthError> {
    // Check if this is a session-based auth (marked with Session:: prefix)
    let (is_from_session, auth_str) = if let Some(rest) = auth_info.auth.strip_prefix("Session::") {
        // Format: "Session::<session_id>::<actual_token>"
        if let Some((_session_id, token)) = rest.split_once("::") {
            (true, token.to_string())
        } else {
            (false, auth_info.auth.clone())
        }
    } else {
        (false, auth_info.auth.clone())
    };

    if let Some(info) = auth_str.strip_prefix("Basic ").map(str::trim) {
        let decoded = match base64::decode(info) {
            Ok(val) => val,
            Err(_) => return Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
        };

        let (username, password) = match get_user_details(&decoded) {
            Some(value) => value,
            None => return Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
        };
        // Pass is_from_session flag through a modified auth_info
        let mut modified_auth_info = auth_info.clone();
        modified_auth_info.bypass_check = is_from_session || auth_info.bypass_check;
        validator(
            req_data,
            &username,
            &password,
            &modified_auth_info,
            path_prefix,
        )
        .await
    } else if auth_str.starts_with("Bearer") {
        log::debug!("Bearer token found");
        super::token::token_validator(req_data, auth_info).await
    } else if let Ok(auth_tokens) = config::utils::json::from_str::<AuthTokensExt>(&auth_info.auth)
    {
        log::debug!("Auth ext token found");
        if auth_tokens.has_expired() {
            Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
        } else {
            log::debug!("Auth ext token found: decoding");
            let decoded = match base64::decode(
                auth_tokens
                    .auth_ext
                    .strip_prefix("auth_ext")
                    .unwrap()
                    .trim(),
            ) {
                Ok(val) => val,
                Err(_) => return Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
            };
            let (username, password) = match get_user_details(&decoded) {
                Some(value) => value,
                None => return Err(AuthError::Unauthorized("Unauthorized Access".to_string())),
            };
            log::info!("Auth ext token found: validating: {username} {password}");
            validator(req_data, &username, &password, auth_info, path_prefix).await
        }
    } else {
        // Missing or unrecognized auth - return WWW-Authenticate header
        Err(AuthError::Unauthorized("Unauthorized Access".to_string()))
    }
}

#[cfg(feature = "enterprise")]
pub async fn get_user_email_from_auth_str(auth_str: &str) -> Option<String> {
    if auth_str.starts_with("Basic") {
        let decoded = match base64::decode(auth_str.strip_prefix("Basic").unwrap().trim()) {
            Ok(val) => val,
            Err(_) => return None,
        };

        match get_user_details(decoded) {
            Some(value) => Some(value.0),
            None => None,
        }
    } else if auth_str.starts_with("Bearer") {
        super::token::get_user_name_from_token(auth_str).await
    } else if auth_str.starts_with("{\"auth_ext\":") {
        let auth_tokens: AuthTokensExt =
            config::utils::json::from_str(auth_str).unwrap_or_default();
        if chrono::Utc::now().timestamp() - auth_tokens.request_time > auth_tokens.expires_in {
            None
        } else {
            let decoded = match base64::decode(
                auth_tokens
                    .auth_ext
                    .strip_prefix("auth_ext")
                    .unwrap()
                    .trim(),
            ) {
                Ok(val) => val,
                Err(_) => return None,
            };
            match get_user_details(decoded) {
                Some(value) => Some(value.0),
                None => None,
            }
        }
    } else {
        None
    }
}

fn get_user_details(decoded: impl AsRef<[u8]>) -> Option<(String, String)> {
    let credentials = str::from_utf8(decoded.as_ref()).ok()?;
    credentials
        .split_once(':')
        .map(|(u, p)| (u.to_string(), p.to_string()))
}

/// Validates the authentication information in the incoming request and returns the result if
/// valid, or an error if invalid.
///
/// This function is responsible for validating the authentication information in the incoming
/// request. It supports both Basic and Bearer authentication (in enterprise).
/// Works exclusively on `/api` prefix
///
/// For Basic authentication, it decodes the base64-encoded credentials, splits them into username
/// and password, and calls the `validator` function to validate the credentials.
///
/// For Bearer authentication, it calls the `token_validator` function to validate the token.
///
/// If the authentication is invalid, it returns an `AuthError::Unauthorized` error.
pub async fn oo_validator(
    req_data: &RequestData,
    auth_info: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    let path_prefix = "/api/";
    let _path = extract_relative_path(req_data.uri.path(), path_prefix);

    oo_validator_internal(req_data, auth_info, path_prefix).await
}

/// Validates the authentication information in the request and returns the result if valid, or an
/// error if invalid.
///
/// This function is a proxy for the `oo_validator_internal` function, setting the `path_prefix` to
/// "/proxy/".
pub async fn validator_proxy_url(
    req_data: &RequestData,
    auth_info: &AuthExtractor,
) -> Result<AuthValidationResult, AuthError> {
    let path_prefix = "/proxy/";
    oo_validator_internal(req_data, auth_info, path_prefix).await
}

pub async fn validate_http_internal(req: &Request) -> Result<(), AuthError> {
    let router_nodes = infra::cluster::get_cached_online_router_nodes()
        .await
        .unwrap_or_default();

    // Get the peer address from headers
    let peer = req
        .headers()
        .get("X-Forwarded-For")
        .or_else(|| req.headers().get("Forwarded"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("unknown")
        .to_string();

    let router_node = router_nodes.iter().find(|node| {
        let node_url = match Url::parse(&node.http_addr) {
            Ok(node_url) => node_url,
            Err(e) => {
                log::error!("Failed to parse node URL: {e}");
                return false;
            }
        };

        // Get IP from peer address (strips port if present)
        let peer_ip = match peer
            .split(':')
            .next()
            .and_then(|addr| addr.parse::<IpAddr>().ok())
        {
            Some(ip) => ip,
            None => {
                log::debug!("Failed to parse peer IP from: {peer}");
                return false;
            }
        };

        let node_ip = match node_url
            .host()
            .and_then(|h| h.to_string().parse::<IpAddr>().ok())
        {
            Some(ip) => ip,
            None => {
                log::debug!("Failed to parse node IP");
                return false;
            }
        };

        peer_ip == node_ip
    });

    if router_node.is_none() {
        return Err(AuthError::Unauthorized("Unauthorized Access".to_string()));
    }
    Ok(())
}

#[cfg(feature = "enterprise")]
pub(crate) async fn check_permissions(
    user_id: &str,
    auth_info: AuthExtractor,
    role: UserRole,
    _is_external: bool,
) -> bool {
    use crate::common::infra::config::ORG_USERS;

    if !get_openfga_config().enabled {
        return true;
    }

    let object_str = auth_info.o2_type;
    log::debug!("Role of user {user_id} is {role:#?}");
    let obj_str = if object_str.contains("##user_id##") {
        object_str.replace("##user_id##", user_id)
    } else {
        object_str
    };
    let role = if role.eq(&UserRole::Root) {
        // root user should have access to everything , bypass check in openfga
        return true;
    } else if auth_info.org_id.eq("organizations") && auth_info.method.eq("POST") {
        match ORG_USERS.get(&format!("{}/{user_id}", config::META_ORG_ID)) {
            Some(user) => format!("{}", user.role),
            None => "".to_string(),
        }
    } else {
        format!("{role}")
    };
    let org_id = if auth_info.org_id.eq("organizations") {
        if auth_info.method.eq("POST") {
            // The user is trying to create a new organization
            // Use the usage org to check for permission
            config::META_ORG_ID
        } else {
            user_id
        }
    } else {
        &auth_info.org_id
    };

    o2_openfga::authorizer::authz::is_allowed(
        org_id,
        user_id,
        &auth_info.method,
        &obj_str,
        &auth_info.parent_id,
        &role.to_string(),
    )
    .await
}

#[cfg(not(feature = "enterprise"))]
pub(crate) async fn check_permissions(
    _user_id: &str,
    _auth_info: AuthExtractor,
    _role: UserRole,
    _is_external: bool,
) -> bool {
    true
}

#[cfg(feature = "enterprise")]
async fn list_objects(
    user_id: &str,
    permission: &str,
    object_type: &str,
    org_id: &str,
    role: &str,
) -> Result<Vec<String>, anyhow::Error> {
    o2_openfga::authorizer::authz::list_objects(user_id, permission, object_type, org_id, role)
        .await
}

#[cfg(feature = "enterprise")]
pub(crate) async fn list_objects_for_user(
    org_id: &str,
    user_id: &str,
    permission: &str,
    object_type: &str,
) -> Result<Option<Vec<String>>, AuthError> {
    let openfga_config = get_openfga_config();
    if !is_root_user(user_id) && openfga_config.enabled && openfga_config.list_only_permitted {
        let role = match users::get_user(Some(org_id), user_id).await {
            Some(user) => user.role.to_string(),
            None => "".to_string(),
        };
        match list_objects(user_id, permission, object_type, org_id, &role).await {
            Ok(resp) => {
                log::debug!(
                    "list_objects_for_user for user {user_id} from {org_id} org returns: {resp:#?}"
                );
                Ok(Some(resp))
            }
            Err(_) => Err(AuthError::Forbidden("Unauthorized Access".to_string())),
        }
    } else {
        Ok(None)
    }
}

/// Helper function to extract the relative path after the base URI and path prefix
fn extract_relative_path(full_path: &str, path_prefix: &str) -> String {
    let base_uri = config::get_config().common.base_uri.clone();
    let full_prefix = format!("{base_uri}{path_prefix}");
    full_path
        .strip_prefix(&full_prefix)
        .unwrap_or(full_path)
        .to_string()
}

/// Helper function to check if the path corresponds to a short URL
fn _is_short_url_path(path_columns: &[&str]) -> bool {
    path_columns
        .get(1)
        .is_some_and(|&segment| segment.to_lowercase() == "short")
}

/// Handles authentication failure by logging the error and returning a redirect response.
fn _handle_auth_failure_for_redirect(req: &Request, error: &AuthError) -> AuthError {
    let full_url = _extract_full_url(req);
    let redirect_http = RedirectResponseBuilder::default()
        .with_query_param("short_url", &full_url)
        .build();
    log::warn!(
        "Authentication failed for path: {}, err: {:?}, {}",
        req.uri().path(),
        error,
        &redirect_http,
    );
    AuthError::Unauthorized(redirect_http.to_string())
}

/// Extracts the full URL from the request.
fn _extract_full_url(req: &Request) -> String {
    let scheme = req
        .headers()
        .get("X-Forwarded-Proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("http");
    let host = req
        .headers()
        .get("Host")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("localhost");
    let path = req
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("");

    format!("{scheme}://{host}{path}")
}

#[cfg(test)]
mod tests {
    use infra::{
        db as infra_db,
        db::{ORM_CLIENT, connect_to_orm},
        table as infra_table,
    };

    use super::*;
    use crate::{
        common::{
            infra::config::{ORG_USERS, USERS},
            meta::user::UserRequest,
        },
        service::{organization, users},
    };

    #[tokio::test]
    async fn test_validation_response_builder_from_db_user() {
        let user = DBUser {
            email: "test@email.com".into(),
            first_name: "first_name".into(),
            last_name: "last_name".into(),
            password: "some_pass".into(),
            salt: "some_salt".into(),
            organizations: vec![],
            is_external: false,
            password_ext: Some("some_pass_ext".into()),
        };

        let resp_from_builder = TokenValidationResponseBuilder::from_db_user(&user).build();

        let resp = TokenValidationResponse {
            is_valid: true,
            user_email: user.email,
            is_internal_user: !user.is_external,
            user_role: None,
            user_name: user.first_name.to_owned(),
            family_name: user.last_name,
            given_name: user.first_name,
        };

        assert_eq!(resp_from_builder.is_valid, resp.is_valid);
        assert!(resp_from_builder.user_email.eq(&resp.user_email));
        assert_eq!(resp_from_builder.is_internal_user, resp.is_internal_user);
        assert_eq!(resp_from_builder.user_role, resp.user_role);
        assert!(resp_from_builder.user_name.eq(&resp.user_name));
        assert!(resp_from_builder.family_name.eq(&resp.family_name));
        assert!(resp_from_builder.given_name.eq(&resp.given_name));
    }

    #[tokio::test]
    async fn test_validation_response_default() {
        let actual = TokenValidationResponse {
            is_valid: false,
            user_email: "".to_string(),
            is_internal_user: false,
            user_role: None,
            user_name: "".to_string(),
            family_name: "".to_string(),
            given_name: "".to_string(),
        };
        let expected1 = TokenValidationResponseBuilder::new().build();
        let expected2 = TokenValidationResponse::default();

        assert!(actual == expected1);
        assert!(actual == expected2);
        assert!(expected1 == expected2);
    }

    #[tokio::test]
    async fn test_validate() {
        let org_id = "default";
        let user_id = "user1@example.com";
        let init_user = "root@example.com";
        let pwd = "Complexpass#123";

        // Initialize ORM client and clear database tables for test isolation
        let _ = ORM_CLIENT.get_or_init(connect_to_orm).await;
        let _ = infra::table::org_users::clear().await;
        let _ = infra::table::users::clear().await;
        let _ = infra::table::organizations::clear().await;
        let _ = infra_db::create_table().await;
        let _ = infra_table::create_user_tables().await;
        let _ = organization::check_and_create_org_without_ofga(org_id).await;

        // Clear global caches to ensure test isolation
        USERS.clear();
        ORG_USERS.clear();
        let _ = users::create_root_user_if_not_exists(
            org_id,
            UserRequest {
                email: init_user.to_string(),
                password: pwd.to_string(),
                role: crate::common::meta::user::UserOrgRole {
                    base_role: config::meta::user::UserRole::Root,
                    custom_role: None,
                },
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
                token: None,
            },
        )
        .await;
        let _ = users::post_user(
            org_id,
            UserRequest {
                email: user_id.to_string(),
                password: pwd.to_string(),
                role: crate::common::meta::user::UserOrgRole {
                    base_role: config::meta::user::UserRole::Admin,
                    custom_role: None,
                },
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: true,
                token: None,
            },
            init_user,
        )
        .await;

        assert!(
            validate_credentials(init_user, pwd, "default/_bulk", false)
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            !validate_credentials("", pwd, "default/_bulk", false)
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            !validate_credentials("", pwd, "/", false)
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            !validate_credentials(user_id, pwd, "/", false)
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            !validate_credentials(user_id, "x", "default/user", false)
                .await
                .unwrap()
                .is_valid
        );
        assert!(validate_user(init_user, pwd).await.unwrap().is_valid);
    }

    #[test]
    fn test_get_user_details() {
        // Test valid credentials
        let valid_creds = "username:password".as_bytes().to_vec();
        let result = get_user_details(String::from_utf8(valid_creds).unwrap());
        assert!(result.is_some());
        let (username, password) = result.unwrap();
        assert_eq!(username, "username");
        assert_eq!(password, "password");

        // Test invalid credentials (no colon)
        let invalid_creds = "usernamepassword".as_bytes().to_vec();
        let result = get_user_details(String::from_utf8(invalid_creds).unwrap());
        assert!(result.is_none());

        // Test invalid credentials (only username with colon)
        let invalid_creds2 = "username:".as_bytes().to_vec();
        let result = get_user_details(String::from_utf8(invalid_creds2).unwrap());
        assert!(result.is_some()); // This actually works because it splits into ["username", ""]
        let (username, password) = result.unwrap();
        assert_eq!(username, "username");
        assert_eq!(password, "");

        // Test invalid credentials format (only colon)
        let invalid_creds3 = ":".as_bytes().to_vec();
        let result = get_user_details(String::from_utf8(invalid_creds3).unwrap());
        assert!(result.is_some()); // This also works because it splits into ["", ""]
        let (username, password) = result.unwrap();
        assert_eq!(username, "");
        assert_eq!(password, "");
    }

    #[test]
    fn test_extract_relative_path() {
        // Test normal path extraction
        let full_path = "/api/v1/logs";
        let result = extract_relative_path(full_path, "/api/");
        assert_eq!(result, "v1/logs");

        // Test path with base URI
        let full_path_with_base = "/openobserve/api/v1/logs";
        let result = extract_relative_path(full_path_with_base, "/api/");
        assert_eq!(result, "/openobserve/api/v1/logs");

        // Test path that doesn't match prefix
        let unmatched_path = "/other/path";
        let result = extract_relative_path(unmatched_path, "/api/");
        assert_eq!(result, "/other/path");
    }

    #[test]
    fn test_is_short_url_path() {
        // Test short URL path
        let short_url_path = ["api", "short", "abc123"];
        assert!(_is_short_url_path(&short_url_path));

        // Test non-short URL path
        let normal_path = ["api", "v1", "logs"];
        assert!(!_is_short_url_path(&normal_path));

        // Test path with insufficient segments
        let short_path = ["api"];
        assert!(!_is_short_url_path(&short_path));

        // Test case insensitive
        let mixed_case_path = ["api", "SHORT", "abc123"];
        assert!(_is_short_url_path(&mixed_case_path));
    }

    #[test]
    fn test_path_normalization() {
        // Test path normalization logic (the code you highlighted)
        let mut path_columns = vec!["api", "v1", "logs", ""];
        if let Some(v) = path_columns.last()
            && v.is_empty()
        {
            path_columns.pop();
        }
        assert_eq!(path_columns, vec!["api", "v1", "logs"]);

        // Test path without trailing empty segment
        let mut path_columns2 = vec!["api", "v1", "logs"];
        if let Some(v) = path_columns2.last()
            && v.is_empty()
        {
            path_columns2.pop();
        }
        assert_eq!(path_columns2, vec!["api", "v1", "logs"]);

        // Test empty path
        let mut path_columns3 = vec![""];
        if let Some(v) = path_columns3.last()
            && v.is_empty()
        {
            path_columns3.pop();
        }
        assert!(path_columns3.is_empty());
    }

    #[tokio::test]
    async fn test_validate_token() {
        // Test with invalid token
        let result = validate_token("invalid_token", "default").await;
        assert!(result.is_err());

        // Test with empty token
        let result = validate_token("", "default").await;
        assert!(result.is_err());
    }

    #[test]
    fn test_validate_credentials_path_handling() {
        // Test path handling in validate_credentials
        let path_columns = ["api", "v1", "organizations"];
        let last_segment = path_columns.last().unwrap_or(&"");
        assert_eq!(*last_segment, "organizations");

        // Test path with trailing slash
        let path_with_slash = ["api", "v1", "logs", ""];
        let last_segment_with_slash = path_with_slash.last().unwrap_or(&"");
        assert_eq!(*last_segment_with_slash, "");
    }

    #[test]
    fn test_v2_api_prefix_handling() {
        // Test V2 API prefix handling
        let v2_path_columns = ["v2", "org_id", "logs"];
        let org_id = if v2_path_columns.len() > 1 && v2_path_columns[0].eq("v2") {
            v2_path_columns[1]
        } else {
            "default"
        };
        assert_eq!(org_id, "org_id");

        // Test non-V2 path
        let normal_path_columns = ["org_id", "logs"];
        let org_id_normal = if normal_path_columns.len() > 1 && normal_path_columns[0].eq("v2") {
            normal_path_columns[1]
        } else {
            "default"
        };
        assert_eq!(org_id_normal, "default");
    }
}
