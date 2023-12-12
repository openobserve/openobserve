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
    Error,
};
use actix_web_httpauth::extractors::bearer::BearerAuth;

use crate::common::utils::jwt;

pub async fn token_validator(
    req: ServiceRequest,
    token: BearerAuth,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    match jwt::verify_token(token.token()).await {
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
        Err(err) => Err((ErrorForbidden(err), req)),
    }
}
