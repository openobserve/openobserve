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

//! Synthetics probe token storage.
//!
//! `o2syn_` prefixed tokens scoped to the synthetics Job API
//! (`/synthetics/jobs/resolve`, `/ack`, `/lease`). Separate from
//! `org_ingestion_tokens` (`o2oi_`) which is write-only ingest.

use std::time::Duration;

use config::{ider::ksuid, meta::secret_store::SecretValue};
use sea_orm::{
    ColumnTrait, Condition, ConnectionTrait, DatabaseBackend, EntityTrait, Iterable, QueryFilter,
    QueryOrder, QuerySelect, Select, Set, SqlErr, TransactionTrait,
    sea_query::{Expr, SimpleExpr},
};
use sha2::{Digest, Sha256};

use super::{
    credential_values::{self, OWNER_KIND_PROBE_TOKEN, ProbeTokenAd, SecretRecord, SlotClass},
    entity::{
        credential_values::ActiveModel as CredentialActiveModel,
        synthetics_probe_tokens::{ActiveModel, Column, Entity, Model},
    },
    secret_store_job_markers::{self, AGENT_TOKEN_CUTOVER, META_ORG},
    ttl_cache::TtlCache,
};
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
    dist_lock,
    errors::{self, DbError, Error},
    secret_store::{capability, gate},
    secrets::{self, CURRENT, SecretOwnerKind, SecretPurpose},
};

pub const SYNTHETICS_PROBE_TOKEN_PREFIX: &str = "o2syn_";

/// Token hash → lookup result, with the time it was loaded.
///
/// `find_global` runs in the auth middleware on **every** probe request
/// (`api/common/src/auth/validator.rs`), so it fired once per lease, resolve and
/// ack — the single highest-frequency query in the feature, always for the same
/// handful of token strings.
///
/// `None` is cached as well as `Some`: an unknown or disabled token must not be
/// able to force a DB round trip per request, which is what makes an uncached
/// validator a cheap way to generate load from outside.
///
/// **The TTL is a security parameter, not a performance one.** It bounds how
/// long a disabled token keeps working. 10 s is short enough that revocation is
/// effectively immediate for an operator and long enough to remove ~99 % of the
/// queries. Writes in this module invalidate eagerly, so the TTL only covers a
/// disable performed on a *different* node.
static TOKEN_CACHE: TtlCache<Option<SyntheticsProbeTokenRecord>> = TtlCache::new(TOKEN_CACHE_TTL);

/// Org → its default enabled token, same TTL rules as [`TOKEN_CACHE`].
static DEFAULT_TOKEN_CACHE: TtlCache<Option<SyntheticsProbeTokenRecord>> =
    TtlCache::new(TOKEN_CACHE_TTL);

const TOKEN_CACHE_TTL: Duration = Duration::from_secs(10);
const REPAIR_PAGE_ROWS: u64 = 200;
const BLANK_LOCK_KEY: &str = "/secret_store/maint/probe_token_blank";

/// Name of the token every org starts with (backfilled / created at org
/// creation). Named tokens minted later carry their own operator-chosen name.
pub const DEFAULT_TOKEN_NAME: &str = "default";

#[derive(Debug, Clone)]
pub struct SyntheticsProbeTokenRecord {
    pub id: String,
    pub org_id: String,
    pub name: String,
    pub token: String,
    pub is_default: bool,
    pub enabled: bool,
    pub created_by: String,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Default)]
pub struct RepairOutcome {
    pub repaired: u64,
    pub failed: u64,
}

#[derive(Debug, Default)]
pub struct BlankReport {
    pub blanked: u64,
    pub mismatched: u64,
    pub skipped: u64,
}

enum BlankRow {
    Blanked,
    Mismatched,
    Skipped,
}

/// Clears both token caches. Called by every write path here so a disable,
/// rotate or default-change takes effect on this node immediately.
pub fn invalidate_cache() {
    TOKEN_CACHE.clear();
    DEFAULT_TOKEN_CACHE.clear();
}

pub fn generate_token() -> String {
    format!(
        "{}{}",
        SYNTHETICS_PROBE_TOKEN_PREFIX,
        config::utils::rand::generate_random_string(32)
    )
}

/// Lower-case hex SHA-256 of the whole token, as `token_sha256` stores it.
pub fn token_sha256(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

/// Insert a new probe token row. Fails with a clear message if a token with the
/// same `(org_id, name)` already exists (the unique constraint).
pub async fn add(record: &SyntheticsProbeTokenRecord) -> Result<(), errors::Error> {
    let (secret_ref, hash, credential) = seal_owned_row(
        &record.org_id,
        &record.id,
        &record.token,
        record.created_at,
        record.updated_at,
    )
    .await?;
    let plaintext = plaintext_column_value(&record.token).await;
    let txn = get_orm_client_rw().await.begin().await?;
    let model = ActiveModel {
        id: Set(record.id.clone()),
        org_id: Set(record.org_id.clone()),
        name: Set(record.name.clone()),
        token: Set(plaintext),
        token_sha256: Set(hash),
        token_ref: Set(Some(secret_ref)),
        is_default: Set(record.is_default),
        enabled: Set(record.enabled),
        created_by: Set(record.created_by.clone()),
        // The record's own timestamps, not this node's clock. Every local
        // caller already stamps them with `now`, so this changes nothing for
        // them — but a token replicated from another region must land with the
        // origin's `created_at`, or `list_by_org` (ordered by it) shows the
        // org's tokens in a different order in every region.
        created_at: Set(record.created_at),
        updated_at: Set(record.updated_at),
    };
    if let Err(e) = Entity::insert(model).exec(&txn).await {
        let message = match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                format!("probe token '{}' already exists in org", record.name)
            }
            _ => "failed to insert probe token".to_owned(),
        };
        return Err(Error::DbError(DbError::SeaORMError(message)));
    }
    insert_owned_row(&txn, credential).await?;
    txn.commit().await?;
    // A new token can become the org default, so both caches are stale.
    invalidate_and_publish(&record.org_id).await;
    Ok(())
}

/// Find an enabled probe token by value (global — no org_id filter). The
/// validator uses this to authenticate the token; the handler then asserts the
/// token's org equals the `{org_id}` in the `/{org}/synthetics/{jobs,agent}/*`
/// path (the tenant boundary). Matches ANY enabled token, so old + new tokens
/// coexist during a rotation overlap window.
/// Matches by hash; the plaintext column is consulted only for rows with a blank hash.
pub async fn find_global(token: &str) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let hash = token_sha256(token);
    let metadata = if let Some(cached) = TOKEN_CACHE.get(&hash) {
        cached
    } else {
        let conn = get_orm_client_rw().await;
        let enabled = reader_query(Expr::value("")).filter(Column::Enabled.eq(true));
        let lookup_error = |_| Error::Message("probe token lookup failed".to_owned());
        let row = match enabled
            .clone()
            .filter(Column::TokenSha256.eq(&hash))
            .one(conn)
            .await
            .map_err(lookup_error)?
        {
            Some(row) => Some(row),
            None => enabled
                .filter(Column::TokenSha256.eq(""))
                .filter(Column::Token.eq(token))
                .one(conn)
                .await
                .map_err(lookup_error)?,
        };
        let metadata = row.map(into_record);
        TOKEN_CACHE.insert(hash, metadata.clone());
        metadata
    };
    Ok(metadata.map(|record| SyntheticsProbeTokenRecord {
        token: token.to_owned(),
        ..record
    }))
}

/// Find the org's default enabled probe token — the one handed out by
/// `agent-setup` / install and injected into Lambda invokes by the dispatcher.
/// A row with `token_ref` takes its value from the owned row, never the plaintext column.
pub async fn find_default(
    org_id: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    if let Some(cached) = DEFAULT_TOKEN_CACHE.get(org_id) {
        return Ok(cached);
    }

    let conn = get_orm_client_rw().await;
    let row = value_query()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::IsDefault.eq(true))
        .filter(Column::Enabled.eq(true))
        .one(conn)
        .await?;
    let record = resolve_record(conn, row).await?;
    DEFAULT_TOKEN_CACHE.insert(org_id.to_owned(), record.clone());
    Ok(record)
}

pub async fn view_by_name(
    org_id: &str,
    name: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let conn = get_orm_client_rw().await;
    let row = value_query()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(conn)
        .await?;
    resolve_record(conn, row).await
}

/// Metadata omits the token value. Use [`view_by_name`] or [`find_default`] for a value.
pub async fn list_by_org(org_id: &str) -> Result<Vec<SyntheticsProbeTokenRecord>, errors::Error> {
    let rows = reader_query(Expr::value(""))
        .filter(Column::OrgId.eq(org_id))
        .order_by_desc(Column::IsDefault)
        .order_by_desc(Column::CreatedAt)
        .all(get_orm_client_ro().await)
        .await?;
    Ok(rows.into_iter().map(into_record).collect())
}

/// Metadata omits the token value. Use [`view_by_name`] or [`find_default`] for a value.
pub async fn get_by_name(
    org_id: &str,
    name: &str,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let row = reader_query(Expr::value(""))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .one(get_orm_client_ro().await)
        .await?;
    Ok(row.map(into_record))
}

pub async fn agent_token_cutover_at() -> Result<Option<i64>, errors::Error> {
    let marker = secret_store_job_markers::get_marker_in(
        get_orm_client_rw().await,
        META_ORG,
        AGENT_TOKEN_CUTOVER,
    )
    .await?;
    Ok(marker.map(|m| m.done_at))
}

pub fn is_pre_cutover(created_at: i64, cutover_at: Option<i64>) -> bool {
    cutover_at.is_some_and(|t| created_at < t)
}

/// `created_at` of the org's token row `id`; None when the row is gone.
pub async fn created_at_by_id(org_id: &str, id: &str) -> Result<Option<i64>, errors::Error> {
    Ok(Entity::find()
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Id.eq(id))
        .select_only()
        .column(Column::CreatedAt)
        .into_tuple::<i64>()
        .one(get_orm_client_rw().await)
        .await?)
}

/// Enable or disable a token by `(org_id, name)`. Disabling is how a token is
/// revoked.
///
/// Revocation is immediate **on this node** — the caches are cleared below —
/// and effectively immediate on every other node in the cluster, because
/// [`invalidate_and_publish`] emits a coordinator event and every node's watcher
/// clears its cache on receipt. `TOKEN_CACHE_TTL` (10 s) is the fallback for a
/// node that missed the event, not the normal path.
///
/// Across a **super cluster** the same holds one level up: the replicated
/// `SetEnabled` is applied through this function in the receiving region, so it
/// emits that region's coordinator event too. The revocation window there is
/// queue latency plus event delivery, with the 10 s TTL as the same fallback.
/// Do not remove the cache to shrink it — `find_global` runs in the auth
/// middleware on every probe request, and an uncached validator is a cheap way
/// to generate load from outside.
pub async fn set_enabled(org_id: &str, name: &str, enabled: bool) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let client = get_orm_client_rw().await;
    Entity::update_many()
        .col_expr(Column::Enabled, Expr::value(enabled))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(client)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    invalidate_and_publish(org_id).await;
    Ok(())
}

/// Make `(org_id, name)` the org's sole default (clears `is_default` on every
/// other row of the org, in one transaction). Does NOT touch `enabled`, so the
/// previous default stays valid during a rotation overlap window until it is
/// explicitly disabled.
pub async fn set_default(org_id: &str, name: &str) -> Result<(), errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let client = get_orm_client_rw().await;
    let txn = client
        .begin()
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Entity::update_many()
        .col_expr(Column::IsDefault, Expr::value(false))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .exec(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    Entity::update_many()
        .col_expr(Column::IsDefault, Expr::value(true))
        .col_expr(Column::UpdatedAt, Expr::value(now))
        .filter(Column::OrgId.eq(org_id))
        .filter(Column::Name.eq(name))
        .exec(&txn)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    txn.commit()
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    invalidate_and_publish(org_id).await;
    Ok(())
}

/// Create the default probe token for a new org.
///
/// Returns the row it inserted so the caller can replicate it. The caller has
/// to be the one to publish: this module is `infra`, which cannot reach the
/// enterprise crate at all, and that missing edge is what stops a region
/// re-broadcasting a token it just applied from another region.
pub async fn create_for_org(
    org_id: &str,
    created_by: &str,
) -> Result<SyntheticsProbeTokenRecord, errors::Error> {
    let now = chrono::Utc::now().timestamp_micros();
    let record = SyntheticsProbeTokenRecord {
        id: config::ider::ksuid(),
        org_id: org_id.to_owned(),
        name: DEFAULT_TOKEN_NAME.to_owned(),
        token: generate_token(),
        is_default: true,
        enabled: true,
        created_by: created_by.to_owned(),
        created_at: now,
        updated_at: now,
    };
    add(&record).await?;
    Ok(record)
}

/// Deletes every probe token of an org and drops both token caches on every node.
pub async fn delete_by_org(org_id: &str) -> Result<(), errors::Error> {
    Entity::delete_many()
        .filter(Column::OrgId.eq(org_id))
        .exec(get_orm_client_rw().await)
        .await
        .map_err(|e| Error::DbError(DbError::SeaORMError(e.to_string())))?;
    invalidate_and_publish(org_id).await;
    Ok(())
}

pub async fn repair_owned_rows<C: TransactionTrait + ConnectionTrait>(
    conn: &C,
) -> Result<RepairOutcome, errors::Error> {
    let mut outcome = RepairOutcome::default();
    let mut after = String::new();
    loop {
        let rows = Entity::find()
            .filter(Column::Token.ne(""))
            .filter(
                Condition::any()
                    .add(Column::TokenSha256.eq(""))
                    .add(Column::TokenRef.is_null()),
            )
            .filter(Column::Id.gt(&after))
            .order_by_asc(Column::Id)
            .limit(REPAIR_PAGE_ROWS)
            .all(conn)
            .await?;
        let page_len = rows.len();
        for row in rows {
            match repair_owned_row(conn, &row).await {
                Ok(repaired) => outcome.repaired += repaired,
                Err(_) => {
                    log::error!("probe token repair failed for id {}", row.id);
                    outcome.failed += 1;
                }
            }
            after = row.id;
        }
        if (page_len as u64) < REPAIR_PAGE_ROWS {
            return Ok(outcome);
        }
    }
}

pub async fn blank_plaintext_pass() -> Result<BlankReport, errors::Error> {
    if !plaintext_blanking_enabled().await? {
        return Ok(BlankReport::default());
    }

    let locker = dist_lock::lock(BLANK_LOCK_KEY, 0).await?;
    let outcome = match plaintext_blanking_enabled().await {
        Ok(true) => blank_plaintext_rows(get_orm_client_rw().await).await,
        Ok(false) => Ok(BlankReport::default()),
        Err(error) => Err(error),
    };
    let unlock = dist_lock::unlock(&locker).await;
    outcome.and_then(|report| unlock.map(|()| report))
}

async fn plaintext_blanking_enabled() -> Result<bool, errors::Error> {
    Ok(gate::all_live_nodes_at_level(capability::LEVEL_P1_11) && gate::durably_latched().await?)
}

// An unreadable latch keeps plaintext: blanking is the one-way step, so it must be proven.
async fn plaintext_column_value(token: &str) -> String {
    if plaintext_blanking_enabled().await.unwrap_or(false) {
        String::new()
    } else {
        token.to_owned()
    }
}

async fn blank_plaintext_rows(
    conn: &(impl TransactionTrait + ConnectionTrait),
) -> Result<BlankReport, errors::Error> {
    repair_owned_rows(conn).await?;
    let mut report = BlankReport::default();
    let mut after = String::new();
    loop {
        let ids = Entity::find()
            .select_only()
            .column(Column::Id)
            .filter(Column::Token.ne(""))
            .filter(Column::Id.gt(&after))
            .order_by_asc(Column::Id)
            .limit(REPAIR_PAGE_ROWS)
            .into_tuple::<String>()
            .all(conn)
            .await?;
        let page_len = ids.len();
        for id in ids {
            if !plaintext_blanking_enabled().await? {
                return Ok(report);
            }
            match blank_plaintext_row(conn, &id).await {
                Ok(BlankRow::Blanked) => report.blanked += 1,
                Ok(BlankRow::Mismatched) => {
                    log::warn!("probe token blanking verification failed for id {id}");
                    report.mismatched += 1;
                }
                Ok(BlankRow::Skipped) => report.skipped += 1,
                Err(_) => {
                    log::error!("probe token blanking failed for id {id}");
                    report.skipped += 1;
                }
            }
            after = id;
        }
        if (page_len as u64) < REPAIR_PAGE_ROWS {
            return Ok(report);
        }
    }
}

async fn blank_plaintext_row(
    conn: &impl TransactionTrait,
    id: &str,
) -> Result<BlankRow, errors::Error> {
    let txn = conn.begin().await?;
    let mut query = Entity::find_by_id(id).filter(Column::Token.ne(""));
    match txn.get_database_backend() {
        DatabaseBackend::Postgres => query = query.lock_exclusive(),
        DatabaseBackend::Sqlite => {
            // Acquire SQLite's writer before the read so the snapshot cannot go stale.
            txn.execute_unprepared("UPDATE synthetics_probe_tokens SET token = token WHERE 1 = 0")
                .await?;
        }
        _ => {
            return Err(Error::Message(
                "unsupported probe token database".to_owned(),
            ));
        }
    }
    let Some(row) = query.one(&txn).await? else {
        return Ok(BlankRow::Skipped);
    };
    let Some(secret_ref) = row.token_ref.as_deref() else {
        return Ok(BlankRow::Mismatched);
    };
    if row.token_sha256 != token_sha256(&row.token)
        || !resolve_owned_value(&txn, &row, secret_ref)
            .await
            .is_ok_and(|value| value.as_str() == row.token)
    {
        return Ok(BlankRow::Mismatched);
    }
    if !plaintext_blanking_enabled().await? {
        return Ok(BlankRow::Skipped);
    }

    let updated = Entity::update_many()
        .col_expr(Column::Token, Expr::value(""))
        .filter(Column::Id.eq(id))
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::Token.eq(&row.token))
        .filter(Column::TokenSha256.eq(&row.token_sha256))
        .filter(Column::TokenRef.eq(secret_ref))
        .exec(&txn)
        .await?;
    txn.commit().await?;
    if updated.rows_affected == 1 {
        Ok(BlankRow::Blanked)
    } else {
        Ok(BlankRow::Skipped)
    }
}

fn reader_query(token: SimpleExpr) -> Select<Entity> {
    Entity::find()
        .select_only()
        .columns(Column::iter().filter(|c| !matches!(c, Column::Token)))
        .expr_as(token, Column::Token)
}

fn value_query() -> Select<Entity> {
    reader_query(
        Expr::case(Column::TokenRef.is_null(), Expr::col(Column::Token))
            .finally("")
            .into(),
    )
}

fn into_record(row: Model) -> SyntheticsProbeTokenRecord {
    SyntheticsProbeTokenRecord {
        id: row.id,
        org_id: row.org_id,
        name: row.name,
        token: row.token,
        is_default: row.is_default,
        enabled: row.enabled,
        created_by: row.created_by,
        created_at: row.created_at,
        updated_at: row.updated_at,
    }
}

async fn resolve_record(
    conn: &impl ConnectionTrait,
    row: Option<Model>,
) -> Result<Option<SyntheticsProbeTokenRecord>, errors::Error> {
    let Some(mut row) = row else { return Ok(None) };
    if let Some(secret_ref) = &row.token_ref {
        row.token = resolve_owned_value(conn, &row, secret_ref)
            .await?
            .to_string();
    }
    if row.token.is_empty() {
        return Err(Error::Message(format!(
            "probe token {} value unavailable",
            row.id
        )));
    }
    Ok(Some(into_record(row)))
}

async fn resolve_owned_value(
    conn: &impl ConnectionTrait,
    row: &Model,
    secret_ref: &str,
) -> Result<SecretValue, errors::Error> {
    let slot = SlotClass::ProbeToken(ProbeTokenAd {
        org_id: &row.org_id,
        token_id: &row.id,
        secret_ref,
        token_sha256: &row.token_sha256,
    });
    let (_, value) = secrets::resolve_value_in(
        conn,
        &row.org_id,
        secret_ref,
        SecretOwnerKind::ProbeToken,
        &row.id,
        CURRENT,
        &slot,
    )
    .await
    .map_err(|_| Error::Message(format!("probe token {} owned row unavailable", row.id)))?;
    Ok(value)
}

/// Invalidates locally **and** tells every other node.
///
/// This is the revocation path: `set_enabled(false)` reaches other nodes as a
/// coordinator event rather than waiting out their TTL, which is what makes a
/// disable effectively fleet-wide-immediate.
async fn invalidate_and_publish(org_id: &str) {
    invalidate_cache();
    if let Err(e) = crate::coordinator::synthetics::emit_tokens_changed(org_id).await {
        log::error!("[synthetics] emit probe token cache event failed for {org_id}: {e}");
    }
}

async fn seal_owned_row(
    org_id: &str,
    token_id: &str,
    token: &str,
    created_at: i64,
    updated_at: i64,
) -> Result<(String, String, CredentialActiveModel), errors::Error> {
    let hash = token_sha256(token);
    let secret = SecretRecord {
        id: ksuid(),
        secret_ref: ksuid(),
        org_id: org_id.to_owned(),
        owner_kind: OWNER_KIND_PROBE_TOKEN.to_owned(),
        owner_id: token_id.to_owned(),
        purpose: SecretPurpose::Auth.as_str().to_owned(),
        key_id: None,
        state: CURRENT.to_owned(),
        value: token.to_owned().into(),
        last_verified_at: None,
        grace_expires_at: None,
        created_at,
        updated_at,
    };
    let slot = SlotClass::ProbeToken(ProbeTokenAd {
        org_id,
        token_id,
        secret_ref: &secret.secret_ref,
        token_sha256: &hash,
    });
    // Provisioning the org DEK can take SQLite's write lock.
    let sealed = credential_values::encrypted_active_model(&secret, &slot).await?;
    Ok((secret.secret_ref, hash, sealed))
}

async fn insert_owned_row<C: ConnectionTrait>(
    conn: &C,
    credential: CredentialActiveModel,
) -> Result<(), errors::Error> {
    credential_values::insert(conn, credential)
        .await
        .map_err(|_| Error::Message("failed to insert probe token credential".to_owned()))
}

async fn repair_owned_row<C: TransactionTrait>(
    conn: &C,
    row: &Model,
) -> Result<u64, errors::Error> {
    let hash = token_sha256(&row.token);
    if !row.token_sha256.is_empty() && row.token_sha256 != hash {
        return Err(Error::Message("probe token hash mismatch".to_owned()));
    }
    let update = Entity::update_many()
        .filter(Column::Id.eq(&row.id))
        .filter(Column::OrgId.eq(&row.org_id))
        .filter(Column::Token.eq(&row.token))
        .filter(Column::TokenSha256.eq(&row.token_sha256))
        .col_expr(Column::TokenSha256, Expr::value(hash));
    let (update, credential) = if let Some(secret_ref) = &row.token_ref {
        (update.filter(Column::TokenRef.eq(secret_ref)), None)
    } else {
        let (secret_ref, _, credential) = seal_owned_row(
            &row.org_id,
            &row.id,
            &row.token,
            row.created_at,
            row.updated_at,
        )
        .await?;
        let update = update
            .col_expr(Column::TokenRef, Expr::value(secret_ref))
            .filter(Column::TokenRef.is_null());
        (update, Some(credential))
    };
    let txn = conn.begin().await?;
    let matched = update
        .exec(&txn)
        .await
        .map_err(|_| Error::Message("failed to update probe token".to_owned()))?;
    if matched.rows_affected != 1 {
        return Ok(0);
    }
    if let Some(credential) = credential {
        insert_owned_row(&txn, credential).await?;
    }
    txn.commit().await?;
    Ok(1)
}

#[cfg(test)]
mod tests {
    use config::{
        meta::cluster::{Node, NodeStatus},
        utils::time::now_micros,
    };
    use sea_orm::{ConnectOptions, Database, DatabaseConnection, PaginatorTrait, Schema};

    use super::*;
    use crate::{
        secret_store::{
            capability::{CapabilityRecord, FgaMode, NODE_LEVEL, STORE_FLOOR_VERSION},
            gate::tests::isolated_store_test,
        },
        table::{
            cipher,
            credential_values::{self, OWNER_KIND_PROBE_TOKEN, ProbeTokenAd, SlotClass},
            entity::credential_values as credentials,
            testing::unique,
        },
    };

    async fn meta_store() -> bool {
        static CIPHER: tokio::sync::OnceCell<()> = tokio::sync::OnceCell::const_new();
        if !crate::table::testing::meta_store().await {
            return false;
        }
        CIPHER
            .get_or_init(|| async {
                if cipher::master_key().is_err() {
                    cipher::boot(None).await.unwrap();
                }
            })
            .await;
        true
    }

    async fn cleanup(org: &str) {
        delete_by_org(org).await.unwrap();
        credential_values::delete_by_org(org).await.unwrap();
        cipher::delete_by_org(org).await.unwrap();
    }

    async fn assert_owned(org: &str, id: &str, token: &str) -> credentials::Model {
        let db = get_orm_client_rw().await;
        let probe = Entity::find_by_id(id).one(db).await.unwrap().unwrap();
        assert!(probe.token == token);
        assert!(probe.token_sha256 == token_sha256(token));
        let rows = credential_values::find_all_by_owner(db, org, OWNER_KIND_PROBE_TOKEN, id)
            .await
            .unwrap();
        assert_eq!(rows.len(), 1);
        let owned = rows.into_iter().next().unwrap();
        assert_eq!(probe.token_ref.as_deref(), Some(owned.secret_ref.as_str()));
        assert_eq!(owned.state, "current");
        assert_eq!(owned.purpose, "auth");
        assert!(owned.ciphertext.starts_with("o2ad1:"));
        assert_eq!(owned.created_at, probe.created_at);
        assert_eq!(owned.updated_at, probe.updated_at);
        let slot = SlotClass::ProbeToken(ProbeTokenAd {
            org_id: org,
            token_id: id,
            secret_ref: &owned.secret_ref,
            token_sha256: &probe.token_sha256,
        });
        let secret = credential_values::decrypt_model(owned.clone(), &slot)
            .await
            .unwrap();
        assert!(secret.value.as_str() == token);
        owned
    }

    async fn insert_legacy(
        db: &DatabaseConnection,
        org: &str,
        name: &str,
        with_hash: bool,
    ) -> (String, String) {
        let token = generate_token();
        let id = config::ider::ksuid();
        let hash = if with_hash {
            token_sha256(&token)
        } else {
            String::new()
        };
        Entity::insert(ActiveModel {
            id: Set(id.clone()),
            org_id: Set(org.to_string()),
            name: Set(name.to_string()),
            token: Set(token.clone()),
            token_sha256: Set(hash),
            token_ref: Set(None),
            is_default: Set(false),
            enabled: Set(true),
            created_by: Set("legacy".to_string()),
            created_at: Set(1),
            updated_at: Set(2),
        })
        .exec(db)
        .await
        .unwrap();
        (id, token)
    }

    #[test]
    fn the_hash_is_lower_hex_sha256_of_the_whole_token() {
        assert_eq!(
            token_sha256("abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn only_tokens_created_before_an_existing_cutover_are_pre_cutover() {
        assert!(!is_pre_cutover(1, None));
        assert!(is_pre_cutover(1, Some(2)));
        assert!(!is_pre_cutover(2, Some(2)));
        assert!(!is_pre_cutover(3, Some(2)));
    }

    #[test]
    fn plaintext_blanking_requires_a_durable_latch_for_passes_and_add() {
        isolated_store_test(
            "table::synthetics_probe_tokens::tests::plaintext_blanking_requires_a_durable_latch_for_passes_and_add",
            async {
                assert!(meta_store().await);
                let db = get_orm_client_rw().await;
                let coordinator = crate::db::get_coordinator().await.as_ref();
                let now = now_micros();
                let node = Node {
                    uuid: ksuid(),
                    name: "probe-token-node".into(),
                    version: STORE_FLOOR_VERSION.into(),
                    status: NodeStatus::Online,
                    ..Default::default()
                };
                let mut record = CapabilityRecord {
                    level: NODE_LEVEL,
                    binary_version: node.version.clone(),
                    booted_at: now,
                    refs_enabled: false,
                    fga_mode: FgaMode::On,
                    renewed_at: now,
                };
                capability::write_record_in(coordinator, &node.uuid, &record)
                    .await
                    .unwrap();
                gate::evaluate_once_in(coordinator, vec![node.clone()], now)
                    .await
                    .unwrap();
                assert!(gate::all_live_nodes_at_level(capability::LEVEL_P1_11));
                assert!(!gate::durably_latched().await.unwrap());

                let org = unique("ptk_latch");
                let minted = create_for_org(&org, "system").await.unwrap();
                assert_owned(&org, &minted.id, &minted.token).await;
                let (legacy_id, legacy_token) = insert_legacy(db, &org, "legacy", false).await;
                let repair = repair_owned_rows(db).await.unwrap();
                assert_eq!((repair.repaired, repair.failed), (1, 0));
                assert_owned(&org, &legacy_id, &legacy_token).await;
                assert_eq!(blank_plaintext_pass().await.unwrap().blanked, 0);
                assert_owned(&org, &minted.id, &minted.token).await;
                assert_owned(&org, &legacy_id, &legacy_token).await;

                record.refs_enabled = true;
                capability::write_record_in(coordinator, &node.uuid, &record)
                    .await
                    .unwrap();
                gate::evaluate_once_in(coordinator, vec![node], now + 1)
                    .await
                    .unwrap();
                assert!(gate::durably_latched().await.unwrap());
                assert_eq!(blank_plaintext_pass().await.unwrap().blanked, 2);
                let named = SyntheticsProbeTokenRecord {
                    id: ksuid(),
                    name: "after-latch".into(),
                    token: generate_token(),
                    is_default: false,
                    ..minted.clone()
                };
                add(&named).await.unwrap();
                for token in [&minted, &named] {
                    let stored = Entity::find_by_id(&token.id)
                        .one(db)
                        .await
                        .unwrap()
                        .unwrap();
                    assert!(stored.token.is_empty());
                    assert_eq!(stored.token_sha256, token_sha256(&token.token));
                    assert!(find_global(&token.token).await.unwrap().is_some());
                }
                cleanup(&org).await;
            },
        );
    }

    #[tokio::test]
    async fn global_lookup_requires_the_hash_of_an_enabled_token_once_populated() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_auth");
        let minted = create_for_org(&org, "system").await.unwrap();
        let other = generate_token();
        Entity::update_many()
            .col_expr(Column::Token, Expr::value(other.clone()))
            .filter(Column::Id.eq(&minted.id))
            .exec(get_orm_client_rw().await)
            .await
            .unwrap();
        invalidate_cache();
        let found = find_global(&minted.token).await.unwrap().unwrap();
        assert_eq!(found.id, minted.id);
        assert!(found.token == minted.token);
        assert!(find_global(&other).await.unwrap().is_none());
        assert!(find_global(&generate_token()).await.unwrap().is_none());

        set_enabled(&org, &minted.name, false).await.unwrap();
        assert!(find_global(&minted.token).await.unwrap().is_none());
        let viewed = view_by_name(&org, &minted.name).await.unwrap().unwrap();
        assert!(!viewed.enabled);
        assert!(viewed.token == minted.token);
        assert!(view_by_name(&org, "unknown").await.unwrap().is_none());
        let listed = list_by_org(&org).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].token.is_empty());
        let metadata = get_by_name(&org, &minted.name).await.unwrap().unwrap();
        assert!(metadata.token.is_empty());
        cleanup(&org).await;
    }

    #[tokio::test]
    async fn readers_survive_blanked_plaintext_only_when_the_owned_value_exists() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_blanked");
        let minted = create_for_org(&org, "system").await.unwrap();
        let db = get_orm_client_rw().await;
        Entity::update_many()
            .col_expr(Column::Token, Expr::value(""))
            .filter(Column::Id.eq(&minted.id))
            .exec(db)
            .await
            .unwrap();
        invalidate_cache();
        let global = find_global(&minted.token).await;
        let default = find_default(&org).await;
        let viewed = view_by_name(&org, &minted.name).await;
        let listed = list_by_org(&org).await;
        let metadata = get_by_name(&org, &minted.name).await;

        Entity::update_many()
            .col_expr(Column::TokenRef, Expr::value(None::<String>))
            .filter(Column::Id.eq(&minted.id))
            .exec(db)
            .await
            .unwrap();
        invalidate_cache();
        let empty_default = find_default(&org).await;
        let empty_view = view_by_name(&org, &minted.name).await;
        cleanup(&org).await;

        for result in [global, default, viewed] {
            let record = result.unwrap().unwrap();
            assert_eq!(record.id, minted.id);
            assert!(record.token == minted.token);
        }
        let listed = listed.unwrap();
        assert_eq!(listed.len(), 1);
        assert!(listed[0].token.is_empty());
        assert!(metadata.unwrap().unwrap().token.is_empty());
        assert!(empty_default.is_err());
        assert!(empty_view.is_err());
    }

    #[tokio::test]
    async fn default_without_an_owned_reference_uses_legacy_plaintext() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_legacy");
        let (_, token) = insert_legacy(get_orm_client_rw().await, &org, "legacy", false).await;
        set_default(&org, "legacy").await.unwrap();
        let default = find_default(&org).await.unwrap().unwrap();
        assert!(default.token == token);
        cleanup(&org).await;
    }

    #[tokio::test]
    async fn missing_owned_credential_fails_closed_even_with_plaintext_present() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_missing");
        let minted = create_for_org(&org, "system").await.unwrap();
        credential_values::delete_by_owner(
            get_orm_client_rw().await,
            &org,
            OWNER_KIND_PROBE_TOKEN,
            &minted.id,
        )
        .await
        .unwrap();
        for result in [
            find_default(&org).await,
            view_by_name(&org, &minted.name).await,
        ] {
            let Err(error) = result else {
                panic!("expected an error for the missing owned credential");
            };
            let message = error.to_string();
            assert!(!message.contains(SYNTHETICS_PROBE_TOKEN_PREFIX));
            assert!(!message.contains(&token_sha256(&minted.token)));
        }
        cleanup(&org).await;
    }

    #[tokio::test]
    async fn add_and_org_creation_store_the_hash_and_lookup_by_value_still_works() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk");
        let minted = create_for_org(&org, "system").await.unwrap();
        let named = SyntheticsProbeTokenRecord {
            id: config::ider::ksuid(),
            name: "ci".to_string(),
            token: generate_token(),
            is_default: false,
            ..minted.clone()
        };
        add(&named).await.unwrap();
        for record in [&minted, &named] {
            let owned = assert_owned(&org, &record.id, &record.token).await;
            let found = find_global(&record.token).await.unwrap().unwrap();
            assert_eq!(found.id, record.id);
            let hash = token_sha256(&record.token);
            for (token_id, token_sha256) in [
                ("different-id", hash.as_str()),
                (record.id.as_str(), "different-hash"),
            ] {
                let slot = SlotClass::ProbeToken(ProbeTokenAd {
                    org_id: &org,
                    token_id,
                    secret_ref: &owned.secret_ref,
                    token_sha256,
                });
                assert!(
                    credential_values::decrypt_model(owned.clone(), &slot)
                        .await
                        .is_err()
                );
            }
        }
        cleanup(&org).await;
    }

    #[tokio::test]
    async fn duplicate_name_does_not_leave_an_orphaned_credential() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_duplicate");
        let first = create_for_org(&org, "system").await.unwrap();
        let duplicate = SyntheticsProbeTokenRecord {
            id: config::ider::ksuid(),
            token: generate_token(),
            ..first
        };
        let error = add(&duplicate).await.unwrap_err().to_string();
        assert!(error.contains("probe token 'default' already exists in org"));
        let count = credentials::Entity::find()
            .filter(credentials::Column::OrgId.eq(&org))
            .count(get_orm_client_rw().await)
            .await
            .unwrap();
        assert_eq!(count, 1);
        cleanup(&org).await;
    }

    #[tokio::test]
    async fn concurrent_and_repeated_repairs_preserve_each_legacy_token_and_credential() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_repair");
        let db = get_orm_client_rw().await;
        let missing_hash = create_for_org(&org, "system").await.unwrap();
        let existing = assert_owned(&org, &missing_hash.id, &missing_hash.token).await;
        Entity::update_many()
            .col_expr(Column::TokenSha256, Expr::value(""))
            .filter(Column::Id.eq(&missing_hash.id))
            .exec(db)
            .await
            .unwrap();
        let legacy = [
            insert_legacy(db, &org, "late", false).await,
            insert_legacy(db, &org, "late-2", false).await,
            insert_legacy(db, &org, "hashed", true).await,
        ];
        for (id, token) in &legacy {
            let found = find_global(token).await.unwrap().unwrap();
            assert_eq!(found.id, *id);
            assert!(found.token == *token);
        }
        let (first, second) = tokio::join!(repair_owned_rows(db), repair_owned_rows(db));
        first.unwrap();
        second.unwrap();
        invalidate_cache();
        let repaired = assert_owned(&org, &missing_hash.id, &missing_hash.token).await;
        assert_eq!(repaired.id, existing.id);
        assert_eq!(repaired.secret_ref, existing.secret_ref);
        let mut owned_ids = Vec::new();
        for (id, token) in &legacy {
            owned_ids.push(assert_owned(&org, id, token).await.id);
            assert_eq!(find_global(token).await.unwrap().unwrap().id, *id);
        }
        repair_owned_rows(db).await.unwrap();
        for ((id, token), owned_id) in legacy.iter().zip(owned_ids) {
            assert_eq!(assert_owned(&org, id, token).await.id, owned_id);
        }
        cleanup(&org).await;
    }

    #[tokio::test]
    async fn failed_credential_insert_rolls_back_only_its_probe_update() {
        if !meta_store().await {
            return;
        }
        let org = unique("ptk_rollback");
        let mut options = ConnectOptions::new("sqlite::memory:");
        options.max_connections(1);
        let db = Database::connect(options).await.unwrap();
        let backend = db.get_database_backend();
        let schema = Schema::new(backend);
        for table in [
            schema.create_table_from_entity(Entity),
            schema.create_table_from_entity(credentials::Entity),
        ] {
            db.execute(backend.build(&table)).await.unwrap();
        }
        db.execute_unprepared(
            "CREATE TRIGGER refuse_first BEFORE INSERT ON credential_values
             WHEN NEW.owner_id = (SELECT MIN(id) FROM synthetics_probe_tokens)
             BEGIN SELECT RAISE(ABORT, 'credential insert refused'); END",
        )
        .await
        .unwrap();
        let mut probes = [
            insert_legacy(&db, &org, "one", false).await,
            insert_legacy(&db, &org, "two", false).await,
        ];
        probes.sort_by(|a, b| a.0.cmp(&b.0));
        let [(failed_id, _), (repaired_id, token)] = probes;
        let result = repair_owned_rows(&db).await.unwrap();
        assert_eq!((result.failed, result.repaired), (1, 1));
        let failed = Entity::find_by_id(failed_id)
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert!(failed.token_sha256.is_empty());
        assert!(failed.token_ref.is_none());
        let repaired = Entity::find_by_id(repaired_id.as_str())
            .one(&db)
            .await
            .unwrap()
            .unwrap();
        assert!(repaired.token_sha256 == token_sha256(&token));
        let owned = credentials::Entity::find().all(&db).await.unwrap();
        assert_eq!(owned.len(), 1);
        assert_eq!(owned[0].owner_id, repaired_id);
        assert_eq!(repaired.token_ref.as_ref(), Some(&owned[0].secret_ref));
        cleanup(&org).await;
    }
}
