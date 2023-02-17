// Copyright 2022 Zinc Labs Inc. and Contributors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

use actix_web::{
    dev::ServiceRequest,
    error::{ErrorForbidden, ErrorUnauthorized},
    Error,
};
use actix_web_httpauth::extractors::basic::BasicAuth;

use crate::common::auth::{get_hash, is_root_user};
use crate::meta::user::UserRole;
use crate::service::users;

pub async fn validator(
    req: ServiceRequest,
    credentials: BasicAuth,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = req.request().path().strip_prefix("/api/").unwrap();
    match validate_credentials(
        credentials.user_id(),
        credentials.password().unwrap().trim(),
        path,
    )
    .await
    {
        Ok(res) => {
            if res {
                Ok(req)
            } else {
                Err((ErrorUnauthorized("Unauthorized Access"), req))
            }
        }
        Err(err) => Err((err, req)),
    }
}

pub async fn validate_credentials(
    user_id: &str,
    user_password: &str,
    path: &str,
) -> Result<bool, Error> {
    let user;
    //this is only applicable for super admin user
    if is_root_user(user_id).await {
        user = users::get_user(None, user_id).await;
        if user.is_none() {
            return Ok(false);
        }
    } else {
        user = match path.find('/') {
            Some(index) => {
                let org_id = &path[0..index];
                users::get_user(Some(org_id), user_id).await
            }
            None => users::get_user(None, user_id).await,
        };
    }

    if user.is_none() {
        return Ok(false);
    }
    let user = user.unwrap();

    if user.token.eq(&user_password) {
        return Ok(true);
    }

    let in_pass = get_hash(user_password, &user.salt);
    if !user.password.eq(&in_pass) {
        return Ok(false);
    }
    if !path.contains("/user")
        || (path.contains("/user")
            && (user.role.eq(&UserRole::Admin)
                || user.role.eq(&UserRole::Root)
                || user.email.eq(user_id)))
    {
        Ok(true)
    } else {
        Err(ErrorForbidden("Not allowed"))
    }
}
