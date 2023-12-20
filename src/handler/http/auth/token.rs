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

use actix_web::{dev::ServiceRequest, error::ErrorForbidden, Error};
#[cfg(feature = "enterprise")]
use actix_web::{
    error::ErrorUnauthorized,
    http::{header, Method},
};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::{common::infra::config::O2_CONFIG, dex::service::auth::get_jwks};

#[cfg(feature = "enterprise")]
use crate::common::utils::jwt;

#[cfg(feature = "enterprise")]
pub async fn token_validator(
    req: ServiceRequest,
    token: &str,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let keys = get_jwks().await;
    match jwt::verify_decode_token(
        token.strip_prefix("Bearer").unwrap().trim(),
        &keys,
        &O2_CONFIG.dex.client_id,
        false,
    )
    .await
    {
        Ok(res) => {
            if res.0.is_valid {
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
                    header::HeaderValue::from_str(&res.0.user_email).unwrap(),
                );
                Ok(req)
            } else {
                Err((ErrorUnauthorized("Unauthorized Access"), req))
            }
        }
        Err(err) => Err((ErrorForbidden(err), req)),
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn token_validator(
    req: ServiceRequest,
    _token: &str,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    Err((ErrorForbidden("Not Supported"), req))
}
