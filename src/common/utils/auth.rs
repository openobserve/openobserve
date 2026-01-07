// Copyright 2026 OpenObserve Inc.
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

use std::fmt::Debug;

use axum::{
    Json,
    extract::FromRequestParts,
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use base64::Engine;
use config::{
    meta::user::UserRole,
    utils::{hash::get_passcode_hash, json},
};
use once_cell::sync::Lazy;
use regex::Regex;
#[cfg(feature = "enterprise")]
use {
    crate::{
        common::{
            infra::config::{USER_SESSIONS, USER_SESSIONS_EXPIRY},
            meta::ingestion::INGESTION_EP,
        },
        service::users::get_user,
    },
    jsonwebtoken::TokenData,
    o2_dex::service::auth::get_dex_jwks,
    o2_openfga::config::get_config as get_openfga_config,
    o2_openfga::meta::mapping::OFGA_MODELS,
    serde_json::Value,
    std::{collections::HashMap, str::FromStr},
};

use crate::common::{
    infra::config::{ORG_USERS, PASSWORD_HASH},
    meta::{
        authz::Authz,
        organization::DEFAULT_ORG,
        user::{AuthTokens, UserOrgRole},
    },
};

pub const V2_API_PREFIX: &str = "v2";

pub static RE_OFGA_UNSUPPORTED_NAME: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"[:#?\s'"%&]+"#).unwrap());
static RE_SPACE_AROUND: Lazy<Regex> = Lazy::new(|| {
    let char_pattern = r#"[^a-zA-Z0-9:#?'"&%\s]"#;
    let pattern = format!(r"(\s+{char_pattern}\s+)|(\s+{char_pattern})|({char_pattern}\s+)");
    Regex::new(&pattern).unwrap()
});

pub static EMAIL_REGEX: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r"^([a-zA-Z0-9_+]([a-zA-Z0-9_+\-]*(\.[a-zA-Z0-9_+\-]+)*)?[a-zA-Z0-9_+])@([a-zA-Z0-9]+([\-\.]{1}[a-zA-Z0-9]+)*\.[a-zA-Z]{2,6})",
    )
    .unwrap()
});

pub fn is_valid_email(email: &str) -> bool {
    EMAIL_REGEX.is_match(email)
}

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
            let password_hash = get_passcode_hash(pass, salt);
            PASSWORD_HASH.insert(key, password_hash.clone());
            password_hash
        }
    }
}

pub(crate) fn is_root_user(user_id: &str) -> bool {
    match ORG_USERS.get(&format!("{DEFAULT_ORG}/{user_id}")) {
        Some(user) => user.role.eq(&UserRole::Root),
        None => false,
    }
}

#[cfg(feature = "enterprise")]
pub async fn save_org_tuples(org_id: &str) {
    use o2_openfga::config::get_config as get_openfga_config;

    if get_openfga_config().enabled {
        o2_openfga::authorizer::authz::save_org_tuples(org_id).await
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn save_org_tuples(_org_id: &str) {}

#[cfg(feature = "enterprise")]
pub async fn delete_org_tuples(org_id: &str) {
    use o2_openfga::config::get_config as get_openfga_config;

    if get_openfga_config().enabled {
        o2_openfga::authorizer::authz::delete_org_tuples(org_id).await
    }
}

#[cfg(not(feature = "enterprise"))]
pub async fn delete_org_tuples(_org_id: &str) {}

#[cfg(feature = "enterprise")]
pub fn get_role(role: &UserOrgRole) -> UserRole {
    use std::str::FromStr;

    let role = o2_openfga::authorizer::roles::get_role(format!("{}", role.base_role));
    UserRole::from_str(&role).unwrap()
}

#[cfg(not(feature = "enterprise"))]
pub fn get_role(_role: &UserOrgRole) -> UserRole {
    UserRole::Admin
}

#[cfg(feature = "enterprise")]
pub async fn set_ownership(org_id: &str, obj_type: &str, obj: Authz) {
    if get_openfga_config().enabled {
        use o2_openfga::{authorizer, meta::mapping::OFGA_MODELS};

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
    if get_openfga_config().enabled {
        use o2_openfga::{authorizer, meta::mapping::OFGA_MODELS};
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

/// A deserializer impl for when a value must be lowercased during deserialization
fn deserialize_lowercase<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: String = serde::Deserialize::deserialize(deserializer)?;
    Ok(s.to_lowercase())
}

#[derive(Debug, serde::Deserialize)]
pub struct UserEmail {
    #[serde(deserialize_with = "deserialize_lowercase")]
    pub user_id: String,
}

#[derive(Debug, PartialEq, Eq, Clone)]
pub struct AuthExtractor {
    pub auth: String,
    pub method: String,
    pub o2_type: String,
    pub org_id: String,
    pub bypass_check: bool,
    pub parent_id: String,
}

/// Rejection type for AuthExtractor
pub struct AuthExtractorRejection {
    message: String,
}

impl IntoResponse for AuthExtractorRejection {
    fn into_response(self) -> Response {
        (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({
                "code": 401,
                "message": self.message
            })),
        )
            .into_response()
    }
}

impl<S> FromRequestParts<S> for AuthExtractor
where
    S: Send + Sync,
{
    type Rejection = AuthExtractorRejection;

    #[cfg(feature = "enterprise")]
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        use config::{get_config, meta::stream::StreamType};
        use hashbrown::HashMap;
        use o2_openfga::meta::mapping::OFGA_MODELS;

        use crate::common::utils::http::{get_folder, get_stream_type_from_request};

        let start = std::time::Instant::now();

        // Parse query string
        let query_string = parts.uri.query().unwrap_or("");
        let query: HashMap<String, String> = url::form_urlencoded::parse(query_string.as_bytes())
            .into_owned()
            .collect();

        let stream_type = get_stream_type_from_request(&query);
        let folder = get_folder(&query);

        let mut method = parts.method.to_string();
        let local_path = parts.uri.path().to_string();
        let path = match local_path
            .strip_prefix(format!("{}/api/", config::get_config().common.base_uri).as_str())
        {
            Some(path) => path,
            None => &local_path,
        };

        let path_columns = path.split('/').collect::<Vec<&str>>();
        let url_len = path_columns.len();
        let org_id = if url_len > 1 && path_columns[0].eq(V2_API_PREFIX) {
            path_columns[1].to_string()
        } else {
            path_columns[0].to_string()
        };

        // This is case for ingestion endpoints where we need to check
        // permissions on the stream
        if method.eq("POST") && INGESTION_EP.contains(&path_columns[url_len - 1]) {
            if let Some(auth_header) = parts.headers.get("Authorization")
                && let Ok(auth_str) = auth_header.to_str()
            {
                return Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method,
                    o2_type: format!("stream:{org_id}"),
                    org_id,
                    bypass_check: true,
                    parent_id: folder,
                });
            }
            return Err(AuthExtractorRejection {
                message: "Unauthorized Access".to_string(),
            });
        }

        // get ofga object type from the url
        // depends on the url path count
        let object_type = if url_len == 1 {
            // for organization entity itself, get requires the list
            // permissions, and the object is a special format string
            if path_columns[0].eq("organizations") {
                if method.eq("GET") {
                    method = "LIST".to_string();
                };

                "org:##user_id##".to_string()
            } else if path_columns[0].eq("invites") && method.eq("GET") {
                let auth_str = extract_auth_str_from_parts(parts).await;
                // because the /invites route is checked by user_id,
                // and does not return any other info, we can bypass the auth
                return Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method: "GET".to_string(),
                    o2_type: "".to_string(),
                    org_id: "".to_string(),
                    bypass_check: true, // bypass check permissions
                    parent_id: "".to_string(),
                });
            } else {
                path_columns[0].to_string()
            }
        } else if url_len == 2 || (url_len > 2 && path_columns[1].eq("settings")) {
            if path_columns[1].eq("settings") {
                if method.eq("POST") || method.eq("DELETE") {
                    method = "PUT".to_string();
                }
            } else if method.eq("GET") {
                method = "LIST".to_string();
            }

            if path_columns[0].eq("invites") && method.eq("DELETE") {
                let auth_str = extract_auth_str_from_parts(parts).await;
                return Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method: "DELETE".to_string(),
                    o2_type: "".to_string(),
                    org_id: "".to_string(),
                    bypass_check: true,
                    parent_id: "".to_string(),
                });
            }

            let key = if path_columns[1].eq("invites") {
                "users"
            } else if (path_columns[1].eq("rename") || path_columns[1].eq("extend_trial_period"))
                && method.eq("PUT")
            {
                "organizations"
            } else {
                path_columns[1]
            };

            let entity = match (key, path_columns[1]) {
                ("organizations", "extend_trial_period") => "_all__meta".to_string(),
                ("organizations", "organizations") => {
                    if url_len == 3 && path_columns[2] == "assume_service_account" {
                        format!("_all_{}", path_columns[0])
                    } else {
                        path_columns[0].to_string()
                    }
                }
                ("organizations", _) => format!("_all_{}", path_columns[0]),
                _ => path_columns[0].to_string(),
            };

            format!(
                "{}:{}",
                OFGA_MODELS.get(key).map_or(key, |model| model.key),
                entity
            )
        } else if path_columns[1].eq("groups") || path_columns[1].eq("roles") {
            format!(
                "{}:{org_id}/{}",
                OFGA_MODELS
                    .get(path_columns[1])
                    .map_or(path_columns[1], |model| model.key),
                path_columns[2]
            )
        } else if url_len == 3 {
            // Handle various 3-segment paths (abbreviated for brevity)
            if path_columns[0].eq(V2_API_PREFIX) && path_columns[2].eq("alerts") {
                if method.eq("GET") {
                    method = "LIST".to_string();
                }
                format!(
                    "{}:{}",
                    OFGA_MODELS.get("alert_folders").unwrap().key,
                    folder
                )
            } else if path_columns[2].eq("alerts")
                || path_columns[2].eq("templates")
                || path_columns[2].eq("destinations")
                || path.ends_with("users/roles")
            {
                if method.eq("GET") {
                    method = "LIST".to_string();
                }
                if method.eq("PUT") || method.eq("DELETE") || path_columns[1].eq("search_jobs") {
                    format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(path_columns[1])
                            .map_or(path_columns[1], |model| model.key),
                        path_columns[2]
                    )
                } else {
                    format!(
                        "{}:{}",
                        OFGA_MODELS
                            .get(path_columns[2])
                            .map_or(path_columns[2], |model| model.key),
                        path_columns[0]
                    )
                }
            } else {
                format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(path_columns[1])
                        .map_or(path_columns[1], |model| model.key),
                    path_columns[0]
                )
            }
        } else {
            format!(
                "{}:{}",
                OFGA_MODELS
                    .get(path_columns[1])
                    .map_or(path_columns[1], |model| model.key),
                path_columns.get(2).unwrap_or(&"")
            )
        };

        // Check if the ws request is using internal grpc token
        if method.eq("GET")
            && path.contains("/ws")
            && let Some(auth_header) = parts.headers.get("Authorization")
            && auth_header
                .to_str()
                .unwrap()
                .eq(&get_config().grpc.internal_grpc_token)
        {
            return Ok(AuthExtractor {
                auth: auth_header.to_str().unwrap().to_string(),
                method,
                o2_type: format!("stream:{org_id}"),
                org_id,
                bypass_check: true,
                parent_id: folder,
            });
        }

        let auth_str = extract_auth_str_from_parts(parts).await;

        if !auth_str.is_empty() {
            let path_is_bulk_operation = method.eq("DELETE")
                && (path.contains("/cipher_keys/bulk")
                    || path.contains("/re_patterns/bulk")
                    || path.contains("/alerts/templates/bulk")
                    || path.contains("/alerts/destinations/bulk")
                    || (path.starts_with("v2/") && path.contains("/alerts/bulk"))
                    || path.contains("/dashboards/bulk")
                    || path.contains("/pipelines/bulk")
                    || path.contains("/actions/bulk")
                    || path.contains("/groups/bulk")
                    || path.contains("/roles/bulk")
                    || path.contains("/service_accounts/bulk")
                    || path.contains("/functions/bulk")
                    || path.contains("/users/bulk")
                    || path.contains("/reports/bulk"));

            if (method.eq("POST") && url_len > 1 && path_columns[1].starts_with("_search"))
                || (method.eq("POST")
                    && url_len > 1
                    && path_columns[1].starts_with("result_schema"))
                || (method.eq("POST") && url_len > 1 && path.ends_with("actions/upload"))
                || path.contains("/prometheus/api/v1/query")
                || path.contains("/resources")
                || path.contains("/format_query")
                || path.contains("/prometheus/api/v1/series")
                || path.contains("/traces/latest")
                || path.contains("clusters")
                || path.contains("query_manager")
                || path.contains("/short")
                || path.contains("/ws")
                || path.contains("/_values_stream")
                || path_is_bulk_operation
                || (url_len == 1 && path.contains("license"))
                || path.contains("/service_streams/_analytics")
                || path.contains("/service_streams/_correlate")
            {
                return Ok(AuthExtractor {
                    auth: auth_str.to_owned(),
                    method: "".to_string(),
                    o2_type: "".to_string(),
                    org_id: "".to_string(),
                    bypass_check: true,
                    parent_id: folder,
                });
            }

            return Ok(AuthExtractor {
                auth: auth_str.to_owned(),
                method,
                o2_type: object_type,
                org_id,
                bypass_check: false,
                parent_id: folder,
            });
        }

        log::debug!(
            "AuthExtractor::from_request took {} ms",
            start.elapsed().as_millis()
        );
        Err(AuthExtractorRejection {
            message: "Unauthorized Access".to_string(),
        })
    }

    #[cfg(not(feature = "enterprise"))]
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let auth_str = extract_auth_str_from_parts(parts).await;

        if !auth_str.is_empty() {
            return Ok(AuthExtractor {
                auth: auth_str.to_owned(),
                method: "".to_string(),
                o2_type: "".to_string(),
                org_id: "".to_string(),
                bypass_check: true, // bypass check permissions
                parent_id: "".to_string(),
            });
        }

        Err(AuthExtractorRejection {
            message: "Unauthorized Access".to_string(),
        })
    }
}

/// Extract auth string from request parts (axum version)
#[cfg(feature = "enterprise")]
pub async fn extract_auth_str_from_parts(parts: &Parts) -> String {
    // Check cookies
    let cookies = parts
        .headers
        .get(http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Parse cookies
    let cookie_map: HashMap<&str, &str> = cookies
        .split(';')
        .filter_map(|c| {
            let mut parts = c.trim().splitn(2, '=');
            Some((parts.next()?, parts.next()?))
        })
        .collect();

    if let Some(auth_tokens_cookie) = cookie_map.get("auth_tokens") {
        let val = config::utils::base64::decode_raw(auth_tokens_cookie).unwrap_or_default();
        let auth_tokens: AuthTokens =
            json::from_str(std::str::from_utf8(&val).unwrap_or_default()).unwrap_or_default();
        let access_token = auth_tokens.access_token;
        if access_token.is_empty() {
            // Check auth_ext cookie
            if let Some(auth_ext_cookie) = cookie_map.get("auth_ext") {
                let val = config::utils::base64::decode_raw(auth_ext_cookie).unwrap_or_default();
                return std::str::from_utf8(&val).unwrap_or_default().to_string();
            }
            return String::new();
        } else if access_token.starts_with("Basic") || access_token.starts_with("Bearer") {
            return access_token;
        } else if access_token.starts_with("session") {
            let session_key = access_token.strip_prefix("session ").unwrap().to_string();
            match crate::service::db::session::get(&session_key).await {
                Ok(token) => {
                    if token.starts_with("Basic ") || token.starts_with("Bearer ") {
                        return format!("Session::{}::{}", session_key, token);
                    } else {
                        return format!("Bearer {}", token);
                    }
                }
                Err(e) => {
                    log::error!("Failed to resolve session '{}': {}", session_key, e);
                    return access_token;
                }
            }
        } else {
            return format!("Bearer {access_token}");
        }
    }

    // Check auth_ext cookie
    if let Some(auth_ext_cookie) = cookie_map.get("auth_ext") {
        let val = config::utils::base64::decode_raw(auth_ext_cookie).unwrap_or_default();
        return std::str::from_utf8(&val).unwrap_or_default().to_string();
    }

    // Check Authorization header
    if let Some(auth_header) = parts.headers.get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            // Handle session tokens from Authorization header
            if auth_str.starts_with("session ") {
                let session_key = auth_str.strip_prefix("session ").unwrap().to_string();
                match crate::service::db::session::get(&session_key).await {
                    Ok(token) => {
                        if token.starts_with("Basic ") || token.starts_with("Bearer ") {
                            return format!("Session::{}::{}", session_key, token);
                        } else {
                            return format!("Bearer {}", token);
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to resolve session '{}' from header: {}",
                            session_key,
                            e
                        );
                        return auth_str.to_owned();
                    }
                }
            } else {
                return auth_str.to_owned();
            }
        }
    }

    String::new()
}

/// Extract auth string from a full axum Request
pub async fn extract_auth_str<B>(req: &axum::http::Request<B>) -> String {
    // Extract directly from request instead of creating Parts
    // Check for Authorization header first
    if let Some(auth_header) = req.headers().get(axum::http::header::AUTHORIZATION)
        && let Ok(auth_str) = auth_header.to_str()
    {
        return auth_str.to_string();
    }

    // Check cookies for session token
    #[cfg(feature = "enterprise")]
    {
        if let Some(cookie_header) = req.headers().get(axum::http::header::COOKIE) {
            if let Ok(cookie_str) = cookie_header.to_str() {
                // Parse cookies manually to avoid depending on cookie crate
                for part in cookie_str.split(';') {
                    let part = part.trim();
                    if let Some((name, value)) = part.split_once('=') {
                        if name == "o2_session" {
                            return value.to_string();
                        }
                    }
                }
            }
        }
    }

    // Check query parameters
    if let Some(query) = req.uri().query() {
        let params: std::collections::HashMap<String, String> =
            url::form_urlencoded::parse(query.as_bytes())
                .map(|(k, v)| (k.to_string(), v.to_string()))
                .collect();

        if let Some(auth) = params.get("auth") {
            return auth.clone();
        }
    }

    String::new()
}

#[cfg(not(feature = "enterprise"))]
pub async fn extract_auth_str_from_parts(parts: &Parts) -> String {
    use std::collections::HashMap;

    // Check cookies
    let cookies = parts
        .headers
        .get(http::header::COOKIE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");

    // Parse cookies
    let cookie_map: HashMap<&str, &str> = cookies
        .split(';')
        .filter_map(|c| {
            let mut parts = c.trim().splitn(2, '=');
            Some((parts.next()?, parts.next()?))
        })
        .collect();

    if let Some(auth_tokens_cookie) = cookie_map.get("auth_tokens") {
        let val = config::utils::base64::decode_raw(auth_tokens_cookie).unwrap_or_default();
        let auth_tokens: AuthTokens =
            json::from_str(std::str::from_utf8(&val).unwrap_or_default()).unwrap_or_default();
        let access_token = auth_tokens.access_token;
        if access_token.starts_with("Basic") || access_token.starts_with("Bearer") {
            return access_token;
        } else {
            return format!("Bearer {access_token}");
        }
    }

    // Check Authorization header
    if let Some(auth_header) = parts.headers.get("Authorization")
        && let Ok(auth_str) = auth_header.to_str()
    {
        return auth_str.to_owned();
    }

    String::new()
}

/// Constructs the login URL with the provided parameters.
pub fn generate_presigned_url(
    username: &str,
    password: &str,
    salt: &str,
    base_url: &str,
    exp_in: i64,
    time: i64,
) -> String {
    let stage1 = get_hash(password, salt);
    let stage2 = get_hash(&format!("{}{}", &stage1, time), salt);
    let stage3 = get_hash(&format!("{}{}", &stage2, exp_in), salt);

    let user_pass = format!("{username}:{stage3}");
    let auth = base64::engine::general_purpose::STANDARD.encode(user_pass);

    format!("{base_url}/auth/login?request_time={time}&exp_in={exp_in}&auth={auth}")
}

#[cfg(not(feature = "enterprise"))]
pub async fn check_permissions(
    _object_id: &str,
    _org_id: &str,
    _user_id: &str,
    _object_type: &str,
    _method: &str,
    _parent_id: Option<&str>,
) -> bool {
    false
}

/// Returns false if Auth fails
#[cfg(feature = "enterprise")]
pub async fn check_permissions(
    object_id: &str,
    org_id: &str,
    user_id: &str,
    object_type: &str,
    method: &str,
    parent_id: Option<&str>,
) -> bool {
    if !is_root_user(user_id) {
        let user: config::meta::user::User = match get_user(Some(org_id), user_id).await {
            Some(user) => user.clone(),
            None => return false,
        }
        .clone();

        return crate::handler::http::auth::validator::check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: method.to_string(),
                o2_type: format!(
                    "{}:{}",
                    OFGA_MODELS
                        .get(object_type)
                        .map_or(object_type, |model| model.key),
                    object_id
                ),
                org_id: org_id.to_string(),
                bypass_check: false,
                parent_id: parent_id.unwrap_or("").to_string(),
            },
            user.role,
            user.is_external,
        )
        .await;
    }
    true
}

#[cfg(feature = "enterprise")]
pub async fn extract_auth_expiry_and_user_id(
    parts: &Parts,
) -> (Option<chrono::DateTime<chrono::Utc>>, Option<String>) {
    use crate::handler::http::auth::validator::get_user_email_from_auth_str;

    let decode = async |token: &str| match decode_expiry(token).await {
        Ok(token_data) => token_data
            .claims
            .get("exp")
            .and_then(|exp| exp.as_i64())
            .and_then(|exp_ts| chrono::DateTime::from_timestamp(exp_ts, 0)),
        Err(e) => {
            log::error!("Error verifying token: {e}");
            None
        }
    };

    let auth_str = extract_auth_str_from_parts(parts).await;
    if auth_str.is_empty() {
        return (None, None);
    } else if auth_str.starts_with("Basic") {
        let user_id = get_user_email_from_auth_str(&auth_str).await;
        return (None, user_id);
    } else if auth_str.starts_with("Bearer") {
        let user_id = get_user_email_from_auth_str(&auth_str).await;
        let stripped_bearer_token = auth_str.strip_prefix("Bearer ").unwrap();
        let exp = decode(stripped_bearer_token).await;
        return (exp, user_id);
    } else if auth_str.starts_with("session ") {
        let session_key = auth_str.strip_prefix("session ").unwrap();
        let stripped_bearer_token = match crate::service::db::session::get(session_key).await {
            Ok(bearer_token) => bearer_token,
            Err(e) => {
                log::error!("Error getting session: {e}");
                return (None, None);
            }
        };
        let exp = decode(&stripped_bearer_token).await;
        let bearer_full_token = format!("Bearer {stripped_bearer_token}");
        let user_id = get_user_email_from_auth_str(&bearer_full_token).await;
        return (exp, user_id);
    }
    (None, None)
}

#[cfg(feature = "enterprise")]
async fn decode_expiry(token: &str) -> Result<TokenData<HashMap<String, Value>>, anyhow::Error> {
    use infra::errors::JwtError;
    use jsonwebtoken::{
        Algorithm, DecodingKey, Validation, decode, decode_header,
        jwk::{self, AlgorithmParameters},
    };

    let header = decode_header(token)?;
    let kid = match header.kid {
        Some(k) => k,
        None => return Err(JwtError::MissingAttribute("`kid` header".to_owned()).into()),
    };
    let dex_jwks = get_dex_jwks().await;
    let jwks: jwk::JwkSet = serde_json::from_str(&dex_jwks).unwrap();

    if let Some(j) = jwks.find(&kid) {
        match &j.algorithm {
            AlgorithmParameters::RSA(rsa) => {
                let decoding_key = DecodingKey::from_rsa_components(&rsa.n, &rsa.e).unwrap();

                let mut validation = Validation::new(
                    Algorithm::from_str(j.common.key_algorithm.unwrap().to_string().as_str())
                        .unwrap(),
                );
                validation.validate_exp = true;
                let aud = &o2_dex::config::get_config().client_id;
                validation.set_audience(&[aud]);
                Ok(decode::<HashMap<String, serde_json::Value>>(
                    token,
                    &decoding_key,
                    &validation,
                )?)
            }
            _ => Err(JwtError::ValidationFailed().into()),
        }
    } else {
        Err(JwtError::KeyNotExists().into())
    }
}

impl AuthExtractor {
    /// Extract auth info from a full Request<Body> - synchronous version
    /// This is used in middleware where we have the full request
    pub fn extract_from_request_sync(request: &axum::extract::Request) -> Result<Self, String> {
        // Create a temporary Parts from the request for extraction
        // Note: We can't use from_request_parts directly because we don't own the parts
        // So we replicate the key extraction logic here

        let cfg = config::get_config();
        let query_string = request.uri().query().unwrap_or("");
        let _query: std::collections::HashMap<String, String> =
            url::form_urlencoded::parse(query_string.as_bytes())
                .into_owned()
                .collect();

        let method = request.method().to_string();
        let local_path = request.uri().path().to_string();
        let path = match local_path.strip_prefix(format!("{}/api/", cfg.common.base_uri).as_str()) {
            Some(path) => path,
            None => &local_path,
        };

        let path_columns: Vec<&str> = path.split('/').collect();
        let org_id = if path_columns.len() > 1 && path_columns[0].eq(V2_API_PREFIX) {
            path_columns[1].to_string()
        } else {
            path_columns
                .first()
                .map(|s| s.to_string())
                .unwrap_or_default()
        };

        // Get auth string from headers
        let auth_str = if let Some(auth_header) = request.headers().get("Authorization") {
            auth_header.to_str().unwrap_or("").to_string()
        } else if let Some(cookie_header) = request.headers().get("Cookie") {
            // Parse cookies for auth_tokens
            let cookies_str = cookie_header.to_str().unwrap_or("");
            let cookie_map: std::collections::HashMap<&str, &str> = cookies_str
                .split(';')
                .filter_map(|cookie| {
                    let parts: Vec<&str> = cookie.trim().splitn(2, '=').collect();
                    if parts.len() == 2 {
                        Some((parts[0], parts[1]))
                    } else {
                        None
                    }
                })
                .collect();

            // First check for auth_tokens cookie (base64 encoded JSON)
            if let Some(auth_tokens_cookie) = cookie_map.get("auth_tokens") {
                let val = config::utils::base64::decode_raw(auth_tokens_cookie).unwrap_or_default();
                let auth_tokens: crate::common::meta::user::AuthTokens =
                    config::utils::json::from_str(std::str::from_utf8(&val).unwrap_or_default())
                        .unwrap_or_default();
                if !auth_tokens.access_token.is_empty() {
                    auth_tokens.access_token
                } else if let Some(auth_ext_cookie) = cookie_map.get("auth_ext") {
                    let val = config::utils::base64::decode_raw(auth_ext_cookie).unwrap_or_default();
                    std::str::from_utf8(&val).unwrap_or_default().to_string()
                } else {
                    String::new()
                }
            } else if let Some(access_token) = cookie_map.get("access_token") {
                // Fallback to individual access_token cookie
                format!("Bearer {}", access_token)
            } else {
                String::new()
            }
        } else {
            String::new()
        };

        if auth_str.is_empty() {
            return Err("No authorization header found".to_string());
        }

        // Simplified extraction - the full logic is in FromRequestParts
        // This is mainly for middleware use where we just need the auth string
        Ok(AuthExtractor {
            auth: auth_str,
            method,
            o2_type: String::new(), // Will be populated by validator
            org_id,
            bypass_check: false,
            parent_id: String::new(),
        })
    }

    /// Async wrapper for backward compatibility
    pub async fn extract_from_request(request: &axum::extract::Request) -> Result<Self, String> {
        Self::extract_from_request_sync(request)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_emails() {
        assert!(is_valid_email("user@example.com"));
        assert!(is_valid_email("john.doe+123@mail.co.in"));
        assert!(is_valid_email("a_b-c.d+e@domain.org"));
        assert!(!is_valid_email("no-at-symbol.com"));
        assert!(!is_valid_email("@missing-user.com"));
        assert!(!is_valid_email("user@.com"));
        assert!(!is_valid_email("user@com"));
        assert!(!is_valid_email("user@domain..com"));
    }

    #[test]
    fn test_is_ofga_unsupported() {
        assert!(is_ofga_unsupported("abc:123"));
        assert!(is_ofga_unsupported("name with space"));
        assert!(is_ofga_unsupported("foo&bar"));
        assert!(!is_ofga_unsupported("valid_name"));
        assert!(!is_ofga_unsupported("name_with_underscores"));
    }

    #[test]
    fn test_into_ofga_supported_format() {
        assert_eq!(into_ofga_supported_format("foo:bar"), "foo_bar");
        assert_eq!(into_ofga_supported_format("foo bar"), "foo_bar");
        assert_eq!(into_ofga_supported_format("foo#bar"), "foo_bar");
        assert_eq!(into_ofga_supported_format("foo : bar"), "foo_bar");
        assert_eq!(into_ofga_supported_format(" a  & b "), "_a_b_");
        assert_eq!(into_ofga_supported_format("a   b"), "a_b");
        assert_eq!(into_ofga_supported_format("a:b#c?d e"), "a_b_c_d_e");
        assert_eq!(into_ofga_supported_format("foo & bar % baz"), "foo_bar_baz");
    }

    #[test]
    fn test_generate_presigned_url() {
        let password = "password";
        let salt = "saltsalt";
        let username = "user";
        let base_url = "https://example.com";
        let exp_in = 3600;
        let time = 1634567890;

        let url = generate_presigned_url(username, password, salt, base_url, exp_in, time);
        assert!(url.starts_with(base_url));
        assert!(url.contains("/auth/login"));
        assert!(url.contains(&format!("request_time={time}")));
        assert!(url.contains(&format!("exp_in={exp_in}")));
        assert!(url.contains("auth="));
    }

    #[tokio::test]
    async fn test_is_root_user() {
        assert!(!is_root_user("dummy"));
    }

    #[tokio::test]
    async fn test_get_hash() {
        let hash =
            "$argon2d$v=16$m=2048,t=4,p=2$VGVzdFNhbHQ$CZzrFPtqjY4mIPYwoDztCJ3OGD5M0P37GH4QddwrbZk";
        assert_eq!(get_hash("Pass#123", "TestSalt"), hash);
    }
}
