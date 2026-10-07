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

use axum::{
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use config::utils::str::mask_license_key;
use db::license;
use o2_enterprise::enterprise::license::{
    LICENSE_DB_KEY, License, check_license, get_license, ingestion_limit_exceeded_count,
    ingestion_used, license_expired,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::UserEmail;
use serde::{Deserialize, Serialize};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

#[derive(Serialize, Deserialize)]
struct LicenseResponse {
    key: Option<String>,
    license: Option<License>,
    installation_id: String,
    expired: bool,
    ingestion_used: f64,
    ingestion_exceeded: u8,
}

pub struct SaveLicenseRequest {
    key: License,
    raw_key: String,
}

impl<'de> Deserialize<'de> for SaveLicenseRequest {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        #[derive(Deserialize)]
        struct Helper {
            key: String,
        }

        let helper = Helper::deserialize(deserializer)?;
        let license = License::load_from_str(&helper.key).map_err(serde::de::Error::custom)?;

        Ok(SaveLicenseRequest {
            key: license,
            raw_key: helper.key,
        })
    }
}

async fn check_license_permission(user_id: &str, method: &str) -> Result<(), anyhow::Error> {
    use o2_openfga::meta::mapping::OFGA_MODELS;
    use openobserve_core::{auth::AuthExtractor, users::get_user};

    if !db::user::is_root_user(user_id) {
        let user = match get_user(Some("_meta"), user_id).await {
            Some(v) => v,
            None => return Err(anyhow::anyhow!("Unauthorized access to license")),
        };
        if !openobserve_api_common::auth::validator::check_permissions(
            user_id,
            AuthExtractor {
                auth: "".to_string(),
                method: method.to_string(),
                o2_type: format!(
                    "{}:_meta",
                    OFGA_MODELS
                        .get("license")
                        .map_or("license", |model| model.key),
                ),
                org_id: "_meta".to_string(),
                bypass_check: false,
                parent_id: "".to_string(),
                use_all_org: true,
                use_self_context: false,
                use_self_parent: false,
            },
            user.role,
            user.is_external,
        )
        .await
        {
            return Err(anyhow::anyhow!("Unauthorized Access to license"));
        }
    }
    Ok(())
}

// license admins need the instance id to request a license, unless it doubles as the grpc token
fn viewer_license_fields(
    is_root: bool,
    is_license_admin: bool,
    internal_grpc_token: &str,
    redact_key: bool,
    key: Option<String>,
    mut license: Option<License>,
) -> (Option<String>, Option<License>, String) {
    if !is_root && let Some(license) = license.as_mut() {
        license.installation_id.clear();
        license.validator_auth.clear();
    }
    let key = if redact_key || !is_root {
        key.map(|v| mask_license_key(&v))
    } else {
        key
    };
    let instance_id = config::get_instance_id();
    let is_grpc_token = internal_grpc_token.is_empty() || internal_grpc_token == instance_id;
    let installation_id = if is_root || (is_license_admin && !is_grpc_token) {
        instance_id
    } else {
        String::new()
    };
    (key, license, installation_id)
}

pub async fn get_license_info(Headers(email): Headers<UserEmail>) -> Response {
    let o2_cfg = o2_enterprise::enterprise::common::config::get_config();

    // Any authenticated user may call this; viewer_license_fields trims the response by role.
    let (key, license) = match get_license().await {
        Some((k, l)) => (Some(k), Some(l)),
        None => (None, None),
    };

    let is_root = db::user::is_root_user(&email.user_id);
    let is_license_admin = is_root
        || check_license_permission(&email.user_id, "PUT")
            .await
            .is_ok();
    let (key, license, installation_id) = viewer_license_fields(
        is_root,
        is_license_admin,
        &config::meta::cluster::get_internal_grpc_token(),
        o2_cfg.common.redact_license_key,
        key,
        license,
    );

    let res = LicenseResponse {
        key,
        license,
        installation_id,
        expired: license_expired().await,
        ingestion_exceeded: ingestion_limit_exceeded_count(),
        ingestion_used: ingestion_used() * 100.0, // convert to percentage
    };
    MetaHttpResponse::json(res)
}

pub async fn store_license(
    Headers(user_email): Headers<UserEmail>,
    axum::Json(req): axum::Json<SaveLicenseRequest>,
) -> Response {
    let email = user_email.user_id;
    if check_license_permission(&email, "PUT").await.is_err() {
        return MetaHttpResponse::forbidden("Unauthorized Access to license");
    }

    if let Err(e) = check_license(&req.raw_key, &req.key).await {
        return MetaHttpResponse::bad_request(e.to_string());
    };

    let db = infra::db::get_db().await;
    db.put(LICENSE_DB_KEY, req.raw_key.into(), false, None)
        .await
        .unwrap();
    match license::update().await {
        Ok(_) => (StatusCode::CREATED, Json("")).into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

pub async fn refresh_license_limits(Headers(user_email): Headers<UserEmail>) -> Response {
    let email = user_email.user_id;
    if check_license_permission(&email, "PUT").await.is_err() {
        return MetaHttpResponse::forbidden("Unauthorized Access to license");
    }

    // check  if license is present. If not present, no point in refreshing
    match get_license().await {
        Some(_) => {}
        None => return (StatusCode::OK, Json("")).into_response(),
    };

    // the nats handling flow will trigger limit refresh in all nodes
    match license::update().await {
        Ok(_) => (StatusCode::OK, Json("")).into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

#[cfg(test)]
mod tests {
    use config::utils::{base64, json};

    use super::*;

    const INSTANCE_ID: &str = "license-instance-7f3a";
    const VALIDATOR_AUTH: &str = "dmFsaWRhdG9yOnMzY3JldA-auth";

    fn stored_license() -> (String, License) {
        let payload = json::json!({
            "installation_id": INSTANCE_ID,
            "license_id": "lic-1",
            "active": true,
            "created_at": 0,
            "expires_at": 0,
            "msv": "0.1.0",
            "company": "acme",
            "address": "",
            "contact_name": "",
            "contact_email": "",
            "additional_emails": [],
            "base_urls": [],
            "limits": {},
            "validator_url": "https://validator.example",
            "validator_auth": VALIDATOR_AUTH,
        });
        let segment = base64::encode(&payload.to_string())
            .replace('+', "-")
            .replace('/', "_")
            .replace('=', "");
        let key = format!("eyJhbGciOiJFUzI1NiJ9.{segment}.c2lnbmF0dXJl");
        (key, json::from_value(payload).unwrap())
    }

    fn response_json(is_root: bool, is_license_admin: bool) -> String {
        response_json_with_token(is_root, is_license_admin, "cluster-token-distinct")
    }

    fn response_json_with_token(is_root: bool, is_license_admin: bool, grpc_token: &str) -> String {
        config::cache_instance_id(INSTANCE_ID);
        let (key, license) = stored_license();
        let (key, license, installation_id) = viewer_license_fields(
            is_root,
            is_license_admin,
            grpc_token,
            false,
            Some(key),
            Some(license),
        );
        json::to_string(&LicenseResponse {
            key,
            license,
            installation_id,
            expired: false,
            ingestion_used: 0.0,
            ingestion_exceeded: 0,
        })
        .unwrap()
    }

    fn decoded_key_segments(response: &str) -> String {
        let response: json::Value = json::from_str(response).unwrap();
        let key = response["key"].as_str().unwrap_or_default();
        key.split('.')
            .filter_map(|segment| {
                let padded = format!("{segment}{}", "=".repeat((4 - segment.len() % 4) % 4));
                base64::decode_raw(padded.replace('-', "+").replace('_', "/")).ok()
            })
            .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
            .collect()
    }

    #[test]
    fn test_installation_id_is_visible_to_root_only() {
        let viewer = response_json(false, false);
        let viewer_key = decoded_key_segments(&viewer);
        for secret in [INSTANCE_ID, VALIDATOR_AUTH] {
            assert!(!viewer.contains(secret), "{viewer}");
            assert!(!viewer_key.contains(secret));
        }
        assert!(viewer.contains("lic-1"));

        let root = response_json(true, true);
        let (key, _) = stored_license();
        assert!(root.contains(&key));
        assert!(decoded_key_segments(&root).contains(INSTANCE_ID));
        let root: json::Value = json::from_str(&root).unwrap();
        assert_eq!(root["installation_id"], INSTANCE_ID);
        assert_eq!(root["license"]["installation_id"], INSTANCE_ID);
        assert_eq!(root["license"]["validator_auth"], VALIDATOR_AUTH);
    }

    #[test]
    fn test_license_admins_never_get_an_installation_id_that_is_the_grpc_token() {
        for token in ["", INSTANCE_ID] {
            let admin = response_json_with_token(false, true, token);
            let admin_json: json::Value = json::from_str(&admin).unwrap();
            assert_eq!(admin_json["installation_id"], "", "token {token:?}");
            assert!(!admin.contains(INSTANCE_ID), "{admin}");
        }
        let root = response_json_with_token(true, true, "");
        let root: json::Value = json::from_str(&root).unwrap();
        assert_eq!(root["installation_id"], INSTANCE_ID);
    }

    #[test]
    fn test_license_admins_get_the_installation_id_once_a_stored_token_replaces_it() {
        config::cache_instance_id(INSTANCE_ID);
        config::cache_stored_grpc_token("stored-random-token");
        let token = config::meta::cluster::get_internal_grpc_token();
        config::cache_stored_grpc_token("");
        let admin = response_json_with_token(false, true, &token);
        let admin: json::Value = json::from_str(&admin).unwrap();
        assert_eq!(admin["installation_id"], INSTANCE_ID);
    }

    #[test]
    fn test_license_admins_get_the_installation_id_but_not_the_key_secrets() {
        let admin = response_json(false, true);
        let admin_json: json::Value = json::from_str(&admin).unwrap();
        assert_eq!(admin_json["installation_id"], INSTANCE_ID);
        assert_eq!(admin_json["license"]["installation_id"], "");
        assert!(!admin.contains(VALIDATOR_AUTH), "{admin}");
        let admin_key = decoded_key_segments(&admin);
        for secret in [INSTANCE_ID, VALIDATOR_AUTH] {
            assert!(!admin_key.contains(secret));
        }
        let (key, _) = stored_license();
        assert!(!admin.contains(&key));
    }
}
