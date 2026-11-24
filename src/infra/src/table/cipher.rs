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
    collections::{BTreeMap, HashMap},
    sync::OnceLock,
    time::Duration,
};

use aes_siv::{KeyInit, siv::Aes256Siv};
use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    cluster::LOCAL_NODE,
    meta::{
        cluster::{Node, NodeStatus},
        secret_store::{SecretErrorCode, length_prefixed},
    },
    utils::{
        encryption::{Algorithm, SECRET_PREFIX, decode_encryption_key},
        rand::random_bytes,
        time::now_micros,
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, PaginatorTrait, QueryFilter, QueryOrder,
    QuerySelect, Set, SqlErr, TransactionTrait,
    sea_query::{Alias, Expr, Func, SimpleExpr},
};
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use super::{entity::cipher_keys::*, ttl_cache::TtlCache};
use crate::{
    cluster,
    db::{get_coordinator, get_orm_client_ro, get_orm_client_rw},
    dist_lock, errors,
    secret_store::capability::{self, CapabilityRecord},
};

pub const CIPHER_KEY_PREFIX: &str = "/cipher_keys/";
pub const DEFAULT_DEK_NAME: &str = "__default__";
pub const WRAP_V2_PREFIX: &str = "o2w2:";

const DEK_CACHE_TTL: Duration = Duration::from_secs(300);
const DEK_SWEEP_PERIOD: Duration = Duration::from_secs(30);
static DEK_CACHE: TtlCache<Zeroizing<Vec<u8>>> = TtlCache::new(DEK_CACHE_TTL);
static MASTER_KEY: OnceLock<KeyState> = OnceLock::new();
static WRAP_FLOOR: OnceLock<WrapFloor> = OnceLock::new();

const NO_KEY_WARNING: &str = "O2_MASTER_ENCRYPTION_KEY is not set: cipher keys are stored base64-encoded only, readable by anyone with database access";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntryKind {
    CipherKey,
}

impl EntryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::CipherKey => "cipher_key",
        }
    }
}

impl std::fmt::Display for EntryKind {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
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

/// How key rows are stored: wrapped under the master key (`Aes`) or base64 only (`None`).
pub enum MasterKeyMode {
    Aes(Vec<u8>),
    None,
}

impl MasterKeyMode {
    fn name(&self) -> &'static str {
        match self {
            Self::Aes(_) => "AES",
            Self::None => "None",
        }
    }
}

/// What the stored rows and the configured key disagree on; it turns stored secrets off.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum KeyProblem {
    WrappedRowsButNoKey { count: usize },
    WrongKey { org: String, name: String },
}

impl std::fmt::Display for KeyProblem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::WrappedRowsButNoKey { count } => write!(
                f,
                "{count} cipher key row(s) are wrapped by a master key but O2_MASTER_ENCRYPTION_KEY is unset"
            ),
            Self::WrongKey { org, name } => write!(
                f,
                "cipher key '{name}' (org={org}) does not unwrap with O2_MASTER_ENCRYPTION_KEY; nothing was written"
            ),
        }
    }
}

/// The process's installed key state: a mode, or a problem that turns stored secrets off.
pub type KeyState = Result<MasterKeyMode, KeyProblem>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WrapFloor {
    None,
    O2w2,
}

impl WrapFloor {
    pub fn parse(setting: &str) -> Result<Self, String> {
        match setting {
            "" => Ok(Self::None),
            "o2w2" => Ok(Self::O2w2),
            _ => Err(format!("invalid cipher wrap floor {setting:?}")),
        }
    }
}

struct WrapId<'a> {
    org: &'a str,
    kind: &'a str,
    name: &'a str,
    is_system: bool,
}

impl WrapId<'_> {
    fn ad(&self) -> Vec<u8> {
        length_prefixed(&[
            self.org.as_bytes(),
            self.kind.as_bytes(),
            self.name.as_bytes(),
            if self.is_system { b"true" } else { b"false" },
        ])
    }

    fn refused(&self, reason: &str) -> errors::Error {
        log::error!(
            "[CRITICAL] cipher: refusing system key '{}' for org {}: {reason}",
            self.name,
            self.org
        );
        errors::Error::SecretStore(SecretErrorCode::DekUnwrappedRefused)
    }
}

impl<'a> From<&'a Model> for WrapId<'a> {
    fn from(row: &'a Model) -> Self {
        Self {
            org: &row.org,
            kind: &row.kind,
            name: &row.name,
            is_system: row.is_system,
        }
    }
}

impl<'a> From<&'a CipherEntry> for WrapId<'a> {
    fn from(entry: &'a CipherEntry) -> Self {
        Self {
            org: &entry.org,
            kind: entry.kind.as_str(),
            name: &entry.name,
            is_system: entry.is_system,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootReport {
    pub mode: &'static str,
    pub already_wrapped: usize,
    pub unprefixed: usize,
    pub migration: MigrationOutcome,
}

impl std::fmt::Display for BootReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "cipher master key: mode={} already_wrapped={} unprefixed={} migration={:?}",
            self.mode, self.already_wrapped, self.unprefixed, self.migration
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MigrationOutcome {
    NotRequested,
    NodesBehind(Vec<String>),
    Migrated(BTreeMap<String, usize>),
    Failed(String),
}

struct WrapMigration {
    per_org: BTreeMap<String, usize>,
}

pub fn wrap_floor() -> WrapFloor {
    WRAP_FLOOR.get().copied().unwrap_or(WrapFloor::None)
}

pub async fn add(entry: CipherEntry) -> Result<(), errors::Error> {
    let encrypted = wrap(
        master_key()?,
        wrap_floor(),
        &WrapId::from(&entry),
        &entry.data,
    )?;
    let record = ActiveModel {
        org: Set(entry.org),
        created_by: Set(entry.created_by),
        created_at: Set(entry.created_at),
        name: Set(entry.name),
        kind: Set(entry.kind.to_string()),
        data: Set(encrypted),
        is_system: Set(entry.is_system),
    };

    let client = get_orm_client_rw().await;
    match Entity::insert(record).exec(client).await {
        Ok(_) => {}
        Err(e) => match e.sql_err() {
            Some(SqlErr::UniqueConstraintViolation(_)) => {
                return Err(errors::Error::DbError(errors::DbError::UniqueViolation));
            }
            _ => {
                return Err(e.into());
            }
        },
    }

    Ok(())
}

/// Updates a user key; a row with `is_system = true` is never matched, whatever the entry says.
pub async fn update(entry: CipherEntry) -> Result<(), errors::Error> {
    let id = WrapId {
        is_system: false,
        ..WrapId::from(&entry)
    };
    let encrypted = wrap(master_key()?, wrap_floor(), &id, &entry.data)?;
    let client = get_orm_client_rw().await;
    Entity::update_many()
        .col_expr(Column::CreatedBy, Expr::value(entry.created_by))
        .col_expr(Column::CreatedAt, Expr::value(entry.created_at))
        .col_expr(Column::Data, Expr::value(encrypted))
        .filter(Column::Org.eq(entry.org))
        .filter(Column::Kind.eq(entry.kind.to_string()))
        .filter(Column::Name.eq(entry.name))
        .filter(Column::IsSystem.eq(false))
        .exec(client)
        .await?;

    Ok(())
}

/// Deletes a user key; the org DEK is a system row and only org teardown removes it.
pub async fn remove(org: &str, kind: EntryKind, name: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.eq(kind.to_string()))
        .filter(Column::Name.eq(name))
        .filter(Column::IsSystem.eq(false))
        .exec(client)
        .await?;

    Ok(())
}

pub async fn get_data(
    org: &str,
    kind: EntryKind,
    name: &str,
) -> Result<Option<String>, errors::Error> {
    let mode = master_key()?;
    get(org, kind, name)
        .await?
        .map(|m| unwrap(mode, wrap_floor(), &WrapId::from(&m), &m.data))
        .transpose()
}

pub async fn list_all(limit: Option<i64>) -> Result<Vec<CipherEntry>, errors::Error> {
    let mode = master_key()?;
    let client = get_orm_client_ro().await;
    let mut res = Entity::find().order_by(Column::CreatedAt, Order::Desc);
    if let Some(limit) = limit {
        res = res.limit(limit as u64);
    }
    let records = res.into_model::<Model>().all(client).await?;

    records
        .into_iter()
        .map(|row| unwrap_entry(mode, row))
        .collect()
}

pub async fn list_filtered(
    filter: ListFilter,
    limit: Option<i64>,
) -> Result<Vec<CipherEntry>, errors::Error> {
    let mode = master_key()?;
    let client = get_orm_client_ro().await;
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

    records
        .into_iter()
        .map(|row| unwrap_entry(mode, row))
        .collect()
}

/// Deletes the org's non-system entries of `kind` and returns their names, never decrypted.
pub async fn delete_non_system_by_org(
    org: &str,
    kind: EntryKind,
) -> Result<Vec<String>, errors::Error> {
    let client = get_orm_client_rw().await;
    let delete = Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.eq(kind.to_string()))
        .filter(Column::IsSystem.eq(false));
    Ok(super::delete_returning(client, delete, &[Column::Name]).await?)
}

pub async fn clear() -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
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
    if let Some(dek) = get_dek_row(org).await? {
        return Ok(dek);
    }
    refuse_user_row_named_dek(org).await?;

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
            match get_dek_row(org).await? {
                Some(dek) => Ok(dek),
                None => {
                    refuse_user_row_named_dek(org).await?;
                    Err(errors::Error::Message(format!(
                        "DEK for org {org} missing after race"
                    )))
                }
            }
        }
        Err(e) => Err(errors::Error::Message(format!(
            "failed to persist DEK for org {org}: {e}"
        ))),
    }
}

/// Returns the per-org DEK, using an in-memory cache with a 5-minute TTL to
/// avoid a database round-trip on every encryption/decryption operation.
/// The org's system DEK, from the cache or the system row; never creates one.
pub async fn get_existing_dek(org: &str) -> Result<Option<Vec<u8>>, errors::Error> {
    if let Some(dek) = DEK_CACHE.get(org) {
        return Ok(Some(dek.to_vec()));
    }
    get_existing_dek_in(get_orm_client_rw().await, org).await
}

/// The org's system DEK when this node has it cached; never reads the store.
pub fn cached_existing_dek(org: &str) -> Option<Zeroizing<Vec<u8>>> {
    DEK_CACHE.get(org)
}

/// Reads through the caller's primary connection so a transaction holding the SQLite writer
/// cannot wait on a second one. It never mints, so every row it caches was already committed.
pub async fn get_existing_dek_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Option<Vec<u8>>, errors::Error> {
    if let Some(dek) = DEK_CACHE.get(org) {
        return Ok(Some(dek.to_vec()));
    }
    let Some(dek) = get_dek_row_in(conn, org).await? else {
        return Ok(None);
    };
    cache_dek(org, &dek);
    Ok(Some(dek))
}

pub async fn get_dek(org: &str) -> Result<Vec<u8>, errors::Error> {
    if let Some(cached) = DEK_CACHE.get(org) {
        return Ok(cached.to_vec());
    }

    let dek = get_or_create_dek(org).await?;
    cache_dek(org, &dek);
    Ok(dek)
}

pub async fn encrypt_for_org(org: &str, plaintext: &str) -> Result<String, errors::Error> {
    let key = get_dek(org).await?;
    Algorithm::Aes256Siv
        .encrypt(&key, plaintext)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

/// Decrypts existing org data without provisioning a missing encryption key.
pub async fn decrypt_for_org(org: &str, ciphertext: &str) -> Result<String, errors::Error> {
    let key = get_existing_dek(org)
        .await?
        .ok_or_else(|| errors::Error::Message("the org has no encryption key".to_string()))?;
    Algorithm::Aes256Siv
        .decrypt(&key, ciphertext)
        .map_err(|e| errors::Error::Message(e.to_string()))
}

pub async fn has_org_key(org: &str) -> Result<bool, errors::Error> {
    Ok(get_existing_dek(org).await?.is_some())
}

/// Deletes all cipher key entries belonging to the given org, the system DEK included.
pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(client)
        .await?;
    DEK_CACHE.remove(org);
    Ok(())
}

/// Sets the key state once (mode or secrets off), from [`boot`]; a second call errors. [strong]
pub fn install_master_key(state: KeyState) -> Result<(), errors::Error> {
    MASTER_KEY
        .set(state)
        .map_err(|_| errors::Error::Message("cipher master key already installed".to_string()))
}

/// Returns the mode; errors before install or with secrets off. [no side effects; depends on B9-K1]
pub fn master_key() -> Result<&'static MasterKeyMode, errors::Error> {
    match MASTER_KEY.get() {
        Some(Ok(mode)) => Ok(mode),
        Some(Err(problem)) => Err(errors::Error::Message(format!(
            "stored secrets are off: {problem}"
        ))),
        None => Err(errors::Error::Message(
            "cipher master key not installed".to_string(),
        )),
    }
}

/// Says whether key rows are wrapped under a master key (AES mode installed). [no-fail]
pub fn is_encrypting() -> bool {
    encrypting(MASTER_KEY.get())
}

pub async fn boot(key_b64: Option<&str>) -> Result<(), errors::Error> {
    boot_with_wraps(key_b64, false, WrapFloor::None).await
}

pub async fn boot_with_wraps(
    key_b64: Option<&str>,
    migrate_wraps: bool,
    wrap_floor: WrapFloor,
) -> Result<(), errors::Error> {
    let mode = mode_from_setting(key_b64)?;
    if let Some(warning) = missing_key_warning(key_b64) {
        log::warn!("{warning}");
    }
    let older = migrate_wraps.then(nodes_blocking_wrap_migration);
    let outcome = boot_with(
        get_orm_client_rw().await,
        mode,
        wrap_floor,
        older,
        |state, floor| {
            install_master_key(state)?;
            WRAP_FLOOR
                .set(floor)
                .map_err(|_| errors::Error::Message("cipher wrap floor already installed".into()))
        },
        migrate_under_lock,
    )
    .await?;
    match outcome {
        Ok(report) => log::info!("{report}"),
        Err(problem) => log::error!("cipher master key: stored secrets are off: {problem}"),
    }
    Ok(())
}

/// Live nodes that may not read `o2w2:` wraps. A same-tag older build passes the version check,
/// so each other node must also report a fresh store capability. `None` when unknown.
async fn nodes_blocking_wrap_migration() -> Option<Vec<String>> {
    let mut blocking = cluster::live_nodes_below(config::VERSION).await?;
    let nodes = cluster::get_cached_nodes(|n| n.status != NodeStatus::Offline).await?;
    let records = match capability::list_records_in(get_coordinator().await.as_ref()).await {
        Ok(records) => records,
        Err(e) => {
            log::error!("[CRITICAL] cipher: could not read node capabilities: {e}");
            return None;
        }
    };
    blocking.extend(nodes_without_wrap_reader(
        &nodes,
        &records,
        &LOCAL_NODE.uuid,
        now_micros(),
    ));
    blocking.sort_unstable();
    blocking.dedup();
    Some(blocking)
}

fn nodes_without_wrap_reader(
    nodes: &[Node],
    records: &HashMap<String, CapabilityRecord>,
    own_uuid: &str,
    now_us: i64,
) -> Vec<String> {
    nodes
        .iter()
        .filter(|node| node.uuid != own_uuid)
        .filter(|node| {
            !records.get(&node.uuid).is_some_and(|record| {
                record.level >= capability::LEVEL_STORE && capability::is_fresh(record, now_us)
            })
        })
        .map(|node| node.name.clone())
        .collect()
}

pub async fn count_unprefixed_rows() -> Result<u64, errors::Error> {
    count_unprefixed_rows_in(get_orm_client_ro().await).await
}

pub async fn count_aesenc_system_rows() -> Result<u64, errors::Error> {
    count_aesenc_system_rows_in(get_orm_client_ro().await).await
}

async fn get(org: &str, kind: EntryKind, name: &str) -> Result<Option<Model>, errors::DbError> {
    let client = get_orm_client_ro().await;
    Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Name.eq(name))
        .filter(Column::Kind.eq(kind.to_string()))
        .into_model::<Model>()
        .one(client)
        .await
        .map_err(|e| errors::DbError::SeaORMError(e.to_string()))
}

fn unwrap_entry(mode: &MasterKeyMode, mut row: Model) -> Result<CipherEntry, errors::Error> {
    row.data = unwrap(mode, wrap_floor(), &WrapId::from(&row), &row.data)?;
    row.try_into()
}

async fn get_dek_row(org: &str) -> Result<Option<Vec<u8>>, errors::Error> {
    get_dek_row_in(get_orm_client_rw().await, org).await
}

/// Reads `__default__` only as a system row, so a user key never acts as a DEK.
async fn get_dek_row_in<C: ConnectionTrait>(
    conn: &C,
    org: &str,
) -> Result<Option<Vec<u8>>, errors::Error> {
    let mode = master_key()?;
    let row = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.eq(EntryKind::CipherKey.to_string()))
        .filter(Column::Name.eq(DEFAULT_DEK_NAME))
        .filter(Column::IsSystem.eq(true))
        .into_model::<Model>()
        .one(conn)
        .await?;
    let Some(row) = row else {
        return Ok(None);
    };
    let b64 = unwrap(mode, wrap_floor(), &WrapId::from(&row), &row.data)?;
    BASE64_STANDARD
        .decode(b64)
        .map(Some)
        .map_err(|e| errors::Error::Message(format!("failed to decode DEK for org {org}: {e}")))
}

fn cache_dek(org: &str, dek: &[u8]) {
    DEK_CACHE.sweep_in_background(DEK_SWEEP_PERIOD);
    DEK_CACHE.insert(org.to_string(), Zeroizing::new(dek.to_vec()));
}

#[cfg(test)]
pub(crate) fn forget_cached_dek(org: &str) {
    DEK_CACHE.remove(org);
}

#[cfg(test)]
pub(crate) fn cache_dek_for_tests(org: &str, dek: Vec<u8>) {
    cache_dek(org, &dek);
}

/// A user row holding the DEK's name blocks the DEK's insert; minting would loop on the conflict.
async fn refuse_user_row_named_dek(org: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    let taken = Entity::find()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.eq(EntryKind::CipherKey.to_string()))
        .filter(Column::Name.eq(DEFAULT_DEK_NAME))
        .filter(Column::IsSystem.eq(false))
        .one(client)
        .await?
        .is_some();
    if taken {
        log::error!(
            "[CRITICAL] cipher: org {org} has a user key named {DEFAULT_DEK_NAME}, so no DEK can be created; rename that key"
        );
        return Err(errors::Error::SecretStore(SecretErrorCode::DekNameTaken));
    }
    Ok(())
}

/// Builds the mode from the master-key setting; absent or empty means no key. [pure]
fn mode_from_setting(key_b64: Option<&str>) -> Result<MasterKeyMode, errors::Error> {
    match key_b64 {
        None | Some("") => Ok(MasterKeyMode::None),
        Some(key) => decode_encryption_key(key)
            .map(MasterKeyMode::Aes)
            .map_err(errors::Error::Message),
    }
}

/// The warning for an empty setting; only enterprise builds pass the setting at all. [pure]
fn missing_key_warning(key_b64: Option<&str>) -> Option<&'static str> {
    matches!(key_b64, Some("")).then_some(NO_KEY_WARNING)
}

fn encrypting(state: Option<&KeyState>) -> bool {
    matches!(state, Some(Ok(MasterKeyMode::Aes(_))))
}

fn wrap(
    mode: &MasterKeyMode,
    floor: WrapFloor,
    id: &WrapId<'_>,
    plaintext: &str,
) -> Result<String, errors::Error> {
    let stored = match mode {
        MasterKeyMode::Aes(key) if floor == WrapFloor::O2w2 => return wrap_v2(key, id, plaintext),
        MasterKeyMode::Aes(key) => Algorithm::Aes256Siv
            .encrypt(key, plaintext)
            .map(|sealed| format!("{SECRET_PREFIX}{sealed}")),
        MasterKeyMode::None => Algorithm::None.encrypt(&[], plaintext),
    };
    stored.map_err(|e| errors::Error::Message(e.to_string()))
}

fn wrap_v2(key: &[u8], id: &WrapId<'_>, plaintext: &str) -> Result<String, errors::Error> {
    let mut cipher = Aes256Siv::new_from_slice(key)
        .map_err(|_| errors::Error::Message("invalid cipher master key".into()))?;
    let sealed = cipher
        .encrypt([id.ad()], plaintext.as_bytes())
        .map_err(|_| errors::Error::Message("sealing cipher key failed".into()))?;
    Ok(format!(
        "{WRAP_V2_PREFIX}{}",
        BASE64_STANDARD.encode(sealed)
    ))
}

fn open_v2(key: &[u8], id: &WrapId<'_>, body: &str) -> Result<String, errors::Error> {
    let refused = || {
        errors::Error::Message(format!(
            "cipher key '{}' (org={}) failed o2w2 authentication",
            id.name, id.org
        ))
    };
    let sealed = BASE64_STANDARD.decode(body).map_err(|_| refused())?;
    let mut cipher = Aes256Siv::new_from_slice(key).map_err(|_| refused())?;
    let plaintext = cipher.decrypt([id.ad()], &sealed).map_err(|_| refused())?;
    String::from_utf8(plaintext).map_err(|_| refused())
}

fn unwrap(
    mode: &MasterKeyMode,
    floor: WrapFloor,
    id: &WrapId<'_>,
    stored: &str,
) -> Result<String, errors::Error> {
    let org = id.org;
    let name = id.name;
    let strict = id.is_system && floor == WrapFloor::O2w2 && matches!(mode, MasterKeyMode::Aes(_));
    let bound = stored.strip_prefix(WRAP_V2_PREFIX);
    if strict && bound.is_none() {
        return Err(id.refused("o2w2 wrap required"));
    }
    let Some(body) = bound.or_else(|| stored.strip_prefix(SECRET_PREFIX)) else {
        return Algorithm::None.decrypt(&[], stored).map_err(|e| {
            errors::Error::Message(format!(
                "cipher key '{name}' (org={org}) is unreadable: {e}"
            ))
        });
    };
    let MasterKeyMode::Aes(key) = mode else {
        return Err(errors::Error::Message(format!(
            "cipher key '{name}' (org={org}): row wrapped by a master key but O2_MASTER_ENCRYPTION_KEY is unset"
        )));
    };
    if bound.is_some() {
        return open_v2(key, id, body).map_err(|e| {
            if strict {
                id.refused("o2w2 authentication failed")
            } else {
                e
            }
        });
    }
    Algorithm::Aes256Siv.decrypt(key, body).map_err(|e| {
        errors::Error::Message(format!(
            "cipher key '{name}' (org={org}) does not unwrap with the master key: {e}"
        ))
    })
}

fn is_wrapped(data: &str) -> bool {
    data.starts_with(SECRET_PREFIX) || data.starts_with(WRAP_V2_PREFIX)
}

fn plan_boot(mode: &MasterKeyMode, rows: &[Model]) -> Result<BootReport, KeyProblem> {
    let wrapped = rows.iter().filter(|row| is_wrapped(&row.data));
    let count = wrapped.clone().count();
    match mode {
        MasterKeyMode::None if count > 0 => return Err(KeyProblem::WrappedRowsButNoKey { count }),
        MasterKeyMode::None => {}
        MasterKeyMode::Aes(_) => {
            for row in wrapped {
                // The floor applies to consumers; a legacy system row cannot disable other orgs at
                // boot.
                unwrap(mode, WrapFloor::None, &WrapId::from(row), &row.data).map_err(|_| {
                    KeyProblem::WrongKey {
                        org: row.org.clone(),
                        name: row.name.clone(),
                    }
                })?;
            }
        }
    }
    Ok(BootReport {
        mode: mode.name(),
        already_wrapped: count,
        unprefixed: rows.len() - count,
        migration: MigrationOutcome::NotRequested,
    })
}

async fn boot_with<C: ConnectionTrait>(
    conn: &C,
    mode: MasterKeyMode,
    floor: WrapFloor,
    older: Option<impl Future<Output = Option<Vec<String>>>>,
    install: impl FnOnce(KeyState, WrapFloor) -> Result<(), errors::Error>,
    migrate: impl AsyncFnOnce(&C, &[u8]) -> Result<WrapMigration, errors::Error>,
) -> Result<Result<BootReport, KeyProblem>, errors::Error> {
    let mut report = match plan_boot(&mode, &Entity::find().all(conn).await?) {
        Ok(report) => report,
        Err(problem) => {
            install(Err(problem.clone()), floor)?;
            return Ok(Err(problem));
        }
    };
    let MasterKeyMode::Aes(key) = &mode else {
        install(Ok(mode), floor)?;
        return Ok(Ok(report));
    };
    let migration = older.map(|nodes| (nodes, key.clone()));
    install(Ok(mode), floor)?;
    if let Some((nodes, key)) = migration {
        report.migration = match nodes.await {
            Some(older) if older.is_empty() => migration_outcome(migrate(conn, &key).await),
            older => {
                let older = older.unwrap_or_default();
                let reason = if older.is_empty() {
                    "node registry is empty".into()
                } else {
                    older.join(", ")
                };
                log::error!("[CRITICAL] cipher: wrap migration skipped: {reason}");
                MigrationOutcome::NodesBehind(older)
            }
        };
    }
    match count_unprefixed_rows_in(conn).await {
        Ok(0) => {}
        Ok(count) => log::error!("[CRITICAL] cipher: {count} unprefixed key row(s) remain"),
        Err(e) => {
            log::error!("[CRITICAL] cipher: could not count remaining unprefixed key rows: {e}")
        }
    }
    Ok(Ok(report))
}

fn migration_outcome(result: Result<WrapMigration, errors::Error>) -> MigrationOutcome {
    match result {
        Ok(migration) => {
            let count: usize = migration.per_org.values().sum();
            log::error!(
                "[CRITICAL] cipher: migrated {count} row(s), per org: {:?}",
                migration.per_org
            );
            MigrationOutcome::Migrated(migration.per_org)
        }
        Err(e) => {
            log::error!("[CRITICAL] cipher: wrap migration failed: {e}");
            MigrationOutcome::Failed(e.to_string())
        }
    }
}

async fn migrate_under_lock<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    key: &[u8],
) -> Result<WrapMigration, errors::Error> {
    let lock = dist_lock::lock("/secret_store/cipher_wraps", 0).await?;
    let result = migrate_wraps_in(conn, key).await;
    if let Err(e) = dist_lock::unlock(&lock).await {
        // A release failure cannot reverse an already committed migration.
        log::error!("[CRITICAL] cipher: failed to release wrap migration lock: {e}");
    }
    result
}

async fn migrate_wraps_in<C: ConnectionTrait + TransactionTrait>(
    conn: &C,
    key: &[u8],
) -> Result<WrapMigration, errors::Error> {
    let txn = conn.begin().await?;
    match migrate_rows(&txn, key).await {
        Ok(report) => {
            txn.commit().await?;
            Ok(report)
        }
        Err(e) => {
            txn.rollback().await?;
            Err(e)
        }
    }
}

async fn migrate_rows<C: ConnectionTrait>(
    conn: &C,
    key: &[u8],
) -> Result<WrapMigration, errors::Error> {
    let mode = MasterKeyMode::Aes(key.to_vec());
    let mut per_org = BTreeMap::new();
    for row in Entity::find().all(conn).await? {
        if row.data.starts_with(WRAP_V2_PREFIX)
            || (!row.is_system && row.data.starts_with(SECRET_PREFIX))
        {
            continue;
        }
        let id = WrapId::from(&row);
        let plaintext = unwrap(&mode, WrapFloor::None, &id, &row.data)?;
        let data = wrap_v2(key, &id, &plaintext)?;
        let update = Entity::update_many()
            .col_expr(Column::Data, Expr::value(data))
            .filter(Column::Org.eq(&row.org))
            .filter(Column::Kind.eq(&row.kind))
            .filter(Column::Name.eq(&row.name))
            .filter(Column::IsSystem.eq(row.is_system))
            .filter(Column::Data.eq(&row.data))
            .exec(conn)
            .await?;
        if update.rows_affected != 1 {
            return Err(errors::Error::Message(format!(
                "cipher key '{}' (org={}) changed during wrap migration",
                row.name, row.org
            )));
        }
        *per_org.entry(row.org).or_default() += 1;
    }
    for row in Entity::find().all(conn).await? {
        if !is_wrapped(&row.data) {
            return Err(errors::Error::Message(format!(
                "unprefixed cipher key '{}' (org={}) after migration",
                row.name, row.org
            )));
        }
        unwrap(&mode, WrapFloor::O2w2, &WrapId::from(&row), &row.data)?;
    }
    Ok(WrapMigration { per_org })
}

// SQLite LIKE folds case, whereas the wire prefixes are byte-exact on every backend.
fn has_prefix(prefix: &'static str) -> SimpleExpr {
    Expr::expr(
        Func::cust(Alias::new("substr"))
            .arg(Expr::col(Column::Data))
            .arg(1)
            .arg(prefix.len() as i32),
    )
    .eq(prefix)
}

async fn count_unprefixed_rows_in<C: ConnectionTrait>(conn: &C) -> Result<u64, errors::Error> {
    Ok(Entity::find()
        .filter(has_prefix(SECRET_PREFIX).not())
        .filter(has_prefix(WRAP_V2_PREFIX).not())
        .count(conn)
        .await?)
}

async fn count_aesenc_system_rows_in<C: ConnectionTrait>(conn: &C) -> Result<u64, errors::Error> {
    Ok(Entity::find()
        .filter(Column::IsSystem.eq(true))
        .filter(has_prefix(SECRET_PREFIX))
        .count(conn)
        .await?)
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::utils::encryption::{decrypt_secret_value, encrypt_secret_value};
    use sea_orm::{ActiveModelTrait, ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

    #[test]
    fn caching_a_dek_starts_the_expiry_sweep() {
        cache_dek_for_tests("t15_sweep", vec![9; 32]);
        assert!(DEK_CACHE.is_sweeping());
        forget_cached_dek("t15_sweep");
    }

    fn aes(byte: u8) -> MasterKeyMode {
        MasterKeyMode::Aes(vec![byte; 64])
    }

    fn row(org: &str, name: &str, data: String) -> Model {
        Model {
            org: org.to_string(),
            created_by: "system".to_string(),
            created_at: 1,
            name: name.to_string(),
            kind: EntryKind::CipherKey.to_string(),
            data,
            is_system: name == DEFAULT_DEK_NAME,
        }
    }

    // One connection, or every query would see its own empty in-memory database.
    async fn db() -> DatabaseConnection {
        let mut opts = ConnectOptions::new("sqlite::memory:".to_string());
        opts.max_connections(1);
        let db = Database::connect(opts).await.unwrap();
        let backend = db.get_database_backend();
        db.execute(backend.build(&Schema::new(backend).create_table_from_entity(Entity)))
            .await
            .unwrap();
        db
    }

    async fn seed(db: &DatabaseConnection, rows: Vec<Model>) {
        for r in rows {
            ActiveModel::from(r).insert(db).await.unwrap();
        }
    }

    async fn stored(db: &DatabaseConnection) -> Vec<Model> {
        Entity::find()
            .order_by_asc(Column::Org)
            .order_by_asc(Column::Name)
            .order_by_asc(Column::Kind)
            .all(db)
            .await
            .unwrap()
    }

    fn legacy(plaintext: &str) -> String {
        BASE64_STANDARD.encode(plaintext)
    }

    fn aesenc(plaintext: &str) -> String {
        let body = Algorithm::Aes256Siv.encrypt(&[1u8; 64], plaintext).unwrap();
        format!("{SECRET_PREFIX}{body}")
    }

    fn bound_row(org: &str, name: &str, plaintext: &str) -> Model {
        let mut row = row(org, name, String::new());
        row.data = wrap(&aes(1), WrapFloor::O2w2, &WrapId::from(&row), plaintext).unwrap();
        row
    }

    fn mixed_rows() -> Vec<Model> {
        vec![
            row("alpha", "user", legacy("user-key")),
            row("alpha", "akeyless", legacy(r#"{"access_id":"id"}"#)),
            row("beta", "ldap", legacy(r#"{"bind_password":"pass"}"#)),
            row("alpha", DEFAULT_DEK_NAME, legacy("dek-a")),
            row("beta", DEFAULT_DEK_NAME, legacy("dek-b")),
            row("gamma", DEFAULT_DEK_NAME, aesenc("dek-c")),
        ]
    }

    fn read(row: &Model, floor: WrapFloor) -> Result<String, errors::Error> {
        unwrap(&aes(1), floor, &WrapId::from(row), &row.data)
    }

    fn assert_dek_refused(row: &Model) {
        assert!(matches!(
            read(row, WrapFloor::O2w2),
            Err(errors::Error::SecretStore(
                SecretErrorCode::DekUnwrappedRefused
            ))
        ));
    }

    type Installed = Option<Result<&'static str, KeyProblem>>;

    // Boots against `db` with a local installer so the process-global state stays untouched.
    async fn boot_db(
        db: &DatabaseConnection,
        mode: MasterKeyMode,
        migrate: bool,
        floor: WrapFloor,
        older: Option<Vec<String>>,
    ) -> (
        Result<Result<BootReport, KeyProblem>, errors::Error>,
        Installed,
    ) {
        let mut installed = None;
        let outcome = boot_with(
            db,
            mode,
            floor,
            migrate.then(|| std::future::ready(older)),
            |state, _floor| {
                installed = Some(state.map(|m| m.name()));
                Ok(())
            },
            migrate_wraps_in,
        )
        .await;
        (outcome, installed)
    }

    async fn flagged_boot(db: &DatabaseConnection) -> BootReport {
        let (outcome, installed) = boot_db(db, aes(1), true, WrapFloor::O2w2, Some(vec![])).await;
        assert_eq!(installed, Some(Ok("AES")));
        outcome.unwrap().unwrap()
    }

    // The only test touching the process-global state, so install order cannot race.
    #[tokio::test]
    async fn b9_r2_r3_r16_install_is_once_and_required() {
        assert!(!is_encrypting());
        let err = master_key().err().unwrap().to_string();
        assert!(err.contains("cipher master key not installed"), "{err}");
        let err = get_data("org1", EntryKind::CipherKey, "k")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("not installed"), "{err}");
        let entry = CipherEntry {
            org: "org1".to_string(),
            created_at: 1,
            created_by: "a".to_string(),
            name: "k".to_string(),
            data: "v".to_string(),
            kind: EntryKind::CipherKey,
            is_system: false,
        };
        let err = add(entry.clone()).await.unwrap_err();
        assert!(err.to_string().contains("not installed"), "{err}");

        let problem = KeyProblem::WrongKey {
            org: "o".to_string(),
            name: "n".to_string(),
        };
        install_master_key(Err(problem.clone())).unwrap();
        assert!(install_master_key(Ok(aes(1))).is_err());
        let err = master_key().err().unwrap().to_string();
        assert!(
            err.contains(&problem.to_string()),
            "a refused second install leaves secrets off: {err}"
        );
        let err = get_data("org1", EntryKind::CipherKey, "k")
            .await
            .unwrap_err();
        assert!(err.to_string().contains(&problem.to_string()), "{err}");
        let err = add(entry).await.unwrap_err();
        assert!(err.to_string().contains(&problem.to_string()), "{err}");
        assert!(!is_encrypting());
    }

    #[test]
    fn b9_r1_the_key_setting_picks_the_mode() {
        let key = BASE64_STANDARD.encode([7u8; 64]);
        assert!(matches!(mode_from_setting(None), Ok(MasterKeyMode::None)));
        assert!(matches!(
            mode_from_setting(Some("")),
            Ok(MasterKeyMode::None)
        ));
        assert!(
            matches!(mode_from_setting(Some(&key)), Ok(MasterKeyMode::Aes(k)) if k == vec![7u8; 64])
        );
        assert!(mode_from_setting(Some("not-base64!!")).is_err());
    }

    #[test]
    fn b9_r15_only_an_enterprise_boot_without_a_key_warns() {
        let key = BASE64_STANDARD.encode([7u8; 64]);
        assert!(missing_key_warning(Some("")).is_some());
        assert!(missing_key_warning(Some(&key)).is_none());
        assert!(missing_key_warning(None).is_none());
    }

    #[test]
    fn b9_r16_encrypting_only_in_aes_mode() {
        let (on, off) = (Ok(aes(1)), Ok(MasterKeyMode::None));
        let secrets_off = Err(KeyProblem::WrappedRowsButNoKey { count: 1 });
        for (state, expected) in [
            (Some(&on), true),
            (Some(&off), false),
            (Some(&secrets_off), false),
            (None, false),
        ] {
            assert_eq!(encrypting(state), expected);
        }
    }

    #[test]
    fn d225_writer_uses_the_configured_floor_only_with_a_key() {
        let key = aes(1);
        let row = row("org", DEFAULT_DEK_NAME, String::new());
        let id = WrapId::from(&row);
        assert_eq!(
            wrap(&key, WrapFloor::None, &id, "dek").unwrap(),
            aesenc("dek")
        );
        let bound = wrap(&key, WrapFloor::O2w2, &id, "dek").unwrap();
        // An independent OpenSSL vector pins the stored format across releases.
        assert_eq!(bound, "o2w2:eGFjaDClYt8CPD5I7A6FtRLNjA==");
        for floor in [WrapFloor::None, WrapFloor::O2w2] {
            let encoded = wrap(&MasterKeyMode::None, floor, &id, "dek").unwrap();
            assert_eq!(encoded, legacy("dek"));
            assert_eq!(
                unwrap(&MasterKeyMode::None, floor, &id, &encoded).unwrap(),
                "dek"
            );
            assert_eq!(unwrap(&key, floor, &id, &bound).unwrap(), "dek");
        }
    }

    #[test]
    fn t14_a_same_tag_node_without_a_store_capability_blocks_wrap_migration() {
        let node = |uuid: &str| Node {
            uuid: uuid.into(),
            name: format!("node-{uuid}"),
            version: config::VERSION.into(),
            ..Default::default()
        };
        let nodes = [node("self"), node("old"), node("stale"), node("new")];
        let now = 1_000_000_000;
        let record = |level, renewed_at| CapabilityRecord {
            level,
            binary_version: config::VERSION.into(),
            booted_at: 1,
            refs_enabled: false,
            fga_mode: capability::FgaMode::Off,
            renewed_at,
        };
        let records = HashMap::from([
            ("stale".to_string(), record(capability::LEVEL_STORE, 1)),
            ("new".to_string(), record(capability::NODE_LEVEL, now)),
        ]);
        assert_eq!(
            nodes_without_wrap_reader(&nodes, &records, "self", now),
            vec!["node-old".to_string(), "node-stale".to_string()]
        );
    }

    #[test]
    fn d225_wrap_floor_accepts_only_the_two_config_values() {
        assert_eq!(WrapFloor::parse(""), Ok(WrapFloor::None));
        assert_eq!(WrapFloor::parse("o2w2"), Ok(WrapFloor::O2w2));
        for invalid in ["AESenc", "O2W2", "o2w2:", " o2w2"] {
            assert!(WrapFloor::parse(invalid).is_err());
        }
    }

    #[test]
    fn d225_o2w2_authenticates_each_identity_field() {
        let original = bound_row("alpha", DEFAULT_DEK_NAME, "dek");
        for changed in [
            Model {
                org: "beta".into(),
                ..original.clone()
            },
            Model {
                name: "user".into(),
                ..original.clone()
            },
            Model {
                kind: "another_kind".into(),
                ..original.clone()
            },
            Model {
                is_system: false,
                ..original.clone()
            },
        ] {
            assert!(read(&changed, WrapFloor::None).is_err());
        }
    }

    #[test]
    fn d225_system_floor_requires_an_authenticated_o2w2_dek() {
        let bound = bound_row("alpha", DEFAULT_DEK_NAME, "dek");
        assert_eq!(read(&bound, WrapFloor::O2w2).unwrap(), "dek");
        let old = row("alpha", DEFAULT_DEK_NAME, aesenc("dek"));
        assert_eq!(read(&old, WrapFloor::None).unwrap(), "dek");
        assert_dek_refused(&old);
        assert_dek_refused(&row("alpha", DEFAULT_DEK_NAME, legacy("dek")));
        assert_dek_refused(&Model {
            org: "beta".into(),
            ..bound
        });
        assert_eq!(
            read(&row("alpha", "user", aesenc("key")), WrapFloor::O2w2).unwrap(),
            "key"
        );
    }

    #[test]
    fn b9_r6_r7_both_wraps_refuse_reads_without_a_master_key() {
        for row in [
            bound_row("alpha", DEFAULT_DEK_NAME, "dek"),
            row("alpha", DEFAULT_DEK_NAME, aesenc("dek")),
        ] {
            let err = unwrap(
                &MasterKeyMode::None,
                WrapFloor::None,
                &WrapId::from(&row),
                &row.data,
            )
            .unwrap_err()
            .to_string();
            assert!(err.contains("O2_MASTER_ENCRYPTION_KEY is unset"), "{err}");
        }
    }

    #[tokio::test]
    async fn d225_unflagged_aes_boot_preserves_every_row() {
        let db = db().await;
        seed(&db, mixed_rows()).await;
        let before = stored(&db).await;
        let (outcome, installed) = boot_db(&db, aes(1), false, WrapFloor::None, None).await;
        assert_eq!(installed, Some(Ok("AES")));
        assert_eq!(
            outcome.unwrap().unwrap(),
            BootReport {
                mode: "AES",
                already_wrapped: 1,
                unprefixed: 5,
                migration: MigrationOutcome::NotRequested,
            }
        );
        let after = stored(&db).await;
        assert_eq!(after, before);
        let values: Vec<_> = after
            .iter()
            .map(|r| read(r, WrapFloor::None).unwrap())
            .collect();
        assert_eq!(
            values,
            [
                "dek-a",
                r#"{"access_id":"id"}"#,
                "user-key",
                "dek-b",
                r#"{"bind_password":"pass"}"#,
                "dek-c"
            ]
        );
    }

    #[tokio::test]
    async fn d225_flagged_boot_with_an_older_node_migrates_nothing() {
        let db = db().await;
        seed(&db, mixed_rows()).await;
        let before = stored(&db).await;
        let older = vec!["node-a".to_string()];
        let (outcome, installed) =
            boot_db(&db, aes(1), true, WrapFloor::O2w2, Some(older.clone())).await;
        assert_eq!(installed, Some(Ok("AES")));
        assert_eq!(
            outcome.unwrap().unwrap().migration,
            MigrationOutcome::NodesBehind(older)
        );
        assert_eq!(stored(&db).await, before);
        let (outcome, _) = boot_db(&db, aes(1), true, WrapFloor::None, None).await;
        assert!(matches!(
            outcome.unwrap().unwrap().migration,
            MigrationOutcome::NodesBehind(_)
        ));
        assert_eq!(stored(&db).await, before);
    }

    #[tokio::test]
    async fn d225_flagged_boot_rolls_back_and_retries_atomically() {
        let db = db().await;
        let mut rows = mixed_rows();
        rows.extend([
            row("alpha", "keep-aesenc", aesenc("user-key")),
            bound_row("beta", "keep-o2w2", "user-key"),
            row("gamma", "zz-last", legacy("last")),
        ]);
        seed(&db, rows).await;
        let before = stored(&db).await;
        db.execute_unprepared(
            "CREATE TRIGGER abort_last BEFORE UPDATE ON cipher_keys WHEN OLD.name = 'zz-last' \
             BEGIN SELECT RAISE(ABORT, 'interrupted'); END",
        )
        .await
        .unwrap();
        assert!(matches!(
            flagged_boot(&db).await.migration,
            MigrationOutcome::Failed(_)
        ));
        assert_eq!(stored(&db).await, before);
        db.execute_unprepared("DROP TRIGGER abort_last")
            .await
            .unwrap();

        let report = flagged_boot(&db).await;
        assert_eq!(report.already_wrapped, 3);
        assert_eq!(report.unprefixed, 6);
        assert_eq!(
            report.migration,
            MigrationOutcome::Migrated(
                [("alpha".into(), 3), ("beta".into(), 2), ("gamma".into(), 2)].into()
            )
        );
        let after = stored(&db).await;
        assert_eq!(after.len(), before.len());
        for (new, old) in after.iter().zip(&before) {
            if old.name.starts_with("keep-") {
                assert_eq!(new, old);
            } else {
                assert!(new.data.starts_with(WRAP_V2_PREFIX));
            }
            assert_eq!(
                read(new, WrapFloor::O2w2).unwrap(),
                read(old, WrapFloor::None).unwrap()
            );
        }

        db.execute_unprepared(
            "CREATE TRIGGER no_updates BEFORE UPDATE ON cipher_keys \
             BEGIN SELECT RAISE(ABORT, 'redundant update'); END",
        )
        .await
        .unwrap();
        let MigrationOutcome::Migrated(counts) = flagged_boot(&db).await.migration else {
            panic!("repeated migration failed");
        };
        assert_eq!(counts.values().sum::<usize>(), 0);
        assert_eq!(stored(&db).await, after);
    }

    #[tokio::test]
    async fn d225_migration_verification_and_conditional_updates_rollback_on_error() {
        let db = db().await;
        seed(&db, vec![row("alpha", "user", legacy("user-key"))]).await;
        let before = stored(&db).await;
        for trigger in [
            "CREATE TRIGGER fail BEFORE UPDATE ON cipher_keys BEGIN SELECT RAISE(IGNORE); END",
            "CREATE TRIGGER fail AFTER UPDATE ON cipher_keys \
             BEGIN UPDATE cipher_keys SET data = 'o2w2:bad' WHERE name = NEW.name; END",
        ] {
            db.execute_unprepared(trigger).await.unwrap();
            assert!(matches!(
                flagged_boot(&db).await.migration,
                MigrationOutcome::Failed(_)
            ));
            assert_eq!(stored(&db).await, before);
            db.execute_unprepared("DROP TRIGGER fail").await.unwrap();
        }
    }

    #[tokio::test]
    async fn d225_invalid_base64_aborts_flagged_migration() {
        let db = db().await;
        seed(
            &db,
            vec![
                row("alpha", "first", legacy("key")),
                row("alpha", "last", "not base64!".to_string()),
            ],
        )
        .await;
        let before = stored(&db).await;
        assert!(matches!(
            flagged_boot(&db).await.migration,
            MigrationOutcome::Failed(_)
        ));
        assert_eq!(stored(&db).await, before);
    }

    #[tokio::test]
    async fn r15_f09_flagged_migration_repairs_a_late_aesenc_system_dek() {
        let db = db().await;
        seed(&db, vec![row("alpha", DEFAULT_DEK_NAME, legacy("dek-a"))]).await;
        assert!(matches!(
            flagged_boot(&db).await.migration,
            MigrationOutcome::Migrated(_)
        ));
        seed(
            &db,
            vec![
                row("alpha", "user", aesenc("key")),
                row("beta", DEFAULT_DEK_NAME, aesenc("dek-b")),
            ],
        )
        .await;
        assert_eq!(count_aesenc_system_rows_in(&db).await.unwrap(), 1);
        let before = stored(&db).await;
        assert_dek_refused(before.iter().find(|r| r.org == "beta").unwrap());
        assert_eq!(
            flagged_boot(&db).await.migration,
            MigrationOutcome::Migrated([("beta".into(), 1)].into())
        );
        assert_eq!(count_aesenc_system_rows_in(&db).await.unwrap(), 0);
        let after = stored(&db).await;
        assert_eq!(
            read(
                after.iter().find(|r| r.org == "beta").unwrap(),
                WrapFloor::O2w2
            )
            .unwrap(),
            "dek-b"
        );
    }

    #[tokio::test]
    async fn d225_count_unprefixed_includes_planted_rows() {
        let db = db().await;
        seed(
            &db,
            vec![
                row("alpha", DEFAULT_DEK_NAME, "planted!".into()),
                row("beta", DEFAULT_DEK_NAME, aesenc("dek-b")),
                bound_row("gamma", DEFAULT_DEK_NAME, "dek-c"),
                row("delta", DEFAULT_DEK_NAME, "aesenc:planted".into()),
                row("epsilon", DEFAULT_DEK_NAME, "O2W2:planted".into()),
            ],
        )
        .await;
        assert_eq!(count_unprefixed_rows_in(&db).await.unwrap(), 3);
        assert_eq!(count_aesenc_system_rows_in(&db).await.unwrap(), 1);
    }

    #[tokio::test]
    async fn d225_no_master_key_refuses_both_prefixes_and_ignores_the_flags() {
        let db = db().await;
        let legacy = row("alpha", DEFAULT_DEK_NAME, legacy("dek-a"));
        seed(&db, vec![legacy.clone()]).await;
        let (outcome, installed) =
            boot_db(&db, MasterKeyMode::None, true, WrapFloor::O2w2, None).await;
        assert_eq!(installed, Some(Ok("None")));
        assert_eq!(
            outcome.unwrap().unwrap().migration,
            MigrationOutcome::NotRequested
        );
        assert_eq!(stored(&db).await, vec![legacy]);

        seed(&db, vec![bound_row("beta", DEFAULT_DEK_NAME, "dek-b")]).await;
        for count in [1, 2] {
            if count == 2 {
                seed(&db, vec![row("gamma", "user", aesenc("user-key"))]).await;
            }
            let before = stored(&db).await;
            let (outcome, installed) = boot_db(
                &db,
                MasterKeyMode::None,
                true,
                WrapFloor::O2w2,
                Some(vec![]),
            )
            .await;
            let problem = KeyProblem::WrappedRowsButNoKey { count };
            assert_eq!(outcome.unwrap(), Err(problem.clone()));
            assert_eq!(installed, Some(Err(problem)));
            assert_eq!(stored(&db).await, before);
        }
    }

    #[tokio::test]
    async fn d225_wrong_key_or_wrong_o2w2_identity_writes_nothing() {
        let bound = bound_row("alpha", "user", "value");
        for (mode, bad) in [
            (aes(2), row("alpha", "user", aesenc("value"))),
            (aes(2), bound.clone()),
            (
                aes(1),
                Model {
                    name: "moved".into(),
                    ..bound
                },
            ),
        ] {
            let db = db().await;
            let problem = KeyProblem::WrongKey {
                org: bad.org.clone(),
                name: bad.name.clone(),
            };
            seed(&db, vec![row("alpha", "legacy", legacy("key")), bad]).await;
            let before = stored(&db).await;
            let (outcome, installed) =
                boot_db(&db, mode, true, WrapFloor::O2w2, Some(vec![])).await;
            assert_eq!(outcome.unwrap(), Err(problem.clone()));
            assert_eq!(installed, Some(Err(problem)));
            assert_eq!(stored(&db).await, before);
        }
    }

    #[tokio::test]
    async fn b9_r12_the_dek_and_its_secrets_survive_a_flagged_rewrap() {
        let db = db().await;
        let dek = random_bytes(64);
        let secret = encrypt_secret_value(&dek, "sk-provider-key").unwrap();
        seed(
            &db,
            vec![row(
                "o",
                DEFAULT_DEK_NAME,
                legacy(&BASE64_STANDARD.encode(&dek)),
            )],
        )
        .await;
        let org = "b9_r12_cache";
        DEK_CACHE.insert(org.to_string(), Zeroizing::new(dek.clone()));
        assert!(matches!(
            flagged_boot(&db).await.migration,
            MigrationOutcome::Migrated(_)
        ));
        assert_eq!(DEK_CACHE.get(org).unwrap().to_vec(), dek);
        DEK_CACHE.remove(org);
        let after = BASE64_STANDARD
            .decode(read(&stored(&db).await[0], WrapFloor::O2w2).unwrap())
            .unwrap();
        assert_eq!(after, dek);
        assert_eq!(
            decrypt_secret_value(&after, &secret).unwrap(),
            "sk-provider-key"
        );
    }

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

    #[tokio::test]
    async fn test_org_encryption_provisions_only_on_write_and_forgets_deleted_keys() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if master_key().is_err() {
            boot(None).await.expect("cipher");
        }
        let org = crate::table::testing::unique("t_cipher_crypto");
        let other = format!("{org}_other");
        assert!(!has_org_key(&org).await.unwrap());
        assert!(decrypt_for_org(&org, "unreadable").await.is_err());
        assert!(
            get_data(&org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
                .await
                .unwrap()
                .is_none()
        );

        let encrypted = encrypt_for_org(&org, "sensitive").await.unwrap();
        assert_ne!(encrypted, "sensitive");
        assert!(has_org_key(&org).await.unwrap());
        assert_eq!(
            decrypt_for_org(&org, &encrypted).await.unwrap(),
            "sensitive"
        );
        encrypt_for_org(&other, "other").await.unwrap();
        assert!(decrypt_for_org(&other, &encrypted).await.is_err());

        delete_by_org(&org).await.unwrap();
        assert!(!has_org_key(&org).await.unwrap());
        assert!(decrypt_for_org(&org, &encrypted).await.is_err());
        assert!(
            get_data(&org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
                .await
                .unwrap()
                .is_none()
        );
        assert!(has_org_key(&other).await.unwrap());
        delete_by_org(&other).await.unwrap();
    }

    #[tokio::test]
    async fn test_user_key_delete_returns_only_non_system_names_of_the_org() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if master_key().is_err() {
            boot(None).await.expect("cipher");
        }
        let org = crate::table::testing::unique("t_cipher");
        let other = format!("{org}_other");
        for (owner, name, is_system) in [
            (&org, "user_a", false),
            (&org, "user_b", false),
            (&org, "system", true),
            (&other, "user_a", false),
        ] {
            add(CipherEntry {
                org: owner.clone(),
                created_at: 1,
                created_by: "t".to_string(),
                name: name.to_string(),
                data: "{}".to_string(),
                kind: EntryKind::CipherKey,
                is_system,
            })
            .await
            .unwrap();
        }

        let mut removed = delete_non_system_by_org(&org, EntryKind::CipherKey)
            .await
            .unwrap();
        removed.sort();
        let system_kept = get_data(&org, EntryKind::CipherKey, "system")
            .await
            .unwrap();
        let other_kept = get_data(&other, EntryKind::CipherKey, "user_a")
            .await
            .unwrap();
        delete_by_org(&org).await.unwrap();
        delete_by_org(&other).await.unwrap();

        assert_eq!(removed, ["user_a", "user_b"]);
        assert!(
            system_kept.is_some(),
            "the system key went with the user keys"
        );
        assert!(
            other_kept.is_some(),
            "another org's key went with this org's"
        );
    }

    fn user_entry(org: &str, name: &str, data: &str, is_system: bool) -> CipherEntry {
        CipherEntry {
            org: org.to_string(),
            created_at: 1,
            created_by: "t".to_string(),
            name: name.to_string(),
            data: data.to_string(),
            kind: EntryKind::CipherKey,
            is_system,
        }
    }

    #[tokio::test]
    async fn test_existing_dek_lookup_never_creates_a_key() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if master_key().is_err() {
            boot(None).await.expect("cipher");
        }
        let org = crate::table::testing::unique("t_cipher_existing");
        assert!(get_existing_dek(&org).await.unwrap().is_none());
        assert!(
            get(&org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
                .await
                .unwrap()
                .is_none()
        );
        let dek = get_or_create_dek(&org).await.unwrap();
        DEK_CACHE.remove(&org);
        assert_eq!(get_existing_dek(&org).await.unwrap(), Some(dek));
        delete_by_org(&org).await.unwrap();
    }

    #[tokio::test]
    async fn test_a_user_row_named_like_the_dek_is_never_a_dek() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if master_key().is_err() {
            boot(None).await.expect("cipher");
        }
        let org = crate::table::testing::unique("t_cipher_planted");
        add(user_entry(&org, DEFAULT_DEK_NAME, "cGxhbnRlZA==", false))
            .await
            .unwrap();
        let existing = get_existing_dek(&org).await.unwrap();
        let created = get_or_create_dek(&org).await;
        delete_by_org(&org).await.unwrap();
        assert!(existing.is_none());
        assert!(matches!(
            created,
            Err(errors::Error::SecretStore(SecretErrorCode::DekNameTaken))
        ));
    }

    #[tokio::test]
    async fn test_user_key_writes_never_touch_the_dek() {
        if !crate::table::testing::meta_store().await {
            return;
        }
        if master_key().is_err() {
            boot(None).await.expect("cipher");
        }
        let org = crate::table::testing::unique("t_cipher_d254");
        let dek = get_or_create_dek(&org).await.unwrap();
        add(user_entry(&org, "user_a", "a1", false)).await.unwrap();
        remove(&org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
            .await
            .unwrap();
        for is_system in [false, true] {
            update(user_entry(
                &org,
                DEFAULT_DEK_NAME,
                "b3ZlcndyaXR0ZW4=",
                is_system,
            ))
            .await
            .unwrap();
        }
        update(user_entry(&org, "user_a", "a2", false))
            .await
            .unwrap();
        DEK_CACHE.remove(&org);
        let dek_after = get_existing_dek(&org).await.unwrap();
        let user_after = get_data(&org, EntryKind::CipherKey, "user_a")
            .await
            .unwrap();
        remove(&org, EntryKind::CipherKey, "user_a").await.unwrap();
        let user_gone = get_data(&org, EntryKind::CipherKey, "user_a")
            .await
            .unwrap();
        delete_by_org(&org).await.unwrap();
        let dek_gone = get(&org, EntryKind::CipherKey, DEFAULT_DEK_NAME)
            .await
            .unwrap();

        assert_eq!(dek_after, Some(dek));
        assert_eq!(user_after.as_deref(), Some("a2"));
        assert!(user_gone.is_none());
        assert!(dek_gone.is_none(), "org teardown keeps removing the DEK");
    }
}
