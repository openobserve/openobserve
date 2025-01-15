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

mod extractor;

use actix_web::{dev::Payload, Error, FromRequest, HttpRequest};
use argon2::{password_hash::SaltString, Algorithm, Argon2, Params, PasswordHasher, Version};
use base64::Engine;
pub use extractor::{extract_auth_str, AuthExtractor};
use futures::future::{ready, Ready};
#[cfg(feature = "enterprise")]
use o2_enterprise::enterprise::common::infra::config::get_config as get_o2_config;
use once_cell::sync::Lazy;
use regex::Regex;

use crate::common::{
    infra::config::{PASSWORD_HASH, USERS},
    meta::{authz::Authz, organization::DEFAULT_ORG, user::UserRole},
};

pub static RE_OFGA_UNSUPPORTED_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"[:#?\s'"%&]+"#).unwrap());
static RE_SPACE_AROUND: Lazy<Regex> = Lazy::new(|| {
    let char_pattern = r#"[^a-zA-Z0-9:#?'"&%\s]"#;
    let pattern = format!(r"(\s+{char_pattern}\s+)|(\s+{char_pattern})|({char_pattern}\s+)");
    Regex::new(&pattern).unwrap()
});

pub fn into_ofga_supported_format(name: &str) -> String {
    // remove spaces around special characters
    let result = RE_SPACE_AROUND.replace_all(name, |caps: &regex::Captures| {
        caps.iter()
            .find_map(|m| m)
            .map(|m| m.as_str().trim())
            .unwrap_or("")
            .to_string()
    });
    RE_OFGA_UNSUPPORTED_NAME
        .replace_all(&result, "_")
        .to_string()
}

pub fn is_ofga_unsupported(name: &str) -> bool {
    RE_OFGA_UNSUPPORTED_NAME.is_match(name)
}

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

#[cfg(feature = "enterprise")]
pub fn get_role(role: UserRole) -> UserRole {
    use std::str::FromStr;

    let role = o2_enterprise::enterprise::openfga::authorizer::roles::get_role(format!("{role}"));
    UserRole::from_str(&role).unwrap()
}

#[cfg(not(feature = "enterprise"))]
pub fn get_role(_role: UserRole) -> UserRole {
    UserRole::Admin
}

#[cfg(feature = "enterprise")]
pub async fn set_ownership(org_id: &str, obj_type: &str, obj: Authz) {
    if get_o2_config().openfga.enabled {
        use o2_enterprise::enterprise::openfga::{authorizer, meta::mapping::OFGA_MODELS};

        let obj_str = format!("{}:{}", OFGA_MODELS.get(obj_type).unwrap().key, obj.obj_id);

        let parent_type = if obj.parent_type.is_empty() {
            ""
        } else {
            OFGA_MODELS.get(obj.parent_type.as_str()).unwrap().key
        };

        // Default folder is already created in case of new org, this handles the case for old org
        if obj_type.eq("folders")
            && authorizer::authz::check_folder_exists(org_id, &obj.obj_id).await
        {
            // If the folder tuples are missing, it automatically creates them
            // So we can return here
            log::debug!(
                "folder tuples already exists for org: {org_id}; folder: {}",
                &obj.obj_id
            );
            return;
        } else if obj.parent_type.eq("folders") {
            log::debug!("checking parent folder tuples for folder: {}", &obj.parent);
            // In case of dashboard, we need to check if the tuples for its folder exist
            // If not, the below function creates the proper tuples for the folder
            authorizer::authz::check_folder_exists(org_id, &obj.parent).await;
        }
        authorizer::authz::set_ownership(org_id, &obj_str, &obj.parent, parent_type).await;
    }
}
#[cfg(not(feature = "enterprise"))]
pub async fn set_ownership(_org_id: &str, _obj_type: &str, _obj: Authz) {}

#[cfg(feature = "enterprise")]
pub async fn remove_ownership(org_id: &str, obj_type: &str, obj: Authz) {
    if get_o2_config().openfga.enabled {
        use o2_enterprise::enterprise::openfga::{authorizer, meta::mapping::OFGA_MODELS};
        let obj_str = format!("{}:{}", OFGA_MODELS.get(obj_type).unwrap().key, obj.obj_id);

        let parent_type = if obj.parent_type.is_empty() {
            ""
        } else {
            OFGA_MODELS.get(obj.parent_type.as_str()).unwrap().key
        };

        authorizer::authz::remove_ownership(org_id, &obj_str, &obj.parent, parent_type).await;
    }
}
#[cfg(not(feature = "enterprise"))]
pub async fn remove_ownership(_org_id: &str, _obj_type: &str, _obj: Authz) {}

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

/// Constructs the login URL with the provided parameters.
///
/// # Arguments
///
/// * `base_url` - The base URL of the authentication service.
/// * `time` - The request time.
/// * `exp_in` - The expiration time.
/// * `auth` - The authentication token.
///
/// # Returns
///
/// The constructed login URL.
pub fn generate_presigned_url(
    username: &str,
    password: &str,
    salt: &str,
    base_url: &str,
    exp_in: i64,
    time: i64,
) -> String {
    // let time = chrono::Utc::now().timestamp();
    let stage1 = get_hash(password, salt);
    let stage2 = get_hash(&format!("{}{}", &stage1, time), salt);
    let stage3 = get_hash(&format!("{}{}", &stage2, exp_in), salt);

    let user_pass = format!("{}:{}", username, stage3);
    let auth = base64::engine::general_purpose::STANDARD.encode(user_pass);

    format!(
        "{}/auth/login?request_time={}&exp_in={}&auth={}",
        base_url, time, exp_in, auth
    )
}

#[cfg(test)]
mod tests {
    use infra::db as infra_db;

    use super::*;
    use crate::{common::meta::user::UserRequest, service::users};

    #[test]
    fn test_generate_presigned_url() {
        let password = "password";
        let salt = "saltsalt";
        let username = "user";
        let base_url = "https://example.com";
        let exp_in = 3600;
        let time = 1634567890;

        let expected_url = format!(
            "{}/auth/login?request_time={}&exp_in={}&auth={}",
            base_url,
            time,
            exp_in,
            "dXNlcjokYXJnb24yZCR2PTE2JG09MjA0OCx0PTQscD0yJGMyRnNkSE5oYkhRJGNwTElHZzdEaFl1Vi9nSWxMaCtRZksrS29Vd2ZFaGVpdHkwc3Z0c243Y1E="
        );

        let generated_url =
            generate_presigned_url(username, password, salt, base_url, exp_in, time);

        assert_eq!(generated_url, expected_url);
    }

    #[tokio::test]
    async fn test_is_root_user() {
        assert!(!is_root_user("dummy"));
    }

    #[tokio::test]
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

    #[tokio::test]
    async fn test_get_hash() {
        let hash =
            "$argon2d$v=16$m=2048,t=4,p=2$VGVzdFNhbHQ$CZzrFPtqjY4mIPYwoDztCJ3OGD5M0P37GH4QddwrbZk";
        assert_eq!(get_hash("Pass#123", "TestSalt"), hash);
    }

    #[tokio::test]
    async fn test_get_hash_for_pass() {
        let pass1 = get_hash("Pass#123", "openobserve");
        let time = chrono::Utc::now().timestamp();
        let pass2 = get_hash(&format!("{}{}", &pass1, time), "openobserve");
        let exp_in = 600;
        let pass3 = get_hash(&format!("{}{}", &pass2, exp_in), "openobserve");
        println!("time: {}", time);
        println!("pass3: {}", pass3);

        let user_pass = format!("{}:{}", "b@b.com", pass3);
        let auth = base64::engine::general_purpose::STANDARD.encode(user_pass);
        println!(
            "http://localhost:5080/auth/login?request_time={}&exp_in={}&auth={}",
            time, exp_in, auth
        );
    }
}
