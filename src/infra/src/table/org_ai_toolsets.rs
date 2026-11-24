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
    ColumnTrait, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, QuerySelect, Select,
    Set, SqlErr, TransactionTrait,
    sea_query::{Expr, OnConflict},
};
use svix_ksuid::{Ksuid, KsuidLike};

use super::entity::{ai_toolset_tombstones as tombstones, org_ai_toolsets::*};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    errors,
    table::cipher,
};

/// A kind no longer supported: its rows stay stored, but no read here returns them.
const UNREAD_KIND: &str = "cli";

/// Filter options for [`list`].
#[derive(Debug, Default)]
pub struct ListFilter {
    /// Case-insensitive substring match on the `name` column (`LIKE '%val%'`).
    pub name: Option<String>,
    /// Exact match on the `kind` column (e.g. `"mcp"`, `"skill"`).
    pub kind: Option<String>,
}

/// Application-level view of an AI toolset record.
/// The `data` field always holds **plaintext** JSON (or `None`) at this layer.
#[derive(Clone)]
pub struct OrgToolset {
    /// 27-character KSUID primary key.
    pub id: String,
    pub org: String,
    pub name: String,
    /// One of: `mcp`, `skill`, `generic`.
    pub kind: String,
    pub description: Option<String>,
    /// Kind-specific plaintext JSON payload. `None` when no config is needed.
    pub data: Option<String>,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
    /// Never sent to, nor overwritten from, another region.
    pub region_only: bool,
    /// The region whose write this row holds; `None` for this region's own.
    pub origin_region: Option<String>,
}

/// How long a tombstone is kept; each write and re-sync drops older ones.
pub const TOMBSTONE_KEEP_MICROS: i64 = 30 * 24 * 3600 * 1_000_000;

/// A deleted toolset's key, kept 30 days so a re-sync can't bring it back.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Tombstone {
    pub org: String,
    /// The toolset's normalized name.
    pub key: String,
    pub deleted_at: i64,
    pub region: String,
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
        region_only: model.region_only,
        origin_region: model.origin_region,
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
    let encrypted_data = encrypt_entry_data(&entry).await?;
    insert_with(get_orm_client_rw().await, entry, encrypted_data).await
}

/// Inserts `entry` in one primary transaction that runs `clash` on the org's names before and after
/// the insert; on a clash nothing is committed and the clashing name is returned.
pub async fn add_checked(
    entry: OrgToolset,
    clash: impl FnMut(&[String]) -> Option<String>,
) -> Result<Option<String>, errors::Error> {
    let encrypted_data = encrypt_entry_data(&entry).await?;
    add_checked_with(get_orm_client_rw().await, entry, encrypted_data, clash).await
}

/// Fetch a toolset by its KSUID `id`. Returns the record with plaintext `data`.
pub async fn get(org: &str, id: &str) -> Result<Option<OrgToolset>, errors::Error> {
    get_with(get_orm_client_ro().await, org, id).await
}

/// [`get`] on the given connection; writers pass the primary so they never act on a lagging
/// replica.
pub async fn get_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    id: &str,
) -> Result<Option<OrgToolset>, errors::Error> {
    let row = find_in(org)
        .filter(Column::Id.eq(id))
        .one(conn)
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
    let row = find_in(org)
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
    limit: Option<u64>,
) -> Result<Vec<OrgToolset>, errors::Error> {
    list_with(get_orm_client_ro().await, org, filter, limit).await
}

pub async fn list_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    filter: ListFilter,
    limit: Option<u64>,
) -> Result<Vec<OrgToolset>, errors::Error> {
    let mut query = find_in(org).order_by(Column::CreatedAt, Order::Desc);

    if let Some(ref name) = filter.name {
        query = query.filter(Column::Name.contains(name));
    }
    if let Some(ref kind) = filter.kind {
        query = query.filter(Column::Kind.eq(kind));
    }
    if let Some(n) = limit {
        // sqlx binds LIMIT as i64 and panics on anything larger.
        query = query.limit(n.min(i64::MAX as u64));
    }

    let rows = query.all(conn).await?;

    if rows.is_empty() {
        return Ok(vec![]);
    }

    let dek = cipher::get_dek(org).await?;
    rows.into_iter()
        .map(|m| model_to_toolset(m, &dek))
        .collect()
}

/// Raw names of every toolset in the org; reads no `data`, so nothing is decrypted.
pub async fn list_names(org: &str) -> Result<Vec<String>, errors::Error> {
    list_names_with(get_orm_client_ro().await, org).await
}

/// [`list_names`] on the given connection; a uniqueness check passes the primary.
pub async fn list_names_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Vec<String>, errors::Error> {
    let names = find_in(org)
        .select_only()
        .column(Column::Name)
        .into_tuple::<String>()
        .all(conn)
        .await?;
    Ok(names)
}

/// Whether a row no read returns still holds the unique `(org, name)`.
pub async fn is_name_held_unread(org: &str, name: &str) -> Result<bool, errors::Error> {
    is_name_held_unread_with(get_orm_client_rw().await, org, name).await
}

/// The org's readable toolsets.
fn find_in(org: &str) -> Select<Entity> {
    Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.ne(UNREAD_KIND))
}

/// Writes `entry`'s description, plaintext `data` and `updated_at` only if the row still has
/// `read_updated_at`; `false` means another update landed since it was read.
pub async fn update_if_unchanged(
    entry: OrgToolset,
    read_updated_at: i64,
) -> Result<bool, errors::Error> {
    let encrypted_data = encrypt_entry_data(&entry).await?;
    write_if_unchanged(
        get_orm_client_rw().await,
        &entry,
        encrypted_data,
        read_updated_at,
    )
    .await
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

/// Keeps the later of the stored and the given delete for the key, and drops expired ones.
pub async fn put_tombstone(tombstone: Tombstone) -> Result<(), errors::Error> {
    put_tombstone_with(get_orm_client_rw().await, tombstone).await
}

pub async fn get_tombstone(org: &str, key: &str) -> Result<Option<Tombstone>, errors::Error> {
    get_tombstone_with(get_orm_client_rw().await, org, key).await
}

/// Org cleanup: a reused org name must not inherit the old org's deletes.
pub async fn delete_tombstones_by_org(org: &str) -> Result<(), errors::Error> {
    tombstones::Entity::delete_many()
        .filter(tombstones::Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

/// Drops tombstones older than `before`, then returns the org's remaining ones.
pub async fn live_tombstones(org: &str, before: i64) -> Result<Vec<Tombstone>, errors::Error> {
    live_tombstones_with(get_orm_client_rw().await, org, before).await
}

/// Credentials are ciphertext under the org DEK, so they must go before the DEK does.
pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(get_orm_client_rw().await)
        .await?;
    Ok(())
}

async fn put_tombstone_with<C: ConnectionTrait>(
    conn: &C,
    t: Tombstone,
) -> Result<(), errors::Error> {
    tombstones::Entity::delete_many()
        .filter(tombstones::Column::DeletedAt.lt(t.deleted_at - TOMBSTONE_KEEP_MICROS))
        .exec(conn)
        .await?;
    if let Some(stored) = get_tombstone_with(conn, &t.org, &t.key).await?
        && stored.deleted_at >= t.deleted_at
    {
        return Ok(());
    }
    let record = tombstones::ActiveModel {
        org: Set(t.org),
        key: Set(t.key),
        deleted_at: Set(t.deleted_at),
        region: Set(t.region),
    };
    tombstones::Entity::insert(record)
        .on_conflict(
            OnConflict::columns([tombstones::Column::Org, tombstones::Column::Key])
                .update_columns([tombstones::Column::DeletedAt, tombstones::Column::Region])
                .to_owned(),
        )
        .exec(conn)
        .await?;
    Ok(())
}

async fn get_tombstone_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    key: &str,
) -> Result<Option<Tombstone>, errors::Error> {
    Ok(tombstones::Entity::find()
        .filter(tombstones::Column::Org.eq(org))
        .filter(tombstones::Column::Key.eq(key))
        .one(conn)
        .await?
        .map(to_tombstone))
}

async fn live_tombstones_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    before: i64,
) -> Result<Vec<Tombstone>, errors::Error> {
    tombstones::Entity::delete_many()
        .filter(tombstones::Column::DeletedAt.lt(before))
        .exec(conn)
        .await?;
    Ok(tombstones::Entity::find()
        .filter(tombstones::Column::Org.eq(org))
        .all(conn)
        .await?
        .into_iter()
        .map(to_tombstone)
        .collect())
}

fn to_tombstone(m: tombstones::Model) -> Tombstone {
    Tombstone {
        org: m.org,
        key: m.key,
        deleted_at: m.deleted_at,
        region: m.region,
    }
}

async fn is_name_held_unread_with<C: ConnectionTrait>(
    conn: &C,
    org: &str,
    name: &str,
) -> Result<bool, errors::Error> {
    Ok(Entity::find()
        .select_only()
        .column(Column::Id)
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(name))
        .filter(Column::Kind.eq(UNREAD_KIND))
        .into_tuple::<String>()
        .one(conn)
        .await?
        .is_some())
}

async fn encrypt_entry_data(entry: &OrgToolset) -> Result<Option<String>, errors::Error> {
    match entry.data.as_deref() {
        Some(plaintext) => Ok(Some(encrypt_data(
            &cipher::get_dek(&entry.org).await?,
            plaintext,
        )?)),
        None => Ok(None),
    }
}

async fn insert_with<C: ConnectionTrait>(
    conn: &C,
    entry: OrgToolset,
    encrypted_data: Option<String>,
) -> Result<(), errors::Error> {
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
        region_only: Set(entry.region_only),
        origin_region: Set(entry.origin_region),
    };
    match Entity::insert(record).exec(conn).await {
        Ok(_) => Ok(()),
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                Err(errors::Error::DbError(errors::DbError::UniqueViolation))
            }
            _ => Err(e.into()),
        },
    }
}

// The second check runs after the insert so a row committed by a writer that skips the check
// (an older node mid-rollout) between the first check and the insert is caught before commit.
async fn add_checked_with<C: TransactionTrait>(
    conn: &C,
    entry: OrgToolset,
    encrypted_data: Option<String>,
    mut clash: impl FnMut(&[String]) -> Option<String>,
) -> Result<Option<String>, errors::Error> {
    let org = entry.org.clone();
    let txn = conn.begin().await?;
    if let Some(name) = clash(&list_names_with(&txn, &org).await?) {
        txn.rollback().await?;
        return Ok(Some(name));
    }
    insert_with(&txn, entry, encrypted_data).await?;
    if let Some(name) = clash(&list_names_with(&txn, &org).await?) {
        txn.rollback().await?;
        return Ok(Some(name));
    }
    txn.commit().await?;
    Ok(None)
}

async fn write_if_unchanged<C: ConnectionTrait>(
    conn: &C,
    entry: &OrgToolset,
    encrypted_data: Option<String>,
    read_updated_at: i64,
) -> Result<bool, errors::Error> {
    let res = Entity::update_many()
        .col_expr(Column::Name, Expr::value(entry.name.clone()))
        .col_expr(Column::Kind, Expr::value(entry.kind.clone()))
        .col_expr(Column::Description, Expr::value(entry.description.clone()))
        .col_expr(Column::RegionOnly, Expr::value(entry.region_only))
        .col_expr(
            Column::OriginRegion,
            Expr::value(entry.origin_region.clone()),
        )
        .col_expr(Column::Data, Expr::value(encrypted_data))
        .col_expr(Column::UpdatedAt, Expr::value(entry.updated_at))
        .filter(Column::Org.eq(&entry.org))
        .filter(Column::Id.eq(&entry.id))
        .filter(Column::UpdatedAt.eq(read_updated_at))
        .exec(conn)
        .await?;
    Ok(res.rows_affected == 1)
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::utils::rand::random_bytes;
    use sea_orm::{ActiveModelTrait, Database, DatabaseConnection, Schema};

    use super::*;

    // -----------------------------------------------------------------------
    // ListFilter
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn list_with_an_out_of_range_limit_does_not_panic() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();

        let rows = list_with(&db, "org", ListFilter::default(), Some(u64::MAX)).await;
        assert!(rows.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_tombstone_keeps_the_later_delete_and_old_ones_expire() {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(tombstones::Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        let at = |deleted_at, region: &str| Tombstone {
            org: "o".into(),
            key: "dd".into(),
            deleted_at,
            region: region.into(),
        };
        put_tombstone_with(&db, at(5, "us")).await.unwrap();
        put_tombstone_with(&db, at(3, "eu")).await.unwrap();
        assert_eq!(
            get_tombstone_with(&db, "o", "dd").await.unwrap(),
            Some(at(5, "us"))
        );
        put_tombstone_with(&db, at(9, "eu")).await.unwrap();
        assert_eq!(
            live_tombstones_with(&db, "o", 6).await.unwrap(),
            [at(9, "eu")]
        );
        assert!(live_tombstones_with(&db, "o", 10).await.unwrap().is_empty());
        let other = |deleted_at| Tombstone {
            key: "gh".into(),
            ..at(deleted_at, "eu")
        };
        put_tombstone_with(&db, other(1)).await.unwrap();
        put_tombstone_with(&db, at(TOMBSTONE_KEEP_MICROS + 2, "us"))
            .await
            .unwrap();
        assert!(
            get_tombstone_with(&db, "o", "gh").await.unwrap().is_none(),
            "expired on write"
        );
    }

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

    async fn db() -> DatabaseConnection {
        let db = Database::connect("sqlite::memory:").await.unwrap();
        let backend = db.get_database_backend();
        let stmt = Schema::new(backend).create_table_from_entity(Entity);
        db.execute(backend.build(&stmt)).await.unwrap();
        db
    }

    async fn insert(db: &DatabaseConnection, id: &str, name: &str, org: &str) {
        insert_kind(db, id, name, org, "mcp").await
    }

    async fn insert_kind(db: &DatabaseConnection, id: &str, name: &str, org: &str, kind: &str) {
        ActiveModel {
            id: Set(id.to_string()),
            org: Set(org.to_string()),
            name: Set(name.to_string()),
            kind: Set(kind.to_string()),
            description: Set(None),
            data: Set(Some("v0".to_string())),
            created_by: Set("u".to_string()),
            created_at: Set(1),
            updated_at: Set(1),
            region_only: Set(false),
            origin_region: Set(None),
        }
        .insert(db)
        .await
        .unwrap();
    }

    fn entry(description: &str, updated_at: i64) -> OrgToolset {
        OrgToolset {
            id: "t1".to_string(),
            org: "org".to_string(),
            name: "datadog-prod".to_string(),
            kind: "mcp".to_string(),
            description: Some(description.to_string()),
            data: None,
            created_by: "u".to_string(),
            created_at: 1,
            updated_at,
            region_only: false,
            origin_region: None,
        }
    }

    #[tokio::test]
    async fn two_updates_from_the_same_read_only_the_first_lands() {
        let db = db().await;
        insert(&db, "t1", "datadog-prod", "org").await;

        let rotated = entry("rotated", 2);
        let rotate = write_if_unchanged(&db, &rotated, Some("new-key".into()), 1).await;
        assert!(rotate.unwrap());
        let timeout = entry("timeout", 3);
        let timeout_only = write_if_unchanged(&db, &timeout, Some("old-key".into()), 1).await;
        assert!(!timeout_only.unwrap());

        let row = Entity::find_by_id("t1").one(&db).await.unwrap().unwrap();
        assert_eq!(row.data.as_deref(), Some("new-key"));
        assert_eq!(row.description.as_deref(), Some("rotated"));
        assert_eq!(row.updated_at, 2);
        assert_eq!(row.name, "datadog-prod");
    }

    #[tokio::test]
    async fn list_names_reads_only_the_org_s_names() {
        let db = db().await;
        insert(&db, "t1", "Datadog Prod", "org").await;
        insert(&db, "t2", "github", "org").await;
        insert(&db, "t3", "other", "org2").await;

        let mut names = list_names_with(&db, "org").await.unwrap();
        names.sort();
        assert_eq!(names, ["Datadog Prod", "github"]);
    }

    #[tokio::test]
    async fn a_cli_row_stays_stored_but_no_read_returns_it() {
        let db = db().await;
        insert_kind(&db, "c1", "gh", "org", "cli").await;

        assert!(get_with(&db, "org", "c1").await.unwrap().is_none());
        for kind in [None, Some("cli".to_string())] {
            let filter = ListFilter { name: None, kind };
            assert!(
                list_with(&db, "org", filter, None)
                    .await
                    .unwrap()
                    .is_empty()
            );
        }
        assert!(list_names_with(&db, "org").await.unwrap().is_empty());
        assert!(is_name_held_unread_with(&db, "org", "gh").await.unwrap());
        assert!(!is_name_held_unread_with(&db, "org2", "gh").await.unwrap());

        insert(&db, "m1", "datadog", "org").await;
        assert!(
            !is_name_held_unread_with(&db, "org", "datadog")
                .await
                .unwrap()
        );
        assert!(Entity::find_by_id("c1").one(&db).await.unwrap().is_some());
    }

    fn new_entry(id: &str, name: &str) -> OrgToolset {
        OrgToolset {
            id: id.to_string(),
            name: name.to_string(),
            ..entry("", 1)
        }
    }

    fn clash_with(name: &'static str) -> impl FnMut(&[String]) -> Option<String> {
        move |names| names.iter().find(|n| n.as_str() == name).cloned()
    }

    #[tokio::test]
    async fn add_checked_inserts_nothing_when_the_first_check_clashes() {
        let db = db().await;
        insert(&db, "t1", "Datadog Prod", "org").await;

        let clash = add_checked_with(
            &db,
            new_entry("t2", "datadog-prod"),
            None,
            clash_with("Datadog Prod"),
        );
        assert_eq!(clash.await.unwrap().as_deref(), Some("Datadog Prod"));
        assert!(Entity::find_by_id("t2").one(&db).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn add_checked_rolls_back_when_the_second_check_clashes() {
        let db = db().await;
        let mut calls = 0;
        let late_clash = |_: &[String]| {
            calls += 1;
            (calls == 2).then(|| "Datadog Prod".to_string())
        };

        let clash = add_checked_with(&db, new_entry("t2", "datadog-prod"), None, late_clash);
        assert_eq!(clash.await.unwrap().as_deref(), Some("Datadog Prod"));
        assert!(Entity::find_by_id("t2").one(&db).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn add_checked_commits_and_its_second_check_sees_the_new_row() {
        let db = db().await;
        let mut seen = Vec::new();
        let record = |names: &[String]| {
            seen.push(names.to_vec());
            None
        };

        let clash = add_checked_with(&db, new_entry("t2", "datadog-prod"), None, record);
        assert!(clash.await.unwrap().is_none());
        assert_eq!(seen, [vec![], vec!["datadog-prod".to_string()]]);
        assert!(Entity::find_by_id("t2").one(&db).await.unwrap().is_some());
    }
}
