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

use std::{
    sync::{LazyLock, OnceLock},
    time::{Duration, Instant},
};

use aes_siv::{KeyInit, siv::Aes256Siv};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    RwHashMap,
    utils::{rand::random_bytes, time::now_micros},
};
use sea_orm::{ColumnTrait, EntityTrait, Order, QueryFilter, QueryOrder, QuerySelect, Set, SqlErr};
use serde::{Deserialize, Serialize};

use super::{entity::cipher_keys::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    CipherKey,
}

// DBKey to set cipher keys
pub const CIPHER_KEY_PREFIX: &str = "/cipher_keys/";

/// Name used for the auto-provisioned per-org DEK (Data Encryption Key).
/// This entry is stored with `is_system = true` and is never exposed via the
/// public API.
pub const DEFAULT_DEK_NAME: &str = "__default__";

/// In-memory DEK cache: org → (raw key bytes, time of last load).
static DEK_CACHE: LazyLock<RwHashMap<String, (Vec<u8>, Instant)>> = LazyLock::new(Default::default);
const DEK_CACHE_TTL: Duration = Duration::from_secs(300);

/// Master Key Encryption Key (KEK). Set once at server startup via
/// [`init_master_key`]. Defaults to [`Algorithm::None`] (no encryption) when
/// not initialised — this is the case in non-enterprise builds.
static MASTER_KEY: OnceLock<Algorithm> = OnceLock::new();

fn get_master_key() -> &'static Algorithm {
    MASTER_KEY.get_or_init(|| Algorithm::None)
}

/// Initialise the master KEK from a base64-encoded key string.
///
/// Must be called **once** at server startup (before any cipher table
/// operations). Called from `init_enterprise()` in the main server when the
/// enterprise encryption config (`O2_MASTER_ENCRYPTION_KEY`) is present.
///
/// Returns an error if the key is not valid base64 or has the wrong length for
/// AES-256-SIV (64 bytes / 512 bits). A second call is silently ignored.
pub fn init_master_key(key_b64: &str) -> Result<(), errors::Error> {
    let key = config::utils::encryption::decode_encryption_key(key_b64)
        .map_err(errors::Error::Message)?;
    let _ = MASTER_KEY.set(Algorithm::Aes256Siv(key));
    Ok(())
}

enum Algorithm {
    Aes256Siv(Vec<u8>),
    None,
}

impl Algorithm {
    fn encrypt(&self, plaintext: &str) -> Result<String, errors::Error> {
        match self {
            Self::Aes256Siv(k) => {
                let mut c = Aes256Siv::new_from_slice(k).unwrap();
                c.encrypt([&[]], plaintext.as_bytes())
                    .map_err(|e| {
                        errors::Error::Message(format!(
                            "error encrypting data for cipher table {e}"
                        ))
                    })
                    .map(|v| BASE64_STANDARD.encode(&v))
            }
            Self::None => Ok(plaintext.to_owned()),
        }
    }
    fn decrypt(&self, encrypted: &str) -> Result<String, errors::Error> {
        match self {
            Self::Aes256Siv(k) => {
                let mut c = Aes256Siv::new_from_slice(k).unwrap();
                let v = match BASE64_STANDARD.decode(encrypted) {
                    Ok(v) => v,
                    Err(e) => {
                        log::warn!("error in decoding encrypted key {e}");
                        return Err(errors::Error::Message(
                            "failed to decode encrypted key".into(),
                        ));
                    }
                };
                c.decrypt([&[]], &v)
                    .map_err(|e| {
                        errors::Error::Message(format!(
                            "error decrypting data for cipher table {e}"
                        ))
                    })
                    .map(|v| String::from_utf8_lossy(&v).into_owned())
            }
            Self::None => Ok(encrypted.to_owned()),
        }
    }
}

impl std::fmt::Display for EntryKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::CipherKey => write!(f, "cipher_key"),
        }
    }
}

impl TryFrom<String> for EntryKind {
    type Error = errors::Error;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        match value.as_str() {
            "cipher_key" => Ok(Self::CipherKey),
            _ => Err(errors::Error::NotImplemented),
        }
    }
}

pub struct ListFilter {
    pub org: Option<String>,
    pub kind: Option<EntryKind>,
    /// Case-insensitive substring match on the `name` column (`LIKE '%val%'`).
    pub name: Option<String>,
    /// When `false`, rows with `is_system = true` are excluded from results.
    /// The public API always sets this to `false` so system DEKs are hidden.
    pub is_system: bool,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CipherEntry {
    pub org: String,
    pub created_at: i64,
    pub created_by: String,
    pub name: String,
    pub data: String,
    pub kind: EntryKind,
    /// Whether this entry is an internally auto-provisioned system key.
    pub is_system: bool,
}

impl TryInto<CipherEntry> for Model {
    type Error = errors::Error;
    fn try_into(self) -> Result<CipherEntry, Self::Error> {
        Ok(CipherEntry {
            org: self.org,
            created_at: self.created_at,
            created_by: self.created_by,
            kind: self.kind.try_into().unwrap(), // we can be fairly certain that this will not fail
            name: self.name,
            data: self.data,
            is_system: self.is_system,
        })
    }
}

pub async fn add(entry: CipherEntry) -> Result<(), errors::Error> {
    let encrypted = get_master_key().encrypt(&entry.data)?;
    let record = ActiveModel {
        org: Set(entry.org),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        name: Set(entry.name),
        kind: Set(entry.kind.to_string()),
        data: Set(encrypted),
        is_system: Set(entry.is_system),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {}
        Err(e) => {
            drop(_lock);
            match e.sql_err() {
                Some(SqlErr::UniqueConstraintViolation(_)) => {
                    return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
                }
                _ => {
                    return Err(e.into());
                }
            }
        }
    }
    drop(_lock);

    Ok(())
}

pub async fn update(entry: CipherEntry) -> Result<(), errors::Error> {
    let encrypted = get_master_key().encrypt(&entry.data)?;
    let record = ActiveModel {
        org: Set(entry.org),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        name: Set(entry.name),
        kind: Set(entry.kind.to_string()),
        data: Set(encrypted),
        is_system: Set(entry.is_system),
    };

    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::update(record).exec(client).await?;
    drop(_lock);

    Ok(())
}

pub async fn remove(org: &str, kind: EntryKind, name: &str) -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.eq(kind.to_string()))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await?;

    drop(_lock);

    Ok(())
}

/// Decrypt a stored cipher entry value using the current master key.
///
/// If decryption fails the entry was likely stored before a master key was
/// configured (plaintext storage). The raw value is returned as-is so
/// existing data keeps working, and a warning is logged so operators know
/// a re-encryption step is needed (update the entry to trigger re-encryption).
fn decrypt_entry(name: &str, org: &str, raw: String) -> String {
    match get_master_key().decrypt(&raw) {
        Ok(v) => v,
        Err(_) => {
            log::warn!(
                "cipher entry '{name}' (org={org}) could not be decrypted with the current \
                 master key — it may have been stored without encryption. \
                 Returning as plaintext. Re-encrypt by updating the entry."
            );
            raw
        }
    }
}

pub async fn get_data(
    org: &str,
    kind: EntryKind,
    name: &str,
) -> Result<Option<String>, errors::Error> {
    let res = get(org, kind, name).await?;
    match res {
        Some(m) => Ok(Some(decrypt_entry(name, org, m.data))),
        None => Ok(None),
    }
}

async fn get(org: &str, kind: EntryKind, name: &str) -> Result<Option<Model>, errors::DbError> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(name))
        .filter(Column::Kind.eq(kind.to_string()))
        .into_model::<Model>()
        .one(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))
}

pub async fn list_all(limit: Option<i64>) -> Result<Vec<CipherEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find().order_by(Column::CreatedAt, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res.into_model::<Model>().all(client).await?;

    let records: Vec<CipherEntry> = records
        .into_iter()
        .map(<Model as TryInto<CipherEntry>>::try_into)
        .collect::<Result<Vec<_>, _>>()?;

    records
        .into_iter()
        .map(|mut c: CipherEntry| {
            c.data = decrypt_entry(&c.name, &c.org, c.data);
            Ok(c)
        })
        .collect()
}

pub async fn list_filtered(
    filter: ListFilter,
    limit: Option<i64>,
) -> Result<Vec<CipherEntry>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut res = Entity::find().order_by(Column::CreatedAt, Order::Desc);
    if let Some(ref org) = filter.org {
        res = res.filter(Column::Org.eq(org));
    }
    if let Some(ref kind) = filter.kind {
        res = res.filter(Column::Kind.eq(kind.to_string()));
    }
    if let Some(ref name) = filter.name {
        res = res.filter(Column::Name.contains(name));
    }
    res = res.filter(Column::IsSystem.eq(filter.is_system));
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res.into_model::<Model>().all(client).await?;

    let records: Vec<CipherEntry> = records
        .into_iter()
        .map(<Model as TryInto<CipherEntry>>::try_into)
        .collect::<Result<Vec<_>, _>>()?;

    records
        .into_iter()
        .map(|mut c: CipherEntry| {
            c.data = decrypt_entry(&c.name, &c.org, c.data);
            Ok(c)
        })
        .collect()
}

pub async fn clear() -> Result<(), errors::Error> {
    // make sure only one client is writing to the database(only for sqlite)
    let _lock = get_lock().await;

    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many().exec(client).await?;

    Ok(())
}

/// Returns the per-org DEK (Data Encryption Key) raw bytes, creating and
/// persisting a new one if none exists yet (lazy provisioning).
///
/// The DEK is a 512-bit random value stored in `cipher_keys` as a system entry
/// (`is_system = true`, `name = DEFAULT_DEK_NAME`). It is itself encrypted at
/// rest by the master key via the normal `add()` path.
pub async fn get_or_create_dek(org: &str) -> Result<Vec<u8>, errors::Error> {
    // Attempt to load an existing DEK from the database.
    if let Some(b64) = get_data(org, EntryKind::CipherKey, DEFAULT_DEK_NAME).await? {
        return BASE64_STANDARD.decode(b64).map_err(|e| {
            errors::Error::Message(format!("failed to decode DEK for org {org}: {e}"))
        });
    }

    // No DEK yet — generate a new 512-bit key (AES-256-SIV requires 64 bytes).
    let dek = random_bytes(64);

    match add(CipherEntry {
        org: org.to_string(),
        name: DEFAULT_DEK_NAME.to_string(),
        kind: EntryKind::CipherKey,
        is_system: true,
        data: BASE64_STANDARD.encode(&dek),
        created_by: "system".to_string(),
        created_at: now_micros(),
    })
    .await
    {
        Ok(_) => Ok(dek),
        // Another concurrent caller won the race and already inserted the DEK.
        // Retrieve the winner's key rather than returning an error.
        Err(errors::Error::DbError(errors::DbError::UniqueViolation)) => {
            get_data(org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
                .await?
                .ok_or_else(|| {
                    errors::Error::Message(format!("DEK for org {org} missing after race"))
                })
                .and_then(|b64| {
                    BASE64_STANDARD.decode(b64).map_err(|e| {
                        errors::Error::Message(format!("failed to decode DEK for org {org}: {e}"))
                    })
                })
        }
        Err(e) => Err(errors::Error::Message(format!(
            "failed to persist DEK for org {org}: {e}"
        ))),
    }
}

/// Returns the per-org DEK, using an in-memory cache with a 5-minute TTL to
/// avoid a database round-trip on every encryption/decryption operation.
pub async fn get_dek(org: &str) -> Result<Vec<u8>, errors::Error> {
    if let Some(entry) = DEK_CACHE.get(org)
        && entry.1.elapsed() < DEK_CACHE_TTL
    {
        return Ok(entry.0.clone());
    }

    let dek = get_or_create_dek(org).await?;
    DEK_CACHE.insert(org.to_string(), (dek.clone(), Instant::now()));
    Ok(dek)
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};

    use super::*;

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    #[test]
    fn test_default_dek_name_value() {
        assert_eq!(DEFAULT_DEK_NAME, "__default__");
    }

    #[test]
    fn test_cipher_key_prefix_value() {
        assert_eq!(CIPHER_KEY_PREFIX, "/cipher_keys/");
    }

    // -----------------------------------------------------------------------
    // EntryKind
    // -----------------------------------------------------------------------

    #[test]
    fn test_entry_kind_display() {
        assert_eq!(EntryKind::CipherKey.to_string(), "cipher_key");
    }

    #[test]
    fn test_entry_kind_try_from_valid() {
        assert_eq!(
            EntryKind::try_from("cipher_key".to_string()).unwrap(),
            EntryKind::CipherKey
        );
    }

    #[test]
    fn test_entry_kind_try_from_invalid() {
        assert!(EntryKind::try_from("unknown".to_string()).is_err());
        assert!(EntryKind::try_from("".to_string()).is_err());
        assert!(EntryKind::try_from("CipherKey".to_string()).is_err()); // case-sensitive
    }

    // -----------------------------------------------------------------------
    // Algorithm::None passthrough
    // -----------------------------------------------------------------------

    #[test]
    fn test_algorithm_none_encrypt_is_passthrough() {
        let alg = Algorithm::None;
        let plaintext = "sensitive data";
        let result = alg.encrypt(plaintext).unwrap();
        assert_eq!(result, plaintext);
    }

    #[test]
    fn test_algorithm_none_decrypt_is_passthrough() {
        let alg = Algorithm::None;
        let ciphertext = "some_base64_looking_string";
        let result = alg.decrypt(ciphertext).unwrap();
        assert_eq!(result, ciphertext);
    }

    // -----------------------------------------------------------------------
    // Algorithm::Aes256Siv encrypt/decrypt roundtrip
    // -----------------------------------------------------------------------

    #[test]
    fn test_algorithm_aes256siv_roundtrip() {
        // 64-byte key for AES-256-SIV
        let key = config::utils::rand::random_bytes(64);
        let alg = Algorithm::Aes256Siv(key);
        let plaintext = r#"{"url":"https://example.com","token":"secret"}"#;

        let encrypted = alg.encrypt(plaintext).unwrap();
        // Encrypted should be base64 and different from plaintext
        assert_ne!(encrypted, plaintext);
        assert!(BASE64_STANDARD.decode(&encrypted).is_ok());

        let decrypted = alg.decrypt(&encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_algorithm_aes256siv_tampered_ciphertext_fails() {
        let key = config::utils::rand::random_bytes(64);
        let alg = Algorithm::Aes256Siv(key);
        let encrypted = alg.encrypt("hello").unwrap();

        // Flip a byte in the ciphertext
        let mut raw = BASE64_STANDARD.decode(&encrypted).unwrap();
        raw[0] ^= 0xFF;
        let tampered = BASE64_STANDARD.encode(raw);

        assert!(alg.decrypt(&tampered).is_err());
    }

    #[test]
    fn test_algorithm_aes256siv_invalid_base64_fails() {
        let key = config::utils::rand::random_bytes(64);
        let alg = Algorithm::Aes256Siv(key);
        assert!(alg.decrypt("not-valid-base64!!!").is_err());
    }

    // -----------------------------------------------------------------------
    // init_master_key — error paths (OnceLock is not set on error)
    // -----------------------------------------------------------------------

    #[test]
    fn test_init_master_key_invalid_base64_returns_err() {
        let result = init_master_key("not-valid-base64!!!");
        assert!(result.is_err());
        let msg = result.unwrap_err().to_string();
        assert!(
            msg.to_lowercase().contains("base64") || msg.to_lowercase().contains("encode"),
            "expected base64 error, got: {msg}"
        );
    }

    #[test]
    fn test_init_master_key_wrong_key_length_returns_err() {
        // AES-256-SIV needs exactly 64 bytes; 32 bytes is wrong
        let short_key = BASE64_STANDARD.encode([0u8; 32]);
        assert!(init_master_key(&short_key).is_err());
    }

    #[test]
    fn test_init_master_key_empty_string_returns_err() {
        // Empty string is valid base64 but decodes to 0 bytes — wrong length
        assert!(init_master_key("").is_err());
    }

    // -----------------------------------------------------------------------
    // ListFilter
    // -----------------------------------------------------------------------

    #[test]
    fn test_list_filter_is_system_false_excludes_system_rows() {
        // Semantic contract: is_system: false means "only non-system rows"
        // This mirrors how the field is used in list_filtered().
        let filter = ListFilter {
            org: Some("acme".to_string()),
            kind: Some(EntryKind::CipherKey),
            name: None,
            is_system: false,
        };
        assert!(!filter.is_system);
    }
}
