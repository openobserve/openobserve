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

//! Encrypted, write-only secrets for outbound LLM integrations.
//!
//! Versioned Remote Task and Remote Scorer configuration stores only a stable
//! `secret_ref`. This module owns the mutable value behind that reference and
//! the current/candidate/retired signing-key state machine.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::Utc;
use config::ider;
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, EntityTrait, IntoActiveModel, QueryFilter, Set,
    TransactionTrait,
};
use serde::{Deserialize, Serialize};

use crate::table::{
    entity::llm_secrets::{ActiveModel, Column, Entity, Model},
    llm_secrets::{self as table, SecretRecord},
};

pub const MAX_GRACE_MS: i64 = 24 * 60 * 60 * 1_000;
pub const CURRENT: &str = "current";
pub const CANDIDATE: &str = "candidate";
const RETIRED: &str = "retired";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretOwnerKind {
    Task,
    Scorer,
    PromptWebhook,
}

impl SecretOwnerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Task => "task",
            Self::Scorer => "scorer",
            Self::PromptWebhook => "prompt_webhook",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SecretPurpose {
    Auth,
    Signing,
    SigningToken,
}

impl SecretPurpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auth => "auth",
            Self::Signing => "signing",
            Self::SigningToken => "signing_token",
        }
    }

    fn parse(value: &str) -> Result<Self, SecretError> {
        match value {
            "auth" => Ok(Self::Auth),
            "signing" => Ok(Self::Signing),
            "signing_token" => Ok(Self::SigningToken),
            other => Err(SecretError::Malformed(format!(
                "unknown secret purpose '{other}'"
            ))),
        }
    }
}

/// Plaintext accepted at the write-only service boundary.
#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SecretMaterial {
    Token { value: String },
    Basic { username: String, password: String },
}

impl std::fmt::Debug for SecretMaterial {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Token { .. } => f
                .debug_struct("Token")
                .field("value", &"<redacted>")
                .finish(),
            Self::Basic { username, .. } => f
                .debug_struct("Basic")
                .field("username", username)
                .field("password", &"<redacted>")
                .finish(),
        }
    }
}

impl SecretMaterial {
    fn validate(&self) -> Result<(), SecretError> {
        match self {
            Self::Token { value } if value.trim().is_empty() => Err(SecretError::Invalid(
                "secret value cannot be empty".to_string(),
            )),
            Self::Basic { username, password }
                if username.trim().is_empty() || password.is_empty() =>
            {
                Err(SecretError::Invalid(
                    "basic credentials require a username and password".to_string(),
                ))
            }
            _ => Ok(()),
        }
    }

    fn encode(&self) -> Result<String, SecretError> {
        self.validate()?;
        serde_json::to_string(self).map_err(|error| SecretError::Malformed(error.to_string()))
    }

    fn decode(value: &str) -> Result<Self, SecretError> {
        let material: Self = serde_json::from_str(value)
            .map_err(|error| SecretError::Malformed(error.to_string()))?;
        material.validate()?;
        Ok(material)
    }
}

/// Non-sensitive metadata safe to return from read APIs.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretMetadata {
    pub secret_ref: String,
    pub owner_kind: SecretOwnerKind,
    pub owner_id: String,
    pub purpose: SecretPurpose,
    pub key_id: Option<String>,
    pub state: String,
    pub last_verified_at: Option<i64>,
    pub grace_expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

/// Returned only by create/replace/rotate. There is no read API for `value`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WrittenSecret {
    pub metadata: SecretMetadata,
    pub material: SecretMaterial,
}

/// An encrypted row prepared before a database transaction begins.
///
/// Organization DEK provisioning can itself need the SQLite write lock, so
/// registration encrypts every value first and only then opens the transaction
/// that inserts the task draft and all of its Secret rows.
pub struct PreparedSecret {
    active: ActiveModel,
    written: WrittenSecret,
}

impl PreparedSecret {
    pub fn secret_ref(&self) -> &str {
        &self.written.metadata.secret_ref
    }

    pub fn key_id(&self) -> Option<&str> {
        self.written.metadata.key_id.as_deref()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("secret not found")]
    NotFound,
    #[error("secret state conflict: {0}")]
    Conflict(String),
    #[error("invalid secret: {0}")]
    Invalid(String),
    #[error("candidate secret must pass an explicit test before activation")]
    CandidateNotVerified,
    #[error("secret does not belong to this integration")]
    OwnerMismatch,
    #[error("malformed secret: {0}")]
    Malformed(String),
    #[error("secret database error: {0}")]
    Database(#[from] sea_orm::DbErr),
    #[error("secret encryption error: {0}")]
    Encryption(String),
}

fn map_infra(error: crate::errors::Error) -> SecretError {
    SecretError::Encryption(error.to_string())
}

fn now_ms() -> i64 {
    Utc::now().timestamp_millis()
}

pub fn generate_signing_material() -> SecretMaterial {
    SecretMaterial::Token {
        value: URL_SAFE_NO_PAD.encode(config::utils::rand::random_bytes(32)),
    }
}

pub fn generate_key_id() -> String {
    ider::generate()
}

fn metadata(model: &Model) -> Result<SecretMetadata, SecretError> {
    Ok(SecretMetadata {
        secret_ref: model.secret_ref.clone(),
        owner_kind: match model.owner_kind.as_str() {
            "task" => SecretOwnerKind::Task,
            "scorer" => SecretOwnerKind::Scorer,
            "prompt_webhook" => SecretOwnerKind::PromptWebhook,
            other => {
                return Err(SecretError::Malformed(format!(
                    "unknown secret owner kind '{other}'"
                )));
            }
        },
        owner_id: model.owner_id.clone(),
        purpose: SecretPurpose::parse(&model.purpose)?,
        key_id: model.key_id.clone(),
        state: model.state.clone(),
        last_verified_at: model.last_verified_at,
        grace_expires_at: model.grace_expires_at,
        created_at: model.created_at,
        updated_at: model.updated_at,
    })
}

fn ensure_shape(purpose: SecretPurpose, material: &SecretMaterial) -> Result<(), SecretError> {
    material.validate()?;
    if matches!(
        purpose,
        SecretPurpose::Signing | SecretPurpose::SigningToken
    ) && !matches!(material, SecretMaterial::Token { .. })
    {
        return Err(SecretError::Invalid(
            "signing secrets must contain token material".to_string(),
        ));
    }
    Ok(())
}

fn ensure_owner(
    model: &Model,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
) -> Result<(), SecretError> {
    if model.owner_kind != owner_kind.as_str() || model.owner_id != owner_id {
        return Err(SecretError::OwnerMismatch);
    }
    Ok(())
}

pub async fn create(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    purpose: SecretPurpose,
    key_id: Option<String>,
    material: SecretMaterial,
) -> Result<WrittenSecret, SecretError> {
    let prepared = prepare_create(org_id, owner_kind, owner_id, purpose, key_id, material).await?;
    let db = table::client().await;
    insert_prepared(db, prepared).await
}

pub async fn prepare_create(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    purpose: SecretPurpose,
    key_id: Option<String>,
    material: SecretMaterial,
) -> Result<PreparedSecret, SecretError> {
    ensure_shape(purpose, &material)?;
    if owner_id.trim().is_empty() {
        return Err(SecretError::Invalid("owner_id cannot be empty".to_string()));
    }
    let key_id = match purpose {
        SecretPurpose::Auth => None,
        SecretPurpose::Signing | SecretPurpose::SigningToken => Some(
            key_id
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(generate_key_id),
        ),
    };
    let now = now_ms();
    let record = SecretRecord {
        id: ider::generate(),
        secret_ref: ider::generate(),
        org_id: org_id.to_string(),
        owner_kind: owner_kind.as_str().to_string(),
        owner_id: owner_id.to_string(),
        purpose: purpose.as_str().to_string(),
        key_id,
        state: CURRENT.to_string(),
        value: material.encode()?,
        last_verified_at: None,
        grace_expires_at: None,
        created_at: now,
        updated_at: now,
    };
    let active = table::encrypted_active_model(&record)
        .await
        .map_err(map_infra)?;
    let written = WrittenSecret {
        metadata: SecretMetadata {
            secret_ref: record.secret_ref,
            owner_kind,
            owner_id: record.owner_id,
            purpose,
            key_id: record.key_id,
            state: record.state,
            last_verified_at: record.last_verified_at,
            grace_expires_at: record.grace_expires_at,
            created_at: record.created_at,
            updated_at: record.updated_at,
        },
        material,
    };
    Ok(PreparedSecret { active, written })
}

pub async fn insert_prepared<C: ConnectionTrait>(
    db: &C,
    prepared: PreparedSecret,
) -> Result<WrittenSecret, SecretError> {
    table::insert(db, prepared.active).await?;
    Ok(prepared.written)
}

/// Replace an auth credential in place. The stable reference and Task/Scorer
/// version remain unchanged; auth has no candidate/grace protocol.
pub async fn replace_auth(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
    material: SecretMaterial,
) -> Result<SecretMetadata, SecretError> {
    replace_current(
        org_id,
        owner_kind,
        owner_id,
        secret_ref,
        SecretPurpose::Auth,
        material,
    )
    .await
}

/// Replaces a current secret while retaining its stable reference.
pub async fn replace_current(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
    purpose: SecretPurpose,
    material: SecretMaterial,
) -> Result<SecretMetadata, SecretError> {
    ensure_shape(purpose, &material)?;
    let db = table::client().await;
    let current = table::find_state(db, org_id, secret_ref, CURRENT)
        .await?
        .ok_or(SecretError::NotFound)?;
    ensure_owner(&current, owner_kind, owner_id)?;
    if current.purpose != purpose.as_str() {
        return Err(SecretError::Invalid(format!(
            "secret purpose is '{}', not '{}'",
            current.purpose,
            purpose.as_str()
        )));
    }
    let record = SecretRecord {
        id: current.id.clone(),
        secret_ref: current.secret_ref.clone(),
        org_id: current.org_id.clone(),
        owner_kind: current.owner_kind.clone(),
        owner_id: current.owner_id.clone(),
        purpose: current.purpose.clone(),
        key_id: current.key_id.clone(),
        state: CURRENT.to_string(),
        value: material.encode()?,
        last_verified_at: None,
        grace_expires_at: None,
        created_at: current.created_at,
        updated_at: now_ms(),
    };
    let active = table::encrypted_active_model(&record)
        .await
        .map_err(map_infra)?;
    table::update(db, active).await?;
    let model = table::find_state(db, org_id, secret_ref, CURRENT)
        .await?
        .ok_or(SecretError::NotFound)?;
    metadata(&model)
}

pub async fn rotate_signing(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
    key_id: Option<String>,
    material: SecretMaterial,
) -> Result<WrittenSecret, SecretError> {
    ensure_shape(SecretPurpose::Signing, &material)?;
    let db = table::client().await;
    let current = table::find_state(db, org_id, secret_ref, CURRENT)
        .await?
        .ok_or(SecretError::NotFound)?;
    ensure_owner(&current, owner_kind, owner_id)?;
    if current.purpose != SecretPurpose::Signing.as_str() {
        return Err(SecretError::Invalid(
            "only signing secrets use candidate rotation".to_string(),
        ));
    }
    if table::find_state(db, org_id, secret_ref, CANDIDATE)
        .await?
        .is_some()
    {
        return Err(SecretError::Conflict(
            "a candidate already exists".to_string(),
        ));
    }
    if let Some(retired) = table::find_state(db, org_id, secret_ref, RETIRED).await? {
        if retired
            .grace_expires_at
            .is_none_or(|expires| expires > now_ms())
        {
            return Err(SecretError::Conflict(
                "the previous signing key is still in its grace period".to_string(),
            ));
        }
        Entity::delete_by_id(retired.id).exec(db).await?;
    }

    let now = now_ms();
    let record = SecretRecord {
        id: ider::generate(),
        secret_ref: secret_ref.to_string(),
        org_id: org_id.to_string(),
        owner_kind: current.owner_kind,
        owner_id: current.owner_id,
        purpose: current.purpose,
        key_id: Some(
            key_id
                .filter(|value| !value.trim().is_empty())
                .unwrap_or_else(generate_key_id),
        ),
        state: CANDIDATE.to_string(),
        value: material.encode()?,
        last_verified_at: None,
        grace_expires_at: None,
        created_at: now,
        updated_at: now,
    };
    let active = table::encrypted_active_model(&record)
        .await
        .map_err(map_infra)?;
    table::insert(db, active).await.map_err(|error| {
        if error.to_string().contains("uq_llm_secrets_ref_state") {
            SecretError::Conflict("a candidate already exists".to_string())
        } else {
            SecretError::Database(error)
        }
    })?;
    let model = table::find_state(db, org_id, secret_ref, CANDIDATE)
        .await?
        .ok_or(SecretError::NotFound)?;
    Ok(WrittenSecret {
        metadata: metadata(&model)?,
        material,
    })
}

pub async fn mark_candidate_verified(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
) -> Result<SecretMetadata, SecretError> {
    let db = table::client().await;
    let candidate = table::find_state(db, org_id, secret_ref, CANDIDATE)
        .await?
        .ok_or(SecretError::NotFound)?;
    ensure_owner(&candidate, owner_kind, owner_id)?;
    let now = now_ms();
    let mut active = candidate.into_active_model();
    active.last_verified_at = Set(Some(now));
    active.updated_at = Set(now);
    let updated = active.update(db).await?;
    metadata(&updated)
}

pub async fn activate_signing(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
    requested_grace_ms: i64,
) -> Result<SecretMetadata, SecretError> {
    if !(0..=MAX_GRACE_MS).contains(&requested_grace_ms) {
        return Err(SecretError::Invalid(format!(
            "grace period must be between 0 and {MAX_GRACE_MS} milliseconds"
        )));
    }
    let db = table::client().await;
    let current = table::find_state(db, org_id, secret_ref, CURRENT)
        .await?
        .ok_or(SecretError::NotFound)?;
    ensure_owner(&current, owner_kind, owner_id)?;
    let candidate = table::find_state(db, org_id, secret_ref, CANDIDATE)
        .await?
        .ok_or(SecretError::NotFound)?;
    ensure_owner(&candidate, owner_kind, owner_id)?;
    if candidate.last_verified_at.is_none() {
        return Err(SecretError::CandidateNotVerified);
    }
    if let Some(retired) = table::find_state(db, org_id, secret_ref, RETIRED).await? {
        if retired
            .grace_expires_at
            .is_none_or(|expires| expires > now_ms())
        {
            return Err(SecretError::Conflict(
                "the previous signing key is still in its grace period".to_string(),
            ));
        }
        Entity::delete_by_id(retired.id).exec(db).await?;
    }

    let now = now_ms();
    let txn = db.begin().await?;
    let mut old = current.into_active_model();
    old.state = Set(RETIRED.to_string());
    old.grace_expires_at = Set(Some(now + requested_grace_ms));
    old.updated_at = Set(now);
    old.update(&txn).await?;

    let mut next = candidate.into_active_model();
    next.state = Set(CURRENT.to_string());
    next.updated_at = Set(now);
    let active = next.update(&txn).await?;
    txn.commit().await?;
    metadata(&active)
}

pub async fn end_grace_early(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
) -> Result<(), SecretError> {
    let db = table::client().await;
    let retired = table::find_state(db, org_id, secret_ref, RETIRED)
        .await?
        .ok_or(SecretError::NotFound)?;
    ensure_owner(&retired, owner_kind, owner_id)?;
    Entity::delete_by_id(retired.id).exec(db).await?;
    Ok(())
}

pub async fn revoke(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    secret_ref: &str,
) -> Result<(), SecretError> {
    let db = table::client().await;
    let result = Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::OwnerKind.eq(owner_kind.as_str()))
        .filter(Column::OwnerId.eq(owner_id))
        .filter(Column::SecretRef.eq(secret_ref))
        .exec(db)
        .await?;
    if result.rows_affected == 0 {
        return Err(SecretError::NotFound);
    }
    Ok(())
}

pub async fn list_for_owner(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
) -> Result<Vec<SecretMetadata>, SecretError> {
    let rows =
        table::find_all_by_owner(table::client().await, org_id, owner_kind.as_str(), owner_id)
            .await?;
    rows.iter().map(metadata).collect()
}

pub async fn delete_for_owner(
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
) -> Result<u64, SecretError> {
    Ok(
        table::delete_by_owner(table::client().await, org_id, owner_kind.as_str(), owner_id)
            .await?,
    )
}

pub async fn delete_for_owner_in<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
) -> Result<u64, SecretError> {
    Ok(table::delete_by_owner(db, org_id, owner_kind.as_str(), owner_id).await?)
}

pub async fn sweep_expired() -> Result<u64, SecretError> {
    Ok(table::delete_expired_retired(table::client().await, now_ms()).await?)
}

pub async fn resolve_record(
    org_id: &str,
    secret_ref: &str,
    owner_kind: SecretOwnerKind,
    owner_id: &str,
    state: &str,
) -> Result<(SecretMetadata, SecretMaterial), SecretError> {
    let model = table::find_state(table::client().await, org_id, secret_ref, state)
        .await?
        .ok_or(SecretError::NotFound)?;
    if model.owner_kind != owner_kind.as_str() || model.owner_id != owner_id {
        return Err(SecretError::OwnerMismatch);
    }
    let safe = metadata(&model)?;
    let record = table::decrypt_model(model).await.map_err(map_infra)?;
    Ok((safe, SecretMaterial::decode(&record.value)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn material_debug_is_redacted() {
        let token = SecretMaterial::Token {
            value: "very-secret".to_string(),
        };
        assert!(!format!("{token:?}").contains("very-secret"));
    }

    #[test]
    fn grace_period_never_exceeds_twenty_four_hours() {
        assert_eq!(MAX_GRACE_MS, 86_400_000);
    }

    #[test]
    fn generated_signing_material_has_no_empty_value() {
        let SecretMaterial::Token { value } = generate_signing_material() else {
            panic!("signing material must be a token")
        };
        assert!(!value.is_empty());
    }
}
