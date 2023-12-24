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

use actix_web::{dev::Payload, Error, FromRequest, HttpRequest};
use argon2::{password_hash::SaltString, Algorithm, Argon2, Params, PasswordHasher, Version};
use futures::future::{ready, Ready};

use crate::common::{
    infra::config::{PASSWORD_HASH, USERS},
    meta::{organization::DEFAULT_ORG, user::UserRole},
};

pub(crate) fn get_hash(pass: &str, salt: &str) -> String {
    let key = format!("{pass}{salt}");
    let hash = PASSWORD_HASH.get(&key);
    match hash {
        Some(ret_hash) => ret_hash.value().to_string(),
        None => {
            let t_cost = 4;
            let m_cost = 2048;
            let p_cost = 2;
            let params = Params::new(m_cost, t_cost, p_cost, None).unwrap();
            let ctx = Argon2::new(Algorithm::Argon2d, Version::V0x10, params);
            let password = pass.as_bytes();
            let salt_string = SaltString::encode_b64(salt.as_bytes()).unwrap();
            let password_hash = ctx
                .hash_password(password, &salt_string)
                .unwrap()
                .to_string();
            PASSWORD_HASH.insert(key, password_hash.clone());
            password_hash
        }
    }
}

pub(crate) fn is_root_user(user_id: &str) -> bool {
    match USERS.get(&format!("{DEFAULT_ORG}/{user_id}")) {
        Some(user) => user.role.eq(&UserRole::Root),
        None => false,
    }
}

pub struct UserEmail {
    pub user_id: String,
}

impl FromRequest for UserEmail {
    type Error = Error;
    type Future = Ready<Result<Self, Error>>;

    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        if let Some(auth_header) = req.headers().get("user_id") {
            if let Ok(user_str) = auth_header.to_str() {
                return ready(Ok(UserEmail {
                    user_id: user_str.to_owned(),
                }));
            }
        }
        ready(Err(actix_web::error::ErrorUnauthorized("No user found")))
    }
}

pub struct AuthExtractor {
    pub auth: String,
}

impl FromRequest for AuthExtractor {
    type Error = Error;
    type Future = Ready<Result<Self, Error>>;

    fn from_request(req: &HttpRequest, _: &mut Payload) -> Self::Future {
        if let Some(auth_header) = req.headers().get("Authorization") {
            if let Ok(auth_str) = auth_header.to_str() {
                return ready(Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                }));
            }
        } else if let Some(cookie) = req.cookie("access_token") {
            let access_token = cookie.value().to_string();
            return ready(Ok(AuthExtractor {
                auth: format!("Bearer {}", access_token),
            }));
        }
        ready(Err(actix_web::error::ErrorUnauthorized(
            "Unauthorized Access",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        common::{infra::db as infra_db, meta::user::UserRequest},
        service::users,
    };

    #[actix_web::test]
    async fn test_is_root_user() {
        assert!(!is_root_user("dummy"));
    }

    #[actix_web::test]
    async fn test_is_root_user2() {
        infra_db::create_table().await.unwrap();
        let _ = users::create_root_user(
            DEFAULT_ORG,
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
        assert!(is_root_user("root@example.com"));
        assert!(!is_root_user("root2@example.com"));
    }

    #[actix_web::test]
    async fn test_get_hash() {
        let hash =
            "$argon2d$v=16$m=2048,t=4,p=2$VGVzdFNhbHQ$CZzrFPtqjY4mIPYwoDztCJ3OGD5M0P37GH4QddwrbZk";
        assert_eq!(get_hash("Pass#123", "TestSalt"), hash);
    }
}
