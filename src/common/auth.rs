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

use argon2::{password_hash::SaltString, Algorithm, Argon2, Params, PasswordHasher, Version};

use crate::{
    infra::config::{PASSWORD_HASH, USERS},
    meta::user::UserRole,
};

pub fn get_hash(pass: &str, salt: &str) -> String {
    let key = format!("{}{}", pass, salt);
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
            let salt_string = SaltString::b64_encode(salt.as_bytes()).unwrap();
            let password_hash = ctx
                .hash_password(password, &salt_string)
                .unwrap()
                .to_string();
            PASSWORD_HASH.insert(key, password_hash.clone());
            password_hash
        }
    }
}

pub async fn is_root_user(user_id: &str) -> bool {
    match USERS.get(user_id) {
        Some(user) => user.role.eq(&UserRole::Root),
        None => false,
    }
}

#[cfg(test)]
mod test_utils {
    use super::*;
    #[actix_web::test]
    async fn test_is_root_user() {
        let res = is_root_user("dummy").await;
        assert_eq!(res, false)
    }

    #[actix_web::test]
    async fn test_get_hash() {
        let hash =
            "$argon2d$v=16$m=2048,t=4,p=2$VGVzdFNhbHQ$CZzrFPtqjY4mIPYwoDztCJ3OGD5M0P37GH4QddwrbZk";
        let res = get_hash("Pass#123", "TestSalt");
        assert_eq!(res, hash);
    }
}
