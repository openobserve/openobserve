// Copyright 2023 Zinc Labs Inc.
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

use actix_web::{
    dev::ServiceRequest,
    error::{ErrorForbidden, ErrorUnauthorized},
    http::{header, Method},
    web, Error,
};
use actix_web_httpauth::extractors::basic::BasicAuth;

#[cfg(not(feature = "enterprise"))]
use crate::common::meta::user::DBUser;
use crate::{
    common::{
        infra::config::CONFIG,
        meta::{
            ingestion::INGESTION_EP,
            proxy::QueryParamProxyURL,
            user::{TokenValidationResponse, UserRole},
        },
        utils::{
            auth::{get_hash, is_root_user, AuthExtractor},
            base64,
        },
    },
    service::{db, users},
};

pub const PKCE_STATE_ORG: &str = "o2_pkce_state";
pub const ACCESS_TOKEN: &str = "access_token";
pub const REFRESH_TOKEN: &str = "refresh_token";

pub mod token;

pub async fn validator(
    req: ServiceRequest,
    user_id: &str,
    password: &str,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = match req
        .request()
        .path()
        .strip_prefix(format!("{}/api/", CONFIG.common.base_uri).as_str())
    {
        Some(path) => path,
        None => req.request().path(),
    };
    match validate_credentials(user_id, password.trim(), path).await {
        Ok(res) => {
            if res.is_valid {
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
                Ok(req)
            } else {
                Err((ErrorUnauthorized("Unauthorized Access"), req))
            }
        }
        Err(err) => Err((err, req)),
    }
}

/// `validate_token` validates the endpoints which are token only.
/// This includes endpoints like `rum` etc.
///
/// ### Args:
/// - token: The token to validate
///  
pub async fn validate_token(token: &str, org_id: &str) -> Result<bool, Error> {
    match users::get_user_by_token(org_id, token).await {
        Some(_user) => Ok(true),
        None => Err(ErrorForbidden("Not allowed")),
    }
}

pub async fn validate_credentials(
    user_id: &str,
    user_password: &str,
    path: &str,
) -> Result<TokenValidationResponse, Error> {
    let user;
    let mut path_columns = path.split('/').collect::<Vec<&str>>();
    if let Some(v) = path_columns.last() {
        if v.is_empty() {
            path_columns.pop();
        }
    }

    // this is only applicable for super admin user
    if is_root_user(user_id) {
        user = users::get_user(None, user_id).await;
        if user.is_none() {
            return Ok(TokenValidationResponse {
                is_valid: false,
                user_email: "".to_string(),
            });
        }
    } else if path_columns.last().unwrap_or(&"").eq(&"organizations") {
        let db_user = db::user::get_db_user(user_id).await;
        user = match db_user {
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
        user = match path.find('/') {
            Some(index) => {
                let org_id = &path[0..index];
                users::get_user(Some(org_id), user_id).await
            }
            None => users::get_user(None, user_id).await,
        }
    };

    if user.is_none() {
        return Ok(TokenValidationResponse {
            is_valid: false,
            user_email: "".to_string(),
        });
    }
    let user = user.unwrap();

    if (path_columns.len() == 1 || INGESTION_EP.iter().any(|s| path_columns.contains(s)))
        && user.token.eq(&user_password)
    {
        return Ok(TokenValidationResponse {
            is_valid: true,
            user_email: user.email,
        });
    }

    let in_pass = get_hash(user_password, &user.salt);
    if !user.password.eq(&in_pass) {
        return Ok(TokenValidationResponse {
            is_valid: false,
            user_email: "".to_string(),
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
        })
    } else {
        Err(ErrorForbidden("Not allowed"))
    }
}

#[cfg(not(feature = "enterprise"))]
async fn validate_user_from_db(
    db_user: Result<DBUser, anyhow::Error>,
    user_password: &str,
) -> Result<TokenValidationResponse, Error> {
    // let db_user = db::user::get_db_user(user_id).await;
    match db_user {
        Ok(user) => {
            let in_pass = get_hash(user_password, &user.salt);
            if user.password.eq(&in_pass) {
                Ok(TokenValidationResponse {
                    is_valid: true,
                    user_email: user.email,
                })
            } else {
                Err(ErrorForbidden("Not allowed"))
            }
        }
        Err(_) => Err(ErrorForbidden("Not allowed")),
    }
}

#[cfg(feature = "enterprise")]
pub async fn validate_user(
    _user_id: &str,
    _user_password: &str,
) -> Result<TokenValidationResponse, Error> {
    use actix_web::error::ErrorNotFound;

    Err(ErrorNotFound("Not supported in enterprise version"))
}

#[cfg(not(feature = "enterprise"))]
pub async fn validate_user(
    user_id: &str,
    user_password: &str,
) -> Result<TokenValidationResponse, Error> {
    let db_user = db::user::get_db_user(user_id).await;
    validate_user_from_db(db_user, user_password).await
}

pub async fn validator_aws(
    req: ServiceRequest,
    _credentials: Option<BasicAuth>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/aws/", CONFIG.common.base_uri).as_str())
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
    _credentials: Option<BasicAuth>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/gcp/", CONFIG.common.base_uri).as_str())
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

pub async fn validator_proxy_url(
    req: ServiceRequest,
    query: web::Query<QueryParamProxyURL>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let creds = base64::decode(&query.proxy_token).expect("Invalid base-encoded token");
    let creds = creds
        .split(':')
        .map(|s| s.to_string())
        .collect::<Vec<String>>();
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/proxy/", CONFIG.common.base_uri).as_str())
        .unwrap_or(req.request().path());

    match validate_credentials(&creds[0], &creds[1], path).await {
        Ok(res) => {
            if res.is_valid {
                Ok(req)
            } else {
                Err((ErrorUnauthorized("Unauthorized Access"), req))
            }
        }
        Err(err) => Err((err, req)),
    }
}

pub async fn validator_rum(
    req: ServiceRequest,
    _credentials: Option<BasicAuth>,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = req
        .request()
        .path()
        .strip_prefix(format!("{}/rum/v1/", CONFIG.common.base_uri).as_str())
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
            Ok(res) => {
                if res {
                    Ok(req)
                } else {
                    Err((ErrorUnauthorized("Unauthorized Access"), req))
                }
            }
            Err(err) => Err((err, req)),
        },
        None => Err((ErrorUnauthorized("Unauthorized Access"), req)),
    }
}

pub async fn oo_validator(
    req: ServiceRequest,
    auth_header: AuthExtractor,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    if auth_header.auth.starts_with("Basic") {
        let decoded = base64::decode(auth_header.auth.strip_prefix("Basic").unwrap().trim())
            .expect("Failed to decode base64 string");
        let credentials = String::from_utf8(decoded.into())
            .map_err(|_| ())
            .expect("Failed to decode base64 string");
        let parts: Vec<&str> = credentials.split(':').collect();
        if parts.len() != 2 {
            return Err((ErrorUnauthorized("Unauthorized Access"), req));
        }
        let (username, password) = (parts[0], parts[1]);
        let username = username.to_owned();
        let password = password.to_owned();
        validator(req, &username, &password).await
    } else if auth_header.auth.starts_with("Bearer") {
        token::token_validator(req, &auth_header.auth).await
    } else {
        Err((ErrorUnauthorized("Unauthorized Access"), req))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::common::{infra::db as infra_db, meta::user::UserRequest};

    #[actix_web::test]
    async fn test_validate() {
        infra_db::create_table().await.unwrap();
        let _ = users::post_user(
            "default",
            UserRequest {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: crate::common::meta::user::UserRole::Root,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
            },
        )
        .await;
        let _ = users::post_user(
            "default",
            UserRequest {
                email: "user1@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: crate::common::meta::user::UserRole::Member,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
            },
        )
        .await;

        let pwd = "Complexpass#123";
        assert!(
            validate_credentials("root@example.com", pwd, "default/_bulk")
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
            !validate_credentials("user1@example.com", pwd, "/")
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            validate_credentials("user1@example.com", pwd, "default/user")
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            !validate_credentials("user1@example.com", "x", "default/user")
                .await
                .unwrap()
                .is_valid
        );
        assert!(
            validate_user("root@example.com", pwd)
                .await
                .unwrap()
                .is_valid
        );
    }
}
