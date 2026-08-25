// Copyright 2026 OpenObserve Inc.
//
// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

//! Encrypted persistence for outbound LLM integration secrets.
//!
//! This is the only module that converts secret plaintext to or from a table
//! row. Callers work with [`SecretRecord`]; the entity and database contain
//! only AES-256-SIV ciphertext encrypted with the organization DEK.

use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    Set,
};

use crate::{
    db::get_orm_client_rw,
    errors,
    table::{
        cipher,
        entity::llm_secrets::{ActiveModel, Column, Entity, Model},
    },
};

/// A decrypted record at the internal service boundary.
///
/// Its `Debug` implementation deliberately redacts the value so error paths
/// and tracing cannot accidentally reveal it.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretRecord {
    pub id: String,
    pub secret_ref: String,
    pub org_id: String,
    pub owner_kind: String,
    pub owner_id: String,
    pub purpose: String,
    pub key_id: Option<String>,
    pub state: String,
    pub value: String,
    pub last_verified_at: Option<i64>,
    pub grace_expires_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
}

impl std::fmt::Debug for SecretRecord {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SecretRecord")
            .field("id", &self.id)
            .field("secret_ref", &self.secret_ref)
            .field("org_id", &self.org_id)
            .field("owner_kind", &self.owner_kind)
            .field("owner_id", &self.owner_id)
            .field("purpose", &self.purpose)
            .field("key_id", &self.key_id)
            .field("state", &self.state)
            .field("value", &"<redacted>")
            .field("last_verified_at", &self.last_verified_at)
            .field("grace_expires_at", &self.grace_expires_at)
            .field("created_at", &self.created_at)
            .field("updated_at", &self.updated_at)
            .finish()
    }
}

pub async fn client() -> &'static DatabaseConnection {
    get_orm_client_rw().await
}

fn encrypt_data(dek: &[u8], plaintext: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .encrypt(dek, plaintext)
        .map_err(|error| errors::Error::Message(error.to_string()))
}

fn decrypt_data(dek: &[u8], ciphertext: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .decrypt(dek, ciphertext)
        .map_err(|error| errors::Error::Message(error.to_string()))
}

/// Encrypt a service-layer record before opening any transaction that might
/// need the same SQLite write lock while provisioning an organization DEK.
pub async fn encrypted_active_model(secret: &SecretRecord) -> Result<ActiveModel, errors::Error> {
    let dek = cipher::get_dek(&secret.org_id).await?;
    let ciphertext = encrypt_data(&dek, &secret.value)?;
    Ok(ActiveModel {
        id: Set(secret.id.clone()),
        secret_ref: Set(secret.secret_ref.clone()),
        org_id: Set(secret.org_id.clone()),
        owner_kind: Set(secret.owner_kind.clone()),
        owner_id: Set(secret.owner_id.clone()),
        purpose: Set(secret.purpose.clone()),
        key_id: Set(secret.key_id.clone()),
        state: Set(secret.state.clone()),
        ciphertext: Set(ciphertext),
        last_verified_at: Set(secret.last_verified_at),
        grace_expires_at: Set(secret.grace_expires_at),
        created_at: Set(secret.created_at),
        updated_at: Set(secret.updated_at),
    })
}

pub async fn decrypt_model(model: Model) -> Result<SecretRecord, errors::Error> {
    let dek = cipher::get_dek(&model.org_id).await?;
    let value = decrypt_data(&dek, &model.ciphertext)?;
    Ok(SecretRecord {
        id: model.id,
        secret_ref: model.secret_ref,
        org_id: model.org_id,
        owner_kind: model.owner_kind,
        owner_id: model.owner_id,
        purpose: model.purpose,
        key_id: model.key_id,
        state: model.state,
        value,
        last_verified_at: model.last_verified_at,
        grace_expires_at: model.grace_expires_at,
        created_at: model.created_at,
        updated_at: model.updated_at,
    })
}

pub async fn insert<C: ConnectionTrait>(db: &C, model: ActiveModel) -> Result<(), sea_orm::DbErr> {
    Entity::insert(model).exec(db).await?;
    Ok(())
}

pub async fn update<C: ConnectionTrait>(db: &C, model: ActiveModel) -> Result<(), sea_orm::DbErr> {
    model.update(db).await?;
    Ok(())
}

pub async fn find_state<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    secret_ref: &str,
    state: &str,
) -> Result<Option<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretRef.eq(secret_ref))
        .filter(Column::State.eq(state))
        .one(db)
        .await
}

pub async fn find_all_by_ref<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    secret_ref: &str,
) -> Result<Vec<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::SecretRef.eq(secret_ref))
        .all(db)
        .await
}

pub async fn find_all_by_owner<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    owner_kind: &str,
    owner_id: &str,
) -> Result<Vec<Model>, sea_orm::DbErr> {
    Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::OwnerKind.eq(owner_kind))
        .filter(Column::OwnerId.eq(owner_id))
        .all(db)
        .await
}

pub async fn delete_by_owner<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    owner_kind: &str,
    owner_id: &str,
) -> Result<u64, sea_orm::DbErr> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::OwnerKind.eq(owner_kind))
        .filter(Column::OwnerId.eq(owner_id))
        .exec(db)
        .await?
        .rows_affected)
}

pub async fn delete_expired_retired<C: ConnectionTrait>(
    db: &C,
    now: i64,
) -> Result<u64, sea_orm::DbErr> {
    Ok(Entity::delete_many()
        .filter(Column::State.eq("retired"))
        .filter(Column::GraceExpiresAt.lte(now))
        .exec(db)
        .await?
        .rows_affected)
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::utils::rand::random_bytes;

    use super::*;

    fn record() -> SecretRecord {
        SecretRecord {
            id: "value-1".to_string(),
            secret_ref: "secret-1".to_string(),
            org_id: "org".to_string(),
            owner_kind: "task".to_string(),
            owner_id: "task-1".to_string(),
            purpose: "auth".to_string(),
            key_id: None,
            state: "current".to_string(),
            value: "do-not-log".to_string(),
            last_verified_at: None,
            grace_expires_at: None,
            created_at: 1,
            updated_at: 1,
        }
    }

    #[test]
    fn debug_redacts_plaintext() {
        let rendered = format!("{:?}", record());
        assert!(rendered.contains("<redacted>"));
        assert!(!rendered.contains("do-not-log"));
    }

    #[test]
    fn encryption_round_trip_keeps_plaintext_out_of_ciphertext() {
        let key = BASE64_STANDARD
            .decode(BASE64_STANDARD.encode(random_bytes(64)))
            .unwrap();
        let encrypted = encrypt_data(&key, "sensitive").unwrap();
        assert!(!encrypted.contains("sensitive"));
        assert_eq!(decrypt_data(&key, &encrypted).unwrap(), "sensitive");
    }
}
