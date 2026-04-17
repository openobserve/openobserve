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

//! Service layer for the `org_ai_toolsets` table.
//!
//! All functions operate with **plaintext** `data` at the service boundary.
//! Encryption (write) and decryption (read) are handled transparently using the
//! org's per-org DEK via [`cipher::get_dek`].

use sea_orm::{
    ActiveModelTrait, ColumnTrait, EntityTrait, Order, QueryFilter, QueryOrder, QuerySelect, Set,
    SqlErr,
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::{entity::org_ai_toolsets::*, get_lock};
use crate::{
    db::{ORM_CLIENT, connect_to_orm},
    errors,
    table::cipher,
};

/// Filter options for [`list`].
#[derive(Debug, Default)]
pub struct ListFilter {
    /// Case-insensitive substring match on the `name` column (`LIKE '%val%'`).
    pub name: Option<String>,
    /// Exact match on the `kind` column (e.g. `"mcp"`, `"cli"`, `"skill"`).
    pub kind: Option<String>,
}

/// Application-level view of an AI toolset record.
/// The `data` field always holds **plaintext** JSON (or `None`) at this layer.
#[derive(Debug, Clone)]
pub struct OrgToolset {
    /// 27-character KSUID primary key.
    pub id: String,
    pub org: String,
    pub name: String,
    /// One of: `mcp`, `cli`, `skill`, `generic`.
    pub kind: String,
    pub description: Option<String>,
    /// Kind-specific plaintext JSON payload. `None` when no config is needed.
    pub data: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

// ---------------------------------------------------------------------------
// Encryption helpers (AES-256-SIV with the org DEK)
// ---------------------------------------------------------------------------

fn encrypt_data(dek: &[u8], plaintext: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .encrypt(dek, plaintext)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

fn decrypt_data(dek: &[u8], ciphertext_b64: &str) -> Result<String, errors::Error> {
    config::utils::encryption::Algorithm::Aes256Siv
        .decrypt(dek, ciphertext_b64)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

// ---------------------------------------------------------------------------
// Model conversion
// ---------------------------------------------------------------------------

fn model_to_toolset(model: Model, dek: &[u8]) -> Result<OrgToolset, errors::Error> {
    let data = model
        .data
        .as_deref()
        .map(|d| decrypt_data(dek, d))
        .transpose()?;
    Ok(OrgToolset {
        id: model.id,
        org: model.org,
        name: model.name,
        kind: model.kind,
        description: model.description,
        data,
        created_by: model.created_by,
        created_at: model.created_at,
        updated_at: model.updated_at,
    })
}

// ---------------------------------------------------------------------------
// Public CRUD API
// ---------------------------------------------------------------------------

/// Insert a new toolset. The caller supplies plaintext `data`; this function
/// encrypts it with the org's DEK before persisting.
///
/// A new KSUID is generated for `entry.id` when it is empty.
pub async fn add(mut entry: OrgToolset) -> Result<(), errors::Error> {
    if entry.id.is_empty() {
        entry.id = Ksuid::new(None, None).to_string();
    }

    let encrypted_data = if let Some(ref plaintext) = entry.data {
        let dek = cipher::get_dek(&entry.org).await?;
        Some(encrypt_data(&dek, plaintext)?)
    } else {
        None
    };

    let record = ActiveModel {
        id: Set(entry.id),
        org: Set(entry.org),
        name: Set(entry.name),
        kind: Set(entry.kind),
        description: Set(entry.description),
        data: Set(encrypted_data),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        updated_at: Set(entry.updated_at),
    };

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
                _ => return Err(e.into()),
            }
        }
    }
    drop(_lock);
    Ok(())
}

/// Fetch a toolset by its KSUID `id`. Returns the record with plaintext `data`.
pub async fn get(org: &str, id: &str) -> Result<Option<OrgToolset>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .one(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;

    match row {
        Some(m) => {
            let dek = cipher::get_dek(org).await?;
            model_to_toolset(m, &dek).map(Some)
        }
        None => Ok(None),
    }
}

/// Fetch a toolset by its unique `(org, name)` pair. Returns the record with
/// plaintext `data`.
pub async fn get_by_name(org: &str, name: &str) -> Result<Option<OrgToolset>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let row = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(name))
        .one(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))?;

    match row {
        Some(m) => {
            let dek = cipher::get_dek(org).await?;
            model_to_toolset(m, &dek).map(Some)
        }
        None => Ok(None),
    }
}

/// List toolsets for an org with optional filtering and limit.
///
/// Results are ordered by `created_at` descending.
/// All records are returned with plaintext `data`.
///
/// - `filter.name` — case-insensitive substring match (`LIKE '%val%'`)
/// - `filter.kind` — exact match on the `kind` column
/// - `limit`       — maximum number of rows to return
pub async fn list(
    org: &str,
    filter: ListFilter,
    limit: Option<i64>,
) -> Result<Vec<OrgToolset>, errors::Error> {
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    let mut query = Entity::find()
        .filter(Column::Org.eq(org))
        .order_by(Column::CreatedAt, Order::Desc);

    if let Some(ref name) = filter.name {
        query = query.filter(Column::Name.contains(name));
    }
    if let Some(ref kind) = filter.kind {
        query = query.filter(Column::Kind.eq(kind));
    }
    if let Some(n) = limit {
        query = query.limit(n as u64);
    }

    let rows = query.all(client).await?;

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let dek = cipher::get_dek(org).await?;
    rows.into_iter()
        .map(|m| model_to_toolset(m, &dek))
        .collect()
}

/// Update an existing toolset. The caller supplies plaintext `data`; this
/// function re-encrypts it with the org's DEK before persisting.
pub async fn update(entry: OrgToolset) -> Result<(), errors::Error> {
    let encrypted_data = if let Some(ref plaintext) = entry.data {
        let dek = cipher::get_dek(&entry.org).await?;
        Some(encrypt_data(&dek, plaintext)?)
    } else {
        None
    };

    let record = ActiveModel {
        id: Set(entry.id),
        org: Set(entry.org),
        name: Set(entry.name),
        kind: Set(entry.kind),
        description: Set(entry.description),
        data: Set(encrypted_data),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        updated_at: Set(entry.updated_at),
    };

    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    record.update(client).await?;
    drop(_lock);
    Ok(())
}

/// Delete a toolset by its KSUID `id`.
pub async fn remove(org: &str, id: &str) -> Result<(), errors::Error> {
    let _lock = get_lock().await;
    let client = ORM_CLIENT.get_or_init(connect_to_orm).await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;
    drop(_lock);
    Ok(())
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::utils::rand::random_bytes;

    use super::*;

    // -----------------------------------------------------------------------
    // ListFilter
    // -----------------------------------------------------------------------

    #[test]
    fn test_list_filter_default() {
        let f = ListFilter::default();
        assert!(f.name.is_none());
        assert!(f.kind.is_none());
    }

    // -----------------------------------------------------------------------
    // encrypt_data / decrypt_data roundtrip
    // -----------------------------------------------------------------------

    #[test]
    fn test_encrypt_decrypt_roundtrip() {
        let dek = random_bytes(64);
        let plaintext =
            r#"{"url":"https://api.example.com/mcp/","headers":{"Authorization":"Bearer tok"}}"#;

        let encrypted = encrypt_data(&dek, plaintext).unwrap();
        // Encrypted value must differ from plaintext
        assert_ne!(encrypted, plaintext);
        // Must be valid base64
        assert!(BASE64_STANDARD.decode(&encrypted).is_ok());

        let decrypted = decrypt_data(&dek, &encrypted).unwrap();
        assert_eq!(decrypted, plaintext);
    }

    #[test]
    fn test_encrypt_decrypt_different_plaintexts() {
        let dek = random_bytes(64);
        let a = encrypt_data(&dek, "plaintext-a").unwrap();
        let b = encrypt_data(&dek, "plaintext-b").unwrap();
        // Different inputs must produce different ciphertexts
        assert_ne!(a, b);
    }

    #[test]
    fn test_decrypt_with_wrong_dek_fails() {
        let dek1 = random_bytes(64);
        let dek2 = random_bytes(64);
        let encrypted = encrypt_data(&dek1, "secret data").unwrap();
        // Decrypting with a different key must fail (AES-SIV authentication)
        assert!(decrypt_data(&dek2, &encrypted).is_err());
    }

    #[test]
    fn test_encrypt_with_invalid_dek_size_fails() {
        let bad_dek = vec![0u8; 16]; // too short for AES-256-SIV
        assert!(encrypt_data(&bad_dek, "test").is_err());
    }

    #[test]
    fn test_decrypt_invalid_base64_fails() {
        let dek = random_bytes(64);
        assert!(decrypt_data(&dek, "not-valid-base64!!!").is_err());
    }

    #[test]
    fn test_decrypt_tampered_ciphertext_fails() {
        let dek = random_bytes(64);
        let encrypted = encrypt_data(&dek, "original").unwrap();
        let mut raw = BASE64_STANDARD.decode(&encrypted).unwrap();
        raw[0] ^= 0xFF; // flip a bit
        let tampered = BASE64_STANDARD.encode(raw);
        assert!(decrypt_data(&dek, &tampered).is_err());
    }

    #[test]
    fn test_encrypt_empty_string() {
        let dek = random_bytes(64);
        let encrypted = encrypt_data(&dek, "").unwrap();
        let decrypted = decrypt_data(&dek, &encrypted).unwrap();
        assert_eq!(decrypted, "");
    }
}
