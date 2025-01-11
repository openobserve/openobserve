// Copyright 2024 OpenObserve Inc.
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
    Error,
};
use actix_web_httpauth::extractors::basic::BasicAuth;
use config::get_config;
use vrl::path::ValuePath;

pub async fn validator(
    req: ServiceRequest,
    credentials: BasicAuth,
) -> Result<ServiceRequest, (actix_web::Error, ServiceRequest)> {
    eprintln!("{credentials:?}");

    let cfg = get_config();

    if !credentials.user_id().eq(&cfg.auth.script_server_token) {
        return Err((actix_web::error::ErrorBadRequest("auth incorrect"), req));
    }

    if let Some(pass) = credentials.password() {
        if !pass.eq(&cfg.auth.script_server_token) {
            return Err((actix_web::error::ErrorBadRequest("auth incorrect"), req));
        }
    } else {
        return Err((actix_web::error::ErrorBadRequest("user ID contains x"), req));
    }

    Ok(req)
}
// pub async fn old_validator(
//     req: ServiceRequest,
//     _body: Next<impl MessageBody>,
// ) -> Result<ServiceRequest, (Error, ServiceRequest)> {
//     let cfg = get_config();
//     let auth = req.headers().get("Authorization");
//     let auth = match auth {
//         Some(auth) => auth,
//         None => return Err((ErrorUnauthorized("Unauthorized"), req)),
//     };
//     if auth.eq(&cfg.auth.script_server_token) {
//         Ok(req)
//     } else {
//         Err((ErrorForbidden("Unauthorized"), req))
//     }
// }
