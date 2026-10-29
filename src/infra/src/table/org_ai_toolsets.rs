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
    ActiveModelTrait, ColumnTrait, Condition, ConnectionTrait, EntityTrait, Order, QueryFilter,
    QueryOrder, QuerySelect, Set, SqlErr, sea_query::Expr,
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::entity::org_ai_toolsets::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
    table::cipher,
};

pub const STATE_OK: &str = "ok";
pub const STATE_FAILING: &str = "failing";

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
    /// A disabled toolset is never pushed to the assistant.
    pub enabled: bool,
    /// `ok` | `failing`; `None` until the toolset was used or tested.
    pub status_state: Option<String>,
    pub status_since: Option<i64>,
    /// A fixed server sentence, never upstream text.
    pub last_error: Option<String>,
    pub last_used_at: Option<i64>,
}

/// One use or test of a toolset, as [`record_health`] stores it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HealthOutcome<'a> {
    Ok,
    Failing(&'a str),
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
        enabled: model.enabled,
        status_state: model.status_state,
        status_since: model.status_since,
        last_error: model.last_error,
        last_used_at: model.last_used_at,
    })
}

/// The columns a config save writes, keyed by id.
fn config_columns(entry: OrgToolset, encrypted_data: Option<String>) -> ActiveModel {
    ActiveModel {
        id: Set(entry.id),
        org: Set(entry.org),
        name: Set(entry.name),
        kind: Set(entry.kind),
        description: Set(entry.description),
        data: Set(encrypted_data),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        updated_at: Set(entry.updated_at),
        // Left unset so a stale save never undoes `set_enabled` or `record_health`.
        ..Default::default()
    }
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
        enabled: Set(entry.enabled),
        status_state: Set(None),
        status_since: Set(None),
        last_error: Set(None),
        last_used_at: Set(None),
    };

    let client = get_orm_client_rw().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {}
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
            }
            _ => return Err(e.into()),
        },
    }
    Ok(())
}

/// Fetch a toolset by its KSUID `id`. Returns the record with plaintext `data`.
pub async fn get(org: &str, id: &str) -> Result<Option<OrgToolset>, errors::Error> {
    let client = get_orm_client_ro().await;
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
    let client = get_orm_client_ro().await;
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
    let client = get_orm_client_ro().await;
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

/// `(id, name, enabled)` of every toolset of `org`, newest first; `data` is never decrypted.
pub async fn list_names(org: &str) -> Result<Vec<(String, String, bool)>, errors::Error> {
    list_names_with(get_orm_client_ro().await, org).await
}

pub async fn list_names_with<C: ConnectionTrait>(
    client: &C,
    org: &str,
) -> Result<Vec<(String, String, bool)>, errors::Error> {
    let names = Entity::find()
        .select_only()
        .column(Column::Id)
        .column(Column::Name)
        .column(Column::Enabled)
        .filter(Column::Org.eq(org))
        .order_by(Column::CreatedAt, Order::Desc)
        .into_tuple::<(String, String, bool)>()
        .all(client)
        .await?;
    Ok(names)
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

    let client = get_orm_client_rw().await;
    config_columns(entry, encrypted_data).update(client).await?;
    Ok(())
}

/// Turn a toolset on or off; `false` when no such toolset exists.
pub async fn set_enabled(
    org: &str,
    id: &str,
    enabled: bool,
    now: i64,
) -> Result<bool, errors::Error> {
    set_enabled_with(get_orm_client_rw().await, org, id, enabled, now).await
}

pub async fn set_enabled_with<C: ConnectionTrait>(
    client: &C,
    org: &str,
    id: &str,
    enabled: bool,
    now: i64,
) -> Result<bool, errors::Error> {
    let result = Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;
    Ok(result.rows_affected > 0)
}

/// Store one use or test: `status_since` moves only when the state changes.
pub async fn record_health(
    org: &str,
    id: &str,
    outcome: HealthOutcome<'_>,
    now: i64,
) -> Result<(), errors::Error> {
    record_health_with(get_orm_client_rw().await, org, id, outcome, now).await
}

pub async fn record_health_with<C: ConnectionTrait>(
    client: &C,
    org: &str,
    id: &str,
    outcome: HealthOutcome<'_>,
    now: i64,
) -> Result<(), errors::Error> {
    let (state, error) = match outcome {
        HealthOutcome::Ok => (STATE_OK, None),
        HealthOutcome::Failing(error) => (STATE_FAILING, Some(error.to_string())),
    };
    // The guarded update keeps the earlier `status_since` while the state stays the same.
    Entity::update_many()
        .col_expr(Column::StatusSince, Expr::value(now))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .filter(
            Condition::any()
                .add(Column::StatusState.is_null())
                .add(Column::StatusState.ne(state)),
        )
        .exec(client)
        .await?;
    Entity::update_many()
        .col_expr(Column::StatusState, Expr::value(state))
        .col_expr(Column::LastError, Expr::value(error))
        .col_expr(Column::LastUsedAt, Expr::value(now))
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;
    Ok(())
}

/// Delete a toolset by its KSUID `id`.
pub async fn remove(org: &str, id: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Id.eq(id))
        .exec(client)
        .await?;
    Ok(())
}

/// Credentials are ciphertext under the org DEK, so they must go before the DEK does.
pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
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

    #[tokio::test]
    async fn names_are_listed_without_reading_any_data() {
        use sea_orm::{Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        for (id, org, name, at) in [
            ("a", "o", "GitHub", 1),
            ("b", "o", "Kube", 2),
            ("c", "x", "Other", 3),
        ] {
            ActiveModel {
                id: Set(id.to_string()),
                org: Set(org.to_string()),
                name: Set(name.to_string()),
                kind: Set("mcp".to_string()),
                description: Set(None),
                // Not ciphertext: a read that decrypted would fail on it.
                data: Set(Some("not-encrypted".to_string())),
                created_by: Set("u".to_string()),
                created_at: Set(at),
                updated_at: Set(at),
                enabled: Set(id != "a"),
                status_state: Set(None),
                status_since: Set(None),
                last_error: Set(None),
                last_used_at: Set(None),
            }
            .insert(&db)
            .await
            .unwrap();
        }
        let names = list_names_with(&db, "o").await.unwrap();
        assert_eq!(
            names,
            vec![
                ("b".to_string(), "Kube".to_string(), true),
                ("a".to_string(), "GitHub".to_string(), false)
            ]
        );
    }

    #[tokio::test]
    async fn health_keeps_its_since_until_the_state_changes_and_enable_toggles() {
        use sea_orm::{Database, Schema};

        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        ActiveModel {
            id: Set("t".to_string()),
            org: Set("o".to_string()),
            name: Set("GitHub".to_string()),
            kind: Set("mcp".to_string()),
            description: Set(None),
            data: Set(None),
            created_by: Set("u".to_string()),
            created_at: Set(1),
            updated_at: Set(1),
            enabled: Set(true),
            status_state: Set(None),
            status_since: Set(None),
            last_error: Set(None),
            last_used_at: Set(None),
        }
        .insert(&db)
        .await
        .unwrap();
        let read = || async { Entity::find_by_id("t").one(&db).await.unwrap().unwrap() };
        record_health_with(&db, "o", "t", HealthOutcome::Ok, 10)
            .await
            .unwrap();
        record_health_with(&db, "o", "t", HealthOutcome::Ok, 20)
            .await
            .unwrap();
        let row = read().await;
        assert_eq!(row.status_state.as_deref(), Some(STATE_OK));
        assert_eq!((row.status_since, row.last_used_at), (Some(10), Some(20)));
        record_health_with(&db, "o", "t", HealthOutcome::Failing("down"), 30)
            .await
            .unwrap();
        let row = read().await;
        assert_eq!(row.status_state.as_deref(), Some(STATE_FAILING));
        assert_eq!(row.status_since, Some(30));
        assert_eq!(row.last_error.as_deref(), Some("down"));
        record_health_with(&db, "o", "t", HealthOutcome::Ok, 40)
            .await
            .unwrap();
        assert!(read().await.last_error.is_none());
        assert!(set_enabled_with(&db, "o", "t", false, 50).await.unwrap());
        assert!(!read().await.enabled);
        assert!(!set_enabled_with(&db, "x", "t", true, 60).await.unwrap());
        let mut stale = model_to_toolset(read().await, &[0; 32]).unwrap();
        stale.enabled = true;
        stale.updated_at = 70;
        config_columns(stale, None).update(&db).await.unwrap();
        let row = read().await;
        assert_eq!((row.enabled, row.updated_at), (false, 70));
        assert_eq!(row.status_state.as_deref(), Some(STATE_OK));
    }
}
