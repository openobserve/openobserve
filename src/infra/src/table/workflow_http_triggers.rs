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

//! HTTP triggers of workflows and their credentials, replicated as one versioned snapshot.

use std::collections::{BTreeMap, HashMap, HashSet};

use config::utils::time::now_micros;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, DbErr, EntityTrait, IntoActiveModel,
    NotSet, QueryFilter, QueryOrder, QuerySelect, Set, TransactionTrait,
    sea_query::{Expr, Query},
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{
    db::get_orm_client_rw,
    errors,
    secrets::{self, PreparedSecret, SecretError, SecretMaterial, SecretOwnerKind, SecretPurpose},
    table::{
        entity::{
            workflow_http_trigger_credentials as credentials, workflow_http_triggers as triggers,
        },
        workflow_http_trigger_requests,
    },
};

pub const TOMBSTONE_TTL_US: i64 = 7 * 24 * 3600 * 1_000_000;
pub const REJECTION_WINDOW_US: i64 = 24 * 3600 * 1_000_000;
// A collision loser keeps its row as a tombstone, so it must give up the UNIQUE workflow_id.
const LOST_WORKFLOW_ID_PREFIX: &str = "lost:";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMode {
    Token,
    Signature,
}

impl AuthMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Token => "token",
            Self::Signature => "signature",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "token" => Some(Self::Token),
            "signature" => Some(Self::Signature),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialKind {
    Token,
    SigningSecret,
}

impl CredentialKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Token => "token",
            Self::SigningSecret => "signing_secret",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "token" => Some(Self::Token),
            "signing_secret" => Some(Self::SigningSecret),
            _ => None,
        }
    }

    pub fn for_mode(mode: AuthMode) -> Self {
        match mode {
            AuthMode::Token => Self::Token,
            AuthMode::Signature => Self::SigningSecret,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CredentialState {
    Active,
    Retiring,
    Revoked,
}

impl CredentialState {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Active => "active",
            Self::Retiring => "retiring",
            Self::Revoked => "revoked",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "active" => Some(Self::Active),
            "retiring" => Some(Self::Retiring),
            "revoked" => Some(Self::Revoked),
            _ => None,
        }
    }
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TriggerSnapshot {
    pub version: i64,
    pub origin_cluster: String,
    pub deleted: bool,
    pub trigger: ReplicatedTrigger,
    pub credentials: Vec<ReplicatedCredential>,
}

impl TriggerSnapshot {
    /// Lexicographic `(version, updated_at, origin_cluster)`, so two writing regions converge.
    pub fn supersedes(&self, local: Option<&triggers::Model>) -> bool {
        let Some(local) = local else {
            return true;
        };
        (
            self.version,
            self.trigger.updated_at,
            self.origin_cluster.as_str(),
        ) > (
            local.version,
            local.updated_at,
            local.origin_cluster.as_str(),
        )
    }
}

impl std::fmt::Debug for TriggerSnapshot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TriggerSnapshot")
            .field("version", &self.version)
            .field("origin_cluster", &self.origin_cluster)
            .field("deleted", &self.deleted)
            .field("trigger", &self.trigger)
            .field("credentials", &self.credentials)
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplicatedTrigger {
    pub id: String,
    pub org_id: String,
    pub workflow_id: String,
    pub enabled: bool,
    pub auth_mode: AuthMode,
    pub max_body_bytes: i64,
    pub rate_limit_per_minute: i32,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub deleted_at: Option<i64>,
}

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ReplicatedCredential {
    pub id: String,
    pub kind: CredentialKind,
    pub display_prefix: String,
    pub token_sha256: Option<String>,
    pub state: CredentialState,
    pub expires_at: Option<i64>,
    pub revoked_at: Option<i64>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub secret: Option<String>,
}

impl std::fmt::Debug for ReplicatedCredential {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ReplicatedCredential")
            .field("id", &self.id)
            .field("kind", &self.kind)
            .field("display_prefix", &self.display_prefix)
            .field(
                "token_sha256",
                &self.token_sha256.as_ref().map(|_| "<redacted>"),
            )
            .field("state", &self.state)
            .field("expires_at", &self.expires_at)
            .field("revoked_at", &self.revoked_at)
            .field("created_by", &self.created_by)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .field("secret", &self.secret.as_ref().map(|_| "<redacted>"))
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RejectionEntry {
    pub count_24h: u64,
    pub last_at: i64,
    pub last_ip: String,
    pub window_start: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RejectionDelta {
    pub count: u64,
    pub last_at: i64,
    pub last_ip: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ApplyOutcome {
    Applied,
    Stale,
    CollisionWon { loser: String },
    CollisionLost,
}

pub fn is_live(state: CredentialState, expires_at: Option<i64>, now_us: i64) -> bool {
    matches!(state, CredentialState::Active | CredentialState::Retiring)
        && expires_at.is_none_or(|at| at > now_us)
}

pub fn merge_rejection_entry(
    existing: Option<&RejectionEntry>,
    delta: &RejectionDelta,
    now_us: i64,
) -> RejectionEntry {
    let Some(existing) = existing.filter(|e| now_us - e.window_start < REJECTION_WINDOW_US) else {
        return RejectionEntry {
            count_24h: delta.count,
            last_at: delta.last_at,
            last_ip: delta.last_ip.clone(),
            window_start: now_us,
        };
    };
    let delta_is_newer = delta.last_at >= existing.last_at;
    RejectionEntry {
        count_24h: existing.count_24h.saturating_add(delta.count),
        last_at: existing.last_at.max(delta.last_at),
        last_ip: if delta_is_newer {
            delta.last_ip.clone()
        } else {
            existing.last_ip.clone()
        },
        window_start: existing.window_start,
    }
}

pub async fn get<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
) -> Result<Option<triggers::Model>, DbErr> {
    triggers::Entity::find_by_id(trigger_id).one(db).await
}

/// Includes a tombstone, which still holds the workflow's UNIQUE `workflow_id`.
pub async fn get_by_workflow<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    workflow_id: &str,
) -> Result<Option<triggers::Model>, DbErr> {
    triggers::Entity::find()
        .filter(triggers::Column::OrgId.eq(org_id))
        .filter(triggers::Column::WorkflowId.eq(workflow_id))
        .one(db)
        .await
}

pub async fn get_for_update<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
) -> Result<Option<triggers::Model>, DbErr> {
    triggers::Entity::find_by_id(trigger_id)
        .lock_exclusive()
        .one(db)
        .await
}

pub async fn list_credentials<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
) -> Result<Vec<credentials::Model>, DbErr> {
    credentials::Entity::find()
        .filter(credentials::Column::TriggerId.eq(trigger_id))
        .order_by_asc(credentials::Column::CreatedAt)
        .order_by_asc(credentials::Column::Id)
        .all(db)
        .await
}

pub async fn insert_trigger<C: ConnectionTrait>(
    db: &C,
    model: triggers::Model,
) -> Result<(), DbErr> {
    triggers::Entity::insert(model.into_active_model().reset_all())
        .exec_without_returning(db)
        .await?;
    Ok(())
}

pub async fn update_trigger<C: ConnectionTrait>(
    db: &C,
    model: triggers::ActiveModel,
) -> Result<(), DbErr> {
    model.update(db).await?;
    Ok(())
}

pub async fn insert_credential<C: ConnectionTrait>(
    db: &C,
    model: credentials::Model,
) -> Result<(), DbErr> {
    credentials::Entity::insert(model.into_active_model().reset_all())
        .exec_without_returning(db)
        .await?;
    Ok(())
}

pub async fn update_credential<C: ConnectionTrait>(
    db: &C,
    model: credentials::ActiveModel,
) -> Result<(), DbErr> {
    model.update(db).await?;
    Ok(())
}

pub async fn enabled_workflow_ids<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
) -> Result<HashSet<String>, DbErr> {
    let ids: Vec<String> = triggers::Entity::find()
        .select_only()
        .column(triggers::Column::WorkflowId)
        .filter(triggers::Column::OrgId.eq(org_id))
        .filter(triggers::Column::Enabled.eq(true))
        .filter(triggers::Column::DeletedAt.is_null())
        .into_tuple()
        .all(db)
        .await?;
    Ok(ids.into_iter().collect())
}

pub async fn list_by_org<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
) -> Result<Vec<triggers::Model>, DbErr> {
    triggers::Entity::find()
        .filter(triggers::Column::OrgId.eq(org_id))
        .order_by_asc(triggers::Column::Id)
        .all(db)
        .await
}

pub async fn list_originated<C: ConnectionTrait>(
    db: &C,
    origin_cluster: &str,
    tombstones_since_us: i64,
) -> Result<Vec<triggers::Model>, DbErr> {
    triggers::Entity::find()
        .filter(triggers::Column::OriginCluster.eq(origin_cluster))
        .filter(
            Condition::any()
                .add(triggers::Column::DeletedAt.is_null())
                .add(triggers::Column::DeletedAt.gte(tombstones_since_us)),
        )
        .order_by_asc(triggers::Column::Id)
        .all(db)
        .await
}

pub async fn list_expired_retiring<C: ConnectionTrait>(
    db: &C,
    origin_cluster: &str,
    now_us: i64,
) -> Result<Vec<credentials::Model>, DbErr> {
    let originated = Query::select()
        .column(triggers::Column::Id)
        .from(triggers::Entity)
        .and_where(Expr::col(triggers::Column::OriginCluster).eq(origin_cluster))
        .and_where(Expr::col(triggers::Column::DeletedAt).is_null())
        .to_owned();
    credentials::Entity::find()
        .filter(credentials::Column::State.eq(CredentialState::Retiring.as_str()))
        .filter(credentials::Column::ExpiresAt.lt(now_us))
        .filter(credentials::Column::TriggerId.in_subquery(originated))
        .order_by_asc(credentials::Column::Id)
        .all(db)
        .await
}

pub async fn delete_tombstones_before<C: ConnectionTrait>(
    db: &C,
    before_us: i64,
) -> Result<u64, DbErr> {
    let tombstoned = Query::select()
        .column(triggers::Column::Id)
        .from(triggers::Entity)
        .and_where(Expr::col(triggers::Column::DeletedAt).lt(before_us))
        .to_owned();
    let orphaned = credentials::Entity::delete_many()
        .filter(credentials::Column::TriggerId.in_subquery(tombstoned))
        .exec(db)
        .await?
        .rows_affected;
    let revoked = credentials::Entity::delete_many()
        .filter(credentials::Column::State.eq(CredentialState::Revoked.as_str()))
        .filter(credentials::Column::RevokedAt.lt(before_us))
        .exec(db)
        .await?
        .rows_affected;
    let deleted = triggers::Entity::delete_many()
        .filter(triggers::Column::DeletedAt.lt(before_us))
        .exec(db)
        .await?
        .rows_affected;
    Ok(orphaned + revoked + deleted)
}

/// Tombstones the workflow's live trigger by workflow id, all that `WorkflowDelete` carries.
pub async fn tombstone_for_workflow<C: TransactionTrait>(
    db: &C,
    workflow_id: &str,
    now_us: i64,
) -> Result<Option<String>, errors::Error> {
    let txn = db.begin().await?;
    let Some(trigger) = triggers::Entity::find()
        .filter(triggers::Column::WorkflowId.eq(workflow_id))
        .filter(triggers::Column::DeletedAt.is_null())
        .lock_exclusive()
        .one(&txn)
        .await?
    else {
        txn.rollback().await?;
        return Ok(None);
    };
    retire_in(&txn, &trigger, now_us).await?;
    triggers::Entity::update_many()
        .col_expr(triggers::Column::DeletedAt, Expr::value(now_us))
        .col_expr(triggers::Column::UpdatedAt, Expr::value(now_us))
        .col_expr(triggers::Column::Version, Expr::value(trigger.version + 1))
        .filter(triggers::Column::Id.eq(&trigger.id))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    Ok(Some(trigger.id))
}

pub async fn delete_by_org<C: ConnectionTrait>(db: &C, org_id: &str) -> Result<u64, DbErr> {
    let credentials = credentials::Entity::delete_many()
        .filter(credentials::Column::OrgId.eq(org_id))
        .exec(db)
        .await?
        .rows_affected;
    let triggers = triggers::Entity::delete_many()
        .filter(triggers::Column::OrgId.eq(org_id))
        .exec(db)
        .await?
        .rows_affected;
    Ok(credentials + triggers)
}

/// Writes only `rejections`, so a merge never takes over `version` or `updated_at`.
pub async fn merge_rejections<C: TransactionTrait>(
    db: &C,
    trigger_id: &str,
    deltas: &BTreeMap<String, RejectionDelta>,
    now_us: i64,
) -> Result<(), DbErr> {
    let txn = db.begin().await?;
    let Some(trigger) = get_for_update(&txn, trigger_id).await? else {
        txn.rollback().await?;
        return Ok(());
    };
    let mut entries: BTreeMap<String, RejectionEntry> = trigger
        .rejections
        .as_deref()
        .and_then(|raw| serde_json::from_str(raw).ok())
        .unwrap_or_default();
    for (reason, delta) in deltas {
        let merged = merge_rejection_entry(entries.get(reason), delta, now_us);
        entries.insert(reason.clone(), merged);
    }
    let encoded = serde_json::to_string(&entries).map_err(|e| DbErr::Custom(e.to_string()))?;
    triggers::Entity::update_many()
        .col_expr(triggers::Column::Rejections, Expr::value(encoded))
        .filter(triggers::Column::Id.eq(trigger_id))
        .exec(&txn)
        .await?;
    txn.commit().await
}

pub async fn touch_last_used<C: ConnectionTrait>(
    db: &C,
    trigger_id: &str,
    invoked_at: i64,
    credential_ids: &[String],
) -> Result<(), DbErr> {
    triggers::Entity::update_many()
        .col_expr(triggers::Column::LastInvokedAt, Expr::value(invoked_at))
        .filter(triggers::Column::Id.eq(trigger_id))
        .exec(db)
        .await?;
    if credential_ids.is_empty() {
        return Ok(());
    }
    credentials::Entity::update_many()
        .col_expr(credentials::Column::LastUsedAt, Expr::value(invoked_at))
        .filter(credentials::Column::TriggerId.eq(trigger_id))
        .filter(credentials::Column::Id.is_in(credential_ids.iter().map(String::as_str)))
        .exec(db)
        .await?;
    Ok(())
}

pub async fn load_snapshot(trigger_id: &str) -> Result<Option<TriggerSnapshot>, errors::Error> {
    load_snapshot_in(get_orm_client_rw().await, trigger_id, resolve_secret).await
}

pub async fn apply_snapshot(snapshot: TriggerSnapshot) -> Result<ApplyOutcome, errors::Error> {
    let db = get_orm_client_rw().await;
    let local = list_credentials(db, &snapshot.trigger.id).await?;
    let prepared = prepare_missing_secrets_with(&snapshot, &local, prepare_secret).await;
    Ok(apply_snapshot_in(db, snapshot, prepared).await?)
}

/// Applies AC-SC-16 on a UNIQUE(`workflow_id`) clash instead of failing, so the message is acked.
pub async fn apply_snapshot_in<C: TransactionTrait>(
    db: &C,
    snapshot: TriggerSnapshot,
    prepared: Vec<(String, PreparedSecret)>,
) -> Result<ApplyOutcome, DbErr> {
    let txn = db.begin().await?;
    let outcome = apply_locked(&txn, &snapshot, prepared.into_iter().collect()).await?;
    txn.commit().await?;
    Ok(outcome)
}

#[cfg(any(test, feature = "test-utils"))]
pub async fn create_tables_for_tests(db: &sea_orm::DatabaseConnection) -> Result<(), DbErr> {
    super::migration::create_workflow_http_trigger_tables(db).await
}

/// A secret that cannot be read is omitted, so the snapshot still replicates every other field.
async fn load_snapshot_in<C, R, F>(
    db: &C,
    trigger_id: &str,
    resolve: R,
) -> Result<Option<TriggerSnapshot>, errors::Error>
where
    C: ConnectionTrait,
    R: Fn(String, String, String) -> F,
    F: Future<Output = Result<String, SecretError>>,
{
    let Some(trigger) = get(db, trigger_id).await? else {
        return Ok(None);
    };
    let credentials = list_credentials(db, trigger_id).await?;
    let now = now_micros();
    let mut plaintexts = HashMap::new();
    for credential in credentials
        .iter()
        .filter(|c| carries_secret(&trigger, c, now))
    {
        let Some(secret_ref) = credential.secret_ref.clone() else {
            continue;
        };
        match resolve(trigger.org_id.clone(), secret_ref, credential.id.clone()).await {
            Ok(value) => {
                plaintexts.insert(credential.id.clone(), value);
            }
            Err(e) => log::warn!(
                "[WORKFLOW_HOOK] trigger {} snapshot omits unreadable secret of credential {}: {e}",
                trigger.id,
                credential.id
            ),
        }
    }
    build_snapshot(&trigger, &credentials, &plaintexts).map(Some)
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
        _ => Err(SecretError::Malformed(
            "workflow trigger secret is not token material".to_string(),
        )),
    }
}

/// Skips, and logs by id, a secret it cannot prepare, so a snapshot always applies.
async fn prepare_missing_secrets_with<P, F>(
    snapshot: &TriggerSnapshot,
    local: &[credentials::Model],
    prepare: P,
) -> Vec<(String, PreparedSecret)>
where
    P: Fn(String, String, SecretPurpose, String) -> F,
    F: Future<Output = Result<PreparedSecret, SecretError>>,
{
    if snapshot.deleted {
        return Vec::new();
    }
    let stored: HashSet<&str> = local
        .iter()
        .filter(|c| c.secret_ref.is_some())
        .map(|c| c.id.as_str())
        .collect();
    let mut prepared = Vec::new();
    for credential in &snapshot.credentials {
        let Some(secret) = credential.secret.as_ref() else {
            continue;
        };
        if credential.state == CredentialState::Revoked || stored.contains(credential.id.as_str()) {
            continue;
        }
        let purpose = match credential.kind {
            CredentialKind::Token if credential.token_sha256 != Some(sha256_hex(secret)) => {
                log::warn!(
                    "[WORKFLOW_HOOK] token {} does not match its hash, secret not stored",
                    credential.id
                );
                continue;
            }
            CredentialKind::Token => SecretPurpose::Auth,
            CredentialKind::SigningSecret => SecretPurpose::Signing,
        };
        let org_id = snapshot.trigger.org_id.clone();
        match prepare(org_id, credential.id.clone(), purpose, secret.clone()).await {
            Ok(secret) => prepared.push((credential.id.clone(), secret)),
            Err(e) => log::warn!(
                "[WORKFLOW_HOOK] credential {} applied without a local secret: {e}",
                credential.id
            ),
        }
    }
    prepared
}

async fn prepare_secret(
    org_id: String,
    credential_id: String,
    purpose: SecretPurpose,
    value: String,
) -> Result<PreparedSecret, SecretError> {
    secrets::prepare_create(
        &org_id,
        SecretOwnerKind::WorkflowTrigger,
        &credential_id,
        purpose,
        None,
        SecretMaterial::Token { value },
    )
    .await
}

async fn apply_locked<C: ConnectionTrait>(
    txn: &C,
    snapshot: &TriggerSnapshot,
    prepared: HashMap<String, PreparedSecret>,
) -> Result<ApplyOutcome, DbErr> {
    let now = now_micros();
    let local = get_for_update(txn, &snapshot.trigger.id).await?;
    if !snapshot.supersedes(local.as_ref()) {
        return Ok(ApplyOutcome::Stale);
    }
    let rival = triggers::Entity::find()
        .filter(triggers::Column::WorkflowId.eq(&snapshot.trigger.workflow_id))
        .filter(triggers::Column::Id.ne(&snapshot.trigger.id))
        .lock_exclusive()
        .one(txn)
        .await?;
    let Some(rival) = rival else {
        write_snapshot(txn, snapshot, local.is_some(), prepared, false, now).await?;
        return Ok(ApplyOutcome::Applied);
    };
    let incoming = (
        snapshot.trigger.created_at,
        snapshot.origin_cluster.as_str(),
        snapshot.trigger.id.as_str(),
    );
    let held = (
        rival.created_at,
        rival.origin_cluster.as_str(),
        rival.id.as_str(),
    );
    if incoming > held {
        lose_in(txn, &rival, now).await?;
        write_snapshot(txn, snapshot, local.is_some(), prepared, false, now).await?;
        Ok(ApplyOutcome::CollisionWon { loser: rival.id })
    } else {
        write_snapshot(txn, snapshot, local.is_some(), HashMap::new(), true, now).await?;
        Ok(ApplyOutcome::CollisionLost)
    }
}

/// Upserts the snapshot's R columns; a `lost` one becomes a tombstone that holds no workflow.
async fn write_snapshot<C: ConnectionTrait>(
    txn: &C,
    snapshot: &TriggerSnapshot,
    exists: bool,
    mut prepared: HashMap<String, PreparedSecret>,
    lost: bool,
    now: i64,
) -> Result<(), DbErr> {
    let replicated = &snapshot.trigger;
    let deleted = snapshot.deleted || lost;
    let trigger = triggers::ActiveModel {
        id: Set(replicated.id.clone()),
        org_id: Set(replicated.org_id.clone()),
        workflow_id: Set(if lost {
            lost_workflow_id(&replicated.id)
        } else {
            replicated.workflow_id.clone()
        }),
        enabled: Set(replicated.enabled),
        auth_mode: Set(replicated.auth_mode.as_str().to_string()),
        max_body_bytes: Set(replicated.max_body_bytes),
        rate_limit_per_minute: Set(replicated.rate_limit_per_minute),
        created_by: Set(replicated.created_by.clone()),
        created_at: Set(replicated.created_at),
        updated_at: Set(replicated.updated_at),
        version: Set(snapshot.version),
        origin_cluster: Set(snapshot.origin_cluster.clone()),
        deleted_at: Set(deleted.then(|| replicated.deleted_at.unwrap_or(now))),
        last_invoked_at: NotSet,
        rejections: NotSet,
    };
    if exists {
        trigger.update(txn).await?;
    } else {
        triggers::Entity::insert(trigger)
            .exec_without_returning(txn)
            .await?;
    }

    let mut local: HashMap<String, credentials::Model> = list_credentials(txn, &replicated.id)
        .await?
        .into_iter()
        .map(|c| (c.id.clone(), c))
        .collect();
    for credential in &snapshot.credentials {
        let held = local.remove(&credential.id);
        let state = if lost {
            CredentialState::Revoked
        } else {
            credential.state
        };
        let keeps_secret = !deleted && state != CredentialState::Revoked;
        let held_ref = held.as_ref().and_then(|c| c.secret_ref.clone());
        let secret_ref = match (keeps_secret, held_ref) {
            (true, Some(secret_ref)) => Some(secret_ref),
            (true, None) => match prepared.remove(&credential.id) {
                Some(secret) => Some(
                    secrets::insert_prepared(txn, secret)
                        .await
                        .map_err(secret_db_err)?
                        .metadata
                        .secret_ref,
                ),
                None => None,
            },
            (false, _) => {
                delete_secret_in(txn, &replicated.org_id, &credential.id).await?;
                None
            }
        };
        let row = credentials::ActiveModel {
            id: Set(credential.id.clone()),
            trigger_id: Set(replicated.id.clone()),
            org_id: Set(replicated.org_id.clone()),
            kind: Set(credential.kind.as_str().to_string()),
            display_prefix: Set(credential.display_prefix.clone()),
            token_sha256: Set(credential.token_sha256.clone()),
            secret_ref: Set(secret_ref),
            state: Set(state.as_str().to_string()),
            expires_at: Set(credential.expires_at),
            revoked_at: Set(if lost {
                credential.revoked_at.or(Some(now))
            } else {
                credential.revoked_at
            }),
            created_by: Set(credential.created_by.clone()),
            created_at: Set(credential.created_at),
            updated_at: Set(credential.updated_at),
            last_used_at: NotSet,
        };
        if held.is_some() {
            row.update(txn).await?;
        } else {
            credentials::Entity::insert(row)
                .exec_without_returning(txn)
                .await?;
        }
    }

    for dropped in local.into_values() {
        delete_secret_in(txn, &dropped.org_id, &dropped.id).await?;
        credentials::Entity::delete_by_id(dropped.id)
            .exec(txn)
            .await?;
    }
    if deleted {
        workflow_http_trigger_requests::delete_queued_for_trigger(txn, &replicated.id).await?;
    }
    Ok(())
}

/// Tombstones the local loser of a create collision and frees its `workflow_id` for the winner.
async fn lose_in<C: ConnectionTrait>(
    txn: &C,
    trigger: &triggers::Model,
    now: i64,
) -> Result<(), DbErr> {
    retire_in(txn, trigger, now).await?;
    triggers::Entity::update_many()
        .col_expr(
            triggers::Column::WorkflowId,
            Expr::value(lost_workflow_id(&trigger.id)),
        )
        .col_expr(
            triggers::Column::DeletedAt,
            Expr::value(trigger.deleted_at.unwrap_or(now)),
        )
        .filter(triggers::Column::Id.eq(&trigger.id))
        .exec(txn)
        .await?;
    Ok(())
}

/// Revokes every credential of the trigger, deletes their local secrets and its queued runs.
async fn retire_in<C: ConnectionTrait>(
    txn: &C,
    trigger: &triggers::Model,
    now: i64,
) -> Result<(), DbErr> {
    for credential in list_credentials(txn, &trigger.id).await? {
        delete_secret_in(txn, &trigger.org_id, &credential.id).await?;
    }
    credentials::Entity::update_many()
        .col_expr(
            credentials::Column::State,
            Expr::value(CredentialState::Revoked.as_str()),
        )
        .col_expr(credentials::Column::RevokedAt, Expr::value(now))
        .col_expr(credentials::Column::UpdatedAt, Expr::value(now))
        .filter(credentials::Column::TriggerId.eq(&trigger.id))
        .filter(credentials::Column::State.ne(CredentialState::Revoked.as_str()))
        .exec(txn)
        .await?;
    credentials::Entity::update_many()
        .col_expr(
            credentials::Column::SecretRef,
            Expr::value(Option::<String>::None),
        )
        .filter(credentials::Column::TriggerId.eq(&trigger.id))
        .exec(txn)
        .await?;
    workflow_http_trigger_requests::delete_queued_for_trigger(txn, &trigger.id).await?;
    Ok(())
}

async fn delete_secret_in<C: ConnectionTrait>(
    txn: &C,
    org_id: &str,
    credential_id: &str,
) -> Result<(), DbErr> {
    secrets::delete_for_owner_in(txn, org_id, SecretOwnerKind::WorkflowTrigger, credential_id)
        .await
        .map_err(secret_db_err)?;
    Ok(())
}

fn sha256_hex(value: &str) -> String {
    format!("{:x}", Sha256::digest(value.as_bytes()))
}

fn carries_secret(trigger: &triggers::Model, credential: &credentials::Model, now: i64) -> bool {
    trigger.deleted_at.is_none()
        && CredentialState::parse(&credential.state)
            .is_some_and(|state| is_live(state, credential.expires_at, now))
}

/// Pairs each live credential with its plaintext from `plaintexts`; no other gets one.
fn build_snapshot(
    trigger: &triggers::Model,
    credentials: &[credentials::Model],
    plaintexts: &HashMap<String, String>,
) -> Result<TriggerSnapshot, errors::Error> {
    let malformed = |what: &str, value: &str| {
        errors::Error::Message(format!(
            "workflow http trigger {}: unknown {what} '{value}'",
            trigger.id
        ))
    };
    let auth_mode = AuthMode::parse(&trigger.auth_mode)
        .ok_or_else(|| malformed("auth mode", &trigger.auth_mode))?;
    let now = now_micros();
    let mut replicated = Vec::with_capacity(credentials.len());
    for credential in credentials {
        let kind = CredentialKind::parse(&credential.kind)
            .ok_or_else(|| malformed("credential kind", &credential.kind))?;
        let state = CredentialState::parse(&credential.state)
            .ok_or_else(|| malformed("credential state", &credential.state))?;
        let secret = carries_secret(trigger, credential, now)
            .then(|| plaintexts.get(&credential.id).cloned())
            .flatten();
        replicated.push(ReplicatedCredential {
            id: credential.id.clone(),
            kind,
            display_prefix: credential.display_prefix.clone(),
            token_sha256: credential.token_sha256.clone(),
            state,
            expires_at: credential.expires_at,
            revoked_at: credential.revoked_at,
            created_by: credential.created_by.clone(),
            created_at: credential.created_at,
            updated_at: credential.updated_at,
            secret,
        });
    }
    Ok(TriggerSnapshot {
        version: trigger.version,
        origin_cluster: trigger.origin_cluster.clone(),
        deleted: trigger.deleted_at.is_some(),
        trigger: ReplicatedTrigger {
            id: trigger.id.clone(),
            org_id: trigger.org_id.clone(),
            workflow_id: trigger.workflow_id.clone(),
            enabled: trigger.enabled,
            auth_mode,
            max_body_bytes: trigger.max_body_bytes,
            rate_limit_per_minute: trigger.rate_limit_per_minute,
            created_by: trigger.created_by.clone(),
            created_at: trigger.created_at,
            updated_at: trigger.updated_at,
            deleted_at: trigger.deleted_at,
        },
        credentials: replicated,
    })
}

fn lost_workflow_id(trigger_id: &str) -> String {
    format!("{LOST_WORKFLOW_ID_PREFIX}{trigger_id}")
}

fn secret_db_err(error: SecretError) -> DbErr {
    match error {
        SecretError::Database(error) => error,
        other => DbErr::Custom(other.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, PaginatorTrait};

    use super::*;
    use crate::table::{
        entity::{llm_secrets, workflow_http_trigger_requests as requests, workflow_run_data},
        workflow_http_trigger_requests::{self as ledger, NewHookRequest},
    };

    const NOW: i64 = 1_760_000_000_000_000;

    type Calls = std::sync::Mutex<Vec<(String, SecretPurpose, String)>>;

    /// One connection: separate connections to `sqlite::memory:` are separate databases.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        create_tables_for_tests(&db).await.unwrap();
        db
    }

    fn trigger(id: &str, workflow_id: &str) -> triggers::Model {
        triggers::Model {
            id: id.to_string(),
            org_id: "acme".to_string(),
            workflow_id: workflow_id.to_string(),
            enabled: true,
            auth_mode: AuthMode::Signature.as_str().to_string(),
            max_body_bytes: 1_048_576,
            rate_limit_per_minute: 60,
            created_by: "a@x.io".to_string(),
            created_at: NOW,
            updated_at: NOW,
            version: 1,
            origin_cluster: "r1".to_string(),
            deleted_at: None,
            last_invoked_at: None,
            rejections: None,
        }
    }

    fn credential(id: &str, trigger_id: &str, kind: CredentialKind) -> credentials::Model {
        credentials::Model {
            id: id.to_string(),
            trigger_id: trigger_id.to_string(),
            org_id: "acme".to_string(),
            kind: kind.as_str().to_string(),
            display_prefix: "whsec_abcd…wxyz".to_string(),
            token_sha256: (kind == CredentialKind::Token).then(|| "ab".repeat(32)),
            secret_ref: None,
            state: CredentialState::Active.as_str().to_string(),
            expires_at: None,
            revoked_at: None,
            created_by: "a@x.io".to_string(),
            created_at: NOW,
            updated_at: NOW,
            last_used_at: None,
        }
    }

    fn snapshot(
        trigger: &triggers::Model,
        credentials: &[credentials::Model],
        secrets: &[(&str, &str)],
    ) -> TriggerSnapshot {
        let secrets = secrets
            .iter()
            .map(|(id, value)| (id.to_string(), value.to_string()))
            .collect();
        build_snapshot(trigger, credentials, &secrets).unwrap()
    }

    fn prepared(org_id: &str, credential_id: &str) -> Vec<(String, PreparedSecret)> {
        vec![(
            credential_id.to_string(),
            secrets::prepared_for_tests(org_id, SecretOwnerKind::WorkflowTrigger, credential_id),
        )]
    }

    fn hook_request(trigger_id: &str, run_id: &str) -> NewHookRequest {
        NewHookRequest {
            trigger_id: trigger_id.to_string(),
            org_id: "acme".to_string(),
            workflow_id: "wf-1".to_string(),
            run_id: run_id.to_string(),
            idem_key: None,
            body_sha256: "cd".repeat(32),
            body_bytes: 2,
            content_type: Some("application/json".to_string()),
            meta: "{}".to_string(),
            credential_id: "c1".to_string(),
            credential_prefix: "o2wh_abcd…wxyz".to_string(),
            caller_ip: "203.0.113.7".to_string(),
            received_at: NOW,
        }
    }

    async fn secret_count(db: &DatabaseConnection, owner_id: &str) -> u64 {
        llm_secrets::Entity::find()
            .filter(llm_secrets::Column::OwnerKind.eq("workflow_trigger"))
            .filter(llm_secrets::Column::OwnerId.eq(owner_id))
            .count(db)
            .await
            .unwrap()
    }

    async fn credential_row(db: &DatabaseConnection, id: &str) -> credentials::Model {
        credentials::Entity::find_by_id(id)
            .one(db)
            .await
            .unwrap()
            .unwrap()
    }

    fn token(id: &str, trigger_id: &str, plaintext: &str) -> credentials::Model {
        let mut row = credential(id, trigger_id, CredentialKind::Token);
        row.display_prefix = "o2wh_abcd…wxyz".to_string();
        row.token_sha256 = Some(sha256_hex(plaintext));
        row
    }

    /// Records each prepare call; `secrets_on == false` plays a region with stored secrets off.
    async fn prepare_recorded(
        snapshot: &TriggerSnapshot,
        local: &[credentials::Model],
        calls: &Calls,
        secrets_on: bool,
    ) -> Vec<(String, PreparedSecret)> {
        prepare_missing_secrets_with(snapshot, local, |org, id, purpose, value| {
            calls.lock().unwrap().push((id.clone(), purpose, value));
            async move {
                if secrets_on {
                    Ok(secrets::prepared_for_tests(
                        &org,
                        SecretOwnerKind::WorkflowTrigger,
                        &id,
                    ))
                } else {
                    Err(SecretError::Encryption(
                        "stored secrets are off".to_string(),
                    ))
                }
            }
        })
        .await
    }

    #[test]
    fn enum_strings_round_trip() {
        for mode in [AuthMode::Token, AuthMode::Signature] {
            assert_eq!(AuthMode::parse(mode.as_str()), Some(mode));
        }
        for kind in [CredentialKind::Token, CredentialKind::SigningSecret] {
            assert_eq!(CredentialKind::parse(kind.as_str()), Some(kind));
        }
        for state in [
            CredentialState::Active,
            CredentialState::Retiring,
            CredentialState::Revoked,
        ] {
            assert_eq!(CredentialState::parse(state.as_str()), Some(state));
        }
        assert_eq!(
            CredentialKind::for_mode(AuthMode::Signature),
            CredentialKind::SigningSecret
        );
        assert_eq!(AuthMode::parse("basic"), None);
    }

    #[test]
    fn an_expired_retiring_credential_is_not_live() {
        assert!(!is_live(CredentialState::Retiring, Some(NOW - 1), NOW));
        assert!(!is_live(CredentialState::Retiring, Some(NOW), NOW));
        assert!(is_live(CredentialState::Retiring, Some(NOW + 1), NOW));
    }

    #[test]
    fn a_revoked_credential_is_not_live() {
        assert!(!is_live(CredentialState::Revoked, None, NOW));
        assert!(!is_live(CredentialState::Revoked, Some(NOW + 1), NOW));
    }

    #[test]
    fn an_active_credential_without_expiry_is_live() {
        assert!(is_live(CredentialState::Active, None, NOW));
    }

    #[test]
    fn rejection_merge_adds_within_the_window_and_resets_after_it() {
        let first = merge_rejection_entry(
            None,
            &RejectionDelta {
                count: 2,
                last_at: NOW,
                last_ip: "198.51.100.1".to_string(),
            },
            NOW,
        );
        assert_eq!((first.count_24h, first.window_start), (2, NOW));
        let older_delta = RejectionDelta {
            count: 3,
            last_at: NOW - 5,
            last_ip: "198.51.100.2".to_string(),
        };
        let added = merge_rejection_entry(Some(&first), &older_delta, NOW + 10);
        assert_eq!(added.count_24h, 5);
        assert_eq!(
            (added.last_at, added.last_ip.as_str()),
            (NOW, "198.51.100.1")
        );
        let reset = merge_rejection_entry(Some(&added), &older_delta, NOW + REJECTION_WINDOW_US);
        assert_eq!(reset.count_24h, 3);
        assert_eq!(reset.window_start, NOW + REJECTION_WINDOW_US);
    }

    #[test]
    fn snapshot_carries_the_secret_of_every_live_credential() {
        let trigger = trigger("t1", "wf-1");
        let live = credential("live", "t1", CredentialKind::SigningSecret);
        let mut expired = credential("expired", "t1", CredentialKind::SigningSecret);
        expired.state = CredentialState::Retiring.as_str().to_string();
        expired.expires_at = Some(NOW - 1);
        let mut revoked = credential("revoked", "t1", CredentialKind::Token);
        revoked.state = CredentialState::Revoked.as_str().to_string();
        revoked.revoked_at = Some(NOW);
        let token = token("token", "t1", "o2wh_token");
        let snap = snapshot(
            &trigger,
            &[live, expired, revoked, token],
            &[
                ("live", "whsec_live"),
                ("expired", "whsec_expired"),
                ("revoked", "o2wh_revoked"),
                ("token", "o2wh_token"),
            ],
        );
        let ids: Vec<&str> = snap.credentials.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, ["live", "expired", "revoked", "token"]);
        let secrets: Vec<Option<&str>> = snap
            .credentials
            .iter()
            .map(|c| c.secret.as_deref())
            .collect();
        assert_eq!(
            secrets,
            [Some("whsec_live"), None, None, Some("o2wh_token")]
        );
        assert_eq!(
            (snap.version, snap.origin_cluster.as_str(), snap.deleted),
            (1, "r1", false)
        );
        assert_eq!(snap.credentials[2].state, CredentialState::Revoked);
    }

    #[test]
    fn snapshot_debug_omits_secrets() {
        let trigger = trigger("t1", "wf-1");
        let snap = snapshot(
            &trigger,
            &[
                credential("c1", "t1", CredentialKind::SigningSecret),
                token("c2", "t1", "o2wh_dG9rZW4tdmFsdWU"),
            ],
            &[
                ("c1", "whsec_c2VjcmV0LXZhbHVl"),
                ("c2", "o2wh_dG9rZW4tdmFsdWU"),
            ],
        );
        assert!(snap.credentials.iter().all(|c| c.secret.is_some()));
        let printed = format!("{snap:?}");
        assert!(!printed.contains("whsec_c2VjcmV0LXZhbHVl"), "{printed}");
        assert!(!printed.contains("o2wh_dG9rZW4tdmFsdWU"), "{printed}");
        assert!(
            !printed.contains(&sha256_hex("o2wh_dG9rZW4tdmFsdWU")),
            "{printed}"
        );
        assert!(printed.contains("<redacted>"), "{printed}");
        assert!(printed.contains("t1"), "{printed}");
    }

    #[tokio::test]
    async fn emit_skips_an_unreadable_token_secret() {
        let db = db().await;
        let mut local = trigger("t1", "wf-1");
        local.auth_mode = AuthMode::Token.as_str().to_string();
        insert_trigger(&db, local).await.unwrap();
        for (id, plaintext) in [("c-good", "o2wh_good"), ("c-bad", "o2wh_bad")] {
            let mut row = token(id, "t1", plaintext);
            row.secret_ref = Some(format!("ref-{id}"));
            insert_credential(&db, row).await.unwrap();
        }
        let snap = load_snapshot_in(&db, "t1", |org, secret_ref, id| async move {
            assert_eq!((org.as_str(), secret_ref), ("acme", format!("ref-{id}")));
            match id.as_str() {
                "c-good" => Ok("o2wh_good".to_string()),
                _ => Err(SecretError::Encryption("no key".to_string())),
            }
        })
        .await
        .unwrap()
        .unwrap();
        let carried: Vec<(&str, Option<&str>)> = snap
            .credentials
            .iter()
            .map(|c| (c.id.as_str(), c.secret.as_deref()))
            .collect();
        assert_eq!(carried, [("c-bad", None), ("c-good", Some("o2wh_good"))]);
        let bad = &snap.credentials[0];
        assert_eq!(bad.token_sha256, Some(sha256_hex("o2wh_bad")));
        assert_eq!(bad.state, CredentialState::Active);
        assert_eq!(snap.trigger.auth_mode, AuthMode::Token);
    }

    #[tokio::test]
    async fn a_newer_snapshot_is_applied() {
        let db = db().await;
        insert_trigger(&db, trigger("t1", "wf-1")).await.unwrap();
        let mut newer = trigger("t1", "wf-1");
        newer.version = 2;
        newer.enabled = false;
        newer.updated_at = NOW + 1;
        let outcome = apply_snapshot_in(&db, snapshot(&newer, &[], &[]), Vec::new())
            .await
            .unwrap();
        assert_eq!(outcome, ApplyOutcome::Applied);
        let stored = get(&db, "t1").await.unwrap().unwrap();
        assert_eq!((stored.version, stored.enabled), (2, false));
    }

    #[tokio::test]
    async fn an_equal_version_is_ignored() {
        let db = db().await;
        insert_trigger(&db, trigger("t1", "wf-1")).await.unwrap();
        let mut same = trigger("t1", "wf-1");
        same.enabled = false;
        let outcome = apply_snapshot_in(&db, snapshot(&same, &[], &[]), Vec::new())
            .await
            .unwrap();
        assert_eq!(outcome, ApplyOutcome::Stale);
        assert!(get(&db, "t1").await.unwrap().unwrap().enabled);
    }

    #[tokio::test]
    async fn ties_break_on_updated_at_then_origin_cluster() {
        let db = db().await;
        insert_trigger(&db, trigger("t1", "wf-1")).await.unwrap();
        let mut later = trigger("t1", "wf-1");
        later.updated_at = NOW + 1;
        later.origin_cluster = "r0".to_string();
        let applied = apply_snapshot_in(&db, snapshot(&later, &[], &[]), Vec::new()).await;
        assert_eq!(applied.unwrap(), ApplyOutcome::Applied);

        let mut lower_origin = later.clone();
        lower_origin.origin_cluster = "q9".to_string();
        let stale = apply_snapshot_in(&db, snapshot(&lower_origin, &[], &[]), Vec::new()).await;
        assert_eq!(stale.unwrap(), ApplyOutcome::Stale);

        let mut higher_origin = later.clone();
        higher_origin.origin_cluster = "r2".to_string();
        let applied = apply_snapshot_in(&db, snapshot(&higher_origin, &[], &[]), Vec::new()).await;
        assert_eq!(applied.unwrap(), ApplyOutcome::Applied);
        assert_eq!(get(&db, "t1").await.unwrap().unwrap().origin_cluster, "r2");
    }

    #[tokio::test]
    async fn apply_never_overwrites_local_columns() {
        let db = db().await;
        let mut local = trigger("t1", "wf-1");
        local.last_invoked_at = Some(NOW + 5);
        local.rejections = Some(r#"{"bad_signature":{"count_24h":1}}"#.to_string());
        insert_trigger(&db, local).await.unwrap();
        let mut held = credential("c1", "t1", CredentialKind::SigningSecret);
        held.secret_ref = Some("local-ref".to_string());
        held.last_used_at = Some(NOW + 6);
        insert_credential(&db, held).await.unwrap();

        let mut remote = trigger("t1", "wf-1");
        remote.version = 2;
        remote.rate_limit_per_minute = 10;
        let mut remote_credential = credential("c1", "t1", CredentialKind::SigningSecret);
        remote_credential.display_prefix = "whsec_new…".to_string();
        let snap = snapshot(&remote, &[remote_credential], &[("c1", "whsec_remote")]);
        let outcome = apply_snapshot_in(&db, snap, prepared("acme", "c1")).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);

        let stored = get(&db, "t1").await.unwrap().unwrap();
        assert_eq!(stored.rate_limit_per_minute, 10);
        assert_eq!(stored.last_invoked_at, Some(NOW + 5));
        assert!(stored.rejections.unwrap().contains("bad_signature"));
        let stored = credential_row(&db, "c1").await;
        assert_eq!(stored.display_prefix, "whsec_new…");
        assert_eq!(stored.secret_ref.as_deref(), Some("local-ref"));
        assert_eq!(stored.last_used_at, Some(NOW + 6));
        assert_eq!(secret_count(&db, "c1").await, 0, "a held secret is kept");
    }

    #[tokio::test]
    async fn a_signing_secret_is_stored_from_the_prepared_row_on_first_sight() {
        let db = db().await;
        let remote = trigger("t1", "wf-1");
        let snap = snapshot(
            &remote,
            &[credential("c1", "t1", CredentialKind::SigningSecret)],
            &[("c1", "whsec_remote")],
        );
        let outcome = apply_snapshot_in(&db, snap, prepared("acme", "c1")).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);
        let stored = credential_row(&db, "c1").await;
        let secret = llm_secrets::Entity::find()
            .filter(llm_secrets::Column::OwnerId.eq("c1"))
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(stored.secret_ref, Some(secret.secret_ref));
        assert_eq!(secret.owner_kind, "workflow_trigger");
    }

    #[tokio::test]
    async fn a_revoked_credential_loses_its_local_secret() {
        let db = db().await;
        let remote = trigger("t1", "wf-1");
        let signing = credential("c1", "t1", CredentialKind::SigningSecret);
        let token = token("c2", "t1", "o2wh_x");
        let first = snapshot(
            &remote,
            &[signing.clone(), token.clone()],
            &[("c1", "whsec_x"), ("c2", "o2wh_x")],
        );
        let mut held = prepared("acme", "c1");
        held.extend(prepared("acme", "c2"));
        apply_snapshot_in(&db, first, held).await.unwrap();
        assert_eq!(secret_count(&db, "c1").await, 1);
        assert_eq!(secret_count(&db, "c2").await, 1);

        let mut revoked_trigger = remote.clone();
        revoked_trigger.version = 2;
        let revoked: Vec<credentials::Model> = [signing, token]
            .into_iter()
            .map(|mut c| {
                c.state = CredentialState::Revoked.as_str().to_string();
                c.revoked_at = Some(NOW + 1);
                c
            })
            .collect();
        let second = snapshot(&revoked_trigger, &revoked, &[]);
        let outcome = apply_snapshot_in(&db, second, Vec::new()).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);
        for id in ["c1", "c2"] {
            assert_eq!(secret_count(&db, id).await, 0, "{id}");
            let stored = credential_row(&db, id).await;
            assert_eq!(stored.state, "revoked", "{id}");
            assert_eq!(stored.secret_ref, None, "{id}");
        }
    }

    #[tokio::test]
    async fn a_token_is_encrypted_locally_on_first_sight_with_purpose_auth() {
        let db = db().await;
        let snap = snapshot(
            &trigger("t1", "wf-1"),
            &[token("c1", "t1", "o2wh_first")],
            &[("c1", "o2wh_first")],
        );
        let calls = Calls::default();
        let prepared = prepare_recorded(&snap, &[], &calls, true).await;
        assert_eq!(
            *calls.lock().unwrap(),
            [(
                "c1".to_string(),
                SecretPurpose::Auth,
                "o2wh_first".to_string()
            )]
        );
        let outcome = apply_snapshot_in(&db, snap, prepared).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);
        let stored = credential_row(&db, "c1").await;
        assert!(stored.secret_ref.is_some());
        assert_eq!(stored.token_sha256, Some(sha256_hex("o2wh_first")));
        assert_eq!(secret_count(&db, "c1").await, 1);
    }

    #[tokio::test]
    async fn a_token_whose_secret_does_not_match_its_hash_is_skipped() {
        let db = db().await;
        let snap = snapshot(
            &trigger("t1", "wf-1"),
            &[
                token("c-ok", "t1", "o2wh_ok"),
                token("c-forged", "t1", "o2wh_original"),
            ],
            &[("c-ok", "o2wh_ok"), ("c-forged", "o2wh_tampered")],
        );
        let calls = Calls::default();
        let prepared = prepare_recorded(&snap, &[], &calls, true).await;
        let asked: Vec<String> = calls.lock().unwrap().iter().map(|c| c.0.clone()).collect();
        assert_eq!(asked, ["c-ok"]);
        let outcome = apply_snapshot_in(&db, snap, prepared).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);
        let forged = credential_row(&db, "c-forged").await;
        assert_eq!(forged.secret_ref, None);
        assert_eq!(forged.token_sha256, Some(sha256_hex("o2wh_original")));
        assert_eq!(secret_count(&db, "c-forged").await, 0);
        assert_eq!(secret_count(&db, "c-ok").await, 1);
    }

    #[tokio::test]
    async fn apply_with_secrets_off_still_revokes_a_token() {
        let db = db().await;
        let remote = trigger("t1", "wf-1");
        let live = token("c1", "t1", "o2wh_first");
        let first = snapshot(
            &remote,
            std::slice::from_ref(&live),
            &[("c1", "o2wh_first")],
        );
        let calls = Calls::default();
        let prepared = prepare_recorded(&first, &[], &calls, true).await;
        apply_snapshot_in(&db, first, prepared).await.unwrap();
        assert_eq!(secret_count(&db, "c1").await, 1);

        let mut newer = remote.clone();
        newer.version = 2;
        let mut revoked = live;
        revoked.state = CredentialState::Revoked.as_str().to_string();
        revoked.revoked_at = Some(NOW + 1);
        let second = snapshot(
            &newer,
            &[revoked, token("c2", "t1", "o2wh_second")],
            &[("c2", "o2wh_second")],
        );
        let local = list_credentials(&db, "t1").await.unwrap();
        let prepared = prepare_recorded(&second, &local, &calls, false).await;
        assert!(prepared.is_empty());
        assert_eq!(
            calls.lock().unwrap().last().map(|c| (c.0.as_str(), c.1)),
            Some(("c2", SecretPurpose::Auth)),
            "the failed prepare was attempted"
        );
        let outcome = apply_snapshot_in(&db, second, prepared).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);
        let c1 = credential_row(&db, "c1").await;
        assert_eq!((c1.state.as_str(), c1.secret_ref), ("revoked", None));
        assert_eq!(secret_count(&db, "c1").await, 0);
        let c2 = credential_row(&db, "c2").await;
        assert_eq!((c2.state.as_str(), c2.secret_ref), ("active", None));
        assert_eq!(c2.token_sha256, Some(sha256_hex("o2wh_second")));
    }

    #[tokio::test]
    async fn a_deleted_snapshot_tombstones_and_drops_queued_rows() {
        let db = db().await;
        let remote = trigger("t1", "wf-1");
        let live = credential("c1", "t1", CredentialKind::SigningSecret);
        let first = snapshot(&remote, std::slice::from_ref(&live), &[("c1", "whsec_x")]);
        apply_snapshot_in(&db, first, prepared("acme", "c1"))
            .await
            .unwrap();
        ledger::enqueue(&db, hook_request("t1", "run-1"), "{}".to_string())
            .await
            .unwrap();

        let mut gone = remote.clone();
        gone.version = 2;
        gone.deleted_at = Some(NOW + 1);
        let mut revoked = live;
        revoked.state = CredentialState::Revoked.as_str().to_string();
        let outcome = apply_snapshot_in(&db, snapshot(&gone, &[revoked], &[]), Vec::new()).await;
        assert_eq!(outcome.unwrap(), ApplyOutcome::Applied);

        let stored = get(&db, "t1").await.unwrap().unwrap();
        assert_eq!(stored.deleted_at, Some(NOW + 1));
        assert_eq!(secret_count(&db, "c1").await, 0);
        assert_eq!(requests::Entity::find().count(&db).await.unwrap(), 0);
        assert_eq!(
            workflow_run_data::Entity::find().count(&db).await.unwrap(),
            0
        );
    }

    #[tokio::test]
    async fn a_stale_snapshot_after_a_revoke_does_not_resurrect_the_credential() {
        let db = db().await;
        let mut remote = trigger("t1", "wf-1");
        let live = credential("c1", "t1", CredentialKind::SigningSecret);
        let old = snapshot(&remote, std::slice::from_ref(&live), &[("c1", "whsec_x")]);
        remote.version = 2;
        let mut revoked = live;
        revoked.state = CredentialState::Revoked.as_str().to_string();
        let revoke = snapshot(&remote, &[revoked], &[]);
        apply_snapshot_in(&db, revoke, Vec::new()).await.unwrap();

        let redelivered = apply_snapshot_in(&db, old, prepared("acme", "c1")).await;
        assert_eq!(redelivered.unwrap(), ApplyOutcome::Stale);
        assert_eq!(credential_row(&db, "c1").await.state, "revoked");
        assert_eq!(secret_count(&db, "c1").await, 0);
    }

    #[tokio::test]
    async fn a_credential_missing_from_a_newer_snapshot_is_dropped() {
        let db = db().await;
        let mut remote = trigger("t1", "wf-1");
        let first = snapshot(
            &remote,
            &[credential("c1", "t1", CredentialKind::SigningSecret)],
            &[("c1", "whsec_x")],
        );
        apply_snapshot_in(&db, first, prepared("acme", "c1"))
            .await
            .unwrap();
        remote.version = 2;
        apply_snapshot_in(&db, snapshot(&remote, &[], &[]), Vec::new())
            .await
            .unwrap();
        assert!(list_credentials(&db, "t1").await.unwrap().is_empty());
        assert_eq!(secret_count(&db, "c1").await, 0);
    }

    #[tokio::test]
    async fn a_create_collision_keeps_the_greater_created_at_and_origin() {
        let db = db().await;
        insert_trigger(&db, trigger("tA", "wf-1")).await.unwrap();
        let mut held = credential("cA", "tA", CredentialKind::SigningSecret);
        held.secret_ref = Some("ref-a".to_string());
        insert_credential(&db, held).await.unwrap();
        ledger::enqueue(&db, hook_request("tA", "run-a"), "{}".to_string())
            .await
            .unwrap();

        let mut newer = trigger("tB", "wf-1");
        newer.created_at = NOW + 1;
        newer.origin_cluster = "r2".to_string();
        let won = apply_snapshot_in(
            &db,
            snapshot(
                &newer,
                &[credential("cB", "tB", CredentialKind::SigningSecret)],
                &[("cB", "whsec_b")],
            ),
            prepared("acme", "cB"),
        )
        .await;
        assert_eq!(
            won.unwrap(),
            ApplyOutcome::CollisionWon {
                loser: "tA".to_string()
            }
        );
        assert_eq!(
            get_by_workflow(&db, "acme", "wf-1")
                .await
                .unwrap()
                .unwrap()
                .id,
            "tB"
        );
        let loser = get(&db, "tA").await.unwrap().unwrap();
        assert!(loser.deleted_at.is_some());
        assert_ne!(loser.workflow_id, "wf-1");
        let loser_credential = credential_row(&db, "cA").await;
        assert_eq!(loser_credential.state, "revoked");
        assert_eq!(loser_credential.secret_ref, None);
        assert_eq!(ledger::count_queued_for_org(&db, "acme").await.unwrap(), 0);

        let mut older = trigger("tC", "wf-1");
        older.created_at = NOW - 1;
        let lost = apply_snapshot_in(
            &db,
            snapshot(
                &older,
                &[credential("cC", "tC", CredentialKind::SigningSecret)],
                &[("cC", "whsec_c")],
            ),
            prepared("acme", "cC"),
        )
        .await;
        assert_eq!(lost.unwrap(), ApplyOutcome::CollisionLost);
        assert_eq!(
            get_by_workflow(&db, "acme", "wf-1")
                .await
                .unwrap()
                .unwrap()
                .id,
            "tB"
        );
        assert!(get(&db, "tC").await.unwrap().unwrap().deleted_at.is_some());
        assert_eq!(credential_row(&db, "cC").await.state, "revoked");
        assert_eq!(secret_count(&db, "cC").await, 0);
        assert_eq!(secret_count(&db, "cB").await, 1);
    }

    #[tokio::test]
    async fn tombstone_for_workflow_finds_the_trigger_by_workflow_id() {
        let db = db().await;
        insert_trigger(&db, trigger("t1", "wf-1")).await.unwrap();
        insert_trigger(&db, trigger("t2", "wf-2")).await.unwrap();
        insert_credential(&db, credential("c1", "t1", CredentialKind::Token))
            .await
            .unwrap();
        ledger::enqueue(&db, hook_request("t1", "run-1"), "{}".to_string())
            .await
            .unwrap();

        let found = tombstone_for_workflow(&db, "wf-1", NOW + 9).await.unwrap();
        assert_eq!(found.as_deref(), Some("t1"));
        let stored = get(&db, "t1").await.unwrap().unwrap();
        assert_eq!((stored.deleted_at, stored.version), (Some(NOW + 9), 2));
        assert_eq!(credential_row(&db, "c1").await.state, "revoked");
        assert_eq!(ledger::count_queued_for_org(&db, "acme").await.unwrap(), 0);
        assert!(get(&db, "t2").await.unwrap().unwrap().deleted_at.is_none());
        assert_eq!(
            tombstone_for_workflow(&db, "wf-1", NOW + 10).await.unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn merge_leaves_version_and_updated_at() {
        let db = db().await;
        insert_trigger(&db, trigger("t1", "wf-1")).await.unwrap();
        let deltas = BTreeMap::from([(
            "bad_signature".to_string(),
            RejectionDelta {
                count: 4,
                last_at: NOW,
                last_ip: "198.51.100.9".to_string(),
            },
        )]);
        merge_rejections(&db, "t1", &deltas, NOW).await.unwrap();
        merge_rejections(&db, "t1", &deltas, NOW + 1).await.unwrap();
        let stored = get(&db, "t1").await.unwrap().unwrap();
        assert_eq!((stored.version, stored.updated_at), (1, NOW));
        let entries: BTreeMap<String, RejectionEntry> =
            serde_json::from_str(&stored.rejections.unwrap()).unwrap();
        assert_eq!(entries["bad_signature"].count_24h, 8);
    }

    #[tokio::test]
    async fn tombstones_and_revoked_credentials_older_than_the_cutoff_are_swept() {
        let db = db().await;
        let mut old = trigger("t1", "wf-1");
        old.deleted_at = Some(NOW - TOMBSTONE_TTL_US - 1);
        insert_trigger(&db, old).await.unwrap();
        insert_credential(&db, credential("c1", "t1", CredentialKind::Token))
            .await
            .unwrap();
        insert_trigger(&db, trigger("t2", "wf-2")).await.unwrap();
        let mut revoked = credential("c2", "t2", CredentialKind::Token);
        revoked.state = CredentialState::Revoked.as_str().to_string();
        revoked.revoked_at = Some(NOW - TOMBSTONE_TTL_US - 1);
        insert_credential(&db, revoked).await.unwrap();
        insert_credential(&db, credential("c3", "t2", CredentialKind::Token))
            .await
            .unwrap();

        let swept = delete_tombstones_before(&db, NOW - TOMBSTONE_TTL_US)
            .await
            .unwrap();
        assert_eq!(swept, 3);
        assert!(get(&db, "t1").await.unwrap().is_none());
        let left: Vec<String> = list_credentials(&db, "t2")
            .await
            .unwrap()
            .into_iter()
            .map(|c| c.id)
            .collect();
        assert_eq!(left, ["c3"]);
    }

    #[tokio::test]
    async fn originated_and_expiring_lists_are_scoped_to_the_local_cluster() {
        let db = db().await;
        insert_trigger(&db, trigger("t1", "wf-1")).await.unwrap();
        let mut remote = trigger("t2", "wf-2");
        remote.origin_cluster = "r9".to_string();
        insert_trigger(&db, remote).await.unwrap();
        for (id, trigger_id) in [("c1", "t1"), ("c2", "t2")] {
            let mut retiring = credential(id, trigger_id, CredentialKind::Token);
            retiring.state = CredentialState::Retiring.as_str().to_string();
            retiring.expires_at = Some(NOW - 1);
            insert_credential(&db, retiring).await.unwrap();
        }
        let originated = list_originated(&db, "r1", NOW).await.unwrap();
        assert_eq!(originated.len(), 1);
        let expiring = list_expired_retiring(&db, "r1", NOW).await.unwrap();
        assert_eq!(expiring.len(), 1);
        assert_eq!(expiring[0].id, "c1");
        let enabled = enabled_workflow_ids(&db, "acme").await.unwrap();
        assert_eq!(enabled.len(), 2);
        touch_last_used(&db, "t1", NOW + 3, &["c1".to_string()])
            .await
            .unwrap();
        assert_eq!(credential_row(&db, "c1").await.last_used_at, Some(NOW + 3));
        assert_eq!(delete_by_org(&db, "acme").await.unwrap(), 4);
    }
}
