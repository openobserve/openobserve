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

use std::{collections::HashMap, fmt::Debug, sync::LazyLock as Lazy};

use axum::{
    Json,
    extract::FromRequestParts,
    http::{HeaderMap, StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use base64::Engine;
use config::{
    meta::user::UserRole,
    utils::{hash::get_passcode_hash, json},
};
use regex::Regex;
#[cfg(feature = "enterprise")]
use {
    crate::{common::meta::ingestion::INGESTION_EP, service::users::get_user},
    jsonwebtoken::TokenData,
    o2_dex::service::auth::get_dex_jwks,
    o2_openfga::config::get_config as get_openfga_config,
    o2_openfga::meta::mapping::OFGA_MODELS,
    serde_json::Value,
    std::str::FromStr,
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

/// Resolves the effective permission method for write requests (PUT/DELETE/PATCH).
///
/// Certain endpoints use HTTP methods that don't map 1:1 to their required
/// permission level. This function handles those overrides:
/// - `delete_fields` endpoints: PATCH/PUT → DELETE (needs delete permission)
/// - General PATCH normalization: PATCH → PUT (treat as update)
#[cfg(any(feature = "enterprise", test))]
#[allow(dead_code)]
pub(crate) fn resolve_write_method(method: &str, path_columns: &[&str]) -> String {
    let url_len = path_columns.len();
    let mut resolved = method.to_string();

    if url_len > 0 && path_columns[url_len - 1] == "delete_fields" {
        resolved = "DELETE".to_string();
    }

    if resolved == "PATCH" {
        resolved = "PUT".to_string();
    }

    resolved
}

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

fn deserialize_trimmed<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let s: String = serde::Deserialize::deserialize(deserializer)?;
    Ok(s.trim().to_string())
}

#[derive(Debug, serde::Deserialize)]
pub struct UserEmail {
    #[serde(deserialize_with = "deserialize_trimmed")]
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
    pub use_all_org: bool,
    pub use_self_context: bool,
    pub use_self_parent: bool,
}

impl AuthExtractor {
    /// Create an AuthExtractor that bypasses the FGA check.
    /// Used for routes where auth is handler-managed or not needed.
    pub fn bypass(auth: String, parent_id: String) -> Self {
        Self {
            auth,
            method: String::new(),
            o2_type: String::new(),
            org_id: String::new(),
            bypass_check: true,
            parent_id,
            use_all_org: false,
            use_self_context: false,
            use_self_parent: false,
        }
    }
}

/// Rejection type for AuthExtractor
pub struct AuthExtractorRejection {
    message: String,
    status_code: StatusCode,
}

impl AuthExtractorRejection {
    fn unauthorized(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            status_code: StatusCode::UNAUTHORIZED,
        }
    }
}

impl IntoResponse for AuthExtractorRejection {
    fn into_response(self) -> Response {
        (
            self.status_code,
            Json(serde_json::json!({
                "code": self.status_code.as_u16(),
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
        use config::meta::stream::StreamType;
        use hashbrown::HashMap;
        use o2_openfga::meta::route_permissions::{self as rp, StreamType as RpStreamType};

        use crate::common::utils::http::{get_folder, get_stream_type_from_request};

        let start = std::time::Instant::now();
        let cfg = config::get_config();

        // Parse query string
        let query_string = parts.uri.query().unwrap_or("");
        let query: HashMap<String, String> = url::form_urlencoded::parse(query_string.as_bytes())
            .into_owned()
            .collect();

        let stream_type = get_stream_type_from_request(&query);
        let folder = get_folder(&query);

        let method = parts.method.to_string();
        let local_path = parts.uri.path().to_string();
        let path = match local_path.strip_prefix(format!("{}/api/", cfg.common.base_uri).as_str()) {
            Some(path) => path,
            None => local_path.strip_prefix("/").unwrap_or(&local_path),
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
                    use_all_org: false,
                    use_self_context: false,
                    use_self_parent: false,
                });
            }
            return Err(AuthExtractorRejection::unauthorized("Unauthorized Access"));
        }

        // Resolve permission via the declarative route table.
        // Falls back to the legacy if-else for routes not yet in the table.
        let resolved = match rp::resolve_permission(
            &path_columns,
            &method,
            &org_id,
            &folder,
            stream_type.map(|st| match st {
                StreamType::Logs => RpStreamType::Logs,
                StreamType::Metrics => RpStreamType::Metrics,
                StreamType::Traces => RpStreamType::Traces,
                StreamType::EnrichmentTables => RpStreamType::EnrichmentTables,
                _ => RpStreamType::Logs,
            }),
        ) {
            Some(r) => r,
            None => {
                // Route not yet in ROUTE_PERMISSIONS table.
                // Root users bypass in check_permissions; non-root users are denied
                // via is_allowed with empty method/o2_type/org_id.
                log::warn!(
                    "route missing from ROUTE_PERMISSIONS: {method} {path} — non-root users will be denied"
                );
                let auth_str = extract_auth_str_from_headers(&parts.headers).await;
                if auth_str.is_empty() {
                    return Err(AuthExtractorRejection::unauthorized("Unauthorized Access"));
                }
                return Ok(AuthExtractor {
                    auth: auth_str,
                    method: String::new(),
                    o2_type: String::new(),
                    org_id: String::new(),
                    bypass_check: false,
                    parent_id: String::new(),
                    use_all_org: false,
                    use_self_context: false,
                    use_self_parent: false,
                });
            }
        };

        let auth_str = extract_auth_str_from_headers(&parts.headers).await;
        if auth_str.is_empty() {
            return Err(AuthExtractorRejection::unauthorized("Unauthorized Access"));
        }

        if resolved.bypass_check {
            return Ok(AuthExtractor {
                auth: auth_str,
                method: String::new(),
                o2_type: String::new(),
                org_id: String::new(),
                bypass_check: true,
                parent_id: resolved.parent_id,
                use_all_org: false,
                use_self_context: false,
                use_self_parent: false,
            });
        }

        log::debug!(
            "AuthExtractor::from_request took {} ms",
            start.elapsed().as_millis()
        );

        Ok(AuthExtractor {
            auth: auth_str,
            method: resolved.method,
            o2_type: resolved.o2_type,
            org_id: resolved.org_id,
            bypass_check: false,
            parent_id: resolved.parent_id,
            use_all_org: resolved.use_all_org,
            use_self_context: resolved.use_self_context,
            use_self_parent: resolved.use_self_parent,
        })
    }

    #[cfg(not(feature = "enterprise"))]
    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        let cookies = extract_cookies_from_headers(&parts.headers);
        let auth_str = if let Some(cookie) = cookies.get("auth_tokens") {
            let val = config::utils::base64::decode_raw(cookie).unwrap_or_default();
            let auth_tokens: AuthTokens =
                json::from_str(std::str::from_utf8(&val).unwrap_or_default()).unwrap_or_default();
            let access_token = auth_tokens.access_token;
            if access_token.starts_with("Basic") || access_token.starts_with("Bearer") {
                access_token
            } else {
                format!("Bearer {access_token}")
            }
        } else if let Some(auth_header) = parts.headers.get("Authorization") {
            if let Ok(auth_str) = auth_header.to_str() {
                auth_str.to_owned()
            } else {
                "".to_string()
            }
        } else {
            "".to_string()
        };

        // if let Some(auth_header) = parts.headers.get("Authorization") {
        if !auth_str.is_empty() {
            return Ok(AuthExtractor {
                auth: auth_str.to_owned(),
                method: "".to_string(),
                o2_type: "".to_string(),
                org_id: "".to_string(),
                bypass_check: true, // bypass check permissions
                parent_id: "".to_string(),
                use_all_org: false,
                use_self_context: false,
                use_self_parent: false,
            });
        }

        Err(AuthExtractorRejection::unauthorized("Unauthorized Access"))
    }
}

fn extract_cookies_from_headers(headers: &HeaderMap) -> HashMap<&str, &str> {
    // Check cookies
    let cookies = headers
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

    cookie_map
}

#[cfg(feature = "enterprise")]
pub async fn extract_auth_str_from_headers(headers: &HeaderMap) -> String {
    let cookies = extract_cookies_from_headers(headers);
    if let Some(cookie) = cookies.get("auth_tokens") {
        let val = config::utils::base64::decode_raw(cookie).unwrap_or_default();
        let auth_tokens: AuthTokens =
            json::from_str(std::str::from_utf8(&val).unwrap_or_default()).unwrap_or_default();
        let access_token = auth_tokens.access_token;
        if access_token.is_empty() {
            // If cookie was set but access token is still empty
            // we check auth_ext cookie to get the token.
            cookies
                .get("auth_ext")
                .map(|cookie| {
                    let val = config::utils::base64::decode_raw(cookie).unwrap_or_default();
                    std::str::from_utf8(&val).unwrap_or_default().to_string()
                })
                .unwrap_or_default()
        } else if access_token.starts_with("Basic") || access_token.starts_with("Bearer") {
            access_token
        } else if access_token.starts_with("session") {
            let session_key = access_token.strip_prefix("session ").unwrap().to_string();
            match crate::service::db::session::get(&session_key).await {
                Ok(token) => {
                    log::debug!("Session '{}' resolved to token", session_key);
                    // Check if token already has auth prefix
                    if token.starts_with("Basic ") || token.starts_with("Bearer ") {
                        // Add session marker prefix to bypass allow_static_token check
                        // Format: "Session::<session_id>::<actual_token>"
                        format!("Session::{}::{}", session_key, token)
                    } else {
                        // Plain JWT token from Dex/OAuth, needs Bearer prefix
                        format!("Bearer {}", token)
                    }
                }
                Err(e) => {
                    log::error!("Failed to resolve session '{}': {}", session_key, e);
                    access_token
                }
            }
        } else {
            format!("Bearer {access_token}")
        }
    } else if let Some(cookie) = cookies.get("auth_ext") {
        let val = config::utils::base64::decode_raw(cookie).unwrap_or_default();
        std::str::from_utf8(&val).unwrap_or_default().to_string()
    } else if let Some(auth_header) = headers.get("Authorization") {
        if let Ok(auth_str) = auth_header.to_str() {
            // Log auth type without exposing sensitive tokens
            let auth_type = if auth_str.starts_with("Basic ") {
                "Basic"
            } else if auth_str.starts_with("Bearer ") {
                "Bearer"
            } else if auth_str.starts_with("session ") {
                "session"
            } else {
                "Other"
            };
            log::debug!(
                "Authorization header (extract_auth_str_from_parts): type='{}', len={}",
                auth_type,
                auth_str.len()
            );
            // Handle session tokens from Authorization header
            if auth_str.starts_with("session ") {
                let session_key = auth_str.strip_prefix("session ").unwrap().to_string();
                match crate::service::db::session::get(&session_key).await {
                    Ok(token) => {
                        log::debug!("Session '{}' resolved to token from header", session_key);
                        // Check if token already has auth prefix
                        if token.starts_with("Basic ") || token.starts_with("Bearer ") {
                            // Add session marker prefix to bypass allow_static_token check
                            // Format: "Session::<session_id>::<actual_token>"
                            format!("Session::{}::{}", session_key, token)
                        } else {
                            // Plain JWT token from Dex/OAuth, needs Bearer prefix
                            format!("Bearer {}", token)
                        }
                    }
                    Err(e) => {
                        log::error!(
                            "Failed to resolve session '{}' from header: {}",
                            session_key,
                            e
                        );
                        auth_str.to_owned()
                    }
                }
            } else {
                auth_str.to_owned()
            }
        } else {
            "".to_string()
        }
    } else {
        "".to_string()
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

    let user_pass = format!("{username}:{stage3}");
    let auth = base64::engine::general_purpose::STANDARD.encode(user_pass);

    format!("{base_url}/auth/login?request_time={time}&exp_in={exp_in}&auth={auth}")
}

#[cfg(not(feature = "enterprise"))]
#[allow(clippy::too_many_arguments)]
pub async fn check_permissions(
    _object_id: &str,
    _org_id: &str,
    _user_id: &str,
    _object_type: &str,
    _method: &str,
    _parent_id: Option<&str>,
    _use_all_org: bool,
    _use_self_context: bool,
    _use_self_parent: bool,
) -> bool {
    false
}

/// Returns false if Auth fails
#[cfg(feature = "enterprise")]
#[allow(clippy::too_many_arguments)]
pub async fn check_permissions(
    object_id: &str,
    org_id: &str,
    user_id: &str,
    object_type: &str,
    method: &str,
    parent_id: Option<&str>,
    use_all_org: bool,
    use_self_context: bool,
    use_self_parent: bool,
) -> bool {
    if !is_root_user(user_id) {
        let user: config::meta::user::User = match get_user(Some(org_id), user_id).await {
            Some(user) => user.clone(),
            None => return false,
        }
        .clone();

        // user_id here is generally safe because it comes from the `user_id` request header,
        // which the auth middleware sets to the DB-resolved email. However, we use user.email
        // directly to avoid any inconsistency between the input identifier and the canonical
        // DB email (e.g. casing differences or aliased identifiers).
        return crate::handler::http::auth::validator::check_permissions(
            &user.email,
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
                use_all_org,
                use_self_context,
                use_self_parent,
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

    let auth_str = extract_auth_str_from_headers(&parts.headers).await;
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

pub fn build_basic_auth_header(email: &str, token: &str) -> String {
    let credentials = format!("{email}:{token}");
    let encoded = base64::engine::general_purpose::STANDARD.encode(credentials.as_bytes());
    format!("Basic {encoded}")
}

#[cfg(test)]
mod tests {
    use infra::{db as infra_db, table as infra_table};

    use super::*;
    use crate::{
        common::meta::user::UserRequest,
        service::{self, organization, users},
    };

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
    #[ignore]
    async fn test_is_root_user2() {
        infra_db::create_table().await.unwrap();
        infra_table::create_user_tables().await.unwrap();
        organization::check_and_create_org_without_ofga(DEFAULT_ORG)
            .await
            .unwrap();
        let _ = users::create_root_user_if_not_exists(
            DEFAULT_ORG,
            UserRequest {
                email: "root@example.com".to_string(),
                password: "Complexpass#123".to_string(),
                role: UserOrgRole {
                    base_role: config::meta::user::UserRole::Root,
                    custom_role: None,
                },
                first_name: "root".to_owned(),
                last_name: "".to_owned(),
                is_external: false,
                token: None,
            },
        )
        .await;
        service::db::user::cache().await.unwrap();
        service::db::organization::cache().await.unwrap();
        service::db::org_users::cache().await.unwrap();
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
        println!("time: {time}");
        println!("pass3: {pass3}");

        let user_pass = format!("{}:{}", "b@b.com", pass3);
        let auth = base64::engine::general_purpose::STANDARD.encode(user_pass);
        println!(
            "http://localhost:5080/auth/login?request_time={time}&exp_in={exp_in}&auth={auth}"
        );
    }

    #[test]
    fn test_get_hash_caching() {
        let pass = "testpass";
        let salt = "testsalt";

        // First call should create hash and cache it
        let hash1 = get_hash(pass, salt);

        // Second call should return cached value
        let hash2 = get_hash(pass, salt);

        assert_eq!(hash1, hash2);
        assert!(!hash1.is_empty());
    }

    #[test]
    fn test_email_regex_edge_cases() {
        // Valid emails
        assert!(is_valid_email("test@example.com"));
        assert!(is_valid_email("user.name@example.com"));
        assert!(is_valid_email("user+tag@example.com"));
        assert!(is_valid_email("user_name@example.co.uk"));
        assert!(is_valid_email("123@example.com"));

        // Invalid emails
        assert!(!is_valid_email(""));
        assert!(!is_valid_email("no-at-sign"));
        assert!(!is_valid_email("@no-user.com"));
        assert!(!is_valid_email("user@"));
        assert!(!is_valid_email("user..double@example.com"));
        assert!(!is_valid_email("user@no-domain"));
        assert!(!is_valid_email("user@domain.c")); // TLD too short
        assert!(!is_valid_email("user with space@example.com"));
        assert!(!is_valid_email("user@domain with space.com"));
        assert!(!is_valid_email(".user@example.com"));
        assert!(!is_valid_email("user@.example.com"));
    }

    #[test]
    fn test_ofga_format_conversion_comprehensive() {
        // Basic replacements
        assert_eq!(into_ofga_supported_format("test"), "test");
        assert_eq!(into_ofga_supported_format("test_name"), "test_name");
        assert_eq!(into_ofga_supported_format("123"), "123");

        // Special characters
        assert_eq!(into_ofga_supported_format("a:b"), "a_b");
        assert_eq!(into_ofga_supported_format("a#b"), "a_b");
        assert_eq!(into_ofga_supported_format("a?b"), "a_b");
        assert_eq!(into_ofga_supported_format("a'b"), "a_b");
        assert_eq!(into_ofga_supported_format("a\"b"), "a_b");
        assert_eq!(into_ofga_supported_format("a%b"), "a_b");
        assert_eq!(into_ofga_supported_format("a&b"), "a_b");

        // Multiple spaces
        assert_eq!(into_ofga_supported_format("a   b"), "a_b");
        assert_eq!(into_ofga_supported_format("  a  b  "), "_a_b_");

        // Complex combinations
        assert_eq!(
            into_ofga_supported_format("test:name with spaces"),
            "test_name_with_spaces"
        );
        assert_eq!(into_ofga_supported_format("a & b : c # d"), "a_b_c_d");

        // Edge cases
        assert_eq!(into_ofga_supported_format(""), "");
        assert_eq!(into_ofga_supported_format(":::"), "_");
        assert_eq!(into_ofga_supported_format("   "), "_");
    }

    #[test]
    fn test_ofga_unsupported_detection() {
        // Supported characters (should return false)
        assert!(!is_ofga_unsupported("valid"));
        assert!(!is_ofga_unsupported("valid123"));
        assert!(!is_ofga_unsupported("valid_name"));
        assert!(!is_ofga_unsupported("CamelCase"));
        assert!(!is_ofga_unsupported(""));

        // Unsupported characters (should return true)
        assert!(is_ofga_unsupported("has:colon"));
        assert!(is_ofga_unsupported("has#hash"));
        assert!(is_ofga_unsupported("has?question"));
        assert!(is_ofga_unsupported("has space"));
        assert!(is_ofga_unsupported("has'quote"));
        assert!(is_ofga_unsupported("has\"doublequote"));
        assert!(is_ofga_unsupported("has%percent"));
        assert!(is_ofga_unsupported("has&ampersand"));

        // Mixed cases
        assert!(is_ofga_unsupported("valid:invalid"));
        assert!(is_ofga_unsupported("valid invalid"));
    }

    #[test]
    fn test_generate_presigned_url_variations() {
        let username = "testuser";
        let password = "testpass";
        let salt = "testsalt";
        let base_url = "https://auth.example.com";
        let exp_in = 7200;
        let time = 1600000000;

        let url = generate_presigned_url(username, password, salt, base_url, exp_in, time);

        assert!(url.starts_with(base_url));
        assert!(url.contains("/auth/login"));
        assert!(url.contains(&format!("request_time={time}")));
        assert!(url.contains(&format!("exp_in={exp_in}")));
        assert!(url.contains("auth="));

        // Test with different parameters
        let url2 = generate_presigned_url(username, password, salt, base_url, exp_in, time + 1);
        assert_ne!(url, url2); // Different time should generate different URL

        let url3 = generate_presigned_url("different", password, salt, base_url, exp_in, time);
        assert_ne!(url, url3); // Different username should generate different URL
    }

    #[tokio::test]
    async fn test_save_org_tuples_non_enterprise() {
        // In non-enterprise mode, this should not panic and return immediately
        save_org_tuples("test_org").await;
        // If we reach here, the function completed successfully
    }

    #[tokio::test]
    async fn test_delete_org_tuples_non_enterprise() {
        // In non-enterprise mode, this should not panic and return immediately
        delete_org_tuples("test_org").await;
        // If we reach here, the function completed successfully
    }

    #[test]
    fn test_get_role_non_enterprise() {
        let user_role = UserOrgRole {
            base_role: UserRole::User,
            custom_role: None,
        };

        // In non-enterprise mode, should always return Admin
        assert_eq!(get_role(&user_role), UserRole::Admin);
    }

    #[cfg(not(feature = "enterprise"))]
    #[tokio::test]
    async fn test_check_permissions_non_enterprise() {
        // In non-enterprise mode, should always return false
        let result = check_permissions(
            "test_object",
            "test_org",
            "test_user",
            "dashboard",
            "GET",
            None,
            false,
            false,
            false,
        )
        .await;

        assert!(!result);
    }

    #[test]
    fn test_regex_compilation() {
        // Test that the regexes compile without panicking
        assert!(RE_OFGA_UNSUPPORTED_NAME.is_match("test:name"));
        assert!(RE_SPACE_AROUND.is_match("a @ b")); // @ is not in the exclusion list, so this should match
        assert!(EMAIL_REGEX.is_match("test@example.com"));

        // Test that the regexes work as expected
        assert!(!RE_OFGA_UNSUPPORTED_NAME.is_match("valid_name"));
        assert!(!EMAIL_REGEX.is_match("invalid-email"));
    }

    #[test]
    fn test_resolve_write_method_alert_trigger_uses_put() {
        let path: Vec<&str> = "v2/default/alerts/abc123/trigger".split('/').collect();
        assert_eq!(resolve_write_method("PATCH", &path), "PUT");
    }

    #[test]
    fn test_resolve_write_method_alert_enable_uses_put() {
        let path: Vec<&str> = "v2/default/alerts/abc123/enable".split('/').collect();
        assert_eq!(resolve_write_method("PATCH", &path), "PUT");
    }

    #[test]
    fn test_resolve_write_method_alert_crud_put() {
        let path: Vec<&str> = "v2/default/alerts/abc123".split('/').collect();
        assert_eq!(resolve_write_method("PUT", &path), "PUT");
    }

    #[test]
    fn test_resolve_write_method_alert_crud_delete() {
        let path: Vec<&str> = "v2/default/alerts/abc123".split('/').collect();
        assert_eq!(resolve_write_method("DELETE", &path), "DELETE");
    }

    #[test]
    fn test_resolve_write_method_patch_normalizes_to_put() {
        let path: Vec<&str> = "v2/default/alerts/abc123".split('/').collect();
        assert_eq!(resolve_write_method("PATCH", &path), "PUT");
    }

    #[test]
    fn test_resolve_write_method_delete_fields_uses_delete() {
        let path: Vec<&str> = "default/streams/mystream/delete_fields"
            .split('/')
            .collect();
        assert_eq!(resolve_write_method("PUT", &path), "DELETE");
        assert_eq!(resolve_write_method("PATCH", &path), "DELETE");
    }

    #[test]
    fn test_resolve_write_method_non_alert_patch_becomes_put() {
        let path: Vec<&str> = "v2/default/dashboards/dash123".split('/').collect();
        assert_eq!(resolve_write_method("PATCH", &path), "PUT");
    }

    #[test]
    fn test_resolve_write_method_trigger_only_matches_v2_alerts() {
        // v1-style path should continue to normalize PATCH to PUT
        let path: Vec<&str> = "default/streams/alerts/abc123/trigger".split('/').collect();
        assert_eq!(resolve_write_method("PATCH", &path), "PUT");
    }

    #[test]
    fn test_resolve_write_method_trigger_requires_full_path() {
        // Too short a path should not match
        let path: Vec<&str> = "v2/default/trigger".split('/').collect();
        assert_eq!(resolve_write_method("PATCH", &path), "PUT");
    }

    #[test]
    fn test_build_basic_auth_header_format() {
        use base64::Engine as _;
        let header = build_basic_auth_header("user@example.com", "mytoken");
        assert!(header.starts_with("Basic "));
        let encoded = header.strip_prefix("Basic ").unwrap();
        let decoded = String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(decoded, "user@example.com:mytoken");
    }

    #[test]
    fn test_build_basic_auth_header_empty_fields() {
        use base64::Engine as _;
        let header = build_basic_auth_header("", "");
        assert!(header.starts_with("Basic "));
        let encoded = header.strip_prefix("Basic ").unwrap();
        let decoded = String::from_utf8(
            base64::engine::general_purpose::STANDARD
                .decode(encoded)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(decoded, ":");
    }
}
