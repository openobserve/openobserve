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

//! Database migration module for migrating data between different database backends.
//!
//! This module provides three main commands:
//! - `init-db`: Initialize the database tables
//! - `migrate-meta`: Migrate all tables except file_list related tables
//! - `migrate-file-list`: Migrate file_list related tables only

use ::config::DB_SCHEMA_VERSION;
use infra::db::{ORM_CLIENT, ORM_CLIENT_DDL, connect_to_orm, connect_to_orm_ddl};

mod adapter;
mod config;
mod migrator;
mod progress;

pub use config::MigrationConfig;
pub use migrator::{run_file_list, run_meta};

pub async fn init_db() -> std::result::Result<(), anyhow::Error> {
    // we init client here to avoid deadlocks
    ORM_CLIENT.get_or_init(connect_to_orm).await;
    // reading the version must be reliable: a genuinely missing version
    // (fresh install) is reported as Ok(0), so an error here means the
    // database is unreachable or overloaded. Never treat that as a fresh
    // install - running the full db upgrade against a struggling database
    // only adds more load on top of it. Retry, then abort the startup.
    const MAX_RETRIES: usize = 5;
    let mut db_schema_version = 0;
    let mut last_err = None;
    for attempt in 1..=MAX_RETRIES {
        match infra::get_db_schema_version().await {
            Ok(v) => {
                db_schema_version = v;
                last_err = None;
                break;
            }
            Err(e) => {
                log::warn!(
                    "error in getting db schema version (attempt {attempt}/{MAX_RETRIES}): {e}, retrying..."
                );
                last_err = Some(e);
                tokio::time::sleep(std::time::Duration::from_secs(attempt as u64 * 2)).await;
            }
        }
    }
    if let Some(e) = last_err {
        return Err(anyhow::anyhow!(
            "failed to get db schema version after {MAX_RETRIES} attempts: {e}; refusing to assume a fresh install and run the db upgrade against an unhealthy database"
        ));
    }
    if db_schema_version == DB_SCHEMA_VERSION {
        // if version matches, we do not need to run update commands
        log::info!("DB_SCHEMA_VERSION match, skipping db upgrade");
        return Ok(());
    }
    log::info!(
        "DB_SCHEMA_VERSION mismatch : expected {}, found {db_schema_version}; running db upgrade",
        DB_SCHEMA_VERSION
    );

    // acquire lock for 1 hour for init or migration db
    let lock = infra::dist_lock::lock("/database/init", 3600).await?;

    if let Err(e) = infra::db_init().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }

    // we initialize both clients here to avoid potential deadlock afterwards
    ORM_CLIENT_DDL.get_or_init(connect_to_orm_ddl).await;

    // migrate infra_sea_orm
    if let Err(e) = infra::table::migrate().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }
    // cloud-related migrations
    #[cfg(feature = "cloud")]
    if let Err(e) = o2_enterprise::enterprise::cloud::migrate().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }

    if let Err(e) = infra::set_db_schema_version().await {
        infra::dist_lock::unlock(&lock).await?;
        return Err(e);
    }

    // release lock
    infra::dist_lock::unlock(&lock).await?;

    log::info!("DB upgrade completed to version {}", DB_SCHEMA_VERSION);

    Ok(())
}
