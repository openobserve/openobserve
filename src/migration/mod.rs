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

use config::cluster::LOCAL_NODE;
use infra::db::{ORM_CLIENT, ORM_CLIENT_DDL, connect_to_orm, connect_to_orm_ddl};
use schema::migrate_resource_names;
use version_compare::Version;

use crate::service::db::version;

pub mod dashboards;
pub mod file_list;
pub mod meta;
pub mod pipeline_func;
pub mod schema;

async fn check_upgrade(old_ver: &str, new_ver: &str) -> Result<(), anyhow::Error> {
    let old_ver = Version::from(old_ver).unwrap();
    let new_ver = Version::from(new_ver).unwrap();
    let zero = Version::from("v0.0.0").unwrap();
    if old_ver == zero {
        // new install
        return Ok(());
    }
    if old_ver >= new_ver {
        return Ok(());
    }

    log::info!("Upgrading from {} to {}", old_ver, new_ver);
    let v093 = Version::from("v0.9.3").unwrap();
    if old_ver < v093 {
        #[allow(deprecated)]
        upgrade_092_093().await?;
    }

    let v131 = Version::from("v0.13.1").unwrap();
    if old_ver < v131 {
        upgrade_130_131().await?;
    }

    Ok(())
}

#[deprecated(since = "0.14.0", note = "will be removed in 0.17.0")]
async fn upgrade_092_093() -> Result<(), anyhow::Error> {
    // migration schema
    #[allow(deprecated)]
    schema::run().await?;

    Ok(())
}

async fn upgrade_130_131() -> Result<(), anyhow::Error> {
    // migrate pipelines and function associations
    pipeline_func::run(false).await?;

    Ok(())
}

#[deprecated(since = "0.14.0", note = "will be removed in 0.17.0")]
async fn upgrade_resource_names() -> Result<(), anyhow::Error> {
    // The below migration requires ofga init ready, but on Router node,
    // we don't initialize ofga, hence the migration should not run on router
    if !LOCAL_NODE.is_router() {
        migrate_resource_names().await?;
    }
    Ok(())
}

pub async fn init_db() -> std::result::Result<(), anyhow::Error> {
    let db_schema_version = match infra::get_db_schema_version().await {
        Ok(v) => v,
        Err(e) => {
            log::warn!(
                "error in getting db schema version {e} ; assuming default of 0 and trying upgrade."
            );
            0
        }
    };
    if db_schema_version == config::DB_SCHEMA_VERSION {
        // if version matches, we do not need to run update commands
        log::info!("DB_SCHEMA_VERSION match, skipping db upgrade");
        return Ok(());
    }
    log::info!(
        "DB_SCHEMA_VERSION mismatch : expected {}, found {db_schema_version} ; running db upgrade",
        config::DB_SCHEMA_VERSION
    );

    infra::db_init().await?;
    // we initialize both clients here to avoid potential deadlock afterwards
    ORM_CLIENT.get_or_init(connect_to_orm).await;
    ORM_CLIENT_DDL.get_or_init(connect_to_orm_ddl).await;
    // check version upgrade
    let old_version = version::get().await.unwrap_or("v0.0.0".to_string());
    check_upgrade(&old_version, config::VERSION).await?;

    #[allow(deprecated)]
    upgrade_resource_names().await?;
    // migrate infra_sea_orm
    infra::table::migrate().await?;
    // migrate dashboards
    dashboards::run().await?;

    infra::set_db_schema_version().await?;
    Ok(())
}
