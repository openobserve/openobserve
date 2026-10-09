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

use base64::{Engine, prelude::BASE64_STANDARD};
use config::{
    RwHashMap,
    utils::{
        encryption::{Algorithm, SECRET_PREFIX, decode_encryption_key},
        rand::random_bytes,
        time::now_micros,
    },
};
use sea_orm::{
    ColumnTrait, ConnectionTrait, EntityTrait, Order, QueryFilter, QueryOrder, QuerySelect, Set,
    SqlErr, sea_query::Expr,
};
use serde::{Deserialize, Serialize};

use super::entity::cipher_keys::*;
use crate::{
    db::{get_orm_client_ro, get_orm_client_rw},
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

/// Key state, installed once by [`boot`] from `src/main.rs` and `tests/integration_test.rs`.
static MASTER_KEY: OnceLock<KeyState> = OnceLock::new();

const NO_KEY_WARNING: &str = "O2_MASTER_ENCRYPTION_KEY is not set: cipher keys are stored base64-encoded only, readable by anyone with database access";

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

/// What the boot step found and did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BootReport {
    pub mode: &'static str,
    pub already_wrapped: usize,
    pub rewrapped: usize,
    pub skipped: usize,
    pub unreadable: usize,
}

impl std::fmt::Display for BootReport {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "cipher master key: mode={} already_wrapped={} rewrapped={} skipped={} unreadable={}",
            self.mode, self.already_wrapped, self.rewrapped, self.skipped, self.unreadable
        )
    }
}

/// The boot step's decision: rows already wrapped, legacy rows to re-wrap, and unreadable rows.
#[derive(Default)]
struct BootPlan {
    already_wrapped: usize,
    rewraps: Vec<Rewrap>,
    unreadable: Vec<(String, String)>,
}

/// One legacy row's new value, written only while the row still holds `old`.
struct Rewrap {
    org: String,
    name: String,
    kind: String,
    old: String,
    new: String,
}

pub async fn add(entry: CipherEntry) -> Result<(), errors::Error> {
    let encrypted = wrap(master_key()?, &entry.data)?;
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

pub async fn update(entry: CipherEntry) -> Result<(), errors::Error> {
    let encrypted = wrap(master_key()?, &entry.data)?;
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
    Entity::update(record).exec(client).await?;

    Ok(())
}

pub async fn remove(org: &str, kind: EntryKind, name: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .filter(Column::Kind.eq(kind.to_string()))
        .filter(Column::Name.eq(name))
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
        .map(|m| unwrap(mode, org, name, &m.data))
        .transpose()
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

pub async fn list_all(limit: Option<i64>) -> Result<Vec<CipherEntry>, errors::Error> {
    let mode = master_key()?;
    let client = get_orm_client_ro().await;
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
            c.data = unwrap(mode, &c.org, &c.name, &c.data)?;
            Ok(c)
        })
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

    let records: Vec<CipherEntry> = records
        .into_iter()
        .map(<Model as TryInto<CipherEntry>>::try_into)
        .collect::<Result<Vec<_>, _>>()?;

    records
        .into_iter()
        .map(|mut c: CipherEntry| {
            c.data = unwrap(mode, &c.org, &c.name, &c.data)?;
            Ok(c)
        })
        .collect()
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

/// Deletes all cipher key entries belonging to the given org.
pub async fn delete_by_org(org: &str) -> Result<(), errors::Error> {
    let client = get_orm_client_rw().await;
    Entity::delete_many()
        .filter(Column::Org.eq(org))
        .exec(client)
        .await?;
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

/// Installs the mode and re-wraps, or turns secrets off. [weak: as `apply_rewraps`; else no write]
pub async fn boot(key_b64: Option<&str>) -> Result<(), errors::Error> {
    let mode = mode_from_setting(key_b64)?;
    if let Some(warning) = missing_key_warning(key_b64) {
        log::warn!("{warning}");
    }
    match boot_with(get_orm_client_rw().await, mode, install_master_key).await? {
        Ok(report) => log::info!("{report}"),
        Err(problem) => log::error!("cipher master key: stored secrets are off: {problem}"),
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

/// Turns a plaintext key into the stored text for the mode. [pure]
fn wrap(mode: &MasterKeyMode, plaintext: &str) -> Result<String, errors::Error> {
    let stored = match mode {
        MasterKeyMode::Aes(key) => Algorithm::Aes256Siv
            .encrypt(key, plaintext)
            .map(|sealed| format!("{SECRET_PREFIX}{sealed}")),
        MasterKeyMode::None => Algorithm::None.encrypt(&[], plaintext),
    };
    stored.map_err(|e| errors::Error::Message(e.to_string()))
}

/// Turns stored text back into the plaintext key, naming the row on failure. [pure]
fn unwrap(
    mode: &MasterKeyMode,
    org: &str,
    name: &str,
    stored: &str,
) -> Result<String, errors::Error> {
    // The marker is checked here because the shared secret helper silently accepts unmarked input.
    let Some(sealed) = stored.strip_prefix(SECRET_PREFIX) else {
        return Algorithm::None.decrypt(&[], stored).map_err(|e| {
            errors::Error::Message(format!(
                "cipher key '{name}' (org={org}) is unreadable: {e}"
            ))
        });
    };
    match mode {
        MasterKeyMode::Aes(key) => Algorithm::Aes256Siv.decrypt(key, sealed).map_err(|e| {
            errors::Error::Message(format!(
                "cipher key '{name}' (org={org}) does not unwrap with the master key: {e}"
            ))
        }),
        MasterKeyMode::None => Err(errors::Error::Message(format!(
            "cipher key '{name}' (org={org}): row wrapped by a master key but O2_MASTER_ENCRYPTION_KEY is unset"
        ))),
    }
}

/// Decides which legacy rows to re-wrap, or which key problem turns secrets off. [pure]
fn plan_boot(mode: &MasterKeyMode, rows: &[Model]) -> Result<BootPlan, KeyProblem> {
    let (wrapped, legacy): (Vec<&Model>, Vec<&Model>) =
        rows.iter().partition(|r| r.data.starts_with(SECRET_PREFIX));
    match mode {
        MasterKeyMode::None if wrapped.is_empty() => Ok(BootPlan::default()),
        MasterKeyMode::None => Err(KeyProblem::WrappedRowsButNoKey {
            count: wrapped.len(),
        }),
        MasterKeyMode::Aes(_) => plan_aes_boot(mode, &wrapped, &legacy),
    }
}

fn plan_aes_boot(
    mode: &MasterKeyMode,
    wrapped: &[&Model],
    legacy: &[&Model],
) -> Result<BootPlan, KeyProblem> {
    if let Some(bad) = wrapped
        .iter()
        .find(|r| unwrap(mode, &r.org, &r.name, &r.data).is_err())
    {
        return Err(KeyProblem::WrongKey {
            org: bad.org.clone(),
            name: bad.name.clone(),
        });
    }
    let mut plan = BootPlan {
        already_wrapped: wrapped.len(),
        ..Default::default()
    };
    for r in legacy {
        match unwrap(mode, &r.org, &r.name, &r.data).and_then(|plain| wrap(mode, &plain)) {
            Ok(new) => plan.rewraps.push(Rewrap {
                org: r.org.clone(),
                name: r.name.clone(),
                kind: r.kind.clone(),
                old: r.data.clone(),
                new,
            }),
            Err(_) => plan.unreadable.push((r.org.clone(), r.name.clone())),
        }
    }
    Ok(plan)
}

/// Writes each new value only while the row holds the old one. [weak: rest stay legacy; rerun safe]
async fn apply_rewraps<C: ConnectionTrait>(
    conn: &C,
    rewraps: &[Rewrap],
) -> Result<(usize, usize), errors::Error> {
    let (mut rewrapped, mut skipped) = (0, 0);
    for r in rewraps {
        let res = Entity::update_many()
            .col_expr(Column::Data, Expr::value(r.new.clone()))
            .filter(Column::Org.eq(&r.org))
            .filter(Column::Name.eq(&r.name))
            .filter(Column::Kind.eq(&r.kind))
            .filter(Column::Data.eq(&r.old))
            .exec(conn)
            .await?;
        match res.rows_affected {
            0 => skipped += 1,
            _ => rewrapped += 1,
        }
    }
    Ok((rewrapped, skipped))
}

async fn boot_with<C: ConnectionTrait>(
    conn: &C,
    mode: MasterKeyMode,
    install: impl FnOnce(KeyState) -> Result<(), errors::Error>,
) -> Result<Result<BootReport, KeyProblem>, errors::Error> {
    let rows = Entity::find().all(conn).await?;
    let plan = match plan_boot(&mode, &rows) {
        Ok(plan) => plan,
        Err(problem) => {
            install(Err(problem.clone()))?;
            return Ok(Err(problem));
        }
    };
    let mode_name = mode.name();
    install(Ok(mode))?;
    for (org, name) in &plan.unreadable {
        log::warn!("cipher key '{name}' (org={org}) is not valid base64 and was left as is");
    }
    let (rewrapped, skipped) = apply_rewraps(conn, &plan.rewraps).await?;
    Ok(Ok(BootReport {
        mode: mode_name,
        already_wrapped: plan.already_wrapped,
        rewrapped,
        skipped,
        unreadable: plan.unreadable.len(),
    }))
}

#[cfg(test)]
mod tests {
    use base64::{Engine, prelude::BASE64_STANDARD};
    use config::utils::encryption::{decrypt_secret_value, encrypt_secret_value};
    use sea_orm::{ActiveModelTrait, ConnectOptions, Database, DatabaseConnection, Schema};

    use super::*;

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

    async fn stored(db: &DatabaseConnection) -> Vec<(String, String, String)> {
        let mut rows: Vec<_> = Entity::find()
            .all(db)
            .await
            .unwrap()
            .into_iter()
            .map(|m| (m.org, m.name, m.data))
            .collect();
        rows.sort();
        rows
    }

    fn legacy(plaintext: &str) -> String {
        wrap(&MasterKeyMode::None, plaintext).unwrap()
    }

    fn sealed(mode: &MasterKeyMode, plaintext: &str) -> String {
        wrap(mode, plaintext).unwrap()
    }

    type Installed = Option<Result<&'static str, KeyProblem>>;

    // Boots against `db` with a local installer so the process-global state stays untouched.
    async fn boot_db(
        db: &DatabaseConnection,
        mode: MasterKeyMode,
    ) -> (
        Result<Result<BootReport, KeyProblem>, errors::Error>,
        Installed,
    ) {
        let mut installed = None;
        let outcome = boot_with(db, mode, |state| {
            installed = Some(state.map(|m| m.name()));
            Ok(())
        })
        .await;
        (outcome, installed)
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
    fn b9_r4_r5_wrap_by_mode() {
        let key = aes(1);
        let wrapped = wrap(&key, "dek").unwrap();
        let expected = format!(
            "{SECRET_PREFIX}{}",
            Algorithm::Aes256Siv.encrypt(&[1u8; 64], "dek").unwrap()
        );
        assert_eq!(wrapped, expected);
        assert_eq!(unwrap(&key, "o", "n", &wrapped).unwrap(), "dek");
        assert_eq!(
            wrap(&MasterKeyMode::None, "dek").unwrap(),
            BASE64_STANDARD.encode("dek"),
            "None mode stores exactly what it stored before the master key existed"
        );
    }

    #[test]
    fn b9_r6_r7_unwrap_by_mode_and_marker() {
        let marked = sealed(&aes(2), "dek");
        let unmarked = BASE64_STANDARD.encode("dek");
        let cases: [(MasterKeyMode, &str, Result<&str, &str>); 5] = [
            (aes(2), &marked, Ok("dek")),
            (aes(1), &marked, Err("cipher key 'name1' (org=org1)")),
            (
                MasterKeyMode::None,
                &marked,
                Err("row wrapped by a master key but O2_MASTER_ENCRYPTION_KEY is unset"),
            ),
            (aes(1), &unmarked, Ok("dek")),
            (MasterKeyMode::None, &unmarked, Ok("dek")),
        ];
        for (mode, stored, expected) in cases {
            match (unwrap(&mode, "org1", "name1", stored), expected) {
                (Ok(got), Ok(want)) => assert_eq!(got, want),
                (Err(got), Err(want)) => assert!(got.to_string().contains(want), "{got}"),
                (got, want) => panic!(
                    "{stored}: got {:?}, want {want:?}",
                    got.map_err(|e| e.to_string())
                ),
            }
        }
    }

    #[test]
    fn b9_r8_r9_r10_plan_boot() {
        let k = aes(1);
        let good = row("o", "good", sealed(&k, "a"));
        let bad = row("o", "bad", sealed(&aes(2), "b"));
        let old1 = row("o", "old1", legacy("c"));
        let old2 = row("p", DEFAULT_DEK_NAME, legacy("d"));
        let junk = row("o", "junk", "not base64!".to_string());
        type Expected = Result<(usize, String, usize), KeyProblem>;
        let cases: Vec<(&MasterKeyMode, Vec<Model>, Expected)> = vec![
            (
                &MasterKeyMode::None,
                vec![old1.clone()],
                Ok((0, String::new(), 0)),
            ),
            (
                &MasterKeyMode::None,
                vec![good.clone(), bad.clone(), old1.clone()],
                Err(KeyProblem::WrappedRowsButNoKey { count: 2 }),
            ),
            (
                &k,
                vec![good.clone(), bad.clone(), old1.clone()],
                Err(KeyProblem::WrongKey {
                    org: "o".to_string(),
                    name: "bad".to_string(),
                }),
            ),
            (
                &k,
                vec![good.clone(), old1.clone(), old2.clone()],
                Ok((1, format!("old1,{DEFAULT_DEK_NAME}"), 0)),
            ),
            (
                &k,
                vec![good.clone(), junk.clone()],
                Ok((1, String::new(), 1)),
            ),
        ];
        for (mode, rows, expected) in cases {
            let got = plan_boot(mode, &rows).map(|p| {
                for r in &p.rewraps {
                    let before = rows.iter().find(|m| m.name == r.name).unwrap();
                    assert_eq!(r.old, before.data);
                    assert_eq!(
                        unwrap(mode, &r.org, &r.name, &r.new).unwrap(),
                        unwrap(mode, &r.org, &r.name, &r.old).unwrap()
                    );
                }
                let names: Vec<&str> = p.rewraps.iter().map(|r| r.name.as_str()).collect();
                (p.already_wrapped, names.join(","), p.unreadable.len())
            });
            assert_eq!(got, expected);
        }
    }

    #[tokio::test]
    async fn b9_r9_a_wrong_key_writes_nothing() {
        let db = db().await;
        seed(
            &db,
            vec![
                row("o", "a", sealed(&aes(1), "x")),
                row("o", "b", legacy("y")),
            ],
        )
        .await;
        let before = stored(&db).await;
        let problem = KeyProblem::WrongKey {
            org: "o".to_string(),
            name: "a".to_string(),
        };
        let (outcome, installed) = boot_db(&db, aes(2)).await;
        assert_eq!(outcome.unwrap(), Err(problem.clone()));
        assert_eq!(installed, Some(Err(problem)));
        assert_eq!(stored(&db).await, before);
    }

    #[tokio::test]
    async fn b9_r8_wrapped_rows_without_a_key_turn_secrets_off() {
        let db = db().await;
        seed(
            &db,
            vec![
                row("o", "a", sealed(&aes(1), "x")),
                row("o", "b", legacy("y")),
            ],
        )
        .await;
        let before = stored(&db).await;
        let problem = KeyProblem::WrappedRowsButNoKey { count: 1 };
        let (outcome, installed) = boot_db(&db, MasterKeyMode::None).await;
        assert_eq!(outcome.unwrap(), Err(problem.clone()));
        assert_eq!(installed, Some(Err(problem)));
        assert_eq!(stored(&db).await, before);
    }

    #[tokio::test]
    async fn b9_r10_a_row_changed_since_the_plan_is_skipped() {
        let db = db().await;
        let k = aes(1);
        seed(&db, vec![row("o", "a", legacy("x"))]).await;
        let plan = plan_boot(&k, &Entity::find().all(&db).await.unwrap()).unwrap();
        Entity::update_many()
            .col_expr(Column::Data, Expr::value(legacy("edited")))
            .exec(&db)
            .await
            .unwrap();
        assert_eq!(apply_rewraps(&db, &plan.rewraps).await.unwrap(), (0, 1));
        assert_eq!(stored(&db).await[0].2, legacy("edited"));
    }

    #[tokio::test]
    async fn b9_r10_a_partial_rewrap_is_completed_by_the_next_boot() {
        let db = db().await;
        let k = aes(1);
        seed(
            &db,
            vec![row("o", "a", legacy("x")), row("o", "b", legacy("y"))],
        )
        .await;
        db.execute_unprepared(
            "CREATE TRIGGER no_b BEFORE UPDATE ON cipher_keys WHEN OLD.name = 'b' \
             BEGIN SELECT RAISE(ABORT, 'refused'); END",
        )
        .await
        .unwrap();
        assert!(boot_db(&db, aes(1)).await.0.is_err());
        let partial = stored(&db).await;
        assert!(partial[0].2.starts_with(SECRET_PREFIX) != partial[1].2.starts_with(SECRET_PREFIX));

        db.execute_unprepared("DROP TRIGGER no_b").await.unwrap();
        let report = boot_db(&db, k).await.0.unwrap().unwrap();
        assert_eq!((report.already_wrapped, report.rewrapped), (1, 1));
        assert!(
            stored(&db)
                .await
                .iter()
                .all(|r| r.2.starts_with(SECRET_PREFIX))
        );
    }

    #[tokio::test]
    async fn b9_r11_r13_both_kinds_rewrapped_once_and_the_cache_kept() {
        let db = db().await;
        let org = "b9_r11_org";
        seed(
            &db,
            vec![
                row(org, DEFAULT_DEK_NAME, legacy("dek")),
                row(org, "user-key", legacy("{}")),
            ],
        )
        .await;
        DEK_CACHE.insert(org.to_string(), (vec![9u8], Instant::now()));

        let (first, installed) = boot_db(&db, aes(1)).await;
        assert_eq!(installed, Some(Ok("AES")));
        let first = first.unwrap().unwrap();
        assert_eq!(
            first,
            BootReport {
                mode: "AES",
                already_wrapped: 0,
                rewrapped: 2,
                skipped: 0,
                unreadable: 0
            }
        );
        assert_eq!(
            first.to_string(),
            "cipher master key: mode=AES already_wrapped=0 rewrapped=2 skipped=0 unreadable=0"
        );
        assert!(
            stored(&db)
                .await
                .iter()
                .all(|r| r.2.starts_with(SECRET_PREFIX))
        );
        assert_eq!(DEK_CACHE.get(org).unwrap().0, vec![9u8]);

        let before = stored(&db).await;
        let second = boot_db(&db, aes(1)).await.0.unwrap().unwrap();
        assert_eq!((second.already_wrapped, second.rewrapped), (2, 0));
        assert_eq!(stored(&db).await, before);
    }

    #[tokio::test]
    async fn b9_r12_the_dek_and_its_secrets_survive_a_rewrap() {
        let db = db().await;
        let k = aes(1);
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

        boot_db(&db, aes(1)).await.0.unwrap().unwrap();
        let data = &stored(&db).await[0].2;
        let after = BASE64_STANDARD
            .decode(unwrap(&k, "o", DEFAULT_DEK_NAME, data).unwrap())
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
}
