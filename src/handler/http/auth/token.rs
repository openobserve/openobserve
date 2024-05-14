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

use actix_web::{dev::ServiceRequest, Error};
#[cfg(feature = "enterprise")]
use actix_web::{
    error::ErrorUnauthorized,
    http::{header, Method},
};
#[cfg(feature = "enterprise")]
use config::CONFIG;
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{common::infra::config::O2_CONFIG, dex::service::auth::get_jwks};

use crate::common::utils::auth::AuthExtractor;
#[cfg(feature = "enterprise")]
use crate::common::utils::jwt;
#[cfg(feature = "enterprise")]
use crate::service::{db, users};

#[cfg(feature = "enterprise")]
pub async fn token_validator(
    req: ServiceRequest,
    auth_info: AuthExtractor,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    use actix_web::error::ErrorForbidden;

    use super::validator::check_permissions;

    let user;
    let keys = get_jwks().await;
    let path = match req
        .request()
        .path()
        .strip_prefix(format!("{}/api/", CONFIG.common.base_uri).as_str())
    {
        Some(path) => path,
        None => req.request().path(),
    };
    let path_columns = path.split('/').collect::<Vec<&str>>();

    match jwt::verify_decode_token(
        auth_info.auth.strip_prefix("Bearer").unwrap().trim(),
        &keys,
        &O2_CONFIG.dex.client_id,
        false,
    )
    .await
    {
        Ok(res) => {
            let user_id = &res.0.user_email;
            if res.0.is_valid {
                let path_suffix = path_columns.last().unwrap_or(&"");
                if path_suffix.eq(&"organizations") || path_suffix.eq(&"clusters") {
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
                if user.is_some() {
                    // / Hack for prometheus, need support POST and check the header
                    let mut req = req;

                    if req.method().eq(&Method::POST) && !req.headers().contains_key("content-type")
                    {
                        req.headers_mut().insert(
                            header::CONTENT_TYPE,
                            header::HeaderValue::from_static("application/x-www-form-urlencoded"),
                        );
                    }
                    req.headers_mut().insert(
                        header::HeaderName::from_static("user_id"),
                        header::HeaderValue::from_str(&res.0.user_email).unwrap(),
                    );
                    // send user role as None as it applies only to internal users
                    if auth_info.bypass_check || check_permissions(user_id, auth_info, None).await {
                        Ok(req)
                    } else {
                        Err((ErrorForbidden("Unauthorized Access"), req))
                    }
                } else {
                    Err((ErrorForbidden("Unauthorized Access"), req))
                }
            } else {
                Err((ErrorForbidden("Unauthorized Access"), req))
            }
        }
        Err(err) => Err((ErrorUnauthorized(err), req)),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn token_validator(
    req: ServiceRequest,
    _token: AuthExtractor,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    use actix_web::error::ErrorForbidden;

    Err((ErrorForbidden("Not Supported"), req))
}
