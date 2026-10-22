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

//! Manages a workflow HTTP endpoint and mints, rotates, revokes and reveals its credentials.

use config::utils::time::now_micros;
use infra::{
    db::get_orm_client_rw,
    secrets::{self, PreparedSecret, SecretError, SecretMaterial, SecretOwnerKind},
    table::{
        cipher,
        entity::{
            workflow_http_trigger_credentials as credentials,
            workflow_http_trigger_requests as requests, workflow_http_triggers as triggers,
        },
        workflow_http_triggers::{
            self as http_triggers, AuthMode, CredentialKind, CredentialState, is_live,
        },
    },
};
use o2_enterprise::enterprise::common::config::get_config as get_o2_config;
use sea_orm::{
    ColumnTrait, ConnectionTrait, DbErr, EntityTrait, IntoActiveModel, QueryFilter, QueryOrder,
    Set, SqlErr, TransactionTrait, sea_query::Expr,
};

use super::{
    DEFAULT_MAX_BODY_BYTES, DEFAULT_TRIGGER_RPM,
    credentials::{self as minting, MintedSecret},
    payload::{EVENT_TYPE, HookInput, HookMeta, TRIGGER_SOURCE},
};

pub const OVERLAPS: [i64; 4] = [0, 3600, 86400, 604800];
pub const MIN_BODY_BYTES: i64 = 1024;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UpsertRequest {
    pub enabled: bool,
    pub auth_mode: AuthMode,
    pub max_body_bytes: Option<i64>,
    pub rate_limit_per_minute: Option<i32>,
}

#[derive(Debug)]
pub enum UpsertOutcome {
    Created {
        config: TriggerView,
        secret: MintedSecret,
    },
    Updated {
        config: TriggerView,
    },
    ModeSwitched {
        config: TriggerView,
        secret: MintedSecret,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct TriggerView {
    pub id: String,
    pub url: String,
    pub region_host: Option<String>,
    pub enabled: bool,
    #[schema(value_type = String)]
    pub auth_mode: AuthMode,
    pub max_body_bytes: i64,
    pub rate_limit_per_minute: i32,
    pub org_rate_limit_per_minute: u32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_invoked_at: Option<i64>,
    pub last_call: Option<LastCall>,
    pub secrets_encrypted_at_rest: bool,
    #[schema(value_type = Object)]
    pub rejections: serde_json::Value,
    pub credentials: Vec<CredentialView>,
    pub permissions: EndpointPermissions,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct CredentialView {
    pub id: String,
    #[schema(value_type = String)]
    pub kind: CredentialKind,
    pub display_prefix: String,
    #[schema(value_type = String)]
    pub state: CredentialState,
    pub expires_at: Option<i64>,
    pub created_by: String,
    pub creator_in_org: bool,
    pub created_at: i64,
    pub last_used_at: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct LastCall {
    pub run_id: String,
    pub status: String,
    pub received_at: i64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct EndpointPermissions {
    pub edit: bool,
    pub test: bool,
    /// `edit && require_credential_access` would pass.
    pub reveal: bool,
}

#[derive(Clone, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
pub struct RevealView {
    pub id: String,
    #[schema(value_type = String)]
    pub kind: CredentialKind,
    pub display_prefix: String,
    #[schema(value_type = String)]
    pub state: CredentialState,
    pub expires_at: Option<i64>,
    pub secret: String,
}

impl std::fmt::Debug for RevealView {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RevealView")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("display_prefix", &self.display_prefix)
            .field("state", &self.state)
            .field("expires_at", &self.expires_at)
            .field("secret", &"[REDACTED]")
            .finish()
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum ManageError {
    WorkflowNotFound,
    NotConfigured,
    InvalidLimit,
    InvalidOverlap,
    CredentialRetiring,
    CredentialNotFound,
    CredentialAccessRequired,
    Internal(String),
}

impl From<DbErr> for ManageError {
    fn from(e: DbErr) -> Self {
        Self::Internal(e.to_string())
    }
}

impl From<SecretError> for ManageError {
    fn from(e: SecretError) -> Self {
        Self::Internal(e.to_string())
    }
}

/// The caller and clock of one locked write; the region named here takes over as origin.
struct Writer<'a> {
    org_id: &'a str,
    workflow_id: &'a str,
    user_id: &'a str,
    local_cluster: &'a str,
    now: i64,
}

/// A credential minted and encrypted before the transaction, inserted inside it.
struct Mint {
    credential_id: String,
    kind: CredentialKind,
    secret: MintedSecret,
    prepared: PreparedSecret,
}

#[derive(Debug, PartialEq, Eq)]
enum WriteKind {
    Created,
    Updated,
    Switched,
}

#[derive(Debug)]
struct Written {
    trigger_id: String,
    kind: WriteKind,
    secret: Option<MintedSecret>,
}

#[derive(Debug, PartialEq, Eq)]
enum UpsertFail {
    Manage(ManageError),
    Raced,
}

impl From<ManageError> for UpsertFail {
    fn from(e: ManageError) -> Self {
        Self::Manage(e)
    }
}

impl From<DbErr> for UpsertFail {
    fn from(e: DbErr) -> Self {
        Self::Manage(e.into())
    }
}

impl From<SecretError> for UpsertFail {
    fn from(e: SecretError) -> Self {
        Self::Manage(e.into())
    }
}

/// Omitted values default; a body over the 1 MiB cap or a rate over the org budget is refused.
pub fn validate_limits(req: &UpsertRequest, org_budget: u32) -> Result<(i64, i32), ManageError> {
    let max_body = req.max_body_bytes.unwrap_or(DEFAULT_MAX_BODY_BYTES);
    if !(MIN_BODY_BYTES..=DEFAULT_MAX_BODY_BYTES).contains(&max_body) {
        return Err(ManageError::InvalidLimit);
    }
    let budget = i32::try_from(org_budget).unwrap_or(i32::MAX);
    let rpm = req
        .rate_limit_per_minute
        .unwrap_or(DEFAULT_TRIGGER_RPM.min(budget));
    if !(1..=budget).contains(&rpm) {
        return Err(ManageError::InvalidLimit);
    }
    Ok((max_body, rpm))
}

pub fn trigger_view(
    trigger: &triggers::Model,
    credentials: Vec<CredentialView>,
    last_call: Option<LastCall>,
    encrypting: bool,
    permissions: EndpointPermissions,
    org_budget: u32,
) -> TriggerView {
    TriggerView {
        id: trigger.id.clone(),
        url: invoke_url(&trigger.org_id, &trigger.id),
        region_host: region_host(),
        enabled: trigger.enabled,
        auth_mode: AuthMode::parse(&trigger.auth_mode).unwrap_or(AuthMode::Token),
        max_body_bytes: trigger.max_body_bytes,
        rate_limit_per_minute: trigger.rate_limit_per_minute,
        org_rate_limit_per_minute: org_budget,
        created_by: trigger.created_by.clone(),
        created_at: trigger.created_at,
        updated_at: trigger.updated_at,
        last_invoked_at: trigger.last_invoked_at,
        last_call,
        secrets_encrypted_at_rest: encrypting,
        rejections: trigger
            .rejections
            .as_deref()
            .and_then(|raw| serde_json::from_str(raw).ok())
            .unwrap_or_else(|| serde_json::json!({})),
        credentials,
        permissions,
    }
}

pub fn org_budget() -> u32 {
    config::get_config().limit.workflow_hook_org_rpm
}

pub fn secrets_encrypted_at_rest() -> bool {
    cipher::is_encrypting()
}

pub async fn get(
    org_id: &str,
    workflow_id: &str,
    permissions: EndpointPermissions,
) -> Result<TriggerView, ManageError> {
    let db = get_orm_client_rw().await;
    let trigger = live_trigger(db, org_id, workflow_id).await?;
    let now = now_micros();
    let mut views = Vec::new();
    for row in http_triggers::list_credentials(db, &trigger.id).await? {
        let in_org = crate::users::get_user(Some(org_id), &row.created_by)
            .await
            .is_some();
        if let Some(view) = credential_view(&row, in_org, now) {
            views.push(view);
        }
    }
    let last_call = last_call_in(db, &trigger).await?;
    Ok(trigger_view(
        &trigger,
        views,
        last_call,
        secrets_encrypted_at_rest(),
        permissions,
        org_budget(),
    ))
}

pub async fn trigger_id(org_id: &str, workflow_id: &str) -> Result<String, ManageError> {
    Ok(live_trigger(get_orm_client_rw().await, org_id, workflow_id)
        .await?
        .id)
}

pub async fn upsert(
    org_id: &str,
    workflow_id: &str,
    req: UpsertRequest,
    user_id: &str,
    permissions: EndpointPermissions,
    credential_access: bool,
) -> Result<UpsertOutcome, ManageError> {
    if !workflow_exists(org_id, workflow_id).await? {
        return Err(ManageError::WorkflowNotFound);
    }
    let db = get_orm_client_rw().await;
    let cluster = config::get_cluster_name();
    let mut raced = false;
    let written = loop {
        let writer = writer(org_id, workflow_id, user_id, &cluster);
        match upsert_in(db, &writer, &req, org_budget(), credential_access, prepare).await {
            Ok(written) => break written,
            Err(UpsertFail::Raced) if !raced => raced = true,
            Err(UpsertFail::Raced) => {
                return Err(ManageError::Internal(
                    "the endpoint changed during the write, retry".to_string(),
                ));
            }
            Err(UpsertFail::Manage(e)) => return Err(e),
        }
    };
    emit_after_commit(&written.trigger_id).await;
    let config = get(org_id, workflow_id, permissions).await?;
    Ok(match (written.kind, written.secret) {
        (WriteKind::Created, Some(secret)) => UpsertOutcome::Created { config, secret },
        (WriteKind::Switched, Some(secret)) => UpsertOutcome::ModeSwitched { config, secret },
        _ => UpsertOutcome::Updated { config },
    })
}

pub async fn delete(org_id: &str, workflow_id: &str) -> Result<(), ManageError> {
    let db = get_orm_client_rw().await;
    let cluster = config::get_cluster_name();
    let trigger_id = delete_in(db, &writer(org_id, workflow_id, "", &cluster)).await?;
    emit_after_commit(&trigger_id).await;
    Ok(())
}

pub async fn rotate(
    org_id: &str,
    workflow_id: &str,
    overlap_seconds: i64,
    user_id: &str,
) -> Result<(CredentialView, MintedSecret), ManageError> {
    let db = get_orm_client_rw().await;
    let cluster = config::get_cluster_name();
    let writer = writer(org_id, workflow_id, user_id, &cluster);
    let (trigger_id, view, secret) = rotate_in(db, &writer, overlap_seconds, prepare).await?;
    emit_after_commit(&trigger_id).await;
    let in_org = crate::users::get_user(Some(org_id), user_id)
        .await
        .is_some();
    Ok((
        CredentialView {
            creator_in_org: in_org,
            ..view
        },
        secret,
    ))
}

pub async fn revoke(
    org_id: &str,
    workflow_id: &str,
    credential_id: &str,
) -> Result<(), ManageError> {
    let db = get_orm_client_rw().await;
    let cluster = config::get_cluster_name();
    let writer = writer(org_id, workflow_id, "", &cluster);
    let trigger_id = revoke_in(db, &writer, credential_id).await?;
    emit_after_commit(&trigger_id).await;
    Ok(())
}

/// Decrypts a live credential, returned with the trigger id for the audit event.
pub async fn reveal_secret(
    org_id: &str,
    workflow_id: &str,
    credential_id: &str,
) -> Result<(RevealView, String), ManageError> {
    let db = get_orm_client_rw().await;
    reveal_in(
        db,
        org_id,
        workflow_id,
        credential_id,
        now_micros(),
        resolve_secret,
    )
    .await
}

/// The test run gets the shape a real call gets, with an empty query and header map.
pub fn hook_test_input(trigger_id: &str, data: Vec<serde_json::Value>) -> serde_json::Value {
    let input = HookInput {
        meta: HookMeta {
            event_type: EVENT_TYPE,
            trigger_source: TRIGGER_SOURCE,
            trigger_id: trigger_id.to_string(),
            run_id: config::ider::uuid(),
            received_at: now_micros(),
            query: serde_json::Map::new(),
            headers: serde_json::Map::new(),
        },
        data,
    };
    serde_json::to_value(input).unwrap_or_default()
}

fn writer<'a>(
    org_id: &'a str,
    workflow_id: &'a str,
    user_id: &'a str,
    local_cluster: &'a str,
) -> Writer<'a> {
    Writer {
        org_id,
        workflow_id,
        user_id,
        local_cluster,
        now: now_micros(),
    }
}

fn invoke_url(org_id: &str, trigger_id: &str) -> String {
    let cfg = config::get_config();
    format!(
        "{}{}/api/v2/{org_id}/workflows/hooks/{trigger_id}",
        cfg.common.web_url.trim_end_matches('/'),
        cfg.common.base_uri.trim_end_matches('/'),
    )
}

/// Hooks run only in the accepting region, so a super-cluster caller must pin this host.
fn region_host() -> Option<String> {
    if !get_o2_config().super_cluster.enabled {
        return None;
    }
    let web_url = &config::get_config().common.web_url;
    url::Url::parse(web_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
}

fn credential_view(
    row: &credentials::Model,
    creator_in_org: bool,
    now: i64,
) -> Option<CredentialView> {
    let kind = CredentialKind::parse(&row.kind)?;
    let state = CredentialState::parse(&row.state)?;
    is_live(state, row.expires_at, now).then(|| CredentialView {
        id: row.id.clone(),
        kind,
        display_prefix: row.display_prefix.clone(),
        state,
        expires_at: row.expires_at,
        created_by: row.created_by.clone(),
        creator_in_org,
        created_at: row.created_at,
        last_used_at: row.last_used_at,
    })
}

async fn workflow_exists(org_id: &str, workflow_id: &str) -> Result<bool, ManageError> {
    let internal = |e: anyhow::Error| ManageError::Internal(e.to_string());
    if crate::workflows::get_workflow_by_id(org_id, workflow_id)
        .await
        .map_err(internal)?
        .is_some()
    {
        return Ok(true);
    }
    Ok(crate::workflows::get_draft_by_id(org_id, workflow_id)
        .await
        .map_err(internal)?
        .is_some())
}

async fn live_trigger<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    workflow_id: &str,
) -> Result<triggers::Model, ManageError> {
    http_triggers::get_by_workflow(db, org_id, workflow_id)
        .await?
        .filter(|trigger| trigger.deleted_at.is_none())
        .ok_or(ManageError::NotConfigured)
}

/// A revived trigger keeps its id, so runs from before its tombstone are not its last call.
async fn last_call_in<C: ConnectionTrait>(
    db: &C,
    trigger: &triggers::Model,
) -> Result<Option<LastCall>, ManageError> {
    let newest = requests::Entity::find()
        .filter(requests::Column::TriggerId.eq(&trigger.id))
        .filter(requests::Column::ReceivedAt.gte(trigger.created_at))
        .order_by_desc(requests::Column::ReceivedAt)
        .order_by_desc(requests::Column::Id)
        .one(db)
        .await?;
    Ok(newest.map(|row| LastCall {
        run_id: row.run_id,
        status: row.status,
        received_at: row.received_at,
    }))
}

async fn prepare(
    org_id: String,
    credential_id: String,
    kind: CredentialKind,
    minted: MintedSecret,
) -> Result<PreparedSecret, SecretError> {
    minting::prepare_secret(&org_id, &credential_id, kind, &minted).await
}

async fn resolve_secret(
    org_id: String,
    secret_ref: String,
    credential_id: String,
) -> Result<String, SecretError> {
    let (_, material) = secrets::resolve_record(
        &org_id,
        &secret_ref,
        SecretOwnerKind::WorkflowTrigger,
        &credential_id,
        secrets::CURRENT,
    )
    .await?;
    match material {
        SecretMaterial::Token { value } => Ok(value),
        SecretMaterial::Basic { .. } => Err(SecretError::Malformed(
            "workflow trigger secret is not token material".to_string(),
        )),
    }
}

/// Encrypts before `begin`: `prepare_create` may write the org DEK, and SQLite has one writer.
async fn mint_for<P, F>(org_id: &str, mode: AuthMode, prepare: &P) -> Result<Mint, ManageError>
where
    P: Fn(String, String, CredentialKind, MintedSecret) -> F,
    F: Future<Output = Result<PreparedSecret, SecretError>>,
{
    let kind = CredentialKind::for_mode(mode);
    let secret = match kind {
        CredentialKind::Token => minting::mint_token(),
        CredentialKind::SigningSecret => minting::mint_signing_secret(),
    };
    let credential_id = config::ider::generate();
    let prepared = prepare(
        org_id.to_string(),
        credential_id.clone(),
        kind,
        secret.clone(),
    )
    .await
    .map_err(|e| {
        log::error!("[WORKFLOW_HOOK] credential {credential_id} could not be stored: {e}");
        ManageError::Internal("stored secrets are unavailable".to_string())
    })?;
    Ok(Mint {
        credential_id,
        kind,
        secret,
        prepared,
    })
}

async fn upsert_in<C, P, F>(
    db: &C,
    writer: &Writer<'_>,
    req: &UpsertRequest,
    org_budget: u32,
    credential_access: bool,
    prepare: P,
) -> Result<Written, UpsertFail>
where
    C: ConnectionTrait + TransactionTrait,
    P: Fn(String, String, CredentialKind, MintedSecret) -> F,
    F: Future<Output = Result<PreparedSecret, SecretError>>,
{
    let existing = http_triggers::get_by_workflow(db, writer.org_id, writer.workflow_id).await?;
    let live = existing.as_ref().filter(|t| t.deleted_at.is_none());
    let limits = validate_limits(&with_current_limits(req, live, org_budget), org_budget)?;
    let switching = live.is_some_and(|t| t.auth_mode != req.auth_mode.as_str());
    let mint = if live.is_none() || switching {
        if !credential_access {
            return Err(ManageError::CredentialAccessRequired.into());
        }
        Some(mint_for(writer.org_id, req.auth_mode, &prepare).await?)
    } else {
        None
    };
    let txn = db.begin().await?;
    let written = match existing {
        None => create_locked(&txn, writer, req, limits, mint).await,
        Some(trigger) => change_locked(&txn, writer, req, limits, mint, &trigger).await,
    };
    match written {
        Ok(written) => {
            txn.commit().await?;
            Ok(written)
        }
        Err(e) => {
            txn.rollback().await?;
            Err(e)
        }
    }
}

/// An omitted limit keeps the stored one, clamped to a budget that may have shrunk since.
fn with_current_limits(
    req: &UpsertRequest,
    live: Option<&triggers::Model>,
    org_budget: u32,
) -> UpsertRequest {
    let Some(trigger) = live else {
        return req.clone();
    };
    let budget = i32::try_from(org_budget).unwrap_or(i32::MAX);
    UpsertRequest {
        max_body_bytes: req.max_body_bytes.or(Some(trigger.max_body_bytes)),
        rate_limit_per_minute: req
            .rate_limit_per_minute
            .or(Some(trigger.rate_limit_per_minute.min(budget))),
        ..req.clone()
    }
}

async fn create_locked<C: ConnectionTrait>(
    txn: &C,
    writer: &Writer<'_>,
    req: &UpsertRequest,
    (max_body_bytes, rate_limit_per_minute): (i64, i32),
    mint: Option<Mint>,
) -> Result<Written, UpsertFail> {
    let mint = mint.ok_or(UpsertFail::Raced)?;
    let trigger_id = minting::new_trigger_id();
    let row = triggers::Model {
        id: trigger_id.clone(),
        org_id: writer.org_id.to_string(),
        workflow_id: writer.workflow_id.to_string(),
        enabled: req.enabled,
        auth_mode: req.auth_mode.as_str().to_string(),
        max_body_bytes,
        rate_limit_per_minute,
        created_by: writer.user_id.to_string(),
        created_at: writer.now,
        updated_at: writer.now,
        version: 1,
        origin_cluster: writer.local_cluster.to_string(),
        deleted_at: None,
        last_invoked_at: None,
        rejections: None,
    };
    if let Err(e) = http_triggers::insert_trigger(txn, row).await {
        return Err(match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => UpsertFail::Raced,
            _ => e.into(),
        });
    }
    let secret = insert_minted(txn, writer, &trigger_id, mint).await?;
    Ok(Written {
        trigger_id,
        kind: WriteKind::Created,
        secret: Some(secret),
    })
}

/// Re-checked under the row lock: the decision to mint was taken before `begin`.
async fn change_locked<C: ConnectionTrait>(
    txn: &C,
    writer: &Writer<'_>,
    req: &UpsertRequest,
    (max_body_bytes, rate_limit_per_minute): (i64, i32),
    mint: Option<Mint>,
    seen: &triggers::Model,
) -> Result<Written, UpsertFail> {
    let locked = http_triggers::get_for_update(txn, &seen.id)
        .await?
        .ok_or(UpsertFail::Raced)?;
    let revived = locked.deleted_at.is_some();
    let switching = !revived && locked.auth_mode != req.auth_mode.as_str();
    if locked.deleted_at != seen.deleted_at
        || locked.auth_mode != seen.auth_mode
        || (revived || switching) != mint.is_some()
    {
        return Err(UpsertFail::Raced);
    }
    if switching || revived {
        revoke_all_in(txn, &locked, writer.now).await?;
    }
    let mut row = locked.clone().into_active_model();
    row.enabled = Set(req.enabled);
    row.auth_mode = Set(req.auth_mode.as_str().to_string());
    row.max_body_bytes = Set(max_body_bytes);
    row.rate_limit_per_minute = Set(rate_limit_per_minute);
    row.updated_at = Set(writer.now);
    row.version = Set(locked.version + 1);
    row.origin_cluster = Set(writer.local_cluster.to_string());
    if revived {
        row.created_by = Set(writer.user_id.to_string());
        row.created_at = Set(writer.now);
        row.deleted_at = Set(None);
        row.last_invoked_at = Set(None);
        row.rejections = Set(None);
    }
    http_triggers::update_trigger(txn, row).await?;
    let secret = match mint {
        Some(mint) => Some(insert_minted(txn, writer, &locked.id, mint).await?),
        None => None,
    };
    let kind = match (revived, switching) {
        (true, _) => WriteKind::Created,
        (false, true) => WriteKind::Switched,
        (false, false) => WriteKind::Updated,
    };
    Ok(Written {
        trigger_id: locked.id,
        kind,
        secret,
    })
}

async fn insert_minted<C: ConnectionTrait>(
    txn: &C,
    writer: &Writer<'_>,
    trigger_id: &str,
    mint: Mint,
) -> Result<MintedSecret, UpsertFail> {
    let secret_ref = secrets::insert_prepared(txn, mint.prepared)
        .await?
        .metadata
        .secret_ref;
    http_triggers::insert_credential(
        txn,
        credentials::Model {
            id: mint.credential_id,
            trigger_id: trigger_id.to_string(),
            org_id: writer.org_id.to_string(),
            kind: mint.kind.as_str().to_string(),
            display_prefix: mint.secret.display_prefix.clone(),
            token_sha256: mint.secret.token_sha256.clone(),
            secret_ref: Some(secret_ref),
            state: CredentialState::Active.as_str().to_string(),
            expires_at: None,
            revoked_at: None,
            created_by: writer.user_id.to_string(),
            created_at: writer.now,
            updated_at: writer.now,
            last_used_at: None,
        },
    )
    .await?;
    Ok(mint.secret)
}

async fn revoke_all_in<C: ConnectionTrait>(
    txn: &C,
    trigger: &triggers::Model,
    now: i64,
) -> Result<(), DbErr> {
    for credential in http_triggers::list_credentials(txn, &trigger.id).await? {
        if credential.state != CredentialState::Revoked.as_str() {
            revoke_credential_in(txn, &credential, now).await?;
        }
    }
    Ok(())
}

/// The secret goes in the same transaction, through the transaction, so SQLite never deadlocks.
async fn revoke_credential_in<C: ConnectionTrait>(
    txn: &C,
    credential: &credentials::Model,
    now: i64,
) -> Result<(), DbErr> {
    secrets::delete_for_owner_in(
        txn,
        &credential.org_id,
        SecretOwnerKind::WorkflowTrigger,
        &credential.id,
    )
    .await
    .map_err(|e| match e {
        SecretError::Database(e) => e,
        other => DbErr::Custom(other.to_string()),
    })?;
    credentials::Entity::update_many()
        .col_expr(
            credentials::Column::State,
            Expr::value(CredentialState::Revoked.as_str()),
        )
        .col_expr(credentials::Column::RevokedAt, Expr::value(now))
        .col_expr(credentials::Column::UpdatedAt, Expr::value(now))
        .col_expr(
            credentials::Column::SecretRef,
            Expr::value(Option::<String>::None),
        )
        .filter(credentials::Column::Id.eq(&credential.id))
        .exec(txn)
        .await?;
    Ok(())
}

/// Every locked write bumps `version` and names this region as origin, a no-op PUT included.
async fn bump_in<C: ConnectionTrait>(
    txn: &C,
    trigger: &triggers::Model,
    writer: &Writer<'_>,
) -> Result<(), DbErr> {
    triggers::Entity::update_many()
        .col_expr(triggers::Column::Version, Expr::value(trigger.version + 1))
        .col_expr(triggers::Column::UpdatedAt, Expr::value(writer.now))
        .col_expr(
            triggers::Column::OriginCluster,
            Expr::value(writer.local_cluster),
        )
        .filter(triggers::Column::Id.eq(&trigger.id))
        .exec(txn)
        .await?;
    Ok(())
}

/// Locks the workflow's live trigger, or answers `NotConfigured` after rolling back.
async fn lock_live<C: ConnectionTrait>(
    txn: &C,
    writer: &Writer<'_>,
) -> Result<triggers::Model, ManageError> {
    let seen = live_trigger(txn, writer.org_id, writer.workflow_id).await?;
    http_triggers::get_for_update(txn, &seen.id)
        .await?
        .filter(|trigger| trigger.deleted_at.is_none())
        .ok_or(ManageError::NotConfigured)
}

async fn delete_in<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    writer: &Writer<'_>,
) -> Result<String, ManageError> {
    let txn = db.begin().await?;
    let trigger = match lock_live(&txn, writer).await {
        Ok(trigger) => trigger,
        Err(e) => {
            txn.rollback().await?;
            return Err(e);
        }
    };
    http_triggers::tombstone_for_workflow(&txn, &trigger.workflow_id, writer.now)
        .await
        .map_err(|e| ManageError::Internal(e.to_string()))?;
    triggers::Entity::update_many()
        .col_expr(
            triggers::Column::OriginCluster,
            Expr::value(writer.local_cluster),
        )
        .filter(triggers::Column::Id.eq(&trigger.id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(trigger.id)
}

async fn rotate_in<C, P, F>(
    db: &C,
    writer: &Writer<'_>,
    overlap_seconds: i64,
    prepare: P,
) -> Result<(String, CredentialView, MintedSecret), ManageError>
where
    C: ConnectionTrait + TransactionTrait,
    P: Fn(String, String, CredentialKind, MintedSecret) -> F,
    F: Future<Output = Result<PreparedSecret, SecretError>>,
{
    if !OVERLAPS.contains(&overlap_seconds) {
        return Err(ManageError::InvalidOverlap);
    }
    let seen = live_trigger(db, writer.org_id, writer.workflow_id).await?;
    let mode = AuthMode::parse(&seen.auth_mode)
        .ok_or_else(|| ManageError::Internal(format!("unknown auth mode {}", seen.auth_mode)))?;
    let mint = mint_for(writer.org_id, mode, &prepare).await?;
    let txn = db.begin().await?;
    match rotate_locked(&txn, writer, overlap_seconds, &seen, mint).await {
        Ok(rotated) => {
            txn.commit().await?;
            Ok(rotated)
        }
        Err(e) => {
            txn.rollback().await?;
            Err(e)
        }
    }
}

/// Holds one active and at most one live retiring credential, so a second rotate is refused.
async fn rotate_locked<C: ConnectionTrait>(
    txn: &C,
    writer: &Writer<'_>,
    overlap_seconds: i64,
    seen: &triggers::Model,
    mint: Mint,
) -> Result<(String, CredentialView, MintedSecret), ManageError> {
    let trigger = lock_live(txn, writer).await?;
    if trigger.id != seen.id || trigger.auth_mode != seen.auth_mode {
        return Err(ManageError::Internal(
            "the endpoint changed during the rotate, retry".to_string(),
        ));
    }
    let now = writer.now;
    let live: Vec<credentials::Model> = http_triggers::list_credentials(txn, &trigger.id)
        .await?
        .into_iter()
        .filter(|c| row_is_live(c, now))
        .collect();
    if live
        .iter()
        .any(|c| c.state == CredentialState::Retiring.as_str())
    {
        return Err(ManageError::CredentialRetiring);
    }
    let newest = live.iter().map(|c| c.created_at).max();
    for credential in &live {
        let keep = overlap_seconds > 0 && Some(credential.created_at) == newest;
        if keep {
            retire_in(txn, credential, now + overlap_seconds * 1_000_000, now).await?;
        } else {
            revoke_credential_in(txn, credential, now).await?;
        }
    }
    bump_in(txn, &trigger, writer).await?;
    let credential_id = mint.credential_id.clone();
    let kind = mint.kind;
    let secret = insert_minted(txn, writer, &trigger.id, mint)
        .await
        .map_err(|e| match e {
            UpsertFail::Manage(e) => e,
            UpsertFail::Raced => ManageError::Internal("raced".to_string()),
        })?;
    let view = CredentialView {
        id: credential_id,
        kind,
        display_prefix: secret.display_prefix.clone(),
        state: CredentialState::Active,
        expires_at: None,
        created_by: writer.user_id.to_string(),
        creator_in_org: true,
        created_at: now,
        last_used_at: None,
    };
    Ok((trigger.id, view, secret))
}

async fn retire_in<C: ConnectionTrait>(
    txn: &C,
    credential: &credentials::Model,
    expires_at: i64,
    now: i64,
) -> Result<(), DbErr> {
    credentials::Entity::update_many()
        .col_expr(
            credentials::Column::State,
            Expr::value(CredentialState::Retiring.as_str()),
        )
        .col_expr(credentials::Column::ExpiresAt, Expr::value(expires_at))
        .col_expr(credentials::Column::UpdatedAt, Expr::value(now))
        .filter(credentials::Column::Id.eq(&credential.id))
        .exec(txn)
        .await?;
    Ok(())
}

async fn revoke_in<C: ConnectionTrait + TransactionTrait>(
    db: &C,
    writer: &Writer<'_>,
    credential_id: &str,
) -> Result<String, ManageError> {
    let txn = db.begin().await?;
    match revoke_locked(&txn, writer, credential_id).await {
        Ok(trigger_id) => {
            txn.commit().await?;
            Ok(trigger_id)
        }
        Err(e) => {
            txn.rollback().await?;
            Err(e)
        }
    }
}

async fn revoke_locked<C: ConnectionTrait>(
    txn: &C,
    writer: &Writer<'_>,
    credential_id: &str,
) -> Result<String, ManageError> {
    let trigger = lock_live(txn, writer).await?;
    let credential = http_triggers::list_credentials(txn, &trigger.id)
        .await?
        .into_iter()
        .find(|c| c.id == credential_id && c.state != CredentialState::Revoked.as_str())
        .ok_or(ManageError::CredentialNotFound)?;
    revoke_credential_in(txn, &credential, writer.now).await?;
    bump_in(txn, &trigger, writer).await?;
    Ok(trigger.id)
}

/// An expired retiring credential is refused before the worker flips it to revoked.
async fn reveal_in<C, R, F>(
    db: &C,
    org_id: &str,
    workflow_id: &str,
    credential_id: &str,
    now: i64,
    resolve: R,
) -> Result<(RevealView, String), ManageError>
where
    C: ConnectionTrait,
    R: Fn(String, String, String) -> F,
    F: Future<Output = Result<String, SecretError>>,
{
    let trigger = live_trigger(db, org_id, workflow_id).await?;
    let credential = http_triggers::list_credentials(db, &trigger.id)
        .await?
        .into_iter()
        .find(|c| c.id == credential_id && row_is_live(c, now))
        .ok_or(ManageError::CredentialNotFound)?;
    let (Some(kind), Some(state)) = (
        CredentialKind::parse(&credential.kind),
        CredentialState::parse(&credential.state),
    ) else {
        return Err(ManageError::Internal(format!(
            "credential {credential_id} is malformed"
        )));
    };
    let Some(secret_ref) = credential.secret_ref.clone() else {
        log::error!("[WORKFLOW_HOOK] credential {credential_id} has no stored secret");
        return Err(ManageError::Internal(
            "the secret is unavailable".to_string(),
        ));
    };
    let secret = resolve(org_id.to_string(), secret_ref, credential.id.clone())
        .await
        .map_err(|e| {
            log::error!("[WORKFLOW_HOOK] credential {credential_id} secret unreadable: {e}");
            ManageError::Internal("the secret is unavailable".to_string())
        })?;
    Ok((
        RevealView {
            id: credential.id,
            kind,
            display_prefix: credential.display_prefix,
            state,
            expires_at: credential.expires_at,
            secret,
        },
        trigger.id,
    ))
}

fn row_is_live(credential: &credentials::Model, now: i64) -> bool {
    CredentialState::parse(&credential.state)
        .is_some_and(|state| is_live(state, credential.expires_at, now))
}

/// The local change is committed, so a failed emit is logged and healed by anti-entropy.
async fn emit_after_commit(trigger_id: &str) {
    // The coordinator watch evicts later; this node must see its own write at once.
    super::cache::invalidate(trigger_id).await;
    if let Err(e) = db::workflow_http_triggers::emit_snapshot(trigger_id).await {
        log::error!("[WORKFLOW_HOOK] snapshot emit for trigger {trigger_id} failed: {e}");
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex},
    };

    use infra::table::{
        entity::llm_secrets,
        workflow_http_trigger_requests::{self as ledger, NewHookRequest},
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, PaginatorTrait};

    use super::*;

    const NOW: i64 = 1_760_000_000_000_000;
    const ORG: &str = "acme";
    const WF: &str = "wf1";
    const LOCAL: &str = "r1";
    const BUDGET: u32 = 1200;

    type Stored = Arc<Mutex<HashMap<String, String>>>;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        http_triggers::create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn at(now: i64) -> Writer<'static> {
        Writer {
            org_id: ORG,
            workflow_id: WF,
            user_id: "a@acme.io",
            local_cluster: LOCAL,
            now,
        }
    }

    fn request(mode: AuthMode) -> UpsertRequest {
        UpsertRequest {
            enabled: true,
            auth_mode: mode,
            max_body_bytes: None,
            rate_limit_per_minute: None,
        }
    }

    fn all_permissions() -> EndpointPermissions {
        EndpointPermissions {
            edit: true,
            test: true,
            reveal: true,
        }
    }

    /// Records each minted plaintext by credential id, so a fake resolver can return it.
    fn preparer(
        stored: Stored,
    ) -> impl Fn(
        String,
        String,
        CredentialKind,
        MintedSecret,
    ) -> std::future::Ready<Result<PreparedSecret, SecretError>> {
        move |org, credential_id, _kind, minted| {
            stored
                .lock()
                .unwrap()
                .insert(credential_id.clone(), minted.plaintext);
            std::future::ready(Ok(secrets::prepared_for_tests(
                &org,
                SecretOwnerKind::WorkflowTrigger,
                &credential_id,
            )))
        }
    }

    fn secrets_off(
        _org: String,
        _credential_id: String,
        _kind: CredentialKind,
        _minted: MintedSecret,
    ) -> std::future::Ready<Result<PreparedSecret, SecretError>> {
        std::future::ready(Err(SecretError::Encryption("no master key".to_string())))
    }

    fn resolver(
        stored: Stored,
    ) -> impl Fn(String, String, String) -> std::future::Ready<Result<String, SecretError>> {
        move |_org, _secret_ref, credential_id| {
            std::future::ready(
                stored
                    .lock()
                    .unwrap()
                    .get(&credential_id)
                    .cloned()
                    .ok_or(SecretError::NotFound),
            )
        }
    }

    async fn create(db: &DatabaseConnection, mode: AuthMode, stored: &Stored) -> Written {
        upsert_in(
            db,
            &at(NOW),
            &request(mode),
            BUDGET,
            true,
            preparer(stored.clone()),
        )
        .await
        .unwrap()
    }

    async fn trigger_of(db: &DatabaseConnection) -> triggers::Model {
        http_triggers::get_by_workflow(db, ORG, WF)
            .await
            .unwrap()
            .unwrap()
    }

    async fn credentials_of(db: &DatabaseConnection, trigger_id: &str) -> Vec<credentials::Model> {
        http_triggers::list_credentials(db, trigger_id)
            .await
            .unwrap()
    }

    async fn secrets_of(db: &DatabaseConnection, owner_id: &str) -> u64 {
        llm_secrets::Entity::find()
            .filter(llm_secrets::Column::OwnerKind.eq("workflow_trigger"))
            .filter(llm_secrets::Column::OwnerId.eq(owner_id))
            .count(db)
            .await
            .unwrap()
    }

    async fn all_secrets(db: &DatabaseConnection) -> u64 {
        llm_secrets::Entity::find().count(db).await.unwrap()
    }

    async fn ledger_row(db: &DatabaseConnection, trigger_id: &str, run_id: &str, at: i64) {
        ledger::enqueue(
            db,
            NewHookRequest {
                trigger_id: trigger_id.to_string(),
                org_id: ORG.to_string(),
                workflow_id: WF.to_string(),
                run_id: run_id.to_string(),
                idem_key: None,
                body_sha256: "ab".repeat(32),
                body_bytes: 2,
                content_type: None,
                meta: "{}".to_string(),
                credential_id: "c1".to_string(),
                credential_prefix: "o2wh_abcd…wxyz".to_string(),
                caller_ip: "203.0.113.7".to_string(),
                received_at: at,
            },
            "{}".to_string(),
        )
        .await
        .unwrap();
    }

    fn live_state(rows: &[credentials::Model], now: i64) -> Vec<(String, String)> {
        rows.iter()
            .filter(|c| row_is_live(c, now))
            .map(|c| (c.kind.clone(), c.state.clone()))
            .collect()
    }

    #[test]
    fn limits_default_and_refuse_values_outside_the_range() {
        let mut req = request(AuthMode::Token);
        assert_eq!(validate_limits(&req, BUDGET), Ok((1024 * 1024, 60)));
        assert_eq!(validate_limits(&req, 30), Ok((1024 * 1024, 30)));
        for (body, rpm) in [
            (Some(MIN_BODY_BYTES - 1), None),
            (Some(DEFAULT_MAX_BODY_BYTES + 1), None),
            (None, Some(0)),
            (None, Some(1201)),
        ] {
            req.max_body_bytes = body;
            req.rate_limit_per_minute = rpm;
            assert_eq!(
                validate_limits(&req, BUDGET),
                Err(ManageError::InvalidLimit),
                "{body:?} {rpm:?}"
            );
        }
        req.max_body_bytes = Some(MIN_BODY_BYTES);
        req.rate_limit_per_minute = Some(1200);
        assert_eq!(validate_limits(&req, BUDGET), Ok((MIN_BODY_BYTES, 1200)));
    }

    #[test]
    fn reveal_view_debug_omits_the_secret() {
        let view = RevealView {
            id: "c1".to_string(),
            kind: CredentialKind::Token,
            display_prefix: "o2wh_abcd…wxyz".to_string(),
            state: CredentialState::Active,
            expires_at: None,
            secret: "o2wh_supersecretvalue".to_string(),
        };
        let printed = format!("{view:?}");
        assert!(!printed.contains("supersecretvalue"), "{printed}");
        assert!(printed.contains("o2wh_abcd…wxyz"), "{printed}");
    }

    #[test]
    fn hook_test_input_has_the_hook_shape() {
        let input = hook_test_input("t1", vec![serde_json::json!({"a": 1})]);
        assert_eq!(input["meta"]["event_type"], "webhook");
        assert_eq!(input["meta"]["trigger_source"], "http");
        assert_eq!(input["meta"]["trigger_id"], "t1");
        assert!(
            input["meta"]["run_id"]
                .as_str()
                .is_some_and(|r| !r.is_empty())
        );
        assert!(input["meta"]["received_at"].as_i64().is_some());
        assert_eq!(input["meta"]["query"], serde_json::json!({}));
        assert_eq!(input["meta"]["headers"], serde_json::json!({}));
        assert_eq!(input["data"], serde_json::json!([{"a": 1}]));
    }

    #[tokio::test]
    async fn the_view_reports_secrets_not_encrypted_without_a_master_key() {
        let db = db().await;
        create(&db, AuthMode::Token, &Stored::default()).await;
        let trigger = trigger_of(&db).await;
        let view = trigger_view(&trigger, vec![], None, false, all_permissions(), BUDGET);
        assert!(!view.secrets_encrypted_at_rest);
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["secrets_encrypted_at_rest"], false);
        assert_eq!(json["auth_mode"], "token");
        assert_eq!(json["org_rate_limit_per_minute"], BUDGET);
        assert_eq!(json["rejections"], serde_json::json!({}));
        assert!(
            json["url"]
                .as_str()
                .unwrap()
                .ends_with(&format!("/api/v2/{ORG}/workflows/hooks/{}", trigger.id))
        );
    }

    #[tokio::test]
    async fn the_view_reports_secrets_encrypted_with_a_master_key() {
        let db = db().await;
        create(&db, AuthMode::Token, &Stored::default()).await;
        let trigger = trigger_of(&db).await;
        let view = trigger_view(&trigger, vec![], None, true, all_permissions(), BUDGET);
        assert!(view.secrets_encrypted_at_rest);
        assert_eq!(view.permissions, all_permissions());
    }

    #[tokio::test]
    async fn trigger_view_carries_last_call_from_the_newest_ledger_row() {
        let db = db().await;
        let written = create(&db, AuthMode::Token, &Stored::default()).await;
        let trigger = trigger_of(&db).await;
        assert_eq!(last_call_in(&db, &trigger).await.unwrap(), None);
        ledger_row(&db, &written.trigger_id, "run-old", NOW + 1).await;
        ledger_row(&db, &written.trigger_id, "run-new", NOW + 2).await;
        ledger_row(&db, "another-trigger", "run-other", NOW + 3).await;
        let last = last_call_in(&db, &trigger).await.unwrap();
        let view = trigger_view(&trigger, vec![], last, false, all_permissions(), BUDGET);
        assert_eq!(
            view.last_call,
            Some(LastCall {
                run_id: "run-new".to_string(),
                status: "queued".to_string(),
                received_at: NOW + 2,
            })
        );
    }

    #[tokio::test]
    async fn minting_a_token_stores_it_encrypted_and_hashed() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        assert_eq!(written.kind, WriteKind::Created);
        let secret = written.secret.unwrap();
        let rows = credentials_of(&db, &written.trigger_id).await;
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.kind, "token");
        assert_eq!(row.state, "active");
        assert_eq!(
            row.token_sha256.as_deref(),
            Some(minting::sha256_hex(&secret.plaintext).as_str())
        );
        assert_eq!(row.display_prefix, secret.display_prefix);
        assert!(row.secret_ref.is_some());
        assert_eq!(secrets_of(&db, &row.id).await, 1);
        assert_eq!(
            stored.lock().unwrap().get(&row.id),
            Some(&secret.plaintext),
            "the plaintext handed to the encryptor is the minted token"
        );
        let trigger = trigger_of(&db).await;
        assert_eq!(
            (trigger.version, trigger.origin_cluster.as_str()),
            (1, LOCAL)
        );
    }

    #[tokio::test]
    async fn a_mint_with_stored_secrets_off_fails_and_writes_nothing() {
        let db = db().await;
        let failed = upsert_in(
            &db,
            &at(NOW),
            &request(AuthMode::Token),
            BUDGET,
            true,
            secrets_off,
        )
        .await;
        assert!(
            matches!(failed, Err(UpsertFail::Manage(ManageError::Internal(_)))),
            "{failed:?}"
        );
        assert!(
            http_triggers::get_by_workflow(&db, ORG, WF)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(all_secrets(&db).await, 0);
    }

    #[tokio::test]
    async fn create_and_mode_switch_need_credential_access_and_an_update_does_not() {
        let db = db().await;
        let stored = Stored::default();
        let refused = upsert_in(
            &db,
            &at(NOW),
            &request(AuthMode::Token),
            BUDGET,
            false,
            preparer(stored.clone()),
        )
        .await;
        assert_eq!(
            refused.unwrap_err(),
            UpsertFail::Manage(ManageError::CredentialAccessRequired)
        );
        assert!(stored.lock().unwrap().is_empty(), "nothing was minted");
        create(&db, AuthMode::Token, &stored).await;
        let mut update = request(AuthMode::Token);
        update.enabled = false;
        let updated = upsert_in(
            &db,
            &at(NOW + 1),
            &update,
            BUDGET,
            false,
            preparer(stored.clone()),
        )
        .await
        .unwrap();
        assert_eq!(
            (updated.kind, updated.secret.is_none()),
            (WriteKind::Updated, true)
        );
        let switch = upsert_in(
            &db,
            &at(NOW + 2),
            &request(AuthMode::Signature),
            BUDGET,
            false,
            preparer(stored.clone()),
        )
        .await;
        assert_eq!(
            switch.unwrap_err(),
            UpsertFail::Manage(ManageError::CredentialAccessRequired)
        );
        assert_eq!(trigger_of(&db).await.auth_mode, "token");
    }

    #[tokio::test]
    async fn an_update_keeps_the_stored_limits_when_omitted() {
        let db = db().await;
        let stored = Stored::default();
        let mut first = request(AuthMode::Token);
        first.max_body_bytes = Some(4096);
        first.rate_limit_per_minute = Some(10);
        upsert_in(
            &db,
            &at(NOW),
            &first,
            BUDGET,
            true,
            preparer(stored.clone()),
        )
        .await
        .unwrap();
        upsert_in(
            &db,
            &at(NOW + 1),
            &request(AuthMode::Token),
            BUDGET,
            true,
            preparer(stored),
        )
        .await
        .unwrap();
        let trigger = trigger_of(&db).await;
        assert_eq!(
            (trigger.max_body_bytes, trigger.rate_limit_per_minute),
            (4096, 10)
        );
    }

    #[tokio::test]
    async fn mode_switch_deletes_the_token_secret() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let token_id = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        assert_eq!(secrets_of(&db, &token_id).await, 1);
        let switched = upsert_in(
            &db,
            &at(NOW + 1),
            &request(AuthMode::Signature),
            BUDGET,
            true,
            preparer(stored),
        )
        .await
        .unwrap();
        assert_eq!(switched.kind, WriteKind::Switched);
        assert!(switched.secret.unwrap().plaintext.starts_with("whsec_"));
        let rows = credentials_of(&db, &written.trigger_id).await;
        assert_eq!(
            live_state(&rows, NOW + 1),
            vec![("signing_secret".to_string(), "active".to_string())]
        );
        let old = rows.iter().find(|c| c.id == token_id).unwrap();
        assert_eq!(
            (old.state.as_str(), old.secret_ref.as_ref()),
            ("revoked", None)
        );
        assert_eq!(secrets_of(&db, &token_id).await, 0);
        assert_eq!(trigger_of(&db).await.auth_mode, "signature");
    }

    #[tokio::test]
    async fn revoking_a_token_deletes_its_secret() {
        let db = db().await;
        let written = create(&db, AuthMode::Token, &Stored::default()).await;
        let token_id = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        let trigger_id = revoke_in(&db, &at(NOW + 1), &token_id).await.unwrap();
        assert_eq!(trigger_id, written.trigger_id);
        let row = &credentials_of(&db, &trigger_id).await[0];
        assert_eq!(
            (row.state.as_str(), row.revoked_at, row.secret_ref.as_ref()),
            ("revoked", Some(NOW + 1), None)
        );
        assert_eq!(secrets_of(&db, &token_id).await, 0);
        assert_eq!(
            revoke_in(&db, &at(NOW + 2), &token_id).await,
            Err(ManageError::CredentialNotFound)
        );
    }

    #[tokio::test]
    async fn revoking_another_triggers_credential_is_not_found() {
        let db = db().await;
        create(&db, AuthMode::Token, &Stored::default()).await;
        let other = Writer {
            workflow_id: "wf2",
            ..at(NOW)
        };
        upsert_in(
            &db,
            &other,
            &request(AuthMode::Token),
            BUDGET,
            true,
            preparer(Stored::default()),
        )
        .await
        .unwrap();
        let foreign = credentials_of(&db, &trigger_of(&db).await.id).await[0]
            .id
            .clone();
        assert_eq!(
            revoke_in(
                &db,
                &Writer {
                    now: NOW + 1,
                    ..other
                },
                &foreign
            )
            .await,
            Err(ManageError::CredentialNotFound)
        );
    }

    #[tokio::test]
    async fn deleting_the_endpoint_deletes_every_secret() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        rotate_in(&db, &at(NOW + 1), 3600, preparer(stored))
            .await
            .unwrap();
        ledger_row(&db, &written.trigger_id, "queued-run", NOW + 2).await;
        assert_eq!(all_secrets(&db).await, 2);
        let deleted = delete_in(&db, &at(NOW + 3)).await.unwrap();
        assert_eq!(deleted, written.trigger_id);
        assert_eq!(all_secrets(&db).await, 0);
        let trigger = trigger_of(&db).await;
        assert_eq!(trigger.deleted_at, Some(NOW + 3));
        assert_eq!(
            (trigger.version, trigger.origin_cluster.as_str()),
            (3, LOCAL)
        );
        assert!(
            credentials_of(&db, &deleted)
                .await
                .iter()
                .all(|c| c.state == "revoked" && c.secret_ref.is_none())
        );
        assert!(
            ledger::get_run(&db, &deleted, "queued-run")
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            delete_in(&db, &at(NOW + 4)).await,
            Err(ManageError::NotConfigured)
        );
    }

    #[tokio::test]
    async fn a_tombstoned_endpoint_is_revived_on_create() {
        let db = db().await;
        let stored = Stored::default();
        let first = create(&db, AuthMode::Token, &stored).await;
        delete_in(&db, &at(NOW + 1)).await.unwrap();
        let again = upsert_in(
            &db,
            &at(NOW + 2),
            &request(AuthMode::Signature),
            BUDGET,
            true,
            preparer(stored),
        )
        .await
        .unwrap();
        assert_eq!(again.kind, WriteKind::Created);
        assert_eq!(again.trigger_id, first.trigger_id);
        let trigger = trigger_of(&db).await;
        assert_eq!(
            (trigger.deleted_at, trigger.created_at, trigger.version),
            (None, NOW + 2, 3)
        );
        let rows = credentials_of(&db, &trigger.id).await;
        assert_eq!(
            live_state(&rows, NOW + 2),
            vec![("signing_secret".to_string(), "active".to_string())]
        );
    }

    #[tokio::test]
    async fn rotate_while_a_live_retiring_credential_exists_is_refused() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        rotate_in(&db, &at(NOW + 1), 3600, preparer(stored.clone()))
            .await
            .unwrap();
        let refused = rotate_in(&db, &at(NOW + 2), 0, preparer(stored.clone())).await;
        assert_eq!(refused.unwrap_err(), ManageError::CredentialRetiring);
        assert_eq!(credentials_of(&db, &written.trigger_id).await.len(), 2);
        let after_expiry = NOW + 1 + 3600 * 1_000_000 + 1;
        rotate_in(&db, &at(after_expiry), 0, preparer(stored))
            .await
            .unwrap();
        assert_eq!(
            rotate_in(&db, &at(NOW), 60, preparer(Stored::default()))
                .await
                .unwrap_err(),
            ManageError::InvalidOverlap
        );
    }

    #[tokio::test]
    async fn a_third_live_credential_is_never_created() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let mut now = NOW;
        for overlap in [3600, 0, 86400, 0, 604800] {
            now += 1;
            let _ = rotate_in(&db, &at(now), overlap, preparer(stored.clone())).await;
            let rows = credentials_of(&db, &written.trigger_id).await;
            let live = live_state(&rows, now);
            assert!(live.len() <= 2, "{live:?}");
            assert_eq!(
                live.iter().filter(|(_, s)| s == "active").count(),
                1,
                "{live:?}"
            );
            assert!(
                live.iter().filter(|(_, s)| s == "retiring").count() <= 1,
                "{live:?}"
            );
        }
        let mut stray = credentials_of(&db, &written.trigger_id).await[0].clone();
        stray.id = "stray-active".to_string();
        stray.state = "active".to_string();
        stray.expires_at = None;
        stray.created_at = NOW - 10;
        stray.secret_ref = None;
        http_triggers::insert_credential(&db, stray).await.unwrap();
        let later = NOW + 30 * 86_400 * 1_000_000;
        rotate_in(&db, &at(later), 3600, preparer(stored))
            .await
            .unwrap();
        let rows = credentials_of(&db, &written.trigger_id).await;
        let live = live_state(&rows, later);
        assert_eq!(live.len(), 2, "{live:?}");
        let stray = rows.iter().find(|c| c.id == "stray-active").unwrap();
        assert_eq!(stray.state, "revoked");
    }

    #[tokio::test]
    async fn an_immediate_rotate_revokes_the_old_credential_and_its_secret() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let old = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        let (_, view, secret) = rotate_in(&db, &at(NOW + 1), 0, preparer(stored))
            .await
            .unwrap();
        assert_eq!(view.state, CredentialState::Active);
        assert_eq!(view.display_prefix, secret.display_prefix);
        let rows = credentials_of(&db, &written.trigger_id).await;
        let old_row = rows.iter().find(|c| c.id == old).unwrap();
        assert_eq!(old_row.state, "revoked");
        assert_eq!(secrets_of(&db, &old).await, 0);
        let with_overlap = rotate_in(&db, &at(NOW + 2), 86400, preparer(Stored::default()))
            .await
            .unwrap();
        let rows = credentials_of(&db, &written.trigger_id).await;
        let retiring = rows.iter().find(|c| c.id == view.id).unwrap();
        assert_eq!(
            (retiring.state.as_str(), retiring.expires_at),
            ("retiring", Some(NOW + 2 + 86400 * 1_000_000))
        );
        assert_ne!(with_overlap.1.id, view.id);
    }

    #[tokio::test]
    async fn a_local_write_takes_over_as_origin() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        triggers::Entity::update_many()
            .col_expr(triggers::Column::OriginCluster, Expr::value("r2"))
            .col_expr(triggers::Column::Version, Expr::value(7))
            .filter(triggers::Column::Id.eq(&written.trigger_id))
            .exec(&db)
            .await
            .unwrap();
        let writes: [(&str, i64); 4] =
            [("update", 8), ("rotate", 9), ("revoke", 10), ("delete", 11)];
        for (step, (name, version)) in writes.into_iter().enumerate() {
            triggers::Entity::update_many()
                .col_expr(triggers::Column::OriginCluster, Expr::value("r2"))
                .filter(triggers::Column::Id.eq(&written.trigger_id))
                .exec(&db)
                .await
                .unwrap();
            let now = NOW + 1 + step as i64;
            match name {
                "update" => {
                    upsert_in(
                        &db,
                        &at(now),
                        &request(AuthMode::Token),
                        BUDGET,
                        true,
                        preparer(stored.clone()),
                    )
                    .await
                    .unwrap();
                }
                "rotate" => {
                    rotate_in(&db, &at(now), 3600, preparer(stored.clone()))
                        .await
                        .unwrap();
                }
                "revoke" => {
                    let retiring = credentials_of(&db, &written.trigger_id)
                        .await
                        .into_iter()
                        .find(|c| c.state == "retiring")
                        .unwrap();
                    revoke_in(&db, &at(now), &retiring.id).await.unwrap();
                }
                _ => {
                    delete_in(&db, &at(now)).await.unwrap();
                }
            }
            let trigger = trigger_of(&db).await;
            assert_eq!(
                (
                    trigger.origin_cluster.as_str(),
                    trigger.version,
                    trigger.updated_at
                ),
                (LOCAL, version, now),
                "{name}"
            );
        }
    }

    #[tokio::test]
    async fn a_noop_put_still_bumps_version_and_emits() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let before = trigger_of(&db).await;
        let again = upsert_in(
            &db,
            &at(NOW + 5),
            &request(AuthMode::Token),
            BUDGET,
            true,
            preparer(stored),
        )
        .await
        .unwrap();
        assert_eq!(
            (
                again.kind,
                again.trigger_id.as_str(),
                again.secret.is_none()
            ),
            (WriteKind::Updated, written.trigger_id.as_str(), true),
            "the write names its trigger, which the caller emits after commit"
        );
        let after = trigger_of(&db).await;
        assert_eq!(after.version, before.version + 1);
        assert_eq!(after.updated_at, NOW + 5);
        assert_eq!(credentials_of(&db, &after.id).await.len(), 1);
    }

    #[tokio::test]
    async fn version_increments_on_each_locked_write() {
        let db = db().await;
        let stored = Stored::default();
        create(&db, AuthMode::Token, &stored).await;
        let mut expected = 1;
        for step in 1..=3 {
            rotate_in(&db, &at(NOW + step), 0, preparer(stored.clone()))
                .await
                .unwrap();
            expected += 1;
            assert_eq!(trigger_of(&db).await.version, expected);
        }
    }

    #[tokio::test]
    async fn reveal_returns_the_plaintext_of_a_live_credential() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let minted = written.secret.unwrap();
        let id = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        let (view, trigger_id) = reveal_in(&db, ORG, WF, &id, NOW + 1, resolver(stored))
            .await
            .unwrap();
        assert_eq!(trigger_id, written.trigger_id);
        assert_eq!(view.secret, minted.plaintext);
        assert_eq!(
            (view.kind, view.state, view.display_prefix.as_str()),
            (
                CredentialKind::Token,
                CredentialState::Active,
                minted.display_prefix.as_str()
            )
        );
    }

    #[tokio::test]
    async fn a_retiring_credential_reveals_until_expiry() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Signature, &stored).await;
        let old = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        rotate_in(&db, &at(NOW + 1), 3600, preparer(stored.clone()))
            .await
            .unwrap();
        let expires = NOW + 1 + 3600 * 1_000_000;
        let (view, _) = reveal_in(&db, ORG, WF, &old, expires - 1, resolver(stored.clone()))
            .await
            .unwrap();
        assert_eq!(
            (view.state, view.expires_at),
            (CredentialState::Retiring, Some(expires))
        );
        assert!(view.secret.starts_with("whsec_"));
        assert_eq!(
            reveal_in(&db, ORG, WF, &old, expires, resolver(stored))
                .await
                .unwrap_err(),
            ManageError::CredentialNotFound
        );
    }

    #[tokio::test]
    async fn revoked_or_expired_credentials_do_not_reveal() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let first = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        rotate_in(&db, &at(NOW + 1), 0, preparer(stored.clone()))
            .await
            .unwrap();
        assert_eq!(
            reveal_in(&db, ORG, WF, &first, NOW + 2, resolver(stored.clone()))
                .await
                .unwrap_err(),
            ManageError::CredentialNotFound
        );
        assert_eq!(
            reveal_in(&db, ORG, WF, "unknown", NOW + 2, resolver(stored.clone()))
                .await
                .unwrap_err(),
            ManageError::CredentialNotFound
        );
        let other_wf = reveal_in(&db, ORG, "wf-none", &first, NOW + 2, resolver(stored)).await;
        assert_eq!(other_wf.unwrap_err(), ManageError::NotConfigured);
    }

    #[tokio::test]
    async fn another_triggers_credential_does_not_reveal() {
        let db = db().await;
        let stored = Stored::default();
        create(&db, AuthMode::Token, &stored).await;
        let other = Writer {
            workflow_id: "wf2",
            ..at(NOW)
        };
        let second = upsert_in(
            &db,
            &other,
            &request(AuthMode::Token),
            BUDGET,
            true,
            preparer(stored.clone()),
        )
        .await
        .unwrap();
        let foreign = credentials_of(&db, &second.trigger_id).await[0].id.clone();
        assert_eq!(
            reveal_in(&db, ORG, WF, &foreign, NOW + 1, resolver(stored))
                .await
                .unwrap_err(),
            ManageError::CredentialNotFound
        );
    }

    #[tokio::test]
    async fn a_credential_without_a_secret_ref_reveals_500() {
        let db = db().await;
        let stored = Stored::default();
        let written = create(&db, AuthMode::Token, &stored).await;
        let id = credentials_of(&db, &written.trigger_id).await[0].id.clone();
        let unreadable = reveal_in(&db, ORG, WF, &id, NOW + 1, resolver(Stored::default())).await;
        assert!(matches!(unreadable, Err(ManageError::Internal(_))));
        credentials::Entity::update_many()
            .col_expr(
                credentials::Column::SecretRef,
                Expr::value(Option::<String>::None),
            )
            .filter(credentials::Column::Id.eq(&id))
            .exec(&db)
            .await
            .unwrap();
        assert!(matches!(
            reveal_in(&db, ORG, WF, &id, NOW + 1, resolver(stored)).await,
            Err(ManageError::Internal(_))
        ));
    }
}
