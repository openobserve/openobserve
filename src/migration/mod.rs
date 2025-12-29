// Copyright 2025 OpenObserve Inc.
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
    let db_schema_version = match infra::get_db_schema_version().await {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "error in getting db schema version {e}; assuming default of 0 and trying upgrade."
            );
            0
        }
    };
    if db_schema_version == DB_SCHEMA_VERSION {
        // if version matches, we do not need to run update commands
        log::info!("DB_SCHEMA_VERSION match, skipping db upgrade");
        return Ok(());
    }
    log::info!(
        "DB_SCHEMA_VERSION mismatch : expected {}, found {db_schema_version}; running db upgrade",
        DB_SCHEMA_VERSION
    );

    infra::db_init().await?;
    // we initialize both clients here to avoid potential deadlock afterwards
    ORM_CLIENT_DDL.get_or_init(connect_to_orm_ddl).await;

    // migrate infra_sea_orm
    infra::table::migrate().await?;
    infra::set_db_schema_version().await?;

    // cloud-related migrations
    #[cfg(feature = "cloud")]
    o2_enterprise::enterprise::cloud::migrate().await?;

    Ok(())
}
