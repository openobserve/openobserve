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
use config::{meta::user::UserRole, utils::str::mask_license_key};
use db::license;
use o2_enterprise::enterprise::license::{
    LICENSE_DB_KEY, License, LicenseDecision, LicenseStatus, Rollback, RollbackReason, Waiver,
    check_license, gate_and_raise, get_license, ingestion_limit_exceeded_count, ingestion_used,
    judge_paste, license_expired, license_status, load_rev_hwm, pasted_key_supersedes_env,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::{AuthExtractor, UserEmail};
use serde::{Deserialize, Serialize};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const ENV_KEY_CONFLICT_MSG: &str = "This instance uses the license key in the O2_LICENSE_KEY environment variable, and that key stays in use. Only a newer key for the same license, such as one carrying new waivers, can be pasted over it. To use any other key, put it in O2_LICENSE_KEY and restart.";
const ENV_KEY_CONFLICT: &str = "env_key_conflict";
const KEY_ACCEPTED: &str = "accept";
const KEY_ACCEPTED_MSG: &str = "This key can be applied.";

#[derive(Serialize, Deserialize)]
struct LicenseResponse {
    key: Option<String>,
    license: Option<License>,
    installation_id: String,
    expired: bool,
    ingestion_used: f64,
    ingestion_exceeded: u8,
    waivers: Vec<Waiver>,
    decision: LicenseDecision,
    base: LicenseDecision,
    evaluated_at: i64,
    env_key_active: bool,
    /// Whether the loaded key is the `O2_LICENSE_KEY` one, i.e. no pasted key superseded it.
    env_key_in_use: bool,
    /// Whether `POST /license/refresh` would pass both its route check and its handler check.
    can_update_license: bool,
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

#[derive(Deserialize, Default)]
pub struct StoreLicenseQuery {
    #[serde(default)]
    pub dry_run: bool,
}

#[derive(Serialize)]
struct RollbackBody {
    code: u16,
    message: String,
    reason: &'static str,
    license_id: String,
    loaded_rev: Option<i64>,
    pasted_rev: Option<i64>,
}

#[derive(Serialize, Deserialize)]
struct KeyCheckResponse {
    dry_run: bool,
    outcome: String,
    message: String,
    license_id: String,
    same_license: bool,
    loaded_rev: Option<i64>,
    pasted_rev: i64,
    waivers_added: Vec<Waiver>,
    waivers_removed: Vec<Waiver>,
}

async fn check_license_permission(user_id: &str, method: &str) -> Result<(), anyhow::Error> {
    use o2_openfga::meta::mapping::OFGA_MODELS;
    use openobserve_core::users::get_user;

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

// root, else the handler's PUT check and the middleware's route check under its cached _meta role
async fn can_update_license<F, Fut>(user_id: &str, handler_allows: bool, route_check: F) -> bool
where
    F: FnOnce(AuthExtractor, UserRole) -> Fut,
    Fut: std::future::Future<Output = bool>,
{
    if db::user::is_root_user(user_id) {
        return true;
    }
    // the middleware takes the _meta role from this cache; on a miss, no is the safe answer
    let cached =
        common::infra::config::ORG_USERS.get(&format!("{}/{user_id}", config::META_ORG_ID));
    let Some(role) = cached.map(|u| u.role.clone()) else {
        return false;
    };
    let Some(route) = refresh_route() else {
        return false;
    };
    handler_allows
        && route_check(
            AuthExtractor {
                auth: String::new(),
                method: route.method,
                o2_type: route.o2_type,
                org_id: route.org_id,
                bypass_check: false,
                parent_id: route.parent_id,
                use_all_org: route.use_all_org,
                use_self_context: route.use_self_context,
                use_self_parent: route.use_self_parent,
            },
            role,
        )
        .await
}

fn refresh_route() -> Option<o2_openfga::meta::route_permissions::ResolvedRoute> {
    o2_openfga::meta::route_permissions::resolve_permission(
        &["license", "refresh"],
        "POST",
        config::META_ORG_ID,
        "",
        None,
    )
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
        hide_waiver_installations(&mut license.waivers);
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

fn license_status_fields(
    status: LicenseStatus,
    is_root: bool,
) -> (Vec<Waiver>, LicenseDecision, LicenseDecision, i64) {
    let mut waivers = status.waivers;
    if !is_root {
        hide_waiver_installations(&mut waivers);
    }
    (waivers, status.decision, status.base, status.evaluated_at)
}

// a scoped waiver names an installation id, which on token-less installs is the grpc token
fn hide_waiver_installations(waivers: &mut [Waiver]) {
    for w in waivers {
        w.installation_id = None;
    }
}

// same test as the enterprise key loader, so the UI and the 409 never disagree with it
fn env_key_active(env_key: &str) -> bool {
    !env_key.is_empty()
}

// an env key that does not parse fails the loader before it reads the db, so nothing supersedes it
fn env_key_conflict(env_key: &str, env: Option<&License>, raw: &str, pasted: &License) -> bool {
    env_key_active(env_key)
        && env_key.trim() != raw.trim()
        && !env.is_some_and(|env| pasted_key_supersedes_env(env, pasted))
}

fn env_key_in_use(env_key: &str, live_key: Option<&str>) -> bool {
    env_key_active(env_key) && live_key == Some(env_key)
}

fn rollback_body(r: &Rollback) -> RollbackBody {
    let issued = issued_on(r.loaded_rev);
    let when = if issued.is_empty() {
        String::new()
    } else {
        format!(" (issued {issued})")
    };
    let message = match r.reason {
        RollbackReason::RevRollback => {
            format!("A newer key for this license is already applied{when}.")
        }
        RollbackReason::RevConflict => {
            format!("A different key with the same revision is already applied{when}.")
        }
        RollbackReason::Superseded => {
            "This license was replaced by another license. Paste a key for the new license."
                .to_string()
        }
    };
    RollbackBody {
        code: StatusCode::CONFLICT.as_u16(),
        message,
        reason: r.reason.as_str(),
        license_id: r.license_id.clone(),
        loaded_rev: Some(r.loaded_rev),
        pasted_rev: Some(r.pasted_rev),
    }
}

fn env_conflict_body(pasted: &License) -> RollbackBody {
    RollbackBody {
        code: StatusCode::CONFLICT.as_u16(),
        message: ENV_KEY_CONFLICT_MSG.to_string(),
        reason: ENV_KEY_CONFLICT,
        license_id: pasted.license_id.clone(),
        loaded_rev: None,
        pasted_rev: None,
    }
}

// a waiver edited in place shows as removed and added, so the preview never hides a change
fn waiver_diff(loaded: Option<&License>, pasted: &License) -> (Vec<Waiver>, Vec<Waiver>) {
    let Some(loaded) = loaded.filter(|l| l.license_id == pasted.license_id) else {
        return (pasted.waivers.clone(), Vec::new());
    };
    let missing_from = |from: &[Waiver], of: &[Waiver]| -> Vec<Waiver> {
        of.iter().filter(|w| !from.contains(w)).cloned().collect()
    };
    (
        missing_from(&loaded.waivers, &pasted.waivers),
        missing_from(&pasted.waivers, &loaded.waivers),
    )
}

// rev 0 marks a legacy key that carries no issue time
fn issued_on(rev: i64) -> String {
    if rev <= 0 {
        return String::new();
    }
    chrono::DateTime::from_timestamp_micros(rev)
        .map(|t| t.format("%Y-%m-%d").to_string())
        .unwrap_or_default()
}

fn key_check_response(
    outcome: &str,
    message: String,
    hwm_rev: Option<i64>,
    loaded: Option<&License>,
    pasted: &License,
    is_root: bool,
) -> KeyCheckResponse {
    let loaded = loaded.filter(|l| l.license_id == pasted.license_id);
    let (mut waivers_added, mut waivers_removed) = waiver_diff(loaded, pasted);
    if !is_root {
        hide_waiver_installations(&mut waivers_added);
        hide_waiver_installations(&mut waivers_removed);
    }
    KeyCheckResponse {
        dry_run: true,
        outcome: outcome.to_string(),
        message,
        license_id: pasted.license_id.clone(),
        same_license: loaded.is_some(),
        loaded_rev: hwm_rev.or(loaded.map(|l| l.rev)),
        pasted_rev: pasted.rev,
        waivers_added,
        waivers_removed,
    }
}

fn verdict_outcome(verdict: &Result<(), Rollback>) -> (&'static str, String) {
    match verdict {
        Ok(()) => (KEY_ACCEPTED, KEY_ACCEPTED_MSG.to_string()),
        Err(r) => (r.reason.as_str(), rollback_body(r).message),
    }
}

async fn preview_key(pasted: &License, loaded: Option<&License>, is_root: bool) -> Response {
    let hwm = match load_rev_hwm().await {
        Ok(hwm) => hwm,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let (outcome, message) = verdict_outcome(&judge_paste(&hwm, pasted));
    let hwm_rev = hwm.get(&pasted.license_id).map(|e| e.rev);
    MetaHttpResponse::json(key_check_response(
        outcome, message, hwm_rev, loaded, pasted, is_root,
    ))
}

pub async fn get_license_info(Headers(email): Headers<UserEmail>) -> Response {
    let o2_cfg = o2_enterprise::enterprise::common::config::get_config();

    // Any authenticated user may call this; viewer_license_fields trims the response by role.
    let (key, license) = match get_license().await {
        Some((k, l)) => (Some(k), Some(l)),
        None => (None, None),
    };

    let env_key_in_use = env_key_in_use(&o2_cfg.common.license_key, key.as_deref());
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

    let (waivers, decision, base, evaluated_at) =
        license_status_fields(license_status().await, is_root);

    let res = LicenseResponse {
        key,
        license,
        installation_id,
        expired: license_expired().await,
        ingestion_exceeded: ingestion_limit_exceeded_count(),
        ingestion_used: ingestion_used() * 100.0, // convert to percentage
        waivers,
        decision,
        base,
        evaluated_at,
        env_key_active: env_key_active(&o2_cfg.common.license_key),
        env_key_in_use,
        // check_permissions ignores is_external
        can_update_license: can_update_license(&email.user_id, is_license_admin, |auth, role| {
            openobserve_core::authz::check_permissions(&email.user_id, auth, role, false)
        })
        .await,
    };
    MetaHttpResponse::json(res)
}

pub async fn store_license(
    Headers(user_email): Headers<UserEmail>,
    axum::extract::Query(q): axum::extract::Query<StoreLicenseQuery>,
    axum::Json(req): axum::Json<SaveLicenseRequest>,
) -> Response {
    let email = user_email.user_id;
    if check_license_permission(&email, "PUT").await.is_err() {
        return MetaHttpResponse::forbidden("Unauthorized Access to license");
    }

    let o2_cfg = o2_enterprise::enterprise::common::config::get_config();
    let env_key = &o2_cfg.common.license_key;
    let env = License::load_from_str(env_key).ok();
    let is_root = db::user::is_root_user(&email);
    let loaded = get_license().await.map(|(_, l)| l);
    if env_key_conflict(env_key, env.as_ref(), &req.raw_key, &req.key) {
        if q.dry_run {
            return MetaHttpResponse::json(key_check_response(
                ENV_KEY_CONFLICT,
                ENV_KEY_CONFLICT_MSG.to_string(),
                None,
                loaded.as_ref(),
                &req.key,
                is_root,
            ));
        }
        return (StatusCode::CONFLICT, Json(env_conflict_body(&req.key))).into_response();
    }

    if let Err(e) = check_license(&req.raw_key, &req.key).await {
        return MetaHttpResponse::bad_request(e.to_string());
    };

    if q.dry_run {
        return preview_key(&req.key, loaded.as_ref(), is_root).await;
    }

    match gate_and_raise(&req.key).await {
        Ok(Ok(())) => {}
        Ok(Err(r)) => return (StatusCode::CONFLICT, Json(rollback_body(&r))).into_response(),
        Err(e) => return MetaHttpResponse::internal_error(e),
    }

    let db = infra::db::get_db().await;
    if let Err(e) = db
        .put(LICENSE_DB_KEY, req.raw_key.into(), false, None)
        .await
    {
        return MetaHttpResponse::internal_error(e);
    }
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
    use o2_enterprise::enterprise::license::Block;

    use super::*;

    const INSTANCE_ID: &str = "license-instance-7f3a";
    const VALIDATOR_AUTH: &str = "dmFsaWRhdG9yOnMzY3JldA-auth";
    const OTHER_INSTANCE_ID: &str = "license-instance-other-9c1d";

    fn scoped_waiver_json(id: &str, installation_id: &str) -> json::Value {
        json::json!({
            "id": id,
            "type": "search_unblock",
            "starts_at": 0,
            "ends_at": 1000,
            "installation_id": installation_id,
            "note": "",
        })
    }

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
            "waivers": [
                scoped_waiver_json("wv_here", INSTANCE_ID),
                scoped_waiver_json("wv_other", OTHER_INSTANCE_ID),
            ],
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
        let mut status = status_fixture();
        status.waivers[0].installation_id = Some(INSTANCE_ID.into());
        let (waivers, decision, base, evaluated_at) = license_status_fields(status, is_root);
        json::to_string(&LicenseResponse {
            key,
            license,
            installation_id,
            expired: false,
            ingestion_used: 0.0,
            ingestion_exceeded: 0,
            waivers,
            decision,
            base,
            evaluated_at,
            env_key_active: false,
            env_key_in_use: false,
            can_update_license: is_license_admin,
        })
        .unwrap()
    }

    fn waiver_installation_ids(response: &str) -> Vec<json::Value> {
        let response: json::Value = json::from_str(response).unwrap();
        [&response["waivers"], &response["license"]["waivers"]]
            .into_iter()
            .flat_map(|ws| ws.as_array().cloned().unwrap_or_default())
            .map(|w| w["installation_id"].clone())
            .collect()
    }

    fn status_fixture() -> LicenseStatus {
        json::from_value(json::json!({
            "decision": {
                "search_allowed": true,
                "exceeded_days": 4,
                "allowed_days": 3,
                "limit_today_gb": 200.0,
                "used_today_gb": 122.0,
                "waiver_ids_applied": ["wv_1"],
            },
            "base": {
                "search_allowed": false,
                "blocks": ["usage_over_limit"],
                "exceeded_days": 4,
                "allowed_days": 3,
                "limit_today_gb": 200.0,
                "used_today_gb": 122.0,
            },
            "waivers": [{
                "id": "wv_1",
                "type": "search_unblock",
                "starts_at": 0,
                "ends_at": 1000,
                "note": "Search restored while you fix the log storm",
            }],
            "waiver_source": "license_key",
            "evaluated_at": 0,
        }))
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
    fn test_waiver_installation_ids_are_visible_to_root_only() {
        for (is_license_admin, token) in
            [(false, "cluster-token-distinct"), (true, ""), (true, "x")]
        {
            let viewer = response_json_with_token(false, is_license_admin, token);
            let ids = waiver_installation_ids(&viewer);
            assert_eq!(ids.len(), 3, "{viewer}");
            assert!(ids.iter().all(|id| id.is_null()), "{viewer}");
            assert!(!viewer.contains(OTHER_INSTANCE_ID), "{viewer}");
        }
        let root = response_json(true, true);
        assert_eq!(
            waiver_installation_ids(&root),
            vec![
                json::json!(INSTANCE_ID),
                json::json!(INSTANCE_ID),
                json::json!(OTHER_INSTANCE_ID)
            ]
        );
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

    #[test]
    fn test_license_response_carries_decision_and_waivers() {
        let mut status = status_fixture();
        status.evaluated_at = 1_792_000_000_000_000;
        let (waivers, decision, base, evaluated_at) = license_status_fields(status, false);
        let json = json::to_value(&LicenseResponse {
            key: None,
            license: None,
            installation_id: String::new(),
            expired: false,
            ingestion_used: 0.0,
            ingestion_exceeded: 0,
            waivers,
            decision,
            base,
            evaluated_at,
            env_key_active: false,
            env_key_in_use: false,
            can_update_license: false,
        })
        .unwrap();
        assert_eq!(json["evaluated_at"], 1_792_000_000_000_000_i64);
        assert_eq!(json["decision"]["search_allowed"], true);
        assert_eq!(json["decision"]["exceeded_days"], 4);
        assert_eq!(json["decision"]["allowed_days"], 3);
        assert_eq!(json["decision"]["limit_today_gb"], 200.0);
        assert_eq!(json["decision"]["waiver_ids_applied"][0], "wv_1");
        assert_eq!(json["base"]["search_allowed"], false);
        assert_eq!(json["base"]["blocks"][0], "usage_over_limit");
        assert_eq!(json["waivers"][0]["type"], "search_unblock");
    }

    #[test]
    fn test_blocks_and_unlimited_serialize_for_the_ui() {
        let mut s = status_fixture();
        s.decision.search_allowed = false;
        s.decision.blocks = vec![Block::UsageOverLimit];
        s.decision.limit_today_gb = None;
        let d = json::to_value(license_status_fields(s, false).1).unwrap();
        assert_eq!(d["blocks"][0], "usage_over_limit");
        assert!(d["limit_today_gb"].is_null());
    }

    fn lic(license_id: &str, rev: i64) -> License {
        let mut l = stored_license().1;
        l.license_id = license_id.to_string();
        l.rev = rev;
        l
    }

    #[test]
    fn test_env_key_conflict_only_when_env_set_and_different() {
        let pasted = lic("lic-1", 0);
        assert!(!env_key_conflict("", None, "eyJ.new", &pasted));
        assert!(!env_key_conflict("eyJ.same", None, " eyJ.same ", &pasted));
        assert!(env_key_conflict("eyJ.old", None, "eyJ.new", &pasted));
    }

    #[test]
    fn test_a_newer_key_for_the_env_license_is_no_conflict() {
        let env = lic("lic-1", 2);
        let conflict =
            |pasted: License| env_key_conflict("eyJ.old", Some(&env), "eyJ.new", &pasted);
        assert!(!conflict(lic("lic-1", 3)));
        assert!(conflict(lic("lic-1", 2)));
        assert!(conflict(lic("lic-1", 1)));
        assert!(conflict(lic("lic-2", 9)));
    }

    #[test]
    fn test_env_key_is_active_exactly_when_the_loader_reads_it() {
        let pasted = lic("lic-1", 0);
        for (env_key, active) in [("", false), ("  ", true), ("eyJ.k", true)] {
            assert_eq!(env_key_active(env_key), active, "{env_key:?}");
            assert_eq!(
                env_key_conflict(env_key, None, "eyJ.new", &pasted),
                active,
                "{env_key:?}"
            );
        }
    }

    #[test]
    fn test_env_key_in_use_only_while_it_is_the_loaded_key() {
        assert!(env_key_in_use("eyJ.env", Some("eyJ.env")));
        assert!(!env_key_in_use("eyJ.env", Some("eyJ.pasted")));
        assert!(!env_key_in_use("eyJ.env", None));
        assert!(!env_key_in_use("", Some("")));
        assert!(!env_key_in_use("", None));
    }

    #[test]
    fn test_license_response_carries_env_key_active() {
        let json = json::to_value(&LicenseResponse {
            key: None,
            license: None,
            installation_id: String::new(),
            expired: false,
            ingestion_used: 0.0,
            ingestion_exceeded: 0,
            waivers: Vec::new(),
            decision: LicenseDecision::default(),
            base: LicenseDecision::default(),
            evaluated_at: 0,
            env_key_active: true,
            env_key_in_use: true,
            can_update_license: false,
        })
        .unwrap();
        assert_eq!(json["env_key_active"], true);
        assert_eq!(json["env_key_in_use"], true);
    }

    fn rollback(reason: RollbackReason, loaded_rev: i64, pasted_rev: i64) -> Rollback {
        Rollback {
            reason,
            license_id: "lic-1".into(),
            loaded_rev,
            pasted_rev,
        }
    }

    fn waiver(id: &str, ends_at: i64) -> Waiver {
        let mut w: Waiver = json::from_value(scoped_waiver_json(id, INSTANCE_ID)).unwrap();
        w.ends_at = ends_at;
        w
    }

    #[test]
    fn rollback_body_names_both_revs_and_keeps_a_numeric_code() {
        let body = json::to_value(rollback_body(&rollback(
            RollbackReason::RevRollback,
            1_760_918_400_000_000,
            1_760_400_000_000_000,
        )))
        .unwrap();
        assert_eq!(
            body,
            json::json!({
                "code": 409,
                "message": "A newer key for this license is already applied (issued 2025-10-20).",
                "reason": "rev_rollback",
                "license_id": "lic-1",
                "loaded_rev": 1_760_918_400_000_000_i64,
                "pasted_rev": 1_760_400_000_000_000_i64,
            })
        );
        for (reason, name) in [
            (RollbackReason::RevConflict, "rev_conflict"),
            (RollbackReason::Superseded, "superseded"),
        ] {
            let body = json::to_value(rollback_body(&rollback(reason, 5, 5))).unwrap();
            assert_eq!(
                (body["code"].as_u64(), body["reason"].as_str()),
                (Some(409), Some(name))
            );
        }
    }

    #[test]
    fn rollback_body_for_rev_zero_has_no_date() {
        let legacy = rollback_body(&rollback(
            RollbackReason::RevRollback,
            1_760_918_400_000_000,
            0,
        ));
        assert_eq!(legacy.pasted_rev, Some(0));
        assert!(!legacy.message.contains("1970"), "{}", legacy.message);
        let undated = rollback_body(&rollback(RollbackReason::RevConflict, 0, 0));
        assert!(!undated.message.contains("issued"), "{}", undated.message);
        assert!(!undated.message.contains("1970"), "{}", undated.message);
    }

    #[test]
    fn env_key_conflict_body_carries_its_reason() {
        let body = json::to_value(env_conflict_body(&lic("lic-1", 3))).unwrap();
        assert_eq!(body["code"], 409);
        assert_eq!(body["reason"], "env_key_conflict");
        assert_eq!(body["message"], ENV_KEY_CONFLICT_MSG);
        assert_eq!(body["license_id"], "lic-1");
        assert!(body["loaded_rev"].is_null() && body["pasted_rev"].is_null());
    }

    #[test]
    fn waiver_diff_lists_added_and_removed_for_the_same_license() {
        let mut loaded = lic("lic-1", 1);
        loaded.waivers = vec![
            waiver("wv_keep", 10),
            waiver("wv_gone", 10),
            waiver("wv_edit", 10),
        ];
        let mut pasted = lic("lic-1", 2);
        pasted.waivers = vec![
            waiver("wv_keep", 10),
            waiver("wv_edit", 20),
            waiver("wv_new", 10),
        ];
        let (added, removed) = waiver_diff(Some(&loaded), &pasted);
        let ids = |ws: &[Waiver]| ws.iter().map(|w| w.id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&added), ["wv_edit", "wv_new"]);
        assert_eq!(ids(&removed), ["wv_gone", "wv_edit"]);
        assert_eq!(added[0].ends_at, 20);
        assert_eq!(removed[1].ends_at, 10);
    }

    #[test]
    fn waiver_diff_for_another_license_lists_all_pasted_as_added() {
        let loaded = lic("lic-1", 1);
        let pasted = lic("lic-2", 1);
        let (added, removed) = waiver_diff(Some(&loaded), &pasted);
        assert_eq!(added, pasted.waivers);
        assert!(removed.is_empty());
        let (added, removed) = waiver_diff(None, &pasted);
        assert_eq!((added.len(), removed.len()), (2, 0));
    }

    #[test]
    fn key_check_response_hides_scoped_installations_for_non_root() {
        let loaded = lic("lic-1", 1);
        let mut pasted = lic("lic-1", 2);
        pasted.waivers.push(waiver("wv_new", 10));
        let check = |is_root| {
            json::to_value(key_check_response(
                "accept",
                KEY_ACCEPTED_MSG.to_string(),
                Some(1),
                Some(&loaded),
                &pasted,
                is_root,
            ))
            .unwrap()
        };
        let viewer = check(false);
        assert_eq!(viewer["waivers_added"][0]["id"], "wv_new");
        assert!(viewer["waivers_added"][0]["installation_id"].is_null());
        assert!(!viewer.to_string().contains(INSTANCE_ID), "{viewer}");
        assert_eq!(
            (
                &viewer["dry_run"],
                &viewer["same_license"],
                &viewer["loaded_rev"],
                &viewer["pasted_rev"]
            ),
            (
                &json::json!(true),
                &json::json!(true),
                &json::json!(1),
                &json::json!(2)
            )
        );
        let root = check(true);
        assert_eq!(root["waivers_added"][0]["installation_id"], INSTANCE_ID);
        let other = json::to_value(key_check_response(
            ENV_KEY_CONFLICT,
            ENV_KEY_CONFLICT_MSG.to_string(),
            None,
            Some(&loaded),
            &lic("lic-2", 1),
            false,
        ))
        .unwrap();
        assert_eq!(other["outcome"], "env_key_conflict");
        assert_eq!(other["same_license"], false);
        assert!(other["loaded_rev"].is_null());
        assert_eq!(other["waivers_added"].as_array().map(Vec::len), Some(2));
    }

    #[test]
    fn verdict_outcome_names_the_refusal() {
        assert_eq!(verdict_outcome(&Ok(())).0, "accept");
        let r = rollback(RollbackReason::RevRollback, 9, 5);
        assert_eq!(
            verdict_outcome(&Err(r.clone())),
            ("rev_rollback", rollback_body(&r).message)
        );
    }

    #[test]
    fn issued_on_formats_a_rev_and_is_empty_for_zero() {
        assert_eq!(issued_on(1_760_918_400_000_000), "2025-10-20");
        assert_eq!(issued_on(0), "");
        assert_eq!(issued_on(-5), "");
    }

    #[test]
    fn dry_run_query_defaults_to_false() {
        let query = |uri: &str| {
            axum::extract::Query::<StoreLicenseQuery>::try_from_uri(&uri.parse().unwrap())
                .unwrap()
                .0
                .dry_run
        };
        assert!(!query("http://o2/api/license"));
        assert!(!query("http://o2/api/license?dry_run=false"));
        assert!(query("http://o2/api/license?dry_run=true"));
        assert!(!StoreLicenseQuery::default().dry_run);
    }

    // a watcher fills these caches on a running node; a miss here would go to the database
    fn join(org_id: &str, email: &str, role: UserRole) {
        common::infra::config::USERS.insert(
            email.to_string(),
            infra::table::users::UserRecord {
                email: email.to_string(),
                first_name: "F".to_string(),
                last_name: "L".to_string(),
                password: "hash".to_string(),
                salt: "salt".to_string(),
                is_root: role == UserRole::Root,
                password_ext: None,
                user_type: config::meta::user::UserType::Internal,
                created_at: 0,
                updated_at: 0,
                must_reset_password: false,
                password_reset_reason: None,
                flagged_at: None,
                password_updated_at: None,
            },
        );
        common::infra::config::ORG_USERS.insert(
            format!("{org_id}/{email}"),
            infra::table::org_users::OrgUserRecord {
                role,
                token: "token".to_string(),
                rum_token: None,
                org_id: org_id.to_string(),
                email: email.to_string(),
                created_at: 0,
                allow_static_token: true,
            },
        );
    }

    #[test]
    fn test_the_update_flag_checks_the_route_the_middleware_checks() {
        let route = refresh_route().expect("license/refresh is in the route table");
        assert!(!route.bypass_check);
        assert_eq!(route.method, "POST");
        assert_eq!(route.org_id, config::META_ORG_ID);
        assert_eq!(route.o2_type, "license:_meta");
    }

    #[tokio::test]
    async fn test_root_may_update_the_license_whatever_the_checks_say() {
        join("default", "lw-root@flag.test", UserRole::Root);
        assert!(can_update_license("lw-root@flag.test", false, |_, _| async { false }).await);
    }

    #[tokio::test]
    async fn test_the_route_check_gets_what_the_middleware_checks() {
        join("_meta", "lw-editor@flag.test", UserRole::Editor);
        let seen = std::sync::Mutex::new(None);
        let allowed = can_update_license("lw-editor@flag.test", true, |auth, role| {
            *seen.lock().unwrap() = Some((auth.method, auth.o2_type, auth.org_id, role));
            async { true }
        })
        .await;
        assert!(allowed);
        let seen = seen.into_inner().unwrap().expect("route check ran");
        assert_eq!(
            seen,
            (
                "POST".to_string(),
                "license:_meta".to_string(),
                "_meta".to_string(),
                UserRole::Editor
            )
        );
    }

    #[tokio::test]
    async fn test_a_meta_member_the_route_check_denies_gets_no_refresh() {
        join("_meta", "lw-viewer@flag.test", UserRole::Viewer);
        assert!(!can_update_license("lw-viewer@flag.test", true, |_, _| async { false }).await);
    }

    #[tokio::test]
    async fn test_no_refresh_without_the_handler_check_or_a_cached_meta_role() {
        join("_meta", "lw-admin@flag.test", UserRole::Admin);
        assert!(!can_update_license("lw-admin@flag.test", false, |_, _| async { true }).await);
        join("lw-acme", "lw-member@flag.test", UserRole::Admin);
        assert!(!can_update_license("lw-member@flag.test", true, |_, _| async { true }).await);
    }
}
