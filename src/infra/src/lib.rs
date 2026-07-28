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

#![feature(btree_cursors)]

pub mod bloom;
pub mod cache;
pub mod client;
pub mod cluster;
pub mod coordinator;
pub mod db;
pub mod dist_lock;
pub mod errors;
pub mod file_list;
pub mod local_lock;
pub mod pipeline;
pub mod queue;
pub mod runtime;
pub mod scheduler;
pub mod schema;
pub mod storage;
pub mod table;

/// Get the db schema version.
///
/// Returns `Ok(0)` only when the version is genuinely absent: the version key
/// does not exist (fresh install or pre-versioning database) or the meta
/// table itself does not exist yet (fresh install, the tables are created by
/// the upgrade the caller is about to run). Any other error - connection
/// failure, timeout, overloaded database - is returned as an error: callers
/// must NOT treat those as a fresh install, otherwise a struggling database
/// would get a full schema upgrade on top of its existing load.
pub async fn get_db_schema_version() -> Result<u64, anyhow::Error> {
    let db = db::get_db().await;
    let b = match db.get(config::DB_SCHEMA_KEY).await {
        Ok(v) => v,
        Err(e) if is_db_schema_version_missing(&e) => return Ok(0),
        Err(e) => return Err(e.into()),
    };
    let s = String::from_utf8_lossy(&b);
    let k = match s.parse::<u64>() {
        Ok(v) => v,
        Err(e) => {
            return Err(anyhow::anyhow!(
                "invalid DB_SCHEMA_VERSION found in db : {e}"
            ));
        }
    };

    Ok(k)
}

/// Whether the error means the schema version is genuinely not stored yet,
/// as opposed to the database being unreachable or overloaded.
fn is_db_schema_version_missing(e: &errors::Error) -> bool {
    match e {
        // the version key is not present (all backends map a missing key to
        // KeyNotExists): fresh install or pre-versioning database
        errors::Error::DbError(errors::DbError::KeyNotExists(_)) => true,
        // the meta table itself does not exist yet: fresh SQL install
        errors::Error::SqlxError(sqlx::Error::Database(e)) => {
            // postgres: undefined_table
            e.code().as_deref() == Some("42P01")
                // sqlite reports a generic error code, match the message
                || e.message().contains("no such table")
        }
        _ => false,
    }
}

#[cfg(test)]
mod schema_version_tests {
    use super::*;

    #[test]
    fn test_missing_version_key_is_fresh_install() {
        let e = errors::Error::DbError(errors::DbError::KeyNotExists("/meta/kv/version".into()));
        assert!(is_db_schema_version_missing(&e));
    }

    #[test]
    fn test_other_errors_are_not_fresh_install() {
        // a connection-level error must never be treated as a fresh install
        let e = errors::Error::Message("connection refused".to_string());
        assert!(!is_db_schema_version_missing(&e));
        let e = errors::Error::SqlxError(sqlx::Error::PoolTimedOut);
        assert!(!is_db_schema_version_missing(&e));
    }
}

pub async fn set_db_schema_version() -> Result<(), anyhow::Error> {
    let db = db::get_db().await;
    let s = config::DB_SCHEMA_VERSION.to_string();
    let b = bytes::Bytes::from_owner(s);
    db.put(config::DB_SCHEMA_KEY, b, false, None).await?;
    Ok(())
}

pub async fn db_init() -> Result<(), anyhow::Error> {
    // check db dir
    std::fs::create_dir_all(&config::get_config().common.data_db_dir)?;
    db::init().await?;
    file_list::create_table().await?;
    file_list::create_table_index().await?;
    pipeline::init().await?;
    queue::init().await?;
    scheduler::init().await?;
    schema::init().await?;
    table::init().await?;
    Ok(())
}

pub async fn init() -> Result<(), anyhow::Error> {
    if !config::cluster::LOCAL_NODE.is_ingester()
        && !config::cluster::LOCAL_NODE.is_querier()
        && !config::cluster::LOCAL_NODE.is_compactor()
    {
        return Ok(());
    }

    let cfg = config::get_config();

    // if we have skipped db migrations (because version is up-to-date),
    // for non-stateful set components this dir will be absent, so we create it anyways
    std::fs::create_dir_all(&cfg.common.data_db_dir)?;
    cache::init().await?;

    // check for coordinator table
    let coordinator = db::get_coordinator().await;
    coordinator.create_table().await?;

    // check for file_list table
    file_list::LOCAL_CACHE.create_table().await?;
    if config::cluster::LOCAL_NODE.is_ingester() || config::cluster::LOCAL_NODE.is_querier() {
        file_list::LOCAL_CACHE.create_table_index().await?;
    }
    file_list::local_cache_gc().await?;
    if cfg.common.meta_store == "postgres" {
        file_list::postgres::spawn_maintenance_task().await?;
    }
    if !config::is_local_disk_storage() {
        storage::test_remote_config().await?;
    }

    // because of asynchronous, we need to wait for a while
    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;

    log::info!("Shutting down DDL connection pool");
    // Shutdown DDL connection pool after all migrations are complete
    if cfg.common.meta_store.as_str() == "postgres"
        && let Err(e) = crate::db::postgres::shutdown_ddl_pool().await
    {
        log::warn!("Failed to shutdown PostgreSQL DDL connection pool: {}", e);
    }

    Ok(())
}
