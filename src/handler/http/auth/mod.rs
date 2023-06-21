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
    http::header,
    http::Method,
    web, Error,
};
use actix_web_httpauth::extractors::basic::BasicAuth;

use crate::common::{
    self,
    auth::{get_hash, is_root_user},
};
use crate::infra::config::CONFIG;
use crate::meta::ingestion::INGESTION_EP;
use crate::meta::user::UserRole;
use crate::service::{db, users};

pub async fn validator(
    req: ServiceRequest,
    credentials: BasicAuth,
) -> Result<ServiceRequest, (Error, ServiceRequest)> {
    let path = match req
        .request()
        .path()
        .strip_prefix(format!("{}/api/", CONFIG.common.base_uri).as_str())
    {
        Some(path) => path,
        None => req.request().path(),
    };
    match validate_credentials(
        credentials.user_id(),
        credentials.password().unwrap_or_default().trim(),
        path,
    )
    .await
    {
        Ok(res) => {
            if res {
                // / Hack for prometheus, need support POST and check the header
                let mut req = req;
                if req.method().eq(&Method::POST) && !req.headers().contains_key("content-type") {
                    req.headers_mut().insert(
                        header::CONTENT_TYPE,
                        header::HeaderValue::from_static("application/x-www-form-urlencoded"),
                    );
                }
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
            return Ok(false);
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
        return Ok(false);
    }
    let user = user.unwrap();

    if (path_columns.len() == 1 || INGESTION_EP.iter().any(|s| path_columns.contains(s)))
        && user.token.eq(&user_password)
    {
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

pub async fn validate_user(user_id: &str, user_password: &str) -> Result<bool, Error> {
    let db_user = db::user::get_db_user(user_id).await;
    match db_user {
        Ok(user) => {
            let in_pass = get_hash(user_password, &user.salt);
            if user.password.eq(&in_pass) {
                Ok(true)
            } else {
                Err(ErrorForbidden("Not allowed"))
            }
        }
        Err(_) => Err(ErrorForbidden("Not allowed")),
    }
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
                let amz_creds = common::base64::decode(val).unwrap();
                let creds = amz_creds
                    .split(':')
                    .map(|s| s.to_string())
                    .collect::<Vec<String>>();

                match validate_credentials(&creds[0], &creds[1], path).await {
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
    match query.get("API_Key") {
        Some(val) => {
            let gcp_creds = common::base64::decode(val).unwrap();
            let creds = gcp_creds
                .split(':')
                .map(|s| s.to_string())
                .collect::<Vec<String>>();

            match validate_credentials(&creds[0], &creds[1], path).await {
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
        None => Err((ErrorUnauthorized("Unauthorized Access"), req)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::meta::user::UserRequest;

    #[actix_web::test]
    async fn test_validate() {
        let _ = users::post_user(
            "default",
            UserRequest {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: crate::meta::user::UserRole::Root,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
            },
        )
        .await;
        let _ = users::post_user(
            "default",
            UserRequest {
                email: "user@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: crate::meta::user::UserRole::Member,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
            },
        )
        .await;

        let pwd = "Complexpass#123";
        assert!(
            validate_credentials("root@example.com", pwd, "default/_bulk")
                .await
                .unwrap()
        );
        assert!(!validate_credentials("", pwd, "default/_bulk")
            .await
            .unwrap());
        assert!(!validate_credentials("", pwd, "/").await.unwrap());
        assert!(!validate_credentials("user@example.com", pwd, "/")
            .await
            .unwrap());
        assert!(
            validate_credentials("user@example.com", pwd, "default/user")
                .await
                .unwrap()
        );
        assert!(
            !validate_credentials("user@example.com", "x", "default/user")
                .await
                .unwrap()
        );
        assert!(validate_user("root@example.com", pwd).await.unwrap());
    }
}
