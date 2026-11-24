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

//! Encrypted persistence for outbound LLM integration secrets.
//!
//! This is the only module that converts secret plaintext to or from a table
//! row. Callers work with [`SecretRecord`]; the entity and database contain
//! only AES-256-SIV ciphertext encrypted with the organization DEK.

use aes_siv::{KeyInit, siv::Aes256Siv};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::meta::secret_store::{SecretKind, SecretValue};
use sea_orm::{
    ActiveModelTrait, ColumnTrait, ConnectionTrait, DatabaseConnection, EntityTrait, QueryFilter,
    Set,
};
use zeroize::Zeroizing;

use crate::{
    db::get_orm_client_rw,
    errors,
    table::{
        cipher,
        entity::credential_values::{ActiveModel, Column, Entity, Model},
    },
};

/// Prefix of every ciphertext sealed with associated data.
pub const AD_PREFIX: &str = "o2ad1:";
/// Stored `owner_kind` of a named store value, a P1-E pointer row and an owned probe token.
pub const OWNER_KIND_ORG_SECRET: &str = "org_secret";
pub const OWNER_KIND_ORG_SECRET_POINTER: &str = "org_secret_pointer";
pub const OWNER_KIND_PROBE_TOKEN: &str = "probe_token";
pub const OWNER_KIND_SECRET_BACKEND: &str = "secret_backend";

/// How a row is sealed, decided by the trusted caller and never by the row's owner kind.
pub enum SlotClass<'a> {
    /// Task, Scorer, PromptWebhook and WorkflowTrigger rows: no associated data.
    Legacy,
    NamedValue(NamedValueAd<'a>),
    ProbeToken(ProbeTokenAd<'a>),
    SecretBackend(SecretBackendAd<'a>),
}

impl SlotClass<'_> {
    fn bound_owner(&self) -> Option<(&str, &str, &str, &str)> {
        match self {
            Self::Legacy => None,
            Self::NamedValue(ad) => Some((
                ad.org_id,
                ad.class.owner_kind(),
                ad.value_row_id,
                ad.secret_ref,
            )),
            Self::ProbeToken(ad) => Some((
                ad.org_id,
                OWNER_KIND_PROBE_TOKEN,
                ad.token_id,
                ad.secret_ref,
            )),
            Self::SecretBackend(ad) => Some((
                ad.org_id,
                OWNER_KIND_SECRET_BACKEND,
                ad.backend_id,
                ad.secret_ref,
            )),
        }
    }

    fn associated_data(&self) -> Option<Vec<u8>> {
        match self {
            Self::Legacy => None,
            Self::NamedValue(ad) => Some(encode_ad(&[
                ad.org_id.as_bytes(),
                ad.class.as_str().as_bytes(),
                ad.value_row_id.as_bytes(),
                ad.secret_ref.as_bytes(),
                ad.secret_id.as_bytes(),
                ad.kind.as_str().as_bytes(),
                ad.env_id.as_bytes(),
                ad.env_incarnation.as_bytes(),
                ad.value_rev.as_bytes(),
            ])),
            Self::ProbeToken(ad) => Some(encode_ad(&[
                ad.org_id.as_bytes(),
                b"ProbeToken",
                ad.token_id.as_bytes(),
                ad.secret_ref.as_bytes(),
                ad.token_sha256.as_bytes(),
            ])),
            Self::SecretBackend(ad) => Some(encode_ad(&[
                ad.org_id.as_bytes(),
                b"SecretBackend",
                ad.backend_id.as_bytes(),
                ad.secret_ref.as_bytes(),
                ad.origin.as_bytes(),
                ad.credential_rev.as_bytes(),
            ])),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NamedValueClass {
    OrgSecret,
    OrgSecretPointer,
}

impl NamedValueClass {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::OrgSecret => "OrgSecret",
            Self::OrgSecretPointer => "OrgSecretPointer",
        }
    }

    pub fn owner_kind(self) -> &'static str {
        match self {
            Self::OrgSecret => OWNER_KIND_ORG_SECRET,
            Self::OrgSecretPointer => OWNER_KIND_ORG_SECRET_POINTER,
        }
    }
}

/// Every field comes from the authorized `(org_id, secret_id, env)` lookup, not the value row.
pub struct NamedValueAd<'a> {
    pub org_id: &'a str,
    pub class: NamedValueClass,
    pub value_row_id: &'a str,
    pub secret_ref: &'a str,
    pub secret_id: &'a str,
    pub kind: SecretKind,
    pub env_id: &'a str,
    pub env_incarnation: &'a str,
    pub value_rev: &'a str,
}

pub struct ProbeTokenAd<'a> {
    pub org_id: &'a str,
    pub token_id: &'a str,
    pub secret_ref: &'a str,
    pub token_sha256: &'a str,
}

pub struct SecretBackendAd<'a> {
    pub org_id: &'a str,
    pub backend_id: &'a str,
    pub secret_ref: &'a str,
    /// The normalized `scheme://host:port` pins the credential to the backend origin.
    pub origin: &'a str,
    pub credential_rev: &'a str,
}

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
    pub value: SecretValue,
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

/// Why a stored value did not open. Every variant but `Other` means the row failed to
/// authenticate as the caller's slot.
#[derive(Debug)]
pub enum OpenError {
    NotCallersSlot,
    Refused,
    NotUtf8,
    Other(errors::Error),
}

impl OpenError {
    pub fn is_authentication_failure(&self) -> bool {
        !matches!(self, Self::Other(_))
    }
}

impl std::fmt::Display for OpenError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NotCallersSlot => f.write_str("the row does not belong to the caller's slot"),
            Self::Refused => f.write_str("sealed value refused"),
            Self::NotUtf8 => f.write_str("sealed value is not UTF-8"),
            Self::Other(error) => error.fmt(f),
        }
    }
}

impl From<OpenError> for errors::Error {
    fn from(error: OpenError) -> Self {
        match error {
            OpenError::Other(error) => error,
            refused => errors::Error::Message(refused.to_string()),
        }
    }
}

pub async fn client() -> &'static DatabaseConnection {
    get_orm_client_rw().await
}

/// Seals `plaintext` under `ad`; the result carries [`AD_PREFIX`].
pub fn encrypt_with_ad(
    dek: &[u8],
    plaintext: &[u8],
    ad: &[&[u8]],
) -> Result<String, errors::Error> {
    seal(dek, plaintext, &encode_ad(ad))
}

/// Opens a ciphertext sealed by [`encrypt_with_ad`]; any other form or AD is refused.
pub fn decrypt_with_ad(
    dek: &[u8],
    ciphertext: &str,
    ad: &[&[u8]],
) -> Result<Zeroizing<Vec<u8>>, errors::Error> {
    open(dek, ciphertext, &encode_ad(ad))
}

/// Encrypt a service-layer record before opening any transaction that might
/// need the same SQLite write lock while provisioning an organization DEK.
pub async fn encrypted_active_model(
    secret: &SecretRecord,
    slot: &SlotClass<'_>,
) -> Result<ActiveModel, errors::Error> {
    let dek = Zeroizing::new(cipher::get_dek(&secret.org_id).await?);
    let ad = checked_ad(
        slot,
        &secret.org_id,
        &secret.owner_kind,
        &secret.owner_id,
        &secret.secret_ref,
    )?;
    seal_record(&dek, secret, ad.as_deref())
}

pub async fn encrypted_active_model_in<C: ConnectionTrait>(
    conn: &C,
    secret: &SecretRecord,
    slot: &SlotClass<'_>,
) -> Result<ActiveModel, errors::Error> {
    let ad = checked_ad(
        slot,
        &secret.org_id,
        &secret.owner_kind,
        &secret.owner_id,
        &secret.secret_ref,
    )?;
    let dek = existing_dek_in(conn, &secret.org_id).await?;
    seal_record(&dek, secret, ad.as_deref())
}

/// Checks the stored owner fields against the caller's slot before any decrypt.
pub async fn decrypt_model(
    model: Model,
    slot: &SlotClass<'_>,
) -> Result<SecretRecord, errors::Error> {
    let ad = checked_ad(
        slot,
        &model.org_id,
        &model.owner_kind,
        &model.owner_id,
        &model.secret_ref,
    )?;
    let dek = Zeroizing::new(cipher::get_dek(&model.org_id).await?);
    Ok(open_record(&dek, model, ad.as_deref())?)
}

pub async fn decrypt_model_in<C: ConnectionTrait>(
    conn: &C,
    model: Model,
    slot: &SlotClass<'_>,
) -> Result<SecretRecord, OpenError> {
    let ad = checked_ad(
        slot,
        &model.org_id,
        &model.owner_kind,
        &model.owner_id,
        &model.secret_ref,
    )?;
    let dek = existing_dek_in(conn, &model.org_id)
        .await
        .map_err(OpenError::Other)?;
    open_record(&dek, model, ad.as_deref())
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

/// Ciphertext under the org DEK, so it must go before the DEK does.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

pub async fn delete_by_org_owner_kind<C: ConnectionTrait>(
    db: &C,
    org_id: &str,
    owner_kind: &str,
) -> Result<u64, sea_orm::DbErr> {
    Ok(Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::OwnerKind.eq(owner_kind))
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

async fn existing_dek_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Zeroizing<Vec<u8>>, errors::Error> {
    cipher::get_existing_dek_in(conn, org)
        .await?
        .map(Zeroizing::new)
        .ok_or_else(|| errors::Error::Message("the org has no encryption key".to_string()))
}

fn seal_record(
    dek: &[u8],
    secret: &SecretRecord,
    ad: Option<&[u8]>,
) -> Result<ActiveModel, errors::Error> {
    let ciphertext = match ad {
        None => encrypt_data(dek, &secret.value)?,
        Some(ad) => seal(dek, secret.value.as_bytes(), ad)?,
    };
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

fn open_record(dek: &[u8], model: Model, ad: Option<&[u8]>) -> Result<SecretRecord, OpenError> {
    let value = match ad {
        None => Zeroizing::new(decrypt_data(dek, &model.ciphertext).map_err(OpenError::Other)?),
        Some(ad) => {
            let bytes = open(dek, &model.ciphertext, ad).map_err(|_| OpenError::Refused)?;
            let text = std::str::from_utf8(&bytes).map_err(|_| OpenError::NotUtf8)?;
            Zeroizing::new(text.to_string())
        }
    };
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

fn checked_ad(
    slot: &SlotClass<'_>,
    org_id: &str,
    owner_kind: &str,
    owner_id: &str,
    secret_ref: &str,
) -> Result<Option<Vec<u8>>, OpenError> {
    let ad = slot.associated_data();
    match &ad {
        None => refuse_bound_kind(owner_kind).map_err(OpenError::Other)?,
        Some(_) => check_bound_owner(slot, org_id, owner_kind, owner_id, secret_ref)?,
    }
    Ok(ad)
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

/// Length-prefixed (u32 big-endian) concatenation, so no two component lists encode alike.
fn encode_ad(components: &[&[u8]]) -> Vec<u8> {
    let mut out = Vec::with_capacity(components.iter().map(|c| c.len() + 4).sum());
    for component in components {
        out.extend_from_slice(&(component.len() as u32).to_be_bytes());
        out.extend_from_slice(component);
    }
    out
}

fn seal(dek: &[u8], plaintext: &[u8], ad: &[u8]) -> Result<String, errors::Error> {
    let mut cipher = Aes256Siv::new_from_slice(dek)
        .map_err(|_| errors::Error::Message("invalid data encryption key".to_string()))?;
    let sealed = cipher
        .encrypt([ad], plaintext)
        .map_err(|_| errors::Error::Message("sealing a value failed".to_string()))?;
    Ok(format!("{AD_PREFIX}{}", BASE64_STANDARD.encode(sealed)))
}

fn open(dek: &[u8], ciphertext: &str, ad: &[u8]) -> Result<Zeroizing<Vec<u8>>, errors::Error> {
    let refused = || errors::Error::Message("sealed value refused".to_string());
    let body = ciphertext.strip_prefix(AD_PREFIX).ok_or_else(refused)?;
    let sealed = BASE64_STANDARD.decode(body).map_err(|_| refused())?;
    let mut cipher = Aes256Siv::new_from_slice(dek).map_err(|_| refused())?;
    cipher
        .decrypt([ad], &sealed)
        .map(Zeroizing::new)
        .map_err(|_| refused())
}

/// A row of an AD-bound kind never goes through the legacy path, in either direction.
fn refuse_bound_kind(owner_kind: &str) -> Result<(), errors::Error> {
    if [
        OWNER_KIND_ORG_SECRET,
        OWNER_KIND_ORG_SECRET_POINTER,
        OWNER_KIND_PROBE_TOKEN,
        OWNER_KIND_SECRET_BACKEND,
    ]
    .contains(&owner_kind)
    {
        return Err(errors::Error::Message(format!(
            "owner kind {owner_kind} requires a bound slot"
        )));
    }
    Ok(())
}

fn check_bound_owner(
    slot: &SlotClass<'_>,
    org_id: &str,
    owner_kind: &str,
    owner_id: &str,
    secret_ref: &str,
) -> Result<(), OpenError> {
    match slot.bound_owner() {
        Some(expected) if expected == (org_id, owner_kind, owner_id, secret_ref) => Ok(()),
        _ => Err(OpenError::NotCallersSlot),
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use config::utils::rand::random_bytes;
    use sea_orm::{TransactionTrait, TryIntoModel};
    use tokio::time::timeout;

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
            value: "do-not-log".to_string().into(),
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

    fn named<'a>(value_row_id: &'a str, secret_id: &'a str, env_id: &'a str) -> NamedValueAd<'a> {
        NamedValueAd {
            org_id: "acme",
            class: NamedValueClass::OrgSecret,
            value_row_id,
            secret_ref: "ref-1",
            secret_id,
            kind: SecretKind::Secret,
            env_id,
            env_incarnation: "inc-1",
            value_rev: "rev-1",
        }
    }

    fn sealed_under(dek: &[u8], slot: &SlotClass<'_>) -> String {
        seal(dek, b"hunter2", &slot.associated_data().unwrap()).unwrap()
    }

    fn opens(dek: &[u8], ciphertext: &str, slot: &SlotClass<'_>) -> bool {
        open(dek, ciphertext, &slot.associated_data().unwrap()).is_ok()
    }

    #[test]
    fn a_named_value_opens_only_under_the_ad_it_was_sealed_with() {
        let dek = random_bytes(64);
        let slot = SlotClass::NamedValue(named("row-1", "sec-1", "prod"));
        let ciphertext = sealed_under(&dek, &slot);
        assert!(ciphertext.starts_with(AD_PREFIX));
        assert!(!ciphertext.contains("hunter2"));
        assert_eq!(
            open(&dek, &ciphertext, &slot.associated_data().unwrap())
                .unwrap()
                .as_slice(),
            b"hunter2"
        );

        let moved = [
            named("row-2", "sec-1", "prod"),
            named("row-1", "sec-2", "prod"),
            named("row-1", "sec-1", "staging"),
            NamedValueAd {
                env_incarnation: "inc-2",
                ..named("row-1", "sec-1", "prod")
            },
            NamedValueAd {
                kind: SecretKind::Variable,
                ..named("row-1", "sec-1", "prod")
            },
            NamedValueAd {
                secret_ref: "ref-2",
                ..named("row-1", "sec-1", "prod")
            },
            NamedValueAd {
                org_id: "zeta",
                ..named("row-1", "sec-1", "prod")
            },
            NamedValueAd {
                value_rev: "rev-2",
                ..named("row-1", "sec-1", "prod")
            },
        ];
        for ad in moved {
            assert!(!opens(&dek, &ciphertext, &SlotClass::NamedValue(ad)));
        }
        let pointer = SlotClass::NamedValue(NamedValueAd {
            class: NamedValueClass::OrgSecretPointer,
            ..named("row-1", "sec-1", "prod")
        });
        assert!(!opens(&dek, &ciphertext, &pointer));
        assert!(!opens(&dek, &sealed_under(&dek, &pointer), &slot));
        let token = SlotClass::ProbeToken(ProbeTokenAd {
            org_id: "acme",
            token_id: "row-1",
            secret_ref: "ref-1",
            token_sha256: "h",
        });
        assert!(!opens(&dek, &ciphertext, &token));
    }

    #[test]
    fn secret_backend_ad_binds_each_component_in_order() {
        let dek = random_bytes(64);
        let ad = SecretBackendAd {
            org_id: "acme",
            backend_id: "backend-1",
            secret_ref: "ref-1",
            origin: "https://example.com:443",
            credential_rev: "rev-1",
        };
        let changed = [
            SecretBackendAd {
                org_id: "zeta",
                ..ad
            },
            SecretBackendAd {
                backend_id: "backend-2",
                ..ad
            },
            SecretBackendAd {
                secret_ref: "ref-2",
                ..ad
            },
            SecretBackendAd {
                origin: "https://example.com:8443",
                ..ad
            },
            SecretBackendAd {
                credential_rev: "rev-2",
                ..ad
            },
        ];
        let slot = SlotClass::SecretBackend(ad);
        let ciphertext = sealed_under(&dek, &slot);
        let expected_ad: &[&[u8]] = &[
            b"acme",
            b"SecretBackend",
            b"backend-1",
            b"ref-1",
            b"https://example.com:443",
            b"rev-1",
        ];
        assert!(ciphertext.starts_with(AD_PREFIX));
        assert!(
            decrypt_with_ad(&dek, &ciphertext, expected_ad)
                .unwrap()
                .as_slice()
                == b"hunter2"
        );
        for ad in changed {
            assert!(!opens(&dek, &ciphertext, &SlotClass::SecretBackend(ad)));
        }
    }

    #[tokio::test]
    async fn secret_backend_rows_require_their_bound_owner() {
        if !crate::secrets::sealed_value_test_store().await {
            return;
        }
        let secret = SecretRecord {
            org_id: crate::table::testing::unique("ad_backend"),
            owner_kind: OWNER_KIND_SECRET_BACKEND.to_string(),
            owner_id: "backend-1".to_string(),
            ..record()
        };
        let slot = SlotClass::SecretBackend(SecretBackendAd {
            org_id: &secret.org_id,
            backend_id: &secret.owner_id,
            secret_ref: &secret.secret_ref,
            origin: "https://example.com:443",
            credential_rev: "rev-1",
        });
        assert!(
            encrypted_active_model(&secret, &SlotClass::Legacy)
                .await
                .is_err()
        );
        let mut model = encrypted_active_model(&secret, &slot)
            .await
            .unwrap()
            .try_into_model()
            .unwrap();
        let opened = decrypt_model(model.clone(), &slot).await.unwrap();
        assert!(opened.value == secret.value);
        for kind in [OWNER_KIND_ORG_SECRET, OWNER_KIND_ORG_SECRET_POINTER] {
            model.owner_kind = kind.to_string();
            assert!(decrypt_model(model.clone(), &slot).await.is_err());
        }
        cipher::delete_by_org(&secret.org_id).await.unwrap();
    }

    #[test]
    fn a_bound_slot_refuses_any_ciphertext_without_the_ad_prefix() {
        let dek = random_bytes(64);
        let legacy = encrypt_data(&dek, "hunter2").unwrap();
        let slot = SlotClass::NamedValue(named("row-1", "sec-1", "prod"));
        assert!(!opens(&dek, &legacy, &slot));
        let sealed = sealed_under(&dek, &slot);
        assert!(!opens(&dek, sealed.trim_start_matches(AD_PREFIX), &slot));
        assert!(
            decrypt_data(&dek, &sealed).is_err(),
            "no legacy read of a sealed row"
        );
    }

    #[test]
    fn ad_components_are_length_prefixed_so_boundaries_cannot_shift() {
        assert_ne!(encode_ad(&[b"ab", b"c"]), encode_ad(&[b"a", b"bc"]));
        assert_eq!(encode_ad(&[b"ab"]), vec![0, 0, 0, 2, b'a', b'b']);
        let dek = random_bytes(64);
        let ciphertext = encrypt_with_ad(&dek, b"v", &[b"x", b"y"]).unwrap();
        assert_eq!(
            decrypt_with_ad(&dek, &ciphertext, &[b"x", b"y"])
                .unwrap()
                .as_slice(),
            b"v"
        );
        assert!(decrypt_with_ad(&dek, &ciphertext, &[b"xy"]).is_err());
    }

    #[test]
    fn the_slot_not_the_row_decides_the_path() {
        for kind in [
            OWNER_KIND_ORG_SECRET,
            OWNER_KIND_ORG_SECRET_POINTER,
            OWNER_KIND_PROBE_TOKEN,
            "secret_backend",
        ] {
            assert!(refuse_bound_kind(kind).is_err(), "{kind}");
        }
        for kind in ["task", "scorer", "prompt_webhook", "workflow_trigger"] {
            assert!(refuse_bound_kind(kind).is_ok(), "{kind}");
        }
        let slot = SlotClass::NamedValue(named("row-1", "sec-1", "prod"));
        assert!(check_bound_owner(&slot, "acme", OWNER_KIND_ORG_SECRET, "row-1", "ref-1").is_ok());
        assert!(check_bound_owner(&slot, "acme", "task", "row-1", "ref-1").is_err());
        assert!(check_bound_owner(&slot, "acme", OWNER_KIND_ORG_SECRET, "row-2", "ref-1").is_err());
        assert!(check_bound_owner(&slot, "zeta", OWNER_KIND_ORG_SECRET, "row-1", "ref-1").is_err());
        assert!(check_bound_owner(&SlotClass::Legacy, "acme", "task", "row-1", "ref-1").is_err());
    }

    #[tokio::test]
    async fn named_value_transaction_uses_existing_deks_on_a_cold_cache() {
        if !crate::secrets::sealed_value_test_store().await {
            return;
        }
        let secret = SecretRecord {
            id: config::ider::ksuid(),
            org_id: crate::table::testing::unique("ad_txn"),
            owner_kind: OWNER_KIND_ORG_SECRET.to_string(),
            owner_id: "row-1".to_string(),
            secret_ref: config::ider::ksuid(),
            ..record()
        };
        let slot = SlotClass::NamedValue(NamedValueAd {
            org_id: &secret.org_id,
            secret_ref: &secret.secret_ref,
            ..named(&secret.owner_id, "sec-1", "prod")
        });
        drop(Zeroizing::new(
            cipher::get_dek(&secret.org_id).await.unwrap(),
        ));
        let conn = client().await;
        let txn = conn.begin().await.unwrap();
        let deadline = Duration::from_secs(10);
        cipher::forget_cached_dek(&secret.org_id);
        let active = timeout(deadline, encrypted_active_model_in(&txn, &secret, &slot))
            .await
            .expect("named value sealing timed out")
            .unwrap();
        insert(&txn, active).await.unwrap();
        let mut model = find_state(&txn, &secret.org_id, &secret.secret_ref, &secret.state)
            .await
            .unwrap()
            .unwrap();
        cipher::forget_cached_dek(&secret.org_id);
        let opened = timeout(deadline, decrypt_model_in(&txn, model.clone(), &slot))
            .await
            .expect("named value open timed out")
            .unwrap();
        assert_eq!(opened, secret);
        let moved = SlotClass::NamedValue(NamedValueAd {
            value_rev: "rev-2",
            org_id: &secret.org_id,
            secret_ref: &secret.secret_ref,
            ..named(&secret.owner_id, "sec-1", "prod")
        });
        let foreign = SlotClass::NamedValue(NamedValueAd {
            org_id: &secret.org_id,
            secret_ref: &secret.secret_ref,
            ..named("row-2", "sec-1", "prod")
        });
        let mut not_utf8 = model.clone();
        let dek = cipher::get_existing_dek_in(&txn, &secret.org_id)
            .await
            .unwrap()
            .unwrap();
        not_utf8.ciphertext = seal(&dek, &[0xff, 0xfe], &slot.associated_data().unwrap()).unwrap();
        for (stored, slot, expected) in [
            (model.clone(), &moved, "sealed value refused"),
            (
                model.clone(),
                &foreign,
                "the row does not belong to the caller's slot",
            ),
            (not_utf8, &slot, "sealed value is not UTF-8"),
        ] {
            let error = decrypt_model_in(&txn, stored, slot).await.unwrap_err();
            assert!(error.is_authentication_failure(), "{error}");
            assert_eq!(error.to_string(), expected);
        }

        let missing = SecretRecord {
            org_id: crate::table::testing::unique("ad_no_dek"),
            ..secret.clone()
        };
        let missing_slot = SlotClass::NamedValue(NamedValueAd {
            org_id: &missing.org_id,
            secret_ref: &missing.secret_ref,
            ..named(&missing.owner_id, "sec-1", "prod")
        });
        model.org_id.clone_from(&missing.org_id);
        for result in [
            encrypted_active_model_in(&txn, &missing, &missing_slot)
                .await
                .map(|_| ()),
            decrypt_model_in(&txn, model, &missing_slot)
                .await
                .map(|_| ())
                .map_err(errors::Error::from),
        ] {
            assert!(
                matches!(result, Err(errors::Error::Message(message)) if message == "the org has no encryption key")
            );
        }
        assert!(
            cipher::get_existing_dek_in(&txn, &missing.org_id)
                .await
                .unwrap()
                .is_none()
        );
        txn.rollback().await.unwrap();
        cipher::delete_by_org(&secret.org_id).await.unwrap();
    }
}
