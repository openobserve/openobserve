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

use argon2::{password_hash::SaltString, Algorithm, Argon2, Params, PasswordHasher, Version};

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
        let _ = users::post_user(
            DEFAULT_ORG,
            UserRequest {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: crate::common::meta::user::UserRole::Root,
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_ldap: false,
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
