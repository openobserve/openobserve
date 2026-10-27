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
    BelowHwm, HwmRaise, KeyCommitFence, LICENSE_DB_KEY, License, LicenseDecision, LicenseStatus,
    RefreshBusy, RefreshReport, RefreshStatus, Rollback, RollbackReason, Waiver, check_license,
    click_refresh, get_license, judge_paste, load_rev_hwm, paste_superseded,
    pasted_key_supersedes_env, prepare_key_commit, refresh_status, rev_hwm_warning,
    rotate_instance_key, undo_raise,
};
use openobserve_api_common::extractors::Headers;
use openobserve_core::auth::{AuthExtractor, UserEmail};
use serde::{Deserialize, Serialize};

use crate::common::meta::http::HttpResponse as MetaHttpResponse;

const ENV_KEY_CONFLICT_MSG: &str = "This instance uses the license key in the O2_LICENSE_KEY environment variable, and that key stays in use. Only a newer key for the same license, such as one carrying new waivers, can be pasted over it. To use any other key, put it in O2_LICENSE_KEY and restart.";
const ENV_KEY_CONFLICT: &str = "env_key_conflict";
const KEY_CHANGED_MSG: &str = "Another license key was applied while this one was being checked. Reload the license page and paste the key again.";
const KEY_CHANGED: &str = "key_changed";
const STORE_OUTCOME_UNKNOWN_MSG: &str = "The license key may or may not have been saved: storing it failed and it could not be read back. Paste the same key again; that is safe.";
const KEY_ACCEPTED: &str = "accept";
const KEY_ACCEPTED_MSG: &str = "This key can be applied.";

#[derive(Serialize)]
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
    #[serde(skip_serializing_if = "Option::is_none")]
    input: Option<o2_enterprise::enterprise::license::LicenseInput>,
    env_key_active: bool,
    /// Whether the loaded key is the `O2_LICENSE_KEY` one, i.e. no pasted key superseded it.
    env_key_in_use: bool,
    /// Whether `POST /license/refresh` would pass both its route check and its handler check.
    can_update_license: bool,
    rev_hwm_warning: Option<BelowHwm>,
    refresh: RefreshStatus,
}

#[derive(Serialize)]
struct RefreshBody {
    limits_refreshed: bool,
    #[serde(flatten)]
    report: RefreshReport,
    /// Unix microseconds of this click's own attempt, matching `refresh.last_attempt_at`.
    #[serde(skip_serializing_if = "Option::is_none")]
    attempt_at: Option<i64>,
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

fn key_changed_body(pasted: &License) -> RollbackBody {
    RollbackBody {
        code: StatusCode::CONFLICT.as_u16(),
        message: KEY_CHANGED_MSG.to_string(),
        reason: KEY_CHANGED,
        license_id: pasted.license_id.clone(),
        loaded_rev: None,
        pasted_rev: Some(pasted.rev),
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

async fn key_landed<R, RF>(raw_key: &str, read_back: R) -> Result<bool, infra::errors::Error>
where
    R: FnOnce() -> RF,
    RF: std::future::Future<Output = Result<Option<bytes::Bytes>, infra::errors::Error>>,
{
    Ok(read_back()
        .await?
        .is_some_and(|stored| stored.as_ref() == raw_key.as_bytes()))
}

// a write can commit before its acknowledgement is lost, so only a proven miss undoes the raise
async fn undo_unless_landed<R, RF>(
    raise: Option<&HwmRaise>,
    raw_key: &str,
    read_back: R,
    error: anyhow::Error,
) -> Option<Response>
where
    R: FnOnce() -> RF,
    RF: std::future::Future<Output = Result<Option<bytes::Bytes>, infra::errors::Error>>,
{
    match key_landed(raw_key, read_back).await {
        Ok(true) => {
            log::warn!("[LICENSE] the key landed despite its store error : {error}");
            return None;
        }
        Ok(false) => {
            if let Some(raise) = raise
                && let Err(undo) = undo_raise(raise).await
            {
                log::error!("[LICENSE] could not undo the rev high-water mark raise : {undo}");
            }
        }
        Err(e) => {
            log::error!("[LICENSE] cannot read back the license key, keeping the rev raise : {e}");
            return Some(MetaHttpResponse::internal_error(format!(
                "{STORE_OUTCOME_UNKNOWN_MSG} Store error: {error}"
            )));
        }
    }
    Some(MetaHttpResponse::internal_error(error))
}

// the gate raises the hwm before the key lands, so a failed store must lower it again
async fn store_gated<C, CF, R, RF>(
    pasted: &License,
    raw_key: &str,
    commit: C,
    read_back: R,
) -> Response
where
    C: FnOnce(KeyCommitFence) -> CF,
    CF: std::future::Future<Output = anyhow::Result<bool>>,
    R: FnOnce() -> RF,
    RF: std::future::Future<Output = Result<Option<bytes::Bytes>, infra::errors::Error>>,
{
    let (raise, fence) = match prepare_key_commit(pasted).await {
        Ok(Ok(prepared)) => prepared,
        Ok(Err(r)) => return (StatusCode::CONFLICT, Json(rollback_body(&r))).into_response(),
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let committed = match commit(fence).await {
        Ok(committed) => committed,
        Err(e) => {
            return match undo_unless_landed(raise.as_ref(), raw_key, read_back, e).await {
                Some(failed) => failed,
                None => reload_nodes().await,
            };
        }
    };
    // a landed write whose acknowledgement was lost also reports a moved revision
    if !committed {
        match key_landed(raw_key, read_back).await {
            Ok(true) => {}
            // the raise may already back a newer paste's key, so a stale judgment never undoes it
            Ok(false) => {
                return (StatusCode::CONFLICT, Json(key_changed_body(pasted))).into_response();
            }
            Err(e) => {
                log::error!(
                    "[LICENSE] cannot read back the license key after a moved revision : {e}"
                );
                return MetaHttpResponse::internal_error(STORE_OUTCOME_UNKNOWN_MSG);
            }
        }
    }
    reload_nodes().await
}

async fn reload_nodes() -> Response {
    match license::update().await {
        Ok(_) => (StatusCode::CREATED, Json("")).into_response(),
        Err(e) => MetaHttpResponse::internal_error(e),
    }
}

async fn stored_license_key() -> Result<Option<bytes::Bytes>, infra::errors::Error> {
    infra::db::get_db()
        .await
        .get_if_exists(LICENSE_DB_KEY)
        .await
}

async fn preview_key(pasted: &License, loaded: Option<&License>, is_root: bool) -> Response {
    let hwm = match load_rev_hwm().await {
        Ok(hwm) => hwm,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let verdict = match judge_paste(&hwm, pasted) {
        Ok(verdict) => verdict,
        Err(e) => return MetaHttpResponse::internal_error(e),
    };
    let (outcome, message) = verdict_outcome(&verdict);
    let hwm_rev = hwm.entry(&pasted.license_id).ok().flatten().map(|e| e.rev);
    MetaHttpResponse::json(key_check_response(
        outcome, message, hwm_rev, loaded, pasted, is_root,
    ))
}

async fn viewer_refresh_status<F, Fut>(
    is_root: bool,
    is_license_admin: bool,
    redact: bool,
    status: F,
) -> RefreshStatus
where
    F: FnOnce(bool, bool, bool) -> Fut,
    Fut: std::future::Future<Output = RefreshStatus>,
{
    status(is_root, is_license_admin, is_root && !redact).await
}

fn refresh_response(
    limits_refreshed: bool,
    report: Result<RefreshReport, RefreshBusy>,
    attempt_at: Option<i64>,
) -> Response {
    match report {
        Ok(report) => MetaHttpResponse::json(RefreshBody {
            limits_refreshed,
            report,
            attempt_at,
        }),
        Err(RefreshBusy) => (
            StatusCode::CONFLICT,
            Json(serde_json::json!({
                "code": 409,
                "reason": "refresh_in_progress",
                "message": "A license refresh is already running. Try again in a moment.",
                "limits_refreshed": limits_refreshed,
            })),
        )
            .into_response(),
    }
}

// the state is cluster-wide, so a later read may hold another node's attempt or an older one
fn own_attempt_at(
    before: Option<i64>,
    after: &RefreshStatus,
    user: &str,
    report: &RefreshReport,
) -> Option<i64> {
    let at = after
        .last_attempt_at
        .filter(|at| before.is_none_or(|before| *at > before))?;
    let same_outcome =
        serde_json::to_value(&after.last_outcome).ok() == serde_json::to_value(Some(report)).ok();
    (after.last_attempt_by.as_deref() == Some(user) && same_outcome).then_some(at)
}

async fn attempt_status() -> RefreshStatus {
    refresh_status(true, true, false).await
}

async fn click_response<Fut>(user: &str, limits_refreshed: bool, click: Fut) -> Response
where
    Fut: std::future::Future<Output = Result<RefreshReport, RefreshBusy>>,
{
    let before = attempt_status().await.last_attempt_at;
    let report = click.await;
    let attempt_at = match &report {
        Ok(report) => own_attempt_at(before, &attempt_status().await, user, report),
        Err(RefreshBusy) => None,
    };
    refresh_response(limits_refreshed, report, attempt_at)
}

pub async fn get_license_info(Headers(email): Headers<UserEmail>) -> Response {
    let o2_cfg = o2_enterprise::enterprise::common::config::get_config();

    // Any authenticated user may call this; viewer_license_fields trims the response by role.
    let (loaded, status, ingestion_used) =
        o2_enterprise::enterprise::license::license_snapshot().await;
    let expired = loaded
        .as_ref()
        .is_some_and(|(_, l)| l.expires_at <= chrono::Utc::now().timestamp_micros());
    let (key, license) = match loaded {
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

    let input = status.input.clone();
    let (waivers, decision, base, evaluated_at) = license_status_fields(status, is_root);

    let res = LicenseResponse {
        key,
        license,
        installation_id,
        expired,
        ingestion_exceeded: decision.exceeded_days as u8,
        ingestion_used: ingestion_used * 100.0,
        waivers,
        decision,
        base,
        evaluated_at,
        input,
        env_key_active: env_key_active(&o2_cfg.common.license_key),
        env_key_in_use,
        // check_permissions ignores is_external
        can_update_license: can_update_license(&email.user_id, is_license_admin, |auth, role| {
            openobserve_core::authz::check_permissions(&email.user_id, auth, role, false)
        })
        .await,
        rev_hwm_warning: rev_hwm_warning(),
        refresh: viewer_refresh_status(
            is_root,
            is_license_admin,
            o2_cfg.common.redact_license_key,
            refresh_status,
        )
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

    if let Some(rollback) = paste_superseded(loaded.as_ref(), &req.key) {
        if q.dry_run {
            return MetaHttpResponse::json(key_check_response(
                rollback.reason.as_str(),
                rollback_body(&rollback).message,
                Some(rollback.loaded_rev),
                loaded.as_ref(),
                &req.key,
                is_root,
            ));
        }
        return (StatusCode::CONFLICT, Json(rollback_body(&rollback))).into_response();
    }

    if let Err(e) = check_license(&req.raw_key, &req.key).await {
        return MetaHttpResponse::bad_request(e.to_string());
    };

    if q.dry_run {
        return preview_key(&req.key, loaded.as_ref(), is_root).await;
    }

    let raw_key = req.raw_key;
    let candidate = raw_key.clone();
    store_gated(
        &req.key,
        &raw_key,
        |fence| async move { fence.commit(&candidate).await },
        stored_license_key,
    )
    .await
}

pub async fn refresh_license_limits(Headers(user_email): Headers<UserEmail>) -> Response {
    let email = user_email.user_id;
    if check_license_permission(&email, "PUT").await.is_err() {
        return MetaHttpResponse::forbidden("Unauthorized Access to license");
    }

    let limits_refreshed = get_license().await.is_some() && license::update().await.is_ok();
    let click = click_refresh(&email, || async { license::update().await });
    click_response(&email, limits_refreshed, click).await
}

pub async fn rotate_license_key(Headers(user_email): Headers<UserEmail>) -> Response {
    let email = user_email.user_id;
    if check_license_permission(&email, "PUT").await.is_err() {
        return MetaHttpResponse::forbidden("Unauthorized Access to license");
    }

    let limits_refreshed = get_license().await.is_some() && license::update().await.is_ok();
    click_response(&email, limits_refreshed, rotate_instance_key(&email)).await
}

#[cfg(test)]
mod tests {
    use config::utils::{base64, json};
    use o2_enterprise::enterprise::license::{
        BelowHwm, Block, KeySource, LICENSE_REV_HWM_KEY, TEST_STATICS_LOCK, gate_and_raise,
        set_rev_hwm_warning_for_tests,
    };

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
        (key, License::from_claims_for_tests(payload).unwrap())
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
        let input = status.input.clone();
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
            input,
            env_key_active: false,
            env_key_in_use: false,
            can_update_license: is_license_admin,
            rev_hwm_warning: None,
            refresh: refresh_status_fixture(),
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
        let input = status.input.clone();
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
            input,
            env_key_active: false,
            env_key_in_use: false,
            can_update_license: false,
            rev_hwm_warning: None,
            refresh: refresh_status_fixture(),
        })
        .unwrap();
        assert!(json["rev_hwm_warning"].is_null());
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

    async fn get_with_warning(
        store: &tokio::sync::MutexGuard<'_, ()>,
        source: KeySource,
    ) -> json::Value {
        let get = || async {
            body_of(
                get_license_info(Headers(UserEmail {
                    user_id: STORE_ROOT.to_string(),
                }))
                .await,
            )
            .await
        };
        set_rev_hwm_warning_for_tests(
            store,
            Some(BelowHwm {
                source,
                license_id: "lic-1".into(),
                loaded_rev: 1_760_400_000_000_000,
                hwm_rev: 1_760_918_400_000_000,
            }),
        );
        let (status, body) = get().await;
        set_rev_hwm_warning_for_tests(store, None);
        assert_eq!(status, StatusCode::OK, "{body}");
        let (_, cleared) = get().await;
        assert!(cleared["rev_hwm_warning"].is_null(), "{cleared}");
        body["rev_hwm_warning"].clone()
    }

    #[tokio::test]
    async fn get_reports_the_env_source_warning() {
        let store = store_setup().await;
        let warning = get_with_warning(&store, KeySource::Env).await;
        assert_eq!(warning["source"], "env");
        assert_eq!(warning["license_id"], "lic-1");
        assert_eq!(warning["loaded_rev"], 1_760_400_000_000_000_i64);
        assert_eq!(warning["hwm_rev"], 1_760_918_400_000_000_i64);
    }

    #[tokio::test]
    async fn get_reports_the_db_source_warning() {
        let store = store_setup().await;
        let warning = get_with_warning(&store, KeySource::Db).await;
        assert_eq!(warning["source"], "db");
        assert_eq!(warning["loaded_rev"], 1_760_400_000_000_000_i64);
        assert_eq!(warning["hwm_rev"], 1_760_918_400_000_000_i64);
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
            input: None,
            env_key_active: true,
            env_key_in_use: true,
            can_update_license: false,
            rev_hwm_warning: None,
            refresh: refresh_status_fixture(),
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

    const STORE_ROOT: &str = "lw-store-root@store.test";

    // store tests share the meta DB and its license keys, and the hooks share the license statics
    async fn store_setup() -> tokio::sync::MutexGuard<'static, ()> {
        let guard = TEST_STATICS_LOCK.lock().await;
        config::cache_instance_id(INSTANCE_ID);
        infra::db::create_table().await.unwrap();
        join(config::DEFAULT_ORG, STORE_ROOT, UserRole::Root);
        let db = infra::db::get_db().await;
        *o2_enterprise::enterprise::license::LICENSE
            .get_or_init(|| tokio::sync::RwLock::new(None))
            .write()
            .await = None;
        for key in [
            LICENSE_DB_KEY,
            LICENSE_REV_HWM_KEY,
            o2_enterprise::enterprise::license::LICENSE_INSTANCE_KEY,
            o2_enterprise::enterprise::license::LICENSE_REFRESH_STATE_KEY,
        ] {
            let _ = db.delete(key, false, false, None).await;
        }
        guard
    }

    async fn stored(key: &str) -> Option<json::Value> {
        let raw = infra::db::get_db()
            .await
            .get_if_exists(key)
            .await
            .unwrap()?;
        Some(json::from_slice(&raw).unwrap_or_else(|_| json::json!(String::from_utf8_lossy(&raw))))
    }

    async fn body_of(resp: Response) -> (StatusCode, json::Value) {
        let status = resp.status();
        let bytes = axum::body::to_bytes(resp.into_body(), usize::MAX)
            .await
            .unwrap();
        (
            status,
            json::from_slice(&bytes).unwrap_or(json::Value::Null),
        )
    }

    async fn paste(license: License, dry_run: bool) -> (StatusCode, json::Value) {
        body_of(
            store_license(
                Headers(UserEmail {
                    user_id: STORE_ROOT.to_string(),
                }),
                axum::extract::Query(StoreLicenseQuery { dry_run }),
                axum::Json(SaveLicenseRequest {
                    key: license,
                    raw_key: "eyJ.store-test.key".to_string(),
                }),
            )
            .await,
        )
        .await
    }

    async fn load_refresh_license(environment: &str) {
        let license = License::from_claims_for_tests(json::json!({
            "version": 2,
            "installation_id": INSTANCE_ID,
            "license_id": "lic-online",
            "active": true,
            "created_at": 0,
            "expires_at": i64::MAX,
            "msv": "0.1.0",
            "company": "acme",
            "address": "",
            "contact_name": "",
            "contact_email": "",
            "additional_emails": [],
            "base_urls": [],
            "limits": {},
            "environment_type": environment,
        }))
        .unwrap();
        *o2_enterprise::enterprise::license::LICENSE
            .get_or_init(|| tokio::sync::RwLock::new(None))
            .write()
            .await = Some(("test-loaded-key".into(), license));
    }

    async fn refresh_as(email: &str) -> (StatusCode, json::Value) {
        body_of(
            refresh_license_limits(Headers(UserEmail {
                user_id: email.into(),
            }))
            .await,
        )
        .await
    }

    #[tokio::test]
    async fn refresh_without_put_permission_is_403_and_makes_no_ls_request() {
        let _store = store_setup().await;
        load_refresh_license("online").await;
        let (status, _) = refresh_as("no-license-permission@test").await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored(o2_enterprise::enterprise::license::LICENSE_INSTANCE_KEY).await,
            None
        );
        assert_eq!(
            stored(o2_enterprise::enterprise::license::LICENSE_REFRESH_STATE_KEY).await,
            None
        );
    }

    #[tokio::test]
    async fn refresh_while_the_lock_is_held_is_409_refresh_in_progress_with_limits_refreshed() {
        let _store = store_setup().await;
        load_refresh_license("online").await;
        let _held = o2_enterprise::enterprise::license::hold_refresh_lock_for_tests().await;
        let (status, body) = refresh_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(
            body,
            json::json!({
                "code": 409,
                "reason": "refresh_in_progress",
                "message": "A license refresh is already running. Try again in a moment.",
                "limits_refreshed": true,
            })
        );
    }

    #[tokio::test]
    async fn airgapped_licence_refreshes_limits_and_reports_airgapped() {
        let _store = store_setup().await;
        load_refresh_license("airgapped").await;
        let (status, body) = refresh_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["limits_refreshed"], true);
        assert_eq!(body["error"], "airgapped");
        assert!(body["outcome"].is_null());
    }

    #[tokio::test]
    async fn refresh_body_serialises_every_report_field() {
        let _store = store_setup().await;
        let (status, body) = refresh_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::OK);
        let fields = [
            "limits_refreshed",
            "outcome",
            "error",
            "detail",
            "old_rev",
            "new_rev",
            "waivers_added",
            "waivers_removed",
            "renewed",
            "successor_available",
            "retry_after_s",
            "rotate_requested",
        ];
        assert_eq!(body.as_object().map(|o| o.len()), Some(fields.len()));
        for field in fields {
            assert!(body.get(field).is_some(), "missing {field}: {body}");
        }
        assert!(body.get("stored").is_none());
        assert!(body["outcome"].is_null());
        assert_eq!(body["waivers_added"], 0);
        assert_eq!(body["rotate_requested"], false);
    }

    #[tokio::test]
    async fn no_licence_reports_no_license_and_no_lock() {
        let _store = store_setup().await;
        let _held = o2_enterprise::enterprise::license::hold_refresh_lock_for_tests().await;
        let (status, body) = refresh_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["limits_refreshed"], false);
        assert_eq!(body["error"], "no_license");
    }

    #[tokio::test]
    async fn refresh_returns_its_own_attempt_time_and_none_when_refused_before_one() {
        let _store = store_setup().await;
        load_refresh_license("online").await;
        // an unloaded stored key makes the click record a pending_reload attempt offline
        infra::db::get_db()
            .await
            .put(LICENSE_DB_KEY, "pending-other-key".into(), false, None)
            .await
            .unwrap();
        let (status, body) = refresh_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["error"], "pending_reload");
        let attempt_at = body["attempt_at"].as_i64().expect("attempt_at");
        let (_, got) = get_as(STORE_ROOT).await;
        assert_eq!(got["refresh"]["last_attempt_at"].as_i64(), Some(attempt_at));

        load_refresh_license("airgapped").await;
        let (status, body) = refresh_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["error"], "airgapped");
        assert!(body.get("attempt_at").is_none(), "{body}");
        let (_, got) = get_as(STORE_ROOT).await;
        assert_eq!(got["refresh"]["last_attempt_at"].as_i64(), Some(attempt_at));
    }

    #[test]
    fn own_attempt_at_takes_only_a_newer_attempt_matching_this_click() {
        let report = RefreshReport {
            outcome: Some(o2_enterprise::enterprise::license::RefreshOutcome::Unchanged),
            ..Default::default()
        };
        let after = |at: Option<i64>, by: &str, outcome: Option<RefreshReport>| RefreshStatus {
            last_attempt_at: at,
            last_attempt_by: Some(by.into()),
            last_outcome: outcome,
            ..refresh_status_fixture()
        };
        let mine = after(Some(20), "me@test", Some(report.clone()));
        assert_eq!(
            own_attempt_at(Some(10), &mine, "me@test", &report),
            Some(20)
        );
        assert_eq!(own_attempt_at(None, &mine, "me@test", &report), Some(20));
        assert_eq!(own_attempt_at(Some(20), &mine, "me@test", &report), None);
        assert_eq!(own_attempt_at(Some(30), &mine, "me@test", &report), None);
        let other_user = after(Some(20), "other@test", Some(report.clone()));
        assert_eq!(
            own_attempt_at(Some(10), &other_user, "me@test", &report),
            None
        );
        let other_outcome = after(Some(20), "me@test", Some(RefreshReport::default()));
        assert_eq!(
            own_attempt_at(Some(10), &other_outcome, "me@test", &report),
            None
        );
        assert_eq!(
            own_attempt_at(Some(10), &after(None, "me@test", None), "me@test", &report),
            None
        );
    }

    fn refresh_status_fixture() -> o2_enterprise::enterprise::license::RefreshStatus {
        o2_enterprise::enterprise::license::RefreshStatus {
            mode: "online",
            server_host: "license.example".into(),
            registration: o2_enterprise::enterprise::license::Registration::Registered,
            key_id: Some("root-key-id".into()),
            key_created: true,
            key_at_rest: "plaintext",
            rotate_recommended: false,
            rotation_unsettled: true,
            last_attempt_at: Some(10),
            last_attempt_by: Some("license-admin@test".into()),
            last_success_at: Some(9),
            last_status: Some("updated".into()),
            last_error: None,
            last_error_detail: String::new(),
            last_outcome: None,
            successor_available: None,
            stored_key: Some("fetched-key-fixture".into()),
        }
    }

    async fn get_as(email: &str) -> (StatusCode, json::Value) {
        body_of(
            get_license_info(Headers(UserEmail {
                user_id: email.into(),
            }))
            .await,
        )
        .await
    }

    #[tokio::test]
    async fn get_carries_refresh_without_counter_and_key_id_for_non_root() {
        let _store = store_setup().await;
        let db = infra::db::get_db().await;
        db.put(
            o2_enterprise::enterprise::license::LICENSE_INSTANCE_KEY,
            json::to_vec(
                &json::json!({"v": 1, "alg": "Ed25519", "key_id": "root-key-id",
                "public_jwk": {"kty": "OKP", "crv": "Ed25519", "x": "test-public-key"},
                "private": "test-private-fixture", "created_at": 1}),
            )
            .unwrap()
            .into(),
            false,
            None,
        )
        .await
        .unwrap();
        db.put(
            o2_enterprise::enterprise::license::LICENSE_REFRESH_STATE_KEY,
            json::to_vec(&json::json!({"v": 1, "counter": 17,
                "last_attempt_by": "license-admin@test"}))
            .unwrap()
            .into(),
            false,
            None,
        )
        .await
        .unwrap();
        let (status, root) = get_as(STORE_ROOT).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(root["refresh"]["key_id"], "root-key-id");
        assert_eq!(root["refresh"]["last_attempt_by"], "license-admin@test");
        let (status, viewer) = get_as("license-viewer@test").await;
        assert_eq!(status, StatusCode::OK);
        let refresh = &viewer["refresh"];
        assert!(refresh.is_object(), "{viewer}");
        assert!(refresh["key_id"].is_null());
        assert!(refresh["last_attempt_by"].is_null());
        assert!(refresh["stored_key"].is_null());
        assert_eq!(refresh["key_created"], true);
        assert!(refresh["rotation_unsettled"].is_boolean());
        assert!(refresh.get("counter").is_none());
        assert!(root["refresh"].get("counter").is_none());
    }

    #[tokio::test]
    async fn stored_key_only_for_root_with_env_active_and_no_redaction() {
        for is_root in [false, true] {
            for is_admin in [false, true] {
                for redact in [false, true] {
                    for env_active in [false, true] {
                        let status = viewer_refresh_status(
                            is_root,
                            is_admin,
                            redact,
                            |show_id, show_actor, show_key| async move {
                                assert_eq!(show_id, is_root);
                                assert_eq!(show_actor, is_admin);
                                let mut status = refresh_status_fixture();
                                status.stored_key =
                                    status.stored_key.filter(|_| env_active && show_key);
                                status
                            },
                        )
                        .await;
                        assert_eq!(
                            status.stored_key.is_some(),
                            is_root && env_active && !redact
                        );
                    }
                }
            }
        }
    }

    #[tokio::test]
    async fn rotate_key_needs_put_permission() {
        let _store = store_setup().await;
        load_refresh_license("online").await;
        let (status, _) = body_of(
            rotate_license_key(Headers(UserEmail {
                user_id: "no-license-permission@test".into(),
            }))
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::FORBIDDEN);
        assert_eq!(
            stored(o2_enterprise::enterprise::license::LICENSE_INSTANCE_KEY).await,
            None
        );
    }

    #[tokio::test]
    async fn rotate_key_returns_409_while_locked() {
        let _store = store_setup().await;
        load_refresh_license("online").await;
        let _held = o2_enterprise::enterprise::license::hold_refresh_lock_for_tests().await;
        let (status, body) = body_of(
            rotate_license_key(Headers(UserEmail {
                user_id: STORE_ROOT.into(),
            }))
            .await,
        )
        .await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["code"], 409);
        assert_eq!(body["reason"], "refresh_in_progress");
        assert_eq!(body["limits_refreshed"], true);
    }

    async fn load_successor_for_paste() {
        load_refresh_license("online").await;
        let mut loaded = o2_enterprise::enterprise::license::LICENSE
            .get()
            .unwrap()
            .write()
            .await;
        let (_, license) = loaded.as_mut().unwrap();
        license.license_id = "lic-successor".into();
        license.rev = 100;
        license.supersedes = vec!["lic-ancestor".into()];
        infra::db::get_db()
            .await
            .put(LICENSE_DB_KEY, "loaded-successor-key".into(), false, None)
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn paste_of_a_superseded_licence_is_409_superseded() {
        let _store = store_setup().await;
        load_successor_for_paste().await;
        let before = stored(LICENSE_DB_KEY).await;
        let hwm = stored(LICENSE_REV_HWM_KEY).await;
        let (status, body) = paste(lic("lic-ancestor", 9), false).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(body["code"], 409);
        assert_eq!(body["reason"], "superseded");
        assert_eq!(body["license_id"], "lic-ancestor");
        assert_eq!(body["loaded_rev"], 100);
        assert_eq!(body["pasted_rev"], 9);
        assert_eq!(stored(LICENSE_DB_KEY).await, before);
        assert_eq!(stored(LICENSE_REV_HWM_KEY).await, hwm);
    }

    #[tokio::test]
    async fn dry_run_reports_superseded_without_writing() {
        let _store = store_setup().await;
        load_successor_for_paste().await;
        let before = stored(LICENSE_DB_KEY).await;
        let hwm = stored(LICENSE_REV_HWM_KEY).await;
        let (status, body) = paste(lic("lic-ancestor", 9), true).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["outcome"], "superseded");
        assert_eq!(body["license_id"], "lic-ancestor");
        assert_eq!(body["loaded_rev"], 100);
        assert_eq!(body["pasted_rev"], 9);
        assert_eq!(stored(LICENSE_DB_KEY).await, before);
        assert_eq!(stored(LICENSE_REV_HWM_KEY).await, hwm);
    }

    #[tokio::test]
    async fn store_fails_closed_on_an_unreadable_hwm_entry() {
        let _store = store_setup().await;
        let unreadable = br#"{"lic-1":{"rev":"x"},"lic-2":{"rev":3}}"#;
        infra::db::get_db()
            .await
            .put(LICENSE_REV_HWM_KEY, unreadable.to_vec().into(), false, None)
            .await
            .unwrap();
        for dry_run in [true, false] {
            let (status, body) = paste(lic("lic-1", 9), dry_run).await;
            assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
            let message = body["message"].as_str().unwrap_or_default();
            assert!(message.contains("unreadable"), "{body}");
        }
        assert_eq!(stored(LICENSE_DB_KEY).await, None);
        assert_eq!(
            stored(LICENSE_REV_HWM_KEY).await,
            Some(json::from_slice(unreadable).unwrap())
        );
    }

    fn store_failure() -> anyhow::Result<bool> {
        Err(anyhow::anyhow!("disk full"))
    }

    fn hwm_rev(hwm: &o2_enterprise::enterprise::license::RevHwm) -> Option<i64> {
        hwm.entry("lic-1").unwrap().map(|e| e.rev)
    }

    #[tokio::test]
    async fn a_failed_key_store_puts_the_hwm_back() {
        let _store = store_setup().await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let before = stored(LICENSE_REV_HWM_KEY).await;
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async { store_failure() },
            stored_license_key,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(stored(LICENSE_REV_HWM_KEY).await, before);
        assert_eq!(stored(LICENSE_DB_KEY).await, None);
        let (status, body) = paste(lic("lic-1", 5), true).await;
        assert_eq!(
            (status, body["outcome"].as_str()),
            (StatusCode::OK, Some("accept"))
        );
    }

    #[tokio::test]
    async fn a_key_write_that_landed_before_its_error_keeps_the_hwm() {
        let _store = store_setup().await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |fence| async move {
                assert!(fence.commit("key-9").await.unwrap());
                Err(anyhow::anyhow!("acknowledgement lost"))
            },
            stored_license_key,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        assert_eq!(stored(LICENSE_DB_KEY).await, Some(json::json!("key-9")));
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(9));
        let (status, body) = paste(lic("lic-1", 5), true).await;
        assert_eq!(
            (status, body["outcome"].as_str()),
            (StatusCode::OK, Some("rev_rollback"))
        );
    }

    #[tokio::test]
    async fn an_unreadable_key_after_a_failed_write_keeps_the_hwm() {
        let _store = store_setup().await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async { store_failure() },
            || async { Err(infra::errors::Error::Message("meta store down".to_string())) },
        )
        .await;
        let (status, body) = body_of(resp).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(
            body["message"].as_str(),
            Some(
                "The license key may or may not have been saved: storing it failed and it could not be read back. Paste the same key again; that is safe. Store error: disk full"
            )
        );
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(9));
    }

    #[tokio::test]
    async fn another_key_read_back_after_a_failed_write_puts_the_hwm_back() {
        let _store = store_setup().await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async { store_failure() },
            || async { Ok(Some(bytes::Bytes::from_static(b"key-5"))) },
        )
        .await;
        assert_eq!(resp.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(5));
    }

    #[tokio::test]
    async fn a_paste_judged_before_another_paste_landed_is_409_and_stores_nothing() {
        let _store = store_setup().await;
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |fence| async move {
                gate_and_raise(&lic("lic-1", 12)).await.unwrap().unwrap();
                infra::db::get_db()
                    .await
                    .put(LICENSE_DB_KEY, "key-12".into(), false, None)
                    .await
                    .unwrap();
                fence.commit("key-9").await
            },
            stored_license_key,
        )
        .await;
        let (status, body) = body_of(resp).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(
            (
                body["code"].as_u64(),
                body["reason"].as_str(),
                body["license_id"].as_str(),
                body["pasted_rev"].as_i64()
            ),
            (Some(409), Some("key_changed"), Some("lic-1"), Some(9))
        );
        assert_eq!(stored(LICENSE_DB_KEY).await, Some(json::json!("key-12")));
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(12));
    }

    #[tokio::test]
    async fn a_key_stored_after_the_judgment_is_never_overwritten() {
        let _store = store_setup().await;
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |fence| async move {
                infra::db::get_db()
                    .await
                    .put(LICENSE_DB_KEY, "other-key".into(), false, None)
                    .await
                    .unwrap();
                fence.commit("key-9").await
            },
            stored_license_key,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CONFLICT);
        assert_eq!(stored(LICENSE_DB_KEY).await, Some(json::json!("other-key")));
    }

    async fn license_reload_signalled() -> bool {
        infra::db::get_coordinator()
            .await
            .get_if_exists(db::license::LICENSE_KEY_PREFIX)
            .await
            .unwrap()
            .is_some()
    }

    #[tokio::test]
    async fn a_write_that_landed_but_lost_its_ack_is_stored_and_reloads_the_nodes() {
        let _store = store_setup().await;
        let coordinator = infra::db::get_coordinator().await;
        let _ = coordinator
            .delete(db::license::LICENSE_KEY_PREFIX, false, false, None)
            .await;
        assert!(!license_reload_signalled().await);
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |fence| async move {
                assert!(fence.commit("key-9").await.unwrap());
                Ok(false)
            },
            stored_license_key,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        assert_eq!(stored(LICENSE_DB_KEY).await, Some(json::json!("key-9")));
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(9));
        assert!(license_reload_signalled().await);
    }

    #[tokio::test]
    async fn a_write_that_landed_before_its_store_error_is_stored_and_reloads_the_nodes() {
        let _store = store_setup().await;
        let coordinator = infra::db::get_coordinator().await;
        let _ = coordinator
            .delete(db::license::LICENSE_KEY_PREFIX, false, false, None)
            .await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |fence| async move {
                assert!(fence.commit("key-9").await.unwrap());
                Err(anyhow::anyhow!("acknowledgement lost"))
            },
            stored_license_key,
        )
        .await;
        assert_eq!(resp.status(), StatusCode::CREATED);
        assert_eq!(stored(LICENSE_DB_KEY).await, Some(json::json!("key-9")));
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(9));
        assert!(license_reload_signalled().await);
    }

    #[tokio::test]
    async fn a_moved_revision_stays_409_when_another_key_or_none_is_read_back() {
        let _store = store_setup().await;
        let coordinator = infra::db::get_coordinator().await;
        let _ = coordinator
            .delete(db::license::LICENSE_KEY_PREFIX, false, false, None)
            .await;
        let other = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async { Ok(false) },
            || async { Ok(Some(bytes::Bytes::from_static(b"key-12"))) },
        )
        .await;
        let (status, body) = body_of(other).await;
        assert_eq!(
            (status, body["reason"].as_str()),
            (StatusCode::CONFLICT, Some("key_changed"))
        );
        let missing = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async { Ok(false) },
            || async { Ok(None) },
        )
        .await;
        assert_eq!(missing.status(), StatusCode::CONFLICT);
        assert!(!license_reload_signalled().await);
    }

    #[tokio::test]
    async fn a_moved_revision_with_an_unreadable_key_is_an_unknown_outcome() {
        let _store = store_setup().await;
        let coordinator = infra::db::get_coordinator().await;
        let _ = coordinator
            .delete(db::license::LICENSE_KEY_PREFIX, false, false, None)
            .await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let resp = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async { Ok(false) },
            || async { Err(infra::errors::Error::Message("meta store down".to_string())) },
        )
        .await;
        let (status, body) = body_of(resp).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
        assert_eq!(
            body["message"].as_str(),
            Some(
                "The license key may or may not have been saved: storing it failed and it could not be read back. Paste the same key again; that is safe."
            )
        );
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(9));
        assert!(!license_reload_signalled().await);
    }

    #[tokio::test]
    async fn an_identical_paste_that_stored_its_key_keeps_the_hwm() {
        let _store = store_setup().await;
        gate_and_raise(&lic("lic-1", 5)).await.unwrap().unwrap();
        let first = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async {
                let _ = store_gated(
                    &lic("lic-1", 9),
                    "key-9",
                    |fence| async move { fence.commit("key-9").await },
                    stored_license_key,
                )
                .await;
                store_failure()
            },
            || async { Ok(None) },
        )
        .await;
        assert_eq!(first.status(), StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(hwm_rev(&load_rev_hwm().await.unwrap()), Some(9));
    }

    #[tokio::test]
    async fn store_dry_run_writes_neither_the_key_nor_the_hwm() {
        let _store = store_setup().await;
        let (status, body) = paste(lic("lic-1", 9), true).await;
        assert_eq!(
            (status, body["outcome"].as_str()),
            (StatusCode::OK, Some("accept"))
        );
        assert_eq!(stored(LICENSE_DB_KEY).await, None);
        assert_eq!(stored(LICENSE_REV_HWM_KEY).await, None);
        gate_and_raise(&lic("lic-1", 9)).await.unwrap().unwrap();
        let hwm = stored(LICENSE_REV_HWM_KEY).await;
        for rev in [5, 12] {
            let (status, _) = paste(lic("lic-1", rev), true).await;
            assert_eq!(status, StatusCode::OK);
        }
        assert_eq!(stored(LICENSE_REV_HWM_KEY).await, hwm);
        assert_eq!(stored(LICENSE_DB_KEY).await, None);
    }

    #[tokio::test]
    async fn store_refuses_a_lower_rev_through_the_real_gate() {
        let _store = store_setup().await;
        gate_and_raise(&lic("lic-1", 9)).await.unwrap().unwrap();
        let (status, body) = paste(lic("lic-1", 5), false).await;
        assert_eq!(status, StatusCode::CONFLICT, "{body}");
        assert_eq!(
            (
                body["code"].as_u64(),
                body["reason"].as_str(),
                body["loaded_rev"].as_i64(),
                body["pasted_rev"].as_i64()
            ),
            (Some(409), Some("rev_rollback"), Some(9), Some(5))
        );
        assert_eq!(stored(LICENSE_DB_KEY).await, None);
    }

    #[tokio::test]
    async fn store_runs_the_gate_before_the_key_is_stored() {
        let _store = store_setup().await;
        let seen = std::sync::Mutex::new(None);
        let seen_by_commit = &seen;
        let _ = store_gated(
            &lic("lic-1", 9),
            "key-9",
            |_| async move {
                let hwm = load_rev_hwm().await.unwrap();
                *seen_by_commit.lock().unwrap() = Some(hwm_rev(&hwm));
                Ok(true)
            },
            stored_license_key,
        )
        .await;
        assert_eq!(seen.into_inner().unwrap(), Some(Some(9)));
        gate_and_raise(&lic("lic-1", 12)).await.unwrap().unwrap();
        let refused = store_gated(
            &lic("lic-1", 10),
            "key-10",
            |_| async { panic!("a refused key is never stored") },
            stored_license_key,
        )
        .await;
        assert_eq!(refused.status(), StatusCode::CONFLICT);
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
