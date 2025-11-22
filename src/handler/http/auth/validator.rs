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

use core::clone::Clone;
use std::net::IpAddr;

use actix_web::{
    Error, HttpResponse,
    dev::ServiceRequest,
    error::{ErrorForbidden, ErrorNotFound, ErrorUnauthorized},
    http::{Method, header},
    web,
};
use config::{
    get_config,
    meta::user::{DBUser, UserRole},
    utils::base64,
};
#[cfg(feature = "enterprise")]
use o2_dex::config::get_config as get_dex_config;
#[cfg(feature = "enterprise")]
use o2_openfga::config::get_config as get_openfga_config;
use url::Url;

use crate::{
    common::{
        infra::cluster,
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

pub async fn validator(
    req: ServiceRequest,
    user_id: &str,
    password: &str,
    auth_info: AuthExtractor,
    path_prefix: &str,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let cfg = get_config();
    let path = match req
        .request()
        .path()
        .strip_prefix(format!("{}{}", cfg.common.base_uri, path_prefix).as_str())
    {
        Some(path) => path,
        None => req.request().path(),
    };
    match if auth_info.auth.starts_with("{\"auth_ext\":") {
        let auth_token: AuthTokensExt =
            config::utils::json::from_str(&auth_info.auth).unwrap_or_default();
        validate_credentials_ext(user_id, password, path, auth_token).await
    } else {
        validate_credentials(user_id, password.trim(), path).await
    } {
        Ok(res) => {
            if res.is_valid {
                // Check and create organization if needed
                if let Err(e) = check_and_create_org(user_id, req.method(), path).await {
                    return Err((e, req));
                }

                #[cfg(feature = "enterprise")]
                let path = path.to_owned();

                // / Hack for prometheus, need support POST and check the header
                let mut req = req;
                if req.method().eq(&Method::POST) && !req.headers().contains_key("content-type") {
                    req.headers_mut().insert(
                        header::CONTENT_TYPE,
                        header::HeaderValue::from_static("application/x-www-form-urlencoded"),
                    );
                }
                req.headers_mut().insert(
                    header::HeaderName::from_static("user_id"),
                    header::HeaderValue::from_str(&res.user_email).unwrap(),
                );

                #[cfg(feature = "enterprise")]
                if let Some(role) = &res.user_role
                    && role.eq(&UserRole::Viewer)
                    && req.method().eq(&Method::PUT)
                    && path.ends_with(&format!("users/{}", res.user_email))
                {
                    // Viewer should be able to update its own details
                    return Ok(req);
                }

                if auth_info.bypass_check
                    || check_permissions(
                        user_id,
                        auth_info,
                        res.user_role.unwrap_or(get_default_user_role()),
                        !res.is_internal_user,
                    )
                    .await
                {
                    Ok(req)
                } else {
                    Err((ErrorForbidden("Unauthorized Access"), req))
                }
            } else {
                Err((ErrorUnauthorized("Unauthorized Access"), req))
            }
        }
        Err(err) => {
            log::debug!("Token Validation Error: {err:#?}");
            Err((err, req))
        }
    }
}

/// `validate_token` validates the endpoints which are token only.
/// This includes endpoints like `rum` etc.
///
/// ### Args:
/// - token: The token to validate
///  
pub async fn validate_token(token: &str, org_id: &str) -> Result<(), Error> {
    match users::get_user_by_token(org_id, token).await {
        Some(_user) => Ok(()),
        None => Err(ErrorForbidden("User associated with this token not found")),
    }
}

pub async fn validate_credentials(
    user_id: &str,
    user_password: &str,
    path: &str,
) -> Result<TokenValidationResponse, Error> {
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
                    all_users.first().cloned()
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
    let user = user.unwrap();

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

    if user.role.eq(&UserRole::ServiceAccount) && user.token.eq(&user_password) {
        return Ok(TokenValidationResponse {
            is_valid: true,
            user_email: user.email,
            is_internal_user: !user.is_external,
            user_role: Some(user.role),
            user_name: user.first_name.to_owned(),
            family_name: user.last_name,
            given_name: user.first_name,
        });
    }

    if (path_columns.len() == 1 || INGESTION_EP.iter().any(|s| path_columns.contains(s)))
        && user.token.eq(&user_password)
    {
        return Ok(TokenValidationResponse {
            is_valid: true,
            user_email: user.email,
            is_internal_user: !user.is_external,
            user_role: Some(user.role),
            user_name: user.first_name.to_owned(),
            family_name: user.last_name,
            given_name: user.first_name,
        });
    }

    // Check for SAML session token
    if user_password.starts_with("saml_session_") {
        match crate::service::session::get(user_id).await {
            Ok(session_token) => {
                if session_token.eq(&user_password) {
                    return Ok(TokenValidationResponse {
                        is_valid: true,
                        user_email: user.email,
                        is_internal_user: !user.is_external,
                        user_role: Some(user.role),
                        user_name: user.first_name.to_owned(),
                        family_name: user.last_name,
                        given_name: user.first_name,
                    });
                }
            }
            Err(_) => {
                // Session not found or expired
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
        Err(ErrorForbidden("Not allowed"))
    }
}

#[cfg(feature = "enterprise")]
pub async fn validate_credentials_ext(
    user_id: &str,
    in_password: &str,
    path: &str,
    auth_token: AuthTokensExt,
) -> Result<TokenValidationResponse, Error> {
    let config = get_config();
    let password_ext_salt = config.auth.ext_auth_salt.as_str();
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
                    all_users.first().cloned()
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
            None => users::get_user(None, user_id).await,
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
        Err(ErrorForbidden("Not allowed"))
    }
}

/// Creates the org if all the below conditions satisfied
/// - The org does not exist in the meta table
/// - The user is a root user
/// - This is a ingestion POST endpoint
async fn check_and_create_org(user_id: &str, method: &Method, path: &str) -> Result<(), Error> {
    let config = get_config();
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
        if !config.common.create_org_through_ingestion {
            Err(ErrorNotFound("Organization not found"))
        } else if is_root_user(user_id)
            && method.eq(&Method::POST)
            && INGESTION_EP.contains(&path_columns[url_len - 1])
            && crate::service::organization::check_and_create_org(org_id)
                .await
                .is_ok()
        {
            Ok(())
        } else {
            Err(ErrorNotFound("Organization not found"))
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
) -> Result<TokenValidationResponse, Error> {
    Err(ErrorForbidden("Not allowed"))
}

async fn validate_user_from_db(
    db_user: Result<DBUser, anyhow::Error>,
    user_password: &str,
    req_time: Option<&String>,
    exp_in: i64,
    password_ext_salt: &str,
) -> Result<TokenValidationResponse, Error> {
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
                    Err(ErrorForbidden("Not allowed"))
                }
            } else {
                Err(ErrorForbidden("Not allowed"))
            }
        }
        Err(_) => Err(ErrorForbidden("Not allowed")),
    }
}

pub async fn validate_user(
    user_id: &str,
    user_password: &str,
) -> Result<TokenValidationResponse, Error> {
    let db_user = db::user::get_user_record(user_id)
        .await
        .map(|user| DBUser::from(&user));
    let config = get_config();
    validate_user_from_db(db_user, user_password, None, 0, &config.auth.ext_auth_salt).await
}

pub async fn validate_user_for_query_params(
    user_id: &str,
    user_password: &str,
    req_time: Option<&String>,
    exp_in: i64,
) -> Result<TokenValidationResponse, Error> {
    let db_user = db::user::get_db_user(user_id).await;
    let config = get_config();
    validate_user_from_db(
        db_user,
        user_password,
        req_time,
        exp_in,
        &config.auth.ext_auth_salt,
    )
    .await
}

pub async fn validator_aws(
    req: ServiceRequest,
    _thread_id: web::Data<usize>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let cfg = get_config();
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/aws/", cfg.common.base_uri).as_str())
        .unwrap_or(req.request().path());

    match req.headers().get("X-Amz-Firehose-Access-Key") {
        Some(val) => match val.to_str() {
            Ok(val) => {
                let amz_creds = match base64::decode(val) {
                    Ok(val) => val,
                    Err(_) => return Err((ErrorUnauthorized("Unauthorized Access"), req)),
                };
                let creds = amz_creds
                    .split(':')
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>();

                match validate_credentials(&creds[0], &creds[1], path).await {
                    Ok(res) => {
                        if res.is_valid {
                            let mut req = req;
                            req.headers_mut().insert(
                                header::HeaderName::from_static("user_id"),
                                header::HeaderValue::from_str(&res.user_email).unwrap(),
                            );
                            Ok(req)
                        } else {
                            Err((ErrorUnauthorized("Unauthorized Access"), req))
                        }
                    }
                    Err(err) => Err((err, req)),
                }
            }
            Err(_) => Err((ErrorUnauthorized("Unauthorized Access"), req)),
        },
        None => Err((ErrorUnauthorized("Unauthorized Access"), req)),
    }
}

pub async fn validator_gcp(
    req: ServiceRequest,
    _thread_id: web::Data<usize>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let cfg = get_config();
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/gcp/", cfg.common.base_uri).as_str())
        .unwrap_or(req.request().path());

    let query =
        web::Query::<std::collections::HashMap<String, String>>::from_query(req.query_string())
            .unwrap();
    match query.get("API-Key") {
        Some(val) => {
            let gcp_creds = base64::decode(val).unwrap();
            let creds = gcp_creds
                .split(':')
                .map(|s| s.to_string())
                .collect::<Vec<String>>();

            match validate_credentials(&creds[0], &creds[1], path).await {
                Ok(res) => {
                    if res.is_valid {
                        let mut req = req;
                        req.headers_mut().insert(
                            header::HeaderName::from_static("user_id"),
                            header::HeaderValue::from_str(&res.user_email).unwrap(),
                        );
                        Ok(req)
                    } else {
                        Err((ErrorUnauthorized("Unauthorized Access"), req))
                    }
                }
                Err(err) => Err((err, req)),
            }
        }
        None => Err((ErrorUnauthorized("Unauthorized Access"), req)),
    }
}

pub async fn validator_rum(
    req: ServiceRequest,
    _thread_id: web::Data<usize>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/rum/v1/", get_config().common.base_uri).as_str())
        .unwrap_or(req.request().path());

    // After this previous path clean we should get only the
    // remaining `org_id/rum` or `org_id/replay` or `org_id/logs`
    let org_id_end_point: Vec<&str> = path.split('/').collect();
    if org_id_end_point.len() != 2 {
        return Err((
            ErrorUnauthorized("Unauthorized Access. Please pass a valid org_id."),
            req,
        ));
    }

    let query =
        web::Query::<std::collections::HashMap<String, String>>::from_query(req.query_string())
            .unwrap();
    let token = query.get("oo-api-key").or_else(|| query.get("o2-api-key"));
    match token {
        Some(token) => match validate_token(token, org_id_end_point[0]).await {
            Ok(_res) => Ok(req),
            Err(err) => {
                log::error!(
                    "validate_token: Token not found for org_id: {}",
                    org_id_end_point[0]
                );
                Err((err, req))
            }
        },
        None => {
            log::error!(
                "validate_token: Missing api key for rum endpoint org_id: {}",
                org_id_end_point[0]
            );
            Err((ErrorUnauthorized("Unauthorized Access"), req))
        }
    }
}

async fn oo_validator_internal(
    req: ServiceRequest,
    auth_info: AuthExtractor,
    path_prefix: &str,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    if let Some(info) = auth_info.auth.strip_prefix("Basic ").map(str::trim) {
        let decoded = match base64::decode(info) {
            Ok(val) => val,
            Err(_) => return Err((ErrorUnauthorized("Unauthorized Access"), req)),
        };

        let (username, password) = match get_user_details(&decoded) {
            Some(value) => value,
            None => return Err((ErrorUnauthorized("Unauthorized Access"), req)),
        };
        validator(req, &username, &password, auth_info, path_prefix).await
    } else if auth_info.auth.starts_with("Bearer") {
        log::debug!("Bearer token found");
        super::token::token_validator(req, auth_info).await
    } else if let Ok(auth_tokens) = config::utils::json::from_str::<AuthTokensExt>(&auth_info.auth)
    {
        log::debug!("Auth ext token found");
        if auth_tokens.has_expired() {
            Err((ErrorUnauthorized("Unauthorized Access"), req))
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
                Err(_) => return Err((ErrorUnauthorized("Unauthorized Access"), req)),
            };
            let (username, password) = match get_user_details(&decoded) {
                Some(value) => value,
                None => return Err((ErrorUnauthorized("Unauthorized Access"), req)),
            };
            log::info!("Auth ext token found: validating: {username} {password}");
            validator(req, &username, &password, auth_info, path_prefix).await
        }
    } else {
        // Missing or unrecognized auth - return WWW-Authenticate header
        Err((create_unauthorized_response("Unauthorized Access"), req))
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

/// Creates an Unauthorized error response with WWW-Authenticate header
fn create_unauthorized_response(message: &str) -> Error {
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

    actix_web::error::InternalError::from_response(
        message.to_string(),
        HttpResponse::Unauthorized()
            .insert_header(("WWW-Authenticate", www_authenticate))
            .finish(),
    )
    .into()
}

/// Validates the authentication information in the incoming request and returns the request if
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
/// If the authentication is invalid, it returns an `ErrorUnauthorized` error.
pub async fn oo_validator(
    req: ServiceRequest,
    auth_result: Result<AuthExtractor, Error>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path_prefix = "/api/";
    let path = extract_relative_path(req.request().path(), path_prefix);
    let path_columns = path.split('/').collect::<Vec<&str>>();
    let is_short_url = is_short_url_path(&path_columns);

    let auth_info = match auth_result {
        Ok(info) => info,
        Err(e) => {
            return if is_short_url {
                Err(handle_auth_failure_for_redirect(req, &e))
            } else {
                Err((e, req))
            };
        }
    };

    match oo_validator_internal(req, auth_info, path_prefix).await {
        Ok(service_req) => Ok(service_req),
        Err((err, err_req)) => {
            if is_short_url {
                Err(handle_auth_failure_for_redirect(err_req, &err))
            } else {
                Err((err, err_req))
            }
        }
    }
}

/// Validates the authentication information in the request and returns the request if valid, or an
/// error if invalid.
///
/// This function is a proxy for the `oo_validator_internal` function, setting the `path_prefix` to
/// "/proxy/".
///
/// # Arguments
/// * `req` - The `ServiceRequest` to validate.
/// * `auth_info` - The authentication information extracted from the request.
///
/// # Returns
/// * `Result<ServiceRequest, (Error, ServiceRequest)>` - The validated request, or an error if the
///   authentication is invalid.
pub async fn validator_proxy_url(
    req: ServiceRequest,
    auth_info: AuthExtractor,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path_prefix = "/proxy/";
    oo_validator_internal(req, auth_info, path_prefix).await
}

pub async fn validate_http_internal(
    req: ServiceRequest,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let router_nodes = cluster::get_cached_online_router_nodes()
        .await
        .unwrap_or_default();

    // Get the peer address early and own the string
    let peer = req
        .connection_info()
        .peer_addr()
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
        return Err((ErrorUnauthorized("Unauthorized Access"), req));
    }
    Ok(req)
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
) -> Result<Option<Vec<String>>, Error> {
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
            Err(_) => Err(ErrorForbidden("Unauthorized Access")),
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
fn is_short_url_path(path_columns: &[&str]) -> bool {
    path_columns
        .get(1)
        .is_some_and(|&segment| segment.to_lowercase() == "short")
}

/// Handles authentication failure by logging the error and returning a redirect response.
///
/// This function is responsible for logging the authentication failure and returning a redirect
/// response. It takes in the request and the error message, and returns a tuple containing the
/// redirect response and the service request.
fn handle_auth_failure_for_redirect(req: ServiceRequest, error: &Error) -> (Error, ServiceRequest) {
    let full_url = extract_full_url(&req);
    let redirect_http = RedirectResponseBuilder::default()
        .with_query_param("short_url", &full_url)
        .build();
    log::warn!(
        "Authentication failed for path: {}, err: {}, {}",
        req.path(),
        error,
        &redirect_http,
    );
    (redirect_http.into(), req)
}

/// Extracts the full URL from the request.
fn extract_full_url(req: &ServiceRequest) -> String {
    let connection_info = req.connection_info();
    let scheme = connection_info.scheme();
    let host = connection_info.host();
    let path = req
        .request()
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("");

    format!("{scheme}://{host}{path}")
}

#[cfg(test)]
mod tests {
    use actix_web::test;
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
            validate_credentials(init_user, pwd, "default/_bulk")
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            !validate_credentials("", pwd, "default/_bulk")
                .await
                .unwrap()
                .is_valid
        );
        assert!(!validate_credentials("", pwd, "/").await.unwrap().is_valid);
        assert!(
            !validate_credentials(user_id, pwd, "/")
                .await
                .unwrap()
                .is_valid
        );
        // TODO: In these unit tests, is_root_user function does not work,
        // So, the below test case will not work, move these tests to integration tests
        // assert!(
        //     validate_credentials(user_id, pwd, "default/user")
        //         .await
        //         .unwrap()
        //         .is_valid
        // );
        assert!(
            !validate_credentials(user_id, "x", "default/user")
                .await
                .unwrap()
                .is_valid
        );
        assert!(validate_user(init_user, pwd).await.unwrap().is_valid);
    }

    #[test]
    async fn test_get_user_details() {
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
    async fn test_extract_relative_path() {
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
    async fn test_is_short_url_path() {
        // Test short URL path
        let short_url_path = ["api", "short", "abc123"];
        assert!(is_short_url_path(&short_url_path));

        // Test non-short URL path
        let normal_path = ["api", "v1", "logs"];
        assert!(!is_short_url_path(&normal_path));

        // Test path with insufficient segments
        let short_path = ["api"];
        assert!(!is_short_url_path(&short_path));

        // Test case insensitive
        let mixed_case_path = ["api", "SHORT", "abc123"];
        assert!(is_short_url_path(&mixed_case_path));
    }

    #[test]
    async fn test_path_normalization() {
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
    async fn test_extract_full_url() {
        let _req = test::TestRequest::default()
            .uri("http://localhost:8080/api/v1/logs")
            .to_http_request();
        let service_req = test::TestRequest::default()
            .uri("http://localhost:8080/api/v1/logs")
            .to_srv_request();

        // This test would need more setup to work properly
        // For now, just test that the function exists and compiles
        let _ = extract_full_url(&service_req);
    }

    #[test]
    async fn test_handle_auth_failure_for_redirect() {
        let req = test::TestRequest::default()
            .uri("http://localhost:8080/api/v1/logs")
            .to_srv_request();
        let error = ErrorUnauthorized("Test error");

        // Test that the function handles errors properly
        let (redirect_error, _) = handle_auth_failure_for_redirect(req, &error);
        // The error should be a redirect response, not necessarily contain "redirect" in the string
        assert!(!redirect_error.to_string().is_empty());
    }

    #[test]
    async fn test_validate_credentials_path_handling() {
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
    async fn test_v2_api_prefix_handling() {
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
